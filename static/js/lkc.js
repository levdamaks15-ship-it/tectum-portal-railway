// =======================================================
// TECTUM ENGINEERING — КАБИНЕТ МАСТЕРА ЛКЦ (JS ENGINE)
// =======================================================

let lkcCatalog = [];
let currentReportId = null;
let currentSelectedDate = null;
let currentWeekOffset = 0; // 0 = current week

// --- PREVENT WHEEL SCROLL VALUE CHANGES ON NUMBER INPUTS ---
document.addEventListener('wheel', function(e) {
    if (document.activeElement && document.activeElement.type === 'number') {
        document.activeElement.blur();
    }
}, { passive: true });

document.addEventListener('DOMContentLoaded', async () => {
    initDatePicker();
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
                const userEl = document.getElementById('lkc-user-name');
                if (userEl) userEl.innerText = data.user.name || 'Миркасимов И.М.';
                
                const masterSelect = document.getElementById('report-master-select');
                if (masterSelect && data.user.name) {
                    let optExists = Array.from(masterSelect.options).some(o => o.value === data.user.name);
                    if (!optExists) {
                        const opt = document.createElement('option');
                        opt.value = data.user.name;
                        opt.innerText = data.user.name;
                        masterSelect.appendChild(opt);
                    }
                    masterSelect.value = data.user.name;
                }
            }
        }
    } catch (e) {
        console.warn('Auth check error:', e);
    }
}

