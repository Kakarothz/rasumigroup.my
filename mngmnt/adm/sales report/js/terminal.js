// ─────────────────────────────────────────────────────────────
// terminal.js — CLI terminal input handler and command processor
// ─────────────────────────────────────────────────────────────
APP.initTerminal = function () {
    const D = APP.DOM;
    if (!D.terminalInput) return;

    D.terminalInput.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        const cmdText = D.terminalInput.value.trim().toLowerCase();
        if (!cmdText) return;
        if (!APP.state.activeDeviceId) return logToTerminal('ERROR: No target node selected.', 'error');

        D.terminalInput.value = '';

        const localCommands = ['help', 'clear'];
        const isLocal       = localCommands.includes(cmdText.split(' ')[0]);

        if (!isLocal && APP.isNodeOffline(APP.state.activeDeviceId)) {
            logToTerminal(`root@spooler:~# ${cmdText}`);
            logToTerminal(`[SYSTEM] Unsuccessful: Device [${APP.state.activeDeviceId}] is OFFLINE. Protocol rejected.`, 'error');
            return;
        }

        await APP.processTerminalCommand(cmdText);
    });
};

APP.processTerminalCommand = async function (cmdRaw) {
    logToTerminal(`root@spooler:~# ${cmdRaw}`, 'info');
    const args = cmdRaw.split(' ').filter(x => x);
    if (args.length === 0) return;
    const cmd = args[0].toLowerCase();

    const helpText = `
[SPOOLER COMMAND DIRECTORY]
help                          - Display this English help manual
clear                         - Flush terminal console history
ping <node_id>                - Wake up node UI / Heartbeat check
restart <node_id>             - Force application restart (Soft fix)
schedule <id> <H:i>         - Update Daily Report Trigger Time (e.g. 16:50)
time <id> <H:i>             - Alias for schedule

[ADVANCED ARSENAL]
sysinfo <node_id>             - Request detailed hardware/OS telemetry
sweep <node_id>               - Clear printed file cache
kill <node_id>                - Remote Emergency Shutdown
uninstall <node_id>           - Permanent Decommission (Remove Startup)
generate report on <date>     - Generate specific date (e.g. 10/6/26)
generate report on <d> until <d> - Generate date range

Note: If <node_id> is omitted, [ACTIVE NODE] will be targeted.`;

    let targetNode = (args.length > 1 && !['schedule'].includes(cmd))
        ? args[1].toUpperCase()
        : APP.state.activeDeviceId;

    if (cmd === 'schedule' && args.length === 4) targetNode = args[1].toUpperCase();

    switch (cmd) {
        case 'help':
            logToTerminal(helpText, 'system');
            break;

        case 'clear':
            APP.DOM.logTerminal.innerHTML = '';
            logToTerminal('[SYSTEM] Local terminal cache cleared.', 'success');
            if (targetNode) {
                APP.db.collection('devices').doc(targetNode).update({
                    live_logs: firebase.firestore.FieldValue.delete()
                }).then(() => {
                    logToTerminal(`[SYSTEM] Live logs for [${targetNode}] cleared from Cloud.`, 'system');
                }).catch(err => {
                    logToTerminal(`[ERROR] Cloud Purge Failed: ${err.message}`, 'error');
                });
            }
            break;

        case 'ping':
        case 'refresh':
            if (!targetNode) return logToTerminal('ERROR: No target node selected.', 'error');
            APP.pushCommandWithNode(targetNode, 'REFRESH_UI', '');
            break;

        case 'restart':
            if (!targetNode) return logToTerminal('ERROR: No target node selected.', 'error');
            APP.pushCommandWithNode(targetNode, 'RESTART_AGENT', '');
            break;

        case 'print':
            if (!targetNode) return logToTerminal('ERROR: No target node selected.', 'error');
            APP.pushCommandWithNode(targetNode, 'FORCE_REPORT', '');
            logToTerminal(`[SYSTEM] Manual report generation triggered for [${targetNode}].`, 'success');
            break;

        case 'sysinfo':
            if (!targetNode) return logToTerminal('ERROR: No target node selected.', 'error');
            APP.pushCommandWithNode(targetNode, 'GET_SYSINFO', '');
            logToTerminal(`[SYSTEM] Telemetry request dispatched to [${targetNode}]...`, 'success');
            break;

        case 'sweep':
            if (!targetNode) return logToTerminal('ERROR: No target node selected.', 'error');
            APP.pushCommandWithNode(targetNode, 'CLEAR_CACHE', '');
            logToTerminal(`[SYSTEM] Cache clear command sent to [${targetNode}].`, 'success');
            break;

        case 'shutdown': {
            if (!targetNode) return logToTerminal('ERROR: No target node selected.', 'error');
            const confirmedShut = await APP.showCyberConfirm("REMOTE SHUTDOWN", `DANGER: Initiating remote shutdown for [${targetNode}]. It will not restart until manual intervention. Proceed?`, "hazard");
            if (!confirmedShut) return;
            APP.pushCommandWithNode(targetNode, 'SHUTDOWN_AGENT', '');
            break;
        }

        case 'kill': {
            if (!targetNode) return logToTerminal('ERROR: No target node selected.', 'error');
            const confirmedKill = await APP.showCyberConfirm("EMERGENCY KILL", `Execute remote process termination for [${targetNode}]? Agent will stop immediately.`, "hazard");
            if (!confirmedKill) return;
            APP.pushCommandWithNode(targetNode, 'KILL_AGENT', '');
            APP.db.collection('devices').doc(targetNode).update({ status: 'offline' });
            break;
        }

        case 'uninstall': {
            const confirmedUn = await APP.showCyberConfirm("SYSTEM DECOMMISSION", `DANGER: This will PERMANENTLY remove the agent from [${targetNode}]. Proceed?`, "danger");
            if (confirmedUn) APP.pushCommandWithNode(targetNode, 'UNINSTALL_AGENT', '');
            break;
        }

        case 'schedule':
        case 'time': {
            const tNode    = (args.length === 3) ? args[1].toUpperCase() : APP.state.activeDeviceId;
            const tNewTime = (args.length === 3) ? args[2] : (args.length === 2 ? args[1] : null);

            if (!tNode || !tNewTime) return logToTerminal('ERROR: Invalid Syntax. Usage: schedule <HH:MM> or schedule <node_id> <HH:MM>', 'error');
            if (!/^\d{2}:\d{2}$/.test(tNewTime)) return logToTerminal('ERROR: Invalid Time Format. Use HH:MM (e.g., 16:50)', 'error');

            APP.pushCommandWithNode(tNode, 'UPDATE_REPORT_TIME', tNewTime);
            break;
        }

        case 'generate':
            if (args[1] === 'report' && args[2] === 'on') {
                const gNode = APP.state.activeDeviceId;
                if (!gNode) return logToTerminal('ERROR: No target node selected.', 'error');
                const payloadStr = args.slice(3).join(' ');
                if (!payloadStr) return logToTerminal('ERROR: Invalid Syntax. Usage: generate report on 10/6/26', 'error');
                APP.pushCommandWithNode(gNode, 'FORCE_REPORT', payloadStr);
                logToTerminal(`[SYSTEM] Manual report generation triggered for [${gNode}] with payload: ${payloadStr}`, 'success');
            } else {
                logToTerminal(`INVALID DIRECTIVE: Usage 'generate report on [date]'`, 'error');
            }
            break;

        default:
            logToTerminal(`INVALID DIRECTIVE: '${cmd}'. Type 'help' for tactical guidance.`, 'error');
    }
};
