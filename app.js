const USE_SUPABASE = true;

// ── APP STATE ─────────────────────────────────────────────────────────────────
const App = {
    isLoggedIn:    false,
    isAdmin:       false,
    isSuperAdmin:  false,
    currentUser:   null,
    activeFilter:  'all',
    searchQuery:   '',
    openPostId:    null,  // which post's comments panel is open
};

// ── BOOT ──────────────────────────────────────────────────────────────────────
(async () => {
    if (USE_SUPABASE) {
        const me = await sb.handleCallback();
        if (me) setUser(me);
        else {
            const restored = await sb.restoreSession();
            if (restored?._banned) {
                showToast('Your account has been banned.');
                sb.signOut();
            } else if (restored) {
                setUser(restored);
            }
        }
        const rows = await sb.getPosts();
        POSTS = (rows || []).filter(r => !r.is_deleted).map(mapRow);
    }
    updateMenuState();
    initSearch();
    initFilters();
    renderFeed();
    startPolling();
    // If redirected from admin panel — go straight back if already logged in as admin,
    // otherwise open the login modal.
    if (new URLSearchParams(window.location.search).get('relogin') === '1') {
        history.replaceState({}, '', window.location.pathname);
        if (App.isAdmin) {
            // Session restored fine — go back to admin panel immediately
            window.location.href = 'admin.html';
        } else {
            setTimeout(() => { openLogin(); showToast('Please sign in to access the admin panel.'); }, 500);
        }
    }
})();

// ── LIVE POLLING ───────────────────────────────────────────────────────────────
let _pendingNewPosts = [];      // new posts waiting for banner click
let _dmUnreadCount   = 0;
let _postSSE         = null;    // EventSource for new posts
let _dmSSE           = null;    // EventSource for DM notifications

// ── SSE CONNECTIONS ────────────────────────────────────────────────────────────
function startPolling() {
    connectPostSSE();
    pollDMBadge();  // initial badge check
}

let _commentSSE = null;

function connectPostSSE() {
    if (_postSSE) { _postSSE.close(); }
    const url = sb.API_BASE + '/stream?channel=all';
    _postSSE = new EventSource(url);
    _postSSE.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.type === 'new_post')    onNewPostSSE(data.post);
            if (data.type === 'new_comment') onNewCommentSSE(data.comment);
        } catch {}
    };
    _postSSE.onerror = () => {
        _postSSE.close();
        setTimeout(connectPostSSE, 3000);
    };
}

function connectCommentSSE(postId) {
    if (_commentSSE) { _commentSSE.close(); _commentSSE = null; }
    const url = sb.API_BASE + `/stream?channel=post:${encodeURIComponent(postId)}`;
    _commentSSE = new EventSource(url);
    _commentSSE.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.type === 'new_comment') onNewCommentSSE(data.comment);
        } catch {}
    };
    _commentSSE.onerror = () => {
        if (_commentSSE) { _commentSSE.close(); _commentSSE = null; }
        // Reconnect after 3s as long as this post is still open
        if (App.openPostId === postId) setTimeout(() => connectCommentSSE(postId), 3000);
    };
}

function connectDMSSE(myUid) {
    if (_dmSSE) { _dmSSE.close(); }
    const url = sb.API_BASE + `/stream?channel=dm:${encodeURIComponent(myUid)}`;
    _dmSSE = new EventSource(url);
    _dmSSE.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.type === 'new_dm') onNewDMSSE(data);
        } catch {}
    };
    _dmSSE.onerror = () => {
        _dmSSE.close();
        setTimeout(() => connectDMSSE(myUid), 3000);
    };
}

function onNewPostSSE(rawPost) {
    const knownIds = new Set(POSTS.map(p => p.id));
    if (knownIds.has(rawPost.id)) return;  // already have it (we just posted it)
    // Don't show banner to the person who just posted
    if (App.isLoggedIn && rawPost.author_uid === App.currentUser?.uid) return;
    const card = mapRow(rawPost);
    _pendingNewPosts.unshift(card);
    showNewPostsBanner(_pendingNewPosts.length);
}

function onNewCommentSSE(comment) {
    if (App.openPostId !== comment.post_id) return;
    // Skip if we just sent this ourselves
    if (App.isLoggedIn && comment.author?.uid === App.currentUser?.uid) return;
    // Re-fetch full comment list (for accurate vote state and full nesting)
    sb.getComments(comment.post_id).then(comments => {
        if (!Array.isArray(comments)) return;
        if (App.openPostId === comment.post_id) renderComments(comments);
    });
}

function onNewDMSSE(data) {
    const dmSheet = document.getElementById('dmSheet');
    const threadVisible = document.getElementById('dmThread')?.style.display !== 'none';

    if (dmSheet?.classList.contains('open') && threadVisible && _dmOtherUid === data.from_uid) {
        // Thread with this person is open — append message live
        appendDMMessage(data.msg, false);
    } else {
        // Sheet closed or different thread — bump badge
        _dmUnreadCount++;
        updateDMBadge(_dmUnreadCount);
    }
}

function appendDMMessage(msg, isMe) {
    const msgs = document.getElementById('dmMessages');
    if (!msgs) return;
    const atBottom = msgs.scrollHeight - msgs.clientHeight - msgs.scrollTop < 60;
    const div = document.createElement('div');
    div.className = `dm-msg ${isMe ? 'me' : 'them'}`;
    const imgHtml = msg.image_url
        ? `<img src="${msg.image_url}" style="max-width:180px;max-height:160px;border-radius:8px;display:block;margin-top:${msg.body?'6px':'0'};object-fit:cover;cursor:pointer" onclick="this.style.maxWidth=this.style.maxWidth==='100%'?'180px':'100%'">`
        : '';
    div.innerHTML = (msg.body ? escHtml(msg.body) : '') + imgHtml +
        ``;
    // Remove "no messages" placeholder if present
    const placeholder = msgs.querySelector('div[style*="text-align:center"]');
    if (placeholder) placeholder.remove();
    msgs.appendChild(div);
    if (atBottom) msgs.scrollTop = msgs.scrollHeight;
}

function showNewPostsBanner(count) {
    const banner = document.getElementById('newPostsBanner');
    const label  = document.getElementById('newPostsLabel');
    if (!banner) return;
    label.textContent = `↑ ${count} new post${count === 1 ? '' : 's'}`;
    banner.style.display = '';
    requestAnimationFrame(() => banner.classList.add('visible'));
}

function dismissNewPosts() {
    if (_pendingNewPosts.length) {
        const knownIds = new Set(POSTS.map(p => p.id));
        const fresh = _pendingNewPosts.filter(p => !knownIds.has(p.id));
        POSTS = [...fresh, ...POSTS];
        renderFeed();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        _pendingNewPosts = [];
    }
    const banner = document.getElementById('newPostsBanner');
    if (banner) {
        banner.classList.remove('visible');
        setTimeout(() => { banner.style.display = 'none'; }, 260);
    }
}

async function pollDMBadge() {
    if (!App.isLoggedIn) { updateDMBadge(0); return; }
    const dmSheet = document.getElementById('dmSheet');
    if (dmSheet?.classList.contains('open')) { updateDMBadge(0); return; }
    const res = await sb.getUnreadCount();
    _dmUnreadCount = res?.count || 0;
    updateDMBadge(_dmUnreadCount);
}

