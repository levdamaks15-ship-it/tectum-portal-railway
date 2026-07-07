let currentUser = null;
let activeShiftId = null;
let activeShiftData = null;
let currentDowntimes = [];
let chartProduction = null;
let chartDefects = null;
let chartMaterials = null;
let chartWeeklyProduction = null;
let chartWeeklyDeviation = null;
let chartDtCategory = null;
let chartDtNodes = null;
let chartDailySheets = null;
let chartDailyTons = null;
// defect names map
const DEFECT_NAMES = {
    ds_defect_chip: "Скол",
    ds_defect_scratch: "Сдир",
    ds_defect_bad_cut: "Плохой рез",
    ds_defect_stick_bottom: "Налип снизу",
    ds_defect_stick_top: "Налип сверху",
    ds_defect_broken: "Сломан",
    ds_defect_fell_box: "Упал коробки",
    ds_defect_dent: "Вмятина",
    ds_defect_thickness: "Толщина",
    ds_defect_delamination: "Расслоение",
    ds_defect_edge: "Кромка"
};

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    } else {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            document.documentElement.setAttribute('data-theme', 'light');
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    }
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const nextTheme = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
    if (currentUser && currentUser.role === 'director') {
        renderDashboard();
    }
}

let ssoActive = false;

function showSsoLogin() {
    const ssoSection = document.getElementById('sso-section');
    const userSelectionSection = document.getElementById('user-selection-section');
    if (ssoSection) ssoSection.style.display = 'block';
    if (userSelectionSection) userSelectionSection.style.display = 'none';
}

function showPinLoginLegacy() {
    const ssoSection = document.getElementById('sso-section');
    const userSelectionSection = document.getElementById('user-selection-section');
    if (ssoSection) ssoSection.style.display = 'none';
    if (userSelectionSection) userSelectionSection.style.display = 'block';
    
    const backToSsoBtn = document.getElementById('back-to-sso-container');
    if (backToSsoBtn && ssoActive) {
        backToSsoBtn.style.display = 'block';
    }
}

function setupTimePickers() {
    flatpickr('.time-picker', {
        enableTime: true,
        noCalendar: true,
        dateFormat: "H:i",
        time_24hr: true,
        locale: "ru"
    });
}

function setupCollapsibleCards() {
    document.querySelectorAll('.collapsible-card h3').forEach(header => {
        if (header.dataset.collapsibleSetup) return;
        header.dataset.collapsibleSetup = 'true';
        header.addEventListener('click', () => {
            const card = header.closest('.collapsible-card');
            if (card) {
                card.classList.toggle('expanded');
            }
        });
    });
}

async function init() {
    initTheme();
    setupCollapsibleCards();
    
    if (typeof Chart !== 'undefined') {
        Chart.defaults.plugins.legend.display = window.innerWidth > 480;
    }
    
    // Check if the user is already authenticated on the server
    try {
        const meRes = await fetch('/api/me/');
        if (meRes.ok) {
            const meData = await meRes.json();
            ssoActive = !!meData.sso_enabled;
            
            if (meData.authenticated) {
                currentUser = meData.user;
                document.getElementById('login-screen').style.display = 'none';
                document.getElementById('main-app').style.display = 'block';
                document.getElementById('user-info-container').style.display = 'flex';
                document.getElementById('user-greeting-name').innerText = currentUser.name;
                document.getElementById('user-greeting-role').innerText = currentUser.role;
                
                applyRoleVisibility();
                loadData();
                setupTimePickers();
                return;
            } else {
                if (meData.sso_enabled) {
                    showSsoLogin();
                } else {
                    const ssoSection = document.getElementById('sso-section');
                    const userSelectionSection = document.getElementById('user-selection-section');
                    if (ssoSection) ssoSection.style.display = 'none';
                    if (userSelectionSection) userSelectionSection.style.display = 'block';
                }
            }
        }
    } catch (e) {
        console.error("Error loading session:", e);
    }
    
    const res = await fetch('/api/masters/');
    const masters = await res.json();
    
    const roleOrder = {
        'director': 1,
        'technologist': 2,
        'master': 3,
        'zo': 4,
        'lfm': 5,
        'stacker': 6,
        'destacker': 7,
        'qcd': 8,
        'mechanic': 9
    };
    
    masters.sort((a, b) => {
        const orderA = roleOrder[a.role] || 99;
        const orderB = roleOrder[b.role] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
    });
    
    const grid = document.getElementById('user-grid');
    if (grid) {
        grid.innerHTML = masters.map(m => {
            let icon = '👤';
            if (m.role === 'admin') icon = '🛡️';
            if (m.role === 'director') icon = '👔';
            if (m.role === 'technologist') icon = '🧑‍🔬';
            if (m.role === 'master') icon = '👷‍♂️';
            if (m.role === 'mechanic') icon = '🔧';
            if (m.role === 'qcd') icon = '🔍';
            if (m.role === 'stacker' || m.role === 'destacker') icon = '🏗️';
            if (m.role === 'zo') icon = '🧪';
            if (m.role === 'lfm') icon = '⚙️';
            
            let roleName = m.role;
            switch(m.role) {
                case 'admin': roleName = 'Администратор'; break;
                case 'master': roleName = 'Мастер смены'; break;
                case 'director': roleName = 'Технический директор'; break;
                case 'technologist': roleName = 'Главный технолог'; break;
                case 'zo': roleName = 'Оператор ЗО'; break;
                case 'lfm': roleName = 'Машинист ЛФМ'; break;
                case 'stacker': roleName = 'Стакер'; break;
                case 'destacker': roleName = 'Дестакер'; break;
                case 'qcd': roleName = 'Инспектор СКК'; break;
                case 'mechanic': roleName = 'Главный механик'; break;
            }

            return `
            <div class="user-card" onclick="selectUser('${m.name}', '${roleName}')" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: 12px; padding: 1rem; text-align: center; cursor: pointer; transition: 0.2s;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">${icon}</div>
                <div style="font-weight: 600; font-size: 0.9rem; color: var(--text-primary); margin-bottom: 0.2rem;">${m.name}</div>
                <div style="font-size: 0.75rem; color: var(--text-secondary);">${roleName}</div>
            </div>
            `;
        }).join('');
    }
    
    setupTimePickers();
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
    document.getElementById('login-error').style.display = 'none';
    
    // Reset to initial screen (SSO or PIN selection)
    init();
}

function applyRoleVisibility() {
    // Восстанавливаем класс collapsible-card у всех карточек перед пересчетом ролей
    const views = ['master-view', 'master-receipt-view', 'zo-view', 'lfm-view', 'stacker-view', 'destacker-view', 'qcd-view'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('collapsible-card');
    });

    const role = currentUser.role;
    
    const tabsMenu = document.getElementById('tabs-menu');
    if(tabsMenu) tabsMenu.style.display = 'none';
    
    const btnProd = document.getElementById('tab-btn-production');
    const btnDown = document.getElementById('tab-btn-downtimes');
    const btnMats = document.getElementById('tab-btn-materials');
    const btnDaily = document.getElementById('tab-btn-daily-report');
    const btnAnalytics = document.getElementById('tab-btn-analytics');
    if(btnProd) btnProd.style.display = 'none';
    if(btnDown) btnDown.style.display = 'none';
    if(btnMats) btnMats.style.display = 'none';
    if(btnDaily) btnDaily.style.display = 'none';
    if(btnAnalytics) btnAnalytics.style.display = 'none';
    
    if (role === 'master' || role === 'director' || role === 'technologist' || role === 'mechanic' || role === 'admin') {
        if(tabsMenu) tabsMenu.style.display = 'flex';
        
        if (role === 'admin' || role === 'master') {
            if(btnProd) btnProd.style.display = 'inline-block';
            if(btnDown) btnDown.style.display = 'inline-block';
            if(btnMats) btnMats.style.display = 'inline-block';
            if(btnDaily) btnDaily.style.display = 'inline-block';
            if(btnAnalytics) btnAnalytics.style.display = 'inline-block';
            switchTab('production');
        } else if (role === 'director' || role === 'technologist') {
            if(btnProd) btnProd.style.display = 'inline-block';
            if(btnDown) btnDown.style.display = 'inline-block';
            if(btnMats) btnMats.style.display = 'inline-block';
            if(btnDaily) btnDaily.style.display = 'inline-block';
            if(btnAnalytics) btnAnalytics.style.display = 'inline-block';
            switchTab('production');
        } else if (role === 'mechanic') {
            if(btnDown) btnDown.style.display = 'inline-block';
            switchTab('downtimes');
        }
    } else {
        if(tabsMenu) tabsMenu.style.display = 'flex';
        if(btnProd) btnProd.style.display = 'inline-block';
        switchTab('production');
    }
    
    const isMechanicOrMaster = (role === 'master' || role === 'mechanic' || role === 'admin' || role === 'director' || role === 'technologist');
    const wrapEnd = document.getElementById('wrapper-dt-end');
    const wrapCat = document.getElementById('wrapper-dt-cat');
    if (wrapEnd) wrapEnd.style.display = isMechanicOrMaster ? 'block' : 'none';
    if (wrapCat) wrapCat.style.display = isMechanicOrMaster ? 'block' : 'none';

    const masterView = document.getElementById('master-view');
    if (masterView) {
        masterView.style.display = (role === 'master' || role === 'admin') ? 'block' : 'none';
    }
    
    const receiptView = document.getElementById('master-receipt-view');
    if (receiptView) {
        receiptView.style.display = (role === 'master' || role === 'admin') ? 'block' : 'none';
    }
    
    const dashView = document.getElementById('dashboard-view');
    if (dashView) {
        dashView.style.display = (role === 'master' || role === 'director' || role === 'technologist' || role === 'admin') ? 'block' : 'none';
    }
    
    const planBoardView = document.getElementById('plan-board-view');
    if (planBoardView) {
        planBoardView.style.display = (role === 'master' || role === 'director' || role === 'technologist' || role === 'admin') ? 'block' : 'none';
    }

    const zoView = document.getElementById('zo-view');
    if (zoView) {
        zoView.style.display = (role === 'zo' || role === 'admin') ? 'block' : 'none';
    }
    
    const lfmView = document.getElementById('lfm-view');
    if (lfmView) {
        lfmView.style.display = (role === 'lfm' || role === 'admin') ? 'block' : 'none';
    }
    
    const stackerView = document.getElementById('stacker-view');
    if (stackerView) {
        stackerView.style.display = (role === 'stacker' || role === 'admin') ? 'block' : 'none';
    }
    
    const destackerView = document.getElementById('destacker-view');
    if (destackerView) {
        destackerView.style.display = (role === 'destacker' || role === 'admin') ? 'block' : 'none';
    }
    
    const qcdView = document.getElementById('qcd-view');
    if (qcdView) {
        qcdView.style.display = (role === 'qcd' || role === 'admin') ? 'block' : 'none';
    }
    
    const reportView = document.getElementById('report-view');
    if (reportView) {
        reportView.style.display = (role === 'master' || role === 'admin') ? 'block' : 'none';
    }

    const adminPlanControls = document.getElementById('admin-plan-controls');
    if (adminPlanControls) {
        adminPlanControls.style.display = (role === 'admin') ? 'block' : 'none';
    }

    // Для мобильных экранов: убираем аккордеон для операторов смены, оставляя только для master/admin
    const collapsibleCards = document.querySelectorAll('.collapsible-card');
    collapsibleCards.forEach(card => {
        card.classList.remove('expanded');
        if (role !== 'master' && role !== 'admin') {
            if (card.style.display !== 'none') {
                // Оператор смены видит только свою форму, убираем с неё функционал аккордеона
                card.classList.remove('collapsible-card');
            }
        }
    });
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const btn = document.getElementById(`tab-btn-${tabId}`);
    if(btn) btn.classList.add('active');
    
    const prod = document.getElementById('production-tab');
    const down = document.getElementById('downtimes-tab');
    const mats = document.getElementById('materials-tab');
    const daily = document.getElementById('daily-report-tab');
    const analytics = document.getElementById('analytics-tab');
    
    if(prod) prod.style.display = 'none';
    if(down) down.style.display = 'none';
    if(mats) mats.style.display = 'none';
    if(daily) daily.style.display = 'none';
    if(analytics) analytics.style.display = 'none';
    
    const target = document.getElementById(`${tabId}-tab`);
    if(target) {
        if (tabId === 'production') target.style.display = 'grid';
        else target.style.display = 'block';
    }

    if (tabId === 'production') {
        const role = currentUser ? currentUser.role : '';
        if (role === 'master' || role === 'admin' || role === 'director' || role === 'technologist') {
            renderDashboard();
            loadDirectorPlanBoard();
        }
    } else if (tabId === 'materials') {
        loadMaterialsReport();
    } else if (tabId === 'downtimes') {
        loadDowntimeDepartments();
        loadDowntimeShifts();
    } else if (tabId === 'daily-report') {
        const dMonth = document.getElementById('daily-report-month');
        if (dMonth && !dMonth.value) {
            const now = new Date();
            dMonth.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        }
        const dDay = document.getElementById('daily-report-day-picker');
        if (dDay && !dDay.value) {
            dDay.value = new Date().toISOString().split('T')[0];
        }
        toggleRangeControls();
        loadDailyReport();
    } else if (tabId === 'analytics') {
        initAnalyticsTab();
    }
}

