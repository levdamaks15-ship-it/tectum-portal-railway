let currentAdmin = null;

async function initAdminLogin() {
    try {
        const res = await fetch('/api/masters/');
        const masters = await res.json();
        const select = document.getElementById('admin-name');
        select.innerHTML = '';
        
        const admins = masters.filter(m => m.role === 'admin' || m.role === 'director');
        admins.forEach(a => {
            select.innerHTML += `<option value="${a.name}">${a.name} (${a.role})</option>`;
        });
    } catch (e) {
        console.error(e);
    }
}

async function adminLogin() {
    const pin = document.getElementById('admin-pin').value;
    const name = document.getElementById('admin-name').value;
    if (!pin || !name) return;

    try {
        const loginRes = await fetch('/api/login/', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name: name, pin: pin })
        });

        if (loginRes.ok) {
            const data = await loginRes.json();
            if (data.role === 'admin' || data.role === 'director') {
                currentAdmin = data;
                document.getElementById('admin-login-screen').style.display = 'none';
                document.getElementById('admin-app').style.display = 'flex';
                loadMasters();
                loadNorms();
            } else {
                throw new Error("Нет прав");
            }
        } else {
            throw new Error("Неверный ПИН-код");
        }
    } catch (e) {
        document.getElementById('admin-login-error').innerText = "Неверный ПИН-код или нет прав.";
        document.getElementById('admin-login-error').style.display = 'block';
    }
}

// Call init on load
window.addEventListener('DOMContentLoaded', initAdminLogin);


function switchAdminTab(tabId) {
    document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('nav-' + tabId).classList.add('active');
    
    document.getElementById('tab-masters').style.display = 'none';
    document.getElementById('tab-norms').style.display = 'none';
    document.getElementById('tab-plan-board').style.display = 'none';
    document.getElementById('tab-shifts').style.display = 'none';
    document.getElementById('tab-cleanup').style.display = 'none';
    document.getElementById('tab-audit-logs').style.display = 'none';
    const tabDowntimes = document.getElementById('tab-downtimes-dir');
    if (tabDowntimes) tabDowntimes.style.display = 'none';
    
    document.getElementById('tab-' + tabId).style.display = 'block';

    if (tabId === 'plan-board') {
        loadPlanBoard();
    } else if (tabId === 'audit-logs') {
        loadAuditLogs();
    } else if (tabId === 'shifts') {
        loadShifts();
    } else if (tabId === 'downtimes-dir') {
        loadDowntimesDir();
    }

}

function closeModals() {
    document.getElementById('master-modal').style.display = 'none';
    document.getElementById('norm-modal').style.display = 'none';
    const shiftModal = document.getElementById('shift-modal');
    if (shiftModal) shiftModal.style.display = 'none';
    const shiftDetailsModal = document.getElementById('shift-details-modal');
    if (shiftDetailsModal) shiftDetailsModal.style.display = 'none';
    const dtDirModal = document.getElementById('downtime-dir-modal');
    if (dtDirModal) dtDirModal.style.display = 'none';
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
    if (!confirm("ВЫ УВЕРЕНЫ? Все записи о сменах, простоях и партиях будут удалены БЕЗВОЗВРАТНО.")) return;
    if (!confirm("Подтвердите еще раз: Вы выгрузили все нужные Excel/PDF отчеты?")) return;

    try {
        const res = await fetch('/api/admin/clear_data/', { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            alert(`Данные успешно очищены!\nУдалено смен: ${data.deleted.shifts}\nПартий: ${data.deleted.batches}\nПростоев: ${data.deleted.downtimes}\nЗаписей выработки: ${data.deleted.plan_board}`);
            loadPlanBoard();
        } else {
            alert("Произошла ошибка при очистке БД на сервере.");
        }
    } catch (e) {
        alert("Сетевая ошибка при очистке БД.");
    }
}

// Handle enter key in login
document.getElementById('admin-pin').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        adminLogin();
    }
});

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
                <button class="btn-danger" style="padding: 0.25rem 0.5rem; width: auto; font-size: 0.8rem;" onclick="deletePlanBoardRow(${p.id})">
                    <i class="fa-solid fa-trash"></i> Удалить
                </button>
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

