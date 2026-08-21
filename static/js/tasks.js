/**
 * Tectum Tasks — Task Tracker Client Logic
 * Mobile-first, Kazakh & Russian Speech-to-Text, Font-scale, Kanban & Analytics
 */

let allTasks = [];
let allWeeks = [];
let allMasters = [];
let allDocuments = [];
let currentUser = { name: "Левда М.", role: "admin", pin: "6282" };
let currentView = "list";
let activeCategory = "all";
let activeVoiceField = null;
let recognition = null;
let isRecording = false;

// Chart instances
let categoryChart = null;
let statusChart = null;
let assigneeChart = null;

// Initialize on Load
document.addEventListener("DOMContentLoaded", async () => {
    initTheme();
    initUser();
    initFontScale();
    initSpeechRecognition();
    await loadInitialMetadata();
    await loadTasks();
});

/* ==========================================================
   THEME MANAGEMENT (LIGHT ONLY)
   ========================================================== */
function initTheme() {
    applyTheme("light");
}

function toggleTasksTheme() {
    applyTheme("light");
}

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem("theme", "light");
}

/* ==========================================================
   USER MANAGEMENT & LOCALSTORAGE
   ========================================================== */
function initUser() {
    const savedUser = localStorage.getItem("tectum_task_user");
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
        } catch (e) {
            currentUser = { name: "Левда М.", role: "admin", pin: "6282" };
        }
    }
    updateUserBadge();
}

function updateUserBadge() {
    const label = document.getElementById("user-name-label");
    if (label) {
        label.textContent = currentUser.name || "Сотрудник";
    }
}

function openUserSwitchModal() {
    const modal = document.getElementById("user-switch-modal");
    const container = document.getElementById("user-profiles-grid");
    if (!modal || !container) return;

    const defaultProfiles = [
        { name: "Левда М.", role: "Администратор", pin: "6282" },
        { name: "Булеханов К.", role: "Начальник производства", pin: "2026" }
    ];

    // Merge with loaded masters
    let profiles = [...defaultProfiles];
    if (allMasters && allMasters.length > 0) {
        allMasters.forEach(m => {
            if (!profiles.some(p => p.name === m.name)) {
                profiles.push({ name: m.name, role: m.role || "Мастер", pin: m.pin || "1234" });
            }
        });
    }

    container.innerHTML = profiles.map(p => `
        <div onclick="selectUser('${p.name}', '${p.role}', '${p.pin}')" 
             style="background: rgba(255,255,255,0.05); border: 1px solid ${p.name === currentUser.name ? 'var(--task-primary)' : 'rgba(255,255,255,0.1)'}; padding: 0.75rem 1rem; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
            <div>
                <strong style="color: #f8fafc; font-size: 0.95rem;">${p.name}</strong>
                <div style="font-size: 0.75rem; color: #94a3b8;">${p.role}</div>
            </div>
            ${p.name === currentUser.name ? '<i class="fa-solid fa-check" style="color: var(--task-primary)"></i>' : ''}
        </div>
    `).join('');

    modal.style.display = "flex";
}

function closeUserSwitchModal() {
    const modal = document.getElementById("user-switch-modal");
    if (modal) modal.style.display = "none";
}

function selectUser(name, role, pin) {
    currentUser = { name, role, pin };
    localStorage.setItem("tectum_task_user", JSON.stringify(currentUser));
    updateUserBadge();
    closeUserSwitchModal();
    showToast(`Вы вошли как: ${name}`);
    applyFilters();
}

/* ==========================================================
   FONT SCALE TOGGLE
   ========================================================== */
function initFontScale() {
    const savedScale = localStorage.getItem("tectum_task_font_scale") || "standard";
    setFontScale(savedScale);
}

function cycleFontSize() {
    const scales = ["compact", "standard", "large", "xlarge"];
    const currentScale = localStorage.getItem("tectum_task_font_scale") || "standard";
    const nextIdx = (scales.indexOf(currentScale) + 1) % scales.length;
    setFontScale(scales[nextIdx]);
}