async function loadData() {
    // Загрузка активной смены
    const res = await fetch('/api/shifts/active');
    const shifts = await res.json();
    if (shifts.length > 0) {
        const shift = shifts[0];
        activeShiftId = shift.id;
        activeShiftData = shift;
        currentDowntimes = shift.downtimes || [];
        const masterText = shift.master ? ` (Мастер: ${shift.master.name})` : '';
        document.getElementById('active-shift-display').innerText = `${shift.date} | ${shift.shift_name} | ${shift.line}${masterText}`;
        
        const lfmList = document.getElementById('lfm-reports-list');
        if(lfmList) {
            lfmList.innerHTML = shift.lfm_reports.map(r => 
                `<div>- ${r.product_name}: ${r.lfm_sheets} шт, Сбросы наката: ${r.lfm_wind_resets} шт</div>`
            ).join('');
        }
        
        updateOperatorsStatus(shift);
        renderDowntimesTable(shift);
        
        if (currentUser.role === 'master') {
            renderSummaryTable(shift);
            renderMasterDashboard(shift);
            document.getElementById('btn-close-shift').style.display = 'inline-block';
            fetchMaterialsSummary(shift.id);
        } else if (currentUser.role === 'director') {
            fetchMaterialsSummary(shift.id);
        }
        // Populate ZO fields if present in DOM
        if (document.getElementById('zo-chr-4-20')) {
            document.getElementById('zo-chr-4-20').value = shift.zo_chrysotile_4_20 || '';
            document.getElementById('zo-chr-5-65').value = shift.zo_chrysotile_5_65 || '';
            document.getElementById('zo-chr-6-40').value = shift.zo_chrysotile_6_40 || '';
            document.getElementById('zo-cem-1').value = shift.zo_cement_silo1 || '';
            document.getElementById('zo-cem-2').value = shift.zo_cement_silo2 || '';
            document.getElementById('zo-cem-3').value = shift.zo_cement_silo3 || '';
            document.getElementById('zo-cem-4').value = shift.zo_cement_silo4 || '';
            document.getElementById('zo-cel').value = shift.zo_cellulose || '';
            document.getElementById('zo-slate').value = shift.zo_crushed_slate || '';
            document.getElementById('zo-asb').value = shift.zo_asbozurit || '';
            document.getElementById('zo-fib').value = shift.zo_fiberglass || '';
            document.getElementById('zo-laprol').value = shift.zo_laprol || '';
            document.getElementById('zo-asbocarton').value = shift.zo_asbocarton || '';
            document.getElementById('zo-batches').value = shift.zo_batches || '';
            document.getElementById('zo-asb-drain').value = shift.zo_asb_drain || '';
            document.getElementById('zo-cem-drain').value = shift.zo_cem_drain || '';
        }

        // Populate Receipt fields if present in DOM
        if (document.getElementById('rec-chr-4-20')) {
            document.getElementById('rec-chr-4-20').value = shift.receipt_chrysotile_4_20 || '';
            document.getElementById('rec-chr-5-65').value = shift.receipt_chrysotile_5_65 || '';
            document.getElementById('rec-chr-6-40').value = shift.receipt_chrysotile_6_40 || '';
            document.getElementById('rec-cem').value = shift.receipt_cement || '';
            document.getElementById('rec-cel').value = shift.receipt_cellulose || '';
            document.getElementById('rec-slate').value = shift.receipt_crushed_slate || '';
            document.getElementById('rec-asbocarton').value = shift.receipt_asbocarton || '';
            document.getElementById('rec-pallets').value = shift.receipt_pallets || '';
            document.getElementById('rec-fib').value = shift.receipt_fiberglass || '';
            document.getElementById('rec-laprol').value = shift.receipt_laprol || '';
        }



        applyShiftMode(shift);
    } else {
        document.getElementById('active-shift-display').innerText = "Нет открытой смены";
        activeShiftId = null;
        const btnClose = document.getElementById('btn-close-shift');
        if (btnClose) btnClose.style.display = 'none';
        const devInd = document.getElementById('shift-dev-indicator');
        if (devInd) devInd.style.display = 'none';
        const readOnly = document.getElementById('readonly-badge');
        if (readOnly) readOnly.style.display = 'none';
        applyShiftMode(null);
    }
    
    if (currentUser.role === 'director') {
        renderDashboard();
    }
    
    // Загрузка списков партий для Разборщика и СКК
    if (currentUser.role === 'destacker' || currentUser.role === 'admin') {
        const dsRes = await fetch('/api/batches/pending_destacker');
        const dsBatches = await dsRes.json();
        document.getElementById('ds-batch-select').innerHTML = '<option value="">-- Выберите партию --</option>' + dsBatches.map(b => 
            `<option value="${b.id}">${b.batch_number} (${b.product_name})</option>`
        ).join('');
    }
    
    if (currentUser.role === 'qcd' || currentUser.role === 'admin') {
        const qcdRes = await fetch('/api/batches/pending_qcd');
        const qcdBatches = await qcdRes.json();
        document.getElementById('qcd-batch-select').innerHTML = '<option value="">-- Выберите партию --</option>' + qcdBatches.map(b => 
            `<option value="${b.id}">${b.batch_number} (${b.status})</option>`
        ).join('');
    }
}

async function createShift() {
    const date = document.getElementById('shift-date').value;
    const name = document.getElementById('shift-name').value;
    const line = document.getElementById('shift-line').value;
    if (!date) return alert("Выберите дату");
    
    const res = await fetch('/api/shifts/', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            date: date, shift_name: name, line: line, master_id: currentUser.id
        })
    });
    if (res.ok) {
        alert("Смена начата");
    } else {
        const err = await res.json();
        alert("Ошибка открытия смены: " + (err.detail || "Недостаточно прав"));
    }
    loadData();
}


async function closeShift() {
    if (!activeShiftId) return;
    if (!confirm("Вы уверены, что хотите закрыть текущую смену?")) return;
    
    const res = await fetch(`/api/shifts/${activeShiftId}/close`, {
        method: 'PUT'
    });
    if (res.ok) {
        alert("Смена закрыта!");
    } else {
        const err = await res.json();
        alert("Ошибка при закрытии смены: " + (err.detail || "Недостаточно прав"));
    }
    loadData();
}


async function viewShift(shiftId) {
    const res = await fetch(`/api/shifts/${shiftId}`);
    const shift = await res.json();
    
    activeShiftId = shift.id;
    activeShiftData = shift;
    currentDowntimes = shift.downtimes || [];
    
    const masterText = shift.master ? ` (Мастер: ${shift.master.name})` : '';
    document.getElementById('active-shift-display').innerText = `${shift.date} | ${shift.shift_name} | ${shift.line}${masterText}`;
    
    const lfmList = document.getElementById('lfm-reports-list');
    if(lfmList) {
        lfmList.innerHTML = (shift.lfm_reports || []).map(r => 
            `<div>- ${r.product_name}: ${r.lfm_sheets} шт, Сбросы наката: ${r.lfm_wind_resets} шт</div>`
        ).join('');
    }
    
    updateOperatorsStatus(shift);
    renderDowntimesTable(shift);
    
    if (currentUser.role === 'master') {
        renderSummaryTable(shift);
        fetchMaterialsSummary(shift.id);
    } else if (currentUser.role === 'director') {
        renderSummaryTable(shift);
        fetchMaterialsSummary(shift.id);
    }
    
    applyShiftMode(shift);
    
    switchTab('production');
}

function updateOperatorsStatus(shift) {
    const block = document.getElementById('operators-status-block');
    if (!block) return;
    
    if (!shift) {
        block.style.display = 'none';
        return;
    }
    
    const canSee = !!(currentUser && currentUser.role);
    if (!canSee) {
        block.style.display = 'none';
        return;
    }
    
    block.style.display = 'block';
    
    // 1. ЗО
    const statusZo = document.getElementById('status-zo');
    if (statusZo) {
        if (shift.zo_submitted) {
            statusZo.innerHTML = `ЗО: <span style="font-weight: bold; color: var(--success-color);">Передано</span>`;
        } else {
            statusZo.innerHTML = `ЗО: <span style="font-weight: bold; color: var(--danger-color);">Нет</span>`;
        }
    }
    
    // 2. ЛФМ
    const statusLfm = document.getElementById('status-lfm');
    if (statusLfm) {
        const hasLfm = shift.lfm_reports && shift.lfm_reports.length > 0;
        if (hasLfm) {
            statusLfm.innerHTML = `ЛФМ: <span style="font-weight: bold; color: var(--success-color);">Передано</span>`;
        } else {
            statusLfm.innerHTML = `ЛФМ: <span style="font-weight: bold; color: var(--danger-color);">Нет</span>`;
        }
    }
    
    // 3. Стакер
    const statusStacker = document.getElementById('status-stacker');
    if (statusStacker) {
        const hasStacker = shift.batches && shift.batches.length > 0;
        if (hasStacker) {
            statusStacker.innerHTML = `Стакер: <span style="font-weight: bold; color: var(--success-color);">Передано</span>`;
        } else {
            statusStacker.innerHTML = `Стакер: <span style="font-weight: bold; color: var(--danger-color);">Нет</span>`;
        }
    }
    
    // 4. Дестакер
    const statusDestacker = document.getElementById('status-destacker');
    if (statusDestacker) {
        const hasDestacker = shift.batches && shift.batches.some(b => b.status === 'destacked' || b.status === 'qcd_checked');
        if (hasDestacker) {
            statusDestacker.innerHTML = `Разборщик: <span style="font-weight: bold; color: var(--success-color);">Передано</span>`;
        } else {
            statusDestacker.innerHTML = `Разборщик: <span style="font-weight: bold; color: var(--danger-color);">Нет</span>`;
        }
    }
    
    // 5. СКК
    const statusQcd = document.getElementById('status-qcd');
    if (statusQcd) {
        const hasQcd = shift.batches && shift.batches.some(b => b.status === 'qcd_checked');
        if (hasQcd) {
            statusQcd.innerHTML = `СКК: <span style="font-weight: bold; color: var(--success-color);">Передано</span>`;
        } else {
            statusQcd.innerHTML = `СКК: <span style="font-weight: bold; color: var(--danger-color);">Нет</span>`;
        }
    }
}

function applyShiftMode(shift) {
    const isClosed = !shift || shift.status === 'closed';
    const isOtherMaster = shift && currentUser.role === 'master' && shift.master_id !== currentUser.id;
    const isReadOnly = isClosed || isOtherMaster;
    
    const readonlyBadge = document.getElementById('readonly-badge');
    if (readonlyBadge) {
        if (shift && shift.status === 'closed') {
            readonlyBadge.innerText = "РЕЖИМ ПРОСМОТРА";
            readonlyBadge.style.display = 'block';
        } else if (isOtherMaster) {
            readonlyBadge.innerText = "СМЕНА ДРУГОГО МАСТЕРА";
            readonlyBadge.style.display = 'block';
        } else {
            readonlyBadge.style.display = 'none';
        }
    }
    
    const btnCloseShift = document.getElementById('btn-close-shift');
    if (btnCloseShift) {
        const canClose = shift && shift.status !== 'closed' && (currentUser.role === 'admin' || (currentUser.role === 'master' && shift.master_id === currentUser.id));
        btnCloseShift.style.display = canClose ? 'inline-block' : 'none';
    }
    
    // Disable inputs and buttons in production if closed or no shift
    const forms = ['zo-view', 'lfm-view', 'stacker-view', 'destacker-view', 'qcd-view', 'master-view', 'master-receipt-view'];
    forms.forEach(f => {
        const el = document.getElementById(f);
        if (el) {
            const inputs = el.querySelectorAll('input, select, button');
            inputs.forEach(input => {
                if(input.id !== 'btn-close-shift' && !input.classList.contains('tab-btn') && input.innerText !== 'Обновить' && !input.getAttribute('onclick')?.includes('switchTab')) {
                     let shouldDisable = isReadOnly;
                     if (f === 'master-view') {
                         shouldDisable = !!shift;
                     }
                     input.disabled = shouldDisable;
                     if(shouldDisable) {
                         input.style.opacity = '0.5';
                         input.style.cursor = 'not-allowed';
                     } else {
                         input.style.opacity = '1';
                         input.style.cursor = 'pointer';
                     }
                }
            });
        }
    });

    // Special logic for ZO
    const zoView = document.getElementById('zo-view');
    if (zoView) {
        const isZoLocked = isReadOnly || (shift && shift.zo_submitted);
        const inputs = zoView.querySelectorAll('input, select, button');
        inputs.forEach(input => {
            if(input.innerText !== 'Обновить' && !input.getAttribute('onclick')?.includes('switchTab')) {
                 input.disabled = isZoLocked;
                 if(isZoLocked) {
                     input.style.opacity = '0.5';
                     input.style.cursor = 'not-allowed';
                 } else {
                     input.style.opacity = '1';
                     input.style.cursor = 'pointer';
                 }
            }
        });
        const zoLockMsg = document.getElementById('zo-lock-msg');
        if (zoLockMsg) {
            zoLockMsg.style.display = (shift && shift.zo_submitted && shift.status !== 'closed') ? 'block' : 'none';
        }
    }
}

async function loadArchive() {
    const res = await fetch('/api/shifts/all');
    const shifts = await res.json();
    const tbody = document.getElementById('archive-table-body');
    
    if (shifts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Нет данных</td></tr>';
        return;
    }
    
    tbody.innerHTML = shifts.map(s => {
        const statusStr = s.status === 'active' ? '<span style="color:var(--success-color);">Активна</span>' : 'Закрыта';
        const receiptTotal = (s.receipt_chrysotile_4_20 || 0) + (s.receipt_chrysotile_5_65 || 0) + (s.receipt_chrysotile_6_40 || 0) + (s.receipt_cement || 0) + (s.receipt_cellulose || 0);
        const zoTotal = (s.zo_chrysotile_4_20 || 0) + (s.zo_chrysotile_5_65 || 0) + (s.zo_chrysotile_6_40 || 0) + (s.zo_cement || 0) + (s.zo_cellulose || 0);
        return `
            <tr>
                <td>${s.id}</td>
                <td>${s.date}</td>
                <td>${s.shift_name}</td>
                <td>${s.line}</td>
                <td>${statusStr}</td>
                <td>${receiptTotal}</td>
                <td>${zoTotal}</td>
                <td>${(s.batches || []).length}</td>
                <td><button onclick="viewShift(${s.id})" style="padding: 0.3rem 0.6rem; background: var(--primary-color);">Просмотр</button></td>
            </tr>
        `;
    }).join('');
}

function getNum(id) { return parseFloat(document.getElementById(id).value) || 0; }

async function updateReceipt() {
    if (!activeShiftId) return alert("Нет активной смены");
    const data = {
        chrysotile_4_20: getNum('rec-chr-4-20'),
        chrysotile_5_65: getNum('rec-chr-5-65'),
        chrysotile_6_40: getNum('rec-chr-6-40'),
        cement: getNum('rec-cem'),
        cellulose: getNum('rec-cel'),
        crushed_slate: getNum('rec-slate'),
        asbocarton: getNum('rec-asbocarton'),
        pallets: getNum('rec-pallets'),
        fiberglass: getNum('rec-fib'),
        laprol: getNum('rec-laprol')
    };
    const res = await fetch(`/api/shifts/${activeShiftId}/receipt`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    if (res.ok) {
        alert("Приход сохранен");
    } else {
        const err = await res.json();
        alert("Ошибка сохранения: " + (err.detail || "Недостаточно прав"));
    }
    loadData();
}

async function updateZO() {
    if (!activeShiftId) return alert("Нет активной смены");
    const data = {
        chrysotile_4_20: getNum('zo-chr-4-20'),
        chrysotile_5_65: getNum('zo-chr-5-65'),
        chrysotile_6_40: getNum('zo-chr-6-40'),
        cement_silo1: getNum('zo-cem-1'),
        cement_silo2: getNum('zo-cem-2'),
        cement_silo3: getNum('zo-cem-3'),
        cement_silo4: getNum('zo-cem-4'),
        cellulose: getNum('zo-cel'),
        crushed_slate: getNum('zo-slate'),
        asbozurit: getNum('zo-asb'),
        fiberglass: getNum('zo-fib'),
        laprol: getNum('zo-laprol'),
        asbocarton: getNum('zo-asbocarton'),
        batches: getNum('zo-batches'),
        asb_drain: getNum('zo-asb-drain'),
        cem_drain: getNum('zo-cem-drain'),
        submitted: true
    };
    const res = await fetch(`/api/shifts/${activeShiftId}/zo`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    if (res.ok) {
        alert("Данные ЗО успешно отправлены");
    } else {
        const err = await res.json();
        alert("Ошибка отправки данных ЗО: " + (err.detail || "Недостаточно прав"));
    }
    loadData();
}




async function addLFMReport() {
    if (!activeShiftId) return alert("Нет активной смены");
    const product_name = document.getElementById('lfm-product').value;
    const lfm_sheets = getNum('lfm-sheets');
    const lfm_wind_resets = getNum('lfm-resets');
    
    await fetch(`/api/shifts/${activeShiftId}/lfm`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            product_name,
            lfm_sheets,
            lfm_wind_resets,
            formed_1st_grade: 0,
            formed_defect: 0,
            transferred_to_warehouse: 0
        })
    });
    alert("Отчет добавлен");
    document.getElementById('lfm-sheets').value = '';
    document.getElementById('lfm-resets').value = '';
    loadData();
}

let currentMediaUrls = [];

let mediaRecorder;
let audioChunks = [];
let isRecording = false;

async function toggleAudioRecording(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-record-audio");
    
    if (isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        btn.innerHTML = '<i class="fa-solid fa-microphone"></i> Начать запись';
        btn.style.background = 'rgba(255,255,255,0.1)';
        btn.style.color = 'white';
    } else {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = event => {
                if (event.data.size > 0) audioChunks.push(event.data);
            };
            
            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const file = new File([audioBlob], `voice_message_${Date.now()}.webm`, { type: 'audio/webm' });
                uploadFileObject(file);
                stream.getTracks().forEach(track => track.stop());
            };
            
            mediaRecorder.start();
            isRecording = true;
            btn.innerHTML = '<i class="fa-solid fa-stop"></i> Запись идет... (нажмите для остановки)';
            btn.style.background = 'var(--danger-color)';
            btn.style.color = 'white';
        } catch (err) {
            console.error("Mic error:", err);
            alert("Не удалось получить доступ к микрофону. Проверьте разрешения в браузере.");
        }
    }
}

async function uploadDowntimeMedia(input) {
    if (!input.files || input.files.length === 0) return;
    uploadFileObject(input.files[0]);
}

async function uploadFileObject(file) {
    const formData = new FormData();
    formData.append("file", file);
    
    const btn = document.getElementById("btn-add-dt");
    const progress = document.getElementById("upload-progress");
    const status = document.getElementById("upload-status");
    
    btn.disabled = true;
    progress.style.display = 'block';
    progress.value = 0;
    status.style.display = 'block';
    status.innerText = "Загрузка файла: " + file.name + "...";
    
    try {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload_media/", true);
        
        xhr.upload.onprogress = function(e) {
            if (e.lengthComputable) {
                progress.value = (e.loaded / e.total) * 100;
            }
        };
        
        xhr.onload = function() {
            if (xhr.status === 200) {
                const res = JSON.parse(xhr.responseText);
                currentMediaUrls.push(res.url);
                status.innerText = "Файл успешно загружен!";
                status.style.color = "var(--success-color)";
                renderUploadedFiles();
            } else {
                status.innerText = "Ошибка загрузки: " + xhr.responseText;
                status.style.color = "var(--danger-color)";
            }
            btn.disabled = false;
            progress.style.display = 'none';
        };
        
        xhr.onerror = function() {
            status.innerText = "Сетевая ошибка при загрузке.";
            status.style.color = "var(--danger-color)";
            btn.disabled = false;
            progress.style.display = 'none';
        };
        
        xhr.send(formData);
    } catch (e) {
        console.error("Upload error", e);
        btn.disabled = false;
    }
}

function renderUploadedFiles() {
    const container = document.getElementById("uploaded-files-container");
    container.innerHTML = currentMediaUrls.map((url, i) => `
        <span style="background: var(--primary-color); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">
            Файл ${i+1} <a href="${url}" target="_blank" style="color:white; margin-left:5px;"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
        </span>
    `).join('');
}

async function loadDowntimeShifts() {
    try {
        const res = await fetch('/api/shifts/all');
        const shifts = await res.json();
        const select = document.getElementById('journal-dt-shift-select');
        if (!select) return;
        
        let html = '';
        if (activeShiftId) {
            html += `<option value="${activeShiftId}">-- Текущая активная смена (ID ${activeShiftId}) --</option>`;
        } else {
            html += '<option value="">-- Выберите смену --</option>';
        }
        
        shifts.forEach(s => {
            if (s.id !== activeShiftId) {
                const masterName = s.master ? s.master.name : 'Без мастера';
                const statusStr = s.status === 'active' ? 'Активна' : 'Закрыта';
                html += `<option value="${s.id}">${s.date} | ${s.shift_name} | ${s.line} (Мастер: ${masterName}) [${statusStr}]</option>`;
            }
        });
        select.innerHTML = html;
    } catch(e) {
        console.error("Failed to load shifts for downtimes dropdown", e);
    }
}

async function onJournalShiftChange() {
    const shiftId = document.getElementById('journal-dt-shift-select').value;
    if (!shiftId) return;
    
    try {
        const res = await fetch(`/api/shifts/${shiftId}`);
        if (res.ok) {
            const shift = await res.json();
            currentDowntimes = shift.downtimes || [];
            renderDowntimesTable(shift);
        }
    } catch(e) {
        console.error("Failed to load selected shift downtimes", e);
    }
}

async function addJournalDowntime() {
    const selectedShiftId = document.getElementById('journal-dt-shift-select').value;
    const targetShiftId = selectedShiftId || activeShiftId;
    if (!targetShiftId) return alert("Выберите смену или откройте активную смену");
    
    const start_time = document.getElementById(`journal-dt-start`).value;
    const end_time = document.getElementById(`journal-dt-end`).value || null;
    const category = null;
    const department = document.getElementById(`journal-dt-dept`).value;
    const node = document.getElementById(`journal-dt-node`).value;
    const subnode = document.getElementById(`journal-dt-subnode`).value;
    const combinedNode = subnode ? `${node} - ${subnode}` : node;
    const breakdownSelect = document.getElementById(`journal-dt-breakdown`);
    const description = breakdownSelect.value === 'Другое' ? document.getElementById(`journal-dt-desc`).value : (breakdownSelect.value || document.getElementById(`journal-dt-desc`).value);
    const is_equipment_downtime = document.getElementById('journal-dt-is-equipment-stop').checked;
    
    if (!start_time || !department || !node) return alert("Заполните обязательные поля (Время начала, Участок, Узел)");
    
    const media_urls = currentMediaUrls.length > 0 ? JSON.stringify(currentMediaUrls) : null;
    
    await fetch(`/api/shifts/${targetShiftId}/downtimes`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ start_time, end_time, category, department, node: combinedNode, description, media_urls, is_equipment_downtime })
    });
    alert("Простой зарегистрирован!");
    document.getElementById(`journal-dt-start`).value = '';
    document.getElementById(`journal-dt-end`).value = '';
    document.getElementById(`journal-dt-desc`).value = '';
    document.getElementById('journal-dt-is-equipment-stop').checked = true;
    
    // reset depts
    document.getElementById(`journal-dt-dept`).value = '';
    document.getElementById(`journal-dt-node`).innerHTML = '<option value="">-- Сначала выберите участок --</option>';
    document.getElementById(`journal-dt-subnode`).innerHTML = '<option value="">-- Выберите подузел --</option>';
    document.getElementById(`wrapper-dt-subnode`).style.display = 'none';
    document.getElementById(`journal-dt-breakdown`).innerHTML = '<option value="">-- Сначала выберите узел --</option>';
    
    currentMediaUrls = [];
    renderUploadedFiles();
    
    if (selectedShiftId) {
        onJournalShiftChange();
    } else {
        loadData();
    }
}

function renderDowntimesTable(shift) {
    const list = document.getElementById('journal-downtimes-list');
    if (!list) return;
    
    if (!currentDowntimes || currentDowntimes.length === 0) {
        list.innerHTML = '<tr><td colspan="10" style="text-align:center; color: var(--text-secondary);">Нет зарегистрированных простоев</td></tr>';
        return;
    }
    
    const html = currentDowntimes.map(dt => {
        let mediaLinks = '';
        if (dt.media_urls) {
            try {
                const urls = JSON.parse(dt.media_urls);
                mediaLinks = urls.map((u, i) => `<a href="${u}" target="_blank" style="margin-right:5px; color:var(--primary-color)"><i class="fa-solid fa-paperclip"></i> Файл ${i+1}</a>`).join('<br>');
            } catch(e) {}
        }
        
        let statusBadge = dt.status === 'pending' 
            ? '<span style="color:var(--accent-color); font-weight:bold;">Ожидает Механика</span>' 
            : '<span style="color:var(--success-color);">Закрыто</span>';
            
        let actionButtons = '';
        if (currentUser && (currentUser.role === 'master' || currentUser.role === 'mechanic' || currentUser.role === 'director' || currentUser.role === 'technologist' || currentUser.role === 'admin')) {
            actionButtons = `
                <button onclick='openEditDowntimeModal(${dt.id})' style="width:auto; padding: 0.3rem 0.6rem; font-size:0.8rem; margin-bottom: 0.2rem; background: var(--primary-color);">Ред.</button>
                <button onclick="deleteDowntime(${dt.id})" style="width:auto; padding: 0.3rem 0.6rem; font-size:0.8rem; background: var(--danger-color);">Удал.</button>
            `;
        }
        
        let stopBadge = dt.is_equipment_downtime 
            ? '<span style="display:inline-block; margin-top:3px; background:rgba(220,53,69,0.2); color:#ff6b6b; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:bold;">🛑 С остановкой</span>' 
            : '<span style="display:inline-block; margin-top:3px; background:rgba(40,167,69,0.2); color:#28a745; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:bold;">⚡ Без остановки</span>';

        let dept_and_node = dt.department ? `${dt.department} / ${dt.node}` : dt.node;
        dept_and_node += `<br>${stopBadge}`;
        
        return `
        <tr style="${dt.status === 'pending' ? 'background: rgba(255,165,0,0.1);' : ''}">
            <td>${shift.shift_name} (${shift.date})</td>
            <td>${statusBadge}</td>
            <td>${dt.start_time}</td>
            <td>${dt.end_time || '-'}</td>
            <td>${dt.duration} мин</td>
            <td><span style="color:var(--danger-color)">-${dt.lost_tons.toFixed(1)} т / -${dt.lost_tenge.toLocaleString()} ₸</span></td>
            <td>${dept_and_node}</td>
            <td>${dt.description}</td>
            <td>${mediaLinks}</td>
            <td>${actionButtons}</td>
        </tr>
        `;
    }).join('');
    
    list.innerHTML = html;
}

// --- DOWNTIME DYNAMIC DIRECTORY LOGIC ---
let currentJournalNodes = [];
let currentEditNodes = [];

async function loadDowntimeDepartments() {
    try {
        const res = await fetch('/api/downtimes/directory/departments');
        const depts = await res.json();
        const select = document.getElementById('journal-dt-dept');
        if (!select) return;
        select.innerHTML = '<option value="">-- Выберите участок --</option>' + 
            depts.map(d => `<option value="${d}">${d}</option>`).join('');
    } catch(e) {
        console.error("Failed to load departments", e);
    }
}

async function onJournalDeptChange() {
    const dept = document.getElementById('journal-dt-dept').value;
    const nodeSelect = document.getElementById('journal-dt-node');
    const subnodeWrapper = document.getElementById('wrapper-dt-subnode');
    const subnodeSelect = document.getElementById('journal-dt-subnode');
    const breakdownSelect = document.getElementById('journal-dt-breakdown');
    
    nodeSelect.innerHTML = '<option value="">-- Выберите узел --</option>';
    subnodeSelect.innerHTML = '<option value="">-- Выберите подузел --</option>';
    breakdownSelect.innerHTML = '<option value="">-- Сначала выберите узел --</option>';
    subnodeWrapper.style.display = 'none';
    
    if (!dept) return;
    try {
        const res = await fetch(`/api/downtimes/directory/nodes?department=${encodeURIComponent(dept)}`);
        currentJournalNodes = await res.json();
        
        const primaryNodes = Array.from(new Set(currentJournalNodes.map(n => n.split(' - ')[0])));
        nodeSelect.innerHTML = '<option value="">-- Выберите узел --</option>' + 
            primaryNodes.map(n => `<option value="${n}">${n}</option>`).join('');
    } catch(e) {
        console.error("Failed to load nodes", e);
    }
}

async function onJournalNodeChange() {
    const dept = document.getElementById('journal-dt-dept').value;
    const node = document.getElementById('journal-dt-node').value;
    const subnodeWrapper = document.getElementById('wrapper-dt-subnode');
    const subnodeSelect = document.getElementById('journal-dt-subnode');
    const breakdownSelect = document.getElementById('journal-dt-breakdown');
    
    subnodeSelect.innerHTML = '<option value="">-- Выберите подузел --</option>';
    breakdownSelect.innerHTML = '<option value="">-- Сначала выберите подузел --</option>';
    
    if (!dept || !node) {
        subnodeWrapper.style.display = 'none';
        return;
    }
    
    const matchingRawNodes = currentJournalNodes.filter(n => n.startsWith(node + ' - ') || n === node);
    const subnodes = matchingRawNodes
        .filter(n => n.includes(' - '))
        .map(n => n.split(' - ')[1]);
        
    if (subnodes.length > 0) {
        subnodeWrapper.style.display = 'block';
        subnodeSelect.innerHTML = '<option value="">-- Выберите подузел --</option>' + 
            subnodes.map(s => `<option value="${s}">${s}</option>`).join('');
    } else {
        subnodeWrapper.style.display = 'none';
        await loadBreakdowns(dept, node);
    }
}

