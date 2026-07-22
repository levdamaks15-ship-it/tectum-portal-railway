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

// Intercept fetch to check for session timeout (401) and prevent aggressive caching
const originalFetch = window.fetch;
window.fetch = function (url, options) {
    let targetUrl = url;
    if (typeof targetUrl === 'string' && targetUrl.startsWith('/api/') && (!options || !options.method || options.method.toUpperCase() === 'GET')) {
        const separator = targetUrl.includes('?') ? '&' : '?';
        targetUrl = `${targetUrl}${separator}_ts=${Date.now()}`;
    }
    return originalFetch(targetUrl, options).then(response => {
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
    
    // Strict exact matching to find correct product norm (fixes the 3500*980 bug)
    const norm = productNorms[prodName];
    const weight = norm ? norm.weight_kg : 19.6;
    const kgs = sheets * weight;
    const tons = kgs / 1000;
    
    const kgEl = document.getElementById('rep-kg-readonly');
    if (kgEl) {
        kgEl.value = kgs.toFixed(2);
    }
    const tonsEl = document.getElementById('rep-tons-readonly');
    if (tonsEl) {
        tonsEl.value = tons.toFixed(3);
    }
}

function onProductChange() {
    recalcTonsAndGrades();
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
    } else if (tabId === 'downtimes') {
        loadDowntimesByParams();
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

    flatpickr("#journal-dt-date", {
        dateFormat: "Y-m-d",
        locale: "ru",
        defaultDate: new Date(),
        onChange: function(selectedDates, dateStr, instance) {
            loadDowntimesByParams();
        }
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
            const recMaster = document.getElementById('rec-master');
            
            if (repMaster) {
                repMaster.innerHTML = '<option value="">-- Выберите мастера --</option>' + 
                    mastersList.filter(m => m.role === 'master' && m.name !== 'Мастер смены').map(m => `<option value="${m.id}">${m.name}</option>`).join('');
            }
            if (filterMaster) {
                filterMaster.innerHTML = '<option value="">-- Все мастера --</option>' + 
                    mastersList.filter(m => m.role === 'master' && m.name !== 'Мастер смены').map(m => `<option value="${m.id}">${m.name}</option>`).join('');
            }
            if (recMaster) {
                recMaster.innerHTML = '<option value="">-- Выберите мастера --</option>' + 
                    mastersList.filter(m => m.role === 'master' && m.name !== 'Мастер смены').map(m => `<option value="${m.id}">${m.name}</option>`).join('');
            }
            const dtMaster = document.getElementById('journal-dt-master-select');
            if (dtMaster) {
                dtMaster.innerHTML = '<option value="">-- Выберите мастера --</option>' + 
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
    await loadUserGrid();
}

function applyRoleVisibility() {
    const r = currentUser.role;
    
    // Master, Admin, Director, Technologist see all reports and summary
    const canReport = ['master', 'admin'].includes(r);
    const canViewSummary = ['master', 'admin', 'director', 'technologist'].includes(r);
    const canViewMaterials = ['admin', 'director', 'technologist'].includes(r); // Hide from master, keep for admin/director/technologist
    const canDowntime = ['master', 'admin', 'mechanic', 'director', 'technologist'].includes(r);
    
    document.getElementById('tab-btn-production').style.display = canReport ? 'inline-block' : 'none';
    document.getElementById('tab-btn-summary').style.display = canViewSummary ? 'inline-block' : 'none';
    document.getElementById('tab-btn-daily-report').style.display = canViewSummary ? 'inline-block' : 'none';
    document.getElementById('tab-btn-materials').style.display = canViewMaterials ? 'inline-block' : 'none';
    
    document.getElementById('tab-btn-downtimes').style.display = canDowntime ? 'inline-block' : 'none';
    document.getElementById('tab-btn-analytics').style.display = canDowntime ? 'inline-block' : 'none';
    
    // Показываем панель управления нормативами только для Технолога и Админа
    const normsPanel = document.getElementById('technologist-norms-panel');
    if (normsPanel) {
        normsPanel.style.display = ['admin', 'technologist'].includes(r) ? 'block' : 'none';
    }
    
    // Показываем панель управления простоев только для Механика, Технолога и Админа
    const dtPanel = document.getElementById('mechanic-downtimes-panel');
    if (dtPanel) {
        dtPanel.style.display = ['admin', 'mechanic', 'technologist'].includes(r) ? 'block' : 'none';
    }
    
    // Hide active shift banner as unified report doesn't use manual open/close state
    const activeShiftBanner = document.getElementById('active-shift-banner');
    if (activeShiftBanner) {
        activeShiftBanner.style.display = 'none';
    }
    
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
                    (currentUser.role === 'admin' || currentUser.role === 'master') ? 'inline-block' : 'none';
                
                // Do not prefill active shift on load - form should start fresh
                // prefillReportForm(activeShift);
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
    loadDowntimesByParams();
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
    // Data is loaded via dedicated endpoint
    loadReceipts(shift);

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
        zo_cem_drain: parseFloat(document.getElementById('zo-cem-drain').value) || 0.0
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
            const formContainer = document.getElementById('report-form-container');
            const successScreen = document.getElementById('report-success-screen');
            if (formContainer) formContainer.style.display = 'none';
            if (successScreen) successScreen.style.display = 'block';
            
            window.scrollTo({ top: 0, behavior: 'smooth' });
            loadData();
        } else {
            const err = await res.json();
            alert(`Ошибка сохранения: ${err.detail}`);
        }
    } catch(e) {
        alert(`Сетевая ошибка: ${e.message}`);
    }
}

function resetReportForm() {
    const dateEl = document.getElementById('rep-date');
    if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
    
    const batchEl = document.getElementById('rep-batch');
    if (batchEl) batchEl.value = '';
    
    const productEl = document.getElementById('rep-product');
    if (productEl) productEl.value = '';
    
    const numericIds = [
        'rep-sheets', 'rep-resets', 'rep-batches', 'rep-warehouse-gp', 'rep-first-grade', 'rep-qcd-defect',
        'def-chip', 'def-scratch', 'def-bad-cut', 'def-stick-bottom', 'def-stick-top', 'def-broken', 'def-fell', 
        'def-dent', 'def-thickness', 'def-delamination', 'def-edge',
        'zo-chr-4-20', 'zo-chr-5-65', 'zo-chr-6-40', 'zo-cem-1', 'zo-cem-2', 'zo-cem-3', 'zo-cem-4', 
        'zo-cellulose', 'zo-crushed-slate', 'zo-asbozurit', 'zo-fiberglass', 'zo-laprol', 'zo-asbocarton', 
        'zo-asb-drain', 'zo-cem-drain',
        'rec-chr-4-20', 'rec-chr-5-65', 'rec-chr-6-40', 'rec-cement-1', 'rec-cement-2', 'rec-cement-3', 'rec-cement-4', 'rec-cellulose', 'rec-crushed-slate', 
        'rec-asbozurit', 'rec-asbocarton', 'rec-pallets', 'rec-fiberglass', 'rec-laprol'
    ];
    
    numericIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    
    const hasDefectEl = document.getElementById('rep-has-defect');
    if (hasDefectEl) {
        hasDefectEl.value = 'no';
        const container = document.getElementById('rep-defect-container');
        if (container) container.style.display = 'none';
    }
    
    const readOnlyIds = [
        'rep-defect-total-readonly', 'zo-chr-total-readonly', 'zo-cem-total-readonly',
        'rep-weight-kg-readonly', 'rep-weight-t-readonly'
    ];
    readOnlyIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

function showNewReportForm() {
    resetReportForm();
    
    const formContainer = document.getElementById('report-form-container');
    const successScreen = document.getElementById('report-success-screen');
    
    if (successScreen) successScreen.style.display = 'none';
    if (formContainer) formContainer.style.display = 'block';
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

function toggleSummaryFilterFields() {
    const filterTypeSelect = document.getElementById('summary-filter-type');
    if (!filterTypeSelect) return;
    const filterType = filterTypeSelect.value;
    
    const dateFromEl = document.getElementById('summary-field-date-from');
    if (dateFromEl) dateFromEl.style.display = filterType === 'dates' ? 'inline-block' : 'none';
    
    const dateToEl = document.getElementById('summary-field-date-to');
    if (dateToEl) dateToEl.style.display = filterType === 'dates' ? 'inline-block' : 'none';
    
    const monthEl = document.getElementById('summary-field-month');
    if (monthEl) monthEl.style.display = (filterType === 'month' || filterType === 'week') ? 'inline-block' : 'none';
    
    const weekEl = document.getElementById('summary-field-week');
    if (weekEl) weekEl.style.display = filterType === 'week' ? 'inline-block' : 'none';
}

async function loadReportSummary() {
    const filterTypeEl = document.getElementById('summary-filter-type');
    const filterType = filterTypeEl ? filterTypeEl.value : 'dates';
    let from_date = '';
    let to_date = '';

    if (filterType === 'dates') {
        const fromEl = document.getElementById('filter-date-from');
        const toEl = document.getElementById('filter-date-to');
        from_date = fromEl ? fromEl.value : '';
        to_date = toEl ? toEl.value : '';
    } else {
        const monthEl = document.getElementById('summary-filter-month');
        const monthVal = monthEl ? monthEl.value : '';
        if (!monthVal) {
            alert("Пожалуйста, выберите месяц!");
            return;
        }
        const [year, month] = monthVal.split('-').map(Number);
        
        if (filterType === 'month') {
            from_date = `${year}-${String(month).padStart(2, '0')}-01`;
            const lastDay = new Date(year, month, 0).getDate();
            to_date = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        } else if (filterType === 'week') {
            const weekEl = document.getElementById('summary-filter-week');
            const weekVal = weekEl ? parseInt(weekEl.value) : 1;
            const mStr = String(month).padStart(2, '0');
            if (weekVal === 1) {
                from_date = `${year}-${mStr}-01`;
                to_date = `${year}-${mStr}-07`;
            } else if (weekVal === 2) {
                from_date = `${year}-${mStr}-08`;
                to_date = `${year}-${mStr}-14`;
            } else if (weekVal === 3) {
                from_date = `${year}-${mStr}-15`;
                to_date = `${year}-${mStr}-21`;
            } else if (weekVal === 4) {
                from_date = `${year}-${mStr}-22`;
                to_date = `${year}-${mStr}-28`;
            } else if (weekVal === 5) {
                from_date = `${year}-${mStr}-29`;
                const lastDay = new Date(year, month, 0).getDate();
                to_date = `${year}-${mStr}-${String(lastDay).padStart(2, '0')}`;
            }
        }
    }

    const lineEl = document.getElementById('filter-line');
    const masterEl = document.getElementById('filter-master');
    const line = lineEl ? lineEl.value : '';
    const master_id = masterEl ? masterEl.value : '';

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

function getDevCell(actual, theoretical) {
    if (theoretical <= 0) {
        if (actual === 0) return `<td style="color: var(--success-color); font-weight: 500;">0.00%</td>`;
        return `<td style="color: var(--danger-color); font-weight: 500;">+100.00%</td>`;
    }
    const devPct = ((actual - theoretical) / theoretical) * 100;
    const sign = devPct > 0 ? '+' : '';
    // > 0.1% is red, otherwise (savings or minimal deviation) is green
    const color = devPct > 0.1 ? 'var(--danger-color)' : 'var(--success-color)';
    return `<td style="color: ${color}; font-weight: 500;">${sign}${devPct.toFixed(2)}%</td>`;
}

function renderSummaryTable(rows) {
    const tbody = document.getElementById('summary-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="42" style="text-align: center; color: var(--text-secondary);">Нет данных за выбранный период</td></tr>';
        return;
    }

    rows.forEach(r => {
        const isEditable = currentUser && (currentUser.role === 'admin' || currentUser.role === 'master') && r.master_name !== 'Смена другого мастера';
        const editBtn = isEditable ? 
            `<button onclick="editReport(${r.shift_id})" class="btn-secondary" style="padding: 0.15rem 0.4rem; font-size: 0.7rem;">✏️ Изменить</button>` : 
            `<span style="color: var(--text-secondary); font-size: 0.7rem;">🔒 Блок</span>`;

        const u = r.zo_usage || {};
        const chrys_4_20 = u.chrysotile_4_20 || 0;
        const chrys_5_65 = u.chrysotile_5_65 || 0;
        const chrys_6_40 = u.chrysotile_6_40 || 0;
        const totalAsbestos = chrys_4_20 + chrys_5_65 + chrys_6_40;

        const cem_1 = u.cement_silo1 || 0;
        const cem_2 = u.cement_silo2 || 0;
        const cem_3 = u.cement_silo3 || 0;
        const cem_4 = u.cement_silo4 || 0;
        const totalCement = cem_1 + cem_2 + cem_3 + cem_4;

        // Defect color: 0 is green, anything else is red
        const defectColor = r.defect === 0 ? 'var(--success-color)' : 'var(--danger-color)';

        // Theoretical values for relative deviations
        const theo = r.deviations && r.deviations.theoretical ? r.deviations.theoretical : {};
        const t_4_20 = theo.chrysotile_4_20 || 0;
        const t_5_65 = theo.chrysotile_5_65 || 0;
        const t_6_40 = theo.chrysotile_6_40 || 0;
        const totalTheoAsbestos = t_4_20 + t_5_65 + t_6_40;
        const t_cement = theo.cement || 0;
        const t_asbocarton = theo.asbocarton || 0;
        const t_laprol = theo.laprol || 0;
        const t_cellulose = theo.cellulose || 0;
        const t_fiberglass = theo.fiberglass || 0;
        const t_crushed_slate = theo.crushed_slate || 0;
        const t_asbozurit = theo.asbozurit || 0;

        tbody.innerHTML += `
            <tr style="border-bottom: 1px solid var(--glass-border);">
                <td>${editBtn}</td>
                <td>${r.date}</td>
                <td>${r.batch_number}</td>
                <td>${r.line}</td>
                <td>${r.shift_name}</td>
                <td style="font-weight: 500;">${r.master_name}</td>
                <td>${r.product_name}</td>
                <td>${r.zo_batches}</td>
                <td style="font-weight: bold;">${r.lfm_sheets}</td>
                <td>${r.lfm_tons.toFixed(2)}</td>
                <td style="color: var(--success-color); font-weight: 500;">${r.warehouse_gp}</td>
                <td>${r.first_grade}</td>
                <td style="color: ${defectColor}; font-weight: bold;">${r.defect}</td>
                <td>${r.lfm_wind_resets}</td>
                <td>${(u.asb_drain || 0).toFixed(0)}</td>
                <td>${(u.cem_drain || 0).toFixed(0)}</td>
                <td>${chrys_4_20.toFixed(0)}</td>
                <td>${chrys_5_65.toFixed(0)}</td>
                <td>${chrys_6_40.toFixed(0)}</td>
                <td style="font-weight: 500;">${totalAsbestos.toFixed(0)}</td>
                <td>${cem_1.toFixed(0)}</td>
                <td>${cem_2.toFixed(0)}</td>
                <td>${cem_3.toFixed(0)}</td>
                <td>${cem_4.toFixed(0)}</td>
                <td style="font-weight: 500;">${totalCement.toFixed(0)}</td>
                <td>${(u.asbocarton || 0).toFixed(0)}</td>
                <td>${(u.laprol || 0).toFixed(0)}</td>
                <td>${(u.cellulose || 0).toFixed(0)}</td>
                <td>${(u.fiberglass || 0).toFixed(0)}</td>
                <td>${(u.crushed_slate || 0).toFixed(0)}</td>
                <td>${(u.asbozurit || 0).toFixed(0)}</td>
                ${getDevCell(chrys_4_20, t_4_20)}
                ${getDevCell(chrys_5_65, t_5_65)}
                ${getDevCell(chrys_6_40, t_6_40)}
                ${getDevCell(totalAsbestos, totalTheoAsbestos)}
                ${getDevCell(totalCement, t_cement)}
                ${getDevCell(u.asbocarton || 0, t_asbocarton)}
                ${getDevCell(u.laprol || 0, t_laprol)}
                ${getDevCell(u.cellulose || 0, t_cellulose)}
                ${getDevCell(u.fiberglass || 0, t_fiberglass)}
                ${getDevCell(u.crushed_slate || 0, t_crushed_slate)}
                ${getDevCell(u.asbozurit || 0, t_asbozurit)}
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
            
            const formContainer = document.getElementById('report-form-container');
            const successScreen = document.getElementById('report-success-screen');
            if (successScreen) successScreen.style.display = 'none';
            if (formContainer) formContainer.style.display = 'block';
            
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

function downloadExcelLocal() {
    window.open('/api/dashboard/export_shift', '_blank');
}

async function syncGoogleSheetsManually() {
    try {
        const res = await fetch('/api/dashboard/sync_google_sheets_manual', {
            method: 'POST'
        });
        if (res.ok) {
            const data = await res.json();
            alert(data.message || 'Синхронизация с Google Таблицами выполнена успешно!');
        } else {
            const err = await res.json();
            alert('Ошибка: ' + (err.detail || 'Не удалось выполнить выгрузку в Google Таблицы'));
        }
    } catch(e) {
        console.error(e);
        alert('Ошибка сети или сервера при выгрузке');
    }
}

async function loadDowntimesByParams() {
    const dateInput = document.getElementById('journal-dt-date');
    const shiftNameInput = document.getElementById('journal-dt-shift-name');
    const lineInput = document.getElementById('journal-dt-line');
    const masterSelect = document.getElementById('journal-dt-master-select');
    
    if (!dateInput || !shiftNameInput || !lineInput) return;
    
    const date = dateInput.value;
    const shift_name = shiftNameInput.value;
    const line = lineInput.value;
    const master_id = masterSelect ? masterSelect.value : '';
    
    if (!date) return;
    
    try {
        let url = `/api/shifts/by_params?date=${date}&shift_name=${encodeURIComponent(shift_name)}&line=${encodeURIComponent(line)}`;
        if (master_id) {
            url += `&master_id=${master_id}`;
        }
        const res = await fetch(url);
        if (res.ok) {
            const shift = await res.json();
            document.getElementById('journal-dt-active-shift-id').value = shift.id;
            renderDowntimesTable(shift);
        } else {
            document.getElementById('journal-dt-active-shift-id').value = '';
            renderDowntimesTable({ downtimes: [] });
        }
    } catch(e) {
        console.error(e);
    }
}

async function refreshDowntimesTable() {
    const shiftId = document.getElementById('journal-dt-active-shift-id').value;
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

async function loadDowntimeDepartments() {
    try {
        const res = await fetch('/api/downtimes/directory/departments');
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

async function onJournalDeptChange() {
    const dept = document.getElementById('journal-dt-dept').value;
    const selectNode = document.getElementById('journal-dt-node');
    if (!dept) {
        selectNode.innerHTML = '<option value="">-- Сначала выберите участок --</option>';
        return;
    }
    
    try {
        const res = await fetch(`/api/downtimes/directory/nodes?department=${encodeURIComponent(dept)}`);
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
        const res = await fetch(`/api/downtimes/directory/breakdowns?department=${encodeURIComponent(dept)}&node=${encodeURIComponent(node)}`);
        if (res.ok) {
            const breakdowns = await res.json();
            selectBk.innerHTML = '<option value="">-- Выберите поломку --</option>' +
                breakdowns.map(b => `<option value="${b.breakdown}">${b.breakdown}</option>`).join('');
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
                <td>${d.lost_tons ? d.lost_tons.toFixed(2) : '0.00'} т</td>
                <td>${d.department} / ${d.node} / ${isEquipment}</td>
                <td>${d.comment || '-'}</td>
                <td>${mediaHtml}</td>
                <td>${editBtn}${deleteBtn}</td>
            </tr>
        `;
    });
}

async function addJournalDowntime() {
    let shiftId = document.getElementById('journal-dt-active-shift-id').value;
    
    const dateInput = document.getElementById('journal-dt-date');
    const shiftNameInput = document.getElementById('journal-dt-shift-name');
    const lineInput = document.getElementById('journal-dt-line');
    const masterSelect = document.getElementById('journal-dt-master-select');
    
    if (!dateInput || !shiftNameInput || !lineInput) return;
    
    const date = dateInput.value;
    const shift_name = shiftNameInput.value;
    const line = lineInput.value;
    const master_id = masterSelect ? masterSelect.value : '';
    
    if (!date) {
        alert("Выберите дату!");
        return;
    }
    
    if (!shiftId) {
        try {
            let url = `/api/shifts/by_params?date=${date}&shift_name=${encodeURIComponent(shift_name)}&line=${encodeURIComponent(line)}&create_if_not_exists=true`;
            if (master_id) {
                url += `&master_id=${master_id}`;
            }
            const createRes = await fetch(url);
            if (createRes.ok) {
                const createdShift = await createRes.json();
                shiftId = createdShift.id;
                document.getElementById('journal-dt-active-shift-id').value = shiftId;
            } else {
                alert("Не удалось создать рапорт смены для добавления простоя!");
                return;
            }
        } catch(e) {
            console.error(e);
            alert("Ошибка сети при создании рапорта смены!");
            return;
        }
    }
    
    const data = {
        start_time: document.getElementById('journal-dt-start').value,
        end_time: document.getElementById('journal-dt-end').value || null,
        department: document.getElementById('journal-dt-dept').value,
        node: document.getElementById('journal-dt-node').value,
        description: document.getElementById('journal-dt-breakdown').value,
        comment: document.getElementById('journal-dt-desc').value,
        is_equipment_downtime: document.getElementById('journal-dt-is-equipment-stop').checked,
        media_urls: null
    };

    if (!data.start_time || !data.department || !data.node || !data.description) {
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
            refreshDowntimesTable();
        } else {
            const err = await res.json();
            if (Array.isArray(err.detail)) {
                alert("Ошибка валидации: " + err.detail.map(e => e.msg).join("; "));
            } else {
                alert(`Ошибка: ${err.detail}`);
            }
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
            refreshDowntimesTable();
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
    
    const res = await fetch(`/api/downtimes/directory/nodes?department=${encodeURIComponent(dept)}`);
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
    
    const res = await fetch(`/api/downtimes/directory/breakdowns?department=${encodeURIComponent(dept)}&node=${encodeURIComponent(node)}`);
    if (res.ok) {
        const breakdowns = await res.json();
        selectBk.innerHTML = '<option value="">-- Выберите поломку --</option>' +
            breakdowns.map(b => `<option value="${b.breakdown}">${b.breakdown}</option>`).join('');
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
        description: document.getElementById('edit-dt-breakdown').value,
        comment: document.getElementById('edit-dt-desc').value,
        is_equipment_downtime: document.getElementById('edit-dt-is-equipment-stop').checked,
        media_urls: null
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
            refreshDowntimesTable();
        } else {
            const err = await res.json();
            if (Array.isArray(err.detail)) {
                alert("Ошибка валидации: " + err.detail.map(e => e.msg).join("; "));
            } else {
                alert(`Ошибка: ${err.detail}`);
            }
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

    document.getElementById('analytics-kpi-nonstop-min').innerText = data.total_nonstop_minutes + ' мин';
    document.getElementById('analytics-kpi-nonstop-count').innerText = data.total_nonstop_count;
    document.getElementById('analytics-kpi-nonstop-tons').innerText = data.total_nonstop_lost_tons.toFixed(1) + ' т';
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
    const rangeTypeSelect = document.getElementById('daily-report-range-type');
    if (!rangeTypeSelect) return;
    const rangeType = rangeTypeSelect.value;
    
    const monthEl = document.getElementById('daily-report-month');
    if (monthEl) monthEl.style.display = rangeType === 'month' ? 'inline-block' : 'none';
    
    const weekEl = document.getElementById('daily-report-week-select');
    if (weekEl) weekEl.style.display = rangeType === 'week' ? 'inline-block' : 'none';
}

async function loadDailyReport() {
    const lineEl = document.getElementById('daily-report-line');
    const rangeTypeEl = document.getElementById('daily-report-range-type');
    const brigadeEl = document.getElementById('daily-report-brigade');
    const monthEl = document.getElementById('daily-report-month');
    const weekEl = document.getElementById('daily-report-week-select');
    
    const line = lineEl ? lineEl.value : 'lfm1';
    const rangeType = rangeTypeEl ? rangeTypeEl.value : 'month';
    const brigade = brigadeEl ? brigadeEl.value : '';
    const month = monthEl ? monthEl.value : '';
    const week = weekEl ? weekEl.value : '';

    let url = `/api/dashboard/daily_report?line=${line}&range_type=${rangeType}`;
    if (month) url += `&month=${month}`;
    if (week) url += `&week=${week}`;
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

    const labels = days.map(d => d.label || d.date.split('-').slice(2).join('.'));
    
    // Determine bar colors dynamically based on Day/Night shift and Plan fulfillment
    const sheetsColors = days.map(d => {
        const isDay = d.label && d.label.includes('(Д)');
        const met = d.fact_sheets >= d.plan_sheets;
        if (met && d.fact_sheets > 0) return '#22c55e'; // Green if plan is met
        return isDay ? '#3b82f6' : '#8b5cf6'; // Blue for Day, Purple for Night
    });

    const tonsColors = days.map(d => {
        const isDay = d.label && d.label.includes('(Д)');
        const met = d.fact_tons >= d.plan_tons;
        if (met && d.fact_tons > 0) return '#22c55e'; // Green if plan is met
        return isDay ? '#3b82f6' : '#8b5cf6'; // Blue for Day, Purple for Night
    });

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
                    backgroundColor: sheetsColors,
                    borderColor: sheetsColors,
                    borderWidth: 1
                },
                {
                    label: 'План День (2700)',
                    data: Array(days.length).fill(2700),
                    borderColor: '#ffc107', // Yellow
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    type: 'line'
                },
                {
                    label: 'План Ночь (3300)',
                    data: Array(days.length).fill(3300),
                    borderColor: '#ef4444', // Red
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    type: 'line'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: textCol,
                        generateLabels: function(chart) {
                            return [
                                { text: 'Факт (выполнение)', fillStyle: '#22c55e', strokeStyle: '#22c55e', lineWidth: 1 },
                                { text: 'Факт (недовыполнение, День)', fillStyle: '#3b82f6', strokeStyle: '#3b82f6', lineWidth: 1 },
                                { text: 'Факт (недовыполнение, Ночь)', fillStyle: '#8b5cf6', strokeStyle: '#8b5cf6', lineWidth: 1 },
                                { text: 'План День (2700)', fillStyle: '#ffc107', strokeStyle: '#ffc107', lineWidth: 2 },
                                { text: 'План Ночь (3300)', fillStyle: '#ef4444', strokeStyle: '#ef4444', lineWidth: 2 }
                            ];
                        }
                    }
                }
            },
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
                    backgroundColor: tonsColors,
                    borderColor: tonsColors,
                    borderWidth: 1
                },
                {
                    label: 'План День (52.9 т)',
                    data: Array(days.length).fill(52.92),
                    borderColor: '#ffc107', // Yellow
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    type: 'line'
                },
                {
                    label: 'План Ночь (64.7 т)',
                    data: Array(days.length).fill(64.68),
                    borderColor: '#ef4444', // Red
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    type: 'line'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: textCol,
                        generateLabels: function(chart) {
                            return [
                                { text: 'Факт (выполнение)', fillStyle: '#22c55e', strokeStyle: '#22c55e', lineWidth: 1 },
                                { text: 'Факт (недовыполнение, День)', fillStyle: '#3b82f6', strokeStyle: '#3b82f6', lineWidth: 1 },
                                { text: 'Факт (недовыполнение, Ночь)', fillStyle: '#8b5cf6', strokeStyle: '#8b5cf6', lineWidth: 1 },
                                { text: 'План День (52.9 т)', fillStyle: '#ffc107', strokeStyle: '#ffc107', lineWidth: 2 },
                                { text: 'План Ночь (64.7 т)', fillStyle: '#ef4444', strokeStyle: '#ef4444', lineWidth: 2 }
                            ];
                        }
                    }
                }
            },
            scales: {
                x: { ticks: { color: textCol } },
                y: { ticks: { color: textCol } }
            }
        }
    });
}

