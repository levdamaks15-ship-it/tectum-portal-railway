/**
 * QCD Workbench - Интерактивный верстак инспектора СКК
 * @description Обеспечивает канонический Searchable Picker (выбор смены/партии),
 * автобалансировку партии, динамический выбор дефектов из 14 категорий,
 * фирменный селектор причин брака и двустороннюю синхронизацию с Google Sheets.
 */

let currentBatchId = null;
let currentBatchData = null;
let allRecentBatches = [];
let isPickerOpen = false;
let isDefectsPopoverOpen = false;
let isCausePickerOpen = false;

// 14 Канонических заводских дефектов
const FACTORY_DEFECTS_CATALOG = [
    // 1-й сорт (11 пунктов)
    { key: 'fg_chip', id: 'fg-chip', group: 'fg', title: '1. Скол (до 50×50 мм)', sub: 'Ұшпа' },
    { key: 'fg_scratch', id: 'fg-scratch', group: 'fg', title: '2. Сдир поверхности', sub: 'Бетінің сыдырылуы' },
    { key: 'fg_bad_cut', id: 'fg-bad-cut', group: 'fg', title: '3. Плохой рез', sub: 'Нашар кесілген' },
    { key: 'fg_stick_bottom', id: 'fg-stick-bottom', group: 'fg', title: '4. Налип снизу', sub: 'Төменгі жабысу' },
    { key: 'fg_stick_top', id: 'fg-stick-top', group: 'fg', title: '5. Налип сверху', sub: 'Үстінен жабысу' },
    { key: 'fg_curved_edge', id: 'fg-curved-edge', group: 'fg', title: '6. Кривой край / угол', sub: 'Қыры қисық (бұрыш)' },
    { key: 'fg_no_pattern', id: 'fg-no-pattern', group: 'fg', title: '7. Нет рисунка', sub: 'Өрнегі жоқ' },
    { key: 'fg_dent', id: 'fg-dent', group: 'fg', title: '8. Вмятина / Ойық', sub: 'Майысқан / Ойық' },
    { key: 'fg_thickness', id: 'fg-thickness', group: 'fg', title: '9. Не соотв. толщине', sub: 'Қалыңдығы' },
    { key: 'fg_delamination', id: 'fg-delamination', group: 'fg', title: '10. Расслоение', sub: 'Қабатталу' },
    { key: 'fg_edge', id: 'fg-edge', group: 'fg', title: '11. Выпирание кромок', sub: 'Бүртіктенуі' },
    
    // Брак (3 пункта)
    { key: 'def_fell_box', id: 'def-fell-box', group: 'brak', title: '12. Упал с коробки', sub: 'Қораптан құлаған' },
    { key: 'def_broken', id: 'def-broken', group: 'brak', title: '13. Сломан доводчиком', sub: 'Сломан' },
    { key: 'def_tech', id: 'def-tech', group: 'brak', title: '14. Технологический / Прочий', sub: 'Технологиялық брак' }
];

// Хранилище активных значений дефектов по ключу: { fg_chip: 5, def_broken: 2 }
let activeDefectsState = {};

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
    initDefectsPickerItems();
    await loadRecentBatches();
    setupGlobalPickerClickOutside();
    setupMainInputsListeners();
});

// Заполнение каталога дефектов в выпадающий поповер
function initDefectsPickerItems() {
    const listEl = document.getElementById('defects-picker-items-list');
    if (!listEl) return;

    let html = '';
    FACTORY_DEFECTS_CATALOG.forEach(d => {
        const isBrak = d.group === 'brak';
        const badgeColor = isBrak ? '#fee2e2' : '#e0f2fe';
        const textColor = isBrak ? '#b91c1c' : '#0369a1';
        const typeText = isBrak ? 'Брак' : '1-й сорт';

        html += `
            <div class="defects-picker-item" onclick="onAddDefectFromCatalog('${d.key}')">
                <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
                    <span style="font-weight: 700; color: #1e293b; font-size: 0.8rem;">${escapeHtml(d.title)}</span>
                    <span style="font-size: 0.72rem; color: #64748b; margin-left: 4px;">(${escapeHtml(d.sub)})</span>
                </div>
                <span style="font-size: 0.68rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: ${badgeColor}; color: ${textColor}; white-space: nowrap; margin-left: 8px;">
                    ${typeText}
                </span>
            </div>
        `;
    });
    listEl.innerHTML = html;
}

// Загрузка последних партий для Searchable Picker
async function loadRecentBatches() {
    const loadingBadge = document.getElementById('qcd-loading-badge');
    if (loadingBadge) loadingBadge.style.display = 'inline-block';

    try {
        const res = await fetch('/api/qcd/batches/recent?limit=40');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // API возвращает либо массив напрямую, либо { batches: [...] }
        allRecentBatches = Array.isArray(data) ? data : (data.batches || []);

        renderBatchPickerList(allRecentBatches);

        // Если ничего не выбрано — выбираем самую первую партию
        if (!currentBatchId && allRecentBatches.length > 0) {
            await selectBatch(allRecentBatches[0].id);
        }
    } catch (err) {
        console.error('Ошибка загрузки списка смен:', err);
        showQcdToast('Не удалось загрузить партии для СКК', 'error');
    } finally {
        if (loadingBadge) loadingBadge.style.display = 'none';
    }
}

// Отрисовка списка партий в канонический поповер
function renderBatchPickerList(batches) {
    const listEl = document.getElementById('list-batch-picker-items');
    if (!listEl) return;

    if (!batches || batches.length === 0) {
        listEl.innerHTML = `
            <div style="padding: 24px; text-align: center; color: #94a3b8; font-size: 0.85rem;">
                <i class="fa-solid fa-magnifying-glass" style="font-size: 1.5rem; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
                Партии не найдены
            </div>
        `;
        return;
    }

    let html = '';
    batches.forEach(b => {
        const isSelected = b.id === currentBatchId;
        const selectedCls = isSelected ? 'selected' : '';
        const initials = getInitials(b.master_name);
        const avatarCol = getAvatarColorClass(b.master_name);
        const shiftIcon = b.shift_name.toLowerCase().includes('ночь') ? '🌙' : '☀️';

        let statusBadge = '';
        if (b.qcd_verified) {
            statusBadge = `<span class="status-chip status-verified" style="font-size: 0.7rem; padding: 2px 6px;"><i class="fa-solid fa-check"></i> СКК</span>`;
        } else {
            statusBadge = `<span class="status-chip status-pending" style="font-size: 0.7rem; padding: 2px 6px;">Ожидает</span>`;
        }

        html += `
            <div class="picker-item-card ${selectedCls}" onclick="onSelectBatchFromPicker(${b.id})">
                <div class="picker-item-left">
                    <div class="picker-avatar ${avatarCol}">${initials}</div>
                    <div class="picker-item-info">
                        <div class="picker-item-line1">
                            <span class="picker-item-batch mono">№ ${escapeHtml(b.batch_number)}</span>
                            <span class="picker-item-date">${escapeHtml(b.date)} (${shiftIcon} ${escapeHtml(b.shift_name)})</span>
                        </div>
                        <div class="picker-item-line2">
                            <span>${escapeHtml(b.master_name)}</span> • <span>${escapeHtml(b.product_name)}</span> • <span class="mono">${formatNum(b.lfm_sheets)} шт</span>
                        </div>
                    </div>
                </div>
                <div class="picker-item-right">
                    ${statusBadge}
                    ${isSelected ? '<i class="fa-solid fa-check" style="color: #2563eb; font-size: 0.85rem;"></i>' : ''}
                </div>
            </div>
        `;
    });

    listEl.innerHTML = html;
}

// Фильтрация списка партий при вводе в инпут поиска
function filterBatchList(query) {
    const clearBtn = document.getElementById('btn-clear-batch-search');
    const q = (query || '').trim().toLowerCase();
    
    if (clearBtn) {
        clearBtn.style.display = q.length > 0 ? 'block' : 'none';
    }

    if (!q) {
        renderBatchPickerList(allRecentBatches);
        return;
    }

    const filtered = allRecentBatches.filter(b => {
        const batchNum = (b.batch_number || '').toLowerCase();
        const dateStr = (b.date || '').toLowerCase();
        const master = (b.master_name || '').toLowerCase();
        const prod = (b.product_name || '').toLowerCase();
        const shift = (b.shift_name || '').toLowerCase();

        return batchNum.includes(q) ||
               dateStr.includes(q) ||
               master.includes(q) ||
               prod.includes(q) ||
               shift.includes(q);
    });

    renderBatchPickerList(filtered);
}

// Очистка строки поиска
function clearBatchSearch() {
    const input = document.getElementById('search-batch-input');
    if (input) {
        input.value = '';
        input.focus();
    }
    filterBatchList('');
}

