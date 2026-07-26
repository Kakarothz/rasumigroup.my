// ─────────────────────────────────────────────────────────────
// state.js — Global application state
// All shared mutable state lives here. Edit shape here only.
// ─────────────────────────────────────────────────────────────
APP.state = {
    activeDeviceId:    null,
    currentDevices:    [],
    currentLoggedUser: null,
    currentAdminData:  null,
    unsubDevices:      null,
    seenLogs:          new Set(),
    lastSyncTime:      null   // ms timestamp of the last real Firestore push (see devices.js updateSyncDisplay)
};
