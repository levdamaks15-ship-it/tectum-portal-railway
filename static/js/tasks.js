/**
 * Tectum Tasks Planner — Client Logic (Clean & Simple)
 * 3-Level Planning, Hierarchies, Dependencies, Roadmaps & Hashtags
 */

let allTasks = [];
let allRoadmaps = [];
let allTagsList = [];
let allWeeksStructure = {};
let allMasters = [];
let showBacklog = false; // toggle to include unfinished tasks from other weeks
let currentMonth = "Август 2026";
let currentWeek = "Неделя 4 (24.08 - 28.08)";
let currentQuarter = "Q3 2026";

// 3 Horizons & Filters State
let currentHorizon = "weekly"; // "weekly" | "services" | "roadmaps"
let currentDepartmentService = "all"; // "all" | "ОГМ" | "ОГЭ" | "Технологи" | "ОТК"
let currentTagFilter = "all";
let filterHasDocOnly = false;

let allPlannerEmployees = [];
let allPlannerZones = [];

let activeQuickPreset = "all"; // "all" | "my" | "in_work" | "zone"
let myTasksFilterActive = false;
let liveSyncIntervalId = null;
let lastTasksDataHash = "";
let isModalOpen = false;

const CORE_NAMES = [
    "Герлинг С.",
    "Булеханов К.",
    "Акжанбаев Ж.",
    "Курилова С.",
    "Солонцов Ю.",
    "Сазонов С.",
    "Носиков Е.",
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

let targetHighlightTaskId = null;
let currentPlannerUser = null; // { name: string, pin: string }
let pendingAuthCallback = null;

// Выделенные задачи в службах (Multi-Select)
let selectedServiceTaskIds = new Set();

document.addEventListener("DOMContentLoaded", async () => {
    initPlannerSession();
    await loadCalendarStructure();
    await loadPlannerDropdownData();
    await loadTaskTags();
    await handleUrlDeepLinking();
    await loadTasks();
    startTasksLiveSync();
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

function updatePlannerUserBadge() {
    const nameEl = document.getElementById("planner-user-name");
    const badgeEl = document.getElementById("planner-user-badge");
    const logoutBtn = document.getElementById("btn-planner-logout");
    if (!nameEl || !badgeEl) return;

    if (currentPlannerUser && currentPlannerUser.name) {
        nameEl.textContent = currentPlannerUser.name;
        badgeEl.style.display = "flex";
        badgeEl.style.background = "#eff6ff";
        badgeEl.style.color = "#1d4ed8";
        badgeEl.style.borderColor = "#bfdbfe";
        badgeEl.title = `Авторизован: ${currentPlannerUser.name}. Нажмите для смены`;
        if (logoutBtn) logoutBtn.style.display = "inline-block";
    } else {
        nameEl.textContent = "Войти (PIN)";
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

function logoutPlannerUser() {
    currentPlannerUser = null;
    localStorage.removeItem("tectum_portal_user");
    localStorage.removeItem("tectum_current_user_name");
    sessionStorage.removeItem("planner_user_session");
    if (myTasksFilterActive) {
        myTasksFilterActive = false;
        loadTasks();
    }
    updatePlannerUserBadge();
    showToast("Вы вышли из сессии");
}

function openPinModal(preselectedUser = null, onSuccess = null) {
    pendingAuthCallback = onSuccess;
    const modal = document.getElementById("planner-pin-modal");
    const select = document.getElementById("pin-auth-user-select");
    const pinInput = document.getElementById("pin-auth-input");

    if (select) {
        const persons = getUniquePersons();
        select.innerHTML = `<option value="">-- Выберите сотрудника --</option>` + 
            persons.map(n => `<option value="${n}">${n}</option>`).join('');
        
        if (preselectedUser && persons.includes(preselectedUser)) {
            select.value = preselectedUser;
        } else if (currentPlannerUser && currentPlannerUser.name) {
            select.value = currentPlannerUser.name;
        }
    }

    if (pinInput) {
        pinInput.value = "";
    }

    onPinUserSelectChanged();

    if (modal) {
        modal.style.display = "flex";
        modal.style.alignItems = "center";
        modal.style.justifyContent = "center";
    }
    
    setTimeout(() => {
        const pinGrp = document.getElementById("pin-input-group");
        if (pinInput && pinGrp && pinGrp.style.display !== "none") {
            pinInput.focus();
        }
    }, 150);
}

function closePinModal() {
    const modal = document.getElementById("planner-pin-modal");
    if (modal) modal.style.display = "none";
    pendingAuthCallback = null;
}

function onPinUserSelectChanged() {
    const select = document.getElementById("pin-auth-user-select");
    const pinGroup = document.getElementById("pin-input-group");
    if (!select || !pinGroup) return;

    const emp = allPlannerEmployees.find(e => e.name === select.value);
    // Если у сотрудника в БД нет PIN-кода, можно не требовать PIN
    if (emp && emp.has_pin === false) {
        pinGroup.style.display = "none";
    } else {
        pinGroup.style.display = "block";
    }
}

async function submitPinModal() {
    const select = document.getElementById("pin-auth-user-select");
    const pinInput = document.getElementById("pin-auth-input");
    const name = select ? select.value.trim() : "";
    const pin = pinInput ? pinInput.value.trim() : "";

    if (!name) {
        alert("Пожалуйста, выберите сотрудника!");
        return;
    }

    const pinGroup = document.getElementById("pin-input-group");
    if (pinGroup && pinGroup.style.display !== "none" && !pin) {
        alert("Пожалуйста, введите 4-значный PIN-код!");
        if (pinInput) pinInput.focus();
        return;
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
            updatePlannerUserBadge();

            const cb = pendingAuthCallback;
            closePinModal();

            if (cb && typeof cb === "function") {
                cb(currentPlannerUser);
            }
        } else {
            const err = await res.json();
            alert("Ошибка авторизации: " + (err.detail || "Неверный PIN-код"));
            if (pinInput) {
                pinInput.value = "";
                pinInput.focus();
            }
        }
    } catch (e) {
        console.error("PIN verification error:", e);
        alert("Ошибка сети при проверке PIN-кода");
    }
}

function ensureUserAuthorized(requiredUser = null, onSuccess) {
    // Если уже есть сессия и она совпадает с требуемым пользователем (или пользователь не указан)
    if (currentPlannerUser && (!requiredUser || currentPlannerUser.name === requiredUser)) {
        onSuccess(currentPlannerUser);
        return;
    }

    // Если нужна авторизация — открываем модалку ввода PIN
    openPinModal(requiredUser, onSuccess);
}

async function handleUrlDeepLinking() {
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
                }
            } catch (e) {
                console.error("Deep link task fetch error:", e);
            }
        }
    } else {
        // 2. Read month and week from URL
        const monthParam = urlParams.get("month");
        if (monthParam) {
            currentMonth = monthParam;
            const monthSelect = document.getElementById("filter-month");
            if (monthSelect) monthSelect.value = monthParam;
        }
        const weekParam = urlParams.get("week");
        if (weekParam) {
            currentWeek = weekParam;
            onMonthChange(weekParam);
        }
    }

    // 3. Read specific filter parameters from URL
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

    // 4. Horizon deep linking (hash or param)
    const horizonHash = window.location.hash ? window.location.hash.replace('#', '') : '';
    const horizonParam = urlParams.get("horizon");
    const targetHorizon = ['weekly', 'services', 'roadmaps'].includes(horizonHash) ? horizonHash : 
                          (['weekly', 'services', 'roadmaps'].includes(horizonParam) ? horizonParam : null);
    if (targetHorizon) {
        switchHorizon(targetHorizon);
    }

    // 5. Quick Create Task from Knowledge Base Document Deep Link
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
            }
            if (createDocId) {
                const parsedId = parseInt(createDocId, 10);
                if (parsedId) {
                    setSelectedDocAttachment(parsedId, cleanTitle);
                }
            }
        }, 400);
    }
}

function setFilterValueDirect(type, value) {
    const desk = document.getElementById(`table-filter-${type}`);
    if (desk) desk.value = value;
    const mob = document.getElementById(`mobile-filter-${type}`);
    if (mob) mob.value = value;
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
    const mob = document.getElementById(`mobile-filter-${type}`);
    if (mob) mob.value = value;
    if (myTasksFilterActive && (type === 'assignee' || type === 'author')) {
        myTasksFilterActive = false;
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
    updateChipsVisualState();
    updateFilterBadge();
    updateUrlParams();
    loadTasks();
}

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
            setFilterValueDirect('assignee', 'all');
            setFilterValueDirect('author', 'all');
            updatePlannerUserBadge();
            updateChipsVisualState();
            updateFilterBadge();
            updateUrlParams();
            loadTasks();
            showToast(`Фильтр: ${user.name}`);
        });
        return;
    }

    myTasksFilterActive = !myTasksFilterActive;
    if (myTasksFilterActive) {
        setFilterValueDirect('assignee', 'all');
        setFilterValueDirect('author', 'all');
        showToast(`Показаны задачи: ${currentPlannerUser.name}`);
    } else {
        showToast("Показаны все задачи");
    }

    updateChipsVisualState();
    updateFilterBadge();
    updateUrlParams();
    loadTasks();
}

