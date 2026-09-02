// Tectum Portal Unified JS App logic
let currentUser = null;
let activeShift = null;
let ssoActive = false;
let productNorms = {};
let mastersList = [];
window.currentLoadedShiftId = null;

// Global handler: prevent mouse wheel from changing input[type="number"] values
document.addEventListener('wheel', function (e) {
    if (document.activeElement && document.activeElement.type === 'number') {
        document.activeElement.blur();
    }
}, { passive: true });

// UX Helpers
function showNotification(type, title, message) {
    const modal = document.getElementById('universal-notification-modal');
    const overlay = document.getElementById('universal-notification-overlay');
    const iconContainer = document.getElementById('unm-icon');
    const iconText = document.getElementById('unm-icon-text');
    const titleEl = document.getElementById('unm-title');
    const messageEl = document.getElementById('unm-message');
    const btn = document.getElementById('unm-btn');

    if (!modal || !overlay) return;

    if (type === 'success') {
        iconContainer.style.background = 'rgba(34, 197, 94, 0.2)';
        iconContainer.style.border = '2px solid #22c55e';
        iconText.style.color = '#22c55e';
        iconText.innerHTML = '✓';
        btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
        btn.style.boxShadow = '0 8px 20px rgba(16, 185, 129, 0.3)';
    } else if (type === 'error') {
        iconContainer.style.background = 'rgba(239, 68, 68, 0.2)';
        iconContainer.style.border = '2px solid #ef4444';
        iconText.style.color = '#ef4444';
        iconText.innerHTML = '✕';
        btn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
        btn.style.boxShadow = '0 8px 20px rgba(239, 68, 68, 0.3)';
    }

    titleEl.innerText = title;
    messageEl.innerText = message;

    overlay.style.display = 'block';
    modal.style.display = 'block';
}

function closeUniversalNotification() {
    const overlay = document.getElementById('universal-notification-overlay');
    const modal = document.getElementById('universal-notification-modal');
    if (overlay) overlay.style.display = 'none';
    if (modal) modal.style.display = 'none';
}

function setButtonLoading(buttonId, isLoading, originalText = '') {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    
    if (isLoading) {
        btn.disabled = true;
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = `<span style="display:inline-block; width:16px; height:16px; border:2px solid rgba(255,255,255,0.3); border-radius:50%; border-top-color:#fff; animation:spin 1s linear infinite; margin-right:8px; vertical-align:middle;"></span> Отправка...`;
        btn.style.opacity = '0.7';
        btn.style.cursor = 'wait';
    } else {
        btn.disabled = false;
        btn.innerHTML = btn.dataset.originalText || originalText;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    }
}

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
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('theme', 'light');
}

function toggleTheme() {
    // Light theme only
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('theme', 'light');
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

function togglePrevDefectsGrid() {
    const hasDefect = document.getElementById('rep-prev-has-defect').value;
    const grid = document.getElementById('prev-defects-detail-grid');
    if (hasDefect === 'yes') {
        grid.style.display = 'block';
    } else {
        grid.style.display = 'none';
        // Zero all prev defect inputs
        document.querySelectorAll('.prev-defect-input').forEach(i => i.value = '0');
        recalcPrevDefectTotal();
    }
}

function recalcPrevDefectTotal() {
    let total = 0;
    document.querySelectorAll('.prev-defect-input').forEach(input => {
        total += parseFloat(input.value) || 0;
    });
    const totalEl = document.getElementById('rep-prev-defect-total-readonly');
    if (totalEl) totalEl.value = total;
}

async function updateShiftScheduleHints() {
    const dateVal = document.getElementById('rep-date')?.value;
    const shiftVal = document.getElementById('rep-shift')?.value;
    if (!dateVal) return;
    
    // dateVal: YYYY-MM-DD -> DD.MM.YYYY
    const parts = dateVal.split('-');
    if (parts.length !== 3) return;
    const dateStr = `${parts[2]}.${parts[1]}.${parts[0]}`;
    
    try {
        const res = await fetch(`/api/checklists/schedule/today?date=${encodeURIComponent(dateStr)}`);
        if (res.ok) {
            const data = await res.json();
            const currEl = document.getElementById('badge-curr-shift-hint');
            const prevEl = document.getElementById('badge-prev-shift-hint');
            
            const isDay = (shiftVal === 'День');
            let currGroup = isDay ? (data.schedule_entry?.day_shift_group || 'Смена') : (data.schedule_entry?.night_shift_group || 'Смена');
            let prevGroup = isDay ? (data.prev_shift_group || 'Смена') : (data.schedule_entry?.day_shift_group || 'Смена');
            
            if (currEl) currEl.textContent = `Текущая: ${currGroup}`;
            if (prevEl) prevEl.textContent = `Предыдущая: ${prevGroup}`;
        }
    } catch(e) {
        console.log('Schedule hint note:', e);
    }
}

function recalcTonsAndGrades() {
    const sheets = parseFloat(document.getElementById('rep-sheets')?.value) || 0;
    const prodName = document.getElementById('rep-product')?.value || '';
    
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

async function onProductChange(event) {
    recalcTonsAndGrades();
    
    const date = document.getElementById('rep-date')?.value;
    const shiftName = document.getElementById('rep-shift')?.value;
    const line = document.getElementById('rep-line')?.value;
    const productName = document.getElementById('rep-product')?.value;
    const batchNumber = document.getElementById('rep-batch')?.value;
    const exportType = document.getElementById('rep-export-type')?.value || "Эталон";
    
    if (date && shiftName && line && productName) {
        try {
            let url = `/api/shifts/by_params?date=${date}&shift_name=${encodeURIComponent(shiftName)}&line=${encodeURIComponent(line)}&product_name=${encodeURIComponent(productName)}&export_type=${encodeURIComponent(exportType)}`;
            if (batchNumber) {
                url += `&batch_number=${encodeURIComponent(batchNumber)}`;
            }
            const res = await fetch(url);
            if (res.ok) {
                const shift = await res.json();
                window.currentLoadedShiftId = shift.id;
                prefillReportForm(shift);
            } else if (res.status === 404) {
                // Not found.
                // If we were viewing an already saved shift from the DB (currentLoadedShiftId != null),
                // reset the form to create a clean new record for the other batch/product.
                // But if user is just filling out a new draft (!window.currentLoadedShiftId),
                // KEEP their entered numbers (sheets, ZOs, calculators) and just update calculation.
                if (window.currentLoadedShiftId) {
                    const masterId = document.getElementById('rep-master')?.value;
                    const batchNum = document.getElementById('rep-batch')?.value;
                    
                    resetReportForm();
                    
                    if (document.getElementById('rep-date')) document.getElementById('rep-date').value = date;
                    if (document.getElementById('rep-shift')) document.getElementById('rep-shift').value = shiftName;
                    if (document.getElementById('rep-line')) document.getElementById('rep-line').value = line;
                    if (window.updateLineSiloHeaders) window.updateLineSiloHeaders();
                    if (document.getElementById('rep-product')) document.getElementById('rep-product').value = productName;
                    if (document.getElementById('rep-export-type')) document.getElementById('rep-export-type').value = exportType;
                    if (document.getElementById('rep-master')) document.getElementById('rep-master').value = masterId || '';
                    if (document.getElementById('rep-batch')) document.getElementById('rep-batch').value = batchNum || '';
                }
                recalcTonsAndGrades();
            }
        } catch(e) {
            console.error(e);
        }
    }
}

function saveLastLineAndShift(line, shiftName) {
    if (line) localStorage.setItem('lastLine', line);
    if (shiftName) localStorage.setItem('lastShift', shiftName);
}

function restoreLastLineAndShift() {
    const savedLine = localStorage.getItem('lastLine');
    const savedShift = localStorage.getItem('lastShift');
    
    if (savedLine) {
        const repLine = document.getElementById('rep-line');
        const recLine = document.getElementById('rec-line');
        const dtLine = document.getElementById('journal-dt-line');
        
        if (repLine) repLine.value = savedLine;
        if (recLine) recLine.value = savedLine;
        if (dtLine) dtLine.value = savedLine;
        if (typeof window.updateLineSiloHeaders === 'function') window.updateLineSiloHeaders();
    }
    
    if (savedShift) {
        const repShift = document.getElementById('rep-shift');
        const recShift = document.getElementById('rec-shift');
        const dtShift = document.getElementById('journal-dt-shift-name');
        
        if (repShift) repShift.value = savedShift;
        if (recShift) recShift.value = savedShift;
        if (dtShift) dtShift.value = savedShift;
    }
}


function recalcDefectTotal() {
    let total = 0;
    document.querySelectorAll('.defect-input').forEach(input => {
        total += parseFloat(input.value) || 0;
    });
    document.getElementById('rep-defect-total-readonly').value = total;
}

function recalcChrTotal() {
    const v1 = parseFloat(document.getElementById('zo-chr-4-20')?.value) || 0;
    const v2 = parseFloat(document.getElementById('zo-chr-5-65')?.value) || 0;
    const v3 = parseFloat(document.getElementById('zo-chr-6-40')?.value) || 0;
    const target = document.getElementById('zo-chr-total-readonly');
    if (target) target.value = (v1 + v2 + v3).toFixed(1);
}

function recalcCemTotal() {
    const v1 = parseFloat(document.getElementById('zo-cem-1')?.value) || 0;
    const v2 = parseFloat(document.getElementById('zo-cem-2')?.value) || 0;
    const v3 = parseFloat(document.getElementById('zo-cem-3')?.value) || 0;
    const v4 = parseFloat(document.getElementById('zo-cem-4')?.value) || 0;
    const target = document.getElementById('zo-cem-total-readonly');
    if (target) target.value = (v1 + v2 + v3 + v4).toFixed(0);
}

function switchTab(tabId, event) {
    if (event) {
        // If it's a standard left click without modifier keys (not middle click, not Ctrl/Cmd/Shift), prevent default anchor navigation
        if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault();
        } else {
            // Let the browser handle middle click or Ctrl+click naturally
            return;
        }
    }
    
    sessionStorage.setItem('active_tab', tabId);
    if (window.location.hash !== `#${tabId}`) {
        history.replaceState(null, '', `#${tabId}`);
    }

    // Hide all tabs
    const tabs = ['production', 'crew-plans', 'summary', 'downtimes', 'daily-report', 'materials'];
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
    if (tabId === 'crew-plans') {
        loadCrewPlansFulfillment();
    } else if (tabId === 'summary') {
        loadReportSummary();
    } else if (tabId === 'daily-report') {
        loadDailyReport();
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
        defaultDate: new Date(),
        onChange: function(selectedDates, dateStr, instance) {
            if (typeof onProductChange === 'function') onProductChange();
        }
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
        try {
            localStorage.setItem('tectum_auth_user', JSON.stringify(currentUser));
            localStorage.setItem('tectum_portal_user', JSON.stringify({ name: currentUser.name, pin: pin }));
            localStorage.setItem('tectum_current_user_name', currentUser.name);
        } catch(e) {}

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
    try {
        localStorage.removeItem('tectum_auth_user');
        localStorage.removeItem('tectum_portal_user');
        localStorage.removeItem('tectum_current_user_name');
        sessionStorage.removeItem('planner_user_session');
    } catch(e) {}

    document.getElementById('user-info-container').style.display = 'none';
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('login-screen').style.display = 'block';
    document.getElementById('pin-input').value = '';
    resetLoginSelection();
    await loadUserGrid();
}

function applyRoleVisibility() {
    const r = currentUser.role;
    
    // Master, Admin, Director, Technologist see all reports, summary and crew plans
    const canReport = ['master', 'admin'].includes(r);
    const canViewSummary = ['master', 'admin', 'director', 'technologist'].includes(r);
    const canViewMaterials = ['admin', 'director', 'technologist'].includes(r); // Hide from master, keep for admin/director/technologist
    const canDowntime = ['master', 'admin', 'mechanic', 'director', 'technologist'].includes(r);
    
    const crewPlansBtn = document.getElementById('tab-btn-crew-plans');
    if (crewPlansBtn) crewPlansBtn.style.display = canViewSummary ? 'inline-block' : 'none';

    document.getElementById('tab-btn-production').style.display = canReport ? 'inline-block' : 'none';
    document.getElementById('tab-btn-summary').style.display = canViewSummary ? 'inline-block' : 'none';
    document.getElementById('tab-btn-daily-report').style.display = canViewSummary ? 'inline-block' : 'none';
    const materialsBtn = document.getElementById('tab-btn-materials');
    if (materialsBtn) materialsBtn.style.display = 'none';
    
    document.getElementById('tab-btn-downtimes').style.display = canDowntime ? 'inline-block' : 'none';
    const analyticsBtn = document.getElementById('tab-btn-analytics');
    if (analyticsBtn) analyticsBtn.style.display = 'none';
    
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
    
    // Hide Google Sheets export button from master role
    const btnExportGoogleSheets = document.getElementById('btn-export-google-sheets');
    if (btnExportGoogleSheets) {
        btnExportGoogleSheets.style.display = ['admin', 'director', 'technologist'].includes(r) ? 'inline-flex' : 'none';
    }
    
    // Determine active tab from URL hash / param or saved tab or role default
    const urlHash = window.location.hash ? window.location.hash.replace('#', '') : null;
    const urlParams = new URLSearchParams(window.location.search);
    const urlTab = urlParams.get('tab');
    const targetTab = urlHash || urlTab;
    
    const targetTabBtn = (targetTab && targetTab !== 'analytics') ? document.getElementById(`tab-btn-${targetTab}`) : null;
    const savedTab = sessionStorage.getItem('active_tab');
    const savedTabBtn = (savedTab && savedTab !== 'analytics') ? document.getElementById(`tab-btn-${savedTab}`) : null;
    
    if (targetTab && targetTabBtn && targetTabBtn.style.display !== 'none') {
        switchTab(targetTab);
    } else if (savedTab && savedTabBtn && savedTabBtn.style.display !== 'none') {
        switchTab(savedTab);
    } else if (r === 'director') {
        switchTab('crew-plans');
    } else if (canReport) {
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
    if (window.updateLineSiloHeaders) window.updateLineSiloHeaders();
    document.getElementById('rep-master').value = shift.master_id || '';
    document.getElementById('rep-batch').value = shift.batch_number || '';
    document.getElementById('rep-product').value = shift.product_name || '';
    if (document.getElementById('rep-export-type')) {
        document.getElementById('rep-export-type').value = shift.export_type || 'Эталон';
    }
    
    // Quantities
    document.getElementById('rep-batches').value = shift.zo_batches || '0';
    
    // Raw materials zo
    const materials = [
        {dbKey: 'zo_chrysotile_4_20', uiKey: 'chr-4-20', hiddenKey: 'zo-chr-4-20'},
        {dbKey: 'zo_chrysotile_5_65', uiKey: 'chr-5-65', hiddenKey: 'zo-chr-5-65'},
        {dbKey: 'zo_chrysotile_6_40', uiKey: 'chr-6-40', hiddenKey: 'zo-chr-6-40'},
        {dbKey: 'zo_cement', uiKey: 'cem', hiddenKey: 'zo-cem'},
        {dbKey: 'zo_cellulose', uiKey: 'cellulose', hiddenKey: 'zo-cel'},
        {dbKey: 'zo_crushed_slate', uiKey: 'crushed-slate', hiddenKey: 'zo-csl'},
        {dbKey: 'zo_asbozurit', uiKey: 'asbozurit', hiddenKey: 'zo-asb'},
        {dbKey: 'zo_fiberglass', uiKey: 'fiberglass', hiddenKey: 'zo-fib'},
        {dbKey: 'zo_laprol', uiKey: 'laprol', hiddenKey: 'zo-lap'},
        {dbKey: 'zo_asbocarton', uiKey: 'asbocarton', hiddenKey: 'zo-car'}
    ];
    
    materials.forEach(mat => {
        // DB total
        const zoTarget = document.getElementById(`zo-${mat.uiKey}`);
        if(zoTarget) zoTarget.value = shift[mat.dbKey] || '0';
        
        // Hidden inputs 1-4
        if(document.getElementById(`${mat.hiddenKey}-1`)) {
            document.getElementById(`${mat.hiddenKey}-1`).value = shift[`${mat.dbKey}_silo1`] || '0';
            document.getElementById(`${mat.hiddenKey}-2`).value = shift[`${mat.dbKey}_silo2`] || '0';
            document.getElementById(`${mat.hiddenKey}-3`).value = shift[`${mat.dbKey}_silo3`] || '0';
            document.getElementById(`${mat.hiddenKey}-4`).value = shift[`${mat.dbKey}_silo4`] || '0';
        }
        
        // Form inputs 1..4
        for (let s = 1; s <= 4; s++) {
            const calcInput = document.getElementById(`calc-${mat.uiKey}-${s}`);
            if (calcInput) {
                const sVal = shift[`${mat.dbKey}_silo${s}`];
                calcInput.value = (sVal !== undefined && sVal !== null && sVal > 0) ? sVal : '';
            }
        }
    });

    const simpleRMs = [
        {dbKey: 'zo_asb_drain', uiKey: 'asb-drain'},
        {dbKey: 'zo_cem_drain', uiKey: 'cem-drain'}
    ];
    simpleRMs.forEach(rm => {
        const val = shift[rm.dbKey] || '0';
        const zoTarget = document.getElementById(`zo-${rm.uiKey}`);
        if(zoTarget) zoTarget.value = val;
    });
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
                
                // Current shift defects breakdown
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

                // Previous shift defects breakdown
                const pd = row.prev_defects || {};
                const prevFirstGradeEl = document.getElementById('rep-prev-first-grade');
                if (prevFirstGradeEl) prevFirstGradeEl.value = row.prev_first_grade || '0';
                
                const prevScratchEl = document.getElementById('prev-def-scratch'); if (prevScratchEl) prevScratchEl.value = pd.prev_defect_scratch || '0';
                const prevBadCutEl = document.getElementById('prev-def-bad-cut'); if (prevBadCutEl) prevBadCutEl.value = pd.prev_defect_bad_cut || '0';
                const prevStickTopEl = document.getElementById('prev-def-stick-top'); if (prevStickTopEl) prevStickTopEl.value = pd.prev_defect_stick_top || '0';
                const prevBrokenEl = document.getElementById('prev-def-broken'); if (prevBrokenEl) prevBrokenEl.value = pd.prev_defect_broken || '0';
                const prevFellEl = document.getElementById('prev-def-fell'); if (prevFellEl) prevFellEl.value = pd.prev_defect_fell_box || '0';
                const prevThicknessEl = document.getElementById('prev-def-thickness'); if (prevThicknessEl) prevThicknessEl.value = pd.prev_defect_thickness || '0';
                const prevEdgeEl = document.getElementById('prev-def-edge'); if (prevEdgeEl) prevEdgeEl.value = pd.prev_defect_edge || '0';

                const hasPrevDefects = Object.values(pd).some(v => v > 0);
                const prevHasDefectEl = document.getElementById('rep-prev-has-defect');
                if (prevHasDefectEl) {
                    prevHasDefectEl.value = hasPrevDefects ? 'yes' : 'no';
                    togglePrevDefectsGrid();
                }
                
                recalcTonsAndGrades();
                recalcDefectTotal();
                recalcPrevDefectTotal();
                recalcChrTotal();
                recalcCemTotal();
            }
        });
}