function updateDMBadge(count) {
    const badge = document.getElementById('dmFabBadge');
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

// ── MAP SUPABASE ROW → CARD OBJECT ────────────────────────────────────────────
function mapRow(r) {
    const d = new Date(r.created_at);
    const dateStr = d.toLocaleDateString('en-GB', {day:'numeric', month:'short'});
    return {
        id:            r.id,
        owner:         r.author_uid      || r.uid || '',
        ownerName:     r.author_name     || r.name || '',
        ownerInitials: r.author_initials || r.initials || '?',
        ownerColor:    r.author_color    || r.color || '#5b8dff',
        ownerId:       r.author_id       || '',
        ownerRole:     r.author_role     || '',
        title:         r.title       || '',
        desc:          r.description || '',
        location:      r.location    || '',
        category:      r.category    || '',
        status:        r.status      || 'found',
        date:          dateStr,
        comments:      Number(r.comment_count) || 0,
        hasImage:      !!r.image_url,
        _imageUrl:     r.image_url ? (r.image_url.startsWith('http') ? r.image_url : sb.API_BASE + r.image_url) : null,
        ownerBadge:    r.author_badge    || '',
        _raw_ts:       r.created_at || '',
    };
}

function setUser(me) {
    const p = me.profile || me;
    App.isLoggedIn   = true;
    App.currentUser  = {
        id:       p.id,
        uid:      p.uid,
        name:     p.name,
        initials: p.initials,
        color:    p.color,
        role:     p.role,
        badge:    p.badge || 'none',
    };
    App.isAdmin      = ['admin','super_admin'].includes(p.role);
    App.isSuperAdmin = p.role === 'super_admin';
    connectDMSSE(p.uid);
    connectUserSSE(p.uid);
    // Restore badge from persisted notifications
    _updateNotifBadge();
}

// ── RENDER ENGINE ─────────────────────────────────────────────────────────────
function statusClass(s) {
    return {found:'status-found',lost:'status-lost',waiting:'status-waiting',recovered:'status-recovered'}[s]||'status-found';
}
function statusLabel(s) {
    return {found:'Found',lost:'Lost',waiting:'Waiting',recovered:'Recovered'}[s]||s;
}

function buildCard(post) {
    const isOwner = App.isLoggedIn && (post.owner === App.currentUser?.uid || App.isAdmin);
    const canReport = App.isLoggedIn && !App.isAdmin && post.owner !== App.currentUser?.uid;
    let imgHtml = '';
    if (post._imageUrl) {
        imgHtml = `<div class="card-image"><img src="${post._imageUrl}" style="width:100%;display:block;height:auto;border-radius:0"></div>`;
    }

    // owner/admin menu
    const ownerMenuItems = App.isSuperAdmin
        ? `<div class="card-menu-item" onclick="openEdit('${post.id}');closeCardMenu('${post.id}')"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit post</div><div class="card-menu-sep"></div><div class="card-menu-item danger" onclick="openConfirm('${post.id}');closeCardMenu('${post.id}')"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>Delete post</div>`
        : post.owner === App.currentUser?.uid
            ? `<div class="card-menu-item" onclick="openEdit('${post.id}');closeCardMenu('${post.id}')"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit post</div><div class="card-menu-sep"></div><div class="card-menu-item danger" onclick="openConfirm('${post.id}');closeCardMenu('${post.id}')"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>Delete post</div>`
            : `<div class="card-menu-item danger" onclick="openConfirm('${post.id}');closeCardMenu('${post.id}')"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>Delete post</div>`;
    // member report menu
    const reportMenuItem = canReport
        ? `<div class="card-menu-item danger" onclick="openReport('${post.id}');closeCardMenu('${post.id}')"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>Report post</div>`
        : '';
    const dotsMenu = (isOwner || canReport) ? `
    <div class="card-menu" id="menu-${post.id}">
      ${isOwner ? ownerMenuItems : ''}
      ${isOwner && canReport ? '<div class="card-menu-sep"></div>' : ''}
      ${reportMenuItem}
    </div>` : '';
    const dotsBtn = (isOwner || canReport)
        ? `<button class="dots-btn" onclick="toggleCardMenu(event,'${post.id}')" title="More options">•••</button>` : '';

    // Escape for safe use in onclick strings
    const safeOwnerName     = post.ownerName.replace(/'/g, "\\'");
    const safeOwnerInitials = post.ownerInitials.replace(/'/g, "\\'");
    const safeOwnerColor    = post.ownerColor.replace(/'/g, "\\'");
    const safeOwner         = post.owner.replace(/'/g, "\\'");
    const safeLocation      = post.location.replace(/'/g, "\\'");

    return `
  <div class="card" data-post="${post.id}" data-owner="${post.owner}"
       data-status="${post.status}" data-category="${post.category.toLowerCase()}"
       data-location="${post.location.toLowerCase()}" data-title="${post.title.toLowerCase()}"
       data-desc="${post.desc.toLowerCase()}">
    <div class="card-inner">
      <div class="card-header">
        <div class="card-avatar" style="background:${post.ownerColor}"
             onclick="openProfile('${safeOwnerName}','${safeOwnerInitials}','${safeOwnerColor}','${safeOwner}','${post.ownerId}')">${post.ownerInitials}</div>
        <div class="card-meta">
          <span class="location-tag" onclick="openLocation('${safeLocation}')">${post.location}</span>
          <span class="username" onclick="openProfile('${safeOwnerName}','${safeOwnerInitials}','${safeOwnerColor}','${safeOwner}','${post.ownerId}')">u/${post.owner}${post.ownerRole==='super_admin'?'<span class="badge-verified gold" title="Super Admin">✓</span>':post.ownerRole==='admin'?'<span class="badge-verified purple" title="Admin">✓</span>':''}${post.ownerBadge==='student'?'<span style="font-size:10px;background:rgba(91,141,255,.15);color:#5b8dff;border:1px solid rgba(91,141,255,.3);border-radius:4px;padding:1px 6px;margin-left:4px;vertical-align:middle;white-space:nowrap">Student</span>':post.ownerBadge==='staff'?'<span style="font-size:10px;background:rgba(34,201,122,.15);color:#22c97a;border:1px solid rgba(34,201,122,.3);border-radius:4px;padding:1px 6px;margin-left:4px;vertical-align:middle;white-space:nowrap">Staff</span>':''}</span>
        </div>
        <div class="card-right">
          <div class="card-status-row">
            <span class="card-category">${post.category}</span>
            <span class="card-date">${post.date}</span>
            ${post._similarity != null ? `<span class="sim-badge">${Math.round(post._similarity*100)}% match</span>` : ''}
            <span class="status-badge ${statusClass(post.status)}">${statusLabel(post.status)}</span>
          </div>
        </div>
      </div>
      <div class="card-title">${post.title}</div>
      <div class="card-desc">${post.desc}</div>
      ${imgHtml}
      <div class="card-actions">
        <button class="action-btn" onclick="openComments('${post.id}')">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span id="comment-count-${post.id}">${post.comments}</span> comment${post.comments!==1?'s':''}
        </button>
        <div class="spacer"></div>
        ${dotsBtn}
        <button class="action-btn" onclick="shareItem(this)">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Share
        </button>
      </div>
    </div>
    ${dotsMenu}
  </div>`;
}

// Image-search mode state
let _imgSearchResults = null;  // null = normal mode, array = image search results

function renderFeed() {
    const feed  = document.getElementById('feed');
    const empty = document.getElementById('emptyState');

    // ── IMAGE SEARCH MODE ────────────────────────────────────────────────────
    if (_imgSearchResults !== null) {
        if (!_imgSearchResults.length) {
            feed.innerHTML = ''; empty.classList.add('visible');
        } else {
            empty.classList.remove('visible');
            feed.innerHTML = _imgSearchResults.map(buildCard).join('');
        }
        return;
    }

    // ── NORMAL MODE ──────────────────────────────────────────────────────────
    const q = App.searchQuery.toLowerCase().trim();
    const f = App.activeFilter;
    const filtered = POSTS.filter(p => {
        let statusMatch;
        if (f === 'all' || !f || (Array.isArray(f) && f.length === 0)) {
            statusMatch = true;
        } else {
            const filters = Array.isArray(f) ? f : [f];
            statusMatch = filters.some(fv => p.status === fv || p.location.toLowerCase().includes(fv));
        }
        const searchMatch = !q || [p.title,p.desc,p.location,p.category,p.owner].some(s=>s.toLowerCase().includes(q));
        return statusMatch && searchMatch;
    });
    if (!filtered.length) { feed.innerHTML=''; empty.classList.add('visible'); }
    else { empty.classList.remove('visible'); feed.innerHTML=filtered.map(buildCard).join(''); }
}

function setImageSearchMode(results) {
    // results = array of post objects with ._similarity set, or null to exit
    _imgSearchResults = results;

    const chip = document.getElementById('chipImageSearch');
    if (results !== null) {
        // show the locked "Image Search" chip as active
        if (chip) { chip.style.display = ''; chip.classList.add('active'); }
    } else {
        // hide it and restore normal state
        if (chip) { chip.style.display = 'none'; chip.classList.remove('active'); }
        // reset all _similarity on POSTS
        POSTS.forEach(p => { p._similarity = null; });
    }
    renderFeed();
}

// ── SEARCH ────────────────────────────────────────────────────────────────────
let _aiSearchTimer  = null;
let _aiSearchActive = false;
let _aiModeOn       = false;   // toggled by the bulb button

function toggleAiSearch() {
    _aiModeOn = !_aiModeOn;
    const btn = document.getElementById('aiSearchBtn');
    btn.classList.toggle('active', _aiModeOn);
    btn.title = _aiModeOn ? 'AI search ON — click to turn off' : 'AI semantic search';

    const q = document.getElementById('searchInput').value.trim();
    if (!_aiModeOn) {
        exitAiSearch();
        App.searchQuery = q;
        renderFeed();
    } else if (q.length > 1) {
        runAiSearch(q);
    } else {
        showToast('✨ AI search on — type what you\'re looking for');
    }
}

function initSearch() {
    const input = document.getElementById('searchInput');
    const clear = document.getElementById('searchClear');

    input.addEventListener('input', () => {
        const q = input.value.trim();
        clear.classList.toggle('visible', !!input.value);
        clearTimeout(_aiSearchTimer);

        if (!q) {
            exitAiSearch();
            App.searchQuery = '';
            renderFeed();
            return;
        }

        if (_aiModeOn) {
            // AI mode: debounce 600ms then semantic search
            _aiSearchTimer = setTimeout(() => runAiSearch(q), 600);
        } else {
            // Normal mode: instant keyword filter
            App.searchQuery = q;
            renderFeed();
        }
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && _aiModeOn) {
            const q = input.value.trim();
            if (q.length > 1) { clearTimeout(_aiSearchTimer); runAiSearch(q); }
        }
    });

    clear.addEventListener('click', () => {
        input.value = ''; App.searchQuery = '';
        clear.classList.remove('visible');
        exitAiSearch(); renderFeed(); input.focus();
    });
}

// ── FILTERS ───────────────────────────────────────────────────────────────────
let activeFilters = new Set();

function initFilters() {
    const allChip    = document.getElementById('chipAll');
    const expandWrap = document.getElementById('filterExpand');
    expandWrap.classList.remove('open');

    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const f = chip.dataset.filter;
            if (f === 'all') {
                if (allChip.classList.contains('active')) {
                    // Deselect All → expand others, show everything still
                    allChip.classList.remove('active');
                    expandWrap.classList.add('open');
                    activeFilters.clear();
                } else {
                    // Re-select All → collapse others, clear filters
                    activeFilters.clear();
                    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
                    allChip.classList.add('active');
                    expandWrap.classList.remove('open');
                }
            } else {
                expandWrap.classList.add('open');
                allChip.classList.remove('active');
                if (activeFilters.has(f)) {
                    activeFilters.delete(f);
                    chip.classList.remove('active');
                } else {
                    activeFilters.add(f);
                    chip.classList.add('active');
                }
                // If nothing selected, mark All as active but keep bar open
                if (activeFilters.size === 0) {
                    allChip.classList.add('active');
                }
            }
            App.activeFilter = activeFilters.size > 0 ? [...activeFilters] : 'all';
            renderFeed();
        });
    });
}

// ── THREE-DOT MENU ────────────────────────────────────────────────────────────
let openMenuId = null;
function toggleCardMenu(e, postId) {
    e.stopPropagation();
    if (openMenuId && openMenuId!==postId) closeCardMenu(openMenuId);
    const menu = document.getElementById('menu-'+postId);
    if (!menu) return;
    const isOpen = menu.classList.contains('open');
    menu.classList.toggle('open', !isOpen);
    openMenuId = isOpen ? null : postId;
}
function closeCardMenu(postId) {
    document.getElementById('menu-'+postId)?.classList.remove('open');
    if (openMenuId===postId) openMenuId=null;
}
document.addEventListener('click', () => {
    if (openMenuId) closeCardMenu(openMenuId);
    if (_openCMenuId) closeCMenu(_openCMenuId);
});

// ── MENU ──────────────────────────────────────────────────────────────────────
function toggleMenu() { document.getElementById('menuDropdown').classList.toggle('open'); }
document.addEventListener('click', e => {
    if (!e.target.closest('.menu-btn') && !e.target.closest('.menu-dropdown'))
        document.getElementById('menuDropdown').classList.remove('open');
});
function goHome() { window.scrollTo({top:0,behavior:'smooth'}); }

async function signOut() {
    if (USE_SUPABASE) await sb.signOut();
    App.isLoggedIn=false; App.isAdmin=false; App.isSuperAdmin=false; App.currentUser=null;
    toggleMenu(); updateMenuState(); renderFeed(); showToast('Signed out');
}
function openOwnProfile() {
    toggleMenu();
    const u = App.currentUser;
    if (u) openProfile(u.name, u.initials, u.color, u.uid, u.id);
}

function updateMenuState() {
    document.getElementById('menuNotLoggedIn').style.display = App.isLoggedIn ? 'none' : '';
    document.getElementById('menuLoggedIn').style.display    = App.isLoggedIn ? '' : 'none';
    if (App.isLoggedIn && App.currentUser) {
        document.getElementById('menuAvatarSm').style.background = App.currentUser.color;
        document.getElementById('menuAvatarSm').textContent      = App.currentUser.initials;
        document.getElementById('menuUserName').textContent      = App.currentUser.name;
        document.getElementById('menuUserHandle').textContent    = 'u/'+App.currentUser.uid;
        const adminSection = document.getElementById('adminMenuSection');
        if (adminSection) adminSection.style.display = App.isAdmin ? '' : 'none';
        const reqAdminItem = document.getElementById('reqAdminMenuItem');
        if (reqAdminItem) reqAdminItem.style.display = App.isAdmin ? 'none' : '';
        // Verify / Change Status
        const badge = App.currentUser?.badge || 'none';
        const verifyItem = document.getElementById('verifyMenuItem');
        const changeItem = document.getElementById('changeStatusMenuItem');
        if (verifyItem) verifyItem.style.display = (badge === 'none') ? '' : 'none';
        if (changeItem) changeItem.style.display = (badge !== 'none') ? '' : 'none';
    }
}

// ── COMMENTS ──────────────────────────────────────────────────────────────────
async function openComments(postId) {
    App.openPostId = postId;
    const post = POSTS.find(p => p.id === postId);
    document.getElementById('panelTitle').textContent = post ? post.title : 'Comments';
    document.getElementById('commentsScroll').innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">Loading…</div>';
    document.getElementById('commentsPanel').classList.add('open');
    document.getElementById('overlay').classList.add('show');
    document.body.style.overflow='hidden';

    // Update comment input visibility based on login state
    const inputWrap = document.getElementById('commentInputWrap');
    const loginPrompt = document.getElementById('commentLoginPrompt');
    if (App.isLoggedIn) {
        inputWrap.style.display='';
        loginPrompt.style.display='none';
    } else {
        inputWrap.style.display='none';
        loginPrompt.style.display='';
    }

    if (USE_SUPABASE) {
        const comments = await sb.getComments(postId);
        renderComments(comments || []);
        connectCommentSSE(postId);
    } else {
        renderComments([]);
    }
}

function renderComments(comments) {
    const scroll = document.getElementById('commentsScroll');
    if (!Array.isArray(comments) || !comments.length) {
        scroll.innerHTML = '<div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:13px">No comments yet. Be the first!</div>';
        return;
    }
    const top = comments.filter(c => !c.parent_id)
        .sort((a,b) => (b.net_votes||0) - (a.net_votes||0));
    const byParent = {};
    comments.filter(c => c.parent_id).forEach(c => {
        (byParent[c.parent_id] = byParent[c.parent_id] || []).push(c);
    });
    // Seed vote state map so castVote has accurate starting points
    _voteState.clear();
    comments.forEach(c => _voteState.set(c.id, { myVote: c.my_vote || 0, net: c.net_votes || 0 }));
    scroll.innerHTML = top.map(c => buildCommentHtml(c, byParent)).join('');
}

function buildCommentHtml(c, byParent, depth = 0) {
    const author     = c.author || {};
    const initials   = author.initials || '?';
    const uid        = author.uid      || 'user';
    const color      = author.color    || '#5b8dff';
    const name       = author.name     || uid;
    const time       = timeAgo(new Date(c.created_at));
    const replyList  = (byParent[c.id] || []);
    const replyCount = replyList.length;
    // replies recurse with depth+1 (indent caps at depth 3)
    const repliesHtml = replyList.map(r => buildCommentHtml(r, byParent, depth + 1)).join('');

    const isMyComment = App.isLoggedIn && App.currentUser?.uid === uid;
    const canDelete   = isMyComment || App.isAdmin;
    const canEdit     = isMyComment;
    const canReport   = App.isLoggedIn && !isMyComment && !App.isAdmin;
    const safeName    = name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const hasDots     = canDelete || canEdit || canReport;

    // votes — data stored on the comment object
    const net       = c.net_votes || 0;
    const myVote    = c.my_vote   || 0;
    const voteColor = net > 0 ? '#5b8dff' : net < 0 ? '#e05a5a' : '#6b7080';

    const cmenuItems = [
        canEdit   ? `<div class="card-menu-item" onclick="startEditComment('${c.id}');closeCMenu('${c.id}')"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</div>` : '',
        canDelete ? `<div class="card-menu-item danger" onclick="deleteComment('${c.id}');closeCMenu('${c.id}')"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>Delete</div>` : '',
        (canEdit || canDelete) && canReport ? '<div class="card-menu-sep"></div>' : '',
        canReport ? `<div class="card-menu-item danger" onclick="openCommentReport('${c.id}');closeCMenu('${c.id}')"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>Report</div>` : '',
    ].filter(Boolean).join('');

    const indentStyle = depth > 0
        ? `margin-left:${Math.min(depth,3)*14}px;padding-left:10px;border-left:2px solid rgba(255,255,255,0.07);`
        : '';

    return `
    <div class="comment" data-comment-id="${c.id}" style="${indentStyle}">
      <div class="comment-avatar" style="background:${color};cursor:pointer;width:${depth>0?26:30}px;height:${depth>0?26:30}px;font-size:${depth>0?10:11}px;flex-shrink:0"
           onclick="openProfile('${safeName}','${initials}','${color}','${uid}','')">${initials}</div>
      <div class="comment-body" style="position:relative;flex:1;min-width:0">
        <div class="comment-user" onclick="openProfile('${safeName}','${initials}','${color}','${uid}','')"
             style="cursor:pointer">u/${uid}</div>
        <div class="comment-text" id="ctext-${c.id}">${escHtml(c.body)}</div>
        <div class="comment-edit-form" id="cedit-${c.id}" style="display:none">
          <textarea class="comment-edit-input" id="cedit-input-${c.id}">${escHtml(c.body)}</textarea>
          <div style="display:flex;gap:6px;margin-top:5px">
            <button class="reply-btn" onclick="saveEditComment('${c.id}')">Save</button>
            <button class="reply-btn" onclick="cancelEditComment('${c.id}')">Cancel</button>
          </div>
        </div>
        ${c.image_url ? `<img src="${c.image_url}" style="max-width:160px;max-height:120px;border-radius:8px;margin-top:6px;display:block;object-fit:cover;cursor:pointer" onclick="this.style.maxWidth=this.style.maxWidth==='100%'?'160px':'100%';this.style.maxHeight=this.style.maxHeight==='none'?'120px':'none'">` : ''}
        <div class="comment-meta">
          <span class="comment-time">${time}</span>

          <div class="vote-btns" id="votewrap-${c.id}">
            <button class="vote-btn" id="vup-${c.id}"
              style="color:${myVote===1?'#5b8dff':'#6b7080'}"
              onclick="castVote(event,'${c.id}',1)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="${myVote===1?'#5b8dff':'none'}" stroke="${myVote===1?'#5b8dff':'#6b7080'}" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <span class="vote-count" id="vcount-${c.id}" style="color:${voteColor}">${net}</span>
            <button class="vote-btn" id="vdn-${c.id}"
              style="color:${myVote===-1?'#e05a5a':'#6b7080'}"
              onclick="castVote(event,'${c.id}',-1)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="${myVote===-1?'#e05a5a':'none'}" stroke="${myVote===-1?'#e05a5a':'#6b7080'}" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </div>

          ${App.isLoggedIn ? `<button class="reply-btn" onclick="toggleReply(this,'${c.id}')">↩ Reply${replyCount>0?' ('+replyCount+')':''}</button>` : ''}
        </div>

        <div class="reply-form" id="reply-form-${c.id}" style="display:none"></div>

        ${replyCount > 0 ? `
        <div class="replies-toggle" onclick="toggleReplies('${c.id}',${replyCount})">
          <span class="replies-toggle-line"></span>
          <span class="replies-toggle-label" id="rtlabel-${c.id}">▸ ${replyCount} repl${replyCount===1?'y':'ies'}</span>
        </div>
        <div id="replies-${c.id}" style="display:none;flex-direction:column;gap:8px;margin-top:8px">${repliesHtml}</div>` : ''}

        ${hasDots ? `
        <button class="dots-btn" style="position:absolute;top:0;right:0;padding:2px 6px;font-size:11px"
                onclick="toggleCMenu(event,'${c.id}')">•••</button>
        <div class="card-menu" id="cmenu-${c.id}">${cmenuItems}</div>` : ''}
      </div>
    </div>`;
}

function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function timeAgo(date) {
    const s = Math.floor((Date.now() - date) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s/60) + 'm ago';
    if (s < 86400) return Math.floor(s/3600) + 'h ago';
    return Math.floor(s/86400) + 'd ago';
}

async function deleteComment(commentId) {
    const res = await sb.deleteComment(commentId);
    if (res?.ok) document.querySelector(`.comment[data-comment-id="${commentId}"]`)?.remove();
}

function toggleReplies(cid, count) {
    const wrap  = document.getElementById('replies-' + cid);
    const label = document.getElementById('rtlabel-' + cid);
    const open  = wrap.style.display !== 'none';
    wrap.style.display  = open ? 'none' : 'flex';
    label.textContent   = open
        ? `▸ ${count} repl${count===1?'y':'ies'}`
        : `▾ Hide repl${count===1?'y':'ies'}`;
}

// Track each comment's current vote state: { myVote, net }
const _voteState = new Map();

async function castVote(e, commentId, requestedVote) {
    e.stopPropagation();
    if (!App.isLoggedIn) { showToast('Sign in to vote'); return; }

    const upBtn   = document.getElementById('vup-'   + commentId);
    const dnBtn   = document.getElementById('vdn-'   + commentId);
    const countEl = document.getElementById('vcount-' + commentId);
    if (!upBtn || !dnBtn || !countEl) return;

    // Get current state
    const state   = _voteState.get(commentId) || { myVote: 0, net: parseInt(countEl.textContent) || 0 };
    const prevVote = state.myVote;

    // Clicking same vote again = remove it (toggle off)
    const newVote = requestedVote === prevVote ? 0 : requestedVote;

    // Calculate new net: remove previous contribution, add new
    const newNet = state.net - prevVote + newVote;

    // Store new state
    _voteState.set(commentId, { myVote: newVote, net: newNet });

    // Update UI immediately (optimistic)
    applyVoteUI(upBtn, dnBtn, countEl, newVote, newNet);

    // Send to server
    const res = await sb.voteComment(commentId, newVote);
    if (res?.ok) {
        // Sync with server truth
        const sv = res.net_votes, mv = res.my_vote;
        _voteState.set(commentId, { myVote: mv, net: sv });
        applyVoteUI(upBtn, dnBtn, countEl, mv, sv);
    }
}

function applyVoteUI(upBtn, dnBtn, countEl, myVote, net) {
    countEl.textContent = net;
    countEl.style.color = net > 0 ? '#5b8dff' : net < 0 ? '#e05a5a' : '#6b7080';

    const upOn = myVote === 1, dnOn = myVote === -1;
    upBtn.style.color = upOn ? '#5b8dff' : '#6b7080';
    upBtn.querySelector('svg').setAttribute('fill',   upOn ? '#5b8dff' : 'none');
    upBtn.querySelector('svg').setAttribute('stroke', upOn ? '#5b8dff' : '#6b7080');
    dnBtn.style.color = dnOn ? '#e05a5a' : '#6b7080';
    dnBtn.querySelector('svg').setAttribute('fill',   dnOn ? '#e05a5a' : 'none');
    dnBtn.querySelector('svg').setAttribute('stroke', dnOn ? '#e05a5a' : '#6b7080');
}

let _openCMenuId = null;
function toggleCMenu(e, cid) {
    e.stopPropagation();
    if (_openCMenuId && _openCMenuId !== cid) closeCMenu(_openCMenuId);
    const menu = document.getElementById('cmenu-' + cid);
    if (!menu) return;
    const isOpen = menu.classList.contains('open');
    if (isOpen) { closeCMenu(cid); return; }

    // Detect space: flip menu above or below the button
    const btn     = e.target.closest('button') || e.target;
    const btnRect = btn.getBoundingClientRect();
    const panel  = document.getElementById('commentsPanel');
    const panelRect = panel ? panel.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const spaceAbove = btnRect.top - panelRect.top;
    const spaceBelow = panelRect.bottom - btnRect.bottom;
    const menuH  = 120; // approx menu height

    if (spaceAbove < menuH && spaceBelow > menuH) {
        // flip to open downward
        menu.style.bottom = 'auto';
        menu.style.top    = '28px';
        menu.style.transformOrigin = 'top right';
    } else {
        // default: open upward
        menu.style.top    = 'auto';
        menu.style.bottom = '28px';
        menu.style.transformOrigin = 'bottom right';
    }

    menu.classList.add('open');
    _openCMenuId = cid;
}
function closeCMenu(cid) {
    document.getElementById('cmenu-' + cid)?.classList.remove('open');
    if (_openCMenuId === cid) _openCMenuId = null;
}

function startEditComment(cid) {
    document.getElementById('ctext-' + cid).style.display = 'none';
    document.getElementById('cedit-' + cid).style.display = '';
    document.getElementById('cedit-input-' + cid).focus();
}
function cancelEditComment(cid) {
    document.getElementById('ctext-' + cid).style.display = '';
    document.getElementById('cedit-' + cid).style.display = 'none';
}
async function saveEditComment(cid) {
    const input = document.getElementById('cedit-input-' + cid);
    const body  = input.value.trim();
    if (!body) return;
    const res = await sb.editComment(cid, body);
    if (res?.ok) {
        document.getElementById('ctext-' + cid).textContent = body;
        cancelEditComment(cid);
    }
}

let _reportCommentId = null;
function openCommentReport(cid) {
    _reportCommentId = cid;
    document.getElementById('reportReason').value = '';
    document.getElementById('reportModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    // Override submit to report comment instead of post
    document.getElementById('reportBtn').onclick = submitCommentReport;
}
async function submitCommentReport() {
    if (!_reportCommentId) return;
    const reason = document.getElementById('reportReason').value.trim();
    const btn = document.getElementById('reportBtn');
    btn.textContent = 'Reporting…'; btn.disabled = true;
    const res = await sb.reportComment(_reportCommentId, reason);
    btn.textContent = 'Report'; btn.disabled = false;
    if (res?.ok) { showToast('Comment reported'); closeReport(); }
    else showToast(res?._error || 'Could not report');
    _reportCommentId = null;
    // Restore original onclick
    document.getElementById('reportBtn').onclick = submitReport;
}

function closeComments() {
    document.getElementById('commentsPanel').classList.remove('open');
    document.getElementById('overlay').classList.remove('show');
    document.body.style.overflow='';
    App.openPostId = null;
    if (_commentSSE) { _commentSSE.close(); _commentSSE = null; }
}

function toggleReply(btn, parentId) {
    const formEl = document.getElementById('reply-form-'+parentId);
    if (!formEl) return;
    if (formEl.innerHTML.trim()) {
        formEl.style.display = formEl.style.display === 'none' ? 'flex' : 'none';
    } else {
        formEl.style.display='flex';
        formEl.innerHTML=`<input class="reply-input" placeholder="Write a reply…" id="reply-input-${parentId}"><button class="reply-send" onclick="submitReply('${parentId}')">Send</button>`;
        document.getElementById('reply-input-'+parentId).focus();
    }
}

async function submitReply(parentId) {
    if (!App.isLoggedIn) { showToast('Sign in to reply'); return; }
    const input = document.getElementById('reply-input-'+parentId);
    const body  = input?.value.trim();
    if (!body) return;
    input.value = '';
    if (USE_SUPABASE) {
        await sb.createComment(App.openPostId, body, parentId, null);
        const comments = await sb.getComments(App.openPostId);
        renderComments(comments || []);
    }
}

async function submitCommentClick() {
    if (!App.isLoggedIn) { showToast('Sign in to comment'); return; }
    const input = document.getElementById('commentInput');
    const body  = input.value.trim();
    if ((!body && !commentImageDataUrl) || !App.openPostId) return;
    input.value = '';

    if (USE_SUPABASE) {
        // Upload comment image if attached
        let imgUrl = null;
        if (commentImageDataUrl) {
            imgUrl = await sb.uploadImage(commentImageDataUrl, 'comments');
            clearCommentImage();
        }
        await sb.createComment(App.openPostId, body || '', null, imgUrl);
        const comments = await sb.getComments(App.openPostId);
        renderComments(comments || []);
        // Update comment count on card
        const post = POSTS.find(p => p.id === App.openPostId);
        if (post) {
            post.comments = (post.comments || 0) + 1;
            const el = document.getElementById('comment-count-'+App.openPostId);
            if (el) el.textContent = post.comments;
        }
    }
}

// ── PROFILE ───────────────────────────────────────────────────────────────────
let curProfile = {};

async function openProfile(name, initials, color, uid, profileId) {
    curProfile = { color, name, initials, uid, profileId };
    document.getElementById('pAvatar').style.background = color;
    document.getElementById('pAvatar').textContent      = initials;
    document.getElementById('pName').textContent        = name;
    document.getElementById('pHandle').textContent      = 'u/' + uid;
    // clear verified badge until stats load
    const pVerified = document.getElementById('pVerifiedBadge');
    if (pVerified) pVerified.innerHTML = '';
    document.getElementById('pPoints').textContent      = '…';
    document.getElementById('pStatPosted').textContent  = '…';
    document.getElementById('pStatReturned').textContent= '…';
    document.getElementById('profileMsgBtn').style.display =
        (App.isLoggedIn && uid === App.currentUser?.uid) ? 'none' : 'inline-flex';
    document.getElementById('profileMsgBtn').onclick = () => tryDM(uid, name, initials, color);
    document.getElementById('profileHistoryList').innerHTML =
        '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">Loading…</div>';
    openSheet('profileSheet','profileOverlay');

    if (!uid) return;

    // Load real stats + posts in parallel — API uses uid not UUID
    const [stats, posts] = await Promise.all([
        sb.getProfileStats(uid),
        sb.getPostsByUser(uid),
    ]);

    if (!stats || !posts) {
        document.getElementById('pPoints').textContent       = '—';
        document.getElementById('pStatPosted').textContent   = '—';
        document.getElementById('pStatReturned').textContent = '—';
        document.getElementById('profileHistoryList').innerHTML =
            '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">Could not load profile</div>';
        return;
    }

    document.getElementById('pPoints').textContent       = stats.points + ' pts';
    // set verified badge
    const pvb = document.getElementById('pVerifiedBadge');
    if (pvb) {
        const r = stats.role;
        const b = stats.badge;
        const roleBadge = r === 'super_admin'
            ? '<span class="badge-verified gold" title="Super Admin">✓</span>'
            : r === 'admin'
            ? '<span class="badge-verified purple" title="Admin">✓</span>'
            : '';
        const userBadge = b === 'student'
            ? '<span style="font-size:10px;background:rgba(91,141,255,.15);color:#5b8dff;border:1px solid rgba(91,141,255,.3);border-radius:4px;padding:1px 6px;white-space:nowrap">Student</span>'
            : b === 'staff'
            ? '<span style="font-size:10px;background:rgba(34,201,122,.15);color:#22c97a;border:1px solid rgba(34,201,122,.3);border-radius:4px;padding:1px 6px;white-space:nowrap">Staff</span>'
            : b === 'verified'
            ? '<span style="font-size:10px;background:rgba(34,201,122,.15);color:#22c97a;border:1px solid rgba(34,201,122,.3);border-radius:4px;padding:1px 6px;white-space:nowrap">Verified</span>'
            : '';
        pvb.innerHTML = roleBadge + userBadge;
    }
    document.getElementById('pStatPosted').textContent   = stats.postCount;
    document.getElementById('pStatReturned').textContent = (posts || []).filter(p => p.status === 'recovered').length;
    const commentsEl = document.getElementById('pStatComments');
    if (commentsEl) commentsEl.textContent = stats.commentCount;

    // Show alert count on member profiles — visible to everyone, only for non-admins
    const alertWrap = document.getElementById('pAlertWrap');
    const alertStat = document.getElementById('pStatAlerts');
    if (alertWrap) {
        const targetIsAdmin = ['admin','super_admin'].includes(stats.role || '');
        if (!targetIsAdmin && App.isAdmin) {
            // Admins see the count
            const alertData = await sb.getAlerts(uid);
            const count = alertData?.count || 0;
            if (alertStat) alertStat.textContent = count;
            alertWrap.style.display = count > 0 ? '' : 'none';
        } else if (!targetIsAdmin) {
            // Members see count on other members' profiles too
            const alertData = await sb.getAlerts(uid);
            const count = alertData?.count || 0;
            if (alertStat) alertStat.textContent = count;
            alertWrap.style.display = count > 0 ? '' : 'none';
        } else {
            alertWrap.style.display = 'none';
        }
    }

    const list = document.getElementById('profileHistoryList');
    if (!posts.length) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">No posts yet</div>';
        return;
    }
    list.innerHTML = posts.map(r => {
        const p = mapRow(r);
        const badgeColor = p.status === 'found' ? 'rgba(34,201,122,0.1)' :
                           p.status === 'lost'  ? 'rgba(77,166,255,0.1)' :
                           p.status === 'recovered' ? 'rgba(232,168,56,0.1)' : 'rgba(138,143,158,0.1)';
        const badgeText  = p.status === 'found' ? 'var(--found)' :
                           p.status === 'lost'  ? 'var(--lost)'  :
                           p.status === 'recovered' ? 'var(--recovered)' : 'var(--waiting)';
        const badgeBorder= p.status === 'found' ? 'rgba(34,201,122,0.18)' :
                           p.status === 'lost'  ? 'rgba(77,166,255,0.18)' :
                           p.status === 'recovered' ? 'rgba(232,168,56,0.2)' : 'rgba(138,143,158,0.18)';
        return `
        <div class="activity-item" onclick="closeProfile();scrollToPost('${p.id}')">
          <span class="act-badge" style="background:${badgeColor};color:${badgeText};border:1px solid ${badgeBorder}">${statusLabel(p.status)}</span>
          <span style="font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.title)}</span>
          <span style="font-size:11px;color:var(--muted);flex-shrink:0">${p.date}</span>
          <svg width="12" height="12" fill="none" stroke="var(--muted)" stroke-width="2" viewBox="0 0 24 24" style="margin-left:6px;flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
        </div>`;
    }).join('');
}

// Scroll to a post in the feed and highlight it
function scrollToPost(postId) {
    // Make sure it's in the feed (reset filters if needed)
    if (App.activeFilter !== 'all' || App.searchQuery) {
        activeFilters.clear();
        App.activeFilter = 'all';
        App.searchQuery  = '';
        document.getElementById('searchInput').value = '';
        document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
        document.getElementById('chipAll')?.classList.add('active');
        document.getElementById('filterExpand')?.classList.remove('open');
        renderFeed();
    }
    const el = document.querySelector(`[data-post="${postId}"]`);
    if (el) {
        el.scrollIntoView({behavior:'smooth', block:'center'});
        el.classList.add('card-highlight');
        setTimeout(() => el.classList.remove('card-highlight'), 2000);
    }
}

function closeProfile() { closeSheet('profileSheet','profileOverlay'); }

function openSheet(id, overlayId) {
    document.getElementById(id).classList.add('open');
    if (overlayId) document.getElementById(overlayId).classList.add('open');
    document.body.style.overflow='hidden';
}
function closeSheet(id, overlayId) {
    document.getElementById(id).classList.remove('open');
    if (overlayId) document.getElementById(overlayId).classList.remove('open');
    document.body.style.overflow='';
}

// ── DM ────────────────────────────────────────────────────────────────────────
function tryDM(targetUid, targetName, targetInitials, targetColor) {
    if (!App.isLoggedIn) { openLogin(); return; }
    closeProfile();
    const sheet = document.getElementById('dmSheet');
    sheet.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (targetUid) {
        setTimeout(() => openDMThread(targetUid, targetName, targetInitials, targetColor), 80);
    } else {
        setTimeout(() => showDMInbox(), 80);
    }
}

// ── DM ────────────────────────────────────────────────────────────────────────
let _dmOtherUid = null;

async function openDMSheet() {
    updateDMBadge(0);  // clear badge immediately on open
    if (!App.isLoggedIn) { openLogin(); return; }
    document.getElementById('dmSheet').classList.add('open');
    document.body.style.overflow = 'hidden';
    showDMInbox();
}

async function showDMInbox() {
    _dmOtherUid = null;
    document.getElementById('dmInbox').style.display  = 'flex';
    document.getElementById('dmInbox').style.flexDirection = 'column';
    document.getElementById('dmThread').style.display = 'none';

    const list = document.getElementById('dmConvoList');
    list.innerHTML = '<div style="text-align:center;padding:32px 0;color:var(--muted);font-size:13px">Loading…</div>';

    const convos = await sb.getConversations();
    if (!convos || !convos.length) {
        list.innerHTML = '<div style="text-align:center;padding:40px 16px;color:var(--muted);font-size:13px">No messages yet. Open someone\'s profile and tap Message.</div>';
        return;
    }
    list.innerHTML = convos.map(c => `
    <div class="dm-convo-item" onclick="openDMThread('${c.uid}','${escHtml(c.name)}','${c.initials}','${c.color}')">
        <div class="dm-avatar" style="background:${c.color};flex-shrink:0;cursor:pointer"
             onclick="event.stopPropagation();closeDM();openProfile('${escHtml(c.name)}','${c.initials}','${c.color}','${c.uid}','')">${c.initials}</div>
        <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
                <span style="font-weight:600;font-size:13px">u/${escHtml(c.uid)}</span>

            </div>
            <div style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(c.last_msg || '')}</div>
        </div>
        ${c.unread > 0 ? `<div style="background:var(--accent);color:#fff;border-radius:50%;min-width:18px;height:18px;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 4px;flex-shrink:0">${c.unread}</div>` : ''}
    </div>`).join('');
}

async function openDMThread(otherUid, name, initials, color) {
    _dmOtherUid = otherUid;
    document.getElementById('dmInbox').style.display  = 'none';
    document.getElementById('dmThread').style.display = 'flex';
    const avatarEl = document.getElementById('dmAvatar');
    avatarEl.style.background = color;
    avatarEl.textContent      = initials;
    avatarEl.style.cursor     = 'pointer';
    avatarEl.onclick          = () => { closeDM(); openProfile(name || otherUid, initials, color, otherUid, ''); };
    document.getElementById('dmName').textContent = name || ('u/' + otherUid);
    document.getElementById('dmName').style.cursor = 'pointer';
    document.getElementById('dmName').onclick = () => { closeDM(); openProfile(name || otherUid, initials, color, otherUid, ''); };

    const msgs = document.getElementById('dmMessages');
    msgs.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">Loading…</div>';

    const data = await sb.getDMThread(otherUid);
    if (!data) { msgs.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">Could not load messages</div>'; return; }

    renderDMMessages(data.messages);
    document.getElementById('dmInput').focus();
    // DM messages arrive live via SSE (_dmSSE) — no polling needed
}

function renderDMMessages(messages) {
    const msgs = document.getElementById('dmMessages');
    if (!messages.length) {
        msgs.innerHTML = '<div style="text-align:center;padding:40px 16px;color:var(--muted);font-size:13px">No messages yet. Say hi! 👋</div>';
        return;
    }
    msgs.innerHTML = messages.map(m => {
        const isMe = m.sender_uid === App.currentUser?.uid;
        const imgHtml = m.image_url ? `<img src="${m.image_url}" style="max-width:180px;max-height:160px;border-radius:8px;display:block;margin-top:${m.body?'6px':'0'};object-fit:cover;cursor:pointer" onclick="this.style.maxWidth=this.style.maxWidth==='100%'?'180px':'100%'">` : '';
        return `<div class="dm-msg ${isMe ? 'me' : 'them'}">${m.body ? escHtml(m.body) : ''}${imgHtml}</div>`;
    }).join('');
    msgs.scrollTop = msgs.scrollHeight;
}

let _dmImageDataUrl = null;

function handleDMImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
        _dmImageDataUrl = e.target.result;
        document.getElementById('dmImagePreview').src = e.target.result;
        document.getElementById('dmImagePreviewWrap').style.display = 'flex';
    };
    reader.readAsDataURL(file);
}

