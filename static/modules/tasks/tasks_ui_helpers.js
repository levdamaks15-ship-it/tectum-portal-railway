function openFilterSheet() {
        const sheet = document.getElementById('apple-filter-sheet');
        if (!sheet) return;
        const panel = sheet.querySelector('.apple-filter-panel');
        const backdrop = sheet.children[0];
        if (typeof updateFilterSheetUI === 'function') updateFilterSheetUI();
        sheet.style.display = 'block';
        if (backdrop) backdrop.style.opacity = '1';
        panel.style.transition = 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
        panel.style.transform = 'translateY(100%)';
        requestAnimationFrame(() => {
            panel.style.transform = 'translateY(0)';
        });
    }

    function closeFilterSheet() {
        const sheet = document.getElementById('apple-filter-sheet');
        if (!sheet) return;
        const panel = sheet.querySelector('.apple-filter-panel');
        const backdrop = sheet.children[0];
        panel.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
        panel.style.transform = 'translateY(100%)';
        if (backdrop) {
            backdrop.style.transition = 'opacity 0.25s ease';
            backdrop.style.opacity = '0';
        }
        setTimeout(() => {
            sheet.style.display = 'none';
            if (backdrop) backdrop.style.opacity = '1';
        }, 260);
    }

    function toggleFilterSheet() {
        const sheet = document.getElementById('apple-filter-sheet');
        if (!sheet) return;
        if (sheet.style.display === 'none' || !sheet.style.display) {
            openFilterSheet();
        } else {
            closeFilterSheet();
        }
    }

    /* ── Apple Date Picker Bottom Sheet (Месяц / Неделя) ─────────────────── */
    let currentAppleDateTab = 'month';

    function openAppleDatePicker(tab) {
        currentAppleDateTab = tab || 'month';
        const sheet = document.getElementById('apple-date-sheet');
        if (!sheet) return;
        const panel = sheet.querySelector('.apple-date-panel');
        const backdrop = sheet.children[0];
        renderAppleDateTab();
        sheet.style.display = 'block';
        if (backdrop) backdrop.style.opacity = '1';
        panel.style.transition = 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
        panel.style.transform = 'translateY(100%)';
        requestAnimationFrame(() => {
            panel.style.transform = 'translateY(0)';
        });
    }

    function closeAppleDatePicker() {
        const sheet = document.getElementById('apple-date-sheet');
        if (!sheet) return;
        const panel = sheet.querySelector('.apple-date-panel');
        const backdrop = sheet.children[0];
        panel.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
        panel.style.transform = 'translateY(100%)';
        if (backdrop) {
            backdrop.style.transition = 'opacity 0.25s ease';
            backdrop.style.opacity = '0';
        }
        setTimeout(() => {
            sheet.style.display = 'none';
            if (backdrop) backdrop.style.opacity = '1';
        }, 260);
    }

    function switchAppleDateTab(tab) {
        currentAppleDateTab = tab;
        renderAppleDateTab();
    }

    function renderAppleDateTab() {
        const btnMonth = document.getElementById('apple-tab-pick-month');
        const btnWeek  = document.getElementById('apple-tab-pick-week');
        const list     = document.getElementById('apple-date-picker-list');
        const monthSel = document.getElementById('filter-month');
        const weekSel  = document.getElementById('filter-week');

        if (currentAppleDateTab === 'month') {
            btnMonth.style.background = '#C82323';
            btnMonth.style.color = '#FFFFFF';
            btnWeek.style.background = '#F2F2F7';
            btnWeek.style.color = '#1C1C1E';

            if (!monthSel) return;
            const curVal = monthSel.value;
            let html = '';
            Array.from(monthSel.options).forEach(opt => {
                const isSel = opt.value === curVal;
                html += `
                    <div onclick="selectAppleMonth('${opt.value}')" style="display: flex; align-items: center; justify-content: space-between; height: 48px; border-bottom: 1px solid rgba(60,60,67,0.1); cursor: pointer;">
                        <span style="font-size: 16px; font-weight: ${isSel ? '700' : '400'}; color: ${isSel ? '#C82323' : '#1C1C1E'};">${opt.text}</span>
                        ${isSel ? '<i class="fa-solid fa-check" style="color: #C82323; font-size: 15px;"></i>' : ''}
                    </div>
                `;
            });
            list.innerHTML = html;
        } else {
            btnMonth.style.background = '#F2F2F7';
            btnMonth.style.color = '#1C1C1E';
            btnWeek.style.background = '#C82323';
            btnWeek.style.color = '#FFFFFF';

            if (!weekSel) return;
            const curVal = weekSel.value;
            let html = '';
            Array.from(weekSel.options).forEach(opt => {
                const isSel = opt.value === curVal;
                html += `
                    <div onclick="selectAppleWeek('${opt.value}')" style="display: flex; align-items: center; justify-content: space-between; height: 48px; border-bottom: 1px solid rgba(60,60,67,0.1); cursor: pointer;">
                        <span style="font-size: 15px; font-weight: ${isSel ? '700' : '400'}; color: ${isSel ? '#C82323' : '#1C1C1E'};">${opt.text}</span>
                        ${isSel ? '<i class="fa-solid fa-check" style="color: #C82323; font-size: 15px;"></i>' : ''}
                    </div>
                `;
            });
            list.innerHTML = html || '<div style="padding: 24px; text-align: center; color: #8E8E93;">Нет доступных недель для данного месяца</div>';
        }
    }

    function selectAppleMonth(val) {
        const monthSel = document.getElementById('filter-month');
        if (monthSel) {
            monthSel.value = val;
            if (typeof onMonthChange === 'function') {
                onMonthChange();
            }
        }
        syncAppleTitleHeader();
        // Переключаем на выбор недели после смены месяца, если не 'all'
        if (val !== 'all') {
            setTimeout(() => {
                switchAppleDateTab('week');
            }, 100);
        } else {
            closeAppleDatePicker();
        }
    }

    function selectAppleWeek(val) {
        const weekSel = document.getElementById('filter-week');
        if (weekSel) {
            weekSel.value = val;
            if (typeof loadTasks === 'function') {
                loadTasks();
            }
        }
        syncAppleTitleHeader();
        closeAppleDatePicker();
    }

    /* ── Переключение Bottom Nav: активный цвет + заголовок ─────────────── */
    const HORIZON_LABELS = {
        weekly: 'Спринт', services: 'Службы',
        tech_council: 'Техсовет', quality_day: 'День качества',
        roadmaps: 'Дорожные карты', my: 'Мои задачи'
    };

    function appleNavSwitch(key) {
        document.querySelectorAll('#apple-bottom-nav .apple-nav-item').forEach(el => {
            const isActive = el.dataset.horizon === key;
            el.style.color = isActive ? '#C82323' : '#8E8E93';
        });
        const sectionEl = document.getElementById('apple-title-section');
        if (sectionEl) sectionEl.textContent = HORIZON_LABELS[key] || 'Спринт';
        setTimeout(syncAppleTitleHeader, 100);
    }

    function selectMyTasksFromNav() {
        if (typeof myTasksFilterActive !== 'undefined' && !myTasksFilterActive) {
            if (typeof toggleMyTasksFilter === 'function') toggleMyTasksFilter();
        } else {
            if (typeof currentHorizon !== 'undefined' && currentHorizon === 'roadmaps') {
                if (typeof loadRoadmaps === 'function') loadRoadmaps();
            } else {
                if (typeof loadTasks === 'function') loadTasks();
            }
        }
        appleNavSwitch('my');
    }

    /* ── Синхронизация Apple Large Title Header ──────────────────────────── */
    function syncAppleTitleHeader() {
        try {
            const monthSel   = document.getElementById('filter-month');
            const weekSel    = document.getElementById('filter-week');
            const monthTextEl = document.getElementById('apple-title-month-text');
            const weekTextEl  = document.getElementById('apple-title-week-text');
            const appleCount  = document.getElementById('apple-task-count');
            const appleAvatar = document.getElementById('apple-avatar-btn');

            // Месяц
            if (monthSel && monthTextEl) {
                const mv = monthSel.value;
                monthTextEl.textContent = (mv === 'all' || !mv) ? 'Все задачи' : mv;
            }

            // Неделя
            if (weekSel && weekTextEl) {
                const wv = weekSel.value || '';
                if (!wv || wv === 'all') {
                    weekTextEl.textContent = 'Весь месяц';
                } else {
                    const clean = wv.replace(/^Неделя\s*/i, '');
                    weekTextEl.textContent = 'Нед. ' + clean;
                }
            }

            // Счётчик
            if (appleCount) {
                const cards = document.querySelectorAll('#tasks-cards-container .planner-card');
                const rows  = document.querySelectorAll('#tasks-table-body tr[id^="task-row-"]');
                appleCount.textContent = cards.length || rows.length || 0;
            }

            // Аватар
            if (appleAvatar && typeof currentPlannerUser !== 'undefined' && currentPlannerUser && currentPlannerUser.name) {
                const parts = currentPlannerUser.name.trim().split(' ').filter(Boolean);
                const initials = parts.slice(0, 2).map(w => w[0]).join('').toUpperCase();
                appleAvatar.innerHTML = `<span style="font-size:13px;font-weight:700;">${initials}</span>`;
            }

            // Заголовок раздела
            const sectionEl = document.getElementById('apple-title-section');
            if (sectionEl) {
                if (typeof myTasksFilterActive !== 'undefined' && myTasksFilterActive) {
                    sectionEl.textContent = 'Мои задачи';
                } else {
                    const activeTab = document.querySelector('.horizon-tab-btn.active');
                    if (activeTab) {
                        const tabText = activeTab.textContent.trim().replace(/^[^\w]*/, '').trim();
                        const sectionMap = {
                            'weekly': 'Спринт', 'services': 'Службы', 'tech_council': 'Техсовет',
                            'quality_day': 'День качества', 'roadmaps': 'Дорожные карты'
                        };
                        const tabId = activeTab.id || '';
                        const key = tabId.replace('tab-horizon-', '');
                        sectionEl.textContent = sectionMap[key] || tabText.split(' ').slice(-1)[0] || 'Спринт';
                    }
                }
            }
        } catch(e) {}
    }

    document.addEventListener('DOMContentLoaded', function() {
        syncAppleTitleHeader();
        if (typeof initBottomSheetSwipeGestures === 'function') {
            initBottomSheetSwipeGestures();
        }
        const cardsEl = document.getElementById('tasks-cards-container');
        const tableEl = document.getElementById('tasks-table-body');
        [cardsEl, tableEl].forEach(el => {
            if (el) {
                const obs = new MutationObserver(syncAppleTitleHeader);
                obs.observe(el, { childList: true, subtree: false });
            }
        });

        // URL deep-link to auto-open task modals (useful for shortcuts and verification)
        try {
            const p = new URLSearchParams(window.location.search);
            const m = p.get('open_modal');
            if (m === 'add') {
                setTimeout(() => {
                    const h = p.get('horizon');
                    if (h && typeof switchHorizon === 'function') {
                        switchHorizon(h);
                    }
                    if (typeof openAddTaskModal === 'function') {
                        const pr = openAddTaskModal(h ? (h === 'services' ? 'service_plan' : h === 'roadmaps' ? 'roadmap' : h) : null);
                        Promise.resolve(pr).then(() => {
                            if (p.get('photo')) {
                                setTimeout(() => {
                                    const photoInput = document.getElementById('task-photo-input');
                                    if (photoInput) {
                                        photoInput.value = '/static/img/Logo.png';
                                        if (typeof onPhotoInputChanged === 'function') onPhotoInputChanged('task-photo-input');
                                    }
                                }, 150);
                            }
                            if (p.get('open_assignee')) {
                                setTimeout(() => {
                                    if (typeof toggleTaskAssigneePopover === 'function') {
                                        toggleTaskAssigneePopover();
                                    }
                                }, 250);
                            } else if (p.get('assignee')) {
                                setTimeout(() => {
                                    if (typeof selectTaskAssignee === 'function') {
                                        selectTaskAssignee(p.get('assignee'));
                                    }
                                }, 250);
                            }
                        });
                    }
                }, 350);
            } else if (m === 'bulk') {
                setTimeout(() => {
                    if (typeof openBulkTasksModal === 'function') {
                        openBulkTasksModal();
                        if (p.get('open_zone')) {
                            setTimeout(() => {
                                if (typeof toggleBulkZonePopover === 'function') toggleBulkZonePopover();
                            }, 200);
                        } else if (p.get('open_author')) {
                            setTimeout(() => {
                                if (typeof toggleBulkAuthorPopover === 'function') toggleBulkAuthorPopover();
                            }, 200);
                        } else if (p.get('open_row_assignee')) {
                            setTimeout(() => {
                                const firstRow = document.querySelector('.bulk-task-row');
                                if (firstRow && typeof toggleBulkRowAssigneePopover === 'function') {
                                    toggleBulkRowAssigneePopover(null, firstRow.id);
                                }
                            }, 250);
                        }
                    }
                }, 350);
            }
            if (p.get('open_graph')) {
                setTimeout(() => {
                    const gid = parseInt(p.get('open_graph'), 10);
                    if (typeof openProjectGraphModal === 'function' && gid) {
                        openProjectGraphModal(gid);
                        if (p.get('select_node')) {
                            setTimeout(() => {
                                const nid = parseInt(p.get('select_node'), 10);
                                if (typeof selectGraphNode === 'function') selectGraphNode(nid);
                            }, 600);
                        }
                        if (p.get('open_new_stage')) {
                            setTimeout(() => {
                                if (typeof openGraphAddStageModal === 'function') {
                                    openGraphAddStageModal();
                                    if (p.get('open_stage_assignee')) {
                                        setTimeout(() => {
                                            if (typeof toggleGraphStageAssigneePopover === 'function') toggleGraphStageAssigneePopover();
                                        }, 250);
                                    }
                                }
                            }, 600);
                        }
                    }
                }, 450);
            }
            if (p.get('open_detail')) {
                const tid = parseInt(p.get('open_detail'), 10);
                setTimeout(() => {
                    if (typeof openTaskDetailModal === 'function' && tid) {
                        openTaskDetailModal(tid);
                        if (p.get('edit_comment')) {
                            setTimeout(() => {
                                if (typeof enableDetailCommentEdit === 'function') enableDetailCommentEdit();
                            }, 200);
                        }
                    }
                }, 50);
            }
            if (p.get('open_status')) {
                setTimeout(() => {
                    if (typeof toggleDeckFilterPopover === 'function') {
                        toggleDeckFilterPopover('status', { stopPropagation: () => {} });
                    }
                }, 350);
            }
        } catch(e) {}
    });