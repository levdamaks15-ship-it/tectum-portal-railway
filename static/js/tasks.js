/**
 * Tectum Tasks Planner — Client Logic (Clean & Simple)
 * Full parity with Google Sheets structure
 */

let allTasks = [];
let allWeeksStructure = {};
let allMasters = [];
let viewMode = 'active'; // 'active' or 'archive'
let currentMonth = "Август 2026";
let currentWeek = "Неделя 4 (24.08 - 28.08)";

const CORE_NAMES = [
    "Левда М.",
    "Булеханов К.",
    "Булаханов К.",
    "Курилова",
    "Сазонов",
    "Носиков",
    "Хохлов",
    "Батырбекова",
    "Маулен",
    "Касимов",
    "Алиев",
    "Ким",
    "Иванов"
];

document.addEventListener("DOMContentLoaded", async () => {
    await loadCalendarStructure();
    await loadMasters();
    await loadTasks();
});

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

async function loadMasters() {
    try {
        const res = await fetch("/api/masters/");
        if (res.ok) {
            allMasters = await res.json();
            populateDropdowns();
        }
    } catch (e) {
        console.error("Error loading masters:", e);
    }
}

function getUniquePersons() {
    const set = new Set(CORE_NAMES);
    allMasters.forEach(m => {
        if (m.name && !m.name.includes("Мастер смены") && !m.name.includes("Оператор")) {
            set.add(m.name);
        }
    });
    return Array.from(set).sort();
}

function populateDropdowns() {
    const persons = getUniquePersons();

    // Table Header Filters
    const filterAuthor = document.getElementById("table-filter-author");
    if (filterAuthor) {
        filterAuthor.innerHTML = `<option value="all">✍️ Все авторы</option>` + 
            persons.map(n => `<option value="${n}">${n}</option>`).join('');
    }

    const filterAssignee = document.getElementById("table-filter-assignee");
    if (filterAssignee) {
        filterAssignee.innerHTML = `<option value="all">👤 Все исполн.</option>` + 
            persons.map(n => `<option value="${n}">${n}</option>`).join('');
    }

    // Modal Dropdowns
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
}

async function loadTasks() {
    const tableBody = document.getElementById("tasks-table-body");
    if (!tableBody) return;

    const month = document.getElementById("filter-month") ? document.getElementById("filter-month").value : "";
    const week = document.getElementById("filter-week") ? document.getElementById("filter-week").value : "";
    
    // Table Header Filters
    const zone = document.getElementById("table-filter-zone") ? document.getElementById("table-filter-zone").value : "all";
    const author = document.getElementById("table-filter-author") ? document.getElementById("table-filter-author").value : "all";
    const assignee = document.getElementById("table-filter-assignee") ? document.getElementById("table-filter-assignee").value : "all";
    const status = document.getElementById("table-filter-status") ? document.getElementById("table-filter-status").value : "all";

    currentMonth = month;
    currentWeek = week;

    const isArchived = (viewMode === 'archive');
    
    let url = `/api/tasks?is_archived=${isArchived}&month=${encodeURIComponent(month)}`;
    if (viewMode === 'active') {
        url += `&week=${encodeURIComponent(week)}`;
    }
    if (zone !== "all") url += `&zone=${encodeURIComponent(zone)}`;
    if (author !== "all") url += `&author=${encodeURIComponent(author)}`;
    if (assignee !== "all") url += `&assignee=${encodeURIComponent(assignee)}`;
    if (status !== "all") url += `&status=${encodeURIComponent(status)}`;

    try {
        const res = await fetch(url);
        if (res.ok) {
            allTasks = await res.json();
            renderTasksTable(allTasks);
        }
    } catch (e) {
        console.error("Error loading tasks:", e);
        tableBody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: #ef4444; padding: 1.5rem;">Ошибка загрузки задач</td></tr>`;
    }
}