function clearDMImage() {
    _dmImageDataUrl = null;
    document.getElementById('dmImagePreview').src = '';
    document.getElementById('dmImagePreviewWrap').style.display = 'none';
    document.getElementById('dmImageInput').value = '';
}

async function sendDMClick() {
    if (!_dmOtherUid) return;
    const input = document.getElementById('dmInput');
    const body  = input.value.trim();
    if (!body && !_dmImageDataUrl) return;
    input.value = '';

    // Upload image if attached
    let imageUrl = null;
    if (_dmImageDataUrl) {
        imageUrl = await sb.uploadImage(_dmImageDataUrl, 'dms');
        clearDMImage();
    }

    const res = await sb.sendDM(_dmOtherUid, body, imageUrl);
    if (res) {
        const msgs = document.getElementById('dmMessages');
        const empty = msgs.querySelector('div[style*="padding:40px"]');
        if (empty) empty.remove();
        const div = document.createElement('div');
        div.className = 'dm-msg me';
        div.innerHTML = `${body ? escHtml(body) : ''}${imageUrl ? `<img src="${imageUrl}" style="max-width:180px;max-height:160px;border-radius:8px;display:block;margin-top:${body?'6px':'0'};object-fit:cover;cursor:pointer" onclick="this.style.maxWidth=this.style.maxWidth==='100%'?'180px':'100%'">` : ''}`;
        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;
    }
}