// Переключение видимости выпадающего поповера партий
function toggleBatchPickerPopover(e) {
    if (e) e.stopPropagation();
    closeAllPopoversExcept('batch');
    const popover = document.getElementById('popover-batch-picker');
    const triggerBtn = document.getElementById('btn-batch-picker-trigger');
    if (!popover || !triggerBtn) return;

    isPickerOpen = !isPickerOpen;
    if (isPickerOpen) {
        popover.style.display = 'block';
        triggerBtn.classList.add('active');
        const searchInp = document.getElementById('search-batch-input');
        if (searchInp) {
            setTimeout(() => searchInp.focus(), 50);
        }
    } else {
        popover.style.display = 'none';
        triggerBtn.classList.remove('active');
    }
}

// Выбор партии из поповера
async function onSelectBatchFromPicker(batchId) {
    toggleBatchPickerPopover();
    await selectBatch(batchId);
}

// Закрытие всех поповеров при клике мимо
function setupGlobalPickerClickOutside() {
    document.addEventListener('click', (e) => {
        closeAllPopoversExcept(null);
    });
}

function closeAllPopoversExcept(current) {
    if (current !== 'batch') {
        const popover = document.getElementById('popover-batch-picker');
        const triggerBtn = document.getElementById('btn-batch-picker-trigger');
        if (popover) popover.style.display = 'none';
        if (triggerBtn) triggerBtn.classList.remove('active');
        isPickerOpen = false;
    }

    if (current !== 'defects') {
        const dPopover = document.getElementById('defects-picker-popover');
        if (dPopover) dPopover.style.display = 'none';
        isDefectsPopoverOpen = false;
    }

    if (current !== 'cause') {
        const cPopover = document.getElementById('cause-picker-popover');
        const cBtn = document.getElementById('btn-cause-picker-trigger');
        if (cPopover) cPopover.style.display = 'none';
        if (cBtn) cBtn.classList.remove('active');
        isCausePickerOpen = false;
    }
}

// Переключение поповера добавления дефектов
function toggleDefectsPopover(e) {
    if (e) e.stopPropagation();
    const isAlreadyOpen = isDefectsPopoverOpen;
    closeAllPopoversExcept(isAlreadyOpen ? null : 'defects');
    
    const popover = document.getElementById('defects-picker-popover');
    if (!popover) return;
    
    isDefectsPopoverOpen = !isAlreadyOpen;
    popover.style.display = isDefectsPopoverOpen ? 'block' : 'none';
}

// Переключение поповера причин брака
function toggleCausePicker(e) {
    if (e) e.stopPropagation();
    const isAlreadyOpen = isCausePickerOpen;
    closeAllPopoversExcept(isAlreadyOpen ? null : 'cause');

    const popover = document.getElementById('cause-picker-popover');
    const btn = document.getElementById('btn-cause-picker-trigger');
    if (!popover || !btn) return;

    isCausePickerOpen = !isAlreadyOpen;
    popover.style.display = isCausePickerOpen ? 'block' : 'none';
    if (isCausePickerOpen) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }
}

// Выбор причины брака
function selectRootCause(val) {
    const hiddenInp = document.getElementById('qcd-root-cause');
    const labelSpan = document.getElementById('cause-picker-selected-label');
    if (hiddenInp) hiddenInp.value = val;
    if (labelSpan) {
        labelSpan.textContent = val ? val : '— Не выбрано (в пределах нормы) —';
    }

    // Подсветка активного пункта
    const items = document.querySelectorAll('.cause-picker-item');
    items.forEach(it => {
        const txt = it.querySelector('span')?.textContent || '';
        if ((!val && txt.includes('Не выбрано')) || (val && txt === val)) {
            it.classList.add('selected');
        } else {
            it.classList.remove('selected');
        }
    });

    closeAllPopoversExcept(null);
}

