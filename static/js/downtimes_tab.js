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

    // Справочник категорий с иконками и стилями
    const DT_CATEGORIES = [
        { name: 'Механические', icon: 'fa-wrench', badgeClass: 'dt-cat-mech', stop: true },
        { name: 'Энергетические', icon: 'fa-bolt', badgeClass: 'dt-cat-energy', stop: true },
        { name: 'Технологические', icon: 'fa-flask', badgeClass: 'dt-cat-tech', stop: true },
        { name: 'ТО и ППР', icon: 'fa-screwdriver-wrench', badgeClass: 'dt-cat-maint', stop: true },
        { name: 'Остановки не связанные с простоем оборудования', icon: 'fa-pause', badgeClass: 'dt-cat-nostop', stop: false },
        { name: 'Санитарный день', icon: 'fa-soap', badgeClass: 'dt-cat-sanitary', stop: true },
        { name: 'Без категории', icon: 'fa-circle-question', badgeClass: 'dt-cat-unclass', stop: true }
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
        return { name: catName, icon: 'fa-tag', badgeClass: 'dt-cat-nostop', stop: true };
    }

    // Инициализация вкладки
    function initDowntimesWorkspace() {
        // Установка дат по умолчанию (последние 7 дней / эта неделя)
        const today = new Date();
        const startOfWeek = new Date();
        startOfWeek.setDate(today.getDate() - 7);

        const formatDate = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        const sInput = document.getElementById('dt-date-from');
        const eInput = document.getElementById('dt-date-to');
        if (sInput && !sInput.value) sInput.value = formatDate(startOfWeek);
        if (eInput && !eInput.value) eInput.value = formatDate(today);

        dtCurrentFilter.start_date = sInput ? sInput.value : '';
        dtCurrentFilter.end_date = eInput ? eInput.value : '';

        // Закрытие поповеров при клике вне
        document.addEventListener('click', (e) => {
            if (activePopover && !e.target.closest('.dt-popover-menu') && !e.target.closest('.dt-cat-picker-btn')) {
                activePopover.style.display = 'none';
                activePopover = null;
            }
        });

        loadDowntimesData();
    }
    window.initDowntimesWorkspace = initDowntimesWorkspace;

    // Переключение пресетов дат
    window.setDtDatePreset = function (preset, btnEl) {
        if (btnEl) {
            document.querySelectorAll('.dt-date-preset').forEach(b => b.classList.remove('active'));
            btnEl.classList.add('active');
        }

        const today = new Date();
        let fromDate = new Date();
        let toDate = new Date();

        if (preset === 'today') {
            fromDate = today;
            toDate = today;
        } else if (preset === 'yesterday') {
            fromDate.setDate(today.getDate() - 1);
            toDate.setDate(today.getDate() - 1);
        } else if (preset === 'week') {
            const day = today.getDay();
            const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Понедельник
            fromDate.setDate(diff);
            toDate = today;
        } else if (preset === 'month') {
            fromDate = new Date(today.getFullYear(), today.getMonth(), 1);
            toDate = today;
        }

        const formatDate = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        const sInput = document.getElementById('dt-date-from');
        const eInput = document.getElementById('dt-date-to');
        if (sInput) sInput.value = formatDate(fromDate);
        if (eInput) eInput.value = formatDate(toDate);

        dtCurrentFilter.start_date = sInput ? sInput.value : '';
        dtCurrentFilter.end_date = eInput ? eInput.value : '';

        loadDowntimesData();
    };

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
    window.loadDowntimesData = function () {
        const sInput = document.getElementById('dt-date-from');
        const eInput = document.getElementById('dt-date-to');
        const lineSelect = document.getElementById('dt-filter-line');
        const catSelect = document.getElementById('dt-filter-category');
        const searchInput = document.getElementById('dt-filter-search');

        if (sInput) dtCurrentFilter.start_date = sInput.value;
        if (eInput) dtCurrentFilter.end_date = eInput.value;
        if (lineSelect) dtCurrentFilter.line = lineSelect.value;
        if (catSelect) dtCurrentFilter.category = catSelect.value;
        if (searchInput) dtCurrentFilter.search = searchInput.value;

        if (dtCurrentFilter.view === 'feed') {
            loadDowntimesFeed();
        } else {
            loadDowntimesSummary();
        }
    };

    // 1. Загрузка ленты быстрой разметки
    async function loadDowntimesFeed() {
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

            renderFeedTable(allFeedItems);
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
    function renderFeedTable(items) {
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
                        ⏱️ ${d.duration} мин
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
                        <i class="fa-solid ${meta.icon}"></i>
                        <span id="label-dt-cat-${d.id}">${escapeHtml(meta.name)}</span>
                        <i class="fa-solid fa-chevron-down" style="font-size: 0.65rem; opacity: 0.7;"></i>
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
                <i class="fa-solid ${c.icon}" style="width: 16px; color: ${c.badgeClass === 'dt-cat-unclass' ? '#ef4444' : '#2563eb'};"></i>
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
                btnEl.innerHTML = `<i class="fa-solid ${meta.icon}"></i> <span>${meta.name}</span> <i class="fa-solid fa-chevron-down" style="font-size: 0.65rem; opacity: 0.7;"></i>`;
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

        let html = `
        <!-- Верхняя шапка KPI (точно как в Excel) -->
        <div class="dt-kpi-summary-box">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 8px;">
                <div>
                    <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: #0f172a;">
                        📊 Простои оборудования за период: ${data.start_date} — ${data.end_date}
                    </h3>
                    <div style="font-size: 0.78rem; color: #64748b; margin-top: 2px;">
                        Линия: <b>${escapeHtml(data.line)}</b> · Время работы: <b>${k.total_operating_hours || 0} ч</b>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <button type="button" class="btn-dt-action primary-sheets" onclick="exportDowntimesToGoogleSheets(this)">
                        <i class="fa-solid fa-file-excel"></i>
                        <span>Выгрузить в Google Таблицу</span>
                    </button>
                </div>
            </div>

            <!-- KPI выработки -->
            <div class="dt-kpi-row-top">
                <div class="dt-kpi-card-item">
                    <div class="kpi-label">Время работы линии</div>
                    <div class="kpi-val">${k.total_operating_hours || 0} ч</div>
                </div>
                <div class="dt-kpi-card-item">
                    <div class="kpi-label">План формовки (шт)</div>
                    <div class="kpi-val">${(k.plan_sheets || 0).toLocaleString()}</div>
                </div>
                <div class="dt-kpi-card-item">
                    <div class="kpi-label">Факт формовки (шт)</div>
                    <div class="kpi-val" style="color: #059669;">${(k.fact_sheets || 0).toLocaleString()}</div>
                </div>
                <div class="dt-kpi-card-item">
                    <div class="kpi-label">Перепроизводство (шт)</div>
                    <div class="kpi-val" style="color: #2563eb;">+${(k.overproduction_sheets || 0).toLocaleString()}</div>
                </div>
                <div class="dt-kpi-card-item">
                    <div class="kpi-label">Потери из-за простоев</div>
                    <div class="kpi-val" style="color: #dc2626;">-${(k.underproduction_sheets || 0).toLocaleString()} шт</div>
                </div>
            </div>

            <!-- Сводная строка часов по категориям -->
            <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #64748b; margin-bottom: 0.5rem;">
                Всего часов простоев: <b style="color: #0f172a; font-size: 0.95rem; font-family: monospace;">${k.total_downtime_formatted || '0:00:00'}</b>
            </div>
            <div class="dt-kpi-hours-deck">
        `;

        cats.forEach(c => {
            html += `
            <div class="dt-kpi-hour-chip" style="background: ${c.color}25; border-color: ${c.color}; color: #1e293b;">
                <span>${c.title}</span>
                <b style="font-family: monospace; font-size: 0.85rem;">${c.total_formatted}</b>
                <span style="font-size: 0.7rem; color: #64748b;">(${(c.percentage_of_pure_time * 100).toFixed(2)}%)</span>
            </div>
            `;
        });

        html += `</div></div>`;

        // 5 блоков категорий (один-в-один как в Excel)
        const bannerClassMap = {
            'mech': 'banner-mech',
            'energy': 'banner-energy',
            'tech': 'banner-tech',
            'maint': 'banner-maint',
            'no_stop': 'banner-nostop'
        };

        cats.forEach(c => {
            const bClass = bannerClassMap[c.key] || 'banner-mech';
            html += `
            <div class="dt-cat-section-card">
                <div class="dt-cat-section-header ${bClass}">
                    <span>${c.title}</span>
                    <span style="font-size: 0.82rem; font-family: monospace;">
                        Итого: <b>${c.total_formatted}</b> (${(c.percentage_of_pure_time * 100).toFixed(2)}% от чистого времени)
                    </span>
                </div>
                <div class="dt-table-responsive">
                    <table class="dt-section-table">
                        <thead>
                            <tr>
                                <th style="width: 100px;">Дата</th>
                                <th style="width: 130px;">Смена / Мастер</th>
                                <th>Причина простоя</th>
                                <th style="width: 80px; text-align: center;">Начало</th>
                                <th style="width: 80px; text-align: center;">Конец</th>
                                <th style="width: 90px; text-align: center;">Время</th>
                                <th style="width: 130px; text-align: right;">Доля от чистого</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            if (c.items.length === 0) {
                html += `<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 1.2rem;">Инциденты отсутствуют</td></tr>`;
            } else {
                c.items.forEach(item => {
                    html += `
                    <tr>
                        <td style="font-weight: 600;">${item.date}</td>
                        <td>
                            <div style="font-weight: 600; color: #0f172a;">${escapeHtml(item.master_name)}</div>
                            <div style="font-size: 0.7rem; color: #64748b;">${item.shift_name}</div>
                        </td>
                        <td style="color: #1e293b;">${escapeHtml(item.reason)}</td>
                        <td style="text-align: center; font-family: monospace;">${item.start_time}</td>
                        <td style="text-align: center; font-family: monospace;">${item.end_time}</td>
                        <td style="text-align: center; font-family: monospace; font-weight: 700; color: #2563eb;">${item.duration_formatted}</td>
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

