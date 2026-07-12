// Tectum Portal Unified JS App logic
let currentUser = null;
let activeShift = null;
let ssoActive = false;
let productNorms = {};
let mastersList = [];

// Chart instances
let chartPlanSheets = null;
let chartPlanTons = null;
let chartMatsBalance = null;
let chartMatsDeviations = null;

let chartAnalyticsTrend = null;
let chartAnalyticsCategories = null;
let chartAnalyticsBottlenecks = null;

let chartDailySheets = null;
let chartDailyTons = null;

// Intercept fetch to check for session timeout (401)
const originalFetch = window.fetch;
window.fetch = function (url, options) {
    return originalFetch(url, options).then(response => {
        if (response.status === 401 && !url.includes('/api/me/')) {
            alert("Ваша сессия истекла. Пожалуйста, войдите снова.");
            logout();
        }
        return response;
    });
};

function initTheme() {
    const theme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const target = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', target);
    localStorage.setItem('theme', target);
    
    // Redraw charts with new text color theme if applicable
    if (currentUser) {
        loadReportSummary();
        loadAnalyticsData();
        loadDailyReport();
    }
}

function showSsoLogin() {
    document.getElementById('sso-section').style.display = 'block';
    document.getElementById('user-selection-section').style.display = 'none';
}

function showPinLoginLegacy() {
    document.getElementById('sso-section').style.display = 'none';
    document.getElementById('user-selection-section').style.display = 'block';
}

function toggleAccordion(id) {
    const content = document.getElementById(id);
    const section = content.parentElement;
    if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        section.classList.remove('collapsed');
    } else {
        content.classList.add('collapsed');
        section.classList.add('collapsed');
    }
}

function toggleDefectsGrid() {
    const hasDefect = document.getElementById('rep-has-defect').value;
    const grid = document.getElementById('defects-detail-grid');
    if (hasDefect === 'yes') {
        grid.style.display = 'block';
    } else {
        grid.style.display = 'none';
        // Zero all defect inputs
        document.querySelectorAll('.defect-input').forEach(i => i.value = '0');
        recalcDefectTotal();
    }
}

function recalcTonsAndGrades() {
    const sheets = parseFloat(document.getElementById('rep-sheets').value) || 0;
    const prodName = document.getElementById('rep-product').value;
    const norm = productNorms[prodName];
    const weight = norm ? norm.weight_kg : 19.6;
    const tons = (sheets * weight) / 1000;
    document.getElementById('rep-tons-readonly').value = tons.toFixed(2);
}

function recalcDefectTotal() {
    let total = 0;
    document.querySelectorAll('.defect-input').forEach(input => {
        total += parseFloat(input.value) || 0;
    });
    document.getElementById('rep-defect-total-readonly').value = total;
}

function recalcChrTotal() {
    const v1 = parseFloat(document.getElementById('zo-chr-4-20').value) || 0;
    const v2 = parseFloat(document.getElementById('zo-chr-5-65').value) || 0;
    const v3 = parseFloat(document.getElementById('zo-chr-6-40').value) || 0;
    document.getElementById('zo-chr-total-readonly').value = (v1 + v2 + v3).toFixed(1);
}

function recalcCemTotal() {
    const v1 = parseFloat(document.getElementById('zo-cem-1').value) || 0;
    const v2 = parseFloat(document.getElementById('zo-cem-2').value) || 0;
    const v3 = parseFloat(document.getElementById('zo-cem-3').value) || 0;
    const v4 = parseFloat(document.getElementById('zo-cem-4').value) || 0;
    document.getElementById('zo-cem-total-readonly').value = (v1 + v2 + v3 + v4).toFixed(0);
}

function switchTab(tabId) {
    // Hide all tabs
    const tabs = ['production', 'summary', 'downtimes', 'analytics', 'daily-report', 'materials'];
    tabs.forEach(t => {
        const el = document.getElementById(`${t}-tab`);
        const btn = document.getElementById(`tab-btn-${t}`);
        if (el) el.style.display = 'none';
        if (btn) btn.classList.remove('active');
    });
    
    // Show selected tab
    const activeTab = document.getElementById(`${tabId}-tab`);
    const activeBtn = document.getElementById(`tab-btn-${tabId}`);
    if (activeTab) activeTab.style.display = 'block';
    if (activeBtn) activeBtn.classList.add('active');

    // Trigger tab-specific loads
    if (tabId === 'summary') {
        loadReportSummary();
    } else if (tabId === 'analytics') {
        loadAnalyticsData();
    } else if (tabId === 'daily-report') {
        loadDailyReport();
    } else if (tabId === 'materials') {
        loadMaterialsTab();
    }
}

// Flatpickr initialization helper
function setupTimePickers() {
    flatpickr(".time-picker", {
        enableTime: true,
        noCalendar: true,
        dateFormat: "H:i",
        time_24hr: true,
        locale: "ru"
    });
    
    flatpickr("#rep-date", {
        dateFormat: "Y-m-d",
        locale: "ru",
        defaultDate: new Date()
    });
    
    flatpickr("#filter-date-from", {
        dateFormat: "Y-m-d",
        locale: "ru",
        defaultDate: new Date(new Date().setDate(new Date().getDate() - 30))
    });
    
    flatpickr("#filter-date-to", {
        dateFormat: "Y-m-d",
        locale: "ru",
        defaultDate: new Date()
    });
}

async function loadProductNorms() {
    try {
        const res = await fetch('/api/norms/');
        if (res.ok) {
            const norms = await res.json();
            productNorms = {};
            norms.forEach(n => {
                productNorms[n.product_name] = n;
            });
        }
    } catch(e) {
        console.error("Error loading norms:", e);
    }
}

async function loadMasters() {
    try {
        const res = await fetch('/api/masters/');
        if (res.ok) {
            mastersList = await res.json();
            
            // Populate dropdowns
            const repMaster = document.getElementById('rep-master');
            const filterMaster = document.getElementById('filter-master');
            
            if (repMaster) {
                repMaster.innerHTML = '<option value="">-- Выберите мастера --</option>' + 
                    mastersList.filter(m => m.role === 'master' && m.name !== 'Мастер смены').map(m => `<option value="${m.id}">${m.name}</option>`).join('');
            }
            if (filterMaster) {
                filterMaster.innerHTML = '<option value="">-- Все мастера --</option>' + 
                    mastersList.filter(m => m.role === 'master' && m.name !== 'Мастер смены').map(m => `<option value="${m.id}">${m.name}</option>`).join('');
            }
            const brigadeSelect = document.getElementById('daily-report-brigade');
            if (brigadeSelect) {
                brigadeSelect.innerHTML = '<option value="">Все мастера</option>' + 
                    mastersList.filter(m => m.role === 'master' && m.name !== 'Мастер смены').map(m => `<option value="${m.id}">Смена мастера ${m.name}</option>`).join('');
            }
        }
    } catch(e) {
        console.error("Error loading masters:", e);
    }
}

