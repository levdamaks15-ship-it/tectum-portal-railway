/**
 * @canonical-pattern UniversalFluidToast
 * @established 2026-10-29
 * @description Universal Apple & Industrial Fluid Notification & Toast System for Tectum Portal.
 * Supports: Success, Error, Warning, Info, 2-tier typography, progress countdown,
 * hover-pause, swipe-to-dismiss, and backward-compatible showToast() wrapper.
 */

(function (window) {
    'use strict';

    // Inject Toast Styles once
    function injectStyles() {
        if (document.getElementById('tectum-toast-styles')) return;

        const css = `
            .tectum-toast-container {
                position: fixed;
                top: 24px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 100005;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 10px;
                pointer-events: none;
                width: 92%;
                max-width: 480px;
            }

            .tectum-toast {
                pointer-events: auto;
                position: relative;
                width: 100%;
                box-sizing: border-box;
                background: rgba(255, 255, 255, 0.94);
                backdrop-filter: blur(20px) saturate(180%);
                -webkit-backdrop-filter: blur(20px) saturate(180%);
                border: 1px solid rgba(226, 232, 240, 0.9);
                border-radius: 16px;
                padding: 12px 16px 14px 16px;
                box-shadow: 0 20px 40px -10px rgba(15, 23, 42, 0.18), 0 4px 12px rgba(0, 0, 0, 0.05);
                display: flex;
                align-items: flex-start;
                gap: 12px;
                overflow: hidden;
                user-select: none;
                touch-action: pan-y;
                animation: tectumToastSpringDrop 0.42s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                transition: opacity 0.24s ease, transform 0.24s ease;
            }

            @keyframes tectumToastSpringDrop {
                0% {
                    opacity: 0;
                    transform: translateY(-24px) scale(0.96);
                }
                60% {
                    transform: translateY(3px) scale(1.01);
                }
                100% {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }

            .tectum-toast.hide {
                opacity: 0 !important;
                transform: translateY(-18px) scale(0.95) !important;
            }

            /* Icon Beacon */
            .tectum-toast-icon-wrap {
                width: 36px;
                height: 36px;
                border-radius: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.15rem;
                flex-shrink: 0;
                margin-top: 2px;
            }

            /* Variant Theme Accents */
            .tectum-toast-success .tectum-toast-icon-wrap {
                background: #ecfdf5;
                color: #10b981;
                border: 1px solid #a7f3d0;
            }
            .tectum-toast-error .tectum-toast-icon-wrap {
                background: #fef2f2;
                color: #ef4444;
                border: 1px solid #fecaca;
            }
            .tectum-toast-warning .tectum-toast-icon-wrap {
                background: #fffbeb;
                color: #f59e0b;
                border: 1px solid #fde68a;
            }
            .tectum-toast-info .tectum-toast-icon-wrap {
                background: #eff6ff;
                color: #2563eb;
                border: 1px solid #bfdbfe;
            }

            /* Content Body */
            .tectum-toast-body {
                flex: 1;
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .tectum-toast-title {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 0.92rem;
                font-weight: 700;
                color: #0f172a;
                line-height: 1.35;
                word-break: break-word;
            }

            .tectum-toast-message {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 0.8rem;
                color: #64748b;
                line-height: 1.35;
                word-break: break-word;
            }

            /* Action button */
            .tectum-toast-action-btn {
                background: #f1f5f9;
                border: 1px solid #cbd5e1;
                color: #1e293b;
                border-radius: 8px;
                padding: 4px 10px;
                font-size: 0.78rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.15s ease;
                white-space: nowrap;
                align-self: center;
            }
            .tectum-toast-action-btn:hover {
                background: #e2e8f0;
                color: #0f172a;
            }

            /* Close Button */
            .tectum-toast-close {
                background: transparent;
                border: none;
                color: #94a3b8;
                font-size: 1.1rem;
                line-height: 1;
                cursor: pointer;
                padding: 2px 4px;
                border-radius: 6px;
                align-self: flex-start;
                margin-top: 1px;
                transition: color 0.15s ease;
            }
            .tectum-toast-close:hover {
                color: #0f172a;
            }

            /* Progress Bar */
            .tectum-toast-progress {
                position: absolute;
                bottom: 0;
                left: 0;
                height: 3px;
                width: 100%;
                background: rgba(0, 0, 0, 0.05);
            }
            .tectum-toast-progress-bar {
                height: 100%;
                width: 100%;
                transform-origin: left center;
                transition: transform linear;
            }
            .tectum-toast-success .tectum-toast-progress-bar { background: #10b981; }
            .tectum-toast-error .tectum-toast-progress-bar { background: #ef4444; }
            .tectum-toast-warning .tectum-toast-progress-bar { background: #f59e0b; }
            .tectum-toast-info .tectum-toast-progress-bar { background: #2563eb; }

            /* Mobile adjustment */
            @media screen and (max-width: 600px) {
                .tectum-toast-container {
                    top: 16px;
                    width: 95%;
                }
                .tectum-toast {
                    padding: 10px 14px 12px 14px;
                    border-radius: 14px;
                }
            }
        `;

        const styleEl = document.createElement('style');
        styleEl.id = 'tectum-toast-styles';
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
    }

    // Ensure container exists
    function getContainer() {
        injectStyles();
        let container = document.getElementById('tectum-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'tectum-toast-container';
            container.className = 'tectum-toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    const ICONS = {
        success: 'fa-solid fa-circle-check',
        error: 'fa-solid fa-circle-xmark',
        warning: 'fa-solid fa-triangle-exclamation',
        info: 'fa-solid fa-circle-info'
    };

    class ToastManager {
        show(options) {
            let config = {
                type: 'info',
                title: '',
                message: '',
                duration: 3000,
                actionText: '',
                onAction: null,
                icon: ''
            };

            if (typeof options === 'string') {
                config.title = options;
            } else if (typeof options === 'object' && options !== null) {
                config = { ...config, ...options };
            }

            const type = ['success', 'error', 'warning', 'info'].includes(config.type) ? config.type : 'info';
            const iconClass = config.icon || ICONS[type];
            const duration = config.duration || 3000;

            const container = getContainer();

            // Create Toast element
            const toastEl = document.createElement('div');
            toastEl.className = `tectum-toast tectum-toast-${type}`;

            let actionBtnHtml = '';
            if (config.actionText && typeof config.onAction === 'function') {
                actionBtnHtml = `<button type="button" class="tectum-toast-action-btn">${escapeHtml(config.actionText)}</button>`;
            }

            const hasSubtitle = !!config.message;

            toastEl.innerHTML = `
                <div class="tectum-toast-icon-wrap">
                    <i class="${iconClass}"></i>
                </div>
                <div class="tectum-toast-body">
                    <div class="tectum-toast-title">${escapeHtml(config.title)}</div>
                    ${hasSubtitle ? `<div class="tectum-toast-message">${escapeHtml(config.message)}</div>` : ''}
                </div>
                ${actionBtnHtml}
                <button type="button" class="tectum-toast-close" title="Закрыть">&times;</button>
                <div class="tectum-toast-progress">
                    <div class="tectum-toast-progress-bar"></div>
                </div>
            `;

            // Progress Bar Animation
            const progressBar = toastEl.querySelector('.tectum-toast-progress-bar');
            let remainingTime = duration;
            let startTime = Date.now();
            let isPaused = false;
            let timeoutId = null;

            function startTimer() {
                if (progressBar) {
                    progressBar.style.transition = `transform ${remainingTime}ms linear`;
                    progressBar.style.transform = 'scaleX(0)';
                }
                startTime = Date.now();
                timeoutId = setTimeout(() => {
                    dismiss();
                }, remainingTime);
            }

            function pauseTimer() {
                if (isPaused) return;
                isPaused = true;
                clearTimeout(timeoutId);
                const elapsed = Date.now() - startTime;
                remainingTime = Math.max(remainingTime - elapsed, 100);
                if (progressBar) {
                    const currentScale = remainingTime / duration;
                    progressBar.style.transition = 'none';
                    progressBar.style.transform = `scaleX(${currentScale})`;
                }
            }

            function resumeTimer() {
                if (!isPaused) return;
                isPaused = false;
                startTimer();
            }

            function dismiss() {
                clearTimeout(timeoutId);
                toastEl.classList.add('hide');
                setTimeout(() => {
                    if (toastEl.parentNode) toastEl.remove();
                }, 260);
            }

            // Event Listeners
            toastEl.addEventListener('mouseenter', pauseTimer);
            toastEl.addEventListener('mouseleave', resumeTimer);

            // Close button
            const closeBtn = toastEl.querySelector('.tectum-toast-close');
            if (closeBtn) closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dismiss();
            });

            // Action button
            if (config.actionText && config.onAction) {
                const btn = toastEl.querySelector('.tectum-toast-action-btn');
                if (btn) btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    config.onAction();
                    dismiss();
                });
            }

            // Swipe to dismiss
            let startY = 0;
            toastEl.addEventListener('touchstart', (e) => {
                pauseTimer();
                startY = e.touches[0].clientY;
            }, { passive: true });

            toastEl.addEventListener('touchend', (e) => {
                resumeTimer();
                const diffY = e.changedTouches[0].clientY - startY;
                if (diffY < -30) {
                    dismiss();
                }
            }, { passive: true });

            container.appendChild(toastEl);
            startTimer();

            return { dismiss };
        }

        success(title, message = '', duration = 3000) {
            return this.show({ type: 'success', title, message, duration });
        }

        error(title, message = '', duration = 4000) {
            return this.show({ type: 'error', title, message, duration });
        }

        warning(title, message = '', duration = 3500) {
            return this.show({ type: 'warning', title, message, duration });
        }

        info(title, message = '', duration = 3000) {
            return this.show({ type: 'info', title, message, duration });
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    const toast = new ToastManager();
    window.toast = toast;

    // Backward-compatible global showToast function
    window.showToast = function (titleOrMsg, type = 'success', subtitle = '') {
        let actualType = 'success';
        if (typeof type === 'string' && ['success', 'error', 'warning', 'info'].includes(type.toLowerCase())) {
            actualType = type.toLowerCase();
        } else if (typeof titleOrMsg === 'string') {
            const lower = titleOrMsg.toLowerCase();
            if (lower.includes('ошибка') || lower.includes('неверн') || lower.includes('сбой')) {
                actualType = 'error';
            } else if (lower.includes('внимание') || lower.includes('заполните') || lower.includes('укажите')) {
                actualType = 'warning';
            }
        }
        return toast.show({
            type: actualType,
            title: titleOrMsg,
            message: subtitle,
            duration: actualType === 'error' ? 4000 : 3000
        });
    };

})(window);

