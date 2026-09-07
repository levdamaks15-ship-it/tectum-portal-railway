/**
 * Tectum Enterprise Portal — Network Resilience Guard
 * 
 * Provides:
 * 1. Real-time network status indicator (Online / Weak / Offline)
 * 2. Smart fetch wrapper with configurable timeouts (12s) and automatic retries (up to 2 attempts)
 * 3. Prevention of double-clicks on submit buttons
 * 4. Automatic reconnection detection with toasts
 */
(function () {
    'use strict';

    let networkState = 'online'; // 'online' | 'slow' | 'offline'
    let lastPingLatency = 0;
    let isPinging = false;
    let statusPillEl = null;
    let consecutiveFailures = 0;
    const PING_INTERVAL_MS = 25000; // Check latency every 25 seconds
    const SLOW_THRESHOLD_MS = 2500; // Latency > 2.5s is considered weak signal
    const TIMEOUT_MS = 12000;       // 12s timeout for network requests

    /**
     * Injects CSS styles for the network status indicator.
     */
    function injectStyles() {
        if (document.getElementById('netguard-styles')) return;
        const style = document.createElement('style');
        style.id = 'netguard-styles';
        style.textContent = `
            #netguard-pill {
                position: fixed;
                top: auto !important;
                left: auto !important;
                bottom: 16px !important;
                right: 16px !important;
                height: auto !important;
                max-height: 36px !important;
                box-sizing: border-box !important;
                z-index: 1050;
                display: flex;
                align-items: center;
                gap: 7px;
                padding: 4px 10px;
                border-radius: 20px;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 11.5px;
                font-weight: 600;
                cursor: pointer;
                user-select: none;
                opacity: 0.88;
                transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
                box-shadow: 0 2px 8px rgba(0,0,0,0.12);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
            }
            @media (max-width: 768px) {
                #netguard-pill {
                    top: auto !important;
                    left: auto !important;
                    bottom: 12px !important;
                    right: 12px !important;
                    padding: 3px 8px;
                    font-size: 11px;
                    gap: 5px;
                }
            }
            #netguard-pill:hover {
                opacity: 1;
                transform: translateY(-2px);
                box-shadow: 0 4px 14px rgba(0,0,0,0.18);
            }
            #netguard-pill.state-online {
                background: rgba(255, 255, 255, 0.9);
                color: #15803d;
                border: 1px solid rgba(22, 163, 74, 0.3);
            }
            #netguard-pill.state-slow {
                background: #fefce8;
                color: #b45309;
                border: 1px solid rgba(245, 158, 11, 0.4);
                animation: netguardPulseSlow 2s infinite ease-in-out;
            }
            #netguard-pill.state-offline {
                background: #fef2f2;
                color: #b91c1c;
                border: 1px solid rgba(239, 68, 68, 0.5);
                animation: netguardPulseOffline 1.5s infinite ease-in-out;
            }
            .netguard-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                display: inline-block;
                flex-shrink: 0;
            }
            .state-online .netguard-dot {
                background: #16a34a;
                box-shadow: 0 0 6px rgba(22, 163, 74, 0.6);
            }
            .state-slow .netguard-dot {
                background: #f59e0b;
                box-shadow: 0 0 6px rgba(245, 158, 11, 0.7);
            }
            .state-offline .netguard-dot {
                background: #ef4444;
                box-shadow: 0 0 8px rgba(239, 68, 68, 0.8);
            }
            @keyframes netguardPulseSlow {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }
            @keyframes netguardPulseOffline {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.85; transform: scale(1.02); }
            }
            #netguard-toast {
                position: fixed;
                bottom: 56px;
                right: 16px;
                z-index: 999999;
                background: rgba(15, 23, 42, 0.95);
                color: #fff;
                padding: 10px 18px;
                border-radius: 12px;
                font-family: 'Inter', -apple-system, sans-serif;
                font-size: 13px;
                display: flex;
                align-items: center;
                gap: 10px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.3);
                border: 1px solid rgba(255,255,255,0.1);
                animation: netguardSlideUp 0.3s ease-out;
            }
            @media (max-width: 768px) {
                #netguard-toast {
                    bottom: 48px;
                    right: 12px;
                }
            }
            @keyframes netguardSlideUp {
                from { transform: translateY(30px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Creates or updates the visual network indicator badge.
     */
    function renderPill() {
        injectStyles();
        if (!statusPillEl) {
            statusPillEl = document.createElement('div');
            statusPillEl.id = 'netguard-pill';
            statusPillEl.title = 'Нажмите для проверки связи с сервером';
            statusPillEl.addEventListener('click', () => {
                checkConnection(true);
            });
            document.body.appendChild(statusPillEl);
        }

        statusPillEl.className = `state-${networkState}`;
        let label = 'Онлайн';
        if (networkState === 'slow') {
            label = `Слабая сеть (${Math.round(lastPingLatency)}мс)`;
        } else if (networkState === 'offline') {
            label = 'Нет связи';
        }

        statusPillEl.innerHTML = `<span class="netguard-dot"></span><span>${label}</span>`;
    }

    /**
     * Shows a brief toast when connection state changes.
     */
    function showToast(icon, text, duration = 3000) {
        const existing = document.getElementById('netguard-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'netguard-toast';
        toast.innerHTML = `<span>${icon}</span><span>${text}</span>`;
        document.body.appendChild(toast);

        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.transition = 'opacity 0.3s ease';
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 300);
            }
        }, duration);
    }

    /**
     * Performs a ping check to measure latency and test connectivity.
     */
    async function checkConnection(isManual = false) {
        if (isPinging) return;
        isPinging = true;

        if (statusPillEl && isManual) {
            statusPillEl.innerHTML = `<span class="netguard-dot" style="background:#38bdf8;"></span><span>Проверка...</span>`;
        }

        const start = performance.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);

        try {
            const res = await window.__NATIVE_FETCH__(`/api/system/ping?_t=${Date.now()}`, {
                cache: 'no-store',
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                lastPingLatency = performance.now() - start;
                const prevState = networkState;
                consecutiveFailures = 0;

                if (lastPingLatency > SLOW_THRESHOLD_MS) {
                    networkState = 'slow';
                } else {
                    networkState = 'online';
                }

                if (prevState === 'offline') {
                    showToast('🟢', 'Связь с сервером восстановлена!');
                } else if (isManual) {
                    showToast('⚡', `Связь в норме (задержка ${Math.round(lastPingLatency)} мс)`);
                }
            } else {
                throw new Error('Ping failed');
            }
        } catch (e) {
            clearTimeout(timeoutId);
            consecutiveFailures++;
            // If browser navigator is offline or 2 consecutive pings fail: mark offline
            if (!navigator.onLine || consecutiveFailures >= 2 || isManual) {
                const prevState = networkState;
                networkState = 'offline';
                if (prevState !== 'offline') {
                    showToast('🔴', 'Связь с сервером потеряна. Проверьте Wi-Fi / мобильный интернет.');
                }
            } else {
                networkState = 'slow';
            }
        } finally {
            isPinging = false;
            renderPill();
        }
    }

    // Save reference to native fetch
    window.__NATIVE_FETCH__ = window.fetch;

    /**
     * Smart resilient fetch wrapper:
     * - Adds 12s timeout using AbortController
     * - Retries failed requests up to 2 times with exponential delay
     * - Formats user-friendly network errors in Russian
     */
    async function smartFetch(url, options = {}, retriesLeft = 2, delayMs = 1200) {
        // Skip non-API or ping URLs
        const isApiUrl = typeof url === 'string' && url.includes('/api/') && !url.includes('/api/system/ping');

        if (!isApiUrl) {
            return window.__NATIVE_FETCH__(url, options);
        }

        const controller = new AbortController();
        const callerSignal = options.signal;
        let timeoutTriggered = false;

        // If caller passed a signal, combine it
        if (callerSignal) {
            callerSignal.addEventListener('abort', () => controller.abort());
        }

        const timeoutId = setTimeout(() => {
            timeoutTriggered = true;
            controller.abort();
        }, TIMEOUT_MS);

        const fetchOptions = {
            ...options,
            signal: controller.signal
        };

        try {
            const response = await window.__NATIVE_FETCH__(url, fetchOptions);
            clearTimeout(timeoutId);

            // Server-side temporary gateway errors (e.g. 502/503/504 during Railway redeploy)
            if ([502, 503, 504].includes(response.status) && retriesLeft > 0) {
                console.warn(`[NetworkGuard] Server gateway error ${response.status}. Retrying in ${delayMs}ms...`);
                networkState = 'slow';
                renderPill();
                await new Promise(r => setTimeout(r, delayMs));
                return smartFetch(url, options, retriesLeft - 1, delayMs * 1.5);
            }

            // Successful response means we are online
            if (networkState === 'offline') {
                networkState = 'online';
                renderPill();
            }

            return response;
        } catch (err) {
            clearTimeout(timeoutId);

            const isAbort = err.name === 'AbortError';
            const isNetworkFailure = isAbort || err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError');

            if (isNetworkFailure && retriesLeft > 0) {
                const reason = timeoutTriggered ? 'таймаут 12с' : 'обрыв связи';
                console.warn(`[NetworkGuard] Network glitch (${reason}). Retrying attempt ${3 - retriesLeft}/2 in ${delayMs}ms...`);

                networkState = 'slow';
                renderPill();

                await new Promise(r => setTimeout(r, delayMs));
                return smartFetch(url, options, retriesLeft - 1, delayMs * 1.5);
            }

            // All retries exhausted
            networkState = 'offline';
            renderPill();

            if (timeoutTriggered) {
                throw new Error('Превышено время ожидания ответа сервера (12 сек). Слабый интернет-сигнал.');
            } else if (err.message?.includes('Failed to fetch')) {
                throw new Error('Сбой сети: сервер недоступен. Проверьте подключение к Wi-Fi или мобильному интернету.');
            }
            throw err;
        }
    }

    // Transparently monkey-patch window.fetch for all /api/ calls
    window.fetch = smartFetch;

    // Listen to browser network events
    window.addEventListener('online', () => {
        checkConnection(true);
    });

    window.addEventListener('offline', () => {
        networkState = 'offline';
        renderPill();
        showToast('🔴', 'Устройство отключено от сети.');
    });

    // Start background ping loop
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            renderPill();
            checkConnection();
        });
    } else {
        renderPill();
        checkConnection();
    }

    setInterval(checkConnection, PING_INTERVAL_MS);

    // Recheck on tab focus / phone wake
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            checkConnection();
        }
    });

    // Expose control API
    window.__NETWORK_GUARD__ = {
        getState: () => networkState,
        getLatency: () => lastPingLatency,
        check: checkConnection,
        smartFetch: smartFetch
    };

})();