async function submitShiftReport() {
    const data = {
        date: document.getElementById('rep-date')?.value || '',
        shift_name: document.getElementById('rep-shift')?.value || '',
        line: document.getElementById('rep-line')?.value || '',
        master_id: parseInt(document.getElementById('rep-master')?.value) || 0,
        batch_number: document.getElementById('rep-batch')?.value || '',
        product_name: document.getElementById('rep-product')?.value || '',
        export_type: document.getElementById('rep-export-type')?.value || 'Эталон',
        
        lfm_sheets: parseInt(document.getElementById('rep-sheets')?.value) || 0,
        lfm_wind_resets: parseInt(document.getElementById('rep-resets')?.value) || 0,
        zo_batches: parseInt(document.getElementById('rep-batches')?.value) || 0,
        
        warehouse_gp: parseInt(document.getElementById('rep-warehouse-gp')?.value) || 0,
        first_grade: parseInt(document.getElementById('rep-first-grade')?.value) || 0,
        has_defect: document.getElementById('rep-has-defect')?.value || 'no',
        
        ds_defect_chip: parseInt(document.getElementById('def-chip')?.value) || 0,
        ds_defect_scratch: parseInt(document.getElementById('def-scratch')?.value) || 0,
        ds_defect_bad_cut: parseInt(document.getElementById('def-bad-cut')?.value) || 0,
        ds_defect_stick_bottom: parseInt(document.getElementById('def-stick-bottom')?.value) || 0,
        ds_defect_stick_top: parseInt(document.getElementById('def-stick-top')?.value) || 0,
        ds_defect_broken: parseInt(document.getElementById('def-broken')?.value) || 0,
        ds_defect_fell_box: parseInt(document.getElementById('def-fell')?.value) || 0,
        ds_defect_dent: parseInt(document.getElementById('def-dent')?.value) || 0,
        ds_defect_thickness: parseInt(document.getElementById('def-thickness')?.value) || 0,
        ds_defect_delamination: parseInt(document.getElementById('def-delamination')?.value) || 0,
        ds_defect_edge: parseInt(document.getElementById('def-edge')?.value) || 0,

        // Предыдущая смена
        prev_first_grade: parseInt(document.getElementById('rep-prev-first-grade')?.value) || 0,
        prev_has_defect: document.getElementById('rep-prev-has-defect')?.value || 'no',
        prev_defect_scratch: parseInt(document.getElementById('prev-def-scratch')?.value) || 0,
        prev_defect_bad_cut: parseInt(document.getElementById('prev-def-bad-cut')?.value) || 0,
        prev_defect_stick_top: parseInt(document.getElementById('prev-def-stick-top')?.value) || 0,
        prev_defect_broken: parseInt(document.getElementById('prev-def-broken')?.value) || 0,
        prev_defect_fell_box: parseInt(document.getElementById('prev-def-fell')?.value) || 0,
        prev_defect_thickness: parseInt(document.getElementById('prev-def-thickness')?.value) || 0,
        prev_defect_edge: parseInt(document.getElementById('prev-def-edge')?.value) || 0,
        
        qcd_defect: parseInt(document.getElementById('rep-qcd-defect')?.value) || 0,


        zo_chrysotile_4_20_silo1: parseFloat(document.getElementById('zo-chr-4-20-1')?.value) || 0.0,
        zo_chrysotile_4_20_silo2: parseFloat(document.getElementById('zo-chr-4-20-2')?.value) || 0.0,
        zo_chrysotile_4_20_silo3: parseFloat(document.getElementById('zo-chr-4-20-3')?.value) || 0.0,
        zo_chrysotile_4_20_silo4: parseFloat(document.getElementById('zo-chr-4-20-4')?.value) || 0.0,
        
        zo_chrysotile_5_65_silo1: parseFloat(document.getElementById('zo-chr-5-65-1')?.value) || 0.0,
        zo_chrysotile_5_65_silo2: parseFloat(document.getElementById('zo-chr-5-65-2')?.value) || 0.0,
        zo_chrysotile_5_65_silo3: parseFloat(document.getElementById('zo-chr-5-65-3')?.value) || 0.0,
        zo_chrysotile_5_65_silo4: parseFloat(document.getElementById('zo-chr-5-65-4')?.value) || 0.0,
        
        zo_chrysotile_6_40_silo1: parseFloat(document.getElementById('zo-chr-6-40-1')?.value) || 0.0,
        zo_chrysotile_6_40_silo2: parseFloat(document.getElementById('zo-chr-6-40-2')?.value) || 0.0,
        zo_chrysotile_6_40_silo3: parseFloat(document.getElementById('zo-chr-6-40-3')?.value) || 0.0,
        zo_chrysotile_6_40_silo4: parseFloat(document.getElementById('zo-chr-6-40-4')?.value) || 0.0,
        
        zo_cement_silo1: parseFloat(document.getElementById('zo-cem-1')?.value) || 0.0,
        zo_cement_silo2: parseFloat(document.getElementById('zo-cem-2')?.value) || 0.0,
        zo_cement_silo3: parseFloat(document.getElementById('zo-cem-3')?.value) || 0.0,
        zo_cement_silo4: parseFloat(document.getElementById('zo-cem-4')?.value) || 0.0,
        
        zo_cellulose_silo1: parseFloat(document.getElementById('zo-cel-1')?.value) || 0.0,
        zo_cellulose_silo2: parseFloat(document.getElementById('zo-cel-2')?.value) || 0.0,
        zo_cellulose_silo3: parseFloat(document.getElementById('zo-cel-3')?.value) || 0.0,
        zo_cellulose_silo4: parseFloat(document.getElementById('zo-cel-4')?.value) || 0.0,
        
        zo_crushed_slate_silo1: parseFloat(document.getElementById('zo-csl-1')?.value) || 0.0,
        zo_crushed_slate_silo2: parseFloat(document.getElementById('zo-csl-2')?.value) || 0.0,
        zo_crushed_slate_silo3: parseFloat(document.getElementById('zo-csl-3')?.value) || 0.0,
        zo_crushed_slate_silo4: parseFloat(document.getElementById('zo-csl-4')?.value) || 0.0,
        
        zo_asbozurit_silo1: parseFloat(document.getElementById('zo-asb-1')?.value) || 0.0,
        zo_asbozurit_silo2: parseFloat(document.getElementById('zo-asb-2')?.value) || 0.0,
        zo_asbozurit_silo3: parseFloat(document.getElementById('zo-asb-3')?.value) || 0.0,
        zo_asbozurit_silo4: parseFloat(document.getElementById('zo-asb-4')?.value) || 0.0,
        
        zo_fiberglass_silo1: parseFloat(document.getElementById('zo-fib-1')?.value) || 0.0,
        zo_fiberglass_silo2: parseFloat(document.getElementById('zo-fib-2')?.value) || 0.0,
        zo_fiberglass_silo3: parseFloat(document.getElementById('zo-fib-3')?.value) || 0.0,
        zo_fiberglass_silo4: parseFloat(document.getElementById('zo-fib-4')?.value) || 0.0,
        
        zo_laprol_silo1: parseFloat(document.getElementById('zo-lap-1')?.value) || 0.0,
        zo_laprol_silo2: parseFloat(document.getElementById('zo-lap-2')?.value) || 0.0,
        zo_laprol_silo3: parseFloat(document.getElementById('zo-lap-3')?.value) || 0.0,
        zo_laprol_silo4: parseFloat(document.getElementById('zo-lap-4')?.value) || 0.0,
        
        zo_asbocarton_silo1: parseFloat(document.getElementById('zo-car-1')?.value) || 0.0,
        zo_asbocarton_silo2: parseFloat(document.getElementById('zo-car-2')?.value) || 0.0,
        zo_asbocarton_silo3: parseFloat(document.getElementById('zo-car-3')?.value) || 0.0,
        zo_asbocarton_silo4: parseFloat(document.getElementById('zo-car-4')?.value) || 0.0,
        
        zo_chrysotile_4_20: parseFloat(document.getElementById('zo-chr-4-20')?.value) || 0.0,
        zo_chrysotile_5_65: parseFloat(document.getElementById('zo-chr-5-65')?.value) || 0.0,
        zo_chrysotile_6_40: parseFloat(document.getElementById('zo-chr-6-40')?.value) || 0.0,
        zo_cement_silo1: parseFloat(document.getElementById('zo-cem-1')?.value) || 0.0,
        zo_cement_silo2: parseFloat(document.getElementById('zo-cem-2')?.value) || 0.0,
        zo_cement_silo3: parseFloat(document.getElementById('zo-cem-3')?.value) || 0.0,
        zo_cement_silo4: parseFloat(document.getElementById('zo-cem-4')?.value) || 0.0,
        zo_cellulose: parseFloat(document.getElementById('zo-cellulose')?.value) || 0.0,
        zo_crushed_slate: parseFloat(document.getElementById('zo-crushed-slate')?.value) || 0.0,
        zo_asbozurit: parseFloat(document.getElementById('zo-asbozurit')?.value) || 0.0,
        zo_fiberglass: parseFloat(document.getElementById('zo-fiberglass')?.value) || 0.0,
        zo_laprol: parseFloat(document.getElementById('zo-laprol')?.value) || 0.0,
        zo_asbocarton: parseFloat(document.getElementById('zo-asbocarton')?.value) || 0.0,
        zo_asb_drain: parseFloat(document.getElementById('zo-asb-drain')?.value) || 0.0,
        zo_cem_drain: parseFloat(document.getElementById('zo-cem-drain')?.value) || 0.0
    };

    if (!data.date || !data.shift_name || !data.line || isNaN(data.master_id) || !data.product_name) {
        showNotification('error', 'Ошибка', "Пожалуйста, заполните все обязательные поля заголовка смены!");
        return;
    }

    const isUpdating = !!window.editingShiftId;
    const url = isUpdating ? `/api/report/${window.editingShiftId}` : '/api/report';
    const method = isUpdating ? 'PUT' : 'POST';

    setButtonLoading('btn-submit-shift-report', true);
    try {
        const res = await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        
        if (res.ok) {
            clearReportDraft();
            saveLastLineAndShift(data.line, data.shift_name);
            
            if (isUpdating) {
                cancelReportEdit();
            }
            
            const formContainer = document.getElementById('report-form-container');
            const successScreen = document.getElementById('report-success-screen');
            if (formContainer) formContainer.style.display = 'none';
            if (successScreen) successScreen.style.display = 'block';
            
            window.scrollTo({ top: 0, behavior: 'smooth' });
            loadData();
            showNotification('success', isUpdating ? 'Рапорт обновлен!' : 'Смена отправлена!', isUpdating ? 'Изменения в рапорте смены успешно сохранены.' : 'Данные рапорта смены успешно загружены в облако.');
        } else {
            const err = await res.json();
            showNotification('error', 'Ошибка сохранения', err.detail || 'Неизвестная ошибка сервера');
        }
    } catch(e) {
        showNotification('error', 'Сетевая ошибка', e.message);
    } finally {
        setButtonLoading('btn-submit-shift-report', false);
    }
}

