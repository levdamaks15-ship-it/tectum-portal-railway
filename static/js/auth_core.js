/**
 * Tectum Enterprise Portal — Autonomous Authentication Core (auth_core.js)
 * @description Isolated, zero-dependency authentication module handling the login screen,
 * canonical employee picker popover, 4-box PIN entry, session storage, and cross-tab sync.
 * Prevents any syntax or runtime errors in large domain scripts from breaking the login screen.
 * @established 2026-11-03
 */

(function (window, document) {
    'use strict';

    let portalEmployeesList = [];
    let isSubmitting = false;

    // Helper: Safe HTML Escaping
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Helper: Generate Initials Avatar
    function getInitialsAvatar(name) {
        if (!name) return '??';
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
        return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
    }

    // 1. Load Employees for Person Picker (with offline/network fallback)
    async function loadPortalEmployeesOnce() {
        if (portalEmployeesList.length > 0) return portalEmployeesList;
        try {
            const res = await fetch('/api/planner/employees');
            const data = await res.json();
            let rawList = [];
            if (Array.isArray(data)) {
                rawList = data;
            } else if (data.employees && Array.isArray(data.employees)) {
                rawList = data.employees;
            }

            const stopWords = ['офис', 'огэ', 'огм', 'служба', 'цех', 'отдел', 'участок'];
            portalEmployeesList = rawList.filter(emp => {
                const name = (emp.name || '').trim().toLowerCase();
                if (!name) return false;
                return !stopWords.some(w => name.includes(w));
            });

            // Merge with Masters if available
            try {
                const mRes = await fetch('/api/masters/');
                if (mRes.ok) {
                    const masters = await mRes.json();
                    masters.forEach(m => {
                        if (!portalEmployeesList.some(e => e.name === m.name)) {
                            portalEmployeesList.push({
                                id: m.id,
                                name: m.name,
                                position: m.role === 'master' ? 'Мастер смены' : (m.role === 'lkc_master' ? 'Мастер ЛКЦ' : (m.role === 'qcd' ? 'Контролер СКК' : m.role))
                            });
                        }
                    });
                }
            } catch (me) {}

            if (portalEmployeesList.length === 0) {
                portalEmployeesList = [
                    { id: 1, name: "Левда М.", position: "Администратор" },
                    { id: 2, name: "Булеханов К.", position: "Начальник производства" },
                    { id: 8, name: "Герлинг С.", position: "Технический директор" },
                    { id: 10, name: "Туматов Д.", position: "Директор" },
                    { id: 9, name: "Косумов Р.", position: "Главный технолог" },
                    { id: 11, name: "Миркасимов И.М.", position: "Мастер ЛКЦ" },
                    { id: 12, name: "Мусаилова З.", position: "Руководитель СКК" }
                ];
            }
        } catch (e) {
            console.warn("[AuthCore] Could not load portal employees from server, using fallback:", e);
            portalEmployeesList = [
                { id: 1, name: "Левда М.", position: "Администратор" },
                { id: 2, name: "Булеханов К.", position: "Начальник производства" },
                { id: 8, name: "Герлинг С.", position: "Технический директор" },
                { id: 10, name: "Туматов Д.", position: "Директор" },
                { id: 9, name: "Косумов Р.", position: "Главный технолог" },
                { id: 11, name: "Миркасимов И.М.", position: "Мастер ЛКЦ" },
                { id: 12, name: "Мусаилова З.", position: "Руководитель СКК" }
            ];
        }
        return portalEmployeesList;
    }

    // 2. Employee Picker Popover Toggle & Positioning
    async function toggleLoginUserPickerPopover(event) {
        if (event) event.stopPropagation();
        const popover = document.getElementById("login-user-picker-popover");
        const trigger = document.getElementById("login-user-picker-trigger");
        if (!popover || !trigger) return;

        const isOpen = popover.style.display === "block";
        if (isOpen) {
            closeLoginUserPickerPopover();
        } else {
            if (!portalEmployeesList || portalEmployeesList.length === 0) {
                await loadPortalEmployeesOnce();
            }
            renderLoginUserPickerList("");
            popover.style.display = "block";
            trigger.classList.add("popover-open");
            positionLoginUserPickerPopover();
            const searchInput = document.getElementById("search-login-user-picker");
            if (searchInput) {
                searchInput.value = "";
                setTimeout(() => { searchInput.focus(); }, 50);
            }
        }
    }

    function closeLoginUserPickerPopover() {
        const popover = document.getElementById("login-user-picker-popover");
        const trigger = document.getElementById("login-user-picker-trigger");
        if (popover) popover.style.display = "none";
        if (trigger) trigger.classList.remove("popover-open");
    }

    function positionLoginUserPickerPopover() {
        const popover = document.getElementById("login-user-picker-popover");
        const trigger = document.getElementById("login-user-picker-trigger");
        if (!popover || !trigger || popover.style.display !== "block") return;

        const rect = trigger.getBoundingClientRect();
        popover.style.top = `${rect.bottom + 6}px`;
        popover.style.left = `${rect.left}px`;
        popover.style.width = `${Math.max(rect.width, 320)}px`;
    }

    window.addEventListener("resize", positionLoginUserPickerPopover, { passive: true });
    window.addEventListener("scroll", positionLoginUserPickerPopover, { passive: true });
    window.addEventListener("click", () => { closeLoginUserPickerPopover(); });

    // 3. Select Employee from Popover
    function selectLoginUser(empName) {
        const input = document.getElementById("login-user-input");
        const displayText = document.getElementById("login-user-picker-display-text");
        const avatar = document.getElementById("login-user-picker-avatar");

        if (input) input.value = empName || "";

        if (empName) {
            const emp = (portalEmployeesList || []).find(e => e.name === empName);
            if (displayText) {
                displayText.textContent = emp ? `${emp.name} ${emp.position ? '(' + emp.position + ')' : ''}` : empName;
                displayText.style.color = "#0f172a";
                displayText.style.fontWeight = "600";
            }
            if (avatar) {
                avatar.innerHTML = getInitialsAvatar(empName);
                avatar.style.background = "#eff6ff";
                avatar.style.color = "#1d4ed8";
            }
        } else {
            if (displayText) {
                displayText.textContent = "-- Выберите сотрудника --";
                displayText.style.color = "#64748b";
                displayText.style.fontWeight = "normal";
            }
            if (avatar) {
                avatar.innerHTML = '<i class="fa-solid fa-user"></i>';
                avatar.style.background = "#f1f5f9";
                avatar.style.color = "#64748b";
            }
        }

        try {
            const searchInput = document.getElementById("search-login-user-picker");
            if (searchInput) searchInput.blur();
            if (document.activeElement && document.activeElement.blur) {
                document.activeElement.blur();
            }
        } catch (e) {}

        closeLoginUserPickerPopover();
        clearLoginPinBoxes();
        const b1 = document.getElementById("pin-box-1");
        if (b1) {
            setTimeout(() => {
                b1.focus();
            }, 120);
        }
    }

    // 4. Render Popover Employee List with Search Filter
    function renderLoginUserPickerList(filterQuery = '') {
        const listEl = document.getElementById("list-login-user-picker");
        if (!listEl) return;

        const q = (filterQuery || '').trim().toLowerCase();
        const currentVal = document.getElementById("login-user-input")?.value || "";

        let html = '';
        const isUnassigned = !currentVal;
        html += `
            <div class="filter-option-item ${isUnassigned ? 'selected' : ''}" onclick="selectLoginUser('')">
                <div class="filter-option-person-left">
                    <div class="author-avatar-circle" style="background: #f1f5f9; color: #64748b;"><i class="fa-solid fa-user-slash" style="font-size: 0.75rem;"></i></div>
                    <span style="color: #64748b; font-style: italic;">-- Выберите сотрудника --</span>
                </div>
            </div>
        `;

        const list = Array.isArray(portalEmployeesList) ? portalEmployeesList : [];
        const filtered = list.filter(emp => {
            if (!q) return true;
            return (emp.name || '').toLowerCase().includes(q) || (emp.position || '').toLowerCase().includes(q);
        });

        filtered.forEach(emp => {
            const isSelected = emp.name === currentVal;
            const initials = getInitialsAvatar(emp.name);
            html += `
                <div class="filter-option-item ${isSelected ? 'selected' : ''}" onclick="selectLoginUser('${escapeHtml(emp.name).replace(/'/g, "\\'")}')">
                    <div class="filter-option-person-left">
                        <div class="author-avatar-circle" style="background: ${isSelected ? '#2563eb' : '#eff6ff'}; color: ${isSelected ? '#fff' : '#1d4ed8'};">
                            ${initials}
                        </div>
                        <div style="display: flex; flex-direction: column; min-width: 0;">
                            <span style="color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: ${isSelected ? '700' : '500'};">${escapeHtml(emp.name)}</span>
                            ${emp.position ? `<span style="font-size: 0.72rem; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(emp.position)}</span>` : ''}
                        </div>
                    </div>
                    ${isSelected ? '<i class="fa-solid fa-check" style="color: #2563eb; font-size: 0.85rem;"></i>' : ''}
                </div>
            `;
        });

        if (filtered.length === 0) {
            html += `<div style="padding: 1rem; text-align: center; color: #94a3b8; font-size: 0.85rem;">Сотрудник не найден</div>`;
        }

        listEl.innerHTML = html;
    }

    // 5. 4-Box PIN Input Logic
    function getLoginPinValue() {
        let val = '';
        for (let i = 1; i <= 4; i++) {
            const box = document.getElementById(`pin-box-${i}`);
            if (box) val += box.value.trim();
        }
        return val;
    }

    function clearLoginPinBoxes() {
        for (let i = 1; i <= 4; i++) {
            const box = document.getElementById(`pin-box-${i}`);
            if (box) box.value = '';
        }
        const hidden = document.getElementById('login-pin-hidden');
        if (hidden) hidden.value = '';
    }

    function handleLoginPinInput(index, event) {
        const box = document.getElementById(`pin-box-${index}`);
        if (!box) return;

        box.value = box.value.replace(/[^0-9]/g, '');

        if (box.value && index < 4) {
            const nextBox = document.getElementById(`pin-box-${index + 1}`);
            if (nextBox) nextBox.focus();
        }

        const fullPin = getLoginPinValue();
        const hidden = document.getElementById('login-pin-hidden');
        if (hidden) hidden.value = fullPin;

        if (fullPin.length === 4) {
            submitCanonicalLogin();
        }
    }

    function handleLoginPinKeydown(index, event) {
        if (event.key === 'Backspace') {
            const box = document.getElementById(`pin-box-${index}`);
            if (box && !box.value && index > 1) {
                const prevBox = document.getElementById(`pin-box-${index - 1}`);
                if (prevBox) {
                    prevBox.focus();
                    prevBox.value = '';
                }
            }
        } else if (event.key === 'Enter') {
            submitCanonicalLogin();
        }
    }

    // 6. Submit Login with Double-Submit Guard
    async function submitCanonicalLogin() {
        if (isSubmitting) return;

        const nameInput = document.getElementById("login-user-input");
        const name = nameInput ? nameInput.value.trim() : "";
        const pin = getLoginPinValue();
        const btnSubmit = document.getElementById("btn-submit-login");
        const errorMsg = document.getElementById("login-error-msg");

        if (errorMsg) errorMsg.style.display = 'none';

        if (!name) {
            if (errorMsg) {
                errorMsg.innerText = "Пожалуйста, выберите сотрудника!";
                errorMsg.style.display = 'block';
            }
            toggleLoginUserPickerPopover();
            return;
        }

        if (pin.length < 4) {
            if (errorMsg) {
                errorMsg.innerText = "Пожалуйста, введите 4-значный PIN-код!";
                errorMsg.style.display = 'block';
            }
            const firstBox = document.getElementById("pin-box-1");
            if (firstBox) firstBox.focus();
            return;
        }

        isSubmitting = true;
        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Вход...</span>';
        }

        try {
            const res = await fetch('/api/login/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, pin })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || "Неверный ПИН-код сотрудника");
            }

            const user = await res.json();
            window.currentUser = user;

            try {
                localStorage.setItem('tectum_auth_user', JSON.stringify(user));
                localStorage.setItem('tectum_portal_user', JSON.stringify({ name: user.name, pin: pin }));
                localStorage.setItem('tectum_current_user_name', user.name);
            } catch (e) {}

            // Deep-link redirect support
            const urlParams = new URLSearchParams(window.location.search);
            const redirectUrl = urlParams.get('redirect');
            if (redirectUrl && !redirectUrl.startsWith('//') && !redirectUrl.includes(':')) {
                window.location.href = redirectUrl;
                return;
            }

            // Role-based routing to separate workshop consoles if required
            if (user.role === 'qcd' || user.name.includes('Мусаилова') || user.name === 'Зарина') {
                window.location.href = '/static/qcd.html';
                return;
            }

            if (user.role === 'lkc_master' || user.name.includes('Миркасимов') || user.name === 'Мастер ЛКЦ') {
                window.location.href = '/static/lkc.html';
                return;
            }

            // Switch header shop badge to XCI workshop
            const shopBadge = document.getElementById('header-shop-badge');
            if (shopBadge) {
                shopBadge.className = 'brand-badge-shop badge-shop-xci';
                shopBadge.innerText = 'ХЦИ';
            }
            const shopSubtitle = document.getElementById('header-shop-subtitle');
            if (shopSubtitle) {
                shopSubtitle.innerText = 'ЦЕХ ХРИЗОТИЛЦЕМЕНТНЫХ ИЗДЕЛИЙ';
            }

            // Reveal main app container
            document.body.classList.remove('not-authenticated');
            const bNav = document.querySelector('.tectum-mobile-bottom-nav');
            if (bNav) bNav.style.display = '';

            const loginScreen = document.getElementById('login-screen');
            if (loginScreen) loginScreen.style.display = 'none';

            const mainApp = document.getElementById('main-app');
            if (mainApp) mainApp.style.display = 'block';

            const userInfo = document.getElementById('user-info-container');
            if (userInfo) userInfo.style.display = 'inline-flex';

            const greetingName = document.getElementById('user-greeting-name');
            if (greetingName) greetingName.innerText = user.name;

            const greetingRole = document.getElementById('user-greeting-role');
            if (greetingRole) greetingRole.innerText = user.role;

            const checklistsBtn = document.getElementById('header-checklists-btn');
            if (checklistsBtn) checklistsBtn.style.display = 'inline-flex';

            // Hand off to application logic if already loaded
            if (typeof window.applyRoleVisibility === 'function') {
                window.applyRoleVisibility();
            }
            if (typeof window.loadData === 'function') {
                window.loadData();
            }
        } catch (e) {
            if (errorMsg) {
                errorMsg.innerText = e.message || "Ошибка авторизации";
                errorMsg.style.display = 'block';
            }
            clearLoginPinBoxes();
            const errBox = document.getElementById("pin-box-1");
            if (errBox) errBox.focus();
        } finally {
            isSubmitting = false;
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> <span>Войти</span>';
            }
        }
    }

    // 7. Cross-tab and Cross-module session synchronizer
    window.addEventListener('storage', function (e) {
        if (e.key === 'tectum_auth_user' || e.key === 'tectum_portal_user') {
            const raw = localStorage.getItem('tectum_auth_user');
            if (!raw) {
                if (window.currentUser) {
                    window.currentUser = null;
                    const userInfo = document.getElementById('user-info-container');
                    if (userInfo) userInfo.style.display = 'none';
                    const mainApp = document.getElementById('main-app');
                    if (mainApp) mainApp.style.display = 'none';
                    const loginScreen = document.getElementById('login-screen');
                    if (loginScreen) loginScreen.style.display = 'block';
                    document.body.classList.remove('role-portal');
                    document.body.classList.add('not-authenticated');
                }
            } else {
                try {
                    const newUser = JSON.parse(raw);
                    if (newUser && newUser.name && (!window.currentUser || window.currentUser.name !== newUser.name)) {
                        window.currentUser = newUser;
                        const greetingName = document.getElementById('user-greeting-name');
                        if (greetingName) greetingName.innerText = newUser.name;
                        const greetingRole = document.getElementById('user-greeting-role');
                        if (greetingRole) greetingRole.innerText = newUser.role;
                        if (typeof window.applyRoleVisibility === 'function') {
                            window.applyRoleVisibility();
                        }
                    }
                } catch (err) {}
            }
        }
    });

    // 8. Global Exports on window for inline HTML onclick/oninput handlers
    window.AuthCore = {
        loadPortalEmployeesOnce,
        toggleLoginUserPickerPopover,
        closeLoginUserPickerPopover,
        positionLoginUserPickerPopover,
        selectLoginUser,
        renderLoginUserPickerList,
        getLoginPinValue,
        clearLoginPinBoxes,
        handleLoginPinInput,
        handleLoginPinKeydown,
        submitCanonicalLogin
    };

    window.toggleLoginUserPickerPopover = toggleLoginUserPickerPopover;
    window.closeLoginUserPickerPopover = closeLoginUserPickerPopover;
    window.positionLoginUserPickerPopover = positionLoginUserPickerPopover;
    window.selectLoginUser = selectLoginUser;
    window.renderLoginUserPickerList = renderLoginUserPickerList;
    window.getLoginPinValue = getLoginPinValue;
    window.clearLoginPinBoxes = clearLoginPinBoxes;
    window.handleLoginPinInput = handleLoginPinInput;
    window.handleLoginPinKeydown = handleLoginPinKeydown;
    window.submitCanonicalLogin = submitCanonicalLogin;
    window.getInitialsAvatar = getInitialsAvatar;

})(window, document);