async function loadAuditLogs() {
    try {
        const res = await fetch('/api/admin/audit_logs');
        const data = await res.json();
        const tbody = document.getElementById('audit-logs-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Нет записей</td></tr>`;
            return;
        }
        data.forEach(log => {
            const dateObj = new Date(log.timestamp);
            const timeStr = dateObj.toLocaleString('ru-RU');
            tbody.innerHTML += `
                <tr>
                    <td>${timeStr}</td>
                    <td>${log.user_name || 'Система'}</td>
                    <td><strong style="color: ${log.action === 'DELETE' ? 'var(--danger-color)' : log.action === 'UPDATE' ? 'var(--accent-color)' : 'var(--success-color)'};">${log.action}</strong></td>
                    <td>${log.target_table}</td>
                    <td style="font-size: 0.85rem; max-width: 400px; word-break: break-all;">${log.details || ''}</td>
                </tr>
            `;
        });
    } catch (e) {
        console.error(e);
        const tbody = document.getElementById('audit-logs-table-body');
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:red;">Ошибка загрузки логов</td></tr>`;
    }
}

// --- SHIFTS CRUD & FULL PRODUCTION DATA EDITING ---

let allMastersCached = [];

async function loadShifts() {
    try {
        const res = await fetch('/api/shifts/all');
        const shifts = await res.json();
        
        const mastersRes = await fetch('/api/masters/');
        allMastersCached = await mastersRes.json();
        
        const tbody = document.getElementById('shifts-table-body');
        tbody.innerHTML = '';
        
        if (shifts.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Смен не обнаружено</td></tr>`;
            return;
        }
        
        shifts.forEach(s => {
            const master = allMastersCached.find(m => m.id === s.master_id);
            const masterName = master ? master.name : `ID: ${s.master_id}`;
            const statusStyle = s.status === 'active' ? 'color: var(--success-color); font-weight: bold;' : 'color: var(--text-secondary);';
            
            tbody.innerHTML += `
                <tr>
                    <td>${s.id}</td>
                    <td>${s.date}</td>
                    <td>${s.shift_name}</td>
                    <td>${s.line}</td>
                    <td>${masterName}</td>
                    <td style="${statusStyle}">${s.status}</td>
                    <td>
                        <button class="action-btn btn-edit" title="Редактировать смену и сырье" onclick="editShift(${s.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button class="action-btn" title="Производственные отчеты (ЛФМ, партии, простои)" style="background: var(--warning-color); color: black;" onclick="showShiftDetails(${s.id})"><i class="fa-solid fa-industry"></i></button>
                        <button class="action-btn btn-delete" title="Удалить смену полностью" onclick="deleteShift(${s.id})"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            `;
        });
    } catch (e) {
        console.error(e);
        alert("Ошибка при загрузке смен");
    }
}

async function editShift(id) {
    try {
        const res = await fetch(`/api/admin/shifts/${id}/details`);
        if (!res.ok) throw new Error("Не удалось загрузить данные смены");
        const data = await res.json();
        const shift = data.shift;
        
        document.getElementById('shift-edit-id').value = shift.id;
        document.getElementById('shift-edit-date').value = shift.date;
        document.getElementById('shift-edit-name').value = shift.shift_name;
        document.getElementById('shift-edit-line').value = shift.line;
        document.getElementById('shift-edit-status').value = shift.status;
        document.getElementById('shift-edit-plan-sheets').value = shift.plan_sheets || 0;
        document.getElementById('shift-edit-plan-tons').value = shift.plan_tons || 0;
        
        const masterSelect = document.getElementById('shift-edit-master');
        masterSelect.innerHTML = '';
        allMastersCached.filter(m => m.role === 'master').forEach(m => {
            const selected = m.id === shift.master_id ? 'selected' : '';
            masterSelect.innerHTML += `<option value="${m.id}" ${selected}>${m.name}</option>`;
        });
        
        document.getElementById('shift-edit-receipt-chr420').value = shift.receipt_chrysotile_4_20 || 0;
        document.getElementById('shift-edit-receipt-chr565').value = shift.receipt_chrysotile_5_65 || 0;
        document.getElementById('shift-edit-receipt-chr640').value = shift.receipt_chrysotile_6_40 || 0;
        document.getElementById('shift-edit-receipt-cement').value = shift.receipt_cement || 0;
        document.getElementById('shift-edit-receipt-cellulose').value = shift.receipt_cellulose || 0;
        document.getElementById('shift-edit-receipt-slate').value = shift.receipt_crushed_slate || 0;
        document.getElementById('shift-edit-receipt-asbozurit').value = shift.receipt_asbozurit || 0;
        document.getElementById('shift-edit-receipt-fiberglass').value = shift.receipt_fiberglass || 0;
        document.getElementById('shift-edit-receipt-laprol').value = shift.receipt_laprol || 0;
        
        document.getElementById('shift-edit-zo-chr420').value = shift.zo_chrysotile_4_20 || 0;
        document.getElementById('shift-edit-zo-chr565').value = shift.zo_chrysotile_5_65 || 0;
        document.getElementById('shift-edit-zo-chr640').value = shift.zo_chrysotile_6_40 || 0;
        document.getElementById('shift-edit-zo-cement-s1').value = shift.zo_cement_silo1 || 0;
        document.getElementById('shift-edit-zo-cement-s2').value = shift.zo_cement_silo2 || 0;
        document.getElementById('shift-edit-zo-cement-s3').value = shift.zo_cement_silo3 || 0;
        document.getElementById('shift-edit-zo-cement-s4').value = shift.zo_cement_silo4 || 0;
        document.getElementById('shift-edit-zo-cellulose').value = shift.zo_cellulose || 0;
        document.getElementById('shift-edit-zo-slate').value = shift.zo_crushed_slate || 0;
        document.getElementById('shift-edit-zo-asbozurit').value = shift.zo_asbozurit || 0;
        document.getElementById('shift-edit-zo-fiberglass').value = shift.zo_fiberglass || 0;
        document.getElementById('shift-edit-zo-laprol').value = shift.zo_laprol || 0;
        document.getElementById('shift-edit-zo-asb-drain').value = shift.zo_asb_drain || 0;
        document.getElementById('shift-edit-zo-cem-drain').value = shift.zo_cem_drain || 0;
        document.getElementById('shift-edit-zo-batches').value = shift.zo_batches || 0;
        
        document.getElementById('shift-modal').style.display = 'flex';
    } catch (e) {
        console.error(e);
        alert(e.message);
    }
}

async function saveShiftEdit() {
    const id = document.getElementById('shift-edit-id').value;
    const data = {
        date: document.getElementById('shift-edit-date').value,
        shift_name: document.getElementById('shift-edit-name').value,
        line: document.getElementById('shift-edit-line').value,
        master_id: parseInt(document.getElementById('shift-edit-master').value),
        status: document.getElementById('shift-edit-status').value,
        plan_sheets: parseInt(document.getElementById('shift-edit-plan-sheets').value) || 0,
        plan_tons: parseFloat(document.getElementById('shift-edit-plan-tons').value) || 0,
        
        receipt_chrysotile_4_20: parseFloat(document.getElementById('shift-edit-receipt-chr420').value) || 0,
        receipt_chrysotile_5_65: parseFloat(document.getElementById('shift-edit-receipt-chr565').value) || 0,
        receipt_chrysotile_6_40: parseFloat(document.getElementById('shift-edit-receipt-chr640').value) || 0,
        receipt_cement: parseFloat(document.getElementById('shift-edit-receipt-cement').value) || 0,
        receipt_cellulose: parseFloat(document.getElementById('shift-edit-receipt-cellulose').value) || 0,
        receipt_crushed_slate: parseFloat(document.getElementById('shift-edit-receipt-slate').value) || 0,
        receipt_asbozurit: parseFloat(document.getElementById('shift-edit-receipt-asbozurit').value) || 0,
        receipt_fiberglass: parseFloat(document.getElementById('shift-edit-receipt-fiberglass').value) || 0,
        receipt_laprol: parseFloat(document.getElementById('shift-edit-receipt-laprol').value) || 0,
        
        zo_chrysotile_4_20: parseFloat(document.getElementById('shift-edit-zo-chr420').value) || 0,
        zo_chrysotile_5_65: parseFloat(document.getElementById('shift-edit-zo-chr565').value) || 0,
        zo_chrysotile_6_40: parseFloat(document.getElementById('shift-edit-zo-chr640').value) || 0,
        zo_cement_silo1: parseFloat(document.getElementById('shift-edit-zo-cement-s1').value) || 0,
        zo_cement_silo2: parseFloat(document.getElementById('shift-edit-zo-cement-s2').value) || 0,
        zo_cement_silo3: parseFloat(document.getElementById('shift-edit-zo-cement-s3').value) || 0,
        zo_cement_silo4: parseFloat(document.getElementById('shift-edit-zo-cement-s4').value) || 0,
        zo_cement: (parseFloat(document.getElementById('shift-edit-zo-cement-s1').value) || 0) +
                   (parseFloat(document.getElementById('shift-edit-zo-cement-s2').value) || 0) +
                   (parseFloat(document.getElementById('shift-edit-zo-cement-s3').value) || 0) +
                   (parseFloat(document.getElementById('shift-edit-zo-cement-s4').value) || 0),
        zo_cellulose: parseFloat(document.getElementById('shift-edit-zo-cellulose').value) || 0,
        zo_crushed_slate: parseFloat(document.getElementById('shift-edit-zo-slate').value) || 0,
        zo_asbozurit: parseFloat(document.getElementById('shift-edit-zo-asbozurit').value) || 0,
        zo_fiberglass: parseFloat(document.getElementById('shift-edit-zo-fiberglass').value) || 0,
        zo_laprol: parseFloat(document.getElementById('shift-edit-zo-laprol').value) || 0,
        zo_asb_drain: parseFloat(document.getElementById('shift-edit-zo-asb-drain').value) || 0,
        zo_cem_drain: parseFloat(document.getElementById('shift-edit-zo-cem-drain').value) || 0,
        zo_batches: parseInt(document.getElementById('shift-edit-zo-batches').value) || 0
    };
    
    try {
        const res = await fetch(`/api/admin/shifts/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        if (res.ok) {
            closeModals();
            loadShifts();
        } else {
            alert("Ошибка при сохранении смены");
        }
    } catch (e) {
        console.error(e);
        alert("Ошибка сети");
    }
}

async function deleteShift(id) {
    if (!confirm("ВНИМАНИЕ! Удаление смены удалит все связанные отчеты ЛФМ, партии и простои.\nВы уверены, что хотите удалить смену полностью?")) return;
    try {
        const res = await fetch(`/api/admin/shifts/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadShifts();
        } else {
            alert("Ошибка при удалении смены");
        }
    } catch (e) {
        console.error(e);
    }
}

// --- SUB-DATA MANAGEMENT (LFM, BATCHES, DOWNTIMES) ---

let activeShiftDetails = null;

async function showShiftDetails(shiftId) {
    try {
        const res = await fetch(`/api/admin/shifts/${shiftId}/details`);
        if (!res.ok) throw new Error("Не удалось получить данные смены");
        activeShiftDetails = await res.json();
        
        document.getElementById('shift-details-title').innerText = `Производственные данные смены № ${shiftId} (${activeShiftDetails.shift.date})`;
        
        const lfmTbody = document.getElementById('shift-details-lfm-body');
        lfmTbody.innerHTML = '';
        if (activeShiftDetails.lfm_reports.length === 0) {
            lfmTbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Нет отчетов ЛФМ</td></tr>`;
        } else {
            activeShiftDetails.lfm_reports.forEach(r => {
                lfmTbody.innerHTML += `
                    <tr>
                        <td>${r.product_name}</td>
                        <td>${r.lfm_sheets}</td>
                        <td>${r.lfm_wind_resets}</td>
                        <td>${r.formed_1st_grade}</td>
                        <td>${r.formed_defect}</td>
                        <td>
                            <button class="action-btn btn-edit" onclick='editLfmRow(${JSON.stringify(r)})'><i class="fa-solid fa-pen"></i></button>
                            <button class="action-btn btn-delete" onclick="deleteLfmRow(${r.id})"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>
                `;
            });
        }
        
        const batchTbody = document.getElementById('shift-details-batches-body');
        batchTbody.innerHTML = '';
        if (activeShiftDetails.batches.length === 0) {
            batchTbody.innerHTML = `<tr><td colspan="8" style="text-align:center;">Нет созданных партий</td></tr>`;
        } else {
            activeShiftDetails.batches.forEach(b => {
                batchTbody.innerHTML += `
                    <tr>
                        <td>${b.batch_number}</td>
                        <td>${b.product_name}</td>
                        <td>${b.stacked_stacks}</td>
                        <td>${b.ds_first_grade}</td>
                        <td>${b.ds_defect}</td>
                        <td>${b.qcd_first_grade}</td>
                        <td>${b.qcd_defect}</td>
                        <td>
                            <button class="action-btn btn-edit" onclick='editBatchRow(${JSON.stringify(b)})'><i class="fa-solid fa-pen"></i></button>
                            <button class="action-btn btn-delete" onclick="deleteBatchRow(${b.id})"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>
                `;
            });
        }

        const dtTbody = document.getElementById('shift-details-downtimes-body');
        dtTbody.innerHTML = '';
        if (activeShiftDetails.downtimes.length === 0) {
            dtTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Нет записей о простоях</td></tr>`;
        } else {
            activeShiftDetails.downtimes.forEach(d => {
                dtTbody.innerHTML += `
                    <tr>
                        <td>${d.start_time || '-'}</td>
                        <td>${d.duration}</td>
                        <td>${d.description}</td>
                        <td><span class="badge" style="background: rgba(23,162,184,0.2); color: #17a2b8; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.85rem;">${d.category || 'Не указана'}</span></td>
                        <td>
                            <button class="action-btn btn-edit" onclick='editDowntimeRow(${JSON.stringify(d).replace(/'/g, "&apos;")})'><i class="fa-solid fa-pen"></i></button>
                            <button class="action-btn btn-delete" onclick="deleteDowntimeRow(${d.id})"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>
                `;
            });
        }

        document.getElementById('shift-details-modal').style.display = 'flex';

    } catch (e) {
        console.error(e);
        alert(e.message);
    }
}

function editLfmRow(r) {
    document.getElementById('edit-lfm-id').value = r.id;
    document.getElementById('edit-lfm-product').value = r.product_name;
    document.getElementById('edit-lfm-sheets').value = r.lfm_sheets;
    document.getElementById('edit-lfm-wind-resets').value = r.lfm_wind_resets;
    document.getElementById('edit-lfm-formed-1st').value = r.formed_1st_grade;
    document.getElementById('edit-lfm-formed-defect').value = r.formed_defect;
    document.getElementById('edit-lfm-modal').style.display = 'flex';
}

async function saveLfmEdit() {
    const id = document.getElementById('edit-lfm-id').value;
    const data = {
        product_name: document.getElementById('edit-lfm-product').value,
        lfm_sheets: parseInt(document.getElementById('edit-lfm-sheets').value) || 0,
        lfm_wind_resets: parseInt(document.getElementById('edit-lfm-wind-resets').value) || 0,
        formed_1st_grade: parseInt(document.getElementById('edit-lfm-formed-1st').value) || 0,
        formed_defect: parseInt(document.getElementById('edit-lfm-formed-defect').value) || 0
    };
    try {
        const res = await fetch(`/api/admin/lfm/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        if (res.ok) {
            document.getElementById('edit-lfm-modal').style.display = 'none';
            showShiftDetails(activeShiftDetails.shift.id);
        } else {
            alert("Ошибка сохранения отчета ЛФМ");
        }
    } catch(e) {
        console.error(e);
    }
}

