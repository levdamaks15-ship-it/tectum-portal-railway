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

function onMonthChange(forcedWeek = null) {
    const monthSelect = document.getElementById("filter-month");
    const weekSelect = document.getElementById("filter-week");
    if (!monthSelect || !weekSelect) return;

    currentMonth = monthSelect.value;
    const weeks = allWeeksStructure[currentMonth] || [];

    if (weeks.length === 0) {
        // Фоллбэк генерация 4 недель
        weekSelect.innerHTML = [
            `Неделя 1 (01 - 07)`,
            `Неделя 2 (08 - 14)`,
            `Неделя 3 (15 - 21)`,
            `Неделя 4 (22 - 28)`
        ].map(w => `<option value="${w}">${w}</option>`).join('');
        currentWeek = `Неделя 1 (01 - 07)`;
    } else {
        weekSelect.innerHTML = weeks.map(w => `<option value="${w}">${w}</option>`).join('');
        if (forcedWeek && weeks.includes(forcedWeek)) {
            weekSelect.value = forcedWeek;
            currentWeek = forcedWeek;
        } else {
            weekSelect.value = weeks[0];
            currentWeek = weeks[0];
        }
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

    const persons = getUniquePersons();

    tableBody.innerHTML = tasks.map((t, idx) => {
        let statusClass = "status-queue";
        if (t.status.includes("В работе")) statusClass = "status-work";
        else if (t.status.includes("Выполнено")) statusClass = "status-done";
        else if (t.status.includes("Перенесено")) statusClass = "status-moved";

        const photoBtn = t.photo_link ? `
            <a href="${t.photo_link}" target="_blank" class="btn-photo-link" title="Открыть фото в новой вкладке">
                <i class="fa-solid fa-image"></i>
            </a>
        ` : `<span style="color: #64748b; font-size: 0.75rem;">—</span>`;

        const isArchived = t.is_archived;

        // Author Dropdown Options
        const authorOptions = `<option value="">-- Автор --</option>` + 
            persons.map(p => `<option value="${p}" ${t.author_name === p ? 'selected' : ''}>${p}</option>`).join('');

        // Assignee Dropdown Options
        const assigneeOptions = `<option value="">-- Исполнитель --</option>` + 
            persons.map(p => `<option value="${p}" ${t.assignee_name === p ? 'selected' : ''}>${p}</option>`).join('');

        return `
            <tr id="task-row-${t.id}">
                <td><span class="badge-code">${t.code || ('TSK-' + (idx + 1))}</span></td>
                <td><span class="badge-zone">${t.zone || 'Бережливое производство'}</span></td>
                <td style="font-weight: 500; min-width: 170px;">${t.title}</td>
                <td style="color: #94a3b8; font-size: 0.85rem; min-width: 150px;">${t.title_kz || '—'}</td>
                <td style="text-align: center;">${photoBtn}</td>
                
                <!-- Inline Author Dropdown -->
                <td>
                    <select class="select-filter" style="font-size: 0.75rem; padding: 2px 4px; width: 100%;" onchange="quickUpdateField(${t.id}, 'author_name', this.value)">
                        ${authorOptions}
                    </select>
                </td>

                <!-- Inline Assignee Dropdown -->
                <td>
                    <select class="select-filter" style="font-size: 0.75rem; padding: 2px 4px; width: 100%; font-weight: 600; color: #93c5fd;" onchange="quickUpdateField(${t.id}, 'assignee_name', this.value)">
                        ${assigneeOptions}
                    </select>
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

function toggleMyTasksFilter() {
    myTasksOnly = !myTasksOnly;
    const btn = document.getElementById("btn-my-tasks");
    if (btn) {
        if (myTasksOnly) {
            btn.className = "btn-action btn-primary-action";
            showToast("Фильтр: только мои задачи");
        } else {
            btn.className = "btn-action btn-secondary-action";
            showToast("Фильтр снят");
        }
    }
    loadTasks();
}

/* ==========================================================
   QUICK INLINE ACTIONS
   ========================================================== */
async function quickUpdateStatus(taskId, newStatus) {
    try {
        const res = await fetch(`/api/tasks/${taskId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus })
        });
        if (res.ok) {
            showToast(`Статус изменен: ${newStatus}`);
            loadTasks();
        }
    } catch (e) {
        console.error("Error updating status:", e);
    }
}

