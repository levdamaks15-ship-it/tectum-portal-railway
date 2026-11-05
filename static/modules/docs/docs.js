let currentFolderId = null;
        let lastNavigatedFolderId = null;
        let lastNavigatedFolderName = 'Все документы';
        let lastNavigatedFolderProtected = false;
        let isSearchActive = false;
        let sidebarFolderMap = {};
        let parentFolderIdHistory = [];
        let folderNameHistory = [];
        let searchTimeout = null;
        let expandedFolders = new Set();
        let currentFoldersData = [];
        let currentFilesData = [];
        let currentDocTypeFilter = 'all';
        let currentLoadToken = 0;

        function setDocTypeFilter(filterKey) {
            currentDocTypeFilter = filterKey;
            document.querySelectorAll('.docs-chip').forEach(chip => chip.classList.remove('active'));
            const activeChip = document.getElementById(`chip-filter-${filterKey}`);
            if (activeChip) activeChip.classList.add('active');
            applySort();
        }

        function getFileCategoryGroup(file) {
            const m = (file.mimeType || '').toLowerCase();
            const name = (file.name || '').toLowerCase();
            const url = (file.external_url || file.webViewLink || '').toLowerCase();

            if (m.includes('pdf') || name.endsWith('.pdf') || url.endsWith('.pdf') || url.includes('.pdf')) {
                return 'pdf';
            }
            if (m.includes('spreadsheet') || m.includes('excel') || m.includes('csv') || url.includes('spreadsheets') || name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
                return 'sheets';
            }
            if (m.includes('document') || m.includes('word') || url.includes('document/d/') || name.endsWith('.docx') || name.endsWith('.doc')) {
                return 'docs';
            }
            return 'other';
        }

        /* ==========================================================
           SIDEBAR DRAWER TOGGLING (MOBILE)
           ========================================================== */
        function toggleDocsSidebar(forceState) {
            const sidebar = document.getElementById('docs-sidebar');
            const backdrop = document.getElementById('docs-sidebar-backdrop');
            if (!sidebar || !backdrop) return;

            const isOpen = typeof forceState === 'boolean' ? forceState : !sidebar.classList.contains('open');
            if (isOpen) {
                sidebar.classList.add('open');
                backdrop.classList.add('active');
                document.body.style.overflow = 'hidden';
            } else {
                sidebar.classList.remove('open');
                backdrop.classList.remove('active');
                document.body.style.overflow = '';
            }
        }

        function applySort() {
            const sortVal = document.getElementById('docs-sort').value;
            let allFolders = [...currentFoldersData];
            let allFiles = [...currentFilesData];

            // 1. Update filter chip counters
            let countPdf = 0;
            let countSheets = 0;
            let countDocs = 0;
            allFiles.forEach(f => {
                const grp = getFileCategoryGroup(f);
                if (grp === 'pdf') countPdf++;
                else if (grp === 'sheets') countSheets++;
                else if (grp === 'docs') countDocs++;
            });

            const countAllEl = document.getElementById('count-chip-all');
            const countPdfEl = document.getElementById('count-chip-pdf');
            const countSheetsEl = document.getElementById('count-chip-sheets');
            const countDocsEl = document.getElementById('count-chip-docs');
            const countFoldersEl = document.getElementById('count-chip-folders');
            const folderBadgeEl = document.getElementById('folder-items-count-badge');

            if (countAllEl) countAllEl.textContent = allFolders.length + allFiles.length;
            if (countPdfEl) countPdfEl.textContent = countPdf;
            if (countSheetsEl) countSheetsEl.textContent = countSheets;
            if (countDocsEl) countDocsEl.textContent = countDocs;
            if (countFoldersEl) countFoldersEl.textContent = allFolders.length;
            if (folderBadgeEl) folderBadgeEl.textContent = `${allFolders.length + allFiles.length} элементов`;

            // 2. Filter by selected chip
            let folders = allFolders;
            let files = allFiles;
            if (currentDocTypeFilter === 'pdf') {
                folders = [];
                files = allFiles.filter(f => getFileCategoryGroup(f) === 'pdf');
            } else if (currentDocTypeFilter === 'sheets') {
                folders = [];
                files = allFiles.filter(f => getFileCategoryGroup(f) === 'sheets');
            } else if (currentDocTypeFilter === 'docs') {
                folders = [];
                files = allFiles.filter(f => getFileCategoryGroup(f) === 'docs');
            } else if (currentDocTypeFilter === 'folders') {
                files = [];
            }

            const sortBy = (arr, isFolder) => {
                arr.sort((a, b) => {
                    if (sortVal === 'name_asc') {
                        return a.name.localeCompare(b.name);
                    } else if (sortVal === 'name_desc') {
                        return b.name.localeCompare(a.name);
                    } else if (sortVal === 'date_desc') {
                        const dateA = isFolder ? a.created_at : (a.uploaded_at ? new Date(a.uploaded_at).getTime() : 0);
                        const dateB = isFolder ? b.created_at : (b.uploaded_at ? new Date(b.uploaded_at).getTime() : 0);
                        return dateB - dateA;
                    } else if (sortVal === 'date_asc') {
                        const dateA = isFolder ? a.created_at : (a.uploaded_at ? new Date(a.uploaded_at).getTime() : 0);
                        const dateB = isFolder ? b.created_at : (b.uploaded_at ? new Date(b.uploaded_at).getTime() : 0);
                        return dateA - dateB;
                    }
                    return 0;
                });
            };

            sortBy(files, false);
            sortBy(folders, true);

            const strictOrder = {
                // Orange
                "Должностные инструкции по всем сотрудникам": 0,
                "ОТ и ТБ": 1,
                "Договора с подрядчиками": 2,
                // Purple
                "Отдел кадров": 3,
                "Коммерческий департамент": 4,
                "Технический директор": 5,
                "Финансовый директор": 6,
                "Начальник производства": 7,
                // Green
                "Главный технолог": 8,
                "Служба контроля качества": 9,
                "Бережливое производство": 10,
                "ОГМ": 11
            };

            folders.sort((a, b) => {
                const orderA = strictOrder.hasOwnProperty(a.name) ? strictOrder[a.name] : 999;
                const orderB = strictOrder.hasOwnProperty(b.name) ? strictOrder[b.name] : 999;
                if (orderA !== orderB) {
                    return orderA - orderB;
                }
                return 0;
            });

            renderItems(folders, files);
        }

        function escapeHtml(text) {
            if (!text) return '';
            return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        }

        function getFileIcon(mimeType = '', fileName = '', externalUrl = '') {
            const m = (mimeType || '').toLowerCase();
            const name = (fileName || '').toLowerCase();
            const url = (externalUrl || '').toLowerCase();

            // 1. Папки Google Диск / Облачные папки
            if (
                m.includes('vnd.google-apps.folder') ||
                url.includes('drive.google.com/drive/folders') ||
                (url.includes('drive.google.com/drive/u/') && url.includes('folders')) ||
                url.includes('/folders/') ||
                (url.includes('drive.google.com') && !url.includes('/file/') && !url.includes('file/d/') && !url.includes('document') && !url.includes('spreadsheets') && !url.includes('presentation')) ||
                name.includes('– google диск') ||
                name.includes('— google диск') ||
                name.includes('- google диск')
            ) {
                return { icon: 'fas fa-folder', color: '#f59e0b', type: 'Папка' };
            }

            // 2. PDF файлы (Строгий приоритет по расширению .pdf и MIME)
            if (m.includes('pdf') || name.endsWith('.pdf') || url.endsWith('.pdf') || url.includes('.pdf')) {
                return { icon: 'fas fa-file-pdf', color: '#ef4444', type: 'PDF Документ' };
            }

            // 3. Таблицы (Excel, Google Sheets, CSV, TSV, ODS)
            if (
                m.includes('spreadsheet') ||
                m.includes('excel') ||
                m.includes('calc') ||
                m.includes('csv') ||
                url.includes('docs.google.com/spreadsheets') ||
                url.includes('spreadsheets') ||
                url.includes('excel') ||
                name.endsWith('.xlsx') ||
                name.endsWith('.xls') ||
                name.endsWith('.csv') ||
                name.endsWith('.xlsm') ||
                name.endsWith('.ods') ||
                (!name.includes('.') && (name.includes('таблиц') || name.includes('реестр') || name.includes('ведомост')))
            ) {
                return { icon: 'fas fa-file-excel', color: '#10b981', type: 'Таблица' };
            }

            // 4. Презентации (PowerPoint, Google Slides)
            if (
                m.includes('presentation') ||
                m.includes('powerpoint') ||
                url.includes('docs.google.com/presentation') ||
                name.endsWith('.pptx') ||
                name.endsWith('.ppt') ||
                name.endsWith('.odp') ||
                (!name.includes('.') && name.includes('презентац'))
            ) {
                return { icon: 'fas fa-file-powerpoint', color: '#f97316', type: 'Презентация' };
            }

            // 5. Google Формы
            if (m.includes('form') || url.includes('docs.google.com/forms')) {
                return { icon: 'fas fa-list-check', color: '#7c3aed', type: 'Google Форма' };
            }

            // 6. Документы / Тексты (Word, Google Docs, TXT, ODT)
            if (
                m.includes('word') ||
                m.includes('document') ||
                url.includes('docs.google.com/document') ||
                name.endsWith('.docx') ||
                name.endsWith('.doc') ||
                name.endsWith('.rtf') ||
                name.endsWith('.odt') ||
                name.endsWith('.txt') ||
                name.includes('документ') ||
                name.includes('приказ') ||
                name.includes('инструкци') ||
                name.includes('регламент') ||
                name.includes('положение') ||
                name.includes('акт')
            ) {
                return { icon: 'fas fa-file-word', color: '#2563eb', type: 'Документ' };
            }

            // 7. Изображения / Фото / Чертежи
            if (
                m.includes('image') ||
                name.endsWith('.png') ||
                name.endsWith('.jpg') ||
                name.endsWith('.jpeg') ||
                name.endsWith('.svg') ||
                name.endsWith('.webp') ||
                name.endsWith('.bmp') ||
                name.endsWith('.dwg')
            ) {
                return { icon: 'fas fa-file-image', color: '#8b5cf6', type: 'Изображение' };
            }

            // 8. Архивы
            if (m.includes('zip') || m.includes('rar') || m.includes('tar') || m.includes('7z') || name.endsWith('.zip') || name.endsWith('.rar') || name.endsWith('.7z')) {
                return { icon: 'fas fa-file-zipper', color: '#eab308', type: 'Архив' };
            }

            // 9. Видео / Аудио
            if (m.includes('video') || name.endsWith('.mp4') || name.endsWith('.avi') || name.endsWith('.mkv') || name.endsWith('.mov')) {
                return { icon: 'fas fa-file-video', color: '#ec4899', type: 'Видео' };
            }

            // 10. Облачные сервисы (если сущность не определилась по специфике)
            if (m === 'application/vnd.ms-onedrive' || url.includes('1drv.ms') || url.includes('onedrive') || url.includes('sharepoint')) {
                return { icon: 'fab fa-microsoft', color: '#0078d4', type: 'OneDrive' };
            }
            if (m === 'application/vnd.yandex-disk' || url.includes('disk.yandex') || url.includes('yadi.sk') || name.toLowerCase().includes('яндекс')) {
                return { icon: 'fab fa-yandex', color: '#fc3f1d', type: 'Яндекс.Диск' };
            }
            if (m.includes('google') || url.includes('drive.google') || url.includes('docs.google')) {
                return { icon: 'fab fa-google', color: '#4285f4', type: 'Google Документ' };
            }

            if (m === 'application/x-external-link' || url.startsWith('http')) {
                return { icon: 'fas fa-arrow-up-right-from-square', color: '#38bdf8', type: 'Внешняя ссылка' };
            }

            return { icon: 'fas fa-file-lines', color: '#94a3b8', type: 'Документ' };
        }

        function getFileTypeName(fileName, mimeType, externalUrl = '') {
            const iconInfo = getFileIcon(mimeType, fileName, externalUrl);
            if (iconInfo && iconInfo.type) {
                return iconInfo.type;
            }
            const ext = fileName ? fileName.split('.').pop().toUpperCase() : '';
            if (ext && ext !== fileName.toUpperCase() && ext.length <= 5) return `${ext} документ`;
            return 'Документ';
        }

        function getFolderColor(name) {
            // Единый благородный теплый желтый цвет для всех папок в системе (устранение светофора)
            return '#f59e0b';
        }

        function getWebViewLink(file) {
            if (!file) return '#';
            if (file.external_url) {
                return file.external_url;
            }
            let rawId = null;
            if (file.id) {
                if (typeof file.id === 'string' && file.id.startsWith('file_')) {
                    rawId = parseInt(file.id.replace('file_', ''));
                } else if (!isNaN(parseInt(file.id))) {
                    rawId = parseInt(file.id);
                }
            }
            if (rawId !== null && !isNaN(rawId)) {
                return `/api/documents/download/${rawId}`;
            }
            return file.webViewLink || '#';
        }

        function isViewableOnline(fileName) {
            const name = (fileName || '').toLowerCase();
            return name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.docx') || name.endsWith('.doc') || name.endsWith('.pptx') || name.endsWith('.ppt') || name.endsWith('.pdf');
        }

        function getFolderPasswordHeader() {
            let pwd = sessionStorage.getItem('folder_password');
            if (!pwd && currentDocsUser && currentDocsUser.pin) {
                pwd = currentDocsUser.pin;
            }
            return pwd ? { 'X-Folder-Password': pwd } : {};
        }

        let currentFolderProtected = false;
        let passwordModalResolve = null;
        let passwordModalFolderId = null;

        function togglePasswordVisibility(inputId, btn) {
            const input = document.getElementById(inputId);
            if (!input) return;
            const icon = btn.querySelector('i');
            if (input.type === 'password') {
                input.type = 'text';
                if (icon) {
                    icon.classList.remove('fa-eye');
                    icon.classList.add('fa-eye-slash');
                }
            } else {
                input.type = 'password';
                if (icon) {
                    icon.classList.remove('fa-eye-slash');
                    icon.classList.add('fa-eye');
                }
            }
        }

        async function verifyPasswordOnServer(folderId, password) {
            try {
                const res = await fetch('/api/documents/verify-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        folder_id: folderId ? String(folderId) : (currentFolderId ? String(currentFolderId) : null),
                        password: password
                    })
                });
                const data = await res.json();
                return { ok: res.ok && data.status === 'success', data: data };
            } catch (e) {
                return { ok: false, data: { message: 'Ошибка связи с сервером при проверке пароля' } };
            }
        }

        async function submitPasswordModal(isConfirmed) {
            const modal = document.getElementById('password-modal');
            const input = document.getElementById('folder-password-input');
            const submitBtn = modal ? modal.querySelector('.btn-action') : null;

            if (!isConfirmed) {
                if (modal) modal.style.display = 'none';
                if (input) input.value = '';
                if (passwordModalResolve) {
                    passwordModalResolve(false);
                    passwordModalResolve = null;
                }
                passwordModalFolderId = null;
                return;
            }

            const pwd = input ? input.value.trim() : '';
            if (!pwd) {
                alert('Пожалуйста, введите пароль или PIN-код!');
                if (input) input.focus();
                return;
            }

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Проверка...';
            }

            try {
                const checkRes = await verifyPasswordOnServer(passwordModalFolderId, pwd);
                if (checkRes.ok) {
                    sessionStorage.setItem('folder_password', pwd);
                    if (checkRes.data?.is_admin && (!currentDocsUser || !currentDocsUser.pin)) {
                        currentDocsUser = { name: checkRes.data.employee_name || 'Левда М.', pin: pwd, is_admin: true };
                        localStorage.setItem('tectum_portal_user', JSON.stringify(currentDocsUser));
                        localStorage.setItem('tectum_current_user_name', currentDocsUser.name);
                        updateDocsUserBadge();
                    } else if (checkRes.data?.employee_name && (!currentDocsUser || !currentDocsUser.pin)) {
                        currentDocsUser = { name: checkRes.data.employee_name, pin: pwd };
                        localStorage.setItem('tectum_portal_user', JSON.stringify(currentDocsUser));
                        localStorage.setItem('tectum_current_user_name', checkRes.data.employee_name);
                        updateDocsUserBadge();
                    }
                    if (modal) modal.style.display = 'none';
                    if (input) input.value = '';
                    if (passwordModalResolve) {
                        passwordModalResolve(true);
                        passwordModalResolve = null;
                    }
                    passwordModalFolderId = null;
                } else {
                    alert(checkRes.data?.message || 'Неверный пароль или PIN-код доступа!');
                    if (input) {
                        input.value = '';
                        input.focus();
                    }
                }
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fas fa-key"></i> Подтвердить';
                }
            }
        }

        async function ensurePassword(isProtected, targetFolderId = null) {
            if (!isProtected) return true;
            // Администратор имеет прямой доступ
            if (currentDocsUser && (currentDocsUser.is_admin || currentDocsUser.name === 'Левда М.')) return true;

            const checkFolderId = targetFolderId || currentFolderId;
            let pwd = sessionStorage.getItem('folder_password') || (currentDocsUser ? currentDocsUser.pin : null);
            if (pwd) {
                const checkRes = await verifyPasswordOnServer(checkFolderId, pwd);
                if (checkRes.ok) {
                    sessionStorage.setItem('folder_password', pwd);
                    return true;
                } else {
                    sessionStorage.removeItem('folder_password');
                }
            }

            return new Promise((resolve) => {
                passwordModalResolve = resolve;
                passwordModalFolderId = checkFolderId;
                const modal = document.getElementById('password-modal');
                const input = document.getElementById('folder-password-input');
                if (input) {
                    input.type = 'password';
                    input.value = '';
                }
                if (modal) {
                    modal.style.display = 'flex';
                    setTimeout(() => {
                        if (input) input.focus();
                    }, 50);
                } else {
                    resolve(false);
                }
            });
        }

        async function ensureAuthForAction() {
            let curUser = (currentDocsUser && currentDocsUser.name) ? currentDocsUser.name : '';
            let curPin = (currentDocsUser && currentDocsUser.pin) ? currentDocsUser.pin : '';
            if (curUser && curPin && curUser !== 'Сотрудник') {
                return { user: curUser, pin: curPin };
            }
            return new Promise((resolve) => {
                openDocsPinModal(null, (user) => {
                    if (user && user.name && user.pin) {
                        resolve({ user: user.name, pin: user.pin });
                    } else {
                        resolve(null);
                    }
                });
            });
        }

        async function openFileLink(viewUrl, isProtected, event) {
            if (event) event.preventDefault();
            if (!await ensurePassword(isProtected, currentFolderId)) return;
            let finalUrl = viewUrl;
            if (isProtected || currentFolderProtected) {
                const pwd = sessionStorage.getItem('folder_password') || (currentDocsUser ? currentDocsUser.pin : '');
                if (pwd) {
                    finalUrl += (finalUrl.includes('?') ? '&' : '?') + 'pwd=' + encodeURIComponent(pwd);
                }
            }
            window.open(finalUrl, '_blank');
        }

        function navigateToRootFolder() {
            clearTimeout(searchTimeout);
            parentFolderIdHistory = [];
            folderNameHistory = [];
            const searchInput = document.getElementById('search-input');
            if (searchInput) searchInput.value = '';
            const clearBtn = document.getElementById('search-clear-btn');
            if (clearBtn) clearBtn.style.display = 'none';
            const kbdShortcut = document.querySelector('.stitch-kbd-shortcut');
            if (kbdShortcut) kbdShortcut.style.display = 'inline-block';
            isSearchActive = false;

            document.querySelectorAll('.folder-item-tree').forEach(el => el.classList.remove('active'));
            const bcText = document.getElementById('breadcrumb-current-text');
            if (bcText) bcText.textContent = 'Все документы';
            if (window.innerWidth <= 900) {
                toggleDocsSidebar(false);
            }
            syncActiveFolderInTree(null);
            loadDocuments(null, 'Все документы', false);
        }

        const docsCache = new Map();

        async function loadDocuments(folderId = null, folderName = 'Все документы', addToHistory = true, searchQuery = null, isProtected = false) {
            clearSelection();
            const thisToken = ++currentLoadToken;

            // Optimistic update of title, breadcrumbs and count badge immediately before network fetch
            const folderTitleEl = document.getElementById('current-folder-name');
            if (folderTitleEl) folderTitleEl.innerText = folderName;
            const bcText = document.getElementById('breadcrumb-current-text');
            if (bcText) bcText.textContent = folderName;

            const btnBack = document.getElementById('btn-folder-back') || document.getElementById('btn-back');
            if (btnBack) {
                if (folderId !== null && !searchQuery) {
                    btnBack.style.display = 'inline-flex';
                    if (!btnBack.innerHTML.includes('<svg')) {
                        btnBack.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; display:inline-block; vertical-align:middle;"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg><span style="color: #334155 !important; font-weight: 600 !important; font-size: 0.8rem !important; display: inline-block !important; line-height: 1 !important; margin-left: 5px;">Назад</span>';
                    }
                } else {
                    btnBack.style.display = 'none';
                }
            }
            
            if (isProtected) {
                if (!await ensurePassword(true, folderId)) {
                    return;
                }
            }
            currentFolderProtected = isProtected;
            const container = document.getElementById('files-container');
            const cacheKey = searchQuery ? `search_${searchQuery}` : (folderId || 'root');

            // Сохраняем текущую папку в URL hash для сохранения позиции при F5
            if (!searchQuery) {
                currentFolderId = folderId;
                lastNavigatedFolderId = folderId;
                lastNavigatedFolderName = folderName;
                lastNavigatedFolderProtected = isProtected;
                syncActiveFolderInTree(folderId);

                if (folderId) {
                    window.location.hash = folderId;
                    sessionStorage.setItem('last_docs_folder_id', folderId);
                    sessionStorage.setItem('last_docs_folder_name', folderName);
                    sessionStorage.setItem('last_docs_folder_protected', isProtected ? '1' : '0');
                } else {
                    history.replaceState(null, null, ' ');
                    sessionStorage.removeItem('last_docs_folder_id');
                    sessionStorage.removeItem('last_docs_folder_name');
                    sessionStorage.removeItem('last_docs_folder_protected');
                }
            }

            // Stale-While-Revalidate: If cached data exists and is under 60s old, show immediately
            if (docsCache.has(cacheKey) && !searchQuery) {
                const cached = docsCache.get(cacheKey);
                if (Date.now() - cached.timestamp < 60000) {
                    if (addToHistory && currentFolderId !== folderId) {
                        if (currentFolderId) {
                            parentFolderIdHistory.push(currentFolderId);
                            folderNameHistory.push(document.getElementById('current-folder-name').innerText);
                        }
                    }
                    currentFolderId = folderId;
                    document.getElementById('current-folder-name').innerText = folderName;
                    const bcText = document.getElementById('breadcrumb-current-text');
                    if (bcText) bcText.textContent = folderName;
                    if (btnBack) {
                        if (currentFolderId !== null && !searchQuery) {
                            btnBack.style.display = 'inline-flex';
                        } else {
                            btnBack.style.display = 'none';
                        }
                    }
                    currentFoldersData = cached.folders;
                    currentFilesData = cached.files;
                    applySort();
                }
            } else {
                container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Загрузка документов...</div>';
            }

            try {
                let url = '/api/documents/list';
                const params = new URLSearchParams();
                if (searchQuery) {
                    params.append('q', searchQuery);
                } else if (folderId) {
                    params.append('parent_id', folderId);
                }
                if (params.toString()) {
                    url += '?' + params.toString();
                }

                const res = await fetch(url);
                const data = await res.json();

                if (thisToken !== currentLoadToken) {
                    return; // Stale async response discarded
                }

                if (data.status === 'success' && data.data) {
                    if (addToHistory && currentFolderId !== folderId && !searchQuery) {
                        if (currentFolderId) {
                            parentFolderIdHistory.push(currentFolderId);
                            folderNameHistory.push(document.getElementById('current-folder-name').innerText);
                        }
                    }

                    const foldersList = Array.isArray(data.data.folders) ? data.data.folders : [];
                    const filesList = Array.isArray(data.data.files) ? data.data.files : [];

                    if (!searchQuery) {
                        currentFolderId = folderId;
                        docsCache.set(cacheKey, {
                            folders: foldersList,
                            files: filesList,
                            timestamp: Date.now()
                        });
                        syncActiveFolderInTree(folderId);
                    }
                    document.getElementById('current-folder-name').innerText = folderName;
                    const bcText = document.getElementById('breadcrumb-current-text');
                    if (bcText) bcText.textContent = folderName;

                    if (btnBack) {
                        if (folderId !== null && !searchQuery) {
                            btnBack.style.display = 'inline-flex';
                        } else {
                            btnBack.style.display = 'none';
                        }
                    }

                    currentFoldersData = foldersList;
                    currentFilesData = filesList;
                    applySort();

                } else {
                    container.innerHTML = `<div style="color: #ef4444; padding: 2rem; text-align: center;">Ошибка: ${data.message || data.detail || 'Не удалось получить данные'}</div>`;
                }
            } catch (error) {
                if (thisToken !== currentLoadToken) return;
                console.error("Error loading documents:", error);
                container.innerHTML = `<div style="color: #ef4444; padding: 2rem; text-align: center;">Ошибка загрузки данных: ${error.message || error}</div>`;
            }
        }

        function handleSearch(query) {
            clearTimeout(searchTimeout);
            const clearBtn = document.getElementById('search-clear-btn');
            const kbdShortcut = document.querySelector('.stitch-kbd-shortcut');
            const trimmed = (query || '').trim();

            if (clearBtn) {
                clearBtn.style.display = (query && query.length > 0) ? 'inline-flex' : 'none';
            }
            if (kbdShortcut) {
                kbdShortcut.style.display = (query && query.length > 0) ? 'none' : 'inline-block';
            }

            if (trimmed === '') {
                if (isSearchActive) {
                    isSearchActive = false;
                    loadDocuments(lastNavigatedFolderId, lastNavigatedFolderName, false, null, lastNavigatedFolderProtected);
                }
                return;
            }

            isSearchActive = true;
            searchTimeout = setTimeout(() => {
                loadDocuments(null, `Результаты: "${trimmed}"`, false, trimmed);
            }, 150);
        }

        function clearSearch() {
            clearTimeout(searchTimeout);
            const input = document.getElementById('search-input');
            if (input) {
                input.value = '';
                if (window.innerWidth > 768) {
                    input.focus();
                } else {
                    input.blur();
                }
            }
            handleSearch('');
        }

        async function loadSidebarTree() {
            try {
                const res = await fetch('/api/documents/tree');
                const data = await res.json();
                if (data.status === 'success') {
                    const folders = data.data.folders || (Array.isArray(data.data) ? data.data : []);
                    const files = data.data.files || [];
                    const sidebar = document.getElementById('sidebar-folders');
                    sidebar.innerHTML = '';

                    const folderMap = {};
                    const rootFolders = [];
                    const rootFiles = [];

                    // Update count of directories in title
                    const dirsCountEl = document.getElementById('sidebar-dirs-count');
                    if (dirsCountEl) {
                        dirsCountEl.textContent = `${folders.length} директорий`;
                    }

                    folders.forEach(f => {
                        f.children = [];
                        f.files = [];
                        folderMap[f.id] = f;
                    });
                    sidebarFolderMap = folderMap;

                    files.forEach(f => {
                        if (f.parent_id && folderMap[f.parent_id]) {
                            folderMap[f.parent_id].files.push(f);
                        } else {
                            rootFiles.push(f);
                        }
                    });

                    folders.forEach(f => {
                        if (f.parent_id && folderMap[f.parent_id]) {
                            folderMap[f.parent_id].children.push(f);
                        } else {
                            rootFolders.push(f);
                        }
                    });

                    // 1. Root Element: «Все документы цеха» with count badge
                    const totalAllItems = folders.length + files.length;
                    sidebar.appendChild(renderTreeRootItem(totalAllItems));

                    // 2. Root Folders
                    rootFolders.forEach(root => {
                        sidebar.appendChild(renderTreeNode(root));
                    });

                    // 3. Root Files
                    rootFiles.forEach(rf => {
                        sidebar.appendChild(renderTreeFileNode(rf));
                    });

                    // Synchronize active folder in tree
                    syncActiveFolderInTree(currentFolderId || lastNavigatedFolderId);
                }
            } catch (error) {
                console.error("Tree load error:", error);
            }
        }

        function renderTreeRootItem(totalCount) {
            const wrapper = document.createElement('div');
            wrapper.className = 'folder-item-wrapper folder-root-wrapper';

            const spacer = document.createElement('div');
            spacer.className = 'folder-tree-toggle';
            spacer.style.visibility = 'hidden';

            const item = document.createElement('div');
            item.className = 'folder-item-tree root-folder-item';
            item.id = 'tree-root-folder-item';
            if (!currentFolderId) {
                item.classList.add('active');
            }

            item.innerHTML = `<i class="fa-solid fa-folder-open" style="color: #f59e0b; font-size: 1.05rem; flex-shrink: 0;"></i> <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; font-weight: 600;">Все документы цеха</span>`;

            item.onclick = () => {
                navigateToRootFolder();
            };

            wrapper.appendChild(spacer);
            wrapper.appendChild(item);
            return wrapper;
        }

        function syncActiveFolderInTree(folderId) {
            document.querySelectorAll('#sidebar-folders .folder-item-tree').forEach(el => {
                el.classList.remove('active');
            });

            if (!folderId || folderId === 'root') {
                const rootItem = document.getElementById('tree-root-folder-item');
                if (rootItem) rootItem.classList.add('active');
                return;
            }

            const strId = String(folderId);
            let targetItem = null;
            try {
                targetItem = document.querySelector(`#sidebar-folders .folder-item-tree[data-folder-id="${CSS.escape(strId)}"]`);
            } catch (e) {
                targetItem = document.querySelector(`#sidebar-folders .folder-item-tree[data-folder-id="${strId}"]`);
            }
            if (targetItem) {
                targetItem.classList.add('active');
                try {
                    targetItem.scrollIntoView({ block: 'nearest' });
                } catch (e) {}
            }

            let currId = folderId;
            const visited = new Set();
            while (currId && sidebarFolderMap && sidebarFolderMap[currId] && !visited.has(String(currId))) {
                visited.add(String(currId));
                const parentId = sidebarFolderMap[currId].parent_id;
                if (parentId) {
                    expandedFolders.add(parentId);
                    const parentStrId = String(parentId);
                    let parentWrapper = null;
                    try {
                        parentWrapper = document.querySelector(`#sidebar-folders .folder-tree-wrapper[data-folder-id="${CSS.escape(parentStrId)}"]`);
                    } catch (e) {
                        parentWrapper = document.querySelector(`#sidebar-folders .folder-tree-wrapper[data-folder-id="${parentStrId}"]`);
                    }
                    if (parentWrapper) {
                        const childrenContainer = parentWrapper.querySelector(':scope > .folder-tree-node');
                        const toggle = parentWrapper.querySelector(':scope > .folder-item-wrapper > .folder-tree-toggle');
                        if (childrenContainer) childrenContainer.classList.add('expanded');
                        if (toggle) toggle.classList.add('expanded');
                    }
                    currId = parentId;
                } else {
                    break;
                }
            }
        }

        function renderTreeFileNode(file) {
            const wrapper = document.createElement('div');
            wrapper.className = 'folder-item-wrapper';

            const spacer = document.createElement('div');
            spacer.className = 'folder-tree-toggle';
            spacer.style.visibility = 'hidden';

            const item = document.createElement('div');
            item.className = 'folder-item-tree';

            const iconInfo = getFileIcon(file.mimeType, file.name, file.external_url || file.webViewLink);
            const viewUrl = getWebViewLink(file);
            const lockIcon = file.is_protected ? ' <i class="fas fa-lock" style="color:#ef4444; font-size: 0.75rem; margin-left: 4px;" title="Защищено"></i>' : '';

            item.innerHTML = `<i class="${iconInfo.icon}" style="color: ${iconInfo.color}; font-size: 1rem; flex-shrink: 0;"></i> <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(file.name)}</span>${lockIcon}`;

            item.onclick = (e) => {
                if (window.innerWidth <= 900) {
                    toggleDocsSidebar(false);
                }
                openFileLink(viewUrl, file.is_protected, e);
            };

            wrapper.appendChild(spacer);
            wrapper.appendChild(item);
            return wrapper;
        }

        function renderTreeNode(folder) {
            const wrapper = document.createElement('div');
            wrapper.className = 'folder-tree-wrapper';
            wrapper.dataset.folderId = folder.id;

            const header = document.createElement('div');
            header.className = 'folder-item-wrapper';

            const hasChildren = (folder.children && folder.children.length > 0) || (folder.files && folder.files.length > 0);
            const totalItemsCount = (folder.children ? folder.children.length : 0) + (folder.files ? folder.files.length : 0);

            const toggle = document.createElement('div');
            toggle.className = 'folder-tree-toggle';
            if (hasChildren) {
                toggle.innerHTML = '<i class="fa-solid fa-chevron-right" style="font-size: 0.65rem;"></i>';
                toggle.title = 'Развернуть / свернуть';
            } else {
                toggle.innerHTML = '';
                toggle.style.visibility = 'hidden';
            }

            const item = document.createElement('div');
            item.className = 'folder-item-tree';
            item.dataset.folderId = folder.id;

            const iconColor = getFolderColor(folder.name);
            const lockIcon = folder.is_protected ? ' <i class="fas fa-lock" style="color:#ef4444; font-size: 0.8rem; margin-left: 5px;" title="Защищено"></i>' : '';
            item.innerHTML = `<i class="fas fa-folder" style="color: ${iconColor}; font-size: 1.05rem; flex-shrink: 0;"></i> <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${escapeHtml(folder.name)}</span>${lockIcon}`;
            if (currentFolderId && String(currentFolderId) === String(folder.id)) {
                item.classList.add('active');
            }

            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'folder-tree-node';

            if (expandedFolders.has(folder.id)) {
                childrenContainer.classList.add('expanded');
                toggle.classList.add('expanded');
            }

            toggle.onclick = (e) => {
                e.stopPropagation();
                if (hasChildren) {
                    if (expandedFolders.has(folder.id)) {
                        expandedFolders.delete(folder.id);
                        childrenContainer.classList.remove('expanded');
                        toggle.classList.remove('expanded');
                    } else {
                        expandedFolders.add(folder.id);
                        childrenContainer.classList.add('expanded');
                        toggle.classList.add('expanded');
                    }
                }
            };

            item.onclick = () => {
                clearTimeout(searchTimeout);
                expandedFolders.add(folder.id);
                parentFolderIdHistory = [];
                folderNameHistory = [];
                const searchEl = document.getElementById('search-input');
                if (searchEl) searchEl.value = '';
                const clearBtn = document.getElementById('search-clear-btn');
                if (clearBtn) clearBtn.style.display = 'none';
                const kbdShortcut = document.querySelector('.stitch-kbd-shortcut');
                if (kbdShortcut) kbdShortcut.style.display = 'inline-block';
                isSearchActive = false;

                document.querySelectorAll('#sidebar-folders .folder-item-tree').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                if (hasChildren) {
                    childrenContainer.classList.add('expanded');
                    toggle.classList.add('expanded');
                }

                // Update Breadcrumbs
                const bcEl = document.getElementById('breadcrumb-current-text');
                if (bcEl) bcEl.textContent = folder.name;

                // On mobile, auto close sidebar when folder is selected
                if (window.innerWidth <= 900) {
                    toggleDocsSidebar(false);
                }

                loadDocuments(folder.id, folder.name, false, null, folder.is_protected);
            };

            header.appendChild(toggle);
            header.appendChild(item);
            wrapper.appendChild(header);

            if (folder.children && folder.children.length > 0) {
                folder.children.forEach(child => {
                    childrenContainer.appendChild(renderTreeNode(child));
                });
            }
            if (folder.files && folder.files.length > 0) {
                folder.files.forEach(f => {
                    childrenContainer.appendChild(renderTreeFileNode(f));
                });
            }
            if (hasChildren) {
                wrapper.appendChild(childrenContainer);
            }

            return wrapper;
        }

        let currentTargetItem = null;
        let createDocType = 'document';

        function showToast(text, type = 'success', subtitle = '') {
            if (window.toast && typeof window.toast.show === 'function') {
                let actualType = type;
                const lower = (text || '').toLowerCase();
                if (lower.includes('ошибка') || lower.includes('неверн') || lower.includes('сбой')) {
                    actualType = 'error';
                } else if (lower.includes('укажите') || lower.includes('выберите')) {
                    actualType = 'warning';
                }
                return window.toast.show({
                    type: actualType,
                    title: text,
                    message: subtitle
                });
            }
            const toast = document.getElementById('toast');
            const toastText = document.getElementById('toast-text');
            if (toast && toastText) {
                toastText.innerText = text;
                toast.style.display = 'flex';
                setTimeout(() => {
                    toast.style.display = 'none';
                }, 2500);
            }
        }

        function toggleCreateDropdown(event) {
            event.stopPropagation();
            const dropdown = document.getElementById('create-dropdown');
            if (dropdown) {
                dropdown.classList.toggle('show');
            }
        }

        window.addEventListener('click', (e) => {
            const dropdown = document.getElementById('create-dropdown');
            if (dropdown && dropdown.classList.contains('show')) {
                dropdown.classList.remove('show');
            }
            hideContextMenu();
        });

        function hideContextMenu() {
            const cm = document.getElementById('custom-context-menu');
            if (cm) {
                cm.style.display = 'none';
            }
            const cmBackdrop = document.getElementById('context-menu-backdrop');
            if (cmBackdrop) {
                cmBackdrop.classList.remove('active');
            }
            document.querySelectorAll('.stitch-table-row.selected, .docs-table-row.selected').forEach(el => el.classList.remove('selected'));
        }

        function showContextMenuAt(x, y, htmlContent) {
            const cm = document.getElementById('custom-context-menu');
            if (!cm) return;
            cm.innerHTML = htmlContent;
            cm.style.display = 'block';

            if (window.innerWidth <= 768) {
                // Handled via CSS bottom-sheet
                const cmBackdrop = document.getElementById('context-menu-backdrop');
                if (cmBackdrop) {
                    cmBackdrop.classList.add('active');
                }
                return;
            }

            // Desktop viewport boundary checking
            const cmWidth = cm.offsetWidth || 240;
            const cmHeight = cm.offsetHeight || 250;
            const winWidth = window.innerWidth;
            const winHeight = window.innerHeight;

            let finalX = x;
            let finalY = y;

            if (x + cmWidth > winWidth) {
                finalX = winWidth - cmWidth - 12;
            }
            if (y + cmHeight > winHeight) {
                finalY = winHeight - cmHeight - 12;
            }

            cm.style.left = `${Math.max(12, finalX)}px`;
            cm.style.top = `${Math.max(12, finalY)}px`;
        }

        function loadFolderById(folderId) {
            hideContextMenu();
            clearTimeout(searchTimeout);
            const searchEl = document.getElementById('search-input');
            if (searchEl) searchEl.value = '';
            const clearBtn = document.getElementById('search-clear-btn');
            if (clearBtn) clearBtn.style.display = 'none';
            const kbdShortcut = document.querySelector('.stitch-kbd-shortcut');
            if (kbdShortcut) kbdShortcut.style.display = 'inline-block';
            isSearchActive = false;

            const folder = currentFoldersData.find(f => String(f.id) === String(folderId));
            if (folder) {
                loadDocuments(folder.id, folder.name, true, null, folder.is_protected);
            } else if (sidebarFolderMap && sidebarFolderMap[folderId]) {
                const f = sidebarFolderMap[folderId];
                loadDocuments(f.id, f.name, true, null, f.is_protected);
            }
        }

        function handleItemContextMenu(e, item, isFolder) {
            e.preventDefault();
            e.stopPropagation();

            // Strict Read-Only Mode on Mobile (<= 768px): directly open folder or preview without destructive menu
            if (window.innerWidth <= 768) {
                if (isFolder) {
                    loadFolderById(item.id);
                } else {
                    openPreviewModal(item, e);
                }
                return;
            }

            const resolvedItem = { ...item, isFolder };
            if (!resolvedItem.viewUrl && !isFolder) {
                resolvedItem.viewUrl = getWebViewLink(item);
            }
            currentTargetItem = resolvedItem;

            document.querySelectorAll('.stitch-table-row.selected, .docs-table-row.selected').forEach(el => el.classList.remove('selected'));
            const row = e.currentTarget;
            if (row) row.classList.add('selected');

            let html = '';
            const closeBtnHtml = `<button class="context-menu-close-btn" onclick="hideContextMenu()"><i class="fas fa-times"></i></button>`;

            if (isFolder) {
                html = `
                    <div class="context-menu-header">
                        <span><i class="fas fa-folder" style="color: ${getFolderColor(item.name)}; margin-right: 6px;"></i> ${escapeHtml(item.name)}</span>
                        ${closeBtnHtml}
                    </div>
                    <div class="context-menu-item" onclick="loadFolderById('${item.id}')">
                        <i class="fas fa-folder-open" style="color:#f59e0b;"></i> Открыть папку
                    </div>
                    <div class="context-menu-item" onclick="openMoveModal(currentTargetItem.id, currentTargetItem.name, true, currentTargetItem.parent_id || '', currentTargetItem.is_protected)">
                        <i class="fas fa-folder-tree" style="color:#0284c7;"></i> Переместить
                    </div>
                    <div class="context-menu-item" onclick="openRenameModal(currentTargetItem.id, currentTargetItem.name, currentTargetItem.is_protected)">
                        <i class="fas fa-edit" style="color:#f59e0b;"></i> Переименовать
                    </div>
                    <div class="context-menu-separator"></div>
                    <div class="context-menu-item danger" onclick="deleteItem(currentTargetItem.id, event, currentTargetItem.is_protected)">
                        <i class="fas fa-trash"></i> Удалить папку
                    </div>
                `;
            } else {
                const viewUrl = getWebViewLink(item);
                const iconInfo = getFileIcon(item.mimeType, item.name, item.external_url || item.webViewLink);
                html = `
                    <div class="context-menu-header">
                        <span><i class="${iconInfo.icon}" style="color: ${iconInfo.color}; margin-right: 6px;"></i> ${escapeHtml(item.name)}</span>
                        ${closeBtnHtml}
                    </div>
                    <div class="context-menu-item" onclick="openFileLink(currentTargetItem.viewUrl, currentTargetItem.is_protected, event)">
                        <i class="fas fa-arrow-up-right-from-square" style="color:#3b82f6;"></i> Открыть онлайн
                    </div>
                    <div class="context-menu-item" onclick="hideContextMenu(); window.open(currentTargetItem.viewUrl, '_blank');">
                        <i class="fas fa-download" style="color:#10b981;"></i> Скачать файл
                    </div>
                    <div class="context-menu-item" onclick="createTaskFromDocItem(currentTargetItem)">
                        <i class="fa-solid fa-list-check" style="color:#2563eb;"></i> Поставить задачу по документу
                    </div>
                    <div class="context-menu-item" onclick="copyItemLink(currentTargetItem.viewUrl, currentTargetItem.is_protected)">
                        <i class="fas fa-link" style="color:#a855f7;"></i> Копировать ссылку
                    </div>
                    <div class="context-menu-item" onclick="openMoveModal(currentTargetItem.id, currentTargetItem.name, false, currentTargetItem.category_id || '', currentTargetItem.is_protected)">
                        <i class="fas fa-folder-tree" style="color:#0284c7;"></i> Переместить
                    </div>
                    <div class="context-menu-separator"></div>
                    <div class="context-menu-item" onclick="openRenameModal(currentTargetItem.id, currentTargetItem.name, currentTargetItem.is_protected)">
                        <i class="fas fa-edit" style="color:#f59e0b;"></i> Переименовать
                    </div>
                    <div class="context-menu-separator"></div>
                    <div class="context-menu-item danger" onclick="deleteItem(currentTargetItem.id, event, currentTargetItem.is_protected)">
                        <i class="fas fa-trash"></i> Удалить ссылку
                    </div>
                `;
            }

            showContextMenuAt(e.clientX, e.clientY, html);
        }

        function handleAreaContextMenu(e) {
            // Strict Read-Only Mode on Mobile (<= 768px): prevent empty-space creation menu
            if (window.innerWidth <= 768) {
                return;
            }
            if (e.target.closest('.stitch-table-row') || e.target.closest('.docs-table-row') || e.target.closest('.action-buttons') || e.target.closest('.search-box') || e.target.closest('.modal')) {
                return;
            }
            e.preventDefault();

            const closeBtnHtml = `<button class="context-menu-close-btn" onclick="hideContextMenu()"><i class="fas fa-times"></i></button>`;
            const html = `
                <div class="context-menu-header">
                    <span>Создать в папке</span>
                    ${closeBtnHtml}
                </div>
                <div class="context-menu-item" onclick="openAddLinkModal('', 'google')">
                    <i class="fab fa-google" style="color: #4285f4;"></i> Ссылка Google (Docs / Sheets)
                </div>
                <div class="context-menu-item" onclick="openAddLinkModal('', 'microsoft')">
                    <i class="fab fa-microsoft" style="color: #0078d4;"></i> Ссылка Microsoft (OneDrive / Excel)
                </div>
                <div class="context-menu-separator"></div>
                <div class="context-menu-item" onclick="showFolderModal()">
                    <i class="fas fa-folder-plus" style="color: #f59e0b;"></i> Новая папка
                </div>
            `;
            showContextMenuAt(e.clientX, e.clientY, html);
        }

        function openItemMoreMenu(e, item, isFolder) {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            handleItemContextMenu({
                preventDefault: () => { },
                stopPropagation: () => { },
                currentTarget: e.currentTarget.closest('.stitch-table-row') || e.currentTarget.closest('.docs-table-row'),
                clientX: rect.left,
                clientY: rect.bottom + 4
            }, item, isFolder);
        }

        function openFileMenuById(fileId, e) {
            e.stopPropagation();
            const file = currentFilesData.find(f => String(f.id) === String(fileId));
            if (!file) return;
            openItemMoreMenu(e, file, false);
        }

        function openFolderMenuById(folderId, e) {
            e.stopPropagation();
            const folder = currentFoldersData.find(f => String(f.id) === String(folderId));
            if (!folder) return;
            openItemMoreMenu(e, folder, true);
        }

        async function copyItemLink(viewUrl, isProtected) {
            hideContextMenu();
            let finalUrl = viewUrl.startsWith('http') ? viewUrl : `${window.location.origin}${viewUrl}`;
            try {
                await navigator.clipboard.writeText(finalUrl);
                showToast('Ссылка скопирована в буфер обмена');
            } catch (err) {
                prompt('Скопируйте ссылку:', finalUrl);
            }
        }

        function openCreateDocModal(type) {
            hideContextMenu();
            createDocType = type;
            const modalTitle = document.getElementById('create-doc-modal-title');
            const docNameInput = document.getElementById('new-doc-name');
            const btnSubmit = document.getElementById('btn-submit-create-doc');

            if (type === 'document') {
                modalTitle.innerText = 'Создать Google Документ';
                docNameInput.placeholder = 'Например: Сменный акт осмотра оборудования';
                btnSubmit.style.background = '#2563eb';
            } else {
                modalTitle.innerText = 'Создать Google Таблицу';
                docNameInput.placeholder = 'Например: Журнал регистрации простоев';
                btnSubmit.style.background = '#10b981';
            }

            docNameInput.value = '';
            document.getElementById('create-doc-modal').style.display = 'flex';
            setTimeout(() => docNameInput.focus(), 50);
        }

        function closeCreateDocModal() {
            document.getElementById('create-doc-modal').style.display = 'none';
        }

        async function submitCreateGoogleDoc() {
            let requiresPassword = currentFolderProtected;
            if (!currentFolderId) requiresPassword = true;
            if (!await ensurePassword(requiresPassword, currentFolderId)) return;

            const name = document.getElementById('new-doc-name').value.trim();
            if (!name) {
                alert('Пожалуйста, введите название файла');
                return;
            }

            const btnSubmit = document.getElementById('btn-submit-create-doc');
            const originalText = btnSubmit.innerHTML;
            btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Создание...';
            btnSubmit.disabled = true;

            const formData = new FormData();
            formData.append('title', name);
            formData.append('doc_type', createDocType);
            if (currentFolderId) formData.append('parent_id', currentFolderId);

            try {
                const res = await fetch('/api/documents/create_google', {
                    method: 'POST',
                    headers: getFolderPasswordHeader(),
                    body: formData
                });
                const data = await res.json();
                btnSubmit.innerHTML = originalText;
                btnSubmit.disabled = false;

                if (data.status === 'success') {
                    docsCache.clear();
                    closeCreateDocModal();
                    loadDocuments(currentFolderId, document.getElementById('current-folder-name').innerText, false);
                    showToast('Google документ успешно создан');

                    if (data.file && data.file.webViewLink) {
                        window.open(data.file.webViewLink, '_blank');
                    }
                } else {
                    alert('Ошибка создания: ' + data.message);
                }
            } catch (err) {
                btnSubmit.innerHTML = originalText;
                btnSubmit.disabled = false;
                alert('Ошибка соединения с сервером');
            }
        }

        let renameTargetId = null;
        let renameTargetProtected = false;

        function openRenameModal(itemId, currentName, isProtected) {
            hideContextMenu();
            renameTargetId = itemId;
            renameTargetProtected = isProtected;
            const renameInput = document.getElementById('rename-input');
            renameInput.value = currentName;
            document.getElementById('rename-modal').style.display = 'flex';
            setTimeout(() => {
                renameInput.focus();
                renameInput.select();
            }, 50);
        }

        function closeRenameModal() {
            document.getElementById('rename-modal').style.display = 'none';
            renameTargetId = null;
        }

        async function submitRename() {
            if (renameTargetProtected || currentFolderProtected) {
                if (!await ensurePassword(true, currentFolderId)) return;
            }
            const auth = await ensureAuthForAction();
            if (!auth) return;

            const newName = document.getElementById('rename-input').value.trim();
            if (!newName) return;

            const curUser = auth.user;
            const curPin = auth.pin;

            const formData = new FormData();
            formData.append('new_name', newName);
            if (curUser) formData.append('user_name', curUser);
            if (curPin) formData.append('user_pin', curPin);

            try {
                const res = await fetch(`/api/documents/${renameTargetId}/rename`, {
                    method: 'PUT',
                    headers: getFolderPasswordHeader(),
                    body: formData
                });
                const data = await res.json();
                if (res.ok && data.status === 'success') {
                    docsCache.clear();
                    closeRenameModal();
                    loadDocuments(currentFolderId, document.getElementById('current-folder-name').innerText, false);
                    loadSidebarTree();
                    showToast('Успешно переименовано');
                } else {
                    alert('Ошибка: ' + (data.detail || data.message || 'Отказано в доступе'));
                }
            } catch (err) {
                alert('Ошибка соединения');
            }
        }

        async function loadQuickAccessBar() {
            // Быстрый доступ удален для минималистичного мобильного и десктопного интерфейса
        }

        
        // ==========================================================================
        // BATCH SELECTION & ACTIONS SYSTEM
        // @canonical-pattern UniversalTableBatchSelection
        // ==========================================================================
        let selectedItems = new Map(); // id -> { id, name, isFolder, viewUrl, isProtected }

        function toggleSelectAll(masterCheckbox) {
            const isChecked = masterCheckbox.checked;
            const checkboxes = document.querySelectorAll('.stitch-table-row .stitch-checkbox-custom');
            
            checkboxes.forEach(cb => {
                cb.checked = isChecked;
                const row = cb.closest('.stitch-table-row');
                if (row) {
                    if (isChecked) {
                        row.classList.add('selected');
                        const itemData = JSON.parse(cb.getAttribute('data-item') || '{}');
                        if (itemData.id) {
                            selectedItems.set(String(itemData.id), itemData);
                        }
                    } else {
                        row.classList.remove('selected');
                    }
                }
            });

            if (!isChecked) {
                selectedItems.clear();
            }

            updateSelectionUI();
        }

        function toggleItemSelection(id, event, itemData) {
            if (event) event.stopPropagation();
            const strId = String(id);
            const row = document.getElementById(`doc-row-${strId}`);
            const cb = document.getElementById(`doc-cb-${strId}`);
            
            const isChecked = cb ? cb.checked : !selectedItems.has(strId);

            if (isChecked) {
                selectedItems.set(strId, itemData);
                if (row) row.classList.add('selected');
                if (cb) cb.checked = true;
            } else {
                selectedItems.delete(strId);
                if (row) row.classList.remove('selected');
                if (cb) cb.checked = false;
            }

            // Sync master checkbox
            const masterCb = document.getElementById('select-all-checkbox');
            const allCbs = document.querySelectorAll('.stitch-table-row .stitch-checkbox-custom');
            if (masterCb) {
                if (selectedItems.size === 0) {
                    masterCb.checked = false;
                    masterCb.indeterminate = false;
                } else if (selectedItems.size === allCbs.length && allCbs.length > 0) {
                    masterCb.checked = true;
                    masterCb.indeterminate = false;
                } else {
                    masterCb.checked = false;
                    masterCb.indeterminate = true;
                }
            }

            updateSelectionUI();
        }

        function clearSelection() {
            selectedItems.clear();
            const masterCb = document.getElementById('select-all-checkbox');
            if (masterCb) {
                masterCb.checked = false;
                masterCb.indeterminate = false;
            }
            document.querySelectorAll('.stitch-table-row .stitch-checkbox-custom').forEach(cb => cb.checked = false);
            document.querySelectorAll('.stitch-table-row').forEach(row => row.classList.remove('selected'));
            updateSelectionUI();
        }

        function updateSelectionUI() {
            const count = selectedItems.size;
            const countLabel = document.getElementById('selected-count-label');
            const actionsPanel = document.getElementById('stitch-batch-actions-panel');

            if (countLabel) {
                countLabel.innerHTML = `Выбрано: <b>${count} ${getRussianFileWord(count)}</b>`;
            }

            if (actionsPanel) {
                if (count > 0) {
                    actionsPanel.style.display = 'inline-flex';
                } else {
                    actionsPanel.style.display = 'none';
                }
            }
        }

        async function bulkDownloadSelected() {
            if (selectedItems.size === 0) return;
            const items = Array.from(selectedItems.values());
            const files = items.filter(i => !i.isFolder);

            if (files.length === 0) {
                if (window.toast) {
                    toast.info("В выделенном нет файлов для скачивания (только папки)");
                } else {
                    alert("В выделенном нет файлов для скачивания");
                }
                return;
            }

            let downloadedCount = 0;
            for (const file of files) {
                if (file.viewUrl && file.viewUrl !== '#') {
                    const a = document.createElement('a');
                    a.href = file.viewUrl;
                    a.target = '_blank';
                    a.download = file.name || '';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    downloadedCount++;
                    await new Promise(r => setTimeout(r, 200)); // небольшая пауза для браузера
                }
            }

            if (window.toast) {
                toast.success(`Скачивание запущено (${downloadedCount} ${getRussianFileWord(downloadedCount)})`);
            }
        }

        async function bulkDeleteSelected() {
            if (selectedItems.size === 0) return;
            const items = Array.from(selectedItems.values());
            const count = items.length;

            const auth = await ensureAuthForAction();
            if (!auth) return;

            if (!confirm(`Вы действительно хотите удалить ${count} выбранных ${getRussianFileWord(count)}? Это действие необратимо.`)) {
                return;
            }

            const curUser = auth.user;
            const curPin = auth.pin;
            let successCount = 0;
            let failCount = 0;

            for (const item of items) {
                let delUrl = `/api/documents/${item.id}`;
                const params = new URLSearchParams();
                if (curUser) params.append('user_name', curUser);
                if (curPin) params.append('user_pin', curPin);
                if (params.toString()) delUrl += '?' + params.toString();

                try {
                    const res = await fetch(delUrl, {
                        method: 'DELETE',
                        headers: getFolderPasswordHeader()
                    });
                    if (res.ok) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } catch (e) {
                    failCount++;
                }
            }

            clearSelection();
            docsCache.clear();
            loadDocuments(currentFolderId, document.getElementById('current-folder-name').innerText, false);
            loadSidebarTree();

            if (window.toast) {
                if (failCount === 0) {
                    toast.success(`Успешно удалено: ${successCount} ${getRussianFileWord(successCount)}`);
                } else {
                    toast.warning(`Удалено: ${successCount}, ошибок: ${failCount}`);
                }
            }
        }


        function renderItems(folders, files) {
            const container = document.getElementById('files-container');
            if (!container) return;

            const totalCount = folders.length + files.length;

            if (folders.length === 0 && files.length === 0) {
                container.innerHTML = `
                    <div class="empty-state" style="padding: 3rem 1rem; text-align: center;">
                        <i class="fas fa-folder-open" style="font-size: 3rem; color: #cbd5e1; margin-bottom: 1rem;"></i>
                        <p style="font-size: 1.1rem; font-weight: 600; color: #334155;">В этой папке пока нет документов</p>
                        <p style="font-size: 0.88rem; color: #64748b; max-width: 480px; margin: 0 auto;">Нажмите кнопку «Добавить», чтобы загрузить PDF документ или прикрепить рабочую таблицу Google Sheets / OneDrive</p>
                    </div>
                `;
                return;
            }

            let html = `
                <div class="stitch-table-wrapper">
                    <div class="stitch-table-header">
                        <div class="stitch-row-checkbox">
                            <input type="checkbox" id="select-all-checkbox" class="stitch-checkbox-custom" onchange="toggleSelectAll(this)" title="Выбрать все">
                        </div>
                        <div>Название файла <i class="fa-solid fa-arrow-down" style="font-size: 0.68rem; margin-left: 4px; color: #94a3b8;"></i></div>
                        <div>Формат / Тип</div>
                        <div>Автор</div>
                        <div>Изменено</div>
                        <div style="text-align: right;">Действия</div>
                    </div>
            `;

            // 1. Folders rendering (Stitch card rows)
            folders.forEach(folder => {
                const iconColor = getFolderColor(folder.name);
                const lockIcon = folder.is_protected ? ' <i class="fas fa-lock" style="color:#ef4444; font-size: 0.75rem; margin-left: 4px;" title="Защищено"></i>' : '';
                const folderAuthor = folder.created_by || 'Администратор';
                const authorInitials = getAuthorInitials(folderAuthor);
                const isSelected = selectedItems.has(String(folder.id));

                const itemDataObj = {
                    id: String(folder.id),
                    name: folder.name,
                    isFolder: true,
                    viewUrl: '',
                    isProtected: !!folder.is_protected
                };
                const itemDataJson = escapeHtml(JSON.stringify(itemDataObj));
                const folderJson = escapeHtml(JSON.stringify(folder));

                html += `
                    <div class="stitch-table-row folder-row ${isSelected ? 'selected' : ''}"
                         id="doc-row-${folder.id}"
                         onclick="loadFolderById('${folder.id}')"
                         oncontextmenu="handleItemContextMenu(event, ${folderJson}, true)">
                        <div class="stitch-row-checkbox" onclick="event.stopPropagation()">
                            <input type="checkbox" 
                                   id="doc-cb-${folder.id}"
                                   class="stitch-checkbox-custom" 
                                   data-item="${itemDataJson}"
                                   ${isSelected ? 'checked' : ''}
                                   onchange="toggleItemSelection('${folder.id}', event, ${itemDataJson})" 
                                   title="Выбрать папку">
                        </div>
                        <div class="stitch-item-cell">
                            <div class="stitch-format-badge badge-folder">
                                <i class="fa-solid fa-folder-open"></i>
                            </div>
                            <div class="stitch-item-details">
                                <div class="stitch-item-title-row">
                                    <span class="stitch-item-title">${escapeHtml(folder.name)}${lockIcon}</span>
                                </div>
                                <div class="stitch-item-subtitle">Директория • ${escapeHtml(folderAuthor)}</div>
                            </div>
                        </div>
                        <div>
                            <span class="stitch-type-pill type-folder"><i class="fa-solid fa-folder"></i> Папка</span>
                        </div>
                        <div class="stitch-author-cell">
                            <div class="stitch-author-avatar" style="background: #f59e0b;">${authorInitials}</div>
                            <div class="stitch-author-info">
                                <div class="stitch-author-name">${escapeHtml(folderAuthor)}</div>
                                <div class="stitch-author-role">Раздел цеха</div>
                            </div>
                        </div>
                        <div class="stitch-date-cell">
                            <span>—</span>
                        </div>
                        <div class="stitch-actions-cell">
                            <button class="stitch-action-btn desktop-only" onclick="event.stopPropagation(); openMoveModal('${folder.id}', '${escapeHtml(folder.name).replace(/'/g, "\'")}', true, '${folder.parent_id || ''}', ${folder.is_protected})" title="Переместить папку">
                                <i class="fas fa-folder-tree"></i>
                            </button>
                            <button class="stitch-action-btn desktop-only" onclick="deleteItem('${folder.id}', event, ${folder.is_protected})" title="Удалить папку">
                                <i class="fas fa-trash" style="color: #ef4444;"></i>
                            </button>
                            <button class="stitch-action-btn mobile-action-trigger mobile-only" onclick="openFolderMenuById('${folder.id}', event)" title="Действия с папкой">
                                <i class="fa-solid fa-ellipsis-vertical"></i>
                            </button>
                        </div>
                    </div>
                `;
            });

            // 2. Files rendering
            files.forEach(file => {
                const iconInfo = getFileIcon(file.mimeType, file.name, file.external_url || file.webViewLink);
                const typeName = getFileTypeName(file.name, file.mimeType, file.external_url || file.webViewLink);
                const fileJson = escapeHtml(JSON.stringify(file));

                let rawDocId = null;
                if (file.id) {
                    if (typeof file.id === 'string' && file.id.startsWith('file_')) {
                        rawDocId = parseInt(file.id.replace('file_', ''));
                    } else if (!isNaN(parseInt(file.id))) {
                        rawDocId = parseInt(file.id);
                    }
                }
                const isLocalFile = !file.external_url && rawDocId !== null;

                let viewUrl = file.external_url;
                if (!viewUrl && rawDocId !== null) {
                    viewUrl = `/api/documents/download/${rawDocId}`;
                } else if (!viewUrl) {
                    viewUrl = file.webViewLink || '#';
                }

                const nameLower = (file.name || '').toLowerCase();
                let formatShort = 'DOC';
                let formatBadgeClass = 'badge-doc';
                let typePillClass = 'type-doc';

                if (nameLower.endsWith('.pdf') || (file.mimeType && file.mimeType.includes('pdf'))) {
                    formatShort = 'PDF';
                    formatBadgeClass = 'badge-pdf';
                    typePillClass = 'type-pdf';
                } else if (nameLower.endsWith('.xlsx') || nameLower.endsWith('.xls') || nameLower.endsWith('.csv') || (file.mimeType && (file.mimeType.includes('spreadsheet') || file.mimeType.includes('excel')))) {
                    formatShort = 'XLS';
                    formatBadgeClass = 'badge-xls';
                    typePillClass = 'type-xls';
                } else if (nameLower.endsWith('.docx') || nameLower.endsWith('.doc')) {
                    formatShort = 'DOC';
                    formatBadgeClass = 'badge-doc';
                    typePillClass = 'type-doc';
                } else if (nameLower.endsWith('.png') || nameLower.endsWith('.jpg') || nameLower.endsWith('.jpeg') || nameLower.endsWith('.webp') || nameLower.endsWith('.svg') || (file.mimeType && file.mimeType.includes('image'))) {
                    formatShort = 'IMG';
                    formatBadgeClass = 'badge-img';
                    typePillClass = 'type-img';
                } else if (nameLower.endsWith('.zip') || nameLower.endsWith('.rar') || nameLower.endsWith('.7z') || (file.mimeType && (file.mimeType.includes('zip') || file.mimeType.includes('compressed')))) {
                    formatShort = 'ZIP';
                    formatBadgeClass = 'badge-zip';
                    typePillClass = 'type-zip';
                } else if (nameLower.endsWith('.pptx') || nameLower.endsWith('.ppt') || (file.mimeType && file.mimeType.includes('presentation'))) {
                    formatShort = 'PPT';
                    formatBadgeClass = 'badge-ppt';
                    typePillClass = 'type-ppt';
                }

                let versionBadgeHtml = '';
                if (isLocalFile && file.version_number) {
                    versionBadgeHtml = `<span class="stitch-item-version" onclick="openVersionsModal(${rawDocId}, '${escapeHtml(file.name).replace(/'/g, "\'")}', event)" title="История версий">v${file.version_number}</span>`;
                }

                let lockBadgeHtml = '';
                if (file.locked_by_user) {
                    lockBadgeHtml = `<span class="lock-indicator" style="font-size:0.7rem; color:#dc2626;" title="Заблокирован: ${escapeHtml(file.locked_by_user)}"><i class="fas fa-lock"></i></span>`;
                }

                const authorDisplay = file.created_by || file.last_modified_by || (isLocalFile ? 'Администратор' : 'Сотрудник');
                const authorInitials = getAuthorInitials(authorDisplay);
                const authorAvatarColor = getAvatarColor(authorDisplay);

                let dateDisplay = 'Недавно';
                let timeDisplay = '';
                if (file.uploaded_at) {
                    try {
                        const d = new Date(file.uploaded_at);
                        if (!isNaN(d.getTime())) {
                            dateDisplay = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
                            timeDisplay = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                        }
                    } catch (e) {
                        dateDisplay = file.uploaded_at;
                    }
                }

                const fileSizeStr = file.file_size ? formatBytes(file.file_size) : (isLocalFile ? 'PDF Документ' : 'Облачный документ');
                const subtitleStr = `${fileSizeStr} • ${escapeHtml(authorDisplay)}`;

                const isSelected = selectedItems.has(String(file.id));
                const itemDataObj = {
                    id: String(file.id),
                    name: file.name,
                    isFolder: false,
                    viewUrl: viewUrl,
                    isProtected: !!file.is_protected
                };
                const itemDataJson = escapeHtml(JSON.stringify(itemDataObj));

                html += `
                    <div class="stitch-table-row file-row ${isSelected ? 'selected' : ''}"
                         id="doc-row-${file.id}"
                         onclick="openPreviewModal(${fileJson}, event)" 
                         oncontextmenu="handleItemContextMenu(event, ${fileJson}, false)">
                        <div class="stitch-row-checkbox" onclick="event.stopPropagation()">
                            <input type="checkbox" 
                                   id="doc-cb-${file.id}"
                                   class="stitch-checkbox-custom" 
                                   data-item="${itemDataJson}"
                                   ${isSelected ? 'checked' : ''}
                                   onchange="toggleItemSelection('${file.id}', event, ${itemDataJson})" 
                                   title="Выбрать документ">
                        </div>
                        <div class="stitch-item-cell">
                            <div class="stitch-format-badge ${formatBadgeClass}">
                                ${formatShort}
                            </div>
                            <div class="stitch-item-details">
                                <div class="stitch-item-title-row">
                                    <span class="stitch-item-title" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                                    ${versionBadgeHtml}
                                    ${lockBadgeHtml}
                                    ${file.is_protected ? '<i class="fas fa-lock" style="color:#ef4444; font-size: 0.75rem; margin-left: 2px;" title="Защищено"></i>' : ''}
                                </div>
                                <div class="stitch-item-subtitle">${subtitleStr}</div>
                            </div>
                        </div>
                        <div>
                            <span class="stitch-type-pill ${typePillClass}">
                                <i class="${iconInfo.icon}"></i> ${typeName}
                            </span>
                        </div>
                        <div class="stitch-author-cell">
                            <div class="stitch-author-avatar" style="background: ${authorAvatarColor};">${authorInitials}</div>
                            <div class="stitch-author-info">
                                <div class="stitch-author-name">${escapeHtml(authorDisplay)}</div>
                                <div class="stitch-author-role">Пользователь цеха</div>
                            </div>
                        </div>
                        <div class="stitch-date-cell">
                            <span>${dateDisplay}</span>
                            ${timeDisplay ? `<span class="time-sub">${timeDisplay}</span>` : ''}
                        </div>
                        <div class="stitch-actions-cell">
                            <a href="${escapeHtml(viewUrl)}" target="_blank" download class="stitch-action-btn desktop-only" title="Скачать файл">
                                <i class="fas fa-download"></i>
                            </a>
                            <button class="stitch-action-btn mobile-action-trigger" onclick="openFileMenuById('${file.id}', event)" title="Дополнительные действия">
                                <i class="fa-solid fa-ellipsis-vertical"></i>
                            </button>
                        </div>
                    </div>
                `;
            });

            // Stitch Table Footer with interactive Batch Actions Panel
            const count = selectedItems.size;
            html += `
                    <div class="stitch-table-footer">
                        <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px;">
                            <span id="selected-count-label">Выбрано: <b>${count} ${getRussianFileWord(count)}</b></span>
                            <span style="color: #cbd5e1;">•</span>
                            <span>Всего в папке: <b>${totalCount} ${getRussianFileWord(totalCount)}</b></span>

                            <!-- Batch Actions Toolbar -->
                            <div class="stitch-table-footer-actions" id="stitch-batch-actions-panel" style="${count > 0 ? 'display: inline-flex;' : 'display: none;'}">
                                <button class="btn-batch-action" onclick="bulkDownloadSelected()" title="Скачать все выбранные файлы">
                                    <i class="fa-solid fa-download"></i> Скачать выбранные
                                </button>
                                <button class="btn-batch-action danger" onclick="bulkDeleteSelected()" title="Удалить выбранные элементы">
                                    <i class="fa-solid fa-trash"></i> Удалить
                                </button>
                                <button class="btn-batch-action btn-clear-selection" onclick="clearSelection()" title="Снять выделение">
                                    <i class="fa-solid fa-xmark"></i> Сбросить
                                </button>
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span>Страница 1 из 1</span>
                            <div class="stitch-pagination">
                                <button class="stitch-page-btn" disabled><i class="fa-solid fa-chevron-left"></i></button>
                                <button class="stitch-page-btn active">1</button>
                                <button class="stitch-page-btn" disabled><i class="fa-solid fa-chevron-right"></i></button>
                            </div>
                        </div>
                    </div>
                </div> <!-- /.stitch-table-wrapper -->
            `;

            container.innerHTML = html;
        }

        function getRussianFileWord(count) {
            const mod10 = count % 10;
            const mod100 = count % 100;
            if (mod100 >= 11 && mod100 <= 19) return 'файлов';
            if (mod10 === 1) return 'файл';
            if (mod10 >= 2 && mod10 <= 4) return 'файла';
            return 'файлов';
        }

        function getAuthorInitials(name) {
            if (!name) return 'ТП';
            const parts = name.trim().split(/\s+/);
            if (parts.length >= 2) {
                return (parts[0][0] + parts[1][0]).toUpperCase();
            }
            return name.substring(0, 2).toUpperCase();
        }

        function getAvatarColor(name) {
            const colors = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0284c7'];
            if (!name) return colors[0];
            let hash = 0;
            for (let i = 0; i < name.length; i++) {
                hash = name.charCodeAt(i) + ((hash << 5) - hash);
            }
            return colors[Math.abs(hash) % colors.length];
        }

        function formatBytes(bytes) {
            if (!bytes || bytes === 0) return '0 Б';
            const k = 1024;
            const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        }

        function createTaskFromDoc(docId, docTitle) {
            if (!docId && docId !== 0) {
                // Если docId не число, пробуем извлечь
                docId = '';
            }
            const cleanTitle = (docTitle || 'Документ').trim();
            const targetUrl = `/tasks?create_doc_id=${encodeURIComponent(docId)}&create_doc_title=${encodeURIComponent(cleanTitle)}`;
            window.open(targetUrl, '_blank');
        }

        function createTaskFromDocItem(item) {
            hideContextMenu();
            if (!item) return;
            let rawDocId = null;
            if (item.id) {
                if (typeof item.id === 'string' && item.id.startsWith('file_')) {
                    rawDocId = parseInt(item.id.replace('file_', ''));
                } else if (!isNaN(parseInt(item.id))) {
                    rawDocId = parseInt(item.id);
                }
            }
            createTaskFromDoc(rawDocId, item.name || item.title);
        }

        function goUp() {
            clearTimeout(searchTimeout);
            clearSearch();
            if (parentFolderIdHistory.length > 0) {
                const prevId = parentFolderIdHistory.pop();
                const prevName = folderNameHistory.pop() || 'Все документы';
                const isProt = (prevId && sidebarFolderMap && sidebarFolderMap[prevId]?.is_protected) || false;
                loadDocuments(prevId, prevName, false, null, isProt);
            } else if (currentFolderId && sidebarFolderMap && sidebarFolderMap[currentFolderId]?.parent_id) {
                const parentId = sidebarFolderMap[currentFolderId].parent_id;
                const parentName = sidebarFolderMap[parentId]?.name || 'Все документы';
                const isProt = sidebarFolderMap[parentId]?.is_protected || false;
                loadDocuments(parentId, parentName, false, null, isProt);
            } else {
                navigateToRootFolder();
            }
        }

        async function deleteItem(itemId, event, isProtected = false) {
            if (event) event.stopPropagation();
            hideContextMenu();
            if (isProtected || currentFolderProtected) {
                if (!await ensurePassword(true, currentFolderId)) return;
            }

            const auth = await ensureAuthForAction();
            if (!auth) return;

            if (!confirm('Вы уверены, что хотите удалить этот элемент?')) return;

            const curUser = auth.user;
            const curPin = auth.pin;

            let delUrl = `/api/documents/${itemId}`;
            const params = new URLSearchParams();
            if (curUser) params.append('user_name', curUser);
            if (curPin) params.append('user_pin', curPin);
            if (params.toString()) delUrl += '?' + params.toString();

            try {
                const res = await fetch(delUrl, {
                    method: 'DELETE',
                    headers: getFolderPasswordHeader()
                });
                const data = await res.json();
                if (res.ok && data.status === 'success') {
                    docsCache.clear();
                    loadDocuments(currentFolderId, document.getElementById('current-folder-name').innerText, false);
                    loadSidebarTree();
                    showToast('Элемент успешно удален');
                } else {
                    const msg = data.detail || data.message || 'Отказано в доступе';
                    alert('Ошибка при удалении: ' + msg);
                    if (res.status === 403 && (msg.includes('пароль') || msg.includes('Access Denied'))) {
                        sessionStorage.removeItem('folder_password');
                    }
                }
            } catch (error) {
                alert('Ошибка соединения при удалении');
            }
        }

        function showFolderModal() {
            hideContextMenu();
            document.getElementById('folder-modal').style.display = 'flex';
            setTimeout(() => document.getElementById('new-folder-name').focus(), 50);
        }
        function closeFolderModal() {
            document.getElementById('folder-modal').style.display = 'none';
            document.getElementById('new-folder-name').value = '';
        }

        async function createFolder() {
            let requiresPassword = currentFolderProtected;
            if (!currentFolderId) {
                requiresPassword = true;
            }
            if (!await ensurePassword(requiresPassword, currentFolderId)) return;

            const name = document.getElementById('new-folder-name').value.trim();
            if (!name) return;

            const author = (currentDocsUser && currentDocsUser.name) ? currentDocsUser.name : (localStorage.getItem('tectum_current_user_name') || 'Сотрудник');
            const formData = new FormData();
            formData.append('folder_name', name);
            formData.append('author_name', author);
            if (currentFolderId) formData.append('parent_id', currentFolderId);

            try {
                const res = await fetch('/api/documents/folders', {
                    method: 'POST',
                    headers: getFolderPasswordHeader(),
                    body: formData
                });
                const data = await res.json();

                if (data.status === 'success') {
                    docsCache.clear();
                    closeFolderModal();
                    loadDocuments(currentFolderId, document.getElementById('current-folder-name').innerText, false);
                    if (!currentFolderId) {
                        loadDocuments();
                    }
                    loadSidebarTree();
                    showToast('Папка создана');
                } else {
                    alert('Ошибка: ' + (data.detail || data.message));
                }
            } catch (error) {
                alert('Ошибка соединения');
            }
        }

        /* ==========================================================
           EXTERNAL LINK HANDLERS (GOOGLE & MICROSOFT UX)
           ========================================================== */
        function openAddLinkModal(prefilledUrl = '', serviceType = 'all') {
            hideContextMenu();
            const urlInput = document.getElementById('add-link-url');
            const titleInput = document.getElementById('add-link-title');
            const modalHeader = document.getElementById('add-link-modal-title');
            const hint = document.getElementById('add-link-hint');

            if (titleInput) titleInput.value = '';
            if (urlInput) urlInput.value = prefilledUrl;

            if (serviceType === 'google') {
                if (modalHeader) modalHeader.innerHTML = '<i class="fab fa-google" style="color: #4285f4; margin-right: 6px;"></i> Прикрепить ссылку Google Документ/Таблицу';
                if (hint) hint.innerHTML = 'Вставьте ссылку на Google Docs, Google Sheets или папку на Google Диске';
            } else if (serviceType === 'microsoft') {
                if (modalHeader) modalHeader.innerHTML = '<i class="fab fa-microsoft" style="color: #0078d4; margin-right: 6px;"></i> Прикрепить ссылку Microsoft OneDrive / SharePoint';
                if (hint) hint.innerHTML = 'Вставьте ссылку "Поделиться" из OneDrive, Excel Online или Word Online';
            } else {
                if (modalHeader) modalHeader.innerHTML = '<i class="fas fa-link" style="color: #3b82f6; margin-right: 6px;"></i> Прикрепить облачную ссылку';
                if (hint) hint.innerHTML = 'Вставьте любую внешнюю ссылку на документ в облаке';
            }

            const modal = document.getElementById('add-link-modal');
            if (modal) modal.style.display = 'flex';
            setTimeout(() => {
                if (urlInput && !prefilledUrl) urlInput.focus();
                else if (titleInput) titleInput.focus();
            }, 50);
        }

        function closeAddLinkModal() {
            const modal = document.getElementById('add-link-modal');
            if (modal) modal.style.display = 'none';
        }

        async function submitAddLink() {
            if (currentFolderProtected && !await ensurePassword(true, currentFolderId)) return;

            let title = document.getElementById('add-link-title').value.trim();
            let url = document.getElementById('add-link-url').value.trim();

            if (!url) {
                alert('Вставьте ссылку на файл!');
                return;
            }
            if (!title) {
                if (url.includes('drive.google.com') && (url.includes('folders') || url.includes('/folders/'))) title = 'Папка Google Диск';
                else if (url.includes('docs.google.com/spreadsheets') || url.includes('spreadsheets')) title = 'Таблица Google';
                else if (url.includes('docs.google.com/presentation') || url.includes('presentation')) title = 'Презентация Google';
                else if (url.includes('docs.google.com/forms') || url.includes('forms')) title = 'Google Форма';
                else if (url.includes('google')) title = 'Документ Google';
                else if (url.includes('onedrive') || url.includes('1drv.ms')) title = 'Документ OneDrive';
                else title = 'Внешний документ';
            }

            // Автоматическое добавление русской локали для OneDrive
            if ((url.includes('onedrive.live.com') || url.includes('1drv.ms') || url.includes('sharepoint.com')) && !url.includes('locale=') && !url.includes('ui=')) {
                const separator = url.includes('?') ? '&' : '?';
                url = `${url}${separator}locale=ru-RU`;
            }

            const author = (currentDocsUser && currentDocsUser.name) ? currentDocsUser.name : (localStorage.getItem('tectum_current_user_name') || 'Сотрудник');
            const btn = document.getElementById('btn-submit-add-link');
            const orig = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохранение...';
            btn.disabled = true;

            try {
                const res = await fetch('/api/documents/add_link', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...getFolderPasswordHeader()
                    },
                    body: JSON.stringify({
                        title: title,
                        external_url: url,
                        parent_id: currentFolderId,
                        author_name: author
                    })
                });
                const data = await res.json();
                btn.innerHTML = orig;
                btn.disabled = false;

                if (data.status === 'success') {
                    closeAddLinkModal();
                    showToast(data.message || 'Ссылка успешно прикреплена!');
                    docsCache.clear();
                    loadDocuments(currentFolderId, document.getElementById('current-folder-name').innerText, false);
                    loadSidebarTree();
                } else {
                    alert('Ошибка: ' + data.message);
                }
            } catch (e) {
                btn.innerHTML = orig;
                btn.disabled = false;
                alert('Ошибка соединения с сервером');
            }
        }

        let fetchTitleTimer = null;
        async function onLinkUrlInput(val) {
            const titleInput = document.getElementById('add-link-title');
            if (!titleInput) return;
            const trimmed = val.trim();
            if (!trimmed || !trimmed.startsWith('http')) return;

            // Базовый плейсхолдер пока подтягивается оригинальное название
            if (!titleInput.value.trim()) {
                if (trimmed.includes('1drv.ms') || trimmed.includes('onedrive.live.com') || trimmed.includes('sharepoint.com')) {
                    titleInput.value = 'Документ OneDrive';
                } else if (trimmed.includes('drive.google.com') && (trimmed.includes('folders') || trimmed.includes('/folders/'))) {
                    titleInput.value = 'Папка Google Диск';
                } else if (trimmed.includes('docs.google.com/spreadsheets')) {
                    titleInput.value = 'Таблица Google';
                } else if (trimmed.includes('docs.google.com/presentation')) {
                    titleInput.value = 'Презентация Google';
                } else if (trimmed.includes('docs.google.com/forms')) {
                    titleInput.value = 'Google Форма';
                } else if (trimmed.includes('docs.google.com/document') || trimmed.includes('google')) {
                    titleInput.value = 'Документ Google';
                } else if (trimmed.includes('disk.yandex') || trimmed.includes('yadi.sk')) {
                    titleInput.value = 'Файл Яндекс.Диск';
                }
            }

            // Запрашиваем точное название документа с сервера
            clearTimeout(fetchTitleTimer);
            fetchTitleTimer = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/documents/fetch_link_title?url=${encodeURIComponent(trimmed)}`);
                    const data = await res.json();
                    if (data.status === 'success' && data.title) {
                        titleInput.value = data.title;
                    }
                } catch (e) {
                    console.log('Title fetch skipped:', e);
                }
            }, 300);
        }

        // Глобальный перехват Ctrl+V для мгновенной вставки ссылок из буфера
        window.addEventListener('paste', function (e) {
            if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
                return;
            }
            const text = (e.clipboardData || window.clipboardData).getData('text');
            if (text && (text.startsWith('http://') || text.startsWith('https://') || text.includes('1drv.ms') || text.includes('onedrive') || text.includes('drive.google') || text.includes('docs.google'))) {
                e.preventDefault();
                const isGoogle = text.includes('google');
                const isMs = text.includes('1drv.ms') || text.includes('onedrive') || text.includes('sharepoint');
                openAddLinkModal(text.trim(), isGoogle ? 'google' : (isMs ? 'microsoft' : 'all'));
                showToast('Ссылка вставлена из буфера обмена');
            }
        });


        async function syncFolderTitles() {
            const btn = document.getElementById('btn-sync-titles');
            const icon = btn ? btn.querySelector('i') : null;
            if (icon) icon.classList.add('fa-spin');
            if (btn) btn.disabled = true;

            try {
                const targetParam = currentFolderId ? `?parent_id=${encodeURIComponent(currentFolderId)}` : '?parent_id=root';
                const res = await fetch(`/api/documents/sync_external_titles${targetParam}`, {
                    method: 'POST'
                });
                const data = await res.json();
                if (data.status === 'success') {
                    docsCache.clear();
                    loadDocuments(currentFolderId, document.getElementById('current-folder-name').innerText, false);
                    loadSidebarTree();
                    if (data.updated_count > 0) {
                        showToast(`Обновлено названий: ${data.updated_count}`);
                    } else {
                        showToast('Все названия актуальны');
                    }
                }
            } catch (e) {
                console.error("Sync titles failed:", e);
            } finally {
                if (icon) icon.classList.remove('fa-spin');
                if (btn) btn.disabled = false;
            }
        }

        /* ==========================================================
           MOVE MODAL LOGIC (ROBUST MOBILE & DESKTOP MOVE)
           ========================================================== */
        let moveTargetItemId = null;
        let moveTargetIsFolder = false;
        let moveTargetProtected = false;
        let moveSelectedFolderId = 'root';
        let allMoveFoldersList = [];
        let expandedMoveFolders = new Set();

        async function openMoveModal(itemId, itemName, isFolder, currentParentId, isProtected) {
            hideContextMenu();
            moveTargetItemId = itemId;
            moveTargetIsFolder = isFolder;
            moveTargetProtected = isProtected;
            moveSelectedFolderId = 'root';
            expandedMoveFolders = new Set();

            const modal = document.getElementById('move-modal');
            const itemText = document.getElementById('move-modal-item-text');
            const searchInput = document.getElementById('move-folder-search');
            const selectedLabel = document.getElementById('move-selected-label');
            const treeContainer = document.getElementById('move-folder-tree');

            if (itemText) itemText.innerText = itemName;
            if (searchInput) searchInput.value = '';
            if (selectedLabel) selectedLabel.innerText = '📁 Главная директория (Корень)';
            if (treeContainer) treeContainer.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--docs-text-muted);"><i class="fas fa-spinner fa-spin"></i> Загрузка структуры папок...</div>';

            if (modal) modal.style.display = 'flex';

            try {
                const res = await fetch('/api/documents/tree');
                const data = await res.json();
                if (data.status === 'success') {
                    const folders = data.data.folders || (Array.isArray(data.data) ? data.data : []);
                    allMoveFoldersList = folders;
                    buildAndRenderMoveTree(folders, itemId, isFolder, currentParentId);
                } else {
                    if (treeContainer) treeContainer.innerHTML = `<div style="color: #ef4444; padding: 1rem; text-align: center;">Ошибка: ${data.message}</div>`;
                }
            } catch (err) {
                if (treeContainer) treeContainer.innerHTML = `<div style="color: #ef4444; padding: 1rem; text-align: center;">Ошибка загрузки папок</div>`;
            }
        }

        function closeMoveModal() {
            const modal = document.getElementById('move-modal');
            if (modal) modal.style.display = 'none';
            moveTargetItemId = null;
        }

        function buildAndRenderMoveTree(folders, movingItemId, movingIsFolder, currentParentId, filterQuery = '') {
            const treeContainer = document.getElementById('move-folder-tree');
            if (!treeContainer) return;
            treeContainer.innerHTML = '';

            const movingFolderId = movingIsFolder ? movingItemId : null;

            // Find all descendant IDs if moving a folder (to prevent cycle)
            const disabledIds = new Set();
            if (movingFolderId) {
                disabledIds.add(movingFolderId);
                const addChildren = (parentId) => {
                    folders.forEach(f => {
                        if (f.parent_id === parentId) {
                            disabledIds.add(f.id);
                            addChildren(f.id);
                        }
                    });
                };
                addChildren(movingFolderId);
            }

            const cleanFilter = (filterQuery || '').trim().toLowerCase();

            // Root folder option
            const rootMatch = !cleanFilter || 'главная директория корень root'.includes(cleanFilter);
            if (rootMatch) {
                const rootWrapper = document.createElement('div');
                rootWrapper.className = 'move-folder-wrapper';

                const rootSpacer = document.createElement('div');
                rootSpacer.className = 'move-tree-toggle';
                rootSpacer.style.visibility = 'hidden';

                const rootItem = document.createElement('div');
                rootItem.className = 'move-folder-item' + (moveSelectedFolderId === 'root' ? ' selected' : '');
                rootItem.innerHTML = `<i class="fas fa-home" style="color: #38bdf8; font-size: 0.95rem; flex-shrink: 0;"></i> <span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">Главная директория (Корень)</span>`;

                rootItem.onclick = () => {
                    selectMoveTarget('root', '📁 Главная директория (Корень)', rootItem);
                };

                rootWrapper.appendChild(rootSpacer);
                rootWrapper.appendChild(rootItem);
                treeContainer.appendChild(rootWrapper);
            }

            // Build tree hierarchy
            const folderMap = {};
            const rootFolders = [];
            folders.forEach(f => {
                f.children = [];
                folderMap[f.id] = f;
            });
            folders.forEach(f => {
                if (f.parent_id && folderMap[f.parent_id]) {
                    folderMap[f.parent_id].children.push(f);
                } else {
                    rootFolders.push(f);
                }
            });

            // Strict sort for root folders
            const strictOrder = {
                "Должностные инструкции по всем сотрудникам": 0,
                "ОТ и ТБ": 1,
                "Договора с подрядчиками": 2,
                "Отдел кадров": 3,
                "Коммерческий департамент": 4,
                "Технический директор": 5,
                "Финансовый директор": 6,
                "Начальник производства": 7,
                "Главный технолог": 8,
                "Служба контроля качества": 9,
                "Бережливое производство": 10,
                "ОГМ": 11
            };
            rootFolders.sort((a, b) => {
                const orderA = strictOrder.hasOwnProperty(a.name) ? strictOrder[a.name] : 999;
                const orderB = strictOrder.hasOwnProperty(b.name) ? strictOrder[b.name] : 999;
                if (orderA !== orderB) return orderA - orderB;
                return a.name.localeCompare(b.name);
            });

            // Helper to check if subtree contains a matching folder
            function subtreeMatches(folder) {
                if (folder.name.toLowerCase().includes(cleanFilter)) return true;
                if (folder.children && folder.children.length > 0) {
                    return folder.children.some(child => subtreeMatches(child));
                }
                return false;
            }

            function renderMoveTreeNode(folder) {
                if (cleanFilter && !subtreeMatches(folder)) {
                    return null;
                }

                const wrapper = document.createElement('div');

                const header = document.createElement('div');
                header.className = 'move-folder-wrapper';

                const hasChildren = folder.children && folder.children.length > 0;
                const isDisabled = disabledIds.has(folder.id);
                const isSelected = moveSelectedFolderId === folder.id;

                const toggle = document.createElement('div');
                toggle.className = 'move-tree-toggle';
                if (hasChildren) {
                    toggle.innerHTML = '<i class="fa-solid fa-chevron-right" style="font-size: 0.65rem;"></i>';
                } else {
                    toggle.innerHTML = '';
                    toggle.style.visibility = 'hidden';
                }

                const item = document.createElement('div');
                item.className = 'move-folder-item';
                if (isSelected) item.classList.add('selected');
                if (isDisabled) item.classList.add('disabled');

                const iconColor = getFolderColor(folder.name);
                const lockIcon = folder.is_protected ? ' <i class="fas fa-lock" style="color:#ef4444; font-size: 0.75rem; margin-left: 4px;" title="Защищено паролем"></i>' : '';
                const disabledText = isDisabled ? '<span style="margin-left: auto; font-size: 0.72rem; color: var(--docs-text-muted);">(текущая/вложенная)</span>' : '';

                item.innerHTML = `<i class="fas fa-folder" style="color: ${iconColor}; font-size: 0.95rem; flex-shrink: 0;"></i> <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${escapeHtml(folder.name)}</span>${lockIcon}${disabledText}`;

                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'move-tree-node';

                const isExpanded = expandedMoveFolders.has(folder.id) || (cleanFilter.length > 0);
                if (isExpanded) {
                    childrenContainer.classList.add('expanded');
                    toggle.classList.add('expanded');
                }

                toggle.onclick = (e) => {
                    e.stopPropagation();
                    if (hasChildren) {
                        if (expandedMoveFolders.has(folder.id)) {
                            expandedMoveFolders.delete(folder.id);
                            childrenContainer.classList.remove('expanded');
                            toggle.classList.remove('expanded');
                        } else {
                            expandedMoveFolders.add(folder.id);
                            childrenContainer.classList.add('expanded');
                            toggle.classList.add('expanded');
                        }
                    }
                };

                item.onclick = (e) => {
                    if (isDisabled) return;
                    selectMoveTarget(folder.id, folder.name, item);
                    if (hasChildren && !expandedMoveFolders.has(folder.id)) {
                        expandedMoveFolders.add(folder.id);
                        childrenContainer.classList.add('expanded');
                        toggle.classList.add('expanded');
                    }
                };

                header.appendChild(toggle);
                header.appendChild(item);
                wrapper.appendChild(header);

                if (hasChildren) {
                    folder.children.forEach(child => {
                        const childNode = renderMoveTreeNode(child);
                        if (childNode) {
                            childrenContainer.appendChild(childNode);
                        }
                    });
                    wrapper.appendChild(childrenContainer);
                }

                return wrapper;
            }

            let renderedCount = 0;
            rootFolders.forEach(rf => {
                const node = renderMoveTreeNode(rf);
                if (node) {
                    treeContainer.appendChild(node);
                    renderedCount++;
                }
            });

            if (!rootMatch && renderedCount === 0) {
                treeContainer.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--docs-text-muted); font-size: 0.88rem;">Папки не найдены</div>';
            }
        }

        function filterMoveFolders(query) {
            const q = query.trim();
            buildAndRenderMoveTree(allMoveFoldersList, moveTargetItemId, moveTargetIsFolder, null, q);
        }

        function selectMoveTarget(folderId, folderName, el) {
            moveSelectedFolderId = folderId;
            document.querySelectorAll('.move-folder-item').forEach(item => item.classList.remove('selected'));
            if (el) el.classList.add('selected');
            const label = document.getElementById('move-selected-label');
            if (label) {
                label.innerText = folderName;
            }
        }

        async function submitMoveItem() {
            if (!moveTargetItemId) return;

            const targetFolder = allMoveFoldersList.find(f => f.id === moveSelectedFolderId);
            const isTargetProtected = targetFolder ? targetFolder.is_protected : false;

            if (moveTargetProtected || isTargetProtected || currentFolderProtected) {
                if (!await ensurePassword(true, currentFolderId)) return;
            }

            const auth = await ensureAuthForAction();
            if (!auth) return;

            const btnSubmit = document.getElementById('btn-submit-move');
            const originalText = btnSubmit.innerHTML;
            btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Перемещение...';
            btnSubmit.disabled = true;

            const curUser = auth.user;
            const curPin = auth.pin;

            const formData = new FormData();
            formData.append('target_folder_id', moveSelectedFolderId === 'root' ? '' : moveSelectedFolderId);
            if (curUser) formData.append('user_name', curUser);
            if (curPin) formData.append('user_pin', curPin);

            try {
                const res = await fetch(`/api/documents/${moveTargetItemId}/move`, {
                    method: 'PUT',
                    headers: getFolderPasswordHeader(),
                    body: formData
                });
                const data = await res.json();
                btnSubmit.innerHTML = originalText;
                btnSubmit.disabled = false;

                if (res.ok && data.status === 'success') {
                    docsCache.clear();
                    closeMoveModal();
                    loadDocuments(currentFolderId, document.getElementById('current-folder-name').innerText, false);
                    loadSidebarTree();
                    showToast(moveTargetIsFolder ? 'Папка успешно перемещена' : 'Файл успешно перемещен');
                } else {
                    alert('Ошибка перемещения: ' + (data.detail || data.message || 'Отказано в доступе'));
                }
            } catch (err) {
                btnSubmit.innerHTML = originalText;
                btnSubmit.disabled = false;
                alert('Ошибка соединения с сервером');
            }
        }

        /* ==========================================================
           MS OFFICE & LOCAL FILES & VERSIONING JAVASCRIPT HANDLERS
           ========================================================== */

        let plannerEmployeesList = [];
        let currentEditingDocId = null;
        let currentEditingDocName = '';
        let currentVersionsDocId = null;

        function isOfficeDocument(fileName) {
            const n = (fileName || '').toLowerCase();
            return n.endsWith('.docx') || n.endsWith('.doc') || n.endsWith('.xlsx') || n.endsWith('.xls') || n.endsWith('.pptx') || n.endsWith('.ppt') || n.endsWith('.xlsm') || n.endsWith('.csv');
        }

        async function loadPlannerEmployeesOnce() {
            if (plannerEmployeesList.length > 0) return plannerEmployeesList;
            try {
                const res = await fetch('/api/planner/employees');
                const data = await res.json();
                let rawList = [];
                if (Array.isArray(data)) {
                    rawList = data;
                } else if (data.employees && Array.isArray(data.employees)) {
                    rawList = data.employees;
                }

                // Фильтрация системных отделов, служб и обобщенных мастеров
                const stopWords = ['офис', 'мастер', 'огэ', 'огм', 'служба', 'цех', 'отдел', 'участок', 'скк', 'директор', 'технолог'];
                plannerEmployeesList = rawList.filter(emp => {
                    const name = (emp.name || '').trim().toLowerCase();
                    if (!name) return false;
                    return !stopWords.some(w => name.includes(w));
                });

                // Если список пуст, даем персонализированный список по умолчанию
                if (plannerEmployeesList.length === 0) {
                    plannerEmployeesList = [
                        { id: 1, name: "Левда М." },
                        { id: 2, name: "Булеханов К." },
                        { id: 3, name: "Курилова С." },
                        { id: 4, name: "Сазонов С." },
                        { id: 5, name: "Носиков Е." },
                        { id: 6, name: "Хохлов К." },
                        { id: 7, name: "Батырбекова Г." },
                        { id: 8, name: "Герлинг С." },
                        { id: 9, name: "Косумов Р." },
                        { id: 10, name: "Туматов Д." }
                    ];
                }
            } catch (e) {
                console.log("Could not load planner employees:", e);
                plannerEmployeesList = [
                    { id: 1, name: "Левда М." },
                    { id: 2, name: "Булеханов К." },
                    { id: 3, name: "Курилова С." },
                    { id: 4, name: "Сазонов С." },
                    { id: 5, name: "Носиков Е." },
                    { id: 6, name: "Хохлов К." },
                    { id: 7, name: "Батырбекова Г." },
                    { id: 8, name: "Герлинг С." },
                    { id: 9, name: "Косумов Р." },
                    { id: 10, name: "Туматов Д." }
                ];
            }
            return plannerEmployeesList;
        }

        function populateEmployeeSelect(selectId, selectedName = '') {
            const sel = document.getElementById(selectId);
            if (!sel) return;
            sel.innerHTML = '<option value="">-- Выберите сотрудника --</option>';
            plannerEmployeesList.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp.name;
                opt.textContent = emp.name + (emp.position ? ` (${emp.position})` : '');
                if (selectedName && emp.name === selectedName) opt.selected = true;
                sel.appendChild(opt);
            });
            if (!selectedName) {
                const savedEmp = localStorage.getItem('tectum_current_user_name');
                if (savedEmp) sel.value = savedEmp;
            }
        }

        /* ==========================================================
           DOCS USER SESSION & AUTH LOGIC (Shared with Planner)
           ========================================================== */
        let currentDocsUser = null;
        let pendingDocsAuthCallback = null;

        function initDocsUserSession() {
            try {
                const saved = localStorage.getItem("tectum_portal_user");
                if (saved) {
                    currentDocsUser = JSON.parse(saved);
                } else {
                    const fallbackName = localStorage.getItem("tectum_current_user_name");
                    if (fallbackName) {
                        currentDocsUser = { name: fallbackName, pin: "" };
                    }
                }
            } catch (e) { }
            updateDocsUserBadge();
        }

        function updateDocsUserBadge() {
            const nameEl = document.getElementById("docs-user-name");
            const badgeEl = document.getElementById("docs-user-badge");
            const logoutBtn = document.getElementById("btn-docs-logout");
            if (nameEl && badgeEl) {
                if (currentDocsUser && currentDocsUser.name) {
                    const isAdmin = currentDocsUser.is_admin || currentDocsUser.name === 'Левда М.';
                    nameEl.textContent = (isAdmin ? '👑 ' : '') + currentDocsUser.name;
                    badgeEl.className = "user-session-badge-modern";
                    badgeEl.title = `Авторизован: ${currentDocsUser.name}. Нажмите для смены профиля`;
                    if (logoutBtn) logoutBtn.style.display = "inline-block";
                } else {
                    nameEl.textContent = "Войти (PIN)";
                    badgeEl.className = "user-session-badge-modern anonymous";
                    badgeEl.title = "Нажмите, чтобы войти под своим именем";
                    if (logoutBtn) logoutBtn.style.display = "none";
                }
            }

            // Синхронизация профиля в мобильной шапке (Canonical TECTUM Mobile Header)
            const mobileNameEl = document.getElementById("mobile-docs-user-name");
            const mobileBadgeEl = document.getElementById("mobile-docs-user-badge");
            const mobileLogoutBtn = document.getElementById("mobile-btn-docs-logout");
            const mobileIconEl = document.getElementById("mobile-docs-user-icon");
            if (mobileNameEl && mobileBadgeEl) {
                if (currentDocsUser && currentDocsUser.name) {
                    const isAdmin = currentDocsUser.is_admin || currentDocsUser.name === 'Левда М.';
                    mobileNameEl.textContent = (isAdmin ? '👑 ' : '') + currentDocsUser.name;
                    mobileBadgeEl.className = "user-session-badge-modern";
                    mobileBadgeEl.style.background = "#eff6ff";
                    mobileBadgeEl.style.color = "#1d4ed8";
                    mobileBadgeEl.style.borderColor = "#bfdbfe";
                    mobileBadgeEl.title = `Авторизован: ${currentDocsUser.name}. Нажмите для смены профиля`;
                    if (mobileIconEl) {
                        mobileIconEl.className = "fa-solid fa-user";
                        mobileIconEl.style.color = "#2563eb";
                    }
                    if (mobileLogoutBtn) mobileLogoutBtn.style.display = "inline-block";
                } else {
                    mobileNameEl.textContent = "Войти (PIN)";
                    mobileBadgeEl.className = "user-session-badge-modern anonymous";
                    mobileBadgeEl.style.background = "#f8fafc";
                    mobileBadgeEl.style.color = "#475569";
                    mobileBadgeEl.style.borderColor = "#cbd5e1";
                    mobileBadgeEl.title = "Нажмите, чтобы войти под своим именем";
                    if (mobileIconEl) {
                        mobileIconEl.className = "fa-solid fa-user-lock";
                        mobileIconEl.style.color = "";
                    }
                    if (mobileLogoutBtn) mobileLogoutBtn.style.display = "none";
                }
            }

            // Синхронизация профиля в боковом меню (Sidebar)
            const sidebarNameEl = document.getElementById("sidebar-docs-user-name");
            const sidebarBadgeEl = document.getElementById("sidebar-docs-user-badge");
            const sidebarLogoutBtn = document.getElementById("sidebar-btn-docs-logout");
            if (sidebarNameEl && sidebarBadgeEl) {
                if (currentDocsUser && currentDocsUser.name) {
                    const isAdmin = currentDocsUser.is_admin || currentDocsUser.name === 'Левда М.';
                    sidebarNameEl.textContent = (isAdmin ? '👑 ' : '') + currentDocsUser.name;
                    sidebarBadgeEl.style.background = "#eff6ff";
                    sidebarBadgeEl.style.color = "#1d4ed8";
                    sidebarBadgeEl.style.borderColor = "#bfdbfe";
                    if (sidebarLogoutBtn) sidebarLogoutBtn.style.display = "inline-block";
                } else {
                    sidebarNameEl.textContent = "Войти (PIN)";
                    sidebarBadgeEl.style.background = "#f8fafc";
                    sidebarBadgeEl.style.color = "#334155";
                    sidebarBadgeEl.style.borderColor = "#cbd5e1";
                    if (sidebarLogoutBtn) sidebarLogoutBtn.style.display = "none";
                }
            }
        }

        async function promptDocsUserAuth() {
            await loadPlannerEmployeesOnce();
            openDocsPinModal(null, (user) => {
                showToast(`Вы вошли как ${user.name}`);
            });
        }

        async function logoutDocsUser(event) {
            if (event) event.stopPropagation();
            currentDocsUser = null;
            try {
                await fetch("/api/logout", { method: "POST" });
            } catch (e) {}
            try {
                localStorage.removeItem("tectum_auth_user");
                localStorage.removeItem("tectum_portal_user");
                localStorage.removeItem("tectum_current_user_name");
                sessionStorage.removeItem("planner_user_session");
            } catch (e) {}
            window.location.replace('/');
        }

        /* --- Canonical PersonPickerPopover & 4-Box PIN Auth Handlers --- */
        function getInitialsAvatar(name) {
            if (!name) return '??';
            const parts = name.trim().split(/\s+/);
            if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
            return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
        }

        function toggleDocsUserPickerPopover(event) {
            if (event) event.stopPropagation();
            const popover = document.getElementById("docs-user-picker-popover");
            const trigger = document.getElementById("docs-user-picker-trigger");
            if (!popover || !trigger) return;

            const isOpen = popover.style.display === "block";
            if (isOpen) {
                closeDocsUserPickerPopover();
            } else {
                renderDocsUserPickerList("");
                popover.style.display = "block";
                trigger.classList.add("popover-open");
                positionDocsUserPickerPopover();
                const searchInput = document.getElementById("search-docs-user-picker");
                if (searchInput) {
                    searchInput.value = "";
                    setTimeout(() => { searchInput.focus(); }, 50);
                }
            }
        }

        function closeDocsUserPickerPopover() {
            const popover = document.getElementById("docs-user-picker-popover");
            const trigger = document.getElementById("docs-user-picker-trigger");
            if (popover) popover.style.display = "none";
            if (trigger) trigger.classList.remove("popover-open");
        }

        function positionDocsUserPickerPopover() {
            const popover = document.getElementById("docs-user-picker-popover");
            const trigger = document.getElementById("docs-user-picker-trigger");
            if (!popover || !trigger || popover.style.display !== "block") return;

            const rect = trigger.getBoundingClientRect();
            popover.style.top = `${rect.bottom + 6}px`;
            popover.style.left = `${rect.left}px`;
            popover.style.width = `${Math.max(rect.width, 320)}px`;
        }

        window.addEventListener("resize", positionDocsUserPickerPopover, { passive: true });
        window.addEventListener("scroll", positionDocsUserPickerPopover, { passive: true });
        window.addEventListener("click", () => { closeDocsUserPickerPopover(); });

        function selectDocsUser(empName) {
            const input = document.getElementById("docs-pin-user-input");
            const select = document.getElementById("docs-pin-user-select");
            const displayText = document.getElementById("docs-user-picker-display-text");
            const avatar = document.getElementById("docs-user-picker-avatar");

            if (input) input.value = empName || "";
            if (select) select.value = empName || "";

            if (empName) {
                const emp = (plannerEmployeesList || []).find(e => e.name === empName);
                if (displayText) {
                    displayText.textContent = emp ? `${emp.name} ${emp.position ? '(' + emp.position + ')' : ''}` : empName;
                    displayText.style.color = "#0f172a";
                    displayText.style.fontWeight = "600";
                }
                if (avatar) {
                    avatar.innerHTML = getInitialsAvatar(empName);
                    avatar.style.background = "#eff6ff";
                    avatar.style.color = "#1d4ed8";
                }
            } else {
                if (displayText) {
                    displayText.textContent = "-- Выберите сотрудника --";
                    displayText.style.color = "#64748b";
                    displayText.style.fontWeight = "normal";
                }
                if (avatar) {
                    avatar.innerHTML = '<i class="fa-solid fa-user"></i>';
                    avatar.style.background = "#f1f5f9";
                    avatar.style.color = "#64748b";
                }
            }

            try {
                const searchInput = document.getElementById("search-docs-user-picker");
                if (searchInput) searchInput.blur();
                if (document.activeElement && document.activeElement.blur) {
                    document.activeElement.blur();
                }
            } catch(e) {}

            closeDocsUserPickerPopover();
            onDocsPinUserSelectChanged();
        }

        function renderDocsUserPickerList(filterQuery = '') {
            const listEl = document.getElementById("list-docs-user-picker");
            if (!listEl) return;

            const q = (filterQuery || '').trim().toLowerCase();
            const currentVal = document.getElementById("docs-pin-user-input")?.value || "";

            let html = '';
            // Reset option
            const isUnassigned = !currentVal;
            html += `
                <div class="filter-option-item ${isUnassigned ? 'selected' : ''}" onclick="selectDocsUser('')">
                    <div class="filter-option-person-left">
                        <div class="author-avatar-circle" style="background: #f1f5f9; color: #64748b;"><i class="fa-solid fa-user-slash" style="font-size: 0.75rem;"></i></div>
                        <span style="color: #64748b; font-style: italic;">-- Выберите сотрудника --</span>
                    </div>
                </div>
            `;

            const list = Array.isArray(plannerEmployeesList) ? plannerEmployeesList : [];
            const filtered = list.filter(emp => {
                if (!q) return true;
                return (emp.name || '').toLowerCase().includes(q) || (emp.position || '').toLowerCase().includes(q);
            });

            filtered.forEach(emp => {
                const isSelected = emp.name === currentVal;
                const initials = getInitialsAvatar(emp.name);
                html += `
                    <div class="filter-option-item ${isSelected ? 'selected' : ''}" onclick="selectDocsUser('${escapeHtml(emp.name).replace(/'/g, "\'")}')">
                        <div class="filter-option-person-left">
                            <div class="author-avatar-circle" style="background: ${isSelected ? '#2563eb' : '#eff6ff'}; color: ${isSelected ? '#fff' : '#1d4ed8'};">
                                ${initials}
                            </div>
                            <div style="display: flex; flex-direction: column; min-width: 0;">
                                <span style="color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: ${isSelected ? '700' : '500'};">${escapeHtml(emp.name)}</span>
                                ${emp.position ? `<span style="font-size: 0.72rem; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(emp.position)}</span>` : ''}
                            </div>
                        </div>
                        ${isSelected ? '<i class="fa-solid fa-check" style="color: #2563eb; font-size: 0.85rem;"></i>' : ''}
                    </div>
                `;
            });

            if (filtered.length === 0) {
                html += `<div style="padding: 1rem; text-align: center; color: #94a3b8; font-size: 0.85rem;">Сотрудник не найден</div>`;
            }

            listEl.innerHTML = html;
        }

        /* 4-Box PIN Input Helpers */
        function getPinBoxValue() {
            let val = '';
            for (let i = 1; i <= 4; i++) {
                const box = document.getElementById(`pin-box-${i}`);
                if (box) val += box.value.trim();
            }
            return val;
        }

        function clearPinBoxes() {
            for (let i = 1; i <= 4; i++) {
                const box = document.getElementById(`pin-box-${i}`);
                if (box) box.value = '';
            }
            const hidden = document.getElementById('docs-pin-input');
            if (hidden) hidden.value = '';
        }

        function handlePinBoxInput(index, event) {
            const box = document.getElementById(`pin-box-${index}`);
            if (!box) return;

            // Allow only numbers
            box.value = box.value.replace(/[^0-9]/g, '');

            if (box.value && index < 4) {
                const nextBox = document.getElementById(`pin-box-${index + 1}`);
                if (nextBox) nextBox.focus();
            }

            const fullPin = getPinBoxValue();
            const hidden = document.getElementById('docs-pin-input');
            if (hidden) hidden.value = fullPin;

            if (fullPin.length === 4) {
                submitDocsPinAuth();
            }
        }

        function handlePinBoxKeydown(index, event) {
            if (event.key === 'Backspace') {
                const box = document.getElementById(`pin-box-${index}`);
                if (box && !box.value && index > 1) {
                    const prevBox = document.getElementById(`pin-box-${index - 1}`);
                    if (prevBox) {
                        prevBox.focus();
                        prevBox.value = '';
                    }
                }
            } else if (event.key === 'Enter') {
                submitDocsPinAuth();
            }
        }

        async function openDocsPinModal(preselectedUser = null, onSuccess = null) {
            pendingDocsAuthCallback = onSuccess;
            await loadPlannerEmployeesOnce();

            const modal = document.getElementById("docs-pin-modal");
            clearPinBoxes();

            const targetUser = preselectedUser || (currentDocsUser ? currentDocsUser.name : '');
            selectDocsUser(targetUser);

            if (modal) {
                modal.style.display = "flex";
                modal.style.alignItems = "center";
                modal.style.justifyContent = "center";
            }

            setTimeout(() => {
                const b1 = document.getElementById("pin-box-1");
                const pinGroup = document.getElementById("docs-pin-input-group");
                if (b1 && pinGroup && pinGroup.style.display !== "none") {
                    b1.focus();
                }
            }, 120);
        }

        function closeDocsPinModal() {
            const modal = document.getElementById("docs-pin-modal");
            if (modal) modal.style.display = "none";
            closeDocsUserPickerPopover();
            pendingDocsAuthCallback = null;
        }

        function onDocsPinUserSelectChanged() {
            const input = document.getElementById("docs-pin-user-input");
            const pinGroup = document.getElementById("docs-pin-input-group");
            const name = input ? input.value.trim() : "";
            if (!name) return;

            const emp = plannerEmployeesList.find(e => e.name === name);
            if (emp && emp.has_pin === false) {
                if (pinGroup) pinGroup.style.display = "none";
            } else {
                if (pinGroup) pinGroup.style.display = "block";
                const b1 = document.getElementById("pin-box-1");
                if (b1) setTimeout(() => b1.focus(), 50);
            }
        }

        async function submitDocsPinAuth() {
            const input = document.getElementById("docs-pin-user-input");
            const name = input ? input.value.trim() : "";
            const pin = getPinBoxValue();
            const btnSubmit = document.getElementById("btn-submit-docs-pin");

            if (!name) {
                showToast("Пожалуйста, выберите сотрудника!");
                toggleDocsUserPickerPopover();
                return;
            }

            const pinGroup = document.getElementById("docs-pin-input-group");
            if (pinGroup && pinGroup.style.display !== "none" && pin.length < 4) {
                showToast("Пожалуйста, введите 4-значный PIN-код!");
                const b1 = document.getElementById("pin-box-1");
                if (b1) b1.focus();
                return;
            }

            // Double submit guard
            if (btnSubmit) {
                btnSubmit.disabled = true;
                btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Проверка...</span>';
            }

            try {
                const res = await fetch("/api/planner/employees/verify_pin", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: name, pin_code: pin })
                });

                if (res.ok) {
                    currentDocsUser = { name: name, pin: pin };
                    localStorage.setItem("tectum_portal_user", JSON.stringify(currentDocsUser));
                    localStorage.setItem("tectum_current_user_name", name);
                    try {
                        const loginRes = await fetch("/api/login/", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: name, pin: pin })
                        });
                        if (loginRes.ok) {
                            const loginUser = await loginRes.json();
                            localStorage.setItem("tectum_auth_user", JSON.stringify(loginUser));
                        }
                    } catch (err) {}
                    updateDocsUserBadge();

                    const cb = pendingDocsAuthCallback;
                    closeDocsPinModal();
                    showToast(`Авторизован: ${name}`);

                    if (cb && typeof cb === "function") {
                        cb(currentDocsUser);
                    }
                } else {
                    const err = await res.json();
                    showToast("Ошибка: " + (err.detail || "Неверный PIN-код"));
                    clearPinBoxes();
                    const b1 = document.getElementById("pin-box-1");
                    if (b1) b1.focus();
                }
            } catch (e) {
                console.error("PIN verification error:", e);
                showToast("Ошибка сети при проверке PIN-кода");
            } finally {
                if (btnSubmit) {
                    btnSubmit.disabled = false;
                    btnSubmit.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> <span>Войти</span>';
                }
            }
        }

        /* --- Local File Upload --- */
        function triggerLocalFileUpload() {
            const input = document.getElementById('local-file-input');
            if (input) {
                input.value = '';
                input.click();
            }
        }

        async function handleLocalFileSelected(event) {
            const file = event.target.files[0];
            if (!file) return;
            await uploadFileDirectly(file);
        }

        async function uploadFileDirectly(file) {
            if (currentFolderProtected && !await ensurePassword(true, currentFolderId)) return;

            const nameLower = (file.name || '').toLowerCase();
            if (!nameLower.endsWith('.pdf')) {
                alert('Локально в Базу Знаний разрешена загрузка только документов формата PDF (.pdf).\n\nДля рабочих документов Word (.docx) и Excel (.xlsx) используйте добавление ссылок Google Docs или OneDrive.');
                return;
            }

            const savedAuthor = (currentDocsUser && currentDocsUser.name) ? currentDocsUser.name : (localStorage.getItem('tectum_current_user_name') || 'Сотрудник');
            const formData = new FormData();
            formData.append('file', file);
            formData.append('author_name', savedAuthor);
            if (currentFolderId) {
                formData.append('parent_id', currentFolderId);
            }

            showToast(`Загрузка файла "${file.name}"...`);

            try {
                const res = await fetch('/api/documents/upload_local', {
                    method: 'POST',
                    headers: getFolderPasswordHeader(),
                    body: formData
                });
                const data = await res.json();
                if (data.status === 'success') {
                    showToast('Файл успешно загружен в Базу Знаний!');
                    docsCache.clear();
                    loadDocuments(currentFolderId, document.getElementById('current-folder-name').innerText, false);
                    loadSidebarTree();
                } else {
                    alert('Ошибка загрузки файла: ' + data.message);
                }
            } catch (e) {
                alert('Ошибка соединения с сервером при загрузке');
            }
        }

        /* --- Document Online Preview & Downloader Modal --- */
        async function openPreviewModal(file, event) {
            if (event) event.stopPropagation();
            if (!file) return;

            if (file.is_protected || currentFolderProtected) {
                if (!await ensurePassword(true, currentFolderId)) return;
            }

            // Если это внешняя ссылка (Google Docs, Google Sheets, OneDrive)
            if (file.external_url) {
                window.open(file.external_url, '_blank');
                return;
            }

            let rawDocId = null;
            if (file.id) {
                if (typeof file.id === 'string' && file.id.startsWith('file_')) {
                    rawDocId = parseInt(file.id.replace('file_', ''));
                } else if (!isNaN(parseInt(file.id))) {
                    rawDocId = parseInt(file.id);
                }
            }

            const modal = document.getElementById('doc-preview-modal');
            const titleEl = document.getElementById('preview-modal-title');
            const iconEl = document.getElementById('preview-modal-icon');
            const iframe = document.getElementById('preview-modal-iframe');
            const fallback = document.getElementById('preview-modal-fallback');
            const downloadBtn = document.getElementById('preview-modal-download-btn');
            const fallbackFilename = document.getElementById('preview-fallback-filename');
            const fallbackLink = document.getElementById('preview-fallback-download-link');

            let downloadUrl = `/api/documents/download/${rawDocId}`;
            if (file.is_protected || currentFolderProtected) {
                const pwd = sessionStorage.getItem('folder_password') || (currentDocsUser ? currentDocsUser.pin : '');
                if (pwd) {
                    downloadUrl += `?pwd=${encodeURIComponent(pwd)}`;
                }
            }
            const fileName = file.name || 'Документ';
            const nameLower = fileName.toLowerCase();

            if (titleEl) titleEl.innerText = fileName;
            if (fallbackFilename) fallbackFilename.innerText = fileName;

            if (downloadBtn) {
                downloadBtn.onclick = () => {
                    window.open(downloadUrl, '_blank');
                };
            }
            if (fallbackLink) {
                fallbackLink.href = downloadUrl;
            }

            const iconInfo = getFileIcon(file.mimeType, fileName, downloadUrl);
            if (iconEl) {
                iconEl.className = iconInfo.icon;
                iconEl.style.color = iconInfo.color;
            }

            // Определение источника предпросмотра
            const isMobile = window.innerWidth <= 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
            const isAndroid = /Android/i.test(navigator.userAgent);
            const isLocalhost = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';

            if (nameLower.endsWith('.pdf')) {
                const pdfContainer = document.getElementById('preview-modal-pdf-container');
                if (isMobile) {
                    // На мобильных устройствах рендерим через PDF.js на Canvas, обходя блокировку iframe Chrome Android
                    if (iframe) {
                        iframe.style.display = 'none';
                        iframe.src = '';
                    }
                    if (pdfContainer) pdfContainer.style.display = 'block';
                    if (fallback) fallback.style.display = 'none';
                    renderPdfOnCanvas(downloadUrl);
                } else {
                    if (pdfContainer) pdfContainer.style.display = 'none';
                    if (iframe) {
                        iframe.style.display = 'block';
                        iframe.src = downloadUrl;
                    }
                    if (fallback) fallback.style.display = 'none';
                }
            } else if (nameLower.endsWith('.txt')) {
                if (iframe) {
                    iframe.style.display = 'block';
                    iframe.src = downloadUrl;
                }
                if (fallback) fallback.style.display = 'none';
            } else if (nameLower.endsWith('.docx') || nameLower.endsWith('.doc') || nameLower.endsWith('.xlsx') || nameLower.endsWith('.xls') || nameLower.endsWith('.pptx')) {
                if (!isLocalhost) {
                    const fullDocUrl = window.location.origin + downloadUrl;
                    const officeViewerUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(fullDocUrl)}`;
                    if (iframe) {
                        iframe.style.display = 'block';
                        iframe.src = officeViewerUrl;
                    }
                    if (fallback) fallback.style.display = 'none';
                } else {
                    if (iframe) iframe.style.display = 'none';
                    if (fallback) fallback.style.display = 'flex';
                }
            } else {
                if (iframe) iframe.style.display = 'none';
                if (fallback) fallback.style.display = 'flex';
            }

            const newTabBtn = document.getElementById('preview-modal-newtab-btn');
            if (newTabBtn) {
                newTabBtn.onclick = () => {
                    window.open(downloadUrl, '_blank');
                };
            }

            if (modal) modal.style.display = 'flex';

            // Добавляем запись в историю браузера, чтобы аппаратный/жестовый свайп "Назад" закрывал модалку, а не уходил в Планнер
            if (!history.state || history.state.modal !== 'doc_preview') {
                history.pushState({ modal: 'doc_preview', docId: rawDocId }, '', window.location.href);
            }
        }

        async function loadDocumentTasks(docId, docTitle) {
            const listEl = document.getElementById('preview-modal-tasks-list');
            const badgeEl = document.getElementById('preview-modal-tasks-badge');
            if (!listEl) return;

            if (!docId && docId !== 0) {
                listEl.innerHTML = `
                    <div style="text-align: center; padding: 1.5rem 0.5rem; color: #94a3b8; font-size: 0.82rem;">
                        Внешняя ссылка (задачи не привязаны)
                    </div>
                `;
                if (badgeEl) badgeEl.textContent = "0";
                return;
            }

            listEl.innerHTML = `<div style="text-align: center; padding: 1rem; color: #64748b; font-size: 0.82rem;"><i class="fas fa-spinner fa-spin"></i> Загрузка задач...</div>`;

            try {
                const res = await fetch(`/api/documents/${docId}/tasks`);
                if (res.ok) {
                    const tasks = await res.json();
                    if (badgeEl) badgeEl.textContent = tasks.length;

                    if (!tasks || tasks.length === 0) {
                        listEl.innerHTML = `
                            <div style="text-align: center; padding: 1.5rem 0.5rem; color: #94a3b8; font-size: 0.82rem;">
                                <i class="fa-solid fa-list-check" style="font-size: 1.5rem; margin-bottom: 0.4rem; display: block; color: #cbd5e1;"></i>
                                Нет привязанных задач
                                <div style="margin-top: 0.6rem;">
                                    <button class="btn-action" style="background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; font-size: 0.75rem; padding: 3px 8px;" onclick="createTaskFromDoc(${docId}, '${escapeHtml(docTitle).replace(/'/g, "\\'")}')">
                                        + Создать задачу
                                    </button>
                                </div>
                            </div>
                        `;
                        return;
                    }

                    listEl.innerHTML = tasks.map(t => {
                        const isDone = t.status && t.status.includes('Выполнено');
                        const statusColor = isDone ? '#10b981' : '#f59e0b';
                        const statusBg = isDone ? '#ecfdf5' : '#fffbeb';
                        const statusBorder = isDone ? '#a7f3d0' : '#fde68a';

                        const tagsHtml = (t.tags || '').split(',').filter(x => x.trim()).map(tagStr => {
                            return `<span style="display: inline-block; background: #eff6ff; color: #2563eb; padding: 1px 5px; border-radius: 4px; font-size: 0.68rem; margin-right: 3px;">${escapeHtml(tagStr.trim())}</span>`;
                        }).join('');

                        return `
                            <div style="background: #f8fafc; border: 1px solid var(--docs-panel-border); border-radius: 6px; padding: 0.5rem 0.6rem; font-size: 0.8rem; display: flex; flex-direction: column; gap: 4px;">
                                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 4px;">
                                    <span style="font-weight: 700; color: #2563eb; font-size: 0.75rem;">${t.code || ('TSK-' + t.id)}</span>
                                    <span style="background: ${statusBg}; color: ${statusColor}; border: 1px solid ${statusBorder}; padding: 1px 5px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; white-space: nowrap;">
                                        ${t.status || 'В работе'}
                                    </span>
                                </div>
                                <div style="font-weight: 600; color: #0f172a; line-height: 1.25;">
                                    ${escapeHtml(t.title)}
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.73rem; color: #64748b; margin-top: 2px;">
                                    <span>👤 ${escapeHtml(t.assignee_name || 'Не назначен')}</span>
                                    <span>📅 ${escapeHtml(t.due_date_str || '—')}</span>
                                </div>
                                ${tagsHtml ? `<div style="margin-top: 2px;">${tagsHtml}</div>` : ''}
                                <div style="margin-top: 4px; text-align: right;">
                                    <a href="/tasks?task_id=${t.id}" target="_blank" style="font-size: 0.72rem; color: #2563eb; text-decoration: none; font-weight: 600;">
                                        Открыть в Планнере →
                                    </a>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            } catch (e) {
                console.error("Error loading doc tasks:", e);
                listEl.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 1rem; font-size: 0.8rem;">Ошибка загрузки</div>`;
            }
        }

        let currentPdfDoc = null;

        async function renderPdfOnCanvas(url) {
            const container = document.getElementById('preview-modal-pdf-container');
            const spinner = document.getElementById('pdf-viewer-spinner');
            const pagesWrapper = document.getElementById('pdf-pages-wrapper');
            if (!pagesWrapper) return;
            pagesWrapper.innerHTML = '';
            if (spinner) spinner.style.display = 'flex';

            try {
                if (typeof pdfjsLib === 'undefined') {
                    throw new Error('PDF.js library not loaded');
                }
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

                const loadingTask = pdfjsLib.getDocument({
                    url: url,
                    withCredentials: true
                });
                const pdf = await loadingTask.promise;
                currentPdfDoc = pdf;
                if (spinner) spinner.style.display = 'none';

                const numPages = pdf.numPages;
                const containerWidth = (container ? container.clientWidth : window.innerWidth) - 24;

                for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                    const page = await pdf.getPage(pageNum);
                    const unscaledViewport = page.getViewport({ scale: 1.0 });
                    const scale = Math.max(1.0, containerWidth / unscaledViewport.width);
                    const viewport = page.getViewport({ scale: scale });

                    const canvas = document.createElement('canvas');
                    canvas.style.display = 'block';
                    canvas.style.maxWidth = '100%';
                    canvas.style.height = 'auto';
                    canvas.style.borderRadius = '4px';
                    canvas.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';
                    canvas.style.background = '#ffffff';

                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    pagesWrapper.appendChild(canvas);
                    await page.render({ canvasContext: context, viewport: viewport }).promise;
                }
            } catch (err) {
                console.error('PDF.js rendering error:', err);
                if (spinner) spinner.style.display = 'none';
                // Fallback to opening directly or fallback link
                const fallback = document.getElementById('preview-modal-fallback');
                if (fallback) fallback.style.display = 'flex';
                if (container) container.style.display = 'none';
            }
        }

        function closeDocPreviewModal(fromHistory = false) {
            const modal = document.getElementById('doc-preview-modal');
            if (modal) modal.style.display = 'none';
            const iframe = document.getElementById('preview-modal-iframe');
            if (iframe) iframe.src = '';
            const pagesWrapper = document.getElementById('pdf-pages-wrapper');
            if (pagesWrapper) pagesWrapper.innerHTML = '';
            const pdfContainer = document.getElementById('preview-modal-pdf-container');
            if (pdfContainer) pdfContainer.style.display = 'none';
            currentPdfDoc = null;

            // Если закрытие вызвано кнопкой интерфейса, возвращаем состояние истории назад
            if (!fromHistory && history.state && history.state.modal === 'doc_preview') {
                history.back();
            }
        }

        /* --- Version History & Archive --- */
        async function openVersionsModal(docId, docTitle, event) {
            if (event) event.stopPropagation();
            if (currentFolderProtected && !await ensurePassword(true, currentFolderId)) return;

            currentVersionsDocId = docId;
            currentEditingDocName = docTitle;

            const titleEl = document.getElementById('versions-modal-doc-title');
            if (titleEl) titleEl.innerText = docTitle;

            const listContainer = document.getElementById('versions-list-container');
            if (listContainer) {
                listContainer.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--docs-text-muted);"><i class="fas fa-spinner fa-spin"></i> Загрузка истории версий...</div>';
            }

            const modal = document.getElementById('versions-modal');
            if (modal) modal.style.display = 'flex';

            try {
                const res = await fetch(`/api/documents/${docId}/versions`);
                const data = await res.json();

                if (data.status === 'success' && Array.isArray(data.data)) {
                    renderVersionsList(data.data, docId);
                } else {
                    if (listContainer) listContainer.innerHTML = '<div style="padding: 1rem; text-align: center; color: #ef4444;">Ошибка загрузки версий</div>';
                }
            } catch (e) {
                if (listContainer) listContainer.innerHTML = '<div style="padding: 1rem; text-align: center; color: #ef4444;">Ошибка соединения</div>';
            }
        }

        function closeVersionsModal() {
            const modal = document.getElementById('versions-modal');
            if (modal) modal.style.display = 'none';
            currentVersionsDocId = null;
        }

        function formatBytes(bytes, decimals = 1) {
            if (!+bytes) return '0 B';
            const k = 1024;
            const dm = decimals < 0 ? 0 : decimals;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
        }

        function renderVersionsList(versions, docId) {
            const container = document.getElementById('versions-list-container');
            if (!container) return;

            if (versions.length === 0) {
                container.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--docs-text-muted);">История версий пуста</div>';
                return;
            }

            let html = `
                <table style="width: 100%; border-collapse: collapse; font-size: 0.88rem; text-align: left;">
                    <thead>
                        <tr style="background: var(--docs-table-header-bg); border-bottom: 1px solid var(--docs-panel-border); color: var(--docs-text-muted); font-size: 0.78rem; text-transform: uppercase;">
                            <th style="padding: 0.6rem 0.8rem;">Версия</th>
                            <th style="padding: 0.6rem 0.8rem;">Дата</th>
                            <th style="padding: 0.6rem 0.8rem;">Автор</th>
                            <th style="padding: 0.6rem 0.8rem;">Комментарий</th>
                            <th style="padding: 0.6rem 0.8rem;">Размер</th>
                            <th style="padding: 0.6rem 0.8rem; text-align: right;">Действия</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            versions.forEach(v => {
                const currentBadge = v.is_current ? ' <span style="background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; border-radius:4px; padding:1px 5px; font-size:0.7rem; font-weight:600;">Текущая</span>' : '';
                const restoreBtn = !v.is_current ? `
                    <button class="btn-version-action" onclick="restoreVersion(${docId}, ${v.id}, ${v.version_number})" title="Откатить документ к этой версии" style="color: #0284c7; padding: 2px 6px; font-size: 0.78rem;">
                        <i class="fas fa-rotate-left"></i> Откат
                    </button>
                ` : '';

                html += `
                    <tr style="border-bottom: 1px solid var(--docs-panel-border); ${v.is_current ? 'background: rgba(37,99,235,0.03);' : ''}">
                        <td style="padding: 0.65rem 0.8rem; font-weight: 600; color: #2563eb;">v${v.version_number}${currentBadge}</td>
                        <td style="padding: 0.65rem 0.8rem; color: var(--docs-text-secondary); white-space: nowrap;">${escapeHtml(v.created_at)}</td>
                        <td style="padding: 0.65rem 0.8rem; font-weight: 500;">${escapeHtml(v.author_name)}</td>
                        <td style="padding: 0.65rem 0.8rem; color: var(--docs-text-muted); font-size: 0.82rem;">${escapeHtml(v.comment || '—')}</td>
                        <td style="padding: 0.65rem 0.8rem; color: var(--docs-text-secondary); font-size: 0.8rem;">${formatBytes(v.file_size)}</td>
                        <td style="padding: 0.65rem 0.8rem; text-align: right; white-space: nowrap;">
                            <a href="${v.download_url}" class="btn-version-action" style="padding: 2px 6px; font-size: 0.78rem; color: #3b82f6;" title="Скачать архивную копию">
                                <i class="fas fa-download"></i>
                            </a>
                            ${restoreBtn}
                        </td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;
            container.innerHTML = html;
        }

        async function restoreVersion(docId, versionId, versionNumber) {
            if (!confirm(`Вы действительно хотите откатить документ к версии v${versionNumber}?`)) return;

            const savedAuthor = localStorage.getItem('tectum_current_user_name') || 'Сотрудник';
            try {
                const res = await fetch(`/api/documents/${docId}/versions/${versionId}/restore`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...getFolderPasswordHeader()
                    },
                    body: JSON.stringify({ user_name: savedAuthor })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    showToast(data.message || 'Версия успешно восстановлена');
                    closeVersionsModal();
                    docsCache.clear();
                    loadDocuments(currentFolderId, document.getElementById('current-folder-name').innerText, false);
                } else {
                    alert('Ошибка отката версии: ' + data.message);
                }
            } catch (e) {
                alert('Ошибка соединения при откате версии');
            }
        }

        /* --- Save New Version Modal --- */
        async function openSaveVersionModal(docId, docTitle, event) {
            if (event) event.stopPropagation();
            if (currentFolderProtected && !await ensurePassword(true, currentFolderId)) return;

            currentEditingDocId = docId;
            currentEditingDocName = docTitle;

            const titleEl = document.getElementById('save-version-doc-title');
            if (titleEl) titleEl.innerText = docTitle;

            const fileInput = document.getElementById('version-file-input');
            if (fileInput) fileInput.value = '';

            const commentInput = document.getElementById('version-comment-input');
            if (commentInput) commentInput.value = '';

            await loadPlannerEmployeesOnce();
            populateEmployeeSelect('version-employee-select');

            const modal = document.getElementById('save-version-modal');
            if (modal) modal.style.display = 'flex';
        }

        function openSaveVersionModalFromHistory() {
            if (!currentVersionsDocId) return;
            const docId = currentVersionsDocId;
            const title = currentEditingDocName;
            closeVersionsModal();
            openSaveVersionModal(docId, title);
        }

        function closeSaveVersionModal() {
            const modal = document.getElementById('save-version-modal');
            if (modal) modal.style.display = 'none';
        }

        async function submitSaveNewVersion() {
            const fileInput = document.getElementById('version-file-input');
            const file = fileInput ? fileInput.files[0] : null;
            if (!file) {
                alert('Пожалуйста, выберите обновленный файл');
                return;
            }

            const empSelect = document.getElementById('version-employee-select');
            const author = empSelect ? empSelect.value.trim() : '';
            if (!author) {
                alert('Пожалуйста, укажите сотрудника, вносящего правки');
                return;
            }

            localStorage.setItem('tectum_current_user_name', author);
            const comment = document.getElementById('version-comment-input').value.trim();

            const btn = document.getElementById('btn-submit-save-version');
            const origText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохранение...';
            btn.disabled = true;

            const formData = new FormData();
            formData.append('file', file);
            formData.append('author_name', author);
            formData.append('comment', comment);

            try {
                const res = await fetch(`/api/documents/${currentEditingDocId}/save_version`, {
                    method: 'POST',
                    headers: getFolderPasswordHeader(),
                    body: formData
                });
                const data = await res.json();
                btn.innerHTML = origText;
                btn.disabled = false;

                if (data.status === 'success') {
                    showToast(data.message || 'Новая версия документа сохранена!');
                    closeSaveVersionModal();
                    docsCache.clear();
                    loadDocuments(currentFolderId, document.getElementById('current-folder-name').innerText, false);
                } else {
                    alert('Ошибка сохранения версии: ' + data.message);
                }
            } catch (e) {
                btn.innerHTML = origText;
                btn.disabled = false;
                alert('Ошибка соединения с сервером');
            }
        }

        /* --- Drag and Drop File Uploading to Current Folder --- */
        let dragCounter = 0;
        window.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            const overlay = document.getElementById('drag-overlay');
            if (overlay) overlay.classList.add('active');
        });

        window.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                const overlay = document.getElementById('drag-overlay');
                if (overlay) overlay.classList.remove('active');
            }
        });

        window.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        window.addEventListener('drop', async (e) => {
            e.preventDefault();
            dragCounter = 0;
            const overlay = document.getElementById('drag-overlay');
            if (overlay) overlay.classList.remove('active');

            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                for (let i = 0; i < e.dataTransfer.files.length; i++) {
                    await uploadFileDirectly(e.dataTransfer.files[i]);
                }
            }
        });

        /* ==========================================================
           THEME MANAGEMENT (LIGHT ONLY)
           ========================================================== */
        function initTheme() {
            applyTheme("light");
        }

        function toggleDocsTheme() {
            applyTheme("light");
        }

        function applyTheme(theme) {
            document.documentElement.setAttribute("data-theme", "light");
            localStorage.setItem("theme", "light");
        }

        window.addEventListener('DOMContentLoaded', () => {
            initTheme();
            initDocsUserSession();

            // Восстановление позиции папки при обновлении страницы (F5)
            const hash = window.location.hash ? window.location.hash.substring(1) : null;
            const savedFolderId = hash || sessionStorage.getItem('last_docs_folder_id');
            const savedFolderName = sessionStorage.getItem('last_docs_folder_name') || 'Папка';
            const savedProtected = sessionStorage.getItem('last_docs_folder_protected') === '1';

            if (savedFolderId) {
                expandedFolders.add(savedFolderId);
                loadDocuments(savedFolderId, savedFolderName, false, null, savedProtected);
            } else {
                loadDocuments();
            }
            loadSidebarTree();
        });

        // Обработка жеста / кнопки смартфона "Назад" (Swipe Back)
        window.addEventListener('popstate', (event) => {
            const previewModal = document.getElementById('doc-preview-modal');
            if (previewModal && previewModal.style.display === 'flex') {
                closeDocPreviewModal(true);
                return;
            }

            const versionsModal = document.getElementById('versions-modal');
            if (versionsModal && versionsModal.style.display === 'flex') {
                closeVersionsModal();
                return;
            }

            // Навигация по папкам при свайпе назад
            if (isSearchActive) {
                clearSearch();
                return;
            }

            const hash = window.location.hash ? window.location.hash.substring(1) : null;
            if (hash && hash !== currentFolderId) {
                const savedFolderName = sessionStorage.getItem('last_docs_folder_name') || 'Папка';
                loadDocuments(hash, savedFolderName, false);
            } else if (!hash && currentFolderId) {
                navigateToRootFolder();
            }
        });

        // Клавиатурный шорткат Ctrl+K / Cmd+K для быстрого перехода к поиску
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                const searchEl = document.getElementById('search-input');
                if (searchEl) {
                    searchEl.focus();
                    searchEl.select();
                }
            }
        });
    </script>
    <script src="/static/js/version_guard.js?v=20261101_v6"></script>
    <script src="/static/js/splash.js?v=20261101_v6"></script>
    <script src="/static/js/toast.js?v=20261101_v6"></script>
    <script src="/static/js/workshop_switcher.js?v=20261103_v7">

// HTMX Seamless Navigation Support (Tectum Law 6)
document.addEventListener('htmx:afterSwap', function(evt) {
    if (typeof loadFolders === 'function') loadFolders();
    if (typeof loadDocuments === 'function') loadDocuments(currentFolderId);
});
