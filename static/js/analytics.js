let allDowntimes = [];
let allMasters = [];
let currentPeriodDowntimes = [];
let prevPeriodDowntimes = [];

let charts = {};

document.addEventListener('DOMContentLoaded', async () => {
    initAnalyticsUser();
    setupPresets();
    setupEventListeners();
    await loadData();
});

// --- AUTH & USER PROFILE ---
async function initAnalyticsUser() {
    try {
        const cached = localStorage.getItem('tectum_auth_user');
        if (cached) {
            const u = JSON.parse(cached);
            if (u && u.name) {
                const nEl = document.getElementById('analytics-user-name');
                const rEl = document.getElementById('analytics-user-role');
                if (nEl) nEl.textContent = u.name;
                if (rEl) rEl.textContent = (u.role === 'admin' ? 'Администратор' : (u.role === 'director' ? 'Директор' : (u.role === 'technologist' ? 'Главный технолог' : u.role)));
            }
        }
        const res = await fetch('/api/me/');
        if (res.ok) {
            const data = await res.json();
            if (data.authenticated && data.user) {
                const u = data.user;
                const nEl = document.getElementById('analytics-user-name');
                const rEl = document.getElementById('analytics-user-role');
                if (nEl) nEl.textContent = u.name;
                if (rEl) rEl.textContent = (u.role === 'admin' ? 'Администратор' : (u.role === 'director' ? 'Директор' : (u.role === 'technologist' ? 'Главный технолог' : u.role)));
                return;
            }
        }
    } catch (e) { }
}

async function logoutAnalytics() {
    try {
        await fetch('/api/logout/', { method: 'POST' });
    } catch (e) { }
    try {
        localStorage.removeItem('tectum_auth_user');
        localStorage.removeItem('tectum_portal_user');
        localStorage.removeItem('tectum_current_user_name');
        sessionStorage.clear();
    } catch (e) { }
    window.location.replace('/');
}

// --- FILTERS & PRESETS ---
function setupPresets() {
    const buttons = document.querySelectorAll('.preset-buttons button');
    buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            buttons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            applyPreset(e.target.dataset.preset);
        });
    });
    // Set default
    applyPreset('this_week');
}

function applyPreset(preset) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let fromDate = new Date(today);
    let toDate = new Date(today);

    if (preset === 'today') {
        // already set
    } else if (preset === 'yesterday') {
        fromDate.setDate(fromDate.getDate() - 1);
        toDate = new Date(fromDate);
    } else if (preset === 'this_week') {
        const day = fromDate.getDay();
        const diff = fromDate.getDate() - day + (day === 0 ? -6 : 1);
        fromDate = new Date(fromDate.setDate(diff));
        toDate = new Date(today); // Up to today
    } else if (preset === 'last_week') {
        const day = fromDate.getDay();
        const diff = fromDate.getDate() - day + (day === 0 ? -6 : 1) - 7;
        fromDate = new Date(fromDate.setDate(diff));
        toDate = new Date(fromDate);
        toDate.setDate(toDate.getDate() + 6);
    } else if (preset === 'this_month') {
        fromDate = new Date(today.getFullYear(), today.getMonth(), 1);
        toDate = new Date(today);
    }

    document.getElementById('filter-date-from').value = formatDateForInput(fromDate);
    document.getElementById('filter-date-to').value = formatDateForInput(toDate);

    // Auto trigger filter
    if (allDowntimes.length > 0) {
        processFilters();
    }
}

function formatDateForInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function setupEventListeners() {
    document.getElementById('filter-date-from').addEventListener('change', () => clearPresetsAndProcess());
    document.getElementById('filter-date-to').addEventListener('change', () => clearPresetsAndProcess());
    document.getElementById('filter-line').addEventListener('change', processFilters);
    document.getElementById('filter-category').addEventListener('change', processFilters);
    document.getElementById('filter-master').addEventListener('change', processFilters);

    // Sort table headers
    document.querySelectorAll('.pivot-table th').forEach(th => {
        th.addEventListener('click', () => {
            const sortKey = th.dataset.sort;
            if (sortKey) {
                const currentDir = th.dataset.dir || 'desc';
                const newDir = currentDir === 'desc' ? 'asc' : 'desc';
                document.querySelectorAll('.pivot-table th').forEach(h => h.dataset.dir = '');
                th.dataset.dir = newDir;
                renderPivotTable(sortKey, newDir);
            }
        });
    });
}

function clearPresetsAndProcess() {
    document.querySelectorAll('.preset-buttons button').forEach(b => b.classList.remove('active'));
    processFilters();
}

async function loadData() {
    const loader = document.getElementById('loading');
    if (loader) loader.style.display = 'flex';

    try {
        const [shiftsRes, mastersRes] = await Promise.all([
            fetch('/api/shifts/all'),
            fetch('/api/masters/')
        ]);

        const shifts = await shiftsRes.json();
        allMasters = await mastersRes.json();

        // Populate masters dropdown
        const masterSelect = document.getElementById('filter-master');
        masterSelect.innerHTML = '<option value="all">Все мастера</option>';
        allMasters.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            masterSelect.appendChild(opt);
        });

        // Flatten downtimes
        allDowntimes = [];
        shifts.forEach(shift => {
            if (shift.downtimes && shift.downtimes.length > 0) {
                shift.downtimes.forEach(dt => {
                    allDowntimes.push({
                        ...dt,
                        shift_date: new Date(shift.date),
                        shift_line: shift.line,
                        master_id: shift.master?.id,
                        master_name: shift.master?.name
                    });
                });
            }
        });

        if (loader) loader.style.display = 'none';
        processFilters();

    } catch (e) {
        console.error(e);
        if (loader) loader.style.display = 'none';
        alert('Ошибка загрузки данных аналитики');
    }
}