function exportDailyReportPDF() {
    const { jsPDF } = window.jspdf;
    
    // Get values from page
    const titleText = document.getElementById('daily-report-title')?.innerText || "Месячный отчет выработки";
    const lineVal = document.getElementById('daily-report-line')?.value || "Все линии";
    const monthVal = document.getElementById('daily-report-month')?.value || "";
    
    const kpiShifts = document.getElementById('kpi-shifts-count')?.innerText || "0";
    const kpiSheets = document.getElementById('kpi-total-sheets')?.innerText || "0";
    const kpiTons = document.getElementById('kpi-total-tons')?.innerText || "0.0";
    const kpiAvgPlan = document.getElementById('kpi-avg-plan-percent')?.innerText || "0%";
    const kpiDefect = document.getElementById('kpi-defect-percent')?.innerText || "0%";

    // Prepare a high-resolution canvas for print quality
    const cw = 1600;
    const ch = 1200;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    
    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    
    // Header
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(titleText, cw / 2, 70);
    
    ctx.fillStyle = '#64748b';
    ctx.font = '22px Arial';
    ctx.fillText(`Линия: ${lineVal}   |   Период: ${monthVal}`, cw / 2, 115);
    
    // Draw horizontal line
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, 150);
    ctx.lineTo(cw - 80, 150);
    ctx.stroke();
    
    // Draw KPIs
    const kpis = [
        { label: "Всего смен", val: kpiShifts, color: '#1e293b' },
        { label: "Выработка (Листы)", val: kpiSheets, color: '#3b82f6' },
        { label: "Выработка (Тонны)", val: kpiTons, color: '#10b981' },
        { label: "Ср. % плана", val: kpiAvgPlan, color: '#f59e0b' },
        { label: "Процент брака", val: kpiDefect, color: '#ef4444' }
    ];
    
    const kpiW = (cw - 160) / 5;
    kpis.forEach((k, idx) => {
        const x = 80 + idx * kpiW;
        const y = 180;
        
        // Draw card border
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(x + 10, y, kpiW - 20, 120);
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 10, y, kpiW - 20, 120);
        
        // Text
        ctx.textAlign = 'center';
        ctx.fillStyle = '#64748b';
        ctx.font = '16px Arial';
        ctx.fillText(k.label, x + kpiW / 2, y + 40);
        
        ctx.fillStyle = k.color;
        ctx.font = 'bold 28px Arial';
        ctx.fillText(k.val, x + kpiW / 2, y + 85);
    });
    
    // Draw chart if exists
    if (chartDailySheets) {
        const chartImgSrc = chartDailySheets.canvas;
        // Calculate centered aspect ratio
        const chartW = cw - 160;
        const chartH = 600;
        ctx.drawImage(chartImgSrc, 80, 350, chartW, chartH);
    } else {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#94a3b8';
        ctx.font = '24px Arial';
        ctx.fillText("График не найден", cw / 2, 600);
    }
    
    // Footer
    ctx.textAlign = 'center';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px Arial';
    ctx.fillText(`Сгенерировано автоматически порталом Tectum. Дата экспорта: ${new Date().toLocaleString()}`, cw / 2, ch - 50);
    
    // Convert to PDF
    const pdfData = canvas.toDataURL('image/jpeg', 0.95);
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.addImage(pdfData, 'JPEG', 0, 0, 297, 210);
    doc.save(`Tectum_Daily_Report_${monthVal}.pdf`);
}

