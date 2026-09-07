/**
 * Tectum Enterprise Portal — Version Guard & Live Auto-Update
 * 
 * Automatically detects backend deployments on Railway / Git pushes
 * and safely refreshes open client tabs without disrupting active forms.
 */
(function () {
    'use strict';

    let currentVersion = null;
    let newVersionDetected = null;
    let isChecking = false;
    let bannerElement = null;
    let countdownInterval = null;
    let busyWatcherInterval = null;
    const CHECK_INTERVAL_MS = 45000; // Check every 45 seconds

    /**
     * Checks if the user is currently editing data or has active modal forms open.
     */
    function isUserBusy() {
        if (window.__IS_SAVING_FORM__ || window.__HAS_UNSAVED_CHANGES__) {
            return true;
        }

        // Check for visible modal dialogs
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
                // Ignore our own banner or closed elements
                if (el.id === 'version-guard-banner') continue;
                const style = window.getComputedStyle(el);
                if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0.1) {
                    return true;
                }
            }
        }

        // Check if user is typing in a form field
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
            if (active.type !== 'button' && active.type !== 'submit') {
                return true;
            }
        }

        return false;
    }

    /**
     * Performs a fresh reload with cache-busting parameters.
     */
    function triggerReload(targetVer) {
        try {
            const url = new URL(window.location.href);
            url.searchParams.set('v', targetVer || newVersionDetected || Date.now().toString());
            url.searchParams.set('_upd', Date.now().toString());
            window.location.replace(url.toString());
        } catch (e) {
            window.location.reload();
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
                    #vg-action-btn:active {
                        transform: translateY(0);
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
            // Busy mode: prompt user without auto-reloading yet
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            btn.innerText = 'Обновить сейчас';
            msgEl.innerHTML = `Вышло обновление портала. Завершите сохранение данных и нажмите «Обновить»`;
        }
    }

    /**
     * Handles detected new version. Decides whether to auto-reload or show busy prompt.
     */
    function onVersionChanged(newVer) {
        newVersionDetected = newVer;
        console.log(`[VersionGuard] New deployment detected: ${newVer} (current: ${currentVersion})`);

        if (isUserBusy()) {
            showUpdateBanner('busy');

            // Set up watcher to reload once user finishes editing
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
     * Queries server for active version.
     */
    async function checkForUpdates() {
        if (isChecking) return;
        isChecking = true;

        try {
            const res = await fetch(`/api/system/version?_=${Date.now()}`, {
                cache: 'no-store',
                headers: {
                    'Pragma': 'no-cache',
                    'Cache-Control': 'no-cache'
                }
            });

            if (!res.ok) {
                isChecking = false;
                return;
            }

            const data = await res.json();
            const serverVer = data?.version;

            if (!serverVer) {
                isChecking = false;
                return;
            }

            if (!currentVersion) {
                currentVersion = serverVer;
                console.log(`[VersionGuard] Initialized. App version: ${currentVersion}`);
            } else if (currentVersion !== serverVer) {
                onVersionChanged(serverVer);
            }
        } catch (err) {
            // Fail silently on transient network drops (e.g. factory Wi-Fi blips)
        } finally {
            isChecking = false;
        }
    }

    // Initialize version check
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkForUpdates);
    } else {
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
    window.__VERSION_GUARD__ = {
        check: checkForUpdates,
        getVersion: () => currentVersion,
        isBusy: isUserBusy,
        simulateNewVersion: (mockVer) => onVersionChanged(mockVer || 'test_v2')
    };
})();
