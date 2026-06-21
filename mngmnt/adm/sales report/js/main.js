// ─────────────────────────────────────────────────────────────
// main.js — Entry point: bootstraps all modules after DOM ready
// Load order in index.html must match:
//   config → state → dom → utils → modal → alerts → navigation →
//   auth → devices → commands → schedule → profile →
//   admin-settings → terminal → charts → main
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    APP.initDOM();
    APP.initNavigation();
    APP.setupTacticalInputs();
    APP.initScheduleSync();
    APP.initCommandButtons();
    APP.initProfile();
    APP.initAdminSettings();
    APP.initTerminal();
    APP.initCharts();
    APP.initAuth(); // Last — starts Firestore listeners after login
});

// Stale device ticker — re-render if a device crosses the 90s offline threshold
setInterval(() => {
    if (!APP.DOM || !APP.DOM.dashboardContainer || APP.DOM.dashboardContainer.classList.contains('hidden')) return;
    const now = Date.now();
    const anyStale = APP.state.currentDevices.some(d => {
        if (!d.last_seen) return false;
        let t = 0;
        if (typeof d.last_seen.toMillis === 'function') t = d.last_seen.toMillis();
        else if (d.last_seen.seconds) t = d.last_seen.seconds * 1000;
        else t = Date.parse(d.last_seen);
        return ((now - t) < 90000) !== ((now - t) < 95000);
    });
    if (anyStale) APP.renderDevices();
}, 10000);

// Clock tick — keeps metric sync timestamp current
setInterval(() => {
    if (APP.DOM && APP.DOM.metricSync) {
        APP.DOM.metricSync.innerText = new Date().toLocaleTimeString();
    }
}, 1000);