async function deleteLfmRow(id) {
    if (!confirm("Удалить этот отчет ЛФМ?")) return;
    try {
        const res = await fetch(`/api/admin/lfm/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showShiftDetails(activeShiftDetails.shift.id);
        } else {
            alert("Ошибка удаления");
        }
    } catch (e) {
        console.error(e);
    }
}

function editBatchRow(b) {
    document.getElementById('edit-batch-id').value = b.id;
    document.getElementById('edit-batch-number').value = b.batch_number;
    document.getElementById('edit-batch-product').value = b.product_name;
    document.getElementById('edit-batch-stacked-stacks').value = b.stacked_stacks;
    document.getElementById('edit-batch-ds-first-grade').value = b.ds_first_grade;
    document.getElementById('edit-batch-ds-defect').value = b.ds_defect;
    document.getElementById('edit-batch-qcd-first-grade').value = b.qcd_first_grade;
    document.getElementById('edit-batch-qcd-defect').value = b.qcd_defect;
    document.getElementById('edit-batch-modal').style.display = 'flex';
}

async function saveBatchEdit() {
    const id = document.getElementById('edit-batch-id').value;
    const data = {
        batch_number: document.getElementById('edit-batch-number').value,
        product_name: document.getElementById('edit-batch-product').value,
        stacked_stacks: parseInt(document.getElementById('edit-batch-stacked-stacks').value) || 0,
        ds_first_grade: parseInt(document.getElementById('edit-batch-ds-first-grade').value) || 0,
        ds_defect: parseInt(document.getElementById('edit-batch-ds-defect').value) || 0,
        qcd_first_grade: parseInt(document.getElementById('edit-batch-qcd-first-grade').value) || 0,
        qcd_defect: parseInt(document.getElementById('edit-batch-qcd-defect').value) || 0
    };
    try {
        const res = await fetch(`/api/admin/batches/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        if (res.ok) {
            document.getElementById('edit-batch-modal').style.display = 'none';
            showShiftDetails(activeShiftDetails.shift.id);
        } else {
            alert("Ошибка сохранения партии");
        }
    } catch(e) {
        console.error(e);
    }
}

async function deleteBatchRow(id) {
    if (!confirm("Удалить эту партию?")) return;
    try {
        const res = await fetch(`/api/admin/batches/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showShiftDetails(activeShiftDetails.shift.id);
        } else {
            alert("Ошибка удаления");
        }
    } catch (e) {
        console.error(e);
    }
}

function editDowntimeRow(d) {
    document.getElementById('edit-downtime-id').value = d.id;
    document.getElementById('edit-downtime-time').value = d.start_time || '';
    document.getElementById('edit-downtime-duration').value = d.duration || 0;
    document.getElementById('edit-downtime-reason').value = d.description || '';
    document.getElementById('edit-downtime-category').value = d.category || 'Механические';
    document.getElementById('edit-downtime-modal').style.display = 'flex';
}

async function saveDowntimeEdit() {
    const id = document.getElementById('edit-downtime-id').value;
    const data = {
        start_time: document.getElementById('edit-downtime-time').value || null,
        duration: parseInt(document.getElementById('edit-downtime-duration').value) || 0,
        description: document.getElementById('edit-downtime-reason').value,
        category: document.getElementById('edit-downtime-category').value
    };
    try {
        const res = await fetch(`/api/admin/downtimes/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        if (res.ok) {
            document.getElementById('edit-downtime-modal').style.display = 'none';
            showShiftDetails(activeShiftDetails.shift.id);
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
            showShiftDetails(activeShiftDetails.shift.id);
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


