/**
 * Tectum Enterprise - Workshop Switcher Popover
 * @canonical-pattern WorkshopSwitcher
 * @established 2026-10-30
 * @version 20261031_switcher_v3
 * @description Сквозной интерактивный переключатель производственных кабинетов
 *              для Администратора (Левда М.), Директора и Главного технолога.
 *              Portal Architecture (document.body), Idempotent Event Binding.
 */

(function () {
    const ALLOWED_ROLES = ['admin', 'director', 'technologist'];

    // Реестр кабинетов завода Tectum
    const WORKSHOPS = [
        {
            id: 'xci',
            title: 'Цех ХЦИ',
            subtitle: 'Сменный рапорт, формовка, дестакер',
            url: '/',
            icon: 'fa-industry',
            bg: '#eff6ff',
            color: '#2563eb'
        },
        {
            id: 'qcd',
            title: 'Служба СКК',
            subtitle: 'Переборка, разбраковка, Акты А4',
            url: '/qcd',
            icon: 'fa-clipboard-check',
            bg: '#f0fdf4',
            color: '#16a34a'
        },
        {
            id: 'lkc',
            title: 'Цех ЛКЦ',
            subtitle: 'Окраска шифера, рапорт, простои',
            url: '/lkc',
            icon: 'fa-paint-roller',
            bg: '#faf5ff',
            color: '#9333ea'
        },
        {
            id: 'admin',
            title: 'Панель администратора',
            subtitle: 'Справочники, сотрудники, нормативы',
            url: '/admin',
            icon: 'fa-sliders',
            bg: '#f1f5f9',
            color: '#0f172a'
        },
        {
            id: 'analytics',
            title: 'Аналитика производства',
            subtitle: 'OEE, выработка, простои, баланс',
            url: '/analytics',
            icon: 'fa-chart-line',
            bg: '#fffbeb',
            color: '#d97706'
        }
    ];

    const SERVICES = [
        { title: 'Планнер', url: '/tasks', icon: 'fa-bullseye', color: '#f59e0b' },
        { title: 'Чек-листы', url: '/checklists', icon: 'fa-square-check', color: '#10b981' },
        { title: 'База знаний', url: '/docs', icon: 'fa-book-bookmark', color: '#3b82f6' }
    ];

    function getCurrentCabinetId() {
        const path = window.location.pathname.toLowerCase();
        if (path.includes('qcd')) return 'qcd';
        if (path.includes('lkc')) return 'lkc';
        if (path.includes('admin')) return 'admin';
        if (path.includes('analytics')) return 'analytics';
        if (path.includes('tasks') || path.includes('planner')) return 'tasks';
        if (path.includes('checklists')) return 'checklists';
        if (path.includes('docs') || path.includes('knowledge') || path.includes('base')) return 'docs';
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

    class WorkshopSwitcher {
        constructor() {
            this.currentUser = null;
            this.triggerEl = null;
            this.popoverEl = null;
            this.isOpen = false;
            this.isMounted = false;
            this.init();
        }

        init() {
            // Глобальные слушатели событий (навешиваются строго один раз в конструкторе)
            document.addEventListener('click', (e) => {
                if (this.isOpen && this.popoverEl) {
                    const isClickInsidePopover = this.popoverEl.contains(e.target);
                    const isClickOnTrigger = this.triggerEl && (this.triggerEl === e.target || this.triggerEl.contains(e.target));
                    if (!isClickInsidePopover && !isClickOnTrigger) {
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
                if (this.isOpen) {
                    this.updatePosition();
                }
            });

            window.addEventListener('scroll', () => {
                if (this.isOpen) {
                    this.updatePosition();
                }
            }, true);

            // Реактивная синхронизация при выходе/смене пользователя в соседней вкладке
            window.addEventListener('storage', (e) => {
                if (e.key === 'tectum_auth_user') {
                    if (!e.newValue) {
                        this.dismantle();
                    } else {
                        try {
                            const u = JSON.parse(e.newValue);
                            if (u && ALLOWED_ROLES.includes(u.role)) {
                                this.currentUser = u;
                                this.mount();
                            } else {
                                this.dismantle();
                            }
                        } catch (err) {
                            this.dismantle();
                        }
                    }
                }
            });

            // 1. Быстрая пре-инициализация из localStorage для мгновенного показа без задержек
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

            // 2. Строгая серверная верификация сессии (Backend Authority)
            this.verifyServerSession();
        }

        async verifyServerSession() {
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

            // Если сервер не подтвердил сессию админа — демонтируем
            if (!this.currentUser || !ALLOWED_ROLES.includes(this.currentUser.role)) {
                this.dismantle();
            }
        }

        findTriggerBadge() {
            // Приоритетный поиск по явному ID
            let badge = document.getElementById('header-shop-badge');
            if (badge) return badge;

            // Сайдбар админки
            const adminBadge = document.querySelector('.admin-sidebar .brand-badge-shop');
            if (adminBadge) return adminBadge;

            // Каноническая шапка
            badge = document.querySelector('.header-brand-left .brand-badge-shop');
            if (badge) return badge;

            badge = document.querySelector('.brand-badge-shop');
            if (badge) return badge;

            badge = document.querySelector('.brand-badge-tasks');
            if (badge) return badge;

            badge = document.querySelector('.sidebar-brand-stitch .brand-kb-badge');
            if (badge) return badge;

            return null;
        }

        mount() {
            if (!this.currentUser || !ALLOWED_ROLES.includes(this.currentUser.role)) return;

            this.triggerEl = this.findTriggerBadge();
            if (!this.triggerEl) {
                // Если DOM еще формируется, повторяем через микротик
                setTimeout(() => this.mount(), 120);
                return;
            }

            // Назначаем канонический ID, если отсутствовал
            if (!this.triggerEl.id) {
                this.triggerEl.id = 'header-shop-badge';
            }

            // Защитный инвариант: если триггер вложен внутрь тега <a>, извлекаем его наружу,
            // чтобы клик по переключателю гарантированно не вызывал перезагрузку или блокировку ссылки
            const parentA = this.triggerEl.closest('a');
            if (parentA && parentA.parentNode) {
                parentA.parentNode.insertBefore(this.triggerEl, parentA.nextSibling);
            }

            // Рендерим поповер в document.body (Portal Architecture)
            this.renderPopover();

            // Если уже привязано и триггер активен — просто обновляем содержимое и выходим
            if (this.isMounted && this.triggerEl.classList.contains('workshop-switcher-trigger')) {
                return;
            }

            // Настраиваем чип цеха как интерактивный селектор
            this.triggerEl.classList.add('workshop-switcher-trigger');
            this.triggerEl.setAttribute('title', 'Нажмите для быстрого перехода в другой цех или кабинет');

            // Атомарный прямой слушатель на клик триггера (исключает дублирование)
            this.triggerEl.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggle();
            };

            // Добавляем стрелку-шеврон, если её еще нет
            if (!this.triggerEl.querySelector('.switcher-chevron')) {
                const chevron = document.createElement('i');
                chevron.className = 'fa-solid fa-chevron-down switcher-chevron';
                this.triggerEl.appendChild(chevron);
            }

            this.isMounted = true;
        }

        renderPopover() {
            let popover = document.getElementById('workshop-switcher-popover');
            if (!popover) {
                popover = document.createElement('div');
                popover.id = 'workshop-switcher-popover';
                popover.className = 'workshop-switcher-popover';
                document.body.appendChild(popover);
            }
            this.popoverEl = popover;

            const currentCab = getCurrentCabinetId();
            const userName = this.currentUser ? this.currentUser.name : 'Администратор';
            const userRoleName = this.currentUser?.role === 'admin' 
                ? 'Системный администратор' 
                : (this.currentUser?.role === 'director' ? 'Директор' : (this.currentUser?.role === 'technologist' ? 'Главный технолог' : this.currentUser?.role || 'Администратор'));

            let workshopsHtml = '';
            WORKSHOPS.forEach(w => {
                const isCurrent = (w.id === currentCab);
                workshopsHtml += `
                    <a href="${w.url}" data-switcher-url="${w.url}" class="switcher-item ${isCurrent ? 'is-current' : ''}">
                        <div class="switcher-icon" style="background: ${w.bg}; color: ${w.color};">
                            <i class="fa-solid ${w.icon}"></i>
                        </div>
                        <div class="switcher-info">
                            <div class="switcher-title-row">
                                <span class="switcher-title">${escapeHtml(w.title)}</span>
                                ${isCurrent ? '<span class="switcher-badge-current"><i class="fa-solid fa-check"></i> Текущий</span>' : ''}
                            </div>
                            <div class="switcher-sub">${escapeHtml(w.subtitle)}</div>
                        </div>
                    </a>
                `;
            });

            let servicesHtml = '';
            SERVICES.forEach(s => {
                servicesHtml += `
                    <a href="${s.url}" data-switcher-url="${s.url}" class="switcher-service-btn" title="${escapeHtml(s.title)}">
                        <i class="fa-solid ${s.icon}" style="color: ${s.color};"></i>
                        <span>${escapeHtml(s.title)}</span>
                    </a>
                `;
            });

            popover.innerHTML = `
                <div class="switcher-header-label">
                    <i class="fa-solid fa-layer-group"></i>
                    <span>Цеховые кабинеты завода</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    ${workshopsHtml}
                </div>
                <div class="switcher-divider"></div>
                <div class="switcher-header-label" style="padding-top: 2px;">
                    <i class="fa-solid fa-cubes"></i>
                    <span>Общие сервисы</span>
                </div>
                <div class="switcher-services-grid">
                    ${servicesHtml}
                </div>
                <div class="switcher-footer">
                    <span><i class="fa-solid fa-user-shield" style="color: #2563eb; margin-right: 4px;"></i> <strong>${escapeHtml(userName)}</strong></span>
                    <span style="font-size: 0.68rem; color: #94a3b8;">${escapeHtml(userRoleName)}</span>
                </div>
            `;

            // Прямая гарантированная навигация при клике по пунктам меню
            popover.querySelectorAll('[data-switcher-url]').forEach(link => {
                link.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const url = link.getAttribute('data-switcher-url');
                    this.close();
                    if (url) {
                        window.location.href = url;
                    }
                };
            });
        }

        updatePosition() {
            if (!this.popoverEl || !this.triggerEl) return;

            const rect = this.triggerEl.getBoundingClientRect();
            const popoverWidth = 330;
            let left = rect.left;
            let top = rect.bottom + 8;

            // Защита от вылета за границы вьюпорта (Windows DPI 125%-150% scaling)
            if (left + popoverWidth > window.innerWidth - 12) {
                left = Math.max(12, window.innerWidth - popoverWidth - 12);
            }
            if (left < 12) left = 12;

            // Если триггер ушел выше экрана
            if (top < 8) top = 8;

            this.popoverEl.style.position = 'fixed';
            this.popoverEl.style.top = `${top}px`;
            this.popoverEl.style.left = `${left}px`;
            this.popoverEl.style.zIndex = '999999';
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
            this.updatePosition();
            this.isOpen = true;
            this.popoverEl.classList.add('is-open');
            this.triggerEl.classList.add('is-open');
        }

        close() {
            if (!this.popoverEl) return;
            this.isOpen = false;
            this.popoverEl.classList.remove('is-open');
            if (this.triggerEl) this.triggerEl.classList.remove('is-open');
        }

        dismantle() {
            this.close();
            if (this.triggerEl) {
                this.triggerEl.classList.remove('workshop-switcher-trigger', 'is-open');
                this.triggerEl.onclick = null;
                const ch = this.triggerEl.querySelector('.switcher-chevron');
                if (ch) ch.remove();
            }
            if (this.popoverEl) {
                this.popoverEl.remove();
                this.popoverEl = null;
            }
            this.isMounted = false;
        }
    }

    // Инициализация
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.TectumWorkshopSwitcher = new WorkshopSwitcher();
        });
    } else {
        window.TectumWorkshopSwitcher = new WorkshopSwitcher();
    }
})();
