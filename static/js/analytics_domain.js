/**
 * Tectum Enterprise Portal - Analytics & Management Domain Module
 *
 * @domain Analytics, KPI, Daily Reports, PDF Export & Norms Sync
 * @extracted 2026-11-03 (Phase 4 Domain Splitting)
 */

// ----------------------------------------------------
// ANALYTICS TAB LOGIC
// ----------------------------------------------------
async function loadAnalyticsData() {
    const start = document.getElementById('analytics-start-date').value;
    const end = document.getElementById('analytics-end-date').value;
    const dept = document.getElementById('analytics-dept').value;
    
    let url = `/api/dashboard/analytics_data?`;
    if (start) url += `&start_date=${start}`;
    if (end) url += `&end_date=${end}`;
    if (dept) url += `&department=${encodeURIComponent(dept)}`;
    
    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            renderAnalyticsKPIs(data);
            renderAnalyticsCharts(data);
            renderAnalyticsTable(data);
        }
    } catch(e) {
        console.error(e);
    }
}

function renderAnalyticsKPIs(data) {
    const kpi = data.kpis || { with_stop: {}, without_stop: {} };
    
    document.getElementById('analytics-kpi-stop-min').innerText = (kpi.with_stop.duration || 0) + ' мин';
    document.getElementById('analytics-kpi-stop-count').innerText = (kpi.with_stop.count || 0);
    document.getElementById('analytics-kpi-stop-tons').innerText = (kpi.with_stop.lost_tons || 0).toFixed(1) + ' т';

    document.getElementById('analytics-kpi-nonstop-min').innerText = (kpi.without_stop.duration || 0) + ' мин';
    document.getElementById('analytics-kpi-nonstop-count').innerText = (kpi.without_stop.count || 0);
    document.getElementById('analytics-kpi-nonstop-tons').innerText = (kpi.without_stop.lost_tons || 0).toFixed(1) + ' т';
}

