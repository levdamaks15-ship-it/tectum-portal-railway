/**
 * Tectum Enterprise - Universal Auth Gate
 * Protects internal modules from unauthorized access.
 * Redirects unauthenticated visitors to the canonical grand login screen on '/'.
 */
(function() {
    try {
        var storedAuth = localStorage.getItem('tectum_auth_user');
        var portalAuth = localStorage.getItem('tectum_portal_user');
        if (!storedAuth && !portalAuth) {
            var currentPath = window.location.pathname + window.location.search + window.location.hash;
            if (window.location.pathname !== '/' && window.location.pathname !== '/static/index.html') {
                window.location.replace('/?redirect=' + encodeURIComponent(currentPath));
                return;
            }
        }
    } catch (e) {
        // Storage sandbox fallback
    }

    // Background server session validation
    document.addEventListener('DOMContentLoaded', function() {
        fetch('/api/me/').then(function(res) {
            if (res.ok) return res.json();
            return { authenticated: false };
        }).then(function(data) {
            if (!data || !data.authenticated) {
                try {
                    localStorage.removeItem('tectum_auth_user');
                    localStorage.removeItem('tectum_portal_user');
                    localStorage.removeItem('tectum_current_user_name');
                } catch(e) {}
                var currentPath = window.location.pathname + window.location.search + window.location.hash;
                if (window.location.pathname !== '/' && window.location.pathname !== '/static/index.html') {
                    window.location.replace('/?redirect=' + encodeURIComponent(currentPath));
                }
            }
        }).catch(function() {
            // Offline tolerance: allow cached session when offline
        });
    });
})();

