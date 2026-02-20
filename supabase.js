const SUPABASE_URL  = 'https://nmfacwqohumgrwdynbxk.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tZmFjd3FvaHVtZ3J3ZHluYnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1MDUwMjUsImV4cCI6MjA4NzA4MTAyNX0.RhgNuJDK3JBgVJ3wTZD5M6OYRBp-l7M34BKndvnN8GE';

const sb = (() => {
    let _token = localStorage.getItem('fi_token') || null;

    function headers(extra = {}) {
        return {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON,
            Authorization: `Bearer ${_token || SUPABASE_ANON}`,
            ...extra,
        };
    }

    async function api(path, opts = {}) {
        const r = await fetch(`${SUPABASE_URL}${path}`, {
            ...opts,
            headers: headers(opts.headers || {}),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            console.error('Supabase error', r.status, path, JSON.stringify(err));
            return null;
        }
        const text = await r.text();
        return text ? JSON.parse(text) : true;
    }

    // ── AUTH ──────────────────────────────────────────────────────────────────
    async function sendMagicLink(email) {
        try {
            console.log('Sending OTP to:', email, 'URL:', SUPABASE_URL);
            const r = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    apikey: SUPABASE_ANON,
                    Authorization: `Bearer ${SUPABASE_ANON}`,
                },
                body: JSON.stringify({ email, create_user: true }),
            });
            const text = await r.text();
            console.log('OTP response status:', r.status, 'body:', text);
            if (!r.ok) return null;
            return true;
        } catch(e) {
            console.error('sendMagicLink fetch error:', e);
            return null;
        }
    }

    async function handleCallback() {
        const hash = window.location.hash;
        if (!hash.includes('access_token')) return restoreSession();
        const p = new URLSearchParams(hash.replace(/^#/, ''));
        const token = p.get('access_token');
        if (!token) return restoreSession();
        _token = token;
        localStorage.setItem('fi_token', token);
        localStorage.setItem('fi_refresh', p.get('refresh_token') || '');
        window.history.replaceState(null, '', window.location.pathname);
        return getMe();
    }

    async function restoreSession() {
        if (!_token) return null;
        return getMe();
    }

    async function signOut() {
        await api('/auth/v1/logout', { method: 'POST' });
        _token = null;
        localStorage.removeItem('fi_token');
        localStorage.removeItem('fi_refresh');
    }

    // ── PROFILES ──────────────────────────────────────────────────────────────
    async function getMe() {
        const user = await api('/auth/v1/user');
        if (!user) return null;
        const rows = await api(`/rest/v1/profiles?id=eq.${user.id}&select=*`);
        if (!rows || !rows[0]) return null;
        return { auth: user, profile: rows[0] };
    }

    async function getAllUsers() {
        return api('/rest/v1/profiles?select=*&order=created_at.asc') || [];
    }

    async function updateProfile(id, fields) {
        return api(`/rest/v1/profiles?id=eq.${id}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(fields),
        });
    }

    // Returns real post count + points for a user
    async function getProfileStats(uid) {
        const [posts, comments] = await Promise.all([
            api(`/rest/v1/posts?author_id=eq.${uid}&is_deleted=eq.false&select=id`),
            api(`/rest/v1/comments?author_id=eq.${uid}&select=id`),
        ]);
        const postCount    = (posts    || []).length;
        const commentCount = (comments || []).length;
        return { postCount, commentCount, points: postCount * 50 + commentCount * 10 };
    }

    // Returns all posts by a user (for profile history)
    async function getPostsByUser(profileId) {
        return api(`/rest/v1/posts_with_author?author_id=eq.${profileId}&is_deleted=eq.false&order=created_at.desc`) || [];
    }

    // ── STORAGE ───────────────────────────────────────────────────────────────
    // Upload a base64 dataURL to Supabase Storage, return public URL
    async function uploadImage(dataUrl, folder = 'posts') {
        // Convert base64 to binary blob
        const [meta, b64] = dataUrl.split(',');
        const mime = meta.match(/:(.*?);/)[1];
        const ext  = mime.split('/')[1].replace('jpeg','jpg');
        const bin  = atob(b64);
        const arr  = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const blob = new Blob([arr], { type: mime });

        const filename = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

        const r = await fetch(`${SUPABASE_URL}/storage/v1/object/images/${filename}`, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_ANON,
                Authorization: `Bearer ${_token || SUPABASE_ANON}`,
                'Content-Type': mime,
                'x-upsert': 'true',
            },
            body: blob,
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            console.error('Storage upload error', r.status, err);
            return null;
        }
        return `${SUPABASE_URL}/storage/v1/object/public/images/${filename}`;
    }

    // ── POSTS ─────────────────────────────────────────────────────────────────
    async function getPosts() {
        return api('/rest/v1/posts_with_author?order=created_at.desc') || [];
    }

    async function createPost(fields) {
        return api('/rest/v1/posts', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(fields),
        });
    }

    async function updatePost(id, fields) {
        return api(`/rest/v1/posts?id=eq.${id}`, {
            method: 'PATCH',
            body: JSON.stringify(fields),
        });
    }

    async function deletePost(id) {
        return updatePost(id, { is_deleted: true });
    }

    // ── COMMENTS ──────────────────────────────────────────────────────────────
    // Fetch comments for a post, joined with author profile
    async function getComments(postId) {
        return api(
            `/rest/v1/comments?post_id=eq.${postId}&select=*,author:author_id(uid,name,initials,color)&order=created_at.asc`
        ) || [];
    }

    async function createComment(postId, body, parentId = null, imageUrl = null) {
        const payload = { post_id: postId, body };
        if (parentId) payload.parent_id = parentId;
        if (imageUrl) payload.image_url = imageUrl;
        return api('/rest/v1/comments', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(payload),
        });
    }

    // ── ADMIN REQUESTS ────────────────────────────────────────────────────────
    async function submitAdminRequest(req) {
        return api('/rest/v1/admin_requests', { method: 'POST', body: JSON.stringify(req) });
    }

    async function getPendingRequests() {
        return api('/rest/v1/pending_admin_requests') || [];
    }

    async function reviewRequest(id, status, reviewerId) {
        return api(`/rest/v1/admin_requests?id=eq.${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() }),
        });
    }

    // ── MODERATION ────────────────────────────────────────────────────────────
    async function setRole(userId, role)  { return updateProfile(userId, { role }); }
    async function banUser(userId)        { return updateProfile(userId, { is_banned: true }); }
    async function unbanUser(userId)      { return updateProfile(userId, { is_banned: false }); }

    async function logAction(adminId, action, targetUser, targetPost, note) {
        return api('/rest/v1/mod_logs', {
            method: 'POST',
            body: JSON.stringify({ admin_id: adminId, action, target_user: targetUser, target_post: targetPost, note }),
        });
    }

    async function getModLogs() {
        return api('/rest/v1/mod_logs?select=*,admin:admin_id(uid,name),target:target_user(uid,name)&order=created_at.desc&limit=150') || [];
    }

    // ── STATS ─────────────────────────────────────────────────────────────────
    async function getStats() {
        const [posts, profiles, pending] = await Promise.all([
            api('/rest/v1/posts?select=id,status&is_deleted=eq.false'),
            api('/rest/v1/profiles?select=id,role,is_banned'),
            api('/rest/v1/admin_requests?status=eq.pending&select=id'),
        ]);
        const p = posts || []; const pr = profiles || []; const rq = pending || [];
        return {
            totalPosts: p.length, activePosts: p.filter(x => x.status !== 'recovered').length,
            totalUsers: pr.length, bannedUsers: pr.filter(x => x.is_banned).length,
            admins: pr.filter(x => ['admin','super_admin'].includes(x.role)).length,
            pendingRequests: rq.length,
        };
    }

    return {
        sendMagicLink, handleCallback, restoreSession, signOut,
        getMe, getAllUsers, updateProfile, getProfileStats, getPostsByUser,
        uploadImage,
        getPosts, createPost, updatePost, deletePost,
        getComments, createComment,
        submitAdminRequest, getPendingRequests, reviewRequest,
        setRole, banUser, unbanUser, logAction, getModLogs, getStats,
    };
})();