function resetReportForm() {
    window.currentLoadedShiftId = null;
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
        'rep-prev-first-grade',
        'prev-def-scratch', 'prev-def-bad-cut', 'prev-def-stick-top', 'prev-def-broken', 'prev-def-fell', 
        'prev-def-thickness', 'prev-def-edge',
        'zo-chr-4-20', 'zo-chr-5-65', 'zo-chr-6-40', 'zo-cem-1', 'zo-cem-2', 'zo-cem-3', 'zo-cem-4', 
        'zo-cellulose', 'zo-crushed-slate', 'zo-asbozurit', 'zo-fiberglass', 'zo-laprol', 'zo-asbocarton', 
        'zo-asb-drain', 'zo-cem-drain',
        'rec-chr-4-20', 'rec-chr-5-65', 'rec-chr-6-40', 'rec-cement-1', 'rec-cement-2', 'rec-cement-3', 'rec-cement-4', 'rec-cellulose', 'rec-crushed-slate', 
        'rec-asbozurit', 'rec-asbocarton', 'rec-pallets', 'rec-fiberglass', 'rec-laprol',
        
        // Calculator inputs
        'calc-chr-4-20-1', 'calc-chr-4-20-2', 'calc-chr-4-20-3', 'calc-chr-4-20-4',
        'calc-chr-5-65-1', 'calc-chr-5-65-2', 'calc-chr-5-65-3', 'calc-chr-5-65-4',
        'calc-chr-6-40-1', 'calc-chr-6-40-2', 'calc-chr-6-40-3', 'calc-chr-6-40-4',
        'calc-cem-1', 'calc-cem-2', 'calc-cem-3', 'calc-cem-4',
        'calc-cellulose-1', 'calc-cellulose-2', 'calc-cellulose-3', 'calc-cellulose-4',
        'calc-crushed-slate-1', 'calc-crushed-slate-2', 'calc-crushed-slate-3', 'calc-crushed-slate-4',
        'calc-asbozurit-1', 'calc-asbozurit-2', 'calc-asbozurit-3', 'calc-asbozurit-4',
        'calc-fiberglass-1', 'calc-fiberglass-2', 'calc-fiberglass-3', 'calc-fiberglass-4',
        'calc-laprol-1', 'calc-laprol-2', 'calc-laprol-3', 'calc-laprol-4',
        'calc-asbocarton-1', 'calc-asbocarton-2', 'calc-asbocarton-3', 'calc-asbocarton-4',
        'zo-chr-total-readonly', 'zo-cem-total-readonly'
    ];
    
    numericIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    
    const hasDefectEl = document.getElementById('rep-has-defect');
    if (hasDefectEl) {
        hasDefectEl.value = 'no';
        toggleDefectsGrid();
    }
    const prevHasDefectEl = document.getElementById('rep-prev-has-defect');
    if (prevHasDefectEl) {
        prevHasDefectEl.value = 'no';
        togglePrevDefectsGrid();
    }
    
    const readOnlyIds = [
        'rep-defect-total-readonly', 'rep-prev-defect-total-readonly', 'zo-chr-total-readonly', 'zo-cem-total-readonly',
        'rep-weight-kg-readonly', 'rep-weight-t-readonly'
    ];
    readOnlyIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