function getPreviousPeriodDates(from, to) {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const diffTime = Math.abs(toDate - fromDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    const prevTo = new Date(fromDate);
    prevTo.setDate(prevTo.getDate() - 1);

    const prevFrom = new Date(prevTo);
    prevFrom.setDate(prevFrom.getDate() - diffDays + 1);

    return { prevFrom, prevTo };
}

function processFilters() {
    const fromStr = document.getElementById('filter-date-from').value;
    const toStr = document.getElementById('filter-date-to').value;
    const line = document.getElementById('filter-line').value;
    const category = document.getElementById('filter-category').value;
    const master = document.getElementById('filter-master').value;

    if (!fromStr || !toStr) return;

    const fromDate = new Date(fromStr);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(toStr);
    toDate.setHours(23, 59, 59, 999);

    const { prevFrom, prevTo } = getPreviousPeriodDates(fromDate, toDate);
    prevTo.setHours(23, 59, 59, 999);

    currentPeriodDowntimes = filterDowntimes(allDowntimes, fromDate, toDate, line, category, master);
    prevPeriodDowntimes = filterDowntimes(allDowntimes, prevFrom, prevTo, line, category, master);

    updateKPIs();
    renderCharts();
    renderPivotTable('duration', 'desc');
}

function filterDowntimes(downtimes, start, end, line, category, masterId) {
    return downtimes.filter(d => {
        if (d.shift_date < start || d.shift_date > end) return false;
        if (line !== 'all' && d.shift_line !== line) return false;
        if (category !== 'all' && d.category !== category) return false;
        if (masterId !== 'all' && String(d.master_id) !== masterId) return false;
        return true;
    });
}

function updateKPIs() {
    const curStats = aggregateStats(currentPeriodDowntimes);
    const prevStats = aggregateStats(prevPeriodDowntimes);

    document.getElementById('kpi-hours').textContent = formatHours(curStats.duration);
    document.getElementById('kpi-tons').textContent = curStats.tons.toFixed(1) + ' т';
    document.getElementById('kpi-count').textContent = curStats.count;

    updateTrend('kpi-trend-hours', curStats.duration, prevStats.duration, true, 'мин');
    updateTrend('kpi-trend-tons', curStats.tons, prevStats.tons, true, 'т');
    updateTrend('kpi-trend-count', curStats.count, prevStats.count, true, 'инц.');
}

function aggregateStats(list) {
    return list.reduce((acc, curr) => {
        acc.duration += (curr.duration || 0);
        acc.tons += (curr.lost_tons || 0);
        acc.count += 1;
        return acc;
    }, { duration: 0, tons: 0, count: 0 });
}

function formatHours(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h} ч ${String(m).padStart(2, '0')} м`;
}

function updateTrend(elId, curVal, prevVal, lowerIsBetter, unit) {
    const el = document.getElementById(elId);
    if (!el) return;

    if (prevVal === 0 && curVal === 0) {
        el.innerHTML = `<span class="trend-neutral"><i class="fa-solid fa-minus"></i> без изменений</span>`;
        return;
    }

    let diff = curVal - prevVal;
    let percent = prevVal === 0 ? 100 : (Math.abs(diff) / prevVal) * 100;

    let isGood = diff < 0; // Для простоев уменьшение — это позитив
    if (!lowerIsBetter) isGood = diff > 0;

    let cls = 'trend-neutral';
    let icon = '<i class="fa-solid fa-minus"></i>';
    let sign = '';

    if (diff > 0) {
        cls = isGood ? 'trend-down' : 'trend-up';
        icon = '<i class="fa-solid fa-arrow-trend-up"></i>';
        sign = '+';
    } else if (diff < 0) {
        cls = isGood ? 'trend-down' : 'trend-up';
        icon = '<i class="fa-solid fa-arrow-trend-down"></i>';
        sign = '';
    }

    const formattedDiff = formatTrendVal(diff);
    el.innerHTML = `
        <span class="${cls}">
            ${icon} ${sign}${formattedDiff} ${unit} (${percent.toFixed(0)}%) к пред. периоду
        </span>
    `;
}

function formatTrendVal(val) {
    if (Math.abs(val) >= 100) return val.toFixed(0);
    return val.toFixed(1);
}

// ----------------------------------------------------
// CHARTS (Modern Tectum Palette)
// ----------------------------------------------------
Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
Chart.defaults.color = '#64748b';

function renderCharts() {
    renderBottlenecksChart();
    renderCategoryChart();
    renderTimelineChart();
}

function renderBottlenecksChart() {
    const canvas = document.getElementById('chart-bottlenecks');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Агрегация по узлу оборудования
    const nodeMap = {};
    currentPeriodDowntimes.forEach(d => {
        const name = d.node || d.department || 'Неизвестно';
        if (!nodeMap[name]) nodeMap[name] = 0;
        nodeMap[name] += (d.duration || 0);
    });

    const sorted = Object.entries(nodeMap).sort((a, b) => b[1] - a[1]).slice(0, 8);

    const labels = sorted.map(i => i[0]);
    const data = sorted.map(i => i[1]);

    if (charts['bottlenecks']) charts['bottlenecks'].destroy();

    // Если нет данных — отображаем заглушку
    if (labels.length === 0) {
        labels.push('Нет данных за период');
        data.push(0);
    }

    charts['bottlenecks'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Минуты',
                data: data,
                backgroundColor: '#3b82f6',
                hoverBackgroundColor: '#2563eb',
                borderRadius: 6,
                barThickness: 22,
                maxBarThickness: 26
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a',
                    padding: 8,
                    cornerRadius: 6,
                    callbacks: {
                        label: (ctx) => `Простой: ${ctx.raw} мин (${formatHours(ctx.raw)})`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: '#f1f5f9' },
                    ticks: {
                        color: '#64748b',
                        font: { size: 11 }
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        color: '#0f172a',
                        font: { size: 12, weight: '600' }
                    }
                }
            }
        }
    });
}

function renderCategoryChart() {
    const canvas = document.getElementById('chart-categories');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const catMap = {};
    currentPeriodDowntimes.forEach(d => {
        const c = d.category || 'Прочие';
        if (!catMap[c]) catMap[c] = 0;
        catMap[c] += (d.duration || 0);
    });

    const labels = Object.keys(catMap);
    const data = Object.values(catMap);
    const colors = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#64748b'];

    if (charts['categories']) charts['categories'].destroy();

    if (labels.length === 0) {
        labels.push('Нет простоев');
        data.push(1);
    }

    charts['categories'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#ffffff',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 12,
                        padding: 12,
                        font: { size: 12, weight: '500' },
                        color: '#334155'
                    }
                },
                tooltip: {
                    backgroundColor: '#0f172a',
                    padding: 8,
                    cornerRadius: 6,
                    callbacks: {
                        label: (ctx) => ` ${ctx.label}: ${ctx.raw} мин`
                    }
                }
            }
        }
    });
}

function renderTimelineChart() {
    const canvas = document.getElementById('chart-timeline');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const dateMap = {};
    currentPeriodDowntimes.forEach(d => {
        const dateStr = formatDateForInput(d.shift_date);
        if (!dateMap[dateStr]) dateMap[dateStr] = 0;
        dateMap[dateStr] += (d.duration || 0);
    });

    const fromStr = document.getElementById('filter-date-from').value;
    const toStr = document.getElementById('filter-date-to').value;
    const labels = [];
    const data = [];

    let curr = new Date(fromStr);
    const end = new Date(toStr);
    while (curr <= end) {
        const s = formatDateForInput(curr);
        // Красивый формат даты ДД.ММ
        const parts = s.split('-');
        labels.push(`${parts[2]}.${parts[1]}`);
        data.push(dateMap[s] || 0);
        curr.setDate(curr.getDate() + 1);
    }

    if (charts['timeline']) charts['timeline'].destroy();

    charts['timeline'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Минуты',
                data: data,
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.12)',
                fill: true,
                tension: 0.35,
                borderWidth: 2.5,
                pointBackgroundColor: '#2563eb',
                pointRadius: 3,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a',
                    padding: 8,
                    cornerRadius: 6,
                    callbacks: {
                        label: (ctx) => `Простой: ${ctx.raw} мин (${formatHours(ctx.raw)})`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: '#f1f5f9' },
                    ticks: { color: '#64748b', font: { size: 11 } }
                },
                y: {
                    grid: { color: '#f1f5f9' },
                    ticks: { color: '#64748b', font: { size: 11 } }
                }
            }
        }
    });
}

// ----------------------------------------------------
// PIVOT TABLE
// ----------------------------------------------------
let pivotData = [];

function renderPivotTable(sortKey, sortDir) {
    const tbody = document.getElementById('pivot-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // 1. Group current period by Category -> Node
    const grouped = {};
    currentPeriodDowntimes.forEach(d => {
        const cat = d.category || 'Прочие';
        const node = d.node || d.department || 'Неизвестно';

        if (!grouped[cat]) grouped[cat] = { name: cat, isCat: true, duration: 0, tons: 0, count: 0, nodes: {} };
        grouped[cat].duration += (d.duration || 0);
        grouped[cat].tons += (d.lost_tons || 0);
        grouped[cat].count += 1;

        if (!grouped[cat].nodes[node]) grouped[cat].nodes[node] = { name: node, isNode: true, duration: 0, tons: 0, count: 0, cat: cat };
        grouped[cat].nodes[node].duration += (d.duration || 0);
        grouped[cat].nodes[node].tons += (d.lost_tons || 0);
        grouped[cat].nodes[node].count += 1;
    });

    // 2. Group previous period for diff
    const prevGrouped = {};
    prevPeriodDowntimes.forEach(d => {
        const cat = d.category || 'Прочие';
        const node = d.node || d.department || 'Неизвестно';

        if (!prevGrouped[cat]) prevGrouped[cat] = { duration: 0, nodes: {} };
        prevGrouped[cat].duration += (d.duration || 0);

        if (!prevGrouped[cat].nodes[node]) prevGrouped[cat].nodes[node] = { duration: 0 };
        prevGrouped[cat].nodes[node].duration += (d.duration || 0);
    });

    // 3. Compute diffs and flatten for sorting
    pivotData = Object.values(grouped).map(catObj => {
        catObj.duration_diff = catObj.duration - (prevGrouped[catObj.name]?.duration || 0);
        catObj.nodesArr = Object.values(catObj.nodes).map(nodeObj => {
            nodeObj.duration_diff = nodeObj.duration - (prevGrouped[catObj.name]?.nodes[nodeObj.name]?.duration || 0);
            return nodeObj;
        });
        return catObj;
    });

    // 4. Sort categories
    pivotData.sort((a, b) => {
        let valA = a[sortKey];
        let valB = b[sortKey];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });

    // Sort nodes inside categories
    pivotData.forEach(cat => {
        cat.nodesArr.sort((a, b) => {
            let valA = a[sortKey];
            let valB = b[sortKey];
            if (valA < valB) return sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    });

    // 5. Render
    if (pivotData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #94a3b8; padding: 2rem;">Нет данных о простоях за выбранный период</td></tr>`;
        return;
    }

    pivotData.forEach((cat, index) => {
        const trCat = document.createElement('tr');
        trCat.className = 'row-category';
        trCat.onclick = () => toggleCategory(index);

        const diffCls = cat.duration_diff > 0 ? 'trend-up' : (cat.duration_diff < 0 ? 'trend-down' : 'trend-neutral');
        const diffText = cat.duration_diff > 0 ? `+${cat.duration_diff}` : cat.duration_diff;

        trCat.innerHTML = `
            <td><i class="fa-solid fa-chevron-right chevron" id="chevron-${index}"></i> ${cat.name}</td>
            <td class="num-cell"><strong>${cat.duration}</strong></td>
            <td class="num-cell diff-col ${diffCls}">${diffText}</td>
            <td class="num-cell">${cat.tons.toFixed(1)}</td>
            <td class="num-cell">${cat.count}</td>
        `;
        tbody.appendChild(trCat);

        cat.nodesArr.forEach(node => {
            const trNode = document.createElement('tr');
            trNode.className = `row-node cat-group-${index}`;

            const nDiffCls = node.duration_diff > 0 ? 'trend-up' : (node.duration_diff < 0 ? 'trend-down' : 'trend-neutral');
            const nDiffText = node.duration_diff > 0 ? `+${node.duration_diff}` : node.duration_diff;

            trNode.innerHTML = `
                <td>${node.name}</td>
                <td class="num-cell">${node.duration}</td>
                <td class="num-cell diff-col ${nDiffCls}">${nDiffText}</td>
                <td class="num-cell">${node.tons.toFixed(1)}</td>
                <td class="num-cell">${node.count}</td>
            `;
            tbody.appendChild(trNode);
        });
    });
}

function toggleCategory(index) {
    const nodes = document.querySelectorAll(`.cat-group-${index}`);
    const chevron = document.getElementById(`chevron-${index}`);

    let isExpanded = false;
    if (nodes.length > 0) {
        isExpanded = nodes[0].style.display === 'table-row';
    }

    nodes.forEach(n => {
        n.style.display = isExpanded ? 'none' : 'table-row';
    });

    if (chevron) {
        chevron.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(90deg)';
        chevron.style.color = isExpanded ? '#94a3b8' : '#2563eb';
    }
}
