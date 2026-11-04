/**
 * Tectum Portal — База простоев и оперативная классификация технолога
 * @canonical-pattern DowntimesTechnologistWorkspace
 * @version 20261103_dt_v1
 */

(function () {
    let dtCurrentFilter = {
        start_date: '',
        end_date: '',
        line: 'all',
        category: 'all',
        unclassified_only: false,
        search: '',
        view: 'feed' // 'feed' | 'summary'
    };

    let allFeedItems = [];
    let activePopover = null;

    // Справочник категорий с иконками, точками и каноническими стилями Tectum
    const DT_CATEGORIES = [
        { name: 'Механические', icon: 'fa-wrench', badgeClass: 'dt-cat-mech', dotColor: '#2563eb', dotHalo: 'rgba(37, 99, 235, 0.25)', stop: true },
        { name: 'Энергетические', icon: 'fa-bolt', badgeClass: 'dt-cat-energy', dotColor: '#ca8a04', dotHalo: 'rgba(202, 138, 4, 0.25)', stop: true },
        { name: 'Технологические', icon: 'fa-flask', badgeClass: 'dt-cat-tech', dotColor: '#9333ea', dotHalo: 'rgba(147, 51, 234, 0.25)', stop: true },
        { name: 'ТО и ППР', icon: 'fa-screwdriver-wrench', badgeClass: 'dt-cat-maint', dotColor: '#16a34a', dotHalo: 'rgba(22, 163, 74, 0.25)', stop: true },
        { name: 'Остановки не связанные с простоем оборудования', icon: 'fa-pause', badgeClass: 'dt-cat-nostop', dotColor: '#64748b', dotHalo: 'rgba(100, 116, 139, 0.25)', stop: false },
        { name: 'Санитарный день', icon: 'fa-soap', badgeClass: 'dt-cat-sanitary', dotColor: '#7c3aed', dotHalo: 'rgba(124, 58, 237, 0.25)', stop: true },
        { name: 'Без категории', icon: 'fa-circle-question', badgeClass: 'dt-cat-unclass', dotColor: '#dc2626', dotHalo: 'rgba(220, 38, 38, 0.25)', stop: true }
    ];

    function getCategoryMeta(catName) {
        if (!catName) return DT_CATEGORIES[6]; // Без категории
        const cLower = String(catName).trim().toLowerCase();
        for (const c of DT_CATEGORIES) {
            if (c.name.toLowerCase() === cLower) return c;
        }
        if (cLower.includes('механ')) return DT_CATEGORIES[0];
        if (cLower.includes('энерг') || cLower.includes('электр')) return DT_CATEGORIES[1];
        if (cLower.includes('технолог')) return DT_CATEGORIES[2];
        if (cLower.includes('то и ппр') || cLower.includes('ппр')) return DT_CATEGORIES[3];
        if (cLower.includes('без простоя') || cLower.includes('не связан')) return DT_CATEGORIES[4];
        if (cLower.includes('санитар')) return DT_CATEGORIES[5];
        return { name: catName, icon: 'fa-tag', badgeClass: 'dt-cat-nostop', dotColor: '#64748b', dotHalo: 'rgba(100, 116, 139, 0.25)', stop: true };
    }

    // ==========================================================================
    // @canonical-pattern CanonicalWeekDatePicker (Planner Standard)
    // ==========================================================================
    const MONTH_NAMES_RU = [
        'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
    ];

    let dtCurrentYear = new Date().getFullYear();
    let dtCurrentMonth = new Date().getMonth() + 1; // 1-12
    let dtSelectedWeek = null; // object { weekNum, startStr, endStr, label }
    let dtActiveDateMode = 'week'; // 'week' | 'all' | 'custom' | 'today' | 'yesterday'

    function getWeeksOfMonth(year, month) {
        const weeks = [];
        const firstDayOfMonth = new Date(year, month - 1, 1);
        let dayOfWeek = firstDayOfMonth.getDay();
        let diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday
        let currentMonday = new Date(year, month - 1, 1 + diff);
        const firstDayOfNextMonth = new Date(year, month, 1);

        while (currentMonday < firstDayOfNextMonth) {
            const currentSunday = new Date(currentMonday);
            currentSunday.setDate(currentMonday.getDate() + 6);

            const sy = currentMonday.getFullYear();
            const sm = String(currentMonday.getMonth() + 1).padStart(2, '0');
            const sd = String(currentMonday.getDate()).padStart(2, '0');

            const ey = currentSunday.getFullYear();
            const em = String(currentSunday.getMonth() + 1).padStart(2, '0');
            const ed = String(currentSunday.getDate()).padStart(2, '0');

            const weekNum = weeks.length + 1;
            weeks.push({
                weekNum: weekNum,
                startStr: `${sy}-${sm}-${sd}`,
                endStr: `${ey}-${em}-${ed}`,
                startDisplay: `${sd}.${sm}`,
                endDisplay: `${ed}.${em}`,
                label: `Неделя ${weekNum} (${sd}.${sm} - ${ed}.${em})`
            });

            currentMonday.setDate(currentMonday.getDate() + 7);
        }
        return weeks;
    }

    function findCurrentWeek(year, month) {
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const weeks = getWeeksOfMonth(year, month);
        for (const w of weeks) {
            if (todayStr >= w.startStr && todayStr <= w.endStr) {
                return w;
            }
        }
        return weeks.length > 0 ? weeks[0] : null;
    }

    function updateDtMonthLabel() {
        const lbl = document.getElementById('label-dt-month');
        if (lbl) {
            lbl.textContent = `${MONTH_NAMES_RU[dtCurrentMonth - 1]} ${dtCurrentYear}`;
        }
    }

    window.toggleDtDatePopover = function (type, event) {
        if (event) event.stopPropagation();
        closeDtCustomRangePopover();
        const popover = document.getElementById(`popover-dt-${type}`);
        const chip = document.getElementById(`btn-dt-${type}`);
        if (!popover) return;

        const isVisible = popover.style.display === 'block';
        closeAllDtPopovers();

        if (!isVisible) {
            if (type === 'month') {
                renderDtMonthPopoverList();
            } else if (type === 'week') {
                renderDtWeekPopoverList();
            }
            popover.style.display = 'block';
            if (chip) chip.classList.add('popover-open');
        }
    };

    function closeAllDtPopovers() {
        ['month', 'week'].forEach(t => {
            const pop = document.getElementById(`popover-dt-${t}`);
            const chip = document.getElementById(`btn-dt-${t}`);
            if (pop) pop.style.display = 'none';
            if (chip) chip.classList.remove('popover-open');
        });
    }

    function renderDtMonthPopoverList() {
        const listEl = document.getElementById('list-dt-month');
        if (!listEl) return;

        let html = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px 8px; border-bottom: 1px solid #f1f5f9; margin-bottom: 4px;">
                <button type="button" class="btn-time-now" onclick="changeDtYear(-1, event)"><i class="fa-solid fa-chevron-left"></i> ${dtCurrentYear - 1}</button>
                <span style="font-size: 12px; font-weight: 700; color: #1e293b;">${dtCurrentYear} год</span>
                <button type="button" class="btn-time-now" onclick="changeDtYear(1, event)">${dtCurrentYear + 1} <i class="fa-solid fa-chevron-right"></i></button>
            </div>
        `;

        MONTH_NAMES_RU.forEach((mName, idx) => {
            const mNum = idx + 1;
            const isSel = (dtCurrentMonth === mNum);
            html += `
                <div class="filter-option-item ${isSel ? 'selected week-option-active' : ''}" 
                     onclick="selectDtMonth(${mNum})" style="padding: 6px 10px;">
                    <div class="week-option-left">
                        <i class="fa-solid fa-calendar" style="color: ${isSel ? '#2563eb' : '#64748b'}; font-size: 13px; width: 16px; text-align: center;"></i>
                        <span class="filter-option-text ${isSel ? 'font-bold' : ''}" style="font-size: 12.5px;">${mName} ${dtCurrentYear}</span>
                    </div>
                    ${isSel ? '<i class="fa-solid fa-check week-option-checkmark"></i>' : ''}
                </div>
            `;
        });

        listEl.innerHTML = html;
    }

    window.changeDtYear = function (delta, event) {
        if (event) event.stopPropagation();
        dtCurrentYear += delta;
        renderDtMonthPopoverList();
    };

    window.selectDtMonth = function (monthNum) {
        dtCurrentMonth = monthNum;
        closeAllDtPopovers();
        updateDtMonthLabel();

        const now = new Date();
        if (now.getFullYear() === dtCurrentYear && (now.getMonth() + 1) === dtCurrentMonth) {
            const curW = findCurrentWeek(dtCurrentYear, dtCurrentMonth);
            selectDtWeek(curW ? curW.weekNum : 1);
        } else {
            selectDtWeek(1);
        }
    };

    function renderDtWeekPopoverList() {
        const listEl = document.getElementById('list-dt-week');
        if (!listEl) return;

        const weeks = getWeeksOfMonth(dtCurrentYear, dtCurrentMonth);
        let html = '';

        const isMonthSel = (dtSelectedWeek === null && dtActiveDateMode === 'all');
        html += `
            <div class="filter-option-item ${isMonthSel ? 'selected week-option-active' : ''}" 
                 onclick="selectDtWholeMonth()" style="padding: 7px 10px; border-bottom: 1px solid #f1f5f9; margin-bottom: 4px;">
                <div class="week-option-left">
                    <i class="fa-solid fa-calendar-check" style="color: ${isMonthSel ? '#2563eb' : '#64748b'}; font-size: 13px; width: 16px; text-align: center;"></i>
                    <span class="filter-option-text ${isMonthSel ? 'font-bold' : ''}" style="font-size: 12.5px;">Весь месяц (${MONTH_NAMES_RU[dtCurrentMonth - 1]} ${dtCurrentYear})</span>
                </div>
                ${isMonthSel ? '<i class="fa-solid fa-check week-option-checkmark"></i>' : ''}
            </div>
        `;

        weeks.forEach(w => {
            const isSel = (dtSelectedWeek && dtSelectedWeek.weekNum === w.weekNum && dtActiveDateMode === 'week');
            html += `
                <div class="filter-option-item ${isSel ? 'selected week-option-active' : ''}" 
                     onclick="selectDtWeek(${w.weekNum})" style="padding: 7px 10px;">
                    <div class="week-option-left">
                        <i class="fa-solid fa-calendar-week" style="color: ${isSel ? '#2563eb' : '#64748b'}; font-size: 13px; width: 16px; text-align: center;"></i>
                        <span class="filter-option-text ${isSel ? 'font-bold' : ''}" style="font-size: 12.5px;">${w.label}</span>
                    </div>
                    ${isSel ? '<i class="fa-solid fa-check week-option-checkmark"></i>' : ''}
                </div>
            `;
        });

        listEl.innerHTML = html;
    }

    window.selectDtWeek = function (weekNum) {
        const weeks = getWeeksOfMonth(dtCurrentYear, dtCurrentMonth);
        const w = weeks.find(item => item.weekNum === weekNum) || weeks[0];
        if (!w) return;

        dtSelectedWeek = w;
        dtActiveDateMode = 'week';
        closeAllDtPopovers();
        hideDtRangeActiveIndicator();

        updateDtMonthLabel();
        const weekLabel = document.getElementById('label-dt-week');
        if (weekLabel) weekLabel.textContent = w.label;

        const sInput = document.getElementById('dt-date-from');
        const eInput = document.getElementById('dt-date-to');
        if (sInput) sInput.value = w.startStr;
        if (eInput) eInput.value = w.endStr;
        dtCurrentFilter.start_date = w.startStr;
        dtCurrentFilter.end_date = w.endStr;

        const curW = findCurrentWeek(new Date().getFullYear(), new Date().getMonth() + 1);
        const isCurrentWeek = (curW && curW.startStr === w.startStr && curW.endStr === w.endStr);
        document.querySelectorAll('.dt-date-preset').forEach(b => b.classList.remove('active'));
        if (isCurrentWeek) {
            const btnWeek = document.getElementById('btn-dt-preset-week');
            if (btnWeek) btnWeek.classList.add('active');
        }

        loadDowntimesData();
    };

    window.selectDtWholeMonth = function () {
        dtSelectedWeek = null;
        dtActiveDateMode = 'all';
        closeAllDtPopovers();
        hideDtRangeActiveIndicator();

        updateDtMonthLabel();
        const weekLabel = document.getElementById('label-dt-week');
        if (weekLabel) weekLabel.textContent = `Весь месяц (${MONTH_NAMES_RU[dtCurrentMonth - 1]})`;

        const lastDay = new Date(dtCurrentYear, dtCurrentMonth, 0).getDate();
        const startStr = `${dtCurrentYear}-${String(dtCurrentMonth).padStart(2, '0')}-01`;
        const endStr = `${dtCurrentYear}-${String(dtCurrentMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        const sInput = document.getElementById('dt-date-from');
        const eInput = document.getElementById('dt-date-to');
        if (sInput) sInput.value = startStr;
        if (eInput) eInput.value = endStr;
        dtCurrentFilter.start_date = startStr;
        dtCurrentFilter.end_date = endStr;

        document.querySelectorAll('.dt-date-preset').forEach(b => b.classList.remove('active'));
        const now = new Date();
        if (now.getFullYear() === dtCurrentYear && (now.getMonth() + 1) === dtCurrentMonth) {
            const btnMonth = document.querySelector('.dt-date-preset[onclick*="month"]');
            if (btnMonth) btnMonth.classList.add('active');
        }

        loadDowntimesData();
    };

    // Переключение пресетов дат
    window.setDtDatePreset = function (preset, btnEl) {
        if (btnEl) {
            document.querySelectorAll('.dt-date-preset').forEach(b => b.classList.remove('active'));
            btnEl.classList.add('active');
        }
        hideDtRangeActiveIndicator();

        const today = new Date();

        if (preset === 'week') {
            dtCurrentYear = today.getFullYear();
            dtCurrentMonth = today.getMonth() + 1;
            const curW = findCurrentWeek(dtCurrentYear, dtCurrentMonth);
            if (curW) {
                selectDtWeek(curW.weekNum);
            }
            return;
        } else if (preset === 'month') {
            dtCurrentYear = today.getFullYear();
            dtCurrentMonth = today.getMonth() + 1;
            selectDtWholeMonth();
            return;
        } else if (preset === 'today') {
            dtActiveDateMode = 'today';
            dtSelectedWeek = null;
            const dayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const sInput = document.getElementById('dt-date-from');
            const eInput = document.getElementById('dt-date-to');
            if (sInput) sInput.value = dayStr;
            if (eInput) eInput.value = dayStr;
            dtCurrentFilter.start_date = dayStr;
            dtCurrentFilter.end_date = dayStr;

            const weekLabel = document.getElementById('label-dt-week');
            if (weekLabel) weekLabel.textContent = `Сегодня (${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')})`;
            loadDowntimesData();
            return;
        } else if (preset === 'yesterday') {
            dtActiveDateMode = 'yesterday';
            dtSelectedWeek = null;
            const yDate = new Date();
            yDate.setDate(today.getDate() - 1);
            const dayStr = `${yDate.getFullYear()}-${String(yDate.getMonth() + 1).padStart(2, '0')}-${String(yDate.getDate()).padStart(2, '0')}`;
            const sInput = document.getElementById('dt-date-from');
            const eInput = document.getElementById('dt-date-to');
            if (sInput) sInput.value = dayStr;
            if (eInput) eInput.value = dayStr;
            dtCurrentFilter.start_date = dayStr;
            dtCurrentFilter.end_date = dayStr;

            const weekLabel = document.getElementById('label-dt-week');
            if (weekLabel) weekLabel.textContent = `Вчера (${String(yDate.getDate()).padStart(2, '0')}.${String(yDate.getMonth() + 1).padStart(2, '0')})`;
            loadDowntimesData();
            return;
        }
    };

    // Custom Date Range Popover
    window.toggleDtCustomRangePopover = function (event) {
        if (event) event.stopPropagation();
        closeAllDtPopovers();
        const pop = document.getElementById('dt-custom-date-popover');
        if (!pop) return;
        const isVisible = pop.style.display === 'block';
        if (isVisible) {
            pop.style.display = 'none';
        } else {
            const sInput = document.getElementById('dt-date-from');
            const eInput = document.getElementById('dt-date-to');
            const customFrom = document.getElementById('dt-custom-from');
            const customTo = document.getElementById('dt-custom-to');
            if (customFrom && sInput && sInput.value) customFrom.value = sInput.value;
            if (customTo && eInput && eInput.value) customTo.value = eInput.value;
            pop.style.display = 'block';
        }
    };

    window.closeDtCustomRangePopover = function () {
        const pop = document.getElementById('dt-custom-date-popover');
        if (pop) pop.style.display = 'none';
    };

    window.applyDtCustomRange = function () {
        const customFrom = document.getElementById('dt-custom-from');
        const customTo = document.getElementById('dt-custom-to');
        if (!customFrom || !customTo || !customFrom.value || !customTo.value) {
            if (typeof showToast === 'function') showToast('Выберите обе даты');
            return;
        }

        const sVal = customFrom.value;
        const eVal = customTo.value;
        if (sVal > eVal) {
            if (typeof showToast === 'function') showToast('Начальная дата не может быть позже конечной');
            return;
        }

        const sInput = document.getElementById('dt-date-from');
        const eInput = document.getElementById('dt-date-to');
        if (sInput) sInput.value = sVal;
        if (eInput) eInput.value = eVal;
        dtCurrentFilter.start_date = sVal;
        dtCurrentFilter.end_date = eVal;

        dtActiveDateMode = 'custom';
        dtSelectedWeek = null;

        document.querySelectorAll('.dt-date-preset').forEach(b => b.classList.remove('active'));

        const indicator = document.getElementById('dt-range-active-indicator');
        if (indicator) indicator.style.display = 'inline-block';
        const rangeBtn = document.getElementById('btn-dt-custom-range');
        if (rangeBtn) rangeBtn.classList.add('active');

        const fParts = sVal.split('-');
        const tParts = eVal.split('-');
        const weekLabel = document.getElementById('label-dt-week');
        if (weekLabel) {
            weekLabel.textContent = `${fParts[2]}.${fParts[1]} - ${tParts[2]}.${tParts[1]}`;
        }

        closeDtCustomRangePopover();
        loadDowntimesData();
    };

    window.resetDtCustomRange = function () {
        closeDtCustomRangePopover();
        window.setDtDatePreset('week', document.getElementById('btn-dt-preset-week'));
    };

    function hideDtRangeActiveIndicator() {
        const indicator = document.getElementById('dt-range-active-indicator');
        if (indicator) indicator.style.display = 'none';
        const rangeBtn = document.getElementById('btn-dt-custom-range');
        if (rangeBtn) rangeBtn.classList.remove('active');
    }

    window.applyDtQuickPreset = function (preset) {
        const today = new Date();
        const customFrom = document.getElementById('dt-custom-from');
        const customTo = document.getElementById('dt-custom-to');
        if (!customFrom || !customTo) return;

        const formatDate = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        if (preset === '7d') {
            const f = new Date();
            f.setDate(today.getDate() - 6);
            customFrom.value = formatDate(f);
            customTo.value = formatDate(today);
        } else if (preset === '14d') {
            const f = new Date();
            f.setDate(today.getDate() - 13);
            customFrom.value = formatDate(f);
            customTo.value = formatDate(today);
        } else if (preset === 'this_month') {
            const f = new Date(today.getFullYear(), today.getMonth(), 1);
            const l = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            customFrom.value = formatDate(f);
            customTo.value = formatDate(l);
        } else if (preset === 'prev_month') {
            const f = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const l = new Date(today.getFullYear(), today.getMonth(), 0);
            customFrom.value = formatDate(f);
            customTo.value = formatDate(l);
        }
    };

    // Инициализация вкладки
    function initDowntimesWorkspace() {
        const today = new Date();
        dtCurrentYear = today.getFullYear();
        dtCurrentMonth = today.getMonth() + 1;
        updateDtMonthLabel();

        const curW = findCurrentWeek(dtCurrentYear, dtCurrentMonth);
        if (curW) {
            dtSelectedWeek = curW;
            dtActiveDateMode = 'week';
            const weekLabel = document.getElementById('label-dt-week');
            if (weekLabel) weekLabel.textContent = curW.label;

            const sInput = document.getElementById('dt-date-from');
            const eInput = document.getElementById('dt-date-to');
            if (sInput) sInput.value = curW.startStr;
            if (eInput) eInput.value = curW.endStr;
            dtCurrentFilter.start_date = curW.startStr;
            dtCurrentFilter.end_date = curW.endStr;
        }

        // Закрытие поповеров при клике вне
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.popover-anchor-wrap') && !e.target.closest('.toolbar-date-chip') && !e.target.closest('.date-range-popover')) {
                closeAllDtPopovers();
                closeDtCustomRangePopover();
            }
            if (activePopover && !e.target.closest('.dt-popover-menu') && !e.target.closest('.dt-cat-picker-btn')) {
                activePopover.style.display = 'none';
                activePopover = null;
            }
        });

        loadDowntimesData();
    }
    window.initDowntimesWorkspace = initDowntimesWorkspace;
    // Переключение фильтра: Все / Только требующие классификации
    window.toggleDtUnclassifiedOnly = function (unclassOnly) {
        dtCurrentFilter.unclassified_only = unclassOnly;

        const btnAll = document.getElementById('btn-dt-filter-all');
        const btnUnclass = document.getElementById('btn-dt-filter-unclass');

        if (unclassOnly) {
            if (btnAll) btnAll.classList.remove('active');
            if (btnUnclass) btnUnclass.classList.add('active');
        } else {
            if (btnAll) btnAll.classList.add('active');
            if (btnUnclass) btnUnclass.classList.remove('active');
        }

        loadDowntimesData();
    };

    // Переключение вида (Журнал разметки vs Сводный отчет)
    window.setDtViewMode = function (mode) {
        dtCurrentFilter.view = mode;

        const btnFeed = document.getElementById('btn-dt-view-feed');
        const btnSummary = document.getElementById('btn-dt-view-summary');
        const feedContainer = document.getElementById('dt-feed-container');
        const summaryContainer = document.getElementById('dt-summary-container');

        if (mode === 'feed') {
            if (btnFeed) btnFeed.classList.add('active');
            if (btnSummary) btnSummary.classList.remove('active');
            if (feedContainer) feedContainer.style.display = 'block';
            if (summaryContainer) summaryContainer.style.display = 'none';
            loadDowntimesFeed();
        } else {
            if (btnFeed) btnFeed.classList.remove('active');
            if (btnSummary) btnSummary.classList.add('active');
            if (feedContainer) feedContainer.style.display = 'none';
            if (summaryContainer) summaryContainer.style.display = 'block';
            loadDowntimesSummary();
        }
    };

    // Главная функция загрузки в зависимости от активного вида
    window.loadDowntimesData = async function (highlightId = null) {
        const sInput = document.getElementById('dt-date-from');
        const eInput = document.getElementById('dt-date-to');
        const lineSelect = document.getElementById('dt-filter-line');
        const catSelect = document.getElementById('dt-filter-category');
        const searchInput = document.getElementById('dt-filter-search');

        if (sInput && sInput.value) dtCurrentFilter.start_date = sInput.value;
        if (eInput && eInput.value) dtCurrentFilter.end_date = eInput.value;
        if (lineSelect) dtCurrentFilter.line = lineSelect.value;
        if (catSelect) dtCurrentFilter.category = catSelect.value;
        if (searchInput) dtCurrentFilter.search = searchInput.value;

        if (dtCurrentFilter.view === 'feed') {
            await loadDowntimesFeed(highlightId);
        } else {
            await loadDowntimesSummary();
        }
    };

    // 1. Загрузка ленты быстрой разметки
    async function loadDowntimesFeed(highlightId = null) {
        const tbody = document.getElementById('dt-feed-tbody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: #64748b;">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.3rem; margin-bottom: 0.5rem; display: block; color: #2563eb;"></i>
                Загрузка простоев за выбранный период...
            </td></tr>`;
        }

        try {
            const params = new URLSearchParams({
                start_date: dtCurrentFilter.start_date,
                end_date: dtCurrentFilter.end_date,
                line: dtCurrentFilter.line,
                category: dtCurrentFilter.category,
                unclassified_only: dtCurrentFilter.unclassified_only,
                search: dtCurrentFilter.search,
                limit: 300
            });

            const res = await fetch(`/api/downtimes/feed?${params.toString()}`);
            if (!res.ok) throw new Error('Ошибка загрузки ленты');
            const data = await res.json();

            allFeedItems = data.items || [];

            // Обновляем счетчики на кнопках-пилюлях
            const totalCountEl = document.getElementById('dt-feed-total-count');
            const unclassCountEl = document.getElementById('dt-feed-unclass-count');
            if (totalCountEl) totalCountEl.textContent = data.total || 0;
            if (unclassCountEl) unclassCountEl.textContent = data.unclassified_count || 0;

            renderFeedTable(allFeedItems, highlightId);
        } catch (e) {
            console.error(e);
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: #ef4444;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.3rem; margin-bottom: 0.5rem; display: block;"></i>
                    Не удалось загрузить данные (${e.message})
                </td></tr>`;
            }
        }
    }

    // Рендер таблицы быстрой разметки
    function renderFeedTable(items, highlightId = null) {
        const tbody = document.getElementById('dt-feed-tbody');
        if (!tbody) return;

        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2.5rem; color: #64748b;">
                <div style="font-size: 1.7rem; margin-bottom: 0.5rem;">🎉</div>
                <b>Нет простоев за выбранный период</b>
                <div style="font-size: 0.78rem; color: #94a3b8; margin-top: 4px;">Все записи классифицированы или простой линии отсутствовал</div>
            </td></tr>`;
            return;
        }

        let html = '';
        items.forEach(d => {
            const meta = getCategoryMeta(d.category);
            const isStop = d.is_equipment_downtime !== false;
            const shiftIcon = d.shift_name === 'Ночь' ? '🌙 Ночь' : '☀️ День';
            const cleanDesc = d.description || '';
            const nodeName = d.node && d.node !== 'Основное оборудование' ? `${d.node}: ` : '';

            html += `
            <tr id="dt-row-${d.id}" data-id="${d.id}">
                <td>
                    <div style="font-weight: 700; color: #0f172a;">${d.date}</div>
                    <div style="font-size: 0.72rem; color: #64748b; margin-top: 2px;">
                        <span>${shiftIcon}</span> · <span style="font-weight: 600;">${escapeHtml(d.master_name)}</span>
                    </div>
                </td>
                <td>
                    <span style="font-weight: 600; color: #334155;">${escapeHtml(d.line)}</span>
                </td>
                <td>
                    <div style="font-family: 'SF Mono', Consolas, monospace; font-size: 0.8rem; font-weight: 700; color: #0f172a;">
                        ${d.start_time} - ${d.end_time}
                    </div>
                    <div style="font-size: 0.72rem; color: #2563eb; font-weight: 700; margin-top: 2px;">
                        ⏱️ ${(d.duration_minutes !== undefined && d.duration_minutes !== null ? (d.duration_minutes >= 60 ? Math.floor(d.duration_minutes/60) + " ч " + (d.duration_minutes%60) + " мин" : d.duration_minutes + " мин") : (d.duration || 0) + " мин")}
                    </div>
                </td>
                <td class="dt-reason-cell">
                    <div class="dt-reason-text" id="dt-desc-${d.id}">
                        <span class="dt-reason-node">${escapeHtml(nodeName)}</span>${escapeHtml(cleanDesc)}
                    </div>
                    ${cleanDesc.length > 70 ? `<span class="dt-expand-link" onclick="toggleDtReasonExpand(${d.id})">Развернуть...</span>` : ''}
                </td>
                <td style="position: relative;">
                    <button type="button" class="dt-cat-picker-btn ${meta.badgeClass}" id="btn-dt-cat-${d.id}"
                        onclick="openCategoryPopover(this, ${d.id}, '${escapeHtml(d.category || '')}', ${isStop}, event)">
                        <span class="dt-cat-dot" style="background: ${meta.dotColor}; box-shadow: 0 0 0 3px ${meta.dotHalo};"></span>
                        <span id="label-dt-cat-${d.id}">${escapeHtml(meta.name)}</span>
                        <i class="fa-solid fa-chevron-down" style="font-size: 0.65rem; opacity: 0.7; margin-left: auto;"></i>
                    </button>
                </td>
                <td style="text-align: center;">
                    <div class="dt-stop-badge ${isStop ? 'dt-stop-true' : 'dt-stop-false'}" id="badge-dt-stop-${d.id}"
                        onclick="toggleEquipmentStopFast(${d.id}, ${isStop})"
                        title="Нажмите для переключения (Простой оборудования / Технологическая пауза)">
                        <span>${isStop ? '🛑 Стоп линии' : '⏸️ Без простоя'}</span>
                    </div>
                </td>
            </tr>
            `;
        });

        tbody.innerHTML = html;

        if (highlightId) {
            setTimeout(() => {
                const row = document.getElementById(`dt-row-${highlightId}`);
                if (row) {
                    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    row.classList.add('dt-row-highlight');
                    setTimeout(() => row.classList.remove('dt-row-highlight'), 3500);
                }
            }, 80);
        }
    }

    // Разворачивание текста описания
    window.toggleDtReasonExpand = function (id) {
        const el = document.getElementById(`dt-desc-${id}`);
        if (!el) return;
        el.classList.toggle('expanded');
        const link = el.nextElementSibling;
        if (link && link.classList.contains('dt-expand-link')) {
            link.textContent = el.classList.contains('expanded') ? 'Свернуть' : 'Развернуть...';
        }
    };

    // Открытие поповера выбора категории прямо под кнопкой
    window.openCategoryPopover = function (btnEl, downtimeId, currentCategory, isEquipmentStop, event) {
        if (event) event.stopPropagation();

        let popover = document.getElementById('dt-global-category-popover');
        if (!popover) {
            popover = document.createElement('div');
            popover.id = 'dt-global-category-popover';
            popover.className = 'dt-popover-menu';
            document.body.appendChild(popover);
        }

        const rect = btnEl.getBoundingClientRect();
        popover.style.top = `${rect.bottom + window.scrollY + 4}px`;
        popover.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 240)}px`;
        popover.style.display = 'block';

        let itemsHtml = '';
        DT_CATEGORIES.forEach(c => {
            const isSelected = (currentCategory || '').toLowerCase() === c.name.toLowerCase();
            itemsHtml += `
            <div class="dt-popover-item ${isSelected ? 'active' : ''}" onclick="selectCategoryFast(${downtimeId}, '${c.name}', ${c.stop})">
                <span class="dt-cat-dot" style="background: ${c.dotColor}; box-shadow: 0 0 0 3px ${c.dotHalo};"></span>
                <span>${c.name}</span>
            </div>
            `;
        });

        popover.innerHTML = itemsHtml;
        activePopover = popover;
    };

    // Быстрое сохранение категории по клику в поповере
    window.selectCategoryFast = async function (downtimeId, newCategory, defaultIsStop) {
        if (activePopover) {
            activePopover.style.display = 'none';
            activePopover = null;
        }

        const btnEl = document.getElementById(`btn-dt-cat-${downtimeId}`);
        const labelEl = document.getElementById(`label-dt-cat-${downtimeId}`);
        const rowEl = document.getElementById(`dt-row-${downtimeId}`);
        const stopBadgeEl = document.getElementById(`badge-dt-stop-${downtimeId}`);

        if (labelEl) labelEl.textContent = 'Сохранение...';

        try {
            const res = await fetch(`/api/downtimes/${downtimeId}/classify`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category: newCategory,
                    is_equipment_downtime: defaultIsStop
                })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Ошибка сохранения');
            }

            const result = await res.json();
            const meta = getCategoryMeta(result.category);

            if (btnEl) {
                btnEl.className = `dt-cat-picker-btn ${meta.badgeClass}`;
                btnEl.innerHTML = `<span class="dt-cat-dot" style="background: ${meta.dotColor}; box-shadow: 0 0 0 3px ${meta.dotHalo};"></span> <span id="label-dt-cat-${downtimeId}">${escapeHtml(meta.name)}</span> <i class="fa-solid fa-chevron-down" style="font-size: 0.65rem; opacity: 0.7; margin-left: auto;"></i>`;
            }

            if (stopBadgeEl) {
                const isStop = result.is_equipment_downtime;
                stopBadgeEl.className = `dt-stop-badge ${isStop ? 'dt-stop-true' : 'dt-stop-false'}`;
                stopBadgeEl.innerHTML = `<span>${isStop ? '🛑 Стоп линии' : '⏸️ Без простоя'}</span>`;
                stopBadgeEl.setAttribute('onclick', `toggleEquipmentStopFast(${downtimeId}, ${isStop})`);
            }

            if (rowEl) {
                rowEl.classList.add('row-just-saved');
                setTimeout(() => rowEl.classList.remove('row-just-saved'), 1200);
            }

            // Уменьшаем счетчик неразмеченных
            const unclassCountEl = document.getElementById('dt-feed-unclass-count');
            if (unclassCountEl) {
                const cur = parseInt(unclassCountEl.textContent, 10) || 0;
                if (cur > 0 && newCategory !== 'Без категории') {
                    unclassCountEl.textContent = cur - 1;
                }
            }

            showDtToast('✓ Категория успешно сохранена', 'success');
        } catch (e) {
            console.error(e);
            showDtToast(e.message, 'error');
            loadDowntimesFeed();
        }
    };

    // Быстрое переключение признака простоя оборудования (🛑/⏸️)
    window.toggleEquipmentStopFast = async function (downtimeId, currentVal) {
        const newVal = !currentVal;
        const badgeEl = document.getElementById(`badge-dt-stop-${downtimeId}`);
        if (badgeEl) {
            badgeEl.className = `dt-stop-badge ${newVal ? 'dt-stop-true' : 'dt-stop-false'}`;
            badgeEl.innerHTML = `<span>${newVal ? '🛑 Стоп линии' : '⏸️ Без простоя'}</span>`;
            badgeEl.setAttribute('onclick', `toggleEquipmentStopFast(${downtimeId}, ${newVal})`);
        }

        try {
            const res = await fetch(`/api/downtimes/${downtimeId}/classify`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_equipment_downtime: newVal })
            });
            if (!res.ok) throw new Error('Ошибка обновления статуса');
            showDtToast(`✓ Простой оборудования: ${newVal ? 'Да' : 'Нет'}`, 'success');
        } catch (e) {
            console.error(e);
            showDtToast(e.message, 'error');
            loadDowntimesFeed();
        }
    };

    // 2. Загрузка сводного отчета по категориям (Вид Excel)
    async function loadDowntimesSummary() {
        const container = document.getElementById('dt-summary-content');
        if (container) {
            container.innerHTML = `<div style="text-align: center; padding: 3rem; color: #64748b;">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; margin-bottom: 0.6rem; display: block; color: #059669;"></i>
                Формирование сводного отчета по категориям...
            </div>`;
        }

        try {
            const params = new URLSearchParams({
                start_date: dtCurrentFilter.start_date,
                end_date: dtCurrentFilter.end_date,
                line: dtCurrentFilter.line
            });

            const res = await fetch(`/api/downtimes/report-summary?${params.toString()}`);
            if (!res.ok) throw new Error('Ошибка формирования сводки');
            const data = await res.json();

            renderSummaryReport(data);
        } catch (e) {
            console.error(e);
            if (container) {
                container.innerHTML = `<div style="text-align: center; padding: 2.5rem; color: #ef4444;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block;"></i>
                    Не удалось загрузить сводный отчет (${e.message})
                </div>`;
            }
        }
    }

    // Рендер сводного отчета
    function renderSummaryReport(data) {
        const container = document.getElementById('dt-summary-content');
        if (!container) return;

        const k = data.kpi || {};
        const cats = data.categories || [];
        const topRecurring = data.top_recurring_losses || [];
        const ann = k.annualized || {};

        let html = `
        <!-- Верхняя аналитическая панель KPI -->
        <div class="dt-kpi-summary-box">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 8px;">
                <div>
                    <h3 style="margin: 0; font-size: 1.18rem; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px;">
                        <span>📊</span> Простои и потери производительности за период: ${data.start_date} — ${data.end_date}
                    </h3>
                    <div style="font-size: 0.78rem; color: #64748b; margin-top: 3px;">
                        Линия: <b>${escapeHtml(data.line)}</b> · Анализируемый интервал: <b>${k.num_days || 1} дн. (${k.total_operating_hours || 0} ч)</b> · Такт: <b>6 об. (24 с) = 1 накат = 2 листа</b>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <button type="button" class="btn-dt-action primary-sheets" onclick="exportDowntimesToGoogleSheets(this)">
                        <i class="fa-solid fa-file-excel"></i>
                        <span>Выгрузить в Google Таблицу</span>
                    </button>
                </div>
            </div>

            <!-- Верхний ряд KPI (Выработка, Потери, Финансы, Годовой эквивалент) -->
            <div class="dt-kpi-row-top" style="grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));">
                <!-- 1. Время & Доступность -->
                <div class="dt-kpi-card-item">
                    <div class="kpi-label">Время работы линии</div>
                    <div class="kpi-val">${k.total_operating_hours || 0} ч</div>
                    <div class="dt-sub-metric">
                        <i class="fa-solid fa-gauge-high" style="color: #2563eb;"></i>
                        <span>Готовность: <b>${k.availability_rate_percent || 100}%</b></span>
                    </div>
                </div>

                <!-- 2. Факт / План формовки -->
                <div class="dt-kpi-card-item">
                    <div class="kpi-label">Факт формовки (ЛФМ)</div>
                    <div class="kpi-val" style="color: #059669;">${(k.fact_sheets || 0).toLocaleString()} шт</div>
                    <div class="dt-sub-metric">
                        <span>План: ${(k.plan_sheets || 0).toLocaleString()} шт</span>
                    </div>
                </div>

                <!-- 3. Недовыпуск продукции -->
                <div class="dt-kpi-card-item">
                    <div class="kpi-label">Недовыпуск от простоев</div>
                    <div class="kpi-val" style="color: #dc2626;">-${(k.total_lost_sheets || k.underproduction_sheets || 0).toLocaleString()} шт</div>
                    <div class="dt-sub-metric" style="color: #ea580c;">
                        <i class="fa-solid fa-weight-hanging"></i>
                        <span>-${(k.total_lost_tons || 0)} т · Потери: <b>-${k.capacity_loss_percent || 0}%</b></span>
                    </div>
                </div>

                <!-- 4. Упущенная маржа -->
                <div class="dt-kpi-card-item">
                    <div class="kpi-label">Упущенная маржа (период)</div>
                    <div class="kpi-val" style="color: #dc2626;">-${(k.total_lost_margin_tenge || k.underproduction_tenge || 0).toLocaleString()} ₸</div>
                    <div class="dt-sub-metric">
                        <span>Выручка: -${(k.total_lost_revenue_tenge || 0).toLocaleString()} ₸</span>
                    </div>
                </div>

                <!-- 5. Годовой эквивалент потерь (Annual Risk) -->
                <div class="dt-kpi-card-item annual-risk">
                    <div class="kpi-label">
                        <span>Годовой риск потерь</span>
                        <span class="dt-annual-pill">365 дней</span>
                    </div>
                    <div class="kpi-val">-${(ann.annual_margin_loss_tenge || 0).toLocaleString()} ₸/год</div>
                    <div class="dt-sub-metric" style="color: #9f1239;">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <span>-${(ann.annual_lost_sheets || 0).toLocaleString()} шт/год · ${(ann.annual_lost_hours || 0)} ч/год</span>
                    </div>
                </div>
            </div>

            <!-- Сводная строка часов по категориям -->
            <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #64748b; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
                <span>Всего часов простоев: <b style="color: #0f172a; font-size: 0.95rem; font-family: monospace;">${k.total_downtime_formatted || '0:00:00'}</b> (со стопом: <b style="color: #dc2626; font-size: 0.95rem; font-family: monospace;">${k.total_stop_formatted || '0:00:00'}</b>)</span>
                <span style="font-size: 0.72rem; color: #94a3b8;">Потенциал без простоев: <b>${(k.potential_sheets || 0).toLocaleString()} шт</b></span>
            </div>
            <div class="dt-kpi-hours-deck">
        `;

        cats.forEach(c => {
            html += `
            <div class="dt-kpi-hour-chip" style="background: ${c.color}25; border-color: ${c.color}; color: #1e293b;">
                <span>${c.title}</span>
                <b style="font-family: monospace; font-size: 0.85rem;">${c.total_formatted}</b>
                <span style="font-size: 0.7rem; color: #64748b;">(${(c.percentage_of_pure_time * 100).toFixed(2)}%)</span>
                ${c.lost_sheets ? `<span style="font-size: 0.72rem; color: #dc2626; font-weight: 800;">-${c.lost_sheets.toLocaleString()} шт</span>` : ''}
            </div>
            `;
        });

        html += `</div></div>`;

        // 2. СВОДНАЯ МАТРИЦА: Связь категорий простоев с производительностью и финансами
        html += `
        <div class="dt-summary-matrix-card">
            <div class="dt-summary-matrix-header">
                <div>
                    <h4 style="margin: 0; font-size: 0.98rem; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px;">
                        <span>📈</span> Связь простоев по категориям с выработкой и финансами
                    </h4>
                    <span style="font-size: 0.75rem; color: #64748b;">
                        Расчет формования: 1 накат = 24 с (6 об.) = 2 листа · Скорость линии = 5 листов/мин (300 шт/ч)
                    </span>
                </div>
            </div>
            <div class="dt-table-responsive">
                <table class="dt-matrix-table">
                    <thead>
                        <tr>
                            <th>Категория потерь</th>
                            <th style="text-align: center; width: 90px;">Инцидентов</th>
                            <th style="text-align: center; width: 100px;">Время</th>
                            <th style="text-align: right; width: 100px;">Накатов</th>
                            <th style="text-align: right; width: 120px;">Потеряно листов</th>
                            <th style="text-align: right; width: 100px;">Потеряно тонн</th>
                            <th style="text-align: right; width: 140px;">Упущенная маржа (период)</th>
                            <th style="text-align: right; width: 160px; color: #be123c;">Годовой эквивалент (₸/год)</th>
                            <th style="text-align: right; width: 90px;">Доля</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        let sumRolls = 0;
        cats.forEach(c => {
            sumRolls += (c.lost_rolls || 0);
            const cAnn = c.annualized || {};
            html += `
            <tr>
                <td style="font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 8px;">
                    <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${c.color}; border: 1px solid rgba(0,0,0,0.15);"></span>
                    <span>${c.title}</span>
                </td>
                <td style="text-align: center; font-family: monospace; font-weight: 600;">${c.count || 0}</td>
                <td style="text-align: center; font-family: monospace; font-weight: 700;">${c.total_formatted}</td>
                <td style="text-align: right; font-family: monospace; color: #64748b;">${(c.lost_rolls || 0).toLocaleString()}</td>
                <td style="text-align: right; font-family: monospace; font-weight: 800; color: ${c.lost_sheets ? '#dc2626' : '#64748b'};">
                    ${c.lost_sheets ? '-' + c.lost_sheets.toLocaleString() + ' шт' : '0 шт'}
                </td>
                <td style="text-align: right; font-family: monospace; color: #475569;">
                    ${c.lost_tons ? '-' + c.lost_tons.toFixed(2) + ' т' : '0.00 т'}
                </td>
                <td style="text-align: right; font-family: monospace; font-weight: 700; color: ${c.lost_margin_tenge ? '#dc2626' : '#64748b'};">
                    ${c.lost_margin_tenge ? '-' + c.lost_margin_tenge.toLocaleString() + ' ₸' : '0 ₸'}
                </td>
                <td style="text-align: right; font-family: monospace; font-weight: 800; color: ${cAnn.annual_margin_loss_tenge ? '#9f1239' : '#64748b'};">
                    ${cAnn.annual_margin_loss_tenge ? '-' + cAnn.annual_margin_loss_tenge.toLocaleString() + ' ₸/год' : '0 ₸'}
                </td>
                <td style="text-align: right; font-family: monospace; font-weight: 600; color: #64748b;">
                    ${((c.percentage_of_pure_time || 0) * 100).toFixed(2)}%
                </td>
            </tr>
            `;
        });

        html += `
                    </tbody>
                    <tfoot>
                        <tr>
                            <td>Итого по всем категориям:</td>
                            <td style="text-align: center; font-family: monospace;">${cats.reduce((acc, c) => acc + (c.count || 0), 0)}</td>
                            <td style="text-align: center; font-family: monospace;">${k.total_downtime_formatted || '0:00:00'}</td>
                            <td style="text-align: right; font-family: monospace;">${sumRolls.toLocaleString()}</td>
                            <td style="text-align: right; font-family: monospace; color: #dc2626;">-${(k.total_lost_sheets || 0).toLocaleString()} шт</td>
                            <td style="text-align: right; font-family: monospace; color: #ea580c;">-${(k.total_lost_tons || 0)} т</td>
                            <td style="text-align: right; font-family: monospace; color: #dc2626;">-${(k.total_lost_margin_tenge || 0).toLocaleString()} ₸</td>
                            <td style="text-align: right; font-family: monospace; color: #9f1239;">-${(ann.annual_margin_loss_tenge || 0).toLocaleString()} ₸/год</td>
                            <td style="text-align: right; font-family: monospace;">100%</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
        `;

        // 3. БЛОК: ТОП-10 повторяющихся узлов и неполадок (Рейтинг годового ущерба / Kaizen)
        if (topRecurring.length > 0) {
            html += `
            <div class="dt-summary-matrix-card" style="border-left: 4px solid #e11d48;">
                <div class="dt-summary-matrix-header">
                    <div>
                        <h4 style="margin: 0; font-size: 0.98rem; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px;">
                            <span>🎯</span> ТОП повторяющихся узлов и причин (Рейтинг годового ущерба)
                        </h4>
                        <span style="font-size: 0.75rem; color: #64748b;">
                            Приоритет для инженеров и механиков: устранение этих системных узлов дает максимальный возврат инвестиций (ROI)
                        </span>
                    </div>
                </div>
                <div class="dt-table-responsive">
                    <table class="dt-matrix-table">
                        <thead>
                            <tr>
                                <th style="width: 45px; text-align: center;">#</th>
                                <th>Узел оборудования / Описание</th>
                                <th style="text-align: center; width: 85px;">Случаев</th>
                                <th style="text-align: center; width: 95px;">Время</th>
                                <th style="text-align: right; width: 110px;">Потеряно листов</th>
                                <th style="text-align: right; width: 130px;">Ущерб за период</th>
                                <th style="text-align: right; width: 170px; color: #be123c;">Годовой ущерб (₸/год)</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            topRecurring.forEach((item, idx) => {
                const rankClass = idx === 0 ? 'rank-1' : (idx === 1 ? 'rank-2' : (idx === 2 ? 'rank-3' : ''));
                const reasonsText = item.sample_reasons && item.sample_reasons.length > 0
                    ? item.sample_reasons.map(r => escapeHtml(r)).join(' · ')
                    : 'Причина в рапорте мастера';

                html += `
                <tr>
                    <td style="text-align: center;">
                        <span class="dt-rank-badge ${rankClass}">${idx + 1}</span>
                    </td>
                    <td>
                        <div style="font-weight: 800; color: #0f172a; font-size: 0.85rem;">${escapeHtml(item.node)}</div>
                        <div style="font-size: 0.72rem; color: #64748b; margin-top: 2px;">${reasonsText}</div>
                    </td>
                    <td style="text-align: center; font-family: monospace; font-weight: 700;">${item.count}</td>
                    <td style="text-align: center; font-family: monospace; font-weight: 700; color: #2563eb;">${item.total_formatted}</td>
                    <td style="text-align: right; font-family: monospace; font-weight: 700; color: #dc2626;">-${(item.lost_sheets || 0).toLocaleString()} шт</td>
                    <td style="text-align: right; font-family: monospace; font-weight: 700; color: #dc2626;">-${(item.lost_margin_tenge || 0).toLocaleString()} ₸</td>
                    <td style="text-align: right; font-family: monospace; font-weight: 800; color: #9f1239; font-size: 0.88rem;">
                        -${(item.annual_margin_loss_tenge || 0).toLocaleString()} ₸/год
                    </td>
                </tr>
                `;
            });

            html += `
                        </tbody>
                    </table>
                </div>
            </div>
            `;
        }

        // 4. 5 блоков категорий (детальные рапорты)
        const bannerClassMap = {
            'mech': 'banner-mech',
            'energy': 'banner-energy',
            'tech': 'banner-tech',
            'maint': 'banner-maint',
            'no_stop': 'banner-nostop'
        };

        cats.forEach(c => {
            const bClass = bannerClassMap[c.key] || 'banner-mech';
            const cAnn = c.annualized || {};
            html += `
            <div class="dt-cat-section-card">
                <div class="dt-cat-section-header ${bClass}">
                    <span>${c.title}</span>
                    <span style="font-size: 0.82rem; font-family: monospace;">
                        Итого: <b>${c.total_formatted}</b> · Потери: <b>-${(c.lost_sheets || 0).toLocaleString()} шт</b> (${(c.percentage_of_pure_time * 100).toFixed(2)}% времени) · Риск: <b>-${(cAnn.annual_margin_loss_tenge || 0).toLocaleString()} ₸/год</b>
                    </span>
                </div>
                <div class="dt-table-responsive">
                    <table class="dt-section-table">
                        <thead>
                            <tr>
                                <th style="width: 95px;">Дата</th>
                                <th style="width: 130px;">Смена / Мастер</th>
                                <th>Узел и причина простоя</th>
                                <th style="width: 75px; text-align: center;">Начало</th>
                                <th style="width: 75px; text-align: center;">Конец</th>
                                <th style="width: 85px; text-align: center;">Время</th>
                                <th style="width: 100px; text-align: right;">Листов</th>
                                <th style="width: 110px; text-align: right;">Маржа (₸)</th>
                                <th style="width: 85px; text-align: right;">Доля</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            if (c.items.length === 0) {
                html += `<tr><td colspan="9" style="text-align: center; color: #94a3b8; padding: 1.2rem;">Инциденты отсутствуют</td></tr>`;
            } else {
                c.items.forEach(item => {
                    html += `
                    <tr>
                        <td style="font-weight: 600;">${item.date}</td>
                        <td>
                            <div style="font-weight: 600; color: #0f172a;">${escapeHtml(item.master_name)}</div>
                            <div style="font-size: 0.7rem; color: #64748b;">${item.shift_name}</div>
                        </td>
                        <td style="color: #1e293b;">
                            <div style="font-weight: 600;">${escapeHtml(item.node || '')}</div>
                            <div style="font-size: 0.78rem; color: #475569;">${escapeHtml(item.reason)}</div>
                        </td>
                        <td style="text-align: center; font-family: monospace;">${item.start_time}</td>
                        <td style="text-align: center; font-family: monospace;">${item.end_time}</td>
                        <td style="text-align: center; font-family: monospace; font-weight: 700; color: #2563eb;">${item.duration_formatted}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 700; color: ${item.lost_sheets ? '#dc2626' : '#64748b'};">
                            ${item.lost_sheets ? '-' + item.lost_sheets.toLocaleString() + ' шт' : '—'}
                        </td>
                        <td style="text-align: right; font-family: monospace; font-weight: 700; color: ${item.lost_margin_tenge ? '#dc2626' : '#64748b'};">
                            ${item.lost_margin_tenge ? '-' + item.lost_margin_tenge.toLocaleString() + ' ₸' : '—'}
                        </td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600; color: #475569;">${(item.percentage_of_pure_time * 100).toFixed(3)}%</td>
                    </tr>
                    `;
                });
            }

            html += `
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colspan="5" style="text-align: right; font-weight: 800;">Итого по разделу:</td>
                                <td style="text-align: center; font-family: monospace; font-weight: 800; color: #0f172a;">${c.total_formatted}</td>
                                <td style="text-align: right; font-family: monospace; font-weight: 800; color: #dc2626;">-${(c.lost_sheets || 0).toLocaleString()} шт</td>
                                <td style="text-align: right; font-family: monospace; font-weight: 800; color: #dc2626;">-${(c.lost_margin_tenge || 0).toLocaleString()} ₸</td>
                                <td style="text-align: right; font-family: monospace; font-weight: 800; color: #0f172a;">${(c.percentage_of_pure_time * 100).toFixed(2)}%</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
            `;
        });

        container.innerHTML = html;
    }

    // Экспорт в Google Таблицу по кнопке
    window.exportDowntimesToGoogleSheets = async function (btnEl) {
        if (!btnEl) btnEl = document.getElementById('btn-export-downtimes-google');
        const origText = btnEl ? btnEl.innerHTML : '';

        if (btnEl) {
            btnEl.disabled = true;
            btnEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Выгрузка в Google...</span>`;
        }

        try {
            const sInput = document.getElementById('dt-date-from');
            const eInput = document.getElementById('dt-date-to');
            const startDate = sInput ? sInput.value : dtCurrentFilter.start_date;
            const endDate = eInput ? eInput.value : dtCurrentFilter.end_date;

            const res = await fetch('/api/downtimes/export/google-sheets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    start_date: startDate,
                    end_date: endDate
                })
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.detail || 'Не удалось выполнить экспорт');
            }

            const url = data.spreadsheet_url || 'https://docs.google.com/spreadsheets/d/1Til9axXv7_U6TLsfYr3Cd4pKufuxnV8FY4F5QKfG5Qk/edit';
            showDtModalSuccess(url, data.sheets_updated || ['Простои ЛФМ 1', 'Простои ЛФМ 2', 'Простои СВОД']);
        } catch (e) {
            console.error(e);
            showDtToast(`Ошибка экспорта: ${e.message}`, 'error');
        } finally {
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.innerHTML = origText;
            }
        }
    };

    // Модальное окно успешного экспорта
    function showDtModalSuccess(spreadsheetUrl, sheets) {
        let modal = document.getElementById('dt-export-success-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'dt-export-success-modal';
            modal.style.cssText = 'position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); backdrop-filter: blur(4px); z-index: 2100; display: flex; align-items: center; justify-content: center; padding: 1rem;';
            document.body.appendChild(modal);
        }

        const sheetsListHtml = sheets.map(s => `<li style="margin-bottom: 4px;">📗 <b>${s}</b></li>`).join('');

        modal.innerHTML = `
        <div style="background: #ffffff; border-radius: 16px; padding: 1.75rem; max-width: 480px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15); animation: dtFadeIn 0.2s ease-out;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 1rem;">
                <div style="width: 44px; height: 44px; border-radius: 12px; background: #ecfdf5; color: #059669; display: flex; align-items: center; justify-content: center; font-size: 1.4rem;">
                    ✓
                </div>
                <div>
                    <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: #0f172a;">Отчет выгружен в Google Таблицу</h3>
                    <div style="font-size: 0.8rem; color: #64748b; margin-top: 2px;">Листы успешно сформированы и обновлены</div>
                </div>
            </div>
            
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 0.9rem 1.1rem; margin-bottom: 1.25rem;">
                <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 0.4rem;">Обновленные листы:</div>
                <ul style="margin: 0; padding-left: 1.2rem; font-size: 0.84rem; color: #1e293b;">
                    ${sheetsListHtml}
                </ul>
            </div>

            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button type="button" class="btn-dt-action" onclick="document.getElementById('dt-export-success-modal').style.display='none'">
                    Закрыть
                </button>
                <a href="${spreadsheetUrl}" target="_blank" class="btn-dt-action primary-sheets" style="text-decoration: none;" onclick="document.getElementById('dt-export-success-modal').style.display='none'">
                    <span>Открыть таблицу</span>
                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                </a>
            </div>
        </div>
        `;
        modal.style.display = 'flex';
    }

    // Всплывающие уведомления (Toasts)
    function showDtToast(msg, type = 'info') {
        let toastContainer = document.getElementById('dt-toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'dt-toast-container';
            toastContainer.style.cssText = 'position: fixed; bottom: 24px; right: 24px; z-index: 3000; display: flex; flex-direction: column; gap: 8px; pointer-events: none;';
            document.body.appendChild(toastContainer);
        }

        const toast = document.createElement('div');
        toast.style.cssText = `
            background: ${type === 'success' ? '#065f46' : (type === 'error' ? '#991b1b' : '#1e293b')};
            color: #ffffff;
            padding: 0.65rem 1.1rem;
            border-radius: 10px;
            font-size: 0.82rem;
            font-weight: 600;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.2);
            pointer-events: auto;
            display: flex;
            align-items: center;
            gap: 8px;
            animation: dtFadeIn 0.2s ease-out;
        `;
        toast.innerHTML = `<span>${escapeHtml(msg)}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

})();

