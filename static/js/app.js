let currentUser = null;
let activeShiftId = null;
let activeShiftData = null;
let currentDowntimes = [];
let chartProduction = null;
let chartDefects = null;
let chartMaterials = null;
let chartDtCategory = null;
let chartDtNodes = null;
let chartDailySheets = null;
let chartDailyTons = null;
// Multipliers: stacks to sheets
const PRODUCT_MULTIPLIERS = {
    "Шифер 7 волн": 100,
    "Шифер 7 волн 3500*980": 100,
    "Шифер 8 волн": 100,
    "Шифер 8 волн глад": 100,
    "Шифер 8 волн пиленый": 100,
    "Шифер плоский 10 мм": 50,
    "Шифер плоский 8 мм": 60,
    "Шифер плоский 6 мм": 80,
    "Шифер РП 1750*930": 100
};

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

async function init() {
    initTheme();
    
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
        'master': 2,
        'zo': 3,
        'lfm': 4,
        'stacker': 5,
        'destacker': 6,
        'qcd': 7,
        'mechanic': 8
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
                case 'director': roleName = 'Руководство'; break;
                case 'zo': roleName = 'Оператор ЗО'; break;
                case 'lfm': roleName = 'Машинист ЛФМ'; break;
                case 'stacker': roleName = 'Стакер'; break;
                case 'destacker': roleName = 'Дестакер'; break;
                case 'qcd': roleName = 'Инспектор СКК'; break;
                case 'mechanic': roleName = 'Механик'; break;
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
    const role = currentUser.role;
    
    const tabsMenu = document.getElementById('tabs-menu');
    if(tabsMenu) tabsMenu.style.display = 'none';
    
    const btnProd = document.getElementById('tab-btn-production');
    const btnDown = document.getElementById('tab-btn-downtimes');
    const btnDash = document.getElementById('tab-btn-dashboard');
    const btnMats = document.getElementById('tab-btn-materials');
    const btnArch = document.getElementById('tab-btn-archive');
    const btnDaily = document.getElementById('tab-btn-daily-report');
    const btnWeekly = document.getElementById('tab-btn-weekly-report');
    const btnPlanBoard = document.getElementById('tab-btn-plan-board');
    if(btnProd) btnProd.style.display = 'none';
    if(btnDown) btnDown.style.display = 'none';
    if(btnDash) btnDash.style.display = 'none';
    if(btnMats) btnMats.style.display = 'none';
    if(btnArch) btnArch.style.display = 'none';
    if(btnDaily) btnDaily.style.display = 'none';
    if(btnWeekly) btnWeekly.style.display = 'none';
    if(btnPlanBoard) btnPlanBoard.style.display = 'none';
    
    if (role === 'master' || role === 'director' || role === 'mechanic' || role === 'admin') {
        if(tabsMenu) tabsMenu.style.display = 'flex';
        
        if (role === 'admin') {
            if(btnProd) btnProd.style.display = 'inline-block';
            if(btnDown) btnDown.style.display = 'inline-block';
            if(btnDash) btnDash.style.display = 'inline-block';
            if(btnMats) btnMats.style.display = 'inline-block';
            if(btnArch) btnArch.style.display = 'inline-block';
            if(btnDaily) btnDaily.style.display = 'inline-block';
            if(btnWeekly) btnWeekly.style.display = 'inline-block';
            if(btnPlanBoard) btnPlanBoard.style.display = 'inline-block';
            switchTab('dashboard');
        } else if (role === 'master') {
            if(btnProd) btnProd.style.display = 'inline-block';
            if(btnDown) btnDown.style.display = 'inline-block';
            if(btnMats) btnMats.style.display = 'inline-block';
            if(btnArch) btnArch.style.display = 'inline-block';
            if(btnDaily) btnDaily.style.display = 'inline-block';
            if(btnWeekly) btnWeekly.style.display = 'inline-block';
            switchTab('production');
        } else if (role === 'director') {
            if(btnDown) btnDown.style.display = 'inline-block';
            if(btnDash) btnDash.style.display = 'inline-block';
            if(btnMats) btnMats.style.display = 'inline-block';
            if(btnArch) btnArch.style.display = 'inline-block';
            if(btnDaily) btnDaily.style.display = 'inline-block';
            if(btnWeekly) btnWeekly.style.display = 'inline-block';
            if(btnPlanBoard) btnPlanBoard.style.display = 'inline-block';
            switchTab('dashboard');
        } else if (role === 'mechanic') {
            if(btnDown) btnDown.style.display = 'inline-block';
            switchTab('downtimes');
        }
    } else {
        if(tabsMenu) tabsMenu.style.display = 'flex';
        if(btnProd) btnProd.style.display = 'inline-block';
        if(btnDown) btnDown.style.display = 'inline-block';
        switchTab('production');
    }
    
    const isMechanicOrMaster = (role === 'master' || role === 'mechanic' || role === 'admin');
    const wrapEnd = document.getElementById('wrapper-dt-end');
    const wrapCat = document.getElementById('wrapper-dt-cat');
    if (wrapEnd) wrapEnd.style.display = isMechanicOrMaster ? 'block' : 'none';
    if (wrapCat) wrapCat.style.display = isMechanicOrMaster ? 'block' : 'none';

    document.getElementById('master-view').style.display = (role === 'master' || role === 'admin') ? 'block' : 'none';
    document.getElementById('zo-view').style.display = (role === 'zo' || role === 'admin') ? 'block' : 'none';
    document.getElementById('lfm-view').style.display = (role === 'lfm' || role === 'admin') ? 'block' : 'none';
    document.getElementById('stacker-view').style.display = (role === 'stacker' || role === 'admin') ? 'block' : 'none';
    document.getElementById('destacker-view').style.display = (role === 'destacker' || role === 'admin') ? 'block' : 'none';
    document.getElementById('qcd-view').style.display = (role === 'qcd' || role === 'admin') ? 'block' : 'none';
    document.getElementById('report-view').style.display = (role === 'master' || role === 'admin') ? 'block' : 'none';

    const adminPlanControls = document.getElementById('admin-plan-controls');
    if (adminPlanControls) {
        adminPlanControls.style.display = (role === 'admin') ? 'block' : 'none';
    }
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const btn = document.getElementById(`tab-btn-${tabId}`);
    if(btn) btn.classList.add('active');
    
    const prod = document.getElementById('production-tab');
    const down = document.getElementById('downtimes-tab');
    const dash = document.getElementById('dashboard-tab');
    const mats = document.getElementById('materials-tab');
    const arch = document.getElementById('archive-tab');
    const daily = document.getElementById('daily-report-tab');
    const weekly = document.getElementById('weekly-report-tab');
    const planBoard = document.getElementById('plan-board-tab');
    
    if(prod) prod.style.display = 'none';
    if(down) down.style.display = 'none';
    if(dash) dash.style.display = 'none';
    if(mats) mats.style.display = 'none';
    if(arch) arch.style.display = 'none';
    if(daily) daily.style.display = 'none';
    if(weekly) weekly.style.display = 'none';
    if(planBoard) planBoard.style.display = 'none';
    
    const target = document.getElementById(`${tabId}-tab`);
    if(target) {
        if (tabId === 'production') target.style.display = 'grid';
        else target.style.display = 'block';
    }

    if (tabId === 'archive') {
        loadArchive();
    } else if (tabId === 'materials') {
        loadMaterialsReport();
    } else if (tabId === 'plan-board') {
        loadDirectorPlanBoard();
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
    } else if (tabId === 'weekly-report') {
        loadWeeklyReport();
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
        document.getElementById('active-shift-display').innerText = `${shift.date} | ${shift.shift_name} | ${shift.line}`;
        
        const lfmList = document.getElementById('lfm-reports-list');
        if(lfmList) {
            lfmList.innerHTML = shift.lfm_reports.map(r => 
                `<div>- ${r.product_name}: ${r.lfm_sheets} шт, Сброс: ${r.lfm_wind_resets} шт, 1 сорт: ${r.formed_1st_grade || 0}, Брак: ${r.formed_defect || 0}, На склад: ${r.transferred_to_warehouse || 0}</div>`
            ).join('');
        }
        
        renderDowntimesTable(shift);
        
        if (currentUser.role === 'master') {
            renderSummaryTable(shift);
            renderMasterDashboard(shift);
            document.getElementById('btn-close-shift').style.display = 'inline-block';
            fetchMaterialsSummary(shift.id);
        } else if (currentUser.role === 'director') {
            fetchMaterialsSummary(shift.id);
        } else if (currentUser.role === 'zo' || currentUser.role === 'master') {
            // Populate ZO fields if they exist
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
            document.getElementById('zo-asb-drain').value = shift.zo_asb_drain || '';
            document.getElementById('zo-cem-drain').value = shift.zo_cem_drain || '';
            document.getElementById('zo-batches').value = shift.zo_batches || '';
        }
        
        applyShiftMode(shift);
    } else {
        document.getElementById('active-shift-display').innerText = "Нет открытой смены";
        activeShiftId = null;
        document.getElementById('btn-close-shift').style.display = 'none';
        document.getElementById('shift-dev-indicator').style.display = 'none';
        document.getElementById('readonly-badge').style.display = 'none';
    }
    
    if (currentUser.role === 'director') {
        renderDashboard();
    }
    
    // Загрузка списков партий для Разборщика и СКК
    if (currentUser.role === 'destacker' || currentUser.role === 'admin') {
        const dsRes = await fetch('/api/batches/pending_destacker');
        const dsBatches = await dsRes.json();
        document.getElementById('ds-batch-select').innerHTML = dsBatches.map(b => 
            `<option value="${b.id}">${b.batch_number} (${b.product_name})</option>`
        ).join('') || '<option value="">Нет партий</option>';
    }
    
    if (currentUser.role === 'qcd' || currentUser.role === 'admin') {
        const qcdRes = await fetch('/api/batches/pending_qcd');
        const qcdBatches = await qcdRes.json();
        document.getElementById('qcd-batch-select').innerHTML = qcdBatches.map(b => 
            `<option value="${b.id}">${b.batch_number} (${b.status})</option>`
        ).join('') || '<option value="">Нет партий</option>';
    }
}

async function createShift() {
    const date = document.getElementById('shift-date').value;
    const name = document.getElementById('shift-name').value;
    const line = document.getElementById('shift-line').value;
    if (!date) return alert("Выберите дату");
    
    await fetch('/api/shifts/', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            date: date, shift_name: name, line: line, master_id: currentUser.id
        })
    });
    alert("Смена начата");
    loadData();
}

async function closeShift() {
    if (!activeShiftId) return;
    if (!confirm("Вы уверены, что хотите закрыть текущую смену?")) return;
    
    await fetch(`/api/shifts/${activeShiftId}/close`, {
        method: 'PUT'
    });
    alert("Смена закрыта!");
    loadData();
}

async function viewShift(shiftId) {
    const res = await fetch(`/api/shifts/${shiftId}`);
    const shift = await res.json();
    
    activeShiftId = shift.id;
    activeShiftData = shift;
    currentDowntimes = shift.downtimes || [];
    
    document.getElementById('active-shift-display').innerText = `${shift.date} | ${shift.shift_name} | ${shift.line}`;
    
    const lfmList = document.getElementById('lfm-reports-list');
    if(lfmList) {
        lfmList.innerHTML = (shift.lfm_reports || []).map(r => 
            `<div>- ${r.product_name}: ${r.lfm_sheets} шт, Сброс: ${r.lfm_wind_resets} шт, 1 сорт: ${r.formed_1st_grade || 0}, Брак: ${r.formed_defect || 0}, На склад: ${r.transferred_to_warehouse || 0}</div>`
        ).join('');
    }
    
    renderDowntimesTable(shift);
    
    if (currentUser.role === 'master') {
        renderSummaryTable(shift);
        renderMasterDashboard(shift);
        fetchMaterialsSummary(shift.id);
    } else if (currentUser.role === 'director') {
        renderSummaryTable(shift);
        fetchMaterialsSummary(shift.id);
        renderDashboard(shift); // Need to pass shift instead of fetching active
    }
    
    applyShiftMode(shift);
    
    // Switch to dashboard or production tab to see the data
    if (currentUser.role === 'director') {
        switchTab('dashboard');
    } else {
        switchTab('production');
    }
}