function setFontScale(scale) {
    document.body.classList.remove("font-compact", "font-large", "font-xlarge");
    const label = document.getElementById("font-scale-label");
    
    if (scale === "compact") {
        document.body.classList.add("font-compact");
        if (label) label.textContent = "A-";
    } else if (scale === "large") {
        document.body.classList.add("font-large");
        if (label) label.textContent = "A+";
    } else if (scale === "xlarge") {
        document.body.classList.add("font-xlarge");
        if (label) label.textContent = "A++";
    } else {
        if (label) label.textContent = "A";
    }
    
    localStorage.setItem("tectum_task_font_scale", scale);
}

/* ==========================================================
   SPEECH-TO-TEXT (KAZAKH & RUSSIAN)
   ========================================================== */
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn("Speech Recognition API is not supported in this browser.");
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            transcript += event.results[i][0].transcript;
        }

        if (activeVoiceField) {
            const inputEl = document.getElementById(activeVoiceField);
            if (inputEl) {
                // If it's the final result, append or set
                inputEl.value = (inputEl.dataset.prevVal ? inputEl.dataset.prevVal + " " : "") + transcript;
            }
        }
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        stopVoiceRecording();
        showToast("Ошибка распознавания: " + event.error);
    };

    recognition.onend = () => {
        stopVoiceRecording();
    };
}

function toggleVoiceInput(targetFieldId, btnId) {
    if (!recognition) {
        alert("Голосовой ввод не поддерживается вашим браузером. Рекомендуется использовать Chrome или мобильный браузер.");
        return;
    }

    if (isRecording && activeVoiceField === targetFieldId) {
        stopVoiceRecording();
        return;
    }

    // Start recording
    const langSelect = document.getElementById("voice-lang-select");
    const lang = langSelect ? langSelect.value : "ru-RU";
    recognition.lang = lang;

    const inputEl = document.getElementById(targetFieldId);
    if (inputEl) {
        inputEl.dataset.prevVal = inputEl.value;
    }

    activeVoiceField = targetFieldId;
    isRecording = true;

    const btn = document.getElementById(btnId);
    if (btn) {
        btn.classList.add("listening");
        btn.querySelector("span").textContent = "Слушаю...";
    }

    try {
        recognition.start();
        showToast(`🎤 Диктуйте на ${lang === "kk-KZ" ? "казахском" : "русском"} языке...`);
    } catch (e) {
        console.warn("Recognition already started or error:", e);
    }
}

function stopVoiceRecording() {
    isRecording = false;
    if (recognition) {
        try { recognition.stop(); } catch (e) {}
    }

    document.querySelectorAll(".btn-voice").forEach(btn => {
        btn.classList.remove("listening");
        const span = btn.querySelector("span");
        if (span) span.textContent = "Диктовка";
    });
    activeVoiceField = null;
}

/* ==========================================================
   METADATA & INITIAL DATA
   ========================================================== */
async function loadInitialMetadata() {
    try {
        // 1. Weeks
        const weeksRes = await fetch("/api/tasks/weeks");
        if (weeksRes.ok) {
            const data = await weeksRes.json();
            allWeeks = data.weeks || [];
            populateWeekDropdowns();
        }

        // 2. Masters (Assignees)
        const mastersRes = await fetch("/api/masters/");
        if (mastersRes.ok) {
            allMasters = await mastersRes.json();
            populateAssigneeDropdown();
        }

        // 3. Documents (Cloud Base)
        const docsRes = await fetch("/api/documents/list");
        if (docsRes.ok) {
            allDocuments = await docsRes.json();
            populateDocsDropdown();
        }
    } catch (e) {
        console.error("Error loading metadata:", e);
    }
}

function populateWeekDropdowns() {
    const filterSelect = document.getElementById("filter-week");
    const modalSelect = document.getElementById("task-week-input");

    if (filterSelect) {
        const currentVal = filterSelect.value;
        filterSelect.innerHTML = `<option value="all">📅 Все недели</option>` + 
            allWeeks.map(w => `<option value="${w}">${w}</option>`).join('');
        if (currentVal) filterSelect.value = currentVal;
    }

    if (modalSelect) {
        modalSelect.innerHTML = allWeeks.map(w => `<option value="${w}">${w}</option>`).join('');
    }
}

function populateAssigneeDropdown() {
    const select = document.getElementById("task-assignee-input");
    if (!select) return;

    let options = `<option value="">-- Выберите ответственного --</option>`;
    
    // Core users first
    options += `<option value="master_levda">Левда М. (Специалист БП)</option>`;
    options += `<option value="master_bulekhanov">Булеханов К. (Начальник производства)</option>`;

    // Masters from DB
    if (allMasters && allMasters.length > 0) {
        allMasters.forEach(m => {
            if (!m.name.includes("Левда") && !m.name.includes("Булеханов")) {
                options += `<option value="${m.id}">${m.name} (${m.role || 'Мастер'})</option>`;
            }
        });
    }

    select.innerHTML = options;
}

function populateDocsDropdown() {
    const select = document.getElementById("task-doc-input");
    if (!select) return;

    let options = `<option value="">-- Без документа --</option>`;
    if (allDocuments && allDocuments.length > 0) {
        allDocuments.forEach(doc => {
            options += `<option value="${doc.id}">📄 ${doc.title}</option>`;
        });
    }
    select.innerHTML = options;
}

/* ==========================================================
   TASK FETCHING & FILTERING
   ========================================================== */
async function loadTasks() {
    try {
        const res = await fetch("/api/tasks");
        if (res.ok) {
            allTasks = await res.json();
            renderDashboardKPIs();
            renderCurrentView();
        }
    } catch (e) {
        console.error("Error loading tasks:", e);
    }
}

function getFilteredTasks() {
    const userScope = document.getElementById("filter-user-scope") ? document.getElementById("filter-user-scope").value : "all";
    const week = document.getElementById("filter-week") ? document.getElementById("filter-week").value : "all";
    const status = document.getElementById("filter-status") ? document.getElementById("filter-status").value : "all";
    const search = document.getElementById("filter-search") ? document.getElementById("filter-search").value.toLowerCase().trim() : "";

    return allTasks.filter(t => {
        // User Scope Filter
        if (userScope === "my") {
            const assignee = (t.assigned_master_name || t.assignee_custom || "").toLowerCase();
            const curr = (currentUser.name || "").toLowerCase();
            if (!assignee.includes(curr) && !curr.includes(assignee)) return false;
        }

        // Week Filter
        if (week !== "all" && t.week_label !== week) return false;

        // Category Filter
        if (activeCategory !== "all" && t.category !== activeCategory) return false;

        // Status Filter
        if (status !== "all" && t.status !== status) return false;

        // Search Filter
        if (search) {
            const title = (t.title || "").toLowerCase();
            const desc = (t.description || "").toLowerCase();
            const assignee = (t.assigned_master_name || t.assignee_custom || "").toLowerCase();
            if (!title.includes(search) && !desc.includes(search) && !assignee.includes(search)) return false;
        }

        return true;
    });
}

function applyFilters() {
    renderCurrentView();
}

let debounceTimer = null;
function debounceApplyFilters() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 250);
}

function selectCategoryChip(cat) {
    activeCategory = cat;
    document.querySelectorAll(".category-chip").forEach(chip => {
        if (chip.dataset.cat === cat) chip.classList.add("active");
        else chip.classList.remove("active");
    });
    applyFilters();
}

/* ==========================================================
   VIEW SWITCHING
   ========================================================== */
function switchView(view) {
    currentView = view;
    document.querySelectorAll(".view-btn").forEach(btn => btn.classList.remove("active"));
    
    const activeBtn = document.getElementById(`view-btn-${view}`);
    if (activeBtn) activeBtn.classList.add("active");

    document.getElementById("view-list-container").style.display = view === "list" ? "block" : "none";
    document.getElementById("view-kanban-container").style.display = view === "kanban" ? "block" : "none";
    document.getElementById("view-analytics-container").style.display = view === "analytics" ? "block" : "none";

    renderCurrentView();
}

function renderCurrentView() {
    if (currentView === "list") {
        renderTaskList();
    } else if (currentView === "kanban") {
        renderKanban();
    } else if (currentView === "analytics") {
        renderAnalytics();
    }
}

/* ==========================================================
   KPI DASHBOARD RENDERING
   ========================================================== */
function renderDashboardKPIs() {
    const total = allTasks.length;
    const completed = allTasks.filter(t => t.status === "Выполнено").length;
    const inProgress = allTasks.filter(t => t.status === "В процессе").length;
    const postponed = allTasks.filter(t => t.status === "Перенесено").length;

    const todayStr = new Date().toISOString().split("T")[0];
    const overdue = allTasks.filter(t => t.status !== "Выполнено" && t.status !== "Отменено" && t.due_date && t.due_date < todayStr).length;

    const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    
    setVal("kpi-total", total);
    setVal("kpi-completed", completed);
    setVal("kpi-in-progress", inProgress);
    setVal("kpi-postponed", postponed);
    setVal("kpi-overdue", overdue);
    setVal("progress-pct-label", `${progressPct}%`);

    const bar = document.getElementById("progress-bar-fill");
    if (bar) bar.style.width = `${progressPct}%`;
}

/* ==========================================================
   VIEW 1: TASK LIST CARDS RENDERING
   ========================================================== */
function renderTaskList() {
    const container = document.getElementById("task-cards-container");
    if (!container) return;

    const tasks = getFilteredTasks();
    if (tasks.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 3rem 1rem; color: #64748b; background: #1e293b; border-radius: 12px; border: 1px dashed rgba(255,255,255,0.1)">
                <i class="fa-solid fa-list-check" style="font-size: 2.5rem; margin-bottom: 0.8rem; opacity: 0.4;"></i>
                <div style="font-size: 1.1rem; font-weight: 600; color: #94a3b8;">Задач не найдено</div>
                <div style="font-size: 0.85rem; margin-top: 0.3rem;">Попробуйте изменить фильтры или добавьте новую задачу с помощью кнопки +</div>
            </div>
        `;
        return;
    }

    const todayStr = new Date().toISOString().split("T")[0];

    container.innerHTML = tasks.map(t => {
        let statusClass = "status-planned";
        if (t.status === "Выполнено") statusClass = "status-done";
        else if (t.status === "В процессе") statusClass = "status-in-progress";
        else if (t.status === "Перенесено") statusClass = "status-postponed";

        const isOverdue = t.status !== "Выполнено" && t.status !== "Отменено" && t.due_date && t.due_date < todayStr;
        
        let priorityClass = "medium";
        if (t.priority === "Высокий" || t.priority === "Критический") priorityClass = "high";
        else if (t.priority === "Низкий") priorityClass = "low";

        const assigneeName = t.assigned_master_name || t.assignee_custom || "Не назначен";
        const formattedDate = t.due_date ? formatDate(t.due_date) : "Без срока";

        // Attached doc or Google Doc
        let docPill = "";
        if (t.google_doc_url) {
            docPill = `<a href="${t.google_doc_url}" target="_blank" class="doc-link-pill"><i class="fa-brands fa-google-drive"></i> Google Doc</a>`;
        } else if (t.attached_document_id) {
            docPill = `<a href="/api/documents/download/${t.attached_document_id}" target="_blank" class="doc-link-pill"><i class="fa-solid fa-file-lines"></i> ${t.attached_document_title || 'Документ'}</a>`;
        }

        return `
            <div class="task-card ${statusClass}">
                <div class="task-card-header">
                    <div class="task-badges">
                        <span class="badge-cat">${t.category || 'Общее'}</span>
                        <span class="badge-priority ${priorityClass}">${t.priority || 'Средний'}</span>
                        ${t.week_label ? `<span style="font-size: 0.75rem; color: #94a3b8;"><i class="fa-regular fa-calendar"></i> ${t.week_label}</span>` : ''}
                    </div>

                    <!-- Quick Status Change Dropdown / Buttons -->
                    <div class="task-actions-row">
                        ${t.status !== 'Выполнено' ? `
                            <button class="btn-status-quick done" onclick="quickChangeStatus(${t.id}, 'Выполнено')" title="Отметить выполненным">
                                <i class="fa-solid fa-check"></i>
                            </button>
                        ` : ''}
                        ${t.status === 'Запланировано' ? `
                            <button class="btn-status-quick work" onclick="quickChangeStatus(${t.id}, 'В процессе')" title="Взять в работу">
                                <i class="fa-solid fa-play"></i>
                            </button>
                        ` : ''}
                        <button class="btn-icon-round" style="padding: 0.3rem 0.5rem; font-size: 0.75rem;" onclick="openEditTaskModal(${t.id})" title="Редактировать">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                    </div>
                </div>

                <div class="task-title" onclick="openEditTaskModal(${t.id})" style="cursor: pointer;">${t.title}</div>
                ${t.description ? `<div class="task-desc">${t.description}</div>` : ''}

                <div class="task-meta-row">
                    <div class="task-meta-left">
                        <div class="task-meta-item">
                            <i class="fa-solid fa-user-circle" style="color: #60a5fa"></i> ${assigneeName}
                        </div>
                        <div class="task-meta-item ${isOverdue ? 'overdue' : ''}">
                            <i class="fa-regular fa-calendar-check"></i> ${formattedDate} ${isOverdue ? '(Просрочено!)' : ''}
                        </div>
                        ${docPill}
                    </div>

                    <div style="font-size: 0.75rem; font-weight: 600; color: ${getStatusColor(t.status)}">
                        ${t.status}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/* ==========================================================
   VIEW 2: KANBAN BOARD RENDERING
   ========================================================== */
function renderKanban() {
    const tasks = getFilteredTasks();

    const cols = {
        "Запланировано": document.getElementById("kanban-cards-planned"),
        "В процессе": document.getElementById("kanban-cards-in-progress"),
        "Перенесено": document.getElementById("kanban-cards-postponed"),
        "Выполнено": document.getElementById("kanban-cards-done")
    };

    const counts = {
        "Запланировано": document.getElementById("kanban-count-planned"),
        "В процессе": document.getElementById("kanban-count-in-progress"),
        "Перенесено": document.getElementById("kanban-count-postponed"),
        "Выполнено": document.getElementById("kanban-count-done")
    };

    Object.values(cols).forEach(col => { if (col) col.innerHTML = ""; });

    const grouped = { "Запланировано": [], "В процессе": [], "Перенесено": [], "Выполнено": [] };

    tasks.forEach(t => {
        const st = t.status || "Запланировано";
        if (grouped[st]) grouped[st].push(t);
        else grouped["Запланировано"].push(t);
    });

    Object.keys(grouped).forEach(st => {
        if (counts[st]) counts[st].textContent = grouped[st].length;

        const colEl = cols[st];
        if (!colEl) return;

        if (grouped[st].length === 0) {
            colEl.innerHTML = `<div style="text-align: center; padding: 2rem 0; color: #64748b; font-size: 0.85rem;">Пусто</div>`;
            return;
        }

        colEl.innerHTML = grouped[st].map(t => {
            let priorityClass = "medium";
            if (t.priority === "Высокий" || t.priority === "Критический") priorityClass = "high";
            else if (t.priority === "Низкий") priorityClass = "low";

            const assigneeName = t.assigned_master_name || t.assignee_custom || "Не назначен";

            return `
                <div class="task-card" style="margin-bottom: 0.6rem; padding: 0.75rem; cursor: pointer;" onclick="openEditTaskModal(${t.id})">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem;">
                        <span class="badge-cat" style="font-size: 0.7rem;">${t.category}</span>
                        <span class="badge-priority ${priorityClass}" style="font-size: 0.7rem;">${t.priority}</span>
                    </div>
                    <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 0.4rem; color: #f8fafc;">${t.title}</div>
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: #94a3b8; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 0.4rem;">
                        <span><i class="fa-solid fa-user"></i> ${assigneeName}</span>
                        <span>${t.due_date ? formatDate(t.due_date) : ''}</span>
                    </div>
                </div>
            `;
        }).join('');
    });
}

/* ==========================================================
   VIEW 3: ANALYTICS RENDERING (CHART.JS)
   ========================================================== */
async function renderAnalytics() {
    const week = document.getElementById("filter-week") ? document.getElementById("filter-week").value : "all";
    try {
        const res = await fetch(`/api/tasks/analytics?week=${encodeURIComponent(week)}`);
        if (!res.ok) return;
        const data = await res.json();

        // 1. Categories Chart (Doughnut)
        const catCanvas = document.getElementById("chart-categories");
        if (catCanvas) {
            if (categoryChart) categoryChart.destroy();
            const catLabels = Object.keys(data.by_category || {});
            const catValues = Object.values(data.by_category || {});

            categoryChart = new Chart(catCanvas, {
                type: 'doughnut',
                data: {
                    labels: catLabels,
                    datasets: [{
                        data: catValues,
                        backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316', '#64748b']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: '#cbd5e1', font: { family: 'Inter', size: 11 } } }
                    }
                }
            });
        }

        // 2. Statuses Chart (Pie)
        const statusCanvas = document.getElementById("chart-statuses");
        if (statusCanvas) {
            if (statusChart) statusChart.destroy();
            statusChart = new Chart(statusCanvas, {
                type: 'pie',
                data: {
                    labels: ['Выполнено', 'В процессе', 'Запланировано', 'Перенесено'],
                    datasets: [{
                        data: [data.completed_tasks, data.in_progress_tasks, data.planned_tasks, data.postponed_tasks],
                        backgroundColor: ['#10b981', '#f59e0b', '#64748b', '#06b6d4']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: '#cbd5e1', font: { family: 'Inter', size: 11 } } }
                    }
                }
            });
        }

        // 3. Assignees Chart (Bar)
        const assigneeCanvas = document.getElementById("chart-assignees");
        if (assigneeCanvas) {
            if (assigneeChart) assigneeChart.destroy();
            const names = Object.keys(data.by_assignee || {});
            const completedVals = names.map(n => data.by_assignee[n].completed || 0);
            const inProgressVals = names.map(n => data.by_assignee[n].in_progress || 0);
            const totalVals = names.map(n => data.by_assignee[n].total || 0);

            assigneeChart = new Chart(assigneeCanvas, {
                type: 'bar',
                data: {
                    labels: names,
                    datasets: [
                        { label: 'Выполнено', data: completedVals, backgroundColor: '#10b981' },
                        { label: 'В процессе', data: inProgressVals, backgroundColor: '#f59e0b' },
                        { label: 'Всего задач', data: totalVals, backgroundColor: '#3b82f6' }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                        y: { ticks: { color: '#cbd5e1', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.05)' } }
                    },
                    plugins: {
                        legend: { labels: { color: '#cbd5e1', font: { family: 'Inter', size: 12 } } }
                    }
                }
            });
        }
    } catch (e) {
        console.error("Error building charts:", e);
    }
}

/* ==========================================================
   CRUD & MODAL ACTIONS
   ========================================================== */
function openTaskModal() {
    stopVoiceRecording();
    document.getElementById("modal-task-title").textContent = "Новая задача";
    document.getElementById("task-id-input").value = "";
    document.getElementById("task-title-input").value = "";
    document.getElementById("task-desc-input").value = "";
    document.getElementById("task-category-input").value = activeCategory !== "all" ? activeCategory : "СКК";
    document.getElementById("task-priority-input").value = "Средний";
    document.getElementById("task-status-input").value = "Запланировано";

    const filterWeek = document.getElementById("filter-week").value;
    document.getElementById("task-week-input").value = filterWeek !== "all" ? filterWeek : (allWeeks[0] || "");

    document.getElementById("task-assignee-input").value = currentUser.name.includes("Левда") ? "master_levda" : (currentUser.name.includes("Булеханов") ? "master_bulekhanov" : "");
    document.getElementById("task-duedate-input").value = new Date().toISOString().split("T")[0];
    document.getElementById("task-doc-input").value = "";
    document.getElementById("google-doc-link-container").innerHTML = "";

    document.getElementById("task-modal").style.display = "flex";
}

function openEditTaskModal(taskId) {
    stopVoiceRecording();
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    document.getElementById("modal-task-title").textContent = `Редактирование задачи #${task.id}`;
    document.getElementById("task-id-input").value = task.id;
    document.getElementById("task-title-input").value = task.title || "";
    document.getElementById("task-desc-input").value = task.description || "";
    document.getElementById("task-category-input").value = task.category || "Производство";
    document.getElementById("task-priority-input").value = task.priority || "Средний";
    document.getElementById("task-status-input").value = task.status || "Запланировано";
    document.getElementById("task-week-input").value = task.week_label || (allWeeks[0] || "");

    // Assignee
    const selectAssignee = document.getElementById("task-assignee-input");
    if (task.assignee_custom && task.assignee_custom.includes("Левда")) {
        selectAssignee.value = "master_levda";
    } else if (task.assignee_custom && task.assignee_custom.includes("Булеханов")) {
        selectAssignee.value = "master_bulekhanov";
    } else if (task.assigned_master_id) {
        selectAssignee.value = task.assigned_master_id;
    } else {
        selectAssignee.value = "";
    }

    document.getElementById("task-duedate-input").value = task.due_date || "";
    document.getElementById("task-doc-input").value = task.attached_document_id || "";

    // Google doc link
    const gLink = document.getElementById("google-doc-link-container");
    if (task.google_doc_url) {
        gLink.innerHTML = `<a href="${task.google_doc_url}" target="_blank" class="doc-link-pill" style="margin-left: 0.5rem;"><i class="fa-brands fa-google-drive"></i> Открыть Google Doc</a>`;
    } else {
        gLink.innerHTML = "";
    }

    document.getElementById("task-modal").style.display = "flex";
}

function closeTaskModal() {
    stopVoiceRecording();
    document.getElementById("task-modal").style.display = "none";
}

async function saveTaskFromModal() {
    const taskId = document.getElementById("task-id-input").value;
    const title = document.getElementById("task-title-input").value.trim();
    if (!title) {
        alert("Пожалуйста, введите название задачи");
        return;
    }

    const desc = document.getElementById("task-desc-input").value.trim();
    const category = document.getElementById("task-category-input").value;
    const priority = document.getElementById("task-priority-input").value;
    const status = document.getElementById("task-status-input").value;
    const week_label = document.getElementById("task-week-input").value;
    const due_date = document.getElementById("task-duedate-input").value || null;
    const attached_doc_id = document.getElementById("task-doc-input").value ? parseInt(document.getElementById("task-doc-input").value) : null;

    const assigneeVal = document.getElementById("task-assignee-input").value;
    let assigned_master_id = null;
    let assignee_custom = null;

    if (assigneeVal === "master_levda") {
        assignee_custom = "Левда М.";
    } else if (assigneeVal === "master_bulekhanov") {
        assignee_custom = "Булеханов К.";
    } else if (assigneeVal) {
        assigned_master_id = parseInt(assigneeVal);
    }

    const payload = {
        title,
        description: desc,
        category,
        priority,
        status,
        week_label,
        due_date,
        attached_document_id: attached_doc_id,
        assigned_master_id,
        assignee_custom,
        creator_name: currentUser.name
    };

    try {
        let res;
        if (taskId) {
            // Update
            res = await fetch(`/api/tasks/${taskId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        } else {
            // Create
            res = await fetch("/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        }

        if (res.ok) {
            closeTaskModal();
            showToast(taskId ? "Задача успешно обновлена!" : "Новая задача создана!");
            await loadTasks();
        } else {
            const err = await res.json();
            alert("Ошибка сохранения: " + (err.detail || "Неизвестная ошибка"));
        }
    } catch (e) {
        console.error("Error saving task:", e);
        alert("Ошибка сети при сохранении задачи");
    }
}

async function quickChangeStatus(taskId, newStatus) {
    try {
        const res = await fetch(`/api/tasks/${taskId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus })
        });

        if (res.ok) {
            showToast(`Статус задачи #${taskId} изменён на "${newStatus}"`);
            await loadTasks();
        }
    } catch (e) {
        console.error("Error updating status:", e);
    }
}

async function createGoogleDocForCurrentTask() {
    const taskId = document.getElementById("task-id-input").value;
    if (!taskId) {
        alert("Сначала сохраните задачу, чтобы создать для неё Google Документ.");
        return;
    }

    showToast("Создание Google Документа...");
    try {
        const res = await fetch(`/api/tasks/${taskId}/create_google_doc`, { method: "POST" });
        if (res.ok) {
            const data = await res.json();
            showToast("Google Документ создан!");
            const gLink = document.getElementById("google-doc-link-container");
            if (gLink && data.url) {
                gLink.innerHTML = `<a href="${data.url}" target="_blank" class="doc-link-pill" style="margin-left: 0.5rem;"><i class="fa-brands fa-google-drive"></i> Открыть Google Doc</a>`;
            }
            await loadTasks();
        } else {
            alert("Не удалось создать Google Документ. Проверьте настройки Google Drive.");
        }
    } catch (e) {
        console.error("Error creating Google doc:", e);
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