function closeDM() {
    document.getElementById('dmSheet').classList.remove('open');
    // Re-poll badge after closing (messages may have been read)
    setTimeout(pollDMBadge, 500);
    document.body.style.overflow = '';
    _dmOtherUid = null;
}

// Legacy openDM called from profile sheet
function openDM() {
    closeProfile();
    setTimeout(() => {
        if (curProfile?.uid) openDMThread(curProfile.uid, curProfile.name, curProfile.initials, curProfile.color);
        else openDMSheet();
    }, 160);
}

// ── LOCATION ──────────────────────────────────────────────────────────────────
function openLocation(name) {
    document.getElementById('locTitle').textContent = name;
    const related = POSTS.filter(p => p.location.toLowerCase() === name.toLowerCase());
    document.getElementById('locCount').textContent = related.length+' item'+(related.length!==1?'s':'')+' reported here';
    document.getElementById('locList').innerHTML = related.map(p=>`
    <div class="loc-card" onclick="closeLocation();scrollToPost('${p.id}')">
      <div class="loc-card-head">
        <div class="card-avatar" style="background:${p.ownerColor};width:26px;height:26px;font-size:9px;flex-shrink:0">${p.ownerInitials}</div>
        <div class="loc-card-meta"><span class="lc-loc">${p.location}</span><span class="lc-uid">u/${p.owner}</span></div>
        <span class="status-badge ${statusClass(p.status)}" style="font-size:10px;padding:2px 7px">${statusLabel(p.status)}</span>
      </div>
      <div class="loc-card-title">${escHtml(p.title)}</div>
      <div class="loc-card-desc">${escHtml(p.desc.substring(0,80))}…</div>
    </div>`).join('');
    openSheet('locSheet','locOverlay');
}
function closeLocation() { closeSheet('locSheet','locOverlay'); }

