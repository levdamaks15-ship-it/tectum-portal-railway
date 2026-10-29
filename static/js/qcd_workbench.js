/**
 * QCD Workbench - Интерактивный верстак переборки партии СКК
 * @description Логика выбора партии, сопоставления с рапортом мастера,
 * автоподсчета дефектов по заводскому стандарту, валидации баланса и сохранения.
 */

let currentBatchId = null;
let currentBatchData = null;
let allRecentBatches = [];

// Инициализация верстака
document.addEventListener('DOMContentLoaded', async () => {
    await loadRecentBatches();
    setupDefectListeners();
});

// Загрузка последних партий для селектора
async function loadRecentBatches() {
    const selectEl = document.getElementById('qcd-batch-select');
    const loadingBadge = document.getElementById('qcd-loading-badge');
    if (loadingBadge) loadingBadge.style.display = 'inline-flex';

    try {
        const res = await fetch('/api/qcd/batches/recent?limit=40');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const batches = await res.json();
        allRecentBatches = batches;

        if (selectEl) {
            selectEl.innerHTML = '';
            if (batches.length === 0) {
                selectEl.innerHTML = '<option value="">Нет доступных партий</option>';
                return;
            }

            batches.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b.id;
                const statusTag = b.qcd_verified ? '✓ СКК' : 'Ожидает';
                opt.textContent = `Партия №${b.batch_number} • ${b.date} (${b.shift_name}) • ${b.master_name} • ${b.product_name} [${statusTag}]`;
                selectEl.appendChild(opt);
            });

            // Выбираем первую партию по умолчанию
            if (batches.length > 0) {
                currentBatchId = batches[0].id;
                selectEl.value = currentBatchId;
                await selectBatch(currentBatchId);
            }
        }
    } catch (err) {
        console.error('Ошибка загрузки партий:', err);
        showQcdToast('Ошибка при загрузке списка партий с сервера', 'error');
    } finally {
        if (loadingBadge) loadingBadge.style.display = 'none';
    }
}

// Переключение выбранной партии из выпадающего списка
async function onBatchSelectChange() {
    const selectEl = document.getElementById('qcd-batch-select');
    if (!selectEl) return;
    const batchId = parseInt(selectEl.value, 10);
    if (batchId) {
        await selectBatch(batchId);
    }
}

// Загрузка полных деталей партии
async function selectBatch(batchId) {
    currentBatchId = batchId;
    const workArea = document.getElementById('qcd-workbench-area');
    const loader = document.getElementById('qcd-batch-loader');
    
    if (loader) loader.style.display = 'flex';
    if (workArea) workArea.style.opacity = '0.5';

    try {
        const res = await fetch(`/api/qcd/batches/${batchId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        currentBatchData = data;
        renderBatchData(data);
    } catch (err) {
        console.error('Ошибка деталей партии:', err);
        showQcdToast('Не удалось загрузить данные партии', 'error');
    } finally {
        if (loader) loader.style.display = 'none';
        if (workArea) workArea.style.opacity = '1';
    }
}

// Отрисовка данных в карточках мастера и СКК
function renderBatchData(data) {
    // 1. Хлебные крошки и статус
    const titleEl = document.getElementById('batch-hero-title');
    if (titleEl) {
        titleEl.textContent = `Партия №${data.batch_number}`;
    }
    const metaEl = document.getElementById('batch-hero-meta');
    if (metaEl) {
        metaEl.textContent = `${data.date} • Смена ${data.shift_name} • Мастер: ${data.master_name} • ${data.product_name}`;
    }

    const statusBadge = document.getElementById('batch-status-badge');
    if (statusBadge) {
        if (data.qcd_verified) {
            statusBadge.className = 'status-chip status-verified';
            statusBadge.innerHTML = `<i class="fa-solid fa-check-double"></i> Проверено СКК (${data.qcd_verified_by || 'Инспектор'})`;
        } else {
            statusBadge.className = 'status-chip status-pending';
            statusBadge.innerHTML = `<i class="fa-solid fa-clock"></i> Ожидает проверки СКК`;
        }
    }

    // 2. Карточка мастера (Базовый ориентир)
    const m = data.master;
    setFieldText('m-condition', formatNum(m.condition));
    setFieldText('m-first-grade', formatNum(m.first_grade));
    setFieldText('m-defect', formatNum(m.defect));
    setFieldText('m-formed', formatNum(data.lfm_sheets));
    setFieldText('m-total-sorted', formatNum(m.condition + m.first_grade + m.defect));
    setFieldText('m-pct-defect', `${m.pct_defect.toFixed(2)}%`);

    // 3. Предзаполнение полей СКК
    const q = data.qcd;
    setInputValue('qcd-condition-input', q.condition);
    setInputValue('qcd-first-grade-input', q.first_grade);
    setInputValue('qcd-defect-input', q.defect);

    // 11 категорий 1-го сорта
    setInputValue('fg-chip', q.fg_chip);
    setInputValue('fg-scratch', q.fg_scratch);
    setInputValue('fg-bad-cut', q.fg_bad_cut);
    setInputValue('fg-stick-bottom', q.fg_stick_bottom);
    setInputValue('fg-stick-top', q.fg_stick_top);
    setInputValue('fg-curved-edge', q.fg_curved_edge);
    setInputValue('fg-no-pattern', q.fg_no_pattern);
    setInputValue('fg-dent', q.fg_dent);
    setInputValue('fg-thickness', q.fg_thickness);
    setInputValue('fg-delamination', q.fg_delamination);
    setInputValue('fg-edge', q.fg_edge);

    // Брак
    setInputValue('def-fell-box', q.def_fell_box);
    setInputValue('def-broken', q.def_broken);
    setInputValue('def-tech', q.def_tech);

    // Причина и замечания
    const rootCauseSelect = document.getElementById('qcd-root-cause');
    if (rootCauseSelect) {
        rootCauseSelect.value = data.qcd_root_cause || '';
    }
    const notesText = document.getElementById('qcd-notes-text');
    if (notesText) {
        notesText.value = data.qcd_notes || '';
    }

    recalcQcdBalance();
}

// Привязка слушателей пересчета к инпутам дефектов
function setupDefectListeners() {
    const fgInputs = document.querySelectorAll('.fg-input');
    fgInputs.forEach(inp => {
        inp.addEventListener('input', () => {
            sumFirstGradeFromDefects();
            recalcQcdBalance();
        });
    });

    const defInputs = document.querySelectorAll('.def-input');
    defInputs.forEach(inp => {
        inp.addEventListener('input', () => {
            sumDefectsFromCategories();
            recalcQcdBalance();
        });
    });

    // Слушатели на 3 главных инпута
    ['qcd-condition-input', 'qcd-first-grade-input', 'qcd-defect-input'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', recalcQcdBalance);
        }
    });
}

// Суммирование 11 видов 1-го сорта
function sumFirstGradeFromDefects() {
    let sum = 0;
    document.querySelectorAll('.fg-input').forEach(inp => {
        sum += parseInt(inp.value, 10) || 0;
    });
    const mainFgInput = document.getElementById('qcd-first-grade-input');
    if (mainFgInput) {
        mainFgInput.value = sum;
    }
    const badge = document.getElementById('badge-sum-fg');
    if (badge) badge.textContent = `${sum} шт`;
}

// Суммирование категорий брака
function sumDefectsFromCategories() {
    let sum = 0;
    document.querySelectorAll('.def-input').forEach(inp => {
        sum += parseInt(inp.value, 10) || 0;
    });
    const mainDefInput = document.getElementById('qcd-defect-input');
    if (mainDefInput) {
        mainDefInput.value = sum;
    }
    const badge = document.getElementById('badge-sum-def');
    if (badge) badge.textContent = `${sum} шт`;
}

// Живой пересчет баланса партии и дельт
function recalcQcdBalance() {
    if (!currentBatchData) return;

    const formed = currentBatchData.lfm_sheets || 0;
    const cond = parseInt(document.getElementById('qcd-condition-input')?.value, 10) || 0;
    const fg = parseInt(document.getElementById('qcd-first-grade-input')?.value, 10) || 0;
    const def = parseInt(document.getElementById('qcd-defect-input')?.value, 10) || 0;

    const totalSorted = cond + fg + def;
    const diff = formed - totalSorted;

    // Дельты от мастера
    const m = currentBatchData.master;
    renderDelta('delta-condition', cond - m.condition);
    renderDelta('delta-first-grade', fg - m.first_grade);
    renderDelta('delta-defect', def - m.defect);

    // Сводные индикаторы
    setFieldText('qcd-sum-sorted', formatNum(totalSorted));
    const pctDef = totalSorted > 0 ? ((def / totalSorted) * 100).toFixed(2) : '0.00';
    setFieldText('qcd-pct-defect', `${pctDef}%`);

    // Баннер сходимости
    const banner = document.getElementById('qcd-balance-banner');
    const equationText = document.getElementById('balance-equation-text');
    const badgeEl = document.getElementById('balance-status-badge');

    if (equationText) {
        equationText.innerHTML = `Формовка <strong>${formatNum(formed)} шт</strong> = ГП <strong>${formatNum(cond)}</strong> + 1-й сорт <strong>${formatNum(fg)}</strong> + Брак <strong>${formatNum(def)}</strong> (Итого предъявлено: ${formatNum(totalSorted)} шт)`;
    }

    if (badgeEl) {
        if (diff === 0) {
            badgeEl.className = 'balance-badge balance-match';
            badgeEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Баланс сошелся (Невязка 0 шт)`;
            if (banner) banner.style.borderColor = '#86efac';
        } else if (diff > 0) {
            badgeEl.className = 'balance-badge balance-buffer';
            badgeEl.innerHTML = `<i class="fa-solid fa-layer-group"></i> Остаток в камере/буфере: +${formatNum(diff)} шт`;
            if (banner) banner.style.borderColor = '#cbd5e1';
        } else {
            badgeEl.className = 'balance-badge balance-excess';
            badgeEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Списано больше формовки: ${formatNum(diff)} шт`;
            if (banner) banner.style.borderColor = '#fca5a5';
        }
    }
}

// Отрисовка цветного бейджа разницы (+ / -)
function renderDelta(elemId, delta) {
    const el = document.getElementById(elemId);
    if (!el) return;
    if (delta > 0) {
        el.className = 'delta-pill delta-plus';
        el.textContent = `+${delta}`;
    } else if (delta < 0) {
        el.className = 'delta-pill delta-minus';
        el.textContent = `${delta}`;
    } else {
        el.className = 'delta-pill delta-zero';
        el.textContent = `0`;
    }
}

// Сброс полей СКК к первичным значениям мастера
function resetToMasterValues() {
    if (!currentBatchData) return;
    const m = currentBatchData.master;
    setInputValue('qcd-condition-input', m.condition);
    setInputValue('qcd-first-grade-input', m.first_grade);
    setInputValue('qcd-defect-input', m.defect);

    // Сброс детальных дефектов
    setInputValue('fg-chip', m.defect_chip || 0);
    setInputValue('fg-scratch', m.defect_scratch || 0);
    setInputValue('fg-bad-cut', m.defect_bad_cut || 0);
    setInputValue('fg-stick-bottom', m.defect_stick_bottom || 0);
    setInputValue('fg-stick-top', m.defect_stick_top || 0);
    setInputValue('fg-curved-edge', 0);
    setInputValue('fg-no-pattern', 0);
    setInputValue('fg-dent', m.defect_dent || 0);
    setInputValue('fg-thickness', m.defect_thickness || 0);
    setInputValue('fg-delamination', m.defect_delamination || 0);
    setInputValue('fg-edge', m.defect_edge || 0);

    setInputValue('def-fell-box', m.defect_fell_box || 0);
    setInputValue('def-broken', m.defect_broken || 0);
    setInputValue('def-tech', 0);

    recalcQcdBalance();
    showQcdToast('Значения возвращены к первичному рапорту мастера', 'info');
}

// Отправка утверждения СКК на бэкенд
async function submitQcdVerification() {
    if (!currentBatchId) {
        showQcdToast('Партия не выбрана', 'error');
        return;
    }

    const btn = document.getElementById('btn-submit-qcd-verify');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Сохранение и синхронизация...';
    }

    // Сборка DTO
    const payload = {
        condition: parseInt(document.getElementById('qcd-condition-input')?.value, 10) || 0,
        first_grade: parseInt(document.getElementById('qcd-first-grade-input')?.value, 10) || 0,
        defect_total: parseInt(document.getElementById('qcd-defect-input')?.value, 10) || 0,
        
        // 11 категорий 1 сорта
        fg_chip: parseInt(document.getElementById('fg-chip')?.value, 10) || 0,
        fg_scratch: parseInt(document.getElementById('fg-scratch')?.value, 10) || 0,
        fg_bad_cut: parseInt(document.getElementById('fg-bad-cut')?.value, 10) || 0,
        fg_stick_bottom: parseInt(document.getElementById('fg-stick-bottom')?.value, 10) || 0,
        fg_stick_top: parseInt(document.getElementById('fg-stick-top')?.value, 10) || 0,
        fg_curved_edge: parseInt(document.getElementById('fg-curved-edge')?.value, 10) || 0,
        fg_no_pattern: parseInt(document.getElementById('fg-no-pattern')?.value, 10) || 0,
        fg_dent: parseInt(document.getElementById('fg-dent')?.value, 10) || 0,
        fg_thickness: parseInt(document.getElementById('fg-thickness')?.value, 10) || 0,
        fg_delamination: parseInt(document.getElementById('fg-delamination')?.value, 10) || 0,
        fg_edge: parseInt(document.getElementById('fg-edge')?.value, 10) || 0,
        
        // Брак
        def_fell_box: parseInt(document.getElementById('def-fell-box')?.value, 10) || 0,
        def_broken: parseInt(document.getElementById('def-broken')?.value, 10) || 0,
        def_tech: parseInt(document.getElementById('def-tech')?.value, 10) || 0,

        root_cause: document.getElementById('qcd-root-cause')?.value || null,
        notes: document.getElementById('qcd-notes-text')?.value || null,
        inspector_name: document.getElementById('user-greeting-name')?.textContent || 'Инспектор СКК'
    };

    try {
        const res = await fetch(`/api/qcd/batches/${currentBatchId}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || `HTTP ${res.status}`);
        }

        const resData = await res.json();
        showQcdToast(resData.message || 'Партия успешно утверждена СКК!', 'success');

        // Обновляем текущую партию в селекторе и UI
        await selectBatch(currentBatchId);
        await loadRecentBatches();
    } catch (err) {
        console.error('Ошибка сохранения верификации:', err);
        showQcdToast(`Ошибка сохранения: ${err.message}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check-double"></i> <span>Утвердить и синхронизировать с листом «Переборка»</span>';
        }
    }
}

// Вспомогательные функции
function setFieldText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setInputValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = (val !== undefined && val !== null) ? val : 0;
}

function formatNum(num) {
    if (num === null || num === undefined) return '0';
    return num.toLocaleString('ru-RU');
}

// Toast уведомления
function showQcdToast(message, type = 'info') {
    const container = document.getElementById('qcd-toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `qcd-toast qcd-toast-${type}`;
    
    let icon = 'info-circle';
    if (type === 'success') icon = 'circle-check';
    if (type === 'error') icon = 'circle-exclamation';

    toast.innerHTML = `<i class="fa-solid fa-${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

