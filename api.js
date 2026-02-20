// ============================================================
//  FindIt – API Client
//  Points to our own FastAPI backend on Hugging Face Spaces.
//  Replace API_URL with your actual HF Space URL once deployed.
// ============================================================

const API_URL = 'https://TiH0-findit-backend.hf.space';

const sb = (() => {
    let _token = localStorage.getItem('fi_token') || null;

    function authHeaders() {
        const h = { 'Content-Type': 'application/json' };
        if (_token) h['Authorization'] = `Bearer ${_token}`;
        return h;
    }

    async function api(path, opts = {}) {
        try {
            const r = await fetch(`${API_URL}${path}`, {
                ...opts,
                headers: { ...authHeaders(), ...(opts.headers || {}) },
            });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                console.error('API error', r.status, path, err);
                return null;
            }
            const text = await r.text();
            return text ? JSON.parse(text) : true;
        } catch(e) {
            console.error('API fetch error', path, e);
            return null;
        }
    }

    // ── AUTH ──────────────────────────────────────────────────────────────────

    // Step 1: ask server for a code — returns {code, expires_in}
    async function requestOtp(email) {
        return api('/auth/request-otp', {
            method: 'POST',
            body: JSON.stringify({ email }),
        });
    }

    // Step 2: verify code — returns {token, profile}
    async function verifyOtp(email, code) {
        const res = await api('/auth/verify-otp', {
            method: 'POST',
            body: JSON.stringify({ email, code }),
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
        if (!res) { _token = null; localStorage.removeItem('fi_token'); return null; }
        return res; // {profile}
    }

    // No URL hash callback needed anymore
    async function handleCallback() {
        return restoreSession();
    }

    async function signOut() {
        await api('/auth/logout', { method: 'POST' });
        _token = null;
        localStorage.removeItem('fi_token');
    }

    // ── PROFILES ──────────────────────────────────────────────────────────────
    async function getMe() {
        const res = await api('/auth/me');
        return res; // {profile}
    }

    async function getProfileStats(uid) {
        return api(`/profiles/${uid}/stats`);
    }

    async function getPostsByUser(uid) {
        return api(`/profiles/${uid}/posts`);
    }

    async function getAllUsers() {
        return api('/admin/users') || [];
    }

    async function updateProfile(id, fields) {
        return api(`/admin/profiles/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(fields),
        });
    }

    // ── POSTS ─────────────────────────────────────────────────────────────────
    async function getPosts() {
        return api('/posts') || [];
    }

    async function createPost(fields) {
        const res = await api('/posts', {
            method: 'POST',
            body: JSON.stringify(fields),
        });
        return res ? [res] : null; // wrap in array to match old Supabase shape
    }

    async function updatePost(id, fields) {
        return api(`/posts/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(fields),
        });
    }

    async function deletePost(id) {
        return api(`/posts/${id}`, { method: 'DELETE' });
    }

    // ── COMMENTS ──────────────────────────────────────────────────────────────
    async function getComments(postId) {
        return api(`/posts/${postId}/comments`) || [];
    }

    async function createComment(postId, body, parentId = null, imageUrl = null) {
        const payload = { body };
        if (parentId)  payload.parent_id  = parentId;
        if (imageUrl)  payload.image_url  = imageUrl;
        return api(`/posts/${postId}/comments`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }

    // ── IMAGES ────────────────────────────────────────────────────────────────
    // Takes a base64 dataUrl, uploads as multipart, returns public URL string
    async function uploadImage(dataUrl, folder = 'posts') {
        const [meta, b64] = dataUrl.split(',');
        const mime = meta.match(/:(.*?);/)[1];
        const ext  = mime.split('/')[1].replace('jpeg','jpg');
        const bin  = atob(b64);
        const arr  = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const blob = new Blob([arr], { type: mime });
        const form = new FormData();
        form.append('file', blob, `upload.${ext}`);
        try {
            const r = await fetch(`${API_URL}/upload`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${_token}` },
                body: form,
            });
            if (!r.ok) { console.error('Upload failed', r.status); return null; }
            const data = await r.json();
            // Return full absolute URL
            return `${API_URL}${data.url}`;
        } catch(e) {
            console.error('Upload error', e); return null;
        }
    }

    // ── ADMIN ─────────────────────────────────────────────────────────────────
    async function getStats() {
        return api('/admin/stats');
    }

    async function setRole(userId, role) { return updateProfile(userId, { role }); }
    async function banUser(userId)        { return updateProfile(userId, { is_banned: 1 }); }
    async function unbanUser(userId)      { return updateProfile(userId, { is_banned: 0 }); }

    async function submitAdminRequest(req) {
        return api('/admin/requests', { method: 'POST', body: JSON.stringify(req) });
    }

    // Stubs to avoid errors if admin.js calls these
    async function getPendingRequests() { return []; }
    async function reviewRequest()      { return null; }
    async function logAction()          { return null; }
    async function getModLogs()         { return []; }

    return {
        requestOtp, verifyOtp,
        handleCallback, restoreSession, signOut, getMe,
        getProfileStats, getPostsByUser, getAllUsers, updateProfile,
        getPosts, createPost, updatePost, deletePost,
        getComments, createComment,
        uploadImage,
        getStats, setRole, banUser, unbanUser,
        submitAdminRequest, getPendingRequests, reviewRequest, logAction, getModLogs,
    };
})();
