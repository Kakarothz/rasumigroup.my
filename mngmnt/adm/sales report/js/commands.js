// ─────────────────────────────────────────────────────────────
// commands.js — Permission checks, command dispatcher, button bindings
// ─────────────────────────────────────────────────────────────
APP.ACTION_PERM_MAP = {
    'RESTART_AGENT':   'can_restart',
    'FORCE_REPORT':    'can_print',
    'REFRESH_UI':      'can_refresh',
    'PING':            'can_refresh',
    'GET_SYSINFO':     'can_sysinfo',
    'CLEAR_CACHE':     'can_sweep',
    'KILL_AGENT':      'can_kill',
    'SHUTDOWN_AGENT':  'can_kill',
    'UNINSTALL_AGENT': 'can_uninstall',
    'UPDATE_SCHEDULE': 'can_schedule'
};

APP.checkPermission = function (perm) {
    const data = APP.state.currentAdminData;
    if (data?.role === 'super_admin') return true;
    return data?.permissions?.[perm] === true;
};

APP.isNodeOffline = function (id) {
    const deviceData = APP.state.currentDevices.find(d => d.id === id);
    if (!deviceData) return true;
    if (deviceData.status === 'hibernate') return false;

    const lastSeen = deviceData.last_seen;
    let LSTime = 0;

    if (lastSeen) {
        if (typeof lastSeen.toMillis === 'function') LSTime = lastSeen.toMillis();
        else if (lastSeen.seconds) LSTime = lastSeen.seconds * 1000;
        else LSTime = Date.parse(lastSeen);
    }

    if (!LSTime || isNaN(LSTime)) return true;
    return (Date.now() - LSTime > 90000);
};

APP.pushCommand = function (actionName, requiredPerm = null) {
    if (!APP.state.activeDeviceId) {
        logToTerminal('[ERROR] No node selected. Click a node card first.', 'error');
        return;
    }

    if (APP.isNodeOffline(APP.state.activeDeviceId)) {
        logToTerminal(`[SYSTEM] Device [${APP.state.activeDeviceId}] is OFFLINE. Command queued and will execute when node reconnects.`, 'warning');
    }

    const permToVerify = requiredPerm || APP.ACTION_PERM_MAP[actionName];
    if (permToVerify && !APP.checkPermission(permToVerify)) return;

    logToTerminal(`[CMD] Routing directive '${actionName}' to Node [${APP.state.activeDeviceId}]...`, 'system');

    APP.db.collection('commands').doc(APP.state.activeDeviceId).set({
        action:    actionName,
        payload:   "",
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        status:    "pending"
    }).then(() => {
        logToTerminal(`[CMD] ${actionName} -> UPLOADED TO CLOUD. Awaiting node fetch!`, 'success');
        if (APP.state.currentLoggedUser) {
            APP.db.collection('admin_users').doc(APP.state.currentLoggedUser.email).update({
                cmds_sent: firebase.firestore.FieldValue.increment(1)
            });
        }
    }).catch(err => {
        logToTerminal(`[ERROR] Command dropped: ${err.message}`, 'error');
    });
};

APP.pushCommandWithNode = function (nodeId, actionName, payload = '') {
    const requiredPerm = APP.ACTION_PERM_MAP[actionName];
    if (requiredPerm && !APP.checkPermission(requiredPerm)) return;

    logToTerminal(`[CMD] Routing directive '${actionName}' to Node [${nodeId}]...`, 'system');
    APP.db.collection('commands').doc(nodeId).set({
        action:    actionName,
        payload:   payload,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        status:    "pending"
    }).then(() => {
        logToTerminal(`[CMD] ${actionName} -> UPLOADED TO CLOUD. Awaiting node fetch!`, 'success');
        if (APP.state.currentLoggedUser) {
            APP.db.collection('admin_users').doc(APP.state.currentLoggedUser.email).update({
                cmds_sent: firebase.firestore.FieldValue.increment(1)
            });
        }
    }).catch(err => {
        logToTerminal(`[ERROR] Command dropped: ${err.message}`, 'error');
    });
};

APP.initCommandButtons = function () {
    const D = APP.DOM;

    if (D.cmdRestart) D.cmdRestart.addEventListener('click', () => APP.pushCommand('RESTART_AGENT'));

    if (D.cmdStop) {
        D.cmdStop.addEventListener('click', async () => {
            const confirmed = await APP.showCyberConfirm("EMERGENCY KILL", "Initiate remote process termination? Agent will go offline until manual intervention or system reboot.", "hazard");
            if (confirmed) {
                APP.pushCommand('KILL_AGENT');
                APP.db.collection('devices').doc(APP.state.activeDeviceId).update({ status: 'offline' });
            }
        });
    }

    if (D.cmdForce) {
        D.cmdForce.addEventListener('click', async () => {
            const d = new Date();
            const todayStr = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
            const confirmed = await APP.showCyberConfirm("FORCE REPORT", `Are you sure you want to force report generation for Date: ${todayStr}?`, "warning");
            if (!confirmed) return;
            if (!APP.state.activeDeviceId) return;
            APP.db.collection('commands').doc(APP.state.activeDeviceId).set({
                action:    'FORCE_REPORT',
                payload:   todayStr,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                status:    "pending"
            }).then(() => {
                logToTerminal(`[CMD] FORCE_REPORT -> ${todayStr} UPLOADED TO CLOUD. Awaiting node fetch!`, 'success');
                if (APP.state.currentLoggedUser) {
                    APP.db.collection('admin_users').doc(APP.state.currentLoggedUser.email).update({
                        cmds_sent: firebase.firestore.FieldValue.increment(1)
                    });
                }
            }).catch(err => logToTerminal(`[ERROR] Command dropped: ${err.message}`, 'error'));
        });
    }

    if (D.cmdRefresh) D.cmdRefresh.addEventListener('click', () => APP.pushCommand('REFRESH_UI'));

    if (D.cmdUninstall) {
        D.cmdUninstall.addEventListener('click', async () => {
            if (!APP.state.activeDeviceId) return logToTerminal('ERROR: No target node selected.', 'error');
            const confirmed1 = await APP.showCyberConfirm("SYSTEM DECOMMISSION", `Do you want to permanently remove the agent from [${APP.state.activeDeviceId}]? IT will not start with Windows.`, "danger");
            if (!confirmed1) return;
            const confirmed2 = await APP.showCyberConfirm("FINAL CLEARANCE", `Are you ABSOLUTELY SURE you want to decommission [${APP.state.activeDeviceId}]? This cannot be undone remotely.`, "danger");
            if (confirmed2) APP.pushCommand('UNINSTALL_AGENT');
        });
    }
};