// Загрузка детальных данных партии
async function selectBatch(batchId) {
    currentBatchId = batchId;
    const area = document.getElementById('qcd-workbench-area');
    if (area) area.style.opacity = '0.5';

    try {
        const res = await fetch(`/api/qcd/batches/${batchId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        currentBatchData = data;

        renderBatchData(data);
    } catch (err) {
        console.error('Ошибка загрузки партии:', err);
        showQcdToast('Ошибка загрузки деталей партии', 'error');
    } finally {
        if (area) area.style.opacity = '1';
    }
}

// Отрисовка данных партии в карточках
function renderBatchData(data) {
    // 1. Обновляем шапку триггера Searchable Picker
    const triggerBadge = document.getElementById('picker-trigger-batch-badge');
    if (triggerBadge) triggerBadge.textContent = `№ ${data.batch_number}`;
    
    const triggerTitle = document.getElementById('picker-trigger-title');
    if (triggerTitle) {
        const shiftIcon = data.shift_name.toLowerCase().includes('ночь') ? '🌙' : '☀️';
        triggerTitle.textContent = `${data.date} (${shiftIcon} ${data.shift_name}) • ${data.master_name}`;
    }

    const triggerSub = document.getElementById('picker-trigger-sub');
    if (triggerSub) {
        triggerSub.textContent = `${data.product_name} • Формовка: ${formatNum(data.lfm_sheets)} шт`;
    }

    // 2. Шапка верстака
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
            const actInfo = data.act_number ? ` • Акт ${data.act_number}` : '';
            statusBadge.className = 'status-chip status-verified';
            statusBadge.innerHTML = `<i class="fa-solid fa-check-double"></i> Проверено СКК (${data.qcd_verified_by || 'Инспектор'})${actInfo}`;
        } else {
            statusBadge.className = 'status-chip status-pending';
            statusBadge.innerHTML = `<i class="fa-solid fa-clock"></i> Ожидает проверки СКК`;
        }
    }

    const printBtn = document.getElementById('btn-print-act-a4');
    if (printBtn) {
        if (data.act_number) {
            printBtn.innerHTML = `<i class="fa-solid fa-print" style="color: #2563eb;"></i> <span>Печать (${escapeHtml(data.act_number)})</span>`;
            printBtn.title = `Распечатать утвержденный Акт ${data.act_number}`;
        } else {
            printBtn.innerHTML = `<i class="fa-solid fa-print" style="color: #2563eb;"></i> <span>📄 Печать Акта А4</span>`;
            printBtn.title = `Сформировать и распечатать официальный Акт переборки СКК на лист А4`;
        }
    }

    // 3. Карточка мастера (Базовый ориентир)
    const m = data.master;
    setFieldText('m-condition', formatNum(m.condition));
    setFieldText('m-first-grade', formatNum(m.first_grade));
    setFieldText('m-defect', formatNum(m.defect));
    setFieldText('m-formed', formatNum(data.lfm_sheets));
    setFieldText('m-pct-defect', `${m.pct_defect.toFixed(2)}%`);

    // 4. Предзаполнение полей СКК
    const q = data.qcd;
    setInputValue('qcd-condition-input', q.condition);
    setInputValue('qcd-first-grade-input', q.first_grade);
    setInputValue('qcd-defect-input', q.defect);

    // Собираем дефекты в activeDefectsState
    activeDefectsState = {};
    FACTORY_DEFECTS_CATALOG.forEach(d => {
        const val = q[d.key] || 0;
        if (val > 0) {
            activeDefectsState[d.key] = val;
        }
    });

    renderActiveDefectsList();

    // Причина и замечания
    // root_cause selector removed
    const notesText = document.getElementById('qcd-notes-text');
    if (notesText) {
        notesText.value = data.qcd_notes || '';
    }

    recalcQcdBalance();
}

// Добавление дефекта из каталога
function onAddDefectFromCatalog(defectKey) {
    closeAllPopoversExcept(null);
    if (activeDefectsState[defectKey] === undefined) {
        activeDefectsState[defectKey] = 0;
    }
    renderActiveDefectsList();

    // Фокус на инпут добавленного дефекта
    setTimeout(() => {
        const inp = document.getElementById(`defect-active-inp-${defectKey}`);
        if (inp) {
            inp.focus();
            inp.select();
        }
    }, 50);
}

// Удаление дефекта из активного списка
function onRemoveActiveDefect(defectKey) {
    delete activeDefectsState[defectKey];
    renderActiveDefectsList();
    recalcFromDefectsToMain();
}

// Отрисовка списка активных дефектов
function renderActiveDefectsList() {
    const container = document.getElementById('defects-active-list');
    const badgeCount = document.getElementById('badge-active-defects-count');
    if (!container) return;

    const keys = Object.keys(activeDefectsState);
    if (badgeCount) badgeCount.textContent = keys.length;

    if (keys.length === 0) {
        container.innerHTML = `
            <div id="defects-empty-placeholder" style="text-align: center; padding: 12px; color: #94a3b8; font-size: 0.8rem;">
                <i class="fa-solid fa-circle-check" style="color: #22c55e; margin-right: 4px;"></i>
                Отклонений не зафиксировано (партия чистая или добавьте дефект кнопкой выше)
            </div>
        `;
        return;
    }

    let html = '';
    keys.forEach(k => {
        const meta = FACTORY_DEFECTS_CATALOG.find(d => d.key === k) || { title: k, sub: '', group: 'fg' };
        const isBrak = meta.group === 'brak';
        const rowClass = isBrak ? 'is-brak' : 'is-fg';
        const val = activeDefectsState[k] || 0;

        html += `
            <div class="defect-active-row ${rowClass}">
                <div class="defect-active-title">
                    <span>${escapeHtml(meta.title)}</span>
                    <span class="defect-active-sub">(${escapeHtml(meta.sub)})</span>
                </div>
                <div class="defect-active-input-wrap">
                    <input type="number" 
                           id="defect-active-inp-${k}"
                           class="defect-active-input mono" 
                           min="0" 
                           value="${val}" 
                           oninput="onActiveDefectValueChange('${k}', this.value)">
                    <button type="button" class="btn-remove-defect" onclick="onRemoveActiveDefect('${k}')" title="Удалить дефект">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// Изменение значения в строке дефекта
function onActiveDefectValueChange(defectKey, val) {
    const num = parseInt(val, 10);
    activeDefectsState[defectKey] = isNaN(num) || num < 0 ? 0 : num;
    recalcFromDefectsToMain();
}

// Автоматический пересчет: классификация -> 1 сорт, Брак, и автоматическое вычитание из Кондиции
function recalcFromDefectsToMain() {
    if (!currentBatchData) return;

    let sumFg = 0;
    let sumBrak = 0;

    Object.entries(activeDefectsState).forEach(([k, val]) => {
        const meta = FACTORY_DEFECTS_CATALOG.find(d => d.key === k);
        if (meta && meta.group === 'brak') {
            sumBrak += val;
        } else {
            sumFg += val;
        }
    });

    // 1. Обновляем 1-й сорт и Брак
    setInputValue('qcd-first-grade-input', sumFg);
    setInputValue('qcd-defect-input', sumBrak);

    // 2. Вычитаем из общей массы партии (или из суммы мастера) в Кондицию ГП
    const m = currentBatchData.master;
    const totalBatch = m.condition + m.first_grade + m.defect; // Всего предъявлено
    const adjustedCond = Math.max(0, totalBatch - sumFg - sumBrak);

    setInputValue('qcd-condition-input', adjustedCond);

    recalcQcdBalance();
}

// Слушатели ручного ввода в 3 главных инпута
function setupMainInputsListeners() {
    ['qcd-condition-input', 'qcd-first-grade-input', 'qcd-defect-input'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', recalcQcdBalance);
        }
    });
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

    // Сброс активных дефектов
    activeDefectsState = {};
    if (m.defect_chip) activeDefectsState['fg_chip'] = m.defect_chip;
    if (m.defect_scratch) activeDefectsState['fg_scratch'] = m.defect_scratch;
    if (m.defect_bad_cut) activeDefectsState['fg_bad_cut'] = m.defect_bad_cut;
    if (m.defect_stick_bottom) activeDefectsState['fg_stick_bottom'] = m.defect_stick_bottom;
    if (m.defect_stick_top) activeDefectsState['fg_stick_top'] = m.defect_stick_top;
    if (m.defect_dent) activeDefectsState['fg_dent'] = m.defect_dent;
    if (m.defect_thickness) activeDefectsState['fg_thickness'] = m.defect_thickness;
    if (m.defect_delamination) activeDefectsState['fg_delamination'] = m.defect_delamination;
    if (m.defect_edge) activeDefectsState['fg_edge'] = m.defect_edge;
    if (m.defect_fell_box) activeDefectsState['def_fell_box'] = m.defect_fell_box;
    if (m.defect_broken) activeDefectsState['def_broken'] = m.defect_broken;

    renderActiveDefectsList();
    // reset cause
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

    // Сборка DTO из активного состояния
    const payload = {
        condition: parseInt(document.getElementById('qcd-condition-input')?.value, 10) || 0,
        first_grade: parseInt(document.getElementById('qcd-first-grade-input')?.value, 10) || 0,
        defect_total: parseInt(document.getElementById('qcd-defect-input')?.value, 10) || 0,
        
        // 11 категорий 1 сорта
        fg_chip: activeDefectsState['fg_chip'] || 0,
        fg_scratch: activeDefectsState['fg_scratch'] || 0,
        fg_bad_cut: activeDefectsState['fg_bad_cut'] || 0,
        fg_stick_bottom: activeDefectsState['fg_stick_bottom'] || 0,
        fg_stick_top: activeDefectsState['fg_stick_top'] || 0,
        fg_curved_edge: activeDefectsState['fg_curved_edge'] || 0,
        fg_no_pattern: activeDefectsState['fg_no_pattern'] || 0,
        fg_dent: activeDefectsState['fg_dent'] || 0,
        fg_thickness: activeDefectsState['fg_thickness'] || 0,
        fg_delamination: activeDefectsState['fg_delamination'] || 0,
        fg_edge: activeDefectsState['fg_edge'] || 0,
        
        // Брак
        def_fell_box: activeDefectsState['def_fell_box'] || 0,
        def_broken: activeDefectsState['def_broken'] || 0,
        def_tech: activeDefectsState['def_tech'] || 0,

        root_cause: Object.keys(activeDefectsState).filter(k => (activeDefectsState[k] || 0) > 0).map(k => {
            const meta = FACTORY_DEFECTS_CATALOG.find(d => d.key === k);
            return meta ? meta.title : k;
        }).join(', ') || null,
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

// Вспомогательные функции генерации аватаров и инициалов
function getInitials(name) {
    if (!name) return '??';
    const clean = name.trim().replace(/^[^а-яa-z0-9]+/i, '');
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
}

function getAvatarColorClass(name) {
    if (!name) return 'avatar-blue';
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (hash << 5) - hash + name.charCodeAt(i);
        hash |= 0;
    }
    const classes = ['avatar-red', 'avatar-blue', 'avatar-green', 'avatar-purple', 'avatar-amber'];
    return classes[Math.abs(hash) % classes.length];
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

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

// ==========================================================================
// МОДАЛЬНЫЕ ОКНА: ОФИЦИАЛЬНЫЙ АКТ СКК (ПЕЧАТЬ А4) И РЕЕСТР АКТОВ
// ==========================================================================

let allActsRegistryData = [];

/**
 * Открытие модального окна печати официального Акта разбраковки СКК (А4)
 * @param {number|null} reportId - ID сохраненного отчета (если открываем из реестра)
 */
async function openPrintActModal(reportId = null) {
    const modal = document.getElementById('modal-qcd-act-print');
    const container = document.getElementById('qcd-act-printable-doc');
    const badgeEl = document.getElementById('act-print-modal-badge');
    if (!modal || !container) return;

    document.body.classList.add('act-printing');
    modal.classList.add('is-open');
    modal.style.display = 'flex';
    container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #64748b;">
            <i class="fa-solid fa-spinner fa-spin fa-2x" style="color: #2563eb; margin-bottom: 12px;"></i>
            <p style="font-weight: 600; font-size: 0.95rem;">Формирование официального Акта СКК...</p>
        </div>
    `;

    try {
        let actData = null;
        if (reportId) {
            const res = await fetch(`/api/qcd/reports/${reportId}`);
            if (!res.ok) throw new Error('Не удалось загрузить данные акта');
            actData = await res.json();
        } else if (currentBatchId) {
            const res = await fetch(`/api/qcd/reports/by-batch/${currentBatchId}`);
            if (!res.ok) throw new Error('Не удалось сформировать акт для выбранной партии');
            actData = await res.json();

            // Если открываем предпросмотр не сохраненного в БД акта, учитываем текущие данные из полей ввода
            if (!actData.id) {
                const scrCond = parseInt(document.getElementById('qcd-condition-input')?.value, 10);
                const scrFg = parseInt(document.getElementById('qcd-first-grade-input')?.value, 10);
                const scrDef = parseInt(document.getElementById('qcd-defect-input')?.value, 10);
                const scrNotes = document.getElementById('qcd-notes-text')?.value;

                if (!isNaN(scrCond)) actData.condition = scrCond;
                if (!isNaN(scrFg)) actData.first_grade_total = scrFg;
                if (!isNaN(scrDef)) actData.defect_total = scrDef;
                if (scrNotes) actData.notes = scrNotes;

                if (activeDefectsState && Object.keys(activeDefectsState).length > 0) {
                    const fgMerged = { ...(actData.first_grade_details || {}) };
                    const defMerged = { ...(actData.defect_details || {}) };
                    for (const [k, v] of Object.entries(activeDefectsState)) {
                        const cleanKey = k.replace(/^(fg_|def_)/, '');
                        if (k.startsWith('fg_') || cleanKey in fgMerged) {
                            fgMerged[cleanKey] = v;
                            fgMerged[k] = v;
                        } else if (k.startsWith('def_') || cleanKey in defMerged) {
                            defMerged[cleanKey] = v;
                            defMerged[k] = v;
                        }
                    }
                    actData.first_grade_details = fgMerged;
                    actData.defect_details = defMerged;
                }
            }
        } else {
            showQcdToast('Сначала выберите партию для формирования Акта', 'error');
            closePrintActModal();
            return;
        }

        if (badgeEl) {
            badgeEl.textContent = actData.act_number ? `№ ${actData.act_number}` : 'Предпросмотр';
        }

        renderActPrintDocument(actData);
    } catch (err) {
        console.error('Error loading act data:', err);
        container.innerHTML = `
            <div style="text-align: center; padding: 30px; color: #ef4444;">
                <i class="fa-solid fa-triangle-exclamation fa-2x" style="margin-bottom: 8px;"></i>
                <p style="font-weight: 700;">Ошибка формирования Акта</p>
                <p style="font-size: 0.85rem; color: #64748b;">${escapeHtml(err.message)}</p>
                <button type="button" class="btn-qcd-secondary" onclick="closePrintActModal()" style="margin-top: 12px;">Закрыть</button>
            </div>
        `;
        showQcdToast(err.message || 'Ошибка загрузки акта', 'error');
    }
}

/**
 * Закрытие модального окна печати Акта
 */
function closePrintActModal() {
    const modal = document.getElementById('modal-qcd-act-print');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('is-open');
    }
    document.body.classList.remove('act-printing');
}

/**
 * Печать акта с активацией стилей документа
 */
function printActDocument() {
    document.body.classList.add('act-printing');
    window.print();
}

/**
 * Вспомогательное извлечение значения дефекта по ключам с префиксом и без
 */
function getDefectValue(catalogKey, fgDict, defDict) {
    if (!fgDict) fgDict = {};
    if (!defDict) defDict = {};
    const shortKey = catalogKey.replace(/^(fg_|def_)/, '');
    
    if (catalogKey in fgDict) return fgDict[catalogKey] || 0;
    if (shortKey in fgDict) return fgDict[shortKey] || 0;
    if (catalogKey in defDict) return defDict[catalogKey] || 0;
    if (shortKey in defDict) return defDict[shortKey] || 0;
    if (shortKey === 'tech' && 'tech_defect' in defDict) return defDict['tech_defect'] || 0;
    return 0;
}

/**
 * Отрисовка бланка официального Акта разбраковки СКК для вывода на экран и печати А4
 * @param {Object} act - Данные отчета
 */
function renderActPrintDocument(act) {
    const container = document.getElementById('qcd-act-printable-doc');
    if (!container) return;

    // Распарсим shifts_breakdown, если пришло строкой
    let shiftsList = [];
    if (typeof act.shifts_breakdown === 'string') {
        try { shiftsList = JSON.parse(act.shifts_breakdown); } catch (e) { shiftsList = []; }
    } else if (Array.isArray(act.shifts_breakdown)) {
        shiftsList = act.shifts_breakdown;
    }

    const firstShift = (shiftsList && shiftsList.length > 0) ? shiftsList[0] : {};
    const batchNumber = act.batch_number || firstShift.batch_number || (currentBatchData ? currentBatchData.batch_number : '—');
    const shiftName = act.shift_name || firstShift.shift_name || (currentBatchData ? currentBatchData.shift_name : 'День');
    const masterName = act.master_name || firstShift.master_name || (currentBatchData ? currentBatchData.master_name : 'Мастер смены');
    const productName = act.product_name || firstShift.product_name || (currentBatchData ? currentBatchData.product_name : 'Шифер 8 волн');
    const lineName = act.line || firstShift.line || 'ЛФМ-1';
    const actDateDisplay = act.act_date_display || act.act_date || (currentBatchData ? currentBatchData.date : '');
    const currentUserName = document.getElementById('user-greeting-name')?.textContent;
    const inspectorName = act.inspector_name || (currentBatchData && currentBatchData.qcd_verified_by) || (currentUserName && currentUserName !== 'Сотрудник' ? currentUserName : 'Мусаилова З.');

    const totalFormed = Number(act.total_formed || (currentBatchData ? currentBatchData.lfm_sheets : 0));
    const firstGradeTotal = Number(act.first_grade_total || 0);
    const defectTotal = Number(act.defect_total || 0);

    let condition = act.condition !== undefined ? Number(act.condition) : undefined;
    if (condition === undefined && firstShift && firstShift.condition !== undefined) {
        condition = Number(firstShift.condition);
    }
    if (condition === undefined) {
        condition = Math.max(0, totalFormed - firstGradeTotal - defectTotal);
    }

    const totalCalculated = condition + firstGradeTotal + defectTotal;
    const baseTotal = totalCalculated > 0 ? totalCalculated : (totalFormed > 0 ? totalFormed : 1);

    const gpPct = ((condition / baseTotal) * 100).toFixed(1);
    const fgPct = ((firstGradeTotal / baseTotal) * 100).toFixed(1);
    const defectPct = act.defect_percentage !== undefined ? Number(act.defect_percentage).toFixed(2) : ((defectTotal / baseTotal) * 100).toFixed(2);

    const fgDict = act.first_grade_details || {};
    const defDict = act.defect_details || {};

    // Разделяем 14 дефектов на 1 сорт (11) и брак (3)
    const fgItems = FACTORY_DEFECTS_CATALOG.filter(d => d.group === 'fg');
    const brakItems = FACTORY_DEFECTS_CATALOG.filter(d => d.group === 'brak');

    // Формируем строки для таблицы дефектов (11 строк, левая колонка - 1 сорт, правая - Брак и итоги)
    let defectsTableRows = '';
    const maxRows = Math.max(fgItems.length, brakItems.length);

    for (let i = 0; i < maxRows; i++) {
        const fgDef = fgItems[i];
        let fgQty = 0;
        let fgTitle = '';
        let fgSub = '';

        if (fgDef) {
            fgQty = getDefectValue(fgDef.key, fgDict, defDict);
            fgTitle = fgDef.title;
            fgSub = fgDef.sub;
        }

        const brakDef = brakItems[i];
        let brakColHtml = '';

        if (brakDef) {
            const bQty = getDefectValue(brakDef.key, fgDict, defDict);
            brakColHtml = `
                <td style="text-align: center; font-weight: 700; width: 26px;">${i + 12}</td>
                <td>
                    <div style="font-weight: 600; color: #1e293b;">${escapeHtml(brakDef.title)}</div>
                    <div style="font-size: 0.65rem; color: #64748b;">${escapeHtml(brakDef.sub)}</div>
                </td>
                <td style="text-align: right; font-weight: 800; font-family: monospace; font-size: 0.85rem; color: ${bQty > 0 ? '#b91c1c' : '#334155'}; width: 55px;">
                    ${formatNum(bQty)}
                </td>
            `;
        } else if (i === 3) {
            // Итого брак
            brakColHtml = `
                <td colspan="2" style="background: #fef2f2; font-weight: 800; color: #991b1b; text-transform: uppercase;">
                    ИТОГО ТЕХНОЛОГИЧЕСКИЙ БРАК:
                </td>
                <td style="text-align: right; font-weight: 900; font-family: monospace; font-size: 0.9rem; background: #fee2e2; color: #dc2626;">
                    ${formatNum(defectTotal)}
                </td>
            `;
        } else if (i === 4) {
            // Итого 1 сорт
            brakColHtml = `
                <td colspan="2" style="background: #f0f9ff; font-weight: 800; color: #0369a1; text-transform: uppercase;">
                    ИТОГО 1-Й СОРТ (ОТКЛОНЕНИЯ):
                </td>
                <td style="text-align: right; font-weight: 900; font-family: monospace; font-size: 0.9rem; background: #e0f2fe; color: #0284c7;">
                    ${formatNum(firstGradeTotal)}
                </td>
            `;
        } else if (i === 5) {
            // Всего несоответствующей продукции
            brakColHtml = `
                <td colspan="2" style="background: #f8fafc; font-weight: 800; color: #0f172a; text-transform: uppercase;">
                    ВСЕГО ПЕРЕБРАНО (1 сорт + Брак):
                </td>
                <td style="text-align: right; font-weight: 900; font-family: monospace; font-size: 0.9rem; background: #f1f5f9; color: #0f172a;">
                    ${formatNum(firstGradeTotal + defectTotal)}
                </td>
            `;
        } else if (i === 6) {
            brakColHtml = `
                <td colspan="3" style="font-size: 0.65rem; color: #64748b; background: #fafafa; padding: 4px 6px;">
                    Стандарт соответствия: <strong>ГОСТ 18124-2012</strong> / СТ ТОО 39396-1910
                </td>
            `;
        } else {
            brakColHtml = `<td colspan="3" style="background: #ffffff; border-color: #cbd5e1;"></td>`;
        }

        defectsTableRows += `
            <tr>
                <td style="text-align: center; font-weight: 700; width: 26px;">${i + 1}</td>
                <td>
                    <div style="font-weight: 600; color: #1e293b;">${escapeHtml(fgTitle)}</div>
                    <div style="font-size: 0.65rem; color: #64748b;">${escapeHtml(fgSub)}</div>
                </td>
                <td style="text-align: right; font-weight: 800; font-family: monospace; font-size: 0.85rem; color: ${fgQty > 0 ? '#0284c7' : '#334155'}; width: 55px;">
                    ${formatNum(fgQty)}
                </td>
                ${brakColHtml}
            </tr>
        `;
    }

    const nowFormatted = new Date().toLocaleString('ru-RU');

    container.innerHTML = `
        <!-- Шапка документа с брендом и грифом утверждения -->
        <div class="act-header-brand-line">
            <div>
                <div class="act-brand-logo-text">TECTUM <span class="act-brand-logo-blue">ENGINEERING</span></div>
                <div class="act-brand-sub">СЛУЖБА КОНТРОЛЯ КАЧЕСТВА (СКК) • ЗАВОД ФИБРОЦЕМЕНТНЫХ ИЗДЕЛИЙ</div>
            </div>
            <div class="act-stamp-approve">
                <div style="font-weight: 800; text-transform: uppercase;">УТВЕРЖДАЮ</div>
                <div style="font-weight: 700; color: #334155;">Начальник цеха ХЦИ</div>
                <div style="margin-top: 14px; border-bottom: 1px solid #0f172a; width: 140px; margin-left: auto;"></div>
                <div style="font-size: 0.68rem; color: #64748b; margin-top: 2px;">Булеханов К.</div>
                <div style="font-size: 0.68rem; margin-top: 2px;">«____» ____________ 202_ г.</div>
            </div>
        </div>

        <!-- Заголовок и номер акта -->
        <div class="act-title-block">
            <div class="act-main-heading">АКТ РАЗБРАКОВКИ И ПЕРЕБОРКИ ПРОДУКЦИИ</div>
            <div class="act-number-subtitle">№ ${escapeHtml(act.act_number || 'ПРОЕКТ')} от ${escapeHtml(actDateDisplay)}</div>
        </div>

        <!-- Таблица метаданных партии -->
        <table class="act-table">
            <tr>
                <td class="act-meta-lbl">Дата выпуска смены:</td>
                <td class="act-meta-val">${escapeHtml(actDateDisplay || '—')}</td>
                <td class="act-meta-lbl">Смена / Линия:</td>
                <td class="act-meta-val">Смена ${escapeHtml(shiftName)} • ${escapeHtml(lineName)}</td>
            </tr>
            <tr>
                <td class="act-meta-lbl">Мастер смены ХЦИ:</td>
                <td class="act-meta-val">${escapeHtml(masterName)}</td>
                <td class="act-meta-lbl">№ Партии:</td>
                <td class="act-meta-val" style="font-weight: 800; font-family: monospace; font-size: 0.9rem;">№ ${escapeHtml(batchNumber)}</td>
            </tr>
            <tr>
                <td class="act-meta-lbl">Номенклатура:</td>
                <td class="act-meta-val">${escapeHtml(productName)}</td>
                <td class="act-meta-lbl">Инспектор СКК:</td>
                <td class="act-meta-val">${escapeHtml(inspectorName)}</td>
            </tr>
        </table>

        <!-- Сводный баланс партии (4 ключевые метрики) -->
        <div class="act-summary-grid">
            <div class="act-summary-cell">
                <div class="act-summary-cell-title">Формовка (ЛФМ)</div>
                <div class="act-summary-cell-val">${formatNum(totalFormed)} шт.</div>
                <div class="act-summary-cell-pct">100% базы смены</div>
            </div>
            <div class="act-summary-cell" style="background: #f0fdf4;">
                <div class="act-summary-cell-title" style="color: #15803d;">Годная продукция (ГП)</div>
                <div class="act-summary-cell-val" style="color: #15803d;">${formatNum(condition)} шт.</div>
                <div class="act-summary-cell-pct">${gpPct}% от выпуска</div>
            </div>
            <div class="act-summary-cell" style="background: #f0f9ff;">
                <div class="act-summary-cell-title" style="color: #0369a1;">1 сорт (отклонения)</div>
                <div class="act-summary-cell-val" style="color: #0284c7;">${formatNum(firstGradeTotal)} шт.</div>
                <div class="act-summary-cell-pct">${fgPct}% от выпуска</div>
            </div>
            <div class="act-summary-cell" style="background: #fef2f2;">
                <div class="act-summary-cell-title" style="color: #b91c1c;">Окончательный брак</div>
                <div class="act-summary-cell-val" style="color: #dc2626;">${formatNum(defectTotal)} шт.</div>
                <div class="act-summary-cell-pct" style="color: #b91c1c; font-weight: 700;">${defectPct}% брака</div>
            </div>
        </div>

        <!-- Таблица классификации 14 дефектов -->
        <table class="act-table">
            <thead>
                <tr>
                    <th colspan="3" style="width: 50%; background: #e0f2fe; color: #0369a1;">
                        1-Й СОРТ (Отклонения без потери прочности)
                    </th>
                    <th colspan="3" style="width: 50%; background: #fee2e2; color: #991b1b;">
                        ТЕХНОЛОГИЧЕСКИЙ БРАК (Окончательное списание)
                    </th>
                </tr>
                <tr>
                    <th style="width: 26px;">№</th>
                    <th>Вид отклонения / Дефект</th>
                    <th style="width: 55px;">Шт.</th>
                    <th style="width: 26px;">№</th>
                    <th>Вид брака</th>
                    <th style="width: 55px;">Шт.</th>
                </tr>
            </thead>
            <tbody>
                ${defectsTableRows}
            </tbody>
        </table>

        <!-- Причины и замечания инспектора СКК -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
            <div class="act-notes-box">
                <div class="act-notes-title"><i class="fa-solid fa-bullseye" style="color: #dc2626;"></i> Корневая причина дефектов:</div>
                <div style="color: #0f172a; font-weight: 600;">${escapeHtml(act.root_cause || (currentBatchData ? currentBatchData.qcd_root_cause : '') || 'Не зафиксирована')}</div>
            </div>
            <div class="act-notes-box">
                <div class="act-notes-title"><i class="fa-solid fa-comment-dots" style="color: #2563eb;"></i> Особые отметки и замечания СКК:</div>
                <div style="color: #334155;">${escapeHtml(act.notes || (currentBatchData ? currentBatchData.qcd_notes : '') || 'Замечания отсутствуют. Продукция соответствует стандартам предприятия.')}</div>
            </div>
        </div>

        <!-- Подписи ответственных лиц -->
        <div class="act-signatures-row">
            <div class="act-signature-item">
                <div class="act-signature-role">Инспектор СКК:</div>
                <div class="act-signature-line"></div>
                <div class="act-signature-name">${escapeHtml(inspectorName)}</div>
            </div>
            <div class="act-signature-item">
                <div class="act-signature-role">Мастер смены цеха ХЦИ:</div>
                <div class="act-signature-line"></div>
                <div class="act-signature-name">${escapeHtml(masterName)}</div>
            </div>
            <div class="act-signature-item">
                <div class="act-signature-role">Начальник цеха ХЦИ:</div>
                <div class="act-signature-line"></div>
                <div class="act-signature-name">Булеханов К.</div>
            </div>
        </div>

        <!-- Подвал официального документа -->
        <div class="act-doc-footer">
            <span>Tectum Portal • Служба Контроля Качества • Официальный электронный документ</span>
            <span>Сформирован: ${nowFormatted}</span>
        </div>
    `;
}

/**
 * Открытие модального окна реестра Актов СКК
 */
function openActRegistryModal() {
    const modal = document.getElementById('modal-qcd-act-registry');
    if (modal) {
        modal.style.display = 'flex';
        loadActRegistry();
    }
}

/**
 * Закрытие модального окна реестра Актов СКК
 */
function closeActRegistryModal() {
    const modal = document.getElementById('modal-qcd-act-registry');
    if (modal) modal.style.display = 'none';
}

/**
 * Загрузка реестра актов с сервера
 */
async function loadActRegistry() {
    const tbody = document.getElementById('tbody-qcd-acts-registry');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" style="text-align: center; padding: 25px; color: #64748b;">
                    <i class="fa-solid fa-spinner fa-spin fa-lg" style="color: #6366f1; margin-right: 8px;"></i>
                    Загрузка официальных актов СКК...
                </td>
            </tr>
        `;
    }

    try {
        const res = await fetch('/api/qcd/reports?limit=100');
        if (!res.ok) throw new Error('Ошибка получения реестра актов');
        const data = await res.json();
        allActsRegistryData = data || [];
        renderActRegistryTable(allActsRegistryData);
    } catch (err) {
        console.error('Error loading acts registry:', err);
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align: center; padding: 25px; color: #ef4444;">
                        <i class="fa-solid fa-triangle-exclamation" style="margin-right: 6px;"></i>
                        Не удалось загрузить реестр: ${escapeHtml(err.message)}
                    </td>
                </tr>
            `;
        }
        showQcdToast('Ошибка загрузки реестра актов', 'error');
    }
}

/**
 * Фильтрация реестра актов по поисковой строке
 * @param {string} query
 */
function filterActRegistry(query) {
    if (!query || !query.trim()) {
        renderActRegistryTable(allActsRegistryData);
        return;
    }
    const q = query.trim().toLowerCase();
    const filtered = allActsRegistryData.filter(act => {
        let shiftsStr = '';
        if (typeof act.shifts_breakdown === 'string') shiftsStr = act.shifts_breakdown.toLowerCase();
        return (
            (act.act_number && act.act_number.toLowerCase().includes(q)) ||
            (act.act_date && act.act_date.toLowerCase().includes(q)) ||
            (act.inspector_name && act.inspector_name.toLowerCase().includes(q)) ||
            (act.product_name && act.product_name.toLowerCase().includes(q)) ||
            (act.notes && act.notes.toLowerCase().includes(q)) ||
            shiftsStr.includes(q)
        );
    });
    renderActRegistryTable(filtered);
}

/**
 * Отрисовка таблицы реестра актов СКК
 * @param {Array} acts
 */
function renderActRegistryTable(acts) {
    const tbody = document.getElementById('tbody-qcd-acts-registry');
    if (!tbody) return;

    if (!acts || acts.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" style="text-align: center; padding: 30px; color: #94a3b8;">
                    <i class="fa-regular fa-folder-open fa-2x" style="margin-bottom: 8px; display: block;"></i>
                    Акты переборки СКК не найдены
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    acts.forEach(act => {
        let breakdown = [];
        if (typeof act.shifts_breakdown === 'string') {
            try { breakdown = JSON.parse(act.shifts_breakdown); } catch (e) { breakdown = []; }
        } else if (Array.isArray(act.shifts_breakdown)) {
            breakdown = act.shifts_breakdown;
        }

        const first = (breakdown && breakdown.length > 0) ? breakdown[0] : {};
        const batchNum = first.batch_number || '—';
        const shiftName = first.shift_name || '—';
        const masterName = first.master_name || '—';
        const formed = act.total_formed || first.lfm_sheets || 0;
        const fg = act.first_grade_total || 0;
        const def = act.defect_total || 0;
        const cond = first.condition !== undefined ? first.condition : Math.max(0, formed - fg - def);
        const actDateStr = act.act_date ? act.act_date.split('-').reverse().join('.') : '';

        html += `
            <tr>
                <td>
                    <button type="button" class="btn-link" onclick="openPrintActModal(${act.id})" 
                            style="background: none; border: none; padding: 0; color: #2563eb; font-weight: 800; font-family: monospace; cursor: pointer; text-decoration: underline;" 
                            title="Открыть для печати">
                        ${escapeHtml(act.act_number)}
                    </button>
                </td>
                <td style="white-space: nowrap; font-size: 0.8rem; color: #475569;">${escapeHtml(actDateStr)}</td>
                <td>
                    <span class="picker-badge-party mono" style="font-size: 0.76rem;">№ ${escapeHtml(batchNum)}</span>
                    <span style="font-size: 0.76rem; color: #64748b; margin-left: 4px;">(${escapeHtml(shiftName)})</span>
                </td>
                <td style="font-weight: 600; font-size: 0.82rem;">${escapeHtml(masterName)}</td>
                <td style="text-align: right; font-weight: 700; font-family: monospace;">${formatNum(formed)}</td>
                <td style="text-align: right; font-weight: 800; font-family: monospace; color: #16a34a;">${formatNum(cond)}</td>
                <td style="text-align: right; font-weight: 800; font-family: monospace; color: #0284c7;">${formatNum(fg)}</td>
                <td style="text-align: right; font-weight: 800; font-family: monospace; color: #dc2626;">
                    ${formatNum(def)} <span style="font-size: 0.72rem; color: #991b1b; font-weight: 600;">(${(act.defect_percentage || 0).toFixed(1)}%)</span>
                </td>
                <td style="font-size: 0.8rem; color: #334155;">${escapeHtml(act.inspector_name || '—')}</td>
                <td style="text-align: center;">
                    <button type="button" class="btn-qcd-secondary" onclick="openPrintActModal(${act.id})" 
                            style="height: 28px; padding: 0 8px; font-size: 0.75rem; border-color: #cbd5e1;" 
                            title="Печать акта А4">
                        <i class="fa-solid fa-print" style="color: #2563eb;"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}


// =========================================================================
// QCD QUALITY & BUFFER ANALYTICS DASHBOARD (Вариант 3: Полная аналитика)
// =========================================================================

let currentAnalyticsPeriod = '30d';
let customDateFrom = null;
let customDateTo = null;
let currentAnalyticsSlice = 'all'; // 'all', 'first_grade', 'defect'
let currentAnalyticsProduct = '';
let cachedAnalyticsData = null;
let paretoChartInstance = null;

// Переключение между вкладками кабинета СКК
function switchQcdView(viewName) {
    const btnSorting = document.getElementById('tab-btn-sorting');
    const btnAnalytics = document.getElementById('tab-btn-analytics');
    const viewSorting = document.getElementById('view-qcd-sorting');
    const viewAnalytics = document.getElementById('view-qcd-analytics');

    if (viewName === 'analytics') {
        if (btnSorting) btnSorting.classList.remove('active');
        if (btnAnalytics) btnAnalytics.classList.add('active');
        if (viewSorting) viewSorting.style.display = 'none';
        if (viewAnalytics) viewAnalytics.style.display = 'flex';

        if (!cachedAnalyticsData) {
            loadQcdAnalyticsData();
        }
    } else {
        if (btnSorting) btnSorting.classList.add('active');
        if (btnAnalytics) btnAnalytics.classList.remove('active');
        if (viewSorting) viewSorting.style.display = 'flex';
        if (viewAnalytics) viewAnalytics.style.display = 'none';
    }
}

// Управление поповером произвольного диапазона дат (как в Планнере)
function toggleQcdDateRangePopover(e) {
    if (e) e.stopPropagation();
    const pop = document.getElementById("qcd-date-range-popover");
    if (!pop) return;
    const isShown = pop.style.display === "block";
    pop.style.display = isShown ? "none" : "block";
    if (!isShown) {
        const df = document.getElementById("qcd-custom-date-from");
        const dt = document.getElementById("qcd-custom-date-to");
        if (df && customDateFrom) df.value = customDateFrom;
        if (dt && customDateTo) dt.value = customDateTo;
    }
}

function closeQcdDateRangePopover() {
    const pop = document.getElementById("qcd-date-range-popover");
    if (pop) pop.style.display = "none";
}

function applyQcdQuickDatePreset(preset) {
    const today = new Date();
    let start = new Date(today);
    let end = new Date(today);

    if (preset === '7d') {
        start.setDate(today.getDate() - 7);
    } else if (preset === '30d') {
        start.setDate(today.getDate() - 30);
    } else if (preset === 'this_month') {
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        end = today;
    } else if (preset === 'quarter') {
        start.setDate(today.getDate() - 90);
    }

    const formatYmd = d => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const df = document.getElementById("qcd-custom-date-from");
    const dt = document.getElementById("qcd-custom-date-to");
    if (df) df.value = formatYmd(start);
    if (dt) dt.value = formatYmd(end);
}

function applyQcdCustomDateRange() {
    const df = document.getElementById("qcd-custom-date-from");
    const dt = document.getElementById("qcd-custom-date-to");
    const valFrom = df ? df.value.trim() : "";
    const valTo = dt ? dt.value.trim() : "";

    if (!valFrom && !valTo) {
        resetQcdCustomDateRange();
        return;
    }

    customDateFrom = valFrom || null;
    customDateTo = valTo || null;

    updateQcdDateRangeBtnUI();
    closeQcdDateRangePopover();
    loadQcdAnalyticsData();
}

function resetQcdCustomDateRange() {
    customDateFrom = null;
    customDateTo = null;
    currentAnalyticsPeriod = '30d';
    const df = document.getElementById("qcd-custom-date-from");
    const dt = document.getElementById("qcd-custom-date-to");
    if (df) df.value = "";
    if (dt) dt.value = "";
    updateQcdDateRangeBtnUI();
    closeQcdDateRangePopover();
    loadQcdAnalyticsData();
}

function updateQcdDateRangeBtnUI() {
    const btn = document.getElementById("btn-qcd-date-range");
    const lbl = document.getElementById("qcd-date-range-label");
    const ind = document.getElementById("qcd-date-range-indicator");
    if (!btn || !lbl) return;

    if (customDateFrom || customDateTo) {
        btn.classList.add("active");
        if (ind) ind.style.display = "inline-block";
        const formatDm = s => {
            if (!s) return "";
            const parts = s.split('-');
            return parts.length === 3 ? `${parts[2]}.${parts[1]}` : s;
        };
        if (customDateFrom && customDateTo) {
            lbl.textContent = `📅 ${formatDm(customDateFrom)} — ${formatDm(customDateTo)}`;
        } else if (customDateFrom) {
            lbl.textContent = `📅 от ${formatDm(customDateFrom)}`;
        } else {
            lbl.textContent = `📅 до ${formatDm(customDateTo)}`;
        }
    } else {
        btn.classList.remove("active");
        if (ind) ind.style.display = "none";
        lbl.textContent = "Диапазон дат";
    }
}

// Переключение периода фильтра (обратная совместимость)
function setQcdAnalyticsPeriod(period) {
    currentAnalyticsPeriod = period;
    customDateFrom = null;
    customDateTo = null;
    updateQcdDateRangeBtnUI();
    loadQcdAnalyticsData();
}

// Фильтр по номенклатуре
function onAnalyticsProductChange(val) {
    currentAnalyticsProduct = val || '';
    loadQcdAnalyticsData();
}

// Переключение среза Парето (Все / 1-й сорт / Брак)
function setParetoSlice(slice) {
    currentAnalyticsSlice = slice;
    const slices = {
        'all': 'btn-slice-all',
        'first_grade': 'btn-slice-fg',
        'defect': 'btn-slice-def'
    };

    Object.entries(slices).forEach(([k, btnId]) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            if (k === slice) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    });

    if (cachedAnalyticsData) {
        renderParetoChart(cachedAnalyticsData, currentAnalyticsSlice);
    }
}

// Загрузка аналитических данных с бэкенда
async function loadQcdAnalyticsData() {
    const refreshBtn = document.getElementById('btn-refresh-analytics');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Загрузка...</span>';
    }

    try {
        const params = new URLSearchParams();
        if (customDateFrom && customDateTo) {
            params.append('period', 'custom');
            params.append('date_from', customDateFrom);
            params.append('date_to', customDateTo);
        } else if (customDateFrom) {
            params.append('period', 'custom');
            params.append('date_from', customDateFrom);
            const todayStr = new Date().toISOString().split('T')[0];
            params.append('date_to', todayStr);
        } else {
            params.append('period', currentAnalyticsPeriod || '30d');
        }
        if (currentAnalyticsProduct) {
            params.append('product_name', currentAnalyticsProduct);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        const res = await fetch(`/api/qcd/analytics/summary?${params.toString()}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
            throw new Error(`Ошибка сервера: HTTP ${res.status}`);
        }

        const data = await res.json();
        cachedAnalyticsData = data;

        // Обновляем бейдж периода и время
        const rangeBadge = document.getElementById('analytics-date-range-badge');
        if (rangeBadge) rangeBadge.textContent = `${data.date_from} — ${data.date_to}`;

        const syncTime = document.getElementById('analytics-sync-time');
        if (syncTime) {
            const now = new Date();
            syncTime.textContent = `${now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
        }

        // Рендеринг всех панелей
        renderBufferBalanceCard(data.buffer_balance);
        renderKpiCards(data.buffer_balance, data.pareto_first_grade, data.pareto_defect);
        renderParetoChart(data, currentAnalyticsSlice);
        renderTopCausesPanels(data.pareto_first_grade, data.pareto_defect);
        renderMasterShiftMatrix(data.by_master_shift);

    } catch (err) {
        console.error('Ошибка загрузки аналитики качества:', err);
        showQcdToast(`Не удалось загрузить аналитику: ${err.message}`, 'error');
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> <span>Обновить данные</span>';
        }
    }
}

// Отрисовка карточки сквозного баланса и буфера камеры
function renderBufferBalanceCard(buf) {
    if (!buf) return;

    setFieldText('buf-val-formed', `${formatNum(buf.total_formed)} шт`);
    setFieldText('buf-val-sorted', `${formatNum(buf.total_sorted)} шт`);

    const sortedPct = buf.total_formed > 0 ? ((buf.total_sorted / buf.total_formed) * 100).toFixed(1) : '0.0';
    setFieldText('buf-badge-sorted-pct', `${sortedPct}% потока`);

    // Буфер камеры
    const rem = buf.buffer_remainder || 0;
    const remStr = rem > 0 ? `+${formatNum(rem)}` : `${formatNum(rem)}`;
    setFieldText('buf-val-remainder', `${remStr} шт`);

    const remPct = buf.total_formed > 0 ? ((Math.abs(rem) / buf.total_formed) * 100).toFixed(1) : '0.0';
    setFieldText('buf-val-remainder-pct', `${remPct}%`);

    const statusBadge = document.getElementById('buf-badge-status');
    if (statusBadge) {
        if (rem === 0) {
            statusBadge.textContent = 'Баланс сошелся';
            statusBadge.style.background = '#dcfce7';
            statusBadge.style.color = '#15803d';
        } else if (rem > 0) {
            statusBadge.textContent = 'На созревании';
            statusBadge.style.background = '#fde68a';
            statusBadge.style.color = '#78350f';
        } else {
            statusBadge.textContent = 'Невязка: превышение';
            statusBadge.style.background = '#fee2e2';
            statusBadge.style.color = '#b91c1c';
        }
    }

    // Мини-цифры сортности
    setFieldText('buf-val-total-sorted-mini', `${formatNum(buf.total_sorted)} шт`);
    setFieldText('buf-val-cond', `${formatNum(buf.condition_count)} (${buf.condition_pct.toFixed(1)}%)`);
    setFieldText('buf-val-fg', `${formatNum(buf.first_grade_count)} (${buf.first_grade_pct.toFixed(1)}%)`);
    setFieldText('buf-val-def', `${formatNum(buf.defect_count)} (${buf.defect_pct.toFixed(2)}%)`);

    // Сегментированный прогресс-бар
    const barCond = document.getElementById('prog-bar-cond');
    const barFg = document.getElementById('prog-bar-fg');
    const barDef = document.getElementById('prog-bar-def');

    if (barCond) barCond.style.width = `${buf.condition_pct}%`;
    if (barFg) barFg.style.width = `${buf.first_grade_pct}%`;
    if (barDef) barDef.style.width = `${buf.defect_pct}%`;

    // Подписи легенды
    setFieldText('leg-cond-str', `${formatNum(buf.condition_count)} шт (${buf.condition_pct.toFixed(1)}%)`);
    setFieldText('leg-fg-str', `${formatNum(buf.first_grade_count)} шт (${buf.first_grade_pct.toFixed(1)}%)`);
    setFieldText('leg-def-str', `${formatNum(buf.defect_count)} шт (${buf.defect_pct.toFixed(2)}%)`);
}

// Отрисовка 4 KPI карточек
function renderKpiCards(buf, paretoFg, paretoDef) {
    if (!buf) return;

    setFieldText('kpi-sorted-count', formatNum(buf.total_sorted));

    // Суточный темп (в среднем за период)
    let days = 30;
    if (customDateFrom && customDateTo) {
        const d1 = new Date(customDateFrom);
        const d2 = new Date(customDateTo);
        days = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1);
    } else {
        days = currentAnalyticsPeriod === '7d' ? 7 : (currentAnalyticsPeriod === 'quarter' ? 90 : 30);
    }
    const dailyRate = Math.round(buf.total_sorted / days);
    setFieldText('kpi-daily-rate', `${formatNum(dailyRate)} шт/день`);

    // Кондиция ГП
    setFieldText('kpi-cond-pct', `${buf.condition_pct.toFixed(1)}%`);
    setFieldText('kpi-cond-count', `${formatNum(buf.condition_count)} шт`);

    // 1-й сорт
    setFieldText('kpi-fg-count', formatNum(buf.first_grade_count));
    setFieldText('kpi-fg-pct', `(${buf.first_grade_pct.toFixed(1)}%)`);
    const topFg = (paretoFg && paretoFg.length > 0 && paretoFg[0].count > 0) 
        ? `${paretoFg[0].short_name} (${formatNum(paretoFg[0].count)} шт)` 
        : '— (нет дефектов)';
    setFieldText('kpi-fg-top', topFg);

    // Брак
    setFieldText('kpi-def-count', formatNum(buf.defect_count));
    setFieldText('kpi-def-pct', `(${buf.defect_pct.toFixed(2)}%)`);
    const topDef = (paretoDef && paretoDef.length > 0 && paretoDef[0].count > 0)
        ? `${paretoDef[0].short_name} (${formatNum(paretoDef[0].count)} шт)`
        : '— (нет брака)';
    setFieldText('kpi-def-top', topDef);
}

// Отрисовка графика Парето с кумулятивной кривой
function renderParetoChart(data, slice) {
    const canvas = document.getElementById('qcd-pareto-chart-canvas');
    if (!canvas || typeof Chart === 'undefined') return;

    let items = [];
    if (slice === 'first_grade') {
        items = data.pareto_first_grade || [];
    } else if (slice === 'defect') {
        items = data.pareto_defect || [];
    } else {
        items = data.pareto_all || [];
    }

    // Фильтруем дефекты с числом > 0 для наглядности диаграммы
    const activeItems = items.filter(it => it.count > 0);
    const displayItems = activeItems.length > 0 ? activeItems : items.slice(0, 8);

    const labels = displayItems.map(it => it.short_name || it.name);
    const counts = displayItems.map(it => it.count);
    const cumPcts = displayItems.map(it => it.cumulative_pct);

    // Находим сколько дефектов формируют 80% (Зона А)
    const vitalFewCount = displayItems.filter(it => it.cumulative_pct <= 80).length || 1;
    const hintEl = document.getElementById('pareto-stats-hint');
    if (hintEl) {
        hintEl.innerHTML = `<span style="color: #dc2626;">Зона А:</span> первые <strong>${vitalFewCount} дефекта(ов)</strong> формируют основу потерь`;
    }

    if (paretoChartInstance) {
        paretoChartInstance.destroy();
    }

    const ctx = canvas.getContext('2d');
    paretoChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Число дефектов (шт)',
                    data: counts,
                    backgroundColor: displayItems.map(it => it.category === 'defect' ? 'rgba(220, 38, 38, 0.85)' : 'rgba(2, 132, 199, 0.85)'),
                    borderColor: displayItems.map(it => it.category === 'defect' ? '#b91c1c' : '#0369a1'),
                    borderWidth: 1,
                    borderRadius: 4,
                    yAxisID: 'yCounts',
                    order: 2
                },
                {
                    label: 'Накопленный % (Парето)',
                    data: cumPcts,
                    type: 'line',
                    borderColor: '#b91c1c',
                    backgroundColor: 'transparent',
                    borderWidth: 2.5,
                    pointBackgroundColor: '#ffffff',
                    pointBorderColor: '#b91c1c',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    tension: 0.25,
                    yAxisID: 'yPct',
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        boxWidth: 12,
                        font: { size: 11, family: "'Inter', sans-serif", weight: '600' },
                        color: '#334155'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (context.dataset.type === 'line') {
                                return `Накопленный процент: ${context.parsed.y}%`;
                            }
                            return `Количество: ${formatNum(context.parsed.y)} шт`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        font: { size: 10, family: "'Inter', sans-serif" },
                        color: '#475569',
                        maxRotation: 45,
                        minRotation: 20
                    }
                },
                yCounts: {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true,
                    grid: { color: '#f1f5f9' },
                    title: {
                        display: true,
                        text: 'Количество (шт)',
                        color: '#64748b',
                        font: { size: 10, weight: '700' }
                    },
                    ticks: {
                        color: '#64748b',
                        font: { size: 10, family: "'JetBrains Mono', monospace" }
                    }
                },
                yPct: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    max: 100,
                    grid: { display: false },
                    title: {
                        display: true,
                        text: 'Накопленный %',
                        color: '#b91c1c',
                        font: { size: 10, weight: '700' }
                    },
                    ticks: {
                        callback: v => `${v}%`,
                        color: '#b91c1c',
                        font: { size: 10, family: "'JetBrains Mono', monospace" }
                    }
                }
            }
        }
    });
}

// Отрисовка боковых панелей детализации дефектов
function renderTopCausesPanels(paretoFg, paretoDef) {
    const listFg = document.getElementById('panel-fg-list');
    const listDef = document.getElementById('panel-def-list');

    // 1-й сорт
    if (listFg) {
        const totalFg = (paretoFg || []).reduce((acc, it) => acc + (it.count || 0), 0);
        setFieldText('panel-fg-total', `${formatNum(totalFg)} шт`);

        const fgNonZero = (paretoFg || []).filter(it => it.count > 0);
        if (fgNonZero.length === 0) {
            listFg.innerHTML = `<div style="text-align: center; color: #94a3b8; font-size: 0.74rem; padding: 12px;">Дефектов 1-го сорта не выявлено</div>`;
        } else {
            let html = '';
            fgNonZero.forEach(it => {
                const pct = it.percentage || 0;
                html += `
                    <div class="defect-stat-row">
                        <div class="defect-stat-header">
                            <span style="font-weight: 700; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(it.name)}</span>
                            <span class="mono" style="font-weight: 800; color: #b45309;">${formatNum(it.count)} шт <span style="font-size: 0.7rem; color: #78350f;">(${pct.toFixed(1)}%)</span></span>
                        </div>
                        <div class="mini-progress">
                            <div class="mini-progress-fill" style="width: ${pct}%; background: #f59e0b;"></div>
                        </div>
                    </div>
                `;
            });
            listFg.innerHTML = html;
        }
    }

    // Брак
    if (listDef) {
        const totalDef = (paretoDef || []).reduce((acc, it) => acc + (it.count || 0), 0);
        setFieldText('panel-def-total', `${formatNum(totalDef)} шт`);

        const defNonZero = (paretoDef || []).filter(it => it.count > 0);
        if (defNonZero.length === 0) {
            listDef.innerHTML = `<div style="text-align: center; color: #94a3b8; font-size: 0.74rem; padding: 12px;">Брака за период не зафиксировано</div>`;
        } else {
            let html = '';
            defNonZero.forEach(it => {
                const pct = it.percentage || 0;
                html += `
                    <div class="defect-stat-row">
                        <div class="defect-stat-header">
                            <span style="font-weight: 700; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(it.name)}</span>
                            <span class="mono" style="font-weight: 800; color: #b91c1c;">${formatNum(it.count)} шт <span style="font-size: 0.7rem; color: #991b1b;">(${pct.toFixed(1)}%)</span></span>
                        </div>
                        <div class="mini-progress">
                            <div class="mini-progress-fill" style="width: ${pct}%; background: #dc2626;"></div>
                        </div>
                    </div>
                `;
            });
            listDef.innerHTML = html;
        }
    }
}

// Отрисовка Матрицы качества по мастерам и сменам ХЦИ
function renderMasterShiftMatrix(rows) {
    const tbody = document.getElementById('matrix-table-body');
    const countEl = document.getElementById('matrix-rows-count');
    if (!tbody) return;

    if (!rows || rows.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; color: #94a3b8; padding: 24px;">
                    Нет данных по партиям за выбранный период
                </td>
            </tr>
        `;
        if (countEl) countEl.textContent = '0 партий';
        return;
    }

    if (countEl) countEl.textContent = `${rows.length} партий`;

    let html = '';
    rows.forEach(r => {
        let statusBadge = '<span class="status-pill-ok"><i class="fa-solid fa-check"></i> Сошлось</span>';
        if (r.buffer_remainder > 0) {
            statusBadge = `<span class="status-pill-buffer"><i class="fa-solid fa-layer-group"></i> Буфер: +${formatNum(r.buffer_remainder)}</span>`;
        } else if (r.buffer_remainder < 0) {
            statusBadge = `<span class="status-pill-excess"><i class="fa-solid fa-triangle-exclamation"></i> Списано > ${formatNum(Math.abs(r.buffer_remainder))}</span>`;
        }

        const condColor = r.condition_pct >= 93.5 ? '#15803d' : '#b45309';
        const defColor = r.defect_pct > 1.0 ? '#b91c1c' : '#334155';

        const remStr = r.buffer_remainder > 0 ? `+${formatNum(r.buffer_remainder)}` : `${formatNum(r.buffer_remainder)}`;

        html += `
            <tr>
                <td>
                    <div style="font-weight: 700; color: #0f172a;">${escapeHtml(r.shift_name)} (${escapeHtml(r.shift_date)})</div>
                    <div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(r.master_name)}</div>
                </td>
                <td>
                    <span class="picker-badge-party mono" style="font-size: 0.76rem;">№ ${escapeHtml(r.batch_number)}</span>
                </td>
                <td style="text-align: right; font-family: monospace; font-weight: 700;">${formatNum(r.formed_count)}</td>
                <td style="text-align: right; font-family: monospace; font-weight: 800; color: #1e293b;">${formatNum(r.sorted_count)}</td>
                <td style="text-align: right; font-family: monospace; font-weight: 700; color: ${r.buffer_remainder > 0 ? '#b45309' : '#64748b'};">${remStr}</td>
                <td style="text-align: right; font-family: monospace; font-weight: 800; color: ${condColor};">
                    ${r.condition_pct.toFixed(1)}%
                </td>
                <td style="font-family: monospace;">
                    <span style="font-weight: 700; color: #0f172a;">${formatNum(r.first_grade_count)} шт</span>
                    <span style="color: #b45309; font-weight: 700;">(${r.first_grade_pct.toFixed(1)}%)</span>
                    <span style="font-size: 0.7rem; color: #64748b; margin-left: 2px;">${escapeHtml(r.top_first_grade_cause)}</span>
                </td>
                <td style="font-family: monospace;">
                    <span style="font-weight: 700; color: ${defColor};">${formatNum(r.defect_count)} шт</span>
                    <span style="color: ${defColor}; font-weight: 700;">(${r.defect_pct.toFixed(2)}%)</span>
                    <span style="font-size: 0.7rem; color: #64748b; margin-left: 2px;">${escapeHtml(r.top_defect_cause)}</span>
                </td>
                <td style="text-align: center;">
                    ${statusBadge}
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

// Закрытие поповера выбора диапазона дат при клике вне его
document.addEventListener('click', (e) => {
    const pop = document.getElementById("qcd-date-range-popover");
    const btn = document.getElementById("btn-qcd-date-range");
    if (pop && pop.style.display === "block") {
        if (!pop.contains(e.target) && (!btn || !btn.contains(e.target))) {
            closeQcdDateRangePopover();
        }
    }
});
