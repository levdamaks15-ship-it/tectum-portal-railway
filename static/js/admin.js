// Prevent aggressive caching of GET requests in mobile browsers
const originalFetch = window.fetch;
window.fetch = function (url, options) {
    if (typeof url === 'string' && url.startsWith('/api/') && (!options || !options.method || options.method.toUpperCase() === 'GET')) {
        const separator = url.includes('?') ? '&' : '?';
        url = `${url}${separator}_ts=${Date.now()}`;
    }
    return originalFetch(url, options);
};

// Global handler: prevent mouse wheel from changing input[type="number"] values
document.addEventListener('wheel', function (e) {
    if (document.activeElement && document.activeElement.type === 'number') {
        document.activeElement.blur();
    }
}, { passive: true });

let currentAdmin = null;

function initAdminLogin() {
    const pinInput = document.getElementById('admin-pin');
    if (pinInput) {
        pinInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') adminLogin();
        });
        pinInput.focus();
    }
}

async function adminLogin() {
    const pin = document.getElementById('admin-pin').value;
    if (!pin) return;

    try {
        const loginRes = await fetch('/api/admin/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ pin: pin })
        });

        if (loginRes.ok) {
            const data = await loginRes.json();
            currentAdmin = data;
            document.getElementById('admin-login-screen').style.display = 'none';
            document.getElementById('admin-app').style.display = 'flex';
            loadMasters();
            loadNorms();
        } else {
            throw new Error("Неверный ПИН-код или нет прав");
        }
    } catch (e) {
        const errEl = document.getElementById('admin-login-error');
        if (errEl) {
            errEl.innerText = "Неверный ПИН-код или нет прав администратора.";
            errEl.style.display = 'block';
        }
    }
}

// Call init on load
window.addEventListener('DOMContentLoaded', initAdminLogin);



function toggleAdminSidebar(forceState) {
    const sidebar = document.getElementById('admin-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!sidebar) return;

    if (forceState !== undefined) {
        if (forceState) {
            sidebar.classList.add('open');
            if (backdrop) backdrop.classList.add('active');
        } else {
            sidebar.classList.remove('open');
            if (backdrop) backdrop.classList.remove('active');
        }
    } else {
        const isOpen = sidebar.classList.toggle('open');
        if (backdrop) {
            if (isOpen) backdrop.classList.add('active');
            else backdrop.classList.remove('active');
        }
    }
}

function switchAdminTab(tabId) {
    document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.remove('active'));
    const activeNav = document.getElementById('nav-' + tabId);
    if (activeNav) activeNav.classList.add('active');
    
    const tabMasters = document.getElementById('tab-masters'); if (tabMasters) tabMasters.style.display = 'none';
    const tabNorms = document.getElementById('tab-norms'); if (tabNorms) tabNorms.style.display = 'none';
    const tabPlanBoard = document.getElementById('tab-plan-board'); if (tabPlanBoard) tabPlanBoard.style.display = 'none';
    const tabShifts = document.getElementById('tab-shifts'); if (tabShifts) tabShifts.style.display = 'none';
    const tabReceipts = document.getElementById('tab-receipts'); if (tabReceipts) tabReceipts.style.display = 'none';
    const tabCleanup = document.getElementById('tab-cleanup'); if (tabCleanup) tabCleanup.style.display = 'none';
    const tabAuditLogs = document.getElementById('tab-audit-logs'); if (tabAuditLogs) tabAuditLogs.style.display = 'none';
    const tabDowntimes = document.getElementById('tab-downtimes-dir'); if (tabDowntimes) tabDowntimes.style.display = 'none';
    const tabDowntimesLog = document.getElementById('tab-downtimes-log'); if (tabDowntimesLog) tabDowntimesLog.style.display = 'none';
    const tabPlannerSettings = document.getElementById('tab-planner-settings'); if (tabPlannerSettings) tabPlannerSettings.style.display = 'none';
    const tabPasswords = document.getElementById('tab-passwords'); if (tabPasswords) tabPasswords.style.display = 'none';
    const tabChecklistEmps = document.getElementById('tab-checklist-emps'); if (tabChecklistEmps) tabChecklistEmps.style.display = 'none';
    const tabShiftSchedule = document.getElementById('tab-shift-schedule'); if (tabShiftSchedule) tabShiftSchedule.style.display = 'none';
    
    const targetTab = document.getElementById('tab-' + tabId);
    if (targetTab) targetTab.style.display = 'block';

    // Auto-close sidebar on mobile after selecting a tab
    if (window.innerWidth <= 900) {
        toggleAdminSidebar(false);
    }

    if (tabId === 'plan-board') {
        loadPlanBoard();
    } else if (tabId === 'audit-logs') {
        loadAuditLogs();
    } else if (tabId === 'shifts') {
        loadShifts();
    } else if (tabId === 'receipts') {
        loadAdminReceipts();
    } else if (tabId === 'downtimes-dir') {
        loadDowntimesDir();
    } else if (tabId === 'downtimes-log') {
        loadDowntimesLog();
    } else if (tabId === 'planner-settings') {
        loadPlannerSettings();
    } else if (tabId === 'passwords') {
        loadPasswords();
    } else if (tabId === 'checklist-emps') {
        loadAdminChecklistEmployees();
    } else if (tabId === 'shift-schedule') {
        loadAdminShiftSchedule();
    }
}

function closeModals() {
    closePlannerModals();
    const clEmpModal = document.getElementById('checklist-emp-modal');
    if (clEmpModal) clEmpModal.style.display = 'none';
    const schedModal = document.getElementById('shift-schedule-modal');
    if (schedModal) schedModal.style.display = 'none';
    document.getElementById('master-modal').style.display = 'none';
    document.getElementById('norm-modal').style.display = 'none';
    const shiftModal = document.getElementById('shift-modal');
    if (shiftModal) shiftModal.style.display = 'none';
    const shiftDetailsModal = document.getElementById('shift-details-modal');
    if (shiftDetailsModal) shiftDetailsModal.style.display = 'none';
    const dtDirModal = document.getElementById('downtime-dir-modal');
    if (dtDirModal) dtDirModal.style.display = 'none';
    const uniModal = document.getElementById('unified-shift-modal');
    if (uniModal) uniModal.style.display = 'none';
    const editDtModal = document.getElementById('edit-downtime-modal');
    if (editDtModal) editDtModal.style.display = 'none';
    const receiptModal = document.getElementById('edit-receipt-modal');
    if (receiptModal) receiptModal.style.display = 'none';
    if (editDtModal) editDtModal.style.display = 'none';
}



// --- MASTERS CRUD ---

async function loadMasters() {
    const res = await fetch('/api/masters/');
    const data = await res.json();
    const tbody = document.getElementById('masters-table-body');
    tbody.innerHTML = '';
    
    data.forEach(m => {
        tbody.innerHTML += `
            <tr>
                <td>${m.id}</td>
                <td>${m.name}</td>
                <td>${m.role}</td>
                <td>${m.email || '-'}</td>
                <td>
                    <button class="action-btn btn-edit" onclick='editMaster(${JSON.stringify(m)})'><i class="fa-solid fa-pen"></i></button>
                    <button class="action-btn btn-delete" onclick="deleteMaster(${m.id})"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
}

function openMasterModal() {
    document.getElementById('master-id').value = '';
    document.getElementById('master-name').value = '';
    document.getElementById('master-pin').value = '';
    document.getElementById('master-email').value = '';
    document.getElementById('master-role').value = 'master';
    document.getElementById('master-modal-title').innerText = "Добавить сотрудника";
    document.getElementById('master-modal').style.display = 'flex';
}

function editMaster(m) {
    document.getElementById('master-id').value = m.id;
    document.getElementById('master-name').value = m.name;
    document.getElementById('master-pin').value = ''; // Don't show existing pin
    document.getElementById('master-pin').placeholder = 'Оставьте пустым, чтобы не менять';
    document.getElementById('master-email').value = m.email || '';
    document.getElementById('master-role').value = m.role;
    document.getElementById('master-modal-title').innerText = "Редактировать сотрудника";
    document.getElementById('master-modal').style.display = 'flex';
}

async function saveMaster() {
    const id = document.getElementById('master-id').value;
    const data = {
        name: document.getElementById('master-name').value,
        role: document.getElementById('master-role').value,
        email: document.getElementById('master-email').value || null
    };
    
    const pin = document.getElementById('master-pin').value;
    if (pin) data.pin = pin;

    const url = id ? `/api/admin/masters/${id}` : '/api/admin/masters/';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
        method: method,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });

    if (res.ok) {
        closeModals();
        loadMasters();
    } else {
        alert("Ошибка при сохранении сотрудника");
    }
}

async function deleteMaster(id) {
    if (!confirm("Вы уверены, что хотите удалить этого сотрудника?")) return;
    try {
        const res = await fetch(`/api/admin/masters/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadMasters();
        } else {
            const err = await res.json();
            alert(err.detail || "Ошибка при удалении");
        }
    } catch(e) {
        console.error(e);
        alert("Ошибка сети при удалении");
    }
}

// --- NORMS CRUD ---

async function loadNorms() {
    const res = await fetch('/api/norms/');
    const data = await res.json();
    const tbody = document.getElementById('norms-table-body');
    tbody.innerHTML = '';
    
    data.forEach(n => {
        tbody.innerHTML += `
            <tr>
                <td>${n.product_name}</td>
                <td>${n.weight_kg || 0}</td>
                <td>${n.norm_chrysotile_4_20 || 0}</td>
                <td>${n.norm_chrysotile_5_65 || 0}</td>
                <td>${n.norm_chrysotile_6_40 || 0}</td>
                <td>${n.norm_cement || 0}</td>
                <td>${n.norm_cellulose || 0}</td>
                <td>${n.norm_crushed_slate || 0}</td>
                <td>${n.norm_asbozurit || 0}</td>
                <td>${n.norm_fiberglass || 0}</td>
                <td>
                    <button class="action-btn btn-edit" onclick='editNorm(${JSON.stringify(n)})'><i class="fa-solid fa-pen"></i></button>
                    <button class="action-btn btn-delete" onclick="deleteNorm(${n.id})"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
}

function openNormModal() {
    document.getElementById('norm-id').value = '';
    document.getElementById('norm-name').value = '';
    document.getElementById('norm-weight').value = 0;
    document.getElementById('norm-cement').value = 0;
    document.getElementById('norm-chr420').value = 0;
    document.getElementById('norm-chr565').value = 0;
    document.getElementById('norm-chr640').value = 0;
    document.getElementById('norm-cel').value = 0;
    document.getElementById('norm-slate').value = 0;
    document.getElementById('norm-asb').value = 0;
    document.getElementById('norm-fib').value = 0;
    document.getElementById('norm-modal-title').innerText = "Добавить норму";
    document.getElementById('norm-modal').style.display = 'flex';
}

function editNorm(n) {
    document.getElementById('norm-id').value = n.id;
    document.getElementById('norm-name').value = n.product_name;
    document.getElementById('norm-weight').value = n.weight_kg || 0;
    document.getElementById('norm-cement').value = n.norm_cement || 0;
    document.getElementById('norm-chr420').value = n.norm_chrysotile_4_20 || 0;
    document.getElementById('norm-chr565').value = n.norm_chrysotile_5_65 || 0;
    document.getElementById('norm-chr640').value = n.norm_chrysotile_6_40 || 0;
    document.getElementById('norm-cel').value = n.norm_cellulose || 0;
    document.getElementById('norm-slate').value = n.norm_crushed_slate || 0;
    document.getElementById('norm-asb').value = n.norm_asbozurit || 0;
    document.getElementById('norm-fib').value = n.norm_fiberglass || 0;
    document.getElementById('norm-modal-title').innerText = "Редактировать норму";
    document.getElementById('norm-modal').style.display = 'flex';
}

async function saveNorm() {
    const id = document.getElementById('norm-id').value;
    const data = {
        product_name: document.getElementById('norm-name').value,
        weight_kg: parseFloat(document.getElementById('norm-weight').value) || 0,
        norm_cement: parseFloat(document.getElementById('norm-cement').value) || 0,
        norm_chrysotile_4_20: parseFloat(document.getElementById('norm-chr420').value) || 0,
        norm_chrysotile_5_65: parseFloat(document.getElementById('norm-chr565').value) || 0,
        norm_chrysotile_6_40: parseFloat(document.getElementById('norm-chr640').value) || 0,
        norm_cellulose: parseFloat(document.getElementById('norm-cel').value) || 0,
        norm_crushed_slate: parseFloat(document.getElementById('norm-slate').value) || 0,
        norm_asbozurit: parseFloat(document.getElementById('norm-asb').value) || 0,
        norm_fiberglass: parseFloat(document.getElementById('norm-fib').value) || 0
    };

    const url = id ? `/api/admin/norms/${id}` : '/api/admin/norms/';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
        method: method,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });

    if (res.ok) {
        closeModals();
        loadNorms();
    } else {
        alert("Ошибка при сохранении нормы");
    }
}

async function deleteNorm(id) {
    if (!confirm("Вы уверены, что хотите удалить эту норму? Это может сломать расчеты для старых отчетов.")) return;
    const res = await fetch(`/api/admin/norms/${id}`, { method: 'DELETE' });
    if (res.ok) {
        loadNorms();
    } else {
        alert("Ошибка при удалении");
    }
}

// --- CLEANUP ---

async function clearOperationalData() {
    if (!confirm("ВНИМАНИЕ! Вы собираетесь БЕЗВОЗВРАТНО удалить все записи о сменах, рапортах ЛФМ, простоях и партиях продукции.")) {
        return;
    }
    const pwd1 = prompt("Введите пароль администратора для подтверждения сброса данных:");
    if (!pwd1) {
        alert("Очистка отменена: пароль не введен.");
        return;
    }
    if (pwd1 !== "VjzJ,jhjyf15") {
        alert("Неверный пароль администратора. Очистка отменена.");
        return;
    }

    const pwd2 = prompt("ПОДТВЕРДИТЕ ЕЩЕ РАЗ: Повторите пароль для окончательного сброса базы:");
    if (pwd2 !== "VjzJ,jhjyf15") {
        alert("Пароли не совпадают или неверны. Очистка отменена.");
        return;
    }

    try {
        const res = await fetch('/api/admin/clear_data/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pwd2 })
        });
        if (res.ok) {
            const data = await res.json();
            alert(`Данные успешно очищены!\nУдалено смен: ${data.deleted.shifts}\nПартий: ${data.deleted.batches}\nПростоев: ${data.deleted.downtimes}\nЗаписей выработки: ${data.deleted.plan_board}`);
            loadShifts();
            if (typeof loadAuditLogs === 'function') loadAuditLogs();
        } else {
            const err = await res.json();
            alert("Ошибка при очистке БД: " + (err.detail || "Доступ запрещен"));
        }
    } catch (e) {
        alert("Сетевая ошибка при очистке БД.");
    }
}



// --- PLAN BOARD ---
async function loadPlanBoard() {
    try {
        const res = await fetch('/api/plan_board');
        const data = await res.json();
        const tbody = document.getElementById('plan-board-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;">Нет данных</td></tr>`;
            return;
        }
        
        const isAdmin = currentAdmin && currentAdmin.role === 'admin';
        
        data.forEach(p => {
            const masterName = p.master ? p.master.name : 'Н/Д';
            
            const actionsHtml = isAdmin ? `
                <div style="display: flex; gap: 0.25rem;">
                    <button class="btn-edit" style="padding: 0.25rem 0.5rem; width: auto; font-size: 0.8rem; background: var(--warning-color);" onclick="editPlanBoardRow(${p.id})">
                        <i class="fa-solid fa-edit"></i> Ред.
                    </button>
                    <button class="btn-danger" style="padding: 0.25rem 0.5rem; width: auto; font-size: 0.8rem;" onclick="deletePlanBoardRow(${p.id})">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            ` : `<span style="color: var(--text-secondary); font-size: 0.85rem;">Нет прав</span>`;
            
            tbody.innerHTML += `
                <tr>
                    <td>${p.date}</td>
                    <td>${p.line || 'Н/Д'}</td>
                    <td>${p.shift_name}</td>
                    <td>${p.shift_number}</td>
                    <td>${masterName}</td>
                    <td>${p.plan_sheets}</td>
                    <td>${p.fact_sheets}</td>
                    <td>${p.first_grade || 0}</td>
                    <td>${p.defect || 0}</td>
                    <td>${actionsHtml}</td>
                </tr>
            `;
        });
    } catch (e) {
        console.error(e);
        const tbody = document.getElementById('plan-board-table-body');
        if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:red;">Ошибка загрузки данных</td></tr>`;
    }
}

function populatePlanBoardMasters(selectedId) {
    const masterSelect = document.getElementById('edit-pb-master');
    if (!masterSelect) return;
    masterSelect.innerHTML = '';
    allMastersCached.filter(m => m.role === 'master').forEach(m => {
        const selected = m.id === selectedId ? 'selected' : '';
        masterSelect.innerHTML += `<option value="${m.id}" ${selected}>${m.name}</option>`;
    });
}

function showAddPlanBoardModal() {
    document.getElementById('plan-board-modal-title').innerText = "Добавить запись выработки";
    document.getElementById('edit-pb-id').value = '';
    document.getElementById('edit-pb-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('edit-pb-line').value = 'ЛФМ-1';
    document.getElementById('edit-pb-shift-name').value = 'День';
    document.getElementById('edit-pb-shift-number').value = '1';
    document.getElementById('edit-pb-plan-sheets').value = '0';
    document.getElementById('edit-pb-fact-sheets').value = '0';
    document.getElementById('edit-pb-first-grade').value = '0';
    document.getElementById('edit-pb-defect').value = '0';
    
    populatePlanBoardMasters(null);
    document.getElementById('edit-plan-board-modal').style.display = 'flex';
}

async function editPlanBoardRow(id) {
    try {
        const res = await fetch(`/api/plan_board/${id}`);
        if (!res.ok) throw new Error("Не удалось загрузить запись выработки");
        const row = await res.json();
        
        document.getElementById('plan-board-modal-title').innerText = "Редактировать запись выработки";
        document.getElementById('edit-pb-id').value = row.id;
        document.getElementById('edit-pb-date').value = row.date;
        document.getElementById('edit-pb-line').value = row.line || 'ЛФМ-1';
        document.getElementById('edit-pb-shift-name').value = row.shift_name;
        document.getElementById('edit-pb-shift-number').value = row.shift_number;
        document.getElementById('edit-pb-plan-sheets').value = row.plan_sheets;
        document.getElementById('edit-pb-fact-sheets').value = row.fact_sheets;
        document.getElementById('edit-pb-first-grade').value = row.first_grade || 0;
        document.getElementById('edit-pb-defect').value = row.defect || 0;
        
        populatePlanBoardMasters(row.master_id);
        document.getElementById('edit-plan-board-modal').style.display = 'flex';
    } catch(e) {
        console.error(e);
        alert(e.message);
    }
}

async function savePlanBoardEdit() {
    const id = document.getElementById('edit-pb-id').value;
    const data = {
        date: document.getElementById('edit-pb-date').value,
        line: document.getElementById('edit-pb-line').value,
        shift_name: document.getElementById('edit-pb-shift-name').value,
        shift_number: parseInt(document.getElementById('edit-pb-shift-number').value) || 1,
        master_id: parseInt(document.getElementById('edit-pb-master').value),
        plan_sheets: parseInt(document.getElementById('edit-pb-plan-sheets').value) || 0,
        fact_sheets: parseInt(document.getElementById('edit-pb-fact-sheets').value) || 0,
        first_grade: parseInt(document.getElementById('edit-pb-first-grade').value) || 0,
        defect: parseInt(document.getElementById('edit-pb-defect').value) || 0
    };
    
    const userNameParam = currentAdmin ? encodeURIComponent(currentAdmin.name) : '';
    try {
        const res = await fetch(`/api/plan_board?user_name=${userNameParam}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        if (res.ok) {
            document.getElementById('edit-plan-board-modal').style.display = 'none';
            loadPlanBoard();
        } else {
            alert("Ошибка сохранения выработки");
        }
    } catch(e) {
        console.error(e);
    }
}

async function deletePlanBoardRow(id) {
    if (!confirm("Вы уверены, что хотите удалить эту строку из выработки?")) return;
    try {
        const userNameParam = currentAdmin ? encodeURIComponent(currentAdmin.name) : '';
        const res = await fetch(`/api/plan_board/${id}?user_name=${userNameParam}`, { method: 'DELETE' });
        if (res.ok) {
            alert("Строка успешно удалена.");
            loadPlanBoard();
        } else {
            const err = await res.json();
            alert("Ошибка удаления: " + (err.detail || "Неизвестная ошибка"));
        }
    } catch (e) {
        console.error(e);
        alert("Сетевая ошибка при удалении.");
    }
}

async function importPlanBoard() {
    if (!confirm("Загрузить данные из monthly_plan_board.xlsx? Это может занять некоторое время.")) return;
    try {
        const res = await fetch('/api/admin/import_plan_board', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            alert(`Импорт завершен успешно!\nСоздано записей: ${data.created}\nОбновлено записей: ${data.updated}`);
            loadPlanBoard();
        } else {
            alert("Ошибка импорта: " + (data.detail || 'Неизвестная ошибка'));
        }
    } catch (e) {
        console.error(e);
        alert("Ошибка сети при импорте");
    }
}

let adminAuditLogsCached = [];

async function loadAuditLogs() {
    try {
        const tbody = document.getElementById('audit-logs-table-body');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-secondary);">Загрузка логов...</td></tr>';
        
        const res = await fetch('/api/admin/audit_logs');
        const data = await res.json();
        adminAuditLogsCached = Array.isArray(data) ? data : [];
        renderAuditLogsTable();
    } catch (e) {
        console.error("Error loading audit logs:", e);
        const tbody = document.getElementById('audit-logs-table-body');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: red;">Ошибка загрузки логов</td></tr>';
    }
}

function renderAuditLogsTable() {
    const tbody = document.getElementById('audit-logs-table-body');
    if (!tbody) return;

    const actionFilter = document.getElementById('filter-audit-action') ? document.getElementById('filter-audit-action').value : '';
    const searchFilter = document.getElementById('filter-audit-search') ? document.getElementById('filter-audit-search').value.toLowerCase().trim() : '';

    let filtered = adminAuditLogsCached.filter(log => {
        const act = (log.action || '').toUpperCase();
        const matchAction = !actionFilter || act === actionFilter.toUpperCase() || act.includes(actionFilter.toUpperCase());
        
        const textToSearch = `${log.user_name || ''} ${log.target_table || ''} ${log.details || ''} ${log.timestamp || ''}`.toLowerCase();
        const matchSearch = !searchFilter || textToSearch.includes(searchFilter);
        
        return matchAction && matchSearch;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-secondary); padding: 1.5rem;">Записи не найдены</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(log => {
        let actionBadge = `<span style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 0.78rem;">${log.action || '—'}</span>`;
        if (log.action === 'CREATE') {
            actionBadge = `<span style="background: rgba(16,185,129,0.2); color: #34d399; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.78rem;">CREATE</span>`;
        } else if (log.action === 'UPDATE') {
            actionBadge = `<span style="background: rgba(59,130,246,0.2); color: #60a5fa; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.78rem;">UPDATE</span>`;
        } else if (log.action === 'DELETE') {
            actionBadge = `<span style="background: rgba(239,68,68,0.2); color: #f87171; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.78rem;">DELETE</span>`;
        } else if (log.action === 'IMPORT' || log.action === 'SYNC') {
            actionBadge = `<span style="background: rgba(245,158,11,0.2); color: #fbbf24; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.78rem;">${log.action}</span>`;
        }

        const dateFormatted = log.timestamp ? log.timestamp.replace('T', ' ').substring(0, 19) : '—';

        return `
            <tr>
                <td style="white-space: nowrap; font-size: 0.78rem; color: var(--text-secondary);">${dateFormatted}</td>
                <td style="font-weight: 600; color: var(--text-primary);">${log.user_name || 'Система'}</td>
                <td>${actionBadge}</td>
                <td style="font-weight: 500; color: var(--accent-color);">${log.target_table || '—'}</td>
                <td style="white-space: pre-wrap; font-size: 0.82rem; line-height: 1.3;">${log.details || '—'}</td>
            </tr>
        `;
    }).join('');
}

function exportAuditLogsToCsv() {
    if (!adminAuditLogsCached || adminAuditLogsCached.length === 0) {
        alert("Нет данных для экспорта");
        return;
    }

    const headers = ["Время", "Пользователь", "Действие", "Таблица", "Детали"];
    const rows = adminAuditLogsCached.map(log => [
        `"${(log.timestamp || '').replace('T', ' ')}"`,
        `"${(log.user_name || '').replace(/"/g, '""')}"`,
        `"${(log.action || '').replace(/"/g, '""')}"`,
        `"${(log.target_table || '').replace(/"/g, '""')}"`,
        `"${(log.details || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = "\uFEFF" + [headers.join(';'), ...rows.map(e => e.join(';'))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `audit_logs_${new Date().toISOString().substring(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- SHIFTS CRUD & UNIFIED MANAGEMENT ---

let allMastersCached = [];
let allShiftsCached = [];
let currentShiftPeriod = 'week';
let activeUnifiedDetails = null;

async function loadShifts() {
    try {
        const [shiftsRes, mastersRes] = await Promise.all([
            fetch('/api/shifts/all'),
            fetch('/api/masters/')
        ]);
        allShiftsCached = await shiftsRes.json();
        allMastersCached = await mastersRes.json();
        
        // Populate master filter dropdown
        const masterSelect = document.getElementById('filter-master');
        if (masterSelect) {
            const currentVal = masterSelect.value;
            masterSelect.innerHTML = '<option value="">Все мастера</option>';
            allMastersCached.filter(m => m.role === 'master').forEach(m => {
                masterSelect.innerHTML += `<option value="${m.id}" ${m.id == currentVal ? 'selected' : ''}>${m.name}</option>`;
            });
        }

        // Populate product filter dropdown
        const productSelect = document.getElementById('filter-product');
        if (productSelect) {
            const currentVal = productSelect.value;
            const uniqueProducts = new Set([
                'Шифер 8 волн рифленый', 'Шифер 8 волн цветной', 'Шифер 7 волн 3500*980',
                'Трубы безнапорные', 'Плоский лист'
            ]);
            allShiftsCached.forEach(s => {
                if (s.product_name) uniqueProducts.add(s.product_name);
                if (s.lfm_reports) s.lfm_reports.forEach(r => { if (r.product_name) uniqueProducts.add(r.product_name); });
                if (s.batches) s.batches.forEach(b => { if (b.product_name) uniqueProducts.add(b.product_name); });
            });
            productSelect.innerHTML = '<option value="">Вся продукция</option>';
            Array.from(uniqueProducts).sort().forEach(p => {
                productSelect.innerHTML += `<option value="${p}" ${p === currentVal ? 'selected' : ''}>${p}</option>`;
            });
        }

        filterShifts();
    } catch (e) {
        console.error("Error loading shifts:", e);
        const tbody = document.getElementById('shifts-table-body');
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--danger-color);">Ошибка при загрузке смен</td></tr>`;
    }
}

function setShiftPeriod(period) {
    currentShiftPeriod = period;
    document.querySelectorAll('[id^="filter-period-"]').forEach(btn => {
        btn.classList.remove('active');
        btn.style.background = 'rgba(255,255,255,0.1)';
    });
    const activeBtn = document.getElementById('filter-period-' + period);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.background = 'var(--accent-color)';
    }
    filterShifts();
}

function resetShiftFilters() {
    const lineEl = document.getElementById('filter-line'); if (lineEl) lineEl.value = '';
    const masterEl = document.getElementById('filter-master'); if (masterEl) masterEl.value = '';
    const prodEl = document.getElementById('filter-product'); if (prodEl) prodEl.value = '';
    const expEl = document.getElementById('filter-export-type'); if (expEl) expEl.value = '';
    const searchEl = document.getElementById('filter-search'); if (searchEl) searchEl.value = '';
    setShiftPeriod('week');
}

function filterShifts() {
    const lineFilter = document.getElementById('filter-line')?.value || '';
    const masterFilter = document.getElementById('filter-master')?.value || '';
    const prodFilter = document.getElementById('filter-product')?.value || '';
    const expFilter = document.getElementById('filter-export-type')?.value || '';
    const searchFilter = (document.getElementById('filter-search')?.value || '').toLowerCase().trim();
    
    const now = new Date();
    let cutoffDate = null;
    if (currentShiftPeriod === 'week') {
        cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (currentShiftPeriod === 'month') {
        cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const filtered = allShiftsCached.filter(s => {
        if (cutoffDate) {
            const sDate = new Date(s.date);
            if (sDate < cutoffDate) return false;
        }
        if (lineFilter && !s.line.includes(lineFilter)) return false;
        if (masterFilter && s.master_id != masterFilter) return false;
        
        // Export matching
        const sExp = s.export_type || 'Эталон';
        if (expFilter && sExp !== expFilter) return false;

        // Product matching
        const sProd = s.product_name || (s.lfm_reports?.[0]?.product_name) || (s.batches?.[0]?.product_name) || '';
        if (prodFilter && sProd !== prodFilter) {
            const hasProd = (s.lfm_reports || []).some(r => r.product_name === prodFilter) ||
                            (s.batches || []).some(b => b.product_name === prodFilter);
            if (!hasProd) return false;
        }

        // Search matching
        if (searchFilter) {
            const batchNum = s.batch_number || (s.batches?.[0]?.batch_number) || '';
            const masterObj = allMastersCached.find(m => m.id === s.master_id);
            const mName = masterObj ? masterObj.name.toLowerCase() : '';
            const matchId = s.id.toString().includes(searchFilter);
            const matchBatch = batchNum.toLowerCase().includes(searchFilter);
            const matchDate = s.date.includes(searchFilter);
            const matchMaster = mName.includes(searchFilter);
            const matchExp = sExp.toLowerCase().includes(searchFilter);
            if (!matchId && !matchBatch && !matchDate && !matchMaster && !matchExp) return false;
        }
        return true;
    });

    const tbody = document.getElementById('shifts-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-secondary);">Смен по выбранным фильтрам не найдено</td></tr>`;
        return;
    }

    filtered.forEach(s => {
        const master = allMastersCached.find(m => m.id === s.master_id);
        const masterName = master ? master.name : `ID: ${s.master_id}`;
        
        const lfmSheets = (s.lfm_reports || []).reduce((acc, r) => acc + (r.lfm_sheets || 0), 0);
        const warehouseGp = (s.batches || []).reduce((acc, b) => acc + (b.ds_condition || 0), 0);
        const firstGrade = (s.batches || []).reduce((acc, b) => acc + (b.ds_first_grade || 0), 0) ||
                           (s.lfm_reports || []).reduce((acc, r) => acc + (r.formed_1st_grade || 0), 0);
        const destackerDefect = (s.batches || []).reduce((acc, b) => acc + (b.ds_defect || 0), 0);
        const qcdDefect = (s.batches || []).reduce((acc, b) => acc + (b.qcd_defect || 0), 0);

        const prodName = s.product_name || (s.lfm_reports?.[0]?.product_name) || (s.batches?.[0]?.product_name) || 'Шифер 8 волн рифленый';
        const batchNum = s.batch_number || (s.batches?.[0]?.batch_number) || '-';
        const exportType = s.export_type || 'Эталон';

        let expBadge = `<span style="padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.72rem; background: rgba(255,255,255,0.08); color: var(--text-secondary); margin-left: 4px;">${exportType}</span>`;
        if (exportType === 'Оренбург') {
            expBadge = `<span style="padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.72rem; background: rgba(14, 165, 233, 0.2); color: #38bdf8; font-weight: bold; margin-left: 4px;">Оренбург</span>`;
        } else if (exportType === 'Шымкент') {
            expBadge = `<span style="padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.72rem; background: rgba(168, 85, 247, 0.2); color: #c084fc; font-weight: bold; margin-left: 4px;">Шымкент</span>`;
        }

        const shiftBadgeColor = s.shift_name === 'День' ? 'background: rgba(255, 193, 7, 0.2); color: #ffc107;' : 'background: rgba(13, 110, 253, 0.2); color: #6ea8fe;';
        const statusBadge = s.status === 'active' 
            ? `<span style="color: var(--success-color); font-size: 0.8rem;"><i class="fa-solid fa-circle-check"></i> active</span>`
            : `<span style="color: var(--text-secondary); font-size: 0.8rem;"><i class="fa-solid fa-lock"></i> closed</span>`;

        tbody.innerHTML += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;">
                <td style="font-weight: bold; color: var(--text-secondary);">#${s.id}</td>
                <td>
                    <div style="font-weight: 500;">${s.date}</div>
                    <div style="margin-top: 0.2rem; display: flex; gap: 0.5rem; align-items: center;">
                        <span style="padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; ${shiftBadgeColor}">${s.shift_name}</span>
                        ${statusBadge}
                    </div>
                </td>
                <td>
                    <div style="font-weight: 500;">${s.line}</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary);">${masterName}</div>
                </td>
                <td>
                    <div style="font-weight: 500; color: white; display: flex; align-items: center; flex-wrap: wrap; gap: 2px;">
                        <span>${prodName}</span> ${expBadge}
                    </div>
                    <div style="font-size: 0.85rem; color: var(--accent-color);">Партия: <b>${batchNum}</b></div>
                </td>
                <td>
                    <div style="display: flex; gap: 0.8rem; font-size: 0.85rem;">
                        <div>ЛФМ: <b style="color: var(--primary-color);">${lfmSheets}</b></div>
                        <div>Склад: <b style="color: var(--success-color);">${warehouseGp}</b></div>
                        <div>1 сорт: <b>${firstGrade}</b></div>
                    </div>
                </td>
                <td>
                    <div style="display: flex; gap: 0.8rem; font-size: 0.85rem;">
                        <div>Дест: <b style="color: ${destackerDefect > 0 ? 'var(--danger-color)' : 'var(--text-secondary)'};">${destackerDefect}</b></div>
                        <div>ОТК: <b style="color: ${qcdDefect > 0 ? 'var(--danger-color)' : 'var(--text-secondary)'};">${qcdDefect}</b></div>
                    </div>
                </td>
                <td style="text-align: right; white-space: nowrap;">
                    <button class="action-btn btn-edit" title="Редактировать рапорт и сырье" onclick="openUnifiedShiftModal(${s.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button class="action-btn btn-delete" title="Удалить рапорт" onclick="deleteShift(${s.id})"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
}

function updateAdminLineSiloHeaders() {
    const lineVal = document.getElementById('uni-line')?.value || "1";
    const siloAHeader = document.getElementById('uni-rm-header-siloA');
    const siloBHeader = document.getElementById('uni-rm-header-siloB');
    if (siloAHeader && siloBHeader) {
        if (lineVal === '1' || lineVal.includes('1')) {
            siloAHeader.innerText = 'Силос 1';
            siloBHeader.innerText = 'Силос 2';
        } else {
            siloAHeader.innerText = 'Силос 3';
            siloBHeader.innerText = 'Силос 4';
        }
    }
    calcAdminCem();
}

function calcAdminSumRM(key) {
    const s1 = parseFloat(document.getElementById('uni-calc-' + key + '-1')?.value) || 0;
    const s2 = parseFloat(document.getElementById('uni-calc-' + key + '-2')?.value) || 0;
    const s3 = parseFloat(document.getElementById('uni-calc-' + key + '-3')?.value) || 0;
    const s4 = parseFloat(document.getElementById('uni-calc-' + key + '-4')?.value) || 0;
    const total = s1 + s2 + s3 + s4;
    const target = document.getElementById('uni-zo-' + key);
    if (target) target.value = total > 0 ? total : '';
    
    const hiddenKey = key === 'cellulose' ? 'uni-zo-cel' : 
                      key === 'crushed-slate' ? 'uni-zo-csl' : 
                      key === 'asbozurit' ? 'uni-zo-asb' :
                      key === 'fiberglass' ? 'uni-zo-fib' :
                      key === 'laprol' ? 'uni-zo-lap' :
                      key === 'asbocarton' ? 'uni-zo-car' : 
                      'uni-zo-' + key;
                      
    if (document.getElementById(hiddenKey + '-1')) {
        document.getElementById(hiddenKey + '-1').value = s1 > 0 ? s1 : '0';
        document.getElementById(hiddenKey + '-2').value = s2 > 0 ? s2 : '0';
        document.getElementById(hiddenKey + '-3').value = s3 > 0 ? s3 : '0';
        document.getElementById(hiddenKey + '-4').value = s4 > 0 ? s4 : '0';
    }
}

function calcAdminCem() {
    const s1 = parseFloat(document.getElementById('uni-calc-cem-1')?.value) || 0;
    const s2 = parseFloat(document.getElementById('uni-calc-cem-2')?.value) || 0;
    const s3 = parseFloat(document.getElementById('uni-calc-cem-3')?.value) || 0;
    const s4 = parseFloat(document.getElementById('uni-calc-cem-4')?.value) || 0;
    const total = s1 + s2 + s3 + s4;
    const target = document.getElementById('uni-zo-cem-total-readonly');
    if (target) target.value = total > 0 ? total : '';

    if (document.getElementById('uni-zo-cem-1')) {
        document.getElementById('uni-zo-cem-1').value = s1 > 0 ? s1 : '0';
        document.getElementById('uni-zo-cem-2').value = s2 > 0 ? s2 : '0';
        document.getElementById('uni-zo-cem-3').value = s3 > 0 ? s3 : '0';
        document.getElementById('uni-zo-cem-4').value = s4 > 0 ? s4 : '0';
    }
}

async function openUnifiedShiftModal(shiftId, targetTab = 'meta') {
    try {
        const res = await fetch(`/api/admin/shifts/${shiftId}/details`);
        if (!res.ok) throw new Error("Не удалось загрузить данные рапорта смены");
        activeUnifiedDetails = await res.json();
        const shift = activeUnifiedDetails.shift;
        const lfm = activeUnifiedDetails.lfm_reports || [];
        const batches = activeUnifiedDetails.batches || [];
        const downtimes = activeUnifiedDetails.downtimes || [];

        document.getElementById('unified-shift-id').value = shift.id;
        document.getElementById('unified-modal-title').innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Редактирование рапорта № ${shift.id}`;
        document.getElementById('unified-modal-subtitle').innerText = `${shift.date} • ${shift.shift_name} • ${shift.line}`;

        // Tab 1: Metadata
        document.getElementById('uni-date').value = shift.date;
        document.getElementById('uni-shift-name').value = shift.shift_name;
        document.getElementById('uni-line').value = shift.line.replace('Линия ', '').trim() || "1";
        document.getElementById('uni-status').value = shift.status || 'active';

        // Bind onchange to uni-line to update headers
        document.getElementById('uni-line').onchange = updateAdminLineSiloHeaders;

        const masterSelect = document.getElementById('uni-master');
        masterSelect.innerHTML = '';
        allMastersCached.filter(m => m.role === 'master').forEach(m => {
            masterSelect.innerHTML += `<option value="${m.id}" ${m.id === shift.master_id ? 'selected' : ''}>${m.name}</option>`;
        });

        const prodSelect = document.getElementById('uni-product');
        prodSelect.innerHTML = '';
        const currentProd = shift.product_name || (lfm[0]?.product_name) || (batches[0]?.product_name) || 'Шифер 8 волн рифленый';
        const standardProds = [
            'Шифер 8 волн рифленый', 'Шифер 8 волн цветной', 'Шифер 7 волн 3500*980',
            'Шифер 7 волн 1750*980', 'Шифер 6 волн 1750*1130', 'Шифер плоский 8мм',
            'Шифер плоский 10мм', 'Шифер 8 волн неокрашенный'
        ];
        if (!standardProds.includes(currentProd) && currentProd) {
            standardProds.push(currentProd);
        }
        standardProds.forEach(p => {
            prodSelect.innerHTML += `<option value="${p}" ${p === currentProd ? 'selected' : ''}>${p}</option>`;
        });

        const expSelect = document.getElementById('uni-export-type');
        if (expSelect) {
            expSelect.value = shift.export_type || (lfm[0]?.export_type) || (batches[0]?.export_type) || 'Эталон';
        }

        document.getElementById('uni-batch-number').value = shift.batch_number || (batches[0]?.batch_number) || '';

        // Tab 2: Production
        const lfmSheetsVal = lfm.reduce((acc, r) => acc + (r.lfm_sheets || 0), 0);
        const lfmWindVal = lfm.reduce((acc, r) => acc + (r.lfm_wind_resets || 0), 0);
        const whGpVal = batches.reduce((acc, b) => acc + (b.ds_condition || 0), 0);
        const firstGradeVal = batches.reduce((acc, b) => acc + (b.ds_first_grade || 0), 0) || lfm.reduce((acc, r) => acc + (r.formed_1st_grade || 0), 0);
        const qcdDefectVal = batches.reduce((acc, b) => acc + (b.qcd_defect || 0), 0);

        document.getElementById('uni-lfm-sheets').value = lfmSheetsVal;
        document.getElementById('uni-lfm-wind-resets').value = lfmWindVal;
        document.getElementById('uni-zo-batches').value = shift.zo_batches || 0;
        document.getElementById('uni-warehouse-gp').value = whGpVal;
        document.getElementById('uni-first-grade').value = firstGradeVal;
        document.getElementById('uni-qcd-defect').value = qcdDefectVal;

        // Tab 3: Raw Materials & Silos Prefill
        updateAdminLineSiloHeaders();
        const isLine1 = shift.line.includes('1') || shift.line === '1';

        const materials = [
            {dbKey: 'zo_chrysotile_4_20', uiKey: 'chr-4-20', hiddenKey: 'uni-zo-chr-4-20'},
            {dbKey: 'zo_chrysotile_5_65', uiKey: 'chr-5-65', hiddenKey: 'uni-zo-chr-5-65'},
            {dbKey: 'zo_chrysotile_6_40', uiKey: 'chr-6-40', hiddenKey: 'uni-zo-chr-6-40'},
            {dbKey: 'zo_cement', uiKey: 'cem', hiddenKey: 'uni-zo-cem'},
            {dbKey: 'zo_cellulose', uiKey: 'cellulose', hiddenKey: 'uni-zo-cel'},
            {dbKey: 'zo_crushed_slate', uiKey: 'crushed-slate', hiddenKey: 'uni-zo-csl'},
            {dbKey: 'zo_asbozurit', uiKey: 'asbozurit', hiddenKey: 'uni-zo-asb'},
            {dbKey: 'zo_fiberglass', uiKey: 'fiberglass', hiddenKey: 'uni-zo-fib'},
            {dbKey: 'zo_laprol', uiKey: 'laprol', hiddenKey: 'uni-zo-lap'},
            {dbKey: 'zo_asbocarton', uiKey: 'asbocarton', hiddenKey: 'uni-zo-car'}
        ];

        materials.forEach(mat => {
            const s1 = shift[`${mat.dbKey}_silo1`] || 0;
            const s2 = shift[`${mat.dbKey}_silo2`] || 0;
            const s3 = shift[`${mat.dbKey}_silo3`] || 0;
            const s4 = shift[`${mat.dbKey}_silo4`] || 0;
            const total = shift[mat.dbKey] || (s1 + s2 + s3 + s4) || 0;

            // Prefill total field
            const totalEl = mat.uiKey === 'cem' ? document.getElementById('uni-zo-cem-total-readonly') : document.getElementById(`uni-zo-${mat.uiKey}`);
            if (totalEl) totalEl.value = total > 0 ? total : '';

            // Prefill hidden fields 1..4
            if (document.getElementById(`${mat.hiddenKey}-1`)) document.getElementById(`${mat.hiddenKey}-1`).value = s1;
            if (document.getElementById(`${mat.hiddenKey}-2`)) document.getElementById(`${mat.hiddenKey}-2`).value = s2;
            if (document.getElementById(`${mat.hiddenKey}-3`)) document.getElementById(`${mat.hiddenKey}-3`).value = s3;
            if (document.getElementById(`${mat.hiddenKey}-4`)) document.getElementById(`${mat.hiddenKey}-4`).value = s4;

            // Prefill Silo 1..4 inputs directly
            for (let s = 1; s <= 4; s++) {
                const calcInp = document.getElementById(`uni-calc-${mat.uiKey}-${s}`);
                if (calcInp) {
                    const sVal = shift[`${mat.dbKey}_silo${s}`];
                    calcInp.value = (sVal !== undefined && sVal !== null && sVal > 0) ? sVal : '';
                }
            }
        });

        // Simple drains
        document.getElementById('uni-zo-asb-drain').value = shift.zo_asb_drain || 0;
        document.getElementById('uni-zo-cem-drain').value = shift.zo_cem_drain || 0;
        document.getElementById('uni-lfm-asb-drain').value = shift.lfm_asb_drain || 0;
        document.getElementById('uni-lfm-cem-drain').value = shift.lfm_cem_drain || 0;

        // Tab 4: Destacker Defects
        document.getElementById('uni-def-chip').value = batches.reduce((acc, b) => acc + (b.ds_defect_chip || 0), 0);
        document.getElementById('uni-def-scratch').value = batches.reduce((acc, b) => acc + (b.ds_defect_scratch || 0), 0);
        document.getElementById('uni-def-bad-cut').value = batches.reduce((acc, b) => acc + (b.ds_defect_bad_cut || 0), 0);
        document.getElementById('uni-def-stick-bottom').value = batches.reduce((acc, b) => acc + (b.ds_defect_stick_bottom || 0), 0);
        document.getElementById('uni-def-stick-top').value = batches.reduce((acc, b) => acc + (b.ds_defect_stick_top || 0), 0);
        document.getElementById('uni-def-broken').value = batches.reduce((acc, b) => acc + (b.ds_defect_broken || 0), 0);
        document.getElementById('uni-def-fell-box').value = batches.reduce((acc, b) => acc + (b.ds_defect_fell_box || 0), 0);
        document.getElementById('uni-def-dent').value = batches.reduce((acc, b) => acc + (b.ds_defect_dent || 0), 0);
        document.getElementById('uni-def-thickness').value = batches.reduce((acc, b) => acc + (b.ds_defect_thickness || 0), 0);
        document.getElementById('uni-def-delamination').value = batches.reduce((acc, b) => acc + (b.ds_defect_delamination || 0), 0);
        document.getElementById('uni-def-edge').value = batches.reduce((acc, b) => acc + (b.ds_defect_edge || 0), 0);

        // Tab 5: Downtimes
        const dtTbody = document.getElementById('uni-downtimes-body');
        dtTbody.innerHTML = '';
        if (downtimes.length === 0) {
            dtTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 1.5rem; color: var(--text-secondary);">Нет зафиксированных простоев за смену</td></tr>`;
        } else {
            downtimes.forEach(d => {
                let displayReason = d.description || '-';
                if (d.breakdowns) {
                    try {
                        const bkList = JSON.parse(d.breakdowns);
                        if (bkList && bkList.length > 0) {
                            displayReason = bkList.map(b => `${b.node || ''} / ${b.description || ''}`).join('<br>');
                        }
                    } catch(e) {}
                }
                
                dtTbody.innerHTML += `
                    <tr>
                        <td style="font-weight: 500;">${d.start_time || '-'}</td>
                        <td><b style="color: var(--warning-color);">${d.duration}</b> мин</td>
                        <td>${displayReason}</td>
                        <td><span style="background: rgba(23,162,184,0.2); color: #17a2b8; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">${d.category || 'Не указана'}</span></td>
                        <td style="white-space: nowrap;">
                            <button class="action-btn btn-edit" onclick='editDowntimeRow(${JSON.stringify(d).replace(/'/g, "&apos;")})' style="padding: 0.3rem 0.6rem;"><i class="fa-solid fa-pen"></i></button>
                            <button class="action-btn btn-delete" onclick="deleteDowntimeRow(${d.id})" style="padding: 0.3rem 0.6rem;"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>
                `;
            });
        }

        switchUnifiedTab(targetTab);
        document.getElementById('unified-shift-modal').style.display = 'flex';
    } catch (e) {
        console.error(e);
        alert("Ошибка при открытии рапорта: " + e.message);
    }
}

function switchUnifiedTab(tabName) {
    document.querySelectorAll('.unified-tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('[id^="btn-tab-"]').forEach(btn => {
        btn.classList.remove('active');
        btn.style.background = 'rgba(255,255,255,0.1)';
    });
    
    const targetEl = document.getElementById('unified-tab-' + tabName);
    if (targetEl) targetEl.style.display = 'block';
    
    const targetBtn = document.getElementById('btn-tab-' + tabName);
    if (targetBtn) {
        targetBtn.classList.add('active');
        targetBtn.style.background = 'var(--accent-color)';
    }
}

async function saveUnifiedShiftReport() {
    const shiftId = document.getElementById('unified-shift-id').value;
    const lineVal = document.getElementById('uni-line').value;
    const lineFormatted = lineVal.toLowerCase().includes('линия') ? lineVal : `Линия ${lineVal}`;

    const payload = {
        date: document.getElementById('uni-date').value,
        shift_name: document.getElementById('uni-shift-name').value,
        line: lineFormatted,
        master_id: parseInt(document.getElementById('uni-master').value),
        status: document.getElementById('uni-status').value,
        product_name: document.getElementById('uni-product').value,
        export_type: document.getElementById('uni-export-type')?.value || 'Эталон',
        batch_number: document.getElementById('uni-batch-number').value.trim(),

        lfm_sheets: parseInt(document.getElementById('uni-lfm-sheets').value) || 0,
        lfm_wind_resets: parseInt(document.getElementById('uni-lfm-wind-resets').value) || 0,
        zo_batches: parseInt(document.getElementById('uni-zo-batches').value) || 0,
        warehouse_gp: parseInt(document.getElementById('uni-warehouse-gp').value) || 0,
        first_grade: parseInt(document.getElementById('uni-first-grade').value) || 0,
        qcd_defect: parseInt(document.getElementById('uni-qcd-defect').value) || 0,

        // Chrysotile Silos & Totals
        zo_chrysotile_4_20_silo1: parseFloat(document.getElementById('uni-zo-chr-4-20-1')?.value) || 0,
        zo_chrysotile_4_20_silo2: parseFloat(document.getElementById('uni-zo-chr-4-20-2')?.value) || 0,
        zo_chrysotile_4_20_silo3: parseFloat(document.getElementById('uni-zo-chr-4-20-3')?.value) || 0,
        zo_chrysotile_4_20_silo4: parseFloat(document.getElementById('uni-zo-chr-4-20-4')?.value) || 0,
        zo_chrysotile_4_20: parseFloat(document.getElementById('uni-zo-chr-4-20')?.value) || 0,

        zo_chrysotile_5_65_silo1: parseFloat(document.getElementById('uni-zo-chr-5-65-1')?.value) || 0,
        zo_chrysotile_5_65_silo2: parseFloat(document.getElementById('uni-zo-chr-5-65-2')?.value) || 0,
        zo_chrysotile_5_65_silo3: parseFloat(document.getElementById('uni-zo-chr-5-65-3')?.value) || 0,
        zo_chrysotile_5_65_silo4: parseFloat(document.getElementById('uni-zo-chr-5-65-4')?.value) || 0,
        zo_chrysotile_5_65: parseFloat(document.getElementById('uni-zo-chr-5-65')?.value) || 0,

        zo_chrysotile_6_40_silo1: parseFloat(document.getElementById('uni-zo-chr-6-40-1')?.value) || 0,
        zo_chrysotile_6_40_silo2: parseFloat(document.getElementById('uni-zo-chr-6-40-2')?.value) || 0,
        zo_chrysotile_6_40_silo3: parseFloat(document.getElementById('uni-zo-chr-6-40-3')?.value) || 0,
        zo_chrysotile_6_40_silo4: parseFloat(document.getElementById('uni-zo-chr-6-40-4')?.value) || 0,
        zo_chrysotile_6_40: parseFloat(document.getElementById('uni-zo-chr-6-40')?.value) || 0,

        // Cement Silos & Total
        zo_cement_silo1: parseFloat(document.getElementById('uni-zo-cem-1')?.value) || 0,
        zo_cement_silo2: parseFloat(document.getElementById('uni-zo-cem-2')?.value) || 0,
        zo_cement_silo3: parseFloat(document.getElementById('uni-zo-cem-3')?.value) || 0,
        zo_cement_silo4: parseFloat(document.getElementById('uni-zo-cem-4')?.value) || 0,
        zo_cement: parseFloat(document.getElementById('uni-zo-cem-total-readonly')?.value) || 0,

        // Cellulose
        zo_cellulose_silo1: parseFloat(document.getElementById('uni-zo-cel-1')?.value) || 0,
        zo_cellulose_silo2: parseFloat(document.getElementById('uni-zo-cel-2')?.value) || 0,
        zo_cellulose_silo3: parseFloat(document.getElementById('uni-zo-cel-3')?.value) || 0,
        zo_cellulose_silo4: parseFloat(document.getElementById('uni-zo-cel-4')?.value) || 0,
        zo_cellulose: parseFloat(document.getElementById('uni-zo-cellulose')?.value) || 0,

        // Crushed slate
        zo_crushed_slate_silo1: parseFloat(document.getElementById('uni-zo-csl-1')?.value) || 0,
        zo_crushed_slate_silo2: parseFloat(document.getElementById('uni-zo-csl-2')?.value) || 0,
        zo_crushed_slate_silo3: parseFloat(document.getElementById('uni-zo-csl-3')?.value) || 0,
        zo_crushed_slate_silo4: parseFloat(document.getElementById('uni-zo-csl-4')?.value) || 0,
        zo_crushed_slate: parseFloat(document.getElementById('uni-zo-crushed-slate')?.value) || 0,

        // Asbozurit
        zo_asbozurit_silo1: parseFloat(document.getElementById('uni-zo-asb-1')?.value) || 0,
        zo_asbozurit_silo2: parseFloat(document.getElementById('uni-zo-asb-2')?.value) || 0,
        zo_asbozurit_silo3: parseFloat(document.getElementById('uni-zo-asb-3')?.value) || 0,
        zo_asbozurit_silo4: parseFloat(document.getElementById('uni-zo-asb-4')?.value) || 0,
        zo_asbozurit: parseFloat(document.getElementById('uni-zo-asbozurit')?.value) || 0,

        // Fiberglass
        zo_fiberglass_silo1: parseFloat(document.getElementById('uni-zo-fib-1')?.value) || 0,
        zo_fiberglass_silo2: parseFloat(document.getElementById('uni-zo-fib-2')?.value) || 0,
        zo_fiberglass_silo3: parseFloat(document.getElementById('uni-zo-fib-3')?.value) || 0,
        zo_fiberglass_silo4: parseFloat(document.getElementById('uni-zo-fib-4')?.value) || 0,
        zo_fiberglass: parseFloat(document.getElementById('uni-zo-fiberglass')?.value) || 0,

        // Laprol
        zo_laprol_silo1: parseFloat(document.getElementById('uni-zo-lap-1')?.value) || 0,
        zo_laprol_silo2: parseFloat(document.getElementById('uni-zo-lap-2')?.value) || 0,
        zo_laprol_silo3: parseFloat(document.getElementById('uni-zo-lap-3')?.value) || 0,
        zo_laprol_silo4: parseFloat(document.getElementById('uni-zo-lap-4')?.value) || 0,
        zo_laprol: parseFloat(document.getElementById('uni-zo-laprol')?.value) || 0,

        // Asbocarton
        zo_asbocarton_silo1: parseFloat(document.getElementById('uni-zo-car-1')?.value) || 0,
        zo_asbocarton_silo2: parseFloat(document.getElementById('uni-zo-car-2')?.value) || 0,
        zo_asbocarton_silo3: parseFloat(document.getElementById('uni-zo-car-3')?.value) || 0,
        zo_asbocarton_silo4: parseFloat(document.getElementById('uni-zo-car-4')?.value) || 0,
        zo_asbocarton: parseFloat(document.getElementById('uni-zo-asbocarton')?.value) || 0,

        // Drains
        lfm_asb_drain: parseFloat(document.getElementById('uni-lfm-asb-drain')?.value) || 0,
        lfm_cem_drain: parseFloat(document.getElementById('uni-lfm-cem-drain')?.value) || 0,
        zo_asb_drain: parseFloat(document.getElementById('uni-zo-asb-drain')?.value) || 0,
        zo_cem_drain: parseFloat(document.getElementById('uni-zo-cem-drain')?.value) || 0,

        // Destacker defect breakdown
        ds_defect_chip: parseInt(document.getElementById('uni-def-chip')?.value) || 0,
        ds_defect_scratch: parseInt(document.getElementById('uni-def-scratch')?.value) || 0,
        ds_defect_bad_cut: parseInt(document.getElementById('uni-def-bad-cut')?.value) || 0,
        ds_defect_stick_bottom: parseInt(document.getElementById('uni-def-stick-bottom')?.value) || 0,
        ds_defect_stick_top: parseInt(document.getElementById('uni-def-stick-top')?.value) || 0,
        ds_defect_broken: parseInt(document.getElementById('uni-def-broken')?.value) || 0,
        ds_defect_fell_box: parseInt(document.getElementById('uni-def-fell-box')?.value) || 0,
        ds_defect_dent: parseInt(document.getElementById('uni-def-dent')?.value) || 0,
        ds_defect_thickness: parseInt(document.getElementById('uni-def-thickness')?.value) || 0,
        ds_defect_delamination: parseInt(document.getElementById('uni-def-delamination')?.value) || 0,
        ds_defect_edge: parseInt(document.getElementById('uni-def-edge')?.value) || 0
    };

    try {
        const res = await fetch(`/api/admin/shift_report/${shiftId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            closeModals();
            loadShifts();
            alert("Рапорт смены успешно обновлен и синхронизирован!");
        } else {
            const err = await res.json();
            alert("Ошибка при сохранении рапорта: " + (err.detail || res.statusText));
        }
    } catch (e) {
        console.error(e);
        alert("Ошибка сети при сохранении рапорта");
    }
}

async function deleteShift(id) {
    if (!confirm("ВНИМАНИЕ! Удаление рапорта смены удалит все связанные отчеты ЛФМ, партии и простои.\nВы уверены, что хотите удалить эту смену полностью?")) return;
    try {
        const res = await fetch(`/api/admin/shifts/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadShifts();
        } else {
            alert("Ошибка при удалении смены");
        }
    } catch (e) {
        console.error(e);
        alert("Ошибка сети при удалении");
    }
}

async function editDowntimeRow(d) {
    document.getElementById('edit-downtime-id').value = d.id;
    document.getElementById('edit-downtime-time').value = d.start_time || '';
    document.getElementById('edit-downtime-end-time').value = d.end_time || '';
    document.getElementById('edit-downtime-duration').value = d.duration || 0;
    
    document.getElementById('edit-downtime-lost-tons').value = d.lost_tons || 0;
    document.getElementById('edit-downtime-lost-tenge').value = d.lost_tenge || 0;
    document.getElementById('edit-downtime-status').value = d.status || 'pending';
    document.getElementById('edit-downtime-category').value = d.category || 'Механические';
    document.getElementById('edit-downtime-is-equipment-stop').checked = d.is_equipment_downtime !== false;
    
    document.getElementById('admin-dt-breakdowns-container').innerHTML = '';
    if (d.breakdowns) {
        try {
            const bkList = JSON.parse(d.breakdowns);
            for (const bk of bkList) {
                await addAdminBreakdownRow(bk);
            }
        } catch(e) {
            await addAdminBreakdownRow({ department: d.department, node: d.node, description: d.description });
        }
    } else {
        await addAdminBreakdownRow({ department: d.department, node: d.node, description: d.description });
    }
    
    document.getElementById('edit-downtime-modal').style.display = 'flex';
}

async function saveDowntimeEdit() {
    const id = document.getElementById('edit-downtime-id').value;
    
    const breakdownRows = document.querySelectorAll('#admin-dt-breakdowns-container .breakdown-row');
    const breakdownsList = [];
    let firstDept = "", firstNode = "", firstDesc = "";

    breakdownRows.forEach(row => {
        const dept = row.querySelector('.brk-dept').value;
        const node = row.querySelector('.brk-node').value;
        const selDesc = row.querySelector('.brk-desc').value;
        const custDesc = row.querySelector('.brk-custom-desc').value;
        const cat = row.querySelector('.brk-category').value;
        
        let desc = selDesc;
        if (selDesc === '_CUSTOM_') {
            desc = custDesc;
        }
        
        if (dept && node && desc) {
            breakdownsList.push({ department: dept, node: node, description: desc, category: cat });
            if (!firstDept) { firstDept = dept; firstNode = node; firstDesc = desc; }
        }
    });

    if (breakdownsList.length === 0) {
        alert("Добавьте хотя бы одну поломку (участок, узел, причина)!");
        return;
    }
    
    const data = {
        start_time: document.getElementById('edit-downtime-time').value || null,
        end_time: document.getElementById('edit-downtime-end-time').value || null,
        duration: parseInt(document.getElementById('edit-downtime-duration').value) || 0,
        department: firstDept,
        node: firstNode,
        description: firstDesc,
        lost_tons: parseFloat(document.getElementById('edit-downtime-lost-tons').value) || 0.0,
        lost_tenge: parseFloat(document.getElementById('edit-downtime-lost-tenge').value) || 0.0,
        status: document.getElementById('edit-downtime-status').value || 'pending',
        category: document.getElementById('edit-downtime-category').value,
        is_equipment_downtime: document.getElementById('edit-downtime-is-equipment-stop').checked,
        breakdowns: JSON.stringify(breakdownsList)
    };
    try {
        const res = await fetch(`/api/admin/downtimes/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        if (res.ok) {
            document.getElementById('edit-downtime-modal').style.display = 'none';
            if (typeof activeUnifiedDetails !== 'undefined' && activeUnifiedDetails?.shift?.id) {
                openUnifiedShiftModal(activeUnifiedDetails.shift.id, 'downtimes');
            }
            if (document.getElementById('tab-downtimes-log') && document.getElementById('tab-downtimes-log').style.display === 'block') {
                loadDowntimesLog();
            }
        } else {
            alert("Ошибка сохранения простоя");
        }
    } catch(e) {
        console.error(e);
    }
}

async function deleteDowntimeRow(id) {
    if (!confirm("Удалить эту запись о простое?")) return;
    try {
        const res = await fetch(`/api/admin/downtimes/${id}`, { method: 'DELETE' });
        if (res.ok) {
            if (typeof activeUnifiedDetails !== 'undefined' && activeUnifiedDetails?.shift?.id) {
                openUnifiedShiftModal(activeUnifiedDetails.shift.id, 'downtimes');
            }
            if (document.getElementById('tab-downtimes-log') && document.getElementById('tab-downtimes-log').style.display === 'block') {
                loadDowntimesLog();
            }
        } else {
            alert("Ошибка удаления");
        }
    } catch (e) {
        console.error(e);
    }
}

// --- DOWNTIME DIRECTORY CRUD ---
let downtimesDirList = [];

async function loadDowntimesDir() {
    try {
        const res = await fetch('/api/downtimes/directory');
        if (!res.ok) return;
        downtimesDirList = await res.json();
        renderDowntimesDirTable(downtimesDirList);
    } catch (e) {
        console.error("Failed to load downtime directory", e);
    }
}

function renderDowntimesDirTable(list) {
    const tbody = document.getElementById('downtimes-dir-table-body');
    if (!tbody) return;
    
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-secondary);">Записи отсутствуют</td></tr>';
        return;
    }
    
    tbody.innerHTML = list.map(item => `
        <tr>
            <td>${item.department}</td>
            <td>${item.node}</td>
            <td>${item.breakdown}</td>
            <td><span class="badge" style="background: rgba(23,162,184,0.2); color: #17a2b8; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.85rem;">${item.category || 'Не указана'}</span></td>
            <td>${item.comment || '-'}</td>
            <td>
                <button class="action-btn btn-edit" onclick='openDowntimeDirModal(${JSON.stringify(item).replace(/'/g, "&apos;")})'><i class="fa-solid fa-pen"></i></button>
                <button class="action-btn btn-delete" onclick="deleteDowntimeDirEntry(${item.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

function filterDowntimesDirTable() {
    const query = document.getElementById('downtimes-dir-search').value.toLowerCase();
    const filtered = downtimesDirList.filter(item => {
        return (item.department && item.department.toLowerCase().includes(query)) ||
               (item.node && item.node.toLowerCase().includes(query)) ||
               (item.breakdown && item.breakdown.toLowerCase().includes(query)) ||
               (item.category && item.category.toLowerCase().includes(query)) ||
               (item.comment && item.comment.toLowerCase().includes(query));
    });
    renderDowntimesDirTable(filtered);
}

function openDowntimeDirModal(item = null) {
    const modal = document.getElementById('downtime-dir-modal');
    const title = document.getElementById('downtime-dir-modal-title');
    const idInput = document.getElementById('downtime-dir-id');
    const deptInput = document.getElementById('downtime-dir-dept');
    const nodeInput = document.getElementById('downtime-dir-node');
    const breakdownInput = document.getElementById('downtime-dir-breakdown');
    const catSelect = document.getElementById('downtime-dir-category');
    const commentInput = document.getElementById('downtime-dir-comment');
    
    if (item) {
        title.innerText = "Редактировать запись справочника";
        idInput.value = item.id;
        deptInput.value = item.department || '';
        nodeInput.value = item.node || '';
        breakdownInput.value = item.breakdown || '';
        catSelect.value = item.category || 'Механические';
        commentInput.value = item.comment || '';
    } else {
        title.innerText = "Добавить запись в справочник";
        idInput.value = '';
        deptInput.value = '';
        nodeInput.value = '';
        breakdownInput.value = '';
        catSelect.value = 'Механические';
        commentInput.value = '';
    }
    modal.style.display = 'flex';
}

async function saveDowntimeDirEntry() {
    const id = document.getElementById('downtime-dir-id').value;
    const data = {
        department: document.getElementById('downtime-dir-dept').value.strip ? document.getElementById('downtime-dir-dept').value.strip() : document.getElementById('downtime-dir-dept').value.trim(),
        node: document.getElementById('downtime-dir-node').value.strip ? document.getElementById('downtime-dir-node').value.strip() : document.getElementById('downtime-dir-node').value.trim(),
        breakdown: document.getElementById('downtime-dir-breakdown').value.strip ? document.getElementById('downtime-dir-breakdown').value.strip() : document.getElementById('downtime-dir-breakdown').value.trim(),
        category: document.getElementById('downtime-dir-category').value,
        comment: document.getElementById('downtime-dir-comment').value.trim() || null
    };
    
    if (!data.department || !data.node || !data.breakdown) {
        alert("Заполните обязательные поля: Участок, Узел, Поломка");
        return;
    }
    
    const url = id ? `/api/downtimes/directory/${id}` : '/api/downtimes/directory';
    const method = id ? 'PUT' : 'POST';
    
    try {
        const res = await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        if (res.ok) {
            closeModals();
            loadDowntimesDir();
        } else {
            const err = await res.json();
            alert("Ошибка сохранения: " + (err.detail || "неизвестно"));
        }
    } catch (e) {
        console.error(e);
        alert("Ошибка сети");
    }
}

async function deleteDowntimeDirEntry(id) {
    if (!confirm("Удалить эту запись из справочника?")) return;
    try {
        const res = await fetch(`/api/downtimes/directory/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadDowntimesDir();
        } else {
            const err = await res.json();
            alert("Ошибка удаления: " + (err.detail || "неизвестно"));
        }
    } catch(e) {
        console.error(e);
    }
}

async function syncNormsFromGoogle() {
    const btn = document.getElementById('btn-sync-norms-google');
    const originalText = btn ? btn.innerHTML : '';
    
    if (!confirm("Синхронизировать нормы продукции из Google Таблицы? Это обновит технологические рецептуры и вес изделий.")) {
        return;
    }
    
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Обновление...';
        }
        
        const res = await fetch('/api/norms/sync_from_google', {
            method: 'POST'
        });
        
        const data = await res.json();
        if (res.ok) {
            alert(data.message || "Нормы продукции успешно обновлены из Google Таблицы!");
            loadNorms();
        } else {
            alert("Ошибка синхронизации норм: " + (data.detail || "Неизвестная ошибка"));
        }
    } catch(e) {
        console.error(e);
        alert("Сетевая ошибка при синхронизации норм: " + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

async function syncDowntimesDirFromGoogle() {
    const btn = document.getElementById('btn-sync-downtimes-google');
    const originalText = btn ? btn.innerHTML : '';
    
    if (!confirm("Синхронизировать справочник простоев из Google Таблицы?")) {
        return;
    }
    
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Обновление...';
        }
        
        const res = await fetch('/api/downtimes/directory/sync_from_google', {
            method: 'POST'
        });
        
        const data = await res.json();
        if (res.ok) {
            alert(data.message || "Справочник простоев успешно обновлен из Google Таблицы!");
            loadDowntimesDir();
        } else {
            alert("Ошибка синхронизации справочника: " + (data.detail || "Неизвестная ошибка"));
        }
    } catch(e) {
        console.error(e);
        alert("Сетевая ошибка при синхронизации справочника: " + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}




// --- DOWNTIMES LOG ---
async function loadDowntimesLog() {
    try {
        const res = await fetch('/api/admin/downtimes/all');
        if (!res.ok) throw new Error('Не удалось загрузить простои');
        const data = await res.json();
        const tbody = document.getElementById('downtimes-log-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Нет данных</td></tr>`;
            return;
        }
        
        data.forEach(d => {
            const shiftDate = d.shift_date || 'Н/Д';
            const shiftName = d.shift_name || 'Н/Д';
            const line = d.shift_line || 'Н/Д';
            const startTime = d.start_time || '-';
            const endTime = d.end_time || '-';
            const duration = d.duration || 0;
            const category = d.category || '-';
            
            let displayReason = `${d.node || '-'} / ${d.description || '-'}`;
            if (d.breakdowns) {
                try {
                    const bkList = JSON.parse(d.breakdowns);
                    if (bkList && bkList.length > 0) {
                        displayReason = bkList.map(b => `${b.node || '-'} / ${b.description || '-'}`).join('<br>');
                    }
                } catch(e) {}
            }
            
            tbody.innerHTML += `
                <tr>
                    <td>${shiftDate} ${shiftName}</td>
                    <td>${line}</td>
                    <td>${startTime} - ${endTime}</td>
                    <td>${duration}</td>
                    <td>${displayReason}</td>
                    <td><span style="background: rgba(23,162,184,0.2); color: #17a2b8; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">${category}</span></td>
                    <td style="white-space: nowrap;">
                        <button class="action-btn btn-edit" onclick='editDowntimeRow(${JSON.stringify(d).replace(/'/g, "&apos;")})' style="padding: 0.3rem 0.6rem;"><i class="fa-solid fa-pen"></i></button>
                        <button class="action-btn btn-delete" onclick="deleteDowntimeRow(${d.id})" style="padding: 0.3rem 0.6rem;"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            `;
        });
    } catch (e) {
        console.error(e);
        const tbody = document.getElementById('downtimes-log-table-body');
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:red;">Ошибка загрузки данных</td></tr>`;
    }
}

// ==========================================
// RECEIPTS ADMIN LOGIC
// ==========================================

let currentReceiptPeriod = 'week';

function setReceiptPeriod(period) {
    currentReceiptPeriod = period;
    document.querySelectorAll('#tab-receipts .filter-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'rgba(255,255,255,0.1)';
    });
    const btn = document.getElementById(`filter-receipt-period-${period}`);
    if(btn) {
        btn.classList.add('active');
        btn.style.background = 'var(--accent-color)';
    }
    loadAdminReceipts();
}

async function loadAdminReceipts() {
    const tbody = document.getElementById('receipts-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">Загрузка...</td></tr>';
    
    let url = '/api/admin/receipts';
    
    if (currentReceiptPeriod !== 'all') {
        const today = new Date();
        const start = new Date();
        if (currentReceiptPeriod === 'week') {
            start.setDate(today.getDate() - 7);
        } else if (currentReceiptPeriod === 'month') {
            start.setMonth(today.getMonth() - 1);
        }
        url += `?start_date=${start.toISOString().split('T')[0]}&end_date=${today.toISOString().split('T')[0]}`;
    }

    try {
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` } });
        if (!res.ok) {
            if(res.status === 401) { logoutAdmin(); return; }
            throw new Error('Failed to fetch receipts');
        }
        const data = await res.json();
        
        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">Нет данных</td></tr>';
            return;
        }

        data.forEach(r => {
            const shiftDate = r.shift_date ? r.shift_date.split('-').reverse().join('.') : '';
            const shiftName = r.shift_name || '';
            const line = r.shift_line ? `Линия ${r.shift_line}` : '';
            const master = r.master_name || '';
            
            const cement = (r.cement_silo1 + r.cement_silo2 + r.cement_silo3 + r.cement_silo4).toFixed(1);
            const chrysotile = `${r.chrysotile_4_20.toFixed(1)} / ${r.chrysotile_5_65.toFixed(1)} / ${r.chrysotile_6_40.toFixed(1)}`;
            const cellulose = r.cellulose.toFixed(1);
            const others1 = `${r.crushed_slate.toFixed(1)} / ${r.asbozurit.toFixed(1)} / ${r.asbocarton.toFixed(1)}`;
            const others2 = `${r.pallets.toFixed(1)} / ${r.fiberglass.toFixed(1)} / ${r.laprol.toFixed(1)}`;

            tbody.innerHTML += `
                <tr>
                    <td>${r.id}</td>
                    <td>${shiftDate} ${shiftName}</td>
                    <td>${line}<br><small style="color:var(--text-secondary)">${master}</small></td>
                    <td>${cement}</td>
                    <td>${chrysotile}</td>
                    <td>${cellulose}</td>
                    <td>${others1}</td>
                    <td>${others2}</td>
                    <td style="white-space: nowrap; text-align: right;">
                        <button class="action-btn btn-edit" onclick='editReceiptRow(${JSON.stringify(r).replace(/'/g, "&apos;")})' style="padding: 0.3rem 0.6rem;"><i class="fa-solid fa-pen"></i></button>
                        <button class="action-btn btn-delete" onclick="deleteReceiptRow(${r.id})" style="padding: 0.3rem 0.6rem;"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            `;
        });
    } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:red;">Ошибка загрузки</td></tr>';
    }
}

function editReceiptRow(r) {
    document.getElementById('edit-receipt-id').value = r.id;
    document.getElementById('edit-receipt-cement1').value = r.cement_silo1;
    document.getElementById('edit-receipt-cement2').value = r.cement_silo2;
    document.getElementById('edit-receipt-cement3').value = r.cement_silo3;
    document.getElementById('edit-receipt-cement4').value = r.cement_silo4;
    document.getElementById('edit-receipt-c420').value = r.chrysotile_4_20 / 50;
    document.getElementById('edit-receipt-c565').value = r.chrysotile_5_65 / 50;
    document.getElementById('edit-receipt-c640').value = r.chrysotile_6_40 / 50;
    document.getElementById('edit-receipt-cellulose').value = r.cellulose;
    document.getElementById('edit-receipt-crushed').value = r.crushed_slate;
    document.getElementById('edit-receipt-asbozurit').value = r.asbozurit;
    document.getElementById('edit-receipt-asbocarton').value = r.asbocarton;
    document.getElementById('edit-receipt-pallets').value = r.pallets;
    document.getElementById('edit-receipt-fiberglass').value = r.fiberglass;
    document.getElementById('edit-receipt-laprol').value = r.laprol / 200;
    
    document.getElementById('edit-receipt-modal').style.display = 'block';
}

async function saveReceiptEdit() {
    const id = document.getElementById('edit-receipt-id').value;
    const data = {
        cement_silo1: parseFloat(document.getElementById('edit-receipt-cement1').value) || 0,
        cement_silo2: parseFloat(document.getElementById('edit-receipt-cement2').value) || 0,
        cement_silo3: parseFloat(document.getElementById('edit-receipt-cement3').value) || 0,
        cement_silo4: parseFloat(document.getElementById('edit-receipt-cement4').value) || 0,
        chrysotile_4_20: (parseFloat(document.getElementById('edit-receipt-c420').value) || 0) * 50,
        chrysotile_5_65: (parseFloat(document.getElementById('edit-receipt-c565').value) || 0) * 50,
        chrysotile_6_40: (parseFloat(document.getElementById('edit-receipt-c640').value) || 0) * 50,
        cellulose: parseFloat(document.getElementById('edit-receipt-cellulose').value) || 0,
        crushed_slate: parseFloat(document.getElementById('edit-receipt-crushed').value) || 0,
        asbozurit: parseFloat(document.getElementById('edit-receipt-asbozurit').value) || 0,
        asbocarton: parseFloat(document.getElementById('edit-receipt-asbocarton').value) || 0,
        pallets: parseFloat(document.getElementById('edit-receipt-pallets').value) || 0,
        fiberglass: parseFloat(document.getElementById('edit-receipt-fiberglass').value) || 0,
        laprol: (parseFloat(document.getElementById('edit-receipt-laprol').value) || 0) * 200
    };
    
    try {
        const res = await fetch(`/api/admin/receipts/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
            },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('Failed to update receipt');
        closeModals();
        loadAdminReceipts();
    } catch (e) {
        console.error(e);
        alert('Ошибка при сохранении');
    }
}

async function deleteReceiptRow(id) {
    if(!confirm('Вы уверены, что хотите удалить этот приход сырья? Это действие нельзя отменить.')) return;
    try {
        const res = await fetch(`/api/admin/receipts/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` }
        });
        if (!res.ok) throw new Error('Failed to delete');
        loadAdminReceipts();
    } catch(e) {
        console.error(e);
        alert('Ошибка удаления: ' + e.message);
    }
}

// ------------------------------------------------
// DYNAMIC BREAKDOWNS LOGIC (ADMIN)
// ------------------------------------------------
let adminBreakdownRowCounter = 0;

async function addAdminBreakdownRow(initialData = null) {
    const container = document.getElementById(`admin-dt-breakdowns-container`);
    if (!container) return;
    
    const rowId = adminBreakdownRowCounter++;
    
    const rowHtml = `
        <div class="breakdown-row" id="admin-dt-brk-row-${rowId}" style="border: 1px solid var(--glass-border); padding: 1rem; border-radius: 8px; background: rgba(255,255,255,0.02); position: relative;">
            <button type="button" class="btn-danger" onclick="this.parentElement.remove()" style="position: absolute; top: 0.5rem; right: 0.5rem; width: auto; padding: 0.2rem 0.6rem; font-size: 0.7rem; cursor: pointer; border: none; border-radius: 4px;">Удалить</button>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 0.5rem; padding-right: 3rem;">
                <div>
                    <label style="font-size: 0.8rem; color: var(--text-secondary);">Участок / Отделение</label>
                    <select class="brk-dept" onchange="onAdminBrkDeptChange(this)" style="margin-bottom:0;">
                        <option value="">-- Выберите участок --</option>
                    </select>
                </div>
                <div>
                    <label style="font-size: 0.8rem; color: var(--text-secondary);">Узел / Оборудование</label>
                    <select class="brk-node" onchange="onAdminBrkNodeChange(this)" style="margin-bottom:0;">
                        <option value="">-- Сначала выберите участок --</option>
                    </select>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div>
                    <label style="font-size: 0.8rem; color: var(--text-secondary);">Поломка / Причина</label>
                    <select class="brk-desc" onchange="onAdminBrkDescChange(this)" style="margin-bottom:0;">
                        <option value="">-- Сначала выберите узел --</option>
                    </select>
                </div>
                <div>
                    <label style="font-size: 0.8rem; color: var(--text-secondary);">Кастомный текст (Свой вариант)</label>
                    <input type="text" class="brk-custom-desc" placeholder="Введите свою поломку" style="display:none; margin-bottom:0;" />
                </div>
            </div>
            <input type="hidden" class="brk-category" value="" />
        </div>
    `;
    
    container.insertAdjacentHTML('beforeend', rowHtml);
    
    const rowDiv = document.getElementById(`admin-dt-brk-row-${rowId}`);
    const deptSelect = rowDiv.querySelector('.brk-dept');
    
    try {
        const res = await fetch('/api/downtimes/directory/departments');
        if (res.ok) {
            const depts = await res.json();
            depts.sort((a, b) => a.localeCompare(b));
            deptSelect.innerHTML = '<option value="">-- Выберите участок --</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
            
            if (initialData && initialData.department) {
                deptSelect.value = initialData.department;
                await onAdminBrkDeptChange(deptSelect, initialData.node, initialData.description);
                if (initialData.category) {
                    rowDiv.querySelector('.brk-category').value = initialData.category;
                }
            }
        }
    } catch(e) {
        console.error(e);
    }
}

async function onAdminBrkDeptChange(selectElement, initialNode = null, initialDesc = null) {
    const rowDiv = selectElement.closest('.breakdown-row');
    const dept = selectElement.value;
    const selectNode = rowDiv.querySelector('.brk-node');
    
    if (!dept) {
        selectNode.innerHTML = '<option value="">-- Сначала выберите участок --</option>';
        return;
    }
    
    try {
        const res = await fetch(`/api/downtimes/directory/nodes?department=${encodeURIComponent(dept)}`);
        if (res.ok) {
            const nodes = await res.json();
            nodes.sort((a, b) => a.localeCompare(b));
            selectNode.innerHTML = '<option value="">-- Выберите узел --</option>' +
                nodes.map(n => `<option value="${n}">${n}</option>`).join('');
                
            if (initialNode) {
                selectNode.value = initialNode;
                await onAdminBrkNodeChange(selectNode, initialDesc);
            }
        }
    } catch(e) {
        console.error(e);
    }
}

async function onAdminBrkNodeChange(selectElement, initialDesc = null) {
    const rowDiv = selectElement.closest('.breakdown-row');
    const dept = rowDiv.querySelector('.brk-dept').value;
    const node = selectElement.value;
    const selectBk = rowDiv.querySelector('.brk-desc');
    
    if (!dept || !node) {
        selectBk.innerHTML = '<option value="">-- Сначала выберите узел --</option>';
        return;
    }
    
    try {
        const res = await fetch(`/api/downtimes/directory/breakdowns?department=${encodeURIComponent(dept)}&node=${encodeURIComponent(node)}`);
        if (res.ok) {
            const breakdowns = await res.json();
            breakdowns.sort((a, b) => a.breakdown.localeCompare(b.breakdown));
            
            selectBk.innerHTML = '<option value="">-- Выберите поломку --</option>' +
                breakdowns.map(b => `<option value="${b.breakdown}" data-category="${b.category || ''}">${b.breakdown}</option>`).join('') +
                '<option value="_CUSTOM_">✏️ Свой вариант (Ввести вручную)</option>';
                
            if (initialDesc) {
                let exists = false;
                for (let i = 0; i < selectBk.options.length; i++) {
                    if (selectBk.options[i].value === initialDesc) {
                        exists = true;
                        break;
                    }
                }
                
                if (exists) {
                    selectBk.value = initialDesc;
                } else {
                    selectBk.value = '_CUSTOM_';
                    rowDiv.querySelector('.brk-custom-desc').value = initialDesc;
                }
                onAdminBrkDescChange(selectBk);
            }
        }
    } catch(e) {
        console.error(e);
    }
}

function onAdminBrkDescChange(selectElement) {
    const rowDiv = selectElement.closest('.breakdown-row');
    const customInput = rowDiv.querySelector('.brk-custom-desc');
    const categoryInput = rowDiv.querySelector('.brk-category');
    
    if (selectElement.value === '_CUSTOM_') {
        customInput.style.display = 'block';
        categoryInput.value = 'Разное';
    } else {
        customInput.style.display = 'none';
        const selectedOption = selectElement.options[selectElement.selectedIndex];
        if (selectedOption) {
            categoryInput.value = selectedOption.getAttribute('data-category') || '';
        }
    }
}

// Password Management
async function loadPasswords() {
    try {
        const res = await fetch('/api/admin/document-categories');
        const data = await res.json();
        const tbody = document.getElementById('passwords-table-body');
        if (data.status === 'success') {
            tbody.innerHTML = data.data.map(cat => `
                <tr>
                    <td>${cat.id}</td>
                    <td>${cat.name}</td>
                    <td>${cat.is_protected ? '<span style="color:red">Защищена</span>' : '<span style="color:green">Открыта</span>'}</td>
                    <td>
                        <button onclick="setPassword(${cat.id})" style="padding: 0.3rem 0.5rem;"><i class="fa-solid fa-key"></i> Установить пароль</button>
                        ${cat.is_protected ? `<button onclick="clearPassword(${cat.id})" style="padding: 0.3rem 0.5rem; background: #e74c3c; margin-left: 0.5rem;"><i class="fa-solid fa-trash"></i> Сбросить</button>` : ''}
                    </td>
                </tr>
            `).join('');
        }
    } catch(e) {
        console.error(e);
    }
}

