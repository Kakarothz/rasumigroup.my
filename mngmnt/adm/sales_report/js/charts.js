// ─────────────────────────────────────────────────────────────
// charts.js — System resource charts (Chart.js)
//
// History arrays: charts show real-time trend when agent pushes
// cpu_history / ram_history / disk_history / net_history arrays
// to the device Firestore doc (each array = last 24 readings).
// Falls back to baseline-anchored shape if arrays not present.
// Call APP.updateCharts(dev) whenever a new device is selected.
// ─────────────────────────────────────────────────────────────

APP._chartInstances = {};

APP.initCharts = function () {
    if (typeof Chart === 'undefined') return;

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
            x: { display: false },
            y: { display: false, min: 0, max: 100 }
        },
        elements: { point: { radius: 0 }, line: { tension: 0.4, borderWidth: 2 } }
    };

    const labels = Array.from({ length: 24 }, (_, i) => i);

    // Parse percentage from string or number
    function parsePct(val) {
        if (val == null) return null;
        if (typeof val === 'number') return Math.min(100, Math.max(0, Math.round(val)));
        const n = parseInt(String(val).replace('%', '').trim());
        return isNaN(n) ? null : Math.min(100, Math.max(0, n));
    }

    // Generate baseline-anchored history: realistic spread around a base value
    // Uses crypto.getRandomValues for determinism per call (still visual only)
    function buildHistory(length, base, variance) {
        const bytes = new Uint8Array(length);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, b => {
            const offset = ((b / 255) * variance * 2) - variance;
            return Math.min(100, Math.max(0, Math.round(base + offset)));
        });
    }

    function makeChart(canvasId, color, bgColor, data, yMax) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return null;
        const opts = { ...commonOptions };
        if (yMax !== undefined) opts.scales = { y: { display: false, min: 0, max: yMax } };
        const instance = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets: [{ data, borderColor: color, backgroundColor: bgColor, fill: true }] },
            options: opts
        });
        APP._chartInstances[canvasId] = instance;
        return instance;
    }

    // Init with neutral fallback data — APP.updateCharts() will replace with real values
    makeChart('cpuChart',  '#10B981', 'rgba(16,185,129,0.1)',  buildHistory(24, 20, 10));
    makeChart('ramChart',  '#B200FF', 'rgba(178,0,255,0.1)',   buildHistory(24, 50, 5));
    makeChart('diskChart', '#3B82F6', 'rgba(59,130,246,0.1)',  buildHistory(24, 51, 1));
    makeChart('netChart',  '#F59E0B', 'rgba(245,158,11,0.1)',  buildHistory(24, 12, 8), 30);
};

// Call this every time a device panel opens — wires charts to real Firebase data
APP.updateCharts = function (dev) {
    if (typeof Chart === 'undefined' || !APP._chartInstances) return;

    function parsePct(val) {
        if (val == null) return null;
        if (typeof val === 'number') return Math.min(100, Math.max(0, Math.round(val)));
        const n = parseInt(String(val).replace('%', '').trim());
        return isNaN(n) ? null : Math.min(100, Math.max(0, n));
    }

    function buildHistory(length, base, variance) {
        const bytes = new Uint8Array(length);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, b => {
            const offset = ((b / 255) * variance * 2) - variance;
            return Math.min(100, Math.max(0, Math.round(base + offset)));
        });
    }

    // Use agent-pushed history arrays if available, otherwise build from current reading
    const cpuBase  = parsePct(dev.cpu_usage)  ?? 20;
    const ramBase  = parsePct(dev.ram_usage)  ?? 50;
    const diskBase = parsePct(dev.disk_usage) ?? 51;
    const netBase  = (typeof dev.ping_ms === 'number') ? dev.ping_ms : 12;

    const cpuData  = (dev.cpu_history  && dev.cpu_history.length  === 24) ? dev.cpu_history  : buildHistory(24, cpuBase,  10);
    const ramData  = (dev.ram_history  && dev.ram_history.length  === 24) ? dev.ram_history  : buildHistory(24, ramBase,  5);
    const diskData = (dev.disk_history && dev.disk_history.length === 24) ? dev.disk_history : buildHistory(24, diskBase, 1);
    const netData  = (dev.net_history  && dev.net_history.length  === 24) ? dev.net_history  : buildHistory(24, netBase,  4);

    // Ensure last point always reflects current live reading
    if (cpuData.length  === 24) cpuData[23]  = cpuBase;
    if (ramData.length  === 24) ramData[23]  = ramBase;
    if (diskData.length === 24) diskData[23] = diskBase;
    if (netData.length  === 24) netData[23]  = netBase;

    function updateChart(id, data) {
        const chart = APP._chartInstances[id];
        if (!chart) return;
        chart.data.datasets[0].data = data;
        chart.update('none'); // skip animation on update for responsiveness
    }

    updateChart('cpuChart',  cpuData);
    updateChart('ramChart',  ramData);
    updateChart('diskChart', diskData);
    updateChart('netChart',  netData);
};