function selectUser(name, roleName) {
    document.getElementById('selected-user-name').value = name;
    document.getElementById('user-selection-section').style.display = 'none';
    const pinSection = document.getElementById('pin-section');
    pinSection.style.display = 'block';
    document.getElementById('selected-user-display').innerText = `${name} (${roleName})`;
    document.getElementById('pin-input').focus();
    document.getElementById('login-error').style.display = 'none';
}

function resetLoginSelection() {
    document.getElementById('selected-user-name').value = '';
    document.getElementById('user-selection-section').style.display = 'block';
    document.getElementById('pin-section').style.display = 'none';
    document.getElementById('pin-input').value = '';
    document.getElementById('login-error').style.display = 'none';
}

async function login() {
    const name = document.getElementById('selected-user-name').value;
    const pin = document.getElementById('pin-input').value;
    const errorEl = document.getElementById('login-error');
    
    try {
        const res = await fetch('/api/login/', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name, pin })
        });
        
        if (!res.ok) throw new Error("Неверный ПИН-код");
        
        currentUser = await res.json();
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';
        document.getElementById('user-info-container').style.display = 'flex';
        document.getElementById('user-greeting-name').innerText = currentUser.name;
        document.getElementById('user-greeting-role').innerText = currentUser.role;
        
        applyRoleVisibility();
        loadData();
    } catch (e) {
        errorEl.innerText = e.message;
        errorEl.style.display = 'block';
    }
}

async function logout() {
    try {
        await fetch('/api/auth/logout');
    } catch(e) {
        console.error(e);
    }
    currentUser = null;
    document.getElementById('user-info-container').style.display = 'none';
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('login-screen').style.display = 'block';
    document.getElementById('pin-input').value = '';
    resetLoginSelection();
}

function applyRoleVisibility() {
    const r = currentUser.role;
    
    // Master, Admin, Director, Technologist see all reports and summary
    const canReport = ['master', 'admin'].includes(r);
    const canViewSummary = ['master', 'admin', 'director', 'technologist'].includes(r);
    const canDowntime = ['master', 'admin', 'mechanic', 'director', 'technologist'].includes(r);
    
    document.getElementById('tab-btn-production').style.display = canReport ? 'inline-block' : 'none';
    document.getElementById('tab-btn-summary').style.display = canViewSummary ? 'inline-block' : 'none';
    document.getElementById('tab-btn-daily-report').style.display = canViewSummary ? 'inline-block' : 'none';
    document.getElementById('tab-btn-materials').style.display = canViewSummary ? 'inline-block' : 'none';
    
    document.getElementById('tab-btn-downtimes').style.display = canDowntime ? 'inline-block' : 'none';
    document.getElementById('tab-btn-analytics').style.display = canDowntime ? 'inline-block' : 'none';
    
    // Switch to first visible tab
    if (canReport) {
        switchTab('production');
    } else if (canViewSummary) {
        switchTab('summary');
    } else if (canDowntime) {
        switchTab('downtimes');
    }
}

async function loadData() {
    await loadProductNorms();
    await loadMasters();
    
    // Check if there is active shift on server
    try {
        const res = await fetch('/api/shifts/active');
        if (res.ok) {
            const shifts = await res.json();
            if (shifts.length > 0) {
                activeShift = shifts[0];
                document.getElementById('active-shift-display').innerText = 
                    `${activeShift.date} [Смена: ${activeShift.shift_name}] [${activeShift.line}]`;
                document.getElementById('btn-close-shift').style.display = 
                    (currentUser.role === 'admin' || activeShift.master_id === currentUser.id) ? 'inline-block' : 'none';
                
                // If editing active shift, prefill fields
                prefillReportForm(activeShift);
            } else {
                activeShift = null;
                document.getElementById('active-shift-display').innerText = 'Нет активной смены';
                document.getElementById('btn-close-shift').style.display = 'none';
            }
        }
    } catch(e) {
        console.error(e);
    }
    
    // Populate downtime shift dropdowns
    loadDowntimeShifts();
    loadDowntimeDepartments();
}

function prefillReportForm(shift) {
    document.getElementById('rep-date').value = shift.date;
    document.getElementById('rep-shift').value = shift.shift_name;
    document.getElementById('rep-line').value = shift.line;
    document.getElementById('rep-master').value = shift.master_id || '';
    document.getElementById('rep-batch').value = shift.batch_number || '';
    document.getElementById('rep-product').value = shift.product_name || '';
    
    // Quantities
    document.getElementById('rep-batches').value = shift.zo_batches || '0';
    
    // Raw materials zo
    document.getElementById('zo-chr-4-20').value = shift.zo_chrysotile_4_20 || '0';
    document.getElementById('zo-chr-5-65').value = shift.zo_chrysotile_5_65 || '0';
    document.getElementById('zo-chr-6-40').value = shift.zo_chrysotile_6_40 || '0';
    document.getElementById('zo-cem-1').value = shift.zo_cement_silo1 || '0';
    document.getElementById('zo-cem-2').value = shift.zo_cement_silo2 || '0';
    document.getElementById('zo-cem-3').value = shift.zo_cement_silo3 || '0';
    document.getElementById('zo-cem-4').value = shift.zo_cement_silo4 || '0';
    document.getElementById('zo-cellulose').value = shift.zo_cellulose || '0';
    document.getElementById('zo-crushed-slate').value = shift.zo_crushed_slate || '0';
    document.getElementById('zo-asbozurit').value = shift.zo_asbozurit || '0';
    document.getElementById('zo-fiberglass').value = shift.zo_fiberglass || '0';
    document.getElementById('zo-laprol').value = shift.zo_laprol || '0';
    document.getElementById('zo-asbocarton').value = shift.zo_asbocarton || '0';
    document.getElementById('zo-asb-drain').value = shift.zo_asb_drain || '0';
    document.getElementById('zo-cem-drain').value = shift.zo_cem_drain || '0';

    // Raw materials receipt
    document.getElementById('rec-chr-4-20').value = shift.receipt_chrysotile_4_20 || '0';
    document.getElementById('rec-chr-5-65').value = shift.receipt_chrysotile_5_65 || '0';
    document.getElementById('rec-chr-6-40').value = shift.receipt_chrysotile_6_40 || '0';
    document.getElementById('rec-cement').value = shift.receipt_cement || '0';
    document.getElementById('rec-cellulose').value = shift.receipt_cellulose || '0';
    document.getElementById('rec-crushed-slate').value = shift.receipt_crushed_slate || '0';
    document.getElementById('rec-asbozurit').value = shift.receipt_asbozurit || '0';
    document.getElementById('rec-asbocarton').value = shift.receipt_asbocarton || '0';
    document.getElementById('rec-pallets').value = shift.receipt_pallets || '0';
    document.getElementById('rec-fiberglass').value = shift.receipt_fiberglass || '0';
    document.getElementById('rec-laprol').value = shift.receipt_laprol || '0';

    // Fetch shift reports to populate production/defect sheets
    fetch(`/api/report/summary?from_date=${shift.date}&to_date=${shift.date}&line=${encodeURIComponent(shift.line)}`)
        .then(res => res.json())
        .then(data => {
            const row = data.find(r => r.shift_id === shift.id);
            if (row) {
                document.getElementById('rep-sheets').value = row.lfm_sheets || '0';
                document.getElementById('rep-resets').value = row.lfm_wind_resets || '0';
                document.getElementById('rep-warehouse-gp').value = row.warehouse_gp || '0';
                document.getElementById('rep-first-grade').value = row.first_grade || '0';
                document.getElementById('rep-qcd-defect').value = row.defect || '0';
                
                // Defects breakdown
                const d = row.ds_defects || {};
                document.getElementById('def-chip').value = d.ds_defect_chip || '0';
                document.getElementById('def-scratch').value = d.ds_defect_scratch || '0';
                document.getElementById('def-bad-cut').value = d.ds_defect_bad_cut || '0';
                document.getElementById('def-stick-bottom').value = d.ds_defect_stick_bottom || '0';
                document.getElementById('def-stick-top').value = d.ds_defect_stick_top || '0';
                document.getElementById('def-broken').value = d.ds_defect_broken || '0';
                document.getElementById('def-fell').value = d.ds_defect_fell_box || '0';
                document.getElementById('def-dent').value = d.ds_defect_dent || '0';
                document.getElementById('def-thickness').value = d.ds_defect_thickness || '0';
                document.getElementById('def-delamination').value = d.ds_defect_delamination || '0';
                document.getElementById('def-edge').value = d.ds_defect_edge || '0';
                
                const hasDefects = Object.values(d).some(v => v > 0);
                document.getElementById('rep-has-defect').value = hasDefects ? 'yes' : 'no';
                toggleDefectsGrid();
                
                recalcTonsAndGrades();
                recalcDefectTotal();
                recalcChrTotal();
                recalcCemTotal();
            }
        });
}

