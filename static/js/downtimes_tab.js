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
        if (!lbl) return;

        if (dtActiveDateMode === 'custom' && dtCurrentFilter.start_date && dtCurrentFilter.end_date) {
            const sParts = dtCurrentFilter.start_date.split('-');
            const eParts = dtCurrentFilter.end_date.split('-');
            const sM = parseInt(sParts[1], 10);
            const eM = parseInt(eParts[1], 10);
            const sY = parseInt(sParts[0], 10);
            const eY = parseInt(eParts[0], 10);
            if (sM === eM && sY === eY) {
                lbl.textContent = `${MONTH_NAMES_RU[sM - 1]} ${sY}`;
            } else {
                lbl.textContent = `${MONTH_NAMES_RU[sM - 1]} — ${MONTH_NAMES_RU[eM - 1]}`;
            }
        } else {
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
            const isSel = (dtActiveDateMode !== 'custom' && dtCurrentMonth === mNum);
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
        dtActiveDateMode = 'week';
        hideDtRangeActiveIndicator();
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

        updateDtMonthLabel();

        const indicator = document.getElementById('dt-range-active-indicator');
        if (indicator) indicator.style.display = 'inline-block';
        const rangeBtn = document.getElementById('btn-dt-custom-range');
        if (rangeBtn) rangeBtn.classList.add('active');

        const fParts = sVal.split('-');
        const tParts = eVal.split('-');
        const weekLabel = document.getElementById('label-dt-week');
        if (weekLabel) {
            weekLabel.textContent = `Период: ${fParts[2]}.${fParts[1]} — ${tParts[2]}.${tParts[1]}`;
        }
        const rangeBtnLabel = document.getElementById('dt-range-btn-label');
        if (rangeBtnLabel) {
            rangeBtnLabel.textContent = `${fParts[2]}.${fParts[1]} — ${tParts[2]}.${tParts[1]}`;
        }

        closeDtCustomRangePopover();
        loadDowntimesData();
    };

    window.resetDtCustomRange = function () {
        hideDtRangeActiveIndicator();
        closeDtCustomRangePopover();
        const curW = findCurrentWeek(dtCurrentYear, dtCurrentMonth);
        if (curW) {
            selectDtWeek(curW.weekNum);
        } else {
            selectDtWholeMonth();
        }
    };

    function hideDtRangeActiveIndicator() {
        const indicator = document.getElementById('dt-range-active-indicator');
        if (indicator) indicator.style.display = 'none';
        const rangeBtn = document.getElementById('btn-dt-custom-range');
        if (rangeBtn) rangeBtn.classList.remove('active');
        const rangeBtnLabel = document.getElementById('dt-range-btn-label');
        if (rangeBtnLabel) rangeBtnLabel.textContent = 'Диапазон дат';
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
    function initDowntimesWorkspace(forceReset = false) {
        // Если уже выбран произвольный диапазон дат и не запрошен принудительный сброс, сохраняем его!
        if (!forceReset && dtActiveDateMode === 'custom' && dtCurrentFilter.start_date && dtCurrentFilter.end_date) {
            updateDtMonthLabel();
            const sInput = document.getElementById('dt-date-from');
            const eInput = document.getElementById('dt-date-to');
            if (sInput) sInput.value = dtCurrentFilter.start_date;
            if (eInput) eInput.value = dtCurrentFilter.end_date;
            const fParts = dtCurrentFilter.start_date.split('-');
            const tParts = dtCurrentFilter.end_date.split('-');
            const weekLabel = document.getElementById('label-dt-week');
            if (weekLabel) weekLabel.textContent = `Период: ${fParts[2]}.${fParts[1]} — ${tParts[2]}.${tParts[1]}`;
            const rangeBtn = document.getElementById('btn-dt-custom-range');
            if (rangeBtn) rangeBtn.classList.add('active');
            const indicator = document.getElementById('dt-range-active-indicator');
            if (indicator) indicator.style.display = 'inline-block';
            const rangeBtnLabel = document.getElementById('dt-range-btn-label');
            if (rangeBtnLabel) rangeBtnLabel.textContent = `${fParts[2]}.${fParts[1]} — ${tParts[2]}.${tParts[1]}`;
            loadDowntimesData();
            return;
        }

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

        // Закрытие поповеров при клике вне (вешаем один раз)
        if (!window.__dtClickOutsideAttached) {
            window.__dtClickOutsideAttached = true;
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
        }

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

    // Быстрый переход из сводного отчета в журнал разметки неклассифицированных простоев
    window.switchToFeedUnclassified = function () {
        dtCurrentFilter.unclassified_only = true;
        const btnAll = document.getElementById('btn-dt-filter-all');
        const btnUnclass = document.getElementById('btn-dt-filter-unclass');
        if (btnAll) btnAll.classList.remove('active');
        if (btnUnclass) btnUnclass.classList.add('active');
        setDtViewMode('feed');
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
        const sInput = document.getElementById('dt-date-from');
        const eInput = document.getElementById('dt-date-to');
        if (sInput && sInput.value) dtCurrentFilter.start_date = sInput.value;
        if (eInput && eInput.value) dtCurrentFilter.end_date = eInput.value;

        const tbody = document.getElementById('dt-feed-tbody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: #64748b;">
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
                tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: #ef4444;">
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
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2.5rem; color: #64748b;">
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
                <td style="text-align: center; white-space: nowrap;">
                    <div style="display: inline-flex; align-items: center; justify-content: center; gap: 6px;">
                        <button type="button" class="btn-dt-row-action edit" onclick="openTechEditDowntimeModal(${d.id})" title="Редактировать запись">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button type="button" class="btn-dt-row-action delete" onclick="openTechDeleteDowntimeModal(${d.id})" title="Удалить запись">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
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
        const sInput = document.getElementById('dt-date-from');
        const eInput = document.getElementById('dt-date-to');
        if (sInput && sInput.value) dtCurrentFilter.start_date = sInput.value;
        if (eInput && eInput.value) dtCurrentFilter.end_date = eInput.value;

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

            // Обновляем счетчики на кнопках-пилюлях в режиме сводки
            const totalCountEl = document.getElementById('dt-feed-total-count');
            const unclassCountEl = document.getElementById('dt-feed-unclass-count');
            if (totalCountEl && data.total_count !== undefined) totalCountEl.textContent = data.total_count;
            if (unclassCountEl && data.unclassified_count !== undefined) unclassCountEl.textContent = data.unclassified_count;

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

    // Загрузка и рендер интерактивной таблицы недельной производительности
    async function loadAndRenderWeeklyProductivity(startDate, endDate, line) {
        const wrapper = document.getElementById('dt-weekly-table-wrapper');
        const badge = document.getElementById('dt-weekly-loading-badge');
        if (!wrapper) return;
        if (badge) badge.style.display = 'inline-block';

        try {
            const params = new URLSearchParams();
            if (startDate) params.set('start_date', startDate);
            if (endDate) params.set('end_date', endDate);
            if (line && line !== 'all') params.set('line', line);

            const res = await fetch(`/api/downtimes/weekly-productivity?${params.toString()}`);
            if (!res.ok) throw new Error('Сбой загрузки недельной производительности');
            const json = await res.json();
            const weeks = json.weeks || [];

            if (weeks.length === 0) {
                wrapper.innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: #94a3b8; font-size: 0.95rem;">
                        <i class="fa-solid fa-calendar-xmark" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block; opacity: 0.5;"></i>
                        За выбранный период производственные недели не найдены
                    </div>
                `;
                return;
            }

            let tableHtml = `
            <table class="dt-matrix-table" style="font-size: 0.88rem; width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: #e2e8f0; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.3px;">
                        <th rowspan="2" style="text-align: center; width: 95px; border-right: 1px solid #cbd5e1;">Начало</th>
                        <th rowspan="2" style="text-align: center; width: 95px; border-right: 1px solid #cbd5e1;">Конец</th>
                        <th colspan="2" style="text-align: center; border-right: 1px solid #cbd5e1; background: #e0e7ff; color: #3730a3;">План на неделю</th>
                        <th colspan="2" style="text-align: center; border-right: 1px solid #cbd5e1; background: #dcfce7; color: #166534;">Произведено</th>
                        <th rowspan="2" style="text-align: center; width: 90px; border-right: 1px solid #cbd5e1; background: #fef9c3; color: #854d0e;">Чистое время (ч)</th>
                        <th colspan="2" style="text-align: center; border-right: 1px solid #cbd5e1; background: #fee2e2; color: #991b1b;">Недопроизвели</th>
                        <th colspan="2" style="text-align: center; border-right: 1px solid #cbd5e1; background: #f1f5f9; color: #0f172a;">Производительность</th>
                        <th rowspan="2" style="text-align: center; width: 85px; border-right: 1px solid #cbd5e1;">План %</th>
                        <th rowspan="2" style="text-align: center; width: 70px; border-right: 1px solid #cbd5e1;">Фонд ч</th>
                        <th rowspan="2" style="text-align: center; width: 65px; border-right: 1px solid #cbd5e1;">Мех</th>
                        <th rowspan="2" style="text-align: center; width: 65px; border-right: 1px solid #cbd5e1;">Энерг</th>
                        <th rowspan="2" style="text-align: center; width: 65px; border-right: 1px solid #cbd5e1;">Техн</th>
                        <th rowspan="2" style="text-align: center; width: 70px; border-right: 1px solid #cbd5e1;">ТО/ППР</th>
                        <th rowspan="2" style="text-align: center; width: 70px; border-right: 1px solid #cbd5e1;">Без ост</th>
                        <th rowspan="2" style="text-align: center; width: 85px; border-right: 1px solid #cbd5e1; color: #dc2626;">Простой</th>
                        <th rowspan="2" style="text-align: center; width: 80px; border-right: 1px solid #cbd5e1;">% простоя</th>
                        <th rowspan="2" style="text-align: center; width: 80px;">Линия</th>
                    </tr>
                    <tr style="background: #f8fafc; font-size: 0.76rem; font-weight: 700; color: #475569;">
                        <th style="text-align: right; width: 70px; border-right: 1px solid #cbd5e1;">т</th>
                        <th style="text-align: right; width: 75px; border-right: 1px solid #cbd5e1;">л</th>
                        <th style="text-align: right; width: 70px; border-right: 1px solid #cbd5e1;">т</th>
                        <th style="text-align: right; width: 75px; border-right: 1px solid #cbd5e1;">л</th>
                        <th style="text-align: right; width: 70px; border-right: 1px solid #cbd5e1;">т</th>
                        <th style="text-align: right; width: 75px; border-right: 1px solid #cbd5e1;">л</th>
                        <th style="text-align: right; width: 70px; border-right: 1px solid #cbd5e1;">т/ч</th>
                        <th style="text-align: right; width: 70px; border-right: 1px solid #cbd5e1;">л/ч</th>
                    </tr>
                </thead>
                <tbody>
            `;

            weeks.forEach(w => {
                const planPillColor = w.plan_fulfillment_pct >= 100 ? '#059669' : (w.plan_fulfillment_pct >= 85 ? '#2563eb' : '#dc2626');
                const underTonsColor = w.underprod_tons > 0 ? '#dc2626' : '#059669';
                const underSheetsColor = w.underprod_sheets > 0 ? '#dc2626' : '#059669';
                const lineBadge = w.line === 'ЛФМ 1' ? 'background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;' : 'background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;';

                tableHtml += `
                    <tr>
                        <td style="text-align: center; font-weight: 600; font-family: monospace;">${w.start_date}</td>
                        <td style="text-align: center; font-weight: 600; font-family: monospace;">${w.end_date}</td>
                        <td style="text-align: right; font-family: monospace; color: #4338ca;">${w.plan_tons}</td>
                        <td style="text-align: right; font-family: monospace; color: #4338ca;">${w.plan_sheets.toLocaleString()}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 700; color: #047857;">${w.fact_tons}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 700; color: #047857;">${w.fact_sheets.toLocaleString()}</td>
                        <td style="text-align: center; font-family: monospace; font-weight: 700; background: #fffbeb; color: #92400e;">${w.clean_hours} ч</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600; color: ${underTonsColor};">${w.underprod_tons}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600; color: ${underSheetsColor};">${w.underprod_sheets.toLocaleString()}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 800; color: #0f172a;">${w.prod_tons_per_hour.toFixed(2)}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 800; color: #0f172a;">${w.prod_sheets_per_hour.toFixed(1)}</td>
                        <td style="text-align: center; font-family: monospace; font-weight: 800; color: ${planPillColor};">${w.plan_fulfillment_pct}%</td>
                        <td style="text-align: center; font-family: monospace; color: #64748b;">${w.calendar_hours}</td>
                        <td style="text-align: center; font-family: monospace; color: #64748b;">${w.mech_formatted}</td>
                        <td style="text-align: center; font-family: monospace; color: #64748b;">${w.energy_formatted}</td>
                        <td style="text-align: center; font-family: monospace; color: #64748b;">${w.tech_formatted}</td>
                        <td style="text-align: center; font-family: monospace; color: #64748b;">${w.maint_formatted}</td>
                        <td style="text-align: center; font-family: monospace; color: #64748b;">${w.no_stop_formatted}</td>
                        <td style="text-align: center; font-family: monospace; font-weight: 700; color: #dc2626;">${w.total_downtime_formatted}</td>
                        <td style="text-align: center; font-family: monospace; font-weight: 700; color: #dc2626;">${w.downtime_pct}%</td>
                        <td style="text-align: center;"><span style="padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 0.78rem; ${lineBadge}">${w.line}</span></td>
                    </tr>
                `;
            });

            tableHtml += `</tbody></table>`;
            wrapper.innerHTML = tableHtml;
        } catch (err) {
            console.error('Ошибка загрузки недельной производительности:', err);
            wrapper.innerHTML = `
                <div style="text-align: center; padding: 1.5rem; color: #ef4444; font-size: 0.9rem;">
                    Не удалось загрузить недельную производительность (${err.message})
                </div>
            `;
        } finally {
            if (badge) badge.style.display = 'none';
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
                    <h3 style="margin: 0; font-size: 1.25rem; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px;">
                        <span>📊</span> Простои и потери производительности за период: ${data.start_date} — ${data.end_date}
                    </h3>
                    <div style="font-size: 0.88rem; color: #64748b; margin-top: 4px;">
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
                    <div class="kpi-val" title="${k.actual_operating_hours_formatted || ''} (чистое время без простоев)">${(k.actual_operating_hours !== undefined ? k.actual_operating_hours : (k.total_operating_hours || 0))} ч</div>
                    <div class="dt-sub-metric">
                        <i class="fa-solid fa-clock" style="color: #2563eb;"></i>
                        <span>из <b>${k.total_operating_hours || 0} ч</b> запланированных (${k.operating_rate_percent || k.availability_rate_percent || 100}%)</span>
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

                <!-- 4. Часы простоев линии -->
                <div class="dt-kpi-card-item" style="border-left: 4px solid #dc2626;">
                    <div class="kpi-label">
                        <span>Всего часов простоев</span>
                        <span class="dt-annual-pill" style="background: #fee2e2; color: #991b1b;">Стоп: ${k.total_stop_formatted || '0:00:00'}</span>
                    </div>
                    <div class="kpi-val" style="color: #dc2626;">${k.total_downtime_formatted || '0:00:00'}</div>
                    <div class="dt-sub-metric" style="color: #991b1b;">
                        <i class="fa-solid fa-circle-exclamation"></i>
                        <span>Потери фонда: <b>${((k.total_downtime_minutes || 0) / Math.max(1, (k.total_operating_hours || 1) * 60) * 100).toFixed(2)}%</b> времени</span>
                    </div>
                </div>
            </div>

            <!-- Сводная строка часов по категориям -->
            <div style="font-size: 0.86rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #64748b; margin-bottom: 0.6rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                <span>Всего часов простоев: <b style="color: #0f172a; font-size: 1.05rem; font-family: monospace;">${k.total_downtime_formatted || '0:00:00'}</b> (со стопом: <b style="color: #dc2626; font-size: 1.05rem; font-family: monospace;">${k.total_stop_formatted || '0:00:00'}</b>)</span>
                <span style="font-size: 0.84rem; color: #64748b; text-transform: none;">Потенциал без простоев: <b style="color: #0f172a;">${(k.potential_sheets || 0).toLocaleString()} шт</b></span>
            </div>
            <div class="dt-kpi-hours-deck">
        `;

        cats.forEach(c => {
            const isUnclass = (c.key === 'unclassified');
            const chipStyle = isUnclass
                ? `background: rgba(239, 68, 68, 0.12); border-color: #ef4444; color: #991b1b; cursor: pointer;`
                : `background: ${c.color}25; border-color: ${c.color}; color: #1e293b;`;
            const clickAttr = isUnclass ? `onclick="switchToFeedUnclassified()" title="Нажмите, чтобы открыть разметку этих простоев"` : '';

            html += `
            <div class="dt-kpi-hour-chip" style="${chipStyle}" ${clickAttr}>
                <span>${c.title}</span>
                <b style="font-family: monospace; font-size: 0.95rem;">${c.total_formatted}</b>
                <span style="font-size: 0.8rem; color: #64748b;">(${(c.percentage_of_pure_time * 100).toFixed(2)}%)</span>
                ${c.lost_sheets ? `<span style="font-size: 0.84rem; color: #dc2626; font-weight: 800;">-${c.lost_sheets.toLocaleString()} шт</span>` : ''}
                ${isUnclass && c.count > 0 ? `<span style="font-size: 0.72rem; background: #ef4444; color: #fff; padding: 2px 7px; border-radius: 10px; font-weight: 700; margin-left: 4px; box-shadow: 0 1px 2px rgba(239,68,68,0.3);">⚠️ ${c.count} не разобрано</span>` : ''}
            </div>
            `;
        });

        html += `</div></div>`;

        // 2. СВОДНАЯ МАТРИЦА: Связь простоев по категориям с выработкой (без тенге, доли сходятся в 100%)
        html += `
        <div class="dt-summary-matrix-card">
            <div class="dt-summary-matrix-header">
                <div>
                    <h4 style="margin: 0; font-size: 1.08rem; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px;">
                        <span>📈</span> Связь простоев по категориям с выработкой продукции
                    </h4>
                    <span style="font-size: 0.84rem; color: #64748b; margin-top: 3px; display: inline-block;">
                        Расчет формования: 1 накат = 24 с (6 об.) = 2 листа · Скорость линии = 5 листов/мин (300 шт/ч)
                    </span>
                </div>
            </div>
            <div class="dt-table-responsive">
                <table class="dt-matrix-table">
                    <thead>
                        <tr>
                            <th>Категория потерь</th>
                            <th style="text-align: center; width: 95px;">Инцидентов</th>
                            <th style="text-align: center; width: 105px;">Время</th>
                            <th style="text-align: right; width: 105px;">Накатов</th>
                            <th style="text-align: right; width: 130px;">Потеряно листов</th>
                            <th style="text-align: right; width: 115px;">Потеряно тонн</th>
                            <th style="text-align: right; width: 120px;">Доля в простоях</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        let sumRolls = 0;
        cats.forEach(c => {
            sumRolls += (c.lost_rolls || 0);
            const isUnclass = (c.key === 'unclassified');
            const cShare = (c.share_of_downtime !== undefined && c.share_of_downtime !== null)
                ? c.share_of_downtime
                : ((k.total_downtime_minutes > 0) ? ((c.total_minutes / k.total_downtime_minutes) * 100) : 0);

            html += `
            <tr style="${isUnclass && c.count > 0 ? 'background: #fff5f5;' : ''}">
                <td style="font-weight: 700; color: ${isUnclass && c.count > 0 ? '#dc2626' : '#0f172a'}; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${c.color}; border: 1px solid rgba(0,0,0,0.15); ${isUnclass && c.count > 0 ? 'box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.2);' : ''}"></span>
                        <span>${c.title}</span>
                    </div>
                    ${isUnclass && c.count > 0 ? `
                        <button type="button" class="btn-table-action" onclick="switchToFeedUnclassified()" style="padding: 3px 9px; font-size: 0.76rem; background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; border-radius: 6px; cursor: pointer; font-weight: 700; display: inline-flex; align-items: center; gap: 5px;" title="Перейти к классификации в журнал разметки">
                            <i class="fa-solid fa-arrow-right"></i> Разметить
                        </button>
                    ` : ''}
                </td>
                <td style="text-align: center; font-family: monospace; font-weight: 600; color: ${isUnclass && c.count > 0 ? '#dc2626' : 'inherit'};">${c.count || 0}</td>
                <td style="text-align: center; font-family: monospace; font-weight: 700; color: ${isUnclass && c.count > 0 ? '#dc2626' : 'inherit'};">${c.total_formatted}</td>
                <td style="text-align: right; font-family: monospace; color: #64748b;">${(c.lost_rolls || 0).toLocaleString()}</td>
                <td style="text-align: right; font-family: monospace; font-weight: 800; color: ${c.lost_sheets ? '#dc2626' : '#64748b'};">
                    ${c.lost_sheets ? '-' + c.lost_sheets.toLocaleString() + ' шт' : '0 шт'}
                </td>
                <td style="text-align: right; font-family: monospace; color: #475569;">
                    ${c.lost_tons ? '-' + c.lost_tons.toFixed(2) + ' т' : '0.00 т'}
                </td>
                <td style="text-align: right; font-family: monospace; font-weight: 700; color: #0f172a;">
                    ${cShare.toFixed(2)}%
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
                            <td style="text-align: right; font-family: monospace; font-weight: 800; color: #059669;">100%</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>

        <!-- 2.5. Блок Недельной производительности (по эталону со скриншота технолога) -->
        <div class="dt-summary-matrix-card" id="dt-weekly-productivity-container" style="margin-top: 1.25rem;">
            <div class="dt-summary-matrix-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div>
                    <h4 style="margin: 0; font-size: 1.08rem; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px;">
                        <span>⏱️</span> Недельная производительность и баланс времени ЛФМ 1 / ЛФМ 2
                    </h4>
                    <span style="font-size: 0.84rem; color: #64748b; margin-top: 3px; display: inline-block;">
                        Сопоставление плановой и фактической выработки, чистого машинного времени и темпа формовки (т/ч, л/ч)
                    </span>
                </div>
                <div id="dt-weekly-loading-badge" style="display: none; font-size: 0.82rem; color: #2563eb; font-weight: 600;">
                    <i class="fa-solid fa-spinner fa-spin"></i> Загрузка недель...
                </div>
            </div>
            <div class="dt-table-responsive" id="dt-weekly-table-wrapper" style="overflow-x: auto;">
                <div style="text-align: center; padding: 1.5rem; color: #64748b; font-size: 0.9rem;">
                    <i class="fa-solid fa-spinner fa-spin"></i> Подготовка данных недельной производительности...
                </div>
            </div>
        </div>
        `;

        // 3. 5 блоков категорий + неклассифицированные (детальные рапорты)
        const bannerClassMap = {
            'mech': 'banner-mech',
            'energy': 'banner-energy',
            'tech': 'banner-tech',
            'maint': 'banner-maint',
            'no_stop': 'banner-nostop',
            'unclassified': 'banner-unclass'
        };

        function parseRuDateTimestamp(str) {
            if (!str || str === 'Н/Д') return 0;
            const p = str.split('.');
            if (p.length === 3) {
                return new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10)).getTime();
            }
            return 0;
        }

        cats.forEach(c => {
            if (Array.isArray(c.items)) {
                c.items.sort((a, b) => {
                    const da = parseRuDateTimestamp(a.date);
                    const db = parseRuDateTimestamp(b.date);
                    if (da !== db) return da - db;
                    const ta = a.start_time || '';
                    const tb = b.start_time || '';
                    return ta.localeCompare(tb);
                });
            }
            const bClass = bannerClassMap[c.key] || 'banner-mech';
            const cAnn = c.annualized || {};
            const isUnclass = (c.key === 'unclassified');
            html += `
            <div class="dt-cat-section-card">
                <div class="dt-cat-section-header ${bClass}">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span>${c.title}</span>
                        ${isUnclass && c.count > 0 ? `
                            <button type="button" onclick="switchToFeedUnclassified()" style="padding: 3px 10px; font-size: 0.8rem; background: #fff; color: #991b1b; border: 1px solid #f87171; border-radius: 6px; cursor: pointer; font-weight: 700; display: inline-flex; align-items: center; gap: 5px;">
                                <i class="fa-solid fa-list-check"></i> Открыть в журнале разметки
                            </button>
                        ` : ''}
                    </div>
                    <span style="font-size: 0.92rem; font-family: monospace;">
                        Итого: <b>${c.total_formatted}</b> · Потери: <b>-${(c.lost_sheets || 0).toLocaleString()} шт</b> (${(c.lost_tons ? '-' + Number(c.lost_tons).toFixed(2) + ' т' : '0.00 т')}) · Доля: <b>${(c.share_of_downtime !== undefined && c.share_of_downtime !== null ? c.share_of_downtime : ((k.total_downtime_minutes > 0) ? (c.total_minutes / k.total_downtime_minutes * 100) : 0)).toFixed(1)}% в простоях</b>
                    </span>
                </div>
                <div class="dt-table-responsive">
                    <table class="dt-section-table">
                        <thead>
                            <tr>
                                <th style="width: 105px;">Дата</th>
                                <th style="width: 140px;">Смена / Мастер</th>
                                <th>Узел и причина простоя</th>
                                <th style="width: 80px; text-align: center;">Начало</th>
                                <th style="width: 80px; text-align: center;">Конец</th>
                                <th style="width: 90px; text-align: center;">Время</th>
                                <th style="width: 110px; text-align: right;">Листов</th>
                                <th style="width: 115px; text-align: right;">Потеряно тонн</th>
                                <th style="width: 100px; text-align: right;">Доля в простоях</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            if (c.items.length === 0) {
                html += `<tr><td colspan="9" style="text-align: center; color: #94a3b8; padding: 1.4rem; font-size: 0.95rem;">Инциденты отсутствуют</td></tr>`;
            } else {
                c.items.forEach(item => {
                    const itmShare = (item.share_of_downtime !== undefined && item.share_of_downtime !== null)
                        ? item.share_of_downtime
                        : ((k.total_downtime_minutes > 0) ? (item.duration_minutes / k.total_downtime_minutes * 100) : 0);

                    html += `
                    <tr>
                        <td style="font-weight: 600; font-size: 0.92rem;">${item.date}</td>
                        <td>
                            <div style="font-weight: 700; font-size: 0.95rem; color: #0f172a;">${escapeHtml(item.master_name)}</div>
                            <div style="font-size: 0.84rem; color: #64748b; margin-top: 2px;">${item.shift_name}</div>
                        </td>
                        <td style="color: #1e293b;">
                            <div style="font-weight: 700; font-size: 0.95rem; color: #0f172a; margin-bottom: 2px;">${escapeHtml(item.node || '')}</div>
                            <div style="font-size: 0.92rem; color: #334155; line-height: 1.42;">${escapeHtml(item.reason)}</div>
                        </td>
                        <td style="text-align: center; font-family: monospace; font-size: 0.92rem;">${item.start_time}</td>
                        <td style="text-align: center; font-family: monospace; font-size: 0.92rem;">${item.end_time}</td>
                        <td style="text-align: center; font-family: monospace; font-weight: 700; font-size: 0.95rem; color: #2563eb;">${item.duration_formatted}</td>
                        <td style="text-align: right; font-family: monospace; font-weight: 700; font-size: 0.95rem; color: ${item.lost_sheets ? '#dc2626' : '#64748b'};">
                            ${item.lost_sheets ? '-' + item.lost_sheets.toLocaleString() + ' шт' : '—'}
                        </td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600; font-size: 0.95rem; color: #475569;">
                            ${item.lost_tons ? '-' + Number(item.lost_tons).toFixed(2) + ' т' : '—'}
                        </td>
                        <td style="text-align: right; font-family: monospace; font-weight: 600; font-size: 0.9rem; color: #475569;">
                            ${itmShare.toFixed(2)}%
                        </td>
                    </tr>
                    `;
                });
            }

            html += `
                        </tbody>
                    </table>
                </div>
            </div>
            `;
        });

        container.innerHTML = html;
        loadAndRenderWeeklyProductivity(dtCurrentFilter.start_date, dtCurrentFilter.end_date, dtCurrentFilter.line);
    }

    // Экспорт в Google Таблицу по кнопке со сквозной фильтрацией
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

            const lineSelect = document.getElementById('dt-filter-line');
            const lineVal = lineSelect ? lineSelect.value : (dtCurrentFilter.line || 'all');

            const catSelect = document.getElementById('dt-filter-category');
            const catVal = catSelect ? catSelect.value : (dtCurrentFilter.category || 'all');

            const unclassVal = Boolean(dtCurrentFilter.unclassified_only);

            const searchInput = document.getElementById('dt-filter-search');
            const searchVal = searchInput ? searchInput.value.trim() : (dtCurrentFilter.search || '');

            const res = await fetch('/api/downtimes/export/google-sheets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    start_date: startDate,
                    end_date: endDate,
                    line: lineVal,
                    category: catVal,
                    unclassified_only: unclassVal,
                    search: searchVal
                })
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.detail || 'Не удалось выполнить экспорт');
            }

            const url = data.spreadsheet_url || 'https://docs.google.com/spreadsheets/d/1Til9axXv7_U6TLsfYr3Cd4pKufuxnV8FY4F5QKfG5Qk/edit';
            showDtModalSuccess(url, data.sheets_updated || ['Сводная аналитика', 'Реестр простоев'], data.records_exported);
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
    function showDtModalSuccess(spreadsheetUrl, sheets, recordsCount) {
        let modal = document.getElementById('dt-export-success-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'dt-export-success-modal';
            modal.style.cssText = 'position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); backdrop-filter: blur(4px); z-index: 2100; display: flex; align-items: center; justify-content: center; padding: 1rem;';
            document.body.appendChild(modal);
        }

        const sheetsListHtml = sheets.map(s => `<li style="margin-bottom: 4px;">📗 <b>${s}</b></li>`).join('');
        const recordsHtml = recordsCount !== undefined ? `<div style="font-size: 0.8rem; color: #15803d; font-weight: 700; margin-top: 6px;">✓ Выгружено записей простоев: ${recordsCount} шт.</div>` : '';

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
                ${recordsHtml}
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

    // ==========================================================================
    // Редактирование и удаление записей простоев (Технолог / Руководство)
    // ==========================================================================
    
    // Открытие модального окна редактирования
    window.openTechEditDowntimeModal = async function(id) {
        let item = allFeedItems.find(x => x.id === id);
        
        // Быстрое заполнение из кеша ленты, если доступно
        if (item) {
            fillTechEditModalFields(item);
        }

        // Показываем оверлей и модалку
        const overlay = document.getElementById('tech-edit-dt-overlay');
        const modal = document.getElementById('tech-edit-dt-modal');
        if (overlay) overlay.style.display = 'block';
        if (modal) modal.style.display = 'block';

        // Подтягиваем свежие данные с сервера (GET /api/downtimes/{id})
        try {
            const res = await fetch(`/api/downtimes/${id}`);
            if (res.ok) {
                const freshData = await res.json();
                fillTechEditModalFields(freshData);
            }
        } catch(e) {
            console.warn('Не удалось загрузить детальные данные простоя:', e);
        }

        // Заполняем datalist узлов из всех записей ленты
        populateNodesDatalist();
    };

    function fillTechEditModalFields(d) {
        const cleanTime = (t) => t ? t.trim().slice(0, 5) : '';
        const idEl = document.getElementById('tech-edit-dt-id');
        const titleEl = document.getElementById('tech-edit-modal-title');
        const subEl = document.getElementById('tech-edit-modal-subtitle');
        const lineEl = document.getElementById('tech-edit-dt-line');
        const shiftInfoEl = document.getElementById('tech-edit-dt-shift-info');
        const startEl = document.getElementById('tech-edit-dt-start');
        const endEl = document.getElementById('tech-edit-dt-end');
        const nodeEl = document.getElementById('tech-edit-dt-node');
        const descEl = document.getElementById('tech-edit-dt-desc');
        const catEl = document.getElementById('tech-edit-dt-category');
        const stopEl = document.getElementById('tech-edit-dt-is-stop');

        if (idEl) idEl.value = d.id;
        if (titleEl) titleEl.textContent = `Редактирование простоя #${d.id}`;
        if (subEl) subEl.textContent = `${d.date_display || d.date || ''} · ${d.shift_name || ''} · ${d.master_name || ''}`;
        if (lineEl) lineEl.value = d.line || 'Линия 1';
        if (shiftInfoEl) shiftInfoEl.value = `${d.shift_name || 'Смена'} (${d.master_name || 'Мастер не указан'})`;
        if (startEl) startEl.value = cleanTime(d.start_time);
        if (endEl) endEl.value = cleanTime(d.end_time);
        if (nodeEl) nodeEl.value = d.node && d.node !== 'Основное оборудование' ? d.node : (d.node || '');
        if (descEl) descEl.value = d.description || d.comment || '';
        
        if (catEl) {
            const currentCat = d.category || 'Без категории';
            // Проверяем наличие опции, если нет - ставим Без категории
            catEl.value = Array.from(catEl.options).some(o => o.value === currentCat) ? currentCat : 'Без категории';
        }
        
        if (stopEl) {
            stopEl.checked = d.is_equipment_downtime !== false;
        }

        calcTechEditDowntimeDuration();
    }

    function populateNodesDatalist() {
        const datalist = document.getElementById('tech-dt-nodes-datalist');
        if (!datalist) return;
        const nodesSet = new Set();
        allFeedItems.forEach(x => {
            if (x.node && x.node.trim() && x.node !== 'Основное оборудование') {
                nodesSet.add(x.node.trim());
            }
        });
        // Добавляем типовые узлы ХЦИ
        ['Стакер', 'Дестакер', 'Пресс', 'Формовочная машина', 'Транспортер', 'Ковшевой элеватор', 'Бракомешалка', 'Сукноправка', 'Вакуумная система'].forEach(n => nodesSet.add(n));

        datalist.innerHTML = Array.from(nodesSet).sort().map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
    }

    // Закрытие модального окна редактирования
    window.closeTechEditDowntimeModal = function() {
        const overlay = document.getElementById('tech-edit-dt-overlay');
        const modal = document.getElementById('tech-edit-dt-modal');
        if (overlay) overlay.style.display = 'none';
        if (modal) modal.style.display = 'none';
    };

    // Живой расчет длительности при вводе времени
    window.calcTechEditDowntimeDuration = function() {
        const startVal = (document.getElementById('tech-edit-dt-start')?.value || '').trim();
        const endVal = (document.getElementById('tech-edit-dt-end')?.value || '').trim();
        const previewEl = document.getElementById('tech-edit-dt-duration-preview');
        if (!previewEl) return;

        if (!startVal) {
            previewEl.textContent = '-- мин';
            previewEl.style.color = '#64748b';
            previewEl.style.background = '#f1f5f9';
            previewEl.style.borderColor = '#cbd5e1';
            return;
        }

        if (!endVal) {
            previewEl.textContent = 'В процессе...';
            previewEl.style.color = '#d97706';
            previewEl.style.background = '#fef3c7';
            previewEl.style.borderColor = '#fde68a';
            return;
        }

        const [sH, sM] = startVal.split(':').map(Number);
        const [eH, eM] = endVal.split(':').map(Number);

        if (isNaN(sH) || isNaN(sM) || isNaN(eH) || isNaN(eM)) {
            previewEl.textContent = '-- мин';
            return;
        }

        let diff = (eH * 60 + eM) - (sH * 60 + sM);
        if (diff < 0) diff += 24 * 60; // Переход через полночь

        const hours = Math.floor(diff / 60);
        const mins = diff % 60;
        let formatted = '';
        if (hours > 0) {
            formatted = `${hours} ч ${mins} мин (${diff} мин)`;
        } else {
            formatted = `${diff} мин`;
        }

        previewEl.textContent = formatted;
        previewEl.style.color = '#15803d';
        previewEl.style.background = '#f0fdf4';
        previewEl.style.borderColor = '#bbf7d0';
    };

    // Сохранение изменений простоя
    window.submitTechEditDowntime = async function() {
        const id = document.getElementById('tech-edit-dt-id')?.value;
        const line = document.getElementById('tech-edit-dt-line')?.value || 'Линия 1';
        const startTime = (document.getElementById('tech-edit-dt-start')?.value || '').trim();
        const endTime = (document.getElementById('tech-edit-dt-end')?.value || '').trim();
        const node = (document.getElementById('tech-edit-dt-node')?.value || '').trim() || 'Основное оборудование';
        const desc = (document.getElementById('tech-edit-dt-desc')?.value || '').trim();
        const category = document.getElementById('tech-edit-dt-category')?.value || 'Без категории';
        const isEquipmentStop = document.getElementById('tech-edit-dt-is-stop')?.checked ?? true;
        const btnSubmit = document.getElementById('btn-submit-tech-edit-dt');

        if (!id) return;
        if (!startTime) {
            showDtToast('Укажите время начала простоя', 'error');
            document.getElementById('tech-edit-dt-start')?.focus();
            return;
        }
        if (!desc) {
            showDtToast('Укажите описание поломки / работ', 'error');
            document.getElementById('tech-edit-dt-desc')?.focus();
            return;
        }

        // Double-Submit Guard
        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Сохранение...</span>`;
        }

        const payload = {
            line: line,
            start_time: startTime,
            end_time: endTime || null,
            node: node,
            description: desc,
            comment: desc,
            category: category,
            is_equipment_downtime: isEquipmentStop
        };

        try {
            const res = await fetch(`/api/downtimes/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Не удалось сохранить изменения');
            }

            const updated = await res.json();

            // Локально обновляем данные в памяти
            const item = allFeedItems.find(x => x.id === parseInt(id));
            if (item) {
                item.line = line;
                item.start_time = startTime;
                item.end_time = endTime || '--:--';
                item.node = node;
                item.description = desc;
                item.category = category;
                item.is_equipment_downtime = isEquipmentStop;
                if (updated.duration !== undefined) {
                    item.duration_minutes = updated.duration;
                }
            }

            closeTechEditDowntimeModal();
            showDtToast(`Простой #${id} успешно обновлен`, 'success');
            
            // Перерисовываем таблицу с подсветкой сохраненной строки
            renderFeedTable(allFeedItems, parseInt(id));

        } catch(e) {
            console.error(e);
            showDtToast(e.message || 'Ошибка сети при сохранении', 'error');
        } finally {
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = `<i class="fa-solid fa-check"></i> <span>Сохранить изменения</span>`;
            }
        }
    };

    // Открытие модального окна удаления
    window.openTechDeleteDowntimeModal = function(id) {
        const item = allFeedItems.find(x => x.id === id);
        const modal = document.getElementById('tech-delete-dt-modal');
        const overlay = document.getElementById('tech-delete-dt-overlay');
        const idInput = document.getElementById('tech-delete-dt-id');
        const infoEl = document.getElementById('tech-delete-dt-info');

        if (!modal || !overlay) return;

        if (idInput) idInput.value = id;

        if (infoEl) {
            if (item) {
                const durText = (item.duration_minutes !== undefined && item.duration_minutes !== null ? (item.duration_minutes >= 60 ? Math.floor(item.duration_minutes/60) + " ч " + (item.duration_minutes%60) + " мин" : item.duration_minutes + " мин") : (item.duration || 0) + " мин");
                infoEl.innerHTML = `
                    <div style="font-weight: 700; color: #0f172a; margin-bottom: 4px;">ID #${item.id} · ${escapeHtml(item.date)} (${escapeHtml(item.shift_name)})</div>
                    <div style="color: #64748b; margin-bottom: 2px;">Линия: <b style="color: #334155;">${escapeHtml(item.line)}</b> · Мастер: ${escapeHtml(item.master_name)}</div>
                    <div style="color: #64748b; margin-bottom: 4px;">Время: <b style="font-family: monospace; color: #0f172a;">${item.start_time} - ${item.end_time}</b> (⏱️ ${durText})</div>
                    <div style="color: #334155; font-size: 0.78rem; border-top: 1px solid #e2e8f0; padding-top: 4px; margin-top: 4px;">
                        <b>Причина:</b> ${escapeHtml(item.node ? item.node + ': ' : '')}${escapeHtml(item.description)}
                    </div>
                `;
            } else {
                infoEl.innerHTML = `<div>Удаление записи простоя ID #${id}</div>`;
            }
        }

        overlay.style.display = 'block';
        modal.style.display = 'block';
    };

    // Закрытие модального окна удаления
    window.closeTechDeleteDowntimeModal = function() {
        const modal = document.getElementById('tech-delete-dt-modal');
        const overlay = document.getElementById('tech-delete-dt-overlay');
        if (overlay) overlay.style.display = 'none';
        if (modal) modal.style.display = 'none';
    };

    // Подтверждение удаления
    window.confirmTechDeleteDowntime = async function() {
        const id = document.getElementById('tech-delete-dt-id')?.value;
        const btnConfirm = document.getElementById('btn-confirm-tech-delete-dt');
        if (!id) return;

        // Double-Submit Guard
        if (btnConfirm) {
            btnConfirm.disabled = true;
            btnConfirm.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Удаление...</span>`;
        }

        try {
            const res = await fetch(`/api/downtimes/${id}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Не удалось удалить запись');
            }

            closeTechDeleteDowntimeModal();
            showDtToast(`Запись простоя #${id} удалена`, 'success');

            // Удаляем запись из локального массива
            allFeedItems = allFeedItems.filter(x => x.id !== parseInt(id));

            // Обновляем счетчики в пилюлях
            const totalCountEl = document.getElementById('dt-feed-total-count');
            const unclassCountEl = document.getElementById('dt-feed-unclass-count');
            if (totalCountEl) {
                const cur = parseInt(totalCountEl.textContent) || 0;
                totalCountEl.textContent = Math.max(0, cur - 1);
            }
            if (unclassCountEl) {
                const curUnclass = allFeedItems.filter(x => x.is_unclassified).length;
                unclassCountEl.textContent = curUnclass;
            }

            // Удаляем строку из DOM с плавной анимацией
            const row = document.getElementById(`dt-row-${id}`);
            if (row) {
                row.style.transition = 'all 0.3s ease';
                row.style.opacity = '0';
                row.style.transform = 'translateX(20px)';
                setTimeout(() => {
                    row.remove();
                    if (allFeedItems.length === 0) {
                        renderFeedTable([]);
                    }
                }, 300);
            } else {
                renderFeedTable(allFeedItems);
            }

        } catch(e) {
            console.error(e);
            showDtToast(e.message || 'Ошибка сети при удалении', 'error');
        } finally {
            if (btnConfirm) {
                btnConfirm.disabled = false;
                btnConfirm.innerHTML = `<i class="fa-solid fa-trash-can"></i> <span>Да, удалить</span>`;
            }
        }
    };

})();

