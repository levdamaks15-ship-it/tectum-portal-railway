/**
 * Tectum Tasks Planner — Client Logic (Clean & Simple)
 * 3-Level Planning, Hierarchies, Dependencies, Roadmaps & Hashtags
 * Build: 2026-10-23 v2.4.3 (Fix empty state add stage button & stop pan propagation)
 */

// Global click handler to open date picker when clicking anywhere in a date/month/time input
document.addEventListener('click', function (e) {
    const input = e.target.closest('input');
    if (!input) return;
    if (input._flatpickr) {
        if (!input._flatpickr.isOpen) input._flatpickr.open();
        return;
    }
    const pickerTypes = ['date', 'month', 'time', 'datetime-local', 'week'];
    if (pickerTypes.includes(input.type)) {
        if (typeof input.showPicker === 'function') {
            try { input.showPicker(); } catch (err) {}
        }
    }
});

let allTasks = [];
let allRoadmaps = [];
let allTagsList = [];
let allWeeksStructure = {};
let allMasters = [];
let showBacklog = false; // toggle to include unfinished tasks from other weeks
const _monthsRuInit = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
];
const _nowInit = new Date();
let currentMonth = `${_monthsRuInit[_nowInit.getMonth()]} ${_nowInit.getFullYear()}`;
let currentWeek = "all";
let currentQuarter = `Q${Math.floor(_nowInit.getMonth() / 3) + 1} ${_nowInit.getFullYear()}`;

// 3 Horizons & Filters State
let currentHorizon = "weekly"; // "weekly" | "services" | "roadmaps"
let currentDepartmentService = "all"; // "all" | "ОГМ" | "ОГЭ" | "Технологи" | "ОТК"
let currentTagFilter = "all";
let filterHasDocOnly = false;

let allPlannerEmployees = [];
let allPlannerZones = [];

let activeQuickPreset = "all"; // "all" | "my" | "in_work" | "zone"
let myTasksFilterActive = false;
let myTasksCurrentPage = 1;
const MY_TASKS_PAGE_SIZE = 25;
let liveSyncIntervalId = null;
let lastTasksDataHash = "";
let lastRoadmapsDataHash = "";
let isModalOpen = false;
let isInitialLoading = true;
let tasksFetchSeq = 0;
let customDateFrom = null;
let customDateTo = null;

const CORE_NAMES = [
    "Герлинг С.",
    "Булеханов К.",
    "Курилова С.",
    "Солонцов Ю.",
    "Сазонов С.",
    "Хохлов К.",
    "Зарина",
    "Косумов Р.",
    "Туматов Д.",
    "Левда М.",
    "Дауылбай М.",
    "Бекбосынов Р.",
    "Султанулы С.",
    "Монаев С."
];

// Local cache restoration for instant 0ms rendering
try {
    const cachedEmps = localStorage.getItem("tectum_planner_employees_cache");
    if (cachedEmps) allPlannerEmployees = JSON.parse(cachedEmps);
    const cachedZones = localStorage.getItem("tectum_planner_zones_cache");
    if (cachedZones) allPlannerZones = JSON.parse(cachedZones);
} catch (e) {}

let targetHighlightTaskId = null;
let currentPlannerUser = null; // { name: string, pin: string }
let pendingAuthCallback = null;

// Выделенные задачи в службах (Multi-Select)
let selectedServiceTaskIds = new Set();

document.addEventListener("DOMContentLoaded", () => {
    initPlannerSession();
    // 1. Мгновенная синхронная гидратация выпадающих списков (0 мс) из кэша / CORE_NAMES
    populateDropdowns();
    // 2. Мгновенный синхронный парсинг URL-фильтров и даты
    syncInitUrlAndFilters();
    // На мобильных устройствах по умолчанию активируем режим «Мои задачи»
    if (window.innerWidth <= 768 && currentPlannerUser && currentPlannerUser.name) {
        myTasksFilterActive = true;
    }

    // 3. Немедленный старт загрузки задач (первый параллельный запрос)
    isInitialLoading = false;
    loadTasks();
    startTasksLiveSync();

    // 4. Фоновая параллельная подгрузка актуальных справочников без блокировки UI
    hydrateBackgroundData();

    // Слушатель глобальной вставки скриншота/фото (Ctrl+V)
    window.addEventListener("paste", async (e) => {
        const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
        if (!items || items.length === 0) return;

        let imageFile = null;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type && items[i].type.indexOf("image") !== -1) {
                imageFile = items[i].getAsFile();
                break;
            }
        }
        if (!imageFile) return;

        // 1. При открытом массовом вводе -> AI OCR
        const bulkModal = document.getElementById("bulk-tasks-modal");
        if (bulkModal && bulkModal.style.display !== "none") {
            if (window.isBulkOcrRunning) return;
            e.preventDefault();
            showToast("Скриншот обнаружен в буфере! Отправка на AI-распознавание... 📷");
            processBulkOcrImage(imageFile);
            return;
        }

        // 2. При открытом модальном окне выполнения задачи -> Фото ПОСЛЕ
        const completeModal = document.getElementById("complete-task-modal");
        if (completeModal && completeModal.style.display !== "none") {
            e.preventDefault();
            showToast("Вставка фото ПОСЛЕ из буфера... 📷");
            await uploadPhotoBlobDirectly(imageFile, 'complete-task-photo', 'complete-photo-preview-hint', 'complete-photo-preview-btn', 'complete-photo-thumb-container');
            return;
        }

        // 3. При открытом модальном окне создания / редактирования задачи
        const taskModal = document.getElementById("task-modal");
        if (taskModal && taskModal.style.display !== "none") {
            e.preventDefault();
            const afterInput = document.getElementById("task-photo-after-input");
            const isAfterFocused = afterInput && (document.activeElement === afterInput);
            if (isAfterFocused) {
                showToast("Вставка фото ПОСЛЕ из буфера... 📷");
                await uploadPhotoBlobDirectly(imageFile, 'task-photo-after-input', 'task-photo-after-preview-hint', 'task-photo-after-preview-btn', 'task-photo-after-thumb-container');
            } else {
                showToast("Вставка фото ДО из буфера... 📷");
                await uploadPhotoBlobDirectly(imageFile, 'task-photo-input', 'task-photo-preview-hint', 'task-photo-preview-btn', 'task-photo-thumb-container');
            }
            return;
        }
    });
});

function initPlannerSession() {
    try {
        const saved = localStorage.getItem("tectum_portal_user") || sessionStorage.getItem("planner_user_session");
        if (saved) {
            currentPlannerUser = JSON.parse(saved);
        }
    } catch (e) {}
    updatePlannerUserBadge();
}

const PLANNER_TRUSTED_LEADERS = ["Туматов Д.", "Герлинг С.", "Булеханов К."];

function isPlannerAdmin(user = currentPlannerUser) {
    if (!user) return false;
    return user.name === "Левда М." || user.is_admin === true;
}

function isPlannerTrustedLeader(user = currentPlannerUser) {
    if (!user || !user.name) return false;
    return PLANNER_TRUSTED_LEADERS.includes(user.name.trim());
}

function canDeleteProjectOrTask(task, user = currentPlannerUser) {
    if (!user || !user.name) return false;
    if (isPlannerAdmin(user)) return true;
    if (isPlannerTrustedLeader(user)) return true;
    return false; // 🔒 Удалять имеют право ТОЛЬКО доверенные лица руководства и админ! Авторам запрещено.
}

function canEditProjectOrTask(task, user = currentPlannerUser) {
    if (!user || !user.name) return false;
    if (isPlannerAdmin(user)) return true;
    if (isPlannerTrustedLeader(user)) return true;
    const uName = user.name.trim();
    if (task && task.author_name && task.author_name.trim() === uName) return true;
    if (task && task.parent_author && task.parent_author.trim() === uName) return true;
    if (typeof currentGraphData !== 'undefined' && currentGraphData?.project?.author_name && currentGraphData.project.author_name.trim() === uName) return true;
    return false;
}

function canInteractWithTask(task, user = currentPlannerUser) {
    if (!user || !user.name) return false;
    if (canEditProjectOrTask(task, user)) return true;
    if (task && task.assignee_name && task.assignee_name.trim() === user.name.trim()) return true;
    return false;
}

function canAcceptProject(project, user = currentPlannerUser) {
    if (!user || !user.name) return false;
    if (isPlannerAdmin(user)) return true;
    if (isPlannerTrustedLeader(user)) return true;
    if (project && project.author_name && project.author_name.trim() === user.name.trim()) return true;
    return false;
}

function updatePlannerUserBadge() {
    const nameEl = document.getElementById("planner-user-name");
    const badgeEl = document.getElementById("planner-user-badge");
    const logoutBtn = document.getElementById("btn-planner-logout");
    if (!nameEl || !badgeEl) return;

    if (currentPlannerUser && currentPlannerUser.name) {
        const isAdmin = isPlannerAdmin();
        const isLeader = isPlannerTrustedLeader();

        let iconHtml = '<i class="fa-solid fa-user-check" style="color: #2563eb; margin-right: 4px;"></i>';
        let bg = "#eff6ff";
        let color = "#1d4ed8";
        let border = "#bfdbfe";
        let title = `👤 Сотрудник: ${currentPlannerUser.name}. Нажмите для смены`;

        if (isAdmin) {
            iconHtml = '<i class="fa-solid fa-crown" style="color: #eab308; margin-right: 4px;" title="Мастер-администратор"></i>';
            bg = "#fefce8";
            color = "#854d0e";
            border = "#fef08a";
            title = `👑 Мастер-администратор: ${currentPlannerUser.name} (полные права). Нажмите для смены`;
        } else if (isLeader) {
            iconHtml = '<i class="fa-solid fa-shield-halved" style="color: #6366f1; margin-right: 4px;" title="Руководство завода"></i>';
            bg = "#eef2ff";
            color = "#4338ca";
            border = "#c7d2fe";
            title = `🛡️ Руководство завода: ${currentPlannerUser.name}. Нажмите для смены`;
        }

        nameEl.innerHTML = `${iconHtml}${currentPlannerUser.name}`;
        badgeEl.style.display = "flex";
        badgeEl.style.background = bg;
        badgeEl.style.color = color;
        badgeEl.style.borderColor = border;
        badgeEl.title = title;
        if (logoutBtn) logoutBtn.style.display = "inline-block";
    } else {
        nameEl.innerHTML = '<i class="fa-solid fa-lock" style="margin-right: 4px;"></i>Войти (PIN)';
        badgeEl.style.display = "flex";
        badgeEl.style.background = "#f1f5f9";
        badgeEl.style.color = "#475569";
        badgeEl.style.borderColor = "#cbd5e1";
        badgeEl.title = "Нажмите, чтобы авторизоваться через PIN-код";
        if (logoutBtn) logoutBtn.style.display = "none";
    }
    if (typeof updateChipsVisualState === "function") {
        updateChipsVisualState();
    }
}

function promptChangePlannerUser() {
    openPinModal(null, (user) => {
        showToast(`Вы вошли как ${user.name}`);
        if (myTasksFilterActive) {
            loadTasks();
        }
    });
}

async function logoutPlannerUser() {
    currentPlannerUser = null;
    try {
        await fetch("/api/logout", { method: "POST" });
    } catch (e) {}
    try {
        localStorage.removeItem("tectum_auth_user");
        localStorage.removeItem("tectum_portal_user");
        localStorage.removeItem("tectum_current_user_name");
        sessionStorage.removeItem("planner_user_session");
    } catch (e) {}
    window.location.replace('/');
}

function getInitialsAvatar(name) {
    if (!name) return '??';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

function togglePlannerUserPickerPopover(event) {
    if (event) event.stopPropagation();
    const popover = document.getElementById("planner-user-picker-popover");
    const trigger = document.getElementById("planner-user-picker-trigger");
    if (!popover || !trigger) return;

    const isOpen = popover.style.display === "block";
    if (isOpen) {
        closePlannerUserPickerPopover();
    } else {
        popover.style.display = "block";
        trigger.classList.add("active");
        renderPlannerUserPickerList();
        const searchInput = document.getElementById("search-planner-user-picker");
        if (searchInput) {
            searchInput.value = "";
            setTimeout(() => searchInput.focus(), 50);
        }
    }
}

function closePlannerUserPickerPopover() {
    const popover = document.getElementById("planner-user-picker-popover");
    const trigger = document.getElementById("planner-user-picker-trigger");
    if (popover) popover.style.display = "none";
    if (trigger) trigger.classList.remove("active");
}

function selectPlannerUser(userName) {
    const hidden = document.getElementById("planner-pin-user-input");
    const display = document.getElementById("planner-user-picker-display-text");
    const avatar = document.getElementById("planner-user-picker-avatar");
    const legacySelect = document.getElementById("pin-auth-user-select");

    if (hidden) hidden.value = userName;
    if (legacySelect) legacySelect.value = userName;

    if (display) {
        display.textContent = userName || "-- Выберите сотрудника --";
        display.style.color = userName ? "#0f172a" : "#64748b";
        display.style.fontWeight = userName ? "600" : "normal";
    }

    if (avatar) {
        if (userName) {
            avatar.textContent = getInitialsAvatar(userName);
            avatar.style.background = "#2563eb";
            avatar.style.color = "#ffffff";
        } else {
            avatar.innerHTML = '<i class="fa-solid fa-user"></i>';
            avatar.style.background = "#eff6ff";
            avatar.style.color = "#2563eb";
        }
    }

    closePlannerUserPickerPopover();
    onPinUserSelectChanged();
    clearPlannerPinBoxes();
    const box1 = document.getElementById("planner-pin-box-1");
    if (box1) box1.focus();
}

function renderPlannerUserPickerList(filterQuery = "") {
    const listEl = document.getElementById("list-planner-user-picker");
    if (!listEl) return;

    const q = (filterQuery || "").trim().toLowerCase();
    const currentVal = document.getElementById("planner-pin-user-input")?.value || "";

    let html = '';
    const isUnassigned = !currentVal;
    html += `
        <div class="filter-option-item ${isUnassigned ? 'selected' : ''}" onclick="selectPlannerUser('')">
            <div class="filter-option-person-left">
                <div class="author-avatar-circle" style="background: #f1f5f9; color: #64748b;"><i class="fa-solid fa-user-slash" style="font-size: 0.75rem;"></i></div>
                <span style="color: #64748b; font-style: italic;">-- Выберите сотрудника --</span>
            </div>
        </div>
    `;

    const list = Array.isArray(allPlannerEmployees) && allPlannerEmployees.length > 0 
        ? allPlannerEmployees 
        : getUniquePersons().map(n => ({ name: n, position: '' }));

    const filtered = list.filter(emp => {
        if (!q) return true;
        return (emp.name || '').toLowerCase().includes(q) || (emp.position || '').toLowerCase().includes(q);
    });

    filtered.forEach(emp => {
        const isSelected = emp.name === currentVal;
        const initials = getInitialsAvatar(emp.name);
        const posHtml = emp.position ? `<span style="font-size: 0.72rem; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(emp.position)}</span>` : '';
        html += `
            <div class="filter-option-item ${isSelected ? 'selected' : ''}" onclick="selectPlannerUser('${escapeHtml(emp.name).replace(/'/g, "\\'")}')">
                <div class="filter-option-person-left">
                    <div class="author-avatar-circle" style="background: ${isSelected ? '#2563eb' : '#eff6ff'}; color: ${isSelected ? '#fff' : '#1d4ed8'};">
                        ${initials}
                    </div>
                    <div style="display: flex; flex-direction: column; min-width: 0;">
                        <span style="color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: ${isSelected ? '700' : '500'};">${escapeHtml(emp.name)}</span>
                        ${posHtml}
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

/* 4-Box PIN Input Helpers */
function getPlannerPinBoxValue() {
    let val = '';
    for (let i = 1; i <= 4; i++) {
        const box = document.getElementById(`planner-pin-box-${i}`);
        if (box) val += box.value.trim();
    }
    return val;
}

function clearPlannerPinBoxes() {
    for (let i = 1; i <= 4; i++) {
        const box = document.getElementById(`planner-pin-box-${i}`);
        if (box) box.value = '';
    }
    const hidden = document.getElementById('pin-auth-input');
    if (hidden) hidden.value = '';
}

function handlePlannerPinBoxInput(index, event) {
    const box = document.getElementById(`planner-pin-box-${index}`);
    if (!box) return;

    box.value = box.value.replace(/[^0-9]/g, '');

    if (box.value && index < 4) {
        const nextBox = document.getElementById(`planner-pin-box-${index + 1}`);
        if (nextBox) nextBox.focus();
    }

    const fullPin = getPlannerPinBoxValue();
    const hidden = document.getElementById('pin-auth-input');
    if (hidden) hidden.value = fullPin;

    if (fullPin.length === 4) {
        submitPinModal();
    }
}

function handlePlannerPinBoxKeydown(index, event) {
    if (event.key === 'Backspace') {
        const box = document.getElementById(`planner-pin-box-${index}`);
        if (box && !box.value && index > 1) {
            const prevBox = document.getElementById(`planner-pin-box-${index - 1}`);
            if (prevBox) {
                prevBox.focus();
                prevBox.value = '';
            }
        }
    } else if (event.key === 'Enter') {
        submitPinModal();
    }
}

// Global click listener to close PersonPickerPopover
document.addEventListener("click", (e) => {
    const popover = document.getElementById("planner-user-picker-popover");
    const trigger = document.getElementById("planner-user-picker-trigger");
    if (popover && popover.style.display === "block") {
        if (!popover.contains(e.target) && !trigger?.contains(e.target)) {
            closePlannerUserPickerPopover();
        }
    }
});

function openPinModal(preselectedUser = null, onSuccess = null) {
    pendingAuthCallback = onSuccess;
    const modal = document.getElementById("planner-pin-modal");

    // Populate PersonPicker & legacy select
    let targetUser = preselectedUser;
    if (!targetUser && currentPlannerUser && currentPlannerUser.name) {
        targetUser = currentPlannerUser.name;
    }

    selectPlannerUser(targetUser || "");
    clearPlannerPinBoxes();

    if (modal) {
        modal.style.display = "flex";
        modal.style.alignItems = "center";
        modal.style.justifyContent = "center";
        modal.style.zIndex = "9000";
    }

    setTimeout(() => {
        const pinGrp = document.getElementById("pin-input-group");
        const box1 = document.getElementById("planner-pin-box-1");
        if (box1 && pinGrp && pinGrp.style.display !== "none") {
            box1.focus();
        }
    }, 150);
}

function closePinModal() {
    const modal = document.getElementById("planner-pin-modal");
    if (modal) modal.style.display = "none";
    closePlannerUserPickerPopover();
    clearPlannerPinBoxes();
    pendingAuthCallback = null;
}

function onPinUserSelectChanged() {
    const hiddenUser = document.getElementById("planner-pin-user-input");
    const pinGroup = document.getElementById("pin-input-group");
    if (!hiddenUser || !pinGroup) return;

    const uName = hiddenUser.value.trim();
    const emp = Array.isArray(allPlannerEmployees) ? allPlannerEmployees.find(e => e.name === uName) : null;
    if (emp && emp.has_pin === false) {
        pinGroup.style.display = "none";
    } else {
        pinGroup.style.display = "block";
    }
}

async function submitPinModal() {
    const hiddenUser = document.getElementById("planner-pin-user-input");
    const name = hiddenUser ? hiddenUser.value.trim() : "";
    const pin = getPlannerPinBoxValue();

    if (!name) {
        if (typeof showToast === 'function') showToast("Пожалуйста, выберите сотрудника!");
        else alert("Пожалуйста, выберите сотрудника!");
        return;
    }

    const pinGroup = document.getElementById("pin-input-group");
    if (pinGroup && pinGroup.style.display !== "none" && !pin) {
        if (typeof showToast === 'function') showToast("Пожалуйста, введите 4-значный PIN-код!");
        else alert("Пожалуйста, введите 4-значный PIN-код!");
        const box1 = document.getElementById("planner-pin-box-1");
        if (box1) box1.focus();
        return;
    }

    const btnSubmit = document.getElementById("btn-submit-planner-pin");
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Вход...</span>';
    }

    try {
        const res = await fetch("/api/planner/employees/verify_pin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name, pin_code: pin })
        });

        if (res.ok) {
            currentPlannerUser = { name: name, pin: pin };
            localStorage.setItem("tectum_portal_user", JSON.stringify(currentPlannerUser));
            localStorage.setItem("tectum_current_user_name", name);
            try {
                const loginRes = await fetch("/api/login/", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: name, pin: pin })
                });
                if (loginRes.ok) {
                    const loginUser = await loginRes.json();
                    localStorage.setItem("tectum_auth_user", JSON.stringify(loginUser));
                }
            } catch (err) {}
            updatePlannerUserBadge();

            const cb = pendingAuthCallback;
            closePinModal();

            if (typeof showToast === 'function') {
                showToast(`Вы вошли как ${name}`);
            }

            if (cb && typeof cb === "function") {
                cb(currentPlannerUser);
            }
        } else {
            const errData = await res.json().catch(() => ({}));
            const msg = errData.detail || "Неверный PIN-код!";
            if (typeof showToast === 'function') showToast(msg);
            else alert(msg);
            clearPlannerPinBoxes();
            const box1 = document.getElementById("planner-pin-box-1");
            if (box1) box1.focus();
        }
    } catch (e) {
        console.error("PIN verification error:", e);
        if (typeof showToast === 'function') showToast("Ошибка сети при проверке PIN-кода.");
        else alert("Ошибка сети при проверке PIN-кода.");
    } finally {
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> <span>Войти</span>';
        }
    }
}

function ensureUserAuthorized(requiredUser = null, onSuccess, task = null, actionType = "interact") {
    // 1. Администратор — абсолютные права
    if (currentPlannerUser && isPlannerAdmin()) {
        onSuccess(currentPlannerUser);
        return;
    }

    // 2. Доверенное руководство завода (Туматов Д., Герлинг С., Булеханов К.) — полный доступ ко всем проектам и задачам
    if (currentPlannerUser && isPlannerTrustedLeader()) {
        onSuccess(currentPlannerUser);
        return;
    }

    // 3. Проверка прав по объекту задачи/проекта
    if (task && currentPlannerUser) {
        const uName = currentPlannerUser.name ? currentPlannerUser.name.trim() : "";
        const isAuthor = Boolean(task.author_name && task.author_name.trim() === uName);
        const isAssignee = Boolean(task.assignee_name && task.assignee_name.trim() === uName);
        const projectAuthor = currentGraphData?.project?.author_name;
        const isProjectAuthor = Boolean(projectAuthor && projectAuthor.trim() === uName);

        if (actionType === "delete_task") {
            showToast(`🔒 Удалять задачи, проекты и этапы разрешено исключительно руководству завода (Туматов Д., Герлинг С., Булеханов К.) или администратору`, "warning");
            return;
        } else if (actionType === "edit_project") {
            if (isAuthor || isProjectAuthor) {
                onSuccess(currentPlannerUser);
                return;
            } else {
                showToast(`🔒 Редактировать суть и этапы проекта/задачи может только автор (${task.author_name || projectAuthor || '—'}), руководство завода или администратор`, "warning");
                return;
            }
        } else if (actionType === "accept_project") {
            if (isAuthor || isProjectAuthor) {
                onSuccess(currentPlannerUser);
                return;
            } else {
                showToast(`🔒 Принимать проект дорожной карты может только автор (${task.author_name || projectAuthor || '—'}), руководство завода или администратор`, "warning");
                return;
            }
        } else {
            // interact (статус, комментарий, фото)
            if (isAuthor || isAssignee || isProjectAuthor) {
                onSuccess(currentPlannerUser);
                return;
            } else {
                showToast(`🔒 Взаимодействовать с задачей (смена статуса, фото, факт) может только исполнитель (${task.assignee_name || '—'}), автор (${task.author_name || '—'}) или руководство завода`, "warning");
                return;
            }
        }
    }

    // 4. Если действие — удаление, разрешаем ТОЛЬКО руководству завода или админу
    if (actionType === "delete_task") {
        openPinModal(null, (authedUser) => {
            if (isPlannerAdmin(authedUser) || isPlannerTrustedLeader(authedUser)) {
                onSuccess(authedUser);
            } else {
                showToast(`🔒 Удалять задачи разрешено исключительно руководству завода (Туматов Д., Герлинг С., Булеханов К.) или администратору`, "warning");
            }
        });
        return;
    }

    // 5. Если сессия совпадает с requiredUser (или requiredUser не задан)
    if (currentPlannerUser && (!requiredUser || currentPlannerUser.name === (typeof requiredUser === 'string' ? requiredUser.trim() : requiredUser))) {
        onSuccess(currentPlannerUser);
        return;
    }

    // 6. Если пользователь залогинен под другим именем или сессии нет — открываем ввод PIN
    openPinModal(requiredUser, onSuccess);
}

function syncInitUrlAndFilters() {
    const urlParams = new URLSearchParams(window.location.search);
    
    // 1. Read month and week from URL with smart validation
    const monthParam = urlParams.get("month");
    const weekParam = urlParams.get("week");
    let shouldApplyUrlDate = false;

    if (monthParam) {
        const monthsRu = [
            "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
            "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
        ];
        const today = new Date();
        const curYear = today.getFullYear();
        const curMonthIdx = today.getMonth(); // 0-11

        const [mName, mYearStr] = monthParam.split(' ');
        const mYear = parseInt(mYearStr, 10) || curYear;
        const mIdx = monthsRu.indexOf(mName);

        // Если дата из URL >= текущего месяца/года или это выбор "all", применяем её
        if (monthParam === "all" || (mIdx !== -1 && (mYear > curYear || (mYear === curYear && mIdx >= curMonthIdx)))) {
            shouldApplyUrlDate = true;
        }
    }

    const monthSelect = document.getElementById("filter-month");
    if (shouldApplyUrlDate && monthParam) {
        currentMonth = monthParam;
        if (monthSelect) monthSelect.value = monthParam;

        if (weekParam) {
            currentWeek = weekParam;
            onMonthChange(weekParam);
        } else {
            onMonthChange(null);
        }
    } else {
        if (monthSelect) {
            monthSelect.value = currentMonth;
        }
        onMonthChange(weekParam || null);
    }

    // 2. Read specific filter parameters from URL
    const zoneParam = urlParams.get("zone");
    if (zoneParam) {
        setFilterValueDirect('zone', zoneParam);
    }

    const assigneeParam = urlParams.get("assignee");
    if (assigneeParam) {
        setFilterValueDirect('assignee', assigneeParam);
    }

    const authorParam = urlParams.get("author");
    if (authorParam) {
        setFilterValueDirect('author', authorParam);
    }

    const statusParam = urlParams.get("status");
    if (statusParam) {
        setFilterValueDirect('status', statusParam);
    }

    const backlogParam = urlParams.get("backlog");
    if (backlogParam === "true" || backlogParam === "1") {
        showBacklog = true;
        const btn = document.getElementById("btn-toggle-backlog");
        if (btn) btn.classList.add("btn-backlog-active");
    }

    const myParam = urlParams.get("my");
    if (myParam === "true" || myParam === "1") {
        myTasksFilterActive = true;
    }

    // 3. Horizon deep linking (hash or param)
    const validHorizons = ['weekly', 'services', 'tech_council', 'quality_day', 'roadmaps'];
    const horizonHash = window.location.hash ? window.location.hash.replace('#', '') : '';
    const horizonParam = urlParams.get("horizon");
    const targetHorizon = validHorizons.includes(horizonHash) ? horizonHash : 
                          (validHorizons.includes(horizonParam) ? horizonParam : null);
    if (targetHorizon) {
        switchHorizon(targetHorizon);
    }
}

function hydrateBackgroundData() {
    Promise.allSettled([
        loadCalendarStructure(),
        loadPlannerDropdownData(),
        loadTaskTags(),
        handleUrlDeepLinkingAsync()
    ]).catch(err => {
        console.warn("Background hydration warning:", err);
    });
}

async function handleUrlDeepLinkingAsync() {
    const urlParams = new URLSearchParams(window.location.search);
    
    // 1. Task highlight & week auto-navigation
    const taskIdParam = urlParams.get("task_id");
    if (taskIdParam) {
        const tId = parseInt(taskIdParam, 10);
        if (tId) {
            targetHighlightTaskId = tId;
            try {
                const res = await fetch(`/api/tasks/${tId}`);
                if (res.ok) {
                    const task = await res.json();
                    if (task.month_label) {
                        currentMonth = task.month_label;
                        const monthSelect = document.getElementById("filter-month");
                        if (monthSelect) monthSelect.value = task.month_label;
                    }
                    if (task.week_label) {
                        currentWeek = task.week_label;
                        onMonthChange(task.week_label);
                    }
                    loadTasks();
                }
            } catch (e) {
                console.error("Deep link task fetch error:", e);
            }
        }
    }

    // 2. Quick Create Task from Knowledge Base Document Deep Link
    const createDocId = urlParams.get("create_doc_id");
    const createDocTitle = urlParams.get("create_doc_title");
    if (createDocTitle || createDocId) {
        setTimeout(() => {
            openAddTaskModal();
            const cleanTitle = decodeURIComponent(createDocTitle || 'Документ').trim();
            const ruInput = document.getElementById("task-ru-input");
            if (ruInput) {
                ruInput.value = `Ознакомиться и внедрить: ${cleanTitle}`;
                onTaskInputChanged('primary');
            }
            const zoneInput = document.getElementById("task-zone-input");
            if (zoneInput) {
                zoneInput.value = "Документация";
                if (typeof updateTaskZoneDisplay === 'function') updateTaskZoneDisplay("Документация");
            }
            if (createDocId) {
                const parsedId = parseInt(createDocId, 10);
                if (parsedId) {
                    setSelectedDocAttachment(parsedId, cleanTitle);
                }
            }
        }, 400);
    }

    if (urlParams.get("open_add_task") === "1" || urlParams.get("open_modal") === "1") {
        setTimeout(async () => {
            await openAddTaskModal();
            if (urlParams.get("select_zone")) {
                const zVal = decodeURIComponent(urlParams.get("select_zone"));
                if (typeof selectTaskZone === 'function') selectTaskZone(zVal);
            }
            if (urlParams.get("open_zone") === "1") {
                setTimeout(() => {
                    if (typeof toggleTaskZonePopover === 'function') toggleTaskZonePopover();
                }, 120);
            }
            if (urlParams.get("open_assignee") === "1") {
                setTimeout(() => {
                    if (typeof toggleTaskAssigneePopover === 'function') toggleTaskAssigneePopover();
                }, 120);
            }
        }, 500);
    }
}

function setFilterValueDirect(type, value) {
    const desk = document.getElementById(`table-filter-${type}`);
    if (desk) desk.value = value;
    const mob = document.getElementById(`mobile-filter-${type}`);
    if (mob) mob.value = value;
    if (typeof updateDeckFiltersVisualState === 'function') {
        updateDeckFiltersVisualState();
    }
}

function updateUrlParams() {
    try {
        const url = new URL(window.location.href);
        const month = document.getElementById("filter-month") ? document.getElementById("filter-month").value : "";
        const week = document.getElementById("filter-week") ? document.getElementById("filter-week").value : "";
        const zone = document.getElementById("table-filter-zone") ? document.getElementById("table-filter-zone").value : "all";
        const author = document.getElementById("table-filter-author") ? document.getElementById("table-filter-author").value : "all";
        const assignee = document.getElementById("table-filter-assignee") ? document.getElementById("table-filter-assignee").value : "all";
        const status = document.getElementById("table-filter-status") ? document.getElementById("table-filter-status").value : "all";

        if (month) url.searchParams.set("month", month);
        if (week) url.searchParams.set("week", week);
        
        if (zone && zone !== "all") url.searchParams.set("zone", zone);
        else url.searchParams.delete("zone");

        if (author && author !== "all") url.searchParams.set("author", author);
        else url.searchParams.delete("author");

        if (assignee && assignee !== "all") url.searchParams.set("assignee", assignee);
        else url.searchParams.delete("assignee");

        if (status && status !== "all") url.searchParams.set("status", status);
        else url.searchParams.delete("status");

        if (showBacklog) url.searchParams.set("backlog", "true");
        else url.searchParams.delete("backlog");

        if (myTasksFilterActive) url.searchParams.set("my", "true");
        else url.searchParams.delete("my");

        window.history.replaceState({}, "", url.toString());
    } catch (e) {
        console.error("Error updating URL query params:", e);
    }
}

function syncDesktopFilter(type, value) {
    const desk = document.getElementById(`table-filter-${type}`);
    if (desk) desk.value = value;
    const mob = document.getElementById(`mobile-filter-${type}`);
    if (mob) mob.value = value;
    if (myTasksFilterActive && (type === 'assignee' || type === 'author')) {
        myTasksFilterActive = false;
    }
    if (typeof updateDeckFiltersVisualState === 'function') {
        updateDeckFiltersVisualState();
    }
    updateChipsVisualState();
    updateFilterBadge();
    updateUrlParams();
    loadTasks();
}

function syncMobileFilter(type, value) {
    const desk = document.getElementById(`table-filter-${type}`);
    if (desk) desk.value = value;
    if (myTasksFilterActive && (type === 'assignee' || type === 'author')) {
        myTasksFilterActive = false;
    }
    if (typeof updateDeckFiltersVisualState === 'function') {
        updateDeckFiltersVisualState();
    }
    updateChipsVisualState();
    updateFilterBadge();
    updateUrlParams();
    loadTasks();
}

/* ==========================================================================
   STICKY FILTER DECK & SEARCHABLE PERSON PICKER (Canonical Enterprise Module)
   ========================================================================== */
function getInitials(name) {
    if (!name) return '??';
    const clean = name.trim().replace(/^[^а-яa-z0-9]+/i, '');
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
}

function getAvatarColorClass(name) {
    if (!name) return 'avatar-blue';
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (hash << 5) - hash + name.charCodeAt(i);
        hash |= 0;
    }
    const classes = ['avatar-red', 'avatar-blue', 'avatar-green', 'avatar-purple', 'avatar-amber'];
    return classes[Math.abs(hash) % classes.length];
}

function updateDeckFiltersVisualState() {
    ['zone', 'author', 'assignee', 'status'].forEach(type => {
        const val = document.getElementById(`table-filter-${type}`)?.value || 'all';
        const labelEl = document.getElementById(`label-filter-${type}`);
        const chipBtn = document.getElementById(`chip-filter-${type}`);
        if (labelEl) {
            if (val === 'all') {
                labelEl.textContent = 'Все';
            } else {
                labelEl.textContent = val.length > 16 ? val.slice(0, 15) + '…' : val;
            }
        }
        if (chipBtn) {
            if (val !== 'all') {
                chipBtn.classList.add('active');
            } else {
                chipBtn.classList.remove('active');
            }
        }
    });

    const resetDeckBtn = document.getElementById("btn-reset-filters-deck");
    if (resetDeckBtn) {
        const zone = document.getElementById("table-filter-zone")?.value || "all";
        const author = document.getElementById("table-filter-author")?.value || "all";
        const assignee = document.getElementById("table-filter-assignee")?.value || "all";
        const status = document.getElementById("table-filter-status")?.value || "all";
        const isAnyActive = zone !== 'all' || author !== 'all' || assignee !== 'all' || status !== 'all' || myTasksFilterActive;
        resetDeckBtn.style.display = isAnyActive ? "inline-flex" : "none";
    }
}

function renderPersonPickerList(type, filterQuery = '') {
    const listEl = document.getElementById(`list-filter-${type}`);
    if (!listEl) return;
    
    const persons = getUniquePersons();
    const currentVal = document.getElementById(`table-filter-${type}`)?.value || 'all';
    
    const taskCountMap = {};
    if (Array.isArray(allTasks)) {
        allTasks.forEach(t => {
            const p = type === 'author' ? (t.author_name || t.author) : (t.assignee_name || t.assignee);
            if (p) taskCountMap[p] = (taskCountMap[p] || 0) + 1;
        });
    }

    const q = (filterQuery || '').trim().toLowerCase();
    let html = '';
    
    // "Все исполнители" / "Все авторы"
    const allTitle = type === 'author' ? 'Все авторы' : 'Все исполнители';
    const allSelected = currentVal === 'all' ? 'selected' : '';
    html += `
        <div class="filter-option-item ${allSelected}" onclick="selectDeckFilter('${type}', 'all')">
            <div class="filter-option-person-left">
                <div class="person-avatar avatar-blue">🌐</div>
                <span class="person-name-text font-bold">${allTitle}</span>
            </div>
            <span class="person-task-badge">${allTasks ? allTasks.length : 0}</span>
        </div>
    `;

    let filteredPersons = persons;
    if (q) {
        filteredPersons = persons.filter(p => p.toLowerCase().includes(q));
    }

    if (filteredPersons.length === 0) {
        html += `<div style="padding: 12px; text-align: center; color: #94a3b8; font-size: 12px;">Ничего не найдено</div>`;
        listEl.innerHTML = html;
        return;
    }

    // Top active persons (with active tasks > 0)
    const activePersons = filteredPersons.filter(p => (taskCountMap[p] || 0) > 0)
        .sort((a, b) => (taskCountMap[b] || 0) - (taskCountMap[a] || 0));

    if (!q && activePersons.length > 0) {
        html += `<div class="filter-group-header">⭐ Часто выбираемые</div>`;
        activePersons.slice(0, 5).forEach(name => {
            const isSel = currentVal === name ? 'selected' : '';
            const cnt = taskCountMap[name] || 0;
            const initials = getInitials(name);
            const avatarColor = getAvatarColorClass(name);
            const safeName = name.replace(/'/g, "\\'");
            html += `
                <div class="filter-option-item ${isSel}" onclick="selectDeckFilter('${type}', '${safeName}')">
                    <div class="filter-option-person-left">
                        <div class="person-avatar ${avatarColor}">${initials}</div>
                        <span class="person-name-text font-semibold">${escapeHtml(name)}</span>
                    </div>
                    <span class="person-task-badge busy">${cnt} ${cnt === 1 ? 'задача' : (cnt < 5 ? 'задачи' : 'задач')}</span>
                </div>
            `;
        });
    }

    // All employees section
    html += `<div class="filter-group-header">👥 ${q ? 'Результаты поиска' : 'Все сотрудники'} (${filteredPersons.length})</div>`;
    filteredPersons.forEach(name => {
        const isSel = currentVal === name ? 'selected' : '';
        const cnt = taskCountMap[name] || 0;
        const initials = getInitials(name);
        const avatarColor = getAvatarColorClass(name);
        const safeName = name.replace(/'/g, "\\'");
        html += `
            <div class="filter-option-item ${isSel}" onclick="selectDeckFilter('${type}', '${safeName}')">
                <div class="filter-option-person-left">
                    <div class="person-avatar ${avatarColor}">${initials}</div>
                    <span class="person-name-text">${escapeHtml(name)}</span>
                </div>
                ${cnt > 0 ? `<span class="person-task-badge">${cnt}</span>` : ''}
            </div>
        `;
    });

    listEl.innerHTML = html;
}

function renderZonePickerList(filterQuery = '') {
    const listEl = document.getElementById('list-filter-zone');
    if (!listEl) return;
    const zones = getPlannerZones();
    const currentVal = document.getElementById('table-filter-zone')?.value || 'all';
    const q = (filterQuery || '').trim().toLowerCase();

    let html = `
        <div class="filter-option-item ${currentVal === 'all' ? 'selected' : ''}" onclick="selectDeckFilter('zone', 'all')">
            <span class="filter-option-text font-bold">📁 Все зоны</span>
        </div>
    `;

    const filtered = q ? zones.filter(z => z.toLowerCase().includes(q)) : zones;
    filtered.forEach(z => {
        const isSel = currentVal === z ? 'selected' : '';
        const safeZ = z.replace(/'/g, "\\'");
        html += `
            <div class="filter-option-item ${isSel}" onclick="selectDeckFilter('zone', '${safeZ}')">
                <span class="filter-option-text">${escapeHtml(z)}</span>
            </div>
        `;
    });
    listEl.innerHTML = html;
}

function toggleDeckFilterPopover(type, event) {
    if (event) event.stopPropagation();
    const popover = document.getElementById(`popover-filter-${type}`);
    const chip = document.getElementById(`chip-filter-${type}`);
    if (!popover) return;

    const isVisible = popover.style.display === 'block';
    closeAllDeckPopovers();
    closeAllToolbarDatePopovers();

    if (!isVisible) {
        popover.style.display = 'block';
        if (chip) chip.classList.add('popover-open');
        if (type === 'assignee' || type === 'author') {
            const searchInput = document.getElementById(`search-filter-${type}`);
            if (searchInput) {
                searchInput.value = '';
                setTimeout(() => searchInput.focus(), 60);
            }
            renderPersonPickerList(type, '');
        } else if (type === 'zone') {
            const searchInput = document.getElementById('search-filter-zone');
            if (searchInput) {
                searchInput.value = '';
                setTimeout(() => searchInput.focus(), 60);
            }
            renderZonePickerList('');
        }
    }
}

function closeAllDeckPopovers() {
    ['zone', 'author', 'assignee', 'status'].forEach(t => {
        const pop = document.getElementById(`popover-filter-${t}`);
        const chip = document.getElementById(`chip-filter-${t}`);
        if (pop) pop.style.display = 'none';
        if (chip) chip.classList.remove('popover-open');
    });
}

/* ==========================================================================
   CUSTOM TOOLBAR DATE POPOVERS (Canonical Pattern Parity)
   ========================================================================== */

function toggleToolbarDatePopover(type, event) {
    if (event) event.stopPropagation();
    const popover = document.getElementById(`popover-toolbar-${type}`);
    const chip = document.getElementById(`btn-toolbar-${type}`);
    if (!popover) return;

    const isVisible = popover.style.display === 'block';
    closeAllToolbarDatePopovers();
    closeAllDeckPopovers();

    if (!isVisible) {
        if (type === 'month') {
            renderMonthPopoverList();
        } else if (type === 'week') {
            renderWeekPopoverList();
        }
        popover.style.display = 'block';
        if (chip) chip.classList.add('popover-open');
    }
}

function closeAllToolbarDatePopovers() {
    ['month', 'week'].forEach(t => {
        const pop = document.getElementById(`popover-toolbar-${t}`);
        const chip = document.getElementById(`btn-toolbar-${t}`);
        if (pop) pop.style.display = 'none';
        if (chip) chip.classList.remove('popover-open');
    });
}

function selectToolbarMonth(monthVal) {
    const monthSelect = document.getElementById('filter-month');
    if (monthSelect) {
        monthSelect.value = monthVal;
    }
    closeAllToolbarDatePopovers();
    onMonthChange();
}

function selectToolbarWeek(weekVal) {
    const weekSelect = document.getElementById('filter-week');
    if (weekSelect) {
        weekSelect.value = weekVal;
    }
    closeAllToolbarDatePopovers();
    onWeekSelectChange(weekVal);
}

function renderMonthPopoverList() {
    const listEl = document.getElementById('list-toolbar-month');
    const monthSelect = document.getElementById('filter-month');
    if (!listEl || !monthSelect) return;

    const currentVal = monthSelect.value || currentMonth || 'all';
    let html = '';

    Array.from(monthSelect.options).forEach(opt => {
        const val = opt.value;
        const text = opt.textContent.replace('🌐 ', '');
        const isSel = (val === currentVal);
        const isAll = (val === 'all');
        const iconClass = isAll ? 'fa-solid fa-globe' : 'fa-solid fa-calendar';
        const iconColor = isSel ? '#2563eb' : '#64748b';

        html += `
            <div class="filter-option-item ${isSel ? 'selected week-option-active' : ''}" 
                 onclick="selectToolbarMonth('${val}')" style="padding: 7px 10px;">
                <div class="week-option-left">
                    <i class="${iconClass}" style="color: ${iconColor}; font-size: 13px; width: 16px; text-align: center;"></i>
                    <span class="filter-option-text ${isSel ? 'font-bold' : ''}" style="font-size: 12.5px;">${escapeHtml(text)}</span>
                </div>
                ${isSel ? '<i class="fa-solid fa-check week-option-checkmark"></i>' : ''}
            </div>
        `;
    });

    listEl.innerHTML = html;
    setTimeout(() => {
        const activeItem = listEl.querySelector('.selected, .week-option-active');
        if (activeItem) {
            activeItem.scrollIntoView({ block: 'nearest' });
        }
    }, 20);
}

function renderWeekPopoverList() {
    const listEl = document.getElementById('list-toolbar-week');
    const weekSelect = document.getElementById('filter-week');
    if (!listEl || !weekSelect) return;

    const currentVal = weekSelect.value || currentWeek || 'all';
    const options = Array.from(weekSelect.options);
    if (options.length === 0) {
        listEl.innerHTML = '<div style="padding: 12px; text-align: center; color: #94a3b8; font-size: 12px;">Недели не сформированы</div>';
        return;
    }

    if (currentMonth === 'all') {
        const isSel = (currentVal === 'all');
        listEl.innerHTML = `
            <div class="filter-option-item ${isSel ? 'selected week-option-active' : ''}" 
                 onclick="selectToolbarWeek('all')" style="padding: 8px 10px;">
                <div class="week-option-left">
                    <i class="fa-solid fa-globe" style="color: #2563eb; font-size: 13px; width: 16px; text-align: center;"></i>
                    <span class="filter-option-text font-semibold">Все недели (за всё время)</span>
                </div>
                ${isSel ? '<i class="fa-solid fa-check week-option-checkmark"></i>' : ''}
            </div>
        `;
        return;
    }

    let quickItemsHtml = '';
    let weekItemsHtml = '';

    options.forEach(opt => {
        const val = opt.value;
        const text = opt.textContent;
        const isSel = (val === currentVal);

        if (['open_active', 'next_2_weeks', 'all'].includes(val)) {
            let iconClass = 'fa-solid fa-globe';
            let iconColor = '#2563eb';
            let label = 'Все активные';
            let badge = '';

            if (val === 'open_active') {
                iconClass = 'fa-solid fa-globe';
                label = 'Все активные';
                const m = text.match(/\((\d+)\s+задач\)/);
                if (m) {
                    badge = `<span class="scope-pill-badge">${m[1]}</span>`;
                }
            } else if (val === 'next_2_weeks') {
                iconClass = 'fa-solid fa-calendar-days';
                iconColor = '#0891b2';
                label = 'Ближайшие 2 недели';
            } else if (val === 'all') {
                iconClass = 'fa-solid fa-calendar-check';
                iconColor = '#475569';
                label = 'Весь месяц';
                const m = text.match(/\((\d+)\s+задач\)/);
                if (m) {
                    badge = `<span class="scope-pill-badge neutral">${m[1]}</span>`;
                }
            }

            quickItemsHtml += `
                <div class="filter-option-item ${isSel ? 'selected week-option-active' : ''}" 
                     onclick="selectToolbarWeek('${val}')" style="padding: 7px 10px;">
                    <div class="week-option-left">
                        <i class="${iconClass}" style="color: ${iconColor}; font-size: 13px; width: 16px; text-align: center;"></i>
                        <span class="filter-option-text ${isSel ? 'font-bold' : ''}" style="font-size: 12.5px;">${escapeHtml(label)}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        ${badge}
                        ${isSel ? '<i class="fa-solid fa-check week-option-checkmark"></i>' : ''}
                    </div>
                </div>
            `;
        } else {
            let weekTitle = val;
            let badge = '';

            if (text.includes('·')) {
                const parts = text.split('·');
                weekTitle = parts[0].trim();
                const stats = parts.slice(1).join('·').trim();
                badge = `<span class="scope-pill-badge ${isSel ? '' : 'neutral'}" style="font-size: 10px;">${escapeHtml(stats)}</span>`;
            } else {
                weekTitle = text.trim();
            }

            weekItemsHtml += `
                <div class="filter-option-item ${isSel ? 'selected week-option-active' : ''}" 
                     onclick="selectToolbarWeek('${val.replace(/'/g, "\\'")}')" style="padding: 7px 10px;">
                    <div class="week-option-left">
                        <i class="fa-regular fa-calendar" style="color: ${isSel ? '#2563eb' : '#94a3b8'}; font-size: 12px; width: 16px; text-align: center;"></i>
                        <span class="filter-option-text ${isSel ? 'font-bold' : ''}" style="font-size: 12px;">${escapeHtml(weekTitle)}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        ${badge}
                        ${isSel ? '<i class="fa-solid fa-check week-option-checkmark"></i>' : ''}
                    </div>
                </div>
            `;
        }
    });

    let fullHtml = '';
    if (quickItemsHtml) {
        fullHtml += `<div class="popover-section-label">Быстрый охват</div>${quickItemsHtml}`;
    }
    if (weekItemsHtml) {
        fullHtml += `<div class="popover-section-label" style="margin-top: 6px;">Недели (${escapeHtml(currentMonth)})</div>${weekItemsHtml}`;
    }

    listEl.innerHTML = fullHtml;
}

function syncDateToolbarUI() {
    const monthSelect = document.getElementById('filter-month');
    const weekSelect = document.getElementById('filter-week');
    const labelMonth = document.getElementById('label-toolbar-month');
    const labelWeek = document.getElementById('label-toolbar-week');

    if (monthSelect && labelMonth) {
        const mVal = monthSelect.value || currentMonth || 'all';
        if (mVal === 'all') {
            labelMonth.textContent = '🌐 За всё время';
        } else {
            labelMonth.textContent = mVal;
        }
    }

    if (weekSelect && labelWeek) {
        const wVal = weekSelect.value || currentWeek || 'all';
        if (wVal === 'open_active') {
            labelWeek.textContent = 'Все активные';
        } else if (wVal === 'next_2_weeks') {
            labelWeek.textContent = 'Ближайшие 2 недели';
        } else if (wVal === 'all') {
            labelWeek.textContent = 'Весь месяц';
        } else {
            const opt = Array.from(weekSelect.options).find(o => o.value === wVal);
            if (opt) {
                const fullText = opt.textContent;
                if (fullText.includes('·')) {
                    labelWeek.textContent = fullText.split('·')[0].trim();
                } else {
                    labelWeek.textContent = fullText.trim();
                }
            } else {
                labelWeek.textContent = wVal;
            }
        }
    }

    const monthPop = document.getElementById('popover-toolbar-month');
    if (monthPop && monthPop.style.display === 'block') {
        renderMonthPopoverList();
    }
    const weekPop = document.getElementById('popover-toolbar-week');
    if (weekPop && weekPop.style.display === 'block') {
        renderWeekPopoverList();
    }
}

function selectDeckFilter(type, value) {
    syncDesktopFilter(type, value);
    closeAllDeckPopovers();
}

function filterPersonList(type, query) {
    renderPersonPickerList(type, query);
}

function filterZoneList(query) {
    renderZonePickerList(query);
}

document.addEventListener('click', function(e) {
    if (!e.target.closest('.popover-anchor-wrap')) {
        closeAllDeckPopovers();
        closeAllToolbarDatePopovers();
    }
    if (!e.target.closest('.assignee-picker-wrapper') && !e.target.closest('#popover-task-assignee')) {
        closeTaskAssigneePopover();
    }
    if (!e.target.closest('.zone-picker-wrapper') && !e.target.closest('#popover-task-zone')) {
        closeTaskZonePopover();
    }
    if (!e.target.closest('#btn-bulk-author-trigger') && !e.target.closest('#popover-bulk-author')) {
        if (typeof closeBulkAuthorPopover === 'function') closeBulkAuthorPopover();
    }
    if (!e.target.closest('#btn-bulk-zone-trigger') && !e.target.closest('#popover-bulk-zone')) {
        if (typeof closeBulkZonePopover === 'function') closeBulkZonePopover();
    }
    if (!e.target.closest('#inspector-assignee-wrapper') && !e.target.closest('#popover-inspector-assignee')) {
        if (typeof closeInspectorAssigneePopover === 'function') closeInspectorAssigneePopover();
    }
    if (!e.target.closest('.bulk-row-assignee-wrap') && !e.target.closest('#popover-bulk-row-assignee')) {
        if (typeof closeBulkRowAssigneePopover === 'function') closeBulkRowAssigneePopover();
    }
    if (!e.target.closest('#graph-stage-assignee-wrapper') && !e.target.closest('#popover-graph-stage-assignee')) {
        if (typeof closeGraphStageAssigneePopover === 'function') closeGraphStageAssigneePopover();
    }
    if (!e.target.closest('#quick-subtask-assignee-wrapper') && !e.target.closest('#popover-quick-subtask-assignee')) {
        if (typeof closeQuickSubtaskAssigneePopover === 'function') closeQuickSubtaskAssigneePopover();
    }
});

function toggleMobileFilters() {
    const panel = document.getElementById("mobile-filters-panel");
    if (!panel) return;
    const isShown = panel.style.display === "flex";
    panel.style.display = isShown ? "none" : "flex";
}

function toggleMyTasksFilter() {
    if (!currentPlannerUser || !currentPlannerUser.name) {
        openPinModal(null, (user) => {
            currentPlannerUser = user;
            myTasksFilterActive = true;
            myTasksCurrentPage = 1;
            setFilterValueDirect('assignee', 'all');
            setFilterValueDirect('author', 'all');
            updatePlannerUserBadge();
            updateChipsVisualState();
            updateFilterBadge();
            updateUrlParams();
            if (currentHorizon === 'roadmaps') {
                loadRoadmaps();
            } else {
                loadTasks();
            }
            showToast(`Фильтр «Мои задачи»: ${user.name}`);
        });
        return;
    }

    myTasksFilterActive = !myTasksFilterActive;
    myTasksCurrentPage = 1;
    if (myTasksFilterActive) {
        setFilterValueDirect('assignee', 'all');
        setFilterValueDirect('author', 'all');
        showToast(`Показаны задачи: ${currentPlannerUser.name}`);
    } else {
        showToast("Показаны все задачи завода");
    }

    updateChipsVisualState();
    updateFilterBadge();
    updateUrlParams();
    if (currentHorizon === 'roadmaps') {
        loadRoadmaps();
    } else {
        loadTasks();
    }
}

function applyGlobalAllFilter() {
    myTasksFilterActive = false;
    myTasksCurrentPage = 1;
    ['zone', 'author', 'assignee', 'status'].forEach(type => {
        setFilterValueDirect(type, 'all');
    });
    showBacklog = false;
    const btnBacklog = document.getElementById("btn-toggle-backlog");
    if (btnBacklog) {
        btnBacklog.classList.remove("btn-backlog-active");
        btnBacklog.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> <span class="hide-mobile">Долги с прошлых недель</span><span class="mobile-only">Долги</span>`;
    }
    updateFilterSheetUI();
    updateChipsVisualState();
    updateFilterBadge();
    updateUrlParams();
    loadTasks();
    showToast("Показаны все задачи завода");
}

function toggleMonthScope() {
    const weekSelect = document.getElementById("filter-week");
    const monthSelect = document.getElementById("filter-month");
    if (!weekSelect || !monthSelect) return;

    if (weekSelect.value === "all") {
        // Переключить на автоопределенную неделю
        onMonthChange();
        showToast("Период: Текущая неделя");
    } else {
        // Переключить на весь месяц
        weekSelect.value = "all";
        currentWeek = "all";
        showToast("Период: Весь месяц (все недели)");
    }
    updateChipsVisualState();
    updateUrlParams();
    loadTasks();
}

function applyPresetFilter(presetType) {
    if (presetType === 'all') {
        // При клике на карточку «Всего задач» сбрасываем статус, но сохраняем пользователя, если активен режим «Мои задачи»
        setFilterValueDirect('status', 'all');
        if (!myTasksFilterActive) {
            setFilterValueDirect('zone', 'all');
            setFilterValueDirect('author', 'all');
            setFilterValueDirect('assignee', 'all');
        }
        updateChipsVisualState();
        updateFilterBadge();
        updateUrlParams();
        loadTasks();
        showToast(myTasksFilterActive ? `Все задачи: ${currentPlannerUser?.name || 'сотрудника'}` : "Показаны все задачи");
        return;
    }

    const statusMap = {
        'in_work': '🟡 В работе',
        'done': '🟢 Выполнено',
        'moved': '🔵 Перенесено',
        'cancelled': '🔴 Отменено'
    };

    const targetStatus = statusMap[presetType];
    if (targetStatus) {
        const curStatus = document.getElementById("table-filter-status")?.value;
        if (curStatus === targetStatus) {
            setFilterValueDirect('status', 'all');
        } else {
            setFilterValueDirect('status', targetStatus);
        }
        updateChipsVisualState();
        updateFilterBadge();
        updateUrlParams();
        loadTasks();
        return;
    }
}

function applyZoneChip(zoneName) {
    const curZone = document.getElementById("table-filter-zone")?.value;
    if (curZone === zoneName) {
        setFilterValueDirect('zone', 'all');
    } else {
        setFilterValueDirect('zone', zoneName);
    }
    updateChipsVisualState();
    updateFilterBadge();
    updateUrlParams();
    loadTasks();
}

function updateChipsVisualState() {
    const zone = document.getElementById("table-filter-zone")?.value || "all";
    const status = document.getElementById("table-filter-status")?.value || "all";
    const author = document.getElementById("table-filter-author")?.value || "all";
    const assignee = document.getElementById("table-filter-assignee")?.value || "all";

    // Chip All
    const isAll = (zone === 'all' && status === 'all' && author === 'all' && assignee === 'all' && !myTasksFilterActive && !showBacklog);
    const chipAll = document.getElementById("chip-all");
    if (chipAll) chipAll.classList.toggle("active", isAll);

    // Chip My Tasks
    const chipMy = document.getElementById("chip-my");
    const chipMyLabel = document.getElementById("chip-my-label");
    if (chipMy) {
        chipMy.classList.toggle("active", myTasksFilterActive);
        if (chipMyLabel) {
            chipMyLabel.textContent = (currentPlannerUser && currentPlannerUser.name && myTasksFilterActive) 
                ? `Мои (${currentPlannerUser.name})` 
                : "Мои задачи";
        }
    }

    // Toolbar My Tasks Button (Desktop)
    const btnMyTasks = document.getElementById("btn-toggle-my-tasks");
    const btnMyTasksLabel = document.getElementById("btn-my-tasks-label");
    if (btnMyTasks) {
        btnMyTasks.classList.toggle("btn-my-tasks-active", myTasksFilterActive);
        if (btnMyTasksLabel) {
            btnMyTasksLabel.textContent = (currentPlannerUser && currentPlannerUser.name && myTasksFilterActive) 
                ? `Мои (${currentPlannerUser.name}) ✓` 
                : "Мои задачи";
        }
    }

    // Chip Month Scope
    const chipMonthScope = document.getElementById("chip-month-scope");
    const chipMonthScopeLabel = document.getElementById("chip-month-scope-label");
    const weekVal = document.getElementById("filter-week")?.value;
    const isWholeMonth = (weekVal === "all");
    if (chipMonthScope) {
        chipMonthScope.classList.toggle("active", isWholeMonth);
        if (chipMonthScopeLabel) {
            chipMonthScopeLabel.textContent = isWholeMonth ? "Весь месяц ✓" : "Весь месяц";
        }
    }

    // Chip In Work
    const chipInWork = document.getElementById("chip-inwork");
    if (chipInWork) chipInWork.classList.toggle("active-warning", status === "🟡 В работе");

    // Zone Chips
    const zoneChips = {
        'ОГЭ': 'chip-zone-oge',
        'ОГМ': 'chip-zone-ogm',
        'СКК': 'chip-zone-qcd',
        'Бережливое производство': 'chip-zone-lean'
    };

    Object.entries(zoneChips).forEach(([zName, btnId]) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.classList.toggle("active", zone === zName);
        }
    });

    if (typeof updateWeekPresetButtonsState === 'function') {
        updateWeekPresetButtonsState();
    }
}

function updateFilterBadge() {
    const zone = document.getElementById("table-filter-zone")?.value || "all";
    const author = document.getElementById("table-filter-author")?.value || "all";
    const assignee = document.getElementById("table-filter-assignee")?.value || "all";
    const status = document.getElementById("table-filter-status")?.value || "all";
    
    let activeCount = 0;
    if (zone !== "all") activeCount++;
    if (author !== "all") activeCount++;
    if (assignee !== "all") activeCount++;
    if (status !== "all") activeCount++;
    if (myTasksFilterActive) activeCount++;
    if (showBacklog) activeCount++;
    
    const badge = document.getElementById("mobile-filter-badge");
    if (badge) {
        if (activeCount > 0) {
            badge.innerText = activeCount;
            badge.style.display = "inline-block";
        } else {
            badge.style.display = "none";
        }
    }

    // Top Chip Bar Reset Button
    const resetChipBtn = document.getElementById("btn-reset-filters-chip");
    const resetCountEl = document.getElementById("reset-filter-count");
    if (resetChipBtn) {
        if (activeCount > 0) {
            resetChipBtn.style.display = "inline-flex";
            if (resetCountEl) resetCountEl.innerText = activeCount;
        } else {
            resetChipBtn.style.display = "none";
        }
    }
}

function resetAllFilters() {
    ['zone', 'author', 'assignee', 'status'].forEach(type => {
        setFilterValueDirect(type, 'all');
    });
    myTasksFilterActive = false;
    showBacklog = false;

    const btnBacklog = document.getElementById("btn-toggle-backlog");
    if (btnBacklog) btnBacklog.classList.remove("btn-backlog-active");

    updateFilterSheetUI();
    updateChipsVisualState();
    updateFilterBadge();
    updateUrlParams();
    loadTasks();
    showToast("Все фильтры сброшены");
}

function startTasksLiveSync() {
    if (liveSyncIntervalId) clearInterval(liveSyncIntervalId);

    liveSyncIntervalId = setInterval(async () => {
        // Only run when tab is visible, no dialog/photo/detail modals are active, and user is not actively typing
        const anyModalActive = !!document.querySelector('.modal-overlay.active, .modal.active, #task-detail-modal.active, #photo-viewer-modal.active') ||
            Array.from(document.querySelectorAll('.modal-overlay, .modal, .modal-backdrop, #subtask-quick-modal, #add-task-modal, #history-modal, #task-detail-modal, #photo-viewer-modal, #pin-auth-modal, #column-picker-modal')).some(m => {
                try {
                    const style = window.getComputedStyle ? window.getComputedStyle(m) : m.style;
                    return style && style.display !== 'none' && style.visibility !== 'hidden';
                } catch (e) {
                    return false;
                }
            });
        const isUserTyping = !!(document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName));

        if (document.hidden || document.visibilityState !== 'visible' || isModalOpen || anyModalActive || isUserTyping) {
            return;
        }

        if (currentHorizon === "roadmaps") {
            await loadRoadmaps(true);
            return;
        }

        try {
            const month = document.getElementById("filter-month") ? document.getElementById("filter-month").value : "";
            const week = document.getElementById("filter-week") ? document.getElementById("filter-week").value : "";
            const zone = document.getElementById("table-filter-zone") ? document.getElementById("table-filter-zone").value : "all";
            const author = document.getElementById("table-filter-author") ? document.getElementById("table-filter-author").value : "all";
            const assignee = document.getElementById("table-filter-assignee") ? document.getElementById("table-filter-assignee").value : "all";
            const status = document.getElementById("table-filter-status") ? document.getElementById("table-filter-status").value : "all";

            let url = `/api/tasks?month=${encodeURIComponent(month)}&week=${encodeURIComponent(week)}&include_backlog=${showBacklog}`;
            
            // Учет горизонта и служб
            if (currentHorizon === "weekly") {
                url += `&task_type=weekly`;
            } else if (currentHorizon === "services") {
                url += `&task_type=service_plan`;
                if (currentDepartmentService !== "all") {
                    url += `&department_service=${encodeURIComponent(currentDepartmentService)}`;
                }
                if (filterHasDocOnly) {
                    url += `&has_doc=true`;
                }
            } else if (currentHorizon === "tech_council") {
                url += `&task_type=tech_council&zone=${encodeURIComponent("Техсовет")}`;
            } else if (currentHorizon === "quality_day") {
                url += `&task_type=quality_day&zone=${encodeURIComponent("День качества")}`;
            }

            // Хэштег
            if (currentTagFilter && currentTagFilter !== "all") {
                url += `&tag=${encodeURIComponent(currentTagFilter)}`;
            }

            if (myTasksFilterActive && currentPlannerUser && currentPlannerUser.name) {
                url += `&my_all_horizons=true&my_person=${encodeURIComponent(currentPlannerUser.name)}`;
            } else {
                if (author !== "all") url += `&author=${encodeURIComponent(author)}`;
                if (assignee !== "all") url += `&assignee=${encodeURIComponent(assignee)}`;
            }
            if (zone !== "all" && currentHorizon !== "tech_council" && currentHorizon !== "quality_day") {
                url += `&zone=${encodeURIComponent(zone)}`;
            }
            if (status !== "all") url += `&status=${encodeURIComponent(status)}`;

            const res = await fetch(url);
            if (res.ok) {
                const freshTasks = await res.json();
                const freshHash = JSON.stringify(freshTasks);
                if (freshHash !== lastTasksDataHash) {
                    lastTasksDataHash = freshHash;
                    allTasks = freshTasks;
                    renderTasksTable(allTasks);
                    renderTasksCards(allTasks);
                    renderKpiSummary(allTasks);
                }
            }
        } catch (e) {
            // Silently ignore background polling errors
        }
    }, 45000); // 45 seconds interval
}

async function loadTasks() {
    if (currentHorizon === "roadmaps") {
        await loadRoadmaps();
        return;
    }

    const tableBody = document.getElementById("tasks-table-body");
    const cardsContainer = document.getElementById("tasks-cards-container");
    if (!tableBody && !cardsContainer) return;

    const month = document.getElementById("filter-month") ? document.getElementById("filter-month").value : "";
    const week = document.getElementById("filter-week") ? document.getElementById("filter-week").value : "";
    
    // Table Header Filters
    const zone = document.getElementById("table-filter-zone") ? document.getElementById("table-filter-zone").value : "all";
    const author = document.getElementById("table-filter-author") ? document.getElementById("table-filter-author").value : "all";
    const assignee = document.getElementById("table-filter-assignee") ? document.getElementById("table-filter-assignee").value : "all";
    const status = document.getElementById("table-filter-status") ? document.getElementById("table-filter-status").value : "all";

    currentMonth = month;
    currentWeek = week;
    updateChipsVisualState();
    updateFilterBadge();
    updateUrlParams();
    
    let url = `/api/tasks?month=${encodeURIComponent(month)}&week=${encodeURIComponent(week)}&include_backlog=${showBacklog}`;
    if (customDateFrom) url += `&date_from=${encodeURIComponent(customDateFrom)}`;
    if (customDateTo) url += `&date_to=${encodeURIComponent(customDateTo)}`;
    
    // Горизонт планирования
    if (currentHorizon === "weekly") {
        url += `&task_type=weekly`;
    } else if (currentHorizon === "services") {
        url += `&task_type=service_plan`;
        if (currentDepartmentService !== "all") {
            url += `&department_service=${encodeURIComponent(currentDepartmentService)}`;
        }
        if (filterHasDocOnly) {
            url += `&has_doc=true`;
        }
    } else if (currentHorizon === "tech_council") {
        url += `&task_type=tech_council&zone=${encodeURIComponent("Техсовет")}`;
    } else if (currentHorizon === "quality_day") {
        url += `&task_type=quality_day&zone=${encodeURIComponent("День качества")}`;
    }

    if (myTasksFilterActive && currentPlannerUser && currentPlannerUser.name) {
        url += `&my_all_horizons=true&my_person=${encodeURIComponent(currentPlannerUser.name)}`;
    } else {
        if (author !== "all") url += `&author=${encodeURIComponent(author)}`;
        if (assignee !== "all") url += `&assignee=${encodeURIComponent(assignee)}`;
    }

    if (zone !== "all" && currentHorizon !== "tech_council" && currentHorizon !== "quality_day") {
        url += `&zone=${encodeURIComponent(zone)}`;
    }

    // Хэштег
    if (currentTagFilter && currentTagFilter !== "all") {
        url += `&tag=${encodeURIComponent(currentTagFilter)}`;
    }
    if (status !== "all") url += `&status=${encodeURIComponent(status)}`;

    tasksFetchSeq++;
    const thisFetchSeq = tasksFetchSeq;

    try {
        const res = await fetch(url);
        if (res.ok) {
            // If another request was initiated while this fetch was in-flight, discard stale result
            if (thisFetchSeq !== tasksFetchSeq) {
                return;
            }
            allTasks = await res.json();
            lastTasksDataHash = JSON.stringify(allTasks);
            renderTasksTable(allTasks);
            renderTasksCards(allTasks);
            renderKpiSummary(allTasks);
            updateFilterSheetUI();
            scrollToTargetTaskAfterRender();
        }
    } catch (e) {
        if (thisFetchSeq !== tasksFetchSeq) {
            return;
        }
        console.error("Error loading tasks:", e);
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: #ef4444; padding: 1.5rem;">Ошибка загрузки задач</td></tr>`;
        if (cardsContainer) cardsContainer.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 1.5rem;">Ошибка загрузки задач</div>`;
    }
}

function switchHorizon(horizon, event) {
    if (event) {
        if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault();
        } else {
            return;
        }
    }
    currentHorizon = horizon;
    clearServicesSelection();
    if (window.location.hash !== `#${horizon}`) {
        history.replaceState(null, '', `#${horizon}`);
    }
    
    // Переключение кнопок горизонтов
    document.querySelectorAll(".horizon-tab-btn").forEach(btn => btn.classList.remove("active"));
    const activeBtn = document.getElementById(`tab-horizon-${horizon}`);
    if (activeBtn) activeBtn.classList.add("active");

    if (typeof appleNavSwitch === "function") {
        appleNavSwitch(horizon);
    }

    document.body.classList.toggle("horizon-roadmaps", horizon === "roadmaps");

    const btnNavToday = document.getElementById("btn-nav-today");
    const toolbarDivider = document.querySelector(".toolbar-divider-v");
    if (btnNavToday) btnNavToday.style.display = (horizon === "roadmaps") ? "none" : "inline-flex";
    if (toolbarDivider) toolbarDivider.style.display = (horizon === "roadmaps") ? "none" : "block";

    const tableWrapper = document.getElementById("planner-table-wrapper");
    const roadmapsContainer = document.getElementById("roadmaps-view-container");
    const filterWeek = document.getElementById("filter-week");
    const filterMonth = document.getElementById("filter-month");
    const filterQuarter = document.getElementById("filter-quarter");
    const btnBacklog = document.getElementById("btn-toggle-backlog");
    const quickChips = document.getElementById("quick-chips-group");
    const printSubtitle = document.getElementById("print-header-subtitle");

    const roadmapChips = document.getElementById("roadmap-status-chips");
    const weekPresets = document.getElementById("week-presets-container");

    if (horizon === "roadmaps") {
        if (tableWrapper) tableWrapper.style.setProperty("display", "none", "important");
        if (roadmapsContainer) roadmapsContainer.style.setProperty("display", "block", "important");
        if (filterWeek) filterWeek.style.display = "none";
        if (filterMonth) filterMonth.style.display = "none";
        if (weekPresets) weekPresets.style.display = "none";
        if (roadmapChips) roadmapChips.style.display = "inline-flex";
        if (filterQuarter) {
            filterQuarter.style.display = "inline-block";
            if (!filterQuarter.value) filterQuarter.value = "active";
        }
        if (btnBacklog) btnBacklog.style.display = "none";
        if (printSubtitle) printSubtitle.textContent = "СТРАТЕГИЧЕСКИЕ ДОРОЖНЫЕ КАРТЫ И ПРОЕКТЫ";
        window.scrollTo({ top: 0, behavior: "instant" });
        loadRoadmaps();
    } else {
        if (tableWrapper) tableWrapper.style.removeProperty("display");
        if (roadmapsContainer) roadmapsContainer.style.setProperty("display", "none", "important");
        if (filterWeek) filterWeek.style.display = "inline-block";
        if (filterMonth) filterMonth.style.display = "inline-block";
        if (weekPresets) weekPresets.style.display = "flex";
        if (roadmapChips) roadmapChips.style.display = "none";
        if (filterQuarter) filterQuarter.style.display = "none";
        if (btnBacklog) btnBacklog.style.display = "inline-flex";

        if (horizon === "services") {
            if (printSubtitle) printSubtitle.textContent = "ПЛАНЫ СЛУЖБ ОГМ И ОГЭ (ППР И РЕВИЗИИ ОБОРУДОВАНИЯ)";
        } else if (horizon === "tech_council") {
            if (printSubtitle) printSubtitle.textContent = "ПРОТОКОЛ ТЕХНИЧЕСКОГО СОВЕТА";
            const zoneFilter = document.getElementById("table-filter-zone");
            if (zoneFilter) zoneFilter.value = "all";
        } else if (horizon === "quality_day") {
            if (printSubtitle) printSubtitle.textContent = "ПРОТОКОЛ ДНЯ КАЧЕСТВА";
            const zoneFilter = document.getElementById("table-filter-zone");
            if (zoneFilter) zoneFilter.value = "all";
        } else {
            if (printSubtitle) printSubtitle.textContent = "ИНФОРМАЦИОННЫЙ СТЕНД / БЕРЕЖЛИВОЕ ПРОИЗВОДСТВО";
        }
        loadTasks();
    }
}

function setRoadmapScope(scope) {
    const chipActive = document.getElementById("chip-roadmap-active");
    const chipCompleted = document.getElementById("chip-roadmap-completed");
    const chipAll = document.getElementById("chip-roadmap-all");
    const quarterSelect = document.getElementById("filter-quarter");

    [chipActive, chipCompleted, chipAll].forEach(c => {
        if (c) c.classList.remove("active");
    });

    if (scope === "completed") {
        if (chipCompleted) chipCompleted.classList.add("active");
        if (quarterSelect) quarterSelect.value = "completed";
    } else if (scope === "all") {
        if (chipAll) chipAll.classList.add("active");
        if (quarterSelect) quarterSelect.value = "all";
    } else {
        if (chipActive) chipActive.classList.add("active");
        if (quarterSelect) quarterSelect.value = "active";
    }

    loadRoadmaps();
}

function onRoadmapQuarterSelectChange(val) {
    const chipActive = document.getElementById("chip-roadmap-active");
    const chipCompleted = document.getElementById("chip-roadmap-completed");
    const chipAll = document.getElementById("chip-roadmap-all");

    [chipActive, chipCompleted, chipAll].forEach(c => {
        if (c) c.classList.remove("active");
    });

    if (val === "completed" && chipCompleted) {
        chipCompleted.classList.add("active");
    } else if (val === "all" && chipAll) {
        chipAll.classList.add("active");
    } else if (val === "active" && chipActive) {
        chipActive.classList.add("active");
    }

    loadRoadmaps();
}

async function loadRoadmaps(isSilent = false) {
    const grid = document.getElementById("roadmaps-cards-grid");
    if (!grid) return;

    const quarterSelect = document.getElementById("filter-quarter");
    const qVal = (quarterSelect && quarterSelect.value) ? quarterSelect.value : "active";

    // Only show spinner on manual/initial load if grid is currently empty
    if (!isSilent) {
        lastRoadmapsDataHash = "";
        if (!allRoadmaps || allRoadmaps.length === 0) {
            grid.innerHTML = `<div style="text-align: center; padding: 2rem; color: #64748b; grid-column: 1 / -1;"><i class="fa-solid fa-spinner fa-spin"></i> Загрузка дорожных карт...</div>`;
        }
    }

    try {
        let url = `/api/tasks/roadmaps?quarter=${encodeURIComponent(qVal)}`;
        if (myTasksFilterActive && currentPlannerUser && currentPlannerUser.name) {
            url += `&my_person=${encodeURIComponent(currentPlannerUser.name)}`;
        }
        const res = await fetch(url);
        if (res.ok) {
            const freshRoadmaps = await res.json();
            const freshHash = JSON.stringify(freshRoadmaps);
            // If data is identical, do not touch DOM (prevents flicker, scroll jump, input loss)
            if (isSilent && freshHash === lastRoadmapsDataHash) {
                return;
            }
            lastRoadmapsDataHash = freshHash;
            allRoadmaps = freshRoadmaps;
            renderRoadmaps(allRoadmaps);
        } else if (!isSilent) {
            grid.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 2rem; grid-column: 1 / -1;">Ошибка загрузки проектов</div>`;
        }
    } catch (e) {
        if (!isSilent) {
            console.error("Error loading roadmaps:", e);
            grid.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 2rem; grid-column: 1 / -1;">Ошибка соединения</div>`;
        }
    }
}

function getStagePluralWord(n) {
    const absN = Math.abs(n) % 100;
    const n10 = absN % 10;
    if (absN > 10 && absN < 20) return 'этапов';
    if (n10 > 1 && n10 < 5) return 'этапа';
    if (n10 === 1) return 'этап';
    return 'этапов';
}

function convertRuDateToIso(str, defaultYear = 2026) {
    if (!str) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const m = str.match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?/);
    if (m) {
        const dd = m[1].padStart(2, '0');
        const mm = m[2].padStart(2, '0');
        const yyyy = m[3] ? m[3] : String(defaultYear);
        return `${yyyy}-${mm}-${dd}`;
    }
    return "";
}

function renderRoadmaps(projects) {
    const grid = document.getElementById("roadmaps-cards-grid");
    if (!grid) return;

    if (!projects || projects.length === 0) {
        if (myTasksFilterActive && currentPlannerUser && currentPlannerUser.name) {
            grid.innerHTML = `
                <div style="text-align: center; padding: 3rem; background: #ffffff; border-radius: 12px; border: 1px solid var(--tbl-border); grid-column: 1 / -1;">
                    <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">👤</div>
                    <h3 style="color: #0f172a; margin-bottom: 0.5rem;">У вас пока нет задач в дорожных картах на этот период</h3>
                    <p style="color: #64748b; font-size: 0.9rem; margin-bottom: 1.25rem;">Вы можете посмотреть все общие проекты завода или выбрать другой квартал.</p>
                    <button class="btn-action btn-secondary-action" onclick="toggleMyTasksFilter()" style="margin-right: 8px;">
                        <i class="fa-solid fa-users"></i> Показать все дорожные карты
                    </button>
                    <button class="btn-action btn-primary-action" onclick="openAddTaskModal('roadmap')">
                        <i class="fa-solid fa-plus"></i> Создать проект Дорожной карты
                    </button>
                </div>
            `;
            return;
        }
        grid.innerHTML = `
            <div style="text-align: center; padding: 3rem; background: #ffffff; border-radius: 12px; border: 1px solid var(--tbl-border); grid-column: 1 / -1;">
                <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🗺️</div>
                <h3 style="color: #0f172a; margin-bottom: 0.5rem;">Нет проектов дорожной карты на этот период</h3>
                <p style="color: #64748b; font-size: 0.9rem; margin-bottom: 1.25rem;">Создайте первый стратегический проект или выберите другой квартал.</p>
                <button class="btn-action btn-primary-action" onclick="openAddTaskModal('roadmap')">
                    <i class="fa-solid fa-plus"></i> Создать проект Дорожной карты
                </button>
            </div>
        `;
        return;
    }

    grid.innerHTML = projects.map(p => {
        const prog = p.calculated_progress || p.progress || 0;
        const totalElems = p.total_elements || 0;
        const doneElems = p.done_elements || 0;
        const isReadyForAccept = (prog === 100 || (totalElems > 0 && doneElems === totalElems)) && p.status !== '🟢 Выполнено';
        const isCompleted = p.status === '🟢 Выполнено';
        const canEdit = canEditProjectOrTask(p);
        const canAccept = canAcceptProject(p);

        let cardStyle = '';
        if (isReadyForAccept) {
            cardStyle = 'border: 2px solid #f59e0b; box-shadow: 0 4px 18px rgba(245, 158, 11, 0.18);';
        } else if (isCompleted) {
            cardStyle = 'border: 1px solid #bbf7d0; background: #ffffff;';
        }

        let statusBadgeHtml = '';
        if (isReadyForAccept) {
            statusBadgeHtml = `<span class="badge-zone" style="background: #fef3c7; color: #b45309; border-color: #fde68a; font-size: 0.72rem; font-weight: 700;">✨ 100% — Готов к сдаче</span>`;
        } else if (isCompleted) {
            statusBadgeHtml = `<span class="badge-zone" style="background: #f0fdf4; color: #166534; border-color: #bbf7d0; font-size: 0.72rem; font-weight: 700;">🟢 Завершён (100%)</span>`;
        } else {
            statusBadgeHtml = `<span class="badge-zone" style="background: #fffbeb; color: #b45309; border-color: #fde68a; font-size: 0.72rem;">${escapeHtml(p.status || '🟡 В работе')}</span>`;
        }

        const totalStages = (p.milestones || []).length;
        const doneStages = (p.milestones || []).filter(m => (m.status && m.status.includes('Выполнено')) || (m.progress >= 100)).length;
        let blockedStages = 0;
        (p.milestones || []).forEach(m => {
            if (m.depends_on && m.depends_on.status && !m.depends_on.status.includes('Выполнено')) {
                blockedStages++;
            }
        });
        const stageWord = getStagePluralWord(totalStages);

        const docBadge = p.attached_doc ? `
            <a href="${p.attached_doc.link}" target="_blank" class="badge-doc-attachment" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; font-size: 0.75rem; font-weight: 600; color: #1d4ed8; text-decoration: none;" title="Регламент / Спецификация">
                <i class="fa-solid fa-file-lines"></i> <span>${escapeHtml(p.attached_doc.title)}</span>
            </a>
        ` : '';

        const tagsHtml = (p.tags || '').split(',').filter(t => t.trim()).map(t => {
            const cleanT = t.trim();
            return `<span class="tag-pill" onclick="filterByTag('${cleanT}')">${cleanT}</span>`;
        }).join('');

        return `
            <div class="roadmap-card" style="${cardStyle}">
                <div class="roadmap-header">
                    <div>
                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px; flex-wrap: wrap;">
                            <span class="badge-code" style="font-size: 11px; color: #B5B5BA; font-family: monospace; letter-spacing: 0.2px; background: none; border: none; padding: 0;">${p.code || ('TSK-' + p.id)}</span>
                            <span class="badge-zone" style="background: #f5f3ff; color: #6d28d9; border-color: #ddd6fe;">${escapeHtml(p.target_quarter || currentQuarter)}</span>
                            ${p.department_service ? `<span class="badge-zone">${escapeHtml(p.department_service)}</span>` : ''}
                            ${statusBadgeHtml}
                        </div>
                        <div class="roadmap-title" onclick="openTaskDetailModal(${p.id})" style="cursor: pointer;" title="Подробный просмотр проекта">${escapeHtml(p.title)}</div>
                    </div>
                    <div style="display: flex; gap: 4px;">
                        <button class="btn-icon-cell" onclick="printRoadmapProject(${p.id})" title="Печать паспорта проекта">
                            <i class="fa-solid fa-print" style="color: #64748b;"></i>
                        </button>
                        ${canEdit ? `
                            <button class="btn-icon-cell" onclick="openEditTaskModal(${p.id})" title="Редактировать проект">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>

                <div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.8rem; font-weight: 600; color: #475569; margin-bottom: 4px;">
                        <span>Прогресс: ${doneStages}/${totalStages} ${stageWord}</span>
                        <span style="color: ${prog === 100 ? '#10b981' : '#2563eb'}; font-weight: 700;">${prog}%</span>
                    </div>
                    <div class="roadmap-progress-wrap">
                        <div class="roadmap-progress-bar" style="width: ${prog}%; ${prog === 100 ? 'background: #10b981;' : ''}"></div>
                    </div>
                    ${blockedStages > 0 ? `
                        <div style="margin-top: 6px;">
                            <span class="badge-zone" style="background: #fef2f2; color: #991b1b; border-color: #fecaca; font-size: 0.72rem; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                                <i class="fa-solid fa-lock"></i> ${blockedStages} ${getStagePluralWord(blockedStages)} ждет предшественника
                            </span>
                        </div>
                    ` : ''}
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #64748b; margin-top: 10px;">
                    <div>👤 Ответственный: <strong style="color: #0f172a;">${p.assignee_name || 'Не назначен'}</strong></div>
                    <div>${docBadge}</div>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; color: #475569; margin: 6px 0; padding: 4px 8px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">
                    <div><i class="fa-solid fa-calendar-day" style="color: #6366f1;"></i> Срок: <strong style="color: #0f172a;">${escapeHtml(p.due_date_str || 'Не установлен')}</strong></div>
                    ${p.created_date ? `<div style="font-size: 0.72rem; color: #94a3b8;">Старт: ${p.created_date}</div>` : ''}
                </div>

                ${tagsHtml ? `<div style="margin-bottom: 6px;">${tagsHtml}</div>` : ''}

                <!-- Main CTA Action: Open Project Interactive Graph -->
                <div style="margin-top: 8px;">
                    <button type="button" class="btn-action" onclick="openProjectGraphModal(${p.id})" style="width: 100%; box-sizing: border-box; background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); color: #ffffff; border: none; font-size: 0.82rem; font-weight: 700; padding: 8px 12px; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; box-shadow: 0 2px 8px rgba(99, 102, 241, 0.28); transition: all 0.2s ease;" onmouseover="this.style.opacity='0.95'" onmouseout="this.style.opacity='1'" title="Интерактивная схема этапов и связей">
                        <i class="fa-solid fa-diagram-project"></i> ⚡ Схема этапов и связей (${totalStages} ${stageWord})
                    </button>
                </div>

                <div style="margin-top: auto; padding-top: 0.5rem; border-top: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <div>
                        ${(isReadyForAccept && canAccept) ? `
                            <button type="button" class="btn-action" onclick="openProjectAcceptModal(${p.id})" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; font-weight: 700; font-size: 0.78rem; padding: 4px 11px; border-radius: 6px; border: none; cursor: pointer; box-shadow: 0 2px 6px rgba(16, 185, 129, 0.35);" title="Принять проект и подписать акт">
                                <i class="fa-solid fa-trophy"></i> Принять проект
                            </button>
                        ` : ''}
                        ${isCompleted ? `
                            <span style="font-size: 0.75rem; color: #16a34a; font-weight: 600;"><i class="fa-solid fa-medal"></i> Проект сдан и завершён</span>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/* ==========================================================
   PROJECT ACCEPTANCE & SIGN-OFF ACTIONS
   ========================================================== */

let currentAcceptProjectId = null;

async function openProjectAcceptModal(projectId) {
    if (!projectId) return;
    currentAcceptProjectId = projectId;
    let p = (allRoadmaps || []).find(item => item.id == projectId || String(item.id) === String(projectId));
    if (!p) {
        try {
            const res = await fetch(`/api/tasks/${projectId}`);
            if (res.ok) p = await res.json();
        } catch (e) {
            console.error("Error fetching project for acceptance:", e);
        }
    }
    if (!p) {
        showToast("Не удалось найти данные проекта для приёмки", "error");
        return;
    }

    if (!canAcceptProject(p)) {
        if (!currentPlannerUser) {
            openPinModal(p.author_name, () => {
                openProjectAcceptModal(projectId);
            });
            return;
        }
        showToast(`🔒 Принимать проект может автор (${p.author_name || '—'}), руководство завода или администратор`, "warning");
        return;
    }

    const idEl = document.getElementById("accept-project-id");
    const codeEl = document.getElementById("accept-project-code");
    const titleEl = document.getElementById("accept-project-title");
    const authorEl = document.getElementById("accept-project-author");
    const quarterEl = document.getElementById("accept-project-quarter");
    const commentEl = document.getElementById("accept-project-comment");

    if (idEl) idEl.value = projectId;
    if (codeEl) codeEl.textContent = p.code || (`TSK-${p.id}`);
    if (titleEl) titleEl.textContent = p.title || "";
    if (authorEl) authorEl.textContent = p.author_name || "Не указан";
    if (quarterEl) quarterEl.textContent = p.target_quarter || "Текущий";

    // Проверяем наличие фото ПОСЛЕ
    const hasAfterPhoto = Boolean(
        p.photo_link_after || 
        (p.photos && p.photos.after && p.photos.after.length > 0) ||
        (p.milestones && p.milestones.some(m => m.photo_link_after || (m.photos && m.photos.after && m.photos.after.length > 0)))
    );

    const noticeEl = document.getElementById("accept-project-photo-notice");
    const noticeText = document.getElementById("accept-project-photo-text");
    if (noticeEl && noticeText) {
        if (hasAfterPhoto) {
            noticeEl.style.background = "#f0fdf4";
            noticeEl.style.borderColor = "#bbf7d0";
            noticeEl.style.color = "#15803d";
            noticeText.innerHTML = "<b>Фотоотчет «ПОСЛЕ» прикреплен</b> и готов к проверке.";
        } else {
            noticeEl.style.background = "#fffbeb";
            noticeEl.style.borderColor = "#fde68a";
            noticeEl.style.color = "#b45309";
            noticeText.innerHTML = "<b>Внимание:</b> фото «ПОСЛЕ» еще не загружены. Рекомендуется прикрепить фотоотчет в деталях задачи.";
        }
    }

    if (commentEl) commentEl.value = "Проект выполнен в полном объеме, ключевые этапы реализованы.";

    const pinInput = document.getElementById("accept-project-pin");
    if (pinInput) {
        pinInput.value = (currentPlannerUser && currentPlannerUser.pin) ? currentPlannerUser.pin : "";
    }

    const modal = document.getElementById("project-accept-modal");
    if (modal) {
        modal.style.display = "flex";
        modal.classList.add("active");
    }
}

function closeProjectAcceptModal() {
    const modal = document.getElementById("project-accept-modal");
    if (modal) {
        modal.style.display = "none";
        modal.classList.remove("active");
    }
    currentAcceptProjectId = null;
}

async function submitProjectAcceptance() {
    if (!currentAcceptProjectId) return;
    const btn = document.getElementById("btn-accept-project-submit");
    const pinInput = document.getElementById("accept-project-pin");
    const commentInput = document.getElementById("accept-project-comment");

    const pin = (pinInput && pinInput.value) ? pinInput.value.trim() : "";
    const comment = (commentInput && commentInput.value) ? commentInput.value.trim() : "Проект официально принят";

    if (!pin) {
        alert("Пожалуйста, введите персональный PIN-код для подтверждения");
        if (pinInput) pinInput.focus();
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Подписание...`;
    }

    try {
        const res = await fetch(`/api/tasks/${currentAcceptProjectId}/accept`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                pin_code: pin,
                comment: comment,
                user_name: (currentPlannerUser && currentPlannerUser.name) ? currentPlannerUser.name : ""
            })
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || "Не удалось принять проект");
        }

        showToast("🏆 Проект успешно принят и завершён!", "success");
        closeProjectAcceptModal();
        loadRoadmaps();
    } catch (err) {
        console.error("Error accepting project:", err);
        alert("Ошибка приёмки проекта: " + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check-double"></i> Подписать и завершить проект`;
        }
    }
}

/* ==========================================================
   SUPPORTING HELPERS & ACTIONS FOR ROADMAP MILESTONES
   ========================================================== */

function buildAssigneeOptions(defaultAssignee) {
    const persons = getUniquePersons();
    const cleanDefault = (defaultAssignee || '').trim().toLowerCase();
    let html = `<option value="">-- Исполнитель --</option>`;
    persons.forEach(name => {
        const isSel = cleanDefault && name.toLowerCase().includes(cleanDefault);
        html += `<option value="${escapeHtml(name)}" ${isSel ? 'selected' : ''}>${escapeHtml(name)}</option>`;
    });
    return html;
}

function getDefaultQuickDateIso() {
    const d = new Date();
    const day = d.getDay();
    const isoDay = day === 0 ? 7 : day;
    const diff = 5 - isoDay;
    d.setDate(d.getDate() + (diff >= 0 ? diff : diff + 7));
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function handleInlineMilestoneKeydown(event, projectId) {
    if (event.key === 'Enter') {
        event.preventDefault();
        submitInlineMilestone(projectId);
    }
}

function submitInlineMilestone(projectId) {
    const input = document.getElementById(`inline-milestone-input-${projectId}`);
    const assigneeSelect = document.getElementById(`inline-milestone-assignee-${projectId}`);
    const dateInput = document.getElementById(`inline-milestone-date-${projectId}`);
    const btn = document.getElementById(`inline-milestone-btn-${projectId}`);

    const title = input ? input.value.trim() : '';
    if (!title) {
        if (input) input.focus();
        return;
    }

    const assignee = assigneeSelect ? assigneeSelect.value : '';
    const dateVal = dateInput ? dateInput.value : '';
    const dueDateStr = dateVal ? formatDateToRuStr(dateVal) : '';

    const authorName = (currentPlannerUser && currentPlannerUser.name) ? currentPlannerUser.name : (localStorage.getItem("tectum_current_user_name") || "Офис бережливого производства");

    ensureUserAuthorized(authorName, async (authSession) => {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
        }

        try {
            const payload = {
                parent_id: projectId,
                title: title,
                assignee_name: assignee,
                due_date_str: dueDateStr,
                author_name: authorName,
                pin_code: authSession ? authSession.pin : ""
            };

            const res = await fetch("/api/tasks/quick_milestone", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const data = await res.json();
                showToast(`Этап [${data.code}] добавлен! 🎯`);
                if (input) input.value = '';
                await loadRoadmaps();
                const refreshedInput = document.getElementById(`inline-milestone-input-${projectId}`);
                if (refreshedInput) refreshedInput.focus();
            } else {
                const err = await res.json();
                showToast(`⚠️ Ошибка: ${err.detail || 'Не удалось сохранить этап'}`);
            }
        } catch (e) {
            console.error("Error submitting inline milestone:", e);
            showToast("⚠️ Ошибка сети при добавлении этапа");
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i class="fa-solid fa-plus"></i>`;
            }
        }
    });
}

function openSubtaskQuickModal(projectId, editTaskId = null, parentMilestoneId = null) {
    const modal = document.getElementById("subtask-quick-modal");
    if (!modal) return;

    const project = allRoadmaps.find(p => p.id === projectId);
    const parentInfo = document.getElementById("subtask-modal-parent-info");
    const titleModal = document.getElementById("subtask-modal-title");
    const parentIdInp = document.getElementById("quick-subtask-parent-id");
    const editIdInp = document.getElementById("quick-subtask-edit-id");
    const titleInp = document.getElementById("quick-subtask-title");
    const assigneeSel = document.getElementById("quick-subtask-assignee");
    const dueDateInp = document.getElementById("quick-subtask-due-date");
    const dependsSel = document.getElementById("quick-subtask-depends");
    const commentInp = document.getElementById("quick-subtask-comment");

    const effectiveParentId = parentMilestoneId || projectId;
    parentIdInp.value = effectiveParentId;
    editIdInp.value = editTaskId || "";

    if (project) {
        parentInfo.textContent = `В проект [${project.code || 'TSK-' + project.id}] «${project.title}»`;
    } else {
        parentInfo.textContent = `Родительский проект #${projectId}`;
    }

    titleModal.textContent = editTaskId ? "Редактирование этапа" : "Новый этап проекта";

    // Setup Person Picker for Quick Subtask Modal (Rule 27: Cross-Tab Parity)
    const defaultAssignee = project ? (project.assignee_name || "") : "";
    let initialAssignee = defaultAssignee;
    if (editTaskId) {
        const milestone = project && project.milestones ? project.milestones.find(m => m.id === editTaskId) : null;
        if (milestone && milestone.assignee_name) initialAssignee = milestone.assignee_name;
    }
    setupQuickSubtaskAssigneePicker(initialAssignee);

    let initialDepIds = [];
    if (!editTaskId) {
        titleInp.value = "";
        commentInp.value = "";
        dueDateInp.value = getDefaultQuickDateIso();
    } else {
        const milestone = project && project.milestones ? project.milestones.find(m => m.id === editTaskId) : null;
        if (milestone) {
            titleInp.value = milestone.title || "";
            if (milestone.assignee_name) assigneeSel.value = milestone.assignee_name;
            commentInp.value = milestone.comment || "";
            if (milestone.depends_on_ids && milestone.depends_on_ids.length > 0) {
                initialDepIds = milestone.depends_on_ids;
            } else if (milestone.depends_on_id) {
                initialDepIds = [milestone.depends_on_id];
            } else if (milestone.depends_on && milestone.depends_on.id) {
                initialDepIds = [milestone.depends_on.id];
            }
        }
    }

    // Universal Multi-Blocker Picker (Rule 27: Cross-Tab Parity)
    renderMultiBlockerPicker("quick-subtask-blockers-picker-container", {
        pickerId: "quick-subtask-blockers",
        currentTaskId: editTaskId,
        selectedIds: initialDepIds,
        parentProjectId: projectId,
        allTasksList: (typeof allTasks !== 'undefined' && allTasks.length > 0) ? allTasks : (project ? (project.milestones || []) : [])
    });
    if (dependsSel) {
        dependsSel.value = initialDepIds.length > 0 ? initialDepIds[0] : "";
    }

    const extraContent = document.getElementById("quick-subtask-extra-content");
    const extraIcon = document.getElementById("quick-subtask-extra-icon");
    if (extraContent) extraContent.style.display = "none";
    if (extraIcon) extraIcon.style.transform = "rotate(0deg)";

    modal.style.display = "flex";
    setTimeout(() => {
        if (titleInp) titleInp.focus();
    }, 100);
}

function closeSubtaskQuickModal() {
    closeQuickSubtaskAssigneePopover();
    const modal = document.getElementById("subtask-quick-modal");
    if (modal) modal.style.display = "none";
}

function toggleQuickSubtaskExtra() {
    const content = document.getElementById("quick-subtask-extra-content");
    const icon = document.getElementById("quick-subtask-extra-icon");
    if (!content) return;
    const isHidden = content.style.display === "none" || !content.style.display;
    content.style.display = isHidden ? "flex" : "none";
    if (icon) icon.style.transform = isHidden ? "rotate(90deg)" : "rotate(0deg)";
}

function setQuickSubtaskPreset(preset) {
    const d = new Date();
    if (preset === 'today') {
        // today
    } else if (preset === 'this_fri') {
        const day = d.getDay();
        const isoDay = day === 0 ? 7 : day;
        d.setDate(d.getDate() + (5 - isoDay));
    } else if (preset === 'next_fri') {
        const day = d.getDay();
        const isoDay = day === 0 ? 7 : day;
        d.setDate(d.getDate() + (5 - isoDay) + 7);
    } else if (preset === 'month_end') {
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        d.setDate(lastDay.getDate());
    }
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dateInp = document.getElementById("quick-subtask-due-date");
    if (dateInp) dateInp.value = `${yyyy}-${mm}-${dd}`;
}

function onQuickSubtaskDateChanged() {
    // date changed handler
}

function handleQuickSubtaskModalKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (event.ctrlKey) {
            submitQuickSubtaskModal(true);
        } else {
            submitQuickSubtaskModal(false);
        }
    }
}

function submitQuickSubtaskModal(keepOpen = false) {
    const parentId = parseInt(document.getElementById("quick-subtask-parent-id").value, 10);
    const editId = document.getElementById("quick-subtask-edit-id").value;
    const titleInp = document.getElementById("quick-subtask-title");
    const assigneeSel = document.getElementById("quick-subtask-assignee");
    const dateInp = document.getElementById("quick-subtask-due-date");
    const dependsSel = document.getElementById("quick-subtask-depends");
    const commentInp = document.getElementById("quick-subtask-comment");

    const btnClose = document.getElementById("btn-save-subtask-close");
    const btnMore = document.getElementById("btn-save-subtask-and-more");

    const title = titleInp ? titleInp.value.trim() : "";
    if (!title) {
        showToast("⚠️ Введите суть этапа");
        if (titleInp) titleInp.focus();
        return;
    }

    const assigneeInp = document.getElementById("quick-subtask-assignee-input");
    const assignee = assigneeInp ? assigneeInp.value.trim() : (assigneeSel ? assigneeSel.value : "");
    const dateVal = dateInp ? dateInp.value : "";
    const dueDateStr = dateVal ? formatDateToRuStr(dateVal) : "";
    const selectedBlockerIds = getMultiBlockerSelectedIds("quick-subtask-blockers");
    const dependsOnId = selectedBlockerIds.length > 0 ? selectedBlockerIds[0] : (dependsSel && dependsSel.value ? parseInt(dependsSel.value, 10) : null);
    const comment = commentInp ? commentInp.value.trim() : "";

    const authorName = (currentPlannerUser && currentPlannerUser.name) ? currentPlannerUser.name : (localStorage.getItem("tectum_current_user_name") || "Офис бережливого производства");

    ensureUserAuthorized(authorName, async (authSession) => {
        if (btnClose) btnClose.disabled = true;
        if (btnMore) btnMore.disabled = true;

        try {
            if (editId) {
                const updatePayload = {
                    title: title,
                    assignee_name: assignee,
                    due_date_str: dueDateStr,
                    depends_on_id: dependsOnId,
                    depends_on_ids: selectedBlockerIds,
                    comment: comment,
                    pin_code: authSession ? authSession.pin : ""
                };
                const res = await fetch(`/api/tasks/${editId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(updatePayload)
                });
                if (res.ok) {
                    showToast("Этап успешно обновлен! 🎯");
                    closeSubtaskQuickModal();
                    loadRoadmaps();
                } else {
                    const err = await res.json();
                    showToast(`⚠️ Ошибка: ${err.detail || 'Не удалось обновить'}`);
                }
            } else {
                const createPayload = {
                    parent_id: parentId,
                    title: title,
                    assignee_name: assignee,
                    due_date_str: dueDateStr,
                    depends_on_id: dependsOnId,
                    depends_on_ids: selectedBlockerIds,
                    comment: comment,
                    author_name: authorName,
                    pin_code: authSession ? authSession.pin : ""
                };
                const res = await fetch("/api/tasks/quick_milestone", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(createPayload)
                });
                if (res.ok) {
                    const data = await res.json();
                    showToast(`Этап [${data.code}] сохранен! 🎯`);
                    if (keepOpen) {
                        if (titleInp) {
                            titleInp.value = "";
                            titleInp.focus();
                        }
                        if (commentInp) commentInp.value = "";
                        renderMultiBlockerPicker("quick-subtask-blockers-picker-container", {
                            pickerId: "quick-subtask-blockers",
                            currentTaskId: null,
                            selectedIds: [],
                            parentProjectId: parentId,
                            allTasksList: (typeof allTasks !== 'undefined' && allTasks.length > 0) ? allTasks : []
                        });
                        loadRoadmaps();
                    } else {
                        closeSubtaskQuickModal();
                        loadRoadmaps();
                    }
                } else {
                    const err = await res.json();
                    showToast(`⚠️ Ошибка: ${err.detail || 'Не удалось сохранить'}`);
                }
            }
        } catch (e) {
            console.error("Error saving quick subtask:", e);
            showToast("⚠️ Ошибка сети при сохранении этапа");
        } finally {
            if (btnClose) btnClose.disabled = false;
            if (btnMore) btnMore.disabled = false;
        }
    });
}

/* ==========================================================
   INTERACTIVE ROADMAP ACTIONS (1-CLICK TOGGLE & QUICK ADD)
   ========================================================== */

function showQuickAddSubtask(milestoneId) {
    const box = document.getElementById(`quick-add-box-${milestoneId}`);
    const btnWrap = document.getElementById(`quick-add-btn-wrap-${milestoneId}`);
    const input = document.getElementById(`quick-add-input-${milestoneId}`);
    if (box) box.style.display = "block";
    if (btnWrap) btnWrap.style.display = "none";
    if (input) {
        input.value = "";
        input.focus();
    }
}

function hideQuickAddSubtask(milestoneId) {
    const box = document.getElementById(`quick-add-box-${milestoneId}`);
    const btnWrap = document.getElementById(`quick-add-btn-wrap-${milestoneId}`);
    if (box) box.style.display = "none";
    if (btnWrap) btnWrap.style.display = "flex";
}

function handleQuickAddKeydown(event, milestoneId, projectId) {
    if (event.key === "Enter") {
        event.preventDefault();
        submitQuickAddSubtask(milestoneId, projectId);
    } else if (event.key === "Escape") {
        event.preventDefault();
        hideQuickAddSubtask(milestoneId);
    }
}

async function submitQuickAddSubtask(milestoneId, projectId) {
    const input = document.getElementById(`quick-add-input-${milestoneId}`);
    const text = input ? input.value.trim() : "";
    if (!text) {
        hideQuickAddSubtask(milestoneId);
        return;
    }

    const project = (allRoadmaps || []).find(p => p.id === projectId);
    const requiredUser = (currentPlannerUser && currentPlannerUser.name) ? currentPlannerUser.name : (project ? project.author_name : null);

    ensureUserAuthorized(requiredUser, async (authSession) => {
        const authorName = authSession ? authSession.name : "Офис бережливого производства";
        const payload = {
            title: text,
            title_kz: null,
            zone: "Дорожная карта",
            task_type: "weekly",
            parent_id: milestoneId,
            author_name: authorName,
            assignee_name: authorName,
            status: "🟡 В работе",
            month_label: currentMonth,
            week_label: currentWeek,
            pin_code: authSession ? authSession.pin : "",
            user_name: authorName
        };

        try {
            const res = await fetch("/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                showToast("Подзадача создана!");
                hideQuickAddSubtask(milestoneId);
                loadRoadmaps();
            } else {
                const err = await res.json();
                alert("Ошибка создания: " + (err.detail || "Не удалось сохранить подзадачу"));
            }
        } catch (e) {
            console.error("Quick add subtask error:", e);
            alert("Ошибка сети при создании подзадачи");
        }
    }, project, "edit_project");
}

async function quickToggleRoadmapSubtask(taskId, currentStatus, event) {
    if (event) event.stopPropagation();
    const isDone = currentStatus === "🟢 Выполнено";
    const nextStatus = isDone ? "🟡 В работе" : "🟢 Выполнено";
    const defaultComment = isDone ? "" : "Выполнено через дорожную карту";

    // Находим задачу в кэше
    let task = null;
    for (const r of (allRoadmaps || [])) {
        for (const m of (r.milestones || [])) {
            const found = (m.subtasks || []).find(s => s.id === taskId);
            if (found) { task = found; break; }
        }
        if (task) break;
    }
    const requiredUser = task ? (task.assignee_name || task.author_name) : null;

    ensureUserAuthorized(requiredUser, async (authSession) => {
        // Оптимистичный UI: находим кнопку чекбокса
        const rowEl = document.getElementById(`roadmap-subtask-${taskId}`);
        if (rowEl) {
            const btn = rowEl.querySelector('.roadmap-check-btn');
            if (btn) btn.classList.toggle('checked');
        }

        try {
            const res = await fetch(`/api/tasks/${taskId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    status: nextStatus,
                    comment: defaultComment,
                    pin_code: authSession ? authSession.pin : "",
                    user_name: authSession ? authSession.name : ""
                })
            });

            if (res.ok) {
                showToast(isDone ? "Статус: В работе" : "Задача выполнена! 🎯");
                loadRoadmaps();
            } else {
                const err = await res.json();
                alert("Ошибка изменения статуса: " + (err.detail || "Не удалось изменить статус"));
                loadRoadmaps();
            }
        } catch (e) {
            console.error("Quick toggle error:", e);
            loadRoadmaps();
        }
    }, task, "interact");
}

async function quickToggleRoadmapMilestone(milestoneId, currentStatus, currentProgress, event) {
    if (event) event.stopPropagation();
    const isDone = (currentStatus && currentStatus.includes("Выполнено")) || currentProgress === 100;
    const nextStatus = isDone ? "🟡 В работе" : "🟢 Выполнено";
    const nextProgress = isDone ? 0 : 100;
    const defaultComment = isDone ? "" : "Этап завершён";

    let milestone = null;
    let parentProject = null;
    for (const r of (allRoadmaps || [])) {
        const found = (r.milestones || []).find(m => m.id === milestoneId);
        if (found) { milestone = found; parentProject = r; break; }
    }
    const requiredUser = milestone ? (milestone.assignee_name || milestone.author_name || (parentProject ? parentProject.author_name : null)) : null;

    ensureUserAuthorized(requiredUser, async (authSession) => {
        try {
            const res = await fetch(`/api/tasks/${milestoneId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    status: nextStatus,
                    progress: nextProgress,
                    comment: defaultComment,
                    pin_code: authSession ? authSession.pin : "",
                    user_name: authSession ? authSession.name : ""
                })
            });

            if (res.ok) {
                showToast(isDone ? "Этап возвращен в работу" : "Ключевой этап завершен! 🎉");
                loadRoadmaps();
            } else {
                const err = await res.json();
                alert("Ошибка: " + (err.detail || "Не удалось обновить статус этапа"));
                loadRoadmaps();
            }
        } catch (e) {
            console.error("Quick milestone toggle error:", e);
            loadRoadmaps();
        }
    }, milestone || parentProject, "interact");
}

async function loadTaskTags() {
    try {
        const res = await fetch("/api/tasks/tags");
        if (res.ok) {
            allTagsList = await res.json();
            renderTagsCloud(allTagsList);
            const badge = document.getElementById("tags-count-badge");
            if (badge) badge.textContent = allTagsList.length;
        }
    } catch (e) {
        console.error("Error loading task tags:", e);
    }
}

function renderTagsCloud(tags) {
    const container = document.getElementById("tags-cloud-items");
    if (!container) return;

    if (!tags || tags.length === 0) {
        container.innerHTML = `<span style="font-size: 0.8rem; color: #94a3b8;">Нет активных тегов</span>`;
        return;
    }

    container.innerHTML = `
        <button type="button" class="filter-chip ${currentTagFilter === 'all' ? 'active' : ''}" onclick="filterByTag('all')">
            Все теги
        </button>
    ` + tags.map(t => {
        const isActive = currentTagFilter === t.tag;
        return `
            <button type="button" class="filter-chip ${isActive ? 'active' : ''}" onclick="filterByTag('${t.tag}')" style="font-family: monospace;">
                ${t.tag} <span style="background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 8px; font-size: 0.7rem;">${t.count}</span>
            </button>
        `;
    }).join('');
}

function toggleTagsCloudBar() {
    const bar = document.getElementById("tags-cloud-bar");
    if (!bar) return;
    bar.style.display = (bar.style.display === "none" || bar.style.display === "") ? "flex" : "none";
}

function filterByTag(tag) {
    currentTagFilter = tag;
    renderTagsCloud(allTagsList);
    loadTasks();
}

function applyDepartmentFilter(dept) {
    if (currentHorizon !== "services") {
        switchHorizon("services");
    }
    
    currentDepartmentService = (currentDepartmentService === dept) ? "all" : dept;
    document.querySelectorAll("#quick-chips-group .filter-chip").forEach(c => c.classList.remove("active"));
    
    if (currentDepartmentService !== "all") {
        const btnIdMap = { "ОГМ": "chip-zone-ogm", "ОГЭ": "chip-zone-oge", "Технологи": "chip-zone-tech", "ОТК": "chip-zone-qcd" };
        const activeBtn = document.getElementById(btnIdMap[currentDepartmentService]);
        if (activeBtn) activeBtn.classList.add("active");
    } else {
        const allBtn = document.getElementById("chip-all");
        if (allBtn) allBtn.classList.add("active");
    }
    loadTasks();
}

function toggleDocFilter() {
    filterHasDocOnly = !filterHasDocOnly;
    const btn = document.getElementById("btn-filter-hasdoc");
    if (btn) {
        if (filterHasDocOnly) {
            btn.classList.add("btn-backlog-active");
            btn.innerHTML = `<i class="fa-solid fa-file-lines" style="color: #1d4ed8;"></i> <span>Только с регламентами (Вкл)</span>`;
        } else {
            btn.classList.remove("btn-backlog-active");
            btn.innerHTML = `<i class="fa-solid fa-file-lines" style="color: #2563eb;"></i> <span>С регламентами</span>`;
        }
    }
    loadTasks();
}

function onTaskTypeChange(taskType) {
    const deptInput = document.getElementById("task-department-input");
    const roadmapRow = document.getElementById("task-roadmap-fields-row");
    const zoneSelect = document.getElementById("task-zone-input");

    if (taskType === "roadmap") {
        if (roadmapRow) roadmapRow.style.display = "grid";
        if (deptInput) deptInput.style.display = "block";
    } else if (taskType === "service_plan") {
        if (roadmapRow) roadmapRow.style.display = "none";
        if (deptInput) {
            deptInput.style.display = "block";
            if (!deptInput.value) deptInput.value = "ОГМ";
        }
        if (zoneSelect) zoneSelect.value = (deptInput && deptInput.value) ? deptInput.value : "ОГМ";
    } else if (taskType === "tech_council") {
        if (roadmapRow) roadmapRow.style.display = "none";
        if (zoneSelect) zoneSelect.value = "Техсовет";
    } else if (taskType === "quality_day") {
        if (roadmapRow) roadmapRow.style.display = "none";
        if (zoneSelect) zoneSelect.value = "День качества";
    } else if (taskType === "milestone") {
        if (roadmapRow) roadmapRow.style.display = "none";
        if (deptInput) deptInput.style.display = "block";
    } else {
        // weekly
        if (roadmapRow) roadmapRow.style.display = "none";
        if (zoneSelect && (zoneSelect.value === "Техсовет" || zoneSelect.value === "День качества")) {
            zoneSelect.value = "Бережливое производство";
        }
    }
    if (zoneSelect && typeof updateTaskZoneDisplay === 'function') {
        updateTaskZoneDisplay(zoneSelect.value);
    }
}

function addTagToModalInput(tag) {
    const input = document.getElementById("task-tags-input");
    if (!input) return;
    let curr = input.value.trim();
    if (!curr) {
        input.value = tag;
    } else {
        const tags = curr.split(',').map(t => t.trim());
        if (!tags.includes(tag)) {
            tags.push(tag);
            input.value = tags.join(', ');
        }
    }
}

async function loadCalendarStructure() {
    try {
        const res = await fetch("/api/tasks/weeks");
        if (res.ok) {
            const data = await res.json();
            allWeeksStructure = data.structure || {};
            
            // Populate Month selector with all 12 months + "all"
            const monthSelect = document.getElementById("filter-month");
            const urlParams = new URLSearchParams(window.location.search);
            const urlMonth = urlParams.get("month");
            const urlWeek = urlParams.get("week");

            if (monthSelect && data.months) {
                const curVal = monthSelect.value;
                monthSelect.innerHTML = `<option value="all">🌐 За всё время</option>` + 
                    data.months.map(m => `<option value="${m}">${m}</option>`).join('');
                
                if (urlMonth && (urlMonth === "all" || data.months.includes(urlMonth))) {
                    monthSelect.value = urlMonth;
                    currentMonth = urlMonth;
                } else if (curVal && curVal !== "all" && data.months.includes(curVal)) {
                    monthSelect.value = curVal;
                    currentMonth = curVal;
                } else if (data.default_month) {
                    monthSelect.value = data.default_month;
                    currentMonth = data.default_month;
                }
            }

            // Only update week options if needed, preserving active selected week
            const activeWeek = urlWeek || (currentWeek && currentWeek !== "all" ? currentWeek : null) || data.default_week || null;
            onMonthChange(activeWeek);
        }
    } catch (e) {
        console.error("Error loading calendar structure:", e);
    }
}

function generateClientFallbackWeeks(monthName) {
    // Dynamic Mon-Fri fallback calculation
    const monthsRu = [
        "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
        "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
    ];
    let mIdx = 7; // default August (0-indexed)
    let year = 2026;
    if (monthName) {
        const parts = monthName.split(' ');
        const found = monthsRu.indexOf(parts[0]);
        if (found !== -1) mIdx = found;
        if (parts[1]) year = parseInt(parts[1], 10) || 2026;
    }

    const weeks = [];
    const cur = new Date(year, mIdx, 1);
    const nextMonth = new Date(year, mIdx + 1, 1);

    // Monday on or after 1st of month:
    let day = cur.getDay(); // 0 is Sun, 1 is Mon...
    let diff = (day === 0) ? 1 : (day === 1 ? 0 : (8 - day));
    let curMonday = new Date(year, mIdx, 1 + diff);

    let wIdx = 1;
    while (curMonday < nextMonth) {
        const fri = new Date(curMonday);
        fri.setDate(curMonday.getDate() + 4);

        const sm = String(curMonday.getMonth() + 1).padStart(2, '0');
        const sd = String(curMonday.getDate()).padStart(2, '0');
        const em = String(fri.getMonth() + 1).padStart(2, '0');
        const ed = String(fri.getDate()).padStart(2, '0');

        weeks.push(`Неделя ${wIdx} (${sd}.${sm} - ${ed}.${em})`);
        wIdx++;
        curMonday.setDate(curMonday.getDate() + 7);
    }
    return weeks;
}

function onMonthChange(forcedWeek = null) {
    const monthSelect = document.getElementById("filter-month");
    const weekSelect = document.getElementById("filter-week");
    if (!monthSelect || !weekSelect) return;

    currentMonth = monthSelect.value;

    if (currentMonth === "all") {
        weekSelect.innerHTML = `<option value="all" selected>🌐 Все недели (за всё время)</option>`;
        weekSelect.value = "all";
        currentWeek = "all";
        if (typeof syncAppleTitleHeader === 'function') syncAppleTitleHeader();
        syncDateToolbarUI();
        if (!isInitialLoading) {
            loadTasks();
        }
        return;
    }

    let weeks = allWeeksStructure[currentMonth] || [];

    if (weeks.length === 0) {
        // Динамический фоллбэк генерации недель строго (Пн-Пт)
        weeks = generateClientFallbackWeeks(currentMonth);
    }
    
    // В начало списка добавляем пресеты: «Все активные», «Ближайшие 2 недели», «Весь месяц»
    let optionsHtml = `
        <option value="open_active">🌐 Все активные (в работе и перенесенные)</option>
        <option value="next_2_weeks">📆 Ближайшие 2 недели</option>
        <option value="all">📅 Весь месяц (все недели)</option>
    ` + weeks.map(w => `<option value="${w}">${w}</option>`).join('');

    weekSelect.innerHTML = optionsHtml;
    let targetWeek = null;
    if (forcedWeek) {
        if (['all', 'open_active', 'next_2_weeks'].includes(forcedWeek) || weeks.includes(forcedWeek)) {
            targetWeek = forcedWeek;
        } else {
            const forcedDates = forcedWeek.split('(')[1]?.split(')')[0];
            if (forcedDates) {
                targetWeek = weeks.find(w => w.includes(forcedDates.trim()));
            }
        }
    }

    if (targetWeek) {
        weekSelect.value = targetWeek;
        currentWeek = targetWeek;
    } else {
        // Пытаемся найти неделю, соответствующую сегодняшнему дню
        let detectedWeek = null;
        try {
            const today = new Date();
            const year = today.getFullYear();
            for (const w of weeks) {
                const datesPart = w.split('(')[1]?.split(')')[0];
                if (datesPart) {
                    const [sStr, eStr] = datesPart.split(' - ');
                    const [sd, sm] = sStr.trim().split('.').map(Number);
                    const [ed, em] = eStr.trim().split('.').map(Number);
                    const wStart = new Date(year, sm - 1, sd, 0, 0, 0);
                    let endYear = year;
                    if (sm === 12 && em === 1) endYear = year + 1;
                    const wEnd = new Date(endYear, em - 1, ed, 23, 59, 59);
                    // Расширяем до конца воскресенья (еще +2 дня от пятницы)
                    const wSun = new Date(wEnd);
                    wSun.setDate(wSun.getDate() + 2, 23, 59, 59);
                    if (today >= wStart && today <= wSun) {
                        detectedWeek = w;
                        break;
                    }
                }
            }
        } catch (err) {
            console.warn("Could not auto-detect current week:", err);
        }

        const chosenWeek = detectedWeek || weeks[0] || "all";
        weekSelect.value = chosenWeek;
        currentWeek = chosenWeek;
    }
    if (typeof syncAppleTitleHeader === 'function') syncAppleTitleHeader();
    updateChipsVisualState();
    syncDateToolbarUI();
    if (!isInitialLoading) {
        updateUrlParams();
        loadTasks();
    }
    // Асинхронно подтягиваем статистику задач по неделям
    loadWeeksSummaryData();
}

async function loadWeeksSummaryData() {
    const weekSelect = document.getElementById("filter-week");
    if (!weekSelect || currentMonth === "all") return;

    try {
        let url = `/api/tasks/weeks_summary?month=${encodeURIComponent(currentMonth)}`;
        if (currentHorizon === "weekly") {
            url += `&task_type=weekly`;
        } else if (currentHorizon === "services") {
            url += `&task_type=service_plan`;
            if (currentDepartmentService !== "all") {
                url += `&department_service=${encodeURIComponent(currentDepartmentService)}`;
            }
        } else if (currentHorizon === "tech_council") {
            url += `&task_type=tech_council`;
        } else if (currentHorizon === "quality_day") {
            url += `&task_type=quality_day`;
        }

        if (myTasksFilterActive && currentPlannerUser && currentPlannerUser.name) {
            url += `&my_person=${encodeURIComponent(currentPlannerUser.name)}`;
        }

        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const weeksSummary = data.weeks || {};

        Array.from(weekSelect.options).forEach(opt => {
            const rawVal = opt.value;
            if (rawVal === "all") {
                const totalM = data.total_tasks || 0;
                opt.textContent = `📅 Весь месяц (${totalM} задач)`;
            } else if (rawVal === "open_active") {
                const totalAct = data.total_active || 0;
                opt.textContent = `🌐 Все активные (${totalAct} задач)`;
            } else if (rawVal === "next_2_weeks") {
                opt.textContent = `📆 Ближайшие 2 недели`;
            } else if (weeksSummary[rawVal]) {
                const st = weeksSummary[rawVal];
                const actCount = st.active || 0;
                const totCount = st.total || 0;
                opt.textContent = `${rawVal} · ${totCount} зад. (${actCount} акт.)`;
            }
        });
        syncDateToolbarUI();
    } catch (e) {
        console.warn("Weeks summary load error:", e);
    }
}

function onWeekSelectChange(val) {
    currentWeek = val;
    const weekSelect = document.getElementById("filter-week");
    if (weekSelect) weekSelect.value = val;
    updateChipsVisualState();
    syncDateToolbarUI();
    updateUrlParams();
    if (typeof syncAppleTitleHeader === 'function') syncAppleTitleHeader();
    loadTasks();
}

function prevWeek() {
    const weekSelect = document.getElementById("filter-week");
    const monthSelect = document.getElementById("filter-month");
    if (!weekSelect || !monthSelect) return;

    const actualWeekOptions = Array.from(weekSelect.options).filter(o => !['all', 'open_active', 'next_2_weeks'].includes(o.value));
    if (actualWeekOptions.length === 0) return;

    const currentVal = weekSelect.value;
    const curIdx = actualWeekOptions.findIndex(o => o.value === currentVal);

    if (curIdx > 0) {
        const prevW = actualWeekOptions[curIdx - 1].value;
        onWeekSelectChange(prevW);
    } else if (curIdx === 0 || curIdx === -1) {
        const monthsRu = [
            "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
            "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
        ];
        const curMVal = monthSelect.value;
        const [mName, mYearStr] = curMVal.split(' ');
        let mYear = parseInt(mYearStr, 10) || 2026;
        let mIdx = monthsRu.indexOf(mName);
        if (mIdx !== -1) {
            let prevMIdx = mIdx - 1;
            let prevYear = mYear;
            if (prevMIdx < 0) {
                prevMIdx = 11;
                prevYear -= 1;
            }
            const prevMonthName = `${monthsRu[prevMIdx]} ${prevYear}`;
            if (allWeeksStructure[prevMonthName] || Array.from(monthSelect.options).some(o => o.value === prevMonthName)) {
                monthSelect.value = prevMonthName;
                currentMonth = prevMonthName;
                const prevMonthWeeks = allWeeksStructure[prevMonthName] || generateClientFallbackWeeks(prevMonthName);
                const targetW = prevMonthWeeks.length > 0 ? prevMonthWeeks[prevMonthWeeks.length - 1] : "all";
                onMonthChange(targetW);
                showToast(`Переключено на ${prevMonthName}`);
            }
        }
    }
}

function nextWeek() {
    const weekSelect = document.getElementById("filter-week");
    const monthSelect = document.getElementById("filter-month");
    if (!weekSelect || !monthSelect) return;

    const actualWeekOptions = Array.from(weekSelect.options).filter(o => !['all', 'open_active', 'next_2_weeks'].includes(o.value));
    if (actualWeekOptions.length === 0) return;

    const currentVal = weekSelect.value;
    const curIdx = actualWeekOptions.findIndex(o => o.value === currentVal);

    if (curIdx >= 0 && curIdx < actualWeekOptions.length - 1) {
        const nextW = actualWeekOptions[curIdx + 1].value;
        onWeekSelectChange(nextW);
    } else if (curIdx === actualWeekOptions.length - 1 || curIdx === -1) {
        const monthsRu = [
            "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
            "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
        ];
        const curMVal = monthSelect.value;
        const [mName, mYearStr] = curMVal.split(' ');
        let mYear = parseInt(mYearStr, 10) || 2026;
        let mIdx = monthsRu.indexOf(mName);
        if (mIdx !== -1) {
            let nextMIdx = mIdx + 1;
            let nextYear = mYear;
            if (nextMIdx > 11) {
                nextMIdx = 0;
                nextYear += 1;
            }
            const nextMonthName = `${monthsRu[nextMIdx]} ${nextYear}`;
            if (allWeeksStructure[nextMonthName] || Array.from(monthSelect.options).some(o => o.value === nextMonthName)) {
                monthSelect.value = nextMonthName;
                currentMonth = nextMonthName;
                const nextMonthWeeks = allWeeksStructure[nextMonthName] || generateClientFallbackWeeks(nextMonthName);
                const targetW = nextMonthWeeks.length > 0 ? nextMonthWeeks[0] : "all";
                onMonthChange(targetW);
                showToast(`Переключено на ${nextMonthName}`);
            }
        }
    }
}

function resetToCurrentWeek() {
    const today = new Date();
    const year = today.getFullYear();
    let targetMonth = null;
    let targetWeek = null;

    // Сквозной поиск по всей структуре года (все месяцы и недели)
    const structure = (allWeeksStructure && Object.keys(allWeeksStructure).length > 0)
        ? allWeeksStructure
        : {};

    for (const [mName, weeksList] of Object.entries(structure)) {
        if (!Array.isArray(weeksList)) continue;
        const parts = mName.split(' ');
        const mYear = parseInt(parts[1], 10) || year;

        for (const w of weeksList) {
            try {
                const datesPart = w.split('(')[1]?.split(')')[0];
                if (!datesPart) continue;
                const [sStr, eStr] = datesPart.split(' - ');
                const [sd, sm] = sStr.trim().split('.').map(Number);
                const [ed, em] = eStr.trim().split('.').map(Number);

                let startYear = mYear;
                let endYear = mYear;
                if (sm === 12 && em === 1) endYear = mYear + 1;

                const wStart = new Date(startYear, sm - 1, sd, 0, 0, 0);
                const wEnd = new Date(endYear, em - 1, ed, 23, 59, 59);
                // Расширяем до конца воскресенья (+2 дня от пятницы)
                const wSun = new Date(wEnd);
                wSun.setDate(wSun.getDate() + 2);
                wSun.setHours(23, 59, 59, 999);

                if (today >= wStart && today <= wSun) {
                    targetMonth = mName;
                    targetWeek = w;
                    break;
                }
            } catch (e) {
                // ignore parsing error
            }
        }
        if (targetMonth && targetWeek) break;
    }

    // Фоллбэк, если не найдено по точным датам
    if (!targetMonth) {
        const monthsRu = [
            "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
            "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
        ];
        targetMonth = `${monthsRu[today.getMonth()]} ${year}`;
    }

    const monthSelect = document.getElementById("filter-month");
    if (monthSelect) {
        monthSelect.value = targetMonth;
        currentMonth = targetMonth;
    }
    onMonthChange(targetWeek);
    updateUrlParams();
    showToast("⚡ Переключено на текущую неделю");
}

function setWeekScopePreset(preset) {
    if (preset === 'whole_month') {
        onWeekSelectChange('all');
    } else if (preset === 'all_active') {
        onWeekSelectChange('open_active');
    } else if (preset === 'next_2_weeks') {
        onWeekSelectChange('next_2_weeks');
    } else if (preset === 'this_week') {
        resetToCurrentWeek();
    } else if (preset === 'next_week') {
        resetToCurrentWeek();
        setTimeout(() => nextWeek(), 100);
    }
}

/* ==========================================================
   INTERACTIVE CUSTOM DATE RANGE PICKER
   ========================================================== */
function toggleDateRangePopover(e) {
    if (e) e.stopPropagation();
    const pop = document.getElementById("date-range-popover");
    if (!pop) return;
    const isShown = pop.style.display === "block";
    pop.style.display = isShown ? "none" : "block";
    if (!isShown) {
        const df = document.getElementById("custom-date-from");
        const dt = document.getElementById("custom-date-to");
        if (df && customDateFrom) df.value = customDateFrom;
        if (dt && customDateTo) dt.value = customDateTo;
    }
}

function closeDateRangePopover() {
    const pop = document.getElementById("date-range-popover");
    if (pop) pop.style.display = "none";
}

function applyQuickDatePreset(preset) {
    const today = new Date();
    let start = new Date(today);
    let end = new Date(today);

    if (preset === '7d') {
        end.setDate(today.getDate() + 7);
    } else if (preset === '14d') {
        end.setDate(today.getDate() + 14);
    } else if (preset === 'this_month') {
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    } else if (preset === 'next_month') {
        start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        end = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    }

    const formatYmd = d => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const df = document.getElementById("custom-date-from");
    const dt = document.getElementById("custom-date-to");
    if (df) df.value = formatYmd(start);
    if (dt) dt.value = formatYmd(end);
}

function applyCustomDateRange() {
    const df = document.getElementById("custom-date-from");
    const dt = document.getElementById("custom-date-to");
    const valFrom = df ? df.value.trim() : "";
    const valTo = dt ? dt.value.trim() : "";

    if (!valFrom && !valTo) {
        resetCustomDateRange();
        return;
    }

    customDateFrom = valFrom || null;
    customDateTo = valTo || null;

    updateDateRangeBtnUI();
    closeDateRangePopover();
    loadTasks();
}

function resetCustomDateRange() {
    customDateFrom = null;
    customDateTo = null;
    const df = document.getElementById("custom-date-from");
    const dt = document.getElementById("custom-date-to");
    if (df) df.value = "";
    if (dt) dt.value = "";
    updateDateRangeBtnUI();
    closeDateRangePopover();
    loadTasks();
}

function updateDateRangeBtnUI() {
    const btn = document.getElementById("btn-custom-date-range");
    const lbl = document.getElementById("date-range-btn-label");
    const ind = document.getElementById("date-range-active-indicator");
    if (!btn || !lbl) return;

    if (customDateFrom || customDateTo) {
        btn.classList.add("active");
        if (ind) ind.style.display = "inline-block";
        const formatDm = s => {
            if (!s) return "";
            const parts = s.split('-');
            return parts.length === 3 ? `${parts[2]}.${parts[1]}` : s;
        };
        if (customDateFrom && customDateTo) {
            lbl.textContent = `📅 ${formatDm(customDateFrom)} - ${formatDm(customDateTo)}`;
        } else if (customDateFrom) {
            lbl.textContent = `📅 от ${formatDm(customDateFrom)}`;
        } else {
            lbl.textContent = `📅 до ${formatDm(customDateTo)}`;
        }
    } else {
        btn.classList.remove("active");
        if (ind) ind.style.display = "none";
        lbl.textContent = "Диапазон дат";
    }
}

// Закрытие поповера при клике вне его области
document.addEventListener("click", function(e) {
    const pop = document.getElementById("date-range-popover");
    const btn = document.getElementById("btn-custom-date-range");
    if (pop && pop.style.display === "block") {
        if (!pop.contains(e.target) && (!btn || !btn.contains(e.target))) {
            pop.style.display = "none";
        }
    }
});

function updateWeekPresetButtonsState() {
    const curW = currentWeek || '';
    const btnThisWeek = document.getElementById('btn-preset-this-week');
    const btnNextWeek = document.getElementById('btn-preset-next-week');
    const btn2Weeks = document.getElementById('btn-preset-2-weeks');
    const btnMonth = document.getElementById('btn-preset-month');

    [btnThisWeek, btnNextWeek, btn2Weeks, btnMonth].forEach(btn => {
        if (btn) btn.classList.remove('active');
    });

    if (curW === 'all') {
        if (btnMonth) btnMonth.classList.add('active');
    } else if (curW === 'next_2_weeks') {
        if (btn2Weeks) btn2Weeks.classList.add('active');
    } else {
        try {
            const today = new Date();
            const year = today.getFullYear();
            const datesPart = curW.split('(')[1]?.split(')')[0];
            if (datesPart) {
                const [sStr, eStr] = datesPart.split(' - ');
                const [sd, sm] = sStr.trim().split('.').map(Number);
                const [ed, em] = eStr.trim().split('.').map(Number);
                const wStart = new Date(year, sm - 1, sd, 0, 0, 0);
                let endYear = year;
                if (sm === 12 && em === 1) endYear = year + 1;
                const wEnd = new Date(endYear, em - 1, ed, 23, 59, 59);
                const wSun = new Date(wEnd);
                wSun.setDate(wSun.getDate() + 2, 23, 59, 59);

                if (today >= wStart && today <= wSun) {
                    if (btnThisWeek) btnThisWeek.classList.add('active');
                }
            }
        } catch (e) {}
    }
}

async function loadPlannerDropdownData() {
    try {
        const [empRes, zoneRes] = await Promise.all([
            fetch("/api/planner/employees"),
            fetch("/api/planner/zones")
        ]);
        if (empRes.ok) {
            allPlannerEmployees = await empRes.json();
            try {
                localStorage.setItem("tectum_planner_employees_cache", JSON.stringify(allPlannerEmployees));
            } catch (e) {}
        }
        if (zoneRes.ok) {
            allPlannerZones = await zoneRes.json();
            try {
                localStorage.setItem("tectum_planner_zones_cache", JSON.stringify(allPlannerZones));
            } catch (e) {}
        }
    } catch (e) {
        console.error("Error loading planner settings:", e);
    }
    populateDropdowns();
}

function getUniquePersons() {
    if (allPlannerEmployees && allPlannerEmployees.length > 0) {
        return allPlannerEmployees.filter(e => e.is_active !== false).map(e => e.name);
    }
    return CORE_NAMES;
}

function getPlannerZones() {
    if (allPlannerZones && allPlannerZones.length > 0) {
        return allPlannerZones.filter(z => z.is_active !== false).map(z => z.name);
    }
    return [
        "Бережливое производство",
        "Техсовет",
        "День качества",
        "Ремонт",
        "Уборка",
        "Производство",
        "Отчетность",
        "Документация",
        "Цифровизация",
        "Обучение",
        "ОГЭ",
        "ОГМ"
    ];
}

function populateDropdowns() {
    const persons = getUniquePersons();
    const zones = getPlannerZones();

    // 1. Table Header Filters (Desktop)
    const filterAuthor = document.getElementById("table-filter-author");
    if (filterAuthor) {
        const curVal = filterAuthor.value;
        filterAuthor.innerHTML = `<option value="all">✍️ Все авторы</option>` + 
            persons.map(n => `<option value="${n}">${n}</option>`).join('');
        if (curVal && persons.includes(curVal)) filterAuthor.value = curVal;
    }

    const filterAssignee = document.getElementById("table-filter-assignee");
    if (filterAssignee) {
        const curVal = filterAssignee.value;
        filterAssignee.innerHTML = `<option value="all">👤 Все исполн.</option>` + 
            persons.map(n => `<option value="${n}">${n}</option>`).join('');
        if (curVal && persons.includes(curVal)) filterAssignee.value = curVal;
    }

    const filterZone = document.getElementById("table-filter-zone");
    if (filterZone) {
        const curVal = filterZone.value;
        filterZone.innerHTML = `<option value="all">📁 Все зоны</option>` + 
            zones.map(z => `<option value="${z}">${z}</option>`).join('');
        if (curVal && zones.includes(curVal)) filterZone.value = curVal;
    }

    // 2. Mobile Filters Drawer
    const mobFilterAuthor = document.getElementById("mobile-filter-author");
    if (mobFilterAuthor) {
        const curVal = mobFilterAuthor.value;
        mobFilterAuthor.innerHTML = `<option value="all">✍️ Все авторы</option>` + 
            persons.map(n => `<option value="${n}">${n}</option>`).join('');
        if (curVal && persons.includes(curVal)) mobFilterAuthor.value = curVal;
    }

    const mobFilterAssignee = document.getElementById("mobile-filter-assignee");
    if (mobFilterAssignee) {
        const curVal = mobFilterAssignee.value;
        mobFilterAssignee.innerHTML = `<option value="all">👤 Все исполн.</option>` + 
            persons.map(n => `<option value="${n}">${n}</option>`).join('');
        if (curVal && persons.includes(curVal)) mobFilterAssignee.value = curVal;
    }

    const mobFilterZone = document.getElementById("mobile-filter-zone");
    if (mobFilterZone) {
        const curVal = mobFilterZone.value;
        mobFilterZone.innerHTML = `<option value="all">📁 Все зоны</option>` + 
            zones.map(z => `<option value="${z}">${z}</option>`).join('');
        if (curVal && zones.includes(curVal)) mobFilterZone.value = curVal;
    }

    // 3. Modal Dropdowns
    const modalAuthor = document.getElementById("task-author-input");
    if (modalAuthor && modalAuthor.tagName === 'SELECT') {
        modalAuthor.innerHTML = `<option value="">-- Выберите автора --</option>` + 
            persons.map(n => `<option value="${n}">${n}</option>`).join('');
    }

    const modalAssignee = document.getElementById("task-assignee-input");
    if (modalAssignee && modalAssignee.tagName === 'SELECT') {
        modalAssignee.innerHTML = `<option value="">-- Выберите исполнителя --</option>` + 
            persons.map(n => `<option value="${n}">${n}</option>`).join('');
    }

    const modalZone = document.getElementById("task-zone-input");
    if (modalZone && modalZone.tagName === 'SELECT') {
        modalZone.innerHTML = zones.map(z => `<option value="${z}">${z}</option>`).join('');
    }

    // 4. Bulk Modal Dropdowns
    const bulkAuthor = document.getElementById("bulk-author-input");
    if (bulkAuthor && bulkAuthor.tagName === 'SELECT') {
        const curVal = bulkAuthor.value;
        bulkAuthor.innerHTML = `<option value="">-- Выберите автора --</option>` + 
            persons.map(n => `<option value="${n}">${n}</option>`).join('');
        if (curVal && persons.includes(curVal)) bulkAuthor.value = curVal;
    }

    const bulkZone = document.getElementById("bulk-zone-input");
    if (bulkZone && bulkZone.tagName === 'SELECT') {
        const curVal = bulkZone.value;
        bulkZone.innerHTML = zones.map(z => `<option value="${z}">${z}</option>`).join('');
        if (curVal && zones.includes(curVal)) bulkZone.value = curVal;
    }
    if (typeof updateDeckFiltersVisualState === 'function') {
        updateDeckFiltersVisualState();
    }
}


function toggleSelectServiceTask(taskId, isChecked) {
    if (isChecked) {
        selectedServiceTaskIds.add(taskId);
    } else {
        selectedServiceTaskIds.delete(taskId);
    }
    const row = document.getElementById(`task-row-${taskId}`);
    if (row) {
        row.classList.toggle('task-row-selected', isChecked);
    }
    updateServicesBulkBar();
}

function isBulkHorizon() {
    return ['services', 'tech_council', 'quality_day'].includes(currentHorizon);
}

function toggleSelectAllServices(isChecked) {
    if (!isBulkHorizon()) return;

    allTasks.forEach(t => {
        const isLocked = (t.status && (t.status.includes("Выполнено") || t.status.includes("Отменено")));
        if (!isLocked) {
            if (isChecked) {
                selectedServiceTaskIds.add(t.id);
            } else {
                selectedServiceTaskIds.delete(t.id);
            }
            const row = document.getElementById(`task-row-${t.id}`);
            if (row) {
                row.classList.toggle('task-row-selected', isChecked);
                const cb = row.querySelector('.task-row-checkbox');
                if (cb) cb.checked = isChecked;
            }
        }
    });
    updateServicesBulkBar();
}

function updateServicesBulkBar() {
    const bar = document.getElementById("services-bulk-bar");
    const countSpan = document.getElementById("services-selected-count");
    const masterCb = document.getElementById("th-select-all-services");

    const count = selectedServiceTaskIds.size;
    if (countSpan) countSpan.textContent = count;

    if (bar) {
        bar.style.display = (count > 0 && isBulkHorizon()) ? 'flex' : 'none';
    }

    if (masterCb) {
        const unlockTasks = allTasks.filter(t => !(t.status && (t.status.includes("Выполнено") || t.status.includes("Отменено"))));
        masterCb.checked = unlockTasks.length > 0 && unlockTasks.every(t => selectedServiceTaskIds.has(t.id));
    }
}

function clearServicesSelection() {
    selectedServiceTaskIds.clear();
    const checkboxes = document.querySelectorAll('.task-row-checkbox');
    checkboxes.forEach(cb => cb.checked = false);
    const rows = document.querySelectorAll('.task-row-selected');
    rows.forEach(r => r.classList.remove('task-row-selected'));
    const masterCb = document.getElementById("th-select-all-services");
    if (masterCb) masterCb.checked = false;
    updateServicesBulkBar();
}

async function executeServicesBulkStatus(newStatus) {
    const taskIds = Array.from(selectedServiceTaskIds);
    if (taskIds.length === 0) {
        alert("Пожалуйста, выберите хотя бы одну задачу!");
        return;
    }

    const actionTitle = newStatus.includes("Выполнено") ? "завершить" : (newStatus.includes("Отменено") ? "отменить" : "изменить статус для");
    const confirmAction = confirm(`Вы уверены, что хотите ${actionTitle} ${taskIds.length} задач?`);
    if (!confirmAction) return;

    const firstTask = allTasks.find(t => t.id === taskIds[0]);
    const authorUser = firstTask ? (firstTask.author_name || firstTask.assignee_name) : null;

    ensureUserAuthorized(authorUser, async (authSession) => {
        try {
            const payload = {
                task_ids: taskIds,
                status: newStatus,
                comment: newStatus.includes("Выполнено") ? "Выполнено" : "",
                pin_code: authSession ? authSession.pin : "",
                user_name: authSession ? authSession.name : ""
            };

            const res = await fetch("/api/tasks/bulk_status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const data = await res.json();
                showToast(`Успешно обновлено: ${data.updated_count} задач 🚀`);
                clearServicesSelection();
                loadTasks();
            } else {
                const err = await res.json();
                alert("Ошибка массового обновления: " + (err.detail || "Не удалось сохранить"));
            }
        } catch (e) {
            console.error("Bulk status update error:", e);
            alert("Ошибка сети при массовом обновлении задач");
        }
    });
}

async function executeServicesBulkMove() {
    const taskIds = Array.from(selectedServiceTaskIds);
    if (taskIds.length === 0) {
        alert("Пожалуйста, выберите хотя бы одну задачу!");
        return;
    }

    const next = getNextCalendarWeek();
    const confirmMove = confirm(`Перенести ${taskIds.length} задач на «${next.week}» (${next.month})?`);
    if (!confirmMove) return;

    const firstTask = allTasks.find(t => t.id === taskIds[0]);
    const authorUser = firstTask ? (firstTask.author_name || firstTask.assignee_name) : null;

    ensureUserAuthorized(authorUser, async (authSession) => {
        try {
            const payload = {
                task_ids: taskIds,
                status: "🔵 Перенесено",
                comment: `Перенесено на ${next.week}`,
                move_to_next_week: true,
                next_month_label: next.month,
                next_week_label: next.week,
                pin_code: authSession ? authSession.pin : "",
                user_name: authSession ? authSession.name : ""
            };

            const res = await fetch("/api/tasks/bulk_status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const data = await res.json();
                showToast(`Задачи (${data.updated_count} шт.) перенесены на ${next.week} 🚀`);
                clearServicesSelection();
                loadTasks();
            } else {
                const err = await res.json();
                alert("Ошибка массового переноса: " + (err.detail || "Не удалось перенести"));
            }
        } catch (e) {
            console.error("Bulk move error:", e);
            alert("Ошибка сети при переносе задач");
        }
    });
}

/**
 * Вычисляет числовой ключ сортировки для календарной недели/даты (YYYYMMDD)
 */
function getWeekSortKey(weekLabel, monthLabel) {
    if (!weekLabel || weekLabel === 'Без недели') return 99999999;
    
    // 1. Извлекаем год из месяца (например, "Сентябрь 2026" -> 2026)
    let year = 2026;
    if (monthLabel) {
        const yearMatch = monthLabel.match(/\b(20\d{2})\b/);
        if (yearMatch) year = parseInt(yearMatch[1], 10);
    }

    // 2. Ищем дату начала недели в формате "дд.мм" (например, "Неделя 4 (28.09 - 02.10)")
    const dateMatch = weekLabel.match(/(\d{1,2})\.(\d{1,2})/);
    if (dateMatch) {
        const day = parseInt(dateMatch[1], 10);
        const month = parseInt(dateMatch[2], 10);
        
        let effYear = year;
        if (month === 12 && monthLabel && monthLabel.toLowerCase().includes("январ")) {
            effYear = year - 1;
        } else if (month === 1 && monthLabel && monthLabel.toLowerCase().includes("декабр")) {
            effYear = year + 1;
        }
        return effYear * 10000 + month * 100 + day;
    }

    // 3. Fallback: если указан только номер недели
    const weekNumMatch = weekLabel.match(/недел[яи]\s*(\d+)/i);
    if (weekNumMatch) {
        const weekNum = parseInt(weekNumMatch[1], 10);
        return year * 10000 + weekNum * 100;
    }

    return 99999999;
}

/**
 * Группирует и сортирует задачи в строгом хронологическом порядке по календарным блокам недель.
 * Возвращает массив объектов: [{ weekLabel, sortKey, tasks: [...] }]
 */
function groupTasksByWeekChronologically(tasks) {
    if (!tasks || tasks.length === 0) return [];

    const groupsMap = new Map();

    tasks.forEach(t => {
        const weekLabel = t.week_label || 'Без недели';
        if (!groupsMap.has(weekLabel)) {
            const sortKey = getWeekSortKey(weekLabel, t.month_label);
            groupsMap.set(weekLabel, {
                weekLabel: weekLabel,
                sortKey: sortKey,
                tasks: []
            });
        }
        groupsMap.get(weekLabel).tasks.push(t);
    });

    // Сортируем группы недель ОТ НОВЫХ К СТАРЫМ (самые актуальные/свежие недели вверху)
    const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => b.sortKey - a.sortKey);

    // Внутри каждой группы сортируем задачи от новых к старым (по ID DESC)
    sortedGroups.forEach(group => {
        group.tasks.sort((a, b) => (b.id || 0) - (a.id || 0));
    });

    return sortedGroups;
}

function renderTasksTable(tasks) {
    const tableBody = document.getElementById("tasks-table-body");
    if (!tableBody) return;

    // Управление видимостью чекбокса в шапке
    const masterCb = document.getElementById("th-select-all-services");
    if (masterCb) {
        masterCb.style.display = isBulkHorizon() ? 'inline-block' : 'none';
    }
    updateServicesBulkBar();

    const taskCount = tasks ? tasks.length : 0;
    const deckCountEl = document.getElementById("deck-tasks-count-text");
    if (deckCountEl) {
        deckCountEl.textContent = `Найдено ${taskCount} ${taskCount === 1 ? 'задача' : (taskCount > 1 && taskCount < 5 ? 'задачи' : 'задач')}`;
    }

    const paginationBar = document.getElementById("my-tasks-pagination-bar");

    if (!tasks || tasks.length === 0) {
        if (paginationBar) paginationBar.style.display = "none";
        if (myTasksFilterActive && currentPlannerUser && currentPlannerUser.name) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align: center; padding: 3rem 1.5rem; color: #64748b; font-size: 0.95rem;">
                        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">👤</div>
                        <div style="font-weight: 700; font-size: 1.05rem; color: #1e293b; margin-bottom: 0.35rem;">
                            Нет назначенных задач для ${escapeHtml(currentPlannerUser.name)}
                        </div>
                        <div style="color: #64748b; font-size: 0.88rem; margin-bottom: 1.25rem;">
                            За последний месяц и на будущие даты задач пока нет.
                        </div>
                        <button type="button" class="btn-action btn-secondary-action" onclick="toggleMyTasksFilter()" style="display: inline-flex; align-items: center; gap: 6px; margin-right: 8px;">
                            <i class="fa-solid fa-users"></i> Показать все задачи завода
                        </button>
                        <button type="button" class="btn-action btn-primary-action" onclick="openAddTaskModal()">
                            <i class="fa-solid fa-plus"></i> Добавить задачу
                        </button>
                    </td>
                </tr>
            `;
            return;
        }
        tableBody.innerHTML = `
            <tr>
                <td colspan="10" style="text-align: center; padding: 2.5rem; color: #94a3b8; font-size: 0.95rem;">
                    ✨ Нет задач на выбранный период. Нажмите «+ Добавить задачу»!
                </td>
            </tr>
        `;
        return;
    }

    let tasksToRender = tasks;
    if (myTasksFilterActive) {
        const totalCount = tasks.length;
        const totalPages = Math.ceil(totalCount / MY_TASKS_PAGE_SIZE) || 1;
        if (myTasksCurrentPage > totalPages) myTasksCurrentPage = totalPages;
        if (myTasksCurrentPage < 1) myTasksCurrentPage = 1;

        const startIndex = (myTasksCurrentPage - 1) * MY_TASKS_PAGE_SIZE;
        const endIndex = Math.min(startIndex + MY_TASKS_PAGE_SIZE, totalCount);
        tasksToRender = tasks.slice(startIndex, endIndex);

        renderMyTasksPagination(totalCount, totalPages, startIndex + 1, endIndex);
    } else {
        if (paginationBar) paginationBar.style.display = "none";
    }

    const weekGroups = groupTasksByWeekChronologically(tasksToRender);
    let rowsHtml = '';

    weekGroups.forEach(group => {
        const currentWeekGroup = group.weekLabel;
        const countInWeek = group.tasks.length;

        // Вставляем визуальный разделитель недели (ровно один раз на блок)
        rowsHtml += `
            <tr class="week-divider-row">
                <td colspan="10">
                    <div class="week-divider-badge">
                        <i class="fa-solid fa-calendar-week"></i>
                        <span>${escapeHtml(currentWeekGroup)}</span>
                        <span style="opacity: 0.8; font-weight: 500; font-size: 0.72rem; margin-left: 6px;">(${countInWeek} зад.)</span>
                    </div>
                </td>
            </tr>
        `;

        group.tasks.forEach(t => {
            let statusClass = "status-work";
            const isCompleted = t.status && t.status.includes("Выполнено");
            const isCancelled = t.status && t.status.includes("Отменено");
            const isLocked = !isPlannerAdmin() && (isCompleted || isCancelled);

            let rowExtraClass = "";
            if (isCompleted) {
                statusClass = "status-done";
                rowExtraClass = "task-row-done";
            } else if (isCancelled) {
                statusClass = "status-cancelled";
                rowExtraClass = "task-row-cancelled";
            } else if (t.status && t.status.includes("Перенесено")) {
                statusClass = "status-moved";
            } else {
                statusClass = "status-work";
            }

            if (t.is_backlog) {
                rowExtraClass += " task-row-backlog";
            }

            const photosObj = t.photos || {};
            const beforeList = photosObj.before || [];
            const afterList = photosObj.after || [];
            const hasPhotoBefore = !!(t.photo_link && t.photo_link.trim()) || beforeList.length > 0;
            const hasPhotoAfter = !!(t.photo_link_after && t.photo_link_after.trim()) || afterList.length > 0;
            const countBefore = Math.max(beforeList.length, hasPhotoBefore ? 1 : 0);
            const countAfter = Math.max(afterList.length, hasPhotoAfter ? 1 : 0);
            const labelBefore = countBefore > 1 ? `ДО (${countBefore})` : 'ДО';
            const labelAfter = countAfter > 1 ? `ПОСЛЕ (${countAfter})` : 'ПОСЛЕ';

            let photoBtn = `<span style="color: #94a3b8; font-size: 0.75rem;">—</span>`;
            if (hasPhotoBefore && hasPhotoAfter) {
                photoBtn = `
                    <div class="photo-dual-group" style="display: inline-flex; gap: 4px; align-items: center;">
                        <button type="button" onclick="openPhotoViewerModal('${t.photo_link || (beforeList[0] ? (beforeList[0].url || beforeList[0]) : '')}', '${t.photo_link_after || (afterList[0] ? (afterList[0].url || afterList[0]) : '')}', 'before')" class="btn-photo-chip before" title="Фото ДО (${countBefore} шт.)">
                            <i class="fa-solid fa-camera"></i> ${labelBefore}
                        </button>
                        <button type="button" onclick="openPhotoViewerModal('${t.photo_link || (beforeList[0] ? (beforeList[0].url || beforeList[0]) : '')}', '${t.photo_link_after || (afterList[0] ? (afterList[0].url || afterList[0]) : '')}', 'after')" class="btn-photo-chip after" title="Фото ПОСЛЕ (${countAfter} шт.)">
                            <i class="fa-solid fa-circle-check"></i> ${labelAfter}
                        </button>
                    </div>
                `;
            } else if (hasPhotoBefore) {
                photoBtn = `
                    <button type="button" onclick="openPhotoViewerModal('${t.photo_link || (beforeList[0] ? (beforeList[0].url || beforeList[0]) : '')}', '', 'before')" class="btn-photo-chip before" title="Фото ДО (${countBefore} шт.)">
                        <i class="fa-solid fa-camera"></i> ${labelBefore}
                    </button>
                `;
            } else if (hasPhotoAfter) {
                photoBtn = `
                    <button type="button" onclick="openPhotoViewerModal('', '${t.photo_link_after || (afterList[0] ? (afterList[0].url || afterList[0]) : '')}', 'after')" class="btn-photo-chip after" title="Фото ПОСЛЕ (${countAfter} шт.)">
                        <i class="fa-solid fa-circle-check"></i> ${labelAfter}
                    </button>
                `;
            }

            const backlogBadge = t.is_backlog ? `
                <div style="margin-top: 4px;">
                    <span class="badge-backlog" title="Долг прошлой недели: ${t.week_label || ''}" style="background: rgba(255, 149, 0, 0.12); color: #C97500; border: 1px solid rgba(255, 149, 0, 0.35); font-weight: 700; padding: 2px 7px; border-radius: 6px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">
                        <i class="fa-solid fa-clock-rotate-left" style="color: #FF9500;"></i> Долг: ${t.week_label ? t.week_label : 'Прошлая неделя'}
                    </span>
                </div>
            ` : '';

            const crossWeekBadge = (t.is_cross_week && !t.is_backlog) ? `
                <div style="margin-top: 4px;">
                    <span class="badge-cross-week" title="Сквозная долгосрочная задача. Создана: ${t.origin_month_label ? t.origin_month_label + ', ' : ''}${t.origin_week_label || ''}">
                        <i class="fa-solid fa-hourglass-half" style="color: #64748b;"></i> Сквозная${t.origin_created_date ? ' (' + t.origin_created_date + ')' : ''}
                    </span>
                </div>
            ` : '';

            const horizonBadge = t.horizon_label ? `
                <span class="badge-horizon ${t.horizon_badge_class || 'horizon-sprint'}" title="Горизонт: ${escapeHtml(t.horizon_label)}">${escapeHtml(t.horizon_label)}</span>
            ` : '';

            const titleClass = isCancelled ? 'task-cancelled-text' : '';

            const canEdit = canEditProjectOrTask(t);
            const canInteract = canInteractWithTask(t);
            const canDelete = canDeleteProjectOrTask(t);

            const commentCell = (isLocked || !canInteract) ? `
                <span class="comment-locked" title="${isLocked ? (isCancelled ? 'Отменённая задача заблокирована' : 'Завершённая задача заблокирована') : 'Только для исполнителя/руководства'}">
                    ${t.comment || '—'}
                </span>
            ` : `
                <span onclick="inlineEditComment(${t.id}, '${escapeHtml(t.comment || '')}')" style="cursor: pointer; border-bottom: 1px dashed rgba(0,0,0,0.25);" title="Кликните для редактирования">
                    ${t.comment || '—'}
                </span>
            `;

            let actionButtons = '';
            if (isLocked) {
                actionButtons = `
                    <div class="row-actions">
                        <button class="btn-icon-cell" onclick="openTaskHistoryModal(${t.id})" title="История задачи (таймлайн)">
                            <i class="fa-solid fa-clock-rotate-left" style="color: #2563eb;"></i>
                        </button>
                        <button class="btn-icon-cell" disabled title="Заблокировано">
                            <i class="fa-solid fa-lock" style="font-size: 0.75rem;"></i>
                        </button>
                    </div>
                `;
            } else if (!canInteract) {
                actionButtons = `
                    <div class="row-actions">
                        <button class="btn-icon-cell" onclick="openTaskHistoryModal(${t.id})" title="История задачи (таймлайн)">
                            <i class="fa-solid fa-clock-rotate-left" style="color: #2563eb;"></i>
                        </button>
                        <button class="btn-icon-cell" onclick="openEditTaskModal(${t.id})" title="Просмотр задачи (только чтение)">
                            <i class="fa-solid fa-eye" style="color: #64748b;"></i>
                        </button>
                    </div>
                `;
            } else {
                actionButtons = `
                    <div class="row-actions">
                        <button class="btn-icon-cell" onclick="openTaskHistoryModal(${t.id})" title="История задачи (таймлайн)">
                            <i class="fa-solid fa-clock-rotate-left" style="color: #2563eb;"></i>
                        </button>
                        <button class="btn-icon-cell" onclick="openReassignTaskModal(${t.id})" title="Переадресовать задачу другому исполнителю">
                            <i class="fa-solid fa-share-nodes" style="color: #6366f1;"></i>
                        </button>
                        <button class="btn-icon-cell" onclick="moveTaskToNextWeekModal(${t.id})" title="Перенести на следующую неделю">
                            <i class="fa-solid fa-arrow-right"></i>
                        </button>
                        <button class="btn-icon-cell" onclick="openEditTaskModal(${t.id})" title="${canEdit ? 'Редактировать' : 'Внести факт / фото / статус'}">
                            <i class="fa-solid ${canEdit ? 'fa-pen' : 'fa-pen-to-square'}" style="${canEdit ? '' : 'color: #0284c7;'}"></i>
                        </button>
                    </div>
                `;
            }

            const docBadge = t.attached_doc ? `
                <div style="margin-top: 4px;">
                    <a href="${t.attached_doc.link}" target="_blank" class="badge-doc-attachment" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; font-size: 0.75rem; font-weight: 600; color: #1d4ed8; text-decoration: none; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="Открыть документ из Базы Знаний: ${escapeHtml(t.attached_doc.title)}">
                        <i class="fa-solid fa-file-lines" style="color: #2563eb;"></i>
                        <span style="overflow: hidden; text-overflow: ellipsis;">${escapeHtml(t.attached_doc.title)}</span>
                    </a>
                </div>
            ` : '';

            const tagsHtml = (t.tags || '').split(',').filter(x => x.trim()).map(tagStr => {
                const cleanT = tagStr.trim();
                return `<span class="tag-pill" onclick="filterByTag('${cleanT}')">${cleanT}</span>`;
            }).join('');

            let depBadge = '';
            const blks = (t.blockers && t.blockers.length > 0)
                ? t.blockers
                : (t.depends_on && t.depends_on.code ? [t.depends_on] : []);
            if (blks.length > 1) {
                const unfin = blks.filter(b => !b.is_done && !(b.status && b.status.includes('Выполнено')));
                const bCount = unfin.length > 0 ? unfin.length : blks.length;
                const codes = blks.map(b => b.code || ('TSK-' + b.id)).join(', ');
                depBadge = `
                    <div style="margin-top: 3px;">
                        <span class="dep-blocker-badge" title="Блокирующие этапы (${codes}): ${blks.map(b => (b.code || 'TSK-' + b.id) + ' ' + (b.title || '')).join('; ')}">
                            <i class="fa-solid fa-lock" style="color: ${unfin.length > 0 ? '#dc2626' : '#16a34a'};"></i> ${bCount} блокера: ${codes}
                        </span>
                    </div>
                `;
            } else if (blks.length === 1) {
                const b = blks[0];
                const isDone = b.is_done || (b.status && b.status.includes('Выполнено'));
                depBadge = `
                    <div style="margin-top: 3px;">
                        <span class="dep-blocker-badge" title="Заблокировано задачей ${b.code || ('TSK-' + b.id)}: ${escapeHtml(b.title || '')}">
                            <i class="fa-solid fa-lock" style="color: ${isDone ? '#16a34a' : '#dc2626'};"></i> Блокер: ${b.code || ('TSK-' + b.id)}
                        </span>
                    </div>
                `;
            }

            let zoneAndDeptHtml = '';
            if (t.is_roadmap_subtask) {
                const projCode = t.roadmap_project_code || t.parent_code || '';
                const projTitle = t.roadmap_project_title || t.parent_title || 'Проект';
                zoneAndDeptHtml = `
                    <span class="badge-zone" style="background: #f5f3ff; color: #6d28d9; border-color: #ddd6fe; font-weight: 700;">
                        <i class="fa-solid fa-map-location-dot"></i> Дорожная карта
                    </span>
                    <div style="margin-top: 3px; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <span class="badge-zone" style="background: #f8fafc; color: #475569; border-color: #e2e8f0; font-size: 0.7rem; font-weight: 600;" title="Проект: ${escapeHtml(projCode)} ${escapeHtml(projTitle)}">
                            📁 ${escapeHtml(projCode)} ${escapeHtml(projTitle)}
                        </span>
                    </div>
                `;
            } else {
                const zoneVal = t.zone || 'Бережливое производство';
                let zoneClass = 'badge-zone';
                if (zoneVal === 'Техсовет') zoneClass += ' badge-zone-tech-council';
                else if (zoneVal === 'День качества') zoneClass += ' badge-zone-quality-day';

                zoneAndDeptHtml = `<span class="${zoneClass}">${escapeHtml(zoneVal)}</span>`;
                if (t.department_service && t.department_service !== 'Общий' && t.department_service !== t.zone && !(t.zone && t.zone.includes(t.department_service))) {
                    zoneAndDeptHtml += `
                        <div style="margin-top: 2px;">
                            <span class="badge-zone" style="background: #f0fdf4; color: #15803d; border-color: #bbf7d0; font-size: 0.72rem;">${escapeHtml(t.department_service)}</span>
                        </div>
                    `;
                }
            }

            const milestoneBadge = (t.is_roadmap_subtask && t.parent_code && t.parent_code !== t.roadmap_project_code) ? `
                <div style="margin-top: 3px;">
                    <span style="font-size: 0.72rem; color: #6d28d9; background: #faf5ff; border: 1px solid #ede9fe; border-radius: 4px; padding: 1px 6px; font-weight: 600;" title="Этап проекта: ${escapeHtml(t.parent_code)} ${escapeHtml(t.parent_title)}">
                        <i class="fa-solid fa-flag-checkered"></i> Этап: ${escapeHtml(t.parent_code)} ${escapeHtml(t.parent_title)}
                    </span>
                </div>
            ` : '';

            const dueDateCell = t.is_deadline_week ? `
                <div>
                    <span class="badge-deadline-week" title="Дедлайн на этой неделе: ${t.due_date_str || ''}">
                        <i class="fa-solid fa-bullseye"></i> ${t.due_date_str || 'Дедлайн'}
                    </span>
                </div>
            ` : `<span style="font-size: 0.82rem; white-space: nowrap; color: #334155;">${t.due_date_str || 'В теч. недели'}</span>`;

            const isBulk = isBulkHorizon();
            const isChecked = selectedServiceTaskIds.has(t.id);
            const checkboxHtml = isBulk ? `
                <input type="checkbox" class="task-row-checkbox" ${isLocked ? 'disabled' : ''} ${isChecked ? 'checked' : ''} onchange="toggleSelectServiceTask(${t.id}, this.checked)" style="cursor: pointer; width: 15px; height: 15px; accent-color: #2563eb; margin-right: 4px;" title="Выбрать задачу">
            ` : '';

            rowsHtml += `
                <tr id="task-row-${t.id}" class="${rowExtraClass} ${isChecked ? 'task-row-selected' : ''}">
                    <td style="white-space: nowrap;">
                        <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                            ${checkboxHtml}
                            <span class="badge-code" onclick="openTaskHistoryModal(${t.id})" style="cursor: pointer;" title="Нажмите для просмотра истории">${t.code || ('TSK-' + t.id)}</span>
                            ${horizonBadge}
                        </div>
                        ${backlogBadge}
                        ${crossWeekBadge}
                    </td>
                    <td>
                        ${zoneAndDeptHtml}
                    </td>
                    <td class="${titleClass}" style="font-weight: 600; min-width: 320px; color: #0f172a; line-height: 1.35; word-break: break-word;">
                        <div onclick="openTaskDetailModal(${t.id})" style="cursor: pointer;" title="Подробный просмотр задачи">${t.title || '—'}</div>
                        ${docBadge}
                        ${milestoneBadge}
                        ${depBadge}
                        ${tagsHtml ? `<div style="margin-top: 4px;">${tagsHtml}</div>` : ''}
                    </td>
                    <td style="text-align: center;">${photoBtn}</td>
                    
                    <!-- Pure Text Author -->
                    <td style="font-size: 0.82rem; color: #475569; white-space: nowrap; max-width: 110px; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(t.author_name || '')}">
                        ${t.author_name || '—'}
                    </td>

                    <!-- Pure Text Assignee -->
                    <td style="font-weight: 600; font-size: 0.82rem; color: #1d4ed8; white-space: nowrap; max-width: 125px; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(t.assignee_name || '')}">
                        ${t.assignee_name || '—'}
                    </td>

                    <td style="text-align: center; white-space: nowrap;">${dueDateCell}</td>
                    <td style="text-align: center; white-space: nowrap; min-width: 115px;">
                        <select class="select-status ${statusClass}" ${isLocked ? 'disabled title="Заблокировано для изменений обычными пользователями"' : `onchange="quickUpdateStatus(${t.id}, this.value)"`}>
                            <option value="🟡 В работе" ${t.status === '🟡 В работе' ? 'selected' : ''}>🟡 В работе</option>
                            <option value="🟢 Выполнено" ${t.status === '🟢 Выполнено' ? 'selected' : ''}>🟢 Выполнено</option>
                            <option value="🔵 Перенесено" ${t.status === '🔵 Перенесено' ? 'selected' : ''}>🔵 Перенесено</option>
                            <option value="🔴 Отменено" ${t.status === '🔴 Отменено' ? 'selected' : ''}>🔴 Отменено</option>
                        </select>
                    </td>
                    <td style="font-size: 0.82rem; color: #334155; max-width: 260px; word-break: break-word;">
                        ${commentCell}
                    </td>
                    <td style="text-align: center;">
                        ${actionButtons}
                    </td>
                </tr>
            `;
        });
    });

    tableBody.innerHTML = rowsHtml;
}

function renderMyTasksPagination(totalCount, totalPages, fromNum, toNum) {
    const bar = document.getElementById("my-tasks-pagination-bar");
    const info = document.getElementById("my-tasks-pagination-info");
    const controls = document.getElementById("my-tasks-pagination-controls");
    if (!bar || !info || !controls) return;

    if (totalCount <= MY_TASKS_PAGE_SIZE && totalPages <= 1) {
        bar.style.display = "none";
        return;
    }

    bar.style.display = "flex";
    info.innerHTML = `Показано <b>${fromNum}–${toNum}</b> из <b>${totalCount}</b> задач`;

    let html = `
        <button class="stitch-page-btn" ${myTasksCurrentPage <= 1 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : 'onclick="setMyTasksPage(' + (myTasksCurrentPage - 1) + ')"'} title="Предыдущая страница">
            <i class="fa-solid fa-chevron-left"></i>
        </button>
    `;

    for (let p = 1; p <= totalPages; p++) {
        // Show all if pages <= 7, else show window
        if (totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - myTasksCurrentPage) <= 1) {
            const isActive = (p === myTasksCurrentPage);
            html += `
                <button class="stitch-page-btn ${isActive ? 'active' : ''}" onclick="setMyTasksPage(${p})" style="${isActive ? 'background:#2563eb;color:#fff;font-weight:700;' : ''}">
                    ${p}
                </button>
            `;
        } else if (p === 2 && myTasksCurrentPage > 3) {
            html += `<span style="color:#94a3b8;font-size:0.8rem;padding:0 2px;">…</span>`;
        } else if (p === totalPages - 1 && myTasksCurrentPage < totalPages - 2) {
            html += `<span style="color:#94a3b8;font-size:0.8rem;padding:0 2px;">…</span>`;
        }
    }

    html += `
        <button class="stitch-page-btn" ${myTasksCurrentPage >= totalPages ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : 'onclick="setMyTasksPage(' + (myTasksCurrentPage + 1) + ')"'} title="Следующая страница">
            <i class="fa-solid fa-chevron-right"></i>
        </button>
    `;

    controls.innerHTML = html;
}

function setMyTasksPage(page) {
    myTasksCurrentPage = page;
    if (allTasks) {
        renderTasksTable(allTasks);
        // Smooth scroll to top of table
        const tableWrapper = document.getElementById("planner-table-wrapper");
        if (tableWrapper) {
            tableWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
}

function renderTasksCards(tasks) {
    const cardsContainer = document.getElementById("tasks-cards-container");
    if (!cardsContainer) return;

    if (!tasks || tasks.length === 0) {
        cardsContainer.innerHTML = `
            <div style="text-align: center; padding: 2.5rem 1rem; color: #64748b; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">👤</div>
                <div style="font-weight: 700; font-size: 1rem; color: #1e293b; margin-bottom: 0.25rem;">
                    ${myTasksFilterActive && currentPlannerUser ? escapeHtml(currentPlannerUser.name) : 'Нет задач'}
                </div>
                <div style="font-size: 0.85rem; color: #64748b;">
                    ${myTasksFilterActive ? 'На ближайший месяц и будущее задач пока нет' : 'На выбранный период задач нет'}
                </div>
            </div>
        `;
        return;
    }

    // В мобильной версии отображаем только оперативные задачи (без дорожных карт и проектов)
    let nonRoadmapTasks = (tasks || []).filter(t => !t.is_roadmap_subtask && t.task_type !== 'roadmap' && t.task_type !== 'milestone');

    let tasksToRender = nonRoadmapTasks;
    if (myTasksFilterActive) {
        const totalCount = nonRoadmapTasks.length;
        const totalPages = Math.ceil(totalCount / MY_TASKS_PAGE_SIZE) || 1;
        if (myTasksCurrentPage > totalPages) myTasksCurrentPage = totalPages;
        if (myTasksCurrentPage < 1) myTasksCurrentPage = 1;

        const startIndex = (myTasksCurrentPage - 1) * MY_TASKS_PAGE_SIZE;
        const endIndex = Math.min(startIndex + MY_TASKS_PAGE_SIZE, totalCount);
        tasksToRender = nonRoadmapTasks.slice(startIndex, endIndex);
    }

    const weekGroups = groupTasksByWeekChronologically(tasksToRender);
    let html = '';

    // Mobile Focus Info Bar
    if (myTasksFilterActive && currentPlannerUser && currentPlannerUser.name) {
        html += `
            <div class="mobile-user-focus-bar">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <i class="fa-solid fa-user-check" style="color: #2563eb;"></i>
                    <span>${escapeHtml(currentPlannerUser.name)}</span>
                </div>
                <span style="font-size: 0.76rem; color: #64748b; font-weight: 500;">
                    ${nonRoadmapTasks.length} ${nonRoadmapTasks.length === 1 ? 'задача' : (nonRoadmapTasks.length < 5 ? 'задачи' : 'задач')}
                </span>
            </div>
        `;
    }

    weekGroups.forEach(group => {
        const weekLabel = group.weekLabel;
        const weekTasks = group.tasks;

        html += `
            <div class="mobile-week-header">
                <i class="fa-solid fa-calendar-week" style="color: #64748b;"></i>
                <span>${escapeHtml(weekLabel)}</span>
                <span style="opacity: 0.7; font-size: 0.75rem; font-weight: 500;">(${weekTasks.length} зад.)</span>
            </div>
        `;

        weekTasks.forEach(t => {
            const code = t.code || ('TSK-' + t.id);
            const status = t.status || '🟡 В работе';

            // Определение источника/вкладки задачи для наглядного отображения в карточке
            let tabBadgeHtml = '';
            if (t.is_roadmap_subtask || t.task_type === 'roadmap' || t.task_type === 'milestone') {
                const projCode = t.roadmap_project_code || t.parent_code || '';
                const projTitle = t.roadmap_project_title || t.parent_title || '';
                const fullProj = (projCode || projTitle) ? ` ${escapeHtml(projCode)} ${escapeHtml(projTitle)}`.trim() : '';
                tabBadgeHtml = `
                    <span class="mobile-badge-dept" style="background: #f5f3ff; color: #6d28d9; border: 1px solid #ddd6fe; font-weight: 600;" title="Дорожная карта">
                        <i class="fa-solid fa-map-location-dot"></i> Проект${fullProj ? ': ' + fullProj : ''}
                    </span>
                `;
            } else if (t.zone === 'Техсовет' || t.task_type === 'tech_council') {
                tabBadgeHtml = `
                    <span class="mobile-badge-dept" style="background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; font-weight: 600;">
                        <i class="fa-solid fa-landmark"></i> Техсовет
                    </span>
                `;
            } else if (t.zone === 'День качества' || t.task_type === 'quality_day') {
                tabBadgeHtml = `
                    <span class="mobile-badge-dept" style="background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; font-weight: 600;">
                        <i class="fa-solid fa-clipboard-check"></i> День качества
                    </span>
                `;
            } else if (t.department_service && ['ОГМ', 'ОГЭ', 'Технологи', 'ОТК', 'СКК'].includes(t.department_service)) {
                tabBadgeHtml = `
                    <span class="mobile-badge-dept" style="background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; font-weight: 600;">
                        <i class="fa-solid fa-wrench"></i> ${escapeHtml(t.department_service)}
                    </span>
                `;
            } else {
                const zoneText = t.zone || t.department_service || 'Спринт';
                tabBadgeHtml = `
                    <span class="mobile-badge-dept" style="background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; font-weight: 600;">
                        ⚡ ${escapeHtml(zoneText)}
                    </span>
                `;
            }

            let statusClass = 'status-badge-work';
            if (status.includes('Выполнено')) statusClass = 'status-badge-done';
            else if (status.includes('Перенесено')) statusClass = 'status-badge-rescheduled';
            else if (status.includes('Отменено')) statusClass = 'status-badge-canceled';

            let dueStr = t.due_date_str || '';
            if (!dueStr && t.due_date) {
                try {
                    const d = new Date(t.due_date);
                    if (!isNaN(d.getTime())) {
                        dueStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
                    }
                } catch(e) {}
            }
            if (!dueStr) dueStr = 'В теч. недели';

            html += `
                <div class="mobile-task-card" id="task-card-${t.id}">
                    <div class="mobile-card-top">
                        <div class="mobile-card-tags" style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
                            <span class="mobile-badge-code">${escapeHtml(code)}</span>
                            ${tabBadgeHtml}
                        </div>
                        <span class="mobile-status-badge ${statusClass}">${escapeHtml(status)}</span>
                    </div>

                    <div class="mobile-card-title">
                        ${escapeHtml(t.title || 'Без описания')}
                    </div>

                    <div class="mobile-card-bottom">
                        <span class="mobile-due-badge">
                            <i class="fa-regular fa-calendar"></i> ${escapeHtml(dueStr)}
                        </span>
                        <span style="color: #94a3b8; font-size: 0.74rem;">
                            ${t.assignee_name ? escapeHtml(t.assignee_name) : ''}
                        </span>
                    </div>
                </div>
            `;
        });
    });

    cardsContainer.innerHTML = html;
}
/* ── Свайп шторок (Bottom Sheets) вниз для закрытия ──────────────────── */
function initBottomSheetSwipeGestures() {
    const sheets = [
        { sheetId: 'apple-filter-sheet', panelClass: '.apple-filter-panel', closeFn: () => { if (typeof closeFilterSheet === 'function') closeFilterSheet(); else if (typeof toggleFilterSheet === 'function') toggleFilterSheet(); } },
        { sheetId: 'apple-date-sheet', panelClass: '.apple-date-panel', closeFn: () => { if (typeof closeAppleDatePicker === 'function') closeAppleDatePicker(); } }
    ];

    sheets.forEach(({ sheetId, panelClass, closeFn }) => {
        const sheet = document.getElementById(sheetId);
        if (!sheet || !closeFn) return;
        const panel = sheet.querySelector(panelClass);
        if (!panel) return;

        let startY = 0;
        let startX = 0;
        let currentY = 0;
        let isDragging = false;

        panel.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            if (panel.scrollTop <= 5) {
                startY = e.touches[0].clientY;
                startX = e.touches[0].clientX;
                currentY = 0;
                isDragging = true;
                panel.style.transition = 'none';
            }
        }, { passive: true });

        panel.addEventListener('touchmove', (e) => {
            if (!isDragging || e.touches.length !== 1) return;
            const dy = e.touches[0].clientY - startY;
            const dx = e.touches[0].clientX - startX;

            // Если тянем вниз от верха шторки
            if (dy > 0 && panel.scrollTop <= 0) {
                // Блокируем системный pull-to-refresh браузера
                if (e.cancelable && Math.abs(dy) > Math.abs(dx)) {
                    e.preventDefault();
                }
                currentY = dy;
                panel.style.transform = `translateY(${dy}px)`;
            } else if (dy < 0 && panel.scrollTop <= 0) {
                currentY = 0;
                panel.style.transform = 'translateY(0)';
            }
        }, { passive: false });

        const endDrag = () => {
            if (!isDragging) return;
            isDragging = false;
            if (currentY > 60) {
                closeFn();
            } else {
                panel.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
                panel.style.transform = 'translateY(0)';
            }
            currentY = 0;
        };

        panel.addEventListener('touchend', endDrag, { passive: true });
        panel.addEventListener('touchcancel', endDrag, { passive: true });
    });
}

function scrollToTargetTaskAfterRender() {
    if (!targetHighlightTaskId) return;

    const tId = targetHighlightTaskId;
    // Don't repeat on subsequent manual filter changes
    targetHighlightTaskId = null;

    setTimeout(() => {
        const rowEl = document.getElementById(`task-row-${tId}`);
        const cardEl = document.getElementById(`task-card-${tId}`);

        let targetEl = null;
        if (window.innerWidth <= 768 && cardEl) {
            targetEl = cardEl;
        } else if (rowEl) {
            targetEl = rowEl;
        } else if (cardEl) {
            targetEl = cardEl;
        }

        if (targetEl) {
            targetEl.scrollIntoView({ behavior: "smooth", block: "center" });

            if (rowEl) {
                rowEl.classList.add("task-row-highlighted");
                setTimeout(() => rowEl.classList.remove("task-row-highlighted"), 4000);
            }
            if (cardEl) {
                cardEl.classList.add("task-card-highlighted");
                setTimeout(() => cardEl.classList.remove("task-card-highlighted"), 4000);
            }
        }
    }, 250);
}

async function quickUpdateField(taskId, fieldName, fieldValue) {
    // Мгновенно обновляем локальный объект в массиве
    const task = allTasks.find(t => t.id === taskId);
    if (task) {
        task[fieldName] = fieldValue;
    }

    try {
        const payload = {};
        payload[fieldName] = fieldValue;
        const res = await fetch(`/api/tasks/${taskId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast("Сохранено");
        }
    } catch (e) {
        console.error("Error updating field:", e);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ==========================================================
   VIEW MODES & FILTERS
   ========================================================== */
function updateFilterSheetUI() {
    const dot = document.getElementById("apple-filter-indicator-dot");
    const switchBadge = document.getElementById("backlog-filter-switch");
    const rowBacklog = document.getElementById("filter-row-backlog");

    if (dot) {
        dot.style.display = showBacklog ? "block" : "none";
    }
    if (switchBadge) {
        if (showBacklog) {
            switchBadge.textContent = "ВКЛ";
            switchBadge.style.background = "#FF9500";
            switchBadge.style.color = "#FFFFFF";
        } else {
            switchBadge.textContent = "ВЫКЛ";
            switchBadge.style.background = "#E5E5EA";
            switchBadge.style.color = "#8E8E93";
        }
    }
    if (rowBacklog) {
        rowBacklog.style.background = showBacklog ? "rgba(255, 149, 0, 0.10)" : "transparent";
    }
}

function toggleBacklogFilter() {
    showBacklog = !showBacklog;
    updateFilterSheetUI();
    const btn = document.getElementById("btn-toggle-backlog");
    if (btn) {
        if (showBacklog) {
            btn.classList.add("btn-backlog-active");
            btn.innerHTML = `<i class="fa-solid fa-clock-rotate-left" style="color: #fbbf24;"></i> <span>Прошлая нед. ✓</span>`;
        } else {
            btn.classList.remove("btn-backlog-active");
            btn.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> <span class="hide-mobile">Прошлая неделя</span><span class="mobile-only">Прошлая нед.</span>`;
        }
    }
    if (showBacklog) {
        showToast("Включены долги прошлых недель");
    } else {
        showToast("Показаны только задачи текущей недели");
    }
    loadTasks();
    if (typeof toggleFilterSheet === 'function') {
        toggleFilterSheet();
    }
}

function toggleBacklog() {
    showBacklog = !showBacklog;
    updateFilterSheetUI();
    const btn = document.getElementById("btn-toggle-backlog");
    if (btn) {
        if (showBacklog) {
            btn.classList.add("btn-backlog-active");
            btn.innerHTML = `<i class="fa-solid fa-clock-rotate-left" style="color: #fbbf24;"></i> <span>Прошлая нед. ✓</span>`;
            showToast("Включены задачи прошлой недели (все статусы)");
        } else {
            btn.classList.remove("btn-backlog-active");
            btn.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> <span class="hide-mobile">Прошлая неделя</span><span class="mobile-only">Прошлая нед.</span>`;
            showToast("Показаны только задачи текущей недели");
        }
    }
    loadTasks();
}

/* ==========================================================
   QUICK INLINE ACTIONS & COMPLETE CONFIRMATION
   ========================================================== */
let pendingCompleteTaskId = null;
let pendingRescheduleTaskId = null;
let pendingCancelTaskId = null;
let previousTaskStatus = {};

async function quickUpdateStatus(taskId, newStatus) {
    const task = allTasks.find(t => t.id === taskId);
    const oldStatus = task ? (task.status || "⚪ В очереди") : "⚪ В очереди";
    previousTaskStatus[taskId] = oldStatus;

    // 🔒 ЗАЩИТА: Завершенные ("🟢 Выполнено") и отмененные ("🔴 Отменено") задачи заблокированы от изменений для обычных сотрудников
    const isAlreadyFinished = oldStatus && (oldStatus.includes("Выполнено") || oldStatus.includes("Отменено"));
    if (isAlreadyFinished && !isPlannerAdmin()) {
        showToast("🔒 Завершенные и отмененные задачи заблокированы от изменений", "error");
        restoreSelectValue(taskId);
        return;
    }

    // 1. Если выбрали "Выполнено":
    if (newStatus === "🟢 Выполнено") {
        // Для служб (ОГЭ / ОГМ), Техсовета и Дня качества — экспресс-завершение без бюрократии!
        const isExpressTask = (task && (task.task_type === 'service_plan' || task.zone === 'Техсовет' || task.zone === 'День качества')) || 
                              ['services', 'tech_council', 'quality_day'].includes(currentHorizon);
        if (isExpressTask) {
            const requiredUser = task ? (task.assignee_name || task.author_name) : null;
            ensureUserAuthorized(requiredUser, async (authSession) => {
                try {
                    const res = await fetch(`/api/tasks/${taskId}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            status: "🟢 Выполнено",
                            comment: task.comment || "Выполнено",
                            pin_code: authSession ? authSession.pin : "",
                            user_name: authSession ? authSession.name : ""
                        })
                    });
                    if (res.ok) {
                        showToast("Задача выполнена! 🎯");
                        loadTasks();
                    } else {
                        const err = await res.json();
                        alert("Ошибка: " + (err.detail || "Не удалось завершить задачу"));
                        restoreSelectValue(taskId);
                    }
                } catch (e) {
                    console.error("Error completing service task:", e);
                    restoreSelectValue(taskId);
                }
            }, task, "interact");
            return;
        }

        // Для обычного спринта (Бережливое производство) — строгое подтверждение факта и фото
        openCompleteTaskModal(taskId);
        return;
    }

    // 2. Если выбрали "Перенесено" — открываем специализированный диалог переноса срока
    if (newStatus === "🔵 Перенесено") {
        openRescheduleTaskModal(taskId);
        return;
    }

    // 3. Если выбрали "Отменено" — модальный диалог отмены с причиной и авторизацией
    if (newStatus === "🔴 Отменено") {
        openCancelTaskModal(taskId);
        return;
    }

    // 4. Обычный перевод (например "В работе")
    const requiredUser = task ? (task.assignee_name || task.author_name) : null;
    ensureUserAuthorized(requiredUser, async (authSession) => {
        if (task) task.status = newStatus;

        try {
            const res = await fetch(`/api/tasks/${taskId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    status: newStatus,
                    pin_code: authSession ? authSession.pin : "",
                    user_name: authSession ? authSession.name : ""
                })
            });
            if (res.ok) {
                showToast(`Статус: ${newStatus}`);
                loadTasks();
            } else {
                const err = await res.json();
                alert("Ошибка изменения статуса: " + (err.detail || "Доступ запрещен"));
                loadTasks();
            }
        } catch (e) {
            console.error("Error updating status:", e);
        }
    }, task, "interact");
}

function restoreSelectValue(taskId) {
    if (!taskId) return;
    const prev = previousTaskStatus[taskId];
    if (!prev) return;
    const rowSelect = document.querySelector(`#task-row-${taskId} .select-status`);
    if (rowSelect) rowSelect.value = prev;
    const cardSelect = document.querySelector(`#task-card-${taskId} .select-status`);
    if (cardSelect) cardSelect.value = prev;
}

/* ==========================================================
   1. COMPLETE TASK MODAL
   ========================================================== */
function openCompleteTaskModal(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    pendingCompleteTaskId = taskId;

    document.getElementById("complete-task-id").value = taskId;
    document.getElementById("complete-task-code").textContent = task.code || `TSK-${task.id}`;
    document.getElementById("complete-task-title").textContent = task.title || "—";
    document.getElementById("complete-task-fact").value = task.comment || "";

    // Блок исходного Фото ДО (если прикреплено к задаче)
    const beforeBlock = document.getElementById("complete-before-photo-block");
    const beforeInput = document.getElementById("complete-task-before-photo");
    const beforeThumb = document.getElementById("complete-before-photo-thumb");
    if (task.photo_link && task.photo_link.trim()) {
        if (beforeBlock) beforeBlock.style.display = "block";
        if (beforeInput) beforeInput.value = task.photo_link;
        if (beforeThumb) beforeThumb.src = task.photo_link;
    } else {
        if (beforeBlock) beforeBlock.style.display = "none";
        if (beforeInput) beforeInput.value = "";
    }

    // Фото ПОСЛЕ (факт выполнения)
    document.getElementById("complete-task-photo").value = task.photo_link_after || "";
    onPhotoInputChanged('complete-task-photo', 'complete-photo-preview-hint', 'complete-photo-preview-btn', 'complete-photo-thumb-container');

    document.getElementById("complete-task-modal").style.display = "flex";
    setTimeout(() => {
        const factInput = document.getElementById("complete-task-fact");
        if (factInput) factInput.focus();
    }, 100);
}

function closeCompleteModal() {
    const modal = document.getElementById("complete-task-modal");
    if (modal) modal.style.display = "none";
    if (pendingCompleteTaskId) {
        restoreSelectValue(pendingCompleteTaskId);
    }
    pendingCompleteTaskId = null;
}

async function submitCompleteModal() {
    const taskId = document.getElementById("complete-task-id").value;
    const factText = document.getElementById("complete-task-fact").value.trim();
    const photoLinkAfter = document.getElementById("complete-task-photo").value.trim();
    const task = allTasks.find(t => t.id == taskId);

    if (!factText) {
        alert("Пожалуйста, обязательно укажите факт выполнения (что сделано)!");
        const factInput = document.getElementById("complete-task-fact");
        if (factInput) factInput.focus();
        return;
    }

    const requiredUser = task ? (task.assignee_name || task.author_name) : null;
    ensureUserAuthorized(requiredUser, async (authSession) => {
        try {
            const payload = {
                status: "🟢 Выполнено",
                comment: factText,
                photo_link_after: photoLinkAfter,
                pin_code: authSession ? authSession.pin : "",
                user_name: authSession ? authSession.name : ""
            };

            const res = await fetch(`/api/tasks/${taskId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                closeCompleteModal();
                showToast("Задача успешно выполнена ✅");
                loadTasks();
            } else {
                const err = await res.json();
                alert("Ошибка сохранения: " + (err.detail || "Не удалось сохранить статус"));
            }
        } catch (e) {
            console.error("Error completing task:", e);
            alert("Произошла ошибка при сохранении");
        }
    }, task, "interact");
}

/* ==========================================================
   2. RESCHEDULE (MOVE DEADLINE) MODAL
   ========================================================== */
function openRescheduleTaskModal(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    pendingRescheduleTaskId = taskId;

    document.getElementById("reschedule-task-id").value = taskId;
    document.getElementById("reschedule-task-code").textContent = task.code || `TSK-${task.id}`;
    document.getElementById("reschedule-task-title").textContent = task.title || "—";
    document.getElementById("reschedule-task-current-due").textContent = task.due_date_str || "В теч. недели";
    
    // Сбрасываем инпуты
    document.getElementById("reschedule-task-date").value = "";
    document.getElementById("reschedule-task-reason").value = "";
    
    // Сбрасываем выбранные чипы
    const chips = document.querySelectorAll("#reschedule-reason-chips .reason-chip");
    chips.forEach(c => c.classList.remove("selected"));

    // По умолчанию предлагаем дату через 3 дня
    applyDatePreset(3);

    document.getElementById("reschedule-task-modal").style.display = "flex";
}

function closeRescheduleModal() {
    const modal = document.getElementById("reschedule-task-modal");
    if (modal) modal.style.display = "none";
    if (pendingRescheduleTaskId) {
        restoreSelectValue(pendingRescheduleTaskId);
    }
    pendingRescheduleTaskId = null;
}

function selectRescheduleChip(btn, text) {
    const chips = document.querySelectorAll("#reschedule-reason-chips .reason-chip");
    chips.forEach(c => c.classList.remove("selected"));
    btn.classList.add("selected");
    
    const reasonInput = document.getElementById("reschedule-task-reason");
    if (reasonInput) {
        reasonInput.value = text;
        reasonInput.focus();
    }
}

function applyDatePreset(daysToAdd) {
    const d = new Date();
    d.setDate(d.getDate() + daysToAdd);
    const dateInput = document.getElementById("reschedule-task-date");
    if (dateInput) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        dateInput.value = `${yyyy}-${mm}-${dd}`;
    }
}

function applyDatePresetToFriday() {
    const d = new Date();
    const day = d.getDay(); // 0 is Sunday, 5 is Friday
    let diff = 5 - day;
    if (diff <= 0) diff += 7;
    d.setDate(d.getDate() + diff);
    const dateInput = document.getElementById("reschedule-task-date");
    if (dateInput) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        dateInput.value = `${yyyy}-${mm}-${dd}`;
    }
}

function onRescheduleDatePicked(val) {
    // Пользователь выбрал дату вручную
}

function formatDateToRuStr(dateStr) {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length === 3) {
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        const dayNames = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
        const dayOfWeek = dayNames[d.getDay()] || "";
        return `${parts[2]}.${parts[1]} (${dayOfWeek})`;
    }
    return dateStr;
}

async function submitRescheduleModal() {
    const taskId = document.getElementById("reschedule-task-id").value;
    const newDateRaw = document.getElementById("reschedule-task-date").value.trim();
    const reason = document.getElementById("reschedule-task-reason").value.trim();
    const task = allTasks.find(t => t.id == taskId);

    if (!newDateRaw) {
        alert("Пожалуйста, укажите новую дату срока!");
        return;
    }
    if (!reason) {
        alert("Пожалуйста, укажите причину переноса срока!");
        const reasonInput = document.getElementById("reschedule-task-reason");
        if (reasonInput) reasonInput.focus();
        return;
    }

    const newDueDateStr = formatDateToRuStr(newDateRaw);
    const requiredUser = task ? (task.assignee_name || task.author_name) : null;

    ensureUserAuthorized(requiredUser, async (authSession) => {
        try {
            const commentText = `[Перенос на ${newDueDateStr}] ${reason}`;
            const payload = {
                status: "🔵 Перенесено",
                due_date_str: newDueDateStr,
                comment: commentText,
                pin_code: authSession ? authSession.pin : "",
                user_name: authSession ? authSession.name : ""
            };

            const res = await fetch(`/api/tasks/${taskId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                closeRescheduleModal();
                showToast(`Срок перенесён на ${newDueDateStr} 🔵`);
                loadTasks();
            } else {
                const err = await res.json();
                alert("Ошибка переноса: " + (err.detail || "Не удалось сохранить"));
            }
        } catch (e) {
            console.error("Error rescheduling task:", e);
            alert("Произошла ошибка сети при переносе срока");
        }
    }, task, "interact");
}

/* ==========================================================
   3. CANCEL TASK MODAL
   ========================================================== */
function openCancelTaskModal(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    pendingCancelTaskId = taskId;

    document.getElementById("cancel-task-id").value = taskId;
    document.getElementById("cancel-task-code").textContent = task.code || `TSK-${task.id}`;
    document.getElementById("cancel-task-title").textContent = task.title || "—";
    document.getElementById("cancel-task-reason").value = "";

    const chips = document.querySelectorAll("#cancel-reason-chips .reason-chip");
    chips.forEach(c => c.classList.remove("selected-danger"));

    document.getElementById("cancel-task-modal").style.display = "flex";
}

function closeCancelModal() {
    const modal = document.getElementById("cancel-task-modal");
    if (modal) modal.style.display = "none";
    if (pendingCancelTaskId) {
        restoreSelectValue(pendingCancelTaskId);
    }
    pendingCancelTaskId = null;
}

function selectCancelChip(btn, text) {
    const chips = document.querySelectorAll("#cancel-reason-chips .reason-chip");
    chips.forEach(c => c.classList.remove("selected-danger"));
    btn.classList.add("selected-danger");

    const reasonInput = document.getElementById("cancel-task-reason");
    if (reasonInput) {
        reasonInput.value = text;
        reasonInput.focus();
    }
}

async function submitCancelModal() {
    const taskId = document.getElementById("cancel-task-id").value;
    const reason = document.getElementById("cancel-task-reason").value.trim();
    const task = allTasks.find(t => t.id == taskId);

    if (!reason) {
        alert("Пожалуйста, обязательно укажите причину отмены задачи!");
        const reasonInput = document.getElementById("cancel-task-reason");
        if (reasonInput) reasonInput.focus();
        return;
    }

    const authorUser = task ? task.author_name : null;
    ensureUserAuthorized(authorUser, async (authSession) => {
        try {
            const commentText = `[Отменено] ${reason}`;
            const res = await fetch(`/api/tasks/${taskId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    status: "🔴 Отменено",
                    comment: commentText,
                    pin_code: authSession ? authSession.pin : "",
                    user_name: authSession ? authSession.name : ""
                })
            });

            if (res.ok) {
                closeCancelModal();
                showToast("Задача отменена 🔴");
                loadTasks();
            } else {
                const err = await res.json();
                alert("Ошибка отмены задачи: " + (err.detail || "Доступ запрещен"));
            }
        } catch (e) {
            console.error("Error cancelling task:", e);
            alert("Произошла ошибка при отмене задачи");
        }
    }, task, "delete_task");
}

/* ==========================================================
   4. REASSIGN TASK MODAL
   ========================================================== */
let pendingReassignTaskId = null;

function openReassignTaskModal(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    const isLocked = !isPlannerAdmin() && (task && task.status && (task.status.includes("Выполнено") || task.status.includes("Отменено")));
    if (isLocked) {
        showToast("🔒 Завершенные и отмененные задачи заблокированы от переадресации", "warning");
        return;
    }

    pendingReassignTaskId = taskId;

    document.getElementById("reassign-task-id").value = taskId;
    document.getElementById("reassign-task-code").textContent = task.code || `TSK-${task.id}`;
    document.getElementById("reassign-task-title").textContent = task.title || "—";
    document.getElementById("reassign-task-current-assignee").textContent = task.assignee_name || "Не назначен";
    
    // Заполняем список сотрудников для выбора
    const assigneeSelect = document.getElementById("reassign-new-assignee");
    if (assigneeSelect) {
        const persons = getUniquePersons();
        // Исключаем текущего исполнителя из выбора
        const availablePersons = persons.filter(p => p !== task.assignee_name);
        assigneeSelect.innerHTML = `<option value="">-- Выберите нового исполнителя --</option>` +
            availablePersons.map(p => `<option value="${p}">${p}</option>`).join('');
    }

    // Служба
    const deptSelect = document.getElementById("reassign-new-department");
    if (deptSelect) {
        deptSelect.value = task.department_service || "";
    }

    // Сброс причины и чипов
    document.getElementById("reassign-task-reason").value = "";
    const chips = document.querySelectorAll("#reassign-reason-chips .reason-chip");
    chips.forEach(c => c.classList.remove("selected"));

    const btnSubmit = document.getElementById("btn-submit-reassign");
    if (btnSubmit) btnSubmit.disabled = false;

    document.getElementById("reassign-task-modal").style.display = "flex";
}

function openReassignModalFromEdit() {
    const taskIdStr = document.getElementById("task-id-input")?.value;
    const taskId = parseInt(taskIdStr, 10);
    if (taskId) {
        closeTaskModal();
        openReassignTaskModal(taskId);
    }
}

function closeReassignModal() {
    const modal = document.getElementById("reassign-task-modal");
    if (modal) modal.style.display = "none";
    pendingReassignTaskId = null;
}

function selectReassignChip(btn, text) {
    const chips = document.querySelectorAll("#reassign-reason-chips .reason-chip");
    chips.forEach(c => c.classList.remove("selected"));
    btn.classList.add("selected");

    const reasonInput = document.getElementById("reassign-task-reason");
    if (reasonInput) {
        reasonInput.value = text;
        reasonInput.focus();
    }
}

async function submitReassignModal() {
    const taskId = parseInt(document.getElementById("reassign-task-id").value, 10);
    const newAssignee = document.getElementById("reassign-new-assignee")?.value.trim();
    const newDept = document.getElementById("reassign-new-department")?.value.trim();
    const reason = document.getElementById("reassign-task-reason")?.value.trim();
    const task = allTasks.find(t => t.id === taskId);

    if (!newAssignee) {
        alert("Пожалуйста, выберите нового исполнителя!");
        const assigneeSelect = document.getElementById("reassign-new-assignee");
        if (assigneeSelect) assigneeSelect.focus();
        return;
    }

    if (!reason) {
        alert("Пожалуйста, обязательно укажите причину переадресации задачи!");
        const reasonInput = document.getElementById("reassign-task-reason");
        if (reasonInput) reasonInput.focus();
        return;
    }

    const btnSubmit = document.getElementById("btn-submit-reassign");
    if (btnSubmit) btnSubmit.disabled = true;

    // Авторизация: проверяем сессию текущего пользователя (или исполнителя/автора)
    const requiredUser = task ? (task.assignee_name || task.author_name) : null;
    ensureUserAuthorized(requiredUser, async (authSession) => {
        try {
            const payload = {
                new_assignee: newAssignee,
                reason: reason,
                new_department_service: newDept || null,
                reassigned_by: authSession ? authSession.name : (currentPlannerUser ? currentPlannerUser.name : task.assignee_name),
                pin_code: authSession ? authSession.pin : ""
            };

            const res = await fetch(`/api/tasks/${taskId}/reassign`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                closeReassignModal();
                showToast(`Задача переадресована сотруднику ${newAssignee} 🔄`);
                loadTasks();
            } else {
                const err = await res.json();
                alert("Ошибка переадресации: " + (err.detail || "Не удалось переадресовать"));
                if (btnSubmit) btnSubmit.disabled = false;
            }
        } catch (e) {
            console.error("Error reassigning task:", e);
            alert("Произошла ошибка сети при переадресации задачи");
            if (btnSubmit) btnSubmit.disabled = false;
        }
    });
}

async function inlineEditComment(taskId, currentComment) {
    const task = allTasks.find(t => t.id === taskId);
    const isLocked = !isPlannerAdmin() && (task && task.status && (task.status.includes("Выполнено") || task.status.includes("Отменено")));
    if (isLocked) {
        showToast("🔒 Нельзя редактировать комментарий завершенной или отмененной задачи", "warning");
        return;
    }
    const requiredUser = task ? (task.assignee_name || task.author_name) : null;

    ensureUserAuthorized(requiredUser, async (authSession) => {
        const newComment = prompt("Введите факт / комментарий к задаче:", currentComment);
        if (newComment === null) return;

        if (task) task.comment = newComment;

        try {
            const res = await fetch(`/api/tasks/${taskId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    comment: newComment,
                    pin_code: authSession ? authSession.pin : "",
                    user_name: authSession ? authSession.name : ""
                })
            });
            if (res.ok) {
                showToast("Комментарий сохранен");
                loadTasks();
            } else {
                const err = await res.json();
                alert("Ошибка: " + (err.detail || "Не удалось сохранить комментарий"));
            }
        } catch (e) {
            console.error("Error updating comment:", e);
        }
    }, task, "interact");
}

/* ==========================================================
   TRANSLATION (RU <-> KZ) - SMART BIDIRECTIONAL ANALYZER
   ========================================================== */
let translateDebounceTimer = null;
let isTranslating = false;

function onTaskInputChanged(source) {
    // Автоперевод отключен по регламенту модернизации планера
    return;
}

function debounceAutoTranslateModal() {
    return;
}

/* ==========================================================
   DATE HELPERS & PRESETS
   ========================================================== */
function parseDateToIso(dateStr) {
    if (!dateStr) return "";
    const clean = dateStr.trim();
    // Формат DD.MM.YYYY или DD.MM
    const ddmmyyyy = clean.match(/^(\d{1,2})[\.\/\-](\d{1,2})(?:[\.\/\-](\d{2,4}))?$/);
    if (ddmmyyyy) {
        const day = ddmmyyyy[1].padStart(2, '0');
        const month = ddmmyyyy[2].padStart(2, '0');
        let year = ddmmyyyy[3];
        if (!year) {
            year = new Date().getFullYear();
        } else if (year.length === 2) {
            year = "20" + year;
        }
        return `${year}-${month}-${day}`;
    }
    // Формат YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
        return clean;
    }
    return "";
}

function formatIsoToDisplayDate(isoStr) {
    if (!isoStr) return "В теч. недели";
    const parts = isoStr.split('-');
    if (parts.length === 3) {
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        const daysRu = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
        const dayName = daysRu[d.getDay()] || "";
        return `${parts[2]}.${parts[1]} (${dayName})`;
    }
    return isoStr;
}

function setDuePreset(preset) {
    const d = new Date();
    if (preset === 'today') {
        // Today
    } else if (preset === 'this_fri') {
        const day = d.getDay(); // 0 Sun, 1 Mon ... 5 Fri, 6 Sat
        const isoDay = day === 0 ? 7 : day;
        const diff = 5 - isoDay;
        d.setDate(d.getDate() + diff);
    } else if (preset === 'next_fri') {
        const day = d.getDay();
        const isoDay = day === 0 ? 7 : day;
        const diff = (5 - isoDay) + 7;
        d.setDate(d.getDate() + diff);
    } else if (preset === 'plus_2w') {
        d.setDate(d.getDate() + 14);
    } else if (preset === 'month_end') {
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        d.setDate(lastDay.getDate());
    }

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const isoVal = `${yyyy}-${mm}-${dd}`;

    const dueInput = document.getElementById("task-due-input");
    if (dueInput) {
        dueInput.value = isoVal;
        onDueDateInputChanged(isoVal);
    }
}

let _dueResolveAbort = null;
async function onDueDateInputChanged(dateVal) {
    const badge = document.getElementById("task-due-target-badge");
    if (!badge) return;

    if (!dateVal) {
        badge.style.display = "none";
        badge.innerHTML = "";
        return;
    }

    const dispDate = formatIsoToDisplayDate(dateVal);
    badge.style.display = "inline-flex";
    badge.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="font-size: 10px;"></i> <span>Определение недели...</span>`;

    try {
        if (_dueResolveAbort) _dueResolveAbort.abort();
        _dueResolveAbort = new AbortController();

        const res = await fetch(`/api/tasks/resolve_week?date_str=${encodeURIComponent(dispDate)}`, {
            signal: _dueResolveAbort.signal
        });
        if (res.ok) {
            const data = await res.json();
            if (data.status === "ok" && data.month_label && data.week_label) {
                badge.innerHTML = `<i class="fa-solid fa-crosshairs" style="color: #2563eb;"></i> <span>Попадёт в: <b>${data.month_label} · ${data.week_label}</b></span>`;
                badge.className = "due-date-target-badge";
                if (data.target_quarter) {
                    const qInp = document.getElementById("task-quarter-input");
                    if (qInp) {
                        let hasOpt = Array.from(qInp.options).some(o => o.value === data.target_quarter);
                        if (!hasOpt) {
                            const opt = document.createElement("option");
                            opt.value = data.target_quarter;
                            opt.textContent = data.target_quarter;
                            qInp.appendChild(opt);
                        }
                        qInp.value = data.target_quarter;
                    }
                }
            } else {
                badge.innerHTML = `<i class="fa-solid fa-calendar" style="color: #64748b;"></i> <span>Срок: <b>${dispDate}</b></span>`;
            }
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            badge.innerHTML = `<i class="fa-solid fa-calendar" style="color: #64748b;"></i> <span>Срок: <b>${dispDate}</b></span>`;
        }
    }
}

/* ==========================================================
   MODAL CREATE & EDIT
   ========================================================== */
/* ==========================================================
   UNIVERSAL MULTI-BLOCKER PICKER COMPONENT (Rule 27)
   Cross-Tab Parity: Unifies blocker selection across
   Task Modal, Inspector, New Stage Modal, and Quick Subtask Modal
   ========================================================== */

const blockerPickerRegistries = new Map();

/**
 * @canonical-pattern MultiBlockerPicker
 * @established 2026-10-26 (commit 50b45c7)
 * @description Общесистемный эталон выбора связанных сущностей / блокеров.
 * @compliance Rule 27, Anti-Overflow Guard, Multi-Select Chips, Live Search
 * @param {string|HTMLElement} containerOrId - Контейнер для рендеринга
 * @param {Object} options - Параметры конфигурации
 */
function renderMultiBlockerPicker(containerOrId, options = {}) {
    const container = typeof containerOrId === 'string' ? document.getElementById(containerOrId) : containerOrId;
    if (!container) return;

    const pickerId = options.pickerId || container.id || ('picker_' + Math.random().toString(36).substr(2, 9));
    const currentTaskId = options.currentTaskId ? parseInt(options.currentTaskId, 10) : null;
    let selectedIds = new Set(
        Array.isArray(options.selectedIds) 
            ? options.selectedIds.map(x => parseInt(x, 10)).filter(x => !isNaN(x))
            : (options.selectedIds ? [parseInt(options.selectedIds, 10)] : [])
    );
    const parentProjectId = options.parentProjectId ? parseInt(options.parentProjectId, 10) : null;
    const allCandidates = (options.allTasksList && options.allTasksList.length > 0)
        ? options.allTasksList 
        : ((typeof allTasks !== 'undefined' && allTasks.length > 0) ? allTasks : (typeof currentGraphData !== 'undefined' ? (currentGraphData?.nodes || []) : []));
    const onChange = typeof options.onChange === 'function' ? options.onChange : null;
    const compact = Boolean(options.compact);
    const labelText = options.label || "Зависит от этапов (Блокеры)";

    const state = {
        pickerId,
        container,
        currentTaskId,
        selectedIds,
        parentProjectId,
        allCandidates,
        onChange,
        compact,
        labelText,
        filterText: ""
    };

    blockerPickerRegistries.set(pickerId, state);
    renderBlockerPickerDOM(state);
}

function getMultiBlockerSelectedIds(pickerIdOrContainer) {
    let state = null;
    if (typeof pickerIdOrContainer === 'string') {
        state = blockerPickerRegistries.get(pickerIdOrContainer);
        if (!state) {
            const el = document.getElementById(pickerIdOrContainer);
            if (el) state = blockerPickerRegistries.get(el.id);
        }
    } else if (pickerIdOrContainer && pickerIdOrContainer.id) {
        state = blockerPickerRegistries.get(pickerIdOrContainer.id);
    }
    if (state && state.selectedIds) {
        return Array.from(state.selectedIds);
    }
    const cEl = typeof pickerIdOrContainer === 'string' ? document.getElementById(pickerIdOrContainer) : pickerIdOrContainer;
    if (cEl) {
        const cbs = cEl.querySelectorAll(".blocker-item-checkbox:checked");
        return Array.from(cbs).map(cb => parseInt(cb.value, 10)).filter(x => !isNaN(x));
    }
    return [];
}

function renderBlockerPickerDOM(state) {
    const { pickerId, container, currentTaskId, selectedIds, parentProjectId, allCandidates, labelText, filterText } = state;
    
    // Filter candidates (exclude self)
    const candidates = (allCandidates || []).filter(t => t && t.id && t.id !== currentTaskId);

    // Grouping: current project stages vs other tasks
    let projectStages = [];
    let otherTasks = [];

    if (parentProjectId) {
        projectStages = candidates.filter(t => t.parent_id === parentProjectId || t.id === parentProjectId);
        const stageIds = new Set(projectStages.map(s => s.id));
        otherTasks = candidates.filter(t => !stageIds.has(t.id));
    } else {
        projectStages = candidates.filter(t => t.task_type === 'roadmap' || t.task_type === 'milestone');
        const stageIds = new Set(projectStages.map(s => s.id));
        otherTasks = candidates.filter(t => !stageIds.has(t.id));
    }

    const query = (filterText || "").trim().toLowerCase();
    const matchesFilter = (t) => {
        if (!query) return true;
        const code = (t.code || `TSK-${t.id}`).toLowerCase();
        const title = (t.title || "").toLowerCase();
        const assignee = (t.assignee_name || "").toLowerCase();
        return code.includes(query) || title.includes(query) || assignee.includes(query);
    };

    const filteredProjectStages = projectStages.filter(matchesFilter);
    const filteredOtherTasks = otherTasks.filter(matchesFilter);

    // Selected chips
    const chipsHtml = Array.from(selectedIds).map(id => {
        const item = candidates.find(t => t.id === id) || { id, code: `TSK-${id}`, title: `Задача #${id}` };
        return `
            <div class="blocker-chip" title="${escapeHtml(item.title)}">
                <span class="blocker-chip-code">${item.code || 'TSK-' + item.id}</span>
                <span class="blocker-chip-title">${escapeHtml(item.title)}</span>
                <span class="blocker-chip-del" onclick="removeMultiBlockerItem('${pickerId}', ${item.id})" title="Удалить блокер">&times;</span>
            </div>
        `;
    }).join('');

    const count = selectedIds.size;

    const renderRow = (t) => {
        const isChecked = selectedIds.has(t.id);
        const isDone = (t.status || "").includes("Выполнено");
        const statusEmoji = isDone ? '🟢' : ((t.status || "").includes("Отменено") ? '🔴' : '🟡');
        return `
            <label class="blocker-item-label ${isChecked ? 'is-checked' : ''}" title="${escapeHtml(t.title)}">
                <input type="checkbox" class="blocker-item-checkbox" value="${t.id}" ${isChecked ? 'checked' : ''} onchange="toggleMultiBlockerItem('${pickerId}', ${t.id}, this.checked)">
                <span class="blocker-item-code">${t.code || ('TSK-' + t.id)}</span>
                <span>${statusEmoji}</span>
                <span class="blocker-item-title">${escapeHtml(t.title)}</span>
                ${isDone ? '<span class="blocker-item-status" style="color: #16a34a; background: #dcfce7; font-weight: 600;">Готово</span>' : ''}
            </label>
        `;
    };

    let listContentHtml = '';

    if (projectStages.length > 0) {
        listContentHtml += `
            <div class="blocker-group-divider" style="color: #6d28d9;">
                <span><i class="fa-solid fa-flag-checkered"></i> Этапы текущего проекта (${filteredProjectStages.length})</span>
            </div>
        `;
        if (filteredProjectStages.length === 0) {
            listContentHtml += `<div style="font-size: 0.72rem; color: #94a3b8; padding: 4px; font-style: italic;">Не найдено по запросу «${escapeHtml(query)}»</div>`;
        } else {
            listContentHtml += filteredProjectStages.map(renderRow).join('');
        }
    }

    if (otherTasks.length > 0) {
        const otherCheckedCount = otherTasks.filter(t => selectedIds.has(t.id)).length;
        const isOpen = query.length > 0 || otherCheckedCount > 0 || projectStages.length === 0;
        listContentHtml += `
            <details class="blocker-other-details" ${isOpen ? 'open' : ''} style="margin-top: 4px;">
                <summary style="cursor: pointer; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; color: #64748b; padding: 4px 2px; list-style: none; display: flex; align-items: center; justify-content: space-between;">
                    <span><i class="fa-solid fa-list-ul"></i> Другие проекты и задачи (${filteredOtherTasks.length})</span>
                    ${otherCheckedCount > 0 ? `<span style="color: #7c3aed; font-size: 0.66rem; background: #ede9fe; padding: 1px 6px; border-radius: 4px;">${otherCheckedCount} выбрано</span>` : '<span style="font-size: 0.68rem; color: #94a3b8;">Развернуть</span>'}
                </summary>
                <div style="display: flex; flex-direction: column; gap: 3px; padding-top: 3px;">
                    ${filteredOtherTasks.length === 0 ? `<div style="font-size: 0.72rem; color: #94a3b8; padding: 4px; font-style: italic;">Не найдено</div>` : filteredOtherTasks.map(renderRow).join('')}
                </div>
            </details>
        `;
    }

    if (!projectStages.length && !otherTasks.length) {
        listContentHtml = `<div style="font-size: 0.72rem; color: #94a3b8; padding: 6px; font-style: italic;">Нет доступных задач для связывания</div>`;
    }

    container.innerHTML = `
        <div class="multi-blocker-picker">
            <div class="multi-blocker-header">
                <label class="multi-blocker-label">
                    <i class="fa-solid fa-link" style="color: #f59e0b;"></i> ${escapeHtml(labelText)}
                </label>
                <span class="multi-blocker-count ${count > 0 ? 'has-selected' : ''}">${count} выбрано</span>
            </div>

            <div class="multi-blocker-chips" id="${pickerId}_chips">
                ${chipsHtml || '<span class="multi-blocker-empty-hint">Нет блокеров (этап выполняется сразу)</span>'}
            </div>

            <div class="multi-blocker-search">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" placeholder="Поиск этапа по коду или названию..." value="${escapeHtml(filterText || '')}" oninput="onMultiBlockerSearch('${pickerId}', this.value)">
            </div>

            <div class="multi-blocker-list" id="${pickerId}_list">
                ${listContentHtml}
            </div>

            <div style="font-size: 0.67rem; color: #94a3b8; line-height: 1.3; margin-top: 2px;">
                💡 Отметьте один или несколько этапов. Задача разблокируется только когда <strong>все</strong> выбранные этапы будут выполнены.
            </div>
        </div>
    `;
}

function onMultiBlockerSearch(pickerId, query) {
    const state = blockerPickerRegistries.get(pickerId);
    if (!state) return;
    state.filterText = query;
    renderBlockerPickerDOM(state);
    const searchInput = state.container.querySelector('.multi-blocker-search input');
    if (searchInput) {
        searchInput.focus();
        searchInput.setSelectionRange(query.length, query.length);
    }
}

function toggleMultiBlockerItem(pickerId, id, isChecked) {
    const state = blockerPickerRegistries.get(pickerId);
    if (!state) return;
    id = parseInt(id, 10);
    if (isChecked) {
        state.selectedIds.add(id);
    } else {
        state.selectedIds.delete(id);
    }
    renderBlockerPickerDOM(state);
    if (typeof state.onChange === 'function') {
        state.onChange(Array.from(state.selectedIds));
    }
}

function removeMultiBlockerItem(pickerId, id) {
    const state = blockerPickerRegistries.get(pickerId);
    if (!state) return;
    id = parseInt(id, 10);
    state.selectedIds.delete(id);
    renderBlockerPickerDOM(state);
    if (typeof state.onChange === 'function') {
        state.onChange(Array.from(state.selectedIds));
    }
}

function onTaskParentInputChange(newParentId) {
    const parentId = newParentId ? parseInt(newParentId, 10) : null;
    const pickerContainer = document.getElementById("task-blockers-picker-container");
    if (pickerContainer) {
        const curIds = getMultiBlockerSelectedIds("task-modal-blockers");
        const taskId = document.getElementById("task-id-input").value ? parseInt(document.getElementById("task-id-input").value, 10) : null;
        renderMultiBlockerPicker(pickerContainer, {
            pickerId: "task-modal-blockers",
            currentTaskId: taskId,
            selectedIds: curIds,
            parentProjectId: parentId
        });
    }
}

/* ==========================================================
   MODAL CREATE & EDIT (3 HORIZONS, ROADMAPS, SERVICES)
   ========================================================== */
let cachedAllHierarchyTasks = null;
let lastHierarchyTasksFetchTime = 0;
const HIERARCHY_CACHE_TTL = 60000;
let hierarchyTasksInFlight = null;

function fetchAllHierarchyTasksBackground(force = false) {
    const now = Date.now();
    if (!force && cachedAllHierarchyTasks && (now - lastHierarchyTasksFetchTime < HIERARCHY_CACHE_TTL)) {
        return Promise.resolve(cachedAllHierarchyTasks);
    }
    if (hierarchyTasksInFlight) return hierarchyTasksInFlight;

    hierarchyTasksInFlight = fetch("/api/tasks?task_type=roadmap,milestone&month=all")
        .then(res => res.ok ? res.json() : [])
        .then(data => {
            cachedAllHierarchyTasks = data;
            lastHierarchyTasksFetchTime = Date.now();
            hierarchyTasksInFlight = null;
            return data;
        })
        .catch(err => {
            console.warn("Background fetch hierarchy tasks error:", err);
            hierarchyTasksInFlight = null;
            return cachedAllHierarchyTasks || allTasks || [];
        });
    return hierarchyTasksInFlight;
}

function renderHierarchyDropdownsFromData(allT, currentTaskId, defaultParentId, initialDepIds) {
    const parentSelect = document.getElementById("task-parent-input");
    const pickerContainer = document.getElementById("task-blockers-picker-container");

    if (parentSelect) {
        const curParentVal = parentSelect.value;
        const targetParentVal = (defaultParentId !== null && defaultParentId !== undefined) ? defaultParentId : curParentVal;
        const roadmapsAndMilestones = allT.filter(t => (t.task_type === 'roadmap' || t.task_type === 'milestone') && t.id !== currentTaskId);
        parentSelect.innerHTML = `<option value="">-- Без родительского проекта --</option>` +
            roadmapsAndMilestones.map(p => `<option value="${p.id}">${p.task_type === 'roadmap' ? '🗺️' : '📍'} [${p.code || ('TSK-' + p.id)}] ${escapeHtml(p.title)}</option>`).join('');
        if (targetParentVal) parentSelect.value = targetParentVal;
    }

    if (pickerContainer) {
        const effectiveParentId = (defaultParentId !== null && defaultParentId !== undefined) ? defaultParentId : (parentSelect && parentSelect.value ? parseInt(parentSelect.value, 10) : null);
        renderMultiBlockerPicker(pickerContainer, {
            pickerId: "task-modal-blockers",
            currentTaskId: currentTaskId,
            selectedIds: initialDepIds,
            parentProjectId: effectiveParentId,
            allTasksList: allT
        });
    }
}

async function populateHierarchyDropdowns(currentTaskId = null, defaultParentId = null, defaultDependsIds = null) {
    let initialDepIds = [];
    if (Array.isArray(defaultDependsIds)) {
        initialDepIds = defaultDependsIds;
    } else if (defaultDependsIds) {
        initialDepIds = [defaultDependsIds];
    }

    // Мгновенная синхронная отрисовка (0 мс) из кэша или локального списка
    const fastTasks = cachedAllHierarchyTasks || (allTasks && allTasks.length > 0 ? allTasks : null);
    if (fastTasks && fastTasks.length > 0) {
        renderHierarchyDropdownsFromData(fastTasks, currentTaskId, defaultParentId, initialDepIds);
    }

    // Фоновая актуализация, если кэш пуст или устарел (> 60 сек)
    const now = Date.now();
    if (!cachedAllHierarchyTasks || (now - lastHierarchyTasksFetchTime >= HIERARCHY_CACHE_TTL)) {
        fetchAllHierarchyTasksBackground().then(freshData => {
            if (freshData && freshData.length) {
                const modal = document.getElementById("task-modal");
                if (modal && modal.style.display !== "none") {
                    renderHierarchyDropdownsFromData(freshData, currentTaskId, defaultParentId, initialDepIds);
                }
            }
        });
    }
}

function updateModalHorizonBadge(taskType) {
    const badgeMap = {
        weekly: { text: "⚡ Недельный спринт", cls: "badge-weekly" },
        service_plan: { text: "🔧 План службы", cls: "badge-services" },
        tech_council: { text: "🏛️ Техсовет", cls: "badge-tech_council" },
        quality_day: { text: "📋 День качества", cls: "badge-quality_day" },
        roadmap: { text: "🗺️ Дорожная карта", cls: "badge-roadmaps" },
        milestone: { text: "📍 Этап проекта", cls: "badge-roadmaps" }
    };
    const bInfo = badgeMap[taskType] || badgeMap.weekly;
    const badgeEl = document.getElementById("modal-horizon-badge");
    if (badgeEl) {
        badgeEl.textContent = bInfo.text;
        badgeEl.className = `modal-horizon-badge ${bInfo.cls}`;
    }
}

function updateTaskAuthorCard(authorName) {
    const authorInput = document.getElementById("task-author-input");
    const nameEl = document.getElementById("task-author-name-text");
    const avatarEl = document.getElementById("task-author-avatar");
    const roleEl = document.getElementById("task-author-role-text");

    const name = (authorName && typeof authorName === 'string' && authorName.trim()) 
        ? authorName.trim() 
        : (currentPlannerUser && currentPlannerUser.name ? currentPlannerUser.name : "Пользователь");
    
    if (authorInput) authorInput.value = name;
    if (nameEl) nameEl.textContent = name;
    
    const parts = name.split(/\s+/).filter(Boolean);
    let initials = "";
    if (parts.length >= 2) {
        initials = (parts[0][0] + parts[1][0]).toUpperCase();
    } else if (parts.length === 1) {
        initials = parts[0].slice(0, 2).toUpperCase();
    } else {
        initials = "👤";
    }
    if (avatarEl) avatarEl.textContent = initials;

    let roleText = "Автор";
    if (typeof plannerUsers !== 'undefined' && Array.isArray(plannerUsers)) {
        const u = plannerUsers.find(x => x.name === name);
        if (u && (u.role_title || u.role)) {
            roleText = u.role_title || u.role;
        }
    }
    if (roleEl) roleEl.textContent = roleText;
}

/* ==========================================================================
   CANONICAL PERSON PICKER FOR TASK MODAL (Rule 7 Single Source of Truth)
   ========================================================================== */
function positionTaskAssigneePopover() {
    const popover = document.getElementById("popover-task-assignee");
    const trigger = document.getElementById("btn-task-assignee-trigger");
    if (!popover || !trigger || popover.style.display !== "block") return;

    if (popover.parentElement !== document.body) {
        document.body.appendChild(popover);
    }

    const rect = trigger.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const popoverWidth = Math.min(Math.max(Math.round(rect.width), 320), window.innerWidth - 24);
    popover.style.setProperty("width", popoverWidth + "px", "important");
    popover.style.setProperty("position", "fixed", "important");
    popover.style.setProperty("z-index", "99999", "important");
    popover.style.setProperty("right", "auto", "important");

    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedHeight = 310;

    if (spaceBelow < estimatedHeight && rect.top > estimatedHeight) {
        popover.style.setProperty("top", "auto", "important");
        popover.style.setProperty("bottom", Math.round(window.innerHeight - rect.top + 6) + "px", "important");
    } else {
        popover.style.setProperty("bottom", "auto", "important");
        popover.style.setProperty("top", Math.round(rect.bottom + 6) + "px", "important");
    }

    let left = Math.round(rect.left);
    if (left + popoverWidth > window.innerWidth - 12) {
        left = window.innerWidth - popoverWidth - 12;
    }
    if (left < 12) left = 12;
    popover.style.setProperty("left", left + "px", "important");
}

document.addEventListener('scroll', function(e) {
    const pop = document.getElementById("popover-task-assignee");
    if (pop && pop.style.display === "block") {
        positionTaskAssigneePopover();
    }
}, true);

function toggleTaskAssigneePopover(event) {
    if (event) event.stopPropagation();
    const popover = document.getElementById("popover-task-assignee");
    const trigger = document.getElementById("btn-task-assignee-trigger");
    if (!popover) return;

    if (popover.parentElement !== document.body) {
        document.body.appendChild(popover);
    }

    const isVisible = (popover.style.display === "block");
    if (isVisible) {
        closeTaskAssigneePopover();
    } else {
        closeTaskZonePopover();
        renderTaskAssigneePickerList("");
        popover.style.display = "block";
        if (trigger) trigger.classList.add("popover-open");
        positionTaskAssigneePopover();
        setTimeout(positionTaskAssigneePopover, 20);
        const searchInput = document.getElementById("search-task-assignee");
        if (searchInput) {
            searchInput.value = "";
            setTimeout(() => {
                try { searchInput.focus({ preventScroll: true }); } catch(e) { searchInput.focus(); }
            }, 60);
        }
    }
}

window.addEventListener("resize", function() {
    positionTaskAssigneePopover();
}, { passive: true });
window.addEventListener("scroll", function() {
    positionTaskAssigneePopover();
}, { passive: true });

function closeTaskAssigneePopover() {
    const popover = document.getElementById("popover-task-assignee");
    const trigger = document.getElementById("btn-task-assignee-trigger");
    if (popover) popover.style.display = "none";
    if (trigger) trigger.classList.remove("popover-open");
}

function updateTaskAssigneeDisplay(assigneeName) {
    const hiddenInput = document.getElementById("task-assignee-input");
    const displayEl = document.getElementById("task-assignee-display-text");
    const avatarEl = document.getElementById("task-assignee-avatar");

    const name = (assigneeName && typeof assigneeName === 'string') ? assigneeName.trim() : "";
    if (hiddenInput) hiddenInput.value = name;

    if (!name) {
        if (displayEl) {
            displayEl.textContent = "-- Выберите исполнителя --";
            displayEl.style.color = "#64748b";
            displayEl.style.fontWeight = "normal";
        }
        if (avatarEl) {
            avatarEl.className = "author-avatar-circle";
            avatarEl.style.background = "#f1f5f9";
            avatarEl.style.color = "#64748b";
            avatarEl.innerHTML = '<i class="fa-solid fa-user"></i>';
        }
        return;
    }

    if (displayEl) {
        displayEl.textContent = name;
        displayEl.style.color = "#1e293b";
        displayEl.style.fontWeight = "600";
    }

    if (avatarEl) {
        const initials = getInitials(name);
        const colorClass = getAvatarColorClass(name);
        avatarEl.className = `author-avatar-circle ${colorClass}`;
        avatarEl.style.background = "";
        avatarEl.style.color = "";
        avatarEl.textContent = initials;
    }
}

function selectTaskAssignee(name) {
    updateTaskAssigneeDisplay(name);
    closeTaskAssigneePopover();
}

function renderTaskAssigneePickerList(filterQuery = '') {
    const listEl = document.getElementById("list-task-assignee");
    if (!listEl) return;

    const persons = (typeof getUniquePersons === 'function') ? getUniquePersons() : [];
    const currentVal = document.getElementById("task-assignee-input")?.value || "";

    const taskCountMap = {};
    if (Array.isArray(allTasks)) {
        allTasks.forEach(t => {
            const p = t.assignee || t.assignee_name;
            if (p) taskCountMap[p] = (taskCountMap[p] || 0) + 1;
        });
    }

    const q = (filterQuery || '').trim().toLowerCase();
    let html = '';

    // 1. Reset / unassigned option
    const isUnassigned = !currentVal;
    html += `
        <div class="filter-option-item ${isUnassigned ? 'selected' : ''}" onclick="selectTaskAssignee('')">
            <div class="filter-option-person-left">
                <div class="person-avatar avatar-gray" style="background: #f1f5f9; color: #64748b;"><i class="fa-solid fa-user-slash" style="font-size: 0.75rem;"></i></div>
                <span class="person-name-text" style="color: #64748b; font-style: italic;">-- Не назначен --</span>
            </div>
        </div>
    `;

    let filteredPersons = persons;
    if (q) {
        filteredPersons = persons.filter(p => p.toLowerCase().includes(q));
    }

    if (filteredPersons.length === 0) {
        html += `<div style="padding: 12px; text-align: center; color: #94a3b8; font-size: 12px;">Ничего не найдено</div>`;
        listEl.innerHTML = html;
        return;
    }

    // Top active persons (with active tasks > 0)
    const activePersons = filteredPersons.filter(p => (taskCountMap[p] || 0) > 0)
        .sort((a, b) => (taskCountMap[b] || 0) - (taskCountMap[a] || 0));

    if (!q && activePersons.length > 0) {
        html += `<div class="filter-group-header">⭐ Часто выбираемые</div>`;
        activePersons.slice(0, 5).forEach(name => {
            const isSel = (currentVal === name) ? 'selected' : '';
            const cnt = taskCountMap[name] || 0;
            const initials = getInitials(name);
            const avatarColor = getAvatarColorClass(name);
            const safeName = name.replace(/'/g, "\\'");
            html += `
                <div class="filter-option-item ${isSel}" onclick="selectTaskAssignee('${safeName}')">
                    <div class="filter-option-person-left">
                        <div class="person-avatar ${avatarColor}">${initials}</div>
                        <span class="person-name-text font-semibold">${escapeHtml(name)}</span>
                    </div>
                    <span class="person-task-badge busy">${cnt} ${cnt === 1 ? 'задача' : (cnt < 5 ? 'задачи' : 'задач')}</span>
                </div>
            `;
        });
    }

    // All employees section
    html += `<div class="filter-group-header">👥 ${q ? 'Результаты поиска' : 'Все сотрудники'} (${filteredPersons.length})</div>`;
    filteredPersons.forEach(name => {
        const isSel = (currentVal === name) ? 'selected' : '';
        const cnt = taskCountMap[name] || 0;
        const initials = getInitials(name);
        const avatarColor = getAvatarColorClass(name);
        const safeName = name.replace(/'/g, "\\'");
        html += `
            <div class="filter-option-item ${isSel}" onclick="selectTaskAssignee('${safeName}')">
                <div class="filter-option-person-left">
                    <div class="person-avatar ${avatarColor}">${initials}</div>
                    <span class="person-name-text">${escapeHtml(name)}</span>
                </div>
                ${cnt > 0 ? `<span class="person-task-badge">${cnt}</span>` : ''}
            </div>
        `;
    });

    listEl.innerHTML = html;
}

/* ==========================================================================
   CANONICAL ZONE PICKER COMPONENT (MODAL POPOVER)
   @canonical-pattern ZonePickerPopover
   @established 2026-10-26
   @description 48px trigger with folder icon, smooth chevron, and body-portaled fixed dropdown popover with search.
   ========================================================================== */

function getTaskModalZones() {
    let zones = (typeof getPlannerZones === 'function') ? getPlannerZones() : [];
    if (!zones || zones.length === 0) {
        zones = [
            "Бережливое производство", "Техсовет", "День качества", "Ремонт и зоны",
            "Инфостенды", "Обучение", "Цифровой портал", "СКК", "Документация",
            "Цилиндры", "Дестакер", "Дозировка", "ЗО", "Зона двигателей", "Слесарная мастерская"
        ];
    }
    if (Array.isArray(allTasks)) {
        allTasks.forEach(t => {
            if (t.zone && !zones.includes(t.zone)) {
                zones.push(t.zone);
            }
        });
    }
    return zones;
}

function positionTaskZonePopover() {
    const popover = document.getElementById("popover-task-zone");
    const trigger = document.getElementById("btn-task-zone-trigger");
    if (!popover || !trigger || popover.style.display !== "block") return;

    if (popover.parentElement !== document.body) {
        document.body.appendChild(popover);
    }

    const rect = trigger.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const popoverWidth = Math.min(Math.max(Math.round(rect.width), 320), window.innerWidth - 24);
    popover.style.setProperty("width", popoverWidth + "px", "important");
    popover.style.setProperty("position", "fixed", "important");
    popover.style.setProperty("z-index", "99999", "important");
    popover.style.setProperty("right", "auto", "important");

    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedHeight = 320;

    if (spaceBelow < estimatedHeight && rect.top > estimatedHeight) {
        popover.style.setProperty("top", "auto", "important");
        popover.style.setProperty("bottom", Math.round(window.innerHeight - rect.top + 6) + "px", "important");
    } else {
        popover.style.setProperty("bottom", "auto", "important");
        popover.style.setProperty("top", Math.round(rect.bottom + 6) + "px", "important");
    }

    let left = Math.round(rect.left);
    if (left + popoverWidth > window.innerWidth - 12) {
        left = window.innerWidth - popoverWidth - 12;
    }
    if (left < 12) left = 12;
    popover.style.setProperty("left", left + "px", "important");
}

document.addEventListener('scroll', function(e) {
    const pop = document.getElementById("popover-task-zone");
    if (pop && pop.style.display === "block") {
        positionTaskZonePopover();
    }
}, true);

window.addEventListener("resize", function() {
    positionTaskZonePopover();
}, { passive: true });
window.addEventListener("scroll", function() {
    positionTaskZonePopover();
}, { passive: true });

function toggleTaskZonePopover(event) {
    if (event) event.stopPropagation();
    const popover = document.getElementById("popover-task-zone");
    const trigger = document.getElementById("btn-task-zone-trigger");
    if (!popover) return;

    if (popover.parentElement !== document.body) {
        document.body.appendChild(popover);
    }

    const isVisible = (popover.style.display === "block");
    if (isVisible) {
        closeTaskZonePopover();
    } else {
        closeTaskAssigneePopover();
        renderTaskZonePickerList("");
        popover.style.display = "block";
        if (trigger) trigger.classList.add("popover-open");
        positionTaskZonePopover();
        setTimeout(positionTaskZonePopover, 20);
        const searchInput = document.getElementById("search-task-zone");
        if (searchInput) {
            searchInput.value = "";
            setTimeout(() => {
                try { searchInput.focus({ preventScroll: true }); } catch(e) { searchInput.focus(); }
            }, 60);
        }
    }
}

function closeTaskZonePopover() {
    const popover = document.getElementById("popover-task-zone");
    const trigger = document.getElementById("btn-task-zone-trigger");
    if (popover) popover.style.display = "none";
    if (trigger) trigger.classList.remove("popover-open");
}

function updateTaskZoneDisplay(zoneName) {
    const hiddenInput = document.getElementById("task-zone-input");
    const displayEl = document.getElementById("task-zone-display-text");
    const iconEl = document.getElementById("task-zone-icon");

    const name = (zoneName && typeof zoneName === 'string') ? zoneName.trim() : "";
    if (hiddenInput) hiddenInput.value = name;

    if (!name) {
        if (displayEl) {
            displayEl.textContent = "-- Выберите зону / участок --";
            displayEl.style.color = "#64748b";
            displayEl.style.fontWeight = "normal";
        }
        if (iconEl) {
            iconEl.style.background = "#f1f5f9";
            iconEl.style.color = "#64748b";
            iconEl.innerHTML = '<i class="fa-solid fa-folder"></i>';
        }
        return;
    }

    if (displayEl) {
        displayEl.textContent = name;
        displayEl.style.color = "#1e293b";
        displayEl.style.fontWeight = "600";
    }

    if (iconEl) {
        iconEl.style.background = "#eff6ff";
        iconEl.style.color = "#2563eb";
        iconEl.innerHTML = '<i class="fa-solid fa-folder"></i>';
    }
}

function selectTaskZone(name) {
    updateTaskZoneDisplay(name);
    closeTaskZonePopover();
}

function renderTaskZonePickerList(filterQuery = '') {
    const listEl = document.getElementById("list-task-zone");
    if (!listEl) return;

    const zones = getTaskModalZones();
    const currentVal = document.getElementById("task-zone-input")?.value || "";

    const q = (filterQuery || '').trim().toLowerCase();
    let html = '';

    let filtered = zones;
    if (q) {
        filtered = zones.filter(z => z.toLowerCase().includes(q));
    }

    if (filtered.length === 0) {
        html += `<div style="padding: 12px; text-align: center; color: #94a3b8; font-size: 12px;">Ничего не найдено</div>`;
        listEl.innerHTML = html;
        return;
    }

    html += `<div class="filter-group-header">📁 ${q ? 'Результаты поиска' : 'Все зоны и участки'} (${filtered.length})</div>`;
    filtered.forEach(z => {
        const isSel = (currentVal === z) ? 'selected' : '';
        const safeZ = z.replace(/'/g, "\\'");
        html += `
            <div class="filter-option-item ${isSel}" onclick="selectTaskZone('${safeZ}')">
                <div class="filter-option-person-left">
                    <div class="zone-icon-circle" style="background: ${isSel ? '#dbeafe' : '#f1f5f9'}; color: #2563eb; width: 26px; height: 26px; font-size: 0.8rem;">
                        <i class="fa-solid fa-folder"></i>
                    </div>
                    <span class="person-name-text ${isSel ? 'font-semibold' : ''}">${escapeHtml(z)}</span>
                </div>
                ${isSel ? '<i class="fa-solid fa-check" style="color: #2563eb; font-size: 0.85rem;"></i>' : ''}
            </div>
        `;
    });

    listEl.innerHTML = html;
}

/* ==========================================================================
   CANONICAL BULK MODAL PICKERS (AUTHOR & ZONE)
   @canonical-pattern BulkPickers
   @established 2026-10-26
   ========================================================================== */

function positionBulkAuthorPopover() {
    const popover = document.getElementById("popover-bulk-author");
    const trigger = document.getElementById("btn-bulk-author-trigger");
    if (!popover || !trigger || popover.style.display !== "block") return;

    if (popover.parentElement !== document.body) {
        document.body.appendChild(popover);
    }

    const rect = trigger.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const popoverWidth = Math.min(Math.max(Math.round(rect.width), 260), window.innerWidth - 24);
    popover.style.setProperty("width", popoverWidth + "px", "important");
    popover.style.setProperty("position", "fixed", "important");
    popover.style.setProperty("z-index", "99999", "important");
    popover.style.setProperty("right", "auto", "important");

    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedHeight = 260;

    if (spaceBelow < estimatedHeight && rect.top > estimatedHeight) {
        popover.style.setProperty("top", "auto", "important");
        popover.style.setProperty("bottom", Math.round(window.innerHeight - rect.top + 4) + "px", "important");
    } else {
        popover.style.setProperty("bottom", "auto", "important");
        popover.style.setProperty("top", Math.round(rect.bottom + 4) + "px", "important");
    }

    let left = Math.round(rect.left);
    if (left + popoverWidth > window.innerWidth - 12) {
        left = window.innerWidth - popoverWidth - 12;
    }
    if (left < 12) left = 12;
    popover.style.setProperty("left", left + "px", "important");
}

function toggleBulkAuthorPopover(event) {
    if (event) event.stopPropagation();
    const popover = document.getElementById("popover-bulk-author");
    const trigger = document.getElementById("btn-bulk-author-trigger");
    if (!popover) return;

    if (popover.parentElement !== document.body) {
        document.body.appendChild(popover);
    }

    const isVisible = (popover.style.display === "block");
    if (isVisible) {
        closeBulkAuthorPopover();
    } else {
        closeBulkZonePopover();
        renderBulkAuthorPickerList("");
        popover.style.display = "block";
        if (trigger) trigger.classList.add("popover-open");
        positionBulkAuthorPopover();
        setTimeout(positionBulkAuthorPopover, 20);
        const searchInput = document.getElementById("search-bulk-author");
        if (searchInput) {
            searchInput.value = "";
            setTimeout(() => {
                try { searchInput.focus({ preventScroll: true }); } catch(e) { searchInput.focus(); }
            }, 60);
        }
    }
}

function closeBulkAuthorPopover() {
    const popover = document.getElementById("popover-bulk-author");
    const trigger = document.getElementById("btn-bulk-author-trigger");
    if (popover) popover.style.display = "none";
    if (trigger) trigger.classList.remove("popover-open");
}

function updateBulkAuthorDisplay(authorName) {
    const hiddenInput = document.getElementById("bulk-author-input");
    const displayEl = document.getElementById("bulk-author-display-text");
    const avatarEl = document.getElementById("bulk-author-avatar");

    const name = (authorName && typeof authorName === 'string') ? authorName.trim() : "";
    if (hiddenInput) hiddenInput.value = name;

    if (!name) {
        if (displayEl) {
            displayEl.textContent = "-- Выберите автора --";
            displayEl.style.color = "#64748b";
            displayEl.style.fontWeight = "normal";
        }
        if (avatarEl) {
            avatarEl.className = "author-avatar-circle";
            avatarEl.style.background = "#f1f5f9";
            avatarEl.style.color = "#64748b";
            avatarEl.innerHTML = '<i class="fa-solid fa-user"></i>';
        }
        return;
    }

    if (displayEl) {
        displayEl.textContent = name;
        displayEl.style.color = "#1e293b";
        displayEl.style.fontWeight = "600";
    }

    if (avatarEl) {
        const initials = getInitials(name);
        const colorClass = getAvatarColorClass(name);
        avatarEl.className = `author-avatar-circle ${colorClass}`;
        avatarEl.style.background = "";
        avatarEl.style.color = "";
        avatarEl.textContent = initials;
    }
}

function selectBulkAuthor(name) {
    updateBulkAuthorDisplay(name);
    closeBulkAuthorPopover();
}

function renderBulkAuthorPickerList(filterQuery = '') {
    const listEl = document.getElementById("list-bulk-author");
    if (!listEl) return;

    const persons = (typeof getUniquePersons === 'function') ? getUniquePersons() : [];
    const currentVal = document.getElementById("bulk-author-input")?.value || "";

    const q = (filterQuery || '').trim().toLowerCase();
    let html = '';

    const isUnassigned = !currentVal;
    html += `
        <div class="filter-option-item ${isUnassigned ? 'selected' : ''}" onclick="selectBulkAuthor('')">
            <div class="filter-option-person-left">
                <div class="person-avatar avatar-gray" style="background: #f1f5f9; color: #64748b;"><i class="fa-solid fa-user-slash" style="font-size: 0.75rem;"></i></div>
                <span class="person-name-text" style="color: #64748b; font-style: italic;">-- Не указан --</span>
            </div>
        </div>
    `;

    let filtered = persons;
    if (q) {
        filtered = persons.filter(p => p.toLowerCase().includes(q));
    }

    if (filtered.length === 0) {
        html += `<div style="padding: 12px; text-align: center; color: #94a3b8; font-size: 12px;">Ничего не найдено</div>`;
        listEl.innerHTML = html;
        return;
    }

    html += `<div class="filter-group-header">👥 ${q ? 'Результаты поиска' : 'Все сотрудники'} (${filtered.length})</div>`;
    filtered.forEach(name => {
        const isSel = (currentVal === name) ? 'selected' : '';
        const initials = getInitials(name);
        const avatarColor = getAvatarColorClass(name);
        const safeName = name.replace(/'/g, "\\'");
        html += `
            <div class="filter-option-item ${isSel}" onclick="selectBulkAuthor('${safeName}')">
                <div class="filter-option-person-left">
                    <div class="person-avatar ${avatarColor}">${initials}</div>
                    <span class="person-name-text ${isSel ? 'font-semibold' : ''}">${escapeHtml(name)}</span>
                </div>
                ${isSel ? '<i class="fa-solid fa-check" style="color: #2563eb; font-size: 0.85rem;"></i>' : ''}
            </div>
        `;
    });

    listEl.innerHTML = html;
}

// Bulk Zone
function positionBulkZonePopover() {
    const popover = document.getElementById("popover-bulk-zone");
    const trigger = document.getElementById("btn-bulk-zone-trigger");
    if (!popover || !trigger || popover.style.display !== "block") return;

    if (popover.parentElement !== document.body) {
        document.body.appendChild(popover);
    }

    const rect = trigger.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const popoverWidth = Math.min(Math.max(Math.round(rect.width), 260), window.innerWidth - 24);
    popover.style.setProperty("width", popoverWidth + "px", "important");
    popover.style.setProperty("position", "fixed", "important");
    popover.style.setProperty("z-index", "99999", "important");
    popover.style.setProperty("right", "auto", "important");

    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedHeight = 260;

    if (spaceBelow < estimatedHeight && rect.top > estimatedHeight) {
        popover.style.setProperty("top", "auto", "important");
        popover.style.setProperty("bottom", Math.round(window.innerHeight - rect.top + 4) + "px", "important");
    } else {
        popover.style.setProperty("bottom", "auto", "important");
        popover.style.setProperty("top", Math.round(rect.bottom + 4) + "px", "important");
    }

    let left = Math.round(rect.left);
    if (left + popoverWidth > window.innerWidth - 12) {
        left = window.innerWidth - popoverWidth - 12;
    }
    if (left < 12) left = 12;
    popover.style.setProperty("left", left + "px", "important");
}

function toggleBulkZonePopover(event) {
    if (event) event.stopPropagation();
    const popover = document.getElementById("popover-bulk-zone");
    const trigger = document.getElementById("btn-bulk-zone-trigger");
    if (!popover) return;

    if (popover.parentElement !== document.body) {
        document.body.appendChild(popover);
    }

    const isVisible = (popover.style.display === "block");
    if (isVisible) {
        closeBulkZonePopover();
    } else {
        closeBulkAuthorPopover();
        renderBulkZonePickerList("");
        popover.style.display = "block";
        if (trigger) trigger.classList.add("popover-open");
        positionBulkZonePopover();
        setTimeout(positionBulkZonePopover, 20);
        const searchInput = document.getElementById("search-bulk-zone");
        if (searchInput) {
            searchInput.value = "";
            setTimeout(() => {
                try { searchInput.focus({ preventScroll: true }); } catch(e) { searchInput.focus(); }
            }, 60);
        }
    }
}

function closeBulkZonePopover() {
    const popover = document.getElementById("popover-bulk-zone");
    const trigger = document.getElementById("btn-bulk-zone-trigger");
    if (popover) popover.style.display = "none";
    if (trigger) trigger.classList.remove("popover-open");
}

function updateBulkZoneDisplay(zoneName) {
    const hiddenInput = document.getElementById("bulk-zone-input");
    const displayEl = document.getElementById("bulk-zone-display-text");
    const iconEl = document.getElementById("bulk-zone-icon");

    const name = (zoneName && typeof zoneName === 'string') ? zoneName.trim() : "";
    if (hiddenInput) hiddenInput.value = name;

    if (!name) {
        if (displayEl) {
            displayEl.textContent = "-- Выберите зону / участок --";
            displayEl.style.color = "#64748b";
            displayEl.style.fontWeight = "normal";
        }
        if (iconEl) {
            iconEl.style.background = "#f1f5f9";
            iconEl.style.color = "#64748b";
            iconEl.innerHTML = '<i class="fa-solid fa-folder"></i>';
        }
        return;
    }

    if (displayEl) {
        displayEl.textContent = name;
        displayEl.style.color = "#1e293b";
        displayEl.style.fontWeight = "600";
    }

    if (iconEl) {
        iconEl.style.background = "#eff6ff";
        iconEl.style.color = "#2563eb";
        iconEl.innerHTML = '<i class="fa-solid fa-folder"></i>';
    }
}

function selectBulkZone(name) {
    updateBulkZoneDisplay(name);
    closeBulkZonePopover();
}

function renderBulkZonePickerList(filterQuery = '') {
    const listEl = document.getElementById("list-bulk-zone");
    if (!listEl) return;

    const zones = getTaskModalZones();
    const currentVal = document.getElementById("bulk-zone-input")?.value || "";

    const q = (filterQuery || '').trim().toLowerCase();
    let html = '';

    let filtered = zones;
    if (q) {
        filtered = zones.filter(z => z.toLowerCase().includes(q));
    }

    if (filtered.length === 0) {
        html += `<div style="padding: 12px; text-align: center; color: #94a3b8; font-size: 12px;">Ничего не найдено</div>`;
        listEl.innerHTML = html;
        return;
    }

    html += `<div class="filter-group-header">📁 ${q ? 'Результаты поиска' : 'Все зоны и участки'} (${filtered.length})</div>`;
    filtered.forEach(z => {
        const isSel = (currentVal === z) ? 'selected' : '';
        const safeZ = z.replace(/'/g, "\\'");
        html += `
            <div class="filter-option-item ${isSel}" onclick="selectBulkZone('${safeZ}')">
                <div class="filter-option-person-left">
                    <div class="zone-icon-circle" style="background: ${isSel ? '#dbeafe' : '#f1f5f9'}; color: #2563eb; width: 24px; height: 24px; font-size: 0.75rem;">
                        <i class="fa-solid fa-folder"></i>
                    </div>
                    <span class="person-name-text ${isSel ? 'font-semibold' : ''}">${escapeHtml(z)}</span>
                </div>
                ${isSel ? '<i class="fa-solid fa-check" style="color: #2563eb; font-size: 0.85rem;"></i>' : ''}
            </div>
        `;
    });

    listEl.innerHTML = html;
}

/* ==========================================================================
   CANONICAL BULK ROW ASSIGNEE PICKER (Rule 7 & 27 Single Source of Truth)
   @canonical-pattern BulkRowAssigneePicker
   @established 2026-10-26
   ========================================================================== */
let activeBulkAssigneeRowId = null;

function positionBulkRowAssigneePopover() {
    const popover = document.getElementById("popover-bulk-row-assignee");
    if (!popover || !activeBulkAssigneeRowId || popover.style.display !== "block") return;
    const trigger = document.getElementById(`btn-bulk-row-assignee-${activeBulkAssigneeRowId}`);
    if (!trigger) return;

    if (popover.parentElement !== document.body) {
        document.body.appendChild(popover);
    }

    const rect = trigger.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const popoverWidth = Math.min(Math.max(Math.round(rect.width), 280), window.innerWidth - 24);
    popover.style.setProperty("width", popoverWidth + "px", "important");
    popover.style.setProperty("position", "fixed", "important");
    popover.style.setProperty("z-index", "99999", "important");
    popover.style.setProperty("right", "auto", "important");

    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedHeight = 260;

    if (spaceBelow < estimatedHeight && rect.top > estimatedHeight) {
        popover.style.setProperty("top", "auto", "important");
        popover.style.setProperty("bottom", Math.round(window.innerHeight - rect.top + 4) + "px", "important");
    } else {
        popover.style.setProperty("bottom", "auto", "important");
        popover.style.setProperty("top", Math.round(rect.bottom + 4) + "px", "important");
    }

    let left = Math.round(rect.left);
    if (left + popoverWidth > window.innerWidth - 12) {
        left = window.innerWidth - popoverWidth - 12;
    }
    if (left < 12) left = 12;
    popover.style.setProperty("left", left + "px", "important");
}

document.addEventListener('scroll', function(e) {
    const pop = document.getElementById("popover-bulk-row-assignee");
    if (pop && pop.style.display === "block") {
        positionBulkRowAssigneePopover();
    }
}, true);

window.addEventListener("resize", function() {
    positionBulkRowAssigneePopover();
}, { passive: true });
window.addEventListener("scroll", function() {
    positionBulkRowAssigneePopover();
}, { passive: true });

function toggleBulkRowAssigneePopover(event, rowId) {
    if (event) event.stopPropagation();
    const popover = document.getElementById("popover-bulk-row-assignee");
    if (!popover) return;

    if (activeBulkAssigneeRowId && activeBulkAssigneeRowId !== rowId) {
        closeBulkRowAssigneePopover();
    }

    const trigger = document.getElementById(`btn-bulk-row-assignee-${rowId}`);
    const isVisible = (popover.style.display === "block" && activeBulkAssigneeRowId === rowId);

    if (isVisible) {
        closeBulkRowAssigneePopover();
    } else {
        closeBulkAuthorPopover();
        closeBulkZonePopover();
        activeBulkAssigneeRowId = rowId;
        renderBulkRowAssigneeList("");
        popover.style.display = "block";
        if (trigger) trigger.classList.add("popover-open");
        positionBulkRowAssigneePopover();
        setTimeout(positionBulkRowAssigneePopover, 20);

        const searchInput = document.getElementById("search-bulk-row-assignee");
        if (searchInput) {
            searchInput.value = "";
            setTimeout(() => {
                try { searchInput.focus({ preventScroll: true }); } catch(e) { searchInput.focus(); }
            }, 60);
        }
    }
}

function closeBulkRowAssigneePopover() {
    const popover = document.getElementById("popover-bulk-row-assignee");
    if (activeBulkAssigneeRowId) {
        const trigger = document.getElementById(`btn-bulk-row-assignee-${activeBulkAssigneeRowId}`);
        if (trigger) trigger.classList.remove("popover-open");
    }
    if (popover) popover.style.display = "none";
    activeBulkAssigneeRowId = null;
}

function renderBulkRowAssigneeList(filterQuery = '') {
    const listEl = document.getElementById("list-bulk-row-assignee");
    if (!listEl) return;

    const currentRow = activeBulkAssigneeRowId ? document.getElementById(activeBulkAssigneeRowId) : null;
    const currentVal = currentRow ? (currentRow.querySelector(".bulk-row-assignee-input")?.value || "") : "";
    const persons = (typeof getUniquePersons === 'function') ? getUniquePersons() : [];

    const taskCountMap = {};
    if (Array.isArray(allTasks)) {
        allTasks.forEach(t => {
            const p = t.assignee || t.assignee_name;
            if (p) taskCountMap[p] = (taskCountMap[p] || 0) + 1;
        });
    }

    const q = (filterQuery || '').trim().toLowerCase();
    let html = '';

    // 1. Reset / unassigned option
    const isUnassigned = !currentVal;
    html += `
        <div class="filter-option-item ${isUnassigned ? 'selected' : ''}" onclick="selectBulkRowAssignee('')">
            <div class="filter-option-person-left">
                <div class="person-avatar avatar-gray" style="background: #f1f5f9; color: #64748b;"><i class="fa-solid fa-user-slash" style="font-size: 0.72rem;"></i></div>
                <span class="person-name-text" style="color: #64748b; font-style: italic;">-- Не назначен --</span>
            </div>
        </div>
    `;

    let filteredPersons = persons;
    if (q) {
        filteredPersons = persons.filter(p => p.toLowerCase().includes(q));
    }

    if (filteredPersons.length === 0) {
        html += `<div style="padding: 10px; text-align: center; color: #94a3b8; font-size: 11px;">Ничего не найдено</div>`;
        listEl.innerHTML = html;
        return;
    }

    // Top active persons
    const activePersons = filteredPersons.filter(p => (taskCountMap[p] || 0) > 0)
        .sort((a, b) => (taskCountMap[b] || 0) - (taskCountMap[a] || 0));

    if (!q && activePersons.length > 0) {
        html += `<div class="filter-group-header">⭐ Часто выбираемые</div>`;
        activePersons.slice(0, 5).forEach(name => {
            const isSel = (currentVal === name) ? 'selected' : '';
            const cnt = taskCountMap[name] || 0;
            const initials = getInitials(name);
            const avatarColor = getAvatarColorClass(name);
            const safeName = name.replace(/'/g, "\\'");
            html += `
                <div class="filter-option-item ${isSel}" onclick="selectBulkRowAssignee('${safeName}')">
                    <div class="filter-option-person-left">
                        <div class="person-avatar ${avatarColor}" style="width: 22px; height: 22px; font-size: 0.7rem;">${initials}</div>
                        <span class="person-name-text font-semibold" style="font-size: 0.8rem;">${escapeHtml(name)}</span>
                    </div>
                    <span class="person-task-badge busy">${cnt}</span>
                </div>
            `;
        });
        html += `<div class="filter-group-header">👥 Все сотрудники (${filteredPersons.length})</div>`;
    }

    filteredPersons.forEach(name => {
        const isSel = (currentVal === name) ? 'selected' : '';
        const initials = getInitials(name);
        const avatarColor = getAvatarColorClass(name);
        const safeName = name.replace(/'/g, "\\'");
        html += `
            <div class="filter-option-item ${isSel}" onclick="selectBulkRowAssignee('${safeName}')">
                <div class="filter-option-person-left">
                    <div class="person-avatar ${avatarColor}" style="width: 22px; height: 22px; font-size: 0.7rem;">${initials}</div>
                    <span class="person-name-text" style="font-size: 0.8rem;">${escapeHtml(name)}</span>
                </div>
            </div>
        `;
    });

    listEl.innerHTML = html;
}

function selectBulkRowAssignee(name) {
    if (!activeBulkAssigneeRowId) return;
    const row = document.getElementById(activeBulkAssigneeRowId);
    if (row) {
        const hiddenInp = row.querySelector(".bulk-row-assignee-input");
        const trigger = row.querySelector(".bulk-row-assignee-trigger");
        const textSpan = row.querySelector(".bulk-row-assignee-text");
        const avatarCircle = trigger ? trigger.querySelector(".author-avatar-circle") : null;

        if (hiddenInp) hiddenInp.value = name;
        if (textSpan) {
            textSpan.textContent = name || "-- Исполнитель --";
            textSpan.style.color = name ? "#1e293b" : "#64748b";
            textSpan.style.fontWeight = name ? "600" : "normal";
        }
        if (avatarCircle) {
            if (name) {
                avatarCircle.className = `author-avatar-circle ${getAvatarColorClass(name)}`;
                avatarCircle.style.background = "";
                avatarCircle.style.color = "";
                avatarCircle.textContent = getInitials(name);
            } else {
                avatarCircle.className = "author-avatar-circle";
                avatarCircle.style.background = "#f1f5f9";
                avatarCircle.style.color = "#64748b";
                avatarCircle.innerHTML = '<i class="fa-solid fa-user"></i>';
            }
        }
    }
    closeBulkRowAssigneePopover();
}

function updateBulkModalHorizonBadge(taskType) {
    const badgeEl = document.getElementById("bulk-modal-horizon-badge");
    if (!badgeEl) return;
    const badgeMap = {
        'weekly': { text: '⚡ Недельный спринт', class: 'badge-weekly' },
        'service_plan': { text: '🔧 План службы', class: 'badge-services' },
        'tech_council': { text: '🏛️ Техсовет', class: 'badge-tech-council' },
        'quality_day': { text: '📋 День качества', class: 'badge-quality-day' },
        'roadmap': { text: '🗺️ Дорожные карты', class: 'badge-roadmaps' }
    };
    const b = badgeMap[taskType] || badgeMap['weekly'];
    badgeEl.textContent = b.text;
    badgeEl.className = `modal-horizon-badge ${b.class}`;
}

/* ==========================================================================
   CANONICAL INSPECTOR ASSIGNEE PICKER (GRAPH INSPECTOR)
   @canonical-pattern InspectorAssigneePicker
   @established 2026-10-26
   ========================================================================== */

function positionInspectorAssigneePopover() {
    const popover = document.getElementById("popover-inspector-assignee");
    const trigger = document.getElementById("btn-inspector-assignee-trigger");
    if (!popover || !trigger || popover.style.display !== "block") return;

    if (popover.parentElement !== document.body) {
        document.body.appendChild(popover);
    }

    const rect = trigger.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const popoverWidth = Math.min(Math.max(Math.round(rect.width), 280), window.innerWidth - 24);
    popover.style.setProperty("width", popoverWidth + "px", "important");
    popover.style.setProperty("position", "fixed", "important");
    popover.style.setProperty("z-index", "99999", "important");
    popover.style.setProperty("right", "auto", "important");

    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedHeight = 280;

    if (spaceBelow < estimatedHeight && rect.top > estimatedHeight) {
        popover.style.setProperty("top", "auto", "important");
        popover.style.setProperty("bottom", Math.round(window.innerHeight - rect.top + 4) + "px", "important");
    } else {
        popover.style.setProperty("bottom", "auto", "important");
        popover.style.setProperty("top", Math.round(rect.bottom + 4) + "px", "important");
    }

    let left = Math.round(rect.left);
    if (left + popoverWidth > window.innerWidth - 12) {
        left = window.innerWidth - popoverWidth - 12;
    }
    if (left < 12) left = 12;
    popover.style.setProperty("left", left + "px", "important");
}

function toggleInspectorAssigneePopover(event) {
    if (event) event.stopPropagation();
    const popover = document.getElementById("popover-inspector-assignee");
    const trigger = document.getElementById("btn-inspector-assignee-trigger");
    if (!popover) return;

    if (popover.parentElement !== document.body) {
        document.body.appendChild(popover);
    }

    const isVisible = (popover.style.display === "block");
    if (isVisible) {
        closeInspectorAssigneePopover();
    } else {
        renderInspectorAssigneePickerList("");
        popover.style.display = "block";
        if (trigger) trigger.classList.add("popover-open");
        positionInspectorAssigneePopover();
        setTimeout(positionInspectorAssigneePopover, 20);
        const searchInput = document.getElementById("search-inspector-assignee");
        if (searchInput) {
            searchInput.value = "";
            setTimeout(() => {
                try { searchInput.focus({ preventScroll: true }); } catch(e) { searchInput.focus(); }
            }, 60);
        }
    }
}

function closeInspectorAssigneePopover() {
    const popover = document.getElementById("popover-inspector-assignee");
    const trigger = document.getElementById("btn-inspector-assignee-trigger");
    if (popover) popover.style.display = "none";
    if (trigger) trigger.classList.remove("popover-open");
}

function updateInspectorAssigneeDisplay(assigneeName) {
    const hiddenInput = document.getElementById("inspector-node-assignee-input");
    const displayEl = document.getElementById("inspector-node-assignee");
    const avatarEl = document.getElementById("inspector-assignee-avatar");

    const name = (assigneeName && typeof assigneeName === 'string') ? assigneeName.trim() : "";
    if (hiddenInput) hiddenInput.value = name;

    if (!name) {
        if (displayEl) {
            displayEl.textContent = "— Не назначен";
            displayEl.style.color = "#94a3b8";
            displayEl.style.fontWeight = "normal";
        }
        if (avatarEl) {
            avatarEl.className = "author-avatar-circle";
            avatarEl.style.background = "#f1f5f9";
            avatarEl.style.color = "#94a3b8";
            avatarEl.innerHTML = '<i class="fa-solid fa-user-slash" style="font-size: 0.65rem;"></i>';
        }
        return;
    }

    if (displayEl) {
        displayEl.textContent = name;
        displayEl.style.color = "#1e293b";
        displayEl.style.fontWeight = "600";
    }

    if (avatarEl) {
        const initials = getInitials(name);
        const colorClass = getAvatarColorClass(name);
        avatarEl.className = `author-avatar-circle ${colorClass}`;
        avatarEl.style.background = "";
        avatarEl.style.color = "";
        avatarEl.textContent = initials;
    }
}

async function selectInspectorAssignee(personName) {
    const newName = (personName && typeof personName === 'string') ? personName.trim() : "";
    closeInspectorAssigneePopover();
    if (!selectedGraphNodeId) return;

    const node = currentGraphData?.nodes?.find(n => n.id === selectedGraphNodeId);
    const prevName = node ? (node.assignee_name || "") : "";
    if (newName === prevName) return;

    // Optimistic UI update
    updateInspectorAssigneeDisplay(newName);
    if (node) {
        node.assignee_name = newName;
        node.assignee = newName;
    }
    if (Array.isArray(allTasks)) {
        const t = allTasks.find(x => x.id === selectedGraphNodeId);
        if (t) {
            t.assignee_name = newName;
            t.assignee = newName;
        }
    }

    try {
        const payload = {
            assignee_name: newName || null
        };
        const res = await fetch(`/api/tasks/${selectedGraphNodeId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || "Не удалось сохранить исполнителя");
        }

        showToast(newName ? `Исполнитель этапа: ${newName} 👤` : "Исполнитель этапа снят", "success");
        if (currentGraphData) {
            renderProjectGraph(currentGraphData);
        }
    } catch (e) {
        console.error("Error updating stage assignee:", e);
        showToast(`⚠️ Ошибка смены исполнителя: ${e.message}`, "error");
        // Rollback
        updateInspectorAssigneeDisplay(prevName);
        if (node) {
            node.assignee_name = prevName;
            node.assignee = prevName;
        }
        if (currentGraphData) {
            renderProjectGraph(currentGraphData);
        }
    }
}

function renderInspectorAssigneePickerList(filterQuery = '') {
    const listEl = document.getElementById("list-inspector-assignee");
    if (!listEl) return;

    const persons = (typeof getUniquePersons === 'function') ? getUniquePersons() : [];
    const currentVal = document.getElementById("inspector-node-assignee-input")?.value || "";

    const q = (filterQuery || '').trim().toLowerCase();
    let html = '';

    // 1. Reset / unassigned option
    const isUnassigned = !currentVal;
    html += `
        <div class="filter-option-item ${isUnassigned ? 'selected' : ''}" onclick="selectInspectorAssignee('')">
            <div class="filter-option-person-left">
                <div class="person-avatar avatar-gray" style="background: #f1f5f9; color: #64748b;"><i class="fa-solid fa-user-slash" style="font-size: 0.75rem;"></i></div>
                <span class="person-name-text" style="color: #64748b; font-style: italic;">-- Снять исполнителя --</span>
            </div>
        </div>
    `;

    let filtered = persons;
    if (q) {
        filtered = persons.filter(p => p.toLowerCase().includes(q));
    }

    if (filtered.length === 0) {
        html += `<div style="padding: 12px; text-align: center; color: #94a3b8; font-size: 12px;">Ничего не найдено</div>`;
        listEl.innerHTML = html;
        return;
    }

    html += `<div class="filter-group-header">👥 ${q ? 'Результаты поиска' : 'Все сотрудники'} (${filtered.length})</div>`;
    filtered.forEach(name => {
        const isSel = (currentVal === name) ? 'selected' : '';
        const initials = getInitials(name);
        const avatarColor = getAvatarColorClass(name);
        const safeName = name.replace(/'/g, "\\'");
        html += `
            <div class="filter-option-item ${isSel}" onclick="selectInspectorAssignee('${safeName}')">
                <div class="filter-option-person-left">
                    <div class="person-avatar ${avatarColor}">${initials}</div>
                    <span class="person-name-text ${isSel ? 'font-semibold' : ''}">${escapeHtml(name)}</span>
                </div>
                ${isSel ? '<i class="fa-solid fa-check" style="color: #6366f1; font-size: 0.85rem;"></i>' : ''}
            </div>
        `;
    });

    listEl.innerHTML = html;
}

/* @canonical-pattern GraphStagePersonPicker (Rule 27 & 7 Cross-Tab Parity) */
let activeGraphStageAssignee = "";

function setupGraphStageAssigneePicker(defaultName = "") {
    activeGraphStageAssignee = defaultName || "";
    const hiddenInput = document.getElementById("graph-new-stage-assignee-input");
    const labelEl = document.getElementById("graph-stage-assignee-label");
    const avatarEl = document.getElementById("graph-stage-assignee-avatar");
    if (hiddenInput) hiddenInput.value = activeGraphStageAssignee;

    if (activeGraphStageAssignee) {
        if (labelEl) labelEl.textContent = activeGraphStageAssignee;
        if (avatarEl) {
            avatarEl.textContent = getInitials(activeGraphStageAssignee);
            avatarEl.className = `author-avatar-circle ${getAvatarColorClass(activeGraphStageAssignee)}`;
            avatarEl.style.background = "";
            avatarEl.style.color = "";
        }
    } else {
        if (labelEl) labelEl.textContent = "-- Исполнитель --";
        if (avatarEl) {
            avatarEl.innerHTML = `<i class="fa-solid fa-user"></i>`;
            avatarEl.className = "author-avatar-circle";
            avatarEl.style.background = "#f1f5f9";
            avatarEl.style.color = "#64748b";
        }
    }
    closeGraphStageAssigneePopover();
}

function positionGraphStageAssigneePopover() {
    const popover = document.getElementById("popover-graph-stage-assignee");
    const trigger = document.getElementById("btn-graph-stage-assignee-trigger");
    if (!popover || !trigger || popover.style.display !== "block") return;

    if (popover.parentElement !== document.body) {
        document.body.appendChild(popover);
    }

    const rect = trigger.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const popoverWidth = Math.min(Math.max(Math.round(rect.width), 260), window.innerWidth - 24);
    popover.style.setProperty("width", popoverWidth + "px", "important");
    popover.style.setProperty("position", "fixed", "important");
    popover.style.setProperty("z-index", "99999", "important");
    popover.style.setProperty("right", "auto", "important");

    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedHeight = 240;

    if (spaceBelow < estimatedHeight && rect.top > estimatedHeight) {
        popover.style.setProperty("top", "auto", "important");
        popover.style.setProperty("bottom", Math.round(window.innerHeight - rect.top + 4) + "px", "important");
    } else {
        popover.style.setProperty("bottom", "auto", "important");
        popover.style.setProperty("top", Math.round(rect.bottom + 4) + "px", "important");
    }

    let left = Math.round(rect.left);
    if (left + popoverWidth > window.innerWidth - 12) {
        left = window.innerWidth - popoverWidth - 12;
    }
    if (left < 12) left = 12;
    popover.style.setProperty("left", left + "px", "important");
}

function toggleGraphStageAssigneePopover(event) {
    if (event) event.stopPropagation();
    const popover = document.getElementById("popover-graph-stage-assignee");
    const trigger = document.getElementById("btn-graph-stage-assignee-trigger");
    if (!popover) return;

    const isVisible = (popover.style.display === "block");
    if (isVisible) {
        closeGraphStageAssigneePopover();
    } else {
        closeQuickSubtaskAssigneePopover();
        renderGraphStageAssigneeList("");
        popover.style.display = "block";
        if (trigger) trigger.classList.add("popover-open");
        positionGraphStageAssigneePopover();
        setTimeout(positionGraphStageAssigneePopover, 20);

        const searchInput = document.getElementById("search-graph-stage-assignee");
        if (searchInput) {
            searchInput.value = "";
            setTimeout(() => {
                try { searchInput.focus({ preventScroll: true }); } catch(e) { searchInput.focus(); }
            }, 60);
        }
    }
}

function closeGraphStageAssigneePopover() {
    const popover = document.getElementById("popover-graph-stage-assignee");
    const trigger = document.getElementById("btn-graph-stage-assignee-trigger");
    if (trigger) trigger.classList.remove("popover-open");
    if (popover) popover.style.display = "none";
}

function renderGraphStageAssigneeList(filterQuery = '') {
    const listEl = document.getElementById("list-graph-stage-assignee");
    if (!listEl) return;

    const currentVal = activeGraphStageAssignee || "";
    const persons = (typeof getUniquePersons === 'function') ? getUniquePersons() : [];

    const taskCountMap = {};
    if (Array.isArray(allTasks)) {
        allTasks.forEach(t => {
            const p = t.assignee || t.assignee_name;
            if (p) taskCountMap[p] = (taskCountMap[p] || 0) + 1;
        });
    }

    const q = (filterQuery || '').trim().toLowerCase();
    let html = '';

    // Reset option
    const isUnassigned = !currentVal;
    html += `
        <div class="filter-option-item ${isUnassigned ? 'selected' : ''}" onclick="selectGraphStageAssignee('')">
            <div class="filter-option-person-left">
                <div class="person-avatar avatar-gray" style="background: #f1f5f9; color: #64748b;"><i class="fa-solid fa-user-slash" style="font-size: 0.72rem;"></i></div>
                <span class="person-name-text" style="color: #64748b; font-style: italic;">-- Без исполнителя --</span>
            </div>
        </div>
    `;

    let filteredPersons = persons;
    if (q) {
        filteredPersons = persons.filter(p => p.toLowerCase().includes(q));
    }

    if (filteredPersons.length === 0) {
        html += `<div style="padding: 10px; text-align: center; color: #94a3b8; font-size: 11px;">Ничего не найдено</div>`;
        listEl.innerHTML = html;
        return;
    }

    const activePersons = filteredPersons.filter(p => (taskCountMap[p] || 0) > 0)
        .sort((a, b) => (taskCountMap[b] || 0) - (taskCountMap[a] || 0));

    if (!q && activePersons.length > 0) {
        html += `<div class="filter-group-header">⭐ Часто выбираемые</div>`;
        activePersons.slice(0, 5).forEach(name => {
            const isSel = (currentVal === name) ? 'selected' : '';
            const cnt = taskCountMap[name] || 0;
            const initials = getInitials(name);
            const avatarColor = getAvatarColorClass(name);
            const safeName = name.replace(/'/g, "\\'");
            html += `
                <div class="filter-option-item ${isSel}" onclick="selectGraphStageAssignee('${safeName}')">
                    <div class="filter-option-person-left">
                        <div class="person-avatar ${avatarColor}">${initials}</div>
                        <span class="person-name-text">${escapeHtml(name)}</span>
                    </div>
                    <span class="filter-option-badge">${cnt}</span>
                </div>
            `;
        });
    }

    html += `<div class="filter-group-header">👥 Все сотрудники</div>`;
    filteredPersons.forEach(name => {
        const isSel = (currentVal === name) ? 'selected' : '';
        const cnt = taskCountMap[name] || 0;
        const initials = getInitials(name);
        const avatarColor = getAvatarColorClass(name);
        const safeName = name.replace(/'/g, "\\'");
        html += `
            <div class="filter-option-item ${isSel}" onclick="selectGraphStageAssignee('${safeName}')">
                <div class="filter-option-person-left">
                    <div class="person-avatar ${avatarColor}">${initials}</div>
                    <span class="person-name-text">${escapeHtml(name)}</span>
                </div>
                ${cnt > 0 ? `<span class="filter-option-badge">${cnt}</span>` : ''}
            </div>
        `;
    });

    listEl.innerHTML = html;
}

function selectGraphStageAssignee(name) {
    setupGraphStageAssigneePicker(name);
    closeGraphStageAssigneePopover();
}

/* @canonical-pattern QuickSubtaskPersonPicker (Rule 27 & 7 Cross-Tab Parity) */
let activeQuickSubtaskAssignee = "";

function setupQuickSubtaskAssigneePicker(defaultName = "") {
    activeQuickSubtaskAssignee = defaultName || "";
    const hiddenInput = document.getElementById("quick-subtask-assignee-input");
    const labelEl = document.getElementById("quick-subtask-assignee-label");
    const avatarEl = document.getElementById("quick-subtask-assignee-avatar");
    if (hiddenInput) hiddenInput.value = activeQuickSubtaskAssignee;

    if (activeQuickSubtaskAssignee) {
        if (labelEl) labelEl.textContent = activeQuickSubtaskAssignee;
        if (avatarEl) {
            avatarEl.textContent = getInitials(activeQuickSubtaskAssignee);
            avatarEl.className = `author-avatar-circle ${getAvatarColorClass(activeQuickSubtaskAssignee)}`;
            avatarEl.style.background = "";
            avatarEl.style.color = "";
        }
    } else {
        if (labelEl) labelEl.textContent = "-- Исполнитель --";
        if (avatarEl) {
            avatarEl.innerHTML = `<i class="fa-solid fa-user"></i>`;
            avatarEl.className = "author-avatar-circle";
            avatarEl.style.background = "#f1f5f9";
            avatarEl.style.color = "#64748b";
        }
    }
    closeQuickSubtaskAssigneePopover();
}

function positionQuickSubtaskAssigneePopover() {
    const popover = document.getElementById("popover-quick-subtask-assignee");
    const trigger = document.getElementById("btn-quick-subtask-assignee-trigger");
    if (!popover || !trigger || popover.style.display !== "block") return;

    if (popover.parentElement !== document.body) {
        document.body.appendChild(popover);
    }

    const rect = trigger.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const popoverWidth = Math.min(Math.max(Math.round(rect.width), 260), window.innerWidth - 24);
    popover.style.setProperty("width", popoverWidth + "px", "important");
    popover.style.setProperty("position", "fixed", "important");
    popover.style.setProperty("z-index", "99999", "important");
    popover.style.setProperty("right", "auto", "important");

    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedHeight = 240;

    if (spaceBelow < estimatedHeight && rect.top > estimatedHeight) {
        popover.style.setProperty("top", "auto", "important");
        popover.style.setProperty("bottom", Math.round(window.innerHeight - rect.top + 4) + "px", "important");
    } else {
        popover.style.setProperty("bottom", "auto", "important");
        popover.style.setProperty("top", Math.round(rect.bottom + 4) + "px", "important");
    }

    let left = Math.round(rect.left);
    if (left + popoverWidth > window.innerWidth - 12) {
        left = window.innerWidth - popoverWidth - 12;
    }
    if (left < 12) left = 12;
    popover.style.setProperty("left", left + "px", "important");
}

function toggleQuickSubtaskAssigneePopover(event) {
    if (event) event.stopPropagation();
    const popover = document.getElementById("popover-quick-subtask-assignee");
    const trigger = document.getElementById("btn-quick-subtask-assignee-trigger");
    if (!popover) return;

    const isVisible = (popover.style.display === "block");
    if (isVisible) {
        closeQuickSubtaskAssigneePopover();
    } else {
        closeGraphStageAssigneePopover();
        renderQuickSubtaskAssigneeList("");
        popover.style.display = "block";
        if (trigger) trigger.classList.add("popover-open");
        positionQuickSubtaskAssigneePopover();
        setTimeout(positionQuickSubtaskAssigneePopover, 20);

        const searchInput = document.getElementById("search-quick-subtask-assignee");
        if (searchInput) {
            searchInput.value = "";
            setTimeout(() => {
                try { searchInput.focus({ preventScroll: true }); } catch(e) { searchInput.focus(); }
            }, 60);
        }
    }
}

function closeQuickSubtaskAssigneePopover() {
    const popover = document.getElementById("popover-quick-subtask-assignee");
    const trigger = document.getElementById("btn-quick-subtask-assignee-trigger");
    if (trigger) trigger.classList.remove("popover-open");
    if (popover) popover.style.display = "none";
}

function renderQuickSubtaskAssigneeList(filterQuery = '') {
    const listEl = document.getElementById("list-quick-subtask-assignee");
    if (!listEl) return;

    const currentVal = activeQuickSubtaskAssignee || "";
    const persons = (typeof getUniquePersons === 'function') ? getUniquePersons() : [];

    const taskCountMap = {};
    if (Array.isArray(allTasks)) {
        allTasks.forEach(t => {
            const p = t.assignee || t.assignee_name;
            if (p) taskCountMap[p] = (taskCountMap[p] || 0) + 1;
        });
    }

    const q = (filterQuery || '').trim().toLowerCase();
    let html = '';

    // Reset option
    const isUnassigned = !currentVal;
    html += `
        <div class="filter-option-item ${isUnassigned ? 'selected' : ''}" onclick="selectQuickSubtaskAssignee('')">
            <div class="filter-option-person-left">
                <div class="person-avatar avatar-gray" style="background: #f1f5f9; color: #64748b;"><i class="fa-solid fa-user-slash" style="font-size: 0.72rem;"></i></div>
                <span class="person-name-text" style="color: #64748b; font-style: italic;">-- Без исполнителя --</span>
            </div>
        </div>
    `;

    let filteredPersons = persons;
    if (q) {
        filteredPersons = persons.filter(p => p.toLowerCase().includes(q));
    }

    if (filteredPersons.length === 0) {
        html += `<div style="padding: 10px; text-align: center; color: #94a3b8; font-size: 11px;">Ничего не найдено</div>`;
        listEl.innerHTML = html;
        return;
    }

    const activePersons = filteredPersons.filter(p => (taskCountMap[p] || 0) > 0)
        .sort((a, b) => (taskCountMap[b] || 0) - (taskCountMap[a] || 0));

    if (!q && activePersons.length > 0) {
        html += `<div class="filter-group-header">⭐ Часто выбираемые</div>`;
        activePersons.slice(0, 5).forEach(name => {
            const isSel = (currentVal === name) ? 'selected' : '';
            const cnt = taskCountMap[name] || 0;
            const initials = getInitials(name);
            const avatarColor = getAvatarColorClass(name);
            const safeName = name.replace(/'/g, "\\'");
            html += `
                <div class="filter-option-item ${isSel}" onclick="selectQuickSubtaskAssignee('${safeName}')">
                    <div class="filter-option-person-left">
                        <div class="person-avatar ${avatarColor}">${initials}</div>
                        <span class="person-name-text">${escapeHtml(name)}</span>
                    </div>
                    <span class="filter-option-badge">${cnt}</span>
                </div>
            `;
        });
    }

    html += `<div class="filter-group-header">👥 Все сотрудники</div>`;
    filteredPersons.forEach(name => {
        const isSel = (currentVal === name) ? 'selected' : '';
        const cnt = taskCountMap[name] || 0;
        const initials = getInitials(name);
        const avatarColor = getAvatarColorClass(name);
        const safeName = name.replace(/'/g, "\\'");
        html += `
            <div class="filter-option-item ${isSel}" onclick="selectQuickSubtaskAssignee('${safeName}')">
                <div class="filter-option-person-left">
                    <div class="person-avatar ${avatarColor}">${initials}</div>
                    <span class="person-name-text">${escapeHtml(name)}</span>
                </div>
                ${cnt > 0 ? `<span class="filter-option-badge">${cnt}</span>` : ''}
            </div>
        `;
    });

    listEl.innerHTML = html;
}

function selectQuickSubtaskAssignee(name) {
    setupQuickSubtaskAssigneePicker(name);
    closeQuickSubtaskAssigneePopover();
}

window.addEventListener('resize', function() {
    positionGraphStageAssigneePopover();
    positionQuickSubtaskAssigneePopover();
}, { passive: true });
window.addEventListener('scroll', function() {
    positionGraphStageAssigneePopover();
    positionQuickSubtaskAssigneePopover();
}, { passive: true });

async function openAddTaskModal(forcedType = null, parentId = null) {
    // 1. Мгновенно отображаем модальное окно (0 мс задержки для пользователя)
    const taskModal = document.getElementById("task-modal");
    if (taskModal) {
        taskModal.style.display = "flex";
        taskModal.style.zIndex = "6500";
    }

    populateDropdowns();

    document.getElementById("modal-title").textContent = "Новая задача";
    document.getElementById("task-id-input").value = "";
    document.getElementById("task-ru-input").value = "";
    document.getElementById("task-kz-input").value = "";
    const tagsInput = document.getElementById("task-tags-input");
    if (tagsInput) tagsInput.value = "";
    document.getElementById("task-photo-input").value = "";
    if (document.getElementById("task-photo-after-input")) document.getElementById("task-photo-after-input").value = "";
    onPhotoInputChanged('task-photo-input', 'task-photo-preview-hint', 'task-photo-preview-btn', 'task-photo-thumb-container');
    onPhotoInputChanged('task-photo-after-input', 'task-photo-after-preview-hint', 'task-photo-after-preview-btn', 'task-photo-after-thumb-container');

    // Скрываем Фото ПОСЛЕ при создании новой задачи
    const photoAfterRow = document.getElementById("task-photo-after-row");
    if (photoAfterRow) photoAfterRow.style.display = "none";
    
    // Тип задачи / Горизонт планирования (динамически определяется вкладкой)
    const typeSelect = document.getElementById("task-type-input");
    const initType = forcedType || (
        currentHorizon === 'roadmaps' ? 'roadmap' :
        currentHorizon === 'services' ? 'service_plan' :
        currentHorizon === 'tech_council' ? 'tech_council' :
        currentHorizon === 'quality_day' ? 'quality_day' : 'weekly'
    );
    if (typeSelect) {
        typeSelect.value = initType;
        onTaskTypeChange(initType);
    }
    updateModalHorizonBadge(initType);

    if (initType === 'roadmap' || currentHorizon === 'roadmaps' || parentId) {
        populateHierarchyDropdowns(null, parentId, null);
    }

    // Служба по умолчанию и видимость строки службы (только для сервисных планов)
    const deptRow = document.getElementById("task-department-row");
    if (deptRow) {
        deptRow.style.display = (initType === 'service_plan') ? 'block' : 'none';
    }
    const deptSelect = document.getElementById("task-department-input");
    if (deptSelect) {
        deptSelect.value = (currentDepartmentService !== 'all') ? currentDepartmentService : '';
    }

    // Изоляция дорожной карты: родительский проект и блокеры видны ТОЛЬКО в roadmaps или при явном parentId
    const roadmapHierarchySec = document.getElementById("task-roadmap-hierarchy-section");
    if (roadmapHierarchySec) {
        roadmapHierarchySec.style.display = (currentHorizon === 'roadmaps' || initType === 'roadmap' || parentId) ? 'block' : 'none';
    }

    // Зона по умолчанию
    let defaultZone = "Бережливое производство";
    if (currentHorizon === 'tech_council' || initType === 'tech_council') {
        defaultZone = "Техсовет";
    } else if (currentHorizon === 'quality_day' || initType === 'quality_day') {
        defaultZone = "День качества";
    }
    const zoneInput = document.getElementById("task-zone-input");
    if (zoneInput) zoneInput.value = defaultZone;
    updateTaskZoneDisplay(defaultZone);
    closeTaskZonePopover();

    // Квартал и прогресс
    const quarterSelect = document.getElementById("task-quarter-input");
    if (quarterSelect) quarterSelect.value = currentQuarter;
    const progInput = document.getElementById("task-progress-input");
    if (progInput) progInput.value = 0;
    const progDisp = document.getElementById("task-progress-display");
    if (progDisp) progDisp.textContent = "0%";

    // Автоподстановка авторизованного пользователя в карточку автора
    updateTaskAuthorCard(currentPlannerUser ? currentPlannerUser.name : "");

    document.getElementById("task-assignee-input").value = "";
    updateTaskAssigneeDisplay("");
    closeTaskAssigneePopover();
    
    // По умолчанию ставим сегодняшнюю дату в календарь
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayIso = `${yyyy}-${mm}-${dd}`;
    document.getElementById("task-due-input").value = todayIso;
    onDueDateInputChanged(todayIso);
    
    // По умолчанию статус «В работе» и пустой факт
    document.getElementById("task-status-input").value = "🟡 В работе";
    document.getElementById("task-comment-input").value = "";

    // Скрываем блок Статуса и блок Факта при создании обычной задачи (но показываем для дорожных карт)
    const statusContainer = document.getElementById("task-status-container");
    if (statusContainer) statusContainer.style.display = (initType === 'roadmap') ? 'block' : 'none';
    const dueStatusRow = document.getElementById("task-due-status-row");
    if (dueStatusRow) dueStatusRow.style.gridTemplateColumns = (initType === 'roadmap') ? '1fr 1fr' : '1fr';
    const commentContainer = document.getElementById("task-comment-container");
    if (commentContainer) commentContainer.style.display = 'none';

    const badge = document.getElementById("translate-status-badge");
    if (badge) badge.style.display = "none";
    const langBadge = document.getElementById("detected-lang-badge");
    if (langBadge) langBadge.style.display = "none";
    const transLabel = document.getElementById("task-trans-label");
    if (transLabel) transLabel.innerHTML = `Перевод <span style="color: #64748b; font-weight: normal; font-size: 0.75rem;">(Авто)</span>`;

    // Сброс прикрепленного документа
    clearSelectedDocAttachment();

    // Скрываем контейнер и кнопку переадресации при создании новой задачи
    const reassignCont = document.getElementById("task-reassign-container");
    if (reassignCont) reassignCont.style.setProperty("display", "none", "important");
    const btnReassign = document.getElementById("btn-modal-reassign-task");
    if (btnReassign) btnReassign.style.setProperty("display", "none", "important");

    setTaskModalLockState(false);
    document.getElementById("modal-title").textContent = "Новая задача";

    document.getElementById("task-modal").style.display = "flex";
}

function setTaskModalLockState(mode, bannerText = "") {
    const lockBanner = document.getElementById("task-modal-lock-banner");
    const saveBtn = document.querySelector("#task-modal .btn-primary-action");
    
    // mode can be: false / "unlocked", true / "full_lock", or "interact_only"
    const isFullLock = (mode === true || mode === "full_lock");
    const isInteractOnly = (mode === "interact_only");

    const structuralInputs = [
        "task-type-input", "task-department-input", "task-quarter-input",
        "task-ru-input", "task-kz-input", "task-tags-input", "task-zone-input",
        "task-author-input", "task-assignee-input", "task-due-input"
    ];
    const interactionInputs = [
        "task-progress-input", "task-photo-input", "task-photo-after-input",
        "task-status-input", "task-comment-input"
    ];

    structuralInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.readOnly = isFullLock || isInteractOnly;
            }
            if (el.tagName === 'SELECT' || el.type === 'date') {
                el.disabled = isFullLock || isInteractOnly;
            }
        }
    });

    const assigneeTrigger = document.getElementById("btn-task-assignee-trigger");
    if (assigneeTrigger) {
        if (isFullLock || isInteractOnly) {
            assigneeTrigger.style.pointerEvents = "none";
            assigneeTrigger.style.opacity = "0.7";
            assigneeTrigger.style.background = "#f8fafc";
            assigneeTrigger.style.cursor = "not-allowed";
        } else {
            assigneeTrigger.style.pointerEvents = "auto";
            assigneeTrigger.style.opacity = "1";
            assigneeTrigger.style.background = "#ffffff";
            assigneeTrigger.style.cursor = "pointer";
        }
    }

    const zoneTrigger = document.getElementById("btn-task-zone-trigger");
    if (zoneTrigger) {
        if (isFullLock || isInteractOnly) {
            zoneTrigger.style.pointerEvents = "none";
            zoneTrigger.style.opacity = "0.7";
            zoneTrigger.style.background = "#f8fafc";
            zoneTrigger.style.cursor = "not-allowed";
        } else {
            zoneTrigger.style.pointerEvents = "auto";
            zoneTrigger.style.opacity = "1";
            zoneTrigger.style.background = "#ffffff";
            zoneTrigger.style.cursor = "pointer";
        }
    }

    interactionInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.readOnly = isFullLock;
            }
            if (el.tagName === 'SELECT' || el.type === 'date') {
                el.disabled = isFullLock;
            }
        }
    });

    const photoGalleryBtns = document.querySelectorAll("#task-modal button[onclick*='gallery']");
    photoGalleryBtns.forEach(btn => btn.style.display = isFullLock ? "none" : "inline-flex");
    const attachBtn = document.getElementById("btn-attach-photo-do");
    if (attachBtn) attachBtn.style.display = isFullLock ? "none" : "flex";
    const photoDelBtns = document.querySelectorAll("#task-modal .photo-thumb-del, #task-modal .photo-thumb-del-modern");
    photoDelBtns.forEach(btn => btn.style.display = isFullLock ? "none" : "inline-block");

    const duePresetBtns = document.querySelectorAll("#task-modal .due-presets-bar button");
    duePresetBtns.forEach(btn => btn.style.display = (isFullLock || isInteractOnly) ? "none" : "inline-block");

    if (saveBtn) {
        saveBtn.style.display = isFullLock ? "none" : "inline-block";
    }

    if (isFullLock || isInteractOnly) {
        let b = document.getElementById("task-modal-lock-banner");
        if (!b) {
            b = document.createElement("div");
            b.id = "task-modal-lock-banner";
            b.style.cssText = "padding: 10px 14px; border-radius: 8px; font-weight: 600; font-size: 0.85rem; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;";
            const header = document.querySelector("#task-modal .modal-header");
            if (header && header.nextSibling) {
                header.parentNode.insertBefore(b, header.nextSibling);
            }
        }
        if (b) {
            b.style.display = "flex";
            if (isFullLock) {
                b.style.background = "#fef2f2";
                b.style.border = "1px solid #fecaca";
                b.style.color = "#991b1b";
                b.innerHTML = `<i class="fa-solid fa-lock"></i> <span>${bannerText || "Режим просмотра: редактирование заблокировано."}</span>`;
            } else {
                b.style.background = "#eff6ff";
                b.style.border = "1px solid #bfdbfe";
                b.style.color = "#1e40af";
                b.innerHTML = `<i class="fa-solid fa-user-pen"></i> <span>${bannerText || "Режим исполнителя: доступно обновление статуса, прогресса, комментария и фото."}</span>`;
            }
        }
    } else {
        if (lockBanner) {
            lockBanner.style.display = "none";
        }
    }
}

async function openEditTaskModal(taskId) {
    populateDropdowns();
    
    let task = allTasks.find(t => t.id === taskId);
    if (!task) {
        try {
            const res = await fetch(`/api/tasks/${taskId}`);
            if (res.ok) task = await res.json();
        } catch (e) {}
    }
    if (!task) return;

    // Мгновенно отображаем окно
    const taskModal = document.getElementById("task-modal");
    if (taskModal) {
        taskModal.style.display = "flex";
        taskModal.style.zIndex = "6500";
    }

    const taskDepIds = (task.depends_on_ids && task.depends_on_ids.length > 0) 
        ? task.depends_on_ids 
        : (task.depends_on_id ? [task.depends_on_id] : []);
    populateHierarchyDropdowns(task.id, task.parent_id, taskDepIds);

    const isCompleted = task.status && task.status.includes("Выполнено");
    const isCancelled = task.status && task.status.includes("Отменено");
    const isFinished = isCompleted || isCancelled;

    const isAdmin = isPlannerAdmin();
    const isLeader = isPlannerTrustedLeader();
    const canEdit = canEditProjectOrTask(task);
    const canInteract = canInteractWithTask(task);
    const isLocked = !canEdit || (isFinished && !isAdmin && !isLeader);

    if (isFinished && !isAdmin && !isLeader) {
        setTaskModalLockState("full_lock", `Задача ${isCancelled ? 'отменена' : 'завершена'} и защищена от изменений. Редактирование доступно только руководству или администратору.`);
        document.getElementById("modal-title").innerHTML = `<i class="fa-solid fa-lock" style="color: #ef4444; margin-right: 6px;"></i>Просмотр задачи [${task.code || ('TSK-' + task.id)}]`;
    } else if (!canEdit && !canInteract) {
        setTaskModalLockState("full_lock", "Режим просмотра: редактировать суть проекта/задачи может только автор, руководство завода или администратор.");
        document.getElementById("modal-title").innerHTML = `<i class="fa-solid fa-eye" style="color: #64748b; margin-right: 6px;"></i>Просмотр задачи [${task.code || ('TSK-' + task.id)}]`;
    } else if (canInteract && !canEdit) {
        setTaskModalLockState("interact_only", "Режим исполнителя: вам доступно обновление статуса, прогресса, факта/комментария и фото.");
        document.getElementById("modal-title").innerHTML = `<i class="fa-solid fa-user-pen" style="color: #2563eb; margin-right: 6px;"></i>Взаимодействие с задачей [${task.code || ('TSK-' + task.id)}]`;
    } else {
        setTaskModalLockState("unlocked");
        document.getElementById("modal-title").textContent = `Редактирование задачи [${task.code || ('TSK-' + task.id)}]`;
    }
    document.getElementById("task-id-input").value = task.id;
    document.getElementById("task-ru-input").value = task.title || "";
    document.getElementById("task-kz-input").value = task.title_kz || "";
    const tagsInput = document.getElementById("task-tags-input");
    const taskZone = task.zone || "Бережливое производство";
    document.getElementById("task-zone-input").value = taskZone;
    updateTaskZoneDisplay(taskZone);
    closeTaskZonePopover();
    document.getElementById("task-photo-input").value = task.photo_link || "";
    if (document.getElementById("task-photo-after-input")) document.getElementById("task-photo-after-input").value = task.photo_link_after || "";
    const photoAfterRow = document.getElementById("task-photo-after-row");
    if (photoAfterRow) photoAfterRow.style.display = "block";
    document.getElementById("task-author-input").value = task.author_name || "";
    updateTaskAuthorCard(task.author_name || "");
    document.getElementById("task-assignee-input").value = task.assignee_name || "";
    updateTaskAssigneeDisplay(task.assignee_name || "");
    closeTaskAssigneePopover();
    
    // Тип задачи, служба, квартал и прогресс
    const taskType = task.task_type || "weekly";
    const typeSelect = document.getElementById("task-type-input");
    if (typeSelect) {
        typeSelect.value = taskType;
        onTaskTypeChange(taskType);
    }
    updateModalHorizonBadge(taskType);

    const deptRow = document.getElementById("task-department-row");
    if (deptRow) {
        deptRow.style.display = (taskType === 'service_plan') ? 'block' : 'none';
    }

    const deptSelect = document.getElementById("task-department-input");
    if (deptSelect) deptSelect.value = task.department_service || "";

    const roadmapHierarchySec = document.getElementById("task-roadmap-hierarchy-section");
    if (roadmapHierarchySec) {
        roadmapHierarchySec.style.display = (taskType === 'roadmap' || taskType === 'milestone' || task.parent_id) ? 'block' : 'none';
    }

    const quarterSelect = document.getElementById("task-quarter-input");
    if (quarterSelect) quarterSelect.value = task.target_quarter || currentQuarter;

    const progInput = document.getElementById("task-progress-input");
    if (progInput) progInput.value = task.progress || 0;
    const progDisp = document.getElementById("task-progress-display");
    if (progDisp) progDisp.textContent = `${task.progress || 0}%`;

    // Синхронизируем дату в календарь (input type="date")
    const editDueIso = parseDateToIso(task.due_date_str);
    document.getElementById("task-due-input").value = editDueIso;
    onDueDateInputChanged(editDueIso);
    
    // Отображаем блоки Статуса и Факта при редактировании существующей задачи
    const statusContainer = document.getElementById("task-status-container");
    if (statusContainer) statusContainer.style.display = "block";
    const dueStatusRow = document.getElementById("task-due-status-row");
    if (dueStatusRow) dueStatusRow.style.gridTemplateColumns = "1fr 1fr";
    const commentContainer = document.getElementById("task-comment-container");
    if (commentContainer) commentContainer.style.display = "block";

    document.getElementById("task-status-input").value = task.status || "⚪ В очереди";
    document.getElementById("task-comment-input").value = task.comment || "";
    onPhotoInputChanged('task-photo-input', 'task-photo-preview-hint', 'task-photo-preview-btn', 'task-photo-thumb-container');
    onPhotoInputChanged('task-photo-after-input', 'task-photo-after-preview-hint', 'task-photo-after-preview-btn', 'task-photo-after-thumb-container');

    // Прикрепленный документ
    if (task.attached_doc) {
        setSelectedDocAttachment(task.attached_doc.id, task.attached_doc.title);
    } else if (task.attached_document_id) {
        setSelectedDocAttachment(task.attached_document_id, task.attached_document_title || "Документ");
    } else {
        clearSelectedDocAttachment();
    }

    const badge = document.getElementById("translate-status-badge");
    if (badge) badge.style.display = "none";
    const langBadge = document.getElementById("detected-lang-badge");
    if (langBadge) langBadge.style.display = "none";
    const transLabel = document.getElementById("task-trans-label");
    // Автоперевод отключен по регламенту модернизации

    // Показываем кнопку переадресации только при редактировании незаблокированной активной задачи
    const reassignCont = document.getElementById("task-reassign-container");
    if (reassignCont) {
        if (isLocked) {
            reassignCont.style.setProperty("display", "none", "important");
        } else {
            reassignCont.style.display = "block";
        }
    }
    const btnReassign = document.getElementById("btn-modal-reassign-task");
    if (btnReassign) {
        if (isLocked) {
            btnReassign.style.setProperty("display", "none", "important");
        } else {
            btnReassign.style.display = "inline-flex";
        }
    }
}

function closeTaskModal() {
    closeTaskAssigneePopover();
    closeTaskZonePopover();
    document.getElementById("task-modal").style.display = "none";
}

async function saveTaskModal() {
    const taskId = document.getElementById("task-id-input").value;
    const existing = taskId ? allTasks.find(t => t.id == taskId) : null;
    if (existing) {
        const isLocked = !isPlannerAdmin() && !isPlannerTrustedLeader() && existing.status && (existing.status.includes("Выполнено") || existing.status.includes("Отменено"));
        if (isLocked) {
            showToast("🔒 Завершенные и отмененные задачи защищены от изменений", "error");
            return;
        }
    }
    let titleRu = document.getElementById("task-ru-input").value.trim();
    let titleKz = document.getElementById("task-kz-input").value.trim();
    const taskType = document.getElementById("task-type-input") ? document.getElementById("task-type-input").value : "weekly";
    const deptService = document.getElementById("task-department-input") ? document.getElementById("task-department-input").value : "";
    const parentIdVal = document.getElementById("task-parent-input") && document.getElementById("task-parent-input").value ? parseInt(document.getElementById("task-parent-input").value, 10) : null;
    const selectedBlockerIds = getMultiBlockerSelectedIds("task-modal-blockers");
    const dependsIdVal = selectedBlockerIds.length > 0 ? selectedBlockerIds[0] : (document.getElementById("task-depends-input") && document.getElementById("task-depends-input").value ? parseInt(document.getElementById("task-depends-input").value, 10) : null);
    const tagsVal = document.getElementById("task-tags-input") ? document.getElementById("task-tags-input").value.trim() : "";
    const quarterVal = document.getElementById("task-quarter-input") ? document.getElementById("task-quarter-input").value : "";
    const progressVal = document.getElementById("task-progress-input") ? parseInt(document.getElementById("task-progress-input").value, 10) : 0;

    const zone = document.getElementById("task-zone-input").value;
    const photoLink = document.getElementById("task-photo-input").value.trim();
    const photoLinkAfter = document.getElementById("task-photo-after-input") ? document.getElementById("task-photo-after-input").value.trim() : "";
    const author = document.getElementById("task-author-input").value;
    const assignee = document.getElementById("task-assignee-input").value;
    
    const rawDue = document.getElementById("task-due-input").value.trim();
    const due = formatIsoToDisplayDate(rawDue);
    
    const status = document.getElementById("task-status-input").value;
    const comment = document.getElementById("task-comment-input").value.trim();

    if (!titleRu && !titleKz) {
        alert("Пожалуйста, введите суть задачи!");
        return;
    }

    if (!author) {
        alert("Пожалуйста, укажите автора задачи!");
        return;
    }

    // Определяем пользователя и тип действия для проверки прав
    const requiredUser = existing ? (canEditProjectOrTask(existing) ? (existing.author_name || author) : (existing.assignee_name || assignee)) : author;
    const actionType = existing ? (canEditProjectOrTask(existing) ? "edit_project" : "interact") : "create";

    ensureUserAuthorized(requiredUser, async (authSession) => {
        // Если статус Выполнено — факт обязателен
        if (status === "🟢 Выполнено" && !comment) {
            alert("При установке статуса «Выполнено» обязательно укажите факт / результат выполнения в поле «Факт / Комментарий»!");
            const commInput = document.getElementById("task-comment-input");
            if (commInput) commInput.focus();
            return;
        }

        // Синхронизируем и определяем языки при сохранении
        try {
            const transRes = await fetch("/api/tasks/translate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: titleRu || titleKz })
            });
            if (transRes.ok) {
                const transData = await transRes.json();
                if (transData.detected_lang === 'kk') {
                    titleKz = transData.text_kz || titleRu || titleKz;
                    titleRu = transData.text_ru || titleRu || titleKz;
                } else {
                    titleRu = transData.text_ru || titleRu || titleKz;
                    titleKz = transData.text_kz || titleKz || titleRu;
                }
            }
        } catch (e) {
            console.error("Save modal translate error:", e);
        }

        const docIdVal = document.getElementById("task-doc-id-input") ? parseInt(document.getElementById("task-doc-id-input").value, 10) : null;

        let targetMonth = currentMonth;
        let targetWeek = currentWeek;

        if (rawDue) {
            try {
                const resW = await fetch(`/api/tasks/resolve_week?date_str=${encodeURIComponent(rawDue)}`);
                if (resW.ok) {
                    const dW = await resW.json();
                    if (dW.status === 'ok' && dW.month_label && dW.week_label) {
                        targetMonth = dW.month_label;
                        targetWeek = dW.week_label;
                    }
                }
            } catch (err) {
                console.warn("Auto-resolve week on task save error:", err);
            }
        }

        const payload = {
            title: titleRu,
            title_kz: null,
            zone: zone,
            task_type: taskType,
            department_service: (deptService && deptService !== 'Общий' && taskType !== 'weekly') ? deptService : null,
            parent_id: parentIdVal,
            depends_on_id: dependsIdVal,
            depends_on_ids: selectedBlockerIds,
            tags: tagsVal,
            target_quarter: quarterVal,
            progress: progressVal,
            photo_link: photoLink,
            photo_link_after: photoLinkAfter,
            author_name: author,
            assignee_name: assignee,
            due_date_str: due,
            status: status,
            comment: comment,
            month_label: targetMonth,
            week_label: targetWeek,
            attached_document_id: docIdVal || null,
            pin_code: authSession ? authSession.pin : "",
            user_name: authSession ? authSession.name : ""
        };

        const saveBtn = document.querySelector("#task-modal .btn-primary-action");
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.dataset.origText = saveBtn.innerHTML;
            saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Сохранение...`;
        }

        try {
            let res;
            if (taskId) {
                res = await fetch(`/api/tasks/${taskId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
            } else {
                res = await fetch("/api/tasks", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
            }

            if (res.ok) {
                closeTaskModal();
                cachedAllHierarchyTasks = null;
                showToast(taskId ? "Задача обновлена" : "Задача добавлена в план");
                loadTaskTags();
                if (typeof currentGraphProjectId !== 'undefined' && currentGraphProjectId && typeof reloadProjectGraphData === 'function') {
                    await reloadProjectGraphData();
                }
                if (currentHorizon === "roadmaps") {
                    loadRoadmaps();
                } else {
                    loadTasks();
                }
            } else {
                const err = await res.json();
                alert("Ошибка сохранения: " + (err.detail || "Не удалось сохранить задачу"));
            }
        } catch (e) {
            console.error("Save task error:", e);
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                if (saveBtn.dataset.origText) saveBtn.innerHTML = saveBtn.dataset.origText;
            }
        }
    });
}

/* ==========================================================
   BULK TASKS MODAL (MASS TASK CREATION)
   ========================================================== */
let bulkRowCounter = 0;

function updateBulkColumnsLayout() {
    const typeSelect = document.getElementById("bulk-type-input");
    const isServicePlan = typeSelect && typeSelect.value === "service_plan";

    // 1. Шапка таблицы
    const header = document.getElementById("bulk-tasks-table-header");
    const headerAssignee = document.getElementById("bulk-header-assignee");
    if (header) {
        if (isServicePlan) {
            header.style.gridTemplateColumns = "32px 1fr 130px 36px";
            if (headerAssignee) headerAssignee.style.display = "none";
        } else {
            header.style.gridTemplateColumns = "32px 1fr 180px 135px 36px";
            if (headerAssignee) headerAssignee.style.display = "block";
        }
    }

    // 2. Все текущие строки
    const rows = document.querySelectorAll(".bulk-task-row");
    rows.forEach(row => {
        const assigneeWrap = row.querySelector(".bulk-row-assignee-wrap");
        const assigneeSel = row.querySelector(".bulk-row-assignee");
        if (isServicePlan) {
            row.style.gridTemplateColumns = "32px 1fr 130px 36px";
            if (assigneeWrap) assigneeWrap.style.display = "none";
            if (assigneeSel) assigneeSel.style.display = "none";
        } else {
            row.style.gridTemplateColumns = "32px 1fr 180px 135px 36px";
            if (assigneeWrap) assigneeWrap.style.display = "block";
            if (assigneeSel) assigneeSel.style.display = "block";
        }
    });
}

function openBulkTasksModal() {
    populateDropdowns();
    bulkRowCounter = 0;

    // Автоматическая привязка к открытой вкладке (горизонту)
    const typeInput = document.getElementById("bulk-type-input");
    const deptContainer = document.getElementById("bulk-department-container");
    const deptSelect = document.getElementById("bulk-department-input");

    let taskType = "weekly";
    if (currentHorizon === "services") {
        taskType = "service_plan";
    } else if (currentHorizon === "tech_council") {
        taskType = "tech_council";
    } else if (currentHorizon === "quality_day") {
        taskType = "quality_day";
    } else if (currentHorizon === "roadmaps") {
        taskType = "roadmap";
    } else {
        taskType = "weekly";
    }

    if (typeInput) typeInput.value = taskType;
    updateBulkModalHorizonBadge(taskType);

    // Селектор службы: скрыт в недельном спринте, отображается только в службах
    if (deptContainer) {
        deptContainer.style.display = (taskType === "service_plan") ? "block" : "none";
    }

    // Автоподстановка автора
    let defaultAuthor = "";
    if (currentPlannerUser && currentPlannerUser.name) {
        defaultAuthor = currentPlannerUser.name;
    }

    if (deptSelect) {
        if (taskType === "service_plan") {
            if (currentDepartmentService && currentDepartmentService !== "all") {
                deptSelect.value = currentDepartmentService;
            } else if (defaultAuthor === "Курилова С.") {
                deptSelect.value = "ОГЭ";
            } else if (defaultAuthor === "Солонцов Ю." || defaultAuthor === "Сазонов С.") {
                deptSelect.value = "ОГМ";
            } else if (defaultAuthor === "Косумов Р.") {
                deptSelect.value = "Технологи";
            } else if (defaultAuthor === "Зарина") {
                deptSelect.value = "ОТК";
            } else {
                deptSelect.value = "ОГМ";
            }
        } else {
            deptSelect.value = "";
        }
    }

    let defaultAuthorVal = "";
    if (defaultAuthor) {
        defaultAuthorVal = defaultAuthor;
    } else {
        if (deptSelect && deptSelect.value === "ОГЭ") {
            defaultAuthorVal = "Курилова С.";
        } else if (deptSelect && deptSelect.value === "ОГМ") {
            defaultAuthorVal = "Солонцов Ю.";
        }
    }
    updateBulkAuthorDisplay(defaultAuthorVal);
    closeBulkAuthorPopover();

    // Подстановка зоны по умолчанию в зависимости от активного горизонта
    let defaultZoneVal = "Бережливое производство";
    if (taskType === "service_plan") {
        defaultZoneVal = (deptSelect && deptSelect.value) ? deptSelect.value : "ОГМ";
    } else if (taskType === "tech_council") {
        defaultZoneVal = "Техсовет";
    } else if (taskType === "quality_day") {
        defaultZoneVal = "День качества";
    }
    updateBulkZoneDisplay(defaultZoneVal);
    closeBulkZonePopover();

    // Подстановка даты по умолчанию (сегодня)
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const defDueInput = document.getElementById("bulk-default-due-input");
    if (defDueInput) {
        defDueInput.value = `${yyyy}-${mm}-${dd}`;
    }

    // Сброс поля быстрой вставки текста
    const pasteBox = document.getElementById("bulk-quick-paste-box");
    if (pasteBox) pasteBox.style.display = "none";
    const pasteArea = document.getElementById("bulk-paste-textarea");
    if (pasteArea) pasteArea.value = "";

    // Очищаем и создаем первые 3 пустые строки
    const container = document.getElementById("bulk-tasks-rows-container");
    if (container) container.innerHTML = "";

    addBulkTaskRow();
    addBulkTaskRow();
    addBulkTaskRow();

    updateBulkColumnsLayout();
    updateBulkTasksCountBadge();

    const modal = document.getElementById("bulk-tasks-modal");
    if (modal) modal.style.display = "flex";
}

function closeBulkTasksModal() {
    closeBulkAuthorPopover();
    closeBulkZonePopover();
    closeBulkRowAssigneePopover();
    const modal = document.getElementById("bulk-tasks-modal");
    if (modal) modal.style.display = "none";
}


function onBulkTypeChange(typeVal) {
    const deptSelect = document.getElementById("bulk-department-input");
    const authorInput = document.getElementById("bulk-author-input");
    const zoneInput = document.getElementById("bulk-zone-input");

    if (typeVal === "service_plan") {
        if (deptSelect && !deptSelect.value) {
            deptSelect.value = "ОГМ";
        }
        if (deptSelect && deptSelect.value === "ОГЭ" && (!authorInput || !authorInput.value)) {
            updateBulkAuthorDisplay("Курилова С.");
        }
        updateBulkZoneDisplay((deptSelect && deptSelect.value) ? deptSelect.value : "ОГМ");
    } else if (typeVal === "tech_council") {
        updateBulkZoneDisplay("Техсовет");
    } else if (typeVal === "quality_day") {
        updateBulkZoneDisplay("День качества");
    } else if (typeVal === "weekly") {
        if (zoneInput && (zoneInput.value === "Техсовет" || zoneInput.value === "День качества")) {
            updateBulkZoneDisplay("Бережливое производство");
        }
    }
    updateBulkColumnsLayout();
}

function onBulkDepartmentChange(deptVal) {
    const authorInput = document.getElementById("bulk-author-input");

    if (deptVal === "ОГЭ") {
        if (!authorInput || !authorInput.value || authorInput.value === "Солонцов Ю.") {
            updateBulkAuthorDisplay("Курилова С.");
        }
        updateBulkZoneDisplay("ОГЭ");
    } else if (deptVal === "ОГМ") {
        if (!authorInput || !authorInput.value || authorInput.value === "Курилова С.") {
            updateBulkAuthorDisplay("Солонцов Ю.");
        }
        updateBulkZoneDisplay("ОГМ");
    } else if (deptVal === "Технологи") {
        updateBulkAuthorDisplay("Косумов Р.");
    } else if (deptVal === "ОТК") {
        updateBulkAuthorDisplay("Зарина");
        updateBulkZoneDisplay("СКК");
    }
}

function onBulkDefaultDueChanged(newIsoDate) {
    if (!newIsoDate) return;
    const rows = document.querySelectorAll(".bulk-task-row");
    rows.forEach(row => {
        const dueInput = row.querySelector(".bulk-row-due");
        if (dueInput) {
            dueInput.value = newIsoDate;
        }
    });
    showToast(`Срок для всех строк обновлён на ${formatIsoToDisplayDate(newIsoDate)} 📅`);
}

function toggleBulkQuickPaste() {
    const pasteBox = document.getElementById("bulk-quick-paste-box");
    if (!pasteBox) return;
    if (pasteBox.style.display === "none" || !pasteBox.style.display) {
        pasteBox.style.display = "block";
        const pasteArea = document.getElementById("bulk-paste-textarea");
        if (pasteArea) pasteArea.focus();
    } else {
        pasteBox.style.display = "none";
    }
}

function matchPersonByName(rawText, personsList) {
    if (!rawText) return "";
    const cleanRaw = rawText.trim().toLowerCase();
    
    // 1. Точное совпадение
    const exact = personsList.find(p => p.toLowerCase() === cleanRaw);
    if (exact) return exact;

    // 2. Извлекаем фамилию (первое слово)
    const surnameMatch = cleanRaw.match(/^([а-яёa-z]+)/i);
    if (surnameMatch) {
        const surname = surnameMatch[1].toLowerCase();
        // Ищем в списке сотрудников по началу фамилии
        const matched = personsList.find(p => p.toLowerCase().startsWith(surname));
        if (matched) return matched;
    }

    // 3. Поиск подстроки
    for (const p of personsList) {
        const pSurname = p.split(" ")[0].toLowerCase();
        if (cleanRaw.includes(pSurname)) {
            return p;
        }
    }
    return "";
}


function normalizeWordTableLines(rawText) {
    // 1. Разбиваем на сырые строки
    const rawLines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (rawLines.length === 0) return [];

    const normalizedRows = [];
    let currentRow = null;

    for (const line of rawLines) {
        // Пропускаем шапки таблиц
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes("содержание поручения") || 
            lowerLine.includes("по результатам") || 
            (lowerLine.startsWith("№") && lowerLine.includes("срок"))) {
            continue;
        }

        // Строка таблицы с табуляцией: делим на столбцы
        const tabCols = line.split("\t").map(c => c.trim());
        const hasTabs = tabCols.length >= 2;
        const startsWithItemNum = /^\d+[\.\)]?\s*(\t|\s{2,})/.test(line) || (/^\d+$/.test(tabCols[0]) && tabCols.length >= 2);

        if (startsWithItemNum || (hasTabs && tabCols.length >= 3)) {
            // Это новая полноценная строка таблицы
            if (currentRow) {
                normalizedRows.push(currentRow);
            }
            currentRow = tabCols;
        } else if (hasTabs && currentRow) {
            // Строка с табуляцией, но без номера пункта (например, несколько ответственных и дата)
            // Присоединяем к существующей строке
            tabCols.forEach((colVal, cIdx) => {
                if (!colVal) return;
                const targetIdx = currentRow.length - tabCols.length + cIdx;
                if (targetIdx >= 0 && targetIdx < currentRow.length) {
                    currentRow[targetIdx] = (currentRow[targetIdx] + " " + colVal).trim();
                } else {
                    currentRow.push(colVal);
                }
            });
        } else if (currentRow) {
            // Строка без табуляции: это перенос строки внутри одной из ячеек предыдущей строки!
            // Проверяем: если это фамилия (например "Носиков Е.Г." или "Хохлов К.")
            const isPersonLike = /^[А-Яа-яёЁ]+\s+[А-Яа-яёЁ]\.?/i.test(line);
            if (isPersonLike && currentRow.length >= 3) {
                // Добавляем к ячейке ответственного (предпоследней)
                const respColIdx = currentRow.length - 2;
                currentRow[respColIdx] = (currentRow[respColIdx] + " " + line).trim();
            } else {
                // Добавляем к тексту поручения
                const titleColIdx = currentRow.length >= 4 ? 1 : 0;
                currentRow[titleColIdx] = (currentRow[titleColIdx] + " " + line).trim();
            }
        } else {
            // Обычная строка текста вне таблицы
            normalizedRows.push([line]);
        }
    }

    if (currentRow) {
        normalizedRows.push(currentRow);
    }

    return normalizedRows;
}

function parseBulkTasksFromTextarea() {
    const pasteArea = document.getElementById("bulk-paste-textarea");
    if (!pasteArea) return;
    const text = pasteArea.value.trim();
    if (!text) {
        alert("Пожалуйста, вставьте текст со списком задач или скопированную таблицу!");
        return;
    }

    const normalizedRows = normalizeWordTableLines(text);
    if (normalizedRows.length === 0) return;

    const persons = getUniquePersons();

    // Очищаем существующие пустые строки, если в них ничего не введено
    const container = document.getElementById("bulk-tasks-rows-container");
    if (container) {
        const existingRows = container.querySelectorAll(".bulk-task-row");
        existingRows.forEach(r => {
            const titleInp = r.querySelector(".bulk-row-title");
            if (titleInp && !titleInp.value.trim()) {
                r.remove();
            }
        });
    }

    let parsedCount = 0;

    normalizedRows.forEach(rowCols => {
        let taskTitle = "";
        let taskAssignee = "";
        let taskDueIso = "";

        if (rowCols.length >= 3) {
            // Табличный формат:
            // Вариант А (с номером): [0]=Номер, [1]=Текст, [2]=Ответственный, [3]=Срок
            // Вариант Б (без номера): [0]=Текст, [1]=Ответственный, [2]=Срок
            let colIndex = 0;
            if (/^\d+[\.\)]?$/.test(rowCols[0].trim())) {
                colIndex = 1;
            }

            taskTitle = rowCols[colIndex] || "";
            const rawAssignee = rowCols[colIndex + 1] || "";
            const rawDue = rowCols[colIndex + 2] || "";

            // Извлекаем срок
            taskDueIso = parseDateToIso(rawDue);
            if (!taskDueIso && rawAssignee) {
                const dateInAssignee = rawAssignee.match(/(\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)/);
                if (dateInAssignee) {
                    taskDueIso = parseDateToIso(dateInAssignee[1]);
                }
            }

            // Ищем ответственного
            if (rawAssignee) {
                // Разделяем нескольких ответственных (переносы, запятые, слэши)
                const peopleTokens = rawAssignee.split(/[\n\,\;\/]|(?<=[А-Яа-я]\.)\s+(?=[А-Я])/);
                for (const tok of peopleTokens) {
                    const matched = matchPersonByName(tok, persons);
                    if (matched) {
                        taskAssignee = matched;
                        break;
                    }
                }
            }
        } else {
            // Одиночная строка текста
            let cleanLine = rowCols[0] || "";
            cleanLine = cleanLine.replace(/^\d+[\.\)\-]\s*/, '').replace(/^[\-\*\•]\s*/, '').trim();

            const dateMatch = cleanLine.match(/(?:до\s+|срок\s+)?(\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)$/i);
            if (dateMatch) {
                taskDueIso = parseDateToIso(dateMatch[1]);
                cleanLine = cleanLine.replace(dateMatch[0], '').trim();
            }

            for (const p of persons) {
                const surname = p.split(" ")[0];
                const re = new RegExp(`\\b${surname}(?:\\s+[А-Я]\\.?)?`, 'i');
                if (re.test(cleanLine)) {
                    taskAssignee = p;
                    break;
                }
            }

            taskTitle = cleanLine;
        }

        // Окончательная очистка сути задачи от ведущей нумерации и лишних пробелов
        taskTitle = taskTitle.replace(/^\d+[\.\)\-]\s*/, '').replace(/^[\-\*\•]\s*/, '').replace(/\s+/g, ' ').trim();

        if (taskTitle) {
            addBulkTaskRow(taskTitle, taskAssignee, taskDueIso);
            parsedCount++;
        }
    });

    pasteArea.value = "";
    toggleBulkQuickPaste();
    updateBulkTasksCountBadge();
    showToast(`Успешно распознано и добавлено строк: ${parsedCount} 🎯`);
}

/* ==========================================================
   OCR VIA DEEPSEEK MULTIMODAL VISION
   ========================================================== */
async function compressImageForOcr(fileOrBlob, maxDim = 2048) {
    if (typeof fileOrBlob === "string") return fileOrBlob;
    if (!(fileOrBlob instanceof Blob)) return fileOrBlob;

    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(fileOrBlob);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width <= maxDim && height <= maxDim && fileOrBlob.size < 1.5 * 1024 * 1024) {
                resolve(fileOrBlob);
                return;
            }
            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round((height * maxDim) / width);
                    width = maxDim;
                } else {
                    width = Math.round((width * maxDim) / height);
                    height = maxDim;
                }
            }
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob(
                (blob) => {
                    resolve(blob || fileOrBlob);
                },
                "image/jpeg",
                0.88
            );
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(fileOrBlob);
        };
        img.src = url;
    });
}

function triggerBulkOcrUpload() {
    const fileInp = document.getElementById("bulk-ocr-file-input");
    if (fileInp) {
        fileInp.value = "";
        fileInp.click();
    }
}

function handleBulkOcrFileSelect(input) {
    if (!input || !input.files || input.files.length === 0) return;
    const files = Array.from(input.files);
    processBulkOcrFiles(files);
}

async function processBulkOcrImage(fileOrBase64) {
    return processBulkOcrFiles([fileOrBase64]);
}

async function processBulkOcrFiles(filesOrBlobs) {
    if (!filesOrBlobs || filesOrBlobs.length === 0) return;
    const btnOcr = document.getElementById("btn-bulk-ocr");
    const origHtml = btnOcr ? btnOcr.innerHTML : "";

    if (window.isBulkOcrRunning) return;
    window.isBulkOcrRunning = true;

    const appendMode = true; // Always append per user rule
    const container = document.getElementById("bulk-tasks-rows-container");

    if (container) {
        if (!appendMode) {
            // Если режим замены — полностью очищаем контейнер
            container.innerHTML = "";
            bulkRowCounter = 0;
        } else {
            // Если все текущие строки полностью пустые (например, 3 строки при открытии модалки), удаляем их
            const allRows = Array.from(container.querySelectorAll(".bulk-task-row"));
            const emptyRows = allRows.filter(r => {
                const t = r.querySelector(".bulk-row-title");
                return !t || !t.value.trim();
            });
            if (allRows.length > 0 && allRows.length === emptyRows.length) {
                container.innerHTML = "";
                bulkRowCounter = 0;
            } else {
                // Иначе удаляем только пустые "хвостовые" строки
                emptyRows.forEach(r => r.remove());
                renumberBulkRows();
            }
        }
    }

    // Собираем множество уже существующих названий задач для предотвращения дублей
    const existingTitles = new Set();
    if (container) {
        container.querySelectorAll(".bulk-row-title").forEach(el => {
            const val = el.value.replace(/^\d+[\.\)\-]\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (val) existingTitles.add(val);
        });
    }

    let totalAdded = 0;
    const totalFiles = filesOrBlobs.length;

    try {
        for (let i = 0; i < totalFiles; i++) {
            const rawFileItem = filesOrBlobs[i];
            
            if (btnOcr) {
                btnOcr.disabled = true;
                const fileLabel = totalFiles > 1 ? ` (${i + 1}/${totalFiles})` : "";
                btnOcr.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="color: #16a34a;"></i> <span>Распознавание DeepSeek${fileLabel}...</span>`;
            }

            try {
                const fileItem = await compressImageForOcr(rawFileItem);
                const formData = new FormData();
                if (typeof fileItem === "string") {
                    formData.append("image_base64", fileItem);
                } else {
                    formData.append("file", fileItem);
                }

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 60000);

                const res = await fetch("/api/tasks/ocr_image", {
                    method: "POST",
                    body: formData,
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (!res.ok) {
                    const err = await res.json().catch(() => ({ detail: "Сбой запроса" }));
                    throw new Error(err.detail || `Ошибка распознавания фото #${i + 1}`);
                }

                const data = await res.json();
                const tasks = data.tasks || [];

                let fileAddedCount = 0;
                tasks.forEach(t => {
                    const cleanTitle = (t.title || "").replace(/^\d+[\.\)\-]\s*/, '').replace(/\s+/g, ' ').trim();
                    const lowerT = cleanTitle.toLowerCase();
                    if (cleanTitle && !existingTitles.has(lowerT)) {
                        existingTitles.add(lowerT);
                        addBulkTaskRow(cleanTitle, t.assignee_name || "", t.due_date || "");
                        fileAddedCount++;
                        totalAdded++;
                    }
                });

                if (totalFiles > 1) {
                    showToast(`Фото ${i + 1}/${totalFiles}: +${fileAddedCount} задач 📸`);
                }
            } catch (err) {
                console.error(`Error recognizing file #${i + 1}:`, err);
                const errMsg = err.name === "AbortError" 
                    ? "Превышено время ожидания ответа AI (таймаут 60с)" 
                    : (err.message || "Ошибка распознавания");
                showToast(`⚠️ ${errMsg}`);
            }
        }

        updateBulkTasksCountBadge();
        if (totalAdded > 0) {
            const summary = totalFiles > 1 
                ? `AI успешно добавил ${totalAdded} задач с ${totalFiles} фото! 🎯` 
                : `AI успешно распознал ${totalAdded} задач со скриншота! 🎯`;
            showToast(summary);
        } else {
            showToast("Новых задач на предоставленных фото не обнаружено ℹ️");
        }

    } finally {
        window.isBulkOcrRunning = false;
        if (btnOcr) {
            btnOcr.disabled = false;
            btnOcr.innerHTML = origHtml;
        }
    }
}

function clearAllBulkTaskRows() {
    const container = document.getElementById("bulk-tasks-rows-container");
    if (!container) return;
    const rowCount = container.querySelectorAll(".bulk-task-row").length;
    if (rowCount === 0) return;

    if (confirm(`Очистить все строки (${rowCount})?`)) {
        container.innerHTML = "";
        bulkRowCounter = 0;
        addBulkTaskRow();
        updateBulkTasksCountBadge();
        showToast("Список задач очищен 🗑️");
    }
}

function autoResizeBulkTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(38, el.scrollHeight) + 'px';
}

function addBulkTaskRow(initTitle = "", initAssignee = "", initDue = "") {
    const container = document.getElementById("bulk-tasks-rows-container");
    if (!container) return;

    bulkRowCounter++;
    const rowId = `bulk-row-${bulkRowCounter}`;

    const defDue = initDue || (document.getElementById("bulk-default-due-input") ? document.getElementById("bulk-default-due-input").value : "");
    const persons = getUniquePersons();

    // Интеллектуальное сопоставление имени исполнителя из OCR (например, "Сазонов С.В." -> "Сазонов С.")
    let matchedAssignee = "";
    if (initAssignee) {
        const rawA = initAssignee.trim().toLowerCase();
        const found = persons.find(p => {
            const lowP = p.toLowerCase();
            if (lowP === rawA) return true;
            const pSurname = lowP.split(' ')[0];
            const aSurname = rawA.split(' ')[0];
            return pSurname && aSurname && pSurname === aSurname && (lowP.includes(aSurname) || rawA.includes(pSurname));
        });
        if (found) matchedAssignee = found;
    }

    const typeSelect = document.getElementById("bulk-type-input");
    const isServicePlan = typeSelect && typeSelect.value === "service_plan";

    const rowDiv = document.createElement("div");
    rowDiv.className = "bulk-task-row";
    rowDiv.id = rowId;
    rowDiv.style.display = "grid";
    rowDiv.style.gridTemplateColumns = isServicePlan ? "32px 1fr 130px 36px" : "32px 1fr 180px 135px 36px";
    rowDiv.style.gap = "0.5rem";
    rowDiv.style.alignItems = "start";
    rowDiv.style.background = "#f8fafc";
    rowDiv.style.border = "1px solid #e2e8f0";
    rowDiv.style.borderRadius = "8px";
    rowDiv.style.padding = "0.45rem 0.6rem";

    const selectedPerson = matchedAssignee || initAssignee;
    const avatarColor = selectedPerson ? getAvatarColorClass(selectedPerson) : "";
    const avatarInitials = selectedPerson ? getInitials(selectedPerson) : '<i class="fa-solid fa-user"></i>';

    rowDiv.innerHTML = `
        <span class="bulk-row-num" style="font-size: 0.8rem; font-weight: 700; color: #64748b; text-align: center; margin-top: 6px;"></span>
        <textarea class="form-textarea bulk-row-title" rows="2" placeholder="Суть задачи..." style="font-size: 0.85rem; padding: 0.35rem 0.55rem; resize: vertical; line-height: 1.35; width: 100%; word-break: break-word; min-height: 38px;" oninput="autoResizeBulkTextarea(this)" onkeydown="handleBulkRowKeydown(event, '${rowId}')">${escapeHtml(initTitle)}</textarea>
        <div class="bulk-row-assignee-wrap" style="${isServicePlan ? 'display: none;' : ''}">
            <input type="hidden" class="bulk-row-assignee-input" value="${escapeHtml(selectedPerson || '')}">
            <div class="bulk-row-assignee-trigger" id="btn-bulk-row-assignee-${rowId}" onclick="toggleBulkRowAssigneePopover(event, '${rowId}')" tabindex="0" title="Нажмите для выбора исполнителя">
                <div style="display: flex; align-items: center; gap: 0.45rem; min-width: 0;">
                    <div class="author-avatar-circle ${avatarColor}" style="${selectedPerson ? '' : 'background: #f1f5f9; color: #64748b;'} font-size: 0.7rem; width: 22px; height: 22px; flex-shrink: 0;">
                        ${avatarInitials}
                    </div>
                    <span class="bulk-row-assignee-text" style="font-size: 0.8rem; color: ${selectedPerson ? '#1e293b' : '#64748b'}; font-weight: ${selectedPerson ? '600' : 'normal'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${selectedPerson ? escapeHtml(selectedPerson) : '-- Исполнитель --'}
                    </span>
                </div>
                <i class="fa-solid fa-chevron-down" style="color: #94a3b8; font-size: 0.7rem; transition: transform 0.2s ease;"></i>
            </div>
        </div>
        <input type="date" class="form-input bulk-row-due" value="${defDue}" style="font-size: 0.82rem; padding: 0.4rem 0.45rem; margin-top: 2px;">
        <button type="button" class="btn-icon-cell" onclick="removeBulkTaskRow('${rowId}')" title="Удалить строку" style="color: #ef4444; border-color: #fecaca; background: #fff; margin-top: 3px;">
            <i class="fa-solid fa-trash-can" style="font-size: 0.82rem;"></i>
        </button>
    `;

    container.appendChild(rowDiv);
    renumberBulkRows();
    updateBulkTasksCountBadge();

    const titleArea = rowDiv.querySelector(".bulk-row-title");
    if (titleArea) {
        autoResizeBulkTextarea(titleArea);
        if (!initTitle) titleArea.focus();
    }
}

function removeBulkTaskRow(rowId) {
    const row = document.getElementById(rowId);
    if (row) {
        row.remove();
        renumberBulkRows();
        updateBulkTasksCountBadge();
    }
}

function renumberBulkRows() {
    const rows = document.querySelectorAll(".bulk-task-row");
    rows.forEach((r, idx) => {
        const numSpan = r.querySelector(".bulk-row-num");
        if (numSpan) numSpan.textContent = idx + 1;
    });
}

function updateBulkTasksCountBadge() {
    const rows = document.querySelectorAll(".bulk-task-row");
    const countBadge = document.getElementById("bulk-tasks-count-badge");
    const btnSaveText = document.getElementById("btn-save-bulk-text");
    
    let filledCount = 0;
    rows.forEach(r => {
        const t = r.querySelector(".bulk-row-title");
        if (t && t.value.trim()) filledCount++;
    });

    const totalCount = rows.length;
    if (countBadge) countBadge.textContent = `Строк: ${totalCount} (готово: ${filledCount})`;
    if (btnSaveText) btnSaveText.textContent = `Сохранить задачи (${filledCount || totalCount})`;
}

function handleBulkRowKeydown(event, currentRowId) {
    if (event.key === "Enter") {
        event.preventDefault();
        addBulkTaskRow();
    }
}

async function saveBulkTasksModal() {
    const author = document.getElementById("bulk-author-input") ? document.getElementById("bulk-author-input").value : "";
    const taskType = document.getElementById("bulk-type-input") ? document.getElementById("bulk-type-input").value : "weekly";
    const deptService = document.getElementById("bulk-department-input") ? document.getElementById("bulk-department-input").value : "";
    const zoneVal = document.getElementById("bulk-zone-input") ? document.getElementById("bulk-zone-input").value : "Бережливое производство";
    const defDueRaw = document.getElementById("bulk-default-due-input") ? document.getElementById("bulk-default-due-input").value : "";
    const defDueFormatted = formatIsoToDisplayDate(defDueRaw);

    if (!author) {
        alert("Пожалуйста, укажите автора задач!");
        const authSelect = document.getElementById("bulk-author-input");
        if (authSelect) authSelect.focus();
        return;
    }

    // Собираем строки
    const rows = document.querySelectorAll(".bulk-task-row");
    const tasksItems = [];

    rows.forEach(r => {
        const titleInput = r.querySelector(".bulk-row-title");
        const assigneeInput = r.querySelector(".bulk-row-assignee-input");
        const assigneeSelect = r.querySelector(".bulk-row-assignee");
        const dueInput = r.querySelector(".bulk-row-due");

        const title = titleInput ? titleInput.value.trim() : "";
        let assignee = assigneeInput ? assigneeInput.value.trim() : (assigneeSelect ? assigneeSelect.value.trim() : "");
        const dueRaw = dueInput ? dueInput.value.trim() : "";
        const due = formatIsoToDisplayDate(dueRaw) || defDueFormatted;

        // В службах для массового ввода автор = исполнитель
        if (taskType === "service_plan" || (currentHorizon === "services" && !assignee)) {
            assignee = author;
        }

        if (title) {
            tasksItems.push({
                title: title,
                assignee_name: assignee,
                due_date_str: due,
                zone: zoneVal
            });
        }
    });

    if (tasksItems.length === 0) {
        alert("Пожалуйста, заполните хотя бы одну задачу (поле «Суть задачи»)");
        return;
    }

    // Запрос PIN-кода автора, если требуется
    ensureUserAuthorized(author, async (authSession) => {
        const saveBtn = document.getElementById("btn-save-bulk-tasks");
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Сохранение (${tasksItems.length})...`;
        }

        const payload = {
            tasks: tasksItems,
            author_name: author,
            pin_code: authSession ? authSession.pin : "",
            task_type: taskType,
            department_service: (deptService && deptService !== 'Общий' && taskType !== 'weekly') ? deptService : "",
            zone: zoneVal,
            month_label: currentMonth,
            week_label: currentWeek,
            target_quarter: currentQuarter,
            default_due_date_str: defDueFormatted
        };

        try {
            const res = await fetch("/api/tasks/bulk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                timeoutMs: 60000
            });

            if (res.ok) {
                const data = await res.json();
                closeBulkTasksModal();
                if (data.count === 0 && data.skipped_duplicates > 0) {
                    showToast(data.message || `Все задачи уже присутствуют в текущей неделе (${data.skipped_duplicates} шт.)`, "warning");
                } else {
                    const dupText = (data.skipped_duplicates > 0) ? ` (пропущено дубликатов: ${data.skipped_duplicates})` : "";
                    showToast(`Успешно создано задач: ${data.count} шт.${dupText} 🚀`);
                }
                loadTaskTags();
                if (currentHorizon === "roadmaps") {
                    loadRoadmaps();
                } else {
                    loadTasks();
                }
            } else {
                const err = await res.json();
                alert("Ошибка массового сохранения: " + (err.detail || "Не удалось сохранить"));
            }
        } catch (e) {
            console.error("Bulk save error:", e);
            alert("Произошла ошибка сети при массовом создании задач");
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> <span id="btn-save-bulk-text">Сохранить задачи (${tasksItems.length})</span>`;
            }
        }
    });
}

/* ==========================================================
   MOVE TO NEXT WEEK & ARCHIVE (1-CLICK NO PROMPTS)
   ========================================================== */
function getNextCalendarWeek(task = null) {
    let baseMonth = currentMonth;
    let baseWeek = currentWeek;

    // Если в текущем фильтре 'all' (За всё время / Все недели), берем месяц и неделю самой задачи
    if ((baseMonth === 'all' || !baseMonth || !allWeeksStructure[baseMonth]) && task) {
        if (task.month_label && allWeeksStructure[task.month_label]) {
            baseMonth = task.month_label;
            baseWeek = task.week_label || '';
        }
    }

    const months = Object.keys(allWeeksStructure);
    if (!baseMonth || baseMonth === 'all' || !allWeeksStructure[baseMonth]) {
        // Фоллбэк: текущий календарный месяц из структуры
        const now = new Date();
        const curMName = `${_monthsRuInit[now.getMonth()]} ${now.getFullYear()}`;
        baseMonth = (months.includes(curMName)) ? curMName : (months.length > 0 ? months[0] : "Октябрь 2026");
    }

    const weeks = allWeeksStructure[baseMonth] || [];
    const currentIdx = weeks.indexOf(baseWeek);
    
    if (currentIdx >= 0 && currentIdx < weeks.length - 1) {
        return { month: baseMonth, week: weeks[currentIdx + 1] };
    }
    
    // Если это последняя неделя текущего месяца -> переходим на первую неделю следующего месяца
    const monthIdx = months.indexOf(baseMonth);
    if (monthIdx >= 0 && monthIdx < months.length - 1) {
        const nextMonth = months[monthIdx + 1];
        const nextMonthWeeks = allWeeksStructure[nextMonth] || [];
        if (nextMonthWeeks.length > 0) {
            return { month: nextMonth, week: nextMonthWeeks[0] };
        }
    }
    
    return { month: baseMonth, week: weeks[0] || `Неделя 1` };
}

async function moveTaskToNextWeekModal(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    const isLocked = !isPlannerAdmin() && (task && task.status && (task.status.includes("Выполнено") || task.status.includes("Отменено")));
    if (isLocked) {
        showToast("🔒 Завершенные и отмененные задачи заблокированы от переноса", "warning");
        return;
    }
    const requiredUser = task ? (task.assignee_name || task.author_name) : null;

    ensureUserAuthorized(requiredUser, async (authSession) => {
        const next = getNextCalendarWeek(task);
        const confirmMove = confirm(`Перенести задачу на «${next.week}» (${next.month}) со статусом «🔵 Перенесено»?`);
        if (!confirmMove) return;

        try {
            const uName = authSession ? authSession.name : (currentPlannerUser ? currentPlannerUser.name : "");
            const uPin = authSession ? authSession.pin : (currentPlannerUser ? currentPlannerUser.pin : "");
            const url = `/api/tasks/${taskId}/move_next_week?next_week=${encodeURIComponent(next.week)}&next_month=${encodeURIComponent(next.month)}&user_name=${encodeURIComponent(uName)}&pin=${encodeURIComponent(uPin)}`;
            const res = await fetch(url, {
                method: "POST"
            });
            if (res.ok) {
                showToast(`Задача перенесена на ${next.week}`);
                
                // Если перешли в другой месяц - переключаем фильтр месяца
                if (next.month !== currentMonth && currentMonth !== 'all') {
                    const monthSelect = document.getElementById("filter-month");
                    if (monthSelect) monthSelect.value = next.month;
                    currentMonth = next.month;
                    onMonthChange(next.week);
                } else {
                    const weekSelect = document.getElementById("filter-week");
                    if (weekSelect && currentWeek !== 'all') weekSelect.value = next.week;
                    if (currentWeek !== 'all') currentWeek = next.week;
                    loadTasks();
                }
            } else {
                const err = await res.json().catch(() => ({}));
                alert("Ошибка переноса задачи: " + (err.detail || "Доступ запрещен"));
            }
        } catch (e) {
            console.error("Move task error:", e);
        }
    }, task, "interact");
}

/* ==========================================================
   SYNC FROM GOOGLE SHEETS
   ========================================================== */
async function syncFromGoogleSheets() {
    if (!confirm("Импортировать задачи и контакты из Google Таблицы?")) return;

    showToast("Синхронизация с Google Таблицей...");
    try {
        const res = await fetch("/api/tasks/import_from_google_sheets", { method: "POST" });
        if (res.ok) {
            const data = await res.json();
            alert(`✅ ${data.message}`);
            await loadMasters();
            await loadTasks();
        } else {
            const err = await res.json();
            alert(`Ошибка: ${err.detail || 'Не удалось выполнить импорт'}`);
        }
    } catch (e) {
        console.error("Google sync error:", e);
    }
}

async function syncWithGoogleSheets() {
    showToast("Выгрузка задач в Google Таблицу...");
    try {
        const res = await fetch("/api/tasks/sync_google", { method: "POST" });
        if (res.ok) {
            showToast("✅ Задачи успешно синхронизированы с Google!");
        } else {
            showToast("⚠️ Ошибка синхронизации с Google.");
        }
    } catch (e) {
        showToast("⚠️ Ошибка соединения с Google API.");
    }
}

/* ==========================================================
   HELPERS & FORMATTERS
   ========================================================== */
function formatDate(dateStr) {
    if (!dateStr) return "";
    try {
        const [y, m, d] = dateStr.split("-");
        return `${d}.${m}.${y}`;
    } catch (e) {
        return dateStr;
    }
}

function getStatusColor(status) {
    if (status === "Выполнено") return "#34d399";
    if (status === "В процессе") return "#fbbf24";
    if (status === "Перенесено") return "#38bdf8";
    return "#94a3b8";
}

function showToast(message) {
    const toast = document.getElementById("toast-msg");
    const msgEl = document.getElementById("toast-text");
    if (!toast || !msgEl) return;

    msgEl.textContent = message;
    toast.classList.add("show");
    setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

/* ==========================================================
   PRINT & PDF EXPORT FOR INFOSTAND
   ========================================================== */
function printTasksPlanner() {
    preparePrintMetaHeader();
    window.print();
}

function exportTasksToPdf() {
    preparePrintMetaHeader();
    showToast("В открывшемся окне выберите «Сохранить как PDF»");
    setTimeout(() => {
        window.print();
    }, 250);
}

function preparePrintMetaHeader() {
    // Гарантируем сброс горизонтального скролла перед печатью на любом разрешении и мониторе
    const tableWrapper = document.getElementById("planner-table-wrapper");
    if (tableWrapper) {
        tableWrapper.scrollLeft = 0;
    }
    const tableContainer = document.querySelector(".table-container");
    if (tableContainer) {
        tableContainer.scrollLeft = 0;
    }

    const metaContainer = document.getElementById("print-meta-info");
    const subtitleEl = document.getElementById("print-header-subtitle");
    
    // Если мы в горизонте служб (ОГЭ / ОГМ) или выбран автор/служба ОГЭ/ОГМ — скрываем пустую колонку исполнителя при печати
    const isServiceMode = (currentHorizon === 'services') || (currentDepartmentService && currentDepartmentService !== 'all');
    if (isServiceMode) {
        document.body.classList.add("print-hide-assignee");
    } else {
        document.body.classList.remove("print-hide-assignee");
    }

    if (subtitleEl) {
        if (myTasksFilterActive && currentPlannerUser && currentPlannerUser.name) {
            subtitleEl.textContent = `ПЕРСОНАЛЬНЫЙ ОТЧЕТ ПО ЗАДАЧАМ: ${currentPlannerUser.name.toUpperCase()}`;
        } else if (currentHorizon === 'services') {
            const svcName = (currentDepartmentService && currentDepartmentService !== 'all') ? currentDepartmentService : "ОГМ / ОГЭ / ТЕХНОЛОГИ / ОТК";
            subtitleEl.textContent = `ПЛАН РАБОТ СЛУЖБЫ: ${svcName}`;
        } else if (currentHorizon === 'tech_council') {
            subtitleEl.textContent = "ПРОТОКОЛ ТЕХНИЧЕСКОГО СОВЕТА";
        } else if (currentHorizon === 'quality_day') {
            subtitleEl.textContent = "ПРОТОКОЛ ДНЯ КАЧЕСТВА";
        } else if (currentHorizon === 'roadmaps') {
            subtitleEl.textContent = "СТРАТЕГИЧЕСКИЙ ПЛАН / ДОРОЖНЫЕ КАРТЫ И ПРОЕКТЫ";
        } else {
            subtitleEl.textContent = "ИНФОРМАЦИОННЫЙ СТЕНД / БЕРЕЖЛИВОЕ ПРОИЗВОДСТВО";
        }
    }
    if (!metaContainer) return;

    // Специфика горизонта Дорожных карт (Roadmaps)
    if (currentHorizon === 'roadmaps' && !singleProjectPrintActive) {
        const quarterSelect = document.getElementById("filter-quarter");
        let quarterLabel = "Активные проекты";
        if (quarterSelect && quarterSelect.selectedIndex >= 0) {
            const selOpt = quarterSelect.options[quarterSelect.selectedIndex];
            if (selOpt) quarterLabel = selOpt.textContent;
        }

        const filterDetails = [];
        filterDetails.push(`Срез: ${quarterLabel}`);
        if (myTasksFilterActive && currentPlannerUser && currentPlannerUser.name) {
            filterDetails.push(`Мои проекты: ${currentPlannerUser.name}`);
        }

        const filterText = filterDetails.join(" • ");
        const now = new Date();
        const nowStr = now.toLocaleDateString("ru-RU") + " " + now.toLocaleTimeString("ru-RU", { hour: '2-digit', minute: '2-digit' });

        let totalMilestones = 0;
        (allRoadmaps || []).forEach(p => {
            totalMilestones += (p.milestones || []).length;
        });

        metaContainer.innerHTML = `
            <div style="font-weight: 700; font-size: 8.5pt; color: #0f172a;">${filterText}</div>
            <div style="font-size: 7.5pt; color: #334155; margin: 1px 0;">Всего проектов: ${(allRoadmaps || []).length} | Всего этапов: ${totalMilestones}</div>
            <div style="font-size: 7pt; color: #64748b;">Сформировано: ${nowStr}</div>
        `;

        buildRoadmapsPrintView(allRoadmaps, false);
        return;
    }
    if (singleProjectPrintActive) {
        return;
    }

    const month = document.getElementById("filter-month") ? document.getElementById("filter-month").value : currentMonth;
    const week = document.getElementById("filter-week") ? document.getElementById("filter-week").value : currentWeek;
    
    const zone = document.getElementById("table-filter-zone") ? document.getElementById("table-filter-zone").value : "all";
    const author = document.getElementById("table-filter-author") ? document.getElementById("table-filter-author").value : "all";
    const assignee = document.getElementById("table-filter-assignee") ? document.getElementById("table-filter-assignee").value : "all";
    const status = document.getElementById("table-filter-status") ? document.getElementById("table-filter-status").value : "all";

    const filterDetails = [];
    if (myTasksFilterActive && currentPlannerUser && currentPlannerUser.name) {
        filterDetails.push(`Сотрудник: ${currentPlannerUser.name} (Автор / Исполнитель)`);
    } else if (currentHorizon === 'services') {
        filterDetails.push(currentDepartmentService !== 'all' ? `Служба: ${currentDepartmentService}` : "Все службы (ОГМ / ОГЭ / Технологи / ОТК)");
    } else if (currentHorizon === 'tech_council') {
        filterDetails.push("Технический совет");
    } else if (currentHorizon === 'quality_day') {
        filterDetails.push("День качества");
    } else if (currentHorizon === 'weekly') {
        filterDetails.push("Бережливое производство");
    }
    if (showBacklog) filterDetails.push("⚡ Включая долги прошлых недель");
    if (zone !== "all") filterDetails.push(`Зона: ${zone}`);
    if (author !== "all" && !myTasksFilterActive) filterDetails.push(`Автор: ${author}`);
    if (assignee !== "all" && !isServiceMode && !myTasksFilterActive) filterDetails.push(`Исполнитель: ${assignee}`);
    if (status !== "all") filterDetails.push(`Статус: ${status}`);

    const filterText = filterDetails.length > 0 ? filterDetails.join(" • ") : "Все подразделения и статусы";
    const now = new Date();
    const nowStr = now.toLocaleDateString("ru-RU") + " " + now.toLocaleTimeString("ru-RU", { hour: '2-digit', minute: '2-digit' });

    metaContainer.innerHTML = `
        <div style="font-weight: 700; font-size: 8.5pt; color: #0f172a;">${month} / ${week === 'all' ? 'Весь месяц (все недели)' : week}</div>
        <div style="font-size: 7.5pt; color: #334155; margin: 1px 0;">${filterText}</div>
        <div style="font-size: 7pt; color: #64748b;">Всего задач: ${allTasks.length} | Сформировано: ${nowStr}</div>
    `;
}

// Автоматический перехват печати по Ctrl+P или через системное меню браузера
window.addEventListener("beforeprint", preparePrintMetaHeader);

/**
 * @canonical-pattern RoadmapPrintReport
 * @established 2026-10-27 (Phase 2 Roadmap Print Release)
 * @description Единый генератор печатной формы дорожных карт (А4 Landscape): сводный реестр и паспорт проекта.
 */
let singleProjectPrintActive = false;

function buildRoadmapsPrintView(projects, isSingleProject = false) {
    const tbody = document.getElementById("roadmap-print-table-body");
    if (!tbody) return;

    if (!projects || projects.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 2rem; color: #64748b; font-size: 8pt;">
                    Нет проектов дорожных карт для отображения по выбранным критериям.
                </td>
            </tr>
        `;
        return;
    }

    let html = "";
    projects.forEach(p => {
        const prog = p.calculated_progress !== undefined ? p.calculated_progress : (p.progress || 0);
        const pCode = p.code || ('TSK-' + p.id);
        const pStatus = p.status || '🟡 В работе';
        const pService = p.department_service ? `[${p.department_service}]` : '';
        const pCurator = p.assignee_name || p.author_name || 'Не назначен';
        const pDue = p.due_date_str || p.target_quarter || '—';
        const milestones = p.milestones || [];

        // Заголовочная строка проекта
        html += `
            <tr class="roadmap-print-project-row" style="background: #e2e8f0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; border-top: 2px solid #0f172a !important; font-weight: 700;">
                <td style="text-align: center; font-weight: 800; font-family: monospace; font-size: 8pt; background: #e2e8f0 !important;">${escapeHtml(pCode)}</td>
                <td style="font-weight: 800; font-size: 8.5pt; color: #0f172a; background: #e2e8f0 !important;">
                    <div style="display: flex; align-items: baseline; gap: 6px;">
                        <span>${escapeHtml(p.title)}</span>
                        ${pService ? `<span style="font-size: 7pt; color: #475569; font-weight: 600;">${escapeHtml(pService)}</span>` : ''}
                    </div>
                    ${p.attached_doc ? `<div style="font-size: 6.5pt; color: #2563eb; font-weight: 600;">📄 Регламент: ${escapeHtml(p.attached_doc.title || 'Документ')}</div>` : ''}
                </td>
                <td style="text-align: center; color: #64748b; font-size: 7.5pt; background: #e2e8f0 !important;">Проект целиком</td>
                <td style="background: #e2e8f0 !important;"><strong style="color: #0f172a;">${escapeHtml(pCurator)}</strong></td>
                <td style="text-align: center; white-space: nowrap; font-weight: 700; background: #e2e8f0 !important;">${escapeHtml(pDue)}</td>
                <td style="text-align: center; font-weight: 700; background: #e2e8f0 !important;">
                    <span style="display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 7.5pt; border: 1px solid #cbd5e1; background: #ffffff;">
                        ${prog}% (${escapeHtml(pStatus)})
                    </span>
                </td>
                <td style="text-align: center; font-size: 7pt; color: #475569; background: #e2e8f0 !important;">
                    <div style="border: 1px dashed #94a3b8; background: #ffffff; padding: 2px 4px; border-radius: 3px; font-size: 6.5pt;">
                        Куратор: ________
                    </div>
                </td>
            </tr>
        `;

        if (milestones.length === 0) {
            html += `
                <tr class="roadmap-print-stage-row">
                    <td></td>
                    <td colspan="6" style="color: #64748b; font-style: italic; font-size: 7pt; padding-left: 14px;">
                        (Этапы проекта пока не добавлены)
                    </td>
                </tr>
            `;
        } else {
            milestones.forEach((m, mIdx) => {
                const mCode = m.code || `${pCode}.${mIdx + 1}`;
                const mTitle = m.title || '—';
                const mAssignee = m.assignee_name || pCurator || '—';
                const mDue = m.due_date_str || '—';
                const mProg = m.calculated_progress !== undefined ? m.calculated_progress : (m.status === '🟢 Выполнено' ? 100 : (m.progress || 0));
                const isDone = m.status === '🟢 Выполнено' || mProg === 100;

                // Блокеры / Предшественники
                let blockersHtml = '—';
                const bList = (m.blockers && m.blockers.length > 0) ? m.blockers : (m.depends_on ? [m.depends_on] : []);
                if (bList.length > 0) {
                    blockersHtml = bList.map(b => {
                        const bDone = b.status && b.status.includes('Выполнено');
                        return `<span style="display: inline-block; padding: 1px 4px; border-radius: 3px; font-size: 6.5pt; margin: 1px; ${bDone ? 'background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0;' : 'background: #fef2f2; color: #991b1b; border: 1px solid #fecaca;'}">
                            ${bDone ? '✓' : '🔒'} ждет: ${escapeHtml(b.code || b.title || 'этап')}
                        </span>`;
                    }).join(' ');
                }

                html += `
                    <tr class="roadmap-print-stage-row" style="${isDone ? 'background: #f8fafc;' : ''}">
                        <td style="text-align: center; font-size: 7pt; color: #64748b; font-family: monospace;">${escapeHtml(mCode)}</td>
                        <td style="padding-left: 14px !important;">
                            <div style="font-weight: 600; color: #1e293b;">
                                <span style="color: #6366f1; margin-right: 4px;">↳</span>${escapeHtml(mTitle)}
                            </div>
                        </td>
                        <td style="font-size: 7pt;">${blockersHtml}</td>
                        <td style="font-size: 7.5pt; color: #334155;">${escapeHtml(mAssignee)}</td>
                        <td style="text-align: center; white-space: nowrap; font-size: 7.5pt;">${escapeHtml(mDue)}</td>
                        <td style="text-align: center; font-size: 7pt;">
                            <span style="font-weight: 700; ${isDone ? 'color: #16a34a;' : 'color: #2563eb;'}">
                                ${isDone ? '🟢 Выполнено' : `${mProg}% (${escapeHtml(m.status || 'В работе')})`}
                            </span>
                        </td>
                        <td style="text-align: center;">
                            <div style="display: inline-block; width: 13px; height: 13px; border: 1.5px solid ${isDone ? '#16a34a' : '#94a3b8'}; border-radius: 3px; line-height: 11px; font-weight: 700; font-size: 8pt; color: #16a34a;">
                                ${isDone ? '✓' : ''}
                            </div>
                        </td>
                    </tr>
                `;

                // Дочерние подзадачи этапа (если есть)
                if (m.subtasks && m.subtasks.length > 0) {
                    m.subtasks.forEach(sub => {
                        const subDone = sub.status === '🟢 Выполнено' || sub.progress === 100;
                        const subDue = sub.due_date_str ? escapeHtml(sub.due_date_str) : '—';
                        const subFact = (subDone && sub.completed_at) ? `<div style="font-size: 5.8pt; color: #166534; font-weight: 600;">факт: ${escapeHtml(sub.completed_at)}</div>` : '';
                        html += `
                            <tr class="roadmap-print-subtask-row" style="background: #fafafa; font-size: 6.8pt; color: #64748b;">
                                <td style="text-align: center; font-family: monospace; font-size: 6.5pt; color: #94a3b8;">${escapeHtml(sub.code || '—')}</td>
                                <td style="padding-left: 28px !important;">
                                    <span style="color: #94a3b8; margin-right: 3px;">•</span> ${escapeHtml(sub.title)}
                                </td>
                                <td>—</td>
                                <td>${escapeHtml(sub.assignee_name || mAssignee)}</td>
                                <td style="text-align: center; white-space: nowrap; font-weight: 600; color: #334155;">
                                    ${subDue}
                                    ${subFact}
                                </td>
                                <td style="text-align: center;">${subDone ? '🟢 100%' : `${sub.progress || 0}%`}</td>
                                <td style="text-align: center;">
                                    <div style="display: inline-block; width: 10px; height: 10px; border: 1px solid ${subDone ? '#16a34a' : '#cbd5e1'}; border-radius: 2px; line-height: 8px; font-size: 6.5pt; color: #16a34a;">
                                        ${subDone ? '✓' : ''}
                                    </div>
                                </td>
                            </tr>
                        `;
                    });
                }
            });
        }

        // Если режим одиночного паспорта проекта — добавляем блок подписания и утверждения
        if (isSingleProject) {
            html += `
                <tr class="roadmap-print-sign-row" style="border-top: 2px solid #0f172a !important; background: #ffffff !important;">
                    <td colspan="7" style="padding: 12px 14px !important;">
                        <div style="font-size: 7.5pt; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;">Лист утверждения и контроля исполнения проекта</div>
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 7.8pt; font-weight: 600; color: #0f172a; gap: 12px;">
                            <div>Куратор проекта: ____________________ / ${escapeHtml(pCurator)} /</div>
                            <div>Главный инженер: ____________________ / ____________________ /</div>
                            <div>Директор завода: ____________________ / ____________________ /</div>
                        </div>
                    </td>
                </tr>
            `;
        }
    });

    tbody.innerHTML = html;
}

/**
 * Печать паспорта одного конкретного проекта Дорожной карты
 */
async function printRoadmapProject(projectId) {
    if (!projectId) return;

    let project = (allRoadmaps || []).find(p => p.id == projectId || String(p.id) === String(projectId));
    if (!project) {
        try {
            showToast("Загрузка данных проекта для печати... ⏳");
            const res = await fetch(`/api/tasks/roadmaps?quarter=all`);
            if (res.ok) {
                const list = await res.json();
                project = list.find(p => p.id == projectId || String(p.id) === String(projectId));
            }
        } catch (e) {
            console.error("Error loading project for print:", e);
        }
    }

    if (!project) {
        showToast("Не удалось найти данные проекта для печати", "error");
        return;
    }

    singleProjectPrintActive = true;
    document.body.classList.add("print-single-project");

    const subtitleEl = document.getElementById("print-header-subtitle");
    if (subtitleEl) {
        subtitleEl.textContent = `ПАСПОРТ ПРОЕКТА: ${project.code || ('TSK-' + project.id)} — ${project.title.toUpperCase()}`;
    }

    const metaContainer = document.getElementById("print-meta-info");
    if (metaContainer) {
        const now = new Date();
        const nowStr = now.toLocaleDateString("ru-RU") + " " + now.toLocaleTimeString("ru-RU", { hour: '2-digit', minute: '2-digit' });
        const curator = project.assignee_name || project.author_name || '—';
        const svc = project.department_service || 'Общезаводской';
        const qtr = project.target_quarter || 'Бессрочный';
        const prog = project.calculated_progress !== undefined ? project.calculated_progress : (project.progress || 0);

        metaContainer.innerHTML = `
            <div style="font-weight: 700; font-size: 8.5pt; color: #0f172a;">Служба: ${escapeHtml(svc)} | Период: ${escapeHtml(qtr)}</div>
            <div style="font-size: 7.5pt; color: #334155; margin: 1px 0;">Куратор: ${escapeHtml(curator)} • Готовность: ${prog}% (${escapeHtml(project.status || 'В работе')})</div>
            <div style="font-size: 7pt; color: #64748b;">Этапов: ${(project.milestones || []).length} | Сформировано: ${nowStr}</div>
        `;
    }

    buildRoadmapsPrintView([project], true);

    setTimeout(() => {
        window.print();
    }, 150);
}

// Восстановление состояния после закрытия окна печати
window.addEventListener("afterprint", () => {
    if (singleProjectPrintActive) {
        singleProjectPrintActive = false;
        document.body.classList.remove("print-single-project");
        preparePrintMetaHeader();
    }
});

/* ==========================================================
   PHOTO UPLOAD & CLIENT-SIDE WEBP COMPRESSOR
   ========================================================== */
async function uploadPhotoBlobDirectly(blob, targetInputId, hintId, previewBtnId, thumbContainerId) {
    const targetInput = document.getElementById(targetInputId);
    const hintEl = hintId ? document.getElementById(hintId) : null;
    const previewBtn = previewBtnId ? document.getElementById(previewBtnId) : null;

    showToast("Сжатие и загрузка фото... ⏳");

    try {
        let compressedBlob;
        try {
            compressedBlob = await compressImageToWebp(blob, 1600, 0.82);
        } catch (compErr) {
            console.warn("Canvas WebP compression failed, fallback to raw blob:", compErr);
            compressedBlob = blob;
        }

        const formData = new FormData();
        formData.append("file", compressedBlob, "task_photo.webp");

        const res = await fetch("/api/tasks/upload_photo", {
            method: "POST",
            body: formData
        });

        if (res.ok) {
            const data = await res.json();
            if (targetInput) {
                targetInput.value = data.url;
            }
            onPhotoInputChanged(targetInputId, hintId, previewBtnId, thumbContainerId);
            if (hintEl) {
                const origKb = Math.round((blob.size || 0) / 1024);
                const compKb = Math.round((compressedBlob.size || 0) / 1024);
                hintEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>Фото сжато (${origKb} Кб ➔ ${compKb} Кб) и прикреплено</span>`;
                hintEl.style.display = "inline-flex";
            }
            if (previewBtn) previewBtn.style.display = "inline-flex";
            showToast("Фото успешно прикреплено! 📸");
        } else {
            const err = await res.json();
            alert("Ошибка загрузки фото: " + (err.detail || "Не удалось сохранить фото"));
        }
    } catch (e) {
        console.error("Direct photo upload error:", e);
        alert("Ошибка при обработке фото: " + e.message);
    }
}

async function handlePhotoFileUpload(fileInput, targetInputId, hintId, previewBtnId, thumbContainerId) {
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) return;
    const file = fileInput.files[0];
    try {
        await uploadPhotoBlobDirectly(file, targetInputId, hintId, previewBtnId, thumbContainerId);
    } finally {
        fileInput.value = "";
    }
}

function compressImageToWebp(file, maxDimension = 1600, quality = 0.82) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > maxDimension || height > maxDimension) {
                    if (width > height) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    } else {
                        width = Math.round((width * maxDimension) / height);
                        height = maxDimension;
                    }
                }

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);

                // Пытаемся сохранить в webp, если браузер поддерживает, иначе jpeg fallback
                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            // Fallback to jpeg if webp blob creation returned null
                            canvas.toBlob(
                                (jpegBlob) => {
                                    if (jpegBlob) resolve(jpegBlob);
                                    else reject(new Error("Не удалось сжать изображение"));
                                },
                                "image/jpeg",
                                quality
                            );
                        }
                    },
                    "image/webp",
                    quality
                );
            };
            img.onerror = (e) => reject(new Error("Не удалось прочитать изображение"));
            img.src = event.target.result;
        };
        reader.onerror = (e) => reject(new Error("Ошибка чтения файла"));
        reader.readAsDataURL(file);
    });
}

function removeAttachedPhoto(inputId, hintId, previewBtnId, thumbContainerId) {
    const inputEl = document.getElementById(inputId);
    if (inputEl) inputEl.value = "";
    onPhotoInputChanged(inputId, hintId, previewBtnId, thumbContainerId);
    showToast("Фото удалено 🗑️");
}

function onPhotoInputChanged(inputId, hintId, previewBtnId, thumbContainerId) {
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;

    // Fallback auto-detection if IDs not passed directly
    let hint = hintId ? document.getElementById(hintId) : null;
    let previewBtn = previewBtnId ? document.getElementById(previewBtnId) : null;
    let thumbContainer = thumbContainerId ? document.getElementById(thumbContainerId) : null;

    if (!hint) {
        if (inputId === 'task-photo-input') hint = document.getElementById('task-photo-preview-hint');
        else if (inputId === 'task-photo-after-input') hint = document.getElementById('task-photo-after-preview-hint');
        else if (inputId === 'complete-task-photo') hint = document.getElementById('complete-photo-preview-hint');
    }
    if (!previewBtn) {
        if (inputId === 'task-photo-input') previewBtn = document.getElementById('task-photo-preview-btn');
        else if (inputId === 'task-photo-after-input') previewBtn = document.getElementById('task-photo-after-preview-btn');
        else if (inputId === 'complete-task-photo') previewBtn = document.getElementById('complete-photo-preview-btn');
    }
    if (!thumbContainer) {
        if (inputId === 'task-photo-input') thumbContainer = document.getElementById('task-photo-thumb-container');
        else if (inputId === 'task-photo-after-input') thumbContainer = document.getElementById('task-photo-after-thumb-container');
        else if (inputId === 'complete-task-photo') thumbContainer = document.getElementById('complete-photo-thumb-container');
    }

    const val = inputEl.value.trim();
    const isValidUrl = val && (val.startsWith("http://") || val.startsWith("https://") || val.startsWith("/static/") || val.startsWith("/uploads/"));

    if (isValidUrl) {
        if (previewBtn && inputId !== 'task-photo-input') previewBtn.style.display = "inline-flex";
        if (hint && inputId !== 'task-photo-input') hint.style.display = "inline-flex";
        if (thumbContainer) {
            thumbContainer.style.display = "flex";
            if (inputId === 'task-photo-input') {
                thumbContainer.innerHTML = `
                    <div class="photo-thumb-card-modern" id="task-photo-thumb-card">
                        <img src="${val}" alt="Превью ДО" onclick="openPhotoViewerModal('${val}')" title="Кликните для полноэкранного просмотра">
                        <div class="photo-thumb-meta">
                            <span class="photo-thumb-name"><i class="fa-solid fa-circle-check" style="color: #16a34a; margin-right: 4px;"></i>Фото ДО загружено</span>
                            <span class="photo-thumb-action" onclick="openPhotoViewerModal('${val}')">Нажмите для просмотра</span>
                        </div>
                        <button type="button" class="photo-thumb-del-modern" onclick="removeAttachedPhoto('${inputId}', '${hintId || ''}', '${previewBtnId || ''}', '${thumbContainerId || ''}')" title="Удалить прикрепленное фото">&times;</button>
                    </div>
                `;
                const attachWrap = document.getElementById("task-photo-attach-wrapper");
                if (attachWrap) attachWrap.classList.add("has-photo");
            } else {
                thumbContainer.innerHTML = `
                    <div class="photo-thumb-card">
                        <img src="${val}" alt="Превью" onclick="openPhotoViewerModal('${val}')" title="Кликните для просмотра в полном размере">
                        <button type="button" class="photo-thumb-del" onclick="removeAttachedPhoto('${inputId}', '${hintId || ''}', '${previewBtnId || ''}', '${thumbContainerId || ''}')" title="Удалить прикрепленное фото">&times;</button>
                    </div>
                `;
            }
        }
    } else {
        if (previewBtn) previewBtn.style.display = "none";
        if (hint) hint.style.display = "none";
        if (thumbContainer) {
            thumbContainer.style.display = "none";
            thumbContainer.innerHTML = "";
            if (inputId === 'task-photo-input') {
                const attachWrap = document.getElementById("task-photo-attach-wrapper");
                if (attachWrap) attachWrap.classList.remove("has-photo");
            }
        }
    }
}

/* ── Lightbox Viewer with ДО / ПОСЛЕ Tabs and Multi-Photo Gallery ───────── */
let currentViewerPhotoBefore = "";
let currentViewerPhotoAfter = "";
let currentViewerActiveTab = "before";
let currentLightboxGallery = [];
let currentLightboxIndex = 0;

function openPhotoViewerModal(urlBefore, urlAfter, activeTab = 'before') {
    currentLightboxGallery = [];
    currentLightboxIndex = 0;
    currentViewerPhotoBefore = (urlBefore && typeof urlBefore === 'string') ? urlBefore.trim() : "";
    currentViewerPhotoAfter = (urlAfter && typeof urlAfter === 'string') ? urlAfter.trim() : "";

    if (!currentViewerPhotoBefore && currentViewerPhotoAfter) {
        currentViewerActiveTab = 'after';
    } else if (currentViewerPhotoBefore && !currentViewerPhotoAfter) {
        currentViewerActiveTab = 'before';
    } else {
        currentViewerActiveTab = activeTab || 'before';
    }

    const modal = document.getElementById("photo-viewer-modal");
    const tabsContainer = document.getElementById("photo-viewer-tabs");
    const tabBeforeBtn = document.getElementById("tab-photo-before");
    const tabAfterBtn = document.getElementById("tab-photo-after");
    const prevBtn = document.getElementById("lightbox-prev-btn");
    const nextBtn = document.getElementById("lightbox-next-btn");
    const counterEl = document.getElementById("photo-viewer-counter");

    if (!modal) return;

    if (prevBtn) prevBtn.style.display = "none";
    if (nextBtn) nextBtn.style.display = "none";
    if (counterEl) counterEl.textContent = "";

    if (currentViewerPhotoBefore && currentViewerPhotoAfter) {
        if (tabsContainer) tabsContainer.style.display = "flex";
        if (tabBeforeBtn) tabBeforeBtn.style.display = "inline-flex";
        if (tabAfterBtn) tabAfterBtn.style.display = "inline-flex";
    } else {
        if (tabsContainer) tabsContainer.style.display = "none";
    }

    updateLightboxImage();
    modal.classList.add("active");
}

function openLightboxGallery(photoType = 'before', initialIndex = 0) {
    if (!currentDetailTaskData || !currentDetailTaskData.photos) return;
    const cleanType = (photoType === 'after') ? 'after' : 'before';
    const list = currentDetailTaskData.photos[cleanType] || [];
    if (!list.length) return;

    currentLightboxGallery = list;
    currentLightboxIndex = Math.max(0, Math.min(initialIndex, list.length - 1));
    currentViewerActiveTab = cleanType;

    const modal = document.getElementById("photo-viewer-modal");
    const tabsContainer = document.getElementById("photo-viewer-tabs");
    const prevBtn = document.getElementById("lightbox-prev-btn");
    const nextBtn = document.getElementById("lightbox-next-btn");

    if (!modal) return;
    if (tabsContainer) tabsContainer.style.display = "none";

    const hasNav = list.length > 1;
    if (prevBtn) prevBtn.style.display = hasNav ? "flex" : "none";
    if (nextBtn) nextBtn.style.display = hasNav ? "flex" : "none";

    renderLightboxGalleryImage();
    modal.classList.add("active");
}

function navigateLightboxPhoto(step) {
    if (!currentLightboxGallery || !currentLightboxGallery.length) return;
    currentLightboxIndex = (currentLightboxIndex + step + currentLightboxGallery.length) % currentLightboxGallery.length;
    renderLightboxGalleryImage();
}

function renderLightboxGalleryImage() {
    if (!currentLightboxGallery || !currentLightboxGallery.length) return;
    const item = currentLightboxGallery[currentLightboxIndex];
    const url = (typeof item === 'object' && item) ? (item.url || "") : String(item);

    const img = document.getElementById("photo-viewer-img");
    const directLink = document.getElementById("photo-viewer-direct-link");
    const counterEl = document.getElementById("photo-viewer-counter");

    if (img) {
        img.style.opacity = "0.3";
        img.src = url;
        img.onload = () => { img.style.opacity = "1"; };
    }
    if (directLink) {
        directLink.href = url || "#";
    }
    if (counterEl) {
        const typeLabel = (currentViewerActiveTab === 'after') ? 'ПОСЛЕ' : 'ДО';
        counterEl.textContent = `${typeLabel}: ${currentLightboxIndex + 1} из ${currentLightboxGallery.length}`;
    }
}

function switchLightboxTab(tab) {
    currentViewerActiveTab = tab;
    updateLightboxImage();
}

function updateLightboxImage() {
    const img = document.getElementById("photo-viewer-img");
    const directLink = document.getElementById("photo-viewer-direct-link");
    const tabBeforeBtn = document.getElementById("tab-photo-before");
    const tabAfterBtn = document.getElementById("tab-photo-after");

    const targetUrl = (currentViewerActiveTab === 'after') ? currentViewerPhotoAfter : currentViewerPhotoBefore;

    if (tabBeforeBtn && tabAfterBtn) {
        if (currentViewerActiveTab === 'after') {
            tabAfterBtn.classList.add("active");
            tabBeforeBtn.classList.remove("active");
        } else {
            tabBeforeBtn.classList.add("active");
            tabAfterBtn.classList.remove("active");
        }
    }

    if (img) {
        img.style.opacity = "0.4";
        img.src = targetUrl || "";
        img.onload = () => { img.style.opacity = "1"; };
    }
    if (directLink) {
        directLink.href = targetUrl || "#";
    }
}

function closePhotoViewerModal() {
    const modal = document.getElementById("photo-viewer-modal");
    const img = document.getElementById("photo-viewer-img");
    if (modal) modal.classList.remove("active");
    if (img) img.src = "";
    currentViewerPhotoBefore = "";
    currentViewerPhotoAfter = "";
    currentLightboxGallery = [];
    currentLightboxIndex = 0;
}

// Lightbox keyboard navigation
document.addEventListener("keydown", (e) => {
    const modal = document.getElementById("photo-viewer-modal");
    if (!modal || !modal.classList.contains("active")) return;
    if (e.key === "Escape") {
        closePhotoViewerModal();
    } else if (e.key === "ArrowLeft") {
        navigateLightboxPhoto(-1);
    } else if (e.key === "ArrowRight") {
        navigateLightboxPhoto(1);
    }
});

/* ==========================================================
   TASK DETAIL VIEW MODAL & MULTI-PHOTO GALLERY
   ========================================================== */
let currentDetailTaskId = null;
let currentDetailTaskData = null;
let currentDetailPhotoTab = 'before';
let taskDetailNavStack = [];

/**
 * @canonical-pattern TaskDetailCleanHeaderAndPropertiesStrip
 * @established 2026-10-26
 * @description Чистая двухполюсная шапка (статус слева, действия 36px справа) и 4-колоночная полоса свойств задачи.
 * @compliance Rule 27, Rule 30, No-Wrap Status Badge, Compact 4-Col Grid, Canonical 36px Height Standard
 * @param {number|string} taskId - Идентификатор задачи
 * @param {boolean} isBack - Признак возврата по стеку навигации
 */
async function openTaskDetailModal(taskId, isBack = false) {
    if (!taskId) return;

    // Track navigation history if traversing to another task
    if (!isBack && currentDetailTaskId && currentDetailTaskId !== taskId) {
        taskDetailNavStack.push(currentDetailTaskId);
    }

    currentDetailTaskId = taskId;
    currentDetailPhotoTab = 'before';

    const modal = document.getElementById("task-detail-modal");
    if (!modal) return;

    // Update back button state
    const backBtn = document.getElementById("detail-btn-back");
    if (backBtn) {
        backBtn.style.display = taskDetailNavStack.length > 0 ? "inline-flex" : "none";
    }

    // Reset fields to loading state
    const codeEl = document.getElementById("detail-task-code");
    const titleRuEl = document.getElementById("detail-task-title-ru");
    const titleKzEl = document.getElementById("detail-task-title-kz");
    const statusBadgeEl = document.getElementById("detail-task-status-badge");
    const horizonBadgeEl = document.getElementById("detail-task-horizon-badge");
    const commentEl = document.getElementById("detail-task-comment");

    if (codeEl) codeEl.textContent = `TSK-${taskId}`;
    if (titleRuEl) titleRuEl.textContent = "Загрузка данных задачи...";
    if (titleKzEl) titleKzEl.textContent = "";
    if (statusBadgeEl) {
        statusBadgeEl.className = "task-detail-status-pill";
        statusBadgeEl.style.background = "#f1f5f9";
        statusBadgeEl.style.color = "#64748b";
        statusBadgeEl.style.borderColor = "#e2e8f0";
        statusBadgeEl.innerHTML = `<span class="task-detail-status-dot" style="background: #94a3b8;"></span><span>Загрузка...</span>`;
    }
    if (commentEl) commentEl.textContent = "—";

    modal.style.display = "flex";
    modal.classList.add("active");

    try {
        const res = await fetch(`/api/tasks/${taskId}`);
        if (!res.ok) {
            throw new Error(`Ошибка загрузки задачи (HTTP ${res.status})`);
        }
        const task = await res.json();
        currentDetailTaskData = task;
        populateTaskDetailModal(task);
    } catch (err) {
        console.error("Error opening task detail modal:", err);
        showToast("Не удалось загрузить подробности задачи", "error");
        closeTaskDetailModal();
    }
}

function navigateBackTaskDetail() {
    if (taskDetailNavStack.length > 0) {
        const prevId = taskDetailNavStack.pop();
        openTaskDetailModal(prevId, true);
    }
}

function closeTaskDetailModal() {
    cancelDetailCommentEdit();
    const modal = document.getElementById("task-detail-modal");
    if (modal) {
        modal.style.display = "none";
        modal.classList.remove("active");
    }
    currentDetailTaskId = null;
    currentDetailTaskData = null;
    taskDetailNavStack = [];
    const backBtn = document.getElementById("detail-btn-back");
    if (backBtn) backBtn.style.display = "none";
}

function populateTaskDetailModal(task) {
    if (!task) return;
    cancelDetailCommentEdit();

    // Header & Codes
    const codeEl = document.getElementById("detail-task-code");
    if (codeEl) codeEl.textContent = task.code || `TSK-${task.id}`;

    // Titles
    const titleRuEl = document.getElementById("detail-task-title-ru");
    if (titleRuEl) titleRuEl.textContent = task.title || "Без названия";

    const titleKzEl = document.getElementById("detail-task-title-kz");
    if (titleKzEl) {
        titleKzEl.style.display = "none";
    }

    // Status Badge (Strict Single Row, Glowing Dot, No Wrap)
    const statusBadgeEl = document.getElementById("detail-task-status-badge");
    if (statusBadgeEl) {
        const rawSt = task.status || "В очереди";
        let cleanSt = rawSt.replace(/^[🟢🟡🔵🔴⚪\s]+/, "").trim();
        let dotColor = "#d97706";
        let bg = "#fef3c7";
        let textCol = "#92400e";
        let borderCol = "#fde68a";
        let variantClass = "status-in-progress";

        if (rawSt.includes("Выполнено")) {
            dotColor = "#16a34a";
            bg = "#dcfce7";
            textCol = "#166534";
            borderCol = "#bbf7d0";
            cleanSt = "Выполнено";
            variantClass = "status-done";
        } else if (rawSt.includes("Отменено")) {
            dotColor = "#dc2626";
            bg = "#fee2e2";
            textCol = "#991b1b";
            borderCol = "#fecaca";
            cleanSt = "Отменено";
            variantClass = "status-cancelled";
        } else if (rawSt.includes("Перенесено")) {
            dotColor = "#0284c7";
            bg = "#e0f2fe";
            textCol = "#075985";
            borderCol = "#bae6fd";
            cleanSt = "Перенесено";
            variantClass = "status-rescheduled";
        } else {
            dotColor = "#d97706";
            bg = "#fef3c7";
            textCol = "#92400e";
            borderCol = "#fde68a";
            cleanSt = "В работе";
            variantClass = "status-in-progress";
        }

        statusBadgeEl.className = `task-detail-status-pill ${variantClass}`;
        statusBadgeEl.style.background = bg;
        statusBadgeEl.style.color = textCol;
        statusBadgeEl.style.borderColor = borderCol;
        statusBadgeEl.style.whiteSpace = "nowrap";
        statusBadgeEl.innerHTML = `<span class="task-detail-status-dot" style="background: ${dotColor}; box-shadow: 0 0 0 3px ${dotColor}33;"></span><span>${escapeHtml(cleanSt)}</span>`;
    }

    // Horizon Badge & Parent Project Wrap (Hidden per clean redesign request)
    const isRoadmap = task.task_type === 'roadmap';
    const isTopProject = isRoadmap && !task.parent_id;
    const isMilestone = isRoadmap && !!task.parent_id;

    const horizonBadgeEl = document.getElementById("detail-task-horizon-badge");
    if (horizonBadgeEl) {
        horizonBadgeEl.style.display = "none";
    }

    const parentWrap = document.getElementById("detail-task-parent-wrap");
    if (parentWrap) {
        parentWrap.style.display = "none";
        parentWrap.innerHTML = "";
    }

    // Action buttons state
    const canInteract = canInteractWithTask(task);
    const canEdit = canEditProjectOrTask(task);
    const canDelete = canDeleteProjectOrTask(task);

    const btnComplete = document.getElementById("detail-btn-complete");
    const isDone = task.status && task.status.includes("Выполнено");
    if (btnComplete) {
        if (!canInteract) {
            btnComplete.style.display = "none";
        } else {
            btnComplete.style.display = "inline-flex";
            if (isDone) {
                btnComplete.innerHTML = `<i class="fa-solid fa-circle-check"></i> Выполнено`;
                btnComplete.style.background = "#059669";
                btnComplete.disabled = true;
            } else {
                btnComplete.innerHTML = `<i class="fa-solid fa-check"></i> Завершить`;
                btnComplete.style.background = "#10b981";
                btnComplete.disabled = false;
            }
        }
    }

    const btnReschedule = document.getElementById("detail-btn-reschedule");
    if (btnReschedule) {
        btnReschedule.style.display = canInteract ? "inline-flex" : "none";
    }

    const btnEdit = document.getElementById("detail-btn-edit");
    if (btnEdit) {
        btnEdit.style.display = canEdit ? "inline-flex" : "none";
        btnEdit.innerHTML = `<i class="fa-solid fa-pen"></i> Редактировать`;
    }

    const btnDelete = document.getElementById("detail-btn-delete");
    if (btnDelete) {
        btnDelete.style.display = canDelete ? "inline-flex" : "none";
        btnDelete.disabled = false;
        btnDelete.innerHTML = '<i class="fa-solid fa-trash-can"></i> Удалить';
    }

    const isDoneOrCancelled = task.status && (task.status.includes("Выполнено") || task.status.includes("Отменено"));
    const isLeaderOrAdmin = (typeof isPlannerAdmin === 'function' && isPlannerAdmin()) || (typeof isPlannerTrustedLeader === 'function' && isPlannerTrustedLeader());
    const canAddSubtasks = (!isDoneOrCancelled || isLeaderOrAdmin) && canInteract;

    const btnAddSubtask = document.getElementById("detail-btn-add-subtask");
    const btnAddSubtaskLabel = document.getElementById("detail-btn-add-subtask-label");
    const addSubtaskWrap = document.getElementById("detail-add-subtask-wrap");
    const newSubInput = document.getElementById("detail-new-subtask-input");
    if (btnAddSubtask) {
        btnAddSubtask.style.display = canAddSubtasks ? "inline-flex" : "none";
        if (btnAddSubtaskLabel) {
            btnAddSubtaskLabel.textContent = isTopProject ? "Добавить этап" : "Добавить подзадачу";
        }
    }
    if (addSubtaskWrap) {
        addSubtaskWrap.style.display = canAddSubtasks ? "flex" : "none";
    }
    if (newSubInput) {
        newSubInput.placeholder = isTopProject ? "+ Введите название этапа (Enter)..." : "+ Введите суть подзадачи (Enter)...";
    }

    // Progress Section (only if has subtasks or is a top-level project)
    const progSection = document.getElementById("detail-progress-section");
    const progBar = document.getElementById("detail-progress-bar");
    const progPercent = document.getElementById("detail-progress-percent");
    const progLabel = document.getElementById("detail-progress-label");
    const subtasks = task.subtasks || [];
    const hasProgress = subtasks.length > 0 || isTopProject;

    if (progSection && hasProgress) {
        progSection.style.display = "block";
        const calcProg = task.calculated_progress || task.progress || 0;
        if (progBar) {
            progBar.style.width = `${calcProg}%`;
            progBar.style.background = calcProg === 100 ? '#10b981' : '#2563eb';
        }
        if (progPercent) progPercent.textContent = `${calcProg}%`;
        if (progLabel) {
            if (subtasks.length > 0) {
                const doneSubs = subtasks.filter(s => s.status && s.status.includes("Выполнено")).length;
                const unitLabel = isTopProject ? 'этапов' : 'подзадач';
                progLabel.textContent = `Прогресс: ${doneSubs} из ${subtasks.length} ${unitLabel} выполнено`;
            } else {
                progLabel.textContent = `Прогресс выполнения:`;
            }
        }
    } else if (progSection) {
        progSection.style.display = "none";
    }

    // 4-Column Property Strip
    const assigneeEl = document.getElementById("detail-task-assignee");
    const avatarEl = document.getElementById("detail-assignee-avatar");
    if (assigneeEl) {
        if (task.assignee_name) {
            assigneeEl.textContent = task.assignee_name;
            assigneeEl.style.color = "#0f172a";
            if (avatarEl) {
                const initials = typeof getInitials === 'function' ? getInitials(task.assignee_name) : task.assignee_name.slice(0, 2);
                const colorClass = typeof getAvatarColorClass === 'function' ? getAvatarColorClass(task.assignee_name) : 'avatar-blue';
                avatarEl.className = `person-avatar ${colorClass}`;
                avatarEl.style.background = "";
                avatarEl.style.color = "";
                avatarEl.textContent = initials;
            }
        } else {
            assigneeEl.textContent = "Не назначен";
            assigneeEl.style.color = "#94a3b8";
            if (avatarEl) {
                avatarEl.className = "person-avatar";
                avatarEl.style.background = "#f1f5f9";
                avatarEl.style.color = "#94a3b8";
                avatarEl.innerHTML = '<i class="fa-solid fa-user-slash" style="font-size: 10px;"></i>';
            }
        }
    }

    const dueDateEl = document.getElementById("detail-task-due-date");
    if (dueDateEl) {
        if (task.due_date_str) {
            dueDateEl.textContent = task.due_date_str;
            dueDateEl.style.color = "#0f172a";
        } else {
            dueDateEl.textContent = "В течение недели";
            dueDateEl.style.color = "#94a3b8";
        }
    }

    const authorEl = document.getElementById("detail-task-author");
    if (authorEl) {
        authorEl.textContent = task.author_name || "Не указан";
        authorEl.style.color = "#0f172a";
    }

    const zoneServiceEl = document.getElementById("detail-task-zone-service");
    if (zoneServiceEl) {
        const textParts = [];
        if (task.department_service) textParts.push(task.department_service);
        if (task.zone && task.zone !== 'Бережливое производство' && task.zone !== task.department_service) {
            textParts.push(task.zone);
        }
        zoneServiceEl.textContent = textParts.join(" / ") || (task.zone || 'Бережливое производство');
        zoneServiceEl.title = zoneServiceEl.textContent;
    }

    const periodEl = document.getElementById("detail-task-period");
    if (periodEl) {
        const parts = [];
        if (task.month_label) parts.push(task.month_label);
        if (task.week_label) parts.push(task.week_label);
        if (task.target_quarter) parts.push(`(${task.target_quarter})`);
        periodEl.textContent = parts.length ? parts.join(" • ") : "—";
    }

    const docCell = document.getElementById("detail-doc-cell");
    const docEl = document.getElementById("detail-task-doc");
    if (docCell && docEl) {
        if (task.attached_doc && task.attached_doc.title) {
            docCell.style.display = "flex";
            docEl.innerHTML = `
                <a href="${task.attached_doc.link}" target="_blank" class="badge-doc-attachment" style="display: inline-flex; align-items: center; gap: 5px; text-decoration: none; color: #1d4ed8; font-weight: 600;">
                    <span>${escapeHtml(task.attached_doc.title)}</span>
                    <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.7rem; opacity: 0.7;"></i>
                </a>
            `;
        } else {
            docCell.style.display = "none";
        }
    }

    // Tags & Blockers (Multi-Blockers support)
    const blockerWrap = document.getElementById("detail-blocker-wrap");
    if (blockerWrap) {
        const blks = (task.blockers && task.blockers.length > 0)
            ? task.blockers
            : (task.depends_on && task.depends_on.code ? [task.depends_on] : []);
        if (blks.length > 0) {
            blockerWrap.style.display = "flex";
            blockerWrap.style.flexWrap = "wrap";
            blockerWrap.style.gap = "6px";
            blockerWrap.innerHTML = blks.map(b => {
                const isDone = b.is_done || (b.status && b.status.includes("Выполнено"));
                return `
                    <span class="dep-blocker-badge" style="font-size: 0.78rem; padding: 4px 10px; cursor: pointer;" onclick="openTaskDetailModal(${b.id})" title="${escapeHtml(b.title || '')}">
                        <i class="fa-solid fa-lock" style="color: ${isDone ? '#16a34a' : '#dc2626'};"></i> ${isDone ? '🟢' : '🔒'} Блокер: <strong>${b.code || ('TSK-' + b.id)}</strong> <span style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: bottom;">${escapeHtml(b.title || '')}</span>
                    </span>
                `;
            }).join('');
        } else {
            blockerWrap.style.display = "none";
            blockerWrap.innerHTML = "";
        }
    }

    const tagsWrap = document.getElementById("detail-tags-wrap");
    if (tagsWrap) {
        tagsWrap.innerHTML = "";
        if (task.tags) {
            task.tags.split(",").filter(Boolean).forEach(t => {
                const cleanT = t.trim();
                if (cleanT) {
                    const span = document.createElement("span");
                    span.className = "tag-pill";
                    span.textContent = cleanT;
                    tagsWrap.appendChild(span);
                }
            });
        }
    }

    // Comment Box with neutral styling when empty
    const commentBox = document.getElementById("detail-task-comment");
    const btnEditComment = document.getElementById("btn-edit-detail-comment");
    const editWrap = document.getElementById("detail-comment-edit-wrap");

    if (btnEditComment) {
        btnEditComment.style.display = canInteract ? "inline-flex" : "none";
    }

    if (editWrap) {
        editWrap.style.display = "none";
    }

    if (commentBox) {
        commentBox.style.display = "block";
        if (canInteract) {
            commentBox.onclick = enableDetailCommentEdit;
            commentBox.style.cursor = "pointer";
            commentBox.title = "Нажмите для добавления или редактирования комментария";
        } else {
            commentBox.onclick = null;
            commentBox.style.cursor = "default";
            commentBox.title = "";
        }

        if (task.comment && task.comment.trim()) {
            commentBox.textContent = task.comment.trim();
            commentBox.classList.remove("is-empty");
        } else {
            commentBox.textContent = "Комментарий отсутствует";
            commentBox.classList.add("is-empty");
        }
    }

    // Render Multi-photo Gallery
    renderDetailPhotoGallery();

    // Render Subtasks
    renderDetailSubtasks();
}

/* @canonical-pattern TaskDetailInlineComment (One-Click Inline Edit) */
function enableDetailCommentEdit() {
    if (!canInteractWithTask(currentDetailTaskData)) {
        showToast("🔒 Редактирование факта и комментариев доступно только исполнителю, автору или руководству завода", "warning");
        return;
    }
    const commentBox = document.getElementById("detail-task-comment");
    const editWrap = document.getElementById("detail-comment-edit-wrap");
    const textarea = document.getElementById("detail-comment-textarea");
    const btnEdit = document.getElementById("btn-edit-detail-comment");
    if (!commentBox || !editWrap || !textarea) return;

    const currentText = (currentDetailTaskData && currentDetailTaskData.comment) ? currentDetailTaskData.comment.trim() : "";
    textarea.value = currentText;
    commentBox.style.display = "none";
    editWrap.style.display = "block";
    if (btnEdit) btnEdit.style.display = "none";
    textarea.focus();

    textarea.style.height = "auto";
    textarea.style.height = Math.max(textarea.scrollHeight + 4, 75) + "px";

    textarea.onkeydown = function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            saveDetailCommentEdit();
        } else if (e.key === "Escape") {
            e.preventDefault();
            cancelDetailCommentEdit();
        }
    };
}

function cancelDetailCommentEdit() {
    const commentBox = document.getElementById("detail-task-comment");
    const editWrap = document.getElementById("detail-comment-edit-wrap");
    const btnEdit = document.getElementById("btn-edit-detail-comment");
    const canInteract = canInteractWithTask(currentDetailTaskData);
    if (commentBox) commentBox.style.display = "block";
    if (editWrap) editWrap.style.display = "none";
    if (btnEdit) btnEdit.style.display = canInteract ? "inline-flex" : "none";
}

async function saveDetailCommentEdit() {
    if (!currentDetailTaskId) return;
    if (!canInteractWithTask(currentDetailTaskData)) {
        showToast("🔒 Редактирование факта и комментариев доступно только исполнителю, автору или руководству завода", "warning");
        return;
    }
    const textarea = document.getElementById("detail-comment-textarea");
    const saveBtn = document.getElementById("btn-save-detail-comment");
    if (!textarea) return;

    const newText = textarea.value.trim();
    const task = currentDetailTaskData;
    const requiredUser = task ? (task.assignee_name || task.author_name) : null;

    ensureUserAuthorized(requiredUser, async (authSession) => {
        const authorName = (authSession && authSession.name) ? authSession.name : ((currentPlannerUser && currentPlannerUser.name) ? currentPlannerUser.name : "Сотрудник завода");
        const pin = (authSession && authSession.pin) ? authSession.pin : ((currentPlannerUser && currentPlannerUser.pin) ? currentPlannerUser.pin : "");

        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Сохранение...`;
        }

        try {
            const payload = {
                author_name: authorName,
                pin_code: pin,
                text: newText,
                comment_type: "comment"
            };
            const res = await fetch(`/api/tasks/${currentDetailTaskId}/comments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || "Не удалось сохранить комментарий");
            }

            if (currentDetailTaskData) {
                currentDetailTaskData.comment = newText;
            }
            if (Array.isArray(allTasks)) {
                const t = allTasks.find(x => x.id === currentDetailTaskId);
                if (t) t.comment = newText;
            }
            if (currentGraphData?.nodes) {
                const n = currentGraphData.nodes.find(x => x.id === currentDetailTaskId);
                if (n) n.comment = newText;
            }

            const commentBox = document.getElementById("detail-task-comment");
            if (commentBox) {
                if (newText) {
                    commentBox.textContent = newText;
                    commentBox.classList.remove("is-empty");
                } else {
                    commentBox.textContent = "Комментарий отсутствует";
                    commentBox.classList.add("is-empty");
                }
            }

            cancelDetailCommentEdit();
            showToast("Комментарий успешно сохранён! 💬", "success");
        } catch (err) {
            console.error("Error saving detail comment:", err);
            showToast(`⚠️ Ошибка сохранения: ${err.message}`, "error");
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = `<i class="fa-solid fa-check"></i> Сохранить`;
            }
        }
    }, task, "interact");
}

function renderDetailSubtasks() {
    const section = document.getElementById("detail-subtasks-section");
    const countEl = document.getElementById("detail-subtasks-count");
    const titleEl = document.getElementById("detail-subtasks-title");
    const iconEl = document.getElementById("detail-subtasks-icon");
    const listEl = document.getElementById("detail-subtasks-list");
    if (!section || !listEl) return;

    const isTopProject = currentDetailTaskData?.task_type === 'roadmap' && !currentDetailTaskData?.parent_id;
    if (titleEl) {
        titleEl.textContent = isTopProject ? "Этапы проекта (Дорожная карта)" : "Чек-лист / Подзадачи";
    }
    if (iconEl) {
        iconEl.className = isTopProject ? "fa-solid fa-diagram-project" : "fa-solid fa-list-check";
        iconEl.style.color = isTopProject ? "#7c3aed" : "#2563eb";
    }

    const subtasks = (currentDetailTaskData && currentDetailTaskData.subtasks) || [];
    if (countEl) countEl.textContent = subtasks.length;

    if (!subtasks.length) {
        listEl.innerHTML = `
            <div style="text-align: center; color: #94a3b8; font-size: 0.82rem; padding: 0.85rem; border: 1px dashed #e2e8f0; border-radius: 8px;">
                ${isTopProject ? 'Этапы проекта пока не созданы' : 'Подзадачи чек-листа пока не созданы'}
            </div>
        `;
        return;
    }

    const canInteractParent = canInteractWithTask(currentDetailTaskData);

    listEl.innerHTML = subtasks.map(st => {
        const isDone = st.status && st.status.includes("Выполнено");
        const stCode = st.code || `TSK-${st.id}`;
        const canInteractSt = canInteractParent || canInteractWithTask(st);
        const checkAction = canInteractSt ? `onclick="quickToggleSubtaskFromDetail(${st.id}, '${st.status || ''}')"` : `disabled="disabled"`;
        const checkStyle = canInteractSt ? `cursor: pointer;` : `cursor: default; opacity: 0.6; pointer-events: none;`;
        const checkTitle = canInteractSt ? (isDone ? 'Снять отметку' : 'Отметить выполненным') : 'Только для чтения';

        const stDue = st.due_date_str ? st.due_date_str.trim() : "";
        const dateBadge = canInteractSt ? `
            <span onclick="quickEditSubtaskDate(${st.id}, '${escapeHtml(stDue)}', event)" style="font-size: 0.70rem; padding: 2px 7px; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 4px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background 0.15s ease;" title="Нажмите, чтобы изменить срок исполнения подзадачи">
                <i class="fa-regular fa-calendar-days" style="font-size: 0.65rem; margin-right: 3px;"></i>${escapeHtml(stDue || 'Указать срок')}
            </span>
        ` : (stDue ? `
            <span style="font-size: 0.70rem; padding: 2px 7px; background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; border-radius: 4px; font-weight: 600; white-space: nowrap;" title="Срок исполнения подзадачи">
                <i class="fa-regular fa-calendar-days" style="font-size: 0.65rem; margin-right: 3px;"></i>${escapeHtml(stDue)}
            </span>
        ` : '');

        return `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; background: ${isDone ? '#f0fdf4' : '#f8fafc'}; border: 1px solid ${isDone ? '#bbf7d0' : '#e2e8f0'}; border-radius: 8px; gap: 8px; transition: background 0.15s ease;">
                <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                    <button type="button" class="roadmap-check-btn ${isDone ? 'checked' : ''}" ${checkAction} style="width: 20px; height: 20px; font-size: 0.7rem; flex-shrink: 0; ${checkStyle}" title="${checkTitle}">
                        <i class="fa-solid fa-check"></i>
                    </button>
                    <span class="badge-code" style="font-size: 0.72rem; font-family: monospace; font-weight: 700; background: #e2e8f0; color: #334155; padding: 1px 5px; border-radius: 4px; flex-shrink: 0;">${escapeHtml(stCode)}</span>
                    <span onclick="openTaskDetailModal(${st.id})" style="font-size: 0.86rem; font-weight: 500; color: ${isDone ? '#64748b' : '#0f172a'}; text-decoration: ${isDone ? 'line-through' : 'none'}; word-break: break-word; cursor: pointer;" title="Открыть паспорт ${isTopProject ? 'этапа' : 'подзадачи'}" class="task-title-link">${escapeHtml(st.title)}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                    ${dateBadge}
                    <span style="font-size: 0.74rem; color: #64748b; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="Исполнитель: ${escapeHtml(st.assignee_name || 'Не назначен')}">${escapeHtml(st.assignee_name || '—')}</span>
                    <span class="badge-zone" style="font-size: 0.68rem; padding: 1px 6px;">${escapeHtml(st.status || 'В работе')}</span>
                    <button type="button" class="btn-icon-cell" onclick="openTaskDetailModal(${st.id})" title="Открыть паспорт ${isTopProject ? 'этапа' : 'подзадачи'}" style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; border: 1px solid #cbd5e1; background: #ffffff; color: #2563eb; cursor: pointer;">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    </button>
                </div>
            </div>
        `;
    }).join("");
}

async function quickEditSubtaskDate(subtaskId, currentDate, event) {
    if (event) event.stopPropagation();
    const subtasks = (currentDetailTaskData && currentDetailTaskData.subtasks) || [];
    const st = subtasks.find(s => s.id === subtaskId);
    if (!canInteractWithTask(st) && !canInteractWithTask(currentDetailTaskData)) {
        showToast("🔒 Изменение срока подзадачи доступно только исполнителю, автору или руководству", "warning");
        return;
    }

    const newDate = prompt(`Укажите срок исполнения для подзадачи [${st ? (st.code || 'TSK-' + st.id) : ''}]:`, currentDate || "");
    if (newDate === null) return;
    const cleanDate = newDate.trim();

    const requiredUser = st ? (st.assignee_name || st.author_name || (currentDetailTaskData ? currentDetailTaskData.assignee_name : null)) : null;

    ensureUserAuthorized(requiredUser, async (authSession) => {
        try {
            const res = await fetch(`/api/tasks/${subtaskId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    due_date_str: cleanDate,
                    pin_code: authSession ? authSession.pin : "",
                    user_name: authSession ? authSession.name : ""
                })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || "Не удалось обновить срок подзадачи");
            }
            showToast("Срок подзадачи обновлен 📅", "success");
            if (currentDetailTaskId) {
                const freshRes = await fetch(`/api/tasks/${currentDetailTaskId}`);
                if (freshRes.ok) {
                    currentDetailTaskData = await freshRes.json();
                    populateTaskDetailModal(currentDetailTaskData);
                }
            }
            if (typeof loadRoadmaps === 'function' && typeof currentHorizon !== 'undefined' && currentHorizon === 'roadmaps') {
                loadRoadmaps();
            } else if (typeof loadTasks === 'function') {
                loadTasks();
            }
        } catch (err) {
            console.error("Error updating subtask date:", err);
            showToast(err.message, "error");
        }
    }, st || currentDetailTaskData, "interact");
}

async function quickToggleSubtaskFromDetail(subtaskId, currentStatus) {
    const subtasks = (currentDetailTaskData && currentDetailTaskData.subtasks) || [];
    const st = subtasks.find(s => s.id === subtaskId);
    if (!canInteractWithTask(st) && !canInteractWithTask(currentDetailTaskData)) {
        showToast("🔒 Отметка выполнения подзадач доступна только исполнителю, автору или руководству", "warning");
        return;
    }

    const isDone = currentStatus && currentStatus.includes("Выполнено");
    const nextStatus = isDone ? "🟡 В работе" : "🟢 Выполнено";
    const requiredUser = st ? (st.assignee_name || st.author_name || (currentDetailTaskData ? currentDetailTaskData.assignee_name : null)) : null;

    ensureUserAuthorized(requiredUser, async (authSession) => {
        try {
            const res = await fetch(`/api/tasks/${subtaskId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    status: nextStatus,
                    comment: isDone ? "Возвращено в работу" : "Выполнено",
                    pin_code: authSession ? authSession.pin : "",
                    user_name: authSession ? authSession.name : ""
                })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || "Не удалось обновить статус подзадачи");
            }
            showToast(isDone ? "Этап возвращен в работу" : "Этап выполнен!", "success");

            // Refresh detail modal
            if (currentDetailTaskId) {
                const freshRes = await fetch(`/api/tasks/${currentDetailTaskId}`);
                if (freshRes.ok) {
                    currentDetailTaskData = await freshRes.json();
                    populateTaskDetailModal(currentDetailTaskData);
                }
            }
            // Refresh background sprint / roadmaps view if active
            if (typeof loadRoadmaps === 'function' && typeof currentHorizon !== 'undefined' && currentHorizon === 'roadmaps') {
                loadRoadmaps();
            } else if (typeof loadTasks === 'function') {
                loadTasks();
            }
        } catch (err) {
            console.error("Error updating subtask status:", err);
            showToast(err.message, "error");
        }
    }, st || currentDetailTaskData, "interact");
}

function switchDetailPhotoTab(tab) {
    currentDetailPhotoTab = (tab === 'after') ? 'after' : 'before';
    const tabBefore = document.getElementById("detail-tab-before");
    const tabAfter = document.getElementById("detail-tab-after");

    if (tabBefore && tabAfter) {
        if (currentDetailPhotoTab === 'after') {
            tabAfter.classList.add("active");
            tabBefore.classList.remove("active");
        } else {
            tabBefore.classList.add("active");
            tabAfter.classList.remove("active");
        }
    }
    renderDetailPhotoGallery();
}

function renderDetailPhotoGallery() {
    const grid = document.getElementById("detail-photos-grid");
    const emptyEl = document.getElementById("detail-photos-empty");
    const emptyText = document.getElementById("detail-photos-empty-text");
    const countBeforeEl = document.getElementById("detail-count-before");
    const countAfterEl = document.getElementById("detail-count-after");
    const uploadBtn = document.getElementById("detail-btn-upload-photos");

    if (!grid || !currentDetailTaskData) return;

    const photos = currentDetailTaskData.photos || { before: [], after: [] };
    const beforeList = photos.before || [];
    const afterList = photos.after || [];

    if (countBeforeEl) countBeforeEl.textContent = beforeList.length;
    if (countAfterEl) countAfterEl.textContent = afterList.length;

    const activeList = (currentDetailPhotoTab === 'after') ? afterList : beforeList;
    const tabName = (currentDetailPhotoTab === 'after') ? 'ПОСЛЕ' : 'ДО';
    const canInteract = canInteractWithTask(currentDetailTaskData);

    if (uploadBtn) {
        uploadBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> + Загрузить фото ${tabName}`;
        uploadBtn.style.display = canInteract ? "inline-flex" : "none";
    }

    if (!activeList.length) {
        grid.innerHTML = "";
        grid.style.display = "none";
        if (emptyEl) emptyEl.style.display = "block";
        if (emptyText) emptyText.textContent = `Нет загруженных фотографий ${tabName} выполнения объекта`;
        return;
    }

    if (emptyEl) emptyEl.style.display = "none";
    grid.style.display = "grid";

    grid.innerHTML = activeList.map((item, idx) => {
        const url = (typeof item === 'object' && item) ? (item.url || "") : String(item);
        const name = (typeof item === 'object' && item) ? (item.name || `Фото ${idx + 1}`) : `Фото ${idx + 1}`;
        const dateStr = (typeof item === 'object' && item) ? (item.uploaded_at || "") : "";
        const authorStr = (typeof item === 'object' && item) ? (item.author || "") : "";
        const caption = dateStr ? `${dateStr}${authorStr ? ' • ' + authorStr : ''}` : name;
        const delBtnHtml = canInteract ? `
            <button type="button" class="gallery-item-del-btn" onclick="deleteDetailPhoto(event, '${url}', '${currentDetailPhotoTab}')" title="Удалить фото">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        ` : '';

        return `
            <div class="gallery-item" onclick="openLightboxGallery('${currentDetailPhotoTab}', ${idx})" title="${escapeHtml(name)} (нажмите для просмотра)">
                <img src="${url}" alt="${escapeHtml(name)}" loading="lazy">
                <div class="gallery-item-badge">${escapeHtml(caption)}</div>
                ${delBtnHtml}
            </div>
        `;
    }).join("");
}

function triggerDetailPhotoUpload() {
    if (!canInteractWithTask(currentDetailTaskData)) {
        if (!currentPlannerUser) {
            openPinModal(null, () => {
                triggerDetailPhotoUpload();
            });
            return;
        }
        showToast("Загрузка фото доступна только исполнителю, автору или руководству завода", "warning");
        return;
    }
    const input = document.getElementById("detail-photo-file-input");
    if (input) input.click();
}

async function handleDetailPhotoUpload(event) {
    const files = event.target.files;
    if (!files || !files.length || !currentDetailTaskId) return;

    if (!canInteractWithTask(currentDetailTaskData)) {
        showToast("Загрузка фото доступна только исполнителю, автору или руководству завода", "warning");
        return;
    }

    const banner = document.getElementById("detail-photo-uploading-banner");
    const uploadBtn = document.getElementById("detail-btn-upload-photos");
    if (banner) banner.style.display = "block";
    if (uploadBtn) uploadBtn.disabled = true;

    try {
        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
            formData.append("files", files[i]);
        }
        formData.append("photo_type", currentDetailPhotoTab);
        if (typeof currentPlannerUser !== 'undefined' && currentPlannerUser && currentPlannerUser.name) {
            formData.append("author_name", currentPlannerUser.name);
            if (currentPlannerUser.pin) {
                formData.append("pin_code", currentPlannerUser.pin);
            }
        }

        const res = await fetch(`/api/tasks/${currentDetailTaskId}/upload_photos`, {
            method: "POST",
            body: formData
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || "Сбой при загрузке фото");
        }

        const data = await res.json();
        if (currentDetailTaskData) {
            currentDetailTaskData.photos = data.photos;
        }

        renderDetailPhotoGallery();
        showToast(`Успешно загружено фото: ${data.added_count || files.length}`, "success");

        // Sync background views
        if (typeof loadTasks === 'function' && currentHorizon !== 'roadmaps') loadTasks();
        if (typeof loadRoadmaps === 'function' && currentHorizon === 'roadmaps') loadRoadmaps();
    } catch (err) {
        console.error("Error uploading photos:", err);
        showToast(err.message || "Ошибка при загрузке фото", "error");
    } finally {
        if (banner) banner.style.display = "none";
        if (uploadBtn) uploadBtn.disabled = false;
        event.target.value = "";
    }
}

async function deleteDetailPhoto(event, photoUrl, photoType) {
    if (event) event.stopPropagation();
    if (!currentDetailTaskId || !photoUrl) return;

    if (!canInteractWithTask(currentDetailTaskData)) {
        showToast("Удалять фото может только исполнитель, автор или руководство завода", "warning");
        return;
    }

    if (!confirm("Вы уверены, что хотите удалить эту фотографию?")) {
        return;
    }

    try {
        const res = await fetch(`/api/tasks/${currentDetailTaskId}/photos`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url: photoUrl,
                photo_type: photoType
            })
        });

        if (!res.ok) throw new Error("Не удалось удалить фотографию");

        const data = await res.json();
        if (currentDetailTaskData) {
            currentDetailTaskData.photos = data.photos;
        }

        renderDetailPhotoGallery();
        showToast("Фотография удалена", "success");

        if (typeof loadTasks === 'function' && currentHorizon !== 'roadmaps') loadTasks();
        if (typeof loadRoadmaps === 'function' && currentHorizon === 'roadmaps') loadRoadmaps();
    } catch (err) {
        console.error("Error deleting photo:", err);
        showToast("Ошибка при удалении фото", "error");
    }
}

function openCompleteTaskModalFromDetail() {
    if (!currentDetailTaskId) return;
    const task = currentDetailTaskData;
    if (!canInteractWithTask(task)) {
        showToast("🔒 Завершение задачи доступно только исполнителю, автору или руководству", "warning");
        return;
    }
    const tid = currentDetailTaskId;
    closeTaskDetailModal();
    if (typeof openCompleteTaskModal === 'function') {
        openCompleteTaskModal(tid);
    }
}

function openRescheduleModalFromDetail() {
    if (!currentDetailTaskId) return;
    const task = currentDetailTaskData;
    if (!canInteractWithTask(task)) {
        showToast("🔒 Перенос срока доступен только исполнителю, автору или руководству", "warning");
        return;
    }
    const tid = currentDetailTaskId;
    closeTaskDetailModal();
    if (typeof openRescheduleTaskModal === 'function') {
        openRescheduleTaskModal(tid);
    }
}

function openEditTaskModalFromDetail() {
    if (!currentDetailTaskId) return;
    const task = currentDetailTaskData;
    if (!canEditProjectOrTask(task)) {
        showToast("🔒 Редактирование паспорта задачи доступно только автору или руководству", "warning");
        return;
    }
    const tid = currentDetailTaskId;
    closeTaskDetailModal();
    if (typeof openEditTaskModal === 'function') {
        openEditTaskModal(tid);
    }
}

function openTaskHistoryModalFromDetail() {
    if (!currentDetailTaskId) return;
    const tid = currentDetailTaskId;
    if (typeof openTaskHistoryModal === 'function') {
        openTaskHistoryModal(tid);
    }
}

function focusDetailNewSubtaskInput() {
    const input = document.getElementById("detail-new-subtask-input");
    if (input) {
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function openAddSubtaskFromDetail() {
    const task = currentDetailTaskData;
    if (!canInteractWithTask(task)) {
        showToast("🔒 Добавление подзадач доступно только исполнителю, автору или руководству", "warning");
        return;
    }
    focusDetailNewSubtaskInput();
}

function handleDetailNewSubtaskKeydown(event) {
    if (event.key === "Enter") {
        event.preventDefault();
        submitDetailNewSubtask();
    }
}

async function submitDetailNewSubtask() {
    if (!currentDetailTaskId) return;
    const task = currentDetailTaskData;
    if (!canInteractWithTask(task)) {
        showToast("🔒 Добавление подзадач доступно только исполнителю, автору или руководству", "warning");
        return;
    }

    const input = document.getElementById("detail-new-subtask-input");
    const title = input ? input.value.trim() : "";
    if (!title) {
        if (input) input.focus();
        return;
    }

    const dateInput = document.getElementById("detail-new-subtask-date");
    const customDate = dateInput ? dateInput.value.trim() : "";
    const effectiveDate = customDate || (task ? (task.due_date_str || "") : "");

    const requiredUser = task ? (task.assignee_name || task.author_name) : null;

    ensureUserAuthorized(requiredUser, async (authSession) => {
        const authorName = (authSession && authSession.name) ? authSession.name : ((currentPlannerUser && currentPlannerUser.name) ? currentPlannerUser.name : (task?.author_name || ""));
        const pin = (authSession && authSession.pin) ? authSession.pin : ((currentPlannerUser && currentPlannerUser.pin) ? currentPlannerUser.pin : "");
        const assigneeName = (task && task.assignee_name) ? task.assignee_name : authorName;

        try {
            const payload = {
                parent_id: currentDetailTaskId,
                title: title,
                assignee_name: assigneeName,
                due_date_str: effectiveDate,
                author_name: authorName,
                pin_code: pin
            };

            const res = await fetch("/api/tasks/quick_milestone", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                if (input) {
                    input.value = "";
                    input.focus();
                }
                if (dateInput) {
                    dateInput.value = "";
                }
                showToast("Подзадача добавлена! 🎯", "success");

                // Refresh task detail modal in-place without closing!
                const freshRes = await fetch(`/api/tasks/${currentDetailTaskId}`);
                if (freshRes.ok) {
                    currentDetailTaskData = await freshRes.json();
                    populateTaskDetailModal(currentDetailTaskData);
                }

                // Also reload background graph or sprint list if active
                if (typeof currentGraphProjectId !== 'undefined' && currentGraphProjectId && typeof reloadProjectGraphData === 'function') {
                    reloadProjectGraphData();
                } else if (typeof loadRoadmaps === 'function' && typeof currentHorizon !== 'undefined' && currentHorizon === 'roadmaps') {
                    loadRoadmaps();
                } else if (typeof loadTasks === 'function') {
                    loadTasks();
                }
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(`⚠️ Ошибка: ${err.detail || 'Не удалось добавить подзадачу'}`);
            }
        } catch (e) {
            console.error("Error submitting detail new subtask:", e);
            showToast("Сетевая ошибка при добавлении подзадачи", "error");
        }
    }, task, "interact");
}

async function deleteTaskFromDetail() {
    if (!currentDetailTaskId) return;
    const tid = currentDetailTaskId;
    const task = currentDetailTaskData || allTasks.find(t => t.id == tid) || null;

    if (!canDeleteProjectOrTask(task)) {
        showToast("🔒 Удаление задач разрешено исключительно руководству завода (Туматов Д., Герлинг С., Булеханов К.) или администратору", "warning");
        return;
    }

    const taskTitle = task ? `[${task.code || ('TSK-' + task.id)}] «${task.title}»` : `TSK-${tid}`;

    ensureUserAuthorized(null, async (authedUser) => {
        if (!confirm(`Вы действительно хотите удалить задачу ${taskTitle}?\n\nДействие подтверждается сотрудником «${authedUser.name}» через PIN-код и будет зафиксировано в истории аудита.`)) {
            return;
        }

        const delBtn = document.getElementById("detail-btn-delete");
        if (delBtn) {
            delBtn.disabled = true;
            delBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        }

        try {
            const userName = authedUser.name || "";
            const pinCode = authedUser.pin || "";
            const res = await fetch(`/api/tasks/${tid}?user_name=${encodeURIComponent(userName)}&pin_code=${encodeURIComponent(pinCode)}`, {
                method: "DELETE"
            });

            if (res.ok) {
                showToast("Задача удалена и зафиксирована в истории", "success");
                closeTaskDetailModal();
                if (typeof currentGraphProjectId !== 'undefined' && currentGraphProjectId && typeof reloadProjectGraphData === 'function') {
                    await reloadProjectGraphData();
                }
                if (currentHorizon === "roadmaps") {
                    await loadRoadmaps();
                } else {
                    await loadTasks();
                }
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(`⚠️ Ошибка: ${err.detail || 'Не удалось удалить задачу'}`, "error");
            }
        } catch (e) {
            console.error("Error deleting task from detail:", e);
            showToast("Сетевая ошибка при удалении задачи", "error");
        } finally {
            if (delBtn) {
                delBtn.disabled = false;
                delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Удалить';
            }
        }
    }, task, "delete_task");
}

/* ==========================================================
   KPI SUMMARY DASHBOARD
   ========================================================== */
function renderKpiSummary(tasks) {
    if (!tasks) tasks = [];
    const total = tasks.length;
    let inWork = 0;
    let done = 0;
    let moved = 0;
    let cancelled = 0;

    tasks.forEach(t => {
        const st = t.status || "";
        if (st.includes("Выполнено")) done++;
        else if (st.includes("Перенесено")) moved++;
        else if (st.includes("Отменено")) cancelled++;
        else inWork++;
    });

    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    const elTotal = document.getElementById("kpi-val-total");
    const elWork = document.getElementById("kpi-val-work");
    const elDone = document.getElementById("kpi-val-done");
    const elPercent = document.getElementById("kpi-val-percent");
    const elMoved = document.getElementById("kpi-val-moved");
    const elCancelled = document.getElementById("kpi-val-cancelled");

    if (elTotal) elTotal.textContent = total;
    if (elWork) elWork.textContent = inWork;
    if (elDone) elDone.textContent = done;
    if (elPercent) elPercent.textContent = `${percent}%`;
    if (elMoved) elMoved.textContent = moved;
    if (elCancelled) elCancelled.textContent = cancelled;
}

/* ==========================================================
   TASK HISTORY & AUDIT LOG MODAL
   ========================================================== */
async function openTaskHistoryModal(taskId) {
    const task = allTasks.find(t => t.id === taskId) || (currentGraphData?.nodes || []).find(n => n.id === taskId) || currentGraphData?.project;
    const modal = document.getElementById("task-history-modal");
    const timelineList = document.getElementById("history-timeline-list");
    const codeEl = document.getElementById("history-task-code");
    const titleEl = document.getElementById("history-task-title");
    const statusBadgeEl = document.getElementById("history-task-status-badge");

    if (!modal) return;

    if (codeEl) codeEl.textContent = task ? (task.code || `TSK-${taskId}`) : `TSK-${taskId}`;
    if (titleEl) titleEl.textContent = task ? (task.title || "—") : "—";
    if (statusBadgeEl) statusBadgeEl.textContent = task ? (task.status || "—") : "—";

    if (timelineList) {
        timelineList.innerHTML = `<div style="text-align: center; color: #94a3b8; padding: 1.5rem 0;"><i class="fa-solid fa-spinner fa-spin"></i> Загрузка истории...</div>`;
    }

    modal.style.display = "flex";
    modal.style.zIndex = "8000";

    try {
        const res = await fetch(`/api/tasks/${taskId}/history`);
        if (res.ok) {
            const data = await res.json();
            if (data.code && codeEl) codeEl.textContent = data.code;
            if (data.title && titleEl) titleEl.textContent = data.title;
            if (data.status && statusBadgeEl) statusBadgeEl.textContent = data.status;
            renderTimelineHistory(data.history || []);
        } else {
            if (timelineList) {
                timelineList.innerHTML = `<div style="color: #ef4444; text-align: center; padding: 1rem;">Не удалось загрузить историю изменений</div>`;
            }
        }
    } catch (e) {
        console.error("Error loading task history:", e);
        if (timelineList) {
            timelineList.innerHTML = `<div style="color: #ef4444; text-align: center; padding: 1rem;">Ошибка сети при получении истории</div>`;
        }
    }
}

function renderTimelineHistory(historyItems) {
    const timelineList = document.getElementById("history-timeline-list");
    if (!timelineList) return;

    if (!historyItems || historyItems.length === 0) {
        timelineList.innerHTML = `<div style="text-align: center; color: #94a3b8; padding: 1.5rem 0;">История изменений пуста</div>`;
        return;
    }

    timelineList.innerHTML = historyItems.map(item => {
        let dotClass = "dot-update";
        let actionBadge = "Обновление";
        let badgeColor = "#475569";
        let badgeBg = "#f1f5f9";

        const act = (item.action || "").toUpperCase();
        const details = item.details || "";

        if (act === "CREATE") {
            dotClass = "dot-create";
            actionBadge = "Создание";
            badgeColor = "#16a34a";
            badgeBg = "#dcfce7";
        } else if (act === "DELETE" || details.includes("удалил") || details.includes("Корзину")) {
            dotClass = "dot-cancel";
            actionBadge = "Удаление (PIN)";
            badgeColor = "#b91c1c";
            badgeBg = "#fee2e2";
        } else if (details.includes("Выполнено")) {
            dotClass = "dot-complete";
            actionBadge = "Выполнено";
            badgeColor = "#15803d";
            badgeBg = "#dcfce7";
        } else if (details.includes("Перенесено") || details.includes("Перенос")) {
            dotClass = "dot-reschedule";
            actionBadge = "Перенос срока";
            badgeColor = "#0369a1";
            badgeBg = "#e0f2fe";
        } else if (details.includes("Отменено")) {
            dotClass = "dot-cancel";
            actionBadge = "Отмена задачи";
            badgeColor = "#b91c1c";
            badgeBg = "#fee2e2";
        } else if (details.includes("В работе")) {
            dotClass = "dot-update";
            actionBadge = "Взято в работу";
            badgeColor = "#b45309";
            badgeBg = "#fef3c7";
        }

        // Очищаем снимок JSON из отображаемого текста истории
        let cleanDetails = details;
        if (cleanDetails.includes(" | Снимок:")) {
            cleanDetails = cleanDetails.split(" | Снимок:")[0];
        }

        return `
            <div class="timeline-item">
                <div class="timeline-dot ${dotClass}"></div>
                <div class="timeline-card">
                    <div class="timeline-header">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 0.72rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: ${badgeBg}; color: ${badgeColor};">${actionBadge}</span>
                            <span class="timeline-user">${escapeHtml(item.user_name || 'Пользователь')}</span>
                        </div>
                        <span class="timeline-date">${item.timestamp || ''}</span>
                    </div>
                    <div class="timeline-body">${escapeHtml(cleanDetails)}</div>
                </div>
            </div>
        `;
    }).join('');
}

function closeTaskHistoryModal() {
    const modal = document.getElementById("task-history-modal");
    if (modal) modal.style.display = "none";
}

/* ==========================================================
   DOCUMENT PICKER (From Knowledge Base)
   ========================================================== */
let allKnowledgeBaseDocs = [];

async function openDocPickerModal() {
    const modal = document.getElementById("doc-picker-modal");
    const container = document.getElementById("doc-picker-list-container");
    const searchInput = document.getElementById("doc-picker-search");
    if (!modal || !container) return;

    if (searchInput) searchInput.value = "";
    container.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: #64748b;">
            <i class="fa-solid fa-spinner fa-spin"></i> Загрузка документов...
        </div>
    `;

    modal.style.display = "flex";

    try {
        let docs = [];
        const res = await fetch("/api/documents/all");
        if (res.ok) {
            docs = await res.json();
        }
        
        // Фоллбэк: если /all вернул пусто, читаем дерево /api/documents/tree
        if (!docs || docs.length === 0) {
            const treeRes = await fetch("/api/documents/tree");
            if (treeRes.ok) {
                const treeData = await treeRes.json();
                const files = (treeData.data && treeData.data.files) ? treeData.data.files : [];
                const foldersMap = {};
                if (treeData.data && treeData.data.folders) {
                    treeData.data.folders.forEach(f => {
                        foldersMap[f.id] = f.name;
                    });
                }
                docs = files.map(f => {
                    let rawId = f.id;
                    if (typeof rawId === 'string' && rawId.startsWith('file_')) {
                        rawId = parseInt(rawId.replace('file_', ''), 10);
                    }
                    return {
                        id: rawId,
                        title: f.name,
                        category_name: foldersMap[f.parent_id] || "Главная директория",
                        mime_type: f.mimeType,
                        link: f.webViewLink || f.external_url || `/api/documents/download/${rawId}`
                    };
                });
            }
        }

        allKnowledgeBaseDocs = docs;
        renderDocPickerList(allKnowledgeBaseDocs);
    } catch (e) {
        console.error("Error loading knowledge docs:", e);
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: #ef4444;">
                Ошибка подключения к Базе Знаний
            </div>
        `;
    }
}

function closeDocPickerModal() {
    const modal = document.getElementById("doc-picker-modal");
    if (modal) modal.style.display = "none";
}

function filterDocPickerList(query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) {
        renderDocPickerList(allKnowledgeBaseDocs);
        return;
    }
    const filtered = allKnowledgeBaseDocs.filter(d => 
        (d.title && d.title.toLowerCase().includes(q)) ||
        (d.category_name && d.category_name.toLowerCase().includes(q))
    );
    renderDocPickerList(filtered);
}

function renderDocPickerList(docs) {
    const container = document.getElementById("doc-picker-list-container");
    if (!container) return;

    if (!docs || docs.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: #94a3b8;">
                Документы не найдены
            </div>
        `;
        return;
    }

    container.innerHTML = docs.map(d => {
        let iconClass = "fa-file-lines";
        let iconColor = "#2563eb";
        const m = (d.mime_type || '').toLowerCase();
        const t = (d.title || '').toLowerCase();
        const l = (d.link || '').toLowerCase();

        if (m.includes('folder') || l.includes('folders') || t.includes('– google диск') || t.includes('— google диск') || t.includes('- google диск')) {
            iconClass = "fa-folder";
            iconColor = "#3b82f6";
        } else if (d.doc_type === 'pdf' || m.includes('pdf') || t.match(/\.pdf$/i)) {
            iconClass = "fa-file-pdf";
            iconColor = "#ef4444";
        } else if (d.doc_type === 'excel' || m.includes('spreadsheet') || l.includes('spreadsheets') || t.match(/\.(xlsx|xls|csv)$/i) || (!t.includes('.') && t.includes('таблиц'))) {
            iconClass = "fa-file-excel";
            iconColor = "#10b981";
        } else if (m.includes('presentation') || l.includes('presentation') || t.match(/\.(pptx|ppt)$/i) || (!t.includes('.') && t.includes('презентац'))) {
            iconClass = "fa-file-powerpoint";
            iconColor = "#f97316";
        } else if (d.doc_type === 'word' || m.includes('word') || m.includes('document') || l.includes('docs.google.com/document') || t.match(/\.(docx|doc)$/i)) {
            iconClass = "fa-file-word";
            iconColor = "#2563eb";
        } else if (d.doc_type === 'google' || l.includes('google')) {
            iconClass = "fa-brands fa-google";
            iconColor = "#1a73e8";
        } else if (d.doc_type === 'microsoft' || l.includes('1drv.ms') || l.includes('onedrive') || l.includes('sharepoint')) {
            iconClass = "fa-brands fa-microsoft";
            iconColor = "#0078d4";
        }

        return `
            <div onclick="selectDocAttachment(${d.id}, '${escapeHtml(d.title)}')" style="display: flex; align-items: center; justify-content: space-between; padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--tbl-border-subtle); cursor: pointer; transition: background 0.15s ease;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='#ffffff'">
                <div style="display: flex; align-items: center; gap: 0.65rem; overflow: hidden; flex: 1;">
                    <i class="${d.doc_type && d.doc_type.startsWith('fa-') ? d.doc_type : 'fa-solid ' + iconClass}" style="color: ${iconColor}; font-size: 1.1rem; width: 20px; text-align: center;"></i>
                    <div style="overflow: hidden;">
                        <div style="font-weight: 600; font-size: 0.88rem; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(d.title)}</div>
                        <div style="font-size: 0.75rem; color: #64748b;">${escapeHtml(d.category_name || 'База Знаний')} • ${d.uploaded_at ? d.uploaded_at.split(' ')[0] : ''}</div>
                    </div>
                </div>
                <button type="button" class="btn-action" style="padding: 3px 8px; font-size: 0.75rem; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;">
                    Выбрать
                </button>
            </div>
        `;
    }).join('');
}

function selectDocAttachment(docId, docTitle) {
    setSelectedDocAttachment(docId, docTitle);
    closeDocPickerModal();
    showToast("Документ прикреплен 📎");
}

function setSelectedDocAttachment(docId, docTitle) {
    const idInput = document.getElementById("task-doc-id-input");
    const nameDisplay = document.getElementById("task-doc-name-display");
    const box = document.getElementById("task-doc-selected-box");

    if (idInput) idInput.value = docId || "";
    if (nameDisplay) nameDisplay.textContent = docTitle || "";
    if (box) box.style.display = docId ? "flex" : "none";
}

function clearSelectedDocAttachment() {
    setSelectedDocAttachment(null, "");
}

/* ==========================================================
   INTERACTIVE PROJECT DEPENDENCY GRAPH (FULLSCREEN DAG)
   ========================================================== */

let currentGraphProjectId = null;
let currentGraphData = null;
let graphZoomScale = 1.0;
let graphPanX = 60;
let graphPanY = 60;
let isGraphPanning = false;
let graphPanStartX = 0;
let graphPanStartY = 0;
let selectedGraphNodeId = null;
let hideCompletedNodesOnGraph = false;
let graphListenersBound = false;

async function openProjectGraphModal(projectId) {
    if (!projectId) return;
    currentGraphProjectId = projectId;
    isModalOpen = true;

    const modal = document.getElementById("project-graph-modal");
    if (!modal) return;
    modal.style.display = "flex";

    const titleEl = document.getElementById("graph-project-title");
    const codeEl = document.getElementById("graph-project-code");
    const subEl = document.getElementById("graph-project-subtitle");
    const progBar = document.getElementById("graph-project-progress-bar");
    const progVal = document.getElementById("graph-project-progress-val");
    const container = document.getElementById("graph-nodes-container");
    const svgGroup = document.getElementById("graph-edges-group");

    if (titleEl) titleEl.textContent = "Загрузка интерактивной схемы...";
    if (codeEl) codeEl.textContent = `TSK-${projectId}`;
    if (subEl) subEl.textContent = "";
    if (container) container.innerHTML = `<div style="padding: 4rem; text-align: center; color: #64748b; font-size: 0.95rem;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color: #6366f1; margin-bottom: 12px; display: block;"></i> Построение графа зависимостей проекта...</div>`;
    if (svgGroup) svgGroup.innerHTML = "";

    initGraphPanZoomListeners();

    try {
        const res = await fetch(`/api/tasks/${projectId}/graph`);
        if (!res.ok) throw new Error("Не удалось загрузить граф проекта");

        currentGraphData = await res.json();
        const p = currentGraphData.project || {};
        const summary = currentGraphData.summary || {};

        if (titleEl) titleEl.textContent = p.title || "Интерактивная схема проекта";
        if (codeEl) codeEl.textContent = p.code || `TSK-${projectId}`;
        if (subEl) {
            const subtitleParts = [];
            if (p.department_service) subtitleParts.push(`Служба: ${p.department_service}`);
            if (p.target_quarter) subtitleParts.push(`Период: ${p.target_quarter}`);
            subtitleParts.push(`Этапов: ${summary.done_milestones || 0}/${summary.total_milestones || 0}`);
            if (summary.blocked_count > 0) subtitleParts.push(`🔒 Заблокировано: ${summary.blocked_count}`);
            subEl.textContent = subtitleParts.join(" • ");
        }

        const prog = summary.overall_progress || p.progress || 0;
        if (progBar) progBar.style.width = `${prog}%`;
        if (progVal) progVal.textContent = `${prog}%`;

        const canEditGraph = canEditProjectOrTask(p);
        const addStageBtn = document.getElementById("graph-btn-add-stage");
        if (addStageBtn) {
            addStageBtn.style.display = canEditGraph ? "inline-flex" : "none";
        }

        renderProjectGraph(currentGraphData);
        
        try {
            // Auto-select first active or available node to populate inspector immediately
            const nodes = currentGraphData.nodes || [];
            if (nodes.length > 0) {
                const activeNode = nodes.find(n => !n.is_done) || nodes[0];
                selectGraphNode(activeNode.id);
            } else {
                showGraphInspectorEmpty();
            }
        } catch (selErr) {
            console.warn("Could not auto-select node in inspector:", selErr);
        }

        setTimeout(() => {
            fitProjectGraphToScreen();
        }, 80);
    } catch (err) {
        console.error("Error opening project graph:", err);
        if (container) container.innerHTML = `<div style="padding: 3rem; text-align: center; color: #ef4444;"><i class="fa-solid fa-triangle-exclamation fa-2x" style="margin-bottom: 8px;"></i><br>${escapeHtml(err.message || 'Ошибка загрузки графа')}</div>`;
    }
}

function closeProjectGraphModal() {
    const modal = document.getElementById("project-graph-modal");
    if (modal) {
        modal.style.display = "none";
        modal.classList.remove("has-fullscreen");
    }
    const box = document.querySelector("#project-graph-modal .graph-modal-box");
    if (box) box.classList.remove("is-fullscreen");
    const icon = document.getElementById("graph-fullscreen-icon");
    if (icon) icon.className = "fa-solid fa-expand";
    isModalOpen = false;
    currentGraphProjectId = null;
    currentGraphData = null;
    closeGraphInspector();
}

function toggleGraphModalFullscreen() {
    const modal = document.getElementById("project-graph-modal");
    const box = document.querySelector("#project-graph-modal .graph-modal-box");
    const icon = document.getElementById("graph-fullscreen-icon");
    if (!box) return;
    box.classList.toggle("is-fullscreen");
    const isFull = box.classList.contains("is-fullscreen");
    if (modal) {
        modal.classList.toggle("has-fullscreen", isFull);
    }
    if (icon) {
        icon.className = isFull ? "fa-solid fa-compress" : "fa-solid fa-expand";
    }
    setTimeout(() => {
        fitProjectGraphToScreen();
    }, 120);
}

function initGraphPanZoomListeners() {
    if (graphListenersBound) return;
    const viewport = document.getElementById("graph-viewport");
    if (!viewport) return;

    viewport.addEventListener("mousedown", (e) => {
        // Only start pan if clicking directly on viewport or surface, not on interactive nodes or buttons
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || e.target.closest('textarea') || e.target.closest('a') || e.target.closest('.btn-action') || e.target.closest('.graph-node') || e.target.closest('.graph-inspector') || e.target.closest('.graph-tool-btn') || e.target.closest('.graph-minimap-wrap') || e.target.closest('.graph-empty-state-card')) {
            return;
        }
        isGraphPanning = true;
        graphPanStartX = e.clientX - graphPanX;
        graphPanStartY = e.clientY - graphPanY;
        viewport.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", (e) => {
        if (!isGraphPanning) return;
        graphPanX = e.clientX - graphPanStartX;
        graphPanY = e.clientY - graphPanStartY;
        applyGraphTransform();
    });

    window.addEventListener("mouseup", () => {
        if (isGraphPanning) {
            isGraphPanning = false;
            if (viewport) viewport.style.cursor = "grab";
        }
    });

    // Touch support for tablets / touchscreens
    let touchStartX = 0;
    let touchStartY = 0;
    viewport.addEventListener("touchstart", (e) => {
        if (e.touches.length === 1) {
            if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || e.target.closest('textarea') || e.target.closest('a') || e.target.closest('.btn-action') || e.target.closest('.graph-node') || e.target.closest('.graph-inspector') || e.target.closest('.graph-tool-btn') || e.target.closest('.graph-minimap-wrap') || e.target.closest('.graph-empty-state-card')) return;
            isGraphPanning = true;
            touchStartX = e.touches[0].clientX - graphPanX;
            touchStartY = e.touches[0].clientY - graphPanY;
        }
    }, { passive: true });

    viewport.addEventListener("touchmove", (e) => {
        if (isGraphPanning && e.touches.length === 1) {
            graphPanX = e.touches[0].clientX - touchStartX;
            graphPanY = e.touches[0].clientY - touchStartY;
            applyGraphTransform();
        }
    }, { passive: true });

    viewport.addEventListener("touchend", () => {
        isGraphPanning = false;
    });

    viewport.addEventListener("wheel", handleGraphWheel, { passive: false });

    graphListenersBound = true;
}

function handleGraphWheel(event) {
    if (!event) return;
    // Don't intercept wheel if scrolling inside inspector drawer or dropdowns
    if (event.target && event.target.closest && event.target.closest('.graph-inspector')) {
        return;
    }
    event.preventDefault();

    const viewport = document.getElementById("graph-viewport");
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const prevScale = graphZoomScale;
    const factor = event.deltaY < 0 ? 1.12 : 0.88;
    const newScale = Math.max(0.3, Math.min(2.5, prevScale * factor));
    if (Math.abs(newScale - prevScale) < 0.001) return;

    // Zoom centered on cursor position
    const contentX = (mouseX - graphPanX) / prevScale;
    const contentY = (mouseY - graphPanY) / prevScale;

    graphZoomScale = newScale;
    graphPanX = mouseX - contentX * newScale;
    graphPanY = mouseY - contentY * newScale;

    applyGraphTransform();
}

function zoomProjectGraph(delta) {
    const prevScale = graphZoomScale;
    graphZoomScale = Math.max(0.3, Math.min(2.5, graphZoomScale + delta));
    // Zoom towards center
    const viewport = document.getElementById("graph-viewport");
    if (viewport) {
        const vw = viewport.clientWidth / 2;
        const vh = viewport.clientHeight / 2;
        graphPanX = vw - (vw - graphPanX) * (graphZoomScale / prevScale);
        graphPanY = vh - (vh - graphPanY) * (graphZoomScale / prevScale);
    }
    applyGraphTransform();
}

function resetProjectGraphZoom() {
    graphZoomScale = 1.0;
    const viewport = document.getElementById("graph-viewport");
    if (viewport && (!currentGraphData || !currentGraphData.nodes || !currentGraphData.nodes.length)) {
        const vpW = viewport.clientWidth || 800;
        const vpH = viewport.clientHeight || 500;
        // Center empty state card (width 440, positioned at left 80, top 80)
        graphPanX = Math.round(Math.max(20, (vpW - 440) / 2 - 80));
        graphPanY = Math.round(Math.max(20, (vpH - 220) / 2 - 80));
    } else {
        graphPanX = 60;
        graphPanY = 60;
    }
    applyGraphTransform();
}

function fitProjectGraphToScreen() {
    const viewport = document.getElementById("graph-viewport");
    if (!viewport || !currentGraphData || !currentGraphData.nodes || !currentGraphData.nodes.length) {
        resetProjectGraphZoom();
        return;
    }

    const nodes = currentGraphData.nodes;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    nodes.forEach(n => {
        if (n._renderedX !== undefined) {
            minX = Math.min(minX, n._renderedX);
            minY = Math.min(minY, n._renderedY);
            maxX = Math.max(maxX, n._renderedX + 280);
            maxY = Math.max(maxY, n._renderedY + 180);
        }
    });

    if (minX === Infinity) {
        resetProjectGraphZoom();
        return;
    }

    const contentW = (maxX - minX) + 120;
    const contentH = (maxY - minY) + 120;
    const vpW = viewport.clientWidth;
    const vpH = viewport.clientHeight;

    const scaleX = vpW / contentW;
    const scaleY = vpH / contentH;
    let idealScale = Math.min(scaleX, scaleY, 1.1);
    idealScale = Math.max(0.45, Math.min(1.2, idealScale));

    graphZoomScale = idealScale;
    graphPanX = (vpW - (contentW * graphZoomScale)) / 2 - (minX * graphZoomScale) + (60 * graphZoomScale);
    graphPanY = (vpH - (contentH * graphZoomScale)) / 2 - (minY * graphZoomScale) + (60 * graphZoomScale);

    applyGraphTransform();
}

function applyGraphTransform() {
    const surface = document.getElementById("graph-surface");
    const zoomLabel = document.getElementById("graph-zoom-label");
    if (surface) {
        surface.style.transform = `translate(${graphPanX}px, ${graphPanY}px) scale(${graphZoomScale})`;
    }
    if (zoomLabel) {
        zoomLabel.textContent = `${Math.round(graphZoomScale * 100)}%`;
    }
    renderGraphMinimap();
}

function renderProjectGraph(data) {
    const container = document.getElementById("graph-nodes-container");
    const svgGroup = document.getElementById("graph-edges-group");
    if (!container || !svgGroup || !data) return;

    container.innerHTML = "";
    svgGroup.innerHTML = "";

    const nodes = data.nodes || [];
    const edges = data.edges || [];

    if (!nodes.length) {
        container.innerHTML = `
            <div class="graph-empty-state-card" style="position: absolute; top: 80px; left: 80px; background: #ffffff; padding: 2rem; border-radius: 12px; border: 1px dashed #cbd5e1; text-align: center; max-width: 440px; cursor: default; user-select: none; pointer-events: auto; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.05);" onmousedown="event.stopPropagation()">
                <div style="font-size: 2rem; margin-bottom: 6px;">🗺️</div>
                <h4 style="margin: 0 0 6px; color: #0f172a;">В проекте пока нет этапов</h4>
                <p style="font-size: 0.82rem; color: #64748b; margin-bottom: 12px;">Добавьте этапы и настройте блокирующие зависимости, чтобы увидеть интерактивную схему.</p>
                <button type="button" class="btn-action btn-primary-action graph-tool-btn" onclick="event.stopPropagation(); openGraphAddStageModal()" onmousedown="event.stopPropagation()" style="cursor: pointer; pointer-events: auto; display: inline-flex; align-items: center; gap: 6px; margin: 0 auto;">
                    <i class="fa-solid fa-plus"></i> Добавить первый этап
                </button>
            </div>
        `;
        renderGraphMinimap();
        return;
    }

    const colWidth = 360;
    const colStartX = 80;
    const rowGap = 210;
    const rowStartY = 80;

    // Filter nodes if hideCompletedNodesOnGraph is on
    const visibleNodes = hideCompletedNodesOnGraph ? nodes.filter(n => !n.is_done) : nodes;
    const nodeCoordMap = new Map();

    // 1. Render DOM Nodes
    visibleNodes.forEach(n => {
        const x = colStartX + ((n.col || 0) * colWidth);
        const y = rowStartY + ((n.row || 0) * rowGap);
        n._renderedX = x;
        n._renderedY = y;
        nodeCoordMap.set(n.id, { x, y, width: 280, height: 160, node: n });

        const isDone = n.is_done;
        const isBlocked = n.is_blocked;
        let statusCls = "status-work";
        let statusBadge = `<span class="badge-zone" style="background: #eff6ff; color: #1d4ed8; font-size: 0.72rem;">🟡 В работе</span>`;

        if (isDone) {
            statusCls = "status-done";
            statusBadge = `<span class="badge-zone" style="background: #f0fdf4; color: #166534; border-color: #bbf7d0; font-size: 0.72rem;">🟢 Выполнено</span>`;
        } else if (isBlocked) {
            statusCls = "status-blocked";
            const unfinCount = (n.blockers || []).filter(b => !b.is_done).length;
            const blockLabel = unfinCount > 1 ? `<i class="fa-solid fa-lock"></i> Блокеры (${unfinCount})` : `<i class="fa-solid fa-lock"></i> Заблокировано`;
            statusBadge = `<span class="badge-zone" style="background: #fef2f2; color: #991b1b; border-color: #fecaca; font-size: 0.72rem;">${blockLabel}</span>`;
        }

        const prog = n.progress || 0;
        const subtasks = n.subtasks || [];
        const subPreviewHtml = subtasks.slice(0, 3).map(st => {
            const isStDone = st.is_done;
            return `
                <div class="graph-subtask-mini" title="${escapeHtml(st.title)}">
                    <i class="fa-solid ${isStDone ? 'fa-circle-check' : 'fa-circle'}" style="color: ${isStDone ? '#10b981' : '#94a3b8'}; font-size: 0.65rem;"></i>
                    <span style="text-decoration: ${isStDone ? 'line-through' : 'none'}; opacity: ${isStDone ? '0.7' : '1'};">${escapeHtml(st.title)}</span>
                </div>
            `;
        }).join('');

        const subCountLabel = subtasks.length > 0 ? `(${n.subtasks_done_count || 0}/${subtasks.length})` : '';

        const nodeEl = document.createElement("div");
        nodeEl.className = `graph-node ${statusCls}`;
        nodeEl.id = `graph-node-${n.id}`;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;
        nodeEl.onclick = (e) => {
            e.stopPropagation();
            selectGraphNode(n.id);
        };
        nodeEl.ondblclick = (e) => {
            e.stopPropagation();
            openTaskDetailModal(n.id);
        };

        nodeEl.innerHTML = `
            <div class="graph-node-header">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span class="badge-code" style="font-size: 11px; font-family: monospace; font-weight: 700;">${n.code || 'TSK-' + n.id}</span>
                    ${statusBadge}
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <button type="button" class="btn-icon-cell" onclick="event.stopPropagation(); selectGraphNode(${n.id})" title="Управление этапом (Инспектор)" style="font-size: 0.72rem; padding: 2px 5px; color: #4338ca;">
                        <i class="fa-solid fa-sliders"></i>
                    </button>
                    <button type="button" class="btn-icon-cell" onclick="event.stopPropagation(); openTaskDetailModal(${n.id})" title="Паспорт задачи" style="font-size: 0.72rem; padding: 2px 5px;">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    </button>
                </div>
            </div>

            <div class="graph-node-title" title="${escapeHtml(n.title)}">${escapeHtml(n.title)}</div>

            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem; color: #64748b; margin-bottom: 4px;">
                <span>👤 ${escapeHtml(n.assignee_name || '—')}</span>
                <span style="font-weight: 700; color: ${prog === 100 ? '#10b981' : '#2563eb'};">${prog}%</span>
            </div>

            <div class="roadmap-progress-wrap" style="height: 5px; margin-bottom: 4px;">
                <div class="roadmap-progress-bar" style="width: ${prog}%; ${prog === 100 ? 'background: #10b981;' : ''}"></div>
            </div>

            ${subPreviewHtml ? `<div class="graph-subtasks-preview"><div style="font-size: 0.7rem; font-weight: 700; color: #64748b;">Подзадачи ${subCountLabel}:</div>${subPreviewHtml}</div>` : ''}
        `;

        container.appendChild(nodeEl);
    });

    // 2. Render SVG Bezier Edges with smart offset for multiple incoming connections (Merge Nodes)
    const incomingByTarget = new Map();
    edges.forEach(e => {
        const list = incomingByTarget.get(e.to_id) || [];
        list.push(e);
        incomingByTarget.set(e.to_id, list);
    });

    edges.forEach((edge, edgeIdx) => {
        const fromCoord = nodeCoordMap.get(edge.from_id);
        const toCoord = nodeCoordMap.get(edge.to_id);
        if (!fromCoord || !toCoord) return;

        const incomingList = incomingByTarget.get(edge.to_id) || [];
        const inCount = incomingList.length;
        const inIdx = incomingList.indexOf(edge);

        // Smart spread of entry arrows across card height if node has multiple predecessors
        let targetYOffset = 44;
        if (inCount > 1) {
            targetYOffset = Math.round(28 + (inIdx * (36 / (inCount - 1))));
        }

        const x1 = fromCoord.x + 280;
        const y1 = fromCoord.y + 44;
        const x2 = toCoord.x;
        const y2 = toCoord.y + targetYOffset;

        const dx = Math.max(50, Math.abs(x2 - x1) * 0.5);
        const pathData = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

        let edgeClass = "work";
        let markerUrl = "url(#arrow-work)";
        if (edge.is_completed) {
            edgeClass = "done";
            markerUrl = "url(#arrow-done)";
        } else if (edge.is_blocked) {
            edgeClass = "blocked";
            markerUrl = "url(#arrow-blocked)";
        }

        const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
        pathEl.setAttribute("d", pathData);
        pathEl.setAttribute("class", `graph-edge-path ${edgeClass}`);
        pathEl.setAttribute("marker-end", markerUrl);
        pathEl.setAttribute("id", `graph-edge-${edge.from_id}-${edge.to_id}`);
        svgGroup.appendChild(pathEl);
    });

    renderGraphMinimap();
}

function selectGraphNode(nodeId) {
    if (!currentGraphData || !currentGraphData.nodes) return;
    selectedGraphNodeId = nodeId;

    // Highlight node in DOM
    document.querySelectorAll(".graph-node").forEach(el => el.classList.remove("selected"));
    const activeEl = document.getElementById(`graph-node-${nodeId}`);
    if (activeEl) activeEl.classList.add("selected");

    const node = currentGraphData.nodes.find(n => n.id === nodeId);
    const inspector = document.getElementById("graph-inspector");
    if (!node || !inspector) return;

    // Immediately open inspector and show content container
    inspector.style.display = "block";
    const emptyState = document.getElementById("inspector-empty-state");
    const contentWrap = document.getElementById("inspector-content-wrap");
    if (emptyState) emptyState.style.display = "none";
    if (contentWrap) contentWrap.style.display = "block";

    // Populate Inspector Fields
    const codeEl = document.getElementById("inspector-node-code");
    const statusSelect = document.getElementById("inspector-edit-status");
    const titleEl = document.getElementById("inspector-node-title");
    const titleKzEl = document.getElementById("inspector-node-title-kz");
    const assigneeEl = document.getElementById("inspector-node-assignee");
    const dueDateEl = document.getElementById("inspector-node-due-date");
    const dependsSelect = document.getElementById("inspector-edit-depends");
    const progEl = document.getElementById("inspector-node-progress");
    const blockerAlert = document.getElementById("inspector-blocker-alert");
    const blockerName = document.getElementById("inspector-blocker-name");
    const subCountEl = document.getElementById("inspector-subtasks-count");
    const subListEl = document.getElementById("inspector-subtasks-list");
    const newSubInput = document.getElementById("inspector-new-subtask-input");
    const detailBtn = document.getElementById("inspector-btn-open-detail");

    if (codeEl) codeEl.textContent = node.code || `TSK-${node.id}`;
    const statusBadge = document.getElementById("inspector-node-status-badge");
    const isDone = node.is_done || (node.status && node.status.includes("Выполнено"));
    const statusText = isDone ? "🟢 Выполнено" : (node.status || "🟡 В работе");
    if (statusBadge) {
        statusBadge.textContent = statusText;
        if (isDone) {
            statusBadge.style.background = "#dcfce7";
            statusBadge.style.color = "#15803d";
            statusBadge.style.border = "1px solid #bbf7d0";
        } else if (statusText.includes("Отменено")) {
            statusBadge.style.background = "#fee2e2";
            statusBadge.style.color = "#dc2626";
            statusBadge.style.border = "1px solid #fecaca";
        } else {
            statusBadge.style.background = "#fef3c7";
            statusBadge.style.color = "#b45309";
            statusBadge.style.border = "1px solid #fde68a";
        }
    }
    if (statusSelect) {
        statusSelect.value = statusText;
    }
    if (titleEl) {
        titleEl.textContent = node.title || "Без названия";
    }
    if (titleKzEl) {
        titleKzEl.style.display = "none";
    }
    updateInspectorAssigneeDisplay(node.assignee_name || node.assignee || "");
    if (dueDateEl) {
        dueDateEl.textContent = node.due_date_str || "Не указан";
    }

    // Clean Informational Predecessors List with Click-to-Focus on Graph (HUD Standard)
    const currentDepIds = (node.depends_on_ids && node.depends_on_ids.length > 0)
        ? node.depends_on_ids 
        : (node.depends_on_id ? [node.depends_on_id] : []);

    const inspectorBlockersContainer = document.getElementById("inspector-blockers-picker-container") || document.getElementById("inspector-depends-list");
    if (inspectorBlockersContainer) {
        const otherNodes = (currentGraphData?.nodes || []).filter(n => n.id !== nodeId);
        const depNodes = otherNodes.filter(n => currentDepIds.includes(n.id));
        
        let blockersHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                <span style="font-size: 0.72rem; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.3px;">
                    <i class="fa-solid fa-link" style="color: #6366f1; margin-right: 3px;"></i> Связи и предшественники:
                </span>
                <span style="font-size: 0.70rem; color: #64748b; font-weight: 600;">${depNodes.length}</span>
            </div>
        `;
        if (depNodes.length === 0) {
            blockersHtml += `
                <div style="font-size: 0.74rem; color: #94a3b8; font-style: italic; padding: 6px 8px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px;">
                    Нет предшественников (этап выполняется сразу)
                </div>
            `;
        } else {
            blockersHtml += `<div style="display: flex; flex-direction: column; gap: 4px; max-height: 140px; overflow-y: auto;">`;
            depNodes.forEach(dn => {
                const isDnDone = dn.is_done || (dn.status && dn.status.includes("Выполнено"));
                const badgeBg = isDnDone ? '#dcfce7' : '#fef3c7';
                const badgeColor = isDnDone ? '#15803d' : '#b45309';
                const badgeText = isDnDone ? '✓ Выполнен' : '🔒 Блокирует';
                blockersHtml += `
                    <div onclick="selectGraphNode(${dn.id})" style="display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 5px 8px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; cursor: pointer; transition: all 0.15s ease;" onmouseover="this.style.borderColor='#6366f1'; this.style.background='#f5f3ff';" onmouseout="this.style.borderColor='#e2e8f0'; this.style.background='#ffffff';" title="Нажмите для перехода к этапу ${dn.code || dn.id}">
                        <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; flex: 1;">
                            <span style="font-family: monospace; font-size: 0.68rem; font-weight: 700; color: #4338ca; background: #eef2ff; padding: 1px 4px; border-radius: 4px; flex-shrink: 0;">${dn.code || `TSK-${dn.id}`}</span>
                            <span style="font-size: 0.75rem; color: #1e293b; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(dn.title)}</span>
                        </div>
                        <span style="font-size: 0.65rem; font-weight: 700; background: ${badgeBg}; color: ${badgeColor}; padding: 1px 6px; border-radius: 4px; flex-shrink: 0;">${badgeText}</span>
                    </div>
                `;
            });
            blockersHtml += `</div>`;
        }
        inspectorBlockersContainer.innerHTML = blockersHtml;
    }

    const progVal = node.progress || 0;
    if (progEl) {
        progEl.textContent = `${progVal}%`;
    }
    const progBarEl = document.getElementById("inspector-node-progress-bar");
    if (progBarEl) {
        progBarEl.style.width = `${progVal}%`;
        progBarEl.style.background = progVal === 100 ? '#10b981' : '#2563eb';
    }

    // Blocker info with multi-blockers support
    if (blockerAlert) {
        if (node.is_blocked) {
            blockerAlert.style.display = "block";
            const unfinBlockers = (node.blockers || []).filter(b => !b.is_done);
            if (unfinBlockers.length > 1) {
                const names = unfinBlockers.map(b => `[${b.code}] «${b.title}»`).join(", ");
                if (blockerName) blockerName.textContent = `(ждут ${unfinBlockers.length} задачи): ${names}`;
            } else if (unfinBlockers.length === 1) {
                if (blockerName) blockerName.textContent = `[${unfinBlockers[0].code}] «${unfinBlockers[0].title}»`;
            } else if (node.blocked_by) {
                if (blockerName) blockerName.textContent = `[${node.blocked_by.code}] «${node.blocked_by.title}»`;
            } else {
                if (blockerName) blockerName.textContent = "предшествующих этапов";
            }
        } else {
            blockerAlert.style.display = "none";
        }
    }

    // Subtasks Checklist
    const subs = node.subtasks || [];
    const canInteractNode = canInteractWithTask(node);
    const canDeleteNode = canDeleteProjectOrTask(node);

    const inspectorDelBtn = document.getElementById("inspector-delete-btn");
    if (inspectorDelBtn) {
        inspectorDelBtn.style.display = canDeleteNode ? "inline-flex" : "none";
    }

    if (subCountEl) {
        subCountEl.textContent = `${node.subtasks_done_count || 0}/${subs.length}`;
    }
    if (subListEl) {
        if (!subs.length) {
            subListEl.innerHTML = `<div style="font-size: 0.74rem; color: #94a3b8; font-style: italic; padding: 4px 0;">Подзадачи этапа пока не добавлены</div>`;
        } else {
            subListEl.innerHTML = subs.map(st => {
                const isStDone = st.is_done;
                const checkBtnHtml = canInteractNode ? `
                    <button type="button" class="roadmap-check-btn ${isStDone ? 'checked' : ''}" onclick="toggleInspectorSubtask(${st.id}, '${st.status || ''}', event)" style="width: 16px; height: 16px; font-size: 0.55rem; flex-shrink: 0;" title="${isStDone ? 'Снять выполнение' : 'Выполнено'}">
                        <i class="fa-solid fa-check"></i>
                    </button>
                ` : `
                    <button type="button" class="roadmap-check-btn ${isStDone ? 'checked' : ''}" disabled="disabled" style="width: 16px; height: 16px; font-size: 0.55rem; flex-shrink: 0; cursor: default; opacity: 0.65; pointer-events: none;" title="${isStDone ? 'Выполнено' : 'В работе'}">
                        <i class="fa-solid fa-check"></i>
                    </button>
                `;
                const delSubHtml = canDeleteNode ? `
                    <button type="button" class="btn-icon-cell" onclick="deleteInspectorSubtask(${st.id}, event)" style="font-size: 0.68rem; color: #94a3b8; padding: 2px 4px;" title="Удалить подзадачу">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                ` : '';

                const stDateBadge = st.due_date_str ? `<span style="font-size: 0.65rem; color: #1e40af; background: #eff6ff; border: 1px solid #bfdbfe; padding: 1px 4px; border-radius: 3px; font-weight: 600; white-space: nowrap;">📅 ${escapeHtml(st.due_date_str)}</span>` : '';

                return `
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 6px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">
                        <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; flex: 1;">
                            ${checkBtnHtml}
                            <span style="font-size: 0.76rem; color: #1e293b; text-decoration: ${isStDone ? 'line-through' : 'none'}; opacity: ${isStDone ? '0.65' : '1'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(st.title)}">${escapeHtml(st.title)}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                            ${stDateBadge}
                            ${delSubHtml}
                        </div>
                    </div>
                `;
            }).join('');
        }
    }
    if (newSubInput) {
        newSubInput.value = "";
    }

    if (detailBtn) {
        detailBtn.onclick = () => {
            openTaskDetailModal(node.id);
        };
    }
}

async function saveInspectorDependencies(nodeId, newDepIds) {
    if (!nodeId) return;
    try {
        const res = await fetch(`/api/tasks/${nodeId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                depends_on_ids: newDepIds,
                depends_on_id: newDepIds.length > 0 ? newDepIds[0] : null
            })
        });
        if (res.ok) {
            showToast("Связи этапа обновлены! 🔗", "success");
            await reloadProjectGraphData();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(`⚠️ ${err.detail || 'Ошибка сохранения связи'}`);
        }
    } catch (e) {
        console.error("Error updating stage dependencies:", e);
        showToast("Ошибка сохранения связи", "error");
    }
}

async function toggleInspectorDependency(depId, isChecked) {
    if (!selectedGraphNodeId) return;
    const node = (currentGraphData?.nodes || []).find(n => n.id === selectedGraphNodeId);
    if (!node) return;

    let currentDepIds = [...(node.depends_on_ids || (node.depends_on_id ? [node.depends_on_id] : []))];
    if (isChecked) {
        if (!currentDepIds.includes(depId)) {
            currentDepIds.push(depId);
        }
    } else {
        currentDepIds = currentDepIds.filter(id => id !== depId);
    }
    await saveInspectorDependencies(selectedGraphNodeId, currentDepIds);
}

async function autoSaveInspectorDepends(depIdVal) {
    if (!selectedGraphNodeId) return;
    const newDepId = depIdVal ? parseInt(depIdVal, 10) : null;
    try {
        const res = await fetch(`/api/tasks/${selectedGraphNodeId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                depends_on_id: newDepId
            })
        });
        if (res.ok) {
            showToast("Связь этапа обновлена! 🔗", "success");
            await reloadProjectGraphData();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(`⚠️ ${err.detail || 'Ошибка сохранения связи'}`);
        }
    } catch (e) {
        console.error("Error updating stage dependency:", e);
        showToast("Ошибка сохранения связи", "error");
    }
}

async function handleInspectorStatusChange(val) {
    if (!selectedGraphNodeId) return;
    const node = (currentGraphData?.nodes || []).find(n => n.id === selectedGraphNodeId);
    if (val && val.includes("Выполнено")) {
        if (!node?.is_done) {
            openCompleteTaskModal(selectedGraphNodeId);
            return;
        }
    }
    try {
        const res = await fetch(`/api/tasks/${selectedGraphNodeId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                status: val
            })
        });
        if (res.ok) {
            showToast(`Статус этапа: ${val}`, "success");
            await reloadProjectGraphData();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(`⚠️ ${err.detail || 'Ошибка смены статуса'}`);
        }
    } catch (e) {
        console.error("Error updating status:", e);
    }
}

function completeStageFromInspector() {
    if (!selectedGraphNodeId) return;
    openCompleteTaskModal(selectedGraphNodeId);
}

async function saveStageFromInspector() {
    // Kept as backward compatibility stub
}

async function toggleInspectorSubtask(subtaskId, currentStatus, event) {
    if (event) event.stopPropagation();
    try {
        await quickToggleRoadmapSubtask(subtaskId, currentStatus, event);
        await reloadProjectGraphData();
    } catch (e) {
        console.error("Error toggling inspector subtask:", e);
    }
}

async function deleteInspectorSubtask(subtaskId, event) {
    if (event) event.stopPropagation();
    if (!selectedGraphNodeId) return;
    const node = (currentGraphData?.nodes || []).find(n => n.id === selectedGraphNodeId);
    if (!canDeleteProjectOrTask(node)) {
        showToast("🔒 Удалять подзадачи имеет право только руководство завода (Туматов Д., Герлинг С., Булеханов К.) или администратор", "warning");
        return;
    }
    const subtask = (node?.subtasks || []).find(st => st.id === subtaskId);
    const subtaskTitle = subtask ? `«${subtask.title}»` : "подзадачу";

    ensureUserAuthorized(null, async (authedUser) => {
        if (!confirm(`Вы действительно хотите удалить ${subtaskTitle}?\n\nДействие подтверждается сотрудником «${authedUser.name}» через PIN-код и запишется в журнал истории проекта.`)) {
            return;
        }

        try {
            const userName = authedUser.name || "";
            const pinCode = authedUser.pin || "";
            const res = await fetch(`/api/tasks/${subtaskId}?user_name=${encodeURIComponent(userName)}&pin_code=${encodeURIComponent(pinCode)}`, {
                method: "DELETE"
            });
            if (res.ok) {
                showToast("Подзадача удалена и зафиксирована в истории");
                await reloadProjectGraphData();
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(`⚠️ Ошибка: ${err.detail || 'Не удалось удалить подзадачу'}`);
            }
        } catch (e) {
            console.error("Error deleting subtask:", e);
            showToast("Сетевая ошибка при удалении подзадачи");
        }
    }, subtask || node, "delete_task");
}

function handleInspectorNewSubtaskKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        addInspectorSubtask();
    }
}

async function addInspectorSubtask() {
    if (!selectedGraphNodeId) return;
    const input = document.getElementById("inspector-new-subtask-input");
    const title = input ? input.value.trim() : "";
    if (!title) return;

    const node = (currentGraphData?.nodes || []).find(n => n.id === selectedGraphNodeId);
    const requiredUser = node ? (node.assignee_name || node.author_name) : null;

    ensureUserAuthorized(requiredUser, async (authSession) => {
        const authorName = (authSession && authSession.name) ? authSession.name : ((currentPlannerUser && currentPlannerUser.name) ? currentPlannerUser.name : (node?.author_name || ""));
        const pin = (authSession && authSession.pin) ? authSession.pin : ((currentPlannerUser && currentPlannerUser.pin) ? currentPlannerUser.pin : "");
        const assigneeName = (node && node.assignee_name) ? node.assignee_name : authorName;

        try {
            const payload = {
                parent_id: selectedGraphNodeId,
                title: title,
                assignee_name: assigneeName,
                due_date_str: node ? node.due_date_str : "",
                author_name: authorName,
                pin_code: pin
            };

            const res = await fetch("/api/tasks/quick_milestone", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                if (input) input.value = "";
                showToast("Подзадача добавлена! 🎯", "success");
                await reloadProjectGraphData();
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(`⚠️ Ошибка: ${err.detail || 'Не удалось добавить подзадачу'}`);
            }
        } catch (e) {
            console.error("Error adding subtask in inspector:", e);
        }
    }, node, "interact");
}

async function deleteStageFromGraph() {
    if (!selectedGraphNodeId) return;
    const node = (currentGraphData?.nodes || []).find(n => n.id === selectedGraphNodeId);
    if (!node) return;

    if (!canDeleteProjectOrTask(node)) {
        showToast("🔒 Удалять этапы имеет право только руководство завода (Туматов Д., Герлинг С., Булеханов К.) или администратор", "warning");
        return;
    }

    const stageTitle = `[${node.code || ('TSK-' + node.id)}] «${node.title}»`;

    ensureUserAuthorized(null, async (authedUser) => {
        if (!confirm(`Вы действительно хотите удалить этап ${stageTitle}?\n\nДействие подтверждается сотрудником «${authedUser.name}» через PIN-код и будет зафиксировано в истории аудита проекта.`)) {
            return;
        }

        const deleteBtn = document.getElementById("inspector-delete-btn");
        if (deleteBtn) {
            deleteBtn.disabled = true;
            deleteBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        }

        try {
            const userName = authedUser.name || "";
            const pinCode = authedUser.pin || "";
            const res = await fetch(`/api/tasks/${selectedGraphNodeId}?user_name=${encodeURIComponent(userName)}&pin_code=${encodeURIComponent(pinCode)}`, {
                method: "DELETE"
            });

            if (res.ok) {
                showToast("Этап удалён и зафиксирован в истории");
                closeGraphInspector();
                await reloadProjectGraphData();
                await loadRoadmaps();
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(`⚠️ Ошибка: ${err.detail || 'Не удалось удалить этап'}`);
            }
        } catch (e) {
            console.error("Error deleting stage from graph:", e);
            showToast("Сетевая ошибка при удалении этапа");
        } finally {
            if (deleteBtn) {
                deleteBtn.disabled = false;
                deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
            }
        }
    }, node, "delete_task");
}

function openSelectedStageHistory() {
    if (!selectedGraphNodeId) {
        showToast("Выберите этап на схеме для просмотра истории");
        return;
    }
    openTaskHistoryModal(selectedGraphNodeId);
}

function openCurrentProjectHistory() {
    if (!currentGraphProjectId) {
        showToast("Проект не выбран");
        return;
    }
    openTaskHistoryModal(currentGraphProjectId);
}

function openGraphAddStageModal(presetDependsOnId = null) {
    if (presetDependsOnId && typeof presetDependsOnId !== 'number') {
        presetDependsOnId = null;
    }
    if (!currentGraphProjectId) return;
    const modal = document.getElementById("graph-new-stage-modal");
    if (!modal) return;

    const titleInput = document.getElementById("graph-new-stage-title");
    const assigneeSelect = document.getElementById("graph-new-stage-assignee");
    const dateInput = document.getElementById("graph-new-stage-date");
    const dependsList = document.getElementById("graph-new-stage-depends-list");

    if (titleInput) titleInput.value = "";
    if (dateInput) dateInput.value = getDefaultQuickDateIso();

    const p = currentGraphData?.project || {};
    setupGraphStageAssigneePicker(p.assignee_name || "");

    const presetIds = (presetDependsOnId && typeof presetDependsOnId === 'number') ? [presetDependsOnId] : [];
    const stagePickerContainer = document.getElementById("graph-new-stage-blockers-picker-container") || document.getElementById("graph-new-stage-depends-list");
    if (stagePickerContainer) {
        renderMultiBlockerPicker(stagePickerContainer, {
            pickerId: "graph-new-stage-blockers",
            currentTaskId: null,
            selectedIds: presetIds,
            parentProjectId: currentGraphProjectId,
            allTasksList: currentGraphData?.nodes || [],
            labelText: "Зависит от этапов (блокеры):",
            compact: true
        });
    }

    modal.style.display = "flex";
    if (titleInput) titleInput.focus();
}

function updateNewStageDependsCount() {
    const countEl = document.getElementById("graph-new-stage-depends-count");
    if (!countEl) return;
    const selected = getMultiBlockerSelectedIds("graph-new-stage-blockers");
    countEl.textContent = `${selected.length} выбрано`;
}

function closeGraphNewStageModal() {
    closeGraphStageAssigneePopover();
    const modal = document.getElementById("graph-new-stage-modal");
    if (modal) modal.style.display = "none";
}

function addNextStageAfterSelected() {
    if (!selectedGraphNodeId) return;
    openGraphAddStageModal(selectedGraphNodeId);
}

async function submitGraphNewStage() {
    if (!currentGraphProjectId) return;
    const titleInput = document.getElementById("graph-new-stage-title");
    const assigneeSelect = document.getElementById("graph-new-stage-assignee");
    const dateInput = document.getElementById("graph-new-stage-date");
    const btn = document.getElementById("graph-new-stage-submit-btn");

    const title = titleInput ? titleInput.value.trim() : "";
    if (!title) {
        showToast("⚠️ Введите название этапа", "warning");
        if (titleInput) titleInput.focus();
        return;
    }

    const assigneeInp = document.getElementById("graph-new-stage-assignee-input");
    const assignee = assigneeInp ? assigneeInp.value.trim() : (assigneeSelect ? assigneeSelect.value : "");
    const dateVal = dateInput ? dateInput.value : "";
    let selectedDepIds = getMultiBlockerSelectedIds("graph-new-stage-blockers");
    if (!selectedDepIds.length) {
        const checkedBoxes = document.querySelectorAll("#graph-new-stage-depends-list .new-stage-dep-checkbox:checked");
        selectedDepIds = Array.from(checkedBoxes).map(cb => parseInt(cb.value, 10)).filter(id => !isNaN(id));
    }
    const dueDateStr = dateVal ? formatDateToRuStr(dateVal) : "";

    const authorName = (currentPlannerUser && currentPlannerUser.name) ? currentPlannerUser.name : (localStorage.getItem("tectum_current_user_name") || "");
    const pin = (currentPlannerUser && currentPlannerUser.pin) ? currentPlannerUser.pin : "";

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Создание...`;
    }

    try {
        const payload = {
            parent_id: currentGraphProjectId,
            title: title,
            assignee_name: assignee,
            due_date_str: dueDateStr,
            depends_on_id: selectedDepIds[0] || null,
            depends_on_ids: selectedDepIds,
            author_name: authorName,
            pin_code: pin
        };

        const res = await fetch("/api/tasks/quick_milestone", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || "Не удалось создать этап");
        }

        const data = await res.json();
        showToast(`Этап [${data.code}] создан на схеме! 🎯`, "success");
        closeGraphNewStageModal();
        await reloadProjectGraphData();
        await loadRoadmaps();

        if (data.id) {
            selectGraphNode(data.id);
        }
    } catch (e) {
        console.error("Error creating stage in graph:", e);
        showToast(`⚠️ Ошибка: ${e.message}`, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-plus"></i> Создать этап`;
        }
    }
}

function showGraphInspectorEmpty() {
    closeInspectorAssigneePopover();
    const inspector = document.getElementById("graph-inspector");
    if (!inspector) return;
    inspector.style.display = "block";
    const emptyState = document.getElementById("inspector-empty-state");
    const contentWrap = document.getElementById("inspector-content-wrap");
    if (emptyState) emptyState.style.display = "block";
    if (contentWrap) contentWrap.style.display = "none";
    document.querySelectorAll(".graph-node").forEach(el => el.classList.remove("selected"));
    selectedGraphNodeId = null;
}

function closeGraphInspector() {
    closeInspectorAssigneePopover();
    const inspector = document.getElementById("graph-inspector");
    if (inspector) inspector.style.display = "none";
    document.querySelectorAll(".graph-node").forEach(el => el.classList.remove("selected"));
    selectedGraphNodeId = null;
}

function toggleGraphInspector() {
    const inspector = document.getElementById("graph-inspector");
    if (!inspector) return;
    const isHidden = !inspector.style.display || inspector.style.display === "none" || (typeof window !== "undefined" && window.getComputedStyle(inspector).display === "none");
    if (isHidden) {
        if (selectedGraphNodeId) {
            selectGraphNode(selectedGraphNodeId);
        } else {
            const nodes = currentGraphData?.nodes || [];
            if (nodes.length > 0) {
                const active = nodes.find(n => !n.is_done) || nodes[0];
                selectGraphNode(active.id);
            } else {
                showGraphInspectorEmpty();
            }
        }
    } else {
        closeGraphInspector();
    }
}

function toggleGraphHideDone(isChecked) {
    hideCompletedNodesOnGraph = isChecked;
    if (currentGraphData) {
        renderProjectGraph(currentGraphData);
        fitProjectGraphToScreen();
    }
}

async function toggleGraphMilestone(milestoneId, currentStatus, currentProgress, event) {
    if (event) event.stopPropagation();
    try {
        // Use existing quickToggleRoadmapMilestone
        await quickToggleRoadmapMilestone(milestoneId, currentStatus, currentProgress, event);
        await reloadProjectGraphData();
    } catch (err) {
        console.error("Error toggling milestone in graph:", err);
    }
}

async function reloadProjectGraphData() {
    if (!currentGraphProjectId) return;
    try {
        const res = await fetch(`/api/tasks/${currentGraphProjectId}/graph`);
        if (res.ok) {
            currentGraphData = await res.json();
            const p = currentGraphData.project || {};
            const summary = currentGraphData.summary || {};

            const progBar = document.getElementById("graph-project-progress-bar");
            const progVal = document.getElementById("graph-project-progress-val");
            const prog = summary.overall_progress || p.progress || 0;
            if (progBar) progBar.style.width = `${prog}%`;
            if (progVal) progVal.textContent = `${prog}%`;

            renderProjectGraph(currentGraphData);

            if (selectedGraphNodeId) {
                selectGraphNode(selectedGraphNodeId);
            }
        }
    } catch (err) {
        console.error("Error reloading graph data:", err);
    }
}

function renderGraphMinimap() {
    const canvas = document.getElementById("graph-minimap-canvas");
    const viewportBox = document.getElementById("graph-minimap-viewport");
    const viewport = document.getElementById("graph-viewport");
    if (!canvas || !viewport || !currentGraphData || !currentGraphData.nodes) return;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Canvas background
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const nodes = currentGraphData.nodes;
    if (!nodes.length) return;

    // Fixed virtual space for minimap: 2400 x 1350
    const virtW = 2400;
    const virtH = 1350;
    const scaleMiniX = canvas.width / virtW;
    const scaleMiniY = canvas.height / virtH;

    // Draw mini nodes
    nodes.forEach(n => {
        if (n._renderedX !== undefined) {
            const mx = n._renderedX * scaleMiniX;
            const my = n._renderedY * scaleMiniY;
            const mw = 280 * scaleMiniX;
            const mh = 160 * scaleMiniY;

            ctx.fillStyle = n.is_done ? "#10b981" : (n.is_blocked ? "#ef4444" : "#2563eb");
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(mx, my, mw, mh, 2) : ctx.rect(mx, my, mw, mh);
            ctx.fill();
        }
    });

    // Draw viewport box in minimap
    if (viewportBox) {
        const vpW = viewport.clientWidth;
        const vpH = viewport.clientHeight;

        const visibleX = -graphPanX / graphZoomScale;
        const visibleY = -graphPanY / graphZoomScale;
        const visibleW = vpW / graphZoomScale;
        const visibleH = vpH / graphZoomScale;

        const boxX = Math.max(0, Math.min(canvas.width - 10, visibleX * scaleMiniX));
        const boxY = Math.max(0, Math.min(canvas.height - 10, visibleY * scaleMiniY));
        const boxW = Math.max(8, Math.min(canvas.width, visibleW * scaleMiniX));
        const boxH = Math.max(8, Math.min(canvas.height, visibleH * scaleMiniY));

        viewportBox.style.left = `${boxX}px`;
        viewportBox.style.top = `${boxY}px`;
        viewportBox.style.width = `${boxW}px`;
        viewportBox.style.height = `${boxH}px`;
    }
}