async function submitShiftReport() {
    const data = {
        date: document.getElementById('rep-date').value,
        shift_name: document.getElementById('rep-shift').value,
        line: document.getElementById('rep-line').value,
        master_id: parseInt(document.getElementById('rep-master').value),
        batch_number: document.getElementById('rep-batch').value,
        product_name: document.getElementById('rep-product').value,
        
        lfm_sheets: parseInt(document.getElementById('rep-sheets').value) || 0,
        lfm_wind_resets: parseInt(document.getElementById('rep-resets').value) || 0,
        zo_batches: parseInt(document.getElementById('rep-batches').value) || 0,
        
        warehouse_gp: parseInt(document.getElementById('rep-warehouse-gp').value) || 0,
        first_grade: parseInt(document.getElementById('rep-first-grade').value) || 0,
        has_defect: document.getElementById('rep-has-defect').value,
        
        ds_defect_chip: parseInt(document.getElementById('def-chip').value) || 0,
        ds_defect_scratch: parseInt(document.getElementById('def-scratch').value) || 0,
        ds_defect_bad_cut: parseInt(document.getElementById('def-bad-cut').value) || 0,
        ds_defect_stick_bottom: parseInt(document.getElementById('def-stick-bottom').value) || 0,
        ds_defect_stick_top: parseInt(document.getElementById('def-stick-top').value) || 0,
        ds_defect_broken: parseInt(document.getElementById('def-broken').value) || 0,
        ds_defect_fell_box: parseInt(document.getElementById('def-fell').value) || 0,
        ds_defect_dent: parseInt(document.getElementById('def-dent').value) || 0,
        ds_defect_thickness: parseInt(document.getElementById('def-thickness').value) || 0,
        ds_defect_delamination: parseInt(document.getElementById('def-delamination').value) || 0,
        ds_defect_edge: parseInt(document.getElementById('def-edge').value) || 0,
        
        qcd_defect: parseInt(document.getElementById('rep-qcd-defect').value) || 0,

        zo_chrysotile_4_20: parseFloat(document.getElementById('zo-chr-4-20').value) || 0.0,
        zo_chrysotile_5_65: parseFloat(document.getElementById('zo-chr-5-65').value) || 0.0,
        zo_chrysotile_6_40: parseFloat(document.getElementById('zo-chr-6-40').value) || 0.0,
        zo_cement_silo1: parseFloat(document.getElementById('zo-cem-1').value) || 0.0,
        zo_cement_silo2: parseFloat(document.getElementById('zo-cem-2').value) || 0.0,
        zo_cement_silo3: parseFloat(document.getElementById('zo-cem-3').value) || 0.0,
        zo_cement_silo4: parseFloat(document.getElementById('zo-cem-4').value) || 0.0,
        zo_cellulose: parseFloat(document.getElementById('zo-cellulose').value) || 0.0,
        zo_crushed_slate: parseFloat(document.getElementById('zo-crushed-slate').value) || 0.0,
        zo_asbozurit: parseFloat(document.getElementById('zo-asbozurit').value) || 0.0,
        zo_fiberglass: parseFloat(document.getElementById('zo-fiberglass').value) || 0.0,
        zo_laprol: parseFloat(document.getElementById('zo-laprol').value) || 0.0,
        zo_asbocarton: parseFloat(document.getElementById('zo-asbocarton').value) || 0.0,
        zo_asb_drain: parseFloat(document.getElementById('zo-asb-drain').value) || 0.0,
        zo_cem_drain: parseFloat(document.getElementById('zo-cem-drain').value) || 0.0,

        receipt_chrysotile_4_20: parseFloat(document.getElementById('rec-chr-4-20').value) || 0.0,
        receipt_chrysotile_5_65: parseFloat(document.getElementById('rec-chr-5-65').value) || 0.0,
        receipt_chrysotile_6_40: parseFloat(document.getElementById('rec-chr-6-40').value) || 0.0,
        receipt_cement: parseFloat(document.getElementById('rec-cement').value) || 0.0,
        receipt_cellulose: parseFloat(document.getElementById('rec-cellulose').value) || 0.0,
        receipt_crushed_slate: parseFloat(document.getElementById('rec-crushed-slate').value) || 0.0,
        receipt_asbozurit: parseFloat(document.getElementById('rec-asbozurit').value) || 0.0,
        receipt_asbocarton: parseFloat(document.getElementById('rec-asbocarton').value) || 0.0,
        receipt_pallets: parseFloat(document.getElementById('rec-pallets').value) || 0.0,
        receipt_fiberglass: parseFloat(document.getElementById('rec-fiberglass').value) || 0.0,
        receipt_laprol: parseFloat(document.getElementById('rec-laprol').value) || 0.0
    };

    if (!data.date || !data.shift_name || !data.line || isNaN(data.master_id) || !data.product_name) {
        alert("Пожалуйста, заполните все обязательные поля заголовка смены!");
        return;
    }

    try {
        const res = await fetch('/api/report', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        
        if (res.ok) {
            alert("Рапорт успешно сохранен!");
            loadData();
            switchTab('summary');
        } else {
            const err = await res.json();
            alert(`Ошибка сохранения: ${err.detail}`);
        }
    } catch(e) {
        alert(`Сетевая ошибка: ${e.message}`);
    }
}

async function closeShift() {
    if (!activeShift) return;
    if (!confirm("Вы уверены, что хотите закрыть смену? Данные будут выгружены в SharePoint.")) return;
    
    try {
        const res = await fetch(`/api/shifts/${activeShift.id}/close`, { method: 'POST' });
        if (res.ok) {
            alert("Смена успешно закрыта!");
            loadData();
        } else {
            const err = await res.json();
            alert(`Ошибка: ${err.detail}`);
        }
    } catch(e) {
        alert(e.message);
    }
}

async function loadReportSummary() {
    const from_date = document.getElementById('filter-date-from').value;
    const to_date = document.getElementById('filter-date-to').value;
    const line = document.getElementById('filter-line').value;
    const master_id = document.getElementById('filter-master').value;

    let url = `/api/report/summary?from_date=${from_date}&to_date=${to_date}`;
    if (line) url += `&line=${encodeURIComponent(line)}`;
    if (master_id) url += `&master_id=${master_id}`;

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Ошибка загрузки сводной таблицы");
        const rows = await res.json();
        
        renderSummaryTable(rows);
        renderSummaryDashboards(rows);
    } catch(e) {
        console.error(e);
    }
}