// ── POST ──────────────────────────────────────────────────────────────────────
let postImageDataUrl = null;

function tryPost() {
    if (!App.isLoggedIn) {
        document.getElementById('signinReqModal').classList.add('open');
        document.body.style.overflow='hidden'; return;
    }
    document.getElementById('postTitle').value='';
    document.getElementById('postDesc').value='';
    clearImage();
    document.getElementById('postModal').classList.add('open');
    document.body.style.overflow='hidden';
}
function closePost() { document.getElementById('postModal').classList.remove('open'); document.body.style.overflow=''; }
function closeSigninReq() { document.getElementById('signinReqModal').classList.remove('open'); document.body.style.overflow=''; }

// ── IMAGE HELPERS ─────────────────────────────────────────────────────────────
function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => showImagePreview(e.target.result);
    reader.readAsDataURL(file);
}
function handleImageDrop(e) {
    e.preventDefault();
    document.getElementById('uploadArea').classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
}
function showImagePreview(dataUrl) {
    postImageDataUrl = dataUrl;
    const btn = document.getElementById('autoFillBtn');
    if (btn) btn.style.display = 'inline-flex';
    document.getElementById('uploadPlaceholder').style.display='none';
    document.getElementById('uploadPreviewWrap').style.display='block';
    document.getElementById('uploadPreview').src=dataUrl;
}
function clearImage() {
    postImageDataUrl = null;
    const btn = document.getElementById('autoFillBtn');
    if (btn) btn.style.display = 'none';
    document.getElementById('uploadPlaceholder').style.display='';
    document.getElementById('uploadPreviewWrap').style.display='none';
    document.getElementById('uploadPreview').src='';
    document.getElementById('postImageInput').value='';
}

// ── EDIT IMAGE HELPERS ───────────────────────────────────────────────────────
let editImageDataUrl = null;
let editImageCleared = false;

function handleEditImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
        editImageDataUrl = e.target.result;
        editImageCleared = false;
        document.getElementById('editUploadPlaceholder').style.display='none';
        document.getElementById('editUploadPreviewWrap').style.display='block';
        document.getElementById('editImagePreview').src = e.target.result;
    };
    reader.readAsDataURL(file);
}
function clearEditImage() {
    editImageDataUrl = null;
    editImageCleared = true;
    document.getElementById('editUploadPlaceholder').style.display='';
    document.getElementById('editUploadPreviewWrap').style.display='none';
    document.getElementById('editImagePreview').src='';
    document.getElementById('editImageInput').value='';
}

// ── COMMENT IMAGE HELPERS ─────────────────────────────────────────────────────
let commentImageDataUrl = null;

function handleCommentImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
        commentImageDataUrl = e.target.result;
        document.getElementById('commentImagePreview').src = e.target.result;
        document.getElementById('commentImagePreviewWrap').style.display='flex';
    };
    reader.readAsDataURL(file);
}
function clearCommentImage() {
    commentImageDataUrl = null;
    document.getElementById('commentImagePreview').src='';
    document.getElementById('commentImagePreviewWrap').style.display='none';
    document.getElementById('commentImageInput').value='';
}

document.addEventListener('paste', e => {
    if (!document.getElementById('postModal').classList.contains('open')) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
        if (item.type.startsWith('image/')) { handleImageFile(item.getAsFile()); break; }
    }
});

// ── SUBMIT POST ───────────────────────────────────────────────────────────────
async function submitPost() {
    if (!App.isLoggedIn) return;
    // reset previous auto-match results for this new post
    _matches = [];
    updateMatchDot();
    closeNotifPanel();
    const title    = document.getElementById('postTitle').value.trim();
    const desc     = document.getElementById('postDesc').value.trim();
    const location = document.getElementById('postLocation').value;
    const category = document.getElementById('postCategory').value;
    const status   = document.getElementById('postStatus').value;
    if (!title) { document.getElementById('postTitle').focus(); showToast('Please enter a title'); return; }

    const btn = document.getElementById('postSubmitBtn');

    try {
        const now     = new Date();
        const dateStr = now.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
        const tempId  = 'temp-' + Date.now();
        const newPost = {
            id:            tempId,
            owner:         App.currentUser.uid,
            ownerName:     App.currentUser.name,
            ownerInitials: App.currentUser.initials,
            ownerColor:    App.currentUser.color,
            ownerId:       App.currentUser.id,
            title, desc, location, category, status,
            date:     dateStr,
            comments: 0,
            hasImage: !!postImageDataUrl,
            _imageUrl: postImageDataUrl || null,
        };
        if (!Array.isArray(window.POSTS)) window.POSTS = [];

        if (USE_SUPABASE) {
            let imageUrl     = null;  // full URL for display
            let imageUrlPath = null;  // server-relative path for API

            if (postImageDataUrl) {
                // ── FEATURE 3: moderated upload with NSFW check ──────────────
                btn.textContent = 'Checking image…'; btn.disabled = true;
                let uploadRes;
                try {
                    uploadRes = await sb.uploadImageFull(postImageDataUrl);
                } catch(e) {
                    btn.textContent = 'Post'; btn.disabled = false;
                    showToast(e.message || 'Image upload failed');
                    return;
                }
                imageUrlPath = uploadRes.url;                  // e.g. /images/abc.jpg
                imageUrl     = uploadRes.fullUrl;              // full URL for display
                btn.textContent = 'Posting…';
            } else {
                btn.textContent = 'Posting…'; btn.disabled = true;
            }

            // optimistic UI
            newPost._imageUrl = imageUrl;
            POSTS.unshift(newPost);
            closePost();
            btn.textContent = 'Post'; btn.disabled = false;
            renderFeed();
            showToast('Post published!');

            // ── FEATURE 2: use /posts/ai when image present (stores embedding + auto-match)
            //              use /posts   when no image (no embedding needed)
            let saved;
            if (imageUrlPath) {
                saved = await sb.createPostAI({
                    author_id: App.currentUser.id,
                    title, description: desc, location, category, status,
                    image_url: imageUrlPath,
                });
            } else {
                saved = await sb.createPost({
                    author_id: App.currentUser.id,
                    title, description: desc, location, category, status,
                    image_url: null,
                });
            }

            if (saved && saved[0]) {
                const realPost = mapRow({ ...saved[0],
                    author_uid:      App.currentUser.uid,
                    author_name:     App.currentUser.name,
                    author_initials: App.currentUser.initials,
                    author_color:    App.currentUser.color,
                });
                realPost._imageUrl = imageUrl;
                const idx = POSTS.findIndex(p => p.id === tempId);
                if (idx > -1) POSTS[idx] = realPost;
                renderFeed();
            }
        }
    } catch(err) {
        console.error('submitPost error:', err);
        btn.textContent = 'Post'; btn.disabled = false;
        showToast('Something went wrong — check console (F12)');
    }
}

// ── EDIT ──────────────────────────────────────────────────────────────────────
let editingPostId=null, editSelectedStatus=null;
function openEdit(postId) {
    editingPostId=postId; editSelectedStatus=null; editImageDataUrl=null; editImageCleared=false;
    document.querySelectorAll('.status-opt').forEach(o=>o.className='status-opt');
    const post=POSTS.find(p=>p.id===postId); if (!post) return;
    document.getElementById('editTitle').value=post.title;
    document.getElementById('editDesc').value=post.desc;
    const cur=document.querySelector(`.status-opt[data-status="${post.status}"]`);
    if (cur) { cur.classList.add('sel-'+post.status); editSelectedStatus=post.status; }
    // Show existing image if any
    const preview = document.getElementById('editImagePreview');
    const placeholder = document.getElementById('editUploadPlaceholder');
    const previewWrap = document.getElementById('editUploadPreviewWrap');
    if (post._imageUrl) {
        preview.src = post._imageUrl;
        placeholder.style.display='none';
        previewWrap.style.display='block';
    } else {
        preview.src='';
        placeholder.style.display='';
        previewWrap.style.display='none';
    }
    document.getElementById('editModal').classList.add('open');
    document.body.style.overflow='hidden';
}
function closeEdit() { document.getElementById('editModal').classList.remove('open'); document.body.style.overflow=''; }
function selectStatus(el,status) {
    document.querySelectorAll('.status-opt').forEach(o=>o.className='status-opt');
    el.classList.add('sel-'+status); editSelectedStatus=status;
}
async function saveEdit() {
    if (!editingPostId) return;
    const post=POSTS.find(p=>p.id===editingPostId); if (!post) return;
    const newTitle=document.getElementById('editTitle').value.trim();
    const newDesc=document.getElementById('editDesc').value.trim();
    if (newTitle) post.title=newTitle;
    if (newDesc)  post.desc=newDesc;
    if (editSelectedStatus) post.status=editSelectedStatus;

    const fields = { title: post.title, description: post.desc, status: post.status };

    if (USE_SUPABASE) {
        // Upload new image if one was selected
        if (editImageDataUrl) {
            const imageUrl = await sb.uploadImage(editImageDataUrl, 'posts');
            if (imageUrl) { post._imageUrl = imageUrl; fields.image_url = imageUrl; }
        } else if (editImageCleared) {
            post._imageUrl = null;
            fields.image_url = null;
        }
        await sb.updatePost(post.id, fields);
    }
    closeEdit(); renderFeed(); showToast('Post updated');
}

// ── DELETE ────────────────────────────────────────────────────────────────────
let deletingPostId=null;
function openConfirm(postId) {
    deletingPostId=postId;
    document.getElementById('confirmModal').classList.add('open');
    document.body.style.overflow='hidden';
}
function closeConfirm() { document.getElementById('confirmModal').classList.remove('open'); document.body.style.overflow=''; }
async function confirmDelete() {
    if (deletingPostId) {
        if (USE_SUPABASE) await sb.deletePost(deletingPostId);
        const idx=POSTS.findIndex(p=>p.id===deletingPostId);
        if (idx>-1) POSTS.splice(idx,1);
    }
    closeConfirm(); renderFeed(); showToast('Post deleted');
}

// ── ADMIN LINK ────────────────────────────────────────────────────────────────
function openAdminDashboard() { toggleMenu(); window.location.href='admin.html'; }

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function openLogin() {
    document.getElementById('menuDropdown').classList.remove('open');
    document.getElementById('loginMainWrap').style.display='';
    document.getElementById('adminRequestWrap').style.display='none';
    document.getElementById('adminRequestSent').style.display='none';
    document.getElementById('loginError').style.display='none';
    document.getElementById('registerError').style.display='none';
    document.getElementById('loginUid').value='';
    document.getElementById('loginPw').value='';
    document.getElementById('regName').value='';
    document.getElementById('regUid').value='';
    document.getElementById('regPw').value='';
    document.getElementById('loginPw').value='';
    document.getElementById('regName').value='';
    document.getElementById('regUid').value='';
    document.getElementById('regPw').value='';
    switchLoginTab('login');
    document.getElementById('loginModal').classList.add('open');
    document.body.style.overflow='hidden';
}
function switchLoginTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('loginTab').style.display    = isLogin ? '' : 'none';
    document.getElementById('registerTab').style.display = isLogin ? 'none' : '';
    document.getElementById('tabLoginBtn').style.background    = isLogin ? 'var(--surface)' : 'transparent';
    document.getElementById('tabLoginBtn').style.color         = isLogin ? 'var(--text)' : 'var(--muted)';
    document.getElementById('tabRegisterBtn').style.background = isLogin ? 'transparent' : 'var(--surface)';
    document.getElementById('tabRegisterBtn').style.color      = isLogin ? 'var(--muted)' : 'var(--text)';
    document.getElementById('loginError').style.display    = 'none';
    document.getElementById('registerError').style.display = 'none';
}

function showAdminRequest() {
    document.getElementById('loginMainWrap').style.display = 'none';
    document.getElementById('adminRequestWrap').style.display = 'block';
}

async function doLogin() {
    const uid = document.getElementById('loginUid').value.trim();
    const pw  = document.getElementById('loginPw').value;
    const err = document.getElementById('loginError');
    err.style.display = 'none';
    if (!uid || !pw) { err.textContent='Enter username and password'; err.style.display=''; return; }
    const btn = document.getElementById('loginBtn');
    btn.textContent='Logging in…'; btn.disabled=true;
    const res = await sb.login(uid, pw);
    btn.textContent='Log in'; btn.disabled=false;
    if (!res || res._error) {
        err.textContent = res?._error || 'Could not reach server';
        err.style.display=''; return;
    }
    await afterAuth(res);
}

let _regIdFile = null;

function handleRegIdFile(file) {
    if (!file) return;
    _regIdFile = file;
    document.getElementById('regIdPreview').src = URL.createObjectURL(file);
    document.getElementById('regIdPreview').style.display = 'block';
    document.getElementById('regIdPlaceholder').style.display = 'none';
    document.getElementById('regIdRemoveBtn').style.display = 'inline-block';
    document.getElementById('regIdArea').onclick = null;
}

