// Логика Кабинета СКК (Переборка и контроль качества)
let shiftsWindowData = [];
let selectedShiftIds = new Set();
let currentReportsList = [];

document.addEventListener('DOMContentLoaded', () => {
    initQcdCabinet();
});

async function initQcdCabinet() {
    // 1. Проверяем авторизацию
    try {
        const storedUser = localStorage.getItem('tectum_auth_user');
        if (storedUser) {
            const user = JSON.parse(storedUser);
            if (user && user.name) {
                const el = document.getElementById('qcd-inspector-display');
                if (el) el.innerText = user.name;
            }
        }
    } catch(e) {}

    // 2. Загружаем окно последних 5 смен
    await loadShiftsWindow();

    // 3. Загружаем журнал отчетов
    await loadQcdReportsJournal();
}

function switchQcdTab(tabName) {
    const tabCreate = document.getElementById('qcd-tab-create');
    const tabJournal = document.getElementById('qcd-tab-journal');
    const tabLab = document.getElementById('qcd-tab-lab');
    const tabLabJournal = document.getElementById('qcd-tab-lab-journal');

    const btnCreate = document.getElementById('tab-btn-create');
    const btnJournal = document.getElementById('tab-btn-journal');
    const btnLab = document.getElementById('tab-btn-lab');
    const btnLabJournal = document.getElementById('tab-btn-lab-journal');

    // Скрываем все вкладки
    if (tabCreate) tabCreate.style.display = 'none';
    if (tabJournal) tabJournal.style.display = 'none';
    if (tabLab) tabLab.style.display = 'none';
    if (tabLabJournal) tabLabJournal.style.display = 'none';

    if (btnCreate) btnCreate.classList.remove('active');
    if (btnJournal) btnJournal.classList.remove('active');
    if (btnLab) btnLab.classList.remove('active');
    if (btnLabJournal) btnLabJournal.classList.remove('active');

    if (tabName === 'create') {
        if (tabCreate) tabCreate.style.display = 'block';
        if (btnCreate) btnCreate.classList.add('active');
    } else if (tabName === 'journal') {
        if (tabJournal) tabJournal.style.display = 'block';
        if (btnJournal) btnJournal.classList.add('active');
        loadQcdReportsJournal();
    } else if (tabName === 'lab') {
        if (tabLab) tabLab.style.display = 'block';
        if (btnLab) btnLab.classList.add('active');
        initLabFormIfNeeded();
    } else if (tabName === 'lab-journal') {
        if (tabLabJournal) tabLabJournal.style.display = 'block';
        if (btnLabJournal) btnLabJournal.classList.add('active');
        loadLabReportsJournal();
        loadMonthlySpreadsheets();
    }
}

async function loadShiftsWindow() {
    const container = document.getElementById('shifts-container');
    try {
        const res = await fetch('/api/qcd/shifts-window?limit=5');
        if (!res.ok) throw new Error('Ошибка загрузки окна смен');
        shiftsWindowData = await res.json();

        if (!shiftsWindowData || shiftsWindowData.length === 0) {
            container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--qcd-subtext); padding: 1rem;">Нет доступных смен</div>';
            return;
        }

        container.innerHTML = shiftsWindowData.map(s => {
            const isDay = (s.shift_name || '').toLowerCase().includes('день');
            const badgeClass = isDay ? 'badge-day' : 'badge-night';
            const badgeText = isDay ? '☀️ День' : '🌙 Ночь';

            return `
                <div class="shift-check-card" id="shift-card-${s.id}" onclick="toggleShiftSelection(${s.id})">
                    <div class="shift-card-top">
                        <span style="font-weight: 800; font-size: 0.88rem; color: var(--qcd-navy);">${s.date}</span>
                        <span class="shift-badge ${badgeClass}">${badgeText}</span>
                    </div>
                    <div class="shift-lfm-val">${(s.lfm_sheets || 0).toLocaleString('ru-RU')} <span style="font-size: 0.8rem; font-weight: 600; color: var(--qcd-subtext);">листов</span></div>
                    <div class="shift-details-sub">
                        <div><strong>${s.line}</strong> | Партия: <strong>${s.batch_number || '—'}</strong></div>
                        <div style="color: #0284c7; font-weight: 600;">${s.master_name}</div>
                    </div>
                    <div style="margin-top: 6px; display: flex; align-items: center; gap: 6px; font-size: 0.78rem; color: #475569;">
                        <input type="checkbox" id="shift-chk-${s.id}" style="pointer-events: none;" ${selectedShiftIds.has(s.id) ? 'checked' : ''}>
                        <span>Выбрать смену</span>
                    </div>
                </div>
            `;
        }).join('');

        // По умолчанию выбираем самую последнюю (свежую) смену
        if (shiftsWindowData.length > 0 && selectedShiftIds.size === 0) {
            toggleShiftSelection(shiftsWindowData[0].id);
        }
    } catch(err) {
        console.error(err);
        container.innerHTML = `<div style="color: red; padding: 1rem;">${err.message}</div>`;
    }
}

function toggleShiftSelection(shiftId) {
    if (selectedShiftIds.has(shiftId)) {
        selectedShiftIds.delete(shiftId);
    } else {
        selectedShiftIds.add(shiftId);
    }

    // Обновляем визуальные классы карточек и чекбоксов
    shiftsWindowData.forEach(s => {
        const card = document.getElementById(`shift-card-${s.id}`);
        const chk = document.getElementById(`shift-chk-${s.id}`);
        if (card && chk) {
            if (selectedShiftIds.has(s.id)) {
                card.classList.add('selected');
                chk.checked = true;
            } else {
                card.classList.remove('selected');
                chk.checked = false;
            }
        }
    });

    const badge = document.getElementById('selected-shifts-count-badge');
    if (badge) badge.innerText = `Выбрано: ${selectedShiftIds.size} смен`;

    recalcQcdTotals();
}

function recalcQcdTotals() {
    // 1. Сумма формовки по выбранным сменам
    let totalFormed = 0;
    shiftsWindowData.forEach(s => {
        if (selectedShiftIds.has(s.id)) {
            totalFormed += (s.lfm_sheets || 0);
        }
    });
    document.getElementById('kpi-total-formed').innerText = totalFormed.toLocaleString('ru-RU');

    // 2. Сумма 1 сорта
    let fgSum = 0;
    document.querySelectorAll('.fg-input').forEach(inp => {
        fgSum += parseInt(inp.value) || 0;
    });
    document.getElementById('kpi-first-grade').innerText = fgSum.toLocaleString('ru-RU');
    document.getElementById('sum-badge-fg').innerText = `${fgSum} шт`;

    // 3. Сумма брака
    let defSum = 0;
    document.querySelectorAll('.def-input').forEach(inp => {
        defSum += parseInt(inp.value) || 0;
    });
    document.getElementById('kpi-defect-total').innerText = defSum.toLocaleString('ru-RU');
    document.getElementById('sum-badge-defect').innerText = `${defSum} шт`;

    // 4. Всего перебрано
    const totalSorted = fgSum + defSum;
    document.getElementById('kpi-total-sorted').innerText = totalSorted.toLocaleString('ru-RU');

    // 5. Процент брака
    let defPercent = 0.0;
    if (totalSorted > 0) {
        defPercent = (defSum / totalSorted) * 100.0;
    } else if (totalFormed > 0) {
        defPercent = (defSum / totalFormed) * 100.0;
    }
    document.getElementById('kpi-defect-percent').innerText = `${defPercent.toFixed(2)}%`;
}

function getCollectedFormData() {
    const inspector = document.getElementById('qcd-inspector-display')?.innerText || 'Мусаилова З.';
    const notes = document.getElementById('qcd-notes')?.value || '';

    let totalFormed = 0;
    const selectedShiftsList = [];
    shiftsWindowData.forEach(s => {
        if (selectedShiftIds.has(s.id)) {
            totalFormed += (s.lfm_sheets || 0);
            selectedShiftsList.push({
                shift_id: s.id,
                date: s.date,
                shift_name: s.shift_name,
                line: s.line,
                master_name: s.master_name,
                batch_number: s.batch_number,
                product_name: s.product_name,
                lfm_sheets: s.lfm_sheets
            });
        }
    });

    const fgDetails = {
        chip: parseInt(document.getElementById('fg-chip')?.value) || 0,
        scratch: parseInt(document.getElementById('fg-scratch')?.value) || 0,
        bad_cut: parseInt(document.getElementById('fg-bad-cut')?.value) || 0,
        stick_bottom: parseInt(document.getElementById('fg-stick-bottom')?.value) || 0,
        stick_top: parseInt(document.getElementById('fg-stick-top')?.value) || 0,
        curved_edge: parseInt(document.getElementById('fg-curved-edge')?.value) || 0,
        no_pattern: parseInt(document.getElementById('fg-no-pattern')?.value) || 0,
        dent: parseInt(document.getElementById('fg-dent')?.value) || 0,
        thickness: parseInt(document.getElementById('fg-thickness')?.value) || 0,
        delamination: parseInt(document.getElementById('fg-delamination')?.value) || 0,
        edge_bulge: parseInt(document.getElementById('fg-edge-bulge')?.value) || 0,
        other: parseInt(document.getElementById('fg-other')?.value) || 0
    };

    const defDetails = {
        fell_box: parseInt(document.getElementById('def-fell-box')?.value) || 0,
        broken: parseInt(document.getElementById('def-broken')?.value) || 0,
        tech_defect: parseInt(document.getElementById('def-tech-defect')?.value) || 0
    };

    let fgTotal = 0;
    Object.values(fgDetails).forEach(v => fgTotal += v);

    let defTotal = 0;
    Object.values(defDetails).forEach(v => defTotal += v);

    const totalSorted = fgTotal + defTotal;
    let defPercent = 0.0;
    if (totalSorted > 0) defPercent = (defTotal / totalSorted) * 100.0;

    const todayStr = new Date().toISOString().split('T')[0];

    return {
        act_date: todayStr,
        inspector_name: inspector,
        selected_shift_ids: Array.from(selectedShiftIds),
        product_name: selectedShiftsList.length > 0 ? selectedShiftsList[0].product_name : 'Шифер 8 волн',
        total_formed: totalFormed,
        first_grade_total: fgTotal,
        defect_total: defTotal,
        defect_percentage: parseFloat(defPercent.toFixed(2)),
        first_grade_details: fgDetails,
        defect_details: defDetails,
        notes: notes,
        shifts_breakdown: selectedShiftsList
    };
}

function previewActBeforeSave() {
    const data = getCollectedFormData();
    if (data.selected_shift_ids.length === 0) {
        showQcdModal('Предупреждение', 'Пожалуйста, выберите хотя бы одну смену чекбоксом!', 'warning');
        return;
    }

    renderPrintableAct(data, 'ЧЕРНОВИК (ПРЕДПРОСМОТР)');
    const previewEl = document.getElementById('printable-act-preview');
    previewEl.style.display = 'block';
    previewEl.scrollIntoView({ behavior: 'smooth' });
}

function renderPrintableAct(data, actNumOverride = null) {
    document.getElementById('print-act-number').innerText = actNumOverride || data.act_number || '№ СКК-2026/...';
    document.getElementById('print-act-date').innerText = `Дата: ${data.act_date || ''}`;
    document.getElementById('print-inspector').innerText = data.inspector_name || 'Мусаилова З.';
    document.getElementById('print-product').innerText = data.product_name || 'Шифер 8 волн';

    const shiftsSummary = (data.shifts_breakdown || []).map(s => 
        `${s.date} ${s.shift_name} (${s.line}, Партия: ${s.batch_number || '—'}, Мастер: ${s.master_name})`
    ).join('; ');
    document.getElementById('print-shifts-list').innerText = shiftsSummary || 'Не указано';

    document.getElementById('print-total-formed').innerText = (data.total_formed || 0).toLocaleString('ru-RU');
    document.getElementById('print-fg-total').innerText = (data.first_grade_total || 0).toLocaleString('ru-RU');
    
    const totalSorted = (data.first_grade_total || 0) + (data.defect_total || 0);
    const fgPct = totalSorted > 0 ? ((data.first_grade_total / totalSorted) * 100).toFixed(2) : '0.0';
    document.getElementById('print-fg-percent').innerText = `${fgPct}%`;

    document.getElementById('print-def-total').innerText = (data.defect_total || 0).toLocaleString('ru-RU');
    document.getElementById('print-def-percent').innerText = `${(data.defect_percentage || 0).toFixed(2)}%`;
    document.getElementById('print-total-sorted').innerText = totalSorted.toLocaleString('ru-RU');

    document.getElementById('print-notes').innerText = data.notes || 'Замечаний нет.';

    // Детализация дефектов
    const fg = data.first_grade_details || {};
    const def = data.defect_details || {};

    const fgLabels = {
        chip: 'Скол (до 50×50 мм)', scratch: 'Сдир', bad_cut: 'Плохой рез',
        stick_bottom: 'Налип снизу', stick_top: 'Налип сверху', curved_edge: 'Кривой край',
        no_pattern: 'Нет рисунка', dent: 'Вмятина', thickness: 'Не соотв. толщине',
        delamination: 'Расслоение', edge_bulge: 'Выпирание кромок', other: 'Прочий 1 сорт'
    };

    const defLabels = {
        fell_box: 'Упал с коробки', broken: 'Сломан', tech_defect: 'Технологический брак'
    };

    let detailsHtml = '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;"><div><strong>1 Сорт (отклонения):</strong><ul style="margin: 4px 0 0 16px; padding: 0;">';
    for (const [k, lbl] of Object.entries(fgLabels)) {
        if (fg[k] > 0) detailsHtml += `<li>${lbl}: <strong>${fg[k]} шт</strong></li>`;
    }
    detailsHtml += '</ul></div><div><strong>Жарамсыз / Брак:</strong><ul style="margin: 4px 0 0 16px; padding: 0;">';
    for (const [k, lbl] of Object.entries(defLabels)) {
        if (def[k] > 0) detailsHtml += `<li style="color: #dc2626;">${lbl}: <strong>${def[k]} шт</strong></li>`;
    }
    detailsHtml += '</ul></div></div>';

    document.getElementById('print-breakdown-details').innerHTML = detailsHtml;
}

async function submitQcdAct() {
    const data = getCollectedFormData();

    if (data.selected_shift_ids.length === 0) {
        showQcdModal('Внимание', 'Пожалуйста, выберите хотя бы одну смену!', 'warning');
        return;
    }

    if (data.first_grade_total === 0 && data.defect_total === 0) {
        if (!confirm('Вы не указали количество 1 сорта и брака. Сформировать нулевой акт?')) {
            return;
        }
    }

    const btn = document.getElementById('btn-save-qcd-act');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Сохранение и выгрузка...';

    try {
        const res = await fetch('/api/qcd/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Ошибка сохранения акта СКК');
        }

        const savedAct = await res.json();

        // Показываем предпросмотр уже с официальным номером
        renderPrintableAct(data, savedAct.act_number);
        document.getElementById('printable-act-preview').style.display = 'block';

        showQcdModal('Акт успешно сохранен!', 
            `Присвоен номер: ${savedAct.act_number}. Данные автоматически отправлены в Google Таблицу «Переборка СКК».`, 
            'success');

        // Перезагружаем журнал
        await loadQcdReportsJournal();
    } catch(err) {
        console.error(err);
        showQcdModal('Ошибка сохранения', err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check-double"></i> Сформировать и сохранить Акт СКК';
    }
}

async function loadQcdReportsJournal() {
    const tbody = document.getElementById('journal-tbody');
    if (!tbody) return;

    try {
        const res = await fetch('/api/qcd/reports?limit=50');
        if (!res.ok) throw new Error('Ошибка загрузки журнала');
        currentReportsList = await res.json();

        if (!currentReportsList || currentReportsList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: var(--qcd-subtext); padding: 1.5rem;">Журнал пока пуст</td></tr>';
            return;
        }

        tbody.innerHTML = currentReportsList.map(r => {
            const gStatus = r.google_synced 
                ? '<span class="stripe-badge" style="background: #dcfce7; color: #15803d;">✓ Выгружен</span>'
                : `<button class="qcd-btn-secondary" style="padding: 3px 8px; font-size: 0.72rem;" onclick="retryGoogleSync(${r.id})">Повторить</button>`;

            return `
                <tr>
                    <td style="font-weight: 800; color: var(--qcd-navy);">${r.act_number}</td>
                    <td>${r.act_date}</td>
                    <td><strong>${r.inspector_name}</strong></td>
                    <td style="font-size: 0.8rem; color: #475569;">${r.product_name || 'Шифер 8 волн'}</td>
                    <td style="text-align: right; font-weight: 700;">${(r.total_formed || 0).toLocaleString('ru-RU')}</td>
                    <td style="text-align: right; font-weight: 700; color: var(--qcd-success);">${(r.first_grade_total || 0).toLocaleString('ru-RU')}</td>
                    <td style="text-align: right; font-weight: 700; color: var(--qcd-danger);">${(r.defect_total || 0).toLocaleString('ru-RU')}</td>
                    <td style="text-align: right; font-weight: 700;">${(r.defect_percentage || 0).toFixed(2)}%</td>
                    <td style="text-align: center;">${gStatus}</td>
                    <td style="text-align: center;">
                        <button class="qcd-btn-secondary" style="padding: 4px 8px;" onclick="viewSavedAct(${r.id})" title="Просмотр и печать">
                            <i class="fa-solid fa-print"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch(e) {
        console.error(e);
        tbody.innerHTML = `<tr><td colspan="10" style="color: red; padding: 1rem;">${e.message}</td></tr>`;
    }
}

async function viewSavedAct(actId) {
    try {
        const res = await fetch(`/api/qcd/reports/${actId}`);
        if (!res.ok) throw new Error('Ошибка загрузки акта');
        const act = await res.json();

        switchQcdTab('create');
        renderPrintableAct(act, act.act_number);
        const previewEl = document.getElementById('printable-act-preview');
        previewEl.style.display = 'block';
        previewEl.scrollIntoView({ behavior: 'smooth' });
    } catch(e) {
        showQcdModal('Ошибка', e.message, 'error');
    }
}

async function retryGoogleSync(actId) {
    try {
        const res = await fetch(`/api/qcd/reports/${actId}/sync-google`, { method: 'POST' });
        if (!res.ok) throw new Error('Ошибка отправки запроса');
        showQcdModal('Запрос отправлен', 'Выгрузка акта в Google Sheets поставлена в очередь.', 'success');
        setTimeout(loadQcdReportsJournal, 2000);
    } catch(e) {
        showQcdModal('Ошибка', e.message, 'error');
    }
}

function showQcdModal(title, msg, type = 'success') {
    const modal = document.getElementById('qcd-alert-modal');
    const titleEl = document.getElementById('qcd-alert-title');
    const msgEl = document.getElementById('qcd-alert-msg');
    const iconEl = document.getElementById('qcd-alert-icon');
    const btnEl = document.getElementById('qcd-alert-ok-btn');

    if (!modal) return;
    titleEl.innerText = title;
    msgEl.innerText = msg;

    if (type === 'error') {
        iconEl.innerText = '✕';
        iconEl.style.color = '#dc2626';
    } else if (type === 'warning') {
        iconEl.innerText = '⚠️';
        iconEl.style.color = '#d97706';
    } else {
        iconEl.innerText = '✓';
        iconEl.style.color = '#16a34a';
    }

    // Сброс кнопки к обычному режиму (только «Понятно»)
    if (btnEl) {
        btnEl.textContent = 'Понятно';
        btnEl.onclick = () => { modal.style.display = 'none'; };
    }
    const cancelBtnEl = document.getElementById('qcd-alert-cancel-btn');
    if (cancelBtnEl) cancelBtnEl.style.display = 'none';

    modal.style.display = 'flex';
}

// П1.Г + П1.Д: Confirm-диалог через существующий модал
function showQcdConfirm(title, msg, onConfirm) {
    const modal = document.getElementById('qcd-alert-modal');
    const titleEl = document.getElementById('qcd-alert-title');
    const msgEl = document.getElementById('qcd-alert-msg');
    const iconEl = document.getElementById('qcd-alert-icon');
    const btnEl = document.getElementById('qcd-alert-ok-btn');
    const cancelBtnEl = document.getElementById('qcd-alert-cancel-btn');

    if (!modal) { if (confirm(`${title}\n${msg}`)) onConfirm(); return; }

    titleEl.innerText = title;
    msgEl.innerText = msg;
    iconEl.innerText = '❓';
    iconEl.style.color = '#d97706';

    if (btnEl) {
        btnEl.textContent = 'Да, продолжить';
        btnEl.onclick = () => {
            modal.style.display = 'none';
            onConfirm();
        };
    }
    if (cancelBtnEl) {
        cancelBtnEl.style.display = 'inline-flex';
        cancelBtnEl.onclick = () => { modal.style.display = 'none'; };
    }
    modal.style.display = 'flex';
}



// ==========================================
// ЛАБОРАТОРНЫЙ КОНТРОЛЬ СКК (LAB ANALYSES)
// ==========================================

let isLabFormInitialized = false;

function initLabFormIfNeeded() {
    if (isLabFormInitialized) return;
    
    // Устанавливаем текущую дату в формате YYYY-MM-DD
    const dateInp = document.getElementById('lab-report-date');
    if (dateInp && !dateInp.value) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        dateInp.value = `${yyyy}-${mm}-${dd}`;
    }

    // Автоматически определяем смену по текущему часу
    const shiftSel = document.getElementById('lab-shift-type');
    if (shiftSel && !shiftSel.value) {
        const hours = new Date().getHours();
        shiftSel.value = (hours >= 8 && hours < 20) ? 'День' : 'Ночь';
    }

    // Инициализируем строки по умолчанию, если они пусты
    const filmTbody = document.getElementById('lab-film-tbody');
    if (filmTbody && filmTbody.children.length === 0) {
        ['09:00', '11:00', '13:00', '15:00', '17:00'].forEach(t => addLabFilmRow({ time: t }));
    }

    const densityTbody = document.getElementById('lab-density-tbody');
    if (densityTbody && densityTbody.children.length === 0) {
        ['09:00', '11:00', '13:00', '15:00', '17:00'].forEach(t => addLabDensityRow({ time: t }));
    }

    const hourlyTbody = document.getElementById('lab-hourly-tbody');
    if (hourlyTbody && hourlyTbody.children.length === 0) {
        generateDefaultHourlyRows();
    }

    // П1.Б: Запрет перезаписи мастера при ручном редактировании
    const masterField = document.getElementById('lab-master-name');
    if (masterField) {
        masterField.addEventListener('input', () => {
            masterField.dataset.manuallyEdited = 'true';
            masterField.style.background = '';
            masterField.title = '';
        });
    }

    // П1.В: IntersectionObserver — показываем sticky-бар при скролле мимо шапки
    const headerCard = document.getElementById('lab-header-card');
    const stickyBar = document.getElementById('lab-sticky-bar');
    if (headerCard && stickyBar && window.IntersectionObserver) {
        const obs = new IntersectionObserver(([entry]) => {
            stickyBar.style.display = entry.isIntersecting ? 'none' : 'flex';
        }, { threshold: 0, rootMargin: '-10px 0px 0px 0px' });
        obs.observe(headerCard);
    }

    // Инициализируем контекст sticky-бара
    updateStickyContext();

    // Автозаполнение мастера при первой инициализации
    _tryAutofillMaster();

    isLabFormInitialized = true;
}


function generateDefaultHourlyRows() {
    const isDay = (document.getElementById('lab-shift-type')?.value || 'День') === 'День';
    const hours = isDay 
        ? ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00']
        : ['20:00', '21:00', '22:00', '23:00', '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00'];
    
    const tbody = document.getElementById('lab-hourly-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    hours.forEach(h => addLabHourlyRow({ time: h, visual_appearance: 'Норма' }));
}

function onLabHeaderChange() {
    const hourlyTbody = document.getElementById('lab-hourly-tbody');
    if (hourlyTbody) {
        const rows = hourlyTbody.querySelectorAll('.lab-hourly-row');
        if (rows.length === 12) {
            const isDay = (document.getElementById('lab-shift-type')?.value || 'День') === 'День';
            const hours = isDay 
                ? ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00']
                : ['20:00', '21:00', '22:00', '23:00', '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00'];
            rows.forEach((r, idx) => {
                const timeInp = r.querySelector('.hourly-time');
                if (timeInp) timeInp.value = hours[idx] || '';
            });
        }
    }

    // П1.Б: Автозаполнение мастера смены из API
    _tryAutofillMaster();

    // П1.В: Обновить sticky-контекст
    updateStickyContext();
}

// П1.Б: Попытка автозаполнения мастера смены из активной смены
async function _tryAutofillMaster() {
    const date = document.getElementById('lab-report-date')?.value;
    const shift = document.getElementById('lab-shift-type')?.value;
    const line = document.getElementById('lab-line-number')?.value;
    if (!date || !shift || !line) return;

    const masterField = document.getElementById('lab-master-name');
    if (!masterField || masterField.dataset.manuallyEdited === 'true') return;

    try {
        const shiftKey = shift === 'День' ? 'day' : 'night';
        const resp = await fetch(`/api/shifts?date=${date}&limit=10`, { signal: AbortSignal.timeout(5000) });
        if (!resp.ok) return;
        const shifts = await resp.json();

        // Ищем совпадение по дате, типу смены и линии
        const match = shifts.find(s =>
            s.report_date?.startsWith(date) &&
            (s.shift_type === shift || s.shift_name === shift) &&
            (s.line_number === line || s.equipment === line)
        );
        if (match?.master_name) {
            masterField.value = match.master_name;
            masterField.style.background = '#f0fdf4'; // зелёный — автозаполнено
            masterField.title = 'Автозаполнено из смены';
        }
    } catch(e) {
        // Сетевая ошибка — молча игнорируем, не блокируем форму
    }
}

// П1.В: Обновить содержимое sticky-контекстной строки
function updateStickyContext() {
    const date = document.getElementById('lab-report-date')?.value;
    const shift = document.getElementById('lab-shift-type')?.value;
    const line = document.getElementById('lab-line-number')?.value;
    const flow = document.getElementById('lab-flow-number')?.value;
    const product = document.getElementById('lab-product-name')?.value;
    const specialist = document.getElementById('lab-inspector-name')?.value;

    const fmt = (v) => v || '—';
    const dateDisp = date ? new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

    const ctxDate = document.getElementById('ctx-date');
    const ctxShift = document.getElementById('ctx-shift');
    const ctxLine = document.getElementById('ctx-line');
    const ctxProduct = document.getElementById('ctx-product');
    const ctxSpecialist = document.getElementById('ctx-specialist');

    if (ctxDate) ctxDate.textContent = dateDisp;
    if (ctxShift) ctxShift.textContent = shift === 'День' ? 'Дневная' : 'Ночная';
    if (ctxLine) ctxLine.textContent = `${fmt(line)} / Поток ${fmt(flow)}`;
    if (ctxProduct) ctxProduct.textContent = fmt(product);
    if (ctxSpecialist) ctxSpecialist.textContent = fmt(specialist);
}

function onLabProductChange() {
    const prod = document.getElementById('lab-product-name')?.value || '';
    const thickInp = document.getElementById('lab-thickness-spec');
    if (!thickInp) return;
    
    if (prod.includes('х6') || prod.includes('х 6')) {
        thickInp.value = '6.0 мм';
    } else if (prod.includes('х8') || prod.includes('х 8')) {
        thickInp.value = '8.0 мм';
    } else if (prod.includes('х10') || prod.includes('х 10')) {
        thickInp.value = '10.0 мм';
    } else if (prod.includes('7 волн')) {
        thickInp.value = '5.2 мм';
    } else {
        thickInp.value = '5.8 мм';
    }
}

// П1.Г: Удаление строки замера с confirm-диалогом
function deleteLabRow(btn, label) {
    const row = btn.closest('tr');
    if (!row) return;
    showQcdConfirm(
        'Удалить замер?',
        `Удалить строку замера ${label ? `(${label})` : ''}? Это действие нельзя отменить.`,
        () => row.remove()
    );
}

// 1. Динамические строки: Влажность пленки (Компактный вид)
function addLabFilmRow(data = {}) {
    const tbody = document.getElementById('lab-film-tbody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.className = 'lab-film-row';
    const timeVal = data.time || '';
    tr.innerHTML = `
        <td><input type="text" class="film-time" value="${timeVal}" placeholder="09:00"></td>
        <td><input type="number" step="0.1" class="film-before-l" value="${data.before_vacuum_left ?? ''}" placeholder="42.5" oninput="validateNormInput(this, 39, 48)"></td>
        <td><input type="number" step="0.1" class="film-before-r" value="${data.before_vacuum_right ?? ''}" placeholder="43.0" oninput="validateNormInput(this, 39, 48)"></td>
        <td><input type="number" step="0.1" class="film-after-l" value="${data.after_vacuum_left ?? ''}" placeholder="33.5" oninput="validateNormInput(this, 32, 35)"></td>
        <td><input type="number" step="0.1" class="film-after-r" value="${data.after_vacuum_right ?? ''}" placeholder="34.0" oninput="validateNormInput(this, 32, 35)"></td>
        <td style="text-align: center;"><button type="button" class="lab-del-btn" onclick="deleteLabRow(this, '${timeVal}')" title="Удалить замер">✕</button></td>
    `;
    tbody.appendChild(tr);

    tr.querySelectorAll('input[type="number"]').forEach(inp => validateNormInput(inp, 
        inp.classList.contains('film-before-l') || inp.classList.contains('film-before-r') ? 39 : 32,
        inp.classList.contains('film-before-l') || inp.classList.contains('film-before-r') ? 48 : 35
    ));
}


// 2. Динамические строки: Объемный вес и влажность наката (Компактный вид)
function addLabDensityRow(data = {}) {
    const tbody = document.getElementById('lab-density-tbody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.className = 'lab-density-row';
    const timeVal = data.time || '';
    tr.innerHTML = `
        <td><input type="text" class="density-time" value="${timeVal}" placeholder="09:00"></td>
        <td><input type="number" step="0.01" class="density-l" value="${data.density_left ?? ''}" placeholder="1.45" oninput="validateNormInput(this, 1.42, 2.0)"></td>
        <td><input type="number" step="0.01" class="density-c" value="${data.density_center ?? ''}" placeholder="1.46" oninput="validateNormInput(this, 1.42, 2.0)"></td>
        <td><input type="number" step="0.01" class="density-r" value="${data.density_right ?? ''}" placeholder="1.44" oninput="validateNormInput(this, 1.42, 2.0)"></td>
        <td><input type="number" step="0.1" class="moisture-l" value="${data.moisture_left ?? ''}" placeholder="22.0" oninput="validateNormInput(this, 20, 24)"></td>
        <td><input type="number" step="0.1" class="moisture-c" value="${data.moisture_center ?? ''}" placeholder="21.5" oninput="validateNormInput(this, 20, 24)"></td>
        <td><input type="number" step="0.1" class="moisture-r" value="${data.moisture_right ?? ''}" placeholder="22.2" oninput="validateNormInput(this, 20, 24)"></td>
        <td style="text-align: center;"><button type="button" class="lab-del-btn" onclick="deleteLabRow(this, '${timeVal}')" title="Удалить замер">✕</button></td>
    `;
    tbody.appendChild(tr);

    tr.querySelectorAll('input[type="number"]').forEach(inp => {
        if (inp.classList.contains('density-l') || inp.classList.contains('density-c') || inp.classList.contains('density-r')) {
            validateNormInput(inp, 1.42, 2.0);
        } else {
            validateNormInput(inp, 20, 24);
        }
    });
}

// 3. Динамические строки: Почасовой контроль ГП (Ультракомпактный селект внешнего вида)
function addLabHourlyRow(data = {}) {
    const tbody = document.getElementById('lab-hourly-tbody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.className = 'lab-hourly-row';
    const rowId = 'hourly-row-' + Math.random().toString(36).substring(2, 8);
    tr.id = rowId;

    const currentVal = data.visual_appearance || 'Норма';
    const standardOptions = ['Норма', 'Ершение', 'Разнотолщинность', 'Тоньше нормы', 'Пятна/Полосы', 'Сколы/Трещины'];
    let customOption = '';
    if (currentVal && !standardOptions.includes(currentVal)) {
        customOption = `<option value="${currentVal}" selected>${currentVal}</option>`;
    }

    const defaultLength = data.gp_length ?? 1750;
    const defaultWidth = data.gp_width ?? 1130;
    
    const timeVal = data.time || '';
    tr.innerHTML = `
        <td><input type="text" class="hourly-time" value="${timeVal}" placeholder="08:00"></td>
        <td><input type="number" step="0.01" class="hourly-t-l" value="${data.thickness_left ?? ''}" placeholder="5.80"></td>
        <td><input type="number" step="0.01" class="hourly-t-c" value="${data.thickness_center ?? ''}" placeholder="5.80"></td>
        <td><input type="number" step="0.01" class="hourly-t-r" value="${data.thickness_right ?? ''}" placeholder="5.80"></td>
        <td>
            <select class="hourly-visual">
                <option value="Норма" ${currentVal === 'Норма' ? 'selected' : ''}>🟢 Норма</option>
                <option value="Ершение" ${currentVal === 'Ершение' ? 'selected' : ''}>🟡 Ершение</option>
                <option value="Разнотолщинность" ${currentVal === 'Разнотолщинность' ? 'selected' : ''}>🟠 Разнотолщ.</option>
                <option value="Тоньше нормы" ${currentVal === 'Тоньше нормы' ? 'selected' : ''}>🔴 Тоньше</option>
                <option value="Пятна/Полосы" ${currentVal === 'Пятна/Полосы' ? 'selected' : ''}>🟣 Пятна/Полосы</option>
                <option value="Сколы/Трещины" ${currentVal === 'Сколы/Трещины' ? 'selected' : ''}>❌ Сколы/Трещ.</option>
                ${customOption}
            </select>
        </td>
        <td><input type="number" class="hourly-gp-len" value="${defaultLength}" placeholder="1750"></td>
        <td><input type="number" class="hourly-gp-wid" value="${defaultWidth}" placeholder="1130"></td>
        <td style="text-align: center;"><button type="button" class="lab-del-btn" onclick="deleteLabRow(this, '${timeVal}')" title="Удалить замер">✕</button></td>
    `;
    tbody.appendChild(tr);
}

// Быстрое заполнение всех 12 строк почасового контроля нормой
function fillAllHourlyAsNorm() {
    const nominalStr = document.getElementById('lab-thickness-spec')?.value || '5.8';
    const numNom = parseFloat(nominalStr.replace(',', '.'));
    const defThick = (!isNaN(numNom) ? numNom.toFixed(2) : '5.80');

    document.querySelectorAll('.lab-hourly-row').forEach(tr => {
        const visualSel = tr.querySelector('.hourly-visual');
        if (visualSel) visualSel.value = 'Норма';
        
        const lenInp = tr.querySelector('.hourly-gp-len');
        if (lenInp && !lenInp.value) lenInp.value = 1750;

        const widInp = tr.querySelector('.hourly-gp-wid');
        if (widInp && !widInp.value) widInp.value = 1130;

        const tl = tr.querySelector('.hourly-t-l');
        const tc = tr.querySelector('.hourly-t-c');
        const tr_inp = tr.querySelector('.hourly-t-r');
        if (tl && !tl.value) tl.value = defThick;
        if (tc && !tc.value) tc.value = defThick;
        if (tr_inp && !tr_inp.value) tr_inp.value = defThick;
    });
}

// Валидация норм в реальном времени с подсветкой
function validateNormInput(inputEl, minVal, maxVal) {
    if (!inputEl) return;
    const val = parseFloat(inputEl.value);
    if (isNaN(val) || inputEl.value === '') {
        inputEl.classList.remove('norm-danger', 'norm-warning');
        return;
    }

    if (val < minVal || val > maxVal) {
        inputEl.classList.add('norm-danger');
        inputEl.classList.remove('norm-warning');
        inputEl.title = `Отклонение от нормы (${minVal} - ${maxVal})!`;
    } else {
        inputEl.classList.remove('norm-danger', 'norm-warning');
        inputEl.title = `В пределах нормы (${minVal} - ${maxVal})`;
    }
}

// Автоподсчет суммы сырья
function recalcLabRawMaterialsTotal() {
    let total = 0;
    document.querySelectorAll('.lab-raw-inp').forEach(inp => {
        const val = parseFloat(inp.value);
        if (!isNaN(val)) total += val;
    });
    const badge = document.getElementById('lab-raw-total-badge');
    if (badge) {
        badge.innerText = `Итого: ${total.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} кг`;
    }
}

// Сбор данных формы
function collectLabFormData(status = 'draft') {
    const idVal = document.getElementById('lab-analysis-id')?.value;
    const analysisId = idVal ? parseInt(idVal) : null;

    // Влажность пленки
    const filmData = [];
    document.querySelectorAll('.lab-film-row').forEach(tr => {
        const time = tr.querySelector('.film-time')?.value || '';
        const b_l = parseFloat(tr.querySelector('.film-before-l')?.value);
        const b_r = parseFloat(tr.querySelector('.film-before-r')?.value);
        const a_l = parseFloat(tr.querySelector('.film-after-l')?.value);
        const a_r = parseFloat(tr.querySelector('.film-after-r')?.value);
        filmData.push({
            time: time,
            before_vacuum_left: isNaN(b_l) ? null : b_l,
            before_vacuum_right: isNaN(b_r) ? null : b_r,
            after_vacuum_left: isNaN(a_l) ? null : a_l,
            after_vacuum_right: isNaN(a_r) ? null : a_r
        });
    });

    // Объемный вес и влажность наката
    const densityData = [];
    document.querySelectorAll('.lab-density-row').forEach(tr => {
        const time = tr.querySelector('.density-time')?.value || '';
        const d_l = parseFloat(tr.querySelector('.density-l')?.value);
        const d_c = parseFloat(tr.querySelector('.density-c')?.value);
        const d_r = parseFloat(tr.querySelector('.density-r')?.value);
        const m_l = parseFloat(tr.querySelector('.moisture-l')?.value);
        const m_c = parseFloat(tr.querySelector('.moisture-c')?.value);
        const m_r = parseFloat(tr.querySelector('.moisture-r')?.value);
        densityData.push({
            time: time,
            density_left: isNaN(d_l) ? null : d_l,
            density_center: isNaN(d_c) ? null : d_c,
            density_right: isNaN(d_r) ? null : d_r,
            moisture_left: isNaN(m_l) ? null : m_l,
            moisture_center: isNaN(m_c) ? null : m_c,
            moisture_right: isNaN(m_r) ? null : m_r
        });
    });

    // Почасовой контроль ГП
    const hourlyData = [];
    document.querySelectorAll('.lab-hourly-row').forEach(tr => {
        const time = tr.querySelector('.hourly-time')?.value || '';
        const t_l = parseFloat(tr.querySelector('.hourly-t-l')?.value);
        const t_c = parseFloat(tr.querySelector('.hourly-t-c')?.value);
        const t_r = parseFloat(tr.querySelector('.hourly-t-r')?.value);
        const visual = tr.querySelector('.hourly-visual')?.value || '';
        const len = parseFloat(tr.querySelector('.hourly-gp-len')?.value);
        const wid = parseFloat(tr.querySelector('.hourly-gp-wid')?.value);
        hourlyData.push({
            time: time,
            thickness_left: isNaN(t_l) ? null : t_l,
            thickness_center: isNaN(t_c) ? null : t_c,
            thickness_right: isNaN(t_r) ? null : t_r,
            visual_appearance: visual,
            gp_length: isNaN(len) ? null : len,
            gp_width: isNaN(wid) ? null : wid
        });
    });

    const parseNum = (id) => {
        const v = parseFloat(document.getElementById(id)?.value);
        return isNaN(v) ? null : v;
    };

    return {
        id: analysisId,
        report_date: document.getElementById('lab-report-date')?.value || new Date().toISOString().split('T')[0],
        shift_name: document.getElementById('lab-shift-type')?.value || 'День',
        equipment: document.getElementById('lab-line-number')?.value || 'ЛФМ-1',
        stream_line: document.getElementById('lab-flow-number')?.value || '1',
        master_name: document.getElementById('lab-master-name')?.value || '',
        machinist_name: document.getElementById('lab-machinist-name')?.value || '',
        specialist_name: document.getElementById('lab-inspector-name')?.value || 'Мусаилова З.',
        product_name: document.getElementById('lab-product-name')?.value || 'Шифер 8 волн серый',
        thickness_nominal: document.getElementById('lab-thickness-spec')?.value || '5.8 мм',
        batch_number: document.getElementById('lab-batch-number')?.value || '',
        launch_time: document.getElementById('lab-start-time')?.value || '08:00',

        asbestos_kg: parseNum('lab-raw-asbestos') || 0.0,
        cement_kg: parseNum('lab-raw-cement') || 0.0,
        cellulose_kg: parseNum('lab-raw-cellulose') || 0.0,
        asbozurit_kg: parseNum('lab-raw-asbozurite') || 0.0,
        crushed_slate_kg: parseNum('lab-raw-crushed-slate') || 0.0,
        fiberglass_kg: parseNum('lab-raw-fiberglass') || 0.0,

        begun_time_min: parseNum('lab-begun-time'),
        chrysotile_moisture_pct: parseNum('lab-chrysotile-moist'),
        fluffing_pct: parseNum('lab-fluffing') ?? parseNum('lab-runner-1'),
        hydropulper_time_min: parseNum('lab-hydropulper-time'),
        hydropulper_conc_pct: parseNum('lab-hydropulper-conc') ?? parseNum('lab-hydropulper-1'),
        turbomixer_conc_pct: parseNum('lab-turbomixer-conc') ?? parseNum('lab-turbomixer-1'),
        bucket_mixer_conc_pct: parseNum('lab-bucket-mixer'),
        defective_mixer_conc_pct: parseNum('lab-defective-mixer') ?? parseNum('lab-pulper-waste'),
        dilution_water_pct: parseNum('lab-dilution-water'),
        clean_recuperator_conc_pct: parseNum('lab-clean-recuperator') ?? parseNum('lab-recuperator-1'),
        recuperator_water_temp_c: parseNum('lab-recuperator-temp'),
        pool_temp_c: parseNum('lab-pool-temp'),
        cellulose_dry_residue: document.getElementById('lab-cellulose-dry-residue')?.value || '',

        vat_1_conc: parseNum('lab-vat-1-conc'),
        vat_2_conc: parseNum('lab-vat-2-conc'),
        vat_3_conc: parseNum('lab-vat-3-conc'),
        vat_4_conc: parseNum('lab-vat-4-conc'),
        vat_1_sediment: parseNum('lab-vat-1-sediment') ?? parseNum('lab-bath-sieve-1'),
        vat_2_sediment: parseNum('lab-vat-2-sediment') ?? parseNum('lab-bath-sieve-2'),
        vat_3_sediment: parseNum('lab-vat-3-sediment') ?? parseNum('lab-bath-sieve-3'),
        vat_4_sediment: parseNum('lab-vat-4-sediment') ?? parseNum('lab-bath-sieve-4'),

        film_moisture_data: filmData,
        density_moisture_data: densityData,
        hourly_gp_data: hourlyData,
        notes: document.getElementById('lab-notes')?.value || '',
        status: status
    };
}

// Сохранение черновика
async function saveLabAnalysisDraft() {
    const btn = document.getElementById('btn-save-lab-draft');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Сохранение...';

    try {
        const payload = collectLabFormData('draft');
        const isUpdate = !!payload.id;
        const url = isUpdate ? `/api/qcd/lab/reports/${payload.id}` : '/api/qcd/lab/reports';
        const method = isUpdate ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Ошибка сохранения черновика');
        }

        const saved = await res.json();
        document.getElementById('lab-analysis-id').value = saved.id;
        document.getElementById('lab-active-status-badge').innerHTML = `📝 Черновик сохранен (#${saved.id})`;
        document.getElementById('lab-active-status-badge').style.background = '#fef3c7';
        document.getElementById('lab-active-status-badge').style.color = '#b45309';

        showQcdModal('Черновик сохранен', `Лабораторный анализ за ${saved.report_date} (${saved.shift_type || saved.shift_name}) успешно сохранен в базе данных. Вы можете продолжать вносить замеры.`, 'success');
    } catch(err) {
        showQcdModal('Ошибка сохранения', err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk" style="color: #0284c7;"></i> <span>Сохранить черновик</span>';
    }
}

// Завершение смены и выгрузка в Google Sheets (с confirm-диалогом)
function submitLabAnalysisComplete() {
    showQcdConfirm(
        'Завершить и выгрузить?',
        'Анализ смены будет завершён и выгружен в Google Таблицу. Убедитесь, что все данные заполнены верно.',
        _doSubmitLabAnalysisComplete
    );
}

async function _doSubmitLabAnalysisComplete() {
    const btn = document.getElementById('btn-submit-lab-complete');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Выгрузка в Google...';


    try {
        const payload = collectLabFormData('completed');
        const isUpdate = !!payload.id;
        const url = isUpdate ? `/api/qcd/lab/reports/${payload.id}` : '/api/qcd/lab/reports';
        const method = isUpdate ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Ошибка сохранения анализа');
        }

        const saved = await res.json();
        document.getElementById('lab-analysis-id').value = saved.id;

        // Триггерим выгрузку в Google Таблицу
        const syncRes = await fetch(`/api/qcd/lab/reports/${saved.id}/sync-google`, { method: 'POST' });
        const syncData = syncRes.ok ? await syncRes.json() : null;

        document.getElementById('lab-active-status-badge').innerHTML = `✓ Синхронизировано с Google (#${saved.id})`;
        document.getElementById('lab-active-status-badge').style.background = '#dcfce7';
        document.getElementById('lab-active-status-badge').style.color = '#15803d';

        if (syncData && syncData.sheet_url) {
            document.getElementById('lab-google-link-container').innerHTML = `
                <a href="${syncData.sheet_url}" target="_blank" class="qcd-btn-secondary" style="color: #15803d; font-weight: 800;">
                    <i class="fa-solid fa-table"></i>
                    <span>Открыть лист в Google Таблице</span>
                </a>
            `;
        }

        showQcdModal('Успешно выгружено!', `Анализ СКК за смену ${saved.report_date} (${saved.shift_type || saved.shift_name}) сохранен и сформирован отдельный лист в Google Таблице месяца!`, 'success');
    } catch(err) {
        showQcdModal('Ошибка выгрузки', err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> <span>Завершить и выгрузить в Google Таблицу</span>';
    }
}

// Очистка формы
function resetLabForm() {
    document.getElementById('lab-analysis-id').value = '';
    document.getElementById('lab-active-status-badge').innerHTML = '📝 Новый бланк смены (Черновик)';
    document.getElementById('lab-active-status-badge').style.background = '#e0f2fe';
    document.getElementById('lab-active-status-badge').style.color = '#0369a1';
    document.getElementById('lab-google-link-container').innerHTML = '';

    // Сброс сырья
    document.querySelectorAll('.lab-raw-inp').forEach(inp => inp.value = '');
    recalcLabRawMaterialsTotal();

    // Сброс подготовки массы
    ['lab-begun-time', 'lab-chrysotile-moist', 'lab-fluffing', 'lab-hydropulper-time',
     'lab-hydropulper-conc', 'lab-turbomixer-conc', 'lab-bucket-mixer', 'lab-defective-mixer',
     'lab-dilution-water', 'lab-clean-recuperator', 'lab-recuperator-temp', 'lab-pool-temp',
     'lab-cellulose-dry-residue', 'lab-vat-1-conc', 'lab-vat-2-conc', 'lab-vat-3-conc', 'lab-vat-4-conc',
     'lab-vat-1-sediment', 'lab-vat-2-sediment', 'lab-vat-3-sediment', 'lab-vat-4-sediment'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.value = '';
            el.classList.remove('norm-danger', 'norm-warning');
        }
    });

    document.getElementById('lab-notes').value = '';

    // Переинициализация таблиц
    document.getElementById('lab-film-tbody').innerHTML = '';
    document.getElementById('lab-density-tbody').innerHTML = '';
    document.getElementById('lab-hourly-tbody').innerHTML = '';
    isLabFormInitialized = false;
    initLabFormIfNeeded();
}

// Загрузка анализа в форму для продолжения ввода
async function editLabReport(id) {
    try {
        const res = await fetch(`/api/qcd/lab/reports/${id}`);
        if (!res.ok) throw new Error('Ошибка загрузки данных анализа');
        const data = await res.json();

        switchQcdTab('lab');

        document.getElementById('lab-analysis-id').value = data.id;
        document.getElementById('lab-report-date').value = data.report_date;
        document.getElementById('lab-shift-type').value = data.shift_name || data.shift_type || 'День';
        document.getElementById('lab-line-number').value = data.equipment || data.line_number || 'ЛФМ-1';
        document.getElementById('lab-flow-number').value = data.stream_line || data.flow_number || 1;
        document.getElementById('lab-master-name').value = data.master_name || '';
        document.getElementById('lab-machinist-name').value = data.machinist_name || '';
        document.getElementById('lab-inspector-name').value = data.specialist_name || data.inspector_name || 'Мусаилова З.';
        document.getElementById('lab-product-name').value = data.product_name || 'Шифер 8 волн серый';
        document.getElementById('lab-thickness-spec').value = data.thickness_nominal || data.thickness_spec || '5.8 мм';
        document.getElementById('lab-batch-number').value = data.batch_number || '';
        document.getElementById('lab-start-time').value = data.launch_time || data.start_time || '08:00';

        // Сырье
        const setVal = (id, v) => {
            const el = document.getElementById(id);
            if (el) el.value = v ?? '';
        };
        setVal('lab-raw-asbestos', data.asbestos_kg ?? data.raw_asbestos);
        setVal('lab-raw-cement', data.cement_kg ?? data.raw_cement);
        setVal('lab-raw-cellulose', data.cellulose_kg ?? data.raw_cellulose);
        setVal('lab-raw-asbozurite', data.asbozurit_kg ?? data.raw_asbozurite);
        setVal('lab-raw-crushed-slate', data.crushed_slate_kg ?? data.raw_crushed_slate);
        setVal('lab-raw-fiberglass', data.fiberglass_kg ?? data.raw_fiberglass);
        recalcLabRawMaterialsTotal();

        // Подготовка массы
        setVal('lab-begun-time', data.begun_time_min);
        setVal('lab-chrysotile-moist', data.chrysotile_moisture_pct);
        setVal('lab-fluffing', data.fluffing_pct ?? data.runner_1);
        setVal('lab-hydropulper-time', data.hydropulper_time_min);
        setVal('lab-hydropulper-conc', data.hydropulper_conc_pct ?? data.hydropulper_1);
        setVal('lab-turbomixer-conc', data.turbomixer_conc_pct ?? data.turbomixer_1);
        setVal('lab-bucket-mixer', data.bucket_mixer_conc_pct ?? data.bucket_mixer);
        setVal('lab-defective-mixer', data.defective_mixer_conc_pct ?? data.pulper_waste);
        setVal('lab-dilution-water', data.dilution_water_pct);
        setVal('lab-clean-recuperator', data.clean_recuperator_conc_pct ?? data.recuperator_1);
        setVal('lab-recuperator-temp', data.recuperator_water_temp_c);
        setVal('lab-pool-temp', data.pool_temp_c);
        setVal('lab-cellulose-dry-residue', data.cellulose_dry_residue);

        setVal('lab-vat-1-conc', data.vat_1_conc);
        setVal('lab-vat-2-conc', data.vat_2_conc);
        setVal('lab-vat-3-conc', data.vat_3_conc);
        setVal('lab-vat-4-conc', data.vat_4_conc);
        setVal('lab-vat-1-sediment', data.vat_1_sediment ?? data.bath_sieve_1);
        setVal('lab-vat-2-sediment', data.vat_2_sediment ?? data.bath_sieve_2);
        setVal('lab-vat-3-sediment', data.vat_3_sediment ?? data.bath_sieve_3);
        setVal('lab-vat-4-sediment', data.vat_4_sediment ?? data.bath_sieve_4);

        // Таблицы замеров
        const filmTbody = document.getElementById('lab-film-tbody');
        filmTbody.innerHTML = '';
        (data.film_moisture_data || []).forEach(r => addLabFilmRow(r));

        const densityTbody = document.getElementById('lab-density-tbody');
        densityTbody.innerHTML = '';
        (data.density_moisture_data || []).forEach(r => addLabDensityRow(r));

        const hourlyTbody = document.getElementById('lab-hourly-tbody');
        hourlyTbody.innerHTML = '';
        (data.hourly_gp_data || []).forEach(r => addLabHourlyRow(r));

        document.getElementById('lab-notes').value = data.notes || '';

        // Статус
        if (data.google_synced && data.google_sheet_url) {
            document.getElementById('lab-active-status-badge').innerHTML = `✓ Синхронизировано с Google (#${data.id})`;
            document.getElementById('lab-active-status-badge').style.background = '#dcfce7';
            document.getElementById('lab-active-status-badge').style.color = '#15803d';
            document.getElementById('lab-google-link-container').innerHTML = `
                <a href="${data.google_sheet_url}" target="_blank" class="qcd-btn-secondary" style="color: #15803d; font-weight: 800;">
                    <i class="fa-solid fa-table"></i>
                    <span>Открыть лист в Google Таблице</span>
                </a>
            `;
        } else {
            document.getElementById('lab-active-status-badge').innerHTML = `📝 Редактирование черновика (#${data.id})`;
            document.getElementById('lab-active-status-badge').style.background = '#fef3c7';
            document.getElementById('lab-active-status-badge').style.color = '#b45309';
            document.getElementById('lab-google-link-container').innerHTML = '';
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch(err) {
        showQcdModal('Ошибка', err.message, 'error');
    }
}

// Загрузка реестра анализов
async function loadLabReportsJournal() {
    const tbody = document.getElementById('lab-journal-tbody');
    if (!tbody) return;

    try {
        const res = await fetch('/api/qcd/lab/reports?limit=50');
        if (!res.ok) throw new Error('Ошибка загрузки реестра анализов');
        const list = await res.json();

        if (!list || list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: var(--qcd-subtext); padding: 1.5rem;">Анализов пока нет</td></tr>';
            return;
        }

        tbody.innerHTML = list.map(r => {
            const shiftName = r.shift_name || r.shift_type || 'День';
            const isDay = shiftName.includes('День');
            const shiftBadge = isDay 
                ? '<span class="shift-badge badge-day">☀️ День</span>' 
                : '<span class="shift-badge badge-night">🌙 Ночь</span>';

            const equipName = r.equipment || r.line_number || 'ЛФМ-1';
            const streamName = r.stream_line || r.flow_number || '1';
            const inspectorName = r.specialist_name || r.inspector_name || 'Мусаилова З.';

            const gStatus = r.google_synced && r.google_sheet_url
                ? `<a href="${r.google_sheet_url}" target="_blank" class="stripe-badge" style="background: #dcfce7; color: #15803d; text-decoration: none; font-weight: 700;">✓ Открыть лист</a>`
                : (r.google_synced ? '<span class="stripe-badge" style="background: #dcfce7; color: #15803d;">✓ Выгружен</span>'
                   : `<button class="qcd-btn-secondary" style="padding: 3px 8px; font-size: 0.72rem;" onclick="retryLabGoogleSync(${r.id})">Выгрузить</button>`);

            const statusBadge = r.status === 'completed'
                ? '<span class="stripe-badge" style="background: #e0f2fe; color: #0369a1;">Завершен</span>'
                : '<span class="stripe-badge" style="background: #fef3c7; color: #b45309;">Черновик</span>';

            const totalSamples = (r.film_moisture_data?.length || 0) + (r.density_moisture_data?.length || 0) + (r.hourly_gp_data?.length || 0);

            return `
                <tr>
                    <td style="font-weight: 800; color: var(--qcd-navy);">${r.report_date}</td>
                    <td>${shiftBadge}</td>
                    <td><strong>${equipName}</strong> (п. ${streamName})</td>
                    <td>${r.master_name || '—'}</td>
                    <td><strong>${inspectorName}</strong></td>
                    <td style="font-size: 0.82rem;">${r.product_name} <span style="color: var(--qcd-subtext);">(${r.batch_number || 'Партия —'})</span></td>
                    <td style="text-align: center; font-weight: 700;">${totalSamples} замеров</td>
                    <td style="text-align: center;">${statusBadge}</td>
                    <td style="text-align: center;">${gStatus}</td>
                    <td style="text-align: center;">
                        <div style="display: flex; gap: 4px; justify-content: center;">
                            <button class="qcd-btn-secondary" style="padding: 4px 8px;" onclick="editLabReport(${r.id})" title="Редактировать / Продолжить ввод">
                                <i class="fa-solid fa-pen-to-square"></i>
                            </button>
                            <button class="lab-btn-sm" style="padding: 4px 8px;" onclick="deleteLabReport(${r.id})" title="Удалить">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    } catch(err) {
        tbody.innerHTML = `<tr><td colspan="10" style="color: red; padding: 1rem;">${err.message}</td></tr>`;
    }
}

// Удаление анализа
async function deleteLabReport(id) {
    if (!confirm('Вы уверены, что хотите удалить этот анализ?')) return;

    try {
        const res = await fetch(`/api/qcd/lab/reports/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Ошибка удаления анализа');
        showQcdModal('Удалено', 'Анализ успешно удален.', 'success');
        loadLabReportsJournal();
    } catch(err) {
        showQcdModal('Ошибка', err.message, 'error');
    }
}

// Повторная выгрузка в Google
async function retryLabGoogleSync(id) {
    try {
        const res = await fetch(`/api/qcd/lab/reports/${id}/sync-google`, { method: 'POST' });
        if (!res.ok) throw new Error('Ошибка отправки на синхронизацию');
        showQcdModal('Запрос отправлен', 'Выгрузка анализа в Google Таблицу поставлена в очередь.', 'success');
        setTimeout(loadLabReportsJournal, 2500);
    } catch(err) {
        showQcdModal('Ошибка', err.message, 'error');
    }
}

// Загрузка списка Google Таблиц по месяцам
async function loadMonthlySpreadsheets() {
    const card = document.getElementById('monthly-sheets-card');
    const container = document.getElementById('monthly-sheets-container');
    if (!container) return;

    try {
        const res = await fetch('/api/qcd/lab/monthly-spreadsheets');
        if (!res.ok) return;
        const list = await res.json();

        if (list && list.length > 0) {
            card.style.display = 'block';
            container.innerHTML = list.map(s => `
                <a href="${s.spreadsheet_url}" target="_blank" class="user-chip" style="text-decoration: none; background: #ffffff; border-color: #0284c7; color: #0284c7;">
                    <i class="fa-solid fa-file-excel" style="color: #107c41;"></i>
                    <span>${s.title}</span>
                    <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.75rem;"></i>
                </a>
            `).join('');
        }
    } catch(e) {
        console.warn('Could not load monthly spreadsheets list:', e);
    }
}