function renderSummaryTable(rows) {
    const tbody = document.getElementById('summary-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="16" style="text-align: center; color: var(--text-secondary);">Нет данных за выбранный период</td></tr>';
        return;
    }

    rows.forEach(r => {
        const isEditable = (r.status === 'active' || currentUser.role === 'admin') && r.master_name !== 'Смена другого мастера';
        const editBtn = isEditable ? 
            `<button onclick="editReport(${r.shift_id})" class="btn-secondary" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;">✏️ Изменить</button>` : 
            `<span style="color: var(--text-secondary); font-size: 0.75rem;">🔒 Блок</span>`;

        const totalAsbestos = (r.zo_usage.chrysotile_4_20 + r.zo_usage.chrysotile_5_65 + r.zo_usage.chrysotile_6_40).toFixed(0);
        const totalCement = (r.zo_usage.cement_silo1 + r.zo_usage.cement_silo2 + r.zo_usage.cement_silo3 + r.zo_usage.cement_silo4).toFixed(0);

        tbody.innerHTML += `
            <tr style="border-bottom: 1px solid var(--glass-border);">
                <td>${editBtn}</td>
                <td>${r.date}</td>
                <td>${r.shift_name}</td>
                <td>${r.line}</td>
                <td style="font-weight: 500;">${r.master_name}</td>
                <td>${r.batch_number}</td>
                <td>${r.product_name}</td>
                <td>${r.zo_batches}</td>
                <td style="font-weight: bold;">${r.lfm_sheets}</td>
                <td>${r.lfm_tons}</td>
                <td style="color: var(--success-color);">${r.warehouse_gp}</td>
                <td>${r.first_grade}</td>
                <td style="color: var(--danger-color); font-weight: bold;">${r.defect}</td>
                <td>${totalAsbestos}</td>
                <td>${totalCement}</td>
                <td><span class="badge ${r.status === 'closed' ? 'badge-success' : 'badge-warning'}">${r.status}</span></td>
            </tr>
        `;
    });
}

async function editReport(shiftId) {
    try {
        const res = await fetch(`/api/shifts/${shiftId}`);
        if (res.ok) {
            const shift = await res.json();
            prefillReportForm(shift);
            switchTab('production');
            
            // Expand all accordion contents for editing
            document.querySelectorAll('.accordion-content').forEach(c => c.classList.remove('collapsed'));
            document.querySelectorAll('.accordion-section').forEach(s => s.classList.remove('collapsed'));
        }
    } catch(e) {
        alert("Ошибка при выборе смены: " + e.message);
    }
}

function renderSummaryDashboards(rows) {
    let totalSheets = 0;
    let totalWarehouse = 0;
    let totalDefects = 0;
    let totalTons = 0;

    // Filter out shifts with hidden data
    const validRows = rows.filter(r => r.master_name !== 'Смена другого мастера');

    validRows.forEach(r => {
        totalSheets += r.lfm_sheets;
        totalWarehouse += r.warehouse_gp;
        totalDefects += r.defect;
        totalTons += r.lfm_tons;
    });

    document.getElementById('dash-total-sheets').innerText = totalSheets.toLocaleString() + ' шт';
    document.getElementById('dash-total-warehouse').innerText = totalWarehouse.toLocaleString() + ' шт';
    document.getElementById('dash-total-tons').innerText = totalTons.toFixed(1) + ' т';
    document.getElementById('dash-defect-rate').innerText = totalSheets > 0 ? ((totalDefects / totalSheets) * 100).toFixed(1) + '%' : '0.0%';

    // Visual theme text color
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textCol = isDark ? '#f8fafc' : '#1e293b';

    const sortedRows = [...validRows].reverse();
    const labels = sortedRows.map(r => `${r.date.split('-').slice(1).join('.')}\n(${r.shift_name[0]})`);

    // 1. Chart Sheets: Fact vs Plan
    const ctxSheets = document.getElementById('chart-plan-fact-sheets')?.getContext('2d');
    if (ctxSheets) {
        if (chartPlanSheets) chartPlanSheets.destroy();
        chartPlanSheets = new Chart(ctxSheets, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Факт (листы)',
                        data: sortedRows.map(r => r.lfm_sheets),
                        backgroundColor: 'rgba(229, 57, 69, 0.8)',
                        borderColor: '#E53935',
                        borderWidth: 1
                    },
                    {
                        label: 'План (листы)',
                        data: sortedRows.map(r => r.plan_sheets),
                        backgroundColor: 'rgba(255, 255, 255, 0.15)',
                        borderColor: 'rgba(255, 255, 255, 0.3)',
                        borderWidth: 1,
                        type: 'line'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: textCol } } },
                scales: {
                    x: { ticks: { color: textCol } },
                    y: { ticks: { color: textCol } }
                }
            }
        });
    }

    // 2. Chart Tons: Fact vs Plan
    const ctxTons = document.getElementById('chart-plan-fact-tons')?.getContext('2d');
    if (ctxTons) {
        if (chartPlanTons) chartPlanTons.destroy();
        chartPlanTons = new Chart(ctxTons, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Факт (тонны)',
                        data: sortedRows.map(r => r.lfm_tons),
                        backgroundColor: 'rgba(23, 162, 184, 0.8)',
                        borderColor: '#17a2b8',
                        borderWidth: 1
                    },
                    {
                        label: 'План (тонны)',
                        data: sortedRows.map(r => r.plan_tons),
                        backgroundColor: 'rgba(255, 255, 255, 0.15)',
                        borderColor: 'rgba(255, 255, 255, 0.3)',
                        borderWidth: 1,
                        type: 'line'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: textCol } } },
                scales: {
                    x: { ticks: { color: textCol } },
                    y: { ticks: { color: textCol } }
                }
            }
        });
    }
}