function renderAnalyticsCharts(data) {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textCol = isDark ? '#f8fafc' : '#1e293b';

    // Trend chart
    const ctxTrend = document.getElementById('chart-analytics-trend').getContext('2d');
    if (chartAnalyticsTrend) chartAnalyticsTrend.destroy();
    
    const trendData = data.trend || {};
    const dates = Object.keys(trendData).sort();
    const minutes = dates.map(d => Object.values(trendData[d]).reduce((a,b) => a+b, 0));

    chartAnalyticsTrend = new Chart(ctxTrend, {
        type: 'line',
        data: {
            labels: dates.map(d => d.split('-').slice(1).join('.')),
            datasets: [{
                label: 'Минуты простоя',
                data: minutes,
                borderColor: '#E53935',
                backgroundColor: 'rgba(229, 57, 69, 0.1)',
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { ticks: { color: textCol } },
                y: { ticks: { color: textCol } }
            }
        }
    });

    // Categories chart
    const ctxCats = document.getElementById('chart-analytics-categories').getContext('2d');
    if (chartAnalyticsCategories) chartAnalyticsCategories.destroy();
    
    const byCategory = data.by_category || {};
    const cats = Object.keys(byCategory);
    const catMins = cats.map(c => byCategory[c].with_stop + byCategory[c].without_stop);

    chartAnalyticsCategories = new Chart(ctxCats, {
        type: 'doughnut',
        data: {
            labels: cats.length ? cats : ['Нет данных'],
            datasets: [{
                data: catMins.length ? catMins : [0],
                backgroundColor: ['#dc3545', '#ffc107', '#28a745', '#17a2b8', '#6f42c1']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });

    // Bottlenecks chart
    const ctxBottlenecks = document.getElementById('chart-analytics-bottlenecks').getContext('2d');
    if (chartAnalyticsBottlenecks) chartAnalyticsBottlenecks.destroy();
    
    const bottlenecks = data.bottlenecks || [];
    const labels = bottlenecks.map(b => b.node);
    const values = bottlenecks.map(b => b.duration);

    chartAnalyticsBottlenecks = new Chart(ctxBottlenecks, {
        type: 'bar',
        data: {
            labels: labels.length ? labels : ['Нет данных'],
            datasets: [{
                label: 'Минуты',
                data: values.length ? values : [0],
                backgroundColor: 'rgba(229, 57, 69, 0.8)',
                borderColor: '#E53935',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { ticks: { color: textCol } },
                y: { ticks: { color: textCol } }
            }
        }
    });
}

function renderAnalyticsTable(data) {
    const tbody = document.getElementById('analytics-table-body');
    if (!tbody) return;
    
    const downtimes = data.downtimes || [];
    if (downtimes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">Нет данных за выбранный период</td></tr>';
        return;
    }
    
    let html = '';
    downtimes.forEach(dt => {
        const stopBadge = dt.is_equipment_downtime ? 
            '<span class="badge" style="background: rgba(220, 53, 69, 0.2); color: #ff6b6b; padding: 2px 6px;">Да</span>' : 
            '<span class="badge" style="background: rgba(40, 167, 69, 0.2); color: #28a745; padding: 2px 6px;">Нет</span>';
            
        html += `
            <tr>
                <td>${dt.date || '-'}</td>
                <td>${dt.shift || '-'}</td>
                <td>${dt.line || '-'}</td>
                <td>${dt.department || '-'}</td>
                <td>${dt.node || '-'}</td>
                <td>${dt.category || '-'}</td>
                <td>${stopBadge}</td>
                <td style="font-weight: bold;">${dt.duration || 0}</td>
                <td style="color: ${dt.is_equipment_downtime ? '#ff6b6b' : '#28a745'};">${(dt.lost_tons || 0).toFixed(2)}</td>
                <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${dt.description || ''}">${dt.description || ''}</td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

// ----------------------------------------------------
// DAILY REPORT TAB LOGIC (📈 Месячная сводка выработки)
// ----------------------------------------------------
function onDailyReportMonthChange() {
    const monthEl = document.getElementById('daily-report-month');
    if (monthEl) {
        updateWeekOptions(monthEl.value, 'daily-report-week-select');
    }
    loadDailyReport();
}

function toggleRangeControls() {
    const rangeTypeSelect = document.getElementById('daily-report-range-type');
    if (!rangeTypeSelect) return;
    const rangeType = rangeTypeSelect.value;
    
    const titleEl = document.getElementById('daily-report-title');
    if (titleEl) {
        titleEl.innerText = rangeType === 'week' ? 'Недельная сводка выработки' : 'Месячная сводка выработки';
    }

    const monthEl = document.getElementById('daily-report-month');
    if (monthEl) {
        monthEl.style.display = (rangeType === 'month' || rangeType === 'week') ? 'inline-block' : 'none';
        if (rangeType === 'week') {
            updateWeekOptions(monthEl.value, 'daily-report-week-select');
        }
    }
    
    const weekEl = document.getElementById('daily-report-week-select');
    const weekWrapper = document.getElementById('daily-report-week-wrapper');
    if (weekWrapper) {
        weekWrapper.style.display = rangeType === 'week' ? 'block' : 'none';
    } else if (weekEl) {
        weekEl.style.display = rangeType === 'week' ? 'inline-block' : 'none';
    }
}

async function loadDailyReport() {
    const lineEl = document.getElementById('daily-report-line');
    const rangeTypeEl = document.getElementById('daily-report-range-type');
    const monthEl = document.getElementById('daily-report-month');
    const weekEl = document.getElementById('daily-report-week-select');
    
    const line = lineEl ? lineEl.value : 'lfm2';
    const rangeType = rangeTypeEl ? rangeTypeEl.value : 'month';
    const month = monthEl ? monthEl.value : '';
    const week = weekEl ? weekEl.value : '';

    let url = `/api/dashboard/daily_report?line=${line}&range_type=${rangeType}`;
    if (month) url += `&month=${month}`;
    if (week) url += `&week=${week}`;

    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            
            // Calculate Today / MTD KPIs (up to today or worked shifts)
            const now = new Date();
            const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
            
            let todayPlanTons = 0;
            let todayFactTons = 0;
            let todayPlanSheets = 0;
            let todayFactSheets = 0;

            let passedDates = new Set();

            if (data.days && Array.isArray(data.days)) {
                data.days.forEach(s => {
                    if (s.date < todayStr || (s.date === todayStr && (s.fact_sheets > 0 || s.fact_tons > 0))) {
                        todayFactTons += (s.fact_tons || 0);
                        todayFactSheets += (s.fact_sheets || 0);
                        passedDates.add(s.date);
                    }
                });
            }

            // Определяем общее количество дней в периоде (делим длину массива на 2, так как бэкенд отдает по 2 смены на каждый день)
            let totalDays = (data.days && data.days.length > 0) ? (data.days.length / 2) : 31;

            // Считаем сколько дней прошло в выбранном периоде
            let daysPassedCount = passedDates.size;
            // Для более честного расчета, если мы смотрим текущий месяц, можно считать прошедшие дни по календарю:
            if (rangeType === 'month' && (!monthEl || !monthEl.value || monthEl.value === (now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0')))) {
                daysPassedCount = now.getDate();
            } else if (rangeType === 'week' && (!weekEl || !weekEl.value)) {
                let dayOfWeek = now.getDay(); // 0 = Sunday
                daysPassedCount = dayOfWeek === 0 ? 7 : dayOfWeek;
            }

            // Вычисляем план на сегодня пропорционально потолку (например 160 000 или 39 000)
            let totalPlanSheetsLimit = data.total_plan_sheets || 160000;
            
            todayPlanSheets = Math.round(totalPlanSheetsLimit / totalDays * daysPassedCount);
            
            // Динамический расчет веса (если производим шифер 7 волн, будет учтен его реальный вес ~17.07 кг)
            let avgWeight = 19.6;
            if (data.total_fact_sheets > 0 && data.total_fact_tons > 0) {
                avgWeight = (data.total_fact_tons * 1000.0) / data.total_fact_sheets;
            }
            todayPlanTons = (todayPlanSheets * avgWeight) / 1000.0;

            const diffTons = todayFactTons - todayPlanTons;
            const diffSheets = todayFactSheets - todayPlanSheets;

            const elTodayTons = document.getElementById('kpi-today-tons');
            if (elTodayTons) elTodayTons.innerText = todayFactTons.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1});
            const elTodaySheets = document.getElementById('kpi-today-sheets');
            if (elTodaySheets) elTodaySheets.innerText = `${todayFactSheets.toLocaleString()} листов`;

            const elTodayPlanTons = document.getElementById('kpi-today-plan-tons');
            if (elTodayPlanTons) elTodayPlanTons.innerText = todayPlanTons.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1});
            const elTodayPlanSheets = document.getElementById('kpi-today-plan-sheets');
            if (elTodayPlanSheets) elTodayPlanSheets.innerText = `${todayPlanSheets.toLocaleString()} листов`;

            const elDiffTons = document.getElementById('kpi-today-diff-tons');
            const elDiffTonsDetail = document.getElementById('kpi-today-diff-tons-detail');
            if (elDiffTons) {
                if (diffTons > 0.05) {
                    elDiffTons.innerText = `+${diffTons.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}`;
                    elDiffTons.style.color = '#22c55e';
                    if (elDiffTonsDetail) elDiffTonsDetail.innerText = 'Перевыполнение плана!';
                } else if (diffTons < -0.05) {
                    elDiffTons.innerText = diffTons.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1});
                    elDiffTons.style.color = '#8b5cf6';
                    if (elDiffTonsDetail) elDiffTonsDetail.innerText = 'Отставание от плана';
                } else {
                    elDiffTons.innerText = '0.0';
                    elDiffTons.style.color = '#22c55e';
                    if (elDiffTonsDetail) elDiffTonsDetail.innerText = 'В норме';
                }
            }

            const elDiffSheets = document.getElementById('kpi-today-diff-sheets');
            const elDiffSheetsDetail = document.getElementById('kpi-today-diff-sheets-detail');
            if (elDiffSheets) {
                if (diffSheets > 0) {
                    elDiffSheets.innerText = `+${diffSheets.toLocaleString()}`;
                    elDiffSheets.style.color = '#22c55e';
                    if (elDiffSheetsDetail) elDiffSheetsDetail.innerText = 'Перевыполнение плана!';
                } else if (diffSheets < 0) {
                    elDiffSheets.innerText = diffSheets.toLocaleString();
                    elDiffSheets.style.color = '#8b5cf6';
                    if (elDiffSheetsDetail) elDiffSheetsDetail.innerText = 'Отставание от плана';
                } else {
                    elDiffSheets.innerText = '0';
                    elDiffSheets.style.color = '#22c55e';
                    if (elDiffSheetsDetail) elDiffSheetsDetail.innerText = 'В норме';
                }
            }

            // Set Total Month KPIs
            document.getElementById('kpi-total-sheets').innerText = data.total_fact_sheets.toLocaleString();
            document.getElementById('kpi-total-tons').innerText = data.total_fact_tons.toFixed(1);
            const tonsDetailEl = document.getElementById('kpi-tons-detail');
            if (tonsDetailEl) {
                tonsDetailEl.innerText = `План: ${(data.total_plan_tons || 0).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})} / Факт: ${(data.total_fact_tons || 0).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}`;
            }

            const lagSheetsEl = document.getElementById('kpi-lag-sheets');
            const lagSheetsDetailEl = document.getElementById('kpi-lag-sheets-detail');
            if (lagSheetsEl) {
                const lagS = data.lag_sheets || 0;
                if (lagS > 0) {
                    lagSheetsEl.innerText = lagS.toLocaleString();
                    lagSheetsEl.style.color = '#8b5cf6';
                    if (lagSheetsDetailEl) lagSheetsDetailEl.innerText = 'Недовыполнение';
                } else if (lagS < 0) {
                    lagSheetsEl.innerText = '0';
                    lagSheetsEl.style.color = '#22c55e';
                    if (lagSheetsDetailEl) lagSheetsDetailEl.innerText = `Перевыполнение: +${Math.abs(lagS).toLocaleString()}`;
                } else {
                    lagSheetsEl.innerText = '0';
                    lagSheetsEl.style.color = '#22c55e';
                    if (lagSheetsDetailEl) lagSheetsDetailEl.innerText = 'План выполнен';
                }
            }

            const lagTonsEl = document.getElementById('kpi-lag-tons');
            const lagTonsDetailEl = document.getElementById('kpi-lag-tons-detail');
            if (lagTonsEl) {
                const lagT = data.lag_tons || 0;
                if (lagT > 0) {
                    lagTonsEl.innerText = lagT.toFixed(1);
                    lagTonsEl.style.color = '#8b5cf6';
                    if (lagTonsDetailEl) lagTonsDetailEl.innerText = 'Недовыполнение';
                } else if (lagT < 0) {
                    lagTonsEl.innerText = '0.0';
                    lagTonsEl.style.color = '#22c55e';
                    if (lagTonsDetailEl) lagTonsDetailEl.innerText = `Перевыполнение: +${Math.abs(lagT).toFixed(1)} т`;
                } else {
                    lagTonsEl.innerText = '0.0';
                    lagTonsEl.style.color = '#22c55e';
                    if (lagTonsDetailEl) lagTonsDetailEl.innerText = 'План выполнен';
                }
            }

            document.getElementById('kpi-avg-plan-percent').innerText = Math.round(data.avg_plan_percent) + '%';
            document.getElementById('kpi-plan-fact-detail').innerText = `План: ${(data.total_plan_sheets || 0).toLocaleString()} / Факт: ${(data.total_fact_sheets || 0).toLocaleString()}`;
            
            const firstGradePercentEl = document.getElementById('kpi-first-grade-percent');
            if (firstGradePercentEl) firstGradePercentEl.innerText = (data.first_grade_percent || 0).toFixed(2) + '%';
            const firstGradeDetailEl = document.getElementById('kpi-first-grade-detail');
            if (firstGradeDetailEl) firstGradeDetailEl.innerText = `1 сорт: ${(data.total_first_grade || 0).toLocaleString()} листов`;

            document.getElementById('kpi-defect-percent').innerText = (data.defect_percent || 0).toFixed(2) + '%';
            document.getElementById('kpi-defect-detail').innerText = `Брак: ${(data.total_defect || 0).toLocaleString()} листов`;

            // Renders charts
            renderDailyReportCharts(data.days, data.line_plan_norms);
        }
    } catch(e) {
        console.error(e);
    }
}

function renderDailyReportCharts(days, planNorms) {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textCol = isDark ? '#f8fafc' : '#1e293b';

    // Определение динамических норм плана
    const dayNorm = (planNorms && planNorms.day) ? planNorms.day : 2700;
    const nightNorm = (planNorms && planNorms.night) ? planNorms.night : 3300;
    const avgWeightKg = 19.6;
    const dayTonsNorm = Number(((dayNorm * avgWeightKg) / 1000.0).toFixed(1));
    const nightTonsNorm = Number(((nightNorm * avgWeightKg) / 1000.0).toFixed(1));

    // Two-line compact label: line 1 = day of month (e.g. "01"), line 2 = shift type ("Д" or "Н")
    const labels = days.map(d => {
        const parts = (d.date || '').split('-');
        const dayStr = parts.length === 3 ? parts[2] : '';
        const isDay = d.label && d.label.includes('(Д)');
        const shiftLetter = isDay ? 'Д' : 'Н';
        return [dayStr, shiftLetter];
    });
    
    // Determine bar colors dynamically: Green for Plan Met, Red for Plan Not Met
    const sheetsColors = days.map(d => {
        const targetPlan = d.plan_sheets > 0 ? d.plan_sheets : (d.label && d.label.includes('(Д)') ? dayNorm : nightNorm);
        const met = d.fact_sheets >= targetPlan;
        if (met && d.fact_sheets > 0) return '#22c55e'; // Green if plan is met
        return '#ef4444'; // Red if plan is not met
    });

    const tonsColors = days.map(d => {
        const targetTons = d.plan_tons > 0 ? d.plan_tons : (d.label && d.label.includes('(Д)') ? dayTonsNorm : nightTonsNorm);
        const met = d.fact_tons >= targetTons;
        if (met && d.fact_tons > 0) return '#22c55e'; // Green if plan is met
        return '#ef4444'; // Red if plan is not met
    });

    const commonPlugins = {
        legend: {
            labels: {
                color: textCol,
                font: { size: 12 },
                generateLabels: function(chart) {
                    return [
                        { text: 'Факт (выполнение)', fillStyle: '#22c55e', strokeStyle: '#22c55e', lineWidth: 1 },
                        { text: 'Факт (невыполнение)', fillStyle: '#ef4444', strokeStyle: '#ef4444', lineWidth: 1 },
                        { text: `План День (${dayNorm})`, fillStyle: '#ffc107', strokeStyle: '#ffc107', lineWidth: 2 },
                        { text: `План Ночь (${nightNorm})`, fillStyle: '#8b5cf6', strokeStyle: '#8b5cf6', lineWidth: 2 }
                    ];
                }
            }
        },
        tooltip: {
            callbacks: {
                title: function(context) {
                    const idx = context[0].dataIndex;
                    const d = days[idx];
                    const shiftName = (d.label && d.label.includes('(Д)')) ? 'День' : 'Ночь';
                    return `📅 ${d.date} — Смена: ${shiftName}`;
                }
            }
        }
    };

    const commonXScale = {
        grid: {
            display: true,
            color: function(context) {
                // Thicker/darker grid line between pairs of days (every 2 shifts)
                if (context.index % 2 === 0) {
                    return isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)';
                }
                return 'transparent';
            }
        },
        ticks: {
            color: textCol,
            autoSkip: false, // Ensure EVERY single shift label (all 62) is rendered!
            maxRotation: 0,
            minRotation: 0,
            font: {
                size: 10,
                weight: function(context) {
                    // Bold shift letter
                    return '600';
                }
            },
            padding: 2
        }
    };

    // Sheets Chart
    const ctxSheets = document.getElementById('chart-daily-sheets').getContext('2d');
    if (chartDailySheets) chartDailySheets.destroy();
    chartDailySheets = new Chart(ctxSheets, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Факт (листы)',
                    data: days.map(d => d.fact_sheets),
                    backgroundColor: sheetsColors,
                    borderColor: sheetsColors,
                    borderWidth: 1,
                    categoryPercentage: 0.92,
                    barPercentage: 0.95
                },
                {
                    label: `План День (${dayNorm})`,
                    data: Array(days.length).fill(dayNorm),
                    borderColor: '#ffc107', // Yellow
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    type: 'line'
                },
                {
                    label: `План Ночь (${nightNorm})`,
                    data: Array(days.length).fill(nightNorm),
                    borderColor: '#8b5cf6', // Purple / Violet
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    type: 'line'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: commonPlugins,
            scales: {
                x: commonXScale,
                y: { ticks: { color: textCol } }
            }
        }
    });

    // Tons Chart
    const ctxTons = document.getElementById('chart-daily-tons').getContext('2d');
    if (chartDailyTons) chartDailyTons.destroy();
    chartDailyTons = new Chart(ctxTons, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Факт (тонны)',
                    data: days.map(d => d.fact_tons),
                    backgroundColor: tonsColors,
                    borderColor: tonsColors,
                    borderWidth: 1,
                    categoryPercentage: 0.92,
                    barPercentage: 0.95
                },
                {
                    label: `План День (${dayTonsNorm} т)`,
                    data: Array(days.length).fill(dayTonsNorm),
                    borderColor: '#ffc107', // Yellow
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    type: 'line'
                },
                {
                    label: `План Ночь (${nightTonsNorm} т)`,
                    data: Array(days.length).fill(nightTonsNorm),
                    borderColor: '#8b5cf6', // Purple / Violet
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    type: 'line'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                ...commonPlugins,
                legend: {
                    labels: {
                        color: textCol,
                        font: { size: 12 },
                        generateLabels: function(chart) {
                            return [
                                { text: 'Факт (выполнение)', fillStyle: '#22c55e', strokeStyle: '#22c55e', lineWidth: 1 },
                                { text: 'Факт (невыполнение)', fillStyle: '#ef4444', strokeStyle: '#ef4444', lineWidth: 1 },
                                { text: `План День (${dayTonsNorm} т)`, fillStyle: '#ffc107', strokeStyle: '#ffc107', lineWidth: 2 },
                                { text: `План Ночь (${nightTonsNorm} т)`, fillStyle: '#8b5cf6', strokeStyle: '#8b5cf6', lineWidth: 2 }
                            ];
                        }
                    }
                }
            },
            scales: {
                x: commonXScale,
                y: { ticks: { color: textCol } }
            }
        }
    });
}

function exportDailyReportPDF() {
    const rangeType = document.getElementById('daily-report-range-type')?.value || 'month';
    const titleText = rangeType === 'week' ? "Недельная сводка выработки" : "Месячная сводка выработки";
    const monthVal = document.getElementById('daily-report-month')?.value || "";

    // Get line readable label
    const lineSelect = document.getElementById('daily-report-line');
    let lineLabel = lineSelect ? lineSelect.options[lineSelect.selectedIndex]?.text : "Все линии";
    if (lineLabel.includes('ЛФМ-1')) lineLabel = 'ЛФМ-1';
    else if (lineLabel.includes('ЛФМ-2')) lineLabel = 'ЛФМ-2';

    // Format readable period range
    const weekSelect = document.getElementById('daily-report-week-select');
    let periodLabel = monthVal;

    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    if (rangeType === 'week' && weekSelect && weekSelect.selectedIndex >= 0) {
        const optText = weekSelect.options[weekSelect.selectedIndex]?.text || '';
        const match = optText.match(/\((.*?)\)/);
        if (match) {
            periodLabel = `с ${match[1].replace(' - ', ' по ')}`;
        } else {
            periodLabel = optText;
        }
    } else if (monthVal) {
        const parts = monthVal.split('-');
        if (parts.length === 2) {
            const yr = parseInt(parts[0]);
            const mo = parseInt(parts[1]);
            const moStr = String(mo).padStart(2, '0');

            if (monthVal === currentYearMonth) {
                const todayDay = String(now.getDate()).padStart(2, '0');
                periodLabel = `с 01.${moStr} по ${todayDay}.${moStr}.${yr}`;
            } else {
                const lastDay = new Date(yr, mo, 0).getDate();
                const lastDayStr = String(lastDay).padStart(2, '0');
                periodLabel = `с 01.${moStr} по ${lastDayStr}.${moStr}.${yr}`;
            }
        }
    }

    const kpiSheets = document.getElementById('kpi-total-sheets')?.innerText || "0";
    const kpiTons = document.getElementById('kpi-total-tons')?.innerText || "0.0";
    const kpiTonsDetail = document.getElementById('kpi-tons-detail')?.innerText || "";
    const kpiLagSheets = document.getElementById('kpi-lag-sheets')?.innerText || "0";
    const kpiLagSheetsDetail = document.getElementById('kpi-lag-sheets-detail')?.innerText || "";
    const kpiLagTons = document.getElementById('kpi-lag-tons')?.innerText || "0.0";
    const kpiLagTonsDetail = document.getElementById('kpi-lag-tons-detail')?.innerText || "";
    const kpiAvgPlan = document.getElementById('kpi-avg-plan-percent')?.innerText || "0%";
    const kpiPlanDetail = document.getElementById('kpi-plan-fact-detail')?.innerText || "";
    const kpiFirstGrade = document.getElementById('kpi-first-grade-percent')?.innerText || "0.00%";
    const kpiFirstGradeDetail = document.getElementById('kpi-first-grade-detail')?.innerText || "";
    const kpiDefect = document.getElementById('kpi-defect-percent')?.innerText || "0.00%";
    const kpiDefectDetail = document.getElementById('kpi-defect-detail')?.innerText || "";

    // Today / MTD KPIs
    const kpiTodayTons = document.getElementById('kpi-today-tons')?.innerText || "0.0";
    const kpiTodaySheets = document.getElementById('kpi-today-sheets')?.innerText || "";
    const kpiTodayPlanTons = document.getElementById('kpi-today-plan-tons')?.innerText || "0.0";
    const kpiTodayPlanSheets = document.getElementById('kpi-today-plan-sheets')?.innerText || "";
    const kpiTodayDiffTons = document.getElementById('kpi-today-diff-tons')?.innerText || "0.0";
    const kpiTodayDiffTonsDetail = document.getElementById('kpi-today-diff-tons-detail')?.innerText || "";
    const kpiTodayDiffSheets = document.getElementById('kpi-today-diff-sheets')?.innerText || "0";
    const kpiTodayDiffSheetsDetail = document.getElementById('kpi-today-diff-sheets-detail')?.innerText || "";

    // Prepare a high-resolution canvas for print quality
    const cw = 1600;
    const ch = 1131; // 1600 / 1.414 (A4 landscape ratio)
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    
    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    
    // Header
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 38px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(titleText, cw / 2, 80);
    
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 22px Arial';
    ctx.fillText(`Линия: ${lineLabel}   |   Период: ${periodLabel}`, cw / 2, 120);
    
    // Draw horizontal line
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, 140);
    ctx.lineTo(cw - 80, 140);
    ctx.stroke();
    
    // Row 1: Today MTD KPIs
    ctx.textAlign = 'left';
    ctx.fillStyle = '#16a34a';
    ctx.font = 'bold 20px Arial';
    ctx.fillText("ФАКТИЧЕСКИЕ ПОКАЗАТЕЛИ НА ТЕКУЩУЮ ДАТУ", 80, 175);

    const todayKpis = [
        { label: "Выработка (Тонны)", val: kpiTodayTons, color: '#16a34a', subtext: kpiTodaySheets },
        { label: "План на сегодня (Тонны)", val: kpiTodayPlanTons, color: '#2563eb', subtext: kpiTodayPlanSheets },
        { label: "Отклонение (Тонны)", val: kpiTodayDiffTons, color: '#ca8a04', subtext: kpiTodayDiffTonsDetail },
        { label: "Отклонение (Листы)", val: kpiTodayDiffSheets, color: '#7c3aed', subtext: kpiTodayDiffSheetsDetail }
    ];
    
    const todayW = (cw - 160) / 4;
    todayKpis.forEach((k, idx) => {
        const x = 80 + idx * todayW;
        const y = 190;
        const cardW = todayW - 20;
        const cardX = x + 10;
        ctx.fillStyle = '#f0fdf4';
        ctx.fillRect(cardX, y, cardW, 110);
        ctx.strokeStyle = '#bbf7d0';
        ctx.lineWidth = 1;
        ctx.strokeRect(cardX, y, cardW, 110);
        
        ctx.textAlign = 'center';
        ctx.fillStyle = '#334155';
        ctx.font = 'bold 18px Arial';
        ctx.fillText(k.label, x + todayW / 2, y + 30);
        
        ctx.fillStyle = k.color;
        ctx.font = 'bold 30px Arial';
        ctx.fillText(k.val, x + todayW / 2, y + 70);
        
        if (k.subtext) {
            ctx.fillStyle = '#000000';
            ctx.font = 'bold 14px Arial';
            ctx.fillText(k.subtext, x + todayW / 2, y + 96);
        }
    });

    // Row 2: Month / Period Total KPIs
    ctx.textAlign = 'left';
    ctx.fillStyle = '#2563eb';
    ctx.font = 'bold 20px Arial';
    ctx.fillText("ИТОГОВЫЕ ПРОГНОЗНЫЕ ПОКАЗАТЕЛИ ЗА ВЕСЬ ПЕРИОД", 80, 335);

    const kpis = [
        { label: "Выработка (Листы)", val: kpiSheets, color: '#2563eb', subtext: "" },
        { label: "Выработка (Тонны)", val: kpiTons, color: '#059669', subtext: kpiTonsDetail },
        { label: "Остаток (Листы)", val: kpiLagSheets, color: '#7c3aed', subtext: kpiLagSheetsDetail },
        { label: "Остаток (Тонны)", val: kpiLagTons, color: '#6366f1', subtext: kpiLagTonsDetail },
        { label: "Ср. % плана", val: kpiAvgPlan, color: '#d97706', subtext: kpiPlanDetail },
        { label: "% 1-го сорта", val: kpiFirstGrade, color: '#16a34a', subtext: kpiFirstGradeDetail },
        { label: "% брака", val: kpiDefect, color: '#dc2626', subtext: kpiDefectDetail }
    ];
    
    const kpiW = (cw - 160) / 7;
    kpis.forEach((k, idx) => {
        const x = 80 + idx * kpiW;
        const y = 350;
        
        const cardW = kpiW - 14;
        const cardX = x + 7;
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(cardX, y, cardW, 110);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.strokeRect(cardX, y, cardW, 110);
        
        ctx.textAlign = 'center';
        ctx.fillStyle = '#334155';
        ctx.font = 'bold 16px Arial';
        ctx.fillText(k.label, x + kpiW / 2, y + 28);
        
        ctx.fillStyle = k.color;
        ctx.font = 'bold 26px Arial';
        ctx.fillText(k.val, x + kpiW / 2, y + 68);
        
        if (k.subtext) {
            ctx.fillStyle = '#000000'; // Pure black, bold subtext for perfect print visibility
            ctx.font = 'bold 13px Arial';
            ctx.fillText(k.subtext, x + kpiW / 2, y + 95);
        }
    });
    
    // Draw chart if exists
    if (chartDailySheets) {
        const chartImgSrc = chartDailySheets.canvas;
        const chartW = cw - 160;
        const chartH = Math.min(560, chartImgSrc.height * (chartW / chartImgSrc.width));
        
        const tmp = document.createElement('canvas');
        tmp.width = chartImgSrc.width;
        tmp.height = chartImgSrc.height;
        const tmpCtx = tmp.getContext('2d');
        tmpCtx.fillStyle = 'white';
        tmpCtx.fillRect(0, 0, tmp.width, tmp.height);
        tmpCtx.drawImage(chartImgSrc, 0, 0);
        
        ctx.drawImage(tmp, 80, 490, chartW, chartH);
    } else {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#94a3b8';
        ctx.font = '24px Arial';
        ctx.fillText("График не найден", cw / 2, 700);
    }
    
    // Footer
    ctx.textAlign = 'center';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px Arial';
    ctx.fillText(`Сгенерировано автоматически порталом Tectum. Дата экспорта: ${new Date().toLocaleString()}`, cw / 2, ch - 50);
    
    // Open standard Print / Microsoft PDF dialog
    const imgDataUrl = canvas.toDataURL('image/png');
    const printWindow = window.open('', '_blank');
    if (printWindow) {
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${titleText} - ${lineLabel} - ${periodLabel}</title>
                <style>
                    @page {
                        size: A4 landscape;
                        margin: 0;
                    }
                    html, body {
                        margin: 0;
                        padding: 0;
                        background: #ffffff;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        width: 100%;
                        height: 100vh;
                        overflow: hidden;
                    }
                    img {
                        width: 100vw;
                        height: 100vh;
                        object-fit: contain;
                    }
                </style>
            </head>
            <body>
                <img src="${imgDataUrl}" onload="window.print(); window.onafterprint = function(){ window.close(); };" />
            </body>
            </html>
        `);
        printWindow.document.close();
    } else {
        // Fallback to jsPDF direct download if popup blocker is active
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        doc.addImage(imgDataUrl, 'PNG', 0, 0, 297, 210);
        doc.save(`Tectum_Report_${monthVal}.pdf`);
    }
}

async function syncNormsFromGoogle() {
    const statusEl = document.getElementById('norms-sync-status');
    if (statusEl) {
        statusEl.innerText = "⏳ Синхронизация...";
        statusEl.style.color = "var(--text-secondary)";
    }
    
    try {
        const res = await fetch('/api/norms/sync_from_google', {
            method: 'POST'
        });
        const data = await res.json();
        
        if (res.ok && data.status === 'success') {
            if (statusEl) {
                statusEl.innerText = "✅ Нормативы успешно обновлены!";
                statusEl.style.color = "#22c55e";
            }
            // Перезагружаем нормы на клиенте
            await loadProductNorms();
        } else {
            if (statusEl) {
                statusEl.innerText = `❌ Ошибка: ${data.detail || 'Не удалось обновить'}`;
                statusEl.style.color = "var(--danger-color)";
            }
        }
    } catch (e) {
        console.error(e);
        if (statusEl) {
            statusEl.innerText = "❌ Ошибка сети при синхронизации";
            statusEl.style.color = "var(--danger-color)";
        }
    }
}

async function syncDowntimesFromGoogle() {
    const statusEl = document.getElementById('downtimes-sync-status');
    if (statusEl) {
        statusEl.innerText = "⏳ Синхронизация...";
        statusEl.style.color = "var(--text-secondary)";
    }
    
    try {
        const res = await fetch('/api/downtimes/directory/sync_from_google', {
            method: 'POST'
        });
        const data = await res.json();
        
        if (res.ok && data.status === 'success') {
            if (statusEl) {
                statusEl.innerText = "✅ Справочник простоев обновлен!";
                statusEl.style.color = "#22c55e";
            }
            // Перезагружаем разделы и причины на клиенте
            loadDowntimeDepartments();
        } else {
            if (statusEl) {
                statusEl.innerText = `❌ Ошибка: ${data.detail || 'Не удалось обновить'}`;
                statusEl.style.color = "var(--danger-color)";
            }
        }
    } catch (e) {
        console.error(e);
        if (statusEl) {
            statusEl.innerText = "❌ Ошибка сети при синхронизации";
            statusEl.style.color = "var(--danger-color)";
        }
    }
}



// --- Window Global Bindings ---
window.loadAnalyticsData = typeof loadAnalyticsData !== 'undefined' ? loadAnalyticsData : null;
window.renderAnalyticsKPIs = typeof renderAnalyticsKPIs !== 'undefined' ? renderAnalyticsKPIs : null;
window.renderAnalyticsCharts = typeof renderAnalyticsCharts !== 'undefined' ? renderAnalyticsCharts : null;
window.renderAnalyticsTable = typeof renderAnalyticsTable !== 'undefined' ? renderAnalyticsTable : null;
window.onDailyReportMonthChange = typeof onDailyReportMonthChange !== 'undefined' ? onDailyReportMonthChange : null;
window.toggleRangeControls = typeof toggleRangeControls !== 'undefined' ? toggleRangeControls : null;
window.loadDailyReport = typeof loadDailyReport !== 'undefined' ? loadDailyReport : null;
window.renderDailyReportCharts = typeof renderDailyReportCharts !== 'undefined' ? renderDailyReportCharts : null;
window.exportDailyReportPDF = typeof exportDailyReportPDF !== 'undefined' ? exportDailyReportPDF : null;
window.syncNormsFromGoogle = typeof syncNormsFromGoogle !== 'undefined' ? syncNormsFromGoogle : null;
window.syncDowntimesFromGoogle = typeof syncDowntimesFromGoogle !== 'undefined' ? syncDowntimesFromGoogle : null;