async function onJournalSubnodeChange() {
    const dept = document.getElementById('journal-dt-dept').value;
    const node = document.getElementById('journal-dt-node').value;
    const subnode = document.getElementById('journal-dt-subnode').value;
    
    if (!subnode) return;
    const combinedNode = `${node} - ${subnode}`;
    await loadBreakdowns(dept, combinedNode);
}

async function loadBreakdowns(dept, combinedNode) {
    const breakdownSelect = document.getElementById('journal-dt-breakdown');
    breakdownSelect.innerHTML = '<option value="">-- Выберите поломку --</option>';
    try {
        const res = await fetch(`/api/downtimes/directory/breakdowns?department=${encodeURIComponent(dept)}&node=${encodeURIComponent(combinedNode)}`);
        const breakdowns = await res.json();
        breakdownSelect.innerHTML = '<option value="">-- Выберите поломку --</option>' + 
            breakdowns.map(b => `<option value="${b.breakdown}" data-comment="${b.comment || ''}">${b.breakdown}</option>`).join('') +
            '<option value="Другое">Другое (ввести вручную)</option>';
    } catch(e) {
        console.error("Failed to load breakdowns", e);
    }
}

function onJournalBreakdownChange() {
    const breakdownSelect = document.getElementById('journal-dt-breakdown');
    const selectedOption = breakdownSelect.options[breakdownSelect.selectedIndex];
    const descInput = document.getElementById('journal-dt-desc');
    
    if (selectedOption && selectedOption.value === "Другое") {
        descInput.value = '';
        descInput.placeholder = "Введите описание поломки вручную";
        descInput.focus();
    } else if (selectedOption && selectedOption.value) {
        const comment = selectedOption.getAttribute('data-comment');
        descInput.value = selectedOption.value + (comment && comment !== "None" ? ` (${comment})` : '');
    } else {
        descInput.value = '';
    }
}

async function loadEditDepartments(selectedDept = '', selectedNode = '', selectedBreakdown = '') {
    try {
        const res = await fetch('/api/downtimes/directory/departments');
        const depts = await res.json();
        const select = document.getElementById('edit-dt-dept');
        if (!select) return;
        select.innerHTML = '<option value="">-- Выберите участок --</option>' + 
            depts.map(d => `<option value="${d}">${d}</option>`).join('');
            
        if (selectedDept) {
            select.value = selectedDept;
            await onEditDeptChange(selectedNode, selectedBreakdown);
        }
    } catch(e) {
        console.error(e);
    }
}

async function onEditDeptChange(selectedNode = '', selectedBreakdown = '') {
    const dept = document.getElementById('edit-dt-dept').value;
    const nodeSelect = document.getElementById('edit-dt-node');
    const subnodeWrapper = document.getElementById('wrapper-edit-dt-subnode');
    const subnodeSelect = document.getElementById('edit-dt-subnode');
    const breakdownSelect = document.getElementById('edit-dt-breakdown');
    
    nodeSelect.innerHTML = '<option value="">-- Выберите узел --</option>';
    subnodeSelect.innerHTML = '<option value="">-- Выберите подузел --</option>';
    breakdownSelect.innerHTML = '<option value="">-- Сначала выберите узел --</option>';
    subnodeWrapper.style.display = 'none';
    
    if (!dept) return;
    try {
        const res = await fetch(`/api/downtimes/directory/nodes?department=${encodeURIComponent(dept)}`);
        currentEditNodes = await res.json();
        
        const primaryNodes = Array.from(new Set(currentEditNodes.map(n => n.split(' - ')[0])));
        nodeSelect.innerHTML = '<option value="">-- Выберите узел --</option>' + 
            primaryNodes.map(n => `<option value="${n}">${n}</option>`).join('');
            
        if (selectedNode) {
            const primaryNode = selectedNode.split(' - ')[0];
            const subnode = selectedNode.includes(' - ') ? selectedNode.split(' - ')[1] : '';
            nodeSelect.value = primaryNode;
            await onEditNodeChange(subnode, selectedBreakdown);
        }
    } catch(e) {
        console.error(e);
    }
}

async function onEditNodeChange(selectedSubnode = '', selectedBreakdown = '') {
    const dept = document.getElementById('edit-dt-dept').value;
    const node = document.getElementById('edit-dt-node').value;
    const subnodeWrapper = document.getElementById('wrapper-edit-dt-subnode');
    const subnodeSelect = document.getElementById('edit-dt-subnode');
    const breakdownSelect = document.getElementById('edit-dt-breakdown');
    
    subnodeSelect.innerHTML = '<option value="">-- Выберите подузел --</option>';
    breakdownSelect.innerHTML = '<option value="">-- Сначала выберите подузел --</option>';
    
    if (!dept || !node) {
        subnodeWrapper.style.display = 'none';
        return;
    }
    
    const matchingRawNodes = currentEditNodes.filter(n => n.startsWith(node + ' - ') || n === node);
    const subnodes = matchingRawNodes
        .filter(n => n.includes(' - '))
        .map(n => n.split(' - ')[1]);
        
    if (subnodes.length > 0) {
        subnodeWrapper.style.display = 'block';
        subnodeSelect.innerHTML = '<option value="">-- Выберите подузел --</option>' + 
            subnodes.map(s => `<option value="${s}">${s}</option>`).join('');
            
        if (selectedSubnode) {
            subnodeSelect.value = selectedSubnode;
            await onEditSubnodeChange(selectedBreakdown);
        }
    } else {
        subnodeWrapper.style.display = 'none';
        await loadEditBreakdowns(dept, node, selectedBreakdown);
    }
}

async function onEditSubnodeChange(selectedBreakdown = '') {
    const dept = document.getElementById('edit-dt-dept').value;
    const node = document.getElementById('edit-dt-node').value;
    const subnode = document.getElementById('edit-dt-subnode').value;
    
    if (!subnode) return;
    const combinedNode = `${node} - ${subnode}`;
    await loadEditBreakdowns(dept, combinedNode, selectedBreakdown);
}

async function loadEditBreakdowns(dept, combinedNode, selectedBreakdown = '') {
    const breakdownSelect = document.getElementById('edit-dt-breakdown');
    breakdownSelect.innerHTML = '<option value="">-- Выберите поломку --</option>';
    try {
        const res = await fetch(`/api/downtimes/directory/breakdowns?department=${encodeURIComponent(dept)}&node=${encodeURIComponent(combinedNode)}`);
        const breakdowns = await res.json();
        
        let found = false;
        let html = '<option value="">-- Выберите поломку --</option>';
        breakdowns.forEach(b => {
            html += `<option value="${b.breakdown}" data-comment="${b.comment || ''}">${b.breakdown}</option>`;
            if (b.breakdown === selectedBreakdown) found = true;
        });
        html += '<option value="Другое">Другое (ввести вручную)</option>';
        breakdownSelect.innerHTML = html;
        
        if (selectedBreakdown) {
            if (found) {
                breakdownSelect.value = selectedBreakdown;
            } else {
                breakdownSelect.value = "Другое";
                document.getElementById('edit-dt-desc').value = selectedBreakdown;
            }
        }
    } catch(e) {
        console.error(e);
    }
}

function onEditBreakdownChange() {
    const breakdownSelect = document.getElementById('edit-dt-breakdown');
    const selectedOption = breakdownSelect.options[breakdownSelect.selectedIndex];
    const descInput = document.getElementById('edit-dt-desc');
    
    if (selectedOption && selectedOption.value === "Другое") {
        descInput.value = '';
        descInput.placeholder = "Введите описание поломки вручную";
        descInput.focus();
    } else if (selectedOption && selectedOption.value) {
        const comment = selectedOption.getAttribute('data-comment');
        descInput.value = selectedOption.value + (comment && comment !== "None" ? ` (${comment})` : '');
    } else {
        descInput.value = '';
    }
}

async function openEditDowntimeModal(id) {
    const dt = currentDowntimes.find(d => d.id === id);
    if (!dt) return;
    
    document.getElementById('edit-dt-id').value = dt.id;
    document.getElementById('edit-dt-start').value = dt.start_time;
    document.getElementById('edit-dt-end').value = dt.end_time || '';
    document.getElementById('edit-dt-is-equipment-stop').checked = dt.is_equipment_downtime !== false;

    document.getElementById('edit-dt-desc').value = dt.description || '';
    
    await loadEditDepartments(dt.department || '', dt.node || '', dt.description || '');
    
    document.getElementById('edit-dt-modal').style.display = 'block';
}

function closeEditDowntimeModal() {
    document.getElementById('edit-dt-modal').style.display = 'none';
}

async function submitEditDowntime() {
    const id = document.getElementById('edit-dt-id').value;
    const start_time = document.getElementById('edit-dt-start').value;
    const end_time = document.getElementById('edit-dt-end').value;
    const category = null;
    const department = document.getElementById('edit-dt-dept').value;
    const node = document.getElementById('edit-dt-node').value;
    const subnode = document.getElementById('edit-dt-subnode').value;
    const combinedNode = subnode ? `${node} - ${subnode}` : node;
    const breakdownSelect = document.getElementById('edit-dt-breakdown');
    const description = breakdownSelect.value === 'Другое' ? document.getElementById('edit-dt-desc').value : (breakdownSelect.value || document.getElementById('edit-dt-desc').value);
    const is_equipment_downtime = document.getElementById('edit-dt-is-equipment-stop').checked;
    
    if (!start_time || !end_time || !department || !node) return alert("Заполните обязательные поля (Время начала, Конец, Участок, Узел)");
    
    await fetch(`/api/downtimes/${id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ start_time, end_time, category, department, node: combinedNode, description, is_equipment_downtime })
    });
    
    closeEditDowntimeModal();
    loadData();
}

async function deleteDowntime(id) {
    if (!confirm("Вы уверены, что хотите удалить этот простой?")) return;
    
    await fetch(`/api/downtimes/${id}`, {
        method: 'DELETE'
    });
    
    loadData();
}

async function createBatch() {
    if (!activeShiftId) return alert("Нет активной смены");
    const batch_number = document.getElementById('batch-number').value;
    const product_name = document.getElementById('batch-product').value;
    const stacked_stacks = getNum('batch-stacks');
    
    const res = await fetch(`/api/batches/?shift_id=${activeShiftId}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ batch_number, product_name, stacked_stacks })
    });
    if (res.ok) {
        alert("Партия создана!");
        document.getElementById('batch-number').value = '';
        document.getElementById('batch-stacks').value = '';
    } else {
        const err = await res.json();
        alert("Ошибка создания партии: " + (err.detail || "Недостаточно прав"));
    }
    loadData();
}

function toggleDefectsBlock() {
    const hasDef = document.getElementById('ds-has-defect').value;
    document.getElementById('ds-defects-block').style.display = hasDef === 'yes' ? 'grid' : 'none';
}

