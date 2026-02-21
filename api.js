// ============================================================
//  FindIt – API Client
//  Replace API_URL with your Hugging Face Space URL.
// ============================================================
const API_URL = 'https://TiH0-findit-backend.hf.space';

const sb = (() => {
    let _token = localStorage.getItem('fi_token') || null;

    function authHeaders(extra = {}) {
        const h = { 'Content-Type': 'application/json', ...extra };
        if (_token) h['Authorization'] = `Bearer ${_token}`;
        return h;
    }

    async function api(path, opts = {}) {
        try {
            const r = await fetch(`${API_URL}${path}`, {
                ...opts,
                headers: authHeaders(opts.headers || {}),
            });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                console.error('API error', r.status, path, err);
                return { _error: err.detail || 'Server error', _status: r.status };
            }
            const text = await r.text();
            return text ? JSON.parse(text) : true;
        } catch(e) {
            console.error('API fetch error', path, e);
            return { _error: 'Could not reach server', _status: 0 };
        }
    }

    // ── AUTH ──────────────────────────────────────────────────────────────────
    async function register(uid, password, name) {
        const res = await api('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ uid, password, name }),
        });
        if (res && res.token) {
            _token = res.token;
            localStorage.setItem('fi_token', _token);
        }
        return res;
    }

    async function login(uid, password) {
        const res = await api('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ uid, password }),
        });
        if (res && res.token) {
            _token = res.token;
            localStorage.setItem('fi_token', _token);
        }
        return res;
    }

    async function restoreSession() {
        if (!_token) return null;
        const res = await api('/auth/me');
        if (!res || res._error) {
            _token = null;
            localStorage.removeItem('fi_token');
            return null;
        }
        return res;
    }

    async function handleCallback() { return restoreSession(); }

    async function signOut() {
        await api('/auth/logout', { method: 'POST' });
        _token = null;
        localStorage.removeItem('fi_token');
    }

    async function getMe() {
        return api('/auth/me');
    }

    // ── PROFILES ──────────────────────────────────────────────────────────────
    async function getProfileStats(uid) { return api(`/profiles/${uid}/stats`); }
    async function getPostsByUser(uid)  { return api(`/profiles/${uid}/posts`); }
    async function getAllUsers()        { return api('/admin/users') || []; }
    async function updateProfile(id, fields) {
        return api(`/admin/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
    }

    // ── POSTS ─────────────────────────────────────────────────────────────────
    async function getPosts() { return api('/posts') || []; }

    async function createPost(fields) {
        const res = await api('/posts', { method: 'POST', body: JSON.stringify(fields) });
        return res && !res._error ? [res] : null;
    }

    async function updatePost(id, fields) {
        return api(`/posts/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
    }

    async function deletePost(id) {
        return api(`/posts/${id}`, { method: 'DELETE' });
    }

    // ── COMMENTS ──────────────────────────────────────────────────────────────
    async function getComments(postId) { return api(`/posts/${postId}/comments`) || []; }

    async function createComment(postId, body, parentId = null, imageUrl = null) {
        const payload = { body };
        if (parentId) payload.parent_id = parentId;
        if (imageUrl) payload.image_url = imageUrl;
        return api(`/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify(payload) });
    }

    // ── IMAGES ────────────────────────────────────────────────────────────────
    async function uploadImage(dataUrl) {
        const [meta, b64] = dataUrl.split(',');
        const mime = meta.match(/:(.*?);/)[1];
        const ext  = mime.split('/')[1].replace('jpeg','jpg');
        const bin  = atob(b64);
        const arr  = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const form = new FormData();
        form.append('file', new Blob([arr], {type: mime}), `upload.${ext}`);
        try {
            const r = await fetch(`${API_URL}/upload`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${_token}` },
                body: form,
            });
            if (!r.ok) return null;
            const data = await r.json();
            return `${API_URL}${data.url}`;
        } catch(e) { return null; }
    }

    // ── DMS ───────────────────────────────────────────────────────────────────
    async function getConversations()       { return api('/dms/conversations') || []; }
    async function getDMThread(otherUid)    { return api(`/dms/${otherUid}`); }
    async function sendDM(otherUid, body, imageUrl = null) {
        const payload = { body: body || '' };
        if (imageUrl) payload.image_url = imageUrl;
        return api(`/dms/${otherUid}`, { method:'POST', body: JSON.stringify(payload) });
    }
    async function getUnreadCount()         { return api('/dms/unread/count'); }

    // ── ALERTS ────────────────────────────────────────────────────────────────
    async function sendAlert(targetUid, note) {
        return api(`/alerts/${targetUid}`, { method:'POST', body: JSON.stringify({note}) });
    }
    async function getAlerts(uid) { return api(`/alerts/${uid}`); }

    // ── REPORTS ───────────────────────────────────────────────────────────────
    async function reportPost(postId, reason) {
        return api(`/reports/${postId}`, { method:'POST', body: JSON.stringify({reason}) });
    }
    async function getReports() { return api('/reports') || []; }

    // ── ADMIN ─────────────────────────────────────────────────────────────────
    async function getStats()           { return api('/admin/stats'); }
    async function setRole(id, role)    { return updateProfile(id, { role }); }
    async function banUser(id)          { return updateProfile(id, { is_banned: 1 }); }
    async function unbanUser(id)        { return updateProfile(id, { is_banned: 0 }); }
    async function submitAdminRequest(req) {
        return api('/admin/requests', { method: 'POST', body: JSON.stringify(req) });
    }
    async function getPendingRequests() { return api('/admin/requests') || []; }
    async function reviewRequest(reqId, status) { return api(`/admin/requests/${reqId}`, { method:'PATCH', body: JSON.stringify({status}) }); }
    async function logAction()          { return null; }
    async function getModLogs()         { return []; }

    // Keep old name as alias for boot sequence
    async function sendMagicLink()      { return null; }

    return {
        register, login,
        handleCallback, restoreSession, signOut, getMe,
        getProfileStats, getPostsByUser, getAllUsers, updateProfile,
        getPosts, createPost, updatePost, deletePost,
        getComments, createComment, uploadImage,
        getStats, setRole, banUser, unbanUser,
        getConversations, getDMThread, sendDM, getUnreadCount,
        sendAlert, getAlerts, reportPost, getReports,
        submitAdminRequest, getPendingRequests, reviewRequest, logAction, getModLogs,
        sendMagicLink,
    };
})();
