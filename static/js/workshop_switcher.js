/**
 * Tectum Enterprise - Workshop Switcher Popover
 * @canonical-pattern WorkshopSwitcher
 * @established 2026-10-30
 * @version 20261105_canonical_v8
 * @description Единый сквозной переключатель производственных цехов завода Tectum.
 *              Полный визуальный и функциональный паритет с templates/core/base.html.
 */

(function () {
    'use strict';

    const ALLOWED_ROLES = ['admin', 'director', 'tech_director', 'production_head', 'technologist'];

    // Канонический реестр 5 цехов Tectum (Шымкент)
    const WORKSHOPS = [
        {
            id: 'xci',
            short_name: 'ХЦИ',
            name: 'цех хризотилцементных изделий',
            badge_class: 'badge-shop-xci',
            url: '/p/shymkent/w/xci/shifts'
        },
        {
            id: 'agb',
            short_name: 'АГБ',
            name: 'цех автоклавного газобетона',
            badge_class: 'badge-shop-agb',
            url: '/p/shymkent/w/agb/shifts'
        },
        {
            id: 'lkc',
            short_name: 'ЛКЦ',
            name: 'лакокрасочный цех',
            badge_class: 'badge-shop-lkc',
            url: '/p/shymkent/w/lkc/shifts'
        },
        {
            id: 'stmo',
            short_name: 'СТМО',
            name: 'цех СТМО',
            badge_class: 'badge-shop-stmo',
            url: '/p/shymkent/w/stmo/shifts'
        },
        {
            id: 'skk',
            short_name: 'СКК',
            name: 'служба контроля качества',
            badge_class: 'badge-shop-skk',
            url: '/p/shymkent/w/skk/shifts'
        }
    ];

    function getCurrentWorkshopId() {
        const path = window.location.pathname.toLowerCase();
        if (path.includes('/w/lkc') || path.includes('/lkc')) return 'lkc';
        if (path.includes('/w/skk') || path.includes('/w/qcd') || path.includes('/skk') || path.includes('/qcd')) return 'skk';
        if (path.includes('/w/agb') || path.includes('/agb')) return 'agb';
        if (path.includes('/w/stmo') || path.includes('/stmo')) return 'stmo';
        return 'xci';
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

    class CanonicalWorkshopSwitcher {
        constructor() {
            this.currentUser = null;
            this.triggerEl = null;
            this.popoverEl = null;
            this.isOpen = false;
            this.isMounted = false;
            this.init();
        }

        init() {
            document.addEventListener('click', (e) => {
                if (this.isOpen && this.popoverEl) {
                    const isClickInside = this.popoverEl.contains(e.target);
                    const isClickOnTrigger = this.triggerEl && (this.triggerEl === e.target || this.triggerEl.contains(e.target));
                    if (!isClickInside && !isClickOnTrigger) {
                        this.close();
                    }
                }
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.isOpen) {
                    this.close();
                }
            });

            window.addEventListener('resize', () => {
                if (this.isOpen) this.updatePosition();
            });

            window.addEventListener('scroll', () => {
                if (this.isOpen) this.updatePosition();
            }, true);

            // На экране логина никогда не монтируем из localStorage
            if (this.isLoginScreen()) {
                this.dismantle();
                return;
            }

            // Читаем текущего пользователя из localStorage только вне экрана логина
            try {
                const stored = localStorage.getItem('tectum_auth_user');
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed && ALLOWED_ROLES.includes(parsed.role)) {
                        this.currentUser = parsed;
                        this.mount();
                    }
                }
            } catch (e) { }

            this.verifyServerSession();
        }

        isLoginScreen() {
            if (document.body.classList.contains('not-authenticated')) return true;
            if (window.location.search && window.location.search.includes('unauthorized')) return true;
            const loginScreen = document.getElementById('login-screen');
            if (loginScreen && window.getComputedStyle(loginScreen).display !== 'none') return true;
            return false;
        }

        async verifyServerSession() {
            if (this.isLoginScreen()) {
                this.currentUser = null;
                this.dismantle();
                return;
            }

            try {
                const res = await fetch('/api/me/');
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.authenticated && data.user && ALLOWED_ROLES.includes(data.user.role)) {
                        this.currentUser = data.user;
                        this.mount();
                        return;
                    }
                }
            } catch (e) { }

            // Сессия не подтверждена или роль не разрешена: аппаратный сброс и демонтаж
            this.currentUser = null;
            try {
                localStorage.removeItem('tectum_auth_user');
            } catch (e) { }
            this.dismantle();
        }

        findTriggerBadge() {
            let badge = document.getElementById('header-shop-badge');
            if (badge) return badge;
            badge = document.querySelector('.header-brand-left .brand-badge-shop');
            if (badge) return badge;
            return document.querySelector('.brand-badge-shop');
        }

        mount() {
            // Строгая изоляция экрана логина: запрет показа меню цехов неавторизованным пользователям
            if (this.isLoginScreen()) {
                this.dismantle();
                return;
            }

            // Если в DOM уже есть серверный поповер ядра (base.html), то JS-свитчер не нужен
            const existingServerPopover = document.getElementById('workshop-dropdown-popover');
            if (existingServerPopover && existingServerPopover.closest('.workshop-switcher-container')) {
                return;
            }

            this.triggerEl = this.findTriggerBadge();
            if (!this.triggerEl) {
                setTimeout(() => this.mount(), 250);
                return;
            }

            // Никогда не привязываться к нейтральному бейджу портала
            if (this.triggerEl.classList.contains('badge-shop-portal')) {
                return;
            }

            if (!this.triggerEl.id) {
                this.triggerEl.id = 'header-shop-badge';
            }

            this.renderPopover();

            if (this.isMounted && this.triggerEl.classList.contains('workshop-switcher-trigger')) {
                return;
            }

            this.triggerEl.classList.add('workshop-switcher-trigger');
            this.triggerEl.setAttribute('title', 'Переключить производственный цех');
            this.triggerEl.style.cursor = 'pointer';

            this.triggerEl.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggle();
            };

            if (!this.triggerEl.querySelector('.fa-chevron-down')) {
                const chevron = document.createElement('i');
                chevron.className = 'fa-solid fa-chevron-down';
                chevron.style.fontSize = '0.62rem';
                chevron.style.marginLeft = '4px';
                this.triggerEl.appendChild(chevron);
            }

            this.isMounted = true;
        }

        dismantle() {
            if (this.popoverEl && this.popoverEl.parentNode) {
                this.popoverEl.parentNode.removeChild(this.popoverEl);
                this.popoverEl = null;
            }
            const badge = this.triggerEl || this.findTriggerBadge();
            if (badge) {
                badge.classList.remove('workshop-switcher-trigger');
                badge.onclick = null;
                const chevrons = badge.querySelectorAll('.fa-chevron-down');
                chevrons.forEach(ch => ch.remove());
            }
            this.isMounted = false;
            this.isOpen = false;
        }

        renderPopover() {
            let popover = document.getElementById('workshop-dropdown-popover');
            if (!popover) {
                popover = document.createElement('div');
                popover.id = 'workshop-dropdown-popover';
                popover.className = 'workshop-popover-menu';
                document.body.appendChild(popover);
            }

            popover.style.display = 'none';
            popover.style.position = 'fixed';
            popover.style.minWidth = '280px';
            popover.style.zIndex = '10002';
            this.popoverEl = popover;

            const curWs = getCurrentWorkshopId();
            let itemsHtml = '';
            WORKSHOPS.forEach(ws => {
                const isActive = (ws.id === curWs);
                itemsHtml += `
                    <a href="${ws.url}" class="workshop-popover-item ${isActive ? 'active' : ''}">
                        <span class="brand-badge-shop ${ws.badge_class}">${ws.short_name}</span>
                        <span class="workshop-popover-name">${escapeHtml(ws.name)}</span>
                    </a>
                `;
            });

            popover.innerHTML = `
                <div class="workshop-popover-header">Переключение цеха</div>
                ${itemsHtml}
            `;
        }

        updatePosition() {
            if (!this.popoverEl || !this.triggerEl) return;
            const rect = this.triggerEl.getBoundingClientRect();
            const popoverWidth = 280;
            let left = rect.left;
            let top = rect.bottom + 6;

            if (left + popoverWidth > window.innerWidth - 12) {
                left = Math.max(12, window.innerWidth - popoverWidth - 12);
            }
            if (left < 12) left = 12;

            this.popoverEl.style.top = `${top}px`;
            this.popoverEl.style.left = `${left}px`;
        }

        toggle() {
            if (this.isOpen) {
                this.close();
            } else {
                this.open();
            }
        }

        open() {
            if (!this.popoverEl || !this.triggerEl) return;
            this.renderPopover(); // перерендерим для актуального активного цеха
            this.popoverEl.style.display = 'block';
            this.updatePosition();
            this.isOpen = true;
            this.triggerEl.classList.add('is-open');
        }

        close() {
            if (!this.popoverEl) return;
            this.popoverEl.style.display = 'none';
            this.isOpen = false;
            if (this.triggerEl) {
                this.triggerEl.classList.remove('is-open');
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.__TECTUM_WORKSHOP_SWITCHER__ = new CanonicalWorkshopSwitcher();
        });
    } else {
        window.__TECTUM_WORKSHOP_SWITCHER__ = new CanonicalWorkshopSwitcher();
    }
})();