async function updateDestacker() {
    const batchId = document.getElementById('ds-batch-select').value;
    if (!batchId) return alert("Выберите партию");
    
    const hasDef = document.getElementById('ds-has-defect').value === 'yes';
    const data = {
        ds_condition: getNum('ds-condition'),
        ds_first_grade: getNum('ds-first'),
        ds_defect_chip: hasDef ? getNum('def-chip') : 0,
        ds_defect_scratch: hasDef ? getNum('def-scratch') : 0,
        ds_defect_bad_cut: hasDef ? getNum('def-bad-cut') : 0,
        ds_defect_stick_bottom: hasDef ? getNum('def-stick-bottom') : 0,
        ds_defect_stick_top: hasDef ? getNum('def-stick-top') : 0,
        ds_defect_broken: hasDef ? getNum('def-broken') : 0,
        ds_defect_fell_box: hasDef ? getNum('def-fell') : 0,
        ds_defect_dent: hasDef ? getNum('def-dent') : 0,
        ds_defect_thickness: hasDef ? getNum('def-thickness') : 0,
        ds_defect_delamination: hasDef ? getNum('def-delam') : 0,
        ds_defect_edge: hasDef ? getNum('def-edge') : 0
    };
    
    const res = await fetch(`/api/batches/${batchId}/destacker`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    if (res.ok) {
        alert("Разборка сохранена!");
    } else {
        const err = await res.json();
        alert("Ошибка сохранения разборщика: " + (err.detail || "Недостаточно прав"));
    }
    loadData();
}

async function updateQCD() {
    const batchId = document.getElementById('qcd-batch-select').value;
    if (!batchId) return alert("Выберите партию");
    
    const data = {
        qcd_condition: getNum('qcd-condition'),
        qcd_first_grade: getNum('qcd-first'),
        qcd_defect: getNum('qcd-defect')
    };
    
    const res = await fetch(`/api/batches/${batchId}/qcd`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    if (res.ok) {
        alert("СКК контроль сохранен!");
    } else {
        const err = await res.json();
        alert("Ошибка сохранения СКК: " + (err.detail || "Недостаточно прав"));
    }
    loadData();
}

// Рендер дашборда для Мастера (синхронизация Приход vs ЗО)
function renderMasterDashboard(shift) {
    const html = `
        <h4>Синхронизация (Склад vs ЗО)</h4>
        <ul>
            <li>Цемент: ${shift.receipt_cement} / ${shift.zo_cement} (Разница: ${shift.receipt_cement - shift.zo_cement})</li>
            <li>Асбест (всех марок): 
                ${shift.receipt_chrysotile_4_20 + shift.receipt_chrysotile_5_65 + shift.receipt_chrysotile_6_40} / 
                ${shift.zo_chrysotile_4_20 + shift.zo_chrysotile_5_65 + shift.zo_chrysotile_6_40}
            </li>
        </ul>
    `;
    document.getElementById('master-dashboard-sync').innerHTML = html;
}

function renderSummaryTable(shift) {
    const tableHeaderEl = document.querySelector('#summary-table thead');
    const tableBodyEl = document.getElementById('report-table-body');
    if (!tableHeaderEl || !tableBodyEl) return;
    
    const batches = shift.batches || [];
    
    // Определяем, какие колонки брака не пустые
    const activeDefects = new Set();
    batches.forEach(b => {
        Object.keys(DEFECT_NAMES).forEach(k => {
            if (b[k] > 0) activeDefects.add(k);
        });
    });

    const defectHeaders = Array.from(activeDefects).map(k => `<th>${DEFECT_NAMES[k]}</th>`).join('');
    
    const tableHeader = `
        <tr>
            <th>Партия</th>
            <th>Продукция</th>
            <th>Стакер (листов)</th>
            <th colspan="3" style="text-align:center; border-left: 2px solid var(--glass-border);">Дестакер</th>
            ${activeDefects.size > 0 ? `<th colspan="${activeDefects.size}" style="text-align:center; border-left: 1px solid var(--glass-border);">Детализация брака (Дестакер)</th>` : ''}
            <th colspan="3" style="text-align:center; border-left: 2px solid var(--glass-border);">СКК</th>
        </tr>
        <tr>
            <th></th><th></th><th></th>
            <th style="border-left: 2px solid var(--glass-border);">Конд.</th><th>1 Сорт</th><th>Брак</th>
            ${defectHeaders}
            <th style="border-left: 2px solid var(--glass-border);">Конд.</th><th>1 Сорт</th><th>Брак</th>
        </tr>
    `;
    
    tableHeaderEl.innerHTML = tableHeader;
    
    let rows = '';
    batches.forEach(b => {
        let defectCols = Array.from(activeDefects).map(k => `<td>${b[k] || 0}</td>`).join('');
        
        // Разница Разборщик vs СКК (проверка)
        const qcdError = (b.status === 'qcd_checked') && (b.ds_defect !== b.qcd_defect || b.ds_condition !== b.qcd_condition) 
            ? 'background: rgba(255,100,100,0.2)' : '';

        rows += `
            <tr style="${qcdError}">
                <td>${b.batch_number}</td>
                <td>${b.product_name}</td>
                <td>${b.stacked_stacks}</td>
                <td style="border-left: 2px solid var(--glass-border);">${b.ds_condition}</td>
                <td>${b.ds_first_grade}</td>
                <td><strong>${b.ds_defect}</strong></td>
                ${defectCols}
                <td style="border-left: 2px solid var(--glass-border);">${b.qcd_condition}</td>
                <td>${b.qcd_first_grade}</td>
                <td><strong>${b.qcd_defect}</strong></td>
            </tr>
        `;
    });
    
    tableBodyEl.innerHTML = rows;
}

function exportToExcel() {
    const table = document.getElementById('summary-table');
    const wb = XLSX.utils.table_to_book(table, {sheet: "Отчет по партиям"});
    XLSX.writeFile(wb, "Svodny_Otchet.xlsx");
}

async function renderDashboard() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const textCol = isLight ? '#1e293b' : '#e0e0e0';

    // Загрузка недельной аналитики
    const weeklyRes = await fetch('/api/dashboard/weekly_report');
    if (!weeklyRes.ok) {
        console.error("Ошибка загрузки недельного отчета");
        return;
    }
    const weeklyData = await weeklyRes.json();
    
    // Отрисовываем таблицу
    const tbody = document.getElementById('weekly-report-table-body');
    if (tbody) {
        tbody.innerHTML = '';
        if (weeklyData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 1rem;">Нет данных за неделю</td></tr>`;
        } else {
            weeklyData.forEach(row => {
                const devColor = row.raw_deviation > 0 ? 'var(--danger-color)' : (row.raw_deviation < 0 ? 'var(--success-color)' : 'inherit');
                const formattedDev = row.raw_deviation > 0 ? `+${row.raw_deviation}` : row.raw_deviation;
                tbody.innerHTML += `
                    <tr style="border-bottom: 1px solid var(--glass-border);">
                        <td style="padding: 0.5rem;">${row.date} (${row.shift_name === 'День' ? 'Д' : 'Н'})</td>
                        <td style="padding: 0.5rem;">${row.line}</td>
                        <td style="padding: 0.5rem;">${row.master_name}</td>
                        <td style="padding: 0.5rem; text-align: right; font-weight: bold;">${row.lfm_sheets.toLocaleString()}</td>
                        <td style="padding: 0.5rem; text-align: right; color: var(--success-color);">${row.qcd_condition.toLocaleString()}</td>
                        <td style="padding: 0.5rem; text-align: right; color: var(--accent-color);">${row.qcd_first_grade.toLocaleString()}</td>
                        <td style="padding: 0.5rem; text-align: right; color: var(--danger-color);">${row.qcd_defect.toLocaleString()}</td>
                        <td style="padding: 0.5rem; text-align: right; color: ${devColor}; font-weight: bold;">${formattedDev} кг</td>
                    </tr>
                `;
            });
        }
    }

    // Готовим данные для графиков
    const chartShifts = [...weeklyData].reverse();
    const labels = chartShifts.map(s => `${s.date.split('-').slice(1).join('.')}\n(${s.shift_name[0]})`);
    const lfmData = chartShifts.map(s => s.lfm_sheets);
    const qcdCondData = chartShifts.map(s => s.qcd_condition);
    const devData = chartShifts.map(s => s.raw_deviation);

    // 1. Формовка vs Кондиция (Bar)
    const ctxProd = document.getElementById('chart-weekly-production')?.getContext('2d');
    if (ctxProd) {
        if (chartWeeklyProduction) chartWeeklyProduction.destroy();
        chartWeeklyProduction = new Chart(ctxProd, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Формовка (ЛФМ)',
                        data: lfmData,
                        backgroundColor: 'rgba(23, 162, 184, 0.8)',
                        borderColor: '#17a2b8',
                        borderWidth: 1
                    },
                    {
                        label: 'Кондиция (СКК)',
                        data: qcdCondData,
                        backgroundColor: 'rgba(40, 167, 69, 0.8)',
                        borderColor: '#28a745',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { ticks: { color: textCol } },
                    x: { ticks: { color: textCol } }
                },
                plugins: { legend: { labels: { color: textCol } } }
            }
        });
    }

    // 2. Отклонения по сырью (Bar)
    const ctxDev = document.getElementById('chart-weekly-deviation')?.getContext('2d');
    if (ctxDev) {
        if (chartWeeklyDeviation) chartWeeklyDeviation.destroy();
        
        const bgColors = devData.map(val => val > 0 ? 'rgba(220, 53, 69, 0.8)' : 'rgba(40, 167, 69, 0.8)');
        const borderColors = devData.map(val => val > 0 ? '#dc3545' : '#28a745');
        
        chartWeeklyDeviation = new Chart(ctxDev, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Отклонение (кг)',
                    data: devData,
                    backgroundColor: bgColors,
                    borderColor: borderColors,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { ticks: { color: textCol } },
                    x: { ticks: { color: textCol } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    // 3. Загружаем простои (KPIs и структуру)
    const resStats = await fetch('/api/dashboard/stats');
    if (resStats.ok) {
        const stats = await resStats.json();
        
        document.getElementById('kpi-dt-minutes').innerText = stats.downtimes.total_minutes + ' мин';
        document.getElementById('kpi-dt-tons').innerText = stats.downtimes.lost_tons.toFixed(1) + ' т';
        document.getElementById('kpi-dt-tenge').innerText = stats.downtimes.lost_tenge.toLocaleString() + ' ₸';

        // Топ узлов простоев
        const ctxDtNodes = document.getElementById('chart-dt-nodes').getContext('2d');
        if (chartDtNodes) chartDtNodes.destroy();
        
        const nodeLabels = stats.downtimes.top_reasons.map(r => r.node);
        const nodeData = stats.downtimes.top_reasons.map(r => r.count);
        
        chartDtNodes = new Chart(ctxDtNodes, {
            type: 'bar',
            data: {
                labels: nodeLabels.length ? nodeLabels : ['Нет данных'],
                datasets: [{
                    label: 'Кол-во остановок',
                    data: nodeData.length ? nodeData : [0],
                    backgroundColor: 'rgba(220, 53, 69, 0.8)',
                    borderColor: '#dc3545',
                    borderWidth: 1
                }]
            },
            options: { 
                plugins: { legend: { display: false } },
                scales: {
                    y: { ticks: { color: textCol, stepSize: 1 }, beginAtZero: true },
                    x: { ticks: { color: textCol } }
                }
            }
        });

        // Простои по категориям
        const ctxDtCategory = document.getElementById('chart-dt-category').getContext('2d');
        if (chartDtCategory) chartDtCategory.destroy();

        const catLabels = Object.keys(stats.downtimes.by_category || {});
        const catData = Object.values(stats.downtimes.by_category || {});

        const finalLabels = catLabels.length ? catLabels : ['Нет данных'];
        const finalData = catData.length ? catData : [0];

        chartDtCategory = new Chart(ctxDtCategory, {
            type: 'doughnut',
            data: {
                labels: finalLabels,
                datasets: [{
                    data: finalData,
                    backgroundColor: [
                        'rgba(23, 162, 184, 0.8)',  // Teal
                        'rgba(255, 193, 7, 0.8)',   // Yellow
                        'rgba(40, 167, 69, 0.8)',   // Green
                        'rgba(220, 53, 69, 0.8)',   // Red
                        'rgba(111, 66, 193, 0.8)'   // Purple
                    ],
                    borderColor: 'var(--glass-border)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: textCol, boxWidth: 12 }
                    }
                }
            }
        });
    }
}


async function fetchMaterialsSummary(shiftId) {
    try {
        const res = await fetch(`/api/shifts/${shiftId}/materials_report`);
        if (!res.ok) return;
        const data = await res.json();
        
        const ind = document.getElementById('shift-dev-indicator');
        const val = document.getElementById('shift-dev-val');
        
        if (ind && val) {
            ind.style.display = 'block';
            val.innerText = `${data.total_deviation_kg} кг`;
            if (data.total_deviation_kg > 0) {
                val.style.color = 'var(--danger-color)'; // Перерасход
            } else if (data.total_deviation_kg < 0) {
                val.style.color = 'var(--success-color)'; // Экономия
            } else {
                val.style.color = 'var(--text-primary)';
            }
        }
    } catch (e) {
        console.error("Failed to fetch materials summary", e);
    }
}

async function loadMaterialsReport() {
    if (!activeShiftId) {
        document.getElementById('materials-report-list').innerHTML = '<tr><td colspan="7" style="text-align:center;">Нет активной смены</td></tr>';
        return;
    }
    
    try {
        const res = await fetch(`/api/shifts/${activeShiftId}/materials_report`);
        const data = await res.json();
        
        const tbody = document.getElementById('materials-report-list');
        if (!data.details || data.details.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Нет данных</td></tr>';
            return;
        }
        
        const html = data.details.map(d => {
            let color = 'inherit';
            if (d.deviation > 0) color = 'var(--danger-color)';
            else if (d.deviation < 0) color = 'var(--success-color)';
            
            const unitAct = d.unit_actual !== undefined ? d.unit_actual : 0;
            const unitTheo = d.unit_theoretical !== undefined ? d.unit_theoretical : 0;
            const unitDev = d.unit_deviation !== undefined ? d.unit_deviation : 0;
            
            return `
                <tr>
                    <td>${d.material}</td>
                    <td>${d.actual}</td>
                    <td>${d.theoretical}</td>
                    <td style="color: ${color}; font-weight: bold;">${d.deviation > 0 ? '+' : ''}${d.deviation}</td>
                    <td>${unitAct}</td>
                    <td>${unitTheo}</td>
                    <td style="color: ${color}; font-weight: bold;">${unitDev > 0 ? '+' : ''}${unitDev}</td>
                </tr>
            `;
        }).join('');
        
        tbody.innerHTML = html;
        
    } catch (e) {
        document.getElementById('materials-report-list').innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--danger-color);">Ошибка загрузки</td></tr>';
    }
}

function toggleRangeControls() {
    const rangeType = document.getElementById('daily-report-range-type').value;
    const monthPicker = document.getElementById('daily-report-month');
    const weekSelect = document.getElementById('daily-report-week-select');
    const dayPicker = document.getElementById('daily-report-day-picker');
    
    if (rangeType === 'month') {
        monthPicker.style.display = 'inline-block';
        weekSelect.style.display = 'none';
        dayPicker.style.display = 'none';
    } else if (rangeType === 'week') {
        monthPicker.style.display = 'inline-block';
        weekSelect.style.display = 'inline-block';
        dayPicker.style.display = 'none';
    } else if (rangeType === 'day') {
        monthPicker.style.display = 'none';
        weekSelect.style.display = 'none';
        dayPicker.style.display = 'inline-block';
    }
}

function getDailyReportDates() {
    const rangeType = document.getElementById('daily-report-range-type').value;
    let startDate = '', endDate = '';
    
    if (rangeType === 'month') {
        const monthVal = document.getElementById('daily-report-month').value;
        if (!monthVal) return null;
        const [y, m] = monthVal.split('-');
        const lastDay = new Date(y, m, 0).getDate();
        startDate = `${monthVal}-01`;
        endDate = `${monthVal}-${String(lastDay).padStart(2, '0')}`;
    } else if (rangeType === 'week') {
        const monthVal = document.getElementById('daily-report-month').value;
        if (!monthVal) return null;
        const [y, m] = monthVal.split('-');
        const weekVal = parseInt(document.getElementById('daily-report-week-select').value) || 1;
        let startDay = 1, endDay = 7;
        if (weekVal === 2) { startDay = 8; endDay = 14; }
        else if (weekVal === 3) { startDay = 15; endDay = 21; }
        else if (weekVal === 4) { startDay = 22; endDay = 28; }
        else if (weekVal === 5) { startDay = 29; endDay = new Date(y, m, 0).getDate(); }
        startDate = `${monthVal}-${String(startDay).padStart(2, '0')}`;
        endDate = `${monthVal}-${String(endDay).padStart(2, '0')}`;
    } else if (rangeType === 'day') {
        const dayVal = document.getElementById('daily-report-day-picker').value;
        if (!dayVal) return null;
        startDate = dayVal;
        endDate = dayVal;
    }
    
    return { startDate, endDate };
}

async function loadDailyReport() {
    const dates = getDailyReportDates();
    if (!dates) return;
    const { startDate, endDate } = dates;
    const line = document.getElementById('daily-report-line').value; // 'lfm1', 'lfm2'
    const brigade = document.getElementById('daily-report-brigade').value;
    
    let url = `/api/dashboard/daily_report?start_date=${startDate}&end_date=${endDate}`;
    if (brigade) {
        url += `&shift_number=${brigade}`;
    }
    
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Ошибка загрузки");
        const report = await res.json();
        
        const lineData = line === 'lfm1' ? report.data.line_1 : report.data.line_2;
        
        // Update KPI summary cards
        updateDailyReportKPI(lineData, report.days, report.start_date);
        
        renderDailyChart('sheets', 'chart-daily-sheets', lineData, report.days, 'sheets', report.start_date);
        renderDailyChart('tons', 'chart-daily-tons', lineData, report.days, 'tons', report.start_date);
    } catch (e) {
        console.error(e);
    }
}

