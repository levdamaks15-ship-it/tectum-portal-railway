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
    const btnCreate = document.getElementById('tab-btn-create');
    const btnJournal = document.getElementById('tab-btn-journal');

    if (tabName === 'create') {
        tabCreate.style.display = 'block';
        tabJournal.style.display = 'none';
        btnCreate.classList.add('active');
        btnJournal.classList.remove('active');
    } else {
        tabCreate.style.display = 'none';
        tabJournal.style.display = 'block';
        btnCreate.classList.remove('active');
        btnJournal.classList.add('active');
        loadQcdReportsJournal();
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

    modal.style.display = 'flex';
}