async function setPassword(catId) {
    const pwd = prompt("Введите новый пароль для папки:");
    if (!pwd) return;
    try {
        const res = await fetch(`/api/admin/document-categories/${catId}/set-password`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password: pwd})
        });
        if (res.ok) {
            alert("Пароль успешно установлен");
            loadPasswords();
        } else {
            alert("Ошибка установки пароля");
        }
    } catch (e) {
        console.error(e);
    }
}

async function clearPassword(catId) {
    if (!confirm("Вы уверены, что хотите сбросить пароль? Папка станет общедоступной.")) return;
    try {
        const res = await fetch(`/api/admin/document-categories/${catId}/set-password`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password: null})
        });
        if (res.ok) {
            alert("Пароль сброшен");
            loadPasswords();
        } else {
            alert("Ошибка сброса пароля");
        }
    } catch (e) {
        console.error(e);
    }
}


// ========================================================
// УПРАВЛЕНИЕ СОТРУДНИКАМИ ЦЕХА (ЧЕК-ЛИСТЫ)
// ========================================================
let adminChecklistEmps = [];

async function loadAdminChecklistEmployees() {
    try {
        const res = await fetch('/api/checklists/employees');
        if (res.ok) {
            adminChecklistEmps = await res.json();
            renderChecklistEmployeesTable();
        }
    } catch (e) {
        console.error("Error loading checklist employees:", e);
    }
}