function updateDailyReportKPI(lineData, daysCount, startDateStr) {
    let shiftsCount = 0;
    let totalSheets = 0;
    let totalTons = 0;
    let sumPlanPercent = 0;
    let planPercentCount = 0;
    let totalFirstGrade = 0;
    let totalDefects = 0;

    for (let d = 0; d < daysCount; d++) {
        const dObj = new Date(startDateStr);
        dObj.setDate(dObj.getDate() + d);
        const dStr = dObj.toISOString().split('T')[0];

        const dayInfo = lineData[dStr] ? lineData[dStr]["День"] : null;
        const nightInfo = lineData[dStr] ? lineData[dStr]["Ночь"] : null;

        [dayInfo, nightInfo].forEach(shiftInfo => {
            if (!shiftInfo) return;

            const sheets = shiftInfo.sheets || 0;
            const tons = shiftInfo.tons || 0;
            const planSheets = shiftInfo.plan_sheets || 0;
            const firstGrade = shiftInfo.first_grade || 0;
            const defect = shiftInfo.defect || 0;

            if (planSheets > 0 || sheets > 0) {
                shiftsCount++;
                totalSheets += sheets;
                totalTons += tons;
                totalFirstGrade += firstGrade;
                totalDefects += defect;

                if (planSheets > 0) {
                    const percent = (sheets / planSheets) * 100;
                    sumPlanPercent += percent;
                    planPercentCount++;
                }
            }
        });
    }

    const avgPlanPercent = planPercentCount > 0 ? Math.round(sumPlanPercent / planPercentCount) : 0;
    const totalProduced = totalFirstGrade + totalDefects;
    const defectPercent = totalProduced > 0 ? ((totalDefects / totalProduced) * 100).toFixed(1) : "0.0";

    const kpiShifts = document.getElementById('kpi-shifts-count');
    const kpiSheets = document.getElementById('kpi-total-sheets');
    const kpiTons = document.getElementById('kpi-total-tons');
    const kpiPlan = document.getElementById('kpi-avg-plan-percent');
    const kpiDefect = document.getElementById('kpi-defect-percent');

    if (kpiShifts) kpiShifts.innerText = shiftsCount;
    if (kpiSheets) kpiSheets.innerText = totalSheets.toLocaleString();
    if (kpiTons) kpiTons.innerText = totalTons.toFixed(1);
    if (kpiPlan) kpiPlan.innerText = avgPlanPercent + "%";
    if (kpiDefect) kpiDefect.innerText = defectPercent + "%";
}

function renderDailyChart(chartInstanceKey, canvasId, lineData, daysCount, unit, startDateStr) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    if (chartInstanceKey === 'sheets' && chartDailySheets) chartDailySheets.destroy();
    if (chartInstanceKey === 'tons' && chartDailyTons) chartDailyTons.destroy();
    
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const textCol = isLight ? '#1e293b' : '#e0e0e0';
    
    const labels = [];
    const dayData = [];
    const nightData = [];
    const bgColorsDay = [];
    const bgColorsNight = [];
    const dayPlanData = [];
    const nightPlanData = [];
    
    for(let d=0; d<daysCount; d++) {
        const dObj = new Date(startDateStr);
        dObj.setDate(dObj.getDate() + d);
        const dStr = dObj.toISOString().split('T')[0];
        const displayLabel = dObj.toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'});
        
        labels.push(displayLabel);
        
        const dVal = lineData[dStr] ? lineData[dStr]["День"][unit] : 0;
        const nVal = lineData[dStr] ? lineData[dStr]["Ночь"][unit] : 0;
        
        const planKey = unit === 'sheets' ? 'plan_sheets' : 'plan_tons';
        const dPlan = lineData[dStr] ? lineData[dStr]["День"][planKey] : 0;
        const nPlan = lineData[dStr] ? lineData[dStr]["Ночь"][planKey] : 0;
        
        dayData.push(dVal);
        nightData.push(nVal);
        dayPlanData.push(dPlan);
        nightPlanData.push(nPlan);
        
        // Day: Light Green (Met Plan) / Light Red (Failed Plan)
        bgColorsDay.push(dVal >= dPlan ? '#4ade80' : '#f87171');
        // Night: Dark Green (Met Plan) / Dark Red (Failed Plan)
        bgColorsNight.push(nVal >= nPlan ? '#166534' : '#991b1b');
    }
    
    const chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'План (День)',
                    type: 'line',
                    data: dayPlanData,
                    borderColor: '#eab308', // Yellow
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0
                },
                {
                    label: 'План (Ночь)',
                    type: 'line',
                    data: nightPlanData,
                    borderColor: '#3b82f6', // Blue
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0
                },
                {
                    label: 'День',
                    data: dayData,
                    backgroundColor: bgColorsDay,
                },
                {
                    label: 'Ночь',
                    data: nightData,
                    backgroundColor: bgColorsNight,
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
                                {
                                    text: 'План (День)',
                                    strokeStyle: '#eab308',
                                    lineWidth: 2,
                                    lineDash: [5, 5],
                                    fillStyle: 'transparent',
                                    hidden: !chart.isDatasetVisible(0),
                                    datasetIndex: 0
                                },
                                {
                                    text: 'План (Ночь)',
                                    strokeStyle: '#3b82f6',
                                    lineWidth: 2,
                                    lineDash: [5, 5],
                                    fillStyle: 'transparent',
                                    hidden: !chart.isDatasetVisible(1),
                                    datasetIndex: 1
                                },
                                {
                                    text: 'День (План выполнен)',
                                    fillStyle: '#4ade80',
                                    strokeStyle: '#4ade80',
                                    lineWidth: 0,
                                    hidden: !chart.isDatasetVisible(2),
                                    datasetIndex: 2
                                },
                                {
                                    text: 'День (План не выполнен)',
                                    fillStyle: '#f87171',
                                    strokeStyle: '#f87171',
                                    lineWidth: 0,
                                    hidden: !chart.isDatasetVisible(2),
                                    datasetIndex: 2
                                },
                                {
                                    text: 'Ночь (План выполнен)',
                                    fillStyle: '#166534',
                                    strokeStyle: '#166534',
                                    lineWidth: 0,
                                    hidden: !chart.isDatasetVisible(3),
                                    datasetIndex: 3
                                },
                                {
                                    text: 'Ночь (План не выполнен)',
                                    fillStyle: '#991b1b',
                                    strokeStyle: '#991b1b',
                                    lineWidth: 0,
                                    hidden: !chart.isDatasetVisible(3),
                                    datasetIndex: 3
                                }
                            ];
                        }
                    },
                    onClick: function(e, legendItem, legend) {
                        const index = legendItem.datasetIndex;
                        const ci = legend.chart;
                        if (ci.isDatasetVisible(index)) {
                            ci.hide(index);
                        } else {
                            ci.show(index);
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        afterLabel: function(context) {
                            const dIndex = context.dataIndex;
                            const dObj = new Date(startDateStr);
                            dObj.setDate(dObj.getDate() + dIndex);
                            const dStr = dObj.toISOString().split('T')[0];
                            const sName = context.datasetIndex === 2 ? "День" : "Ночь";
                            const planKey = unit === 'sheets' ? 'plan_sheets' : 'plan_tons';
                            const planVal = lineData[dStr] ? lineData[dStr][sName][planKey] : 0;
                            const firstVal = lineData[dStr] ? lineData[dStr][sName]["first_grade"] : 0;
                            const defVal = lineData[dStr] ? lineData[dStr][sName]["defect"] : 0;
                            return `План: ${planVal.toFixed(1)}\n1 сорт: ${firstVal} шт\nБрак: ${defVal} шт`;
                        }
                    }
                }
            },
            scales: {
                y: { ticks: { color: textCol }, title: {display: true, text: unit === 'sheets' ? 'Листы' : 'Тонны', color: textCol} },
                x: { ticks: { color: textCol } }
            }
        }
    });
    if (chartInstanceKey === 'sheets') chartDailySheets = chart;
    else chartDailyTons = chart;
}

async function exportDailyReportPDF() {
    const dates = getDailyReportDates();
    if (!dates) return;
    const { startDate, endDate } = dates;
    const line = document.getElementById('daily-report-line').value;
    const brigade = document.getElementById('daily-report-brigade').value;
    
    let url = `/api/dashboard/daily_report?start_date=${startDate}&end_date=${endDate}`;
    if (brigade) {
        url += `&shift_number=${brigade}`;
    }
    
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Ошибка загрузки данных с сервера");
        const report = await res.json();
        
        let totalSheets = 0, totalTons = 0, planSheets = 0, planTons = 0;
        let totalFirst = 0, totalDefect = 0;
        
        const processLineData = (lineData) => {
            for (const date in lineData) {
                for (const shiftType in lineData[date]) {
                    const s = lineData[date][shiftType];
                    totalSheets += s.sheets || 0;
                    totalTons += s.tons || 0;
                    planSheets += s.plan_sheets || 0;
                    planTons += s.plan_tons || 0;
                    totalFirst += s.first_grade || 0;
                    totalDefect += s.defect || 0;
                }
            }
        };

        const lineData = line === 'lfm1' ? report.data.line_1 : report.data.line_2;
        processLineData(lineData);

        const lineName = line === 'lfm1' ? 'ЛФМ-1' : 'ЛФМ-2';
        const pct = planSheets > 0 ? ((totalSheets / planSheets) * 100).toFixed(1) : '0';

        // Функция: снять скриншот графика Chart.js с БЕЛЫМ фоном
        const captureChartWhiteBg = (chartInstance) => {
            const src = chartInstance.canvas;
            const tmp = document.createElement('canvas');
            tmp.width = src.width;
            tmp.height = src.height;
            const ctx2 = tmp.getContext('2d');
            ctx2.fillStyle = 'white';
            ctx2.fillRect(0, 0, tmp.width, tmp.height);
            ctx2.drawImage(src, 0, 0);
            return tmp.toDataURL('image/jpeg', 0.95);
        };

        const chartImages = [];
        if (typeof chartDailySheets !== 'undefined' && chartDailySheets !== null) {
            chartImages.push({ label: 'В листах', img: captureChartWhiteBg(chartDailySheets) });
        }
        if (typeof chartDailyTons !== 'undefined' && chartDailyTons !== null) {
            chartImages.push({ label: 'В тоннах', img: captureChartWhiteBg(chartDailyTons) });
        }

        const startDt = new Date(startDate);
        const endDt = new Date(endDate);
        const fmtDate = (d) => d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const periodStr = startDate === endDate ? fmtDate(startDt) : `${fmtDate(startDt)} — ${fmtDate(endDt)}`;

        // Рисуем шапку документа на Canvas (так кириллица отображается корректно)
        const CW = 1800; // ширина холста в пикселях
        const HEADER_H = 160; // более компактная шапка
        const hCanvas = document.createElement('canvas');
        hCanvas.width = CW;
        hCanvas.height = HEADER_H;
        const hCtx = hCanvas.getContext('2d');

        hCtx.fillStyle = '#ffffff';
        hCtx.fillRect(0, 0, CW, HEADER_H);

        // Заголовок
        hCtx.fillStyle = '#1a1a2e';
        hCtx.font = 'bold 48px Arial';
        hCtx.textAlign = 'center';
        hCtx.fillText('Ежедневная сводка мастера', CW / 2, 48);

        // Подзаголовок: период ОТ и ДО + линия
        hCtx.fillStyle = '#444';
        hCtx.font = '30px Arial';
        hCtx.fillText(`Период: ${periodStr}  |  Линия: ${lineName}`, CW / 2, 85);

        // Линия-разделитель
        hCtx.strokeStyle = '#ccc';
        hCtx.lineWidth = 1.5;
        hCtx.beginPath();
        hCtx.moveTo(60, 100);
        hCtx.lineTo(CW - 60, 100);
        hCtx.stroke();

        // Блок статистики — компактный, в одну строку
        const statsY = 135;
        const cols = [CW * 0.18, CW * 0.5, CW * 0.82];
        const labels = ['План', 'Факт', 'Выполнение'];
        const vals = [
            `${planSheets.toLocaleString('ru-RU')} л  /  ${planTons.toFixed(1)} т`,
            `${totalSheets.toLocaleString('ru-RU')} л  /  ${totalTons.toFixed(1)} т`,
            `${pct}%`
        ];

        labels.forEach((lbl, i) => {
            hCtx.textAlign = 'center';
            hCtx.fillStyle = '#888';
            hCtx.font = '24px Arial';
            hCtx.fillText(lbl, cols[i], statsY - 25);
            hCtx.fillStyle = '#111';
            hCtx.font = 'bold 28px Arial';
            hCtx.fillText(vals[i], cols[i], statsY);
            
            // Add quality text under Fact
            if (i === 1) {
                hCtx.fillStyle = '#555';
                hCtx.font = '20px Arial';
                hCtx.fillText(`1 сорт: ${totalFirst} шт  |  Брак: ${totalDefect} шт`, cols[i], statsY + 25);
            }
        });

        const headerImg = hCanvas.toDataURL('image/jpeg', 0.95);

        // Собираем PDF через jsPDF
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const pageW = 297;
        const pageH = 210;
        const margin = 10;
        const contentW = pageW - margin * 2;

        // Вставляем шапку (компактная: 160px / 1800px * contentW ≈ ~24мм)
        const headerMmH = (HEADER_H / CW) * contentW;
        doc.addImage(headerImg, 'JPEG', margin, margin, contentW, headerMmH);

        // Вставляем графики
        let y = margin + headerMmH + 5;

        for (let i = 0; i < chartImages.length; i++) {
            if (i > 0) {
                doc.addPage();
                y = margin;
            }
            if (chartImages.length > 1) {
                // Подпись линии как картинка-canvas
                const lblCanvas = document.createElement('canvas');
                lblCanvas.width = CW;
                lblCanvas.height = 60;
                const lCtx = lblCanvas.getContext('2d');
                lCtx.fillStyle = '#ffffff';
                lCtx.fillRect(0, 0, CW, 60);
                lCtx.fillStyle = '#333';
                lCtx.font = 'bold 36px Arial';
                lCtx.textAlign = 'left';
                lCtx.fillText(chartImages[i].label, 0, 45);
                const lblH = (60 / CW) * contentW;
                doc.addImage(lblCanvas.toDataURL('image/jpeg', 0.9), 'JPEG', margin, y, contentW, lblH);
                y += lblH + 2;
            }

            // Добавляем график, вписывая его в оставшееся место страницы
            const availH = pageH - y - margin;
            const chartAspect = chartImages[i].img ? 2.5 : 2; // chart.js charts are wide
            const chartH = Math.min(availH, contentW / chartAspect);
            doc.addImage(chartImages[i].img, 'JPEG', margin, y, contentW, chartH);
            y += chartH;
        }

        doc.save(`report_${startDate}_${line}.pdf`);

    } catch (e) {
        alert("Ошибка при выгрузке PDF: " + e.message);
        console.error(e);
    }
}