function applyPresetFilter(presetType) {
    if (presetType === 'all') {
        myTasksFilterActive = false;
        ['zone', 'author', 'assignee', 'status'].forEach(type => {
            setFilterValueDirect(type, 'all');
        });
        showBacklog = false;
        const btnBacklog = document.getElementById("btn-toggle-backlog");
        if (btnBacklog) {
            btnBacklog.classList.remove("btn-backlog-active");
            btnBacklog.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> <span class="hide-mobile">Долги с прошлых недель</span><span class="mobile-only">Долги</span>`;
        }

        updateChipsVisualState();
        updateFilterBadge();
        updateUrlParams();
        loadTasks();
        showToast("Показаны все задачи");
        return;
    }

    if (presetType === 'in_work') {
        const curStatus = document.getElementById("table-filter-status")?.value;
        if (curStatus === "🟡 В работе") {
            setFilterValueDirect('status', 'all');
        } else {
            setFilterValueDirect('status', '🟡 В работе');
        }
        updateChipsVisualState();
        updateFilterBadge();
        updateUrlParams();
        loadTasks();
        return;
    }

    if (presetType === 'done') {
        const curStatus = document.getElementById("table-filter-status")?.value;
        if (curStatus === "🟢 Выполнено") {
            setFilterValueDirect('status', 'all');
        } else {
            setFilterValueDirect('status', '🟢 Выполнено');
        }
        updateChipsVisualState();
        updateFilterBadge();
        updateUrlParams();
        loadTasks();
        return;
    }

    if (presetType === 'moved') {
        const curStatus = document.getElementById("table-filter-status")?.value;
        if (curStatus === "🔵 Перенесено") {
            setFilterValueDirect('status', 'all');
        } else {
            setFilterValueDirect('status', '🔵 Перенесено');
        }
        updateChipsVisualState();
        updateFilterBadge();
        updateUrlParams();
        loadTasks();
        return;
    }

    if (presetType === 'cancelled') {
        const curStatus = document.getElementById("table-filter-status")?.value;
        if (curStatus === "🔴 Отменено") {
            setFilterValueDirect('status', 'all');
        } else {
            setFilterValueDirect('status', '🔴 Отменено');
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

    updateChipsVisualState();
    updateFilterBadge();
    updateUrlParams();
    loadTasks();
    showToast("Все фильтры сброшены");
}

function startTasksLiveSync() {
    if (liveSyncIntervalId) clearInterval(liveSyncIntervalId);

    liveSyncIntervalId = setInterval(async () => {
        // Only run when tab is visible and no dialog modals are currently open
        if (document.hidden || document.visibilityState !== 'visible' || isModalOpen) {
            return;
        }

        if (currentHorizon === "roadmaps") {
            await loadRoadmaps();
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
            }

            // Хэштег
            if (currentTagFilter && currentTagFilter !== "all") {
                url += `&tag=${encodeURIComponent(currentTagFilter)}`;
            }

            if (myTasksFilterActive && currentPlannerUser && currentPlannerUser.name) {
                url += `&my_person=${encodeURIComponent(currentPlannerUser.name)}`;
            } else {
                if (zone !== "all") url += `&zone=${encodeURIComponent(zone)}`;
                if (author !== "all") url += `&author=${encodeURIComponent(author)}`;
                if (assignee !== "all") url += `&assignee=${encodeURIComponent(assignee)}`;
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
    }, 35000); // every 35 seconds
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
    }

    // Хэштег
    if (currentTagFilter && currentTagFilter !== "all") {
        url += `&tag=${encodeURIComponent(currentTagFilter)}`;
    }

    if (myTasksFilterActive && currentPlannerUser && currentPlannerUser.name) {
        url += `&my_person=${encodeURIComponent(currentPlannerUser.name)}`;
    } else {
        if (zone !== "all") url += `&zone=${encodeURIComponent(zone)}`;
        if (author !== "all") url += `&author=${encodeURIComponent(author)}`;
        if (assignee !== "all") url += `&assignee=${encodeURIComponent(assignee)}`;
    }
    if (status !== "all") url += `&status=${encodeURIComponent(status)}`;

    try {
        const res = await fetch(url);
        if (res.ok) {
            allTasks = await res.json();
            lastTasksDataHash = JSON.stringify(allTasks);
            renderTasksTable(allTasks);
            renderTasksCards(allTasks);
            renderKpiSummary(allTasks);
            scrollToTargetTaskAfterRender();
        }
    } catch (e) {
        console.error("Error loading tasks:", e);
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: #ef4444; padding: 1.5rem;">Ошибка загрузки задач</td></tr>`;
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

    const tableWrapper = document.getElementById("planner-table-wrapper");
    const roadmapsContainer = document.getElementById("roadmaps-view-container");
    const filterWeek = document.getElementById("filter-week");
    const filterMonth = document.getElementById("filter-month");
    const filterQuarter = document.getElementById("filter-quarter");
    const btnBacklog = document.getElementById("btn-toggle-backlog");
    const btnFilterHasDoc = document.getElementById("btn-filter-hasdoc");
    const quickChips = document.getElementById("quick-chips-group");
    const printSubtitle = document.getElementById("print-header-subtitle");

    if (horizon === "roadmaps") {
        if (tableWrapper) tableWrapper.style.display = "none";
        if (roadmapsContainer) roadmapsContainer.style.display = "block";
        if (filterWeek) filterWeek.style.display = "none";
        if (filterMonth) filterMonth.style.display = "none";
        if (filterQuarter) filterQuarter.style.display = "inline-block";
        if (btnBacklog) btnBacklog.style.display = "none";
        if (btnFilterHasDoc) btnFilterHasDoc.style.display = "none";
        if (printSubtitle) printSubtitle.textContent = "СТРАТЕГИЧЕСКИЕ ДОРОЖНЫЕ КАРТЫ И ПРОЕКТЫ";
        loadRoadmaps();
    } else if (horizon === "services") {
        if (tableWrapper) tableWrapper.style.display = "block";
        if (roadmapsContainer) roadmapsContainer.style.display = "none";
        if (filterWeek) filterWeek.style.display = "inline-block";
        if (filterMonth) filterMonth.style.display = "inline-block";
        if (filterQuarter) filterQuarter.style.display = "none";
        if (btnBacklog) btnBacklog.style.display = "inline-flex";
        if (btnFilterHasDoc) btnFilterHasDoc.style.display = "inline-flex";
        if (printSubtitle) printSubtitle.textContent = "ПЛАНЫ СЛУЖБ ОГМ И ОГЭ (ППР И РЕВИЗИИ ОБОРУДОВАНИЯ)";
        loadTasks();
    } else {
        // weekly
        if (tableWrapper) tableWrapper.style.display = "block";
        if (roadmapsContainer) roadmapsContainer.style.display = "none";
        if (filterWeek) filterWeek.style.display = "inline-block";
        if (filterMonth) filterMonth.style.display = "inline-block";
        if (filterQuarter) filterQuarter.style.display = "none";
        if (btnBacklog) btnBacklog.style.display = "inline-flex";
        if (btnFilterHasDoc) btnFilterHasDoc.style.display = "none";
        if (printSubtitle) printSubtitle.textContent = "ИНФОРМАЦИОННЫЙ СТЕНД / БЕРЕЖЛИВОЕ ПРОИЗВОДСТВО";
        loadTasks();
    }
}

async function loadRoadmaps() {
    const grid = document.getElementById("roadmaps-cards-grid");
    if (!grid) return;

    const quarterSelect = document.getElementById("filter-quarter");
    const qVal = quarterSelect ? quarterSelect.value : "all";

    grid.innerHTML = `<div style="text-align: center; padding: 2rem; color: #64748b; grid-column: 1 / -1;"><i class="fa-solid fa-spinner fa-spin"></i> Загрузка дорожных карт...</div>`;

    try {
        const res = await fetch(`/api/tasks/roadmaps?quarter=${encodeURIComponent(qVal)}`);
        if (res.ok) {
            allRoadmaps = await res.json();
            renderRoadmaps(allRoadmaps);
        } else {
            grid.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 2rem; grid-column: 1 / -1;">Ошибка загрузки проектов</div>`;
        }
    } catch (e) {
        console.error("Error loading roadmaps:", e);
        grid.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 2rem; grid-column: 1 / -1;">Ошибка соединения</div>`;
    }
}

function renderRoadmaps(projects) {
    const grid = document.getElementById("roadmaps-cards-grid");
    if (!grid) return;

    if (!projects || projects.length === 0) {
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

        const milestonesHtml = (p.milestones || []).map(m => {
            const mProg = m.calculated_progress || m.progress || 0;
            const isMDone = (m.status && m.status.includes('Выполнено')) || mProg === 100;
            const subtasksHtml = (m.subtasks || []).map(st => {
                const isStDone = st.status === '🟢 Выполнено';
                const depHtml = st.depends_on ? `<span class="dep-blocker-badge" title="Зависит от ${st.depends_on.code}"><i class="fa-solid fa-lock"></i> ${st.depends_on.code}</span>` : '';
                return `
                    <div class="roadmap-subtask-item" id="roadmap-subtask-${st.id}">
                        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; flex: 1;">
                            <button type="button" class="roadmap-check-btn ${isStDone ? 'checked' : ''}" onclick="quickToggleRoadmapSubtask(${st.id}, '${st.status || ''}', event)" title="${isStDone ? 'Отметить как «В работе»' : 'Отметить как «Выполнено»'}">
                                <i class="fa-solid fa-check"></i>
                            </button>
                            <span style="font-weight: 500; color: #1e293b; text-decoration: ${isStDone ? 'line-through' : 'none'}; opacity: ${isStDone ? '0.65' : '1'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;" onclick="openEditTaskModal(${st.id})" title="Нажмите для редактирования">${escapeHtml(st.title)}</span>
                            ${depHtml}
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                            <span style="font-size: 0.75rem; color: #64748b;">${st.assignee_name || '—'}</span>
                            <button class="btn-icon-cell" onclick="openEditTaskModal(${st.id})" title="Редактировать" style="font-size: 0.7rem; padding: 2px 4px;">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            const mDepHtml = m.depends_on ? `<span class="dep-blocker-badge" title="Зависит от ${m.depends_on.code}"><i class="fa-solid fa-lock"></i> ${m.depends_on.code}</span>` : '';

            return `
                <div class="roadmap-milestone-box" id="roadmap-milestone-${m.id}">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <div style="font-weight: 700; font-size: 0.88rem; color: #1e293b; display: flex; align-items: center; gap: 7px; overflow: hidden;">
                            <button type="button" class="roadmap-check-btn ${isMDone ? 'checked' : ''}" onclick="quickToggleRoadmapMilestone(${m.id}, '${m.status || ''}', ${mProg}, event)" title="${isMDone ? 'Снять отметку выполнения этапа' : 'Завершить этап (100%)'}" style="width: 18px; height: 18px; font-size: 0.6rem;">
                                <i class="fa-solid fa-check"></i>
                            </button>
                            <span style="cursor: pointer; text-decoration: ${isMDone ? 'line-through' : 'none'}; opacity: ${isMDone ? '0.7' : '1'};" onclick="openEditTaskModal(${m.id})" title="Нажмите для редактирования">${escapeHtml(m.title)}</span>
                            ${mDepHtml}
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 0.78rem; font-weight: 700; color: ${mProg === 100 ? '#10b981' : '#2563eb'};">${mProg}%</span>
                            <button class="btn-icon-cell" onclick="openEditTaskModal(${m.id})" title="Редактировать этап" style="font-size: 0.7rem; padding: 2px 4px;">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                        </div>
                    </div>
                    <div class="roadmap-progress-wrap" style="height: 5px; margin-bottom: 6px;">
                        <div class="roadmap-progress-bar" style="width: ${mProg}%; ${mProg === 100 ? 'background: #10b981;' : ''}"></div>
                    </div>
                    <div>
                        ${subtasksHtml}
                    </div>

                    <!-- Quick Add Subtask Input Inline -->
                    <div class="roadmap-quick-add-wrap" id="quick-add-box-${m.id}">
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <input type="text" class="roadmap-quick-add-input" id="quick-add-input-${m.id}" placeholder="Суть подзадачи (нажмите Enter для сохранения)..." onkeydown="handleQuickAddKeydown(event, ${m.id}, ${p.id})">
                            <button type="button" class="btn-action btn-primary-action" style="padding: 2px 8px; font-size: 0.75rem;" onclick="submitQuickAddSubtask(${m.id}, ${p.id})">OK</button>
                            <button type="button" class="btn-action btn-secondary-action" style="padding: 2px 6px; font-size: 0.75rem;" onclick="hideQuickAddSubtask(${m.id})">&times;</button>
                        </div>
                    </div>

                    <div style="margin-top: 6px; display: flex; justify-content: flex-end; gap: 4px;" id="quick-add-btn-wrap-${m.id}">
                        <button type="button" class="btn-action btn-secondary-action" style="font-size: 0.72rem; padding: 2px 7px;" onclick="showQuickAddSubtask(${m.id})">
                            <i class="fa-solid fa-plus"></i> Быстрая подзадача
                        </button>
                        <button type="button" class="btn-action btn-secondary-action" style="font-size: 0.72rem; padding: 2px 7px;" onclick="openAddTaskModal('milestone', ${m.id})" title="Подробная форма">
                            <i class="fa-solid fa-sliders"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

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
            <div class="roadmap-card">
                <div class="roadmap-header">
                    <div>
                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                            <span class="badge-code">${p.code || ('TSK-' + p.id)}</span>
                            <span class="badge-zone" style="background: #f5f3ff; color: #6d28d9; border-color: #ddd6fe;">${p.target_quarter || 'Q3 2026'}</span>
                            ${p.department_service ? `<span class="badge-zone">${p.department_service}</span>` : ''}
                        </div>
                        <div class="roadmap-title">${escapeHtml(p.title)}</div>
                    </div>
                    <div style="display: flex; gap: 4px;">
                        <button class="btn-icon-cell" onclick="openEditTaskModal(${p.id})" title="Редактировать проект">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                    </div>
                </div>

                <div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.8rem; font-weight: 600; color: #475569; margin-bottom: 4px;">
                        <span>Прогресс: ${doneElems}/${totalElems} этапов</span>
                        <span style="color: #2563eb;">${prog}%</span>
                    </div>
                    <div class="roadmap-progress-wrap">
                        <div class="roadmap-progress-bar" style="width: ${prog}%;"></div>
                    </div>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #64748b;">
                    <div>👤 Ответственный: <strong style="color: #0f172a;">${p.assignee_name || 'Не назначен'}</strong></div>
                    <div>${docBadge}</div>
                </div>

                ${tagsHtml ? `<div>${tagsHtml}</div>` : ''}

                <!-- Milestones & Steps -->
                <div style="margin-top: 0.25rem;">
                    <div style="font-size: 0.8rem; font-weight: 700; color: #475569; margin-bottom: 4px; text-transform: uppercase;">Ключевые этапы:</div>
                    ${milestonesHtml || '<div style="font-size: 0.8rem; color: #94a3b8; font-style: italic; padding: 0.5rem 0;">Этапы проекта пока не добавлены</div>'}
                </div>

                <div style="margin-top: auto; padding-top: 0.5rem; border-top: 1px solid #f1f5f9; display: flex; justify-content: flex-end; gap: 6px;">
                    <button type="button" class="btn-action btn-secondary-action" style="font-size: 0.78rem; padding: 3px 9px;" onclick="openAddTaskModal('milestone', ${p.id})">
                        <i class="fa-solid fa-plus"></i> Добавить этап
                    </button>
                </div>
            </div>
        `;
    }).join('');
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

    // Определяем автора/ответственного (текущий авторизованный пользователь или ответственный по проекту)
    const authorName = (currentPlannerUser && currentPlannerUser.name) ? currentPlannerUser.name : (localStorage.getItem("tectum_current_user_name") || "Офис бережливого производства");

    const payload = {
        title: text,
        title_kz: text,
        zone: "Бережливое производство",
        task_type: "weekly",
        parent_id: milestoneId,
        author_name: authorName,
        assignee_name: authorName,
        status: "🟡 В работе",
        month_label: currentMonth,
        week_label: currentWeek,
        pin_code: (currentPlannerUser && currentPlannerUser.pin) ? currentPlannerUser.pin : ""
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
}

async function quickToggleRoadmapSubtask(taskId, currentStatus, event) {
    if (event) event.stopPropagation();
    const isDone = currentStatus === "🟢 Выполнено";
    const nextStatus = isDone ? "🟡 В работе" : "🟢 Выполнено";
    const defaultComment = isDone ? "" : "Выполнено через дорожную карту";

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
                pin_code: (currentPlannerUser && currentPlannerUser.pin) ? currentPlannerUser.pin : ""
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
}

async function quickToggleRoadmapMilestone(milestoneId, currentStatus, currentProgress, event) {
    if (event) event.stopPropagation();
    const isDone = (currentStatus && currentStatus.includes("Выполнено")) || currentProgress === 100;
    const nextStatus = isDone ? "🟡 В работе" : "🟢 Выполнено";
    const nextProgress = isDone ? 0 : 100;
    const defaultComment = isDone ? "" : "Этап завершён";

    try {
        const res = await fetch(`/api/tasks/${milestoneId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                status: nextStatus,
                progress: nextProgress,
                comment: defaultComment,
                pin_code: (currentPlannerUser && currentPlannerUser.pin) ? currentPlannerUser.pin : ""
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
    const hierarchyRow = document.getElementById("task-hierarchy-row");

    if (taskType === "roadmap") {
        if (roadmapRow) roadmapRow.style.display = "grid";
        if (deptInput) deptInput.style.display = "block";
    } else if (taskType === "service_plan") {
        if (roadmapRow) roadmapRow.style.display = "none";
        if (deptInput) deptInput.style.display = "block";
    } else if (taskType === "milestone") {
        if (roadmapRow) roadmapRow.style.display = "none";
        if (deptInput) deptInput.style.display = "block";
    } else {
        // weekly
        if (roadmapRow) roadmapRow.style.display = "none";
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
            if (monthSelect && data.months) {
                monthSelect.innerHTML = `<option value="all">🌐 За всё время</option>` + 
                    data.months.map(m => `<option value="${m}">${m}</option>`).join('');
                if (data.default_month) {
                    monthSelect.value = data.default_month;
                    currentMonth = data.default_month;
                }
            }

            onMonthChange(data.default_week);
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
        loadTasks();
        return;
    }

    let weeks = allWeeksStructure[currentMonth] || [];

    if (weeks.length === 0) {
        // Динамический фоллбэк генерации недель строго (Пн-Пт)
        weeks = generateClientFallbackWeeks(currentMonth);
    }
    
    // В начало списка добавляем «Весь месяц»
    let optionsHtml = `<option value="all">📅 Весь месяц (все недели)</option>` + 
        weeks.map(w => `<option value="${w}">${w}</option>`).join('');

    weekSelect.innerHTML = optionsHtml;
    if (forcedWeek && (forcedWeek === "all" || weeks.includes(forcedWeek))) {
        weekSelect.value = forcedWeek;
        currentWeek = forcedWeek;
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
                    const wStart = new Date(year, sm - 1, sd);
                    let endYear = year;
                    if (sm === 12 && em === 1) endYear = year + 1;
                    const wEnd = new Date(endYear, em - 1, ed, 23, 59, 59);
                    // Расширяем до конца воскресенья (еще +2 дня от пятницы)
                    const wSun = new Date(wEnd);
                    wSun.setDate(wSun.getDate() + 2);
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
    loadTasks();
}

async function loadPlannerDropdownData() {
    try {
        const [empRes, zoneRes] = await Promise.all([
            fetch("/api/planner/employees"),
            fetch("/api/planner/zones")
        ]);
        if (empRes.ok) {
            allPlannerEmployees = await empRes.json();
        }
        if (zoneRes.ok) {
            allPlannerZones = await zoneRes.json();
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
    if (modalAuthor) {
        modalAuthor.innerHTML = `<option value="">-- Выберите автора --</option>` + 
            persons.map(n => `<option value="${n}">${n}</option>`).join('');
    }

    const modalAssignee = document.getElementById("task-assignee-input");
    if (modalAssignee) {
        modalAssignee.innerHTML = `<option value="">-- Выберите исполнителя --</option>` + 
            persons.map(n => `<option value="${n}">${n}</option>`).join('');
    }

    const modalZone = document.getElementById("task-zone-input");
    if (modalZone) {
        modalZone.innerHTML = zones.map(z => `<option value="${z}">${z}</option>`).join('');
    }

    // 4. Bulk Modal Dropdowns
    const bulkAuthor = document.getElementById("bulk-author-input");
    if (bulkAuthor) {
        const curVal = bulkAuthor.value;
        bulkAuthor.innerHTML = `<option value="">-- Выберите автора --</option>` + 
            persons.map(n => `<option value="${n}">${n}</option>`).join('');
        if (curVal && persons.includes(curVal)) bulkAuthor.value = curVal;
    }

    const bulkZone = document.getElementById("bulk-zone-input");
    if (bulkZone) {
        const curVal = bulkZone.value;
        bulkZone.innerHTML = zones.map(z => `<option value="${z}">${z}</option>`).join('');
        if (curVal && zones.includes(curVal)) bulkZone.value = curVal;
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

function toggleSelectAllServices(isChecked) {
    const isServicesMode = currentHorizon === 'services';
    if (!isServicesMode) return;

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
        bar.style.display = (count > 0 && currentHorizon === 'services') ? 'flex' : 'none';
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

    // Определяем автора для проверки PIN (если необходимо)
    const firstTask = allTasks.find(t => t.id === taskIds[0]);
    const authorUser = firstTask ? (firstTask.author_name || firstTask.assignee_name) : null;

    ensureUserAuthorized(authorUser, async (authSession) => {
        try {
            const payload = {
                task_ids: taskIds,
                status: newStatus,
                comment: newStatus.includes("Выполнено") ? "Выполнено" : "",
                pin_code: authSession ? authSession.pin : ""
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
                pin_code: authSession ? authSession.pin : ""
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

function renderTasksTable(tasks) {
    const tableBody = document.getElementById("tasks-table-body");
    if (!tableBody) return;

    // Управление видимостью чекбокса в шапке
    const masterCb = document.getElementById("th-select-all-services");
    if (masterCb) {
        masterCb.style.display = (currentHorizon === 'services') ? 'inline-block' : 'none';
    }
    updateServicesBulkBar();

    if (!tasks || tasks.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="11" style="text-align: center; padding: 2.5rem; color: #94a3b8; font-size: 0.95rem;">
                    ✨ Нет задач на выбранную неделю. Нажмите «+ Добавить задачу»!
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = tasks.map((t, idx) => {
        let statusClass = "status-work";
        const isCompleted = t.status && t.status.includes("Выполнено");
        const isCancelled = t.status && t.status.includes("Отменено");
        const isLocked = isCompleted || isCancelled;

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

        const photoBtn = t.photo_link ? `
            <button type="button" onclick="openPhotoViewerModal('${t.photo_link}')" class="btn-photo-link" style="border: none; cursor: pointer;" title="Просмотреть фото">
                <i class="fa-solid fa-image"></i>
            </button>
        ` : `<span style="color: #94a3b8; font-size: 0.75rem;">—</span>`;

        const backlogBadge = t.is_backlog ? `
            <div style="margin-top: 4px;">
                <span class="badge-backlog" title="Переходящая задача с прошлой недели: ${t.week_label || ''}">
                    <i class="fa-solid fa-clock-rotate-left"></i> ${t.week_label ? t.week_label.split(' ')[0] + ' ' + (t.week_label.split(' ')[1] || '') : 'Долг'}
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

        const titleClass = isCancelled ? 'task-cancelled-text' : '';

        const commentCell = isLocked ? `
            <span class="comment-locked" title="${isCancelled ? 'Отменённая задача заблокирована' : 'Завершённая задача заблокирована'}">
                ${t.comment || '—'}
            </span>
        ` : `
            <span onclick="inlineEditComment(${t.id}, '${escapeHtml(t.comment || '')}')" style="cursor: pointer; border-bottom: 1px dashed rgba(0,0,0,0.25);" title="Кликните для редактирования">
                ${t.comment || '—'}
            </span>
        `;

        const actionButtons = isLocked ? `
            <div class="row-actions">
                <button class="btn-icon-cell" onclick="openTaskHistoryModal(${t.id})" title="История задачи (таймлайн)">
                    <i class="fa-solid fa-clock-rotate-left" style="color: #2563eb;"></i>
                </button>
                <button class="btn-icon-cell" disabled title="Заблокировано">
                    <i class="fa-solid fa-lock" style="font-size: 0.75rem;"></i>
                </button>
            </div>
        ` : `
            <div class="row-actions">
                <button class="btn-icon-cell" onclick="openTaskHistoryModal(${t.id})" title="История задачи (таймлайн)">
                    <i class="fa-solid fa-clock-rotate-left" style="color: #2563eb;"></i>
                </button>
                <button class="btn-icon-cell" onclick="moveTaskToNextWeekModal(${t.id})" title="Перенести на следующую неделю">
                    <i class="fa-solid fa-arrow-right"></i>
                </button>
                <button class="btn-icon-cell" onclick="openEditTaskModal(${t.id})" title="Редактировать">
                    <i class="fa-solid fa-pen"></i>
                </button>
            </div>
        `;

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

        const depBadge = t.depends_on ? `
            <div style="margin-top: 3px;">
                <span class="dep-blocker-badge" title="Заблокировано задачей ${t.depends_on.code}: ${escapeHtml(t.depends_on.title)}">
                    <i class="fa-solid fa-lock"></i> Блокер: ${t.depends_on.code}
                </span>
            </div>
        ` : '';

        let zoneAndDeptHtml = `<span class="badge-zone">${escapeHtml(t.zone || 'Бережливое производство')}</span>`;
        if (t.department_service && t.department_service !== 'Общий' && t.department_service !== t.zone && !(t.zone && t.zone.includes(t.department_service))) {
            zoneAndDeptHtml += `
                <div style="margin-top: 2px;">
                    <span class="badge-zone" style="background: #f0fdf4; color: #15803d; border-color: #bbf7d0; font-size: 0.72rem;">${escapeHtml(t.department_service)}</span>
                </div>
            `;
        }

        const dueDateCell = t.is_deadline_week ? `
            <div>
                <span class="badge-deadline-week" title="Дедлайн на этой неделе: ${t.due_date_str || ''}">
                    <i class="fa-solid fa-bullseye"></i> ${t.due_date_str || 'Дедлайн'}
                </span>
            </div>
        ` : `<span style="font-size: 0.82rem; white-space: nowrap; color: #334155;">${t.due_date_str || 'В теч. недели'}</span>`;

        const isServicesMode = currentHorizon === 'services';
        const isChecked = selectedServiceTaskIds.has(t.id);
        const checkboxHtml = isServicesMode ? `
            <input type="checkbox" class="task-row-checkbox" ${isLocked ? 'disabled' : ''} ${isChecked ? 'checked' : ''} onchange="toggleSelectServiceTask(${t.id}, this.checked)" style="cursor: pointer; width: 15px; height: 15px; accent-color: #2563eb; margin-right: 4px;" title="Выбрать задачу">
        ` : '';

        return `
            <tr id="task-row-${t.id}" class="${rowExtraClass} ${isChecked ? 'task-row-selected' : ''}">
                <td style="white-space: nowrap;">
                    <div style="display: flex; align-items: center; gap: 4px;">
                        ${checkboxHtml}
                        <span class="badge-code" onclick="openTaskHistoryModal(${t.id})" style="cursor: pointer;" title="Нажмите для просмотра истории">${t.code || ('TSK-' + t.id)}</span>
                    </div>
                    ${backlogBadge}
                    ${crossWeekBadge}
                </td>
                <td>
                    ${zoneAndDeptHtml}
                </td>
                <td class="${titleClass}" style="font-weight: 600; min-width: 170px; color: #0f172a;">
                    <div>${t.title || '—'}</div>
                    ${docBadge}
                    ${depBadge}
                    ${tagsHtml ? `<div style="margin-top: 4px;">${tagsHtml}</div>` : ''}
                </td>
                <td class="${titleClass}" style="color: #64748b; font-size: 0.85rem; min-width: 150px;">${t.title_kz || '—'}</td>
                <td style="text-align: center;">${photoBtn}</td>
                
                <!-- Pure Text Author -->
                <td style="font-size: 0.85rem; color: #475569; white-space: nowrap;">
                    ${t.author_name || '—'}
                </td>

                <!-- Pure Text Assignee -->
                <td style="font-weight: 600; font-size: 0.85rem; color: #1d4ed8; white-space: nowrap;">
                    ${t.assignee_name || '—'}
                </td>

                <td>${dueDateCell}</td>
                <td style="text-align: center; white-space: nowrap; min-width: 140px;">
                    <select class="select-status ${statusClass}" ${isLocked ? 'disabled title="Заблокировано для изменений обычными пользователями"' : `onchange="quickUpdateStatus(${t.id}, this.value)"`}>
                        <option value="🟡 В работе" ${t.status === '🟡 В работе' ? 'selected' : ''}>🟡 В работе</option>
                        <option value="🟢 Выполнено" ${t.status === '🟢 Выполнено' ? 'selected' : ''}>🟢 Выполнено</option>
                        <option value="🔵 Перенесено" ${t.status === '🔵 Перенесено' ? 'selected' : ''}>🔵 Перенесено</option>
                        <option value="🔴 Отменено" ${t.status === '🔴 Отменено' ? 'selected' : ''}>🔴 Отменено</option>
                    </select>
                </td>
                <td style="font-size: 0.82rem; color: #334155; max-width: 180px;">
                    ${commentCell}
                </td>
                <td style="text-align: center;">
                    ${actionButtons}
                </td>
            </tr>
        `;
    }).join('');
}

function renderTasksCards(tasks) {
    const cardsContainer = document.getElementById("tasks-cards-container");
    if (!cardsContainer) return;

    if (!tasks || tasks.length === 0) {
        cardsContainer.innerHTML = `
            <div style="text-align: center; padding: 2.5rem 1rem; color: #94a3b8; background: #ffffff; border-radius: 12px; border: 1px solid var(--tbl-border);">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">📋</div>
                <div style="font-weight: 600; color: #475569; margin-bottom: 0.25rem;">Нет задач на эту неделю</div>
                <div style="font-size: 0.85rem; color: #94a3b8;">Нажмите «+ Задача», чтобы добавить первую задачу</div>
            </div>
        `;
        return;
    }

    cardsContainer.innerHTML = tasks.map((t, idx) => {
        let statusClass = "status-work";
        const isCompleted = t.status && t.status.includes("Выполнено");
        const isCancelled = t.status && t.status.includes("Отменено");
        const isLocked = isCompleted || isCancelled;

        let cardExtraClass = "";
        if (isCompleted) {
            statusClass = "status-done";
            cardExtraClass = "task-card-done";
        } else if (isCancelled) {
            statusClass = "status-cancelled";
            cardExtraClass = "task-card-cancelled";
        } else if (t.status && t.status.includes("Перенесено")) {
            statusClass = "status-moved";
        } else {
            statusClass = "status-work";
        }

        const backlogBadge = t.is_backlog ? `
            <span class="badge-backlog" title="Переходящая задача с прошлой недели: ${t.week_label || ''}">
                <i class="fa-solid fa-clock-rotate-left"></i> ${t.week_label ? t.week_label.split(' ')[0] + ' ' + (t.week_label.split(' ')[1] || '') : 'Долг'}
            </span>
        ` : '';

        const crossWeekBadge = (t.is_cross_week && !t.is_backlog) ? `
            <span class="badge-cross-week" title="Сквозная задача. Создана: ${t.origin_month_label ? t.origin_month_label + ', ' : ''}${t.origin_week_label || ''}">
                <i class="fa-solid fa-hourglass-half" style="color: #64748b;"></i> Сквозная${t.origin_created_date ? ' (' + t.origin_created_date + ')' : ''}
            </span>
        ` : '';

        const photoBtn = t.photo_link ? `
            <button type="button" onclick="openPhotoViewerModal('${t.photo_link}')" class="btn-action" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; cursor: pointer; padding: 0.35rem 0.65rem; font-size: 0.78rem; border-radius: 6px; font-weight: 600;" title="Просмотреть прикрепленное фото">
                <i class="fa-solid fa-image"></i> Фото
            </button>
        ` : '';

        let commentBlock = '';
        if (isLocked) {
            commentBlock = t.comment ? `
                <div class="card-comment-box" style="cursor: default;" title="${isCancelled ? 'Отменённая задача' : 'Завершённая задача'}">
                    <i class="fa-regular fa-comment-dots" style="margin-top: 2px;"></i>
                    <div style="flex: 1;">${t.comment}</div>
                </div>
            ` : '';
        } else {
            commentBlock = t.comment ? `
                <div class="card-comment-box" onclick="inlineEditComment(${t.id}, '${escapeHtml(t.comment || '')}')" title="Нажмите для редактирования">
                    <i class="fa-regular fa-comment-dots" style="margin-top: 2px;"></i>
                    <div style="flex: 1;">${t.comment}</div>
                </div>
            ` : `
                <div class="card-add-comment-btn" onclick="inlineEditComment(${t.id}, '')">
                    <i class="fa-solid fa-plus" style="font-size: 0.75rem; color: #2563eb;"></i>
                    <span>Добавить факт / комментарий...</span>
                </div>
            `;
        }

        const titleClass = isCancelled ? 'task-cancelled-text' : '';
        const titleKzBlock = t.title_kz ? `
            <div class="planner-card-title-kz ${titleClass}">${t.title_kz}</div>
        ` : '';

        const docBadge = t.attached_doc ? `
            <div style="margin-top: 6px;">
                <a href="${t.attached_doc.link}" target="_blank" class="badge-doc-attachment" style="display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; font-size: 0.78rem; font-weight: 600; color: #1d4ed8; text-decoration: none; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="Открыть документ: ${escapeHtml(t.attached_doc.title)}">
                    <i class="fa-solid fa-file-lines" style="color: #2563eb;"></i>
                    <span style="overflow: hidden; text-overflow: ellipsis;">${escapeHtml(t.attached_doc.title)}</span>
                </a>
            </div>
        ` : '';

        const cardFooter = isLocked ? `
            <div class="card-actions-footer">
                <button class="btn-card-action" onclick="openTaskHistoryModal(${t.id})" title="История задачи">
                    <i class="fa-solid fa-clock-rotate-left"></i> История
                </button>
                <button class="btn-card-action" disabled title="Заблокировано для изменений">
                    <i class="fa-solid fa-lock" style="font-size: 0.8rem;"></i> Завершено
                </button>
            </div>
        ` : `
            <div class="card-actions-footer">
                <button class="btn-card-action" onclick="openTaskHistoryModal(${t.id})" title="История задачи">
                    <i class="fa-solid fa-clock-rotate-left"></i> История
                </button>
                <button class="btn-card-action" onclick="moveTaskToNextWeekModal(${t.id})" title="Перенести на следующую неделю">
                    <i class="fa-solid fa-arrow-right"></i> Перенести
                </button>
                <button class="btn-card-action btn-card-action-primary" onclick="openEditTaskModal(${t.id})" title="Редактировать задачу">
                    <i class="fa-solid fa-pen"></i> Редактировать
                </button>
            </div>
        `;

        let cardZoneHtml = `<span class="badge-zone">${escapeHtml(t.zone || 'Бережливое производство')}</span>`;
        if (t.department_service && t.department_service !== 'Общий' && t.department_service !== t.zone && !(t.zone && t.zone.includes(t.department_service))) {
            cardZoneHtml += `<span class="badge-zone" style="background: #f0fdf4; color: #15803d; border-color: #bbf7d0; font-size: 0.72rem;">${escapeHtml(t.department_service)}</span>`;
        }

        const cardDueDateItem = t.is_deadline_week ? `
            <div class="card-meta-item">
                <span class="badge-deadline-week" title="Дедлайн на этой неделе: ${t.due_date_str}">
                    <i class="fa-solid fa-bullseye"></i> ${t.due_date_str}
                </span>
            </div>
        ` : `
            <div class="card-meta-item">
                <i class="fa-regular fa-calendar" style="color: #64748b;"></i>
                <span>${t.due_date_str || 'В теч. недели'}</span>
            </div>
        `;

        return `
            <div class="planner-card ${cardExtraClass}" id="task-card-${t.id}">
                <div class="planner-card-header">
                    <div class="card-header-tags">
                        <span class="badge-code">${t.code || ('TSK-' + (idx + 1))}</span>
                        ${cardZoneHtml}
                        ${backlogBadge}
                        ${crossWeekBadge}
                    </div>
                    <div>
                        <select class="select-status ${statusClass}" ${isLocked ? 'disabled title="Заблокировано для изменений обычными пользователями"' : `onchange="quickUpdateStatus(${t.id}, this.value)"`} style="font-size: 0.88rem; min-height: 38px; padding: 0.4rem 0.85rem; font-weight: 700;">
                            <option value="🟡 В работе" ${t.status === '🟡 В работе' ? 'selected' : ''}>🟡 В работе</option>
                            <option value="🟢 Выполнено" ${t.status === '🟢 Выполнено' ? 'selected' : ''}>🟢 Выполнено</option>
                            <option value="🔵 Перенесено" ${t.status === '🔵 Перенесено' ? 'selected' : ''}>🔵 Перенесено</option>
                            <option value="🔴 Отменено" ${t.status === '🔴 Отменено' ? 'selected' : ''}>🔴 Отменено</option>
                        </select>
                    </div>
                </div>

                <div class="planner-card-body">
                    <div class="planner-card-title ${titleClass}">${t.title || '—'}</div>
                    ${titleKzBlock}
                </div>

                <div class="planner-card-meta">
                    <div class="card-meta-item assignee">
                        <i class="fa-solid fa-user-check"></i>
                        <span title="${t.assignee_name || 'Не назначен'}">${t.assignee_name || 'Не назначен'}</span>
                    </div>
                    ${cardDueDateItem}
                    <div class="card-meta-item">
                        <i class="fa-solid fa-pen-nib" style="color: #94a3b8; font-size: 0.75rem;"></i>
                        <span title="${t.author_name || '—'}">${t.author_name || '—'}</span>
                    </div>
                    <div class="card-meta-item" style="justify-content: flex-end;">
                        ${photoBtn}
                    </div>
                </div>

                ${commentBlock}
                ${cardFooter}
            </div>
        `;
    }).join('');
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
function toggleBacklog() {
    showBacklog = !showBacklog;
    const btn = document.getElementById("btn-toggle-backlog");
    if (btn) {
        if (showBacklog) {
            btn.classList.add("btn-backlog-active");
            btn.innerHTML = `<i class="fa-solid fa-clock-rotate-left" style="color: #fbbf24;"></i> <span>Долги включены</span>`;
        } else {
            btn.classList.remove("btn-backlog-active");
            btn.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> <span>Долги с прошлых недель</span>`;
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

    // 1. Если выбрали "Выполнено":
    if (newStatus === "🟢 Выполнено") {
        // Для служб (ОГЭ / ОГМ) — экспресс-завершение без бюрократии!
        const isServiceTask = (task && task.task_type === 'service_plan') || (currentHorizon === 'services');
        if (isServiceTask) {
            const requiredUser = task ? (task.assignee_name || task.author_name) : null;
            ensureUserAuthorized(requiredUser, async (authSession) => {
                try {
                    const res = await fetch(`/api/tasks/${taskId}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            status: "🟢 Выполнено",
                            comment: task.comment || "Выполнено",
                            pin_code: authSession ? authSession.pin : ""
                        })
                    });
                    if (res.ok) {
                        showToast("Задача службы выполнена! 🎯");
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
            });
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
                    pin_code: authSession ? authSession.pin : ""
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
    });
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
    document.getElementById("complete-task-photo").value = task.photo_link || "";
    onPhotoInputChanged('complete-task-photo');

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
    const photoLink = document.getElementById("complete-task-photo").value.trim();
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
                photo_link: photoLink,
                pin_code: authSession ? authSession.pin : ""
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
    });
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
                pin_code: authSession ? authSession.pin : ""
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
    });
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
                    pin_code: authSession ? authSession.pin : ""
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
    });
}

async function inlineEditComment(taskId, currentComment) {
    const task = allTasks.find(t => t.id === taskId);
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
                    pin_code: authSession ? authSession.pin : ""
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
    });
}

/* ==========================================================
   TRANSLATION (RU <-> KZ) - SMART BIDIRECTIONAL ANALYZER
   ========================================================== */
let translateDebounceTimer = null;
let isTranslating = false;

function onTaskInputChanged(source) {
    clearTimeout(translateDebounceTimer);
    
    const primaryInput = document.getElementById("task-ru-input"); // Колонка 1: Задача
    const transInput = document.getElementById("task-kz-input");  // Колонка 2: Перевод
    const badge = document.getElementById("translate-status-badge");
    const langBadge = document.getElementById("detected-lang-badge");
    const transLabel = document.getElementById("task-trans-label");

    if (!primaryInput || !transInput) return;

    // source: 'primary' (первая колонка) или 'secondary' (вторая колонка)
    const isPrimary = (source === 'primary' || source === 'ru');
    const sourceText = (isPrimary ? primaryInput.value : transInput.value).trim();

    if (!sourceText) {
        if (badge) badge.style.display = "none";
        if (langBadge) langBadge.style.display = "none";
        if (isPrimary && transInput) {
            transInput.value = "";
            if (transLabel) transLabel.innerHTML = `Перевод <span style="color: #64748b; font-weight: normal; font-size: 0.75rem;">(Авто)</span>`;
        }
        return;
    }

    if (badge) {
        badge.style.display = "inline-flex";
        badge.innerHTML = `<i class="fa-solid fa-arrows-rotate fa-spin"></i> <span>Перевод...</span>`;
    }

    translateDebounceTimer = setTimeout(async () => {
        try {
            isTranslating = true;
            const res = await fetch("/api/tasks/translate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    text: sourceText,
                    source_lang: isPrimary ? "auto" : "auto"
                })
            });

            if (res.ok) {
                const data = await res.json();
                
                if (isPrimary) {
                    if (data.detected_lang === 'kk') {
                        // Пользователь ввел казахский текст в первую колонку
                        transInput.value = data.text_ru || "";
                        if (transLabel) {
                            transLabel.innerHTML = `Перевод на русский <span style="color: #2563eb; font-weight: 600; font-size: 0.75rem;">(RU)</span>`;
                        }
                        if (langBadge) {
                            langBadge.style.display = "inline-block";
                            langBadge.innerHTML = `<span style="background: #e0f2fe; color: #0284c7; padding: 2px 6px; border-radius: 4px;">🇰🇿 Қазақша</span>`;
                        }
                        if (badge) {
                            badge.innerHTML = `<i class="fa-solid fa-check" style="color: #10b981;"></i> <span style="color: #10b981;">Русский</span>`;
                            badge.style.display = "inline-flex";
                        }
                    } else {
                        // Обычный ввод на русском
                        transInput.value = data.text_kz || "";
                        if (transLabel) {
                            transLabel.innerHTML = `Перевод на казахский <span style="color: #2563eb; font-weight: 600; font-size: 0.75rem;">(KZ)</span>`;
                        }
                        if (langBadge) {
                            langBadge.style.display = "inline-block";
                            langBadge.innerHTML = `<span style="background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px;">🇷🇺 Русский</span>`;
                        }
                        if (badge) {
                            badge.innerHTML = `<i class="fa-solid fa-check" style="color: #10b981;"></i> <span style="color: #10b981;">Қазақша</span>`;
                            badge.style.display = "inline-flex";
                        }
                    }
                } else {
                    // Ручная правка во второй колонке
                    if (badge) {
                        badge.innerHTML = `<i class="fa-solid fa-check" style="color: #10b981;"></i> <span style="color: #64748b;">Отредактировано</span>`;
                        badge.style.display = "inline-flex";
                    }
                }
            }
        } catch (e) {
            console.error("Auto-translate error:", e);
            if (badge) {
                badge.innerHTML = `<span style="color: #ef4444;">Ошибка перевода</span>`;
            }
        } finally {
            isTranslating = false;
        }
    }, 350);
}

function debounceAutoTranslateModal() {
    onTaskInputChanged('primary');
}

/* ==========================================================
   DATE HELPERS
   ========================================================== */
function parseDateToIso(str) {
    if (!str) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const parts = str.match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?/);
    if (parts) {
        const day = parts[1].padStart(2, '0');
        const month = parts[2].padStart(2, '0');
        const year = parts[3] || "2026";
        return `${year}-${month}-${day}`;
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

/* ==========================================================
   MODAL CREATE & EDIT
   ========================================================== */
/* ==========================================================
   MODAL CREATE & EDIT (3 HORIZONS, ROADMAPS, SERVICES)
   ========================================================== */
async function populateHierarchyDropdowns(currentTaskId = null, defaultParentId = null, defaultDependsId = null) {
    const parentSelect = document.getElementById("task-parent-input");
    const dependsSelect = document.getElementById("task-depends-input");

    try {
        const res = await fetch("/api/tasks?task_type=all&month=all");
        if (res.ok) {
            const allT = await res.json();
            
            // 1. Родительские проекты (Дорожные карты и этапы)
            if (parentSelect) {
                const roadmapsAndMilestones = allT.filter(t => (t.task_type === 'roadmap' || t.task_type === 'milestone') && t.id !== currentTaskId);
                parentSelect.innerHTML = `<option value="">-- Без родительского проекта --</option>` +
                    roadmapsAndMilestones.map(p => `<option value="${p.id}">${p.task_type === 'roadmap' ? '🗺️' : '📍'} [${p.code || ('TSK-' + p.id)}] ${escapeHtml(p.title)}</option>`).join('');
                if (defaultParentId) parentSelect.value = defaultParentId;
            }

            // 2. Блокирующие задачи
            if (dependsSelect) {
                const otherTasks = allT.filter(t => t.id !== currentTaskId);
                dependsSelect.innerHTML = `<option value="">-- Нет блокирующих задач --</option>` +
                    otherTasks.map(d => `<option value="${d.id}">🔒 [${d.code || ('TSK-' + d.id)}] ${escapeHtml(d.title)} (${d.status})</option>`).join('');
                if (defaultDependsId) dependsSelect.value = defaultDependsId;
            }
        }
    } catch (e) {
        console.error("Error populating hierarchy dropdowns:", e);
    }
}

async function openAddTaskModal(forcedType = null, parentId = null) {
    populateDropdowns();
    await populateHierarchyDropdowns(null, parentId, null);

    document.getElementById("modal-title").textContent = "Новая задача";
    document.getElementById("task-id-input").value = "";
    document.getElementById("task-ru-input").value = "";
    document.getElementById("task-kz-input").value = "";
    document.getElementById("task-tags-input").value = "";
    document.getElementById("task-photo-input").value = "";
    
    // Тип задачи / Горизонт
    const typeSelect = document.getElementById("task-type-input");
    const initType = forcedType || (currentHorizon === 'roadmaps' ? 'roadmap' : (currentHorizon === 'services' ? 'service_plan' : 'weekly'));
    if (typeSelect) {
        typeSelect.value = initType;
        onTaskTypeChange(initType);
    }

    // Служба по умолчанию
    const deptSelect = document.getElementById("task-department-input");
    if (deptSelect) {
        deptSelect.value = (currentDepartmentService !== 'all') ? currentDepartmentService : '';
    }

    // Квартал и прогресс
    const quarterSelect = document.getElementById("task-quarter-input");
    if (quarterSelect) quarterSelect.value = currentQuarter;
    const progInput = document.getElementById("task-progress-input");
    if (progInput) progInput.value = 0;
    const progDisp = document.getElementById("task-progress-display");
    if (progDisp) progDisp.textContent = "0%";

    // Автоподстановка авторизованного пользователя
    const authorSelect = document.getElementById("task-author-input");
    if (authorSelect) {
        if (currentPlannerUser && currentPlannerUser.name) {
            authorSelect.value = currentPlannerUser.name;
        } else {
            authorSelect.value = "";
        }
    }

    document.getElementById("task-assignee-input").value = "";
    
    // По умолчанию ставим сегодняшнюю дату в календарь
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    document.getElementById("task-due-input").value = `${yyyy}-${mm}-${dd}`;
    
    // По умолчанию статус «В работе» и пустой факт
    document.getElementById("task-status-input").value = "🟡 В работе";
    document.getElementById("task-comment-input").value = "";
    onPhotoInputChanged('task-photo-input');

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

    document.getElementById("task-modal").style.display = "flex";
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

    await populateHierarchyDropdowns(task.id, task.parent_id, task.depends_on_id);

    document.getElementById("modal-title").textContent = `Редактирование задачи [${task.code || ('TSK-' + task.id)}]`;
    document.getElementById("task-id-input").value = task.id;
    document.getElementById("task-ru-input").value = task.title || "";
    document.getElementById("task-kz-input").value = task.title_kz || "";
    document.getElementById("task-tags-input").value = task.tags || "";
    document.getElementById("task-zone-input").value = task.zone || "Бережливое производство";
    document.getElementById("task-photo-input").value = task.photo_link || "";
    document.getElementById("task-author-input").value = task.author_name || "";
    document.getElementById("task-assignee-input").value = task.assignee_name || "";
    
    // Тип задачи, служба, квартал и прогресс
    const taskType = task.task_type || "weekly";
    const typeSelect = document.getElementById("task-type-input");
    if (typeSelect) {
        typeSelect.value = taskType;
        onTaskTypeChange(taskType);
    }

    const deptSelect = document.getElementById("task-department-input");
    if (deptSelect) deptSelect.value = task.department_service || "";

    const quarterSelect = document.getElementById("task-quarter-input");
    if (quarterSelect) quarterSelect.value = task.target_quarter || currentQuarter;

    const progInput = document.getElementById("task-progress-input");
    if (progInput) progInput.value = task.progress || 0;
    const progDisp = document.getElementById("task-progress-display");
    if (progDisp) progDisp.textContent = `${task.progress || 0}%`;

    // Синхронизируем дату в календарь (input type="date")
    document.getElementById("task-due-input").value = parseDateToIso(task.due_date_str);
    
    // Отображаем блоки Статуса и Факта при редактировании существующей задачи
    const statusContainer = document.getElementById("task-status-container");
    if (statusContainer) statusContainer.style.display = "block";
    const dueStatusRow = document.getElementById("task-due-status-row");
    if (dueStatusRow) dueStatusRow.style.gridTemplateColumns = "1fr 1fr";
    const commentContainer = document.getElementById("task-comment-container");
    if (commentContainer) commentContainer.style.display = "block";

    document.getElementById("task-status-input").value = task.status || "⚪ В очереди";
    document.getElementById("task-comment-input").value = task.comment || "";
    onPhotoInputChanged('task-photo-input');

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
    if (transLabel) transLabel.innerHTML = `Перевод <span style="color: #64748b; font-weight: normal; font-size: 0.75rem;">(Авто)</span>`;

    // Если нет KZ перевода - запускаем фоновый перевод
    if (!task.title_kz && task.title) {
        onTaskInputChanged('primary');
    }

    document.getElementById("task-modal").style.display = "flex";
}

function closeTaskModal() {
    document.getElementById("task-modal").style.display = "none";
}

async function saveTaskModal() {
    const taskId = document.getElementById("task-id-input").value;
    let titleRu = document.getElementById("task-ru-input").value.trim();
    let titleKz = document.getElementById("task-kz-input").value.trim();
    const taskType = document.getElementById("task-type-input") ? document.getElementById("task-type-input").value : "weekly";
    const deptService = document.getElementById("task-department-input") ? document.getElementById("task-department-input").value : "";
    const parentIdVal = document.getElementById("task-parent-input") && document.getElementById("task-parent-input").value ? parseInt(document.getElementById("task-parent-input").value, 10) : null;
    const dependsIdVal = document.getElementById("task-depends-input") && document.getElementById("task-depends-input").value ? parseInt(document.getElementById("task-depends-input").value, 10) : null;
    const tagsVal = document.getElementById("task-tags-input") ? document.getElementById("task-tags-input").value.trim() : "";
    const quarterVal = document.getElementById("task-quarter-input") ? document.getElementById("task-quarter-input").value : "";
    const progressVal = document.getElementById("task-progress-input") ? parseInt(document.getElementById("task-progress-input").value, 10) : 0;

    const zone = document.getElementById("task-zone-input").value;
    const photoLink = document.getElementById("task-photo-input").value.trim();
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

    // Если автор не авторизован по PIN — запрашиваем PIN
    ensureUserAuthorized(author, async (authSession) => {
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

        const payload = {
            title: titleRu,
            title_kz: titleKz,
            zone: zone,
            task_type: taskType,
            department_service: (deptService && deptService !== 'Общий' && taskType !== 'weekly') ? deptService : null,
            parent_id: parentIdVal,
            depends_on_id: dependsIdVal,
            tags: tagsVal,
            target_quarter: quarterVal,
            progress: progressVal,
            photo_link: photoLink,
            author_name: author,
            assignee_name: assignee,
            due_date_str: due,
            status: status,
            comment: comment,
            month_label: currentMonth,
            week_label: currentWeek,
            attached_document_id: docIdVal || null,
            pin_code: authSession ? authSession.pin : ""
        };

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
                showToast(taskId ? "Задача обновлена" : "Задача добавлена в план");
                loadTaskTags();
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
            header.style.gridTemplateColumns = "32px 1fr 160px 130px 36px";
            if (headerAssignee) headerAssignee.style.display = "block";
        }
    }

    // 2. Все текущие строки
    const rows = document.querySelectorAll(".bulk-task-row");
    rows.forEach(row => {
        const assigneeSel = row.querySelector(".bulk-row-assignee");
        if (isServicePlan) {
            row.style.gridTemplateColumns = "32px 1fr 130px 36px";
            if (assigneeSel) assigneeSel.style.display = "none";
        } else {
            row.style.gridTemplateColumns = "32px 1fr 160px 130px 36px";
            if (assigneeSel) assigneeSel.style.display = "block";
        }
    });
}

function openBulkTasksModal() {
    populateDropdowns();
    bulkRowCounter = 0;

    // Подстановка типа задачи и службы в зависимости от активного горизонта
    const typeSelect = document.getElementById("bulk-type-input");
    const deptSelect = document.getElementById("bulk-department-input");
    const authorSelect = document.getElementById("bulk-author-input");
    
    // Автоподстановка автора
    let defaultAuthor = "";
    if (currentPlannerUser && currentPlannerUser.name) {
        defaultAuthor = currentPlannerUser.name;
    }

    if (typeSelect) {
        if (currentHorizon === "services") {
            typeSelect.value = "service_plan";
        } else if (currentHorizon === "roadmaps") {
            typeSelect.value = "roadmap";
        } else {
            typeSelect.value = "weekly";
        }
    }

    if (deptSelect) {
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
            deptSelect.value = (typeSelect && typeSelect.value === "service_plan") ? "ОГМ" : "";
        }
    }

    if (authorSelect) {
        if (defaultAuthor) {
            authorSelect.value = defaultAuthor;
        } else {
            // Если автор не выбран, но служба ОГЭ -> предлагаем Курилову С.
            if (deptSelect && deptSelect.value === "ОГЭ") {
                authorSelect.value = "Курилова С.";
            } else if (deptSelect && deptSelect.value === "ОГМ") {
                authorSelect.value = "Солонцов Ю.";
            } else {
                authorSelect.value = "";
            }
        }
    }

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
    const modal = document.getElementById("bulk-tasks-modal");
    if (modal) modal.style.display = "none";
}

function onBulkTypeChange(typeVal) {
    const deptSelect = document.getElementById("bulk-department-input");
    const authorSelect = document.getElementById("bulk-author-input");

    if (typeVal === "service_plan") {
        if (deptSelect && !deptSelect.value) {
            deptSelect.value = "ОГМ";
        }
        if (deptSelect && deptSelect.value === "ОГЭ" && authorSelect && !authorSelect.value) {
            authorSelect.value = "Курилова С.";
        }
    }
    updateBulkColumnsLayout();
}

function onBulkDepartmentChange(deptVal) {
    const authorSelect = document.getElementById("bulk-author-input");
    const zoneSelect = document.getElementById("bulk-zone-input");

    if (deptVal === "ОГЭ") {
        if (authorSelect && (!authorSelect.value || authorSelect.value === "Солонцов Ю.")) {
            authorSelect.value = "Курилова С.";
        }
        if (zoneSelect) zoneSelect.value = "ОГЭ";
    } else if (deptVal === "ОГМ") {
        if (authorSelect && (!authorSelect.value || authorSelect.value === "Курилова С.")) {
            authorSelect.value = "Солонцов Ю.";
        }
        if (zoneSelect) zoneSelect.value = "ОГМ";
    } else if (deptVal === "Технологи") {
        if (authorSelect) authorSelect.value = "Косумов Р.";
    } else if (deptVal === "ОТК") {
        if (authorSelect) authorSelect.value = "Зарина";
        if (zoneSelect) zoneSelect.value = "СКК";
    }
}

function onBulkDefaultDueChanged(newIsoDate) {
    // Обновляем даты в строках, если они пустые или совпадали со старой
    const rows = document.querySelectorAll(".bulk-task-row");
    rows.forEach(row => {
        const dueInput = row.querySelector(".bulk-row-due");
        if (dueInput && !dueInput.value) {
            dueInput.value = newIsoDate;
        }
    });
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

function parseBulkTasksFromTextarea() {
    const pasteArea = document.getElementById("bulk-paste-textarea");
    if (!pasteArea) return;
    const text = pasteArea.value.trim();
    if (!text) {
        alert("Пожалуйста, вставьте текст со списком задач!");
        return;
    }

    const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;

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

    // Добавляем каждую строку как задачу, очищая нумерацию вида "1. ", "- ", "* "
    lines.forEach(line => {
        let cleanTitle = line.replace(/^\d+[\.\)\-]\s*/, '').replace(/^[\-\*\•]\s*/, '').trim();
        if (cleanTitle) {
            addBulkTaskRow(cleanTitle);
        }
    });

    pasteArea.value = "";
    toggleBulkQuickPaste();
    updateBulkTasksCountBadge();
    showToast(`Добавлено строк: ${lines.length}`);
}

function addBulkTaskRow(initTitle = "", initAssignee = "", initDue = "") {
    const container = document.getElementById("bulk-tasks-rows-container");
    if (!container) return;

    bulkRowCounter++;
    const rowId = `bulk-row-${bulkRowCounter}`;

    const defDue = initDue || (document.getElementById("bulk-default-due-input") ? document.getElementById("bulk-default-due-input").value : "");
    const persons = getUniquePersons();

    const typeSelect = document.getElementById("bulk-type-input");
    const isServicePlan = typeSelect && typeSelect.value === "service_plan";

    const rowDiv = document.createElement("div");
    rowDiv.className = "bulk-task-row";
    rowDiv.id = rowId;
    rowDiv.style.display = "grid";
    rowDiv.style.gridTemplateColumns = isServicePlan ? "32px 1fr 130px 36px" : "32px 1fr 160px 130px 36px";
    rowDiv.style.gap = "0.5rem";
    rowDiv.style.alignItems = "center";
    rowDiv.style.background = "#f8fafc";
    rowDiv.style.border = "1px solid #e2e8f0";
    rowDiv.style.borderRadius = "6px";
    rowDiv.style.padding = "0.35rem 0.5rem";

    rowDiv.innerHTML = `
        <span class="bulk-row-num" style="font-size: 0.78rem; font-weight: 700; color: #64748b; text-align: center;"></span>
        <input type="text" class="form-input bulk-row-title" placeholder="Суть задачи... (#ОГЭ, #ППР, #Срочно, насос ЗО)" value="${escapeHtml(initTitle)}" style="font-size: 0.85rem; padding: 0.35rem 0.5rem;" onkeydown="handleBulkRowKeydown(event, '${rowId}')">
        <select class="form-select bulk-row-assignee" style="font-size: 0.8rem; padding: 0.35rem 0.4rem; ${isServicePlan ? 'display: none;' : ''}">
            <option value="">-- Исполнитель --</option>
            ${persons.map(p => `<option value="${escapeHtml(p)}" ${p === initAssignee ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('')}
        </select>
        <input type="date" class="form-input bulk-row-due" value="${defDue}" style="font-size: 0.8rem; padding: 0.35rem 0.4rem;">
        <button type="button" class="btn-icon-cell" onclick="removeBulkTaskRow('${rowId}')" title="Удалить строку" style="color: #ef4444; border-color: #fecaca; background: #fff;">
            <i class="fa-solid fa-trash-can" style="font-size: 0.8rem;"></i>
        </button>
    `;

    container.appendChild(rowDiv);
    renumberBulkRows();
    updateBulkTasksCountBadge();

    // Фокусируемся на добавленной строке
    const titleInput = rowDiv.querySelector(".bulk-row-title");
    if (titleInput && !initTitle) {
        titleInput.focus();
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
        const assigneeSelect = r.querySelector(".bulk-row-assignee");
        const dueInput = r.querySelector(".bulk-row-due");

        const title = titleInput ? titleInput.value.trim() : "";
        const assignee = assigneeSelect ? assigneeSelect.value.trim() : "";
        const dueRaw = dueInput ? dueInput.value.trim() : "";
        const due = formatIsoToDisplayDate(dueRaw) || defDueFormatted;

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
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const data = await res.json();
                closeBulkTasksModal();
                showToast(`Успешно создано задач: ${data.count} шт. 🚀`);
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
function getNextCalendarWeek() {
    const weeks = allWeeksStructure[currentMonth] || [];
    const currentIdx = weeks.indexOf(currentWeek);
    
    if (currentIdx >= 0 && currentIdx < weeks.length - 1) {
        return { month: currentMonth, week: weeks[currentIdx + 1] };
    }
    
    // Если это последняя неделя текущего месяца -> переходим на первую неделю следующего месяца
    const months = Object.keys(allWeeksStructure);
    const monthIdx = months.indexOf(currentMonth);
    if (monthIdx >= 0 && monthIdx < months.length - 1) {
        const nextMonth = months[monthIdx + 1];
        const nextMonthWeeks = allWeeksStructure[nextMonth] || [];
        if (nextMonthWeeks.length > 0) {
            return { month: nextMonth, week: nextMonthWeeks[0] };
        }
    }
    
    return { month: currentMonth, week: `Неделя 1` };
}

async function moveTaskToNextWeekModal(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    const requiredUser = task ? (task.assignee_name || task.author_name) : null;

    ensureUserAuthorized(requiredUser, async (authSession) => {
        const next = getNextCalendarWeek();
        const confirmMove = confirm(`Перенести задачу на «${next.week}» (${next.month}) со статусом «🔵 Перенесено»?`);
        if (!confirmMove) return;

        try {
            const res = await fetch(`/api/tasks/${taskId}/move_next_week?next_week=${encodeURIComponent(next.week)}&next_month=${encodeURIComponent(next.month)}`, {
                method: "POST"
            });
            if (res.ok) {
                showToast(`Задача перенесена на ${next.week}`);
                
                // Если перешли в другой месяц - переключаем фильтр месяца
                if (next.month !== currentMonth) {
                    const monthSelect = document.getElementById("filter-month");
                    if (monthSelect) monthSelect.value = next.month;
                    currentMonth = next.month;
                    onMonthChange(next.week);
                } else {
                    const weekSelect = document.getElementById("filter-week");
                    if (weekSelect) weekSelect.value = next.week;
                    currentWeek = next.week;
                    loadTasks();
                }
            } else {
                alert("Ошибка переноса задачи");
            }
        } catch (e) {
            console.error("Move task error:", e);
        }
    });
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
        if (currentHorizon === 'services') {
            const svcName = (currentDepartmentService && currentDepartmentService !== 'all') ? currentDepartmentService : "ОГМ / ОГЭ / ТЕХНОЛОГИ / ОТК";
            subtitleEl.textContent = `ПЛАН РАБОТ СЛУЖБЫ: ${svcName}`;
        } else if (currentHorizon === 'roadmaps') {
            subtitleEl.textContent = "СТРАТЕГИЧЕСКИЙ ПЛАН / ДОРОЖНЫЕ КАРТЫ И ПРОЕКТЫ";
        } else {
            subtitleEl.textContent = "ИНФОРМАЦИОННЫЙ СТЕНД / БЕРЕЖЛИВОЕ ПРОИЗВОДСТВО";
        }
    }
    if (!metaContainer) return;

    const month = document.getElementById("filter-month") ? document.getElementById("filter-month").value : currentMonth;
    const week = document.getElementById("filter-week") ? document.getElementById("filter-week").value : currentWeek;
    
    const zone = document.getElementById("table-filter-zone") ? document.getElementById("table-filter-zone").value : "all";
    const author = document.getElementById("table-filter-author") ? document.getElementById("table-filter-author").value : "all";
    const assignee = document.getElementById("table-filter-assignee") ? document.getElementById("table-filter-assignee").value : "all";
    const status = document.getElementById("table-filter-status") ? document.getElementById("table-filter-status").value : "all";

    const filterDetails = [];
    if (currentHorizon === 'services') {
        filterDetails.push(currentDepartmentService !== 'all' ? `Служба: ${currentDepartmentService}` : "Все службы (ОГМ / ОГЭ / Технологи / ОТК)");
    } else if (currentHorizon === 'weekly') {
        filterDetails.push("Бережливое производство");
    }
    if (showBacklog) filterDetails.push("⚡ Включая долги прошлых недель");
    if (zone !== "all") filterDetails.push(`Зона: ${zone}`);
    if (author !== "all") filterDetails.push(`Автор: ${author}`);
    if (assignee !== "all" && !isServiceMode) filterDetails.push(`Исполнитель: ${assignee}`);
    if (status !== "all") filterDetails.push(`Статус: ${status}`);

    const filterText = filterDetails.length > 0 ? filterDetails.join(" • ") : "Все подразделения и статусы";
    const now = new Date();
    const nowStr = now.toLocaleDateString("ru-RU") + " " + now.toLocaleTimeString("ru-RU", { hour: '2-digit', minute: '2-digit' });

    metaContainer.innerHTML = `
        <div style="font-weight: 700; font-size: 8.5pt; color: #0f172a;">${month} / ${week}</div>
        <div style="font-size: 7.5pt; color: #334155; margin: 1px 0;">${filterText}</div>
        <div style="font-size: 7pt; color: #64748b;">Всего задач: ${allTasks.length} | Сформировано: ${nowStr}</div>
    `;
}

/* ==========================================================
   PHOTO UPLOAD & CLIENT-SIDE WEBP COMPRESSOR
   ========================================================== */
async function handlePhotoFileUpload(fileInput, targetInputId, hintId, previewBtnId) {
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) return;
    const file = fileInput.files[0];
    const targetInput = document.getElementById(targetInputId);
    const hintEl = document.getElementById(hintId);
    const previewBtn = document.getElementById(previewBtnId);

    showToast("Сжатие и загрузка фото... ⏳");

    try {
        // 1. Сжимаем фото на клиенте в WebP (макс 1600px, 82% качество)
        const compressedBlob = await compressImageToWebp(file, 1600, 0.82);
        
        // 2. Отправляем на сервер
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
            if (hintEl) {
                const origKb = Math.round(file.size / 1024);
                const compKb = Math.round(compressedBlob.size / 1024);
                hintEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>Фото сжато (${origKb} Кб ➔ ${compKb} Кб) и прикреплено</span>`;
                hintEl.style.display = "inline-flex";
            }
            if (previewBtn) previewBtn.style.display = "inline-flex";
            showToast("Фото успешно загружено! 📸");
        } else {
            const err = await res.json();
            alert("Ошибка загрузки фото: " + (err.detail || "Не удалось сохранить фото"));
        }
    } catch (e) {
        console.error("Photo upload error:", e);
        alert("Ошибка при обработке фото: " + e.message);
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

                // Пытаемся сохранить в webp, если браузер поддерживает, иначе jpeg
                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error("Не удалось сжать изображение"));
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

function onPhotoInputChanged(inputId) {
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;

    const val = inputEl.value.trim();
    const isModal1 = (inputId === 'task-photo-input');
    const previewBtn = document.getElementById(isModal1 ? 'task-photo-preview-btn' : 'complete-photo-preview-btn');
    const hintEl = document.getElementById(isModal1 ? 'task-photo-preview-hint' : 'complete-photo-preview-hint');

    if (val && (val.startsWith("http://") || val.startsWith("https://") || val.startsWith("/static/") || val.startsWith("/uploads/"))) {
        if (previewBtn) previewBtn.style.display = "inline-flex";
        if (hintEl) hintEl.style.display = "inline-flex";
    } else {
        if (previewBtn) previewBtn.style.display = "none";
        if (hintEl) hintEl.style.display = "none";
    }
}

function openPhotoViewerModal(url) {
    if (!url) return;
    const modal = document.getElementById("photo-viewer-modal");
    const img = document.getElementById("photo-viewer-img");
    const directLink = document.getElementById("photo-viewer-direct-link");
    if (!modal || !img) return;

    img.src = url;
    if (directLink) directLink.href = url;
    modal.classList.add("active");
}

function closePhotoViewerModal() {
    const modal = document.getElementById("photo-viewer-modal");
    const img = document.getElementById("photo-viewer-img");
    if (modal) modal.classList.remove("active");
    if (img) img.src = "";
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
    const task = allTasks.find(t => t.id === taskId);
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

    try {
        const res = await fetch(`/api/tasks/${taskId}/history`);
        if (res.ok) {
            const data = await res.json();
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
            actionBadge = "Создание задачи";
            badgeColor = "#16a34a";
            badgeBg = "#dcfce7";
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
                    <div class="timeline-body">${escapeHtml(item.details || '')}</div>
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
        if (d.doc_type === 'excel' || (d.title && d.title.match(/\.(xlsx|xls)$/i))) {
            iconClass = "fa-file-excel";
            iconColor = "#10b981";
        } else if (d.doc_type === 'word' || (d.title && d.title.match(/\.(docx|doc)$/i))) {
            iconClass = "fa-file-word";
            iconColor = "#2563eb";
        } else if (d.doc_type === 'pdf' || (d.title && d.title.match(/\.pdf$/i))) {
            iconClass = "fa-file-pdf";
            iconColor = "#ef4444";
        } else if (d.doc_type === 'google') {
            iconClass = "fa-brands fa-google";
            iconColor = "#1a73e8";
        } else if (d.doc_type === 'microsoft') {
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
