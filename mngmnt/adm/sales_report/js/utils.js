// ─────────────────────────────────────────────────────────────
// utils.js — Shared utility functions
// ─────────────────────────────────────────────────────────────
window.logToTerminal = function (msg, type = 'system') {
    const terminal = APP.DOM && APP.DOM.logTerminal;
    if (!terminal) return;
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.innerText = msg;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
};

APP.formatLastActive = function (ts) {
    const diff = Date.now() - ts.toMillis();
    if (diff < 60000) return 'JUST NOW';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm AGO';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h AGO';
    return new Date(ts.toMillis()).toLocaleDateString();
};