async function loadWeeklyReport() {
    const startDate = document.getElementById('weekly-report-start-date').value;
    if (!startDate) {
        const d = new Date();
        const day = d.getDay() || 7; // Get current day number, convert Sun(0) to 7
        if (day !== 1) d.setHours(-24 * (day - 1)); // Set to Monday
        document.getElementById('weekly-report-start-date').value = d.toISOString().split('T')[0];
        return loadWeeklyReport();
    }
    
    try {
        const res = await fetch(`/api/dashboard/weekly?start_date=${startDate}`);
        if (!res.ok) throw new Error("Ошибка загрузки");
        const report = await res.json();
        
        const tbody = document.getElementById('weekly-report-body');
        if (!report.data || report.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">Нет данных за выбранную неделю</td></tr>';
            return;
        }
        
        tbody.innerHTML = report.data.map(d => {
            const pct = d.plan_sheets > 0 ? ((d.fact_sheets / d.plan_sheets) * 100).toFixed(1) : 0;
            const pctColor = pct < 100 ? 'var(--danger-color)' : 'var(--success-color)';
            
            // Format 1st grade & defect as "N шт (X%)"
            const dsTotal = d.ds_first_grade + d.ds_defect;
            const ds1stPct = dsTotal > 0 ? ((d.ds_first_grade / dsTotal) * 100).toFixed(1) : 0;
            const dsDefPct = dsTotal > 0 ? ((d.ds_defect / dsTotal) * 100).toFixed(1) : 0;
            
            return `
                <tr>
                    <td>${d.date}</td>
                    <td>${d.shift_name} (${d.line})</td>
                    <td>${d.master}</td>
                    <td>${d.plan_sheets} / ${d.plan_tons}</td>
                    <td>${d.fact_sheets} / ${d.fact_tons}</td>
                    <td style="color: ${pctColor}; font-weight: bold;">${pct}%</td>
                    <td>${d.ds_first_grade} (${ds1stPct}%)</td>
                    <td>${d.ds_defect} (${dsDefPct}%)</td>
                    <td style="color: var(--accent-color);">${d.note || ''}</td>
                </tr>
            `;
        }).join('');
        
    } catch (e) {
        console.error(e);
        document.getElementById('weekly-report-body').innerHTML = '<tr><td colspan="9" style="text-align:center; color: var(--danger-color);">Ошибка загрузки</td></tr>';
    }
}

async function exportWeeklyReportPDF() {
    const startDate = document.getElementById('weekly-report-start-date').value;
    if (!startDate) return;
    
    try {
        const res = await fetch(`/api/dashboard/weekly?start_date=${startDate}`);
        if (!res.ok) throw new Error("Ошибка загрузки");
        const report = await res.json();
        
        if (!report.data || report.data.length === 0) {
            return alert("Нет данных для выгрузки");
        }
        
        // Use hidden canvas to render the table
        const CW = 2000;
        const HEADER_H = 150;
        const ROW_H = 60;
        const hCanvas = document.createElement('canvas');
        hCanvas.width = CW;
        hCanvas.height = HEADER_H + ROW_H * (report.data.length + 1) + 20;
        const ctx = hCanvas.getContext('2d');
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, hCanvas.width, hCanvas.height);
        
        // Header
        ctx.fillStyle = '#111';
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Еженедельный отчет', CW / 2, 60);
        
        ctx.fillStyle = '#444';
        ctx.font = '30px Arial';
        ctx.fillText(`Период: ${report.start_date} — ${report.end_date}`, CW / 2, 110);
        
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(50, 130);
        ctx.lineTo(CW - 50, 130);
        ctx.stroke();
        
        // Table Headers
        let y = HEADER_H + 40;
        const cols = [50, 200, 450, 750, 1050, 1300, 1450, 1650, 1850];
        const headers = ['Дата', 'Смена (Линия)', 'Мастер', 'План (л/т)', 'Факт (л/т)', 'Вып. %', '1-й сорт', 'Брак', 'Прим.'];
        
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#333';
        headers.forEach((h, i) => {
            ctx.fillText(h, cols[i], y);
        });
        
        y += 20;
        ctx.beginPath();
        ctx.moveTo(50, y);
        ctx.lineTo(CW - 50, y);
        ctx.stroke();
        
        // Table Rows
        ctx.font = '24px Arial';
        report.data.forEach(d => {
            y += ROW_H;
            
            const pct = d.plan_sheets > 0 ? ((d.fact_sheets / d.plan_sheets) * 100).toFixed(1) : 0;
            const dsTotal = d.ds_first_grade + d.ds_defect;
            const ds1stPct = dsTotal > 0 ? ((d.ds_first_grade / dsTotal) * 100).toFixed(1) : 0;
            const dsDefPct = dsTotal > 0 ? ((d.ds_defect / dsTotal) * 100).toFixed(1) : 0;
            
            ctx.fillStyle = '#000';
            ctx.fillText(d.date, cols[0], y);
            ctx.fillText(`${d.shift_name} (${d.line})`, cols[1], y);
            ctx.fillText(d.master, cols[2], y);
            ctx.fillText(`${d.plan_sheets} / ${d.plan_tons}`, cols[3], y);
            ctx.fillText(`${d.fact_sheets} / ${d.fact_tons}`, cols[4], y);
            
            ctx.fillStyle = pct < 100 ? '#dc3545' : '#28a745';
            ctx.fillText(`${pct}%`, cols[5], y);
            
            ctx.fillStyle = '#000';
            ctx.fillText(`${d.ds_first_grade} (${ds1stPct}%)`, cols[6], y);
            ctx.fillText(`${d.ds_defect} (${dsDefPct}%)`, cols[7], y);
            
            ctx.fillStyle = '#ffc107';
            ctx.fillText(d.note || '', cols[8], y);
            
            ctx.strokeStyle = '#eee';
            ctx.beginPath();
            ctx.moveTo(50, y + 20);
            ctx.lineTo(CW - 50, y + 20);
            ctx.stroke();
        });
        
        const imgData = hCanvas.toDataURL('image/jpeg', 0.95);
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const contentW = 297 - 20;
        const hMm = (hCanvas.height / CW) * contentW;
        doc.addImage(imgData, 'JPEG', 10, 10, contentW, hMm);
        
        doc.save(`weekly_report_${startDate}.pdf`);
        
    } catch (e) {
        alert("Ошибка при выгрузке PDF: " + e.message);
        console.error(e);
    }
}