function renderChecklistEmployeesTable() {
    const tbody = document.getElementById('checklist-emps-table-body');
    if (!tbody) return;

    const shiftFilter = document.getElementById('filter-emp-shift') ? document.getElementById('filter-emp-shift').value : '';
    const searchFilter = document.getElementById('filter-emp-search') ? document.getElementById('filter-emp-search').value.toLowerCase().trim() : '';

    let filtered = adminChecklistEmps.filter(e => {
        const matchShift = !shiftFilter || e.shift_group === shiftFilter;
        const matchSearch = !searchFilter || e.name.toLowerCase().includes(searchFilter) || e.position.toLowerCase().includes(searchFilter);
        return matchShift && matchSearch;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-secondary); padding: 1.5rem;">Сотрудники не найдены</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(e => `
        <tr>
            <td style="font-weight: 600; color: var(--text-secondary);">${e.num || '—'}</td>
            <td style="font-weight: 700; color: var(--text-primary);">${e.name}</td>
            <td><span style="background: rgba(37,99,235,0.15); color: #60a5fa; padding: 4px 8px; border-radius: 6px; font-weight: 600; font-size: 0.8rem;">${e.shift_group}</span></td>
            <td><span style="background: rgba(16,185,129,0.15); color: #34d399; padding: 4px 8px; border-radius: 6px; font-size: 0.8rem;">${e.department || 'Цех ХЦИ'}</span></td>
            <td style="color: var(--text-secondary);">${e.position}</td>
            <td style="text-align: right; white-space: nowrap;">
                <button class="action-btn btn-edit" onclick="editChecklistEmp(${e.id})" title="Редактировать"><i class="fa-solid fa-pen"></i></button>
                <button class="action-btn btn-delete" onclick="deleteChecklistEmp(${e.id}, '${e.name}')" title="Удалить"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

function openChecklistEmpModal() {
    document.getElementById('cl-emp-id').value = '';
    document.getElementById('cl-emp-name').value = '';
    document.getElementById('cl-emp-pos').value = '';
    document.getElementById('cl-emp-num').value = '';
    document.getElementById('cl-emp-shift').value = '1-я смена';
    document.getElementById('cl-emp-dept').value = 'ЛФМ';
    document.getElementById('checklist-emp-modal-title').innerHTML = '<i class="fa-solid fa-user-plus"></i> Добавить сотрудника';
    document.getElementById('checklist-emp-modal').style.display = 'flex';
}

function editChecklistEmp(empId) {
    const emp = adminChecklistEmps.find(e => e.id === empId);
    if (!emp) return;

    document.getElementById('cl-emp-id').value = emp.id;
    document.getElementById('cl-emp-name').value = emp.name;
    document.getElementById('cl-emp-pos').value = emp.position;
    document.getElementById('cl-emp-num').value = emp.num || '';
    document.getElementById('cl-emp-shift').value = emp.shift_group;
    if (document.getElementById('cl-emp-dept')) {
        document.getElementById('cl-emp-dept').value = emp.department || 'ЛФМ';
    }
    document.getElementById('checklist-emp-modal-title').innerHTML = '<i class="fa-solid fa-user-pen"></i> Редактировать сотрудника';
    document.getElementById('checklist-emp-modal').style.display = 'flex';
}

async function saveChecklistEmployee() {
    const empId = document.getElementById('cl-emp-id').value;
    const name = document.getElementById('cl-emp-name').value.trim();
    const position = document.getElementById('cl-emp-pos').value.trim();
    const shiftGroup = document.getElementById('cl-emp-shift').value;
    const dept = document.getElementById('cl-emp-dept') ? document.getElementById('cl-emp-dept').value : '';
    const num = document.getElementById('cl-emp-num').value;

    if (!name || !position) {
        alert("Пожалуйста, заполните ФИО и должность!");
        return;
    }

    const payload = {
        name: name,
        position: position,
        shift_group: shiftGroup,
        department: dept,
        num: num ? parseInt(num) : null
    };

    try {
        const url = empId ? `/api/checklists/employees/${empId}` : `/api/checklists/employees`;
        const method = empId ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            closeModals();
            loadAdminChecklistEmployees();
        } else {
            const err = await res.json();
            alert("Ошибка сохранения: " + (err.detail || "Неизвестная ошибка"));
        }
    } catch (e) {
        alert("Ошибка сети при сохранении сотрудника");
    }
}

async function deleteChecklistEmp(empId, name) {
    if (!confirm(`Вы действительно хотите удалить сотрудника "${name}"?`)) return;

    try {
        const res = await fetch(`/api/checklists/employees/${empId}`, { method: 'DELETE' });
        if (res.ok) {
            loadAdminChecklistEmployees();
        } else {
            alert("Ошибка при удалении сотрудника");
        }
    } catch (e) {
        alert("Ошибка сети");
    }
}

async function syncChecklistEmployeesFromGoogle() {
    if (!confirm("Запустить обновление базы сотрудников из Google Таблицы?")) return;
    try {
        const res = await fetch('/api/checklists/employees/sync', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            alert(`Синхронизация завершена!\nОбработано строк: ${data.total_rows}\nДобавлено/обновлено: ${data.synced_count}`);
            loadAdminChecklistEmployees();
        } else {
            alert("Ошибка синхронизации: " + (data.message || data.detail));
        }
    } catch (e) {
        alert("Ошибка сети при синхронизации");
    }
}

// ========================================================
// УПРАВЛЕНИЕ ГРАФИКОМ СМЕННОСТИ
// ========================================================
let adminShiftSchedule = [];

async function loadAdminShiftSchedule() {
    try {
        const res = await fetch('/api/checklists/schedule/all');
        if (res.ok) {
            adminShiftSchedule = await res.json();
            renderShiftScheduleTable();
        }
    } catch (e) {
        console.error("Error loading shift schedule:", e);
    }
}

function renderShiftScheduleTable() {
    const tbody = document.getElementById('shift-schedule-table-body');
    if (!tbody) return;

    const searchDate = document.getElementById('schedule-search-date') ? document.getElementById('schedule-search-date').value.toLowerCase().trim() : '';

    let filtered = adminShiftSchedule.filter(e => {
        return !searchDate || (e.date_str && e.date_str.toLowerCase().includes(searchDate));
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-secondary); padding: 1.5rem;">График не найден</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(e => `
        <tr>
            <td style="font-weight: 700; color: var(--primary-color);">${e.date_str}</td>
            <td style="color: var(--text-secondary);">${e.day_of_week || '—'}</td>
            <td><span style="background: rgba(245,158,11,0.15); color: #fbbf24; padding: 4px 8px; border-radius: 6px; font-weight: 700;">☀️ ${e.day_shift_group || '—'}</span></td>
            <td><span style="background: rgba(99,102,241,0.15); color: #818cf8; padding: 4px 8px; border-radius: 6px; font-weight: 700;">🌙 ${e.night_shift_group || '—'}</span></td>
            <td style="text-align: center;">${e.shift1_status || '—'}</td>
            <td style="text-align: center;">${e.shift2_status || '—'}</td>
            <td style="text-align: center;">${e.shift3_status || '—'}</td>
            <td style="text-align: center;">${e.shift4_status || '—'}</td>
            <td style="text-align: right;">
                <button class="action-btn btn-edit" onclick="openEditShiftScheduleModal('${e.date_str}', '${e.day_shift_group || ''}', '${e.night_shift_group || ''}')" title="Изменить смены"><i class="fa-solid fa-pen"></i></button>
            </td>
        </tr>
    `).join('');
}

function openEditShiftScheduleModal(dateStr, dayShift, nightShift) {
    document.getElementById('sched-date-str').value = dateStr;
    document.getElementById('sched-date-display').value = dateStr;
    document.getElementById('sched-day-shift').value = dayShift || 'Смена 1';
    document.getElementById('sched-night-shift').value = nightShift || 'Смена 2';
    document.getElementById('shift-schedule-modal').style.display = 'flex';
}

async function saveShiftScheduleDay() {
    const dateStr = document.getElementById('sched-date-str').value;
    const dayShift = document.getElementById('sched-day-shift').value;
    const nightShift = document.getElementById('sched-night-shift').value;

    try {
        const res = await fetch('/api/checklists/schedule/update_day', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                date_str: dateStr,
                day_shift_group: dayShift,
                night_shift_group: nightShift
            })
        });

        if (res.ok) {
            closeModals();
            loadAdminShiftSchedule();
        } else {
            alert("Ошибка при сохранении графика");
        }
    } catch (e) {
        alert("Ошибка сети при сохранении");
    }
}


// ==========================================================
// ⚙️ PLANNER SETTINGS (EMPLOYEES & ZONES) ADMIN LOGIC
// ==========================================================

let adminPlannerEmployees = [];
let adminPlannerZones = [];
let adminAllTasks = [];

async function loadPlannerSettings() {
    await Promise.all([loadPlannerEmployees(), loadPlannerZones(), loadAdminTasksList()]);
}

async function loadPlannerEmployees() {
    try {
        const res = await fetch('/api/planner/employees');
        if (res.ok) {
            adminPlannerEmployees = await res.json();
            renderPlannerEmployeesTable();
        }
    } catch (e) {
        console.error("Error loading planner employees:", e);
    }
}

function renderPlannerEmployeesTable() {
    const tbody = document.getElementById('planner-employees-table-body');
    if (!tbody) return;

    if (adminPlannerEmployees.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">Нет добавленных сотрудников</td></tr>`;
        return;
    }

    tbody.innerHTML = adminPlannerEmployees.map((emp, idx) => `
        <tr>
            <td style="color: var(--text-secondary); width: 35px;">${idx + 1}</td>
            <td style="font-weight: 600; color: var(--text-primary);">${emp.name}</td>
            <td style="color: ${emp.email ? 'var(--accent-color)' : 'var(--text-secondary)'};">
                ${emp.email ? `<i class="fa-regular fa-envelope"></i> ${emp.email}` : '—'}
            </td>
            <td style="text-align: right; white-space: nowrap;">
                <button onclick="openPlannerEmployeeModal(${emp.id}, '${emp.name.replace(/'/g, "\\'")}', '${(emp.email || '').replace(/'/g, "\\'")}')" class="action-btn btn-edit" title="Редактировать"><i class="fa-solid fa-pen"></i></button>
                <button onclick="deletePlannerEmployee(${emp.id}, '${emp.name.replace(/'/g, "\\'")}')" class="action-btn btn-delete" title="Удалить"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

function openPlannerEmployeeModal(id = null, name = '', email = '') {
    document.getElementById('planner-emp-id').value = id || '';
    document.getElementById('planner-emp-name').value = name || '';
    document.getElementById('planner-emp-email').value = email || '';
    document.getElementById('planner-emp-modal-title').innerHTML = id ? `<i class="fa-solid fa-pen"></i> Редактировать сотрудника` : `<i class="fa-solid fa-user-plus"></i> Добавить сотрудника`;
    
    const modal = document.getElementById('planner-emp-modal');
    if (modal) modal.style.display = 'flex';
}

async function savePlannerEmployee() {
    const id = document.getElementById('planner-emp-id').value;
    const name = document.getElementById('planner-emp-name').value.trim();
    const email = document.getElementById('planner-emp-email').value.trim();

    if (!name) {
        alert("Пожалуйста, укажите имя/ФИО сотрудника");
        return;
    }

    try {
        const url = id ? `/api/planner/employees/${id}` : '/api/planner/employees';
        const method = id ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name: name, email: email })
        });

        if (res.ok) {
            closePlannerModals();
            loadPlannerEmployees();
        } else {
            const err = await res.json();
            alert("Ошибка сохранения: " + (err.detail || "Не удалось сохранить"));
        }
    } catch (e) {
        alert("Ошибка сети при сохранении");
    }
}

async function deletePlannerEmployee(id, name) {
    if (!confirm(`Вы действительно хотите удалить сотрудника «${name}» из настроек планнера?`)) return;

    try {
        const res = await fetch(`/api/planner/employees/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadPlannerEmployees();
        } else {
            alert("Ошибка при удалении");
        }
    } catch (e) {
        alert("Ошибка сети при удалении");
    }
}

