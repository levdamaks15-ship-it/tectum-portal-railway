/**
 * Tectum Enterprise Portal — Deployment Guard & Live Version Guard
 * 
 * 1. Automatically detects backend deployments / container rebuilds on Railway.
 * 2. Blocks the UI with a non-dismissible, responsive fullscreen overlay during maintenance.
 * 3. Safely preserves active form drafts in localStorage before reloading.
 * 4. Resumes automatically with a fresh cache-busted reload as soon as the new server version is live.
 */
(function () {
    'use strict';

    let currentVersion = null;
    let newVersionDetected = null;
    let isChecking = false;
    let isDeploying = false;
    let consecutiveFailures = 0;
    let fastPollInterval = null;
    let bannerElement = null;
    let overlayElement = null;
    let countdownInterval = null;
    let busyWatcherInterval = null;
    let retryCount = 0;

    const CHECK_INTERVAL_MS = 15000; // Check every 15s in normal mode
    const FAST_POLL_INTERVAL_MS = 2000; // Check every 2s during deployment

    const originalFetch = window.fetch ? window.fetch.bind(window) : null;

    /**
     * Intercepts fetch calls to detect Railway 502/503 gateway drops during deployments.
     */
    if (window.fetch && originalFetch) {
        window.fetch = async function (...args) {
            try {
                const response = await originalFetch.apply(this, args);
                const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
                if (url.includes('/api/')) {
                    if (response.status === 502 || response.status === 503 || response.status === 504) {
                        handleDeploymentDetected('gateway_error');
                    }
                }
                return response;
            } catch (err) {
                // Client network glitches are handled by NetworkGuard, do not trigger deployment overlay
                throw err;
            }
        };
    }

    /**
     * Safely saves active form drafts to localStorage so no user input is lost.
     */
    function saveActiveFormDraft() {
        try {
            const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="button"]):not([type="submit"]), textarea, select');
            const draft = {};
            let hasData = false;

            inputs.forEach(inp => {
                const id = inp.id || inp.name;
                if (!id) return;
                if (inp.type === 'checkbox' || inp.type === 'radio') {
                    draft[id] = inp.checked;
                    hasData = true;
                } else if (inp.value && inp.value.trim() !== '') {
                    draft[id] = inp.value;
                    hasData = true;
                }
            });

            if (hasData) {
                localStorage.setItem('__tectum_deployment_draft__', JSON.stringify({
                    url: window.location.pathname,
                    timestamp: Date.now(),
                    fields: draft
                }));
            }
        } catch (e) {
            console.warn('[DeploymentGuard] Draft save skipped:', e);
        }
    }

    /**
     * Restores saved draft on page reload if available and fresh (< 15 mins).
     */
    function restoreActiveFormDraft() {
        try {
            const raw = localStorage.getItem('__tectum_deployment_draft__');
            if (!raw) return;
            const draft = JSON.parse(raw);
            if (draft.url !== window.location.pathname) return;
            if (Date.now() - draft.timestamp > 15 * 60 * 1000) {
                localStorage.removeItem('__tectum_deployment_draft__');
                return;
            }

            setTimeout(() => {
                const fields = draft.fields || {};
                let restored = 0;
                Object.keys(fields).forEach(id => {
                    const el = document.getElementById(id) || document.querySelector(`[name="${id}"]`);
                    if (el && !el.readOnly && !el.disabled) {
                        if (el.type === 'checkbox' || el.type === 'radio') {
                            el.checked = fields[id];
                        } else {
                            el.value = fields[id];
                            // Trigger input event for auto-calculating fields
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                        restored++;
                    }
                });
                if (restored > 0) {
                    console.log(`[DeploymentGuard] Restored ${restored} form fields from pre-deployment draft.`);
                }
                localStorage.removeItem('__tectum_deployment_draft__');
            }, 600);
        } catch (e) {
            console.warn('[DeploymentGuard] Draft restore error:', e);
        }
    }

    /**
     * Checks if the user is currently editing data or has active modal forms open.
     */
    function isUserBusy() {
        if (window.__IS_SAVING_FORM__ || window.__HAS_UNSAVED_CHANGES__) {
            return true;
        }

        const modalSelectors = [
            '.modal-centered',
            '.modal-overlay-fade',
            '#shift-modal',
            '#dt-modal',
            '#edit-dt-modal',
            '#task-detail-modal',
            '#quick-create-modal',
            '#task-edit-modal',
            '#checklist-modal'
        ];

        for (const sel of modalSelectors) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
                if (el.id === 'version-guard-banner' || el.id === 'deployment-guard-overlay') continue;
                const style = window.getComputedStyle(el);
                if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0.1) {
                    return true;
                }
            }
        }

        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
            if (active.type !== 'button' && active.type !== 'submit') {
                return true;
            }
        }

        return false;
    }

    /**
     * Performs a fresh reload with cache-busting parameters, CacheStorage purge, and script pre-revalidation.
     */
    async function triggerReload(targetVer) {
        saveActiveFormDraft();
        const ver = targetVer || newVersionDetected || Date.now().toString();

        // 1. Purge modern browser CacheStorage (PWA / Service Worker caches)
        try {
            if (typeof window !== 'undefined' && 'caches' in window) {
                const keys = await window.caches.keys();
                await Promise.all(keys.map(k => window.caches.delete(k)));
                console.log('[DeploymentGuard] Purged browser CacheStorage.');
            }
        } catch (e) {
            console.warn('[DeploymentGuard] Cache purge skipped:', e);
        }

        // 2. Pre-fetch currently loaded scripts and styles with { cache: 'reload' } to bypass browser disk cache
        try {
            const staticElements = document.querySelectorAll('script[src], link[rel="stylesheet"]');
            const preloads = [];
            staticElements.forEach(el => {
                const src = el.src || el.href;
                if (src && (src.includes('/static/') || src.includes('.js') || src.includes('.css'))) {
                    try {
                        const assetUrl = new URL(src, window.location.origin);
                        // Only preload same-origin assets to avoid CORS errors with external CDNs (FontAwesome, Google Fonts, etc.)
                        if (assetUrl.origin === window.location.origin) {
                            assetUrl.searchParams.set('v', ver);
                            assetUrl.searchParams.set('_t', Date.now().toString());
                            preloads.push(
                                fetch(assetUrl.toString(), {
                                    method: 'GET',
                                    cache: 'reload',
                                    headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' }
                                }).catch(() => {})
                            );
                        }
                    } catch (_) {}
                }
            });
            if (preloads.length > 0) {
                // Wait up to 600ms for background revalidation
                await Promise.race([
                    Promise.all(preloads),
                    new Promise(resolve => setTimeout(resolve, 600))
                ]);
            }
        } catch (e) {
            console.warn('[DeploymentGuard] Preload cache bypass skipped:', e);
        }

        // 3. Final Hard Navigation via window.location.replace with version and timestamp
        try {
            const url = new URL(window.location.href);
            url.searchParams.set('v', ver);
            url.searchParams.set('_deploy', Date.now().toString());
            window.location.replace(url.toString());
        } catch (e) {
            window.location.reload();
        }
    }

    /**
     * Creates and displays the non-dismissible fullscreen deployment overlay.
     */
    function showDeploymentOverlay() {
        if (overlayElement) return;

        saveActiveFormDraft();

        overlayElement = document.createElement('div');
        overlayElement.id = 'deployment-guard-overlay';
        overlayElement.innerHTML = `
            <style>
                #deployment-guard-overlay {
                    position: fixed !important;
                    inset: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    background: rgba(10, 15, 29, 0.96) !important;
                    backdrop-filter: blur(20px) !important;
                    -webkit-backdrop-filter: blur(20px) !important;
                    z-index: 2147483647 !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    padding: 24px !important;
                    box-sizing: border-box !important;
                    touch-action: none !important;
                    overscroll-behavior: none !important;
                    user-select: none !important;
                    -webkit-user-select: none !important;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                    animation: dgFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
                }
                @keyframes dgFadeIn {
                    from { opacity: 0; transform: scale(0.98); }
                    to { opacity: 1; transform: scale(1); }
                }
                .dg-card {
                    background: rgba(26, 34, 52, 0.85) !important;
                    border: 1.5px solid rgba(200, 35, 35, 0.4) !important;
                    border-radius: 28px !important;
                    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08) !important;
                    padding: 40px 32px !important;
                    max-width: 480px !important;
                    width: 100% !important;
                    text-align: center !important;
                    color: #ffffff !important;
                    box-sizing: border-box !important;
                    position: relative !important;
                }
                .dg-icon-wrapper {
                    position: relative !important;
                    width: 84px !important;
                    height: 84px !important;
                    margin: 0 auto 24px auto !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                }
                .dg-icon-bg {
                    position: absolute !important;
                    inset: 0 !important;
                    border-radius: 50% !important;
                    background: radial-gradient(circle, rgba(200,35,35,0.3) 0%, rgba(200,35,35,0.05) 70%) !important;
                    animation: dgPulseRing 2.4s infinite ease-out !important;
                }
                @keyframes dgPulseRing {
                    0% { transform: scale(0.85); opacity: 0.8; }
                    50% { transform: scale(1.25); opacity: 0.3; }
                    100% { transform: scale(0.85); opacity: 0.8; }
                }
                .dg-icon {
                    font-size: 42px !important;
                    position: relative !important;
                    z-index: 2 !important;
                    filter: drop-shadow(0 4px 12px rgba(200,35,35,0.6)) !important;
                    animation: dgRocketFloat 2s ease-in-out infinite !important;
                }
                @keyframes dgRocketFloat {
                    0%, 100% { transform: translateY(0) rotate(0deg); }
                    50% { transform: translateY(-6px) rotate(4deg); }
                }
                .dg-title {
                    font-size: 22px !important;
                    font-weight: 700 !important;
                    letter-spacing: -0.4px !important;
                    margin: 0 0 12px 0 !important;
                    color: #ffffff !important;
                }
                .dg-desc {
                    font-size: 14px !important;
                    line-height: 1.55 !important;
                    color: #94a3b8 !important;
                    margin: 0 0 28px 0 !important;
                }
                .dg-status-box {
                    background: rgba(15, 23, 42, 0.7) !important;
                    border: 1px solid rgba(255, 255, 255, 0.1) !important;
                    border-radius: 16px !important;
                    padding: 14px 18px !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    gap: 12px !important;
                    font-size: 13.5px !important;
                    font-weight: 600 !important;
                    color: #e2e8f0 !important;
                }
                .dg-spinner {
                    width: 18px !important;
                    height: 18px !important;
                    border: 2.5px solid rgba(200, 35, 35, 0.3) !important;
                    border-top-color: #ef4444 !important;
                    border-radius: 50% !important;
                    animation: dgSpin 0.8s linear infinite !important;
                    flex-shrink: 0 !important;
                }
                @keyframes dgSpin {
                    to { transform: rotate(360deg); }
                }
                .dg-badge {
                    display: inline-block !important;
                    background: rgba(200, 35, 35, 0.2) !important;
                    border: 1px solid rgba(200, 35, 35, 0.4) !important;
                    color: #fca5a5 !important;
                    font-size: 11px !important;
                    font-weight: 700 !important;
                    text-transform: uppercase !important;
                    letter-spacing: 0.8px !important;
                    padding: 4px 10px !important;
                    border-radius: 20px !important;
                    margin-bottom: 14px !important;
                }
            </style>
            <div class="dg-card">
                <div class="dg-badge">TECTUM SYSTEM UPDATE</div>
                <div class="dg-icon-wrapper">
                    <div class="dg-icon-bg"></div>
                    <div class="dg-icon" id="dg-main-icon">🚀</div>
                </div>
                <h2 class="dg-title" id="dg-main-title">Идет обновление портала</h2>
                <p class="dg-desc" id="dg-main-desc">
                    Сервер применяет новый коммит. Во избежание рассинхронизации данных работа временно приостановлена.<br><br>
                    <b>Пожалуйста, не закрывайте страницу</b> — система подключится и обновится автоматически сразу после старта контейнера.
                </p>
                <div class="dg-status-box" id="dg-status-box">
                    <div class="dg-spinner" id="dg-spinner"></div>
                    <span id="dg-status-text">Ожидание готовности сервера...</span>
                </div>
            </div>
        `;

        document.body.appendChild(overlayElement);
        document.body.style.overflow = 'hidden';

        // Trap key presses
        window.addEventListener('keydown', blockUserInteraction, true);
    }

    function blockUserInteraction(e) {
        if (isDeploying) {
            e.stopImmediatePropagation();
            e.preventDefault();
            return false;
        }
    }

    /**
     * Handles detected deployment or downtime.
     */
    function handleDeploymentDetected(reason) {
        if (isDeploying) return;
        isDeploying = true;
        console.log(`[DeploymentGuard] Deployment detected (${reason}). Activating lock screen...`);

        showDeploymentOverlay();

        // Start fast polling loop
        if (fastPollInterval) clearInterval(fastPollInterval);
        fastPollInterval = setInterval(checkServerRecovery, FAST_POLL_INTERVAL_MS);
    }

    /**
     * Fast polling loop during deployment.
     */
    async function checkServerRecovery() {
        retryCount++;
        const statusText = document.getElementById('dg-status-text');
        if (statusText) {
            statusText.innerText = `Проверка запуска сервера (попытка ${retryCount})...`;
        }

        try {
            const fetchFn = originalFetch || window.fetch;
            const res = await fetchFn(`/api/system/version?_=${Date.now()}`, {
                cache: 'no-store',
                headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' }
            });

            if (res.ok) {
                const data = await res.json();
                const serverVer = data?.version;

                if (serverVer) {
                    console.log(`[DeploymentGuard] Server is back online! Version: ${serverVer}`);
                    clearInterval(fastPollInterval);
                    fastPollInterval = null;

                    // If we are already on the active version, dismiss overlay gracefully without loop reload
                    if (currentVersion && currentVersion === serverVer) {
                        if (overlayElement) {
                            overlayElement.remove();
                            overlayElement = null;
                        }
                        document.body.style.overflow = '';
                        isDeploying = false;
                        consecutiveFailures = 0;
                        window.removeEventListener('keydown', blockUserInteraction, true);
                        return;
                    }

                    // Update UI to success state
                    const icon = document.getElementById('dg-main-icon');
                    const title = document.getElementById('dg-main-title');
                    const desc = document.getElementById('dg-main-desc');
                    const spinner = document.getElementById('dg-spinner');
                    const status = document.getElementById('dg-status-text');

                    if (icon) icon.innerText = '✅';
                    if (title) title.innerText = 'Обновление успешно завершено!';
                    if (desc) desc.innerText = 'Сервер запущен и готов к работе. Применяем актуальную версию...';
                    if (spinner) spinner.style.display = 'none';
                    if (status) status.innerText = 'Загрузка обновленного интерфейса...';

                    setTimeout(() => {
                        triggerReload(serverVer);
                    }, 1000);
                }
            }
        } catch (e) {
            // Still waiting for container reboot
        }
    }

    /**
     * Normal version check loop.
     */
    async function checkForUpdates() {
        if (isChecking || isDeploying) return;
        isChecking = true;

        try {
            const fetchFn = originalFetch || window.fetch;
            const res = await fetchFn(`/api/system/version?_=${Date.now()}`, {
                cache: 'no-store',
                headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' }
            });

            if (res.status === 502 || res.status === 503 || res.status === 504) {
                consecutiveFailures++;
                if (consecutiveFailures >= 2) {
                    handleDeploymentDetected('server_gateway_error');
                }
                return;
            }

            if (!res.ok) {
                return;
            }

            const data = await res.json();
            const serverVer = data?.version;

            if (!serverVer) return;

            consecutiveFailures = 0;

            if (!currentVersion) {
                currentVersion = serverVer;
                console.log(`[VersionGuard] Initialized. App version: ${currentVersion}`);
            } else if (currentVersion !== serverVer) {
                onVersionChanged(serverVer);
            }
        } catch (err) {
            // Silently ignore network fluctuations; NetworkGuard handles offline toasts
        } finally {
            isChecking = false;
        }
    }

    /**
     * Handles detected new version when server is already live.
     */
    function onVersionChanged(newVer) {
        newVersionDetected = newVer;
        console.log(`[VersionGuard] New deployment detected: ${newVer} (current: ${currentVersion})`);

        if (isUserBusy()) {
            showUpdateBanner('busy');

            if (!busyWatcherInterval) {
                busyWatcherInterval = setInterval(() => {
                    if (!isUserBusy()) {
                        clearInterval(busyWatcherInterval);
                        busyWatcherInterval = null;
                        showUpdateBanner('countdown');
                    }
                }, 2000);
            }
        } else {
            showUpdateBanner('countdown');
        }
    }

    /**
     * Renders or updates the floating update notification banner.
     */
    function showUpdateBanner(mode) {
        if (!bannerElement) {
            bannerElement = document.createElement('div');
            bannerElement.id = 'version-guard-banner';
            bannerElement.innerHTML = `
                <style>
                    #version-guard-banner {
                        position: fixed;
                        top: 18px;
                        left: 50%;
                        transform: translateX(-50%);
                        z-index: 999999;
                        background: rgba(15, 23, 42, 0.96);
                        backdrop-filter: blur(12px);
                        -webkit-backdrop-filter: blur(12px);
                        border: 1px solid rgba(200, 35, 35, 0.45);
                        border-radius: 50px;
                        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05);
                        padding: 8px 16px 8px 12px;
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        color: #ffffff;
                        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                        font-size: 13.5px;
                        font-weight: 500;
                        animation: vgSlideDown 0.35s cubic-bezier(0.16, 1, 0.3, 1);
                        max-width: 92vw;
                        box-sizing: border-box;
                    }
                    @keyframes vgSlideDown {
                        from { transform: translate(-50%, -100%); opacity: 0; }
                        to { transform: translate(-50%, 0); opacity: 1; }
                    }
                    #vg-badge-icon {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        width: 30px;
                        height: 30px;
                        border-radius: 50%;
                        background: rgba(200, 35, 35, 0.25);
                        border: 1px solid rgba(200, 35, 35, 0.5);
                        font-size: 14px;
                        flex-shrink: 0;
                        animation: vgPulse 2s infinite ease-in-out;
                    }
                    @keyframes vgPulse {
                        0%, 100% { transform: scale(1); opacity: 0.9; }
                        50% { transform: scale(1.1); opacity: 1; filter: drop-shadow(0 0 6px rgba(200,35,35,0.8)); }
                    }
                    #vg-action-btn {
                        background: #C82323;
                        color: #ffffff;
                        border: none;
                        border-radius: 30px;
                        padding: 6px 14px;
                        font-size: 12.5px;
                        font-weight: 600;
                        cursor: pointer;
                        white-space: nowrap;
                        transition: all 0.2s ease;
                        box-shadow: 0 2px 8px rgba(200, 35, 35, 0.4);
                        flex-shrink: 0;
                    }
                    #vg-action-btn:hover {
                        background: #b01f1f;
                        transform: translateY(-1px);
                    }
                </style>
                <div id="vg-badge-icon">🚀</div>
                <div id="vg-message" style="line-height: 1.35;"></div>
                <button id="vg-action-btn">Обновить</button>
            `;
            document.body.appendChild(bannerElement);

            const btn = bannerElement.querySelector('#vg-action-btn');
            btn.addEventListener('click', function () {
                btn.disabled = true;
                btn.innerText = 'Обновление...';
                triggerReload(newVersionDetected);
            });
        }

        const msgEl = bannerElement.querySelector('#vg-message');
        const btn = bannerElement.querySelector('#vg-action-btn');

        if (mode === 'countdown') {
            let secondsLeft = 3;
            btn.innerText = 'Обновить сейчас';
            msgEl.innerHTML = `Портал обновлен! Применение через <b><span id="vg-timer">${secondsLeft}</span></b> сек...`;

            if (countdownInterval) clearInterval(countdownInterval);
            countdownInterval = setInterval(() => {
                secondsLeft--;
                const timerEl = bannerElement.querySelector('#vg-timer');
                if (timerEl) timerEl.innerText = secondsLeft;
                if (secondsLeft <= 0) {
                    clearInterval(countdownInterval);
                    triggerReload(newVersionDetected);
                }
            }, 1000);
        } else {
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            btn.innerText = 'Обновить сейчас';
            msgEl.innerHTML = `Вышло обновление портала. Завершите сохранение данных и нажмите «Обновить»`;
        }
    }

    // Initialize version check and restore draft
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            restoreActiveFormDraft();
            checkForUpdates();
        });
    } else {
        restoreActiveFormDraft();
        checkForUpdates();
    }

    // Periodic check
    setInterval(checkForUpdates, CHECK_INTERVAL_MS);

    // Instant check when user unlocks phone or switches back to portal tab
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            checkForUpdates();
        }
    });

    window.addEventListener('focus', () => {
        checkForUpdates();
    });

    // Expose control object for debugging / tests
    window.__DEPLOYMENT_GUARD__ = {
        check: checkForUpdates,
        getVersion: () => currentVersion,
        isBusy: isUserBusy,
        triggerOverlay: () => handleDeploymentDetected('manual_test'),
        simulateRecovery: (mockVer) => {
            if (fastPollInterval) clearInterval(fastPollInterval);
            const title = document.getElementById('dg-main-title');
            if (title) title.innerText = 'Обновление завершено (Тест)';
            setTimeout(() => triggerReload(mockVer || 'test_v2'), 1000);
        }
    };
})();