function showNewReportForm() {
    const masterId = document.getElementById('rep-master').value;
    resetReportForm();
    restoreLastLineAndShift();
    document.getElementById('rep-master').value = masterId;
    
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

function getWeeksOfMonth(year, month) {
    const weeks = [];
    const firstDayOfMonth = new Date(year, month - 1, 1);
    
    let dayOfWeek = firstDayOfMonth.getDay();
    let diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    
    let currentMonday = new Date(year, month - 1, 1 + diff);
    const firstDayOfNextMonth = new Date(year, month, 1);
    
    while (currentMonday < firstDayOfNextMonth) {
        const currentSunday = new Date(currentMonday);
        currentSunday.setDate(currentMonday.getDate() + 6);
        
        const sy = currentMonday.getFullYear();
        const sm = String(currentMonday.getMonth() + 1).padStart(2, '0');
        const sd = String(currentMonday.getDate()).padStart(2, '0');
        
        const ey = currentSunday.getFullYear();
        const em = String(currentSunday.getMonth() + 1).padStart(2, '0');
        const ed = String(currentSunday.getDate()).padStart(2, '0');
        
        weeks.push({
            startStr: `${sy}-${sm}-${sd}`,
            endStr: `${ey}-${em}-${ed}`,
            startDisplay: `${sd}.${sm}`,
            endDisplay: `${ed}.${em}`
        });
        
        currentMonday.setDate(currentMonday.getDate() + 7);
    }
    
    return weeks;
}

function updateWeekOptions(monthStr, selectId) {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return;
    let year, month;
    if (monthStr && monthStr.includes('-')) {
        const parts = monthStr.split('-');
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
    } else {
        const now = new Date();
        year = now.getFullYear();
        month = now.getMonth() + 1;
    }
    const weeks = getWeeksOfMonth(year, month);
    const currentVal = selectEl.value || '1';
    selectEl.innerHTML = '';
    weeks.forEach((w, idx) => {
        const weekNum = idx + 1;
        const opt = document.createElement('option');
        opt.value = weekNum;
        opt.textContent = `Неделя ${weekNum} (${w.startDisplay} - ${w.endDisplay})`;
        if (String(weekNum) === String(currentVal)) {
            opt.selected = true;
        }
        selectEl.appendChild(opt);
    });
    if (!selectEl.value && selectEl.options.length > 0) {
        selectEl.options[0].selected = true;
    }
}

function onSummaryMonthChange() {
    const monthEl = document.getElementById('summary-filter-month');
    if (monthEl) {
        updateWeekOptions(monthEl.value, 'summary-filter-week');
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
    if (weekEl) {
        weekEl.style.display = filterType === 'week' ? 'inline-block' : 'none';
        if (filterType === 'week') {
            const mVal = document.getElementById('summary-filter-month')?.value;
            updateWeekOptions(mVal, 'summary-filter-week');
        }
    }
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
    } else if (filterType === 'month' || filterType === 'week') {
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
            const weekVal = weekEl ? parseInt(weekEl.value, 10) : 1;
            const weeks = getWeeksOfMonth(year, month);
            const idx = weekVal - 1;
            const selectedWeek = (idx >= 0 && idx < weeks.length) ? weeks[idx] : (weeks.length > 0 ? weeks[0] : null);
            if (selectedWeek) {
                from_date = selectedWeek.startStr;
                to_date = selectedWeek.endStr;
            }
        }
    }

    const lineEl = document.getElementById('filter-line');
    const masterEl = document.getElementById('filter-master');
    const exportTypeEl = document.getElementById('summary-filter-export-type');
    const line = lineEl ? lineEl.value : '';
    const master_id = masterEl ? masterEl.value : '';
    const export_type = exportTypeEl ? exportTypeEl.value : '';

    let url = `/api/report/summary?from_date=${from_date}&to_date=${to_date}`;
    if (line) url += `&line=${encodeURIComponent(line)}`;
    if (master_id) url += `&master_id=${master_id}`;
    if (export_type) url += `&export_type=${encodeURIComponent(export_type)}`;

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
        tbody.innerHTML = '<tr><td colspan="43" style="text-align: center; color: var(--text-secondary);">Нет данных за выбранный период</td></tr>';
        return;
    }

    rows.forEach(r => {
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

        // Export badge styling
        const expType = r.export_type || 'Эталон';
        let exportBadge = `<span style="padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.75rem; background: rgba(255,255,255,0.08); color: var(--text-secondary);">${expType}</span>`;
        if (expType === 'Оренбург') {
            exportBadge = `<span style="padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.75rem; background: rgba(14, 165, 233, 0.2); color: #38bdf8; font-weight: bold;">Оренбург</span>`;
        } else if (expType === 'Шымкент') {
            exportBadge = `<span style="padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.75rem; background: rgba(168, 85, 247, 0.2); color: #c084fc; font-weight: bold;">Шымкент</span>`;
        }

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

        let actionCell = '<span style="color: var(--text-secondary); font-size: 0.75rem;">-</span>';
        if (r.can_edit) {
            let timerBadge = '';
            if (r.remaining_edit_seconds !== undefined && r.remaining_edit_seconds < 999990) {
                const mins = Math.floor(r.remaining_edit_seconds / 60);
                const secs = r.remaining_edit_seconds % 60;
                timerBadge = `<span class="report-row-timer" data-seconds="${r.remaining_edit_seconds}" style="display: block; font-size: 0.7rem; color: var(--text-secondary); margin-top: 2px;">⏱ ${mins}м ${secs}с</span>`;
            }
            actionCell = `
                <button type="button" onclick="editReport(${r.shift_id})" class="btn-secondary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.5); color: var(--text-primary); font-weight: 600; border-radius: 6px; cursor: pointer;">
                    ✏️ Изменить
                </button>
                ${timerBadge}
            `;
        }

        tbody.innerHTML += `
            <tr style="border-bottom: 1px solid var(--glass-border);">
                <td style="white-space: nowrap;">${actionCell}</td>
                <td>${r.date}</td>
                <td>${r.batch_number}</td>
                <td>${r.line}</td>
                <td>${r.shift_name}</td>
                <td style="font-weight: 500;">${r.master_name}</td>
                <td>${r.product_name}</td>
                <td>${exportBadge}</td>
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

    startSummaryRowTimers();
}

let summaryRowTimerInterval = null;
function startSummaryRowTimers() {
    if (summaryRowTimerInterval) clearInterval(summaryRowTimerInterval);
    
    summaryRowTimerInterval = setInterval(() => {
        const timerBadges = document.querySelectorAll('.report-row-timer');
        if (timerBadges.length === 0) return;
        
        let hasActive = false;
        timerBadges.forEach(badge => {
            let secs = parseInt(badge.getAttribute('data-seconds'), 10);
            if (isNaN(secs)) return;
            
            if (secs > 0) {
                secs--;
                badge.setAttribute('data-seconds', secs);
                const mins = Math.floor(secs / 60);
                const s = secs % 60;
                badge.innerText = `⏱ ${mins}м ${s < 10 ? '0' : ''}${s}с`;
                hasActive = true;
            } else {
                // Time expired, hide edit button and timer
                const parentTd = badge.closest('td');
                if (parentTd) {
                    parentTd.innerHTML = '<span style="color: var(--text-secondary); font-size: 0.75rem;">🔒 Истекло</span>';
                }
            }
        });
        
        if (!hasActive) {
            clearInterval(summaryRowTimerInterval);
        }
    }, 1000);
}

let reportEditTimerInterval = null;

async function editReport(shiftId) {
    try {
        const res = await fetch(`/api/shifts/${shiftId}`);
        if (res.ok) {
            const shift = await res.json();
            window.editingShiftId = shift.id;
            window.editingShiftRemainingSeconds = shift.remaining_edit_seconds;
            
            prefillReportForm(shift);
            
            const formContainer = document.getElementById('report-form-container');
            const successScreen = document.getElementById('report-success-screen');
            if (successScreen) successScreen.style.display = 'none';
            if (formContainer) formContainer.style.display = 'block';
            
            // Show edit banner
            const banner = document.getElementById('report-edit-mode-banner');
            const bannerTitle = document.getElementById('report-edit-banner-title');
            if (banner) banner.style.display = 'flex';
            if (bannerTitle) {
                bannerTitle.innerText = `Редактирование рапорта №${shift.id} (${shift.date} ${shift.shift_name} [${shift.line}])`;
            }
            
            // Change submit button to update mode
            const submitBtn = document.getElementById('btn-submit-shift-report');
            if (submitBtn) {
                submitBtn.innerHTML = '💾 Обновить рапорт смены';
                submitBtn.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
                submitBtn.style.boxShadow = '0 8px 25px rgba(245, 158, 11, 0.4)';
            }
            
            startReportEditTimer(shift.remaining_edit_seconds);
            
            switchTab('production');
            
            // Expand all accordion contents for editing
            document.querySelectorAll('.accordion-content').forEach(c => c.classList.remove('collapsed'));
            document.querySelectorAll('.accordion-section').forEach(s => s.classList.remove('collapsed'));
            
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    } catch(e) {
        alert("Ошибка при выборе смены: " + e.message);
    }
}

function startReportEditTimer(initialSeconds) {
    if (reportEditTimerInterval) clearInterval(reportEditTimerInterval);
    let secondsLeft = (initialSeconds !== undefined && initialSeconds !== null) ? initialSeconds : 1800;
    
    function updateDisplay() {
        const timerEl = document.getElementById('report-edit-timer');
        if (!timerEl) return;
        
        if (secondsLeft >= 999990) {
            timerEl.innerText = 'Без ограничений (Администратор)';
            return;
        }
        
        if (secondsLeft <= 0) {
            timerEl.innerText = '00:00 (Время истекло!)';
            timerEl.style.color = '#ef4444';
            clearInterval(reportEditTimerInterval);
            showNotification('error', 'Время истекло', '30-минутное окно самостоятельного редактирования рапорта завершилось. Для правок обратитесь к администратору.');
            return;
        }
        
        const m = Math.floor(secondsLeft / 60);
        const s = secondsLeft % 60;
        timerEl.innerText = `${m} мин ${s < 10 ? '0' : ''}${s} сек`;
        secondsLeft--;
    }
    
    updateDisplay();
    reportEditTimerInterval = setInterval(updateDisplay, 1000);
}

function cancelReportEdit() {
    window.editingShiftId = null;
    if (reportEditTimerInterval) clearInterval(reportEditTimerInterval);
    
    const banner = document.getElementById('report-edit-mode-banner');
    if (banner) banner.style.display = 'none';
    
    const submitBtn = document.getElementById('btn-submit-shift-report');
    if (submitBtn) {
        submitBtn.innerHTML = '💾 Сохранить рапорт смены';
        submitBtn.style.background = '';
        submitBtn.style.boxShadow = '';
    }
    
    resetReportForm();
    restoreLastLineAndShift();
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
            if (shift.master_id && masterSelect && !master_id) {
                masterSelect.value = shift.master_id;
            }
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
            depts.sort((a, b) => a.localeCompare(b));
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
            nodes.sort((a, b) => a.localeCompare(b));
            selectNode.innerHTML = '<option value="">-- Выберите узел --</option>' +
                nodes.map(n => `<option value="${n}">${n}</option>`).join('');
        }
    } catch(e) {
        console.error(e);
    }
}

function formatDurationHM(minutes) {
    if (!minutes || minutes <= 0) return '0:00';
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return `${h}:${m < 10 ? '0' : ''}${m}`;
}

function parseDurationMinutes(startTime, endTime) {
    if (!startTime || !endTime) return 0;
    const parts1 = startTime.trim().split(':');
    const parts2 = endTime.trim().split(':');
    if (parts1.length < 2 || parts2.length < 2) return 0;
    const h1 = parseInt(parts1[0], 10) || 0;
    const m1 = parseInt(parts1[1], 10) || 0;
    const h2 = parseInt(parts2[0], 10) || 0;
    const m2 = parseInt(parts2[1], 10) || 0;
    
    let total1 = h1 * 60 + m1;
    let total2 = h2 * 60 + m2;
    if (total2 < total1) {
        total2 += 24 * 60; // переход через полночь
    }
    return Math.max(0, total2 - total1);
}

function calcJournalDowntimeDuration() {
    const s = document.getElementById('journal-dt-start')?.value || '';
    const e = document.getElementById('journal-dt-end')?.value || '';
    const preview = document.getElementById('journal-dt-duration-preview');
    if (!preview) return;
    if (!s || !e) {
        preview.textContent = '0:00';
        return;
    }
    const mins = parseDurationMinutes(s, e);
    preview.textContent = `${formatDurationHM(mins)} (${mins} мин)`;
}

function calcEditDowntimeDuration() {
    const s = document.getElementById('edit-dt-start')?.value || '';
    const e = document.getElementById('edit-dt-end')?.value || '';
    const preview = document.getElementById('edit-dt-duration-preview');
    if (!preview) return;
    if (!s || !e) {
        preview.textContent = '0:00';
        return;
    }
    const mins = parseDurationMinutes(s, e);
    preview.textContent = `${formatDurationHM(mins)} (${mins} мин)`;
}

function updateDowntimeToggleUI() {
    const chk = document.getElementById('journal-dt-is-equipment-stop');
    const card = document.getElementById('journal-dt-toggle-card');
    const icon = document.getElementById('journal-dt-toggle-icon');
    const title = document.getElementById('journal-dt-toggle-title');
    const sub = document.getElementById('journal-dt-toggle-subtitle');
    const badge = document.getElementById('journal-dt-toggle-badge');
    if (!chk || !card) return;

    if (chk.checked) {
        card.style.borderColor = '#fca5a5';
        card.style.background = '#fef2f2';
        if (icon) icon.textContent = '🛑';
        if (title) { title.textContent = 'Остановка оборудования'; title.style.color = '#991b1b'; }
        if (sub) { sub.textContent = 'Линия была полностью остановлена'; sub.style.color = '#b91c1c'; }
        if (badge) {
            badge.textContent = 'ДА';
            badge.style.background = '#fee2e2';
            badge.style.color = '#991b1b';
            badge.style.borderColor = '#f87171';
        }
    } else {
        card.style.borderColor = '#86efac';
        card.style.background = '#f0fdf4';
        if (icon) icon.textContent = '🟢';
        if (title) { title.textContent = 'Ремонт на ходу (без остановки)'; title.style.color = '#166534'; }
        if (sub) { sub.textContent = 'Оборудование продолжало работать'; sub.style.color = '#15803d'; }
        if (badge) {
            badge.textContent = 'НЕТ';
            badge.style.background = '#dcfce7';
            badge.style.color = '#166534';
            badge.style.borderColor = '#4ade80';
        }
    }
}

function toggleEquipmentStopManual() {
    const chk = document.getElementById('journal-dt-is-equipment-stop');
    if (chk) {
        chk.checked = !chk.checked;
        updateDowntimeToggleUI();
    }
}

function onDowntimeTextChange() {
    const desc = document.getElementById('journal-dt-desc')?.value || '';
    const chk = document.getElementById('journal-dt-is-equipment-stop');
    if (!chk) return;
    const lower = desc.toLowerCase();
    if (lower.includes('на ходу') || lower.includes('без остановки') || lower.includes('без простоя')) {
        chk.checked = false;
        updateDowntimeToggleUI();
    }
}

function renderDowntimesTable(shift) {
    const tbody = document.getElementById('journal-downtimes-list');
    const totalBadge = document.getElementById('journal-dt-total-time-badge');
    const countBadge = document.getElementById('journal-dt-rows-count');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const downtimes = shift.downtimes || [];
    let totalMinutes = 0;
    
    if (downtimes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 2rem; color: var(--text-secondary);">Нет зафиксированных простоев за смену</td></tr>';
        if (totalBadge) totalBadge.textContent = '0:00 (0 мин)';
        if (countBadge) countBadge.textContent = 'Всего записей: 0';
        return;
    }

    if (countBadge) countBadge.textContent = `Всего записей: ${downtimes.length}`;

    downtimes.forEach((d, idx) => {
        const mins = d.duration || 0;
        totalMinutes += mins;
        const durationStr = mins > 0 ? formatDurationHM(mins) : (d.end_time ? '0:00' : 'В процессе');
        const isEquipment = d.is_equipment_downtime ? '<span style="color: #ef4444; font-weight: 600;">🛑 Да</span>' : '<span style="color: #10b981; font-weight: 600;">🟢 На ходу</span>';
        
        const desc = d.description || d.comment || '-';
        
        const canEdit = (d.can_edit !== undefined) ? d.can_edit : true;
        const deleteBtn = canEdit ? `<button onclick="deleteDowntime(${d.id})" class="btn-danger" style="padding: 0.3rem 0.6rem; font-size: 0.8rem; border-radius: 6px;" title="Удалить">🗑️</button>` : '';
        const editBtn = canEdit ? `<button onclick="openEditDowntimeModal(${d.id})" class="btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.8rem; margin-right: 0.4rem; border-radius: 6px;" title="Редактировать">✏️</button>` : '';
        const actionHtml = canEdit ? `<div style="display: flex; justify-content: flex-end;">${editBtn}${deleteBtn}</div>` : '<span style="color: var(--text-secondary); font-size: 0.75rem;">🔒 Истекло</span>';

        tbody.innerHTML += `
            <tr style="border-bottom: 1px solid var(--glass-border); transition: background 0.2s ease;">
                <td style="text-align: center; color: var(--text-secondary); padding: 0.6rem 0.4rem;">${idx + 1}</td>
                <td style="font-family: monospace; font-weight: 600; padding: 0.6rem 0.4rem;">${d.start_time || '-'}</td>
                <td style="font-family: monospace; font-weight: 600; padding: 0.6rem 0.4rem;">${d.end_time || '-'}</td>
                <td style="font-family: monospace; font-weight: 700; color: #0284c7; padding: 0.6rem 0.4rem;">${durationStr}</td>
                <td style="padding: 0.6rem 0.4rem; word-break: break-word; font-weight: 500;">${desc}</td>
                <td style="text-align: center; padding: 0.6rem 0.4rem;">${isEquipment}</td>
                <td style="padding: 0.6rem 0.4rem;">${actionHtml}</td>
            </tr>
        `;
    });

    if (totalBadge) {
        totalBadge.textContent = `${formatDurationHM(totalMinutes)} (${totalMinutes} мин)`;
    }
}

async function addJournalDowntime() {
    let shiftId = document.getElementById('journal-dt-active-shift-id')?.value;
    
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
        showNotification('error', 'Ошибка', "Выберите дату!");
        return;
    }
    
    const startTime = (document.getElementById('journal-dt-start')?.value || '').trim();
    const endTime = (document.getElementById('journal-dt-end')?.value || '').trim();
    const desc = (document.getElementById('journal-dt-desc')?.value || '').trim();
    const isEquipmentStop = document.getElementById('journal-dt-is-equipment-stop')?.checked ?? true;

    if (!desc) {
        showNotification('error', 'Ошибка', "Введите описание поломки или выполненных работ!");
        return;
    }
    if (!startTime) {
        showNotification('error', 'Ошибка', "Укажите время начала простоя!");
        return;
    }

    setButtonLoading('btn-add-dt', true);
    
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
                showNotification('error', 'Ошибка', "Не удалось создать рапорт смены для добавления простоя!");
                setButtonLoading('btn-add-dt', false);
                return;
            }
        } catch(e) {
            console.error(e);
            showNotification('error', 'Ошибка сети', "Ошибка сети при создании рапорта смены!");
            setButtonLoading('btn-add-dt', false);
            return;
        }
    }

    const data = {
        start_time: startTime,
        end_time: endTime || null,
        description: desc,
        comment: desc,
        is_equipment_downtime: isEquipmentStop,
        media_urls: null,
        master_id: master_id ? parseInt(master_id) : null
    };

    try {
        const res = await fetch(`/api/shifts/${shiftId}/downtimes`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        
        if (res.ok) {
            saveLastLineAndShift(line, shift_name);
            showNotification('success', 'Отлично!', 'Простой успешно зафиксирован в журнале.');
            // Очищаем поля ввода
            document.getElementById('journal-dt-desc').value = '';
            document.getElementById('journal-dt-start').value = '';
            document.getElementById('journal-dt-end').value = '';
            document.getElementById('journal-dt-is-equipment-stop').checked = true;
            updateDowntimeToggleUI();
            calcJournalDowntimeDuration();
        } else {
            const err = await res.json();
            if (Array.isArray(err.detail)) {
                showNotification('error', 'Ошибка валидации', err.detail.map(e => e.msg).join("; "));
            } else {
                showNotification('error', 'Ошибка', err.detail || 'Неизвестная ошибка сервера');
            }
        }
    } catch(e) {
        showNotification('error', 'Сетевая ошибка', e.message);
    } finally {
        setButtonLoading('btn-add-dt', false);
    }
}

async function deleteDowntime(id) {
    if (!confirm("Вы действительно хотите удалить запись о простое?")) return;
    try {
        const res = await fetch(`/api/downtimes/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showNotification('success', 'Успех', 'Запись удалена!');
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
        document.getElementById('edit-dt-start').value = d.start_time || '';
        document.getElementById('edit-dt-end').value = d.end_time || '';
        document.getElementById('edit-dt-desc').value = d.description || d.comment || '';
        document.getElementById('edit-dt-is-equipment-stop').checked = d.is_equipment_downtime !== false;
        
        calcEditDowntimeDuration();
        document.getElementById('edit-dt-modal').style.display = 'block';
        if (typeof setupTimePickers === 'function') setupTimePickers();
    } catch(e) {
        showNotification('error', 'Ошибка', e.message);
    }
}

function closeEditDowntimeModal() {
    const modal = document.getElementById('edit-dt-modal');
    if (modal) modal.style.display = 'none';
}

