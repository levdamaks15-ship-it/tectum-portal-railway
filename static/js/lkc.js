// =======================================================
// TECTUM ENGINEERING — КАБИНЕТ МАСТЕРА ЛКЦ (JS ENGINE)
// =======================================================

let lkcCatalog = [];
let currentReportId = null;
let currentSelectedDate = null;
let currentWeekOffset = 0; // 0 = current week

// --- PREVENT WHEEL SCROLL & AUTO-CLEAR 0 ON FOCUS (FIX 0500 BUG) ---
document.addEventListener('wheel', function(e) {
    if (document.activeElement && document.activeElement.type === 'number') {
        document.activeElement.blur();
    }
}, { passive: true });

// Auto-clear or select '0' on focus/click to prevent '0500' when typing
document.addEventListener('focusin', function(e) {
    const el = e.target;
    if (el && (el.type === 'number' || el.inputMode === 'numeric')) {
        if (el.value === '0') {
            el.value = '';
        } else if (el.value) {
            setTimeout(() => {
                if (typeof el.select === 'function') el.select();
            }, 15);
        }
    }
});

document.addEventListener('click', function(e) {
    const el = e.target;
    if (el && (el.type === 'number' || el.inputMode === 'numeric')) {
        if (el.value === '0') {
            el.value = '';
        }
    }
});