function removeRegId(e) {
    if (e) e.stopPropagation();
    _regIdFile = null;
    document.getElementById('regIdPreview').src = '';
    document.getElementById('regIdPreview').style.display = 'none';
    document.getElementById('regIdPlaceholder').style.display = '';
    document.getElementById('regIdRemoveBtn').style.display = 'none';
    document.getElementById('regIdInput').value = '';
    document.getElementById('regIdArea').onclick = () => document.getElementById('regIdInput').click();
}

async function doRegister() {
    const name = document.getElementById('regName').value.trim();
    const uid  = document.getElementById('regUid').value.trim();
    const pw   = document.getElementById('regPw').value;
    const err  = document.getElementById('registerError');
    err.style.display = 'none';
    if (!uid || !pw) { err.textContent='Fill in all fields'; err.style.display=''; return; }
    const btn = document.getElementById('registerBtn');
    btn.textContent = _regIdFile ? 'Verifying ID…' : 'Creating…';
    btn.disabled = true;

    try {
        const form = new FormData();
        form.append('uid', uid);
        form.append('password', pw);
        form.append('name', name || uid);
        if (_regIdFile) form.append('id_file', _regIdFile, 'id.jpg');

        const r = await fetch(`${sb.API_URL}/auth/register-with-id`, {
            method: 'POST',
            body: form,
        });
        const res = await r.json();

        if (!r.ok || res._error || res.detail) {
            err.textContent = res.detail || res._error || 'Could not create account';
            err.style.display = ''; return;
        }

        // Show badge toast if detected
        if (res.badge && res.badge !== 'none') {
            const label = res.badge === 'student' ? '🎓 Student' : res.badge === 'staff' ? '🏫 Staff' : '✅ Verified';
            showToast(`${label} badge added to your profile!`);
        }
        // Save token so session persists across refreshes (bypassed sb.register, must save manually)
        if (res.token) {
            localStorage.setItem('fi_token', res.token);
            // Sync the token into the sb client so subsequent API calls are authenticated
            sb._setToken(res.token);
        }
        await afterAuth(res);
    } catch(e) {
        err.textContent = 'Could not reach server';
        err.style.display = '';
    } finally {
        btn.textContent = 'Create account';
        btn.disabled = false;
    }
}

async function afterAuth(res) {
    setUser(res);
    closeLogin();
    updateMenuState();
    const rows = await sb.getPosts();
    POSTS = (rows || []).map(mapRow);
    renderFeed();
    showToast('Welcome, ' + App.currentUser.uid + '!');
}

// kept for compat
async function sendMagicLink() {}
async function verifyOtp() {}
function closeLogin() { document.getElementById('loginModal').classList.remove('open'); document.body.style.overflow=''; }

// ── ADMIN REQUEST FORM ────────────────────────────────────────────────────────
function contactAdmin() { showAdminRequest(); }
function backToLogin() {
    document.getElementById('adminRequestWrap').style.display='none';
    document.getElementById('adminRequestSent').style.display='none';
    document.getElementById('loginMainWrap').style.display='';
}
function backToEmailStep() { backToLogin(); }
function shareItem(btn) {
    const orig=btn.innerHTML;
    navigator.clipboard?.writeText(window.location.href);
    btn.textContent='Copied'; setTimeout(()=>btn.innerHTML=orig,1600);
}

// ── ADMIN REQUEST MODAL ──────────────────────────────────────────────────────
function openAdminRequestModal() {
    document.getElementById('menuDropdown').classList.remove('open');
    document.getElementById('adminReqModal').classList.add('open');
    document.getElementById('adminReqSent').style.display = 'none';
    document.getElementById('adminReqForm').style.display = '';
    clearArId();
    document.getElementById('arUid').value = App.currentUser?.uid || '';
    const btn = document.getElementById('adminReqBtn');
    if (btn) { btn.textContent = 'Submit'; btn.disabled = false; }
    document.body.style.overflow = 'hidden';
}
function closeAdminReqModal() {
    document.getElementById('adminReqModal').classList.remove('open');
    document.body.style.overflow = '';
}

// ── ADMIN REQUEST ────────────────────────────────────────────────────────────
let _arIdDataUrl = null;

function handleArIdFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
        _arIdDataUrl = e.target.result;
        document.getElementById('arIdPreview').src = e.target.result;
        document.getElementById('arIdPlaceholder').style.display = 'none';
        document.getElementById('arIdPreviewWrap').style.display = 'block';
    };
    reader.readAsDataURL(file);
}
function clearArId() {
    _arIdDataUrl = null;
    document.getElementById('arIdPreview').src = '';
    document.getElementById('arIdPlaceholder').style.display = '';
    document.getElementById('arIdPreviewWrap').style.display = 'none';
    document.getElementById('arIdInput').value = '';
}