async function loadPlannerZones() {
    try {
        const res = await fetch('/api/planner/zones');
        if (res.ok) {
            adminPlannerZones = await res.json();
            renderPlannerZonesTable();
        }
    } catch (e) {
        console.error("Error loading planner zones:", e);
    }
}

function renderPlannerZonesTable() {
    const tbody = document.getElementById('planner-zones-table-body');
    if (!tbody) return;

    if (adminPlannerZones.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary);">Нет добавленных зон</td></tr>`;
        return;
    }

    tbody.innerHTML = adminPlannerZones.map((z, idx) => `
        <tr>
            <td style="color: var(--text-secondary); width: 35px;">${idx + 1}</td>
            <td style="font-weight: 500; color: var(--text-primary);"><i class="fa-solid fa-tag" style="font-size: 0.75rem; color: var(--accent-color); margin-right: 4px;"></i> ${z.name}</td>
            <td style="text-align: right; white-space: nowrap;">
                <button onclick="openPlannerZoneModal(${z.id}, '${z.name.replace(/'/g, "\\'")}')" class="action-btn btn-edit" title="Редактировать"><i class="fa-solid fa-pen"></i></button>
                <button onclick="deletePlannerZone(${z.id}, '${z.name.replace(/'/g, "\\'")}')" class="action-btn btn-delete" title="Удалить"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

function openPlannerZoneModal(id = null, name = '') {
    document.getElementById('planner-zone-id').value = id || '';
    document.getElementById('planner-zone-name').value = name || '';
    document.getElementById('planner-zone-modal-title').innerHTML = id ? `<i class="fa-solid fa-pen"></i> Редактировать зону` : `<i class="fa-solid fa-plus"></i> Добавить зону / подразделение`;
    
    const modal = document.getElementById('planner-zone-modal');
    if (modal) modal.style.display = 'flex';
}

async function savePlannerZone() {
    const id = document.getElementById('planner-zone-id').value;
    const name = document.getElementById('planner-zone-name').value.trim();

    if (!name) {
        alert("Пожалуйста, укажите название зоны / подразделения");
        return;
    }

    try {
        const url = id ? `/api/planner/zones/${id}` : '/api/planner/zones';
        const method = id ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name: name })
        });

        if (res.ok) {
            closePlannerModals();
            loadPlannerZones();
        } else {
            const err = await res.json();
            alert("Ошибка сохранения: " + (err.detail || "Не удалось сохранить"));
        }
    } catch (e) {
        alert("Ошибка сети при сохранении");
    }
}

async function deletePlannerZone(id, name) {
    if (!confirm(`Вы действительно хотите удалить зону «${name}» из настроек планнера?`)) return;

    try {
        const res = await fetch(`/api/planner/zones/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadPlannerZones();
        } else {
            alert("Ошибка при удалении");
        }
    } catch (e) {
        alert("Ошибка сети при удалении");
    }
}

function closePlannerModals() {
    const empModal = document.getElementById('planner-emp-modal');
    if (empModal) empModal.style.display = 'none';
    const zoneModal = document.getElementById('planner-zone-modal');
    if (zoneModal) zoneModal.style.display = 'none';
}

/* ==========================================================
   ADMIN TASKS REGISTRY & DELETION
   ========================================================== */
async function loadAdminTasksList() {
    const tbody = document.getElementById('admin-tasks-table-body');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary);"><i class="fa-solid fa-spinner fa-spin"></i> Загрузка задач...</td></tr>`;

    try {
        const res = await fetch('/api/tasks?month=all');
        if (res.ok) {
            adminAllTasks = await res.json();
            renderAdminTasksTable(adminAllTasks);
        } else {
            if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger-color);">Не удалось загрузить задачи</td></tr>`;
        }
    } catch (e) {
        console.error("Error loading admin tasks:", e);
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger-color);">Ошибка сети</td></tr>`;
    }
}

function renderAdminTasksTable(tasks) {
    const tbody = document.getElementById('admin-tasks-table-body');
    if (!tbody) return;

    if (!tasks || tasks.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary);">Задач не найдено</td></tr>`;
        return;
    }

    tbody.innerHTML = tasks.map(t => `
        <tr>
            <td style="font-family: monospace; font-weight: 700; color: var(--accent-color); font-size: 0.8rem;">${t.code || ('TSK-' + t.id)}</td>
            <td style="color: var(--text-secondary); font-size: 0.78rem; white-space: nowrap;">${t.month_label || '—'} / ${t.week_label || '—'}</td>
            <td style="font-size: 0.82rem; color: var(--text-primary);"><span style="background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px;">${t.zone || '—'}</span></td>
            <td style="font-weight: 500; color: var(--text-primary); max-width: 320px; font-size: 0.85rem;">
                <div>${(t.title || '—')}</div>
                ${t.title_kz ? `<div style="font-size: 0.75rem; color: var(--text-secondary);">${t.title_kz}</div>` : ''}
            </td>
            <td style="font-size: 0.82rem; color: var(--text-primary); white-space: nowrap;">${t.assignee_name || '—'}</td>
            <td style="font-size: 0.78rem; white-space: nowrap;">${t.status || '—'}</td>
            <td style="text-align: right; white-space: nowrap;">
                <button onclick="deleteTaskFromAdmin(${t.id}, '${(t.title || '').replace(/'/g, "\\'")}')" class="action-btn btn-delete" title="Удалить задачу навсегда">
                    <i class="fa-solid fa-trash"></i> Удалить
                </button>
            </td>
        </tr>
    `).join('');
}

function filterAdminTasksTable() {
    const q = (document.getElementById('admin-task-search')?.value || '').toLowerCase().trim();
    if (!q) {
        renderAdminTasksTable(adminAllTasks);
        return;
    }
    const filtered = adminAllTasks.filter(t => 
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.title_kz && t.title_kz.toLowerCase().includes(q)) ||
        (t.assignee_name && t.assignee_name.toLowerCase().includes(q)) ||
        (t.author_name && t.author_name.toLowerCase().includes(q)) ||
        (t.zone && t.zone.toLowerCase().includes(q)) ||
        (t.code && t.code.toLowerCase().includes(q)) ||
        (t.month_label && t.month_label.toLowerCase().includes(q))
    );
    renderAdminTasksTable(filtered);
}

async function deleteTaskFromAdmin(taskId, taskTitle) {
    if (!confirm(`Вы действительно хотите БЕЗВОЗВРАТНО удалить задачу ID ${taskId} («${taskTitle}»)?`)) return;

    try {
        const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
        if (res.ok) {
            alert("Задача успешно удалена");
            loadAdminTasksList();
        } else {
            const err = await res.json();
            alert("Ошибка удаления: " + (err.detail || "Не удалось удалить"));
        }
    } catch (e) {
        alert("Ошибка сети при удалении");
    }
}

async function testSendPlannerEmailPrompt() {
    const targetEmail = prompt("Введите Email для отправки тестового уведомления:", "");
    if (!targetEmail || !targetEmail.trim()) return;

    try {
        const res = await fetch('/api/planner/test_email', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ to_email: targetEmail.trim() })
        });

        const data = await res.json();
        if (res.ok) {
            alert(data.message || "Тестовое письмо успешно отправлено! Проверьте входящие.");
        } else {
            alert("Ошибка отправки: " + (data.detail || "Проверьте переменные SMTP в Railway"));
        }
    } catch (e) {
        alert("Ошибка сети при проверке отправки");
    }
}