document.addEventListener('input', function(e) {
    const el = e.target;
    if (el && (el.type === 'number' || el.inputMode === 'numeric')) {
        if (el.value && el.value.length > 1 && el.value.startsWith('0') && !el.value.startsWith('0.')) {
            el.value = el.value.replace(/^0+/, '') || '0';
        }
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    initDatePicker();
    initSheetGestures();
    await loadCatalog();
    await checkCurrentUser();
    await loadReportForDate(getTodayDateStr());
    loadLKCDowntimes();
});

// --- DATEPICKER ---
function getTodayDateStr() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateRu(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
    return dateStr;
}

function parseRuDateToISO(ruStr) {
    if (!ruStr) return '';
    const parts = ruStr.split('.');
    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
    return ruStr;
}

function initDatePicker() {
    const input = document.getElementById('report-date-input');
    if (!input) return;

    flatpickr(input, {
        locale: 'ru',
        dateFormat: 'd.m.Y',
        defaultDate: new Date(),
        allowInput: true,
        onChange: function (selectedDates, dateStr) {
            if (dateStr) {
                const isoDate = parseRuDateToISO(dateStr);
                loadReportForDate(isoDate);
            }
        }
    });
    currentSelectedDate = getTodayDateStr();
}

// --- USER & AUTH ---
async function checkCurrentUser() {
    try {
        const resp = await fetch('/api/me/');
        if (resp.ok) {
            const data = await resp.json();
            if (data.authenticated && data.user) {
                const user = data.user;
                
                // Cross-Cabin Access Guard: Only lkc_master, admin or director are allowed here
                const allowedRoles = ['lkc_master', 'admin', 'director'];
                if (!allowedRoles.includes(user.role)) {
                    if (user.role === 'qcd' || (user.name && user.name.includes('Мусаилова'))) {
                        window.location.replace('/static/qcd.html');
                        return;
                    }
                    // For portal and other roles, return to main portal
                    window.location.replace('/');
                    return;
                }

                const userEl = document.getElementById('lkc-user-name');
                if (userEl) userEl.innerText = user.name || 'Миркасимов И.М.';
                
                const masterSelect = document.getElementById('report-master-select');
                if (masterSelect && user.name) {
                    let optExists = Array.from(masterSelect.options).some(o => o.value === user.name);
                    if (!optExists) {
                        const opt = document.createElement('option');
                        opt.value = user.name;
                        opt.innerText = user.name;
                        masterSelect.appendChild(opt);
                    }
                    masterSelect.value = user.name;
                }
            } else {
                // Not authenticated
                window.location.replace('/');
            }
        }
    } catch (e) {
        console.warn('Auth check error:', e);
    }
}

async function logoutLKC() {
    try {
        await fetch('/api/auth/logout');
        await fetch('/api/logout', { method: 'POST' });
    } catch (e) {}
    try {
        localStorage.removeItem('tectum_auth_user');
        localStorage.removeItem('tectum_portal_user');
        localStorage.removeItem('tectum_current_user_name');
        sessionStorage.clear();
    } catch (e) {}
    window.location.replace('/');
}

// --- CATALOG ---
async function loadCatalog() {
    try {
        const resp = await fetch('/api/lkc/catalog');
        if (resp.ok) {
            const data = await resp.json();
            lkcCatalog = data.catalog || [];
            renderLKCNormsTable();
        }
    } catch (e) {
        console.error('Failed to load catalog:', e);
    }
}

// --- TABS & ACCORDION ---
function switchLKCTab(tabName, event) {
    if (event && event.preventDefault) event.preventDefault();
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.lkc-tab-pane').forEach(pane => pane.style.display = 'none');

    const activeBtn = document.getElementById(`tab-btn-${tabName}`);
    const activePane = document.getElementById(`tab-${tabName}`);

    if (activeBtn) activeBtn.classList.add('active');
    if (activePane) activePane.style.display = 'block';

    if (tabName === 'downtimes') {
        loadLKCDowntimes();
    } else if (tabName === 'weekly') {
        loadLKCWeeklySummary();
    } else if (tabName === 'norms') {
        renderLKCNormsTable();
    }
}

function toggleLKCSection(sectionId) {
    const sec = document.getElementById(sectionId);
    if (sec) {
        sec.classList.toggle('expanded');
    }
}

// --- REPORT LOADING & RENDERING ---
function onShiftSelectChange(shiftVal) {
    if (currentSelectedDate) {
        loadReportForDate(currentSelectedDate);
    }
}

async function loadReportForDate(isoDate) {
    currentSelectedDate = isoDate;
    const shiftName = document.getElementById('report-shift-select')?.value || 'День';

    try {
        const resp = await fetch(`/api/lkc/reports/by_date?report_date=${isoDate}&shift_name=${encodeURIComponent(shiftName)}`);
        if (resp.ok) {
            const report = await resp.json();
            if (report) {
                populateReportForm(report);
                showToast('info', `Загружен рапорт (${shiftName}) за ${formatDateRu(isoDate)}`);
                return;
            }
        }
        // If not found in server, check local draft or initialize clean
        const draft = loadDraft(isoDate);
        if (draft) {
            populateReportForm(draft);
            showToast('info', 'Восстановлен локальный черновик');
        } else {
            initEmptyReportForm();
        }
    } catch (e) {
        console.error('Error loading report:', e);
        initEmptyReportForm();
    }
}

function initEmptyReportForm() {
    currentReportId = null;

    const tbody = document.getElementById('lkc-items-tbody');
    if (tbody) tbody.innerHTML = '';
    
    const rawTbody = document.getElementById('lkc-raw-tbody');
    if (rawTbody) rawTbody.innerHTML = '';

    // Default 1 product item row (Раскрой листа со сменным планом 750)
    addLKCItemRow({
        dimension_size: 'пл. лист 6мм 1800х300',
        plan_qty: 750,
        fact_qty: '',
        order_batch: 'Раскрой листа',
        sets_count: '',
        comp_t_count: '',
        comp_l_count: '',
        comp_screws_count: ''
    });

    // Default 1 raw material row
    addLKCRawMaterialRow({
        material_name: 'Плоский лист 8мм 1800х1200',
        spent_qty: '',
        warehouse_submitted_qty: '',
        scrap_defect_qty: '',
        notes: ''
    });

    calculateLKCTotals();
}

function populateReportForm(report) {
    currentReportId = report.id || null;

    if (report.shift_name) {
        const shiftSelect = document.getElementById('report-shift-select');
        if (shiftSelect) {
            const isNight = report.shift_name.toLowerCase().includes('ноч') || report.shift_name === '2';
            shiftSelect.value = isNight ? 'Ночь' : 'День';
        }
    }

    if (report.master_name) {
        const masterSelect = document.getElementById('report-master-select');
        if (masterSelect) masterSelect.value = report.master_name;
    }

    const tbody = document.getElementById('lkc-items-tbody');
    if (tbody) {
        tbody.innerHTML = '';
        if (report.items && report.items.length > 0) {
            report.items.forEach(item => addLKCItemRow(item));
        } else {
            addLKCItemRow();
        }
    }

    const rawTbody = document.getElementById('lkc-raw-tbody');
    if (rawTbody) {
        rawTbody.innerHTML = '';
        if (report.raw_materials && report.raw_materials.length > 0) {
            report.raw_materials.forEach(r => addLKCRawMaterialRow(r));
        } else if (report.raw_sheets_spent || report.warehouse_submitted_qty || report.scrap_defect_qty) {
            addLKCRawMaterialRow({
                material_name: 'Плоский лист ' + (report.raw_sheets_thickness || '8 мм') + ' 1800х1200',
                spent_qty: report.raw_sheets_spent || '',
                warehouse_submitted_qty: report.warehouse_submitted_qty || '',
                scrap_defect_qty: report.scrap_defect_qty || '',
                notes: ''
            });
        } else {
            addLKCRawMaterialRow();
        }
    }

    calculateLKCTotals();
}

// --- FRIENDLY PRODUCT NAMES & BASE SIZES FOR STEPPED SELECTION ---
function getFriendlyDimName(dimVal = '') {
    if (!dimVal) return 'Выберите продукцию...';
    if (lkcCatalog && lkcCatalog.length > 0) {
        const item = lkcCatalog.find(c => c.dimension_size === dimVal || c.name === dimVal);
        if (item && item.name) return item.name;
    }
    const s = String(dimVal).toLowerCase();
    if (s.includes('3600') || s.includes('3.6')) return 'Грядка 3.6 м (3600х900х240)';
    if (s.includes('2700') || s.includes('2.7')) return 'Грядка 2.7 м (2700х900х240)';
    if (s.includes('1800х900') || s.includes('1800x900') || s.includes('1.8')) return 'Грядка 1.8 м (1800х900х240)';
    let th = '8мм';
    if (s.includes('6мм') || s.includes('6 мм')) th = '6мм';
    else if (s.includes('10мм') || s.includes('10 мм')) th = '10мм';
    
    if (s.includes('1200')) return `Плоский лист ${th} 1800х1200`;
    if (s.includes('300')) return `Полоса плоская ${th} 1800х300`;
    if (s.includes('240')) return `Полоса плоская ${th} 1800х240`;
    if (s.includes('200')) return `Полоса плоская ${th} 1800х200`;
    if (s.includes('400')) return `Полоса плоская ${th} 1800х400`;
    return dimVal;
}

const LKC_BASE_SIZES = [
    {
        key: 'strip_1800_300',
        cat: 'strip',
        title: 'Полоса 1800 × 300',
        ratioText: '4 полосы с 1 цельного листа 1800×1200',
        iconClass: 'card-icon-strip',
        icon: 'fa-solid fa-bars',
        dimPrefix: '1800х300',
        type: 'cut'
    },
    {
        key: 'strip_1800_240',
        cat: 'strip',
        title: 'Полоса 1800 × 240',
        ratioText: '5 полос с 1 листа (высота борта грядки)',
        iconClass: 'card-icon-strip',
        icon: 'fa-solid fa-bars',
        dimPrefix: '1800х240',
        type: 'cut'
    },
    {
        key: 'strip_1800_200',
        cat: 'strip',
        title: 'Полоса 1800 × 200',
        ratioText: '6 полос с 1 цельного листа 1800×1200',
        iconClass: 'card-icon-strip',
        icon: 'fa-solid fa-bars',
        dimPrefix: '1800х200',
        type: 'cut'
    },
    {
        key: 'strip_1800_400',
        cat: 'strip',
        title: 'Полоса 1800 × 400',
        ratioText: '3 полосы с 1 цельного листа 1800×1200',
        iconClass: 'card-icon-strip',
        icon: 'fa-solid fa-bars',
        dimPrefix: '1800х400',
        type: 'cut'
    },
    {
        key: 'sheet_1800_1200',
        cat: 'sheet',
        title: 'Плоский лист 1800 × 1200',
        ratioText: 'Цельный плоский хризотилцементный лист',
        iconClass: 'card-icon-sheet',
        icon: 'fa-solid fa-sheet-plastic',
        dimPrefix: '1800х1200',
        type: 'cut'
    },
    {
        key: 'bed_3600',
        cat: 'bed',
        title: 'Грядка 3.6 м (3600х900х240)',
        ratioText: 'Комплект: Т-профиль 6 шт, L-уголок 4 шт, шурупы 40 шт',
        iconClass: 'card-icon-bed',
        icon: 'fa-solid fa-cubes-stacked',
        dimension_size: 'грядка 3600х900х240',
        type: 'bed'
    },
    {
        key: 'bed_2700',
        cat: 'bed',
        title: 'Грядка 2.7 м (2700х900х240)',
        ratioText: 'Комплект: Т-профиль 4 шт, L-уголок 4 шт, шурупы 32 шт',
        iconClass: 'card-icon-bed',
        icon: 'fa-solid fa-cubes-stacked',
        dimension_size: 'грядка 2700х900х240',
        type: 'bed'
    },
    {
        key: 'bed_1800',
        cat: 'bed',
        title: 'Грядка 1.8 м (1800х900х240)',
        ratioText: 'Комплект: Т-профиль 2 шт, L-уголок 4 шт, шурупы 24 шт',
        iconClass: 'card-icon-bed',
        icon: 'fa-solid fa-cubes-stacked',
        dimension_size: 'грядка 1800х900х240',
        type: 'bed'
    }
];

let currentActiveDimRow = null;
let currentSelectedBase = null;
let currentSheetCategory = 'all';

function openLKCProductSheet(btnEl) {
    currentActiveDimRow = btnEl.closest('tr');
    if (!currentActiveDimRow) return;

    const selectEl = currentActiveDimRow.querySelector('.item-dimension');
    const currentDim = selectEl ? selectEl.value : '';

    currentSelectedBase = null;
    currentSheetCategory = 'all';

    document.querySelectorAll('.sheet-cat-filter-chips .sheet-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.cat === 'all');
    });

    renderSheetStep1(currentDim);
    goToSheetStep(1);

    const backdrop = document.getElementById('lkc-product-sheet-backdrop');
    if (backdrop) {
        backdrop.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeLKCProductSheet() {
    const backdrop = document.getElementById('lkc-product-sheet-backdrop');
    if (backdrop) {
        backdrop.classList.remove('active');
    }
    document.body.style.overflow = '';
    currentActiveDimRow = null;
    currentSelectedBase = null;
}

function goToSheetStep(step) {
    const step1 = document.getElementById('sheet-step-1');
    const step2 = document.getElementById('sheet-step-2');
    const btnBack = document.getElementById('sheet-btn-back');
    const subtitle = document.getElementById('sheet-subtitle');

    if (step === 1) {
        if (step1) step1.style.display = 'flex';
        if (step2) step2.style.display = 'none';
        if (btnBack) btnBack.style.display = 'none';
        if (subtitle) subtitle.textContent = 'Шаг 1 из 2: Выберите типоразмер';
    } else if (step === 2) {
        if (step1) step1.style.display = 'none';
        if (step2) step2.style.display = 'flex';
        if (btnBack) btnBack.style.display = 'inline-flex';
        if (subtitle) subtitle.textContent = 'Шаг 2 из 2: Выберите толщину листа';
    }
}

function filterSheetDimensions(cat, chipEl) {
    currentSheetCategory = cat;
    if (chipEl) {
        document.querySelectorAll('.sheet-cat-filter-chips .sheet-chip').forEach(c => c.classList.remove('active'));
        chipEl.classList.add('active');
    }
    const currentDim = currentActiveDimRow?.querySelector('.item-dimension')?.value || '';
    renderSheetStep1(currentDim);
}

function renderSheetStep1(currentDim = '') {
    const container = document.getElementById('sheet-step1-items');
    if (!container) return;

    const filtered = currentSheetCategory === 'all' 
        ? LKC_BASE_SIZES 
        : LKC_BASE_SIZES.filter(b => b.cat === currentSheetCategory);

    const normDim = (currentDim || '').toLowerCase().replace(' ', '');

    container.innerHTML = filtered.map(item => {
        let isSelected = false;
        if (item.type === 'bed') {
            isSelected = normDim.includes(item.dimension_size.replace(' ', '')) || normDim.includes(item.key.replace('bed_', ''));
        } else {
            const prefix = item.dimPrefix.replace('х', 'x');
            const normPref = item.dimPrefix;
            isSelected = normDim.includes(normPref) || normDim.includes(prefix);
        }

        const selectedClass = isSelected ? 'active-selected' : '';
        const actionLabel = item.type === 'bed' 
            ? '<span class="card-action-indicator bed-instant"><i class="fa-solid fa-check"></i> 1 клик</span>' 
            : '<span class="card-action-indicator">Толщина <i class="fa-solid fa-chevron-right"></i></span>';

        return `
            <button type="button" class="sheet-dim-card ${selectedClass}" onclick="selectLKCBaseDimension('${item.key}')">
                <div class="card-icon-box ${item.iconClass}">
                    <i class="${item.icon}"></i>
                </div>
                <div class="card-info">
                    <span class="card-title">${escapeHtml(item.title)}</span>
                    <span class="card-subtitle">${escapeHtml(item.ratioText)}</span>
                </div>
                ${actionLabel}
            </button>
        `;
    }).join('');
}

function selectLKCBaseDimension(key) {
    const baseItem = LKC_BASE_SIZES.find(b => b.key === key);
    if (!baseItem) return;

    if (baseItem.type === 'bed') {
        applyDimensionToActiveRow(baseItem.dimension_size);
        closeLKCProductSheet();
        return;
    }

    currentSelectedBase = baseItem;
    const nameEl = document.getElementById('sheet-step2-base-name');
    const hintEl = document.getElementById('sheet-step2-base-hint');
    if (nameEl) nameEl.textContent = baseItem.title;
    if (hintEl) hintEl.textContent = baseItem.ratioText;

    const currentDim = (currentActiveDimRow?.querySelector('.item-dimension')?.value || '').toLowerCase();
    document.querySelectorAll('.sheet-thickness-options .sheet-thick-card').forEach(btn => {
        btn.classList.remove('active-selected');
    });
    if (currentDim.includes('6мм') || currentDim.includes('6 мм')) {
        document.querySelector('.sheet-thickness-options .sheet-thick-card:nth-child(1)')?.classList.add('active-selected');
    } else if (currentDim.includes('8мм') || currentDim.includes('8 мм')) {
        document.querySelector('.sheet-thickness-options .sheet-thick-card:nth-child(2)')?.classList.add('active-selected');
    } else if (currentDim.includes('10мм') || currentDim.includes('10 мм')) {
        document.querySelector('.sheet-thickness-options .sheet-thick-card:nth-child(3)')?.classList.add('active-selected');
    }

    goToSheetStep(2);
}

function selectLKCThickness(thick) {
    if (!currentSelectedBase) return;
    const cleanThick = thick.replace(' ', '');
    const dimPrefix = currentSelectedBase.dimPrefix;

    let matchedItem = null;
    if (lkcCatalog && lkcCatalog.length > 0) {
        matchedItem = lkcCatalog.find(c => {
            const d = (c.dimension_size || '').toLowerCase().replace(' ', '');
            const n = (c.name || '').toLowerCase().replace(' ', '');
            const pNorm = dimPrefix.replace('x', 'х');
            return (d.includes(cleanThick) || n.includes(cleanThick)) && (d.includes(dimPrefix) || n.includes(dimPrefix) || d.includes(pNorm) || n.includes(pNorm));
        });
    }

    let finalDimValue = '';
    if (matchedItem) {
        finalDimValue = matchedItem.dimension_size || matchedItem.name;
    } else {
        finalDimValue = `пл. лист ${cleanThick} ${dimPrefix}`;
    }

    applyDimensionToActiveRow(finalDimValue);
    closeLKCProductSheet();
}

function applyDimensionToActiveRow(dimVal) {
    if (!currentActiveDimRow) return;
    const selectEl = currentActiveDimRow.querySelector('.item-dimension');
    const btnTextEl = currentActiveDimRow.querySelector('.lkc-dim-picker-text');

    if (selectEl) {
        selectEl.value = dimVal;
        if (selectEl.value !== dimVal) {
            const opt = document.createElement('option');
            opt.value = dimVal;
            opt.textContent = getFriendlyDimName(dimVal);
            opt.selected = true;
            selectEl.appendChild(opt);
            selectEl.value = dimVal;
        }
        onDimensionSelectChange(selectEl);
    }

    if (btnTextEl) {
        btnTextEl.textContent = getFriendlyDimName(dimVal);
    }

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(14); } catch (e) {}
    }
}