async function logoutLKC() {
    try {
        await fetch('/api/logout', { method: 'POST' });
    } catch (e) {}
    window.location.href = '/';
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
async function loadReportForDate(isoDate) {
    currentSelectedDate = isoDate;
    const shiftName = document.getElementById('report-shift-select')?.value || 'Дневная смена (08:00 - 17:00)';

    try {
        const resp = await fetch(`/api/lkc/reports/by_date?report_date=${isoDate}&shift_name=${encodeURIComponent(shiftName)}`);
        if (resp.ok) {
            const report = await resp.json();
            if (report) {
                populateReportForm(report);
                showToast('info', `Загружен рапорт за ${formatDateRu(isoDate)}`);
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

    // Default 1 product item row
    addLKCItemRow({
        dimension_size: 'пл. лист 6мм 1800х300',
        plan_qty: 750,
        fact_qty: '',
        order_batch: 'грядки',
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

// Catalog options helper
function getCatalogOptionsHTML(selectedDim = '') {
    if (!lkcCatalog || lkcCatalog.length === 0) {
        const fallback = [
            { name: 'Полоса плоская 6мм 1800х300', dim: 'пл. лист 6мм 1800х300' },
            { name: 'Полоса плоская 8мм 1800х300', dim: 'пл. лист 8мм 1800х300' },
            { name: 'Плоский лист 6мм 1800х1200', dim: 'пл. лист 6мм 1800х1200' },
            { name: 'Плоский лист 8мм 1800х1200', dim: 'пл. лист 8мм 1800х1200' },
            { name: 'Грядка 3.6 м (3600х900)', dim: 'грядка 3600х900' },
            { name: 'Грядка 2.7 м (2700х900)', dim: 'грядка 2700х900' },
            { name: 'Грядка 1.8 м (1800х900)', dim: 'грядка 1800х900' }
        ];
        return fallback.map(item => {
            const isSel = (item.dim === selectedDim || item.name === selectedDim) ? 'selected' : '';
            return `<option value="${escapeHtml(item.dim)}" ${isSel}>${escapeHtml(item.name)}</option>`;
        }).join('');
    }

    return lkcCatalog.map(c => {
        const isSel = (c.dimension_size === selectedDim || c.name === selectedDim) ? 'selected' : '';
        return `<option value="${escapeHtml(c.dimension_size || c.name)}" data-t="${c.norm_t}" data-l="${c.norm_l}" data-s="${c.norm_screws}" data-plan="${c.plan_default || 750}" ${isSel}>${escapeHtml(c.name)}</option>`;
    }).join('');
}

function addLKCItemRow(data = {}) {
    const tbody = document.getElementById('lkc-items-tbody');
    if (!tbody) return;
    const rowIdx = tbody.children.length + 1;
    const tr = document.createElement('tr');
    tr.className = 'lkc-item-row';

    const dimSize = data.dimension_size || 'пл. лист 6мм 1800х300';
    const planQty = data.plan_qty !== undefined && data.plan_qty !== '' ? Math.round(Number(data.plan_qty)) : 750;
    const factQty = data.fact_qty !== undefined && data.fact_qty !== '' ? Math.round(Number(data.fact_qty)) : '';
    const orderBatch = data.order_batch || 'грядки';
    const setsCount = data.sets_count !== undefined && data.sets_count !== '' ? Math.round(Number(data.sets_count)) : '';
    const compT = data.comp_t_count !== undefined && data.comp_t_count !== '' ? Math.round(Number(data.comp_t_count)) : '';
    const compL = data.comp_l_count !== undefined && data.comp_l_count !== '' ? Math.round(Number(data.comp_l_count)) : '';
    const compScrews = data.comp_screws_count !== undefined && data.comp_screws_count !== '' ? Math.round(Number(data.comp_screws_count)) : '';

    tr.innerHTML = `
        <td class="cell-header" data-label="№">
            <span class="mobile-row-title"><i class="fa-solid fa-layer-group" style="color:var(--lkc-primary);"></i> Строка №<span class="row-num">${rowIdx}</span></span>
            <button type="button" class="lkc-btn-danger mobile-only" onclick="removeLKCItemRow(this)" title="Удалить строку" style="height: 32px; width: 32px; font-size: 0.85rem; border-radius: 8px;">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </td>
        <td class="cell-dim" data-label="Размер / Типоразмер">
            <select class="item-dimension" onchange="onDimensionSelectChange(this)" style="font-weight: 600; color: #0f172a; height: 42px; font-size: 0.92rem;">
                ${getCatalogOptionsHTML(dimSize)}
            </select>
        </td>
        <td class="cell-plan" data-label="План (шт)">
            <input type="number" step="1" class="item-plan" value="${planQty}" readonly style="background: #f8fafc; color: #475569; font-weight: 700; text-align: center; height: 42px; font-size: 0.95rem;">
        </td>
        <td class="cell-fact" data-label="Факт (шт)">
            <input type="number" step="1" class="item-fact" value="${factQty}" placeholder="0" min="0" onwheel="this.blur()" oninput="calculateLKCTotals()" style="text-align: center; font-weight: 700; color: #0f172a; height: 42px; font-size: 0.95rem;">
        </td>
        <td class="cell-order" data-label="Комплект (Заказ / Партия)">
            <select class="item-order" onchange="calculateLKCTotals()" style="height: 42px; font-size: 0.92rem; font-weight: 600;">
                <option value="грядки" ${orderBatch === 'грядки' ? 'selected' : ''}>грядки</option>
                <option value="Заказ покупателя" ${orderBatch === 'Заказ покупателя' ? 'selected' : ''}>Заказ покупателя</option>
                <option value="Партия на склад" ${orderBatch === 'Партия на склад' ? 'selected' : ''}>Партия на склад</option>
                <option value="Без комплекта" ${orderBatch === 'Без комплекта' ? 'selected' : ''}>Без комплекта</option>
            </select>
        </td>
        <td class="cell-sets" data-label="Кол-во компл.">
            <input type="number" step="1" class="item-sets" value="${setsCount}" placeholder="0" min="0" onwheel="this.blur()" oninput="onSetsCountChange(this)" style="text-align: center; font-weight: 700; height: 42px; font-size: 0.95rem;">
        </td>
        <td class="cell-t" data-label="T (шт)" style="background: #f0f9ff;">
            <input type="number" step="1" class="item-t" value="${compT}" placeholder="0" min="0" onwheel="this.blur()" oninput="calculateLKCTotals()" style="background: #f0f9ff; font-weight: 700; text-align: center; color: #0369a1; height: 42px; font-size: 0.95rem;">
        </td>
        <td class="cell-l" data-label="L (шт)" style="background: #f0f9ff;">
            <input type="number" step="1" class="item-l" value="${compL}" placeholder="0" min="0" onwheel="this.blur()" oninput="calculateLKCTotals()" style="background: #f0f9ff; font-weight: 700; text-align: center; color: #0369a1; height: 42px; font-size: 0.95rem;">
        </td>
        <td class="cell-screws" data-label="Шурупы" style="background: #f0f9ff;">
            <input type="number" step="1" class="item-screws" value="${compScrews}" placeholder="0" min="0" onwheel="this.blur()" oninput="calculateLKCTotals()" style="background: #f0f9ff; font-weight: 700; text-align: center; color: #0369a1; height: 42px; font-size: 0.95rem;">
        </td>
        <td class="cell-action desktop-only" style="text-align: center;">
            <button type="button" class="lkc-btn-danger" onclick="removeLKCItemRow(this)" title="Удалить строку" style="height: 38px; width: 38px; font-size: 0.95rem;">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </td>
    `;

    tbody.appendChild(tr);
    renumberItemRows();
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
        'Полоса 8мм 1800х300',
        'Полоса 6мм 1800х300',
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
            <button type="button" class="lkc-btn-danger mobile-only" onclick="removeLKCRawMaterialRow(this)" title="Удалить строку" style="height: 32px; width: 32px; font-size: 0.85rem; border-radius: 8px;">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </td>
        <td class="cell-mat" data-label="Наименование сырья / Материал">
            <select class="raw-material-name" onchange="calculateLKCTotals()" style="font-weight: 600; color: #0f172a; height: 42px; font-size: 0.92rem;">
                ${getRawMaterialOptionsHTML(matName)}
            </select>
        </td>
        <td class="cell-spent" data-label="Списано (шт)">
            <input type="number" step="1" class="raw-spent" value="${spentQty}" placeholder="0" min="0" onwheel="this.blur()" oninput="calculateLKCTotals()" style="text-align: center; font-weight: 700; color: #1e293b; height: 42px; font-size: 0.95rem;">
        </td>
        <td class="cell-submitted" data-label="Сдано на склад ГП (шт)">
            <input type="number" step="1" class="raw-submitted" value="${whSub}" placeholder="0" min="0" onwheel="this.blur()" oninput="calculateLKCTotals()" style="text-align: center; font-weight: 700; color: #15803d; height: 42px; font-size: 0.95rem;">
        </td>
        <td class="cell-scrap" data-label="Отходы / Брак (шт)">
            <input type="number" step="1" class="raw-scrap" value="${scrapQty}" placeholder="0" min="0" onwheel="this.blur()" oninput="calculateLKCTotals()" style="text-align: center; font-weight: 700; color: #dc2626; height: 42px; font-size: 0.95rem;">
        </td>
        <td class="cell-notes" data-label="Примечание / Партия">
            <input type="text" class="raw-notes" value="${escapeHtml(notes)}" placeholder="Партия / примечание" style="height: 42px; font-size: 0.92rem;">
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
    const dimVal = selectEl.value;
    const catItem = lkcCatalog.find(c => c.dimension_size === dimVal || c.name === dimVal);

    const planInput = tr.querySelector('.item-plan');
    if (planInput) {
        planInput.value = catItem?.plan_default !== undefined ? catItem.plan_default : 750;
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
    if (catItem && (catItem.norm_t > 0 || catItem.norm_l > 0 || catItem.norm_screws > 0)) {
        tr.querySelector('.item-t').value = sets > 0 ? Math.round(catItem.norm_t * sets) : 0;
        tr.querySelector('.item-l').value = sets > 0 ? Math.round(catItem.norm_l * sets) : 0;
        tr.querySelector('.item-screws').value = sets > 0 ? Math.round(catItem.norm_screws * sets) : 0;
    } else {
        // Fallback rule by dimension text
        const dimLower = dimVal.toLowerCase();
        if (dimLower.includes('3.6') || dimLower.includes('3600')) {
            tr.querySelector('.item-t').value = sets > 0 ? (sets * 2) : 0;
            tr.querySelector('.item-l').value = sets > 0 ? (sets * 4) : 0;
            tr.querySelector('.item-screws').value = sets > 0 ? (sets * 24) : 0;
        } else if (dimLower.includes('2.7') || dimLower.includes('2700')) {
            tr.querySelector('.item-t').value = sets > 0 ? (sets * 2) : 0;
            tr.querySelector('.item-l').value = sets > 0 ? (sets * 4) : 0;
            tr.querySelector('.item-screws').value = sets > 0 ? (sets * 24) : 0;
        } else if (dimLower.includes('1.8') || dimLower.includes('1800') || dimLower.includes('грядка')) {
            tr.querySelector('.item-t').value = 0;
            tr.querySelector('.item-l').value = sets > 0 ? (sets * 4) : 0;
            tr.querySelector('.item-screws').value = sets > 0 ? (sets * 16) : 0;
        } else {
            tr.querySelector('.item-t').value = 0;
            tr.querySelector('.item-l').value = 0;
            tr.querySelector('.item-screws').value = 0;
        }
    }
    calculateLKCTotals();
}

function renderLKCNormsTable() {
    const tbody = document.getElementById('lkc-norms-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!lkcCatalog || lkcCatalog.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #64748b; padding: 1.5rem;">Загрузка справочника нормативов...</td></tr>';
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
            <td style="text-align: center; font-weight: 700; color: #15803d;">${item.plan_default || 750} шт</td>
            <td style="color: #475569; font-size: 0.82rem;">${escapeHtml(item.description || '')}</td>
        `;
        tbody.appendChild(tr);
    });
}

function calculateLKCTotals() {
    const itemRows = document.querySelectorAll('.lkc-item-row');
    let totalFact = 0;
    let totalSets = 0;
    let totalT = 0;
    let totalL = 0;
    let totalScrews = 0;

    itemRows.forEach(tr => {
        const fact = parseInt(tr.querySelector('.item-fact')?.value, 10) || 0;
        const sets = parseInt(tr.querySelector('.item-sets')?.value, 10) || 0;
        const t = parseInt(tr.querySelector('.item-t')?.value, 10) || 0;
        const l = parseInt(tr.querySelector('.item-l')?.value, 10) || 0;
        const screws = parseInt(tr.querySelector('.item-screws')?.value, 10) || 0;

        totalFact += fact;
        totalSets += sets;
        totalT += t;
        totalL += l;
        totalScrews += screws;
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

    // Save active draft
    if (currentSelectedDate) {
        saveDraft(currentSelectedDate, collectFormData());
    }
}

// --- COLLECT DATA & SAVE ---
function collectFormData() {
    const reportDate = currentSelectedDate || getTodayDateStr();
    const shiftName = document.getElementById('report-shift-select')?.value || 'Дневная смена (08:00 - 17:00)';
    const masterName = document.getElementById('report-master-select')?.value || 'Миркасимов И.М.';

    const items = [];
    document.querySelectorAll('.lkc-item-row').forEach((tr, idx) => {
        const dim = tr.querySelector('.item-dimension')?.value.trim();
        if (!dim) return;

        items.push({
            item_order: idx + 1,
            dimension_size: dim,
            plan_qty: parseInt(tr.querySelector('.item-plan')?.value, 10) || 0,
            fact_qty: parseInt(tr.querySelector('.item-fact')?.value, 10) || 0,
            fact_unit: 'шт',
            order_batch: tr.querySelector('.item-order')?.value.trim() || '',
            sets_count: parseInt(tr.querySelector('.item-sets')?.value, 10) || 0,
            comp_t_count: parseInt(tr.querySelector('.item-t')?.value, 10) || 0,
            comp_l_count: parseInt(tr.querySelector('.item-l')?.value, 10) || 0,
            comp_screws_count: parseInt(tr.querySelector('.item-screws')?.value, 10) || 0
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

        showToast('success', `Рапорт смены за ${formatDateRu(payload.report_date)} успешно сохранен!`);
    } catch (e) {
        console.error('Save error:', e);
        showToast('error', `Ошибка сохранения: ${e.message}. Черновик сохранен в памяти браузера.`);
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

    const payload = {
        downtime_date: currentSelectedDate || getTodayDateStr(),
        shift_name: 'Дневная смена',
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
            showToast('success', 'Простой успешно зафиксирован в журнале');
            document.getElementById('dt-reason-input').value = '';
            loadLKCDowntimes();
        } else {
            showToast('error', 'Ошибка фиксации простоя');
        }
    } catch (e) {
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
                            <td>${escapeHtml(item.order_batch || '')}</td>
                            <td style="text-align:right;">${item.sets_count || 0}</td>
                            <td style="text-align:right; background:#f0f9ff;">${item.comp_t_count || 0}</td>
                            <td style="text-align:right; background:#f0f9ff;">${item.comp_l_count || 0}</td>
                            <td style="text-align:right; background:#f0f9ff;">${item.comp_screws_count || 0}</td>
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

// --- NORMS TAB TABLE RENDERING ---
function renderLKCNormsTable() {
    const tbody = document.getElementById('lkc-norms-tbody');
    if (!tbody) return;
    const list = (lkcCatalog && lkcCatalog.length > 0) ? lkcCatalog : [
        { id: 'strip_1800_300_6', name: 'Полоса плоская 6мм 1800х300', product_type: 'Плоская полоса', norm_t: 0, norm_l: 0, norm_screws: 0, plan_default: 750, description: 'Нарезка полос из листа 6мм 1800х1200 (4 полосы с 1 листа)' },
        { id: 'strip_1800_300_8', name: 'Полоса плоская 8мм 1800х300', product_type: 'Плоская полоса', norm_t: 0, norm_l: 0, norm_screws: 0, plan_default: 750, description: 'Нарезка полос из листа 8мм 1800х1200 (4 полосы с 1 листа)' },
        { id: 'sheet_1800_1200_6', name: 'Плоский лист 6мм 1800х1200', product_type: 'Плоский лист', norm_t: 0, norm_l: 0, norm_screws: 0, plan_default: 750, description: 'Плоский хризотилцементный лист 6 мм. Сменный план: 750 шт' },
        { id: 'sheet_1800_1200_8', name: 'Плоский лист 8мм 1800х1200', product_type: 'Плоский лист', norm_t: 0, norm_l: 0, norm_screws: 0, plan_default: 750, description: 'Базовый плоский хризотилцементный лист 8 мм. Сменный план: 750 шт' },
        { id: 'bed_3600', name: 'Грядка 3.6 м (3600х900)', product_type: 'Комплект грядок', norm_t: 2.0, norm_l: 4.0, norm_screws: 24, plan_default: 750, description: '2 продольных борта (1800+1800) + 2 торца 900х245. Расход: Т-профиль 2 шт, L-уголок 4 шт, Шурупы 24 шт' },
        { id: 'bed_2700', name: 'Грядка 2.7 м (2700х900)', product_type: 'Комплект грядок', norm_t: 2.0, norm_l: 4.0, norm_screws: 24, plan_default: 750, description: '2 борта (1800+900) + 2 торца 900х245. Расход: Т-профиль 2 шт, L-уголок 4 шт, Шурупы 24 шт' },
        { id: 'bed_1800', name: 'Грядка 1.8 м (1800х900)', product_type: 'Комплект грядок', norm_t: 0.0, norm_l: 4.0, norm_screws: 16, plan_default: 750, description: '2 борта 1800х245 + 2 торца 900х245. Расход: Т-профиль 0 шт, L-уголок 4 шт, Шурупы 16 шт' }
    ];

    tbody.innerHTML = list.map((item, idx) => `
        <tr>
            <td style="text-align: center; font-weight: 700; color: #64748b;">${idx + 1}</td>
            <td style="font-weight: 700; color: #0f172a;">${escapeHtml(item.name)}</td>
            <td><span class="badge" style="background: #e2e8f0; color: #334155; padding: 3px 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600;">${escapeHtml(item.product_type || 'Изделие')}</span></td>
            <td style="text-align: center; font-weight: 700; color: ${item.norm_t > 0 ? '#0284c7' : '#94a3b8'};">${item.norm_t > 0 ? item.norm_t + ' шт' : '0 шт'}</td>
            <td style="text-align: center; font-weight: 700; color: ${item.norm_l > 0 ? '#0284c7' : '#94a3b8'};">${item.norm_l > 0 ? item.norm_l + ' шт' : '0 шт'}</td>
            <td style="text-align: center; font-weight: 700; color: ${item.norm_screws > 0 ? '#0284c7' : '#94a3b8'};">${item.norm_screws > 0 ? item.norm_screws + ' шт' : '0 шт'}</td>
            <td style="text-align: center; font-weight: 700; color: #16a34a;">${item.plan_default || 750} шт</td>
            <td style="font-size: 0.85rem; color: #475569;">${escapeHtml(item.description || '--')}</td>
        </tr>
    `).join('');
}