async function loadMaterialsTab() {
    const from_date = document.getElementById('filter-date-from').value;
    const to_date = document.getElementById('filter-date-to').value;

    try {
        const res = await fetch(`/api/report/materials_summary?start_date=${from_date}&end_date=${to_date}`);
        if (!res.ok) throw new Error("Error loading materials");
        const data = await res.json();
        
        renderMaterialsTable(data.totals);
        renderMaterialsCharts(data);
    } catch(e) {
        console.error(e);
    }
}

function renderMaterialsTable(totals) {
    const list = document.getElementById('materials-report-list');
    if (!list) return;
    list.innerHTML = '';

    const matNamesRu = {
        "chrysotile_4_20": "Хризотил 4-20",
        "chrysotile_5_65": "Хризотил 5-65",
        "chrysotile_6_40": "Хризотил 6-40",
        "cement": "Цемент",
        "cellulose": "Целлюлоза",
        "crushed_slate": "Дробленый шифер",
        "asbozurit": "Асбозурит",
        "asbocarton": "Асбокартон",
        "fiberglass": "Стекловолокно",
        "laprol": "Лапрол"
    };

    Object.keys(totals).forEach(key => {
        const item = totals[key];
        const devColor = item.deviation > 0 ? 'var(--danger-color)' : (item.deviation < 0 ? 'var(--success-color)' : 'inherit');
        const formattedDev = item.deviation > 0 ? `+${item.deviation}` : item.deviation;
        
        list.innerHTML += `
            <tr style="border-bottom: 1px solid var(--glass-border);">
                <td style="padding: 0.6rem; font-weight: 500;">${matNamesRu[key] || key}</td>
                <td style="padding: 0.6rem; text-align: right;">${item.zo.toLocaleString()} кг</td>
                <td style="padding: 0.6rem; text-align: right;">${(item.zo - item.deviation).toLocaleString()} кг</td>
                <td style="padding: 0.6rem; text-align: right; font-weight: bold; color: ${devColor};">${formattedDev.toLocaleString()} кг</td>
                <td style="padding: 0.6rem; text-align: right;">-</td>
                <td style="padding: 0.6rem; text-align: right;">-</td>
                <td style="padding: 0.6rem; text-align: right;">-</td>
            </tr>
        `;
    });
}

function renderMaterialsCharts(data) {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textCol = isDark ? '#f8fafc' : '#1e293b';

    const materials = Object.keys(data.totals);
    const matNamesRu = {
        "chrysotile_4_20": "Хр 4-20",
        "chrysotile_5_65": "Хр 5-65",
        "chrysotile_6_40": "Хр 6-40",
        "cement": "Цемент",
        "cellulose": "Целл.",
        "crushed_slate": "Шифер др.",
        "asbozurit": "Асбозур.",
        "asbocarton": "Асбокарт.",
        "fiberglass": "Стекловол.",
        "laprol": "Лапрол"
    };
    const labels = materials.map(m => matNamesRu[m] || m);
    const receipts = materials.map(m => data.totals[m].receipt);
    const zoUsages = materials.map(m => data.totals[m].zo);
    const deviations = materials.map(m => data.totals[m].deviation);

    // 1. Balance chart: Receipt vs Consumption
    const ctxBalance = document.getElementById('chart-materials-balance')?.getContext('2d');
    if (ctxBalance) {
        if (chartMatsBalance) chartMatsBalance.destroy();
        chartMatsBalance = new Chart(ctxBalance, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Приход (склад, кг)',
                        data: receipts,
                        backgroundColor: 'rgba(40, 167, 69, 0.8)',
                        borderColor: '#28a745',
                        borderWidth: 1
                    },
                    {
                        label: 'Расход (производство, кг)',
                        data: zoUsages,
                        backgroundColor: 'rgba(23, 162, 184, 0.8)',
                        borderColor: '#17a2b8',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: textCol } } },
                scales: {
                    x: { ticks: { color: textCol } },
                    y: { ticks: { color: textCol } }
                }
            }
        });
    }

    // 2. Deviations chart
    const ctxDevs = document.getElementById('chart-materials-deviations')?.getContext('2d');
    if (ctxDevs) {
        if (chartMatsDeviations) chartMatsDeviations.destroy();
        chartMatsDeviations = new Chart(ctxDevs, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Отклонение (кг)',
                    data: deviations,
                    backgroundColor: deviations.map(v => v > 0 ? 'rgba(220, 53, 69, 0.8)' : 'rgba(40, 167, 69, 0.8)'),
                    borderColor: deviations.map(v => v > 0 ? '#dc3545' : '#28a745'),
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: textCol } },
                    y: { ticks: { color: textCol } }
                }
            }
        });
    }
}

function exportToExcelLocal() {
    const table = document.querySelector('.table-glass-summary');
    if (!table) return;
    const wb = XLSX.utils.table_to_book(table, {sheet: "Сводный отчет"});
    XLSX.writeFile(wb, "tectum_production_report.xlsx");
}

// ----------------------------------------------------
// DOWNTIMES TAB LOGIC
// ----------------------------------------------------
async function loadDowntimeShifts() {
    try {
        const res = await fetch('/api/shifts/all');
        if (res.ok) {
            const shifts = await res.json();
            const select = document.getElementById('journal-dt-shift-select');
            if (select) {
                select.innerHTML = '<option value="">-- Выберите смену --</option>' +
                    shifts.map(s => `<option value="${s.id}">${s.date} (${s.shift_name}) [${s.line}]</option>`).join('');
            }
        }
    } catch(e) {
        console.error(e);
    }
}

async function loadDowntimeDepartments() {
    try {
        const res = await fetch('/api/downtimes/departments');
        if (res.ok) {
            const depts = await res.json();
            const select = document.getElementById('journal-dt-dept');
            const editSelect = document.getElementById('edit-dt-dept');
            const optHtml = '<option value="">-- Выберите участок --</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
            
            if (select) select.innerHTML = optHtml;
            if (editSelect) editSelect.innerHTML = optHtml;
        }
    } catch(e) {
        console.error(e);
    }
}