async function syncNormsFromGoogle() {
    const statusEl = document.getElementById('norms-sync-status');
    if (statusEl) {
        statusEl.innerText = "⏳ Синхронизация...";
        statusEl.style.color = "var(--text-secondary)";
    }
    
    try {
        const res = await fetch('/api/norms/sync_from_google', {
            method: 'POST'
        });
        const data = await res.json();
        
        if (res.ok && data.status === 'success') {
            if (statusEl) {
                statusEl.innerText = "✅ Нормативы успешно обновлены!";
                statusEl.style.color = "#22c55e";
            }
            // Перезагружаем нормы на клиенте
            await loadProductNorms();
        } else {
            if (statusEl) {
                statusEl.innerText = `❌ Ошибка: ${data.detail || 'Не удалось обновить'}`;
                statusEl.style.color = "var(--danger-color)";
            }
        }
    } catch (e) {
        console.error(e);
        if (statusEl) {
            statusEl.innerText = "❌ Ошибка сети при синхронизации";
            statusEl.style.color = "var(--danger-color)";
        }
    }
}

async function syncDowntimesFromGoogle() {
    const statusEl = document.getElementById('downtimes-sync-status');
    if (statusEl) {
        statusEl.innerText = "⏳ Синхронизация...";
        statusEl.style.color = "var(--text-secondary)";
    }
    
    try {
        const res = await fetch('/api/downtimes/directory/sync_from_google', {
            method: 'POST'
        });
        const data = await res.json();
        
        if (res.ok && data.status === 'success') {
            if (statusEl) {
                statusEl.innerText = "✅ Справочник простоев обновлен!";
                statusEl.style.color = "#22c55e";
            }
            // Перезагружаем разделы и причины на клиенте
            loadDowntimeDepartments();
        } else {
            if (statusEl) {
                statusEl.innerText = `❌ Ошибка: ${data.detail || 'Не удалось обновить'}`;
                statusEl.style.color = "var(--danger-color)";
            }
        }
    } catch (e) {
        console.error(e);
        if (statusEl) {
            statusEl.innerText = "❌ Ошибка сети при синхронизации";
            statusEl.style.color = "var(--danger-color)";
        }
    }
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
        
        await loadUserGrid();
    } catch(e) {
        console.error("Init error:", e);
    }
}