// Drag down gesture & Escape key listener
let sheetTouchStartY = 0;
let sheetTouchCurrentY = 0;

function initSheetGestures() {
    const sheet = document.getElementById('lkc-product-sheet');
    const handle = document.querySelector('.sheet-drag-handle');
    if (sheet && handle) {
        handle.addEventListener('touchstart', (e) => {
            sheetTouchStartY = e.touches[0].clientY;
            sheetTouchCurrentY = sheetTouchStartY;
        }, { passive: true });

        handle.addEventListener('touchmove', (e) => {
            sheetTouchCurrentY = e.touches[0].clientY;
            const diff = sheetTouchCurrentY - sheetTouchStartY;
            if (diff > 0) {
                sheet.style.transform = `translateY(${diff}px)`;
            }
        }, { passive: true });

        handle.addEventListener('touchend', () => {
            const diff = sheetTouchCurrentY - sheetTouchStartY;
            sheet.style.transform = '';
            if (diff > 70) {
                closeLKCProductSheet();
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeLKCProductSheet();
        }
    });
}

// Catalog options helper
function getCatalogOptionsHTML(selectedDim = '') {
    if (!lkcCatalog || lkcCatalog.length === 0) {
        const fallback = [
            { name: 'Полоса плоская 6мм 1800х300', dim: 'пл. лист 6мм 1800х300', plan: 750 },
            { name: 'Полоса плоская 8мм 1800х300', dim: 'пл. лист 8мм 1800х300', plan: 750 },
            { name: 'Полоса плоская 6мм 1800х240', dim: 'пл. лист 6мм 1800х240', plan: 750 },
            { name: 'Полоса плоская 8мм 1800х240', dim: 'пл. лист 8мм 1800х240', plan: 750 },
            { name: 'Полоса плоская 10мм 1800х240', dim: 'пл. лист 10мм 1800х240', plan: 750 },
            { name: 'Плоский лист 6мм 1800х1200', dim: 'пл. лист 6мм 1800х1200', plan: 750 },
            { name: 'Плоский лист 8мм 1800х1200', dim: 'пл. лист 8мм 1800х1200', plan: 750 },
            { name: 'Плоский лист 10мм 1800х1200', dim: 'пл. лист 10мм 1800х1200', plan: 750 },
            { name: 'Грядка 3.6 м (3600х900х240)', dim: 'грядка 3600х900х240', plan: 0 },
            { name: 'Грядка 2.7 м (2700х900х240)', dim: 'грядка 2700х900х240', plan: 0 },
            { name: 'Грядка 1.8 м (1800х900х240)', dim: 'грядка 1800х900х240', plan: 0 }
        ];
        return fallback.map(item => {
            const isSel = (item.dim === selectedDim || item.name === selectedDim) ? 'selected' : '';
            return `<option value="${escapeHtml(item.dim)}" data-plan="${item.plan}" ${isSel}>${escapeHtml(item.name)}</option>`;
        }).join('');
    }

    return lkcCatalog.map(c => {
        const isSel = (c.dimension_size === selectedDim || c.name === selectedDim) ? 'selected' : '';
        const isBed = (c.product_type && c.product_type.includes('гряд')) || (c.id && c.id.startsWith('bed_')) || c.name.toLowerCase().includes('грядка');
        const planVal = isBed ? 0 : (c.plan_default !== undefined ? c.plan_default : 750);
        return `<option value="${escapeHtml(c.dimension_size || c.name)}" data-t="${c.norm_t}" data-l="${c.norm_l}" data-s="${c.norm_screws}" data-plan="${planVal}" ${isSel}>${escapeHtml(c.name)}</option>`;
    }).join('');
}

let orderProgressTimers = {};

async function checkOrderProgress(orderNumber, badgeEl, currentShiftSets = 0) {
    if (!badgeEl || !orderNumber) return;
    const cleanOrder = orderNumber.trim();
    if (!cleanOrder || cleanOrder.toLowerCase() === 'раскрой листа') {
        badgeEl.style.display = 'none';
        return;
    }

    try {
        const resp = await fetch(`/api/lkc/orders/progress?order_number=${encodeURIComponent(cleanOrder)}`);
        if (resp.ok) {
            const data = await resp.json();
            const prev = data.previously_produced_qty || 0;
            const plan = data.total_planned_qty || 0;
            const currentTotal = prev + Number(currentShiftSets || 0);

            badgeEl.style.display = 'block';
            if (plan > 0) {
                const pct = Math.min(100, Math.round((currentTotal / plan) * 100));
                const rem = Math.max(0, plan - currentTotal);
                badgeEl.innerHTML = `<i class="fa-solid fa-list-check"></i> Заказ: <strong>${currentTotal}</strong> из ${plan} (${pct}%) • Ост: ${rem}`;
                badgeEl.style.background = rem === 0 ? '#dcfce7' : '#e0f2fe';
                badgeEl.style.color = rem === 0 ? '#15803d' : '#0369a1';
                badgeEl.style.border = `1px solid ${rem === 0 ? '#86efac' : '#bae6fd'}`;
            } else if (prev > 0) {
                badgeEl.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> Ранее сделано: <strong>${prev}</strong> шт • Смена: +${currentShiftSets || 0}`;
                badgeEl.style.background = '#f1f5f9';
                badgeEl.style.color = '#334155';
                badgeEl.style.border = '1px solid #cbd5e1';
            } else {
                badgeEl.innerHTML = `<i class="fa-solid fa-circle-plus"></i> Новый заказ (0 шт ранее)`;
                badgeEl.style.background = '#f8fafc';
                badgeEl.style.color = '#64748b';
                badgeEl.style.border = '1px solid #e2e8f0';
            }
        }
    } catch (e) {
        console.warn('Failed to check order progress:', e);
    }
}

function onOrderInputChange(inputEl) {
    const tr = inputEl.closest('tr');
    if (!tr) return;
    const badgeEl = tr.querySelector('.order-progress-tag');
    const orderVal = inputEl.value.trim();
    const setsVal = parseInt(tr.querySelector('.item-sets')?.value, 10) || 0;

    const rowId = tr.rowIndex || Math.random();
    if (orderProgressTimers[rowId]) clearTimeout(orderProgressTimers[rowId]);

    orderProgressTimers[rowId] = setTimeout(() => {
        checkOrderProgress(orderVal, badgeEl, setsVal);
    }, 400);

    calculateLKCTotals();
}

function addLKCItemRow(data = {}) {
    const tbody = document.getElementById('lkc-items-tbody');
    if (!tbody) return;
    const rowIdx = tbody.children.length + 1;
    const tr = document.createElement('tr');
    tr.className = 'lkc-item-row';

    const dimSize = data.dimension_size || 'пл. лист 6мм 1800х300';
    const isBed = Boolean(
        (dimSize && dimSize.toLowerCase().includes('гряд')) ||
        (data.order_batch && data.order_batch.toLowerCase().includes('гряд')) ||
        (data.order_number && data.order_number.toLowerCase().includes('гряд')) ||
        (dimSize && (dimSize.includes('3600') || dimSize.includes('2700') || dimSize.includes('1800х900')))
    );
    const defaultPlan = isBed ? 0 : 750;
    const planQty = data.plan_qty !== undefined && data.plan_qty !== '' ? Math.round(Number(data.plan_qty)) : defaultPlan;
    const factQty = data.fact_qty !== undefined && data.fact_qty !== '' ? Math.round(Number(data.fact_qty)) : '';
    const defaultOrder = isBed ? 'Заказ грядки' : 'Раскрой листа';
    const orderNum = data.order_number || data.order_batch || defaultOrder;
    const setsCount = data.sets_count !== undefined && data.sets_count !== '' ? Math.round(Number(data.sets_count)) : '';
    let compT = data.comp_t_count !== undefined && data.comp_t_count !== '' ? Math.round(Number(data.comp_t_count)) : '';
    let compL = data.comp_l_count !== undefined && data.comp_l_count !== '' ? Math.round(Number(data.comp_l_count)) : '';
    let compScrews = data.comp_screws_count !== undefined && data.comp_screws_count !== '' ? Math.round(Number(data.comp_screws_count)) : '';
    let compStrips = data.comp_strips_count !== undefined && data.comp_strips_count !== '' ? Math.round(Number(data.comp_strips_count)) : '';

    // If sets are given but hardware is not specified, auto-calculate from catalog
    if (setsCount > 0 && compT === '' && compL === '' && compScrews === '' && compStrips === '' && lkcCatalog && lkcCatalog.length > 0) {
        const catItem = lkcCatalog.find(c => c.dimension_size === dimSize || c.name === dimSize);
        if (catItem) {
            compT = Math.round((catItem.norm_t || 0) * setsCount);
            compL = Math.round((catItem.norm_l || 0) * setsCount);
            compScrews = Math.round((catItem.norm_screws || 0) * setsCount);
            compStrips = Math.round((catItem.norm_strips || 0) * setsCount);
        }
    }

    tr.innerHTML = `
        <td class="cell-header" data-label="№">
            <span class="mobile-row-title"><i class="fa-solid fa-layer-group" style="color:var(--lkc-primary);"></i> Строка №<span class="row-num">${rowIdx}</span></span>
            <button type="button" class="lkc-row-del-btn mobile-only" onclick="removeLKCItemRow(this)" title="Удалить строку" aria-label="Удалить строку">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </td>
        <td class="cell-dim" data-label="Размер / Типоразмер">
            <select class="item-dimension" onchange="onDimensionSelectChange(this)" style="display: none;">
                ${getCatalogOptionsHTML(dimSize)}
            </select>
            <button type="button" class="lkc-dim-picker-btn" onclick="openLKCProductSheet(this)" title="Нажмите для выбора типоразмера">
                <span class="lkc-dim-picker-text">${escapeHtml(getFriendlyDimName(dimSize))}</span>
                <i class="fa-solid fa-chevron-down lkc-dim-picker-icon"></i>
            </button>
        </td>
        <td class="cell-plan" data-label="План (шт)">
            <input type="number" step="1" inputmode="numeric" class="item-plan" value="${planQty}" placeholder="0" min="0" onwheel="this.blur()" oninput="calculateLKCTotals()">
        </td>
        <td class="cell-fact" data-label="Факт (шт)">
            <input type="number" step="1" inputmode="numeric" pattern="[0-9]*" class="item-fact" value="${factQty}" placeholder="0" min="0" onwheel="this.blur()" oninput="calculateLKCTotals()">
        </td>
        <td class="cell-order" data-label="Комплект (Заказ / Партия)">
            <div style="display: flex; flex-direction: column; gap: 4px; width: 100%;">
                <input type="text" class="item-order" value="${escapeHtml(orderNum)}" placeholder="№ Заказа (напр. ЗАК-104)" oninput="onOrderInputChange(this)">
                <div class="order-progress-tag" style="display: none; font-size: 0.74rem; font-weight: 700; border-radius: 6px; padding: 2px 6px;"></div>
            </div>
        </td>
        <td class="cell-sets" data-label="Кол-во компл.">
            <input type="number" step="1" inputmode="numeric" pattern="[0-9]*" class="item-sets" value="${setsCount}" placeholder="0" min="0" onwheel="this.blur()" oninput="onSetsCountChange(this)">
        </td>
        <td class="cell-hw-banner mobile-only" data-label="">
            <div class="mobile-hw-header">
                <i class="fa-solid fa-calculator" style="color: #0284c7;"></i>
                <span>Фурнитура и полосы (авторасчет)</span>
            </div>
        </td>
        <td class="cell-t" data-label="T (шт)">
            <input type="number" step="1" class="item-t" value="${compT}" placeholder="0" readonly tabindex="-1" style="pointer-events: none;">
        </td>
        <td class="cell-l" data-label="L (шт)">
            <input type="number" step="1" class="item-l" value="${compL}" placeholder="0" readonly tabindex="-1" style="pointer-events: none;">
        </td>
        <td class="cell-screws" data-label="Шурупы">
            <input type="number" step="1" class="item-screws" value="${compScrews}" placeholder="0" readonly tabindex="-1" style="pointer-events: none;">
        </td>
        <td class="cell-strips" data-label="Полосы (шт)">
            <input type="number" step="1" class="item-strips" value="${compStrips}" placeholder="0" readonly tabindex="-1" style="pointer-events: none;">
        </td>
        <td class="cell-action desktop-only" style="text-align: center;">
            <button type="button" class="lkc-btn-danger" onclick="removeLKCItemRow(this)" title="Удалить строку" style="height: 38px; width: 38px; font-size: 0.95rem;">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </td>
    `;

    tbody.appendChild(tr);
    const orderInput = tr.querySelector('.item-order');
    if (orderInput && orderInput.value) {
        onOrderInputChange(orderInput);
    }
    renumberItemRows();
    calculateLKCTotals();
}

function onOrderTypeChange(selectEl) {
    const tr = selectEl.closest('tr');
    if (!tr) return;
    const val = (selectEl.value || '').toLowerCase();
    const isCut = val === 'раскрой листа' || val.includes('раскрой');
    const planInput = tr.querySelector('.item-plan');
    if (planInput && !planInput.value) {
        planInput.value = isCut ? 750 : 0;
    }
    const setsInput = tr.querySelector('.item-sets');
    const hwBanner = tr.querySelector('.cell-hw-banner');
    const cellT = tr.querySelector('.cell-t');
    const cellL = tr.querySelector('.cell-l');
    const cellScrews = tr.querySelector('.cell-screws');
    const cellStrips = tr.querySelector('.cell-strips');

    if (isCut) {
        if (setsInput) {
            setsInput.value = 0;
            setsInput.disabled = true;
            setsInput.style.background = '#f1f5f9';
            setsInput.style.color = '#94a3b8';
            setsInput.style.borderColor = '#cbd5e1';
        }
        if (tr.querySelector('.item-t')) tr.querySelector('.item-t').value = 0;
        if (tr.querySelector('.item-l')) tr.querySelector('.item-l').value = 0;
        if (tr.querySelector('.item-screws')) tr.querySelector('.item-screws').value = 0;
        if (tr.querySelector('.item-strips')) tr.querySelector('.item-strips').value = 0;
        if (hwBanner) hwBanner.style.opacity = '0.35';
        if (cellT) cellT.style.opacity = '0.35';
        if (cellL) cellL.style.opacity = '0.35';
        if (cellScrews) cellScrews.style.opacity = '0.35';
        if (cellStrips) cellStrips.style.opacity = '0.35';
    } else {
        if (setsInput) {
            setsInput.disabled = false;
            setsInput.style.background = '#ffffff';
            setsInput.style.color = '#0f172a';
            setsInput.style.borderColor = '#3b82f6';
        }
        if (hwBanner) hwBanner.style.opacity = '1';
        if (cellT) cellT.style.opacity = '1';
        if (cellL) cellL.style.opacity = '1';
        if (cellScrews) cellScrews.style.opacity = '1';
        if (cellStrips) cellStrips.style.opacity = '1';
        if (setsInput) onSetsCountChange(setsInput);
    }
    calculateLKCTotals();
}

function removeLKCItemRow(btn) {
    const tbody = document.getElementById('lkc-items-tbody');
    if (!tbody) return;
    if (tbody.children.length <= 1) {
        showToast('error', 'В рапорте должна оставаться минимум одна строка');
        return;
    }
    const tr = btn.closest('tr');
    tr.remove();
    renumberItemRows();
    calculateLKCTotals();
}

function renumberItemRows() {
    const tbody = document.getElementById('lkc-items-tbody');
    if (!tbody) return;
    Array.from(tbody.children).forEach((tr, idx) => {
        const numTd = tr.querySelector('.row-num');
        if (numTd) numTd.innerText = idx + 1;
    });
}

// --- DYNAMIC RAW MATERIAL USAGE ROWS ---
function getRawMaterialOptionsHTML(selectedMat = '') {
    const rawPresets = [
        'Плоский лист 8мм 1800х1200',
        'Плоский лист 6мм 1800х1200',
        'Плоский лист 10мм 1800х1200',
        'Полоса 8мм 1800х300',
        'Полоса 6мм 1800х300',
        'Полоса 8мм 1800х240',
        'Полоса 6мм 1800х240',
        'Полоса 10мм 1800х240',
        'Т-профиль (1.0 м)',
        'L-уголок (245 мм)',
        'Саморезы / Шурупы 4.2х16',
        'Прочее сырье'
    ];

    return rawPresets.map(mat => {
        const isSel = (mat === selectedMat) ? 'selected' : '';
        return `<option value="${escapeHtml(mat)}" ${isSel}>${escapeHtml(mat)}</option>`;
    }).join('');
}

function addLKCRawMaterialRow(data = {}) {
    const tbody = document.getElementById('lkc-raw-tbody');
    if (!tbody) return;
    const rowIdx = tbody.children.length + 1;
    const tr = document.createElement('tr');
    tr.className = 'lkc-raw-row';

    const matName = data.material_name || 'Плоский лист 8мм 1800х1200';
    const spentQty = data.spent_qty !== undefined && data.spent_qty !== '' ? Math.round(Number(data.spent_qty)) : '';
    const whSub = data.warehouse_submitted_qty !== undefined && data.warehouse_submitted_qty !== '' ? Math.round(Number(data.warehouse_submitted_qty)) : '';
    const scrapQty = data.scrap_defect_qty !== undefined && data.scrap_defect_qty !== '' ? Math.round(Number(data.scrap_defect_qty)) : '';
    const notes = data.notes || '';

    tr.innerHTML = `
        <td class="cell-header" data-label="№">
            <span class="mobile-row-title"><i class="fa-solid fa-box-open" style="color:var(--lkc-primary);"></i> Материал №<span class="raw-row-num">${rowIdx}</span></span>
            <button type="button" class="lkc-row-del-btn mobile-only" onclick="removeLKCRawMaterialRow(this)" title="Удалить строку" aria-label="Удалить строку">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </td>
        <td class="cell-mat" data-label="Наименование сырья / Материал">
            <select class="raw-material-name" onchange="calculateLKCTotals()" style="font-weight: 700; color: #0f172a;">
                ${getRawMaterialOptionsHTML(matName)}
            </select>
        </td>
        <td class="cell-spent" data-label="Списано (шт)">
            <input type="number" step="1" inputmode="numeric" pattern="[0-9]*" class="raw-spent" value="${spentQty}" placeholder="0" min="0" onwheel="this.blur()" oninput="calculateLKCTotals()" style="text-align: center; font-weight: 700; color: #1e293b;">
        </td>
        <td class="cell-submitted" data-label="Сдано на склад ГП (шт)">
            <input type="number" step="1" inputmode="numeric" pattern="[0-9]*" class="raw-submitted" value="${whSub}" placeholder="0" min="0" onwheel="this.blur()" oninput="calculateLKCTotals()" style="text-align: center; font-weight: 800; color: #15803d;">
        </td>
        <td class="cell-scrap" data-label="Отходы / Брак (шт)">
            <input type="number" step="1" inputmode="numeric" pattern="[0-9]*" class="raw-scrap" value="${scrapQty}" placeholder="0" min="0" onwheel="this.blur()" oninput="calculateLKCTotals()" style="text-align: center; font-weight: 800; color: #dc2626;">
        </td>
        <td class="cell-notes" data-label="Примечание / Партия">
            <input type="text" class="raw-notes" value="${escapeHtml(notes)}" placeholder="Партия / примечание">
        </td>
        <td class="cell-action desktop-only" style="text-align: center;">
            <button type="button" class="lkc-btn-danger" onclick="removeLKCRawMaterialRow(this)" title="Удалить строку списания" style="height: 38px; width: 38px; font-size: 0.95rem;">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </td>
    `;

    tbody.appendChild(tr);
    renumberRawRows();
    calculateLKCTotals();
}

function removeLKCRawMaterialRow(btn) {
    const tbody = document.getElementById('lkc-raw-tbody');
    if (!tbody) return;
    if (tbody.children.length <= 1) {
        showToast('error', 'В списании должна оставаться минимум одна строка');
        return;
    }
    const tr = btn.closest('tr');
    tr.remove();
    renumberRawRows();
    calculateLKCTotals();
}

function renumberRawRows() {
    const tbody = document.getElementById('lkc-raw-tbody');
    if (!tbody) return;
    Array.from(tbody.children).forEach((tr, idx) => {
        const numTd = tr.querySelector('.raw-row-num');
        if (numTd) numTd.innerText = idx + 1;
    });
}

// --- AUTO CALCULATION LOGIC ---
function onDimensionSelectChange(selectEl) {
    const tr = selectEl.closest('tr');
    if (!tr) return;
    const dimVal = selectEl.value;

    const pickerText = tr.querySelector('.lkc-dim-picker-text');
    if (pickerText) {
        pickerText.textContent = getFriendlyDimName(dimVal);
    }

    const catItem = lkcCatalog.find(c => c.dimension_size === dimVal || c.name === dimVal);
    const isBed = Boolean(
        (catItem?.product_type && catItem.product_type.includes('гряд')) ||
        (catItem?.id && catItem.id.startsWith('bed_')) ||
        dimVal.toLowerCase().includes('грядк') ||
        dimVal.includes('3600') || dimVal.includes('2700') || dimVal.includes('1800х900')
    );

    const planInput = tr.querySelector('.item-plan');
    if (planInput) {
        planInput.value = isBed ? 0 : (catItem?.plan_default !== undefined ? catItem.plan_default : 750);
    }

    const orderSelect = tr.querySelector('.item-order');
    if (orderSelect) {
        orderSelect.value = isBed ? 'грядки' : 'Раскрой листа';
        onOrderTypeChange(orderSelect);
    }

    const setsInput = tr.querySelector('.item-sets');
    if (setsInput) {
        onSetsCountChange(setsInput);
    } else {
        calculateLKCTotals();
    }
}

function onSetsCountChange(inputEl) {
    const tr = inputEl.closest('tr');
    const sets = parseInt(inputEl.value, 10) || 0;
    const dimSelect = tr.querySelector('.item-dimension');
    const dimVal = dimSelect ? dimSelect.value : '';

    const catItem = lkcCatalog.find(c => c.dimension_size === dimVal || c.name === dimVal);
    let normT = 0, normL = 0, normScrews = 0, normStrips = 0;

    if (catItem && (catItem.norm_t > 0 || catItem.norm_l > 0 || catItem.norm_screws > 0 || catItem.norm_strips > 0)) {
        normT = catItem.norm_t || 0;
        normL = catItem.norm_l || 0;
        normScrews = catItem.norm_screws || 0;
        normStrips = catItem.norm_strips || 0;
    } else {
        // Fallback rule by dimension text
        const dimLower = dimVal.toLowerCase();
        if (dimLower.includes('3.6') || dimLower.includes('3600')) {
            normT = 6; normL = 4; normScrews = 40; normStrips = 10;
        } else if (dimLower.includes('2.7') || dimLower.includes('2700')) {
            normT = 4; normL = 4; normScrews = 32; normStrips = 8;
        } else if (dimLower.includes('1.8') || dimLower.includes('1800') || dimLower.includes('грядка')) {
            normT = 2; normL = 4; normScrews = 24; normStrips = 6;
        }
    }

    if (tr.querySelector('.item-t')) tr.querySelector('.item-t').value = sets > 0 ? Math.round(normT * sets) : 0;
    if (tr.querySelector('.item-l')) tr.querySelector('.item-l').value = sets > 0 ? Math.round(normL * sets) : 0;
    if (tr.querySelector('.item-screws')) tr.querySelector('.item-screws').value = sets > 0 ? Math.round(normScrews * sets) : 0;
    if (tr.querySelector('.item-strips')) tr.querySelector('.item-strips').value = sets > 0 ? Math.round(normStrips * sets) : 0;

    // Check order progress dynamically
    const orderInput = tr.querySelector('.item-order');
    if (orderInput && orderInput.value) {
        onOrderInputChange(orderInput);
    }

    calculateLKCTotals();
}

function renderLKCNormsTable() {
    const tbody = document.getElementById('lkc-norms-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!lkcCatalog || lkcCatalog.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #64748b; padding: 1.5rem;">Загрузка справочника нормативов...</td></tr>';
        return;
    }

    lkcCatalog.forEach((item, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align: center; font-weight: 700; color: #64748b;">${idx + 1}</td>
            <td style="font-weight: 600; color: #0f172a;">${escapeHtml(item.name)}</td>
            <td><span style="background: #f1f5f9; padding: 2px 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; color: #334155;">${escapeHtml(item.product_type)}</span></td>
            <td style="text-align: center; font-weight: 700; color: #0369a1; background: #f0f9ff;">${item.norm_t} шт</td>
            <td style="text-align: center; font-weight: 700; color: #0369a1; background: #f0f9ff;">${item.norm_l} шт</td>
            <td style="text-align: center; font-weight: 700; color: #0369a1; background: #f0f9ff;">${item.norm_screws} шт</td>
            <td style="text-align: center; font-weight: 700; color: #0369a1; background: #f0f9ff;">${item.norm_strips || 0} шт</td>
            <td style="text-align: center; font-weight: 700; color: #15803d;">${item.plan_default || (item.product_type === 'Комплект грядок' ? 'Заказ' : 750)}</td>
            <td style="color: #475569; font-size: 0.82rem;">${escapeHtml(item.description || '')}</td>
        `;
        tbody.appendChild(tr);
    });
}

function calculateTheoreticalDemand() {
    let normSheets6 = 0;
    let normSheets8 = 0;
    let normSheets10 = 0;
    let normStripsTotal = 0;

    document.querySelectorAll('.lkc-item-row').forEach(tr => {
        const dim = (tr.querySelector('.item-dimension')?.value || '').toLowerCase();
        const fact = parseInt(tr.querySelector('.item-fact')?.value, 10) || 0;
        const sets = parseInt(tr.querySelector('.item-sets')?.value, 10) || 0;
        const strips = parseInt(tr.querySelector('.item-strips')?.value, 10) || 0;
        const isBed = dim.includes('гряд') || dim.includes('3600') || dim.includes('2700') || dim.includes('1800х900');

        let th = '8';
        if (dim.includes('6мм') || dim.includes('6 мм')) th = '6';
        else if (dim.includes('10мм') || dim.includes('10 мм')) th = '10';

        if (isBed) {
            normStripsTotal += strips;
            // 1 лист 1800х1200 дает 5 полос 1800х240 для грядки (высота 240 мм по чертежу)
            const sheets = strips / 5.0;
            if (th === '6') normSheets6 += sheets;
            else if (th === '10') normSheets10 += sheets;
            else normSheets8 += sheets;
        } else {
            let ratio = 4.0;
            if (dim.includes('400')) ratio = 3.0;
            else if (dim.includes('240')) ratio = 5.0;
            else if (dim.includes('200')) ratio = 6.0;
            else if (dim.includes('300')) ratio = 4.0;

            const sheets = ratio > 0 ? (fact / ratio) : 0;
            if (th === '6') normSheets6 += sheets;
            else if (th === '10') normSheets10 += sheets;
            else normSheets8 += sheets;
        }
    });

    return {
        normSheets6: Math.round(normSheets6 * 10) / 10,
        normSheets8: Math.round(normSheets8 * 10) / 10,
        normSheets10: Math.round(normSheets10 * 10) / 10,
        normSheetsTotal: Math.round((normSheets6 + normSheets8 + normSheets10) * 10) / 10,
        normStripsTotal: normStripsTotal
    };
}

function applyTheoreticalRawDemand() {
    const demand = calculateTheoreticalDemand();
    const totalSheets = Math.ceil(demand.normSheetsTotal);

    if (totalSheets <= 0) {
        showToast('info', 'В рапорте пока нет факта выпуска продукции для расчета норм расхода');
        return;
    }

    const rawTbody = document.getElementById('lkc-raw-tbody');
    if (!rawTbody) return;

    rawTbody.innerHTML = '';

    if (demand.normSheets6 > 0) {
        addLKCRawMaterialRow({
            material_name: 'Плоский лист 6мм 1800х1200',
            spent_qty: Math.ceil(demand.normSheets6),
            warehouse_submitted_qty: Math.ceil(demand.normSheets6),
            scrap_defect_qty: 0,
            notes: 'По норме раскроя (6мм)'
        });
    }

    if (demand.normSheets8 > 0 || (demand.normSheets6 === 0 && demand.normSheets10 === 0)) {
        const qty = demand.normSheets8 > 0 ? Math.ceil(demand.normSheets8) : totalSheets;
        addLKCRawMaterialRow({
            material_name: 'Плоский лист 8мм 1800х1200',
            spent_qty: qty,
            warehouse_submitted_qty: qty,
            scrap_defect_qty: 0,
            notes: 'По норме раскроя (8мм)'
        });
    }

    if (demand.normSheets10 > 0) {
        addLKCRawMaterialRow({
            material_name: 'Плоский лист 10мм 1800х1200',
            spent_qty: Math.ceil(demand.normSheets10),
            warehouse_submitted_qty: Math.ceil(demand.normSheets10),
            scrap_defect_qty: 0,
            notes: 'По норме раскроя (10мм)'
        });
    }

    calculateLKCTotals();
    showToast('success', `Применены нормы расхода сырья: ${totalSheets} листов`);
}

function calculateLKCTotals() {
    const itemRows = document.querySelectorAll('.lkc-item-row');
    let totalPlan = 0;
    let totalFact = 0;
    let totalSets = 0;
    let totalT = 0;
    let totalL = 0;
    let totalScrews = 0;
    let totalStrips = 0;

    itemRows.forEach(tr => {
        const plan = parseInt(tr.querySelector('.item-plan')?.value, 10) || 0;
        const fact = parseInt(tr.querySelector('.item-fact')?.value, 10) || 0;
        const sets = parseInt(tr.querySelector('.item-sets')?.value, 10) || 0;
        const t = parseInt(tr.querySelector('.item-t')?.value, 10) || 0;
        const l = parseInt(tr.querySelector('.item-l')?.value, 10) || 0;
        const screws = parseInt(tr.querySelector('.item-screws')?.value, 10) || 0;
        const strips = parseInt(tr.querySelector('.item-strips')?.value, 10) || 0;

        totalPlan += plan;
        totalFact += fact;
        totalSets += sets;
        totalT += t;
        totalL += l;
        totalScrews += screws;
        totalStrips += strips;
    });

    const rawRows = document.querySelectorAll('.lkc-raw-row');
    let totalSpent = 0;
    let totalSubmitted = 0;
    let totalScrap = 0;

    rawRows.forEach(tr => {
        const spent = parseInt(tr.querySelector('.raw-spent')?.value, 10) || 0;
        const sub = parseInt(tr.querySelector('.raw-submitted')?.value, 10) || 0;
        const scrap = parseInt(tr.querySelector('.raw-scrap')?.value, 10) || 0;

        totalSpent += spent;
        totalSubmitted += sub;
        totalScrap += scrap;
    });

    const elSpent = document.getElementById('raw-total-spent');
    if (elSpent) elSpent.innerText = totalSpent;

    const elSub = document.getElementById('raw-total-submitted');
    if (elSub) elSub.innerText = totalSubmitted;

    const elScrap = document.getElementById('raw-total-scrap');
    if (elScrap) elScrap.innerText = totalScrap;

    // Расчет материального баланса
    const demand = calculateTheoreticalDemand();
    const normTotalEl = document.getElementById('bal-norm-total');
    if (normTotalEl) normTotalEl.innerText = demand.normSheetsTotal;

    const norm6El = document.getElementById('bal-norm-6');
    if (norm6El) norm6El.innerText = demand.normSheets6;

    const norm8El = document.getElementById('bal-norm-8');
    if (norm8El) norm8El.innerText = demand.normSheets8;

    const norm10El = document.getElementById('bal-norm-10');
    if (norm10El) norm10El.innerText = demand.normSheets10;

    const balanceDiff = Math.round((totalSpent - (totalSubmitted + totalScrap)) * 100) / 100;
    const diffBadge = document.getElementById('balance-badge-diff');
    const diffValEl = document.getElementById('bal-diff-val');
    if (diffValEl) diffValEl.innerText = balanceDiff === 0 ? '0 (Баланс сошелся)' : (balanceDiff > 0 ? `+${balanceDiff}` : `${balanceDiff}`);
    if (diffBadge) {
        if (totalSpent === 0 && totalSubmitted === 0 && totalScrap === 0) {
            diffBadge.style.background = '#f1f5f9';
            diffBadge.style.color = '#475569';
        } else if (balanceDiff === 0) {
            diffBadge.style.background = '#dcfce7';
            diffBadge.style.color = '#15803d';
        } else {
            diffBadge.style.background = '#fef2f2';
            diffBadge.style.color = '#dc2626';
        }
    }

    const kis = totalSpent > 0 ? (totalSubmitted / totalSpent * 100).toFixed(1) : '0.0';
    const scrapPct = totalSpent > 0 ? (totalScrap / totalSpent * 100).toFixed(1) : '0.0';

    const kisEl = document.getElementById('bal-kis-val');
    if (kisEl) kisEl.innerText = kis;

    const defectEl = document.getElementById('bal-defect-val');
    if (defectEl) defectEl.innerText = scrapPct;

    // Save active draft
    if (currentSelectedDate) {
        saveDraft(currentSelectedDate, collectFormData());
    }
}

// --- COLLECT DATA & SAVE ---
function collectFormData() {
    const reportDate = currentSelectedDate || getTodayDateStr();
    const shiftName = document.getElementById('report-shift-select')?.value || 'День';
    const masterName = document.getElementById('report-master-select')?.value || 'Миркасимов И.М.';

    const items = [];
    document.querySelectorAll('.lkc-item-row').forEach((tr, idx) => {
        const dim = tr.querySelector('.item-dimension')?.value.trim();
        if (!dim) return;

        const orderText = tr.querySelector('.item-order')?.value.trim() || '';

        items.push({
            item_order: idx + 1,
            dimension_size: dim,
            plan_qty: parseInt(tr.querySelector('.item-plan')?.value, 10) || 0,
            fact_qty: parseInt(tr.querySelector('.item-fact')?.value, 10) || 0,
            fact_unit: 'шт',
            order_batch: orderText,
            order_number: orderText,
            sets_count: parseInt(tr.querySelector('.item-sets')?.value, 10) || 0,
            comp_t_count: parseInt(tr.querySelector('.item-t')?.value, 10) || 0,
            comp_l_count: parseInt(tr.querySelector('.item-l')?.value, 10) || 0,
            comp_screws_count: parseInt(tr.querySelector('.item-screws')?.value, 10) || 0,
            comp_strips_count: parseInt(tr.querySelector('.item-strips')?.value, 10) || 0
        });
    });

    const rawMaterials = [];
    let totalSpent = 0;
    let totalSubmitted = 0;
    let totalScrap = 0;

    document.querySelectorAll('.lkc-raw-row').forEach((tr, idx) => {
        const mat = tr.querySelector('.raw-material-name')?.value.trim();
        const spent = parseInt(tr.querySelector('.raw-spent')?.value, 10) || 0;
        const sub = parseInt(tr.querySelector('.raw-submitted')?.value, 10) || 0;
        const scrap = parseInt(tr.querySelector('.raw-scrap')?.value, 10) || 0;
        const notes = tr.querySelector('.raw-notes')?.value.trim() || '';

        totalSpent += spent;
        totalSubmitted += sub;
        totalScrap += scrap;

        rawMaterials.push({
            item_order: idx + 1,
            material_name: mat || 'Плоский лист 8мм 1800х1200',
            thickness: mat.includes('6мм') ? '6 мм' : (mat.includes('10мм') ? '10 мм' : '8 мм'),
            spent_qty: spent,
            unit: 'шт',
            warehouse_submitted_qty: sub,
            scrap_defect_qty: scrap,
            notes: notes
        });
    });

    return {
        id: currentReportId,
        report_date: reportDate,
        shift_name: shiftName,
        master_name: masterName,
        status: 'completed',
        raw_sheets_thickness: rawMaterials[0]?.thickness || '8 мм',
        raw_sheets_spent: totalSpent,
        warehouse_submitted_qty: totalSubmitted,
        scrap_defect_qty: totalScrap,
        notes: '',
        items: items,
        raw_materials: rawMaterials
    };
}

async function saveLKCReport() {
    const btn = document.getElementById('btn-save-report');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Сохранение...';
    }

    const payload = collectFormData();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
        const resp = await fetch('/api/lkc/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || 'Ошибка сервера при сохранении');
        }

        const savedData = await resp.json();
        currentReportId = savedData.id;
        clearDraft(payload.report_date);

        showNotification(
            'success',
            'Рапорт смены сохранен!',
            `Смена «${payload.shift_name}» за ${formatDateRu(payload.report_date)} успешно записана в базу Tectum.\nМастер: ${payload.master_name}\nСтрок продукции: ${payload.items.length}\nСдано на склад: ${payload.warehouse_submitted_qty} шт`
        );
        showToast('success', `Рапорт сохранен в БД`);
    } catch (e) {
        console.error('Save error:', e);
        showNotification(
            'error',
            'Ошибка сохранения',
            `${e.message || 'Сбой сети'}.\nЧерновик надежно сохранен в локальной памяти браузера.`
        );
        showToast('error', `Ошибка: ${e.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> СОХРАНИТЬ РАПОРТ СМЕНЫ';
        }
    }
}

function resetLKCReportForm() {
    if (confirm('Очистить форму и сбросить все введенные строки?')) {
        initEmptyReportForm();
        if (currentSelectedDate) clearDraft(currentSelectedDate);
        showToast('info', 'Форма очищена');
    }
}

// --- DOWNTIMES LOG ---
async function loadLKCDowntimes() {
    const tbody = document.getElementById('lkc-downtimes-tbody');
    if (!tbody) return;

    try {
        const resp = await fetch('/api/lkc/downtimes');
        if (!resp.ok) return;

        const list = await resp.json();
        if (!list || list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#94a3b8; padding:1.5rem;">Нет зафиксированных простоев</td></tr>';
            return;
        }

        tbody.innerHTML = list.map(dt => `
            <tr>
                <td><strong>${formatDateRu(dt.downtime_date)}</strong></td>
                <td>${dt.start_time} - ${dt.end_time || '--'}</td>
                <td><span style="font-weight:700; color:var(--lkc-primary);">${dt.duration_minutes} мин</span></td>
                <td>${escapeHtml(dt.equipment_node)}</td>
                <td><span class="badge" style="background:#f1f5f9; padding:3px 8px; border-radius:6px;">${escapeHtml(dt.category)}</span></td>
                <td>${escapeHtml(dt.reason || dt.comment || '--')}</td>
                <td>${escapeHtml(dt.master_name || 'Миркасимов И.М.')}</td>
                <td style="text-align: center;">
                    <button class="lkc-btn-danger" onclick="deleteLKCDowntime(${dt.id})" title="Удалить"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Error loading downtimes:', e);
    }
}

async function addLKCDowntimeRecord() {
    const startTime = document.getElementById('dt-start-time')?.value || '09:00';
    const endTime = document.getElementById('dt-end-time')?.value || '';
    const node = document.getElementById('dt-node-select')?.value || 'Дисковая пила раскроя';
    const category = document.getElementById('dt-category-select')?.value || 'Механическая';
    const reason = document.getElementById('dt-reason-input')?.value.trim() || '';

    let durationMin = 0;
    if (startTime && endTime) {
        const [h1, m1] = startTime.split(':').map(Number);
        const [h2, m2] = endTime.split(':').map(Number);
        durationMin = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (durationMin < 0) durationMin += 24 * 60;
    }

    const currentShift = document.getElementById('report-shift-select')?.value || 'День';
    const payload = {
        downtime_date: currentSelectedDate || getTodayDateStr(),
        shift_name: currentShift,
        master_name: document.getElementById('report-master-select')?.value || 'Миркасимов И.М.',
        start_time: startTime,
        end_time: endTime,
        duration_minutes: durationMin,
        equipment_node: node,
        category: category,
        reason: reason,
        comment: ''
    };

    try {
        const resp = await fetch('/api/lkc/downtimes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (resp.ok) {
            showNotification(
                'success',
                'Простой зафиксирован!',
                `Узел: ${node}\nКатегория: ${category}\nВремя: ${startTime} - ${endTime || 'по н.в.'} (${durationMin} мин)\nПричина: ${reason || 'Не указана'}`
            );
            showToast('success', 'Простой успешно зафиксирован в журнале');
            document.getElementById('dt-reason-input').value = '';
            loadLKCDowntimes();
        } else {
            const err = await resp.json().catch(() => ({}));
            showNotification('error', 'Ошибка фиксации простоя', err.detail || 'Не удалось сохранить запись простоя');
            showToast('error', 'Ошибка фиксации простоя');
        }
    } catch (e) {
        showNotification('error', 'Сетевой сбой', e.message || 'Ошибка сети');
        showToast('error', `Сетевой сбой: ${e.message}`);
    }
}

async function deleteLKCDowntime(dtId) {
    if (!confirm('Удалить эту запись простоя?')) return;
    try {
        const resp = await fetch(`/api/lkc/downtimes/${dtId}`, { method: 'DELETE' });
        if (resp.ok) {
            showToast('info', 'Запись простоя удалена');
            loadLKCDowntimes();
        }
    } catch (e) {
        showToast('error', 'Ошибка удаления');
    }
}

// --- WEEKLY SUMMARY & ARCHIVE ---
function getMonday(d) {
    d = new Date(d);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

function shiftLKCWeek(offsetDelta) {
    currentWeekOffset += offsetDelta;
    loadLKCWeeklySummary();
}

async function loadLKCWeeklySummary() {
    const tbody = document.getElementById('lkc-weekly-summary-tbody');
    const periodDisplay = document.getElementById('weekly-period-display');
    if (!tbody) return;

    const baseMonday = getMonday(new Date());
    baseMonday.setDate(baseMonday.getDate() + (currentWeekOffset * 7));

    const sunday = new Date(baseMonday);
    sunday.setDate(sunday.getDate() + 6);

    const startStr = baseMonday.toISOString().split('T')[0];
    const endStr = sunday.toISOString().split('T')[0];

    if (periodDisplay) {
        periodDisplay.innerText = `Неделя: ${formatDateRu(startStr)} — ${formatDateRu(endStr)}`;
    }

    try {
        const resp = await fetch(`/api/lkc/reports?start_date=${startStr}&end_date=${endStr}&limit=50`);
        if (!resp.ok) return;

        const reports = await resp.json();
        
        let rowsHtml = '';
        let rowCount = 1;

        for (let i = 0; i < 7; i++) {
            const currDate = new Date(baseMonday);
            currDate.setDate(currDate.getDate() + i);
            const iso = currDate.toISOString().split('T')[0];
            const ru = formatDateRu(iso);

            const dayRep = (reports || []).find(r => r.report_date === iso);

            if (dayRep && dayRep.items && dayRep.items.length > 0) {
                dayRep.items.forEach(item => {
                    rowsHtml += `
                        <tr>
                            <td style="text-align:center;">${rowCount++}</td>
                            <td><strong>${ru}</strong></td>
                            <td>${escapeHtml(dayRep.master_name || 'Миркасимов И.М.')}</td>
                            <td>${escapeHtml(item.dimension_size)}</td>
                            <td style="text-align:right;">${item.plan_qty || 0}</td>
                            <td style="text-align:right; font-weight:700;">${item.fact_qty || 0}</td>
                            <td>${escapeHtml(item.order_number || item.order_batch || '')}</td>
                            <td style="text-align:right;">${item.sets_count || 0}</td>
                            <td style="text-align:right; background:#f0f9ff;">${item.comp_t_count || 0}</td>
                            <td style="text-align:right; background:#f0f9ff;">${item.comp_l_count || 0}</td>
                            <td style="text-align:right; background:#f0f9ff;">${item.comp_screws_count || 0}</td>
                            <td style="text-align:right; background:#f0f9ff;">${item.comp_strips_count || 0}</td>
                            <td style="text-align:right;">${item.warehouse_submitted_qty || dayRep.warehouse_submitted_qty || 0}</td>
                            <td>${escapeHtml(item.notes || dayRep.notes || '')}</td>
                            <td style="text-align:center;">
                                <button class="lkc-btn-secondary" style="padding:2px 8px; font-size:0.75rem;" onclick="openReportDate('${iso}')">Открыть</button>
                            </td>
                        </tr>
                    `;
                });
            } else {
                rowsHtml += `
                    <tr style="opacity:0.6;">
                        <td style="text-align:center;">${rowCount++}</td>
                        <td>${ru}</td>
                        <td>Миркасимов И.М.</td>
                        <td>--</td>
                        <td style="text-align:right;">750</td>
                        <td style="text-align:right;">0</td>
                        <td>--</td>
                        <td style="text-align:right;">0</td>
                        <td style="text-align:right; background:#f0f9ff;">0</td>
                        <td style="text-align:right; background:#f0f9ff;">0</td>
                        <td style="text-align:right; background:#f0f9ff;">0</td>
                        <td style="text-align:right; background:#f0f9ff;">0</td>
                        <td style="text-align:right;">0</td>
                        <td>--</td>
                        <td style="text-align:center;">
                            <button class="lkc-btn-secondary" style="padding:2px 8px; font-size:0.75rem;" onclick="openReportDate('${iso}')">Создать</button>
                        </td>
                    </tr>
                `;
            }
        }

        tbody.innerHTML = rowsHtml;
    } catch (e) {
        console.error('Error loading weekly summary:', e);
    }
}

function openReportDate(isoDate) {
    switchLKCTab('report');
    const input = document.getElementById('report-date-input');
    if (input && input._flatpickr) {
        input._flatpickr.setDate(isoDate, true);
    } else {
        loadReportForDate(isoDate);
    }
}

function downloadLKCExcel() {
    const baseMonday = getMonday(new Date());
    baseMonday.setDate(baseMonday.getDate() + (currentWeekOffset * 7));

    const sunday = new Date(baseMonday);
    sunday.setDate(sunday.getDate() + 6);

    const startStr = baseMonday.toISOString().split('T')[0];
    const endStr = sunday.toISOString().split('T')[0];

    window.location.href = `/api/lkc/export_excel?start_date=${startStr}&end_date=${endStr}`;
}

async function syncLKCGoogleSheets(btn) {
    if (!btn) btn = document.getElementById('btn-sync-lkc-sheets');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Выгрузка в Google...';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
        const resp = await fetch('/api/lkc/sync_google_sheets', {
            method: 'POST',
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || `Ошибка сервера: ${resp.status}`);
        }

        const data = await resp.json();
        showToast('success', 'Данные успешно выгружены в Google Таблицу ЛКЦ (3 листа: Производство, Простои, Сдано на склад)!');

        if (data.url) {
            const link = document.getElementById('link-lkc-sheets');
            if (link) link.href = data.url;
        }
    } catch (e) {
        console.error('LKC Google Sheets sync error:', e);
        showToast('error', `Ошибка выгрузки: ${e.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml || '<i class="fa-solid fa-arrows-rotate" style="color: #2563eb;"></i> Выгрузить в Google Таблицу';
        }
    }
}

// --- LOCAL STORAGE DRAFT MANAGEMENT ---
function saveDraft(dateStr, data) {
    try {
        localStorage.setItem(`lkc_draft_${dateStr}`, JSON.stringify(data));
    } catch (e) {}
}

function loadDraft(dateStr) {
    try {
        const raw = localStorage.getItem(`lkc_draft_${dateStr}`);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function clearDraft(dateStr) {
    try {
        localStorage.removeItem(`lkc_draft_${dateStr}`);
    } catch (e) {}
}

// --- UTILS & TOASTS ---
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showToast(type, text) {
    const container = document.getElementById('lkc-toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `lkc-toast ${type}`;

    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <span>${escapeHtml(text)}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// --- UNIVERSAL NOTIFICATION MODAL (КАК В БОЕВОМ РАПОРТЕ) ---
function showNotification(type, title, message) {
    const modal = document.getElementById('universal-notification-modal');
    const overlay = document.getElementById('universal-notification-overlay');
    const iconContainer = document.getElementById('unm-icon');
    const iconText = document.getElementById('unm-icon-text');
    const titleEl = document.getElementById('unm-title');
    const messageEl = document.getElementById('unm-message');
    const btn = document.getElementById('unm-btn');

    if (!modal || !overlay) {
        showToast(type, `${title}: ${message}`);
        return;
    }

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
    } else {
        iconContainer.style.background = 'rgba(59, 130, 246, 0.2)';
        iconContainer.style.border = '2px solid #3b82f6';
        iconText.style.color = '#3b82f6';
        iconText.innerHTML = 'ℹ';
        btn.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)';
        btn.style.boxShadow = '0 8px 20px rgba(59, 130, 246, 0.3)';
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

// --- NORMS TAB TABLE RENDERING ---
function renderLKCNormsTable() {
    const tbody = document.getElementById('lkc-norms-tbody');
    if (!tbody) return;
    const list = (lkcCatalog && lkcCatalog.length > 0) ? lkcCatalog : [
        { id: 'strip_1800_300_6', name: 'Полоса плоская 6мм 1800х300', product_type: 'Плоская полоса', norm_t: 0, norm_l: 0, norm_screws: 0, plan_default: 750, description: 'Нарезка полос из листа 6мм 1800х1200 (4 полосы с 1 листа)' },
        { id: 'strip_1800_300_8', name: 'Полоса плоская 8мм 1800х300', product_type: 'Плоская полоса', norm_t: 0, norm_l: 0, norm_screws: 0, plan_default: 750, description: 'Нарезка полос из листа 8мм 1800х1200 (4 полосы с 1 листа)' },
        { id: 'sheet_1800_1200_6', name: 'Плоский лист 6мм 1800х1200', product_type: 'Плоский лист', norm_t: 0, norm_l: 0, norm_screws: 0, plan_default: 750, description: 'Плоский хризотилцементный лист 6 мм. Сменный план: 750 шт' },
        { id: 'sheet_1800_1200_8', name: 'Плоский лист 8мм 1800х1200', product_type: 'Плоский лист', norm_t: 0, norm_l: 0, norm_screws: 0, plan_default: 750, description: 'Базовый плоский хризотилцементный лист 8 мм. Сменный план: 750 шт' },
        { id: 'bed_3600', name: 'Грядка 3.6 м (3600х900)', product_type: 'Комплект грядок', norm_t: 2.0, norm_l: 4.0, norm_screws: 24, plan_default: 0, description: '2 продольных борта (1800+1800) + 2 торца 900х245. Расход: Т-профиль 2 шт, L-уголок 4 шт, Шурупы 24 шт' },
        { id: 'bed_2700', name: 'Грядка 2.7 м (2700х900)', product_type: 'Комплект грядок', norm_t: 2.0, norm_l: 4.0, norm_screws: 24, plan_default: 0, description: '2 борта (1800+900) + 2 торца 900х245. Расход: Т-профиль 2 шт, L-уголок 4 шт, Шурупы 24 шт' },
        { id: 'bed_1800', name: 'Грядка 1.8 м (1800х900)', product_type: 'Комплект грядок', norm_t: 0.0, norm_l: 4.0, norm_screws: 16, plan_default: 0, description: '2 борта 1800х245 + 2 торца 900х245. Расход: Т-профиль 0 шт, L-уголок 4 шт, Шурупы 16 шт' }
    ];

    tbody.innerHTML = list.map((item, idx) => {
        const isBed = (item.product_type && item.product_type.includes('гряд')) || (item.id && item.id.startsWith('bed_')) || item.name.toLowerCase().includes('грядка');
        const planText = isBed ? '— (без плана)' : `${item.plan_default || 750} шт`;
        return `
        <tr>
            <td style="text-align: center; font-weight: 700; color: #64748b;">${idx + 1}</td>
            <td style="font-weight: 700; color: #0f172a;">${escapeHtml(item.name)}</td>
            <td><span class="badge" style="background: #e2e8f0; color: #334155; padding: 3px 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600;">${escapeHtml(item.product_type || 'Изделие')}</span></td>
            <td style="text-align: center; font-weight: 700; color: ${item.norm_t > 0 ? '#0284c7' : '#94a3b8'};">${item.norm_t > 0 ? item.norm_t + ' шт' : '0 шт'}</td>
            <td style="text-align: center; font-weight: 700; color: ${item.norm_l > 0 ? '#0284c7' : '#94a3b8'};">${item.norm_l > 0 ? item.norm_l + ' шт' : '0 шт'}</td>
            <td style="text-align: center; font-weight: 700; color: ${item.norm_screws > 0 ? '#0284c7' : '#94a3b8'};">${item.norm_screws > 0 ? item.norm_screws + ' шт' : '0 шт'}</td>
            <td style="text-align: center; font-weight: 700; color: ${isBed ? '#64748b' : '#16a34a'};">${planText}</td>
            <td style="font-size: 0.85rem; color: #475569;">${escapeHtml(item.description || '--')}</td>
        </tr>
    `;
    }).join('');
}

