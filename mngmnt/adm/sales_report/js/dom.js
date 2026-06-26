// ─────────────────────────────────────────────────────────────
// dom.js — DOM element cache
// Call APP.initDOM() once inside DOMContentLoaded.
// Add new element refs here when HTML changes.
// ─────────────────────────────────────────────────────────────
APP.initDOM = function () {
    APP.DOM = {
        // Auth
        authContainer:       document.getElementById('auth-container'),
        dashboardContainer:  document.getElementById('dashboard-container'),
        btnLogin:            document.getElementById('btn-login'),
        authEmail:           document.getElementById('auth-email'),
        authPass:            document.getElementById('auth-password'),
        authError:           document.getElementById('auth-error'),

        // Node list
        deviceList:          document.getElementById('device-list'),
        btnRefreshNodes:     document.getElementById('btn-refresh-nodes'),

        // Nav
        userIdentity:        document.querySelector('.user-info'),
        profileTrigger:      document.getElementById('profile-trigger'),
        notifTrigger:        document.getElementById('notif-trigger'),
        notifDropdown:       document.getElementById('notif-dropdown'),
        notifDropdownList:   document.getElementById('notif-dropdown-list'),
        notifBadge:          document.getElementById('notif-badge'),
        navDropdown:         document.getElementById('nav-dropdown'),
        menuProfile:         document.getElementById('menu-profile'),
        menuSettings:        document.getElementById('menu-settings'),
        menuLogout:          document.getElementById('menu-logout'),
        menuModeTrigger:     document.getElementById('menu-mode-trigger'),
        modeSubmenu:         document.getElementById('mode-submenu'),
        modeVims:            document.getElementById('mode-vims'),
        modeCamscanner:      document.getElementById('mode-camscanner'),

        // Alerts panel
        criticalAlertsList:  document.getElementById('critical-alerts-list'),
        criticalAlertsBadge: document.getElementById('critical-alerts-badge'),
        alertsPanelBox:      document.getElementById('alerts-panel-box'),
        btnViewAllAlerts:    document.getElementById('btn-view-all-alerts'),

        // Settings modal
        modalSettings:       document.getElementById('settings-modal'),
        btnCloseSettings:    document.getElementById('btn-close-settings'),
        adminTableBody:      document.getElementById('admin-table-body'),
        btnAddAdmin:         document.getElementById('btn-add-admin'),
        newAdminEmail:       document.getElementById('new-admin-email'),
        newAdminPass:        document.getElementById('new-admin-pass'),
        newAdminConfirm:     document.getElementById('new-admin-confirm'),
        btnGenPass:          document.getElementById('btn-gen-pass'),
        adminSearch:         document.getElementById('admin-search'),

        // Device telemetry panel
        focusEmpty:          document.getElementById('focus-empty'),
        focusContent:        document.getElementById('focus-content'),
        activeDeviceName:    document.getElementById('active-device-name'),
        tStatus:             document.getElementById('t-status'),
        tLastseen:           document.getElementById('t-lastseen'),
        rsTime:              document.getElementById('rs-time'),
        rsPath:              document.getElementById('rs-path'),
        rsXlsx:              document.getElementById('rs-xlsx'),
        rsPdf:               document.getElementById('rs-pdf'),

        // Schedule
        btnSyncSch:          document.getElementById('btn-sync-sch'),
        schDisplay:          document.getElementById('sch-display'),
        schStart:            document.getElementById('sch-start'),

        // Terminal
        logTerminal:         document.getElementById('log-terminal'),
        terminalInput:       document.getElementById('terminal-input'),

        // Command buttons
        cmdRestart:          document.getElementById('cmd-restart'),
        cmdStop:             document.getElementById('cmd-stop'),
        cmdForce:            document.getElementById('cmd-forceprint'),
        cmdRefresh:          document.getElementById('cmd-refresh'),
        cmdUninstall:        document.getElementById('cmd-uninstall'),

        // Proof viewer
        proofViewer:         document.getElementById('proof-viewer'),
        btnProofClose:       document.getElementById('btn-close-proof'),
        proofContainer:      document.getElementById('proof-container'),
        proofGalleryStrip:   document.getElementById('proof-gallery-strip'),
        fsModal:             document.getElementById('fullscreen-proof-modal'),
        fsImg:               document.getElementById('fs-proof-img'),
        btnCloseFs:          document.getElementById('btn-close-fs'),
        proofClick:          document.getElementById('proof-click'),

        // Profile modal
        modalProfile:        document.getElementById('profile-modal'),
        btnCloseProfile:     document.getElementById('btn-close-profile'),
        profileImgDisplay:   document.getElementById('profile-img-display'),
        profileUpload:       document.getElementById('profile-upload'),
        pRole:               document.getElementById('p-role'),
        pEmail:              document.getElementById('p-email'),
        pNewPass:            document.getElementById('p-new-pass'),
        pConfirmPass:        document.getElementById('p-confirm-pass'),
        btnUpdateProfile:    document.getElementById('btn-update-profile'),
        statLastLogin:       document.getElementById('stat-last-login'),
        statCmdsSent:        document.getElementById('stat-cmds-sent'),

        // Misc
        loadingOverlay:      document.getElementById('loading-overlay'),

        // Metrics
        metricActive:        document.getElementById('metric-active'),
        metricOffline:       document.getElementById('metric-offline'),
        metricGenerated:     document.getElementById('metric-generated'),
        metricFailed:        document.getElementById('metric-failed'),
        metricSync:          document.getElementById('metric-sync'),

        // Health bars
        hmName:              document.getElementById('hm-name'),
        barCpu:              document.getElementById('bar-cpu'),
        pctCpu:              document.getElementById('pct-cpu'),
        barRam:              document.getElementById('bar-ram'),
        pctRam:              document.getElementById('pct-ram'),
        barDisk:             document.getElementById('bar-disk'),
        pctDisk:             document.getElementById('pct-disk'),
        pctNet:              document.getElementById('pct-net'),
        pctUp:               document.getElementById('pct-up'),

        // System telemetry
        sysOsName:           document.getElementById('sys-os-name'),
        sysRamVal:           document.getElementById('sys-ram-val'),
        sysRamPct:           document.getElementById('sys-ram-pct'),
        sysRamBar:           document.getElementById('sys-ram-bar'),
        sysCpuPct:           document.getElementById('sys-cpu-pct'),
        sysCpuBar:           document.getElementById('sys-cpu-bar'),
        sysDiskVal:          document.getElementById('sys-disk-val'),
        sysDiskPct:          document.getElementById('sys-disk-pct'),
        sysDiskBar:          document.getElementById('sys-disk-bar'),
        sysUpVal:            document.getElementById('sys-up-val'),

        // Tables
        activityList:        document.getElementById('activity-list'),
        cmdHistoryTbody:     document.getElementById('cmd-history-tbody'),
        downloadsTbody:      document.getElementById('downloads-tbody'),

        // Version manager
        globalVersion:       document.getElementById('global-version'),
        vUpd:                document.getElementById('v-upd'),
        vPen:                document.getElementById('v-pen'),
        vFail:               document.getElementById('v-fail'),
    };
};
