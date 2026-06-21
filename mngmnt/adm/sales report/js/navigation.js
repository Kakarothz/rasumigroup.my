// ─────────────────────────────────────────────────────────────
// navigation.js — Nav bar, dropdowns, and mode switcher
// ─────────────────────────────────────────────────────────────
APP.initNavigation = function () {
    const D = APP.DOM;

    if (D.btnViewAllAlerts && D.alertsPanelBox) {
        D.btnViewAllAlerts.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            D.alertsPanelBox.classList.toggle('expanded');
        });
    }

    if (D.notifTrigger) {
        D.notifTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (D.navDropdown) D.navDropdown.classList.add('hidden');
            if (D.notifDropdown) D.notifDropdown.classList.toggle('hidden');
        });
    }

    [D.profileTrigger, D.userIdentity].forEach(el => {
        if (!el) return;
        el.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (D.notifDropdown) D.notifDropdown.classList.add('hidden');
            if (D.navDropdown) D.navDropdown.classList.toggle('hidden');
        });
    });

    document.addEventListener('click', (e) => {
        if (D.navDropdown && !D.navDropdown.classList.contains('hidden')) {
            D.navDropdown.classList.add('hidden');
        }
        if (D.notifDropdown && !D.notifDropdown.classList.contains('hidden')) {
            D.notifDropdown.classList.add('hidden');
        }
        if (D.alertsPanelBox && D.alertsPanelBox.classList.contains('expanded')) {
            if (!e.target.closest('#alerts-panel-box')) {
                D.alertsPanelBox.classList.remove('expanded');
            }
        }
    });

    if (D.navDropdown) D.navDropdown.addEventListener('click', (e) => e.stopPropagation());
    if (D.notifDropdown) D.notifDropdown.addEventListener('click', (e) => e.stopPropagation());

    if (D.menuProfile) {
        D.menuProfile.addEventListener('click', () => {
            if (D.navDropdown) D.navDropdown.classList.add('hidden');
            if (D.modalProfile) D.modalProfile.classList.remove('hidden');
        });
    }

    if (D.menuSettings) {
        D.menuSettings.addEventListener('click', () => {
            if (D.modalSettings) {
                D.modalSettings.classList.remove('hidden');
                APP.loadAdminsTable();
            }
        });
    }

    if (D.menuModeTrigger) {
        D.menuModeTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (D.modeSubmenu) D.modeSubmenu.classList.toggle('hidden');
        });
    }

    if (D.modeCamscanner) {
        D.modeCamscanner.addEventListener('click', () => {
            window.location.href = "../../camscanner/camscanner_admin/index.html";
        });
    }

    if (D.menuLogout) {
        D.menuLogout.addEventListener('click', () => {
            APP.auth.signOut().then(() => {
                location.reload();
            }).catch(err => {
                alert("Sign-out Error: " + err.message);
                location.reload();
            });
        });
    }

    if (D.btnRefreshNodes) {
        D.btnRefreshNodes.addEventListener('click', () => {
            APP.renderDevices();
            logToTerminal('[SYSTEM] Manual node refresh triggered.', 'success');
        });
    }

    if (D.btnCloseSettings) {
        D.btnCloseSettings.addEventListener('click', () => {
            D.modalSettings.classList.add('hidden');
        });
    }
};
