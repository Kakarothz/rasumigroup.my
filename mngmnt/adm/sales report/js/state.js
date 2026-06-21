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
    seenLogs:          new Set()
};