function renderTasksTable(tasks) {
    const tableBody = document.getElementById("tasks-table-body");
    if (!tableBody) return;

    if (!tasks || tasks.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="11" style="text-align: center; padding: 2.5rem; color: #94a3b8; font-size: 0.95rem;">
                    ${viewMode === 'active' ? '✨ Нет активных задач на выбранную неделю. Нажмите «+ Добавить задачу»!' : '📦 Архив пуст'}
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = tasks.map((t, idx) => {
        let statusClass = "status-queue";
        if (t.status && t.status.includes("В работе")) statusClass = "status-work";
        else if (t.status && t.status.includes("Выполнено")) statusClass = "status-done";
        else if (t.status && t.status.includes("Перенесено")) statusClass = "status-moved";

        const photoBtn = t.photo_link ? `
            <a href="${t.photo_link}" target="_blank" class="btn-photo-link" title="Открыть фото в новой вкладке">
                <i class="fa-solid fa-image"></i>
            </a>
        ` : `<span style="color: #64748b; font-size: 0.75rem;">—</span>`;

        const isArchived = t.is_archived;

        return `
            <tr id="task-row-${t.id}">
                <td><span class="badge-code">${t.code || ('TSK-' + (idx + 1))}</span></td>
                <td><span class="badge-zone">${t.zone || 'Бережливое производство'}</span></td>
                <td style="font-weight: 500; min-width: 170px;">${t.title || '—'}</td>
                <td style="color: #94a3b8; font-size: 0.85rem; min-width: 150px;">${t.title_kz || '—'}</td>
                <td style="text-align: center;">${photoBtn}</td>
                
                <!-- Pure Text Author (No broken dropdowns inside table) -->
                <td style="font-size: 0.85rem; color: #cbd5e1; white-space: nowrap;">
                    ${t.author_name || '—'}
                </td>

                <!-- Pure Text Assignee -->
                <td style="font-weight: 600; font-size: 0.85rem; color: #93c5fd; white-space: nowrap;">
                    ${t.assignee_name || '—'}
                </td>

                <td style="font-size: 0.82rem; white-space: nowrap;">${t.due_date_str || 'В теч. недели'}</td>
                <td style="text-align: center;">
                    <select class="select-status ${statusClass}" onchange="quickUpdateStatus(${t.id}, this.value)">
                        <option value="⚪ В очереди" ${t.status === '⚪ В очереди' ? 'selected' : ''}>⚪ В очереди</option>
                        <option value="🟡 В работе" ${t.status === '🟡 В работе' ? 'selected' : ''}>🟡 В работе</option>
                        <option value="🟢 Выполнено" ${t.status === '🟢 Выполнено' ? 'selected' : ''}>🟢 Выполнено</option>
                        <option value="🔵 Перенесено" ${t.status === '🔵 Перенесено' ? 'selected' : ''}>🔵 Перенесено</option>
                    </select>
                </td>
                <td style="font-size: 0.82rem; color: #cbd5e1; max-width: 180px;">
                    <span onclick="inlineEditComment(${t.id}, '${escapeHtml(t.comment || '')}')" style="cursor: pointer; border-bottom: 1px dashed rgba(255,255,255,0.2);" title="Кликните для редактирования">
                        ${t.comment || '—'}
                    </span>
                </td>
                <td style="text-align: center;">
                    <div class="row-actions">
                        ${!isArchived ? `
                            <button class="btn-icon-cell" onclick="moveTaskToNextWeekModal(${t.id})" title="Перенести на следующую неделю">
                                <i class="fa-solid fa-arrow-right"></i>
                            </button>
                            <button class="btn-icon-cell" onclick="openEditTaskModal(${t.id})" title="Редактировать">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                        ` : `
                            <button class="btn-icon-cell" onclick="restoreTaskFromArchive(${t.id})" title="Вернуть в активный план">
                                <i class="fa-solid fa-rotate-left" style="color: #34d399;"></i>
                            </button>
                        `}
                        <button class="btn-icon-cell delete" onclick="deleteTask(${t.id})" title="Удалить">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
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
function switchViewMode(mode) {
    viewMode = mode;
    const btnActive = document.getElementById("btn-mode-active");
    const btnArchive = document.getElementById("btn-mode-archive");
    const btnArchiveWeek = document.getElementById("btn-archive-week");

    if (mode === 'active') {
        btnActive.className = "btn-action btn-primary-action";
        btnArchive.className = "btn-action btn-secondary-action";
        if (btnArchiveWeek) btnArchiveWeek.style.display = "inline-flex";
    } else {
        btnActive.className = "btn-action btn-secondary-action";
        btnArchive.className = "btn-action btn-primary-action";
        if (btnArchiveWeek) btnArchiveWeek.style.display = "none";
    }
    loadTasks();
}

/* ==========================================================
   QUICK INLINE ACTIONS
   ========================================================== */
async function quickUpdateStatus(taskId, newStatus) {
    const task = allTasks.find(t => t.id === taskId);
    if (task) task.status = newStatus;

    try {
        const res = await fetch(`/api/tasks/${taskId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus })
        });
        if (res.ok) {
            showToast(`Статус: ${newStatus}`);
            loadTasks();
        }
    } catch (e) {
        console.error("Error updating status:", e);
    }
}