async function submitAdminRequest() {
    if (!_arIdDataUrl) { showToast('Please upload your staff ID photo'); return; }
    const uid = document.getElementById('arUid')?.value.trim() || App.currentUser?.uid || '';
    const btn = document.getElementById('adminReqBtn');
    if (btn) { btn.textContent = 'Verifying ID…'; btn.disabled = true; }

    try {
        // Convert dataURL → blob
        const [meta, b64] = _arIdDataUrl.split(',');
        const mime = meta.match(/:(.*?);/)[1];
        const bin  = atob(b64);
        const arr  = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const blob = new Blob([arr], { type: mime });

        // Send image + uid in one multipart request
        const form = new FormData();
        form.append('file', blob, 'id.jpg');
        form.append('uid', uid);

        const r = await fetch(`${sb.API_URL}/admin/verify-id`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${sb.getToken()}` },
            body: form,
        });
        const res = await r.json();

        if (res.auto_approved) {
            if (App.currentUser) App.currentUser.role = 'admin';
            App.isAdmin = true;
            if (sb.getToken()) localStorage.setItem('fi_token', sb.getToken());
            updateMenuState();  // show Admin Dashboard instantly, no refresh needed
            document.getElementById('adminReqForm').style.display = 'none';
            document.getElementById('adminReqSent').style.display = 'block';
            document.getElementById('adminReqSent').innerHTML = `
                <div style="text-align:center;padding:24px">
                    <div style="font-size:48px">✅</div>
                    <h3 style="margin:12px 0 8px">Access Granted!</h3>
                    <p style="opacity:.7;margin-bottom:20px">Your ID was verified automatically.</p>
                    <button onclick="window.location.href='admin.html'" style="background:var(--accent);color:#fff;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:15px">Go to Admin Panel →</button>
                </div>`;
        } else {
            // Backend already saved the pending request with the image
            // No second call needed
            document.getElementById('adminReqForm').style.display = 'none';
            document.getElementById('adminReqSent').style.display = 'block';
            document.getElementById('adminReqSent').innerHTML = `
                <div style="text-align:center;padding:24px">
                    <div style="font-size:48px">🕐</div>
                    <h3 style="margin:12px 0 8px">Request Submitted</h3>
                    <p style="opacity:.7;margin-bottom:8px">Your ID couldn't be verified automatically.</p>
                    <p style="opacity:.7;margin-bottom:20px">An admin will review your request shortly.</p>
                </div>`;
        }
    } catch(e) {
        if (btn) { btn.textContent = 'Submit'; btn.disabled = false; }
        showToast('Error submitting request. Please try again.');
    }
}

// ── REPORT ───────────────────────────────────────────────────────────────────
let _reportPostId = null;
function openReport(postId) {
    _reportPostId = postId;
    document.getElementById('reportModal').classList.add('open');
    document.body.style.overflow = 'hidden';
}
function closeReport() {
    document.getElementById('reportModal').classList.remove('open');
    document.body.style.overflow = '';
    _reportPostId = null;
}
async function submitReport() {
    if (!_reportPostId) return;
    const reason = document.getElementById('reportReason').value.trim();
    const btn = document.getElementById('reportBtn');
    btn.textContent = 'Reporting…'; btn.disabled = true;
    const res = await sb.reportPost(_reportPostId, reason);
    btn.textContent = 'Report'; btn.disabled = false;
    if (res && !res._error) {
        showToast('Report submitted');
        closeReport();
    } else {
        showToast(res?._error || 'Could not submit report');
    }
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
    const t=document.getElementById('toast');
    t.textContent=msg; t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),2200);
}


// ── SHEET DRAG TO RESIZE ──────────────────────────────────────────────────────
let _drag = null;

function startDrag(e, sheetId) {
    const sheet = document.getElementById(sheetId);
    if (!sheet) return;
    e.preventDefault();

    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const startY  = clientY;
    const startH  = sheet.getBoundingClientRect().height;
    const maxH    = window.innerHeight * 0.95;
    const minH    = 200;

    sheet.style.transition = 'none';

    function onMove(ev) {
        const y    = ev.touches ? ev.touches[0].clientY : ev.clientY;
        const diff = startY - y;
        const newH = Math.min(maxH, Math.max(minH, startH + diff));
        sheet.style.height = newH + 'px';
        sheet.style.maxHeight = newH + 'px';
    }

    function onEnd() {
        sheet.style.transition = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
}


// ══════════════════════════════════════════════════════════════════════════════
// ── FEATURE 1: IMAGE SEARCH ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
let _imgFile       = null;
let _imgFilter     = 'all';

function openImgSearch() {
    _imgFile   = null;
    _imgFilter = 'all';
    document.getElementById('imgPreview').style.display = 'none';
    document.getElementById('imgDropPlaceholder').style.display = '';
    document.getElementById('imgSearchRunBtn').disabled = true;
    document.querySelectorAll('#imgFilterRow .filter-chip').forEach(c => c.classList.remove('active'));
    document.querySelector('#imgFilterRow [data-imgf="all"]').classList.add('active');
    document.getElementById('imgSearchBg').classList.add('open');
    document.body.style.overflow = 'hidden';
    // listen for paste
    document.addEventListener('paste', _onImgPaste);
}
function closeImgSearch() {
    document.getElementById('imgSearchBg').classList.remove('open');
    document.body.style.overflow = '';
    document.removeEventListener('paste', _onImgPaste);
    if (_imgFile) { URL.revokeObjectURL(_imgFile._url||''); _imgFile = null; }
}

function _onImgPaste(e) {
    const item = [...(e.clipboardData?.items||[])].find(i => i.type.startsWith('image/'));
    if (item) handleImgFile(item.getAsFile());
}
function handleImgDrop(e) {
    e.preventDefault();
    document.getElementById('imgDropZone').classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) handleImgFile(f);
}
function handleImgFile(file) {
    if (!file) return;
    _imgFile = file;
    const url = URL.createObjectURL(file);
    const prev = document.getElementById('imgPreview');
    prev.src = url; prev.style.display = 'block';
    document.getElementById('imgDropPlaceholder').style.display = 'none';
    document.getElementById('imgSearchRunBtn').disabled = false;
    document.getElementById('imgSearchResults').innerHTML = '';
}
function selectImgFilter(el) {
    document.querySelectorAll('#imgFilterRow .filter-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    _imgFilter = el.dataset.imgf;
}

async function runImgSearch() {
    if (!_imgFile) return;
    const btn = document.getElementById('imgSearchRunBtn');
    btn.disabled = true; btn.textContent = 'Searching…';
    try {
        const raw = await sb.searchByImage(_imgFile, _imgFilter);
        // Map server results into card-compatible objects with _similarity
        const cards = raw.map(p => ({
            ...mapRow(p),
            _similarity: p.similarity || 0,
            _imageUrl:   p.image_url ? sb.API_BASE + p.image_url : null,
        }));
        closeImgSearch();
        setImageSearchMode(cards);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch(e) {
        showToast('Image search failed: ' + e.message);
    } finally {
        btn.disabled = false; btn.textContent = 'Search';
    }
}


// ══════════════════════════════════════════════════════════════════════════════
// ── FEATURE 2: AUTO-MATCH PANEL (logo button) ─────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
let _matches = [];       // accumulated image_matches from SSE (kept for goToMatchPost)

function onLogoClick() {
    const panel = document.getElementById('notifPanel');
    const isOpen = panel && panel.style.display !== 'none';
    if (isOpen) {
        closeNotifPanel();
    } else {
        if (_notifications.length > 0) {
            openNotifPanel();
        } else {
            goHome();
        }
    }
}
function openMatchPanel() { openNotifPanel(); }
function closeMatchPanel() { closeNotifPanel(); }
function renderMatchPanel() { /* handled by notif panel */ }

function goToMatchPost(postId) {
    // If post is already in POSTS array, scroll to it
    // Otherwise reload all posts first then scroll
    const exists = POSTS.find(p => p.id === postId);
    if (exists) {
        scrollToPost(postId);
    } else {
        sb.getPosts().then(rows => {
            POSTS = (rows || []).filter(r => !r.is_deleted).map(mapRow);
            setImageSearchMode(null);
            renderFeed();
            setTimeout(() => scrollToPost(postId), 120);
        });
    }
}
function addMatches(newMatches) {
    const seen = new Set(_matches.map(m => m.id));
    newMatches.forEach(m => { if (!seen.has(m.id)) _matches.push(m); });
    // badge updated by _addNotification
}

function updateMatchDot() {
    _updateNotifBadge();
}

// ── NOTIFICATION SYSTEM ──────────────────────────────────────────────────────
// Notifications persisted to localStorage so they survive page refresh.
const _NOTIF_KEY = 'fi_notifications';
const _NOTIF_MAX = 50;  // keep at most 50 notifications

let _notifications = [];       // {id, type, text, seen, ts, meta}
let _notifPanelOpen = false;

// Restore notifications from localStorage on boot
(function _restoreNotifs() {
    try {
        const saved = localStorage.getItem(_NOTIF_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) _notifications = parsed;
        }
    } catch(e) { _notifications = []; }
})();

function _saveNotifs() {
    try {
        // Only keep the most recent MAX notifications to avoid localStorage bloat
        localStorage.setItem(_NOTIF_KEY, JSON.stringify(_notifications.slice(0, _NOTIF_MAX)));
    } catch(e) {}
}

function _addNotification(type, text, meta = {}) {
    const notif = { id: Date.now() + Math.random(), type, text, seen: false, ts: new Date().toISOString(), meta };
    _notifications.unshift(notif);
    _saveNotifs();
    _updateNotifBadge();
}

function _updateNotifBadge() {
    const dot = document.getElementById('matchDot');
    if (!dot) return;
    // Count individual items: each match notification may contain multiple matches
    let count = 0;
    _notifications.forEach(n => {
        if (n.seen) return;
        if (n.type === 'match' && n.meta?.matches?.length) {
            count += n.meta.matches.length;  // count each matched post separately
        } else {
            count += 1;
        }
    });
    if (count > 0) {
        dot.textContent = count;
        dot.style.display = '';
        dot.style.background = 'var(--accent)';
    } else {
        dot.style.display = 'none';
    }
}

function openNotifPanel() {
    _notifPanelOpen = true;
    const panel = document.getElementById('notifPanel');
    if (!panel) return;
    panel.style.display = '';
    _renderNotifPanel('new');
}

function closeNotifPanel() {
    _notifPanelOpen = false;
    const panel = document.getElementById('notifPanel');
    if (panel) panel.style.display = 'none';
}

function _renderNotifPanel(tab) {
    const tabNew  = document.getElementById('notifTabNew');
    const tabHist = document.getElementById('notifTabHistory');
    const list    = document.getElementById('notifList');
    if (!list) return;

    if (tabNew)  tabNew.classList.toggle('active', tab === 'new');
    if (tabHist) tabHist.classList.toggle('active', tab === 'history');

    const clearBtn = document.getElementById('notifClearBtn');
    if (clearBtn) clearBtn.style.display = tab === 'history' ? '' : 'none';

    // Separate new vs seen
    const newItems  = _notifications.filter(n => !n.seen);
    const histItems = _notifications.filter(n => n.seen);
    const items     = tab === 'new' ? newItems : histItems;

    // Mark exactly the IDs visible right now as seen after 2s.
    // Any notification that arrives AFTER this render is NOT in seenNow,
    // so it stays unseen and keeps the badge lit.
    if (tab === 'new') {
        const seenNow = new Set(newItems.map(n => n.id));
        setTimeout(() => {
            _notifications.forEach(n => { if (seenNow.has(n.id)) n.seen = true; });
            _saveNotifs();  // persist seen state
            _updateNotifBadge();
        }, 2000);
    }

    if (!items.length && tab === 'new') {
        list.innerHTML = '<div style="padding:20px;text-align:center;font-size:13px;color:var(--muted)">No new notifications</div>';
        return;
    }
    if (!items.length && tab === 'history') {
        list.innerHTML = '<div style="padding:20px;text-align:center;font-size:13px;color:var(--muted)">Nothing here yet</div>';
        return;
    }

    let html = '';
    items.forEach(n => {
        if (n.type === 'match') {
            // Match notifications have embedded match data in meta
            const matches = n.meta?.matches || [];
            if (matches.length) {
                matches.forEach(m => {
                    const imgSrc = m.image_url
                        ? (m.image_url.startsWith('http') ? m.image_url : sb.API_BASE + m.image_url)
                        : null;
                    html += `<div class="notif-item" onclick="closeNotifPanel();goToMatchPost('${m.id}')">
                        ${imgSrc ? `<img class="notif-thumb" src="${imgSrc}">` : '<div class="notif-icon">📦</div>'}
                        <div class="notif-body">
                            <div class="notif-text">🔍 Visual match: ${escHtml(m.title||'')} (${Math.round((m.score||0)*100)}%)</div>
                            <div class="notif-time">${timeAgo(new Date(n.ts))}</div>
                        </div>
                    </div>`;
                });
            } else {
                html += `<div class="notif-item">
                    <div class="notif-icon">🔍</div>
                    <div class="notif-body">
                        <div class="notif-text">${escHtml(n.text)}</div>
                        <div class="notif-time">${timeAgo(new Date(n.ts))}</div>
                    </div>
                </div>`;
            }
        } else {
            const icon = n.type === 'alert' ? '⚠️' : n.type === 'nudge' ? '📌' : '🔔';
            html += `<div class="notif-item">
                <div class="notif-icon">${icon}</div>
                <div class="notif-body">
                    <div class="notif-text">${escHtml(n.text)}</div>
                    <div class="notif-time">${timeAgo(new Date(n.ts))}</div>
                </div>
            </div>`;
        }
    });

    if (!html) html = '<div style="padding:20px;text-align:center;font-size:13px;color:var(--muted)">Nothing here yet</div>';
    list.innerHTML = html;
}

function clearHistoryNotifs() {
    _notifications = _notifications.filter(n => !n.seen);
    _saveNotifs();
    _renderNotifPanel('history');
}

// ── Hook SSE: listen for image_matches events ─────────────────────────────────
// connectPostSSE already sets up the 'all' channel.
// We subscribe to user-specific channel for match notifications.
let _userSSE = null;
function connectUserSSE(uid) {
    if (_userSSE) _userSSE.close();
    _userSSE = new EventSource(sb.API_BASE + `/stream?channel=user:${encodeURIComponent(uid)}`);
    _userSSE.onmessage = e => {
        try {
            const data = JSON.parse(e.data);
            if (data.type === 'image_matches') {
                addMatches(data.matches);
                // Store as notification with full match data so history works
                _addNotification('match', `🔍 ${data.matches.length} visual match${data.matches.length>1?'es':''} found!`, { matches: data.matches });
                // Flash badge
                const _md = document.getElementById('matchDot');
                if (_md) { _md.style.transform = 'scale(1.5)'; setTimeout(() => _md.style.transform = '', 400); }
                // If panel already open refresh it so new match appears immediately
                const _mp = document.getElementById('notifPanel');
                if (_mp && _mp.style.display !== 'none') _renderNotifPanel('new');
            }
            if (data.type === 'nudge') {
                _showNudgeBanner(data);
                _addNotification('nudge', `📌 "${data.title}" — is this still active?`);
            }
            if (data.type === 'alert_received') {
                const msg = data.note ? `⚠️ Alert from admin: ${data.note}` : '⚠️ You received an admin alert.';
                _addNotification('alert', msg);
                showToast(msg);
                // If panel already open, re-render so new alert shows immediately.
                // If closed, just leave badge lit – user will click to see it.
                const _ap = document.getElementById('notifPanel');
                if (_ap && _ap.style.display !== 'none') {
                    _renderNotifPanel('new');
                }
            }
            if (data.type === 'banned') {
                // Force immediate sign-out — no reload needed
                showToast('Your account has been banned.');
                setTimeout(async () => {
                    await sb.signOut();
                    App.isLoggedIn   = false;
                    App.isAdmin      = false;
                    App.isSuperAdmin = false;
                    App.currentUser  = null;
                    if (_userSSE) { _userSSE.close(); _userSSE = null; }
                    if (_dmSSE)   { _dmSSE.close();   _dmSSE   = null; }
                    updateMenuState();
                    renderFeed();
                    // Close any open sheets/modals
                    document.querySelectorAll('.comments-panel, .bottom-sheet, .dm-sheet').forEach(el => el.classList.remove('open'));
                    document.querySelectorAll('.modal-bg').forEach(el => el.classList.remove('open'));
                    document.body.style.overflow = '';
                }, 1500);
            }
        } catch {}
    };
    _userSSE.onerror = () => {
        _userSSE.close();
        setTimeout(() => connectUserSSE(uid), 3000);
    };
}

// connectUserSSE is now called directly inside setUser()


// ══════════════════════════════════════════════════════════════════════════════
// ── F-A: AUTO-FILL FROM PHOTO ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

let _dotsAnimId = null;

function _startDotsAnim(btn) {
    const d1 = btn.querySelector('.dot1');
    const d2 = btn.querySelector('.dot2');
    const d3 = btn.querySelector('.dot3');
    if (!d1) return;

    const dur = 350; // slower snake
    let step  = 0;

    function tick() {
        const which = step % 3;
        [d1, d2, d3].forEach((d, i) => {
            d.style.transition = `transform ${dur}ms ease`;
            d.style.transform  = i === which ? 'translateY(-5px)' : 'translateY(0)';
        });
        step++;
        _dotsAnimId = setTimeout(tick, dur);
    }
    tick();
}

function _stopDotsAnim(btn) {
    if (_dotsAnimId) { clearTimeout(_dotsAnimId); _dotsAnimId = null; }
    btn.querySelectorAll('.dot1,.dot2,.dot3').forEach(d => {
        d.style.transform  = '';
        d.style.transition = '';
        d.style.opacity    = '';
    });
}

async function triggerAutoFill() {
    if (!postImageDataUrl) return;
    const btn = document.getElementById('autoFillBtn');
    btn.disabled = true;
    _startDotsAnim(btn);

    try {
        const res    = await fetch(postImageDataUrl);
        const blob   = await res.blob();
        const file   = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
        const status   = document.getElementById('postStatus')?.value   || 'lost';
        const location = document.getElementById('postLocation')?.value || '';

        const result = await sb.describeImage(file, status, location);

        if (!result || (!result.title && !result.description)) {
            showToast('⚠️ Could not analyse image — Florence-2 may still be loading. Try again in 30s.');
            return;
        }

        const titleEl = document.getElementById('postTitle');
        const descEl  = document.getElementById('postDesc');
        const catEl   = document.getElementById('postCategory');

        if (result.title)       titleEl.value = result.title;
        if (result.description) descEl.value  = result.description;
        if (result.category && catEl) {
            const match = [...catEl.options].find(o => o.value === result.category || o.text === result.category);
            if (match) catEl.value = match.value;
        }

        showToast('✨ Form auto-filled! Edit anything that looks wrong.');
    } catch(e) {
        showToast('Auto-fill failed: ' + e.message);
    } finally {
        _stopDotsAnim(btn);
        btn.disabled = false;
    }
}


// ══════════════════════════════════════════════════════════════════════════════
// ── F-B: NATURAL LANGUAGE SEARCH ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════




async function runAiSearch(query) {
    _aiSearchActive = true;
    App.searchQuery = '';
    const chip = document.getElementById('chipAiSearch');
    if (chip) { chip.style.display = ''; chip.classList.add('active'); }

    const feed = document.getElementById('feed');
    if (feed) feed.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px">✨ Searching…</div>';

    // 1. Server-side hybrid search (SigLIP semantic + keyword)
    let raw = [];
    try {
        raw = await sb.aiSearch(query);
        if (!Array.isArray(raw)) raw = []; // guard against error objects
    } catch(e) {
        console.error('[ai search]', e);
        raw = [];
    }
    if (!_aiSearchActive) return;

    // Map server results — normalise image URLs
    const seenIds = new Set();
    let cards = raw.map(r => {
        const card = mapRow(r);
        card._similarity = typeof r.similarity === 'number' ? r.similarity : null;
        seenIds.add(card.id);
        return card;
    });

    // 2. Local keyword fallback — catches posts server missed (no embedding,
    //    cold start, etc.). Split query into words for partial matching.
    const q = query.toLowerCase().trim();
    const words = q.split(/\s+/).filter(w => w.length >= 2);
    if (words.length > 0) {
        const kwMatches = POSTS.filter(p => {
            if (seenIds.has(p.id)) return false;
            const haystack = [p.title, p.desc, p.location, p.category, p.owner]
                .join(' ').toLowerCase();
            // match if ANY query word appears in the haystack
            return words.some(w => haystack.includes(w));
        }).map(p => ({ ...p, _similarity: null }));
        cards = [...cards, ...kwMatches];
    }

    if (!cards.length) {
        showToast('No results found — try different words');
    }

    _imgSearchResults = cards;
    renderFeed();
}

function exitAiSearch() {
    _aiSearchActive = false;
    _aiModeOn = false;
    const btn = document.getElementById('aiSearchBtn');
    if (btn) { btn.classList.remove('active'); btn.title = 'AI semantic search'; }
    const chip = document.getElementById('chipAiSearch');
    if (chip) { chip.style.display = 'none'; chip.classList.remove('active'); }
    setImageSearchMode(null);
}


// ══════════════════════════════════════════════════════════════════════════════
// ── F-C: LIVE CAMERA FINDER ───────────────────────────────────────────────────
// Purpose: user describes their lost item (text or photo), opens camera,
//          walks around — AI watches every frame and says WHERE the item is.
//          Nothing to do with posts. Pure real-world object finder.
// ══════════════════════════════════════════════════════════════════════════════
let _cameraStream    = null;
let _cameraScanning  = false;
let _cameraRefBlob   = null;
let _cameraQueryText = '';
let _cameraLastFound = false;
let _scanning        = false;  // prevent overlapping requests

function openCameraSearch() {
    document.getElementById('cameraOverlay').style.display = 'flex';
    document.getElementById('cameraSetup').style.display   = 'flex';
    document.getElementById('cameraLive').style.display    = 'none';
}

function handleCameraRefImage(file) {
    if (!file) return;
    _cameraRefBlob = file;
    const preview     = document.getElementById('cameraRefPreview');
    const placeholder = document.getElementById('cameraRefPlaceholder');
    const removeBtn   = document.getElementById('cameraRefRemoveBtn');
    if (preview)     { preview.src = URL.createObjectURL(file); preview.style.display = 'block'; }
    if (placeholder) placeholder.style.display = 'none';
    if (removeBtn)   removeBtn.style.display = 'block';
    // Stop click on area from reopening file picker when image is set
    document.getElementById('cameraRefArea').onclick = null;
}

function removeCameraRefImage(e) {
    if (e) e.stopPropagation();
    _cameraRefBlob = null;
    const preview     = document.getElementById('cameraRefPreview');
    const placeholder = document.getElementById('cameraRefPlaceholder');
    const removeBtn   = document.getElementById('cameraRefRemoveBtn');
    const input       = document.getElementById('cameraRefInput');
    if (preview)     { preview.src = ''; preview.style.display = 'none'; }
    if (placeholder) placeholder.style.display = 'block';
    if (removeBtn)   removeBtn.style.display = 'none';
    if (input)       input.value = '';
    // Restore click handler
    document.getElementById('cameraRefArea').onclick = () => document.getElementById('cameraRefInput').click();
}

function startCameraWithContext() { startCameraSearch(); }

async function startCameraSearch() {
    _cameraQueryText = (document.getElementById('cameraQueryText')?.value || '').trim();
    if (!_cameraQueryText && !_cameraRefBlob) {
        showToast('Enter what you are looking for or add a reference photo');
        return;
    }
    const label = _cameraQueryText || '📷 Reference photo';
    document.getElementById('cameraTargetLabel').textContent = '🔍 ' + label;
    document.getElementById('cameraSetup').style.display = 'none';
    document.getElementById('cameraLive').style.display  = 'flex';

    try {
        _cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        const video = document.getElementById('cameraFeed');
        video.srcObject = _cameraStream;
        await video.play();
        _cameraScanning = true;
        _scanning = false;
        _setCameraStatus('scanning', '🔍 Scanning…');
        _scanLoop();
    } catch(e) {
        showToast('Camera access denied');
        closeCameraSearch();
    }
}

async function _scanLoop() {
    if (!_cameraScanning) return;

    // Don't overlap — if previous request still running, wait and retry
    if (_scanning) {
        setTimeout(_scanLoop, 100);
        return;
    }

    const video = document.getElementById('cameraFeed');
    if (!video || video.readyState < 2) {
        setTimeout(_scanLoop, 100);
        return;
    }

    // Capture frame
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width  = Math.min(vw, 640);
    canvas.height = Math.round(vh * (canvas.width / vw));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(async blob => {
        if (!blob || !_cameraScanning) return;
        _scanning = true;
        try {
            const result = await sb.findItemInFrame(blob, _cameraRefBlob, _cameraQueryText);
            if (!_cameraScanning) return;

            // Always show what word YOLO is actually searching for
            if (result && result.label && result.label !== '?') {
                document.getElementById('cameraTargetLabel').textContent = `🔍 Searching: "${result.label}"`;
            }

            if (result && result.found && result.box) {
                _cameraLastFound = true;
                const label = result.label || _cameraQueryText || 'item';
                _drawBox(result.box, label, result.confidence);
                _setCameraStatus('found', `✅ ${Math.round(result.confidence * 100)}% confident`);
            } else {
                _clearCanvas();
                if (!_cameraLastFound) _setCameraStatus('scanning', '🔍 Scanning…');
                _cameraLastFound = false;
            }
        } catch(e) {
            // silent — keep scanning
        } finally {
            _scanning = false;
            // Immediately scan next frame — as fast as server can respond
            if (_cameraScanning) _scanLoop();
        }
    }, 'image/jpeg', 0.85);
}

function closeCameraSearch() {
    _cameraScanning = false;
    _scanning = false;
    _clearCanvas();
    if (_cameraStream) {
        _cameraStream.getTracks().forEach(t => t.stop());
        _cameraStream = null;
    }
    _cameraRefBlob   = null;
    _cameraQueryText = '';
    _cameraLastFound = false;
    document.getElementById('cameraOverlay').style.display = 'none';
    const setup = document.getElementById('cameraSetup');
    const live  = document.getElementById('cameraLive');
    if (setup) setup.style.display = 'flex';
    if (live)  live.style.display  = 'none';
}

function _clearCanvas() {
    const canvas = document.getElementById('cameraCanvas');
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

function _drawBox(box, label, confidence) {
    const video  = document.getElementById('cameraFeed');
    const canvas = document.getElementById('cameraCanvas');
    if (!canvas || !video) return;

    // Match canvas size to displayed video
    const rect    = video.getBoundingClientRect();
    canvas.width  = rect.width  || video.offsetWidth  || 640;
    canvas.height = rect.height || video.offsetHeight || 480;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const [fx1, fy1, fx2, fy2] = box;
    const x1 = fx1 * canvas.width;
    const y1 = fy1 * canvas.height;
    const x2 = fx2 * canvas.width;
    const y2 = fy2 * canvas.height;
    const bw = x2 - x1;
    const bh = y2 - y1;

    // Glowing green box
    ctx.shadowColor  = '#22c97a';
    ctx.shadowBlur   = 20;
    ctx.strokeStyle  = '#22c97a';
    ctx.lineWidth    = 3;
    ctx.strokeRect(x1, y1, bw, bh);

    // Corner accents
    ctx.shadowBlur  = 0;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 3;
    const cs = Math.min(bw, bh) * 0.2;
    [[x1,y1,cs,0,0,cs],[x2,y1,-cs,0,0,cs],[x1,y2,cs,0,0,-cs],[x2,y2,-cs,0,0,-cs]]
        .forEach(([ox,oy,dx1,dy1,dx2,dy2]) => {
            ctx.beginPath(); ctx.moveTo(ox+dx1,oy+dy1); ctx.lineTo(ox,oy); ctx.lineTo(ox+dx2,oy+dy2); ctx.stroke();
        });

    // Label pill
    const pct  = Math.round(confidence * 100);
    const text = `${label}  ${pct}%`;
    ctx.font   = 'bold 14px system-ui, sans-serif';
    const tw   = ctx.measureText(text).width;
    const px   = x1, py = Math.max(0, y1 - 28);
    ctx.fillStyle = '#22c97a';
    ctx.beginPath(); ctx.roundRect(px, py, tw + 16, 24, 5); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.fillText(text, px + 8, py + 17);
}

function _setCameraStatus(state, text) {
    const bar   = document.getElementById('cameraStatusBar');
    const label = document.getElementById('cameraStatusText');
    const colors = { idle:'rgba(0,0,0,.55)', scanning:'rgba(91,141,255,.7)', found:'rgba(34,201,122,.8)', notfound:'rgba(0,0,0,.55)' };
    if (bar)   bar.style.background = colors[state] || colors.idle;
    if (label) label.textContent = text;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── F-D: AI ADMIN ID CHECK ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// ── VERIFY YOURSELF MODAL ────────────────────────────────────────────────────
let _verifyIdFile = null;

function openVerifyModal() {
    toggleMenu();
    _verifyIdFile = null;
    document.getElementById('verifyIdPreview').style.display = 'none';
    document.getElementById('verifyIdPlaceholder').style.display = '';
    document.getElementById('verifyIdRemoveBtn').style.display = 'none';
    document.getElementById('verifyIdInput').value = '';
    document.getElementById('verifyResult').style.display = 'none';
    // Always reset the button so re-opening the modal works correctly
    const btn = document.getElementById('verifySubmitBtn');
    btn.textContent = 'Verify';
    btn.disabled = false;
    btn.setAttribute('onclick', 'submitVerifyId()');
    document.getElementById('verifyIdArea').onclick = () => document.getElementById('verifyIdInput').click();
    document.getElementById('verifyModal').classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeVerifyModal() {
    document.getElementById('verifyModal').classList.remove('open');
    document.body.style.overflow = '';
    _verifyIdFile = null;
}

function handleVerifyIdFile(file) {
    if (!file) return;
    _verifyIdFile = file;
    document.getElementById('verifyIdPreview').src = URL.createObjectURL(file);
    document.getElementById('verifyIdPreview').style.display = 'block';
    document.getElementById('verifyIdPlaceholder').style.display = 'none';
    document.getElementById('verifyIdRemoveBtn').style.display = 'block';
    document.getElementById('verifyIdArea').onclick = null;
}

function removeVerifyId(e) {
    if (e) e.stopPropagation();
    _verifyIdFile = null;
    document.getElementById('verifyIdPreview').src = '';
    document.getElementById('verifyIdPreview').style.display = 'none';
    document.getElementById('verifyIdPlaceholder').style.display = '';
    document.getElementById('verifyIdRemoveBtn').style.display = 'none';
    document.getElementById('verifyIdInput').value = '';
    document.getElementById('verifyIdArea').onclick = () => document.getElementById('verifyIdInput').click();
}

async function submitVerifyId() {
    if (!_verifyIdFile) { showToast('Please upload your university ID first'); return; }
    const btn = document.getElementById('verifySubmitBtn');
    const resultEl = document.getElementById('verifyResult');
    btn.textContent = 'Verifying…'; btn.disabled = true;
    resultEl.style.display = 'none';

    try {
        const form = new FormData();
        form.append('file', _verifyIdFile, 'id.jpg');
        const r = await fetch(`${sb.API_URL}/auth/verify-badge`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${sb.getToken()}` },
            body: form,
        });
        const res = await r.json();

        if (res.ok && res.badge !== 'none') {
            // 1. Update in-memory user state
            if (App.currentUser) App.currentUser.badge = res.badge;

            // 2. Update ownerBadge on every post by this user so cards re-render immediately
            if (App.currentUser) {
                POSTS.forEach(p => {
                    if (p.owner === App.currentUser.uid) p.ownerBadge = res.badge;
                });
                renderFeed();
            }

            // 3. Refresh menu (Verify vs Change Status toggle)
            updateMenuState();

            resultEl.style.cssText = 'display:block;margin-bottom:12px;padding:10px;border-radius:8px;font-size:13px;text-align:center;background:rgba(34,201,122,.1);color:#22c97a;border:1px solid rgba(34,201,122,.25)';
            resultEl.textContent = res.message;
            btn.textContent = 'Done';
            btn.disabled = false;
            // Use setAttribute so openVerifyModal can safely reset it next time
            btn.setAttribute('onclick', 'closeVerifyModal()');
            showToast(res.message);
        } else {
            resultEl.style.cssText = 'display:block;margin-bottom:12px;padding:10px;border-radius:8px;font-size:13px;text-align:center;background:rgba(255,80,80,.1);color:#ff6b6b;border:1px solid rgba(255,80,80,.25)';
            resultEl.textContent = res.message || 'Could not verify ID. Make sure the card is clearly visible.';
            btn.textContent = 'Try Again';
            btn.disabled = false;
        }
    } catch(e) {
        resultEl.style.cssText = 'display:block;margin-bottom:12px;padding:10px;border-radius:8px;font-size:13px;text-align:center;background:rgba(255,80,80,.1);color:#ff6b6b;border:1px solid rgba(255,80,80,.25)';
        resultEl.textContent = 'Connection error. Please try again.';
        btn.textContent = 'Try Again';
        btn.disabled = false;
    }
}


function _showNudgeBanner(data) {
    showToast(`📌 "${data.title}" — is this still active?`);
    // Also show a persistent banner they can act on
    const existing = document.getElementById('nudgeBanner');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.id = 'nudgeBanner';
    banner.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--border);border-radius:14px;padding:12px 16px;z-index:300;max-width:340px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.4)';
    banner.innerHTML = `
        <div style="font-size:12px;font-weight:600;margin-bottom:8px">📌 Still active?</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:10px">"${escHtml(data.title)}"</div>
        <div style="display:flex;gap:8px">
            <button onclick="sb.updatePost('${data.post_id}',{status:'recovered'});document.getElementById('nudgeBanner').remove();showToast('Marked as recovered!')"
                style="flex:1;padding:7px;background:rgba(34,201,122,.15);color:var(--found);border:1px solid rgba(34,201,122,.25);border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">
                ✓ Recovered
            </button>
            <button onclick="document.getElementById('nudgeBanner').remove()"
                style="flex:1;padding:7px;background:rgba(255,255,255,.06);color:var(--muted);border:1px solid var(--border);border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">
                Still active
            </button>
        </div>`;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 15000);
}