function applyShiftMode(shift) {
    const isClosed = shift.status === 'closed';
    document.getElementById('readonly-badge').style.display = isClosed ? 'block' : 'none';
    document.getElementById('btn-close-shift').style.display = isClosed ? 'none' : 'inline-block';
    
    // Disable inputs and buttons in production if closed
    const forms = ['master-view', 'lfm-view', 'stacker-view', 'destacker-view', 'qcd-view'];
    forms.forEach(f => {
        const el = document.getElementById(f);
        if (el) {
            const inputs = el.querySelectorAll('input, select, button');
            inputs.forEach(input => {
                if(input.id !== 'btn-close-shift' && !input.classList.contains('tab-btn') && input.innerText !== 'Обновить' && !input.getAttribute('onclick')?.includes('switchTab')) {
                     input.disabled = isClosed;
                     if(isClosed) {
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
        const isZoLocked = isClosed || shift.zo_submitted;
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
        document.getElementById('zo-lock-msg').style.display = (shift.zo_submitted && !isClosed) ? 'block' : 'none';
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
        asbozurit: getNum('rec-asb'),
        fiberglass: getNum('rec-fib'),
        laprol: getNum('rec-laprol')
    };
    await fetch(`/api/shifts/${activeShiftId}/receipt`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    alert("Приход сохранен");
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
        asb_drain: getNum('zo-asb-drain'),
        cem_drain: getNum('zo-cem-drain'),
        batches: getNum('zo-batches'),
        submitted: true
    };
    await fetch(`/api/shifts/${activeShiftId}/zo`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    alert("Данные ЗО успешно отправлены");
    loadData();
}

async function addLFMReport() {
    if (!activeShiftId) return alert("Нет активной смены");
    const product_name = document.getElementById('lfm-product').value;
    const lfm_sheets = getNum('lfm-sheets');
    const lfm_wind_resets = getNum('lfm-resets');
    const formed_1st_grade = getNum('lfm-1st');
    const formed_defect = getNum('lfm-defect');
    const transferred_to_warehouse = getNum('lfm-warehouse');
    
    await fetch(`/api/shifts/${activeShiftId}/lfm`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ product_name, lfm_sheets, lfm_wind_resets, formed_1st_grade, formed_defect, transferred_to_warehouse })
    });
    alert("Отчет добавлен");
    document.getElementById('lfm-sheets').value = '';
    document.getElementById('lfm-resets').value = '';
    document.getElementById('lfm-1st').value = '';
    document.getElementById('lfm-defect').value = '';
    document.getElementById('lfm-warehouse').value = '';
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

async function addJournalDowntime() {
    if (!activeShiftId) return alert("Нет активной смены");
    const start_time = document.getElementById(`journal-dt-start`).value;
    const end_time = document.getElementById(`journal-dt-end`).value || null;
    const category = document.getElementById(`journal-dt-cat`).value || null;
    const node = document.getElementById(`journal-dt-node`).value;
    const description = document.getElementById(`journal-dt-desc`).value;
    
    if (!start_time || !node) return alert("Заполните обязательные поля (Время начала, Узел)");
    
    const media_urls = currentMediaUrls.length > 0 ? JSON.stringify(currentMediaUrls) : null;
    
    await fetch(`/api/shifts/${activeShiftId}/downtimes`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ start_time, end_time, category, node, description, media_urls })
    });
    alert("Простой зарегистрирован!");
    document.getElementById(`journal-dt-start`).value = '';
    document.getElementById(`journal-dt-end`).value = '';
    document.getElementById(`journal-dt-desc`).value = '';
    document.getElementById(`downtime-media`).value = '';
    document.getElementById('upload-status').style.display = 'none';
    currentMediaUrls = [];
    renderUploadedFiles();
    loadData();
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
        if (currentUser && (currentUser.role === 'master' || currentUser.role === 'mechanic' || currentUser.role === 'director')) {
            actionButtons = `
                <button onclick='openEditDowntimeModal(${dt.id})' style="width:auto; padding: 0.3rem 0.6rem; font-size:0.8rem; margin-bottom: 0.2rem; background: var(--primary-color);">Ред.</button>
                <button onclick="deleteDowntime(${dt.id})" style="width:auto; padding: 0.3rem 0.6rem; font-size:0.8rem; background: var(--danger-color);">Удал.</button>
            `;
        }
        
        return `
        <tr style="${dt.status === 'pending' ? 'background: rgba(255,165,0,0.1);' : ''}">
            <td>${shift.shift_name} (${shift.date})</td>
            <td>${statusBadge}</td>
            <td>${dt.start_time}</td>
            <td>${dt.end_time || '-'}</td>
            <td>${dt.duration} мин</td>
            <td><span style="color:var(--danger-color)">-${dt.lost_tons.toFixed(1)} т / -${dt.lost_tenge.toLocaleString()} ₸</span></td>
            <td>[${dt.category || '?'}]<br>${dt.node}</td>
            <td>${dt.description}</td>
            <td>${mediaLinks}</td>
            <td>${actionButtons}</td>
        </tr>
        `;
    }).join('');
    
    list.innerHTML = html;
}

function openEditDowntimeModal(id) {
    const dt = currentDowntimes.find(d => d.id === id);
    if (!dt) return;
    
    document.getElementById('edit-dt-id').value = dt.id;
    document.getElementById('edit-dt-start').value = dt.start_time;
    document.getElementById('edit-dt-end').value = dt.end_time;
    document.getElementById('edit-dt-cat').value = dt.category;
    document.getElementById('edit-dt-node').value = dt.node;
    document.getElementById('edit-dt-desc').value = dt.description;
    
    document.getElementById('edit-dt-modal').style.display = 'block';
}

function closeEditDowntimeModal() {
    document.getElementById('edit-dt-modal').style.display = 'none';
}

async function submitEditDowntime() {
    const id = document.getElementById('edit-dt-id').value;
    const start_time = document.getElementById('edit-dt-start').value;
    const end_time = document.getElementById('edit-dt-end').value;
    const category = document.getElementById('edit-dt-cat').value;
    const node = document.getElementById('edit-dt-node').value;
    const description = document.getElementById('edit-dt-desc').value;
    
    if (!start_time || !end_time || !category || !node) return alert("Заполните обязательные поля");
    
    await fetch(`/api/downtimes/${id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ start_time, end_time, category, node, description })
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
    
    await fetch(`/api/batches/?shift_id=${activeShiftId}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ batch_number, product_name, stacked_stacks })
    });
    alert("Партия создана!");
    document.getElementById('batch-number').value = '';
    document.getElementById('batch-stacks').value = '';
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
    
    await fetch(`/api/batches/${batchId}/destacker`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    alert("Разборка сохранена!");
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
    
    await fetch(`/api/batches/${batchId}/qcd`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    alert("СКК контроль сохранен!");
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
            <th>Стакер (стопы)</th>
            <th>Стакер (листы)</th>
            <th colspan="3" style="text-align:center; border-left: 2px solid var(--glass-border);">Дестакер</th>
            ${activeDefects.size > 0 ? `<th colspan="${activeDefects.size}" style="text-align:center; border-left: 1px solid var(--glass-border);">Детализация брака (Дестакер)</th>` : ''}
            <th colspan="3" style="text-align:center; border-left: 2px solid var(--glass-border);">СКК</th>
        </tr>
        <tr>
            <th></th><th></th><th></th><th></th>
            <th style="border-left: 2px solid var(--glass-border);">Конд.</th><th>1 Сорт</th><th>Брак</th>
            ${defectHeaders}
            <th style="border-left: 2px solid var(--glass-border);">Конд.</th><th>1 Сорт</th><th>Брак</th>
        </tr>
    `;
    
    document.querySelector('#summary-table thead').innerHTML = tableHeader;
    
    let rows = '';
    batches.forEach(b => {
        const mult = PRODUCT_MULTIPLIERS[b.product_name] || 100;
        const calcSheets = b.stacked_stacks * mult;
        
        let defectCols = Array.from(activeDefects).map(k => `<td>${b[k] || 0}</td>`).join('');
        
        // Разница Разборщик vs СКК (проверка)
        const qcdError = (b.status === 'qcd_checked') && (b.ds_defect !== b.qcd_defect || b.ds_condition !== b.qcd_condition) 
            ? 'background: rgba(255,100,100,0.2)' : '';

        rows += `
            <tr style="${qcdError}">
                <td>${b.batch_number}</td>
                <td>${b.product_name}</td>
                <td>${b.stacked_stacks}</td>
                <td>${calcSheets}</td>
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
    
    document.getElementById('report-table-body').innerHTML = rows;
}

function exportToExcel() {
    const table = document.getElementById('summary-table');
    const wb = XLSX.utils.table_to_book(table, {sheet: "Отчет по партиям"});
    XLSX.writeFile(wb, "Svodny_Otchet.xlsx");
}

async function renderDashboard(shiftDataParam = null) {
    let stats;
    if (shiftDataParam) {
        // Compute stats manually for the specific shift
        const s = shiftDataParam;
        let cond = 0, first = 0, def = 0;
        let defects = {};
        for(let k in DEFECT_NAMES) defects[k] = 0;
        
        const bList = s.batches || [];
        for(let b of bList) {
            cond += b.ds_condition || 0;
            first += b.ds_first_grade || 0;
            def += b.ds_defect || 0;
            for(let k in DEFECT_NAMES) {
                defects[k] += b[k] || 0;
            }
        }
        
        let dMinutes = 0, dTons = 0, dTenge = 0;
        let dtByCat = {};
        let dtNodesMap = {};
        for(let d of (s.downtimes || [])) {
            dMinutes += d.duration;
            dTons += d.lost_tons;
            dTenge += d.lost_tenge;
            dtByCat[d.category] = (dtByCat[d.category] || 0) + d.duration;
            dtNodesMap[d.node] = (dtNodesMap[d.node] || 0) + 1;
        }
        let topReasons = Object.entries(dtNodesMap).map(([node, count]) => ({node, count})).sort((a,b)=>b.count-a.count).slice(0,5);
        
        stats = {
            production: { condition: cond, first_grade: first, defect: def },
            defects: defects,
            materials: {
                "Асбест": { 
                    receipt: (s.receipt_chrysotile_4_20||0) + (s.receipt_chrysotile_5_65||0) + (s.receipt_chrysotile_6_40||0),
                    zo: (s.zo_chrysotile_4_20||0) + (s.zo_chrysotile_5_65||0) + (s.zo_chrysotile_6_40||0)
                },
                "Цемент": { receipt: s.receipt_cement||0, zo: s.zo_cement||0 },
                "Целлюлоза": { receipt: s.receipt_cellulose||0, zo: s.zo_cellulose||0 }
            },
            downtimes: {
                total_minutes: dMinutes, lost_tons: dTons, lost_tenge: dTenge, by_category: dtByCat, top_reasons: topReasons
            }
        };
    } else {
        const res = await fetch('/api/dashboard/stats');
        stats = await res.json();
    }

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const textCol = isLight ? '#1e293b' : '#e0e0e0';

    // 1. Production (Bar)
    const ctxProd = document.getElementById('chart-production').getContext('2d');
    if (chartProduction) chartProduction.destroy();
    chartProduction = new Chart(ctxProd, {
        type: 'bar',
        data: {
            labels: ['Кондиция', '1 Сорт', 'Брак'],
            datasets: [{
                label: 'Объем (шт)',
                data: [stats.production.condition, stats.production.first_grade, stats.production.defect],
                backgroundColor: ['rgba(40, 167, 69, 0.8)', 'rgba(23, 162, 184, 0.8)', 'rgba(220, 53, 69, 0.8)'],
                borderColor: ['#28a745', '#17a2b8', '#dc3545'],
                borderWidth: 1
            }]
        },
        options: { 
            plugins: { legend: { display: false } },
            scales: {
                y: { ticks: { color: textCol } },
                x: { ticks: { color: textCol } }
            }
        }
    });

    // 2. Defects (Doughnut)
    const ctxDef = document.getElementById('chart-defects').getContext('2d');
    if (chartDefects) chartDefects.destroy();
    
    const defLabels = [];
    const defData = [];
    const defColors = [
        '#ff6384','#36a2eb','#cc65fe','#ffce56','#ff9f40',
        '#4bc0c0','#9966ff','#ff6633','#00cc99','#ff33cc','#ffff66'
    ];
    let colorIdx = 0;
    const finalColors = [];

    for (const [k, v] of Object.entries(stats.defects)) {
        if (v > 0) {
            defLabels.push(k);
            defData.push(v);
            finalColors.push(defColors[colorIdx % defColors.length]);
        }
        colorIdx++;
    }

    chartDefects = new Chart(ctxDef, {
        type: 'doughnut',
        data: {
            labels: defLabels.length ? defLabels : ['Нет брака'],
            datasets: [{
                data: defData.length ? defData : [1],
                backgroundColor: defData.length ? finalColors : ['rgba(255,255,255,0.1)'],
                borderColor: 'rgba(255,255,255,0.2)',
                borderWidth: 1
            }]
        },
        options: { 
            plugins: { 
                legend: { position: 'right', labels: { color: textCol } } 
            } 
        }
    });

    // 3. Materials (Bar - grouped)
    const ctxMat = document.getElementById('chart-materials').getContext('2d');
    if (chartMaterials) chartMaterials.destroy();
    
    chartMaterials = new Chart(ctxMat, {
        type: 'bar',
        data: {
            labels: ['Асбест', 'Цемент', 'Целлюлоза'],
            datasets: [
                {
                    label: 'Склад (Приход)',
                    data: [stats.materials['Асбест'].receipt, stats.materials['Цемент'].receipt, stats.materials['Целлюлоза'].receipt],
                    backgroundColor: 'rgba(23, 162, 184, 0.8)',
                    borderColor: '#17a2b8',
                    borderWidth: 1
                },
                {
                    label: 'ЗО (Расход)',
                    data: [stats.materials['Асбест'].zo, stats.materials['Цемент'].zo, stats.materials['Целлюлоза'].zo],
                    backgroundColor: 'rgba(255, 193, 7, 0.8)',
                    borderColor: '#ffc107',
                    borderWidth: 1
                }
            ]
        },
        options: {
            scales: {
                y: { ticks: { color: textCol } },
                x: { ticks: { color: textCol } }
            },
            plugins: { legend: { labels: { color: textCol } } }
        }
    });

    // 4. Простои (KPIs)
    document.getElementById('kpi-dt-minutes').innerText = stats.downtimes.total_minutes + ' мин';
    document.getElementById('kpi-dt-tons').innerText = stats.downtimes.lost_tons.toFixed(1) + ' т';
    document.getElementById('kpi-dt-tenge').innerText = stats.downtimes.lost_tenge.toLocaleString() + ' ₸';

    // 5. Простои - Категории (Doughnut)
    const ctxDtCat = document.getElementById('chart-dt-category').getContext('2d');
    if (chartDtCategory) chartDtCategory.destroy();
    
    chartDtCategory = new Chart(ctxDtCat, {
        type: 'doughnut',
        data: {
            labels: Object.keys(stats.downtimes.by_category).length ? Object.keys(stats.downtimes.by_category) : ['Нет простоев'],
            datasets: [{
                data: Object.keys(stats.downtimes.by_category).length ? Object.values(stats.downtimes.by_category) : [1],
                backgroundColor: Object.keys(stats.downtimes.by_category).length ? ['#ff6384','#36a2eb','#ffce56','#4bc0c0','#9966ff'] : ['rgba(255,255,255,0.1)'],
                borderColor: 'rgba(255,255,255,0.2)',
                borderWidth: 1
            }]
        },
        options: { plugins: { legend: { position: 'right', labels: { color: textCol } } } }
    });

    // 6. Простои - Узлы (Bar)
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
                    <td><button onclick="exportShift(${s.shift_id})" style="background: #217346; padding: 0.2rem 0.5rem; font-size: 0.8rem; border-radius: 4px; width:auto; border:none; cursor:pointer;" title="Печать смены">🖨</button></td>
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

window.onload = init;

