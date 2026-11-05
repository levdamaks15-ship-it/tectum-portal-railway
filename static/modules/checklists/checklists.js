let currentTemplates = [];
        let activeTemplate = null;
        let allEmployees = [];
        let scheduleInfo = null;

        const SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/17AqmwqceblrAzlHfSztc80cmGJJ71B_godpYoK0QHrc/edit";

        function openGoogleSheet() {
            window.open(SPREADSHEET_URL, '_blank');
        }

        function toggleTheme() {
            const current = document.documentElement.getAttribute('data-theme');
            const target = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', target);
            localStorage.setItem('theme', target);
        }

        // Init Theme
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);

        function showNotification(type, title, message) {
            const modal = document.getElementById('universal-notification-modal');
            const overlay = document.getElementById('universal-notification-overlay');
            const iconContainer = document.getElementById('unm-icon');
            const iconText = document.getElementById('unm-icon-text');
            const titleEl = document.getElementById('unm-title');
            const messageEl = document.getElementById('unm-message');
            const btn = document.getElementById('unm-btn');

            if (!modal || !overlay) {
                alert(`${title}\n${message}`);
                return;
            }

            if (type === 'success') {
                iconContainer.style.background = 'rgba(34, 197, 94, 0.15)';
                iconContainer.style.border = '2px solid #22c55e';
                iconText.style.color = '#22c55e';
                iconText.innerHTML = '✓';
                btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
                btn.style.boxShadow = '0 8px 20px rgba(16, 185, 129, 0.3)';
            } else if (type === 'error') {
                iconContainer.style.background = 'rgba(239, 68, 68, 0.15)';
                iconContainer.style.border = '2px solid #ef4444';
                iconText.style.color = '#ef4444';
                iconText.innerHTML = '✕';
                btn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
                btn.style.boxShadow = '0 8px 20px rgba(239, 68, 68, 0.3)';
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

        function switchClTab(tab, event) {
            if (event) {
                if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                    event.preventDefault();
                } else {
                    return;
                }
            }
            if (window.location.hash !== `#${tab}`) {
                history.replaceState(null, '', `#${tab}`);
            }
            document.querySelectorAll('.cl-tab-btn').forEach(btn => btn.classList.remove('active'));
            if (tab === 'fill') {
                const btn = document.getElementById('cl-tab-btn-fill') || document.querySelectorAll('.cl-tab-btn')[0];
                if (btn) btn.classList.add('active');
                document.getElementById('tab-fill-content').style.display = 'block';
                document.getElementById('tab-journal-content').style.display = 'none';
            } else if (tab === 'journal') {
                const btn = document.getElementById('cl-tab-btn-journal') || document.querySelectorAll('.cl-tab-btn')[1];
                if (btn) btn.classList.add('active');
                document.getElementById('tab-fill-content').style.display = 'none';
                document.getElementById('tab-journal-content').style.display = 'block';
                loadChecklistJournal();
            }
        }

        const FALLBACK_TEMPLATES = [
            {
                code: "master_shift",
                title: "Чек-лист мастера смены",
                subtitle: "Проверка состояния оборудования и рабочих мест перед началом смены",
                department: "Цех ХЦИ",
                has_submitter: true,
                inspector_label: "Принимающий смену мастер",
                submitter_label: "Сдающий смену мастер",
                items: [
                    { index: 1, title: "Состояние прокладок", desc: "Целостность и износ прокладочного материала" },
                    { index: 2, title: "Подкрутка всех болтов и гаек на машине", desc: "Проверка затяжки ключевых узлов и креплений" },
                    { index: 3, title: "Проверка состояния бахромы", desc: "Состояние и очистка сукна / бахромы" },
                    { index: 4, title: "Наличие поддонов", desc: "Запас деревянных поддонов на линии и участках" },
                    { index: 5, title: "Все ли расходники в достатке", desc: "Наличие сырья, скотча, маркировочных материалов" },
                    { index: 6, title: "Таблички КВТ установлены правильно", desc: "Контроль визуализации и знаков безопасности" },
                    { index: 7, title: "Отсутствие засорения и забивки механизмов и деталей", desc: "Чистота направляющих, роликов, датчиков" },
                    { index: 8, title: "Порядок на рабочих местах", desc: "5S, отсутствие посторонних предметов и мусора" },
                    { index: 9, title: "Готовые пачки продукции вывезены со склада/участка", desc: "Своевременная передача на склад ГП" }
                ]
            },
            {
                code: "worker_shift_handover",
                title: "Чек-лист приема-передачи смены (Рабочие)",
                subtitle: "Ауысымды қабылдау-тапсыру чек-парағы / Состояние рабочего места",
                department: "Сменный участок",
                has_submitter: true,
                inspector_label: "Принимающий / Қабылдаушы",
                submitter_label: "Сдающий / Тапсырушы",
                items: [
                    { index: 1, title: "Чистота рабочего места / Тазалық", desc: "Уборка зоны, отсутствие шлама, грязи и отходов" },
                    { index: 2, title: "Состояние инвентаря / Мүкәммал", desc: "Наличие и исправность лопат, щеток, емкостей" },
                    { index: 3, title: "Состояние инструмента / Құрал", desc: "Комплектность и исправность рабочего инструмента" },
                    { index: 4, title: "Оборудование и механизмы / Қондырғылар", desc: "Исправность узлов на позиции, отсутствие течей и шумов" },
                    { index: 5, title: "СИЗ и Безопасность / Қорғаныс құралдары", desc: "Применение спецодежды, касок, защитных очков" }
                ]
            },
            {
                code: "day_inspection",
                title: "Чек-лист дневных сотрудников и инспекций",
                subtitle: "Тексеру чек-парағы / Ежедневный контроль участка",
                department: "ИТР / Дневные службы",
                has_submitter: true,
                inspector_label: "Проверяющий / Тексеруші",
                submitter_label: "Ответственный сдающий / Тапсырушы",
                items: [
                    { index: 1, title: "Чистота и порядок в цехе / Тазалық", desc: "Отсутствие захламления проходов и зон обслуживания" },
                    { index: 2, title: "Состояние инвентаря и оборудования / Мүкәммал", desc: "Техническое состояние закрепленных агрегатов" },
                    { index: 3, title: "Исправность инструмента / Құрал", desc: "Правильное хранение и безопасность использования" },
                    { index: 4, title: "Охрана труда и промбезопасность", desc: "Соблюдение регламентов и инструкций персоналом" }
                ]
            }
        ];

        async function clLogout() {
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

        async function initChecklistApp() {
            // Инициализация канонического профиля в шапке
            try {
                let userObj = null;
                const storedUser = localStorage.getItem('tectum_auth_user') || localStorage.getItem('tectum_portal_user');
                if (storedUser) {
                    userObj = JSON.parse(storedUser);
                }
                const cachedName = localStorage.getItem('tectum_current_user_name');
                const userNameEl = document.getElementById('user-greeting-name');
                const userRoleEl = document.getElementById('user-greeting-role');
                if (userNameEl) {
                    userNameEl.innerText = (userObj && userObj.name) || cachedName || 'Сотрудник';
                }
                if (userRoleEl) {
                    if (userObj && userObj.role) {
                        const roleMap = {
                            'master': 'Мастер ХЦИ',
                            'xci_master': 'Мастер ХЦИ',
                            'admin': 'Администратор',
                            'director': 'Директор',
                            'qcd': 'Служба СКК',
                            'lkc_master': 'Мастер ЛКЦ',
                            'operator': 'Оператор'
                        };
                        userRoleEl.innerText = roleMap[userObj.role] || userObj.role;
                    } else {
                        userRoleEl.innerText = 'Чек-листы';
                    }
                }
            } catch(e) {
                console.warn('[Header] Failed to parse auth user', e);
            }

            currentTemplates = FALLBACK_TEMPLATES;
            renderTemplateCards();
            selectTemplate(currentTemplates[0].code);

            const initialHash = window.location.hash ? window.location.hash.replace('#', '') : '';
            if (initialHash === 'journal' || initialHash === 'fill') {
                switchClTab(initialHash);
            }

            try {
                const [schedRes, empRes, tplRes] = await Promise.allSettled([
                    fetch('/api/checklists/schedule/today').then(r => r.json()),
                    fetch('/api/checklists/employees').then(r => r.json()),
                    fetch('/api/checklists/templates').then(r => r.json())
                ]);

                if (schedRes.status === 'fulfilled' && schedRes.value) {
                    scheduleInfo = schedRes.value;
                    document.getElementById('cl-date').value = scheduleInfo.date || '19.08.2026';
                    document.getElementById('cl-shift-name').value = scheduleInfo.shift_name || 'День';

                    if (scheduleInfo.current_shift_group) {
                        setShiftGroupValue(scheduleInfo.current_shift_group, scheduleInfo.prev_shift_group);
                        const dutyBadge = document.getElementById('duty-shift-badge');
                        if (dutyBadge) {
                            dutyBadge.innerText = `Дежурит: ${getShiftPairDisplayName(scheduleInfo.current_shift_group, scheduleInfo.prev_shift_group)} (${scheduleInfo.shift_name})`;
                        }
                    }
                }

                if (empRes.status === 'fulfilled' && Array.isArray(empRes.value)) {
                    allEmployees = empRes.value;
                }

                if (tplRes.status === 'fulfilled' && Array.isArray(tplRes.value) && tplRes.value.length > 0) {
                    currentTemplates = tplRes.value;
                    renderTemplateCards();
                }

                if (activeTemplate) {
                    selectTemplate(activeTemplate.code);
                } else if (currentTemplates.length > 0) {
                    selectTemplate(currentTemplates[0].code);
                }
            } catch (e) {
                console.error('Error initializing checklists:', e);
            }
        }

        function renderTemplateCards() {
            const container = document.getElementById('template-cards-container');
            if (!container) return;

            container.innerHTML = currentTemplates.map(t => `
            <div class="template-card ${activeTemplate && activeTemplate.code === t.code ? 'selected' : ''}" onclick="selectTemplate('${t.code}')">
                <span class="template-badge">${t.department}</span>
                <div style="font-weight: 700; font-size: 1.05rem; margin-bottom: 4px;">${t.title}</div>
                <div style="font-size: 0.8rem; color: var(--cl-subtext);">${t.subtitle}</div>
            </div>
        `).join('');
        }

        function selectTemplate(code) {
            activeTemplate = currentTemplates.find(t => t.code === code);
            if (!activeTemplate) return;

            renderTemplateCards();

            document.getElementById('active-template-title').innerText = activeTemplate.title;
            document.getElementById('active-template-sub').innerText = activeTemplate.subtitle;

            document.getElementById('inspector-label-text').innerText = `5. ${activeTemplate.inspector_label || "Принимающий (ФИО)"}`;
            document.getElementById('submitter-label-text').innerText = `6. ${activeTemplate.submitter_label || "Сдающий (ФИО)"}`;

            updateDepartmentsList();
            renderChecklistItems();
        }

        function onShiftGroupChange() {
            updateDepartmentsList();
        }

        function getShiftGroupDisplayName(shiftStr) {
            if (!shiftStr) return "1-я смена";
            const str = String(shiftStr).trim();
            const numMatch = str.match(/\d+/);
            if (numMatch) {
                return `${numMatch[0]}-я смена`;
            }
            if (str.toLowerCase().includes("котельн")) return "Котельная";
            if (str.toLowerCase().includes("дневн")) return "Дневной персонал";
            return str;
        }

        function getShiftPairDisplayName(curShiftStr, prevShiftStr) {
            const curNum = (curShiftStr ? String(curShiftStr).match(/\d+/) || [''] : [''])[0];
            const prevNum = (prevShiftStr ? String(prevShiftStr).match(/\d+/) || [''] : [''])[0];
            if (curNum && prevNum) {
                return `Смена ${curNum} (прием) ➔ Смена ${prevNum} (сдача)`;
            }
            return getShiftGroupDisplayName(curShiftStr);
        }

        function setShiftGroupValue(curShiftStr, prevShiftStr) {
            const select = document.getElementById('cl-shift-group');
            if (!select) return;
            const curNorm = getShiftGroupDisplayName(curShiftStr);
            const pairLabel = getShiftPairDisplayName(curShiftStr, prevShiftStr);

            // Добавляем или обновляем кастомную опцию с парой смен
            let opt = Array.from(select.options).find(o => o.value === curNorm);
            if (opt) {
                opt.innerText = pairLabel;
                select.value = curNorm;
            } else {
                select.innerHTML = `<option value="${curNorm}" selected>${pairLabel}</option>` + select.innerHTML;
                select.value = curNorm;
            }
        }

        const FACTORY_DEPARTMENTS = [
            "ЛФМ",
            "Дестакер",
            "Стакер",
            "Заготовительное отделение (ЗО)",
            "Рекуператоры и целлюлоза",
            "Участок дозировки",
            "Сменные ремслужбы",
            "СКК",
            "Слесарная мастерская",
            "Зона ремонта насосов",
            "Участок ремонта цилиндров"
        ];

        function updateDepartmentsList() {
            const deptSelect = document.getElementById('cl-department');
            if (!deptSelect || !activeTemplate) return;

            let depts = [];
            if (activeTemplate.code === 'master_shift') {
                depts = ['Цех ХЦИ'];
            } else if (activeTemplate.code === 'day_inspection') {
                depts = ['Все участки', ...FACTORY_DEPARTMENTS];
            } else {
                depts = FACTORY_DEPARTMENTS;
            }

            deptSelect.innerHTML = depts.map(d => `<option value="${d}">${d}</option>`).join('');

            filterEmployeesByDepartment();
        }

        function onDepartmentChange() {
            filterEmployeesByDepartment();
        }

        function filterEmployeesByDepartment() {
            const currentShiftG = document.getElementById('cl-shift-group').value || (scheduleInfo ? scheduleInfo.current_shift_group : '');
            const prevShiftG = (scheduleInfo && scheduleInfo.prev_shift_group) ? scheduleInfo.prev_shift_group : "";
            function normalizeShiftNum(str) {
                if (!str) return "";
                const m = String(str).match(/\d+/);
                return m ? m[0] : "";
            }

            const curNum = normalizeShiftNum(currentShiftG);
            const prevNum = normalizeShiftNum(prevShiftG);

            const deptSelect = document.getElementById('cl-department');
            const selectedDept = deptSelect ? deptSelect.value : '';

            const inspectorSelect = document.getElementById('cl-inspector-name');
            const submitterSelect = document.getElementById('cl-submitter-name');

            if (!inspectorSelect || !submitterSelect) return;

            if (!allEmployees || allEmployees.length === 0) {
                inspectorSelect.innerHTML = '<option value="">Загрузка сотрудников...</option>';
                submitterSelect.innerHTML = '<option value="">Загрузка сотрудников...</option>';
                return;
            }

            // Если это мастерский чек-лист, показываем строго мастеров
            if (activeTemplate && activeTemplate.code === 'master_shift') {
                const allMasters = allEmployees.filter(e => e.position && e.position.toLowerCase().includes('мастер'));

                const curMasters = allMasters.filter(e => {
                    const eNum = normalizeShiftNum(e.shift_group);
                    return (curNum && eNum === curNum) || (e.shift_group === currentShiftG);
                });
                const prevMasters = allMasters.filter(e => {
                    const eNum = normalizeShiftNum(e.shift_group);
                    return (prevNum && eNum === prevNum) || (e.shift_group === prevShiftG);
                });

                const inspectorList = curMasters.length ? curMasters : allMasters;
                const submitterList = prevMasters.length ? prevMasters : allMasters;

                inspectorSelect.innerHTML = inspectorList.map(e => `<option value="${e.name}">${e.name} (${e.position}${e.shift_group ? ' - ' + e.shift_group : ''})</option>`).join('');
                submitterSelect.innerHTML = submitterList.map(e => `<option value="${e.name}">${e.name} (${e.position}${e.shift_group ? ' - ' + e.shift_group : ''})</option>`).join('');
                return;
            }

            // Фильтрация по участку
            function matchDept(emp) {
                if (!selectedDept || selectedDept === 'Все участки') return true;
                if (emp.department && emp.department.toLowerCase() === selectedDept.toLowerCase()) return true;
                const p = (emp.position || '').toLowerCase();
                if (selectedDept === 'ЛФМ') return p.includes('машин') || p.includes('помощник');
                if (selectedDept === 'Дестакер') return p.includes('дестакер');
                if (selectedDept === 'Стакер') return p.includes('стакер') && !p.includes('дестакер');
                if (selectedDept.includes('Рекуператор') || selectedDept.includes('целлюлоз')) return p.includes('целлюлоз') || p.includes('рекуператор');
                if (selectedDept.includes('Заготовительное') || selectedDept.includes('ЗО')) return p.includes('зо') && !p.includes('целлюлоз');
                if (selectedDept === 'Участок дозировки') return p.includes('дозиров');
                if (selectedDept.includes('Сменные ремслужбы') || selectedDept.includes('Слесарная')) return p.includes('слесар') || p.includes('электрик');
                if (selectedDept === 'Зона ремонта насосов') return p.includes('насос');
                if (selectedDept === 'Участок ремонта цилиндров') return p.includes('цилиндр');
                if (selectedDept === 'СКК') return p.includes('лаборант') || p.includes('отк') || p.includes('скк');
                return true;
            }

            // 1. Принимающие (из текущей смены и выбранного участка)
            let curShiftEmployees = allEmployees.filter(e => {
                const eNum = normalizeShiftNum(e.shift_group);
                const matchShift = (curNum && eNum === curNum) || (e.shift_group === currentShiftG);
                return matchShift && matchDept(e);
            });

            // 2. Сдающие (из сдающей смены и выбранного участка)
            let prevShiftEmployees = allEmployees.filter(e => {
                const eNum = normalizeShiftNum(e.shift_group);
                const matchShift = (prevNum && eNum === prevNum) || (e.shift_group === prevShiftG);
                return matchShift && matchDept(e);
            });

            // Fallbacks: если по участку нет людей, берем всех из смены
            if (curShiftEmployees.length === 0) {
                curShiftEmployees = allEmployees.filter(e => {
                    const eNum = normalizeShiftNum(e.shift_group);
                    return (curNum && eNum === curNum) || (e.shift_group === currentShiftG);
                });
            }
            if (curShiftEmployees.length === 0) {
                curShiftEmployees = allEmployees;
            }

            if (prevShiftEmployees.length === 0) {
                prevShiftEmployees = allEmployees.filter(e => {
                    const eNum = normalizeShiftNum(e.shift_group);
                    return (prevNum && eNum === prevNum) || (e.shift_group === prevShiftG);
                });
            }
            if (prevShiftEmployees.length === 0) {
                prevShiftEmployees = allEmployees;
            }

            inspectorSelect.innerHTML = curShiftEmployees.map(e => `<option value="${e.name}">${e.name} (${e.position}${e.shift_group ? ' - ' + e.shift_group : ''})</option>`).join('');
            submitterSelect.innerHTML = prevShiftEmployees.map(e => `<option value="${e.name}">${e.name} (${e.position}${e.shift_group ? ' - ' + e.shift_group : ''})</option>`).join('');
        }

        function onInspectorChange() { }

        async function onShiftChange() {
            const isDay = document.getElementById('cl-shift-name').value === 'День';

            if (scheduleInfo && scheduleInfo.schedule_entry) {
                const curG = isDay ? scheduleInfo.schedule_entry.day_shift_group : scheduleInfo.schedule_entry.night_shift_group;
                // Для Дня: сдавала прошлая Ночь. Для Ночи: сдает сегодняшний День.
                const prevG = isDay ? (scheduleInfo.schedule_entry.day_prev_shift_group || scheduleInfo.schedule_entry.night_shift_group) : (scheduleInfo.schedule_entry.night_prev_shift_group || scheduleInfo.schedule_entry.day_shift_group);

                scheduleInfo.current_shift_group = curG;
                scheduleInfo.prev_shift_group = prevG;
                scheduleInfo.shift_name = isDay ? 'День' : 'Ночь';

                setShiftGroupValue(curG, prevG);
                document.getElementById('duty-shift-badge').innerText = `Дежурит: ${getShiftPairDisplayName(curG, prevG)} (${scheduleInfo.shift_name})`;

                updateDepartmentsList();
            }
        }

        function renderChecklistItems() {
            const container = document.getElementById('checklist-items-container');
            if (!container || !activeTemplate) return;

            container.innerHTML = activeTemplate.items.map(item => `
            <div class="check-item" id="check-item-row-${item.index}">
                <div class="check-item-header">
                    <div>
                        <div class="check-item-title">
                            <span style="color: var(--cl-primary); font-weight: 700; margin-right: 6px;">#${item.index}</span>
                            ${item.title}
                        </div>
                        <div class="check-item-desc">${item.desc || ''}</div>
                    </div>
                    <div class="status-toggle-btn-group">
                        <button type="button" class="status-btn ok active" id="btn-ok-${item.index}" onclick="setItemStatus(${item.index}, 'ok')">
                            ✔️ Норма
                        </button>
                        <button type="button" class="status-btn fail" id="btn-fail-${item.index}" onclick="setItemStatus(${item.index}, 'fail')">
                            ❌ Замечание
                        </button>
                    </div>
                </div>
                <div class="comment-field" id="comment-box-${item.index}">
                    <input type="text" class="form-control" id="comment-input-${item.index}" placeholder="Опишите выявленный дефект или проблему...">
                </div>
            </div>
        `).join('');
        }

        function setItemStatus(index, status) {
            const row = document.getElementById(`check-item-row-${index}`);
            const btnOk = document.getElementById(`btn-ok-${index}`);
            const btnFail = document.getElementById(`btn-fail-${index}`);
            const commentBox = document.getElementById(`comment-box-${index}`);

            if (status === 'ok') {
                btnOk.classList.add('active');
                btnFail.classList.remove('active');
                row.classList.remove('has-remark');
                commentBox.classList.remove('visible');
            } else {
                btnFail.classList.add('active');
                btnOk.classList.remove('active');
                row.classList.add('has-remark');
                commentBox.classList.add('visible');
                const commentInput = document.getElementById(`comment-input-${index}`);
                if (commentInput) commentInput.focus();
            }
        }

        async function submitChecklist() {
            const inspectorName = document.getElementById('cl-inspector-name').value;
            if (!inspectorName) {
                alert('Пожалуйста, выберите ФИО принимающего / проверяющего сотрудника!');
                return;
            }

            const submitterName = document.getElementById('cl-submitter-name').value;
            const dateStr = document.getElementById('cl-date').value;
            const shiftName = document.getElementById('cl-shift-name').value;
            const shiftGroup = document.getElementById('cl-shift-group').value;
            const notes = document.getElementById('cl-overall-notes').value;

            // Gather items
            const items = activeTemplate.items.map(item => {
                const isOk = document.getElementById(`btn-ok-${item.index}`).classList.contains('active');
                const comment = document.getElementById(`comment-input-${item.index}`).value;
                return {
                    index: item.index,
                    title: item.title,
                    status: isOk ? 'ok' : 'fail',
                    comment: isOk ? '' : comment
                };
            });

            const deptVal = document.getElementById('cl-department') ? document.getElementById('cl-department').value : activeTemplate.department;

            const payload = {
                template_code: activeTemplate.code,
                template_title: activeTemplate.title,
                date_str: dateStr,
                shift_name: shiftName,
                shift_group: shiftGroup,
                department: deptVal,
                inspector_name: inspectorName,
                inspector_position: activeTemplate.code === 'master_shift' ? 'Мастер' : deptVal,
                submitter_name: submitterName,
                submitter_position: activeTemplate.code === 'master_shift' ? 'Мастер' : deptVal,
                notes: notes,
                items: items
            };

            const submitBtn = document.getElementById('cl-submit-btn');
            const statusDiv = document.getElementById('cl-submit-status');

            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span>⏳ Сохранение и передача в Google Sheets...</span>';
            statusDiv.style.display = 'none';

            try {
                const resp = await fetch('/api/checklists/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const res = await resp.json();
                if (resp.ok) {
                    // Очистка полей ввода и возврат формы в начальное состояние
                    document.getElementById('cl-overall-notes').value = '';
                    renderChecklistItems();

                    // Модальное уведомление с кнопкой ОК (как на портале)
                    showNotification(
                        'success',
                        'Чек-лист сохранен!',
                        `Чек-лист #${res.id} успешно зарегистрирован в базе данных и отправлен в Google Таблицу.`
                    );
                } else {
                    throw new Error(res.detail || 'Ошибка сохранения');
                }
            } catch (err) {
                showNotification('error', 'Ошибка сохранения', err.message || 'Не удалось сохранить чек-лист');
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<span>💾 Сохранить и передать в отчет</span>';
            }
        }

        async function loadChecklistJournal() {
            const container = document.getElementById('journal-list-container');
            if (!container) return;

            container.innerHTML = '<div style="text-align:center; color:var(--cl-subtext); padding:2rem;">Загрузка журнала...</div>';

            try {
                const resp = await fetch('/api/checklists/submissions?limit=30');
                const data = await resp.json();

                if (!data || data.length === 0) {
                    container.innerHTML = '<div style="text-align:center; color:var(--cl-subtext); padding:2rem;">Заполненных чек-листов пока нет. Будьте первым!</div>';
                    return;
                }

                container.innerHTML = data.map(sub => `
                <div class="history-card">
                    <div class="history-header">
                        <div>
                            <span style="font-weight:700; font-size:1.05rem;">${sub.template_title}</span>
                            <span style="font-size:0.8rem; color:var(--cl-subtext); margin-left:8px;">${sub.date_str} (${sub.shift_name}, ${sub.shift_group || ''})</span>
                        </div>
                        <span class="badge-status ${sub.remarks_count > 0 ? 'badge-fail' : 'badge-ok'}">
                            ${sub.remarks_count > 0 ? `Замечаний: ${sub.remarks_count}` : '✔️ Норма'}
                        </span>
                    </div>
                    <div style="font-size:0.85rem; margin-bottom:8px;">
                        <strong>Принимающий:</strong> ${sub.inspector_name || '—'} | 
                        <strong>Сдающий:</strong> ${sub.submitter_name || '—'}
                    </div>
                    ${sub.notes ? `<div style="font-size:0.85rem; color:var(--cl-subtext); background:var(--cl-bg); padding:6px 10px; border-radius:6px; margin-bottom:8px;"><strong>Замечания:</strong> ${sub.notes}</div>` : ''}
                    <div style="font-size:0.75rem; color:var(--cl-subtext);">
                        Сохранено: ${sub.created_at}
                    </div>
                </div>
            `).join('');
            } catch (e) {
                container.innerHTML = `<div style="color:var(--cl-danger); padding:1rem;">Ошибка загрузки журнала: ${e.message}</div>`;
            }
        }

        // HTMX & Direct Load Safe Initialization (Tectum Law 6)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChecklistApp);
} else {
    initChecklistApp();
}
document.addEventListener('htmx:afterSwap', initChecklistApp);