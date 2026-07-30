let allDowntimes = [];
let allMasters = [];
let currentPeriodDowntimes = [];
let prevPeriodDowntimes = [];

let charts = {};

document.addEventListener('DOMContentLoaded', async () => {
    setupPresets();
    setupEventListeners();
    await loadData();
});

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
    today.setHours(0,0,0,0);
    
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
                // simple toggle direction
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
    try {
        const [shiftsRes, mastersRes] = await Promise.all([
            fetch('/api/shifts/all'),
            fetch('/api/masters/')
        ]);

        const shifts = await shiftsRes.json();
        allMasters = await mastersRes.json();

        // Populate masters dropdown
        const masterSelect = document.getElementById('filter-master');
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

        document.getElementById('loading').style.display = 'none';
        processFilters();

    } catch (e) {
        console.error(e);
        alert('Ошибка загрузки данных');
        document.getElementById('loading').style.display = 'none';
    }
}

function getPreviousPeriodDates(from, to) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    
    // Calculate difference in days
    const diffTime = Math.abs(toDate - fromDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both ends
    
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
    fromDate.setHours(0,0,0,0);
    const toDate = new Date(toStr);
    toDate.setHours(23,59,59,999);
    
    const { prevFrom, prevTo } = getPreviousPeriodDates(fromDate, toDate);
    prevTo.setHours(23,59,59,999);

    currentPeriodDowntimes = filterDowntimes(allDowntimes, fromDate, toDate, line, category, master);
    prevPeriodDowntimes = filterDowntimes(allDowntimes, prevFrom, prevTo, line, category, master);

    updateKPIs();
    renderCharts();
    renderPivotTable('duration', 'desc'); // default sort
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

    updateTrend('kpi-trend-hours', curStats.duration, prevStats.duration, true);
    updateTrend('kpi-trend-tons', curStats.tons, prevStats.tons, true);
    updateTrend('kpi-trend-count', curStats.count, prevStats.count, true);
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
    return `${h} ч ${String(m).padStart(2,'0')} м`;
}

function updateTrend(elId, curVal, prevVal, lowerIsBetter) {
    const el = document.getElementById(elId);
    if (prevVal === 0 && curVal === 0) {
        el.innerHTML = `<span class="trend-neutral">без изменений</span>`;
        return;
    }
    
    let diff = curVal - prevVal;
    let percent = prevVal === 0 ? 100 : (Math.abs(diff) / prevVal) * 100;
    
    let text = diff > 0 ? `+${formatTrendVal(diff)} (${percent.toFixed(0)}%)` : `${formatTrendVal(diff)} (${percent.toFixed(0)}%)`;
    
    let isGood = diff < 0; // Less downtime is good
    if (!lowerIsBetter) isGood = diff > 0;
    
    let cls = 'trend-neutral';
    let icon = '';
    if (diff !== 0) {
        cls = isGood ? 'trend-down' : 'trend-up';
        icon = diff > 0 ? '<i class="fa-solid fa-arrow-trend-up"></i>' : '<i class="fa-solid fa-arrow-trend-down"></i>';
    }

    el.innerHTML = `<span class="${cls}">${icon} к прошлому периоду: ${text}</span>`;
}

function formatTrendVal(val) {
    if (Math.abs(val) > 100) return val.toFixed(0);
    return val.toFixed(1);
}

// ----------------------------------------------------
// CHARTS
// ----------------------------------------------------
Chart.defaults.color = '#a0aec0';
Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';

function renderCharts() {
    renderBottlenecksChart();
    renderCategoryChart();
    renderTimelineChart();
}

function renderBottlenecksChart() {
    const ctx = document.getElementById('chart-bottlenecks').getContext('2d');
    
    // Aggregate by node
    const nodeMap = {};
    currentPeriodDowntimes.forEach(d => {
        const name = d.node || d.department || 'Неизвестно';
        if (!nodeMap[name]) nodeMap[name] = 0;
        nodeMap[name] += (d.duration || 0);
    });
    
    // Sort and get top 10
    const sorted = Object.entries(nodeMap).sort((a,b) => b[1] - a[1]).slice(0, 10);
    
    const labels = sorted.map(i => i[0]);
    const data = sorted.map(i => i[1]);

    if(charts['bottlenecks']) charts['bottlenecks'].destroy();
    charts['bottlenecks'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Минуты',
                data: data,
                backgroundColor: '#ef4444',
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: {display: false} }
        }
    });
}

function renderCategoryChart() {
    const ctx = document.getElementById('chart-categories').getContext('2d');
    
    const catMap = {};
    currentPeriodDowntimes.forEach(d => {
        const c = d.category || 'Прочие';
        if (!catMap[c]) catMap[c] = 0;
        catMap[c] += (d.duration || 0);
    });

    const labels = Object.keys(catMap);
    const data = Object.values(catMap);
    const colors = ['#f59e0b', '#3b82f6', '#10b981', '#6366f1', '#ec4899'];

    if(charts['categories']) charts['categories'].destroy();
    charts['categories'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'right' }
            }
        }
    });
}

function renderTimelineChart() {
    const ctx = document.getElementById('chart-timeline').getContext('2d');
    
    // Group by date
    const dateMap = {};
    currentPeriodDowntimes.forEach(d => {
        const dateStr = formatDateForInput(d.shift_date);
        if(!dateMap[dateStr]) dateMap[dateStr] = 0;
        dateMap[dateStr] += (d.duration || 0);
    });

    // Create continuous timeline array
    const fromStr = document.getElementById('filter-date-from').value;
    const toStr = document.getElementById('filter-date-to').value;
    const labels = [];
    const data = [];
    
    let curr = new Date(fromStr);
    const end = new Date(toStr);
    while (curr <= end) {
        const s = formatDateForInput(curr);
        labels.push(s);
        data.push(dateMap[s] || 0);
        curr.setDate(curr.getDate() + 1);
    }

    if(charts['timeline']) charts['timeline'].destroy();
    charts['timeline'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Минуты',
                data: data,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

// ----------------------------------------------------
// PIVOT TABLE
// ----------------------------------------------------

// Global state for pivot data so we can re-sort it easily
let pivotData = [];

function renderPivotTable(sortKey, sortDir) {
    const tbody = document.getElementById('pivot-table-body');
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
    pivotData.sort((a,b) => {
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
        cat.nodesArr.sort((a,b) => {
            let valA = a[sortKey];
            let valB = b[sortKey];
            if (valA < valB) return sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    });

    // 5. Render
    pivotData.forEach((cat, index) => {
        const trCat = document.createElement('tr');
        trCat.className = 'row-category';
        trCat.onclick = () => toggleCategory(index);
        
        const diffCls = cat.duration_diff > 0 ? 'trend-up' : (cat.duration_diff < 0 ? 'trend-down' : 'trend-neutral');
        const diffText = cat.duration_diff > 0 ? `+${cat.duration_diff}` : cat.duration_diff;
        
        trCat.innerHTML = `
            <td><i class="fa-solid fa-chevron-right chevron" id="chevron-${index}"></i> ${cat.name}</td>
            <td>${cat.duration}</td>
            <td class="diff-col ${diffCls}">${diffText}</td>
            <td>${cat.tons.toFixed(1)}</td>
            <td>${cat.count}</td>
        `;
        tbody.appendChild(trCat);

        cat.nodesArr.forEach(node => {
            const trNode = document.createElement('tr');
            trNode.className = `row-node cat-group-${index}`;
            
            const nDiffCls = node.duration_diff > 0 ? 'trend-up' : (node.duration_diff < 0 ? 'trend-down' : 'trend-neutral');
            const nDiffText = node.duration_diff > 0 ? `+${node.duration_diff}` : node.duration_diff;

            trNode.innerHTML = `
                <td>${node.name}</td>
                <td>${node.duration}</td>
                <td class="diff-col ${nDiffCls}">${nDiffText}</td>
                <td>${node.tons.toFixed(1)}</td>
                <td>${node.count}</td>
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
        // Check first node
        isExpanded = nodes[0].style.display === 'table-row';
    }
    
    nodes.forEach(n => {
        n.style.display = isExpanded ? 'none' : 'table-row';
    });
    
    if (isExpanded) {
        chevron.style.transform = 'rotate(0deg)';
    } else {
        chevron.style.transform = 'rotate(90deg)';
    }
}