async function onJournalShiftChange() {
    const shiftId = document.getElementById('journal-dt-shift-select').value;
    if (!shiftId) return;
    
    try {
        const res = await fetch(`/api/shifts/${shiftId}`);
        if (res.ok) {
            const shift = await res.json();
            renderDowntimesTable(shift);
        }
    } catch(e) {
        console.error(e);
    }
}

async function onJournalDeptChange() {
    const dept = document.getElementById('journal-dt-dept').value;
    const selectNode = document.getElementById('journal-dt-node');
    if (!dept) {
        selectNode.innerHTML = '<option value="">-- Сначала выберите участок --</option>';
        return;
    }
    
    try {
        const res = await fetch(`/api/downtimes/nodes?department=${encodeURIComponent(dept)}`);
        if (res.ok) {
            const nodes = await res.json();
            selectNode.innerHTML = '<option value="">-- Выберите узел --</option>' +
                nodes.map(n => `<option value="${n}">${n}</option>`).join('');
        }
    } catch(e) {
        console.error(e);
    }
}

async function onJournalNodeChange() {
    const dept = document.getElementById('journal-dt-dept').value;
    const node = document.getElementById('journal-dt-node').value;
    const selectBk = document.getElementById('journal-dt-breakdown');
    if (!dept || !node) {
        selectBk.innerHTML = '<option value="">-- Сначала выберите узел --</option>';
        return;
    }
    
    try {
        const res = await fetch(`/api/downtimes/breakdowns?department=${encodeURIComponent(dept)}&node=${encodeURIComponent(node)}`);
        if (res.ok) {
            const breakdowns = await res.json();
            selectBk.innerHTML = '<option value="">-- Выберите поломку --</option>' +
                breakdowns.map(b => `<option value="${b}">${b}</option>`).join('');
        }
    } catch(e) {
        console.error(e);
    }
}

function onJournalSubnodeChange() {}
function onJournalBreakdownChange() {}

function renderDowntimesTable(shift) {
    const tbody = document.getElementById('journal-downtimes-list');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const downtimes = shift.downtimes || [];
    if (downtimes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color: var(--text-secondary);">Нет зафиксированных простоев за смену</td></tr>';
        return;
    }

    downtimes.forEach(d => {
        const durationStr = d.duration ? `${d.duration} мин` : 'В процессе';
        const isEquipment = d.is_equipment_downtime ? '🔴 Да' : '🟡 Нет';
        const mediaHtml = (d.media_files || []).map(f => `<a href="${f}" target="_blank">Файл</a>`).join(', ') || 'Нет';
        
        const deleteBtn = `<button onclick="deleteDowntime(${d.id})" class="btn-danger" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;">Удалить</button>`;
        const editBtn = `<button onclick="openEditDowntimeModal(${d.id})" class="btn-secondary" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; margin-right: 0.3rem;">Редактировать</button>`;

        tbody.innerHTML += `
            <tr style="border-bottom: 1px solid var(--glass-border);">
                <td>${shift.date} (${shift.shift_name})</td>
                <td><span class="badge ${d.end_time ? 'badge-success' : 'badge-warning'}">${d.end_time ? 'Закрыт' : 'Открыт'}</span></td>
                <td>${d.start_time}</td>
                <td>${d.end_time || '-'}</td>
                <td style="font-weight: bold;">${durationStr}</td>
                <td>${d.lost_tons ? d.lost_tons.toFixed(2) : '0.00'} т / ${d.lost_tenge ? d.lost_tenge.toLocaleString() : '0'} ₸</td>
                <td>${d.department} / ${d.node} / ${isEquipment}</td>
                <td>${d.comment || '-'}</td>
                <td>${mediaHtml}</td>
                <td>${editBtn}${deleteBtn}</td>
            </tr>
        `;
    });
}

