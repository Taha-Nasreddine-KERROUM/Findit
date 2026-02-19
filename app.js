// ============================================================
//  FindIt – Main App
//  Works in two modes:
//   • DEMO MODE  (USE_SUPABASE = false) — all data is local, no backend needed
//   • LIVE MODE  (USE_SUPABASE = true)  — reads/writes from Supabase
// ============================================================
const USE_SUPABASE = true; // flip to true once you've set up Supabase

// ── APP STATE ─────────────────────────────────────────────────────────────────
const App = {
    isLoggedIn: false,
    isAdmin: false,
    isSuperAdmin: false,
    currentUser: null,   // { id, uid, name, initials, color, role }
    activeFilter: 'all',
    searchQuery: '',
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
    } else {
        // Demo: simulate being logged in as amir_b who owns post 1
        App.isLoggedIn = true;
        App.currentUser = { id:'demo-amir', uid:'amir_b', name:'Amir', initials:'AB', color:'#4da6ff', role:'user' };
    }
    updateMenuState();
    initSearch();
    initFilters();
    renderFeed();
})();

function setUser(me) {
    App.isLoggedIn = true;
    App.currentUser = {
        id:       me.profile.id,
        uid:      me.profile.uid,
        name:     me.profile.name,
        initials: me.profile.initials,
        color:    me.profile.color,
        role:     me.profile.role,
    };
    App.isAdmin      = ['admin','super_admin'].includes(me.profile.role);
    App.isSuperAdmin = me.profile.role === 'super_admin';
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
    const imgHtml = post.hasImage
        ? `<div class="card-image"><div class="img-placeholder ${post.imgClass}">${post.imgEmoji}</div></div>` : '';

    const dotsMenu = isOwner ? `
    <div class="card-menu" id="menu-${post.id}">
      <div class="card-menu-item" onclick="openEdit(${post.id});closeCardMenu(${post.id})">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Edit post
      </div>
      <div class="card-menu-sep"></div>
      <div class="card-menu-item danger" onclick="openConfirm(${post.id});closeCardMenu(${post.id})">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
        Delete post
      </div>
    </div>` : '';
    const dotsBtn = isOwner
        ? `<button class="dots-btn" onclick="toggleCardMenu(event,${post.id})" title="More options">•••</button>` : '';

    return `
  <div class="card" data-post="${post.id}" data-owner="${post.owner}"
       data-status="${post.status}" data-category="${post.category.toLowerCase()}"
       data-location="${post.location.toLowerCase()}" data-title="${post.title.toLowerCase()}"
       data-desc="${post.desc.toLowerCase()}">
    <div class="card-inner">
      <div class="card-header">
        <div class="card-avatar" style="background:${post.ownerColor}"
             onclick="openProfile('${post.ownerName}','${post.ownerInitials}','${post.ownerColor}','${post.owner}')">${post.ownerInitials}</div>
        <div class="card-meta">
          <span class="location-tag" onclick="openLocation('${post.location}')">${post.location}</span>
          <span class="username" onclick="openProfile('${post.ownerName}','${post.ownerInitials}','${post.ownerColor}','${post.owner}')">u/${post.owner}</span>
        </div>
        <div class="card-right">
          <div class="card-status-row">
            <span class="card-category">${post.category}</span>
            <span class="card-date">${post.date}</span>
            <span class="status-badge ${statusClass(post.status)}" id="status-card-${post.id}">${statusLabel(post.status)}</span>
          </div>
        </div>
      </div>
      <div class="card-title">${post.title}</div>
      <div class="card-desc">${post.desc}</div>
      ${imgHtml}
      <div class="card-actions">
        <button class="action-btn" onclick="openComments('${post.title.substring(0,30)}…')">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          ${post.comments} comment${post.comments!==1?'s':''}
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
    if (u) openProfile(u.name, u.initials, u.color, u.uid);
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
function openComments(title) {
    document.getElementById('panelTitle').textContent = title;
    document.getElementById('commentsPanel').classList.add('open');
    document.getElementById('overlay').classList.add('show');
    document.body.style.overflow='hidden';
}
function closeComments() {
    document.getElementById('commentsPanel').classList.remove('open');
    document.getElementById('overlay').classList.remove('show');
    document.body.style.overflow='';
}
function toggleReply(btn) {
    const body=btn.closest('.comment-body');
    const form=body.querySelector('.reply-form');
    const user=body.querySelector('.comment-user').textContent;
    if (!form.innerHTML.trim()) form.innerHTML=`<input class="reply-input" placeholder="Reply to ${user}…"><button class="reply-send" onclick="submitReply(this)">Send</button>`;
    form.classList.toggle('visible');
    if (form.classList.contains('visible')) form.querySelector('.reply-input').focus();
}
function submitReply(btn) {
    const form=btn.closest('.reply-form');
    const input=form.querySelector('.reply-input');
    if (!input.value.trim()) return;
    const replies=form.closest('.comment-body').querySelector('.replies');
    const div=document.createElement('div'); div.className='reply';
    div.innerHTML=`<div class="reply-avatar" style="background:var(--accent)">Me</div><div class="reply-body"><div class="comment-user">u/me</div><div class="comment-text" style="font-size:12px;color:#b0b6c5">${input.value}</div></div>`;
    replies.appendChild(div); input.value=''; form.classList.remove('visible');
}
function submitCommentClick() {
    const input=document.getElementById('commentInput');
    if (!input.value.trim()) return;
    const scroll=document.getElementById('commentsScroll');
    const div=document.createElement('div'); div.className='comment';
    div.innerHTML=`<div class="comment-avatar" style="background:var(--accent)">Me</div><div class="comment-body"><div class="comment-user">u/me</div><div class="comment-text">${input.value}</div><div class="comment-meta"><span class="comment-time">just now</span><button class="reply-btn" onclick="toggleReply(this)">Reply</button></div><div class="reply-form"></div><div class="replies"></div></div>`;
    scroll.appendChild(div); input.value=''; scroll.scrollTop=scroll.scrollHeight;
}

// ── PROFILE ───────────────────────────────────────────────────────────────────
let cur={};
const pts=[320,480,640,750,840,910,1200,1450];
function openProfile(name,initials,color,uid) {
    cur={color,name:name+' B.',initials,uid};
    document.getElementById('pAvatar').style.background=color;
    document.getElementById('pAvatar').textContent=initials;
    document.getElementById('pName').textContent=name+' B.';
    document.getElementById('pHandle').textContent='u/'+uid;
    document.getElementById('pPoints').textContent=pts[Math.floor(Math.random()*pts.length)]+' points';
    document.getElementById('profileMsgBtn').style.display=
        (App.isLoggedIn && uid===App.currentUser?.uid) ? 'none' : 'inline-flex';
    openSheet('profileSheet','profileOverlay');
}
function closeProfile() { closeSheet('profileSheet','profileOverlay'); }

function openSheet(id,overlayId) {
    document.getElementById(id).classList.add('open');
    if (overlayId) document.getElementById(overlayId).classList.add('open');
    document.body.style.overflow='hidden';
}
function closeSheet(id,overlayId) {
    document.getElementById(id).classList.remove('open');
    if (overlayId) document.getElementById(overlayId).classList.remove('open');
    document.body.style.overflow='';
}

function openHistoryItem(title,desc,status,location,date,category) {
    document.getElementById('hTitle').textContent=title;
    document.getElementById('hDesc').textContent=desc;
    document.getElementById('hDate').textContent=date;
    document.getElementById('hLocation').textContent=location;
    document.getElementById('hCategory').textContent=category;
    const sb2=document.getElementById('hStatus');
    sb2.textContent=statusLabel(status); sb2.className='status-badge '+statusClass(status);
    openSheet('historySheet');
}
function closeHistoryItem() { closeSheet('historySheet'); document.body.style.overflow='hidden'; }

// ── DM ────────────────────────────────────────────────────────────────────────
function openDM() {
    closeProfile();
    document.getElementById('dmAvatar').style.background=cur.color;
    document.getElementById('dmAvatar').textContent=cur.initials;
    document.getElementById('dmName').textContent=cur.name;
    setTimeout(()=>{document.getElementById('dmSheet').classList.add('open');document.body.style.overflow='hidden';},160);
}
function closeDM() { document.getElementById('dmSheet').classList.remove('open'); document.body.style.overflow=''; }
function sendDMClick() {
    const input=document.getElementById('dmInput');
    if (!input.value.trim()) return;
    const msgs=document.getElementById('dmMessages');
    const div=document.createElement('div'); div.className='dm-msg me'; div.textContent=input.value;
    msgs.appendChild(div); input.value=''; msgs.scrollTop=msgs.scrollHeight;
}

// ── LOCATION ──────────────────────────────────────────────────────────────────
function openLocation(name) {
    document.getElementById('locTitle').textContent=name;
    const related=(LOCATIONS[name]||[]).map(id=>POSTS.find(p=>p.id===id)).filter(Boolean);
    document.getElementById('locCount').textContent=related.length+' item'+(related.length!==1?'s':'')+' reported here';
    document.getElementById('locList').innerHTML=related.map(p=>`
    <div class="loc-card">
      <div class="loc-card-head">
        <div class="card-avatar" style="background:${p.ownerColor};width:26px;height:26px;font-size:9px;flex-shrink:0">${p.ownerInitials}</div>
        <div class="loc-card-meta"><span class="lc-loc">${p.location}</span><span class="lc-uid">u/${p.owner}</span></div>
        <span class="status-badge ${statusClass(p.status)}" style="font-size:10px;padding:2px 7px">${statusLabel(p.status)}</span>
      </div>
      <div class="loc-card-title">${p.title}</div>
      <div class="loc-card-desc">${p.desc.substring(0,80)}…</div>
    </div>`).join('');
    openSheet('locSheet','locOverlay');
}
function closeLocation() { closeSheet('locSheet','locOverlay'); }

// ── POST ──────────────────────────────────────────────────────────────────────
function tryPost() {
    if (!App.isLoggedIn) {
        document.getElementById('signinReqModal').classList.add('open');
        document.body.style.overflow='hidden'; return;
    }
    document.getElementById('postModal').classList.add('open');
    document.body.style.overflow='hidden';
}
function closePost() { document.getElementById('postModal').classList.remove('open'); document.body.style.overflow=''; }
function closeSigninReq() { document.getElementById('signinReqModal').classList.remove('open'); document.body.style.overflow=''; }

// ── EDIT ──────────────────────────────────────────────────────────────────────
let editingPostId=null, editSelectedStatus=null;
function openEdit(postId) {
    editingPostId=postId; editSelectedStatus=null;
    document.querySelectorAll('.status-opt').forEach(o=>o.className='status-opt');
    const post=POSTS.find(p=>p.id===postId); if (!post) return;
    document.getElementById('editTitle').value=post.title;
    document.getElementById('editDesc').value=post.desc;
    const cur=document.querySelector(`.status-opt[data-status="${post.status}"]`);
    if (cur) { cur.classList.add('sel-'+post.status); editSelectedStatus=post.status; }
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
    if (USE_SUPABASE) await sb.updatePost(post.id, {title:post.title,description:post.desc,status:post.status});
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
function openAdminDashboard() { toggleMenu(); window.open('admin.html','_blank'); }

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function openLogin() {
    toggleMenu();
    document.getElementById('loginFormWrap').style.display='';
    document.getElementById('loginSent').style.display='none';
    document.getElementById('adminRequestWrap').style.display='none';
    document.getElementById('loginEmail').value='';
    document.getElementById('loginEmail').style.borderColor='';
    document.getElementById('loginModal').classList.add('open');
    document.body.style.overflow='hidden';
}
function closeLogin() { document.getElementById('loginModal').classList.remove('open'); document.body.style.overflow=''; }

async function sendMagicLink() {
    const email=document.getElementById('loginEmail').value.trim();
    if (!email||!email.includes('@')) {
        document.getElementById('loginEmail').style.borderColor='rgba(224,90,90,0.5)';
        document.getElementById('loginEmail').focus(); return;
    }
    if (USE_SUPABASE) {
        const ok = await sb.sendMagicLink(email);
        if (!ok) { showToast('Could not send email. Check the address.'); return; }
    }
    document.getElementById('loginFormWrap').style.display='none';
    document.getElementById('loginSent').style.display='block';
    document.getElementById('loginSentMsg').innerHTML=`We sent a sign-in link to<br><strong>${email}</strong><br><br>Click it to log in — no password required.`;
    if (!USE_SUPABASE) {
        setTimeout(()=>{
            App.isLoggedIn=true;
            App.currentUser={ id:'demo', uid: email.split('@')[0].replace(/\./g,'_'), name:email.split('@')[0], initials:email.split('@')[0].substring(0,2).toUpperCase(), color:'#5b8dff', role:'user' };
            closeLogin(); updateMenuState(); renderFeed(); showToast('Signed in (demo)');
        },1500);
    }
}

// ── ADMIN REQUEST FORM ────────────────────────────────────────────────────────
function contactAdmin() {
    // show in-app form instead of opening email client (nicer UX)
    document.getElementById('loginFormWrap').style.display='none';
    document.getElementById('adminRequestWrap').style.display='block';
}
function backToLogin() {
    document.getElementById('adminRequestWrap').style.display='none';
    document.getElementById('loginFormWrap').style.display='block';
}
async function submitAdminRequest() {
    const name      = document.getElementById('arName').value.trim();
    const roleTitle = document.getElementById('arRole').value.trim();
    const reason    = document.getElementById('arReason').value.trim();
    const email     = document.getElementById('arEmail').value.trim();
    if (!name||!roleTitle||!reason||!email) { showToast('Please fill in all fields'); return; }
    if (USE_SUPABASE && App.isLoggedIn) {
        await sb.submitAdminRequest({
            user_id: App.currentUser.id, email, name, role_title: roleTitle, reason,
        });
    }
    // Always show confirmation — even in demo mode
    document.getElementById('adminRequestWrap').style.display='none';
    document.getElementById('adminRequestSent').style.display='block';
}

// ── SHARE ─────────────────────────────────────────────────────────────────────
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