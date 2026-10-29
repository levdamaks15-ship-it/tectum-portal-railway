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
            statusBadge.className = 'status-chip status-verified';
            statusBadge.innerHTML = `<i class="fa-solid fa-check-double"></i> Проверено СКК (${data.qcd_verified_by || 'Инспектор'})`;
        } else {
            statusBadge.className = 'status-chip status-pending';
            statusBadge.innerHTML = `<i class="fa-solid fa-clock"></i> Ожидает проверки СКК`;
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
    selectRootCause(data.qcd_root_cause || '');
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
    selectRootCause('');
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