async function loadArchive() {
    const month = document.getElementById('archive-month').value;
    if (!month) {
        const now = new Date();
        const m = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        document.getElementById('archive-month').value = m;
        return loadArchive();
    }
    
    try {
        const boardRes = await fetch(`/api/dashboard/shift_board?month=${month}`);
        if (boardRes.ok) {
            const boardData = await boardRes.json();
            renderShiftBoard(boardData);
        }
        
        const res = await fetch('/api/shifts/all');
        if (res.ok) {
            const shifts = await res.json();
            const filtered = shifts.filter(s => s.date && s.date.startsWith(month));
            
            const tbody = document.getElementById('archive-table-body');
            if (filtered.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">Нет смен в этом месяце</td></tr>';
            } else {
                tbody.innerHTML = filtered.map(s => {
                    const recTons = ((s.receipt_chrysotile_4_20||0) + (s.receipt_chrysotile_5_65||0) + (s.receipt_chrysotile_6_40||0) + (s.receipt_cement||0) + (s.receipt_cellulose||0) + (s.receipt_crushed_slate||0) + (s.receipt_asbozurit||0) + (s.receipt_fiberglass||0)) / 1000;
                    const zoTons = ((s.zo_chrysotile_4_20||0) + (s.zo_chrysotile_5_65||0) + (s.zo_chrysotile_6_40||0) + (s.zo_cement||0) + (s.zo_cellulose||0) + (s.zo_crushed_slate||0) + (s.zo_asbozurit||0) + (s.zo_fiberglass||0)) / 1000;
                    
                    return `
                        <tr>
                            <td>${s.id}</td>
                            <td>${s.date}</td>
                            <td>${s.shift_name}</td>
                            <td>${s.line}</td>
                            <td>${s.status === 'closed' ? '<span style="color:var(--success-color)">Закрыта</span>' : '<span style="color:var(--accent-color)">Открыта</span>'}</td>
                            <td>${recTons.toFixed(1)} т</td>
                            <td>${zoTons.toFixed(1)} т</td>
                            <td>${(s.batches||[]).length} шт</td>
                            <td>
                                <button onclick="exportShift(${s.id})" style="background: #217346; width: auto; padding: 0.3rem 0.6rem; font-size: 0.8rem;">🖨 Печать</button>
                                <button onclick="window.open('/api/shifts/${s.id}/download_passport', '_blank')" style="background: #1F4E78; width: auto; padding: 0.3rem 0.6rem; font-size: 0.8rem; margin-left: 0.3rem;">🌐 Excel Паспорт</button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }
    } catch (e) {
        console.error(e);
    }
}

function renderShiftBoard(boardData) {
    const container = document.getElementById('shift-board-container');
    if (Object.keys(boardData).length === 0) {
        container.innerHTML = '<p style="text-align:center; color: var(--text-secondary);">Нет данных по бригадам за этот месяц</p>';
        return;
    }
    
    let html = '';
    for (const [master, shifts] of Object.entries(boardData)) {
        let rows = '';
        let totalPlanSheets = 0, totalFactSheets = 0;
        let totalPlanTons = 0, totalFactTons = 0;
        
        shifts.forEach(s => {
            totalPlanSheets += s.plan_sheets;
            totalFactSheets += s.fact_sheets;
            totalPlanTons += s.plan_tons;
            totalFactTons += s.fact_tons;
            
            const isDanger = s.fact_sheets < s.plan_sheets;
            const factSheetsColor = isDanger ? 'var(--danger-color)' : 'var(--success-color)';
            
            rows += `
                <tr>
                    <td>${s.date}</td>
                    <td>${s.shift_name}</td>
                    <td>${s.plan_sheets}</td>
                    <td style="color: ${factSheetsColor}; font-weight: bold;">${s.fact_sheets}</td>
                    <td>${s.plan_tons.toFixed(1)}</td>
                    <td style="color: ${factSheetsColor}; font-weight: bold;">${s.fact_tons.toFixed(1)}</td>
                    <td>
                        <button onclick="exportShift(${s.shift_id})" style="background: #217346; padding: 0.2rem 0.5rem; font-size: 0.8rem; border-radius: 4px; width:auto; border:none; cursor:pointer;" title="Печать смены">🖨</button>
                        <button onclick="window.open('/api/shifts/${s.shift_id}/download_passport', '_blank')" style="background: #1F4E78; padding: 0.2rem 0.5rem; font-size: 0.8rem; border-radius: 4px; width:auto; border:none; cursor:pointer; margin-left: 0.3rem;" title="Excel Паспорт">🌐</button>
                    </td>
                </tr>
            `;
        });
        
        const isTotalDanger = totalFactSheets < totalPlanSheets;
        const totalColor = isTotalDanger ? 'var(--danger-color)' : 'var(--success-color)';
        rows += `
            <tr style="background: rgba(255,255,255,0.05); font-weight: bold;">
                <td colspan="2" style="text-align:right;">ИТОГО:</td>
                <td>${totalPlanSheets}</td>
                <td style="color: ${totalColor}">${totalFactSheets}</td>
                <td>${totalPlanTons.toFixed(1)}</td>
                <td style="color: ${totalColor}">${totalFactTons.toFixed(1)}</td>
                <td></td>
            </tr>
        `;
        
        html += `
            <div style="background: rgba(0,0,0,0.2); padding: 1rem; border-radius: 8px;">
                <h5 style="margin-bottom: 0.5rem; color: var(--accent-color); font-size: 1.1rem;">Бригада: ${master}</h5>
                <div style="overflow-x: auto;">
                    <table class="table-glass" style="font-size: 0.85rem; width: 100%; border-collapse: collapse; text-align: left;">
                        <thead>
                            <tr>
                                <th>Дата</th>
                                <th>Смена</th>
                                <th>План (лист)</th>
                                <th>Факт (лист)</th>
                                <th>План (т)</th>
                                <th>Факт (т)</th>
                                <th>Печать</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
}

async function exportWeek() {
    const start = document.getElementById('archive-week-start').value;
    if (!start) return alert("Выберите начало недели");
    
    try {
        const response = await fetch(`/api/dashboard/export_week?start_date=${start}`);
        if (!response.ok) throw new Error("Download failed");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `week_${start}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
        alert("Ошибка при выгрузке: " + e.message);
    }
}

async function exportShift(shiftId) {
    try {
        const response = await fetch(`/api/dashboard/export_shift?shift_id=${shiftId}`);
        if (!response.ok) throw new Error("Download failed");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `shift_${shiftId}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
        alert("Ошибка при выгрузке: " + e.message);
    }
}

// --- PLAN BOARD (DIRECTOR) ---
async function loadDirectorPlanBoard() {
    try {
        // Загрузим мастеров для селекта
        const mastersRes = await fetch('/api/masters/');
        const masters = await mastersRes.json();
        const select = document.getElementById('pb-master');
        if (select) {
            select.innerHTML = masters.filter(m => m.role === 'master').map(m => `<option value="${m.id}">${m.name}</option>`).join('');
        }
        
        // Сегодняшняя дата по умолчанию
        const pbDate = document.getElementById('pb-date');
        if (pbDate && !pbDate.value) {
            pbDate.value = new Date().toISOString().split('T')[0];
        }

        const res = await fetch('/api/plan_board');
        if (!res.ok) {
            console.error("Ошибка при получении данных выработки:", res.status, res.statusText);
            return;
        }
        const data = await res.json();
        const tbody = document.getElementById('director-plan-board-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;">Нет данных</td></tr>`;
            return;
        }
        data.forEach(p => {
            const masterName = p.master ? p.master.name : 'Н/Д';
            tbody.innerHTML += `
                <tr>
                    <td>${p.date}</td>
                    <td>${p.line || 'Н/Д'}</td>
                    <td>${p.shift_name}</td>
                    <td>${p.shift_number}</td>
                    <td>${masterName}</td>
                    <td>${p.plan_sheets}</td>
                    <td>${p.fact_sheets}</td>
                    <td>
                        <button class="btn-edit" onclick="editDirectorPlanBoard('${p.date}', '${p.line || ''}', '${p.shift_name}', ${p.shift_number}, ${p.master_id}, ${p.plan_sheets}, ${p.fact_sheets})" style="padding: 0.25rem 0.5rem; width: auto; font-size: 0.8rem; background: var(--primary-color);">
                            <i class="fa-solid fa-pen"></i> Ред.
                        </button>
                        <button class="btn-delete" onclick="deleteDirectorPlanBoard(${p.id})" style="padding: 0.25rem 0.5rem; width: auto; font-size: 0.8rem; background: var(--danger-color); margin-left: 0.5rem;">
                            <i class="fa-solid fa-trash"></i> Удал.
                        </button>
                    </td>
                </tr>
            `;
        });
    } catch (e) {
        console.error(e);
        const tbody = document.getElementById('director-plan-board-body');
        if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:red;">Ошибка загрузки данных</td></tr>`;
    }
}

function editDirectorPlanBoard(date, line, shiftName, shiftNumber, masterId, planSheets, factSheets) {
    document.getElementById('pb-date').value = date;
    document.getElementById('pb-line').value = line;
    document.getElementById('pb-shift-name').value = shiftName;
    document.getElementById('pb-shift-num').value = shiftNumber;
    document.getElementById('pb-master').value = masterId;
    document.getElementById('pb-plan').value = planSheets;
    document.getElementById('pb-fact').value = factSheets;
    
    const inputDate = document.getElementById('pb-date');
    if (inputDate) {
        inputDate.scrollIntoView({ behavior: 'smooth' });
    }
}

async function deleteDirectorPlanBoard(id) {
    if (!confirm("Вы уверены, что хотите удалить эту строку из выработки?")) return;
    try {
        const userNameParam = currentUser ? `?user_name=${encodeURIComponent(currentUser.name)}` : '';
        const res = await fetch(`/api/plan_board/${id}${userNameParam}`, { method: 'DELETE' });
        if (res.ok) {
            alert("Строка успешно удалена.");
            loadDirectorPlanBoard();
        } else {
            const err = await res.json();
            alert("Ошибка удаления: " + (err.detail || "Неизвестная ошибка"));
        }
    } catch (e) {
        console.error(e);
        alert("Сетевая ошибка при удалении.");
    }
}

async function saveDirectorPlanBoard() {
    const data = {
        date: document.getElementById('pb-date').value,
        line: document.getElementById('pb-line').value,
        shift_name: document.getElementById('pb-shift-name').value,
        shift_number: parseInt(document.getElementById('pb-shift-num').value) || 1,
        master_id: parseInt(document.getElementById('pb-master').value),
        plan_sheets: parseInt(document.getElementById('pb-plan').value) || 0,
        fact_sheets: parseInt(document.getElementById('pb-fact').value) || 0
    };
    
    if (!data.date || isNaN(data.master_id)) {
        alert("Заполните дату и выберите мастера");
        return;
    }

    const parsedDate = new Date(data.date);
    const isMonday = parsedDate.getDay() === 1; // 0 is Sunday, 1 is Monday
    if (isMonday && data.shift_name === "День" && data.plan_sheets !== 0) {
        alert("Внимание: План на санитарный день (понедельник, дневная смена) по правилам системы должен быть равен 0. План будет автоматически сохранен как 0, факт при этом сохранится.");
        document.getElementById('pb-plan').value = 0;
        data.plan_sheets = 0;
    }

    try {
        const userNameParam = currentUser ? `?user_name=${encodeURIComponent(currentUser.name)}` : '';
        const res = await fetch(`/api/plan_board${userNameParam}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (res.ok) {
            alert("Данные успешно сохранены/обновлены");
            loadDirectorPlanBoard();
        } else {
            const err = await res.json();
            alert("Ошибка сохранения: " + (err.detail || "Неизвестная ошибка"));
        }
    } catch (e) {
        console.error(e);
        alert("Сетевая ошибка при сохранении");
    }
}

async function uploadAndImportExcel() {
    const fileInput = document.getElementById('admin-excel-file');
    if (!fileInput || fileInput.files.length === 0) {
        alert("Пожалуйста, выберите Excel-файл для импорта (.xlsx)");
        return;
    }
    
    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append("file", file);
    
    const userName = currentUser ? currentUser.name : "Администратор";
    
    try {
        const res = await fetch(`/api/admin/upload_and_import_plan_board?user_name=${encodeURIComponent(userName)}`, {
            method: 'POST',
            body: formData
        });
        
        if (res.ok) {
            const result = await res.json();
            alert(`Импорт успешно завершен!\nСоздано записей: ${result.created}\nОбновлено записей: ${result.updated}`);
            loadDirectorPlanBoard();
            fileInput.value = ''; // очистить выбор файла
        } else {
            const err = await res.json();
            alert("Ошибка импорта: " + (err.detail || "Неизвестная ошибка"));
        }
    } catch (e) {
        console.error(e);
        alert("Сетевая ошибка при загрузке файла");
    }
}

async function clearPlanBoard() {
    if (!confirm("ВНИМАНИЕ! Вы уверены, что хотите ПОЛНОСТЬЮ удалить все записи из план-факт доски? Это действие необратимо.")) {
        return;
    }
    
    const userName = currentUser ? currentUser.name : "Администратор";
    
    try {
        const res = await fetch(`/api/admin/clear_plan_board?user_name=${encodeURIComponent(userName)}`, {
            method: 'DELETE'
        });
        
        if (res.ok) {
            const result = await res.json();
            alert(`Все данные успешно удалены. Количество удаленных записей: ${result.deleted_count}`);
            loadDirectorPlanBoard();
        } else {
            const err = await res.json();
            alert("Ошибка очистки: " + (err.detail || "Неизвестная ошибка"));
        }
    } catch (e) {
        console.error(e);
        alert("Сетевая ошибка при отправке запроса");
    }
}

// --- ANALYTICS TAB LOGIC ---
let chartAnalyticsTrend = null;
let chartAnalyticsCategories = null;
let chartAnalyticsBottlenecks = null;

async function initAnalyticsTab() {
    // 1. Populate dates if empty
    const startInput = document.getElementById('analytics-start-date');
    const endInput = document.getElementById('analytics-end-date');
    
    if (startInput && !startInput.value) {
        const now = new Date();
        // Start of current month
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const offset = startOfMonth.getTimezoneOffset();
        const localStart = new Date(startOfMonth.getTime() - (offset*60*1000));
        startInput.value = localStart.toISOString().split('T')[0];
    }
    
    if (endInput && !endInput.value) {
        const now = new Date();
        const offset = now.getTimezoneOffset();
        const localNow = new Date(now.getTime() - (offset*60*1000));
        endInput.value = localNow.toISOString().split('T')[0];
    }
    
    // 2. Populate departments list
    try {
        const res = await fetch('/api/downtimes/directory/departments');
        const depts = await res.json();
        const select = document.getElementById('analytics-dept');
        if (select) {
            const currentValue = select.value;
            select.innerHTML = '<option value="">-- Все участки --</option>' + 
                depts.map(d => `<option value="${d}">${d}</option>`).join('');
            select.value = currentValue;
        }
    } catch(e) {
        console.error("Failed to load departments for analytics", e);
    }
    
    // 3. Load initial analytics data
    await loadAnalyticsData();
}

async function loadAnalyticsData() {
    const start_date = document.getElementById('analytics-start-date').value;
    const end_date = document.getElementById('analytics-end-date').value;
    const department = document.getElementById('analytics-dept').value;
    
    let url = `/api/dashboard/analytics_data?`;
    if (start_date) url += `start_date=${start_date}&`;
    if (end_date) url += `end_date=${end_date}&`;
    if (department) url += `department=${encodeURIComponent(department)}&`;
    
    try {
        const res = await fetch(url);
        const data = await res.json();
        
        // 1. Update KPI cards
        const stopMin = document.getElementById('analytics-kpi-stop-min');
        const stopCount = document.getElementById('analytics-kpi-stop-count');
        const stopTons = document.getElementById('analytics-kpi-stop-tons');
        const stopTenge = document.getElementById('analytics-kpi-stop-tenge');
        
        const nonstopMin = document.getElementById('analytics-kpi-nonstop-min');
        const nonstopCount = document.getElementById('analytics-kpi-nonstop-count');
        const nonstopTons = document.getElementById('analytics-kpi-nonstop-tons');
        const nonstopTenge = document.getElementById('analytics-kpi-nonstop-tenge');
        
        if (stopMin) stopMin.innerText = `${data.kpis.with_stop.duration} мин`;
        if (stopCount) stopCount.innerText = data.kpis.with_stop.count;
        if (stopTons) stopTons.innerText = `${data.kpis.with_stop.lost_tons.toFixed(1)} т`;
        if (stopTenge) stopTenge.innerText = `${data.kpis.with_stop.lost_tenge.toLocaleString()} ₸`;
        
        if (nonstopMin) nonstopMin.innerText = `${data.kpis.without_stop.duration} мин`;
        if (nonstopCount) nonstopCount.innerText = data.kpis.without_stop.count;
        if (nonstopTons) nonstopTons.innerText = `${data.kpis.without_stop.lost_tons.toFixed(1)} т`;
        if (nonstopTenge) nonstopTenge.innerText = `${data.kpis.without_stop.lost_tenge.toLocaleString()} ₸`;
        
        // 2. Destroy old charts if they exist
        if (chartAnalyticsTrend) chartAnalyticsTrend.destroy();
        if (chartAnalyticsCategories) chartAnalyticsCategories.destroy();
        if (chartAnalyticsBottlenecks) chartAnalyticsBottlenecks.destroy();
        
        const categoryColors = {
            'Механические': 'rgba(40, 167, 69, 0.8)',
            'Технологические': 'rgba(23, 162, 184, 0.8)',
            'Энергетические': 'rgba(255, 193, 7, 0.8)',
            'ТО и ППР': 'rgba(111, 66, 193, 0.8)',
            'Санитарный день': 'rgba(220, 53, 69, 0.8)',
            'Остановки не связанные с простоем оборудования': 'rgba(108, 117, 125, 0.8)'
        };
        const defaultColor = 'rgba(255, 255, 255, 0.5)';
        
        // --- 2.1 Trend Chart ---
        const trendDates = Object.keys(data.trend);
        const trendCats = new Set();
        trendDates.forEach(d => {
            Object.keys(data.trend[d]).forEach(c => trendCats.add(c));
        });
        
        const trendDatasets = Array.from(trendCats).map(cat => {
            const dataPoints = trendDates.map(d => data.trend[d][cat] || 0);
            return {
                label: cat,
                data: dataPoints,
                borderColor: categoryColors[cat] || defaultColor,
                backgroundColor: categoryColors[cat] ? categoryColors[cat].replace('0.8', '0.1') : 'rgba(255, 255, 255, 0.1)',
                borderWidth: 2,
                fill: false,
                tension: 0.1
            };
        });
        
        const ctxTrend = document.getElementById('chart-analytics-trend').getContext('2d');
        chartAnalyticsTrend = new Chart(ctxTrend, {
            type: 'line',
            data: {
                labels: trendDates,
                datasets: trendDatasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#ccc' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#ccc' }, grid: { color: 'rgba(255,255,255,0.05)' } }
                },
                plugins: {
                    legend: { labels: { color: '#fff' } }
                }
            }
        });
        
        // --- 2.2 Category Chart ---
        const catLabels = Object.keys(data.by_category);
        const catStopData = catLabels.map(cat => data.by_category[cat].with_stop || 0);
        const catBgColors = catLabels.map(cat => categoryColors[cat] || defaultColor);
        
        const ctxCats = document.getElementById('chart-analytics-categories').getContext('2d');
        chartAnalyticsCategories = new Chart(ctxCats, {
            type: 'doughnut',
            data: {
                labels: catLabels,
                datasets: [{
                    data: catStopData,
                    backgroundColor: catBgColors,
                    borderWidth: 1,
                    borderColor: 'rgba(0,0,0,0.5)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: '#fff', boxWidth: 12 } }
                }
            }
        });
        
        // --- 2.3 Bottlenecks Chart ---
        const bLabels = data.bottlenecks.map(b => b.node);
        const bData = data.bottlenecks.map(b => b.duration);
        
        const ctxBottlenecks = document.getElementById('chart-analytics-bottlenecks').getContext('2d');
        chartAnalyticsBottlenecks = new Chart(ctxBottlenecks, {
            type: 'bar',
            data: {
                labels: bLabels,
                datasets: [{
                    label: 'Минут простоя с остановкой',
                    data: bData,
                    backgroundColor: 'rgba(220, 53, 69, 0.7)',
                    borderColor: '#dc3545',
                    borderWidth: 1
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#ccc' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#ccc' }, grid: { color: 'rgba(255,255,255,0.05)' } }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
        
    } catch(e) {
        console.error("Failed to load analytics data", e);
    }
}

window.onload = init;

