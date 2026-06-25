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
    document.getElementById('tab-cleanup').style.display = 'none';
    document.getElementById('tab-audit-logs').style.display = 'none';
    
    document.getElementById('tab-' + tabId).style.display = 'block';

    if (tabId === 'plan-board') {
        loadPlanBoard();
    } else if (tabId === 'audit-logs') {
        loadAuditLogs();
    }
}

function closeModals() {
    document.getElementById('master-modal').style.display = 'none';
    document.getElementById('norm-modal').style.display = 'none';
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
    document.getElementById('master-role').value = 'master';
    document.getElementById('master-modal-title').innerText = "Добавить сотрудника";
    document.getElementById('master-modal').style.display = 'flex';
}

function editMaster(m) {
    document.getElementById('master-id').value = m.id;
    document.getElementById('master-name').value = m.name;
    document.getElementById('master-pin').value = ''; // Don't show existing pin
    document.getElementById('master-pin').placeholder = 'Оставьте пустым, чтобы не менять';
    document.getElementById('master-role').value = m.role;
    document.getElementById('master-modal-title').innerText = "Редактировать сотрудника";
    document.getElementById('master-modal').style.display = 'flex';
}

async function saveMaster() {
    const id = document.getElementById('master-id').value;
    const data = {
        name: document.getElementById('master-name').value,
        role: document.getElementById('master-role').value
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
    const res = await fetch(`/api/admin/masters/${id}`, { method: 'DELETE' });
    if (res.ok) {
        loadMasters();
    } else {
        alert("Ошибка при удалении");
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