async function inlineEditComment(taskId, currentComment) {
    const newComment = prompt("Введите факт / комментарий к задаче:", currentComment);
    if (newComment === null) return;

    const task = allTasks.find(t => t.id === taskId);
    if (task) task.comment = newComment;

    try {
        const res = await fetch(`/api/tasks/${taskId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comment: newComment })
        });
        if (res.ok) {
            showToast("Комментарий сохранен");
            loadTasks();
        }
    } catch (e) {
        console.error("Error updating comment:", e);
    }
}

/* ==========================================================
   TRANSLATION (RU <-> KZ) - INSTANT AUTO-TRANSLATE
   ========================================================== */
let translateDebounceTimer = null;
function debounceAutoTranslateModal() {
    clearTimeout(translateDebounceTimer);
    translateDebounceTimer = setTimeout(async () => {
        const ruInput = document.getElementById("task-ru-input");
        const kzInput = document.getElementById("task-kz-input");
        if (!ruInput || !kzInput) return;

        const text = ruInput.value.trim();
        if (!text) {
            kzInput.value = "";
            return;
        }

        try {
            const res = await fetch("/api/tasks/translate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text })
            });
            if (res.ok) {
                const data = await res.json();
                kzInput.value = data.text_kz || "";
            }
        } catch (e) {
            console.error("Auto-translate error:", e);
        }
    }, 300);
}

function setDueQuick(val) {
    const input = document.getElementById("task-due-input");
    if (input) input.value = val;
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
    document.getElementById("task-author-input").value = "";
    document.getElementById("task-assignee-input").value = "";
    document.getElementById("task-due-input").value = "В теч. недели";
    document.getElementById("task-status-input").value = "⚪ В очереди";
    document.getElementById("task-comment-input").value = "";

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
    document.getElementById("task-due-input").value = task.due_date_str || "В теч. недели";
    document.getElementById("task-status-input").value = task.status || "⚪ В очереди";
    document.getElementById("task-comment-input").value = task.comment || "";

    // Если нет KZ перевода - запускаем фоновый перевод
    if (!task.title_kz && task.title) {
        debounceAutoTranslateModal();
    }

    document.getElementById("task-modal").style.display = "flex";
}

function closeTaskModal() {
    document.getElementById("task-modal").style.display = "none";
}

async function saveTaskModal() {
    const taskId = document.getElementById("task-id-input").value;
    const titleRu = document.getElementById("task-ru-input").value.trim();
    let titleKz = document.getElementById("task-kz-input").value.trim();
    const zone = document.getElementById("task-zone-input").value;
    const photoLink = document.getElementById("task-photo-input").value.trim();
    const author = document.getElementById("task-author-input").value;
    const assignee = document.getElementById("task-assignee-input").value;
    const due = document.getElementById("task-due-input").value.trim() || "В теч. недели";
    const status = document.getElementById("task-status-input").value;
    const comment = document.getElementById("task-comment-input").value.trim();

    if (!titleRu) {
        alert("Пожалуйста, введите суть задачи!");
        return;
    }

    // Если казахский перевод еще не подтянулся - получаем синхронно
    if (!titleKz) {
        try {
            const transRes = await fetch("/api/tasks/translate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: titleRu })
            });
            if (transRes.ok) {
                const transData = await transRes.json();
                titleKz = transData.text_kz || "";
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
        week_label: currentWeek
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
            alert("Ошибка сохранения задачи на сервере");
        }
    } catch (e) {
        console.error("Save task error:", e);
    }
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
        }
    } catch (e) {
        console.error("Move task error:", e);
    }
}

async function archiveCurrentWeek() {
    const next = getNextCalendarWeek();

    const confirmMsg = `Завершить рабочую неделю «${currentWeek}»?\n\n• Выполненные задачи (🟢) уйдут в Архив.\n• Все оставшиеся задачи перенесутся на «${next.week}» (🔵 Перенесено).`;
    if (!confirm(confirmMsg)) return;

    try {
        const res = await fetch("/api/tasks/archive_week", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_week: currentWeek, next_week: next.week })
        });
        if (res.ok) {
            const data = await res.json();
            alert(`✅ ${data.message}`);
            
            // Если перешли в следующий месяц
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
        }
    } catch (e) {
        console.error("Archive error:", e);
    }
}

async function restoreTaskFromArchive(taskId) {
    if (!confirm("Вернуть эту задачу из Архива обратно в активный рабочий план?")) return;

    try {
        const res = await fetch(`/api/tasks/${taskId}/restore?target_week=${encodeURIComponent(currentWeek)}`, {
            method: "POST"
        });
        if (res.ok) {
            showToast("Задача возвращена в активный план");
            loadTasks();
        }
    } catch (e) {
        console.error("Restore error:", e);
    }
}

async function deleteTask(taskId) {
    if (!confirm("Вы уверены, что хотите удалить эту задачу?")) return;

    try {
        const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
        if (res.ok) {
            showToast("Задача удалена");
            loadTasks();
        }
    } catch (e) {
        console.error("Delete task error:", e);
    }
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
    const toast = document.getElementById("task-toast");
    const msgEl = document.getElementById("toast-message");
    if (!toast || !msgEl) return;

    msgEl.textContent = message;
    toast.classList.add("show");
    setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}