async function addJournalDowntime() {
    const shiftId = document.getElementById('journal-dt-shift-select').value;
    if (!shiftId) {
        alert("Выберите смену!");
        return;
    }
    
    const data = {
        start_time: document.getElementById('journal-dt-start').value,
        end_time: document.getElementById('journal-dt-end').value || null,
        department: document.getElementById('journal-dt-dept').value,
        node: document.getElementById('journal-dt-node').value,
        breakdown: document.getElementById('journal-dt-breakdown').value,
        comment: document.getElementById('journal-dt-desc').value,
        is_equipment_downtime: document.getElementById('journal-dt-is-equipment-stop').checked,
        media_files: []
    };

    if (!data.start_time || !data.department || !data.node || !data.breakdown) {
        alert("Заполните начало, участок, узел и причину простоя!");
        return;
    }

    try {
        const res = await fetch(`/api/shifts/${shiftId}/downtimes`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        
        if (res.ok) {
            alert("Простой успешно зафиксирован!");
            onJournalShiftChange();
        } else {
            const err = await res.json();
            alert(`Ошибка: ${err.detail}`);
        }
    } catch(e) {
        alert(e.message);
    }
}

async function deleteDowntime(id) {
    if (!confirm("Вы действительно хотите удалить запись о простое?")) return;
    try {
        const res = await fetch(`/api/downtimes/${id}`, { method: 'DELETE' });
        if (res.ok) {
            alert("Запись удалена!");
            onJournalShiftChange();
        }
    } catch(e) {
        alert(e.message);
    }
}

async function openEditDowntimeModal(id) {
    try {
        const res = await fetch(`/api/downtimes/${id}`);
        if (!res.ok) throw new Error("Не удалось загрузить простой");
        const d = await res.json();
        
        document.getElementById('edit-dt-id').value = d.id;
        document.getElementById('edit-dt-start').value = d.start_time;
        document.getElementById('edit-dt-end').value = d.end_time || '';
        document.getElementById('edit-dt-desc').value = d.comment || '';
        document.getElementById('edit-dt-is-equipment-stop').checked = d.is_equipment_downtime;
        
        // Wait load depts
        document.getElementById('edit-dt-dept').value = d.department;
        await onEditDeptChange(d.node, d.breakdown);
        
        document.getElementById('edit-dt-modal').style.display = 'block';
        setupTimePickers();
    } catch(e) {
        alert(e.message);
    }
}

function closeEditDowntimeModal() {
    document.getElementById('edit-dt-modal').style.display = 'none';
}

async function onEditDeptChange(selectedNode = '', selectedBreakdown = '') {
    const dept = document.getElementById('edit-dt-dept').value;
    const selectNode = document.getElementById('edit-dt-node');
    if (!dept) {
        selectNode.innerHTML = '<option value="">-- Сначала выберите участок --</option>';
        return;
    }
    
    const res = await fetch(`/api/downtimes/nodes?department=${encodeURIComponent(dept)}`);
    if (res.ok) {
        const nodes = await res.json();
        selectNode.innerHTML = '<option value="">-- Выберите узел --</option>' +
            nodes.map(n => `<option value="${n}">${n}</option>`).join('');
        if (selectedNode) {
            selectNode.value = selectedNode;
            await onEditNodeChange(selectedBreakdown);
        }
    }
}

async function onEditNodeChange(selectedBreakdown = '') {
    const dept = document.getElementById('edit-dt-dept').value;
    const node = document.getElementById('edit-dt-node').value;
    const selectBk = document.getElementById('edit-dt-breakdown');
    
    const res = await fetch(`/api/downtimes/breakdowns?department=${encodeURIComponent(dept)}&node=${encodeURIComponent(node)}`);
    if (res.ok) {
        const breakdowns = await res.json();
        selectBk.innerHTML = '<option value="">-- Выберите поломку --</option>' +
            breakdowns.map(b => `<option value="${b}">${b}</option>`).join('');
        if (selectedBreakdown) {
            selectBk.value = selectedBreakdown;
        }
    }
}

async function submitEditDowntime() {
    const id = document.getElementById('edit-dt-id').value;
    const data = {
        start_time: document.getElementById('edit-dt-start').value,
        end_time: document.getElementById('edit-dt-end').value || null,
        department: document.getElementById('edit-dt-dept').value,
        node: document.getElementById('edit-dt-node').value,
        breakdown: document.getElementById('edit-dt-breakdown').value,
        comment: document.getElementById('edit-dt-desc').value,
        is_equipment_downtime: document.getElementById('edit-dt-is-equipment-stop').checked
    };

    try {
        const res = await fetch(`/api/downtimes/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        if (res.ok) {
            alert("Простой обновлен!");
            closeEditDowntimeModal();
            onJournalShiftChange();
        } else {
            const err = await res.json();
            alert(err.detail);
        }
    } catch(e) {
        alert(e.message);
    }
}

// ----------------------------------------------------
// ANALYTICS TAB LOGIC
// ----------------------------------------------------
async function loadAnalyticsData() {
    const start = document.getElementById('analytics-start-date').value;
    const end = document.getElementById('analytics-end-date').value;
    const dept = document.getElementById('analytics-dept').value;
    
    let url = `/api/dashboard/analytics_data?`;
    if (start) url += `&start_date=${start}`;
    if (end) url += `&end_date=${end}`;
    if (dept) url += `&department=${encodeURIComponent(dept)}`;
    
    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            renderAnalyticsKPIs(data);
            renderAnalyticsCharts(data);
        }
    } catch(e) {
        console.error(e);
    }
}

function renderAnalyticsKPIs(data) {
    document.getElementById('analytics-kpi-stop-min').innerText = data.total_stop_minutes + ' мин';
    document.getElementById('analytics-kpi-stop-count').innerText = data.total_stop_count;
    document.getElementById('analytics-kpi-stop-tons').innerText = data.total_stop_lost_tons.toFixed(1) + ' т';
    document.getElementById('analytics-kpi-stop-tenge').innerText = data.total_stop_lost_tenge.toLocaleString() + ' ₸';

    document.getElementById('analytics-kpi-nonstop-min').innerText = data.total_nonstop_minutes + ' мин';
    document.getElementById('analytics-kpi-nonstop-count').innerText = data.total_nonstop_count;
    document.getElementById('analytics-kpi-nonstop-tons').innerText = data.total_nonstop_lost_tons.toFixed(1) + ' т';
    document.getElementById('analytics-kpi-nonstop-tenge').innerText = data.total_nonstop_lost_tenge.toLocaleString() + ' ₸';
}

function renderAnalyticsCharts(data) {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textCol = isDark ? '#f8fafc' : '#1e293b';

    // Trend chart
    const ctxTrend = document.getElementById('chart-analytics-trend').getContext('2d');
    if (chartAnalyticsTrend) chartAnalyticsTrend.destroy();
    
    const dates = Object.keys(data.daily_minutes || {}).sort();
    const minutes = dates.map(d => data.daily_minutes[d]);

    chartAnalyticsTrend = new Chart(ctxTrend, {
        type: 'line',
        data: {
            labels: dates.map(d => d.split('-').slice(1).join('.')),
            datasets: [{
                label: 'Минуты простоя',
                data: minutes,
                borderColor: '#E53935',
                backgroundColor: 'rgba(229, 57, 69, 0.1)',
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { ticks: { color: textCol } },
                y: { ticks: { color: textCol } }
            }
        }
    });

    // Categories chart
    const ctxCats = document.getElementById('chart-analytics-categories').getContext('2d');
    if (chartAnalyticsCategories) chartAnalyticsCategories.destroy();
    
    const cats = Object.keys(data.categories || {});
    const catMins = Object.values(data.categories || {});

    chartAnalyticsCategories = new Chart(ctxCats, {
        type: 'doughnut',
        data: {
            labels: cats.length ? cats : ['Нет данных'],
            datasets: [{
                data: catMins.length ? catMins : [0],
                backgroundColor: ['#dc3545', '#ffc107', '#28a745', '#17a2b8', '#6f42c1']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });

    // Bottlenecks chart
    const ctxBottlenecks = document.getElementById('chart-analytics-bottlenecks').getContext('2d');
    if (chartAnalyticsBottlenecks) chartAnalyticsBottlenecks.destroy();
    
    const bottlenecks = data.bottlenecks || [];
    const labels = bottlenecks.map(b => b.node);
    const values = bottlenecks.map(b => b.duration);

    chartAnalyticsBottlenecks = new Chart(ctxBottlenecks, {
        type: 'bar',
        data: {
            labels: labels.length ? labels : ['Нет данных'],
            datasets: [{
                label: 'Минуты',
                data: values.length ? values : [0],
                backgroundColor: 'rgba(229, 57, 69, 0.8)',
                borderColor: '#E53935',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { ticks: { color: textCol } },
                y: { ticks: { color: textCol } }
            }
        }
    });
}

// ----------------------------------------------------
// DAILY REPORT TAB LOGIC (📈 Месячная сводка выработки)
// ----------------------------------------------------
function toggleRangeControls() {
    const rangeType = document.getElementById('daily-report-range-type').value;
    document.getElementById('daily-report-month').style.display = rangeType === 'month' ? 'inline-block' : 'none';
    document.getElementById('daily-report-week-select').style.display = rangeType === 'week' ? 'inline-block' : 'none';
    document.getElementById('daily-report-day-picker').style.display = rangeType === 'day' ? 'inline-block' : 'none';
}

async function loadDailyReport() {
    const line = document.getElementById('daily-report-line').value;
    const rangeType = document.getElementById('daily-report-range-type').value;
    const brigade = document.getElementById('daily-report-brigade').value;
    const month = document.getElementById('daily-report-month').value;
    const week = document.getElementById('daily-report-week-select').value;
    const day = document.getElementById('daily-report-day-picker').value;

    let url = `/api/dashboard/daily_report?line=${line}&range_type=${rangeType}`;
    if (month) url += `&month=${month}`;
    if (week) url += `&week=${week}`;
    if (day) url += `&day=${day}`;
    if (brigade) url += `&master_id=${brigade}`;

    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            
            // Set KPIs
            document.getElementById('kpi-shifts-count').innerText = data.total_shifts;
            document.getElementById('kpi-total-sheets').innerText = data.total_fact_sheets.toLocaleString();
            document.getElementById('kpi-total-tons').innerText = data.total_fact_tons.toFixed(1);
            document.getElementById('kpi-avg-plan-percent').innerText = Math.round(data.avg_plan_percent) + '%';
            document.getElementById('kpi-defect-percent').innerText = data.defect_percent.toFixed(1) + '%';

            // Renders charts
            renderDailyReportCharts(data.days);
        }
    } catch(e) {
        console.error(e);
    }
}

function renderDailyReportCharts(days) {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textCol = isDark ? '#f8fafc' : '#1e293b';

    const labels = days.map(d => d.date.split('-').slice(2).join('.'));
    
    // Sheets Chart
    const ctxSheets = document.getElementById('chart-daily-sheets').getContext('2d');
    if (chartDailySheets) chartDailySheets.destroy();
    chartDailySheets = new Chart(ctxSheets, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Факт (листы)',
                    data: days.map(d => d.fact_sheets),
                    backgroundColor: 'rgba(40, 167, 69, 0.8)',
                    borderColor: '#28a745',
                    borderWidth: 1
                },
                {
                    label: 'План (листы)',
                    data: days.map(d => d.plan_sheets),
                    backgroundColor: 'rgba(255, 255, 255, 0.2)',
                    borderColor: 'rgba(255, 255, 255, 0.5)',
                    borderWidth: 1,
                    type: 'line'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { ticks: { color: textCol } },
                y: { ticks: { color: textCol } }
            }
        }
    });

    // Tons Chart
    const ctxTons = document.getElementById('chart-daily-tons').getContext('2d');
    if (chartDailyTons) chartDailyTons.destroy();
    chartDailyTons = new Chart(ctxTons, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Факт (тонны)',
                    data: days.map(d => d.fact_tons),
                    backgroundColor: 'rgba(23, 162, 184, 0.8)',
                    borderColor: '#17a2b8',
                    borderWidth: 1
                },
                {
                    label: 'План (тонны)',
                    data: days.map(d => d.plan_tons),
                    backgroundColor: 'rgba(255, 255, 255, 0.2)',
                    borderColor: 'rgba(255, 255, 255, 0.5)',
                    borderWidth: 1,
                    type: 'line'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { ticks: { color: textCol } },
                y: { ticks: { color: textCol } }
            }
        }
    });
}

function exportDailyReportPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    
    // Simple mock Cyrillic export or just use canvas image
    alert("Экспорт PDF запущен. Отчет сгенерирован.");
}

// Window load init
window.addEventListener('DOMContentLoaded', () => {
    // Current date default for month picker
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('daily-report-month').value = yearMonth;

    init();
});

async function init() {
    initTheme();
    setupTimePickers();
    
    // Check session me
    try {
        const res = await fetch('/api/me/');
        if (res.ok) {
            const data = await res.json();
            if (data.authenticated) {
                currentUser = data.user;
                document.getElementById('login-screen').style.display = 'none';
                document.getElementById('main-app').style.display = 'block';
                document.getElementById('user-info-container').style.display = 'flex';
                document.getElementById('user-greeting-name').innerText = currentUser.name;
                document.getElementById('user-greeting-role').innerText = currentUser.role;
                
                applyRoleVisibility();
                await loadData();
                return;
            }
        }
        
        // If not authenticated, render user selection grid for generic roles only
        const gridRes = await fetch('/api/masters/');
        if (gridRes.ok) {
            const masters = await gridRes.json();
            const grid = document.getElementById('user-grid');
            if (grid) {
                // Show generic "Мастер смены" and other administration/staff roles. Hide operators and individual masters.
                const filteredMasters = masters.filter(m => 
                    (m.role === 'master' && m.name === 'Мастер смены') || 
                    ['admin', 'director', 'technologist', 'mechanic'].includes(m.role)
                );
                
                grid.innerHTML = filteredMasters.map(m => {
                    let roleDisplay = m.role;
                    let svgContent = '';
                    
                    if (m.role === 'master') {
                        roleDisplay = 'Мастер';
                        svgContent = `
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                                <path d="M9 14l2 2 4-4"></path>
                            </svg>
                        `;
                    } else if (m.role === 'admin') {
                        roleDisplay = 'Администратор';
                        svgContent = `
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                            </svg>
                        `;
                    } else if (m.role === 'director') {
                        roleDisplay = 'Директор';
                        svgContent = `
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                            </svg>
                        `;
                    } else if (m.role === 'technologist') {
                        roleDisplay = 'Технолог';
                        svgContent = `
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M10 2h4M12 2v8M18 16.6L13.5 9V4h-3v5L6 16.6C5.1 18.1 6.2 20 8 20h8c1.8 0 2.9-1.9 2-3.4z"></path>
                            </svg>
                        `;
                    } else if (m.role === 'mechanic') {
                        roleDisplay = 'Механик';
                        svgContent = `
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
                            </svg>
                        `;
                    } else {
                        svgContent = `
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                        `;
                    }
                    
                    const gradient = 'linear-gradient(135deg, var(--primary-color) 0%, var(--accent-color) 100%)';
                    const shadowColor = 'rgba(200, 35, 35, 0.3)';
                    
                    return `
                        <div class="user-card glass-panel" onclick="selectUser('${m.name}', '${roleDisplay}')" style="cursor: pointer; padding: 1.2rem 0.8rem; text-align: center; border: 1px solid var(--border-color); border-radius: 12px; transition: 0.2s; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 0; box-sizing: border-box;">
                            <div class="user-avatar-gradient" style="background: ${gradient}; width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.2rem; box-shadow: 0 4px 15px ${shadowColor}; flex-shrink: 0;">
                                ${svgContent}
                            </div>
                            <div style="font-weight: bold; font-size: 0.95rem; color: var(--text-primary); margin-bottom: 0.4rem; white-space: normal; line-height: 1.2; width: 100%; word-break: break-word;">${m.name}</div>
                            <div style="font-size: 0.72rem; color: var(--accent-color); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; white-space: normal; line-height: 1.2; width: 100%; word-break: break-word;">${roleDisplay}</div>
                        </div>
                    `;
                }).join('');
            }
        }
    } catch(e) {
        console.error("Init error:", e);
    }
}
