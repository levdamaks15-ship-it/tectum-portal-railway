/**
 * Tectum Enterprise Portal — Declarative SPA Router & Route Guard (router.js)
 * @description Centralized URL manifest, capability-based navigation guards,
 * deep-linking support, and role-based fallback redirects.
 * @established 2026-11-03
 */
(function (window, document) {
    'use strict';

    // 1. Declarative Route Manifest with Capability Requirements
    const ROUTE_MANIFEST = {
        'production': {
            path: '#production',
            canonicalPath: '#/workshop/shift-report',
            title: 'Рапорт мастера',
            requiredPermission: 'shift.report.edit',
            tabId: 'production',
            containerId: 'production-tab',
            buttonId: 'tab-btn-production'
        },
        'crew-plans': {
            path: '#crew-plans',
            canonicalPath: '#/workshop/crew-plans',
            title: 'Выполнение плана бригадами',
            requiredPermission: 'shift.crew_plan.view',
            tabId: 'crew-plans',
            containerId: 'crew-plans-tab',
            buttonId: 'tab-btn-crew-plans'
        },
        'summary': {
            path: '#summary',
            canonicalPath: '#/management/production-summary',
            title: 'Сводка производства',
            requiredPermission: 'kpi.summary.view',
            tabId: 'summary',
            containerId: 'summary-tab',
            buttonId: 'tab-btn-summary'
        },
        'downtimes': {
            path: '#downtimes',
            canonicalPath: '#/workshop/downtime-logger',
            title: 'Журнал простоев',
            requiredPermission: 'shift.downtime.record',
            tabId: 'downtimes',
            containerId: 'downtimes-tab',
            buttonId: 'tab-btn-downtimes'
        },
        'tech-downtimes': {
            path: '#tech-downtimes',
            canonicalPath: '#/engineering/downtime-audit',
            title: 'База простоев',
            requiredPermission: 'downtimes.audit.view',
            tabId: 'tech-downtimes',
            containerId: 'tech-downtimes-tab',
            buttonId: 'tab-btn-tech-downtimes'
        },
        'daily-report': {
            path: '#daily-report',
            canonicalPath: '#/management/monthly-report',
            title: 'Месячная сводка выработки',
            requiredPermission: 'kpi.summary.view',
            tabId: 'daily-report',
            containerId: 'daily-report-tab',
            buttonId: 'tab-btn-daily-report'
        }
    };

    // Aliases to support canonical URLs and legacy hashes seamlessly
    const ROUTE_ALIASES = {
        '#production': 'production',
        '#/workshop/shift-report': 'production',
        '#crew-plans': 'crew-plans',
        '#/workshop/crew-plans': 'crew-plans',
        '#summary': 'summary',
        '#/management/production-summary': 'summary',
        '#downtimes': 'downtimes',
        '#/workshop/downtime-logger': 'downtimes',
        '#tech-downtimes': 'tech-downtimes',
        '#/engineering/downtime-audit': 'tech-downtimes',
        '#daily-report': 'daily-report',
        '#/management/monthly-report': 'daily-report'
    };

    // Designated default home tab for each role
    const ROLE_HOME_TABS = {
        'master': 'production',
        'technologist': 'tech-downtimes',
        'director': 'crew-plans',
        'mechanic': 'downtimes',
        'production_head': 'production',
        'tech_director': 'tech-downtimes',
        'admin': 'production',
        'portal': 'portal'
    };

    function getUserHomeTab() {
        const role = (window.currentUser?.role || '').toLowerCase();
        const designated = ROLE_HOME_TABS[role];
        if (designated && designated !== 'portal') {
            const route = ROUTE_MANIFEST[designated];
            if (route && window.can && window.can(route.requiredPermission)) {
                return designated;
            }
        }
        // Fallback scan: first allowed tab
        for (const [tabId, r] of Object.entries(ROUTE_MANIFEST)) {
            if (window.can && window.can(r.requiredPermission)) {
                return tabId;
            }
        }
        return 'production';
    }

    /**
     * Resolves tabId from an arbitrary hash string (supports legacy and canonical hashes)
     */
    function resolveTabIdFromHash(rawHash) {
        if (!rawHash) return null;
        let clean = rawHash.trim();
        if (!clean.startsWith('#')) clean = '#' + clean;
        if (ROUTE_ALIASES[clean]) return ROUTE_ALIASES[clean];
        const stripped = clean.replace(/^#\/?/, '').replace(/\/$/, '');
        if (ROUTE_MANIFEST[stripped]) return stripped;
        return null;
    }

    /**
     * Navigation Interceptor & Route Guard
     */
    function navigateToTab(tabId, event) {
        if (event) {
            if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                event.preventDefault();
            } else {
                return;
            }
        }

        const route = ROUTE_MANIFEST[tabId];
        if (!route) {
            console.warn(`[Router] Unknown route ${tabId}, redirecting to home.`);
            return navigateToTab(getUserHomeTab());
        }

        // Capability Check via PBAC
        if (typeof window.can === 'function' && window.currentUser) {
            if (!window.can(route.requiredPermission)) {
                console.warn(`[RouteGuard] Access to ${tabId} denied for user ${window.currentUser.name} (${window.currentUser.role}).`);
                if (typeof window.showToast === 'function') {
                    window.showToast("У вас нет доступа к этому разделу", "warning");
                }
                const homeTab = getUserHomeTab();
                if (homeTab !== tabId) {
                    return navigateToTab(homeTab);
                }
                return;
            }
        }

        // Update history hash gracefully
        sessionStorage.setItem('active_tab', tabId);
        if (window.location.hash !== route.path && window.location.hash !== route.canonicalPath) {
            history.replaceState(null, '', route.path);
        }

        // Delegate to UI activator in app.js
        if (typeof window.activateTabUI === 'function') {
            window.activateTabUI(tabId);
        }
    }

    // Hashchange listener for browser back/forward and deep linking
    window.addEventListener('hashchange', function () {
        if (!window.currentUser) return;
        const targetTab = resolveTabIdFromHash(window.location.hash);
        if (targetTab) {
            navigateToTab(targetTab);
        }
    });

    // Public Router API
    window.AppRouter = {
        ROUTE_MANIFEST,
        ROUTE_ALIASES,
        ROLE_HOME_TABS,
        getUserHomeTab,
        resolveTabIdFromHash,
        navigateToTab
    };

    window.navigateToTab = navigateToTab;

})(window, document);
