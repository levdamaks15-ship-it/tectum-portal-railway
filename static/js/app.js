let currentUser = null;
let activeShiftId = null;
let activeShiftData = null;
let currentDowntimes = [];
let chartProduction = null;
let chartDefects = null;
let chartMaterials = null;
let chartDtCategory = null;
let chartDtNodes = null;


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
    if (currentUser && (currentUser.role === 'master' || currentUser.role === 'director')) {
        renderDashboard();
    }
}

async function init() {
    initTheme();
    const res = await fetch('/api/masters/');
    const masters = await res.json();
    const select = document.getElementById('user-select');
    select.innerHTML = masters.map(m => `<option value="${m.name}">${m.name} (${m.role})</option>`).join('');
    
    flatpickr('.time-picker', {
        enableTime: true,
        noCalendar: true,
        dateFormat: "H:i",
        time_24hr: true,
        locale: "ru"
    });
}

async function login() {
    const name = document.getElementById('user-select').value;
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

function logout() {
    currentUser = null;
    document.getElementById('user-info-container').style.display = 'none';
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('login-screen').style.display = 'block';
    document.getElementById('pin-input').value = '';
    document.getElementById('login-error').style.display = 'none';
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
    if(btnProd) btnProd.style.display = 'none';
    if(btnDown) btnDown.style.display = 'none';
    if(btnDash) btnDash.style.display = 'none';
    if(btnMats) btnMats.style.display = 'none';
    if(btnArch) btnArch.style.display = 'none';
    
    if (role === 'master' || role === 'director' || role === 'mechanic') {
        if(tabsMenu) tabsMenu.style.display = 'flex';
        
        if (role === 'master') {
            if(btnProd) btnProd.style.display = 'inline-block';
            if(btnDown) btnDown.style.display = 'inline-block';
            if(btnDash) btnDash.style.display = 'inline-block';
            if(btnMats) btnMats.style.display = 'inline-block';
            if(btnArch) btnArch.style.display = 'inline-block';
            switchTab('production');
        } else if (role === 'director') {
            if(btnDown) btnDown.style.display = 'inline-block';
            if(btnDash) btnDash.style.display = 'inline-block';
            if(btnMats) btnMats.style.display = 'inline-block';
            if(btnArch) btnArch.style.display = 'inline-block';
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
    
    const isMechanicOrMaster = (role === 'master' || role === 'mechanic');
    const wrapEnd = document.getElementById('wrapper-dt-end');
    const wrapCat = document.getElementById('wrapper-dt-cat');
    if (wrapEnd) wrapEnd.style.display = isMechanicOrMaster ? 'block' : 'none';
    if (wrapCat) wrapCat.style.display = isMechanicOrMaster ? 'block' : 'none';

    document.getElementById('master-view').style.display = role === 'master' ? 'block' : 'none';
    document.getElementById('zo-view').style.display = role === 'zo' ? 'block' : 'none';
    document.getElementById('lfm-view').style.display = role === 'lfm' ? 'block' : 'none';
    document.getElementById('stacker-view').style.display = role === 'stacker' ? 'block' : 'none';
    document.getElementById('destacker-view').style.display = role === 'destacker' ? 'block' : 'none';
    document.getElementById('qcd-view').style.display = role === 'qcd' ? 'block' : 'none';
    document.getElementById('report-view').style.display = role === 'master' ? 'block' : 'none';
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
    
    if(prod) prod.style.display = 'none';
    if(down) down.style.display = 'none';
    if(dash) dash.style.display = 'none';
    if(mats) mats.style.display = 'none';
    if(arch) arch.style.display = 'none';
    
    const target = document.getElementById(`${tabId}-tab`);
    if(target) {
        if (tabId === 'production') target.style.display = 'grid';
        else target.style.display = 'block';
    }

    if (tabId === 'archive') {
        loadArchive();
    } else if (tabId === 'materials') {
        loadMaterialsReport();
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
                `<div>- ${r.product_name}: ${r.lfm_sheets} шт, Сброс: ${r.lfm_wind_resets} шт</div>`
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
    
    if (currentUser.role === 'master' || currentUser.role === 'director') {
        renderDashboard();
    }
    
    // Загрузка списков партий для Разборщика и СКК
    if (currentUser.role === 'destacker') {
        const dsRes = await fetch('/api/batches/pending_destacker');
        const dsBatches = await dsRes.json();
        document.getElementById('ds-batch-select').innerHTML = dsBatches.map(b => 
            `<option value="${b.id}">${b.batch_number} (${b.product_name})</option>`
        ).join('') || '<option value="">Нет партий</option>';
    }
    
    if (currentUser.role === 'qcd') {
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
            `<div>- ${r.product_name}: ${r.lfm_sheets} шт, Сброс: ${r.lfm_wind_resets} шт</div>`
        ).join('');
    }
    
    renderDowntimesTable(shift);
    
    if (currentUser.role === 'master' || currentUser.role === 'director') {
        renderSummaryTable(shift);
        renderMasterDashboard(shift);
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
        fiberglass: getNum('rec-fib')
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
    
    await fetch(`/api/shifts/${activeShiftId}/lfm`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ product_name, lfm_sheets, lfm_wind_resets })
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
        document.getElementById('materials-report-list').innerHTML = '<tr><td colspan="4" style="text-align:center;">Нет активной смены</td></tr>';
        return;
    }
    
    try {
        const res = await fetch(`/api/shifts/${activeShiftId}/materials_report`);
        const data = await res.json();
        
        const tbody = document.getElementById('materials-report-list');
        if (!data.details || data.details.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Нет данных</td></tr>';
            return;
        }
        
        const html = data.details.map(d => {
            let color = 'inherit';
            if (d.deviation > 0) color = 'var(--danger-color)';
            else if (d.deviation < 0) color = 'var(--success-color)';
            
            return `
                <tr>
                    <td>${d.material}</td>
                    <td>${d.actual}</td>
                    <td>${d.theoretical}</td>
                    <td style="color: ${color}; font-weight: bold;">${d.deviation > 0 ? '+' : ''}${d.deviation}</td>
                </tr>
            `;
        }).join('');
        
        tbody.innerHTML = html;
        
    } catch (e) {
        document.getElementById('materials-report-list').innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--danger-color);">Ошибка загрузки</td></tr>';
    }
}

window.onload = init;