async function inlineEditComment(taskId, currentComment) {
    const newComment = prompt("Введите факт / комментарий к задаче:", currentComment);
    if (newComment === null) return;

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
   TRANSLATION (RU <-> KZ)
   ========================================================== */
async function triggerAutoTranslate() {
    const inputEl = document.getElementById("task-input-text");
    const ruEl = document.getElementById("task-ru-input");
    const kzEl = document.getElementById("task-kz-input");
    if (!inputEl || !inputEl.value.trim()) return;

    const text = inputEl.value.trim();
    try {
        const res = await fetch("/api/tasks/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        });
        if (res.ok) {
            const data = await res.json();
            if (ruEl) ruEl.value = data.text_ru || text;
            if (kzEl) kzEl.value = data.text_kz || "";
            showToast("Перевод выполнен ✨");
        }
    } catch (e) {
        console.error("Translation error:", e);
    }
}

/* ==========================================================
   MODAL CREATE & EDIT
   ========================================================== */
function openAddTaskModal() {
    document.getElementById("modal-title").textContent = "Новая задача";
    document.getElementById("task-id-input").value = "";
    document.getElementById("task-input-text").value = "";
    document.getElementById("task-ru-input").value = "";
    document.getElementById("task-kz-input").value = "";
    document.getElementById("task-photo-input").value = "";
    document.getElementById("task-author-input").value = "";
    document.getElementById("task-assignee-input").value = "";
    document.getElementById("task-due-input").value = "28.08";
    document.getElementById("task-status-input").value = "⚪ В очереди";
    document.getElementById("task-comment-input").value = "";

    document.getElementById("task-modal").style.display = "flex";
}

function openEditTaskModal(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    document.getElementById("modal-title").textContent = `Редактирование задачи [${task.code}]`;
    document.getElementById("task-id-input").value = task.id;
    document.getElementById("task-input-text").value = task.title;
    document.getElementById("task-ru-input").value = task.title;
    document.getElementById("task-kz-input").value = task.title_kz || "";
    document.getElementById("task-zone-input").value = task.zone || "Бережливое производство";
    document.getElementById("task-photo-input").value = task.photo_link || "";
    document.getElementById("task-author-input").value = task.author_name || "";
    document.getElementById("task-assignee-input").value = task.assignee_name || "";
    document.getElementById("task-due-input").value = task.due_date_str || "";
    document.getElementById("task-status-input").value = task.status || "⚪ В очереди";
    document.getElementById("task-comment-input").value = task.comment || "";

    document.getElementById("task-modal").style.display = "flex";
}

function closeTaskModal() {
    document.getElementById("task-modal").style.display = "none";
}

async function saveTaskModal() {
    const taskId = document.getElementById("task-id-input").value;
    const inputText = document.getElementById("task-input-text").value.trim();
    const titleRu = document.getElementById("task-ru-input").value.trim() || inputText;
    const titleKz = document.getElementById("task-kz-input").value.trim();
    const zone = document.getElementById("task-zone-input").value;
    const photoLink = document.getElementById("task-photo-input").value.trim();
    const author = document.getElementById("task-author-input").value;
    const assignee = document.getElementById("task-assignee-input").value;
    const due = document.getElementById("task-due-input").value.trim();
    const status = document.getElementById("task-status-input").value;
    const comment = document.getElementById("task-comment-input").value.trim();

    if (!titleRu) {
        alert("Пожалуйста, введите суть задачи!");
        return;
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
   MOVE TO NEXT WEEK & ARCHIVE
   ========================================================== */
async function moveTaskToNextWeekModal(taskId) {
    const weeks = allWeeksStructure[currentMonth] || [];
    const currentIdx = weeks.indexOf(currentWeek);
    let nextWeek = (currentIdx >= 0 && currentIdx < weeks.length - 1) ? weeks[currentIdx + 1] : prompt("Введите название следующей недели (напр. Неделя 1 (31.08 - 04.09)):");
    
    if (!nextWeek) return;

    try {
        const res = await fetch(`/api/tasks/${taskId}/move_next_week?next_week=${encodeURIComponent(nextWeek)}`, {
            method: "POST"
        });
        if (res.ok) {
            showToast(`Задача перенесена на: ${nextWeek}`);
            loadTasks();
        }
    } catch (e) {
        console.error("Move task error:", e);
    }
}

async function archiveCurrentWeek() {
    const weeks = allWeeksStructure[currentMonth] || [];
    const currentIdx = weeks.indexOf(currentWeek);
    const nextWeek = (currentIdx >= 0 && currentIdx < weeks.length - 1) ? weeks[currentIdx + 1] : "";

    const confirmMsg = `Завершить рабочую неделю «${currentWeek}»?\n\n• Задачи «Выполнено» будут перенесены в Архив.\n• Незавершенные задачи будут перенесены на ${nextWeek || 'следующую неделю'}.`;
    if (!confirm(confirmMsg)) return;

    try {
        const res = await fetch("/api/tasks/archive_week", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_week: currentWeek, next_week: nextWeek })
        });
        if (res.ok) {
            const data = await res.json();
            alert(`✅ ${data.message}`);
            if (nextWeek) {
                const weekSelect = document.getElementById("filter-week");
                if (weekSelect) weekSelect.value = nextWeek;
                currentWeek = nextWeek;
            }
            loadTasks();
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
