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

// Sync-age ticker — counts up the LAST SYNC TIME card from the actual last
// Firestore push (APP.state.lastSyncTime, set in devices.js). This used to be
// a plain clock that printed the current time every second regardless of
// whether any data had actually arrived, so it always looked "live" even when
// the listener had gone silent for days.
setInterval(() => {
    if (typeof APP.updateSyncDisplay === 'function') APP.updateSyncDisplay();
}, 1000);
