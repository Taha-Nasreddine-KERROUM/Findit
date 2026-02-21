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
            if (restored) setUser(restored);
        }
        const rows = await sb.getPosts();
        POSTS = (rows || []).filter(r => !r.is_deleted).map(mapRow);
    }
    updateMenuState();
    initSearch();
    initFilters();
    renderFeed();
})();

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
        title:         r.title       || '',
        desc:          r.description || '',
        location:      r.location    || '',
        category:      r.category    || '',
        status:        r.status      || 'found',
        date:          dateStr,
        comments:      Number(r.comment_count) || 0,
        hasImage:      !!r.image_url,
        _imageUrl:     r.image_url || null,
    };
}

function setUser(me) {
    // Accept both {profile:{...}} and flat profile object
    const p = me.profile || me;
    App.isLoggedIn   = true;
    App.currentUser  = {
        id:       p.id,
        uid:      p.uid,
        name:     p.name,
        initials: p.initials,
        color:    p.color,
        role:     p.role,
    };
    App.isAdmin      = ['admin','super_admin'].includes(p.role);
    App.isSuperAdmin = p.role === 'super_admin';
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
    let imgHtml = '';
    if (post._imageUrl) {
        imgHtml = `<div class="card-image"><img src="${post._imageUrl}" style="width:100%;display:block;height:auto;border-radius:0"></div>`;
    }

    const dotsMenu = isOwner ? `
    <div class="card-menu" id="menu-${post.id}">
      <div class="card-menu-item" onclick="openEdit('${post.id}');closeCardMenu('${post.id}')">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Edit post
      </div>
      <div class="card-menu-sep"></div>
      <div class="card-menu-item danger" onclick="openConfirm('${post.id}');closeCardMenu('${post.id}')">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
        Delete post
      </div>
    </div>` : '';
    const dotsBtn = isOwner
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
          <span class="username" onclick="openProfile('${safeOwnerName}','${safeOwnerInitials}','${safeOwnerColor}','${safeOwner}','${post.ownerId}')">u/${post.owner}</span>
        </div>
        <div class="card-right">
          <div class="card-status-row">
            <span class="card-category">${post.category}</span>
            <span class="card-date">${post.date}</span>
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

function renderFeed() {
    const feed  = document.getElementById('feed');
    const empty = document.getElementById('emptyState');
    const q = App.searchQuery.toLowerCase().trim();
    const f = App.activeFilter;
    const filtered = POSTS.filter(p => {
        const statusMatch = f==='all' || p.status===f || p.location.toLowerCase().includes(f);
        const searchMatch = !q || [p.title,p.desc,p.location,p.category,p.owner].some(s=>s.toLowerCase().includes(q));
        return statusMatch && searchMatch;
    });
    if (!filtered.length) { feed.innerHTML=''; empty.classList.add('visible'); }
    else { empty.classList.remove('visible'); feed.innerHTML=filtered.map(buildCard).join(''); }
}

// ── SEARCH ────────────────────────────────────────────────────────────────────
function initSearch() {
    const input = document.getElementById('searchInput');
    const clear = document.getElementById('searchClear');
    input.addEventListener('input', () => {
        App.searchQuery = input.value;
        clear.classList.toggle('visible', !!input.value);
        renderFeed();
    });
    clear.addEventListener('click', () => {
        input.value=''; App.searchQuery='';
        clear.classList.remove('visible');
        renderFeed(); input.focus();
    });
}

// ── FILTERS ───────────────────────────────────────────────────────────────────
function initFilters() {
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
            chip.classList.add('active');
            App.activeFilter = chip.dataset.filter;
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
document.addEventListener('click', () => { if (openMenuId) closeCardMenu(openMenuId); });

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
        document.getElementById('adminMenuItem').style.display   = App.isAdmin ? '' : 'none';
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
    } else {
        renderComments([]);
    }
}

function renderComments(comments) {
    const scroll = document.getElementById('commentsScroll');
    if (!comments.length) {
        scroll.innerHTML = '<div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:13px">No comments yet. Be the first!</div>';
        return;
    }
    // Only top-level (no parent)
    const top = comments.filter(c => !c.parent_id);
    const byParent = {};
    comments.filter(c => c.parent_id).forEach(c => {
        (byParent[c.parent_id] = byParent[c.parent_id] || []).push(c);
    });

    scroll.innerHTML = top.map(c => buildCommentHtml(c, byParent)).join('');
}

function buildCommentHtml(c, byParent) {
    const author   = c.author || {};
    const initials = author.initials || '?';
    const uid      = author.uid      || 'user';
    const color    = author.color    || '#5b8dff';
    const name     = author.name     || uid;
    const time     = timeAgo(new Date(c.created_at));
    const replies  = (byParent[c.id] || []).map(r => buildCommentHtml(r, byParent)).join('');

    return `
    <div class="comment" data-comment-id="${c.id}">
      <div class="comment-avatar" style="background:${color}">${initials}</div>
      <div class="comment-body">
        <div class="comment-user">u/${uid}</div>
        <div class="comment-text">${escHtml(c.body)}</div>
        ${c.image_url ? `<img src="${c.image_url}" style="max-width:160px;max-height:120px;border-radius:8px;margin-top:6px;display:block;object-fit:cover;cursor:pointer" onclick="this.style.maxWidth=this.style.maxWidth==='100%'?'160px':'100%';this.style.maxHeight=this.style.maxHeight==='none'?'120px':'none'">` : ''}
        <div class="comment-meta">
          <span class="comment-time">${time}</span>
          ${App.isLoggedIn ? `<button class="reply-btn" onclick="toggleReply(this,'${c.id}')">Reply</button>` : ''}
        </div>
        <div class="reply-form" id="reply-form-${c.id}" style="display:none"></div>
        <div class="replies">${replies}</div>
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

function closeComments() {
    document.getElementById('commentsPanel').classList.remove('open');
    document.getElementById('overlay').classList.remove('show');
    document.body.style.overflow='';
    App.openPostId = null;
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
    document.getElementById('pStatPosted').textContent   = stats.postCount;
    document.getElementById('pStatReturned').textContent = (posts || []).filter(p => p.status === 'recovered').length;
    const commentsEl = document.getElementById('pStatComments');
    if (commentsEl) commentsEl.textContent = stats.commentCount;

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
        App.activeFilter = 'all';
        App.searchQuery  = '';
        document.getElementById('searchInput').value = '';
        document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
        document.querySelector('.filter-chip[data-filter="all"]').classList.add('active');
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
    if (targetUid) {
        closeProfile();
        setTimeout(() => openDMThread(targetUid, targetName, targetInitials, targetColor), 160);
    } else {
        openDMSheet();
    }
}

// ── DM ────────────────────────────────────────────────────────────────────────
let _dmOtherUid = null;

async function openDMSheet() {
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
        <div class="dm-avatar" style="background:${c.color};flex-shrink:0">${c.initials}</div>
        <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
                <span style="font-weight:600;font-size:13px">u/${escHtml(c.uid)}</span>
                <span style="font-size:11px;color:var(--muted)">${c.last_at ? timeAgo(new Date(c.last_at)) : ''}</span>
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
    document.getElementById('dmAvatar').style.background = color;
    document.getElementById('dmAvatar').textContent      = initials;
    document.getElementById('dmName').textContent        = name || ('u/' + otherUid);

    const msgs = document.getElementById('dmMessages');
    msgs.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">Loading…</div>';

    const data = await sb.getDMThread(otherUid);
    if (!data) { msgs.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">Could not load messages</div>'; return; }

    renderDMMessages(data.messages);
    document.getElementById('dmInput').focus();
}

function renderDMMessages(messages) {
    const msgs = document.getElementById('dmMessages');
    if (!messages.length) {
        msgs.innerHTML = '<div style="text-align:center;padding:40px 16px;color:var(--muted);font-size:13px">No messages yet. Say hi! 👋</div>';
        return;
    }
    msgs.innerHTML = messages.map(m => {
        const isMe = m.sender_uid === App.currentUser?.uid;
        return `<div class="dm-msg ${isMe ? 'me' : 'them'}">${escHtml(m.body)}<div class="dm-msg-time">${timeAgo(new Date(m.created_at))}</div></div>`;
    }).join('');
    msgs.scrollTop = msgs.scrollHeight;
}

async function sendDMClick() {
    if (!_dmOtherUid) return;
    const input = document.getElementById('dmInput');
    const body  = input.value.trim();
    if (!body) return;
    input.value = '';
    const res = await sb.sendDM(_dmOtherUid, body);
    if (res) {
        const msgs = document.getElementById('dmMessages');
        // Remove empty state if present
        const empty = msgs.querySelector('div[style*="padding:40px"]');
        if (empty) empty.remove();
        const div = document.createElement('div');
        div.className = 'dm-msg me';
        div.innerHTML = `${escHtml(body)}<div class="dm-msg-time">just now</div>`;
        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;
    }
}

function closeDM() {
    document.getElementById('dmSheet').classList.remove('open');
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
    document.getElementById('uploadPlaceholder').style.display='none';
    document.getElementById('uploadPreviewWrap').style.display='block';
    document.getElementById('uploadPreview').src=dataUrl;
}
function clearImage() {
    postImageDataUrl = null;
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
    const title    = document.getElementById('postTitle').value.trim();
    const desc     = document.getElementById('postDesc').value.trim();
    const location = document.getElementById('postLocation').value;
    const category = document.getElementById('postCategory').value;
    const status   = document.getElementById('postStatus').value;
    if (!title) { document.getElementById('postTitle').focus(); showToast('Please enter a title'); return; }

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
        POSTS.unshift(newPost);
        closePost();
        renderFeed();
        showToast('Post published!');

        if (USE_SUPABASE) {
            // Upload image to Supabase Storage first so it has a real public URL
            let imageUrl = null;
            if (postImageDataUrl) {
                imageUrl = await sb.uploadImage(postImageDataUrl, 'posts');
                // Update local post with real URL right away
                const tempPost = POSTS.find(p => p.id === tempId);
                if (tempPost && imageUrl) { tempPost._imageUrl = imageUrl; renderFeed(); }
            }
            const saved = await sb.createPost({ author_id: App.currentUser.id, title, description: desc, location, category, status, image_url: imageUrl });
            if (saved && saved[0]) {
                const realPost = mapRow({ ...saved[0],
                    author_uid:      App.currentUser.uid,
                    author_name:     App.currentUser.name,
                    author_initials: App.currentUser.initials,
                    author_color:    App.currentUser.color,
                });
                const idx = POSTS.findIndex(p => p.id === tempId);
                if (idx > -1) POSTS[idx] = realPost;
                renderFeed();
            }
        }
    } catch(err) {
        console.error('submitPost error:', err);
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

async function doRegister() {
    const name = document.getElementById('regName').value.trim();
    const uid  = document.getElementById('regUid').value.trim();
    const pw   = document.getElementById('regPw').value;
    const err  = document.getElementById('registerError');
    err.style.display = 'none';
    if (!uid || !pw) { err.textContent='Fill in all fields'; err.style.display=''; return; }
    const btn = document.getElementById('registerBtn');
    btn.textContent='Creating…'; btn.disabled=true;
    const res = await sb.register(uid, pw, name || uid);
    btn.textContent='Create account'; btn.disabled=false;
    if (!res || res._error) {
        err.textContent = res?._error || 'Could not reach server';
        err.style.display=''; return;
    }
    await afterAuth(res);
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
