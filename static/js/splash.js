/**
 * Tectum Enterprise — Mobile Core, Splash Screen & Unified App Navigation
 */
(function () {
  // 1. PWA Service Worker Registration
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js')
        .then((reg) => console.log('[PWA] ServiceWorker registered with scope:', reg.scope))
        .catch((err) => console.warn('[PWA] ServiceWorker registration failed:', err));
    });
  }

  // Determine current active section
  const currentPath = window.location.pathname;
  let activeTab = 'home';
  if (currentPath.includes('tasks') || currentPath.includes('planner')) {
    activeTab = 'tasks';
  } else if (currentPath.includes('checklists')) {
    activeTab = 'checklists';
  } else if (currentPath.includes('docs')) {
    activeTab = 'docs';
  }

  // 2. Inject Splash Screen into DOM if not present
  function ensureSplashScreen() {
    if (document.getElementById('tectum-splash-screen')) return;

    const splash = document.createElement('div');
    splash.id = 'tectum-splash-screen';
    splash.innerHTML = `
      <div class="tectum-splash-content">
        <div class="tectum-splash-logo-wrap">
          <img src="/static/img/tectum_animated_logo.svg" alt="Tectum Engineering" width="380" height="307" />
        </div>
        <div class="tectum-splash-loader">
          <div class="tectum-splash-progress">
            <div class="tectum-splash-progress-bar"></div>
          </div>
          <div class="tectum-splash-status" id="tectum-splash-status-text">Инициализация Tectum Enterprise...</div>
        </div>
      </div>
    `;
    document.body.prepend(splash);
  }

  // 3. Inject Unified Mobile Bottom Navigation & App Hub Drawer
  function ensureMobileNavigation() {
    if (document.querySelector('.tectum-mobile-bottom-nav')) return;

    // Bottom Navigation Bar
    const nav = document.createElement('nav');
    nav.className = 'tectum-mobile-bottom-nav';
    nav.innerHTML = `
      <a href="/" class="tectum-nav-item ${activeTab === 'home' ? 'active' : ''}" id="nav-item-home">
        <i class="fas fa-industry"></i>
        <span>Смена</span>
      </a>
      <a href="/tasks" class="tectum-nav-item ${activeTab === 'tasks' ? 'active' : ''}" id="nav-item-tasks">
        <i class="fas fa-tasks"></i>
        <span>Планнер</span>
      </a>
      <a href="/checklists" class="tectum-nav-item ${activeTab === 'checklists' ? 'active' : ''}" id="nav-item-checklists">
        <i class="fas fa-clipboard-check"></i>
        <span>Чек-листы</span>
      </a>
      <a href="/docs" class="tectum-nav-item ${activeTab === 'docs' ? 'active' : ''}" id="nav-item-docs">
        <i class="fas fa-book"></i>
        <span>База знаний</span>
      </a>
      <div class="tectum-nav-item" id="nav-item-hub" onclick="window.toggleTectumHubDrawer(true)">
        <i class="fas fa-th"></i>
        <span>Модули</span>
      </div>
    `;
    document.body.appendChild(nav);

    // Hub Drawer Overlay & Drawer Sheet
    const drawerOverlay = document.createElement('div');
    drawerOverlay.id = 'tectum-hub-drawer-overlay';
    drawerOverlay.onclick = () => window.toggleTectumHubDrawer(false);

    const drawer = document.createElement('div');
    drawer.id = 'tectum-hub-drawer';
    drawer.innerHTML = `
      <div class="tectum-drawer-handle"></div>
      <div class="tectum-drawer-header">
        <div class="tectum-drawer-title">
          <span>TECTUM</span> Модули завода
        </div>
        <button type="button" class="btn-close" style="border:none;background:none;font-size:18px;color:#64748b;cursor:pointer;" onclick="window.toggleTectumHubDrawer(false)">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="tectum-drawer-grid">
        <a href="/" class="tectum-hub-card">
          <div class="tectum-hub-icon-wrap" style="background: linear-gradient(135deg, #950405, #bf2319);">
            <i class="fas fa-industry"></i>
          </div>
          <div class="tectum-hub-card-title">Сменный рапорт</div>
          <div class="tectum-hub-card-subtitle">Выпуск и сырье</div>
        </a>

        <a href="/tasks" class="tectum-hub-card">
          <div class="tectum-hub-icon-wrap" style="background: linear-gradient(135deg, #2563eb, #3b82f6);">
            <i class="fas fa-tasks"></i>
          </div>
          <div class="tectum-hub-card-title">Планнер задач</div>
          <div class="tectum-hub-card-subtitle">3 горизонта</div>
        </a>

        <a href="/checklists" class="tectum-hub-card">
          <div class="tectum-hub-icon-wrap" style="background: linear-gradient(135deg, #059669, #10b981);">
            <i class="fas fa-clipboard-check"></i>
          </div>
          <div class="tectum-hub-card-title">Чек-листы</div>
          <div class="tectum-hub-card-subtitle">Оборудование</div>
        </a>

        <a href="/docs" class="tectum-hub-card">
          <div class="tectum-hub-icon-wrap" style="background: linear-gradient(135deg, #d97706, #f59e0b);">
            <i class="fas fa-book"></i>
          </div>
          <div class="tectum-hub-card-title">База знаний</div>
          <div class="tectum-hub-card-subtitle">Регламенты</div>
        </a>

        <a href="/qcd" class="tectum-hub-card">
          <div class="tectum-hub-icon-wrap" style="background: linear-gradient(135deg, #7c3aed, #8b5cf6);">
            <i class="fas fa-microscope"></i>
          </div>
          <div class="tectum-hub-card-title">День качества</div>
          <div class="tectum-hub-card-subtitle">СКК и брак</div>
        </a>

        <a href="/lkc" class="tectum-hub-card">
          <div class="tectum-hub-icon-wrap" style="background: linear-gradient(135deg, #0284c7, #38bdf8);">
            <i class="fas fa-vial"></i>
          </div>
          <div class="tectum-hub-card-title">Лаборатория ЛКЦ</div>
          <div class="tectum-hub-card-subtitle">Анализы</div>
        </a>

        <a href="/analytics" class="tectum-hub-card">
          <div class="tectum-hub-icon-wrap" style="background: linear-gradient(135deg, #0f172a, #334155);">
            <i class="fas fa-chart-line"></i>
          </div>
          <div class="tectum-hub-card-title">Аналитика</div>
          <div class="tectum-hub-card-subtitle">Дашборды</div>
        </a>

        <a href="/admin" class="tectum-hub-card">
          <div class="tectum-hub-icon-wrap" style="background: linear-gradient(135deg, #475569, #64748b);">
            <i class="fas fa-sliders-h"></i>
          </div>
          <div class="tectum-hub-card-title">Админ-панель</div>
          <div class="tectum-hub-card-subtitle">Справочники</div>
        </a>
      </div>
    `;

    document.body.appendChild(drawerOverlay);
    document.body.appendChild(drawer);
  }

  // 4. Hub Drawer Toggle Function
  window.toggleTectumHubDrawer = function (show) {
    const overlay = document.getElementById('tectum-hub-drawer-overlay');
    const drawer = document.getElementById('tectum-hub-drawer');
    if (!overlay || !drawer) return;

    if (show) {
      overlay.classList.add('active');
      drawer.classList.add('active');
      document.body.style.overflow = 'hidden';
    } else {
      overlay.classList.remove('active');
      drawer.classList.remove('active');
      document.body.style.overflow = '';
    }
  };

  // 5. Hide Splash Screen with smooth transition
  let splashHidden = false;
  window.hideSplashScreen = function (statusMessage) {
    if (splashHidden) return;
    const splash = document.getElementById('tectum-splash-screen');
    const statusText = document.getElementById('tectum-splash-status-text');
    if (statusMessage && statusText) {
      statusText.innerText = statusMessage;
    }

    if (splash) {
      setTimeout(() => {
        splash.classList.add('hidden');
        splashHidden = true;
        setTimeout(() => {
          if (splash.parentNode) {
            splash.parentNode.removeChild(splash);
          }
        }, 600);
      }, 350);
    }
  };

  // Auto initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureSplashScreen();
      ensureMobileNavigation();
    });
  } else {
    ensureSplashScreen();
    ensureMobileNavigation();
  }

  // Safety fallback: ensure splash screen automatically fades out within 3.5s max
  window.addEventListener('load', () => {
    setTimeout(() => {
      window.hideSplashScreen();
    }, 1200);
  });
})();