async function submitEditDowntime() {
    const id = document.getElementById('edit-dt-id')?.value;
    const startTime = (document.getElementById('edit-dt-start')?.value || '').trim();
    const endTime = (document.getElementById('edit-dt-end')?.value || '').trim();
    const desc = (document.getElementById('edit-dt-desc')?.value || '').trim();
    const isEquipmentStop = document.getElementById('edit-dt-is-equipment-stop')?.checked ?? true;

    if (!id) return;
    if (!desc) {
        alert("Введите описание поломки / работ!");
        return;
    }
    if (!startTime) {
        alert("Укажите время начала!");
        return;
    }
    
    const masterSelect = document.getElementById('journal-dt-master-select');
    const master_id = masterSelect ? masterSelect.value : '';

    const data = {
        start_time: startTime,
        end_time: endTime || null,
        description: desc,
        comment: desc,
        is_equipment_downtime: isEquipmentStop,
        media_urls: null,
        master_id: master_id ? parseInt(master_id) : null
    };

    try {
        const res = await fetch(`/api/downtimes/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        if (res.ok) {
            closeEditDowntimeModal();
            refreshDowntimesTable();
            showNotification('success', 'Успех', 'Запись о простое обновлена');
        } else {
            const err = await res.json();
            if (Array.isArray(err.detail)) {
                alert("Ошибка валидации: " + err.detail.map(e => e.msg).join("; "));
            } else {
                alert(`Ошибка: ${err.detail || 'Неизвестная ошибка'}`);
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
            renderAnalyticsTable(data);
        }
    } catch(e) {
        console.error(e);
    }
}

function renderAnalyticsKPIs(data) {
    const kpi = data.kpis || { with_stop: {}, without_stop: {} };
    
    document.getElementById('analytics-kpi-stop-min').innerText = (kpi.with_stop.duration || 0) + ' мин';
    document.getElementById('analytics-kpi-stop-count').innerText = (kpi.with_stop.count || 0);
    document.getElementById('analytics-kpi-stop-tons').innerText = (kpi.with_stop.lost_tons || 0).toFixed(1) + ' т';

    document.getElementById('analytics-kpi-nonstop-min').innerText = (kpi.without_stop.duration || 0) + ' мин';
    document.getElementById('analytics-kpi-nonstop-count').innerText = (kpi.without_stop.count || 0);
    document.getElementById('analytics-kpi-nonstop-tons').innerText = (kpi.without_stop.lost_tons || 0).toFixed(1) + ' т';
}

function renderAnalyticsCharts(data) {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textCol = isDark ? '#f8fafc' : '#1e293b';

    // Trend chart
    const ctxTrend = document.getElementById('chart-analytics-trend').getContext('2d');
    if (chartAnalyticsTrend) chartAnalyticsTrend.destroy();
    
    const trendData = data.trend || {};
    const dates = Object.keys(trendData).sort();
    const minutes = dates.map(d => Object.values(trendData[d]).reduce((a,b) => a+b, 0));

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
    
    const byCategory = data.by_category || {};
    const cats = Object.keys(byCategory);
    const catMins = cats.map(c => byCategory[c].with_stop + byCategory[c].without_stop);

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

function renderAnalyticsTable(data) {
    const tbody = document.getElementById('analytics-table-body');
    if (!tbody) return;
    
    const downtimes = data.downtimes || [];
    if (downtimes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">Нет данных за выбранный период</td></tr>';
        return;
    }
    
    let html = '';
    downtimes.forEach(dt => {
        const stopBadge = dt.is_equipment_downtime ? 
            '<span class="badge" style="background: rgba(220, 53, 69, 0.2); color: #ff6b6b; padding: 2px 6px;">Да</span>' : 
            '<span class="badge" style="background: rgba(40, 167, 69, 0.2); color: #28a745; padding: 2px 6px;">Нет</span>';
            
        html += `
            <tr>
                <td>${dt.date || '-'}</td>
                <td>${dt.shift || '-'}</td>
                <td>${dt.line || '-'}</td>
                <td>${dt.department || '-'}</td>
                <td>${dt.node || '-'}</td>
                <td>${dt.category || '-'}</td>
                <td>${stopBadge}</td>
                <td style="font-weight: bold;">${dt.duration || 0}</td>
                <td style="color: ${dt.is_equipment_downtime ? '#ff6b6b' : '#28a745'};">${(dt.lost_tons || 0).toFixed(2)}</td>
                <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${dt.description || ''}">${dt.description || ''}</td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

// ----------------------------------------------------
// DAILY REPORT TAB LOGIC (📈 Месячная сводка выработки)
// ----------------------------------------------------
function onDailyReportMonthChange() {
    const monthEl = document.getElementById('daily-report-month');
    if (monthEl) {
        updateWeekOptions(monthEl.value, 'daily-report-week-select');
    }
    loadDailyReport();
}

function toggleRangeControls() {
    const rangeTypeSelect = document.getElementById('daily-report-range-type');
    if (!rangeTypeSelect) return;
    const rangeType = rangeTypeSelect.value;
    
    const titleEl = document.getElementById('daily-report-title');
    if (titleEl) {
        titleEl.innerText = rangeType === 'week' ? 'Недельная сводка выработки' : 'Месячная сводка выработки';
    }

    const monthEl = document.getElementById('daily-report-month');
    if (monthEl) {
        monthEl.style.display = (rangeType === 'month' || rangeType === 'week') ? 'inline-block' : 'none';
        if (rangeType === 'week') {
            updateWeekOptions(monthEl.value, 'daily-report-week-select');
        }
    }
    
    const weekEl = document.getElementById('daily-report-week-select');
    const weekWrapper = document.getElementById('daily-report-week-wrapper');
    if (weekWrapper) {
        weekWrapper.style.display = rangeType === 'week' ? 'block' : 'none';
    } else if (weekEl) {
        weekEl.style.display = rangeType === 'week' ? 'inline-block' : 'none';
    }
}

async function loadDailyReport() {
    const lineEl = document.getElementById('daily-report-line');
    const rangeTypeEl = document.getElementById('daily-report-range-type');
    const monthEl = document.getElementById('daily-report-month');
    const weekEl = document.getElementById('daily-report-week-select');
    
    const line = lineEl ? lineEl.value : 'lfm1';
    const rangeType = rangeTypeEl ? rangeTypeEl.value : 'month';
    const month = monthEl ? monthEl.value : '';
    const week = weekEl ? weekEl.value : '';

    let url = `/api/dashboard/daily_report?line=${line}&range_type=${rangeType}`;
    if (month) url += `&month=${month}`;
    if (week) url += `&week=${week}`;

    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            
            // Calculate Today / MTD KPIs (up to today or worked shifts)
            const now = new Date();
            const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
            
            let todayPlanTons = 0;
            let todayFactTons = 0;
            let todayPlanSheets = 0;
            let todayFactSheets = 0;

            let passedDates = new Set();

            if (data.days && Array.isArray(data.days)) {
                data.days.forEach(s => {
                    if (s.date < todayStr || (s.date === todayStr && (s.fact_sheets > 0 || s.fact_tons > 0))) {
                        todayFactTons += (s.fact_tons || 0);
                        todayFactSheets += (s.fact_sheets || 0);
                        passedDates.add(s.date);
                    }
                });
            }

            // Определяем общее количество дней в периоде (делим длину массива на 2, так как бэкенд отдает по 2 смены на каждый день)
            let totalDays = (data.days && data.days.length > 0) ? (data.days.length / 2) : 31;

            // Считаем сколько дней прошло в выбранном периоде
            let daysPassedCount = passedDates.size;
            // Для более честного расчета, если мы смотрим текущий месяц, можно считать прошедшие дни по календарю:
            if (rangeType === 'month' && (!monthEl || !monthEl.value || monthEl.value === (now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0')))) {
                daysPassedCount = now.getDate();
            } else if (rangeType === 'week' && (!weekEl || !weekEl.value)) {
                let dayOfWeek = now.getDay(); // 0 = Sunday
                daysPassedCount = dayOfWeek === 0 ? 7 : dayOfWeek;
            }

            // Вычисляем план на сегодня пропорционально потолку (например 160 000 или 39 000)
            let totalPlanSheetsLimit = data.total_plan_sheets || 160000;
            
            todayPlanSheets = Math.round(totalPlanSheetsLimit / totalDays * daysPassedCount);
            
            // Динамический расчет веса (если производим шифер 7 волн, будет учтен его реальный вес ~17.07 кг)
            let avgWeight = 19.6;
            if (data.total_fact_sheets > 0 && data.total_fact_tons > 0) {
                avgWeight = (data.total_fact_tons * 1000.0) / data.total_fact_sheets;
            }
            todayPlanTons = (todayPlanSheets * avgWeight) / 1000.0;

            const diffTons = todayFactTons - todayPlanTons;
            const diffSheets = todayFactSheets - todayPlanSheets;

            const elTodayTons = document.getElementById('kpi-today-tons');
            if (elTodayTons) elTodayTons.innerText = todayFactTons.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1});
            const elTodaySheets = document.getElementById('kpi-today-sheets');
            if (elTodaySheets) elTodaySheets.innerText = `${todayFactSheets.toLocaleString()} листов`;

            const elTodayPlanTons = document.getElementById('kpi-today-plan-tons');
            if (elTodayPlanTons) elTodayPlanTons.innerText = todayPlanTons.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1});
            const elTodayPlanSheets = document.getElementById('kpi-today-plan-sheets');
            if (elTodayPlanSheets) elTodayPlanSheets.innerText = `${todayPlanSheets.toLocaleString()} листов`;

            const elDiffTons = document.getElementById('kpi-today-diff-tons');
            const elDiffTonsDetail = document.getElementById('kpi-today-diff-tons-detail');
            if (elDiffTons) {
                if (diffTons > 0.05) {
                    elDiffTons.innerText = `+${diffTons.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}`;
                    elDiffTons.style.color = '#22c55e';
                    if (elDiffTonsDetail) elDiffTonsDetail.innerText = 'Перевыполнение плана!';
                } else if (diffTons < -0.05) {
                    elDiffTons.innerText = diffTons.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1});
                    elDiffTons.style.color = '#8b5cf6';
                    if (elDiffTonsDetail) elDiffTonsDetail.innerText = 'Отставание от плана';
                } else {
                    elDiffTons.innerText = '0.0';
                    elDiffTons.style.color = '#22c55e';
                    if (elDiffTonsDetail) elDiffTonsDetail.innerText = 'В норме';
                }
            }

            const elDiffSheets = document.getElementById('kpi-today-diff-sheets');
            const elDiffSheetsDetail = document.getElementById('kpi-today-diff-sheets-detail');
            if (elDiffSheets) {
                if (diffSheets > 0) {
                    elDiffSheets.innerText = `+${diffSheets.toLocaleString()}`;
                    elDiffSheets.style.color = '#22c55e';
                    if (elDiffSheetsDetail) elDiffSheetsDetail.innerText = 'Перевыполнение плана!';
                } else if (diffSheets < 0) {
                    elDiffSheets.innerText = diffSheets.toLocaleString();
                    elDiffSheets.style.color = '#8b5cf6';
                    if (elDiffSheetsDetail) elDiffSheetsDetail.innerText = 'Отставание от плана';
                } else {
                    elDiffSheets.innerText = '0';
                    elDiffSheets.style.color = '#22c55e';
                    if (elDiffSheetsDetail) elDiffSheetsDetail.innerText = 'В норме';
                }
            }

            // Set Total Month KPIs
            document.getElementById('kpi-total-sheets').innerText = data.total_fact_sheets.toLocaleString();
            document.getElementById('kpi-total-tons').innerText = data.total_fact_tons.toFixed(1);
            const tonsDetailEl = document.getElementById('kpi-tons-detail');
            if (tonsDetailEl) {
                tonsDetailEl.innerText = `План: ${(data.total_plan_tons || 0).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})} / Факт: ${(data.total_fact_tons || 0).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}`;
            }

            const lagSheetsEl = document.getElementById('kpi-lag-sheets');
            const lagSheetsDetailEl = document.getElementById('kpi-lag-sheets-detail');
            if (lagSheetsEl) {
                const lagS = data.lag_sheets || 0;
                if (lagS > 0) {
                    lagSheetsEl.innerText = lagS.toLocaleString();
                    lagSheetsEl.style.color = '#8b5cf6';
                    if (lagSheetsDetailEl) lagSheetsDetailEl.innerText = 'Недовыполнение';
                } else if (lagS < 0) {
                    lagSheetsEl.innerText = '0';
                    lagSheetsEl.style.color = '#22c55e';
                    if (lagSheetsDetailEl) lagSheetsDetailEl.innerText = `Перевыполнение: +${Math.abs(lagS).toLocaleString()}`;
                } else {
                    lagSheetsEl.innerText = '0';
                    lagSheetsEl.style.color = '#22c55e';
                    if (lagSheetsDetailEl) lagSheetsDetailEl.innerText = 'План выполнен';
                }
            }

            const lagTonsEl = document.getElementById('kpi-lag-tons');
            const lagTonsDetailEl = document.getElementById('kpi-lag-tons-detail');
            if (lagTonsEl) {
                const lagT = data.lag_tons || 0;
                if (lagT > 0) {
                    lagTonsEl.innerText = lagT.toFixed(1);
                    lagTonsEl.style.color = '#8b5cf6';
                    if (lagTonsDetailEl) lagTonsDetailEl.innerText = 'Недовыполнение';
                } else if (lagT < 0) {
                    lagTonsEl.innerText = '0.0';
                    lagTonsEl.style.color = '#22c55e';
                    if (lagTonsDetailEl) lagTonsDetailEl.innerText = `Перевыполнение: +${Math.abs(lagT).toFixed(1)} т`;
                } else {
                    lagTonsEl.innerText = '0.0';
                    lagTonsEl.style.color = '#22c55e';
                    if (lagTonsDetailEl) lagTonsDetailEl.innerText = 'План выполнен';
                }
            }

            document.getElementById('kpi-avg-plan-percent').innerText = Math.round(data.avg_plan_percent) + '%';
            document.getElementById('kpi-plan-fact-detail').innerText = `План: ${(data.total_plan_sheets || 0).toLocaleString()} / Факт: ${(data.total_fact_sheets || 0).toLocaleString()}`;
            
            const firstGradePercentEl = document.getElementById('kpi-first-grade-percent');
            if (firstGradePercentEl) firstGradePercentEl.innerText = (data.first_grade_percent || 0).toFixed(2) + '%';
            const firstGradeDetailEl = document.getElementById('kpi-first-grade-detail');
            if (firstGradeDetailEl) firstGradeDetailEl.innerText = `1 сорт: ${(data.total_first_grade || 0).toLocaleString()} листов`;

            document.getElementById('kpi-defect-percent').innerText = (data.defect_percent || 0).toFixed(2) + '%';
            document.getElementById('kpi-defect-detail').innerText = `Брак: ${(data.total_defect || 0).toLocaleString()} листов`;

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

    // Two-line compact label: line 1 = day of month (e.g. "01"), line 2 = shift type ("Д" or "Н")
    const labels = days.map(d => {
        const parts = (d.date || '').split('-');
        const dayStr = parts.length === 3 ? parts[2] : '';
        const isDay = d.label && d.label.includes('(Д)');
        const shiftLetter = isDay ? 'Д' : 'Н';
        return [dayStr, shiftLetter];
    });
    
    // Determine bar colors dynamically: Green for Plan Met, Red for Plan Not Met
    const sheetsColors = days.map(d => {
        const met = d.fact_sheets >= d.plan_sheets;
        if (met && d.fact_sheets > 0) return '#22c55e'; // Green if plan is met
        return '#ef4444'; // Red if plan is not met
    });

    const tonsColors = days.map(d => {
        const met = d.fact_tons >= d.plan_tons;
        if (met && d.fact_tons > 0) return '#22c55e'; // Green if plan is met
        return '#ef4444'; // Red if plan is not met
    });

    const commonPlugins = {
        legend: {
            labels: {
                color: textCol,
                font: { size: 12 },
                generateLabels: function(chart) {
                    return [
                        { text: 'Факт (выполнение)', fillStyle: '#22c55e', strokeStyle: '#22c55e', lineWidth: 1 },
                        { text: 'Факт (невыполнение)', fillStyle: '#ef4444', strokeStyle: '#ef4444', lineWidth: 1 },
                        { text: 'План День (2700)', fillStyle: '#ffc107', strokeStyle: '#ffc107', lineWidth: 2 },
                        { text: 'План Ночь (3300)', fillStyle: '#8b5cf6', strokeStyle: '#8b5cf6', lineWidth: 2 }
                    ];
                }
            }
        },
        tooltip: {
            callbacks: {
                title: function(context) {
                    const idx = context[0].dataIndex;
                    const d = days[idx];
                    const shiftName = (d.label && d.label.includes('(Д)')) ? 'День' : 'Ночь';
                    return `📅 ${d.date} — Смена: ${shiftName}`;
                }
            }
        }
    };

    const commonXScale = {
        grid: {
            display: true,
            color: function(context) {
                // Thicker/darker grid line between pairs of days (every 2 shifts)
                if (context.index % 2 === 0) {
                    return isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)';
                }
                return 'transparent';
            }
        },
        ticks: {
            color: textCol,
            autoSkip: false, // Ensure EVERY single shift label (all 62) is rendered!
            maxRotation: 0,
            minRotation: 0,
            font: {
                size: 10,
                weight: function(context) {
                    // Bold shift letter
                    return '600';
                }
            },
            padding: 2
        }
    };

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
                    borderWidth: 1,
                    categoryPercentage: 0.92,
                    barPercentage: 0.95
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
                    borderColor: '#8b5cf6', // Purple / Violet
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
            plugins: commonPlugins,
            scales: {
                x: commonXScale,
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
                    borderWidth: 1,
                    categoryPercentage: 0.92,
                    barPercentage: 0.95
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
                    borderColor: '#8b5cf6', // Purple / Violet
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
                ...commonPlugins,
                legend: {
                    labels: {
                        color: textCol,
                        font: { size: 12 },
                        generateLabels: function(chart) {
                            return [
                                { text: 'Факт (выполнение)', fillStyle: '#22c55e', strokeStyle: '#22c55e', lineWidth: 1 },
                                { text: 'Факт (невыполнение)', fillStyle: '#ef4444', strokeStyle: '#ef4444', lineWidth: 1 },
                                { text: 'План День (52.9 т)', fillStyle: '#ffc107', strokeStyle: '#ffc107', lineWidth: 2 },
                                { text: 'План Ночь (64.7 т)', fillStyle: '#8b5cf6', strokeStyle: '#8b5cf6', lineWidth: 2 }
                            ];
                        }
                    }
                }
            },
            scales: {
                x: commonXScale,
                y: { ticks: { color: textCol } }
            }
        }
    });
}

function exportDailyReportPDF() {
    const rangeType = document.getElementById('daily-report-range-type')?.value || 'month';
    const titleText = rangeType === 'week' ? "Недельная сводка выработки" : "Месячная сводка выработки";
    const monthVal = document.getElementById('daily-report-month')?.value || "";

    // Get line readable label
    const lineSelect = document.getElementById('daily-report-line');
    let lineLabel = lineSelect ? lineSelect.options[lineSelect.selectedIndex]?.text : "Все линии";
    if (lineLabel.includes('ЛФМ-1')) lineLabel = 'ЛФМ-1';
    else if (lineLabel.includes('ЛФМ-2')) lineLabel = 'ЛФМ-2';

    // Format readable period range
    const weekSelect = document.getElementById('daily-report-week-select');
    let periodLabel = monthVal;

    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    if (rangeType === 'week' && weekSelect && weekSelect.selectedIndex >= 0) {
        const optText = weekSelect.options[weekSelect.selectedIndex]?.text || '';
        const match = optText.match(/\((.*?)\)/);
        if (match) {
            periodLabel = `с ${match[1].replace(' - ', ' по ')}`;
        } else {
            periodLabel = optText;
        }
    } else if (monthVal) {
        const parts = monthVal.split('-');
        if (parts.length === 2) {
            const yr = parseInt(parts[0]);
            const mo = parseInt(parts[1]);
            const moStr = String(mo).padStart(2, '0');

            if (monthVal === currentYearMonth) {
                const todayDay = String(now.getDate()).padStart(2, '0');
                periodLabel = `с 01.${moStr} по ${todayDay}.${moStr}.${yr}`;
            } else {
                const lastDay = new Date(yr, mo, 0).getDate();
                const lastDayStr = String(lastDay).padStart(2, '0');
                periodLabel = `с 01.${moStr} по ${lastDayStr}.${moStr}.${yr}`;
            }
        }
    }

    const kpiSheets = document.getElementById('kpi-total-sheets')?.innerText || "0";
    const kpiTons = document.getElementById('kpi-total-tons')?.innerText || "0.0";
    const kpiTonsDetail = document.getElementById('kpi-tons-detail')?.innerText || "";
    const kpiLagSheets = document.getElementById('kpi-lag-sheets')?.innerText || "0";
    const kpiLagSheetsDetail = document.getElementById('kpi-lag-sheets-detail')?.innerText || "";
    const kpiLagTons = document.getElementById('kpi-lag-tons')?.innerText || "0.0";
    const kpiLagTonsDetail = document.getElementById('kpi-lag-tons-detail')?.innerText || "";
    const kpiAvgPlan = document.getElementById('kpi-avg-plan-percent')?.innerText || "0%";
    const kpiPlanDetail = document.getElementById('kpi-plan-fact-detail')?.innerText || "";
    const kpiFirstGrade = document.getElementById('kpi-first-grade-percent')?.innerText || "0.00%";
    const kpiFirstGradeDetail = document.getElementById('kpi-first-grade-detail')?.innerText || "";
    const kpiDefect = document.getElementById('kpi-defect-percent')?.innerText || "0.00%";
    const kpiDefectDetail = document.getElementById('kpi-defect-detail')?.innerText || "";

    // Today / MTD KPIs
    const kpiTodayTons = document.getElementById('kpi-today-tons')?.innerText || "0.0";
    const kpiTodaySheets = document.getElementById('kpi-today-sheets')?.innerText || "";
    const kpiTodayPlanTons = document.getElementById('kpi-today-plan-tons')?.innerText || "0.0";
    const kpiTodayPlanSheets = document.getElementById('kpi-today-plan-sheets')?.innerText || "";
    const kpiTodayDiffTons = document.getElementById('kpi-today-diff-tons')?.innerText || "0.0";
    const kpiTodayDiffTonsDetail = document.getElementById('kpi-today-diff-tons-detail')?.innerText || "";
    const kpiTodayDiffSheets = document.getElementById('kpi-today-diff-sheets')?.innerText || "0";
    const kpiTodayDiffSheetsDetail = document.getElementById('kpi-today-diff-sheets-detail')?.innerText || "";

    // Prepare a high-resolution canvas for print quality
    const cw = 1600;
    const ch = 1131; // 1600 / 1.414 (A4 landscape ratio)
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    
    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    
    // Header
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 38px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(titleText, cw / 2, 80);
    
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 22px Arial';
    ctx.fillText(`Линия: ${lineLabel}   |   Период: ${periodLabel}`, cw / 2, 120);
    
    // Draw horizontal line
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, 140);
    ctx.lineTo(cw - 80, 140);
    ctx.stroke();
    
    // Row 1: Today MTD KPIs
    ctx.textAlign = 'left';
    ctx.fillStyle = '#16a34a';
    ctx.font = 'bold 20px Arial';
    ctx.fillText("ФАКТИЧЕСКИЕ ПОКАЗАТЕЛИ НА ТЕКУЩУЮ ДАТУ", 80, 175);

    const todayKpis = [
        { label: "Выработка (Тонны)", val: kpiTodayTons, color: '#16a34a', subtext: kpiTodaySheets },
        { label: "План на сегодня (Тонны)", val: kpiTodayPlanTons, color: '#2563eb', subtext: kpiTodayPlanSheets },
        { label: "Отклонение (Тонны)", val: kpiTodayDiffTons, color: '#ca8a04', subtext: kpiTodayDiffTonsDetail },
        { label: "Отклонение (Листы)", val: kpiTodayDiffSheets, color: '#7c3aed', subtext: kpiTodayDiffSheetsDetail }
    ];
    
    const todayW = (cw - 160) / 4;
    todayKpis.forEach((k, idx) => {
        const x = 80 + idx * todayW;
        const y = 190;
        const cardW = todayW - 20;
        const cardX = x + 10;
        ctx.fillStyle = '#f0fdf4';
        ctx.fillRect(cardX, y, cardW, 110);
        ctx.strokeStyle = '#bbf7d0';
        ctx.lineWidth = 1;
        ctx.strokeRect(cardX, y, cardW, 110);
        
        ctx.textAlign = 'center';
        ctx.fillStyle = '#334155';
        ctx.font = 'bold 18px Arial';
        ctx.fillText(k.label, x + todayW / 2, y + 30);
        
        ctx.fillStyle = k.color;
        ctx.font = 'bold 30px Arial';
        ctx.fillText(k.val, x + todayW / 2, y + 70);
        
        if (k.subtext) {
            ctx.fillStyle = '#000000';
            ctx.font = 'bold 14px Arial';
            ctx.fillText(k.subtext, x + todayW / 2, y + 96);
        }
    });

    // Row 2: Month / Period Total KPIs
    ctx.textAlign = 'left';
    ctx.fillStyle = '#2563eb';
    ctx.font = 'bold 20px Arial';
    ctx.fillText("ИТОГОВЫЕ ПРОГНОЗНЫЕ ПОКАЗАТЕЛИ ЗА ВЕСЬ ПЕРИОД", 80, 335);

    const kpis = [
        { label: "Выработка (Листы)", val: kpiSheets, color: '#2563eb', subtext: "" },
        { label: "Выработка (Тонны)", val: kpiTons, color: '#059669', subtext: kpiTonsDetail },
        { label: "Остаток (Листы)", val: kpiLagSheets, color: '#7c3aed', subtext: kpiLagSheetsDetail },
        { label: "Остаток (Тонны)", val: kpiLagTons, color: '#6366f1', subtext: kpiLagTonsDetail },
        { label: "Ср. % плана", val: kpiAvgPlan, color: '#d97706', subtext: kpiPlanDetail },
        { label: "% 1-го сорта", val: kpiFirstGrade, color: '#16a34a', subtext: kpiFirstGradeDetail },
        { label: "% брака", val: kpiDefect, color: '#dc2626', subtext: kpiDefectDetail }
    ];
    
    const kpiW = (cw - 160) / 7;
    kpis.forEach((k, idx) => {
        const x = 80 + idx * kpiW;
        const y = 350;
        
        const cardW = kpiW - 14;
        const cardX = x + 7;
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(cardX, y, cardW, 110);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.strokeRect(cardX, y, cardW, 110);
        
        ctx.textAlign = 'center';
        ctx.fillStyle = '#334155';
        ctx.font = 'bold 16px Arial';
        ctx.fillText(k.label, x + kpiW / 2, y + 28);
        
        ctx.fillStyle = k.color;
        ctx.font = 'bold 26px Arial';
        ctx.fillText(k.val, x + kpiW / 2, y + 68);
        
        if (k.subtext) {
            ctx.fillStyle = '#000000'; // Pure black, bold subtext for perfect print visibility
            ctx.font = 'bold 13px Arial';
            ctx.fillText(k.subtext, x + kpiW / 2, y + 95);
        }
    });
    
    // Draw chart if exists
    if (chartDailySheets) {
        const chartImgSrc = chartDailySheets.canvas;
        const chartW = cw - 160;
        const chartH = Math.min(560, chartImgSrc.height * (chartW / chartImgSrc.width));
        
        const tmp = document.createElement('canvas');
        tmp.width = chartImgSrc.width;
        tmp.height = chartImgSrc.height;
        const tmpCtx = tmp.getContext('2d');
        tmpCtx.fillStyle = 'white';
        tmpCtx.fillRect(0, 0, tmp.width, tmp.height);
        tmpCtx.drawImage(chartImgSrc, 0, 0);
        
        ctx.drawImage(tmp, 80, 490, chartW, chartH);
    } else {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#94a3b8';
        ctx.font = '24px Arial';
        ctx.fillText("График не найден", cw / 2, 700);
    }
    
    // Footer
    ctx.textAlign = 'center';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px Arial';
    ctx.fillText(`Сгенерировано автоматически порталом Tectum. Дата экспорта: ${new Date().toLocaleString()}`, cw / 2, ch - 50);
    
    // Open standard Print / Microsoft PDF dialog
    const imgDataUrl = canvas.toDataURL('image/png');
    const printWindow = window.open('', '_blank');
    if (printWindow) {
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${titleText} - ${lineLabel} - ${periodLabel}</title>
                <style>
                    @page {
                        size: A4 landscape;
                        margin: 0;
                    }
                    html, body {
                        margin: 0;
                        padding: 0;
                        background: #ffffff;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        width: 100%;
                        height: 100vh;
                        overflow: hidden;
                    }
                    img {
                        width: 100vw;
                        height: 100vh;
                        object-fit: contain;
                    }
                </style>
            </head>
            <body>
                <img src="${imgDataUrl}" onload="window.print(); window.onafterprint = function(){ window.close(); };" />
            </body>
            </html>
        `);
        printWindow.document.close();
    } else {
        // Fallback to jsPDF direct download if popup blocker is active
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        doc.addImage(imgDataUrl, 'PNG', 0, 0, 297, 210);
        doc.save(`Tectum_Report_${monthVal}.pdf`);
    }
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

// --- Auto-Save Draft Logic ---
const REPORT_FIELDS = [
    'rep-date', 'rep-shift', 'rep-line', 'rep-master', 'rep-batch', 'rep-product', 'rep-export-type',
    'rep-sheets', 'rep-resets', 'rep-batches', 'rep-warehouse-gp', 'rep-first-grade',
    'rep-has-defect', 'def-chip', 'def-scratch', 'def-bad-cut', 'def-stick-bottom',
    'def-stick-top', 'def-broken', 'def-fell', 'def-dent', 'def-thickness',
    'def-delamination', 'def-edge', 'rep-qcd-defect',
    'zo-chr-4-20', 'zo-chr-5-65', 'zo-chr-6-40', 'zo-cem-1', 'zo-cem-2', 'zo-cem-3', 'zo-cem-4',
    'zo-cellulose', 'zo-crushed-slate', 'zo-asbozurit', 'zo-fiberglass', 'zo-laprol',
    'zo-asbocarton', 'zo-asb-drain', 'zo-cem-drain',
    
    // Calculator inputs for draft saving
    'calc-chr-4-20-1', 'calc-chr-4-20-2', 'calc-chr-4-20-3', 'calc-chr-4-20-4',
    'calc-chr-5-65-1', 'calc-chr-5-65-2', 'calc-chr-5-65-3', 'calc-chr-5-65-4',
    'calc-chr-6-40-1', 'calc-chr-6-40-2', 'calc-chr-6-40-3', 'calc-chr-6-40-4',
    'calc-cem-1', 'calc-cem-2', 'calc-cem-3', 'calc-cem-4',
    'calc-cellulose-1', 'calc-cellulose-2', 'calc-cellulose-3', 'calc-cellulose-4',
    'calc-crushed-slate-1', 'calc-crushed-slate-2', 'calc-crushed-slate-3', 'calc-crushed-slate-4',
    'calc-asbozurit-1', 'calc-asbozurit-2', 'calc-asbozurit-3', 'calc-asbozurit-4',
    'calc-fiberglass-1', 'calc-fiberglass-2', 'calc-fiberglass-3', 'calc-fiberglass-4',
    'calc-laprol-1', 'calc-laprol-2', 'calc-laprol-3', 'calc-laprol-4',
    'calc-asbocarton-1', 'calc-asbocarton-2', 'calc-asbocarton-3', 'calc-asbocarton-4'
];

let draftSaveTimeout = null;

function saveReportDraft() {
    const draft = {};
    REPORT_FIELDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            draft[id] = el.value;
        }
    });
    localStorage.setItem('shift_report_draft', JSON.stringify(draft));
    
    const indicator = document.getElementById('draft-indicator');
    if (indicator) {
        indicator.textContent = '✓ Черновик сохранен локально';
        indicator.style.opacity = '1';
        clearTimeout(draftSaveTimeout);
        draftSaveTimeout = setTimeout(() => {
            indicator.style.opacity = '0';
        }, 2000);
    }
}

function loadReportDraft() {
    const saved = localStorage.getItem('shift_report_draft');
    if (saved) {
        try {
            const draft = JSON.parse(saved);
            let hasData = false;
            REPORT_FIELDS.forEach(id => {
                const el = document.getElementById(id);
                if (el && draft[id] !== undefined && draft[id] !== '') {
                    el.value = draft[id];
                    hasData = true;
                }
            });
            if (hasData) {
                if (typeof recalcTonsAndGrades === 'function') recalcTonsAndGrades();
                if (typeof recalcDefectTotal === 'function') recalcDefectTotal();
                if (typeof toggleDefectsGrid === 'function') toggleDefectsGrid();
                if (typeof window.updateLineSiloHeaders === 'function') window.updateLineSiloHeaders();
                
                const indicator = document.getElementById('draft-indicator');
                if (indicator) {
                    indicator.textContent = '✓ Черновик восстановлен';
                    indicator.style.opacity = '1';
                    setTimeout(() => {
                        indicator.style.opacity = '0';
                    }, 3000);
                }
            }
        } catch (e) {
            console.error("Error loading draft", e);
        }
    }
}

function clearReportDraft() {
    localStorage.removeItem('shift_report_draft');
}

function attachDraftListeners() {
    REPORT_FIELDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', saveReportDraft);
            el.addEventListener('change', saveReportDraft);
        }
    });
}

// --- Downtime Draft Logic ---
const DOWNTIME_CONTEXT_FIELDS = [
    'journal-dt-date', 'journal-dt-shift-name', 'journal-dt-line', 'journal-dt-master-select'
];

function saveDowntimeContext() {
    const context = {};
    DOWNTIME_CONTEXT_FIELDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            context[id] = el.value;
        }
    });
    localStorage.setItem('downtime_context', JSON.stringify(context));
}

function loadDowntimeContext() {
    const saved = localStorage.getItem('downtime_context');
    if (saved) {
        try {
            const context = JSON.parse(saved);
            DOWNTIME_CONTEXT_FIELDS.forEach(id => {
                const el = document.getElementById(id);
                if (el && context[id] !== undefined && context[id] !== '') {
                    el.value = context[id];
                }
            });
            if (typeof loadDowntimesByParams === 'function') {
                loadDowntimesByParams();
            }
        } catch (e) {
            console.error("Error loading downtime context", e);
        }
    }
}

function attachDowntimeContextListeners() {
    DOWNTIME_CONTEXT_FIELDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', saveDowntimeContext);
            el.addEventListener('change', saveDowntimeContext);
        }
    });
}
// ------------------------------

// Window load init
window.addEventListener('DOMContentLoaded', () => {
    // Current date default for month picker
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dailyMonthEl = document.getElementById('daily-report-month');
    if (dailyMonthEl) {
        dailyMonthEl.value = yearMonth;
        updateWeekOptions(yearMonth, 'daily-report-week-select');
    }
    const summaryMonthEl = document.getElementById('summary-filter-month');
    if (summaryMonthEl) {
        if (!summaryMonthEl.value) summaryMonthEl.value = yearMonth;
        updateWeekOptions(summaryMonthEl.value, 'summary-filter-week');
    }

    init().then(() => {
        attachDraftListeners();
        loadReportDraft();
        attachDowntimeContextListeners();
        loadDowntimeContext();
    });
});

async function init() {
    initTheme();
    setupTimePickers();
    restoreLastLineAndShift();
    
    document.getElementById('rep-shift')?.addEventListener('change', onProductChange);
    document.getElementById('rep-line')?.addEventListener('change', onProductChange);
    document.getElementById('rep-product')?.addEventListener('change', onProductChange);
    document.getElementById('rep-export-type')?.addEventListener('change', onProductChange);
    document.getElementById('rep-batch')?.addEventListener('change', onProductChange);
    document.getElementById('rep-batch')?.addEventListener('blur', onProductChange);
    
    // 1. Instant Cache-First Auth Check: render main-app instantly without login screen flicker
    let cachedUser = window.__cachedUser;
    if (!cachedUser) {
        try {
            const raw = localStorage.getItem('tectum_auth_user');
            if (raw) cachedUser = JSON.parse(raw);
        } catch(e) {}
    }

    if (cachedUser && cachedUser.name && cachedUser.role) {
        currentUser = cachedUser;
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';
        document.getElementById('user-info-container').style.display = 'flex';
        document.getElementById('user-greeting-name').innerText = currentUser.name;
        document.getElementById('user-greeting-role').innerText = currentUser.role;
        applyRoleVisibility();
    }

    // 2. Validate session with server in background
    try {
        const res = await fetch('/api/me/');
        if (res.ok) {
            const data = await res.json();
            if (data.authenticated) {
                currentUser = data.user;
                try {
                    localStorage.setItem('tectum_auth_user', JSON.stringify(currentUser));
                } catch(e) {}
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
        
        // If server says not authenticated and we had cached user, reset
        if (cachedUser) {
            try {
                localStorage.removeItem('tectum_auth_user');
                localStorage.removeItem('tectum_portal_user');
            } catch(e) {}
            currentUser = null;
            document.getElementById('user-info-container').style.display = 'none';
            document.getElementById('main-app').style.display = 'none';
            document.getElementById('login-screen').style.display = 'block';
        }
        
        await loadUserGrid();
    } catch(e) {
        console.error("Init error:", e);
        if (currentUser) {
            // Offline/transient error: allow cached session to work
            await loadData();
        } else {
            await loadUserGrid();
        }
    }
}

async function loadUserGrid() {
    try {
        const gridRes = await fetch('/api/masters/');
        if (gridRes.ok) {
            window.allMastersData = await gridRes.json();
            renderMainScreenGrid();
        }
    } catch(e) {
        console.error("Error loading user grid:", e);
    }
}

function renderMainScreenGrid() {
    const grid = document.getElementById('user-grid');
    if (!grid) return;
    
    const titleEl = document.getElementById('selection-title');
    if (titleEl) titleEl.innerText = 'Выберите раздел';
    
    const backBtn = document.getElementById('back-to-main-container');
    if (backBtn) backBtn.style.display = 'none';

    const svgMaster = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
        <path d="M9 14l2 2 4-4"></path>
    </svg>`;
    
    const svgITR = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>`;
    
    const svgDocs = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
    </svg>`;
    
    const svgChecklists = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
    </svg>`;

    const svgTasks = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9"></path>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
    </svg>`;

    grid.innerHTML = 
        createCardHTML('Кабинет мастера', 'Производство', svgMaster, "selectUser('Мастер смены', 'Мастер')") +
        createCardHTML('Планнер задач', 'Бережливое производство', svgTasks, null, '/static/tasks.html') +
        createCardHTML('Кабинет чек-листов', 'Смены и ТО', svgChecklists, null, '/static/checklists.html') +
        createCardHTML('База знаний', 'Документация', svgDocs, null, '/static/docs.html') +
        createCardHTML('ИТР персонал', 'Сотрудники', svgITR, "renderItrGrid()");
}

function renderItrGrid() {
    const grid = document.getElementById('user-grid');
    if (!grid || !window.allMastersData) return;
    
    const titleEl = document.getElementById('selection-title');
    if (titleEl) titleEl.innerText = 'Выберите ваш профиль';
    
    const backBtn = document.getElementById('back-to-main-container');
    if (backBtn) backBtn.style.display = 'block';

    const filteredMasters = window.allMastersData.filter(m => 
        ['admin', 'director', 'technologist', 'mechanic'].includes(m.role) || m.name.includes("Левда") || m.name.includes("Булеханов")
    );
    
    grid.innerHTML = filteredMasters.map(m => {
        let roleDisplay = m.role;
        let svgContent = '';
        
        if (m.name.includes("Левда")) {
            roleDisplay = 'Администратор';
            svgContent = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>`;
        } else if (m.name.includes("Булеханов") || m.name.includes("Булекпаев")) {
            roleDisplay = 'Начальник производства';
            svgContent = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>`;
        } else if (m.role === 'admin') {
            roleDisplay = 'Администратор';
            svgContent = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>`;
        } else if (m.role === 'director') {
            roleDisplay = 'Директор';
            svgContent = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>`;
        } else if (m.role === 'technologist') {
            roleDisplay = 'Технолог';
            svgContent = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 2h4M12 2v8M18 16.6L13.5 9V4h-3v5L6 16.6C5.1 18.1 6.2 20 8 20h8c1.8 0 2.9-1.9 2-3.4z"></path>
            </svg>`;
        } else if (m.role === 'mechanic') {
            roleDisplay = 'Механик';
            svgContent = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
            </svg>`;
        } else {
            svgContent = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
            </svg>`;
        }
        
        return createCardHTML(m.name, roleDisplay, svgContent, `selectUser('${m.name}', '${roleDisplay}')`);
    }).join('');
}

function createCardHTML(title, subtitle, svgContent, onClickCode, href = null) {
    const gradient = 'linear-gradient(135deg, var(--primary-color) 0%, var(--accent-color) 100%)';
    const shadowColor = 'rgba(200, 35, 35, 0.3)';
    
    if (href) {
        return `
            <a href="${href}" class="user-card glass-panel" style="text-decoration: none; cursor: pointer; padding: 1.2rem 0.8rem; text-align: center; border: 1px solid var(--border-color); border-radius: 12px; transition: 0.2s; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 0; box-sizing: border-box;">
                <div class="user-avatar-gradient" style="background: ${gradient}; width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.2rem; box-shadow: 0 4px 15px ${shadowColor}; flex-shrink: 0;">
                    ${svgContent}
                </div>
                <div style="font-weight: bold; font-size: 0.95rem; color: var(--text-primary); margin-bottom: 0.4rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; width: 100%;">${title}</div>
                <div style="font-size: 0.72rem; color: var(--accent-color); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; width: 100%;">${subtitle}</div>
            </a>
        `;
    }
    
    return `
        <div class="user-card glass-panel" onclick="${onClickCode}" style="cursor: pointer; padding: 1.2rem 0.8rem; text-align: center; border: 1px solid var(--border-color); border-radius: 12px; transition: 0.2s; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 0; box-sizing: border-box;">
            <div class="user-avatar-gradient" style="background: ${gradient}; width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.2rem; box-shadow: 0 4px 15px ${shadowColor}; flex-shrink: 0;">
                ${svgContent}
            </div>
            <div style="font-weight: bold; font-size: 0.95rem; color: var(--text-primary); margin-bottom: 0.4rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; width: 100%;">${title}</div>
            <div style="font-size: 0.72rem; color: var(--accent-color); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; width: 100%;">${subtitle}</div>
        </div>
    `;
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
            renderPlanBoard();
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
        master_id: parseInt(master_id) || null,
        chrysotile_4_20: (parseFloat(document.getElementById('rec-chr-4-20').value) || 0.0) * 50,
        chrysotile_5_65: (parseFloat(document.getElementById('rec-chr-5-65').value) || 0.0) * 50,
        chrysotile_6_40: (parseFloat(document.getElementById('rec-chr-6-40').value) || 0.0) * 50,
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
        laprol: (parseFloat(document.getElementById('rec-laprol').value) || 0.0) * 200
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
            saveLastLineAndShift(line, shift_name);
            // Clear fields
            ['rec-chr-4-20', 'rec-chr-5-65', 'rec-chr-6-40', 'rec-cement-1', 'rec-cement-2', 'rec-cement-3', 'rec-cement-4', 'rec-cellulose', 'rec-crushed-slate', 'rec-asbozurit', 'rec-asbocarton', 'rec-pallets', 'rec-fiberglass', 'rec-laprol'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            loadReceipts(shift);
            showNotification('success', 'Отлично!', 'Приход сырья успешно сохранен в облако.');
        } else {
            const err = await res.json();
            showNotification('error', 'Ошибка сохранения', err.detail || 'Неизвестная ошибка');
        }
    } catch(e) {
        showNotification('error', 'Сетевая ошибка', e.message);
    } finally {
        setButtonLoading('btn-submit-receipt', false);
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

// ------------------------------------------------
// DYNAMIC BREAKDOWNS LOGIC
// ------------------------------------------------
let breakdownRowCounter = 0;

async function addJournalBreakdownRow(initialData = null) {
    await addBreakdownRowInternal('journal-dt', initialData);
}

async function addEditBreakdownRow(initialData = null) {
    await addBreakdownRowInternal('edit-dt', initialData);
}

async function addBreakdownRowInternal(prefix, initialData = null) {
    const container = document.getElementById(`${prefix}-breakdowns-container`);
    if (!container) return;
    
    const rowId = breakdownRowCounter++;
    
    const rowHtml = `
        <div class="breakdown-row" id="${prefix}-brk-row-${rowId}" style="border: 1px solid var(--glass-border); padding: 1rem; border-radius: 8px; background: rgba(255,255,255,0.02); position: relative;">
            <button type="button" class="btn-danger" onclick="this.parentElement.remove()" style="position: absolute; top: 0.5rem; right: 0.5rem; width: auto; padding: 0.2rem 0.6rem; font-size: 0.7rem; cursor: pointer; border: none; border-radius: 4px;">Удалить</button>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 0.5rem; padding-right: 3rem;">
                <div>
                    <label style="font-size: 0.8rem; color: var(--text-secondary);">Участок / Отделение</label>
                    <select class="brk-dept" onchange="onBrkDeptChange(this, '${prefix}')" style="margin-bottom:0;">
                        <option value="">-- Выберите участок --</option>
                    </select>
                </div>
                <div>
                    <label style="font-size: 0.8rem; color: var(--text-secondary);">Узел / Оборудование</label>
                    <select class="brk-node" onchange="onBrkNodeChange(this, '${prefix}')" style="margin-bottom:0;">
                        <option value="">-- Сначала выберите участок --</option>
                    </select>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div>
                    <label style="font-size: 0.8rem; color: var(--text-secondary);">Поломка / Причина</label>
                    <select class="brk-desc" onchange="onBrkDescChange(this)" style="margin-bottom:0;">
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
    
    const rowDiv = document.getElementById(`${prefix}-brk-row-${rowId}`);
    const deptSelect = rowDiv.querySelector('.brk-dept');
    
    try {
        const res = await fetch('/api/downtimes/directory/departments');
        if (res.ok) {
            const depts = await res.json();
            depts.sort((a, b) => a.localeCompare(b));
            deptSelect.innerHTML = '<option value="">-- Выберите участок --</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
            
            if (initialData && initialData.department) {
                deptSelect.value = initialData.department;
                await onBrkDeptChange(deptSelect, prefix, initialData.node, initialData.description);
                if (initialData.category) {
                    rowDiv.querySelector('.brk-category').value = initialData.category;
                }
            }
        }
    } catch(e) {
        console.error(e);
    }
}

async function onBrkDeptChange(selectElement, prefix, initialNode = null, initialDesc = null) {
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
                await onBrkNodeChange(selectNode, prefix, initialDesc);
            }
        }
    } catch(e) {
        console.error(e);
    }
}

