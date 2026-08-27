/**
 * Tectum Tasks Planner — Client Logic (Clean & Simple)
 * Full parity with Google Sheets structure
 */

let allTasks = [];
let allWeeksStructure = {};
let allMasters = [];
let showBacklog = false; // toggle to include unfinished tasks from other weeks
let currentMonth = "Август 2026";
let currentWeek = "Неделя 4 (24.08 - 28.08)";

let allPlannerEmployees = [];
let allPlannerZones = [];

const CORE_NAMES = [
    "Левда М.",
    "Булеханов К.",
    "Курилова С.",
    "Сазонов С.",
    "Носиков Е.",
    "Хохлов К.",
    "Батырбекова Г.",
    "Герлинг С.",
    "Косумов Р.",
    "Мастера цеха",
    "Туматов Д.",
    "ОГЭ",
    "ОГМ"
];

let targetHighlightTaskId = null;
let currentPlannerUser = null; // { name: string, pin: string }
let pendingAuthCallback = null;

document.addEventListener("DOMContentLoaded", async () => {
    initPlannerSession();
    await loadCalendarStructure();
    await loadPlannerDropdownData();
    await handleUrlDeepLinking();
    await loadTasks();
});

function initPlannerSession() {
    try {
        const saved = sessionStorage.getItem("planner_user_session");
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
}

function promptChangePlannerUser() {
    openPinModal(null, (user) => {
        showToast(`Вы вошли как ${user.name}`);
    });
}

function logoutPlannerUser() {
    currentPlannerUser = null;
    sessionStorage.removeItem("planner_user_session");
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
            sessionStorage.setItem("planner_user_session", JSON.stringify(currentPlannerUser));
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
    const taskIdParam = urlParams.get("task_id");
    if (!taskIdParam) return;

    const tId = parseInt(taskIdParam, 10);
    if (!tId) return;

    targetHighlightTaskId = tId;

    // Fetch the task info to automatically navigate to the right month and week
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

async function loadCalendarStructure() {
    try {
        const res = await fetch("/api/tasks/weeks");
        if (res.ok) {
            const data = await res.json();
            allWeeksStructure = data.structure || {};
            
            // Populate Month selector with all 12 months
            const monthSelect = document.getElementById("filter-month");
            if (monthSelect && data.months) {
                monthSelect.innerHTML = data.months.map(m => `<option value="${m}">${m}</option>`).join('');
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
    let weeks = allWeeksStructure[currentMonth] || [];

    if (weeks.length === 0) {
        // Динамический фоллбэк генерации недель строго (Пн-Пт)
        weeks = generateClientFallbackWeeks(currentMonth);
    }
    
    weekSelect.innerHTML = weeks.map(w => `<option value="${w}">${w}</option>`).join('');
    if (forcedWeek && weeks.includes(forcedWeek)) {
        weekSelect.value = forcedWeek;
        currentWeek = forcedWeek;
    } else {
        weekSelect.value = weeks[0] || "";
        currentWeek = weeks[0] || "";
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
}

function syncDesktopFilter(type, value) {
    const mob = document.getElementById(`mobile-filter-${type}`);
    if (mob) mob.value = value;
    updateFilterBadge();
    loadTasks();
}

function syncMobileFilter(type, value) {
    const desk = document.getElementById(`table-filter-${type}`);
    if (desk) desk.value = value;
    updateFilterBadge();
    loadTasks();
}

function toggleMobileFilters() {
    const panel = document.getElementById("mobile-filters-panel");
    if (!panel) return;
    const isShown = panel.style.display === "flex";
    panel.style.display = isShown ? "none" : "flex";
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
    
    const badge = document.getElementById("mobile-filter-badge");
    if (badge) {
        if (activeCount > 0) {
            badge.innerText = activeCount;
            badge.style.display = "inline-block";
        } else {
            badge.style.display = "none";
        }
    }
}

function resetAllFilters() {
    ['zone', 'author', 'assignee', 'status'].forEach(type => {
        const desk = document.getElementById(`table-filter-${type}`);
        if (desk) desk.value = 'all';
        const mob = document.getElementById(`mobile-filter-${type}`);
        if (mob) mob.value = 'all';
    });
    updateFilterBadge();
    loadTasks();
}

async function loadTasks() {
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
    updateFilterBadge();
    
    let url = `/api/tasks?month=${encodeURIComponent(month)}&week=${encodeURIComponent(week)}&include_backlog=${showBacklog}`;
    if (zone !== "all") url += `&zone=${encodeURIComponent(zone)}`;
    if (author !== "all") url += `&author=${encodeURIComponent(author)}`;
    if (assignee !== "all") url += `&assignee=${encodeURIComponent(assignee)}`;
    if (status !== "all") url += `&status=${encodeURIComponent(status)}`;

    try {
        const res = await fetch(url);
        if (res.ok) {
            allTasks = await res.json();
            renderTasksTable(allTasks);
            renderTasksCards(allTasks);
            scrollToTargetTaskAfterRender();
        }
    } catch (e) {
        console.error("Error loading tasks:", e);
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: #ef4444; padding: 1.5rem;">Ошибка загрузки задач</td></tr>`;
        if (cardsContainer) cardsContainer.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 1.5rem;">Ошибка загрузки задач</div>`;
    }
}

function renderTasksTable(tasks) {
    const tableBody = document.getElementById("tasks-table-body");
    if (!tableBody) return;

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
        let statusClass = "status-queue";
        const isCompleted = t.status && t.status.includes("Выполнено");
        const isCancelled = t.status && t.status.includes("Отменено");
        const isLocked = isCompleted || isCancelled;

        if (t.status && t.status.includes("В работе")) statusClass = "status-work";
        else if (isCompleted) statusClass = "status-done";
        else if (t.status && t.status.includes("Перенесено")) statusClass = "status-moved";
        else if (isCancelled) statusClass = "status-cancelled";

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
                <button class="btn-icon-cell" disabled title="Заблокировано">
                    <i class="fa-solid fa-arrow-right"></i>
                </button>
                <button class="btn-icon-cell" disabled title="Заблокировано">
                    <i class="fa-solid fa-pen"></i>
                </button>
            </div>
        ` : `
            <div class="row-actions">
                <button class="btn-icon-cell" onclick="moveTaskToNextWeekModal(${t.id})" title="Перенести на следующую неделю">
                    <i class="fa-solid fa-arrow-right"></i>
                </button>
                <button class="btn-icon-cell" onclick="openEditTaskModal(${t.id})" title="Редактировать">
                    <i class="fa-solid fa-pen"></i>
                </button>
            </div>
        `;

        return `
            <tr id="task-row-${t.id}">
                <td>
                    <span class="badge-code">${t.code || ('TSK-' + (idx + 1))}</span>
                    ${backlogBadge}
                </td>
                <td><span class="badge-zone">${t.zone || 'Бережливое производство'}</span></td>
                <td class="${titleClass}" style="font-weight: 600; min-width: 170px; color: #0f172a;">${t.title || '—'}</td>
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

                <td style="font-size: 0.82rem; white-space: nowrap; color: #334155;">${t.due_date_str || 'В теч. недели'}</td>
                <td style="text-align: center;">
                    <select class="select-status ${statusClass}" ${isLocked ? 'disabled title="Заблокировано для изменений обычными пользователями"' : `onchange="quickUpdateStatus(${t.id}, this.value)"`}>
                        <option value="⚪ В очереди" ${t.status === '⚪ В очереди' ? 'selected' : ''}>⚪ В очереди</option>
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
        let statusClass = "status-queue";
        const isCompleted = t.status && t.status.includes("Выполнено");
        const isCancelled = t.status && t.status.includes("Отменено");
        const isLocked = isCompleted || isCancelled;

        if (t.status && t.status.includes("В работе")) statusClass = "status-work";
        else if (isCompleted) statusClass = "status-done";
        else if (t.status && t.status.includes("Перенесено")) statusClass = "status-moved";
        else if (isCancelled) statusClass = "status-cancelled";

        const backlogBadge = t.is_backlog ? `
            <span class="badge-backlog" title="Переходящая задача с прошлой недели: ${t.week_label || ''}">
                <i class="fa-solid fa-clock-rotate-left"></i> ${t.week_label ? t.week_label.split(' ')[0] + ' ' + (t.week_label.split(' ')[1] || '') : 'Долг'}
            </span>
        ` : '';

        const photoBtn = t.photo_link ? `
            <button type="button" onclick="openPhotoViewerModal('${t.photo_link}')" class="btn-photo-link" style="border: none; cursor: pointer; padding: 0.3rem 0.6rem; font-size: 0.78rem;" title="Просмотреть фото">
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
                <div style="font-size: 0.78rem; color: #94a3b8; cursor: pointer; padding: 2px 0;" onclick="inlineEditComment(${t.id}, '')">
                    <i class="fa-solid fa-plus" style="font-size: 0.7rem;"></i> Добавить факт/комментарий...
                </div>
            `;
        }

        const titleClass = isCancelled ? 'task-cancelled-text' : '';
        const titleKzBlock = t.title_kz ? `
            <div class="planner-card-title-kz ${titleClass}">${t.title_kz}</div>
        ` : '';

        const cardFooter = isLocked ? `
            <div class="card-actions-footer">
                <button class="btn-card-action" disabled title="Заблокировано">
                    <i class="fa-solid fa-arrow-right"></i> Перенести
                </button>
                <button class="btn-card-action" disabled title="Заблокировано">
                    <i class="fa-solid fa-pen"></i> Редактировать
                </button>
            </div>
        ` : `
            <div class="card-actions-footer">
                <button class="btn-card-action" onclick="moveTaskToNextWeekModal(${t.id})" title="Перенести на следующую неделю">
                    <i class="fa-solid fa-arrow-right"></i> Перенести
                </button>
                <button class="btn-card-action" onclick="openEditTaskModal(${t.id})" title="Редактировать задачу">
                    <i class="fa-solid fa-pen"></i> Редактировать
                </button>
            </div>
        `;

        return `
            <div class="planner-card" id="task-card-${t.id}">
                <div class="planner-card-header">
                    <div class="card-header-tags">
                        <span class="badge-code">${t.code || ('TSK-' + (idx + 1))}</span>
                        <span class="badge-zone">${t.zone || 'Бережливое производство'}</span>
                        ${backlogBadge}
                    </div>
                    <div>
                        <select class="select-status ${statusClass}" ${isLocked ? 'disabled title="Заблокировано для изменений обычными пользователями"' : `onchange="quickUpdateStatus(${t.id}, this.value)"`} style="font-size: 0.82rem; padding: 0.4rem 0.75rem;">
                            <option value="⚪ В очереди" ${t.status === '⚪ В очереди' ? 'selected' : ''}>⚪ В очереди</option>
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
                    <div class="card-meta-item">
                        <i class="fa-regular fa-calendar" style="color: #64748b;"></i>
                        <span>${t.due_date_str || 'В теч. недели'}</span>
                    </div>
                    <div class="card-meta-item">
                        <i class="fa-solid fa-pen-nib" style="color: #94a3b8; font-size: 0.75rem;"></i>
                        <span title="${t.author_name || '—'}">${t.author_name || '—'}</span>
                    </div>
                    <div class="card-meta-item" style="justify-content: flex-end;">
                        ${photoBtn || '<span style="color: #cbd5e1; font-size: 0.75rem;">Без фото</span>'}
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
let previousTaskStatus = {};

async function quickUpdateStatus(taskId, newStatus) {
    const task = allTasks.find(t => t.id === taskId);
    const oldStatus = task ? (task.status || "⚪ В очереди") : "⚪ В очереди";
    previousTaskStatus[taskId] = oldStatus;

    // Если выбрали "Выполнено" — требуем весомого подтверждения через модальное окно
    if (newStatus === "🟢 Выполнено") {
        openCompleteTaskModal(taskId);
        return;
    }

    // Если выбрали "Отменено" — отменять может только Автор задачи (или Админ) с указанием причины
    if (newStatus === "🔴 Отменено") {
        const authorUser = task ? task.author_name : null;
        ensureUserAuthorized(authorUser, async (authSession) => {
            const reason = prompt("Укажите причину отмены задачи (будет сохранена в комментарии):", task.comment || "");
            if (reason === null) {
                loadTasks();
                return;
            }

            try {
                const commentText = reason ? `[Отменено] ${reason}` : "[Отменено]";
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
                    showToast("Задача отменена 🔴");
                    loadTasks();
                } else {
                    const err = await res.json();
                    alert("Ошибка отмены задачи: " + (err.detail || "Доступ запрещен"));
                    loadTasks();
                }
            } catch (e) {
                console.error("Error cancelling task:", e);
                loadTasks();
            }
        });
        return;
    }

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

    // Возвращаем селектор статуса обратно к предыдущему значению при отмене
    if (pendingCompleteTaskId) {
        const rowSelect = document.querySelector(`#task-row-${pendingCompleteTaskId} .select-status`);
        if (rowSelect && previousTaskStatus[pendingCompleteTaskId]) {
            rowSelect.value = previousTaskStatus[pendingCompleteTaskId];
        }
        const cardSelect = document.querySelector(`#task-card-${pendingCompleteTaskId} .select-status`);
        if (cardSelect && previousTaskStatus[pendingCompleteTaskId]) {
            cardSelect.value = previousTaskStatus[pendingCompleteTaskId];
        }
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

function onTaskInputChanged(sourceField) {
    clearTimeout(translateDebounceTimer);
    
    const ruInput = document.getElementById("task-ru-input");
    const kzInput = document.getElementById("task-kz-input");
    const badge = document.getElementById("translate-status-badge");
    if (!ruInput || !kzInput) return;

    const sourceText = (sourceField === 'ru' ? ruInput.value : kzInput.value).trim();
    if (!sourceText) {
        if (badge) badge.style.display = "none";
        return;
    }

    if (badge) {
        badge.style.display = "inline-flex";
        badge.innerHTML = `<i class="fa-solid fa-arrows-rotate fa-spin"></i> <span>Анализ языка...</span>`;
    }

    translateDebounceTimer = setTimeout(async () => {
        try {
            isTranslating = true;
            const res = await fetch("/api/tasks/translate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    text: sourceText,
                    source_lang: sourceField === 'kz' ? 'kk' : 'auto'
                })
            });

            if (res.ok) {
                const data = await res.json();
                
                if (sourceField === 'ru') {
                    if (data.detected_lang === 'kk') {
                        // Пользователь ввел казахский текст в RU поле -> раскладываем по местам
                        kzInput.value = data.text_kz || sourceText;
                        if (data.text_ru) {
                            ruInput.value = data.text_ru;
                        }
                        if (badge) {
                            badge.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles" style="color: #38bdf8;"></i> <span style="color: #38bdf8;">Распознан <b>казахский</b> ➔ переведено на русский</span>`;
                            badge.style.display = "inline-flex";
                        }
                    } else {
                        // Обычный русский ввод
                        kzInput.value = data.text_kz || "";
                        if (badge) {
                            badge.innerHTML = `<i class="fa-solid fa-check" style="color: #34d399;"></i> <span style="color: #94a3b8;">Переведено на <b>казахский</b></span>`;
                            badge.style.display = "inline-flex";
                        }
                    }
                } else if (sourceField === 'kz') {
                    // Пользователь ввел казахский текст в KZ поле
                    ruInput.value = data.text_ru || "";
                    if (badge) {
                        badge.innerHTML = `<i class="fa-solid fa-check" style="color: #34d399;"></i> <span style="color: #94a3b8;">Переведено на <b>русский</b></span>`;
                        badge.style.display = "inline-flex";
                    }
                }
            }
        } catch (e) {
            console.error("Auto-translate error:", e);
            if (badge) {
                badge.innerHTML = `<span style="color: #ef4444;">Ошибка анализа</span>`;
            }
        } finally {
            isTranslating = false;
        }
    }, 350);
}

function debounceAutoTranslateModal() {
    onTaskInputChanged('ru');
}

function swapTaskLanguages() {
    const ruInput = document.getElementById("task-ru-input");
    const kzInput = document.getElementById("task-kz-input");
    const badge = document.getElementById("translate-status-badge");
    if (!ruInput || !kzInput) return;

    const temp = ruInput.value;
    ruInput.value = kzInput.value;
    kzInput.value = temp;

    if (badge) {
        badge.innerHTML = `<i class="fa-solid fa-right-left" style="color: #fbbf24;"></i> <span style="color: #fbbf24;">Тексты поменяны местами</span>`;
        badge.style.display = "inline-flex";
    }
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
function openAddTaskModal() {
    populateDropdowns();
    document.getElementById("modal-title").textContent = "Новая задача";
    document.getElementById("task-id-input").value = "";
    document.getElementById("task-ru-input").value = "";
    document.getElementById("task-kz-input").value = "";
    document.getElementById("task-photo-input").value = "";
    
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
    
    document.getElementById("task-status-input").value = "🟡 В работе";
    document.getElementById("task-comment-input").value = "";
    onPhotoInputChanged('task-photo-input');

    const badge = document.getElementById("translate-status-badge");
    if (badge) badge.style.display = "none";

    document.getElementById("task-modal").style.display = "flex";
}

function openEditTaskModal(taskId) {
    populateDropdowns();
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    document.getElementById("modal-title").textContent = `Редактирование задачи [${task.code || ('TSK-' + task.id)}]`;
    document.getElementById("task-id-input").value = task.id;
    document.getElementById("task-ru-input").value = task.title || "";
    document.getElementById("task-kz-input").value = task.title_kz || "";
    document.getElementById("task-zone-input").value = task.zone || "Бережливое производство";
    document.getElementById("task-photo-input").value = task.photo_link || "";
    document.getElementById("task-author-input").value = task.author_name || "";
    document.getElementById("task-assignee-input").value = task.assignee_name || "";
    
    // Синхронизируем дату в календарь (input type="date")
    document.getElementById("task-due-input").value = parseDateToIso(task.due_date_str);
    
    document.getElementById("task-status-input").value = task.status || "⚪ В очереди";
    document.getElementById("task-comment-input").value = task.comment || "";
    onPhotoInputChanged('task-photo-input');

    const badge = document.getElementById("translate-status-badge");
    if (badge) badge.style.display = "none";

    // Если нет KZ перевода - запускаем фоновый перевод
    if (!task.title_kz && task.title) {
        onTaskInputChanged('ru');
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

        // Если одно из полей не заполнено — получаем перевод синхронно
        if (!titleRu && titleKz) {
            try {
                const transRes = await fetch("/api/tasks/translate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: titleKz, source_lang: "kk" })
                });
                if (transRes.ok) {
                    const transData = await transRes.json();
                    titleRu = transData.text_ru || titleKz;
                }
            } catch (e) {
                titleRu = titleKz;
            }
        } else if (titleRu && !titleKz) {
            try {
                const transRes = await fetch("/api/tasks/translate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: titleRu })
                });
                if (transRes.ok) {
                    const transData = await transRes.json();
                    titleKz = transData.text_kz || "";
                    if (transData.detected_lang === 'kk' && transData.text_ru) {
                        titleRu = transData.text_ru;
                    }
                }
            } catch (e) {}
        }

        const payload = {
            title: titleRu,
            title_kz: titleKz,
            zone: zone,
            photo_link: photoLink,
            author_name: author,
            assignee_name: assignee,
            due_date_str: due,
            status: status,
            comment: comment,
            month_label: currentMonth,
            week_label: currentWeek,
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
                loadTasks();
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
    if (!metaContainer) return;

    const month = document.getElementById("filter-month") ? document.getElementById("filter-month").value : currentMonth;
    const week = document.getElementById("filter-week") ? document.getElementById("filter-week").value : currentWeek;
    
    const zone = document.getElementById("table-filter-zone") ? document.getElementById("table-filter-zone").value : "all";
    const author = document.getElementById("table-filter-author") ? document.getElementById("table-filter-author").value : "all";
    const assignee = document.getElementById("table-filter-assignee") ? document.getElementById("table-filter-assignee").value : "all";
    const status = document.getElementById("table-filter-status") ? document.getElementById("table-filter-status").value : "all";

    const filterDetails = [];
    if (showBacklog) filterDetails.push("⚡ Включая долги прошлых недель");
    if (zone !== "all") filterDetails.push(`Зона: ${zone}`);
    if (author !== "all") filterDetails.push(`Автор: ${author}`);
    if (assignee !== "all") filterDetails.push(`Исполнитель: ${assignee}`);
    if (status !== "all") filterDetails.push(`Статус: ${status}`);

    const filterText = filterDetails.length > 0 ? filterDetails.join(" • ") : "Все подразделения и статусы";
    const now = new Date();
    const nowStr = now.toLocaleDateString("ru-RU") + " " + now.toLocaleTimeString("ru-RU", { hour: '2-digit', minute: '2-digit' });

    metaContainer.innerHTML = `
        <div style="font-weight: 700; font-size: 9pt; color: #0f172a;">${month} / ${week}</div>
        <div style="font-size: 8pt; color: #334155; margin: 2px 0;">Фильтр: ${filterText}</div>
        <div style="font-size: 7.5pt; color: #64748b;">Всего задач: ${allTasks.length} | Сформировано: ${nowStr}</div>
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