async function loadUserGrid() {
    try {
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
        console.error("Error loading user grid:", e);
    }
}

async function exportDowntimesToGoogle() {
    const statusEl = document.getElementById('downtimes-sync-status');
    if (statusEl) {
        statusEl.textContent = '⏳ Экспорт простоев...';
        statusEl.style.color = 'var(--accent-color)';
    }
    
    try {
        const res = await fetch('/api/dashboard/sync_downtimes_to_google', { method: 'POST' });
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.detail || 'Ошибка экспорта');
        }
        
        if (statusEl) {
            statusEl.textContent = '✅ ' + data.message;
            statusEl.style.color = '#22c55e';
        }
    } catch(e) {
        console.error('Export downtimes error:', e);
        if (statusEl) {
            statusEl.textContent = '❌ ' + (e.message || 'Ошибка');
            statusEl.style.color = 'var(--danger-color)';
        }
    }
}


// --- Raw Material Receipts Logic ---
async function loadReceipts(shift) {
    if (!shift || !shift.id) return;
    try {
        const res = await fetch(`/api/shifts/${shift.id}`);
        if (res.ok) {
            const shiftData = await res.json();
            renderReceiptsTable(shiftData.receipts || [], shiftData);
        }
    } catch(e) {
        console.error('Error loading receipts:', e);
    }
}