async function onBrkNodeChange(selectElement, prefix, initialDesc = null) {
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
                onBrkDescChange(selectBk);
            }
        }
    } catch(e) {
        console.error(e);
    }
}

function onBrkDescChange(selectElement) {
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

// Clear '0' on focus and restore on blur for number inputs
document.addEventListener('focusin', function(e) {
    if (e.target.tagName === 'INPUT' && e.target.type === 'number') {
        if (e.target.value === '0') {
            e.target.value = '';
        }
    }
});

document.addEventListener('focusout', function(e) {
    if (e.target.tagName === 'INPUT' && e.target.type === 'number') {
        if (e.target.value === '') {
            e.target.value = '0';
            // Dispatch input event to trigger any dependent calculations
            e.target.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
});

// ==========================================
// CREW PLANS FULFILLMENT TAB LOGIC (🏆)
// ==========================================
let currentCrewPlansData = null;

async function loadCrewPlansFulfillment() {
    const monthInput = document.getElementById('crew-plans-month');
    let month = monthInput ? monthInput.value : '';
    
    if (!month) {
        const now = new Date();
        month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        if (monthInput) monthInput.value = month;
    }

    const tbody = document.getElementById('crew-plans-table-body');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 2rem; color: var(--text-secondary);">⏳ Загрузка данных за ' + month + '...</td></tr>';
    }

    try {
        const res = await fetch(`/api/shifts/crew_plan_fulfillment?month=${encodeURIComponent(month)}`);
        if (!res.ok) throw new Error('Ошибка загрузки данных сводки');
        
        const data = await res.json();
        currentCrewPlansData = data;
        
        renderCrewCards(data.crew_stats, data.factory_summary);
        renderCrewPlansTable();
    } catch (e) {
        console.error("Error loading crew plans:", e);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 2rem; color: var(--danger-color);">❌ Ошибка при загрузке: ${e.message}</td></tr>`;
        }
    }
}

function renderCrewCards(crewStats, factorySummary) {
    const container = document.getElementById('crew-kpi-cards-grid');
    if (!container || !crewStats) return;

    const cardsHtml = [1, 2, 3, 4].map(idx => {
        const st = crewStats[idx] || { name: `Смена №${idx}`, total_shifts: 0, met_count: 0, percent: 0, total_lfm: 0, day_shifts: 0, day_met: 0, night_shifts: 0, night_met: 0 };
        const isLeader = st.met_count > 0;
        
        // Progress color
        let badgeBg = '#f1f5f9';
        let badgeColor = '#475569';
        let badgeBorder = '#cbd5e1';
        if (st.percent >= 70) {
            badgeBg = '#ecfdf5';
            badgeColor = '#047857';
            badgeBorder = '#a7f3d0';
        } else if (st.percent >= 40) {
            badgeBg = '#eff6ff';
            badgeColor = '#1d4ed8';
            badgeBorder = '#bfdbfe';
        } else if (st.total_shifts > 0) {
            badgeBg = '#fff7ed';
            badgeColor = '#c2410c';
            badgeBorder = '#ffedd5';
        }

        return `
            <div style="background: #ffffff; border: 1px solid var(--glass-border); border-radius: 12px; padding: 1.1rem; box-shadow: 0 2px 8px rgba(0,0,0,0.04); position: relative; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem;">
                        <h4 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: #0f172a;">${st.name}</h4>
                        <span style="font-size: 0.8rem; font-weight: 700; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; padding: 3px 8px; border-radius: 6px;">
                            ${st.percent}%
                        </span>
                    </div>
                    <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 0.5rem;">
                        <span style="font-size: 1.7rem; font-weight: 800; color: #0f172a;">${st.met_count}</span>
                        <span style="font-size: 0.9rem; color: var(--text-secondary); font-weight: 600;">из ${st.total_shifts} смен</span>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4; margin-bottom: 0.6rem;">
                        ☀️ День: <strong style="color: #334155;">${st.day_met}/${st.day_shifts}</strong> &nbsp;|&nbsp; 
                        🌙 Ночь: <strong style="color: #334155;">${st.night_met}/${st.night_shifts}</strong>
                    </div>
                </div>
                <div style="border-top: 1px dashed #e2e8f0; padding-top: 0.6rem; font-size: 0.8rem; color: var(--text-secondary); display: flex; justify-content: space-between;">
                    <span>Формовка за месяц:</span>
                    <strong style="color: #0f172a;">${(st.total_lfm || 0).toLocaleString()} шт.</strong>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = cardsHtml;

    // Update Factory summary banner
    if (factorySummary) {
        const badge = document.getElementById('factory-total-met-badge');
        if (badge) {
            badge.innerText = `${factorySummary.total_met} из ${factorySummary.total_shifts} выполнений (${factorySummary.percent}%)`;
        }
        const text = document.getElementById('factory-total-stats-text');
        if (text) {
            text.innerText = `Всего отработано смен: ${factorySummary.total_shifts} | Суммарно отформовано: ${(factorySummary.total_lfm || 0).toLocaleString()} шт.`;
        }
    }
}

function renderCrewPlansTable() {
    const tbody = document.getElementById('crew-plans-table-body');
    if (!tbody || !currentCrewPlansData || !currentCrewPlansData.days) return;

    const filterCrew = document.getElementById('crew-plans-filter-crew')?.value || '';
    const filterStatus = document.getElementById('crew-plans-filter-status')?.value || '';
    const monthInput = document.getElementById('crew-plans-month')?.value || '';

    // Update subtitle for printout
    const subtitleEl = document.getElementById('crew-plans-print-subtitle');
    if (subtitleEl) {
        const crewText = filterCrew ? ` | Бригада: Смена №${filterCrew}` : ' | Все смены (1..4)';
        subtitleEl.innerText = `Отчетный период: ${monthInput}${crewText} | Норма формовки: ☀️ День ≥ 2 700 шт., 🌙 Ночь ≥ 3 300 шт.`;
    }

    let rows = currentCrewPlansData.days;

    if (filterCrew) {
        rows = rows.filter(r => String(r.crew_num) === String(filterCrew));
    }

    if (filterStatus === 'met') {
        rows = rows.filter(r => r.is_met);
    } else if (filterStatus === 'unmet') {
        rows = rows.filter(r => !r.is_met);
    }

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 2rem; color: var(--text-secondary);">По заданным фильтрам смены не найдены</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map(r => {
        // Shift badge
        const isDay = r.shift_name === 'День';
        const shiftBadge = isDay 
            ? `<span style="background: #fef3c7; color: #b45309; border: 1px solid #fde68a; padding: 3px 8px; border-radius: 6px; font-weight: 600; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px;">☀️ День</span>`
            : `<span style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; padding: 3px 8px; border-radius: 6px; font-weight: 600; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px;">🌙 Ночь</span>`;

        // Status badge
        const statusBadge = r.is_met
            ? `<span style="background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 0.8rem; display: inline-block;">✓ ВЫПОЛНЕН</span>`
            : `<span style="background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; padding: 3px 8px; border-radius: 6px; font-weight: 600; font-size: 0.8rem; display: inline-block;">Не выполнен</span>`;

        // Diff formatted
        const diffColor = r.diff >= 0 ? '#047857' : '#b91c1c';
        const diffPrefix = r.diff > 0 ? '+' : '';
        const diffText = r.fact_lfm > 0 ? `${diffPrefix}${r.diff.toLocaleString()} шт.` : '-';

        const crewBadge = r.crew_name 
            ? `<strong style="color: #0f172a; font-size: 0.9rem;">${r.crew_name}</strong>` 
            : `<span style="color: var(--text-secondary); font-style: italic;">Не назначена</span>`;

        const rowBg = r.is_met ? 'rgba(236, 253, 245, 0.25)' : '#ffffff';

        return `
            <tr style="background: ${rowBg}; border-bottom: 1px solid var(--glass-border);">
                <td style="font-weight: 600; color: #0f172a; white-space: nowrap;">${r.date_display}</td>
                <td style="color: var(--text-secondary); font-size: 0.8rem;">${r.day_of_week || ''}</td>
                <td>${shiftBadge}</td>
                <td>${crewBadge}</td>
                <td style="text-align: right; font-weight: 700; font-size: 0.95rem; color: #0f172a;">${(r.fact_lfm || 0).toLocaleString()}</td>
                <td style="text-align: right; color: var(--text-secondary); font-size: 0.88rem;">${(r.plan || 0).toLocaleString()}</td>
                <td style="text-align: center;">${statusBadge}</td>
                <td style="text-align: right; font-weight: 600; font-size: 0.85rem; color: ${diffColor};">${diffText}</td>
                <td style="color: #334155; font-size: 0.85rem;">${r.master || '<span style="color:#94a3b8;">-</span>'}</td>
                <td style="color: #64748b; font-size: 0.8rem;">${r.batches ? 'Партия: ' + r.batches : ''} ${r.products ? '(' + r.products + ')' : ''}</td>
            </tr>
        `;
    }).join('');
}