function renderReceiptsTable(receipts, shiftData) {
    const tbody = document.getElementById('receipts-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (!receipts || receipts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">Нет добавленных приходов сырья</td></tr>';
        return;
    }

    const sDate = shiftData ? shiftData.date : '-';
    const sName = shiftData ? shiftData.shift_name : '-';
    const mName = shiftData && shiftData.master ? shiftData.master.name : '-';

    receipts.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${sDate}</td>
            <td>${sName}</td>
            <td>${mName}</td>
            <td>
                <button type="button" class="btn-danger btn-sm" onclick="deleteReceipt(${r.id})">❌</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function addReceipt() {
    const date = document.getElementById('rec-date').value;
    const shift_name = document.getElementById('rec-shift').value;
    const line = document.getElementById('rec-line').value;
    const master_id = document.getElementById('rec-master').value;
    
    if (!date || !shift_name || !line || !master_id) {
        alert("Пожалуйста, заполните параметры смены (Дата, Смена, Линия, Мастер) перед добавлением прихода сырья.");
        return;
    }
    
    const data = {
        chrysotile_4_20: parseFloat(document.getElementById('rec-chr-4-20').value) || 0.0,
        chrysotile_5_65: parseFloat(document.getElementById('rec-chr-5-65').value) || 0.0,
        chrysotile_6_40: parseFloat(document.getElementById('rec-chr-6-40').value) || 0.0,
        cement_silo1: parseFloat(document.getElementById('rec-cement-1').value) || 0.0,
        cement_silo2: parseFloat(document.getElementById('rec-cement-2').value) || 0.0,
        cement_silo3: parseFloat(document.getElementById('rec-cement-3').value) || 0.0,
        cement_silo4: parseFloat(document.getElementById('rec-cement-4').value) || 0.0,
        cellulose: parseFloat(document.getElementById('rec-cellulose').value) || 0.0,
        crushed_slate: parseFloat(document.getElementById('rec-crushed-slate').value) || 0.0,
        asbozurit: parseFloat(document.getElementById('rec-asbozurit').value) || 0.0,
        asbocarton: parseFloat(document.getElementById('rec-asbocarton').value) || 0.0,
        pallets: parseFloat(document.getElementById('rec-pallets').value) || 0.0,
        fiberglass: parseFloat(document.getElementById('rec-fiberglass').value) || 0.0,
        laprol: parseFloat(document.getElementById('rec-laprol').value) || 0.0
    };
    
    try {
        // Find or create shift first
        let url = `/api/shifts/by_params?date=${date}&shift_name=${encodeURIComponent(shift_name)}&line=${encodeURIComponent(line)}&master_id=${master_id}&create_if_not_exists=true`;
        const shiftRes = await fetch(url);
        if (!shiftRes.ok) throw new Error("Не удалось определить или создать смену");
        
        const shift = await shiftRes.json();
        
        const res = await fetch(`/api/shifts/${shift.id}/receipts`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        
        if (res.ok) {
            // Clear fields
            ['rec-chr-4-20', 'rec-chr-5-65', 'rec-chr-6-40', 'rec-cement-1', 'rec-cement-2', 'rec-cement-3', 'rec-cement-4', 'rec-cellulose', 'rec-crushed-slate', 'rec-asbozurit', 'rec-asbocarton', 'rec-pallets', 'rec-fiberglass', 'rec-laprol'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            loadReceipts(shift);
        } else {
            const err = await res.json();
            alert("Ошибка при добавлении прихода: " + (err.detail || 'Неизвестная ошибка'));
        }
    } catch(e) {
        alert("Ошибка: " + e.message);
    }
}

async function deleteReceipt(receiptId) {
    if (!confirm("Вы уверены, что хотите удалить этот приход сырья?")) return;
    
    try {
        const res = await fetch(`/api/receipts/${receiptId}`, {
            method: 'DELETE'
        });
        
        if (res.ok) {
            // Reload receipts for the currently selected shift
            const date = document.getElementById('rep-date').value;
            const shift_name = document.getElementById('rep-shift').value;
            const line = document.getElementById('rep-line').value;
            let url = `/api/shifts/by_params?date=${date}&shift_name=${encodeURIComponent(shift_name)}&line=${encodeURIComponent(line)}`;
            const shiftRes = await fetch(url);
            if (shiftRes.ok) {
                const shift = await shiftRes.json();
                loadReceipts(shift);
            }
        } else {
            const err = await res.json();
            alert("Ошибка при удалении: " + (err.detail || 'Неизвестная ошибка'));
        }
    } catch(e) {
        alert("Ошибка: " + e.message);
    }
}
