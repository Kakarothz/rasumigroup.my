// ─────────────────────────────────────────────────────────────
// auth.js — Firebase authentication and admin profile loading
// ─────────────────────────────────────────────────────────────
APP.initAuth = function () {
    const D = APP.DOM;

    if (D.btnLogin) {
        D.btnLogin.addEventListener('click', () => {
            const email = D.authEmail.value;
            const pass  = D.authPass.value;
            if (!email || !pass) return;

            D.btnLogin.innerText = 'AUTHENTICATING...';
            APP.auth.signInWithEmailAndPassword(email, pass).catch(err => {
                D.authError.innerText = `[ERROR] ${err.message}`;
                D.btnLogin.innerText  = 'INITIALIZE CONNECTION';
            });
        });
    }

    if (D.authPass) {
        D.authPass.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') D.btnLogin.click();
        });
    }

    APP.auth.onAuthStateChanged(user => {
        if (user) {
            APP.state.currentLoggedUser = user;

            D.authContainer.classList.add('hidden');
            D.dashboardContainer.classList.remove('hidden');
            D.btnLogin.innerText = 'INITIALIZE CONNECTION';

            logToTerminal(`[SYSTEM] Authenticated as Node Commander: ${user.email}`, 'success');

            APP.db.collection('admin_users').doc(user.email).onSnapshot(doc => {
                if (doc.exists) {
                    APP.state.currentAdminData = doc.data();
                    if (!APP.state.currentAdminData.permissions) APP.state.currentAdminData.permissions = {};

                    const roleText    = APP.state.currentAdminData.role === 'super_admin' ? 'SUPER ADMIN' : 'ADMIN';
                    const roleSubText = APP.state.currentAdminData.role === 'super_admin' ? 'Super Admin' : 'Admin';

                    if (D.profileTrigger) {
                        const nameEl = D.profileTrigger.querySelector('.name');
                        const roleEl = D.profileTrigger.querySelector('.role');
                        if (nameEl) nameEl.textContent = roleText;
                        if (roleEl) roleEl.textContent = roleSubText;

                        const picEl = D.profileTrigger.querySelector('img');
                        if (picEl) {
                            if (APP.state.currentAdminData.profile_img) {
                                picEl.src = APP.state.currentAdminData.profile_img;
                                if (D.profileImgDisplay) D.profileImgDisplay.src = APP.state.currentAdminData.profile_img;
                            } else {
                                const initials  = user.email.substring(0, 2).toUpperCase();
                                const avatarUrl = `https://ui-avatars.com/api/?name=${initials}&background=8b5cf6&color=fff`;
                                picEl.src = avatarUrl;
                                if (D.profileImgDisplay) D.profileImgDisplay.src = avatarUrl;
                            }
                        }
                    }

                    if (D.pRole)        D.pRole.innerText        = APP.state.currentAdminData.role.replace('_', ' ');
                    if (D.pEmail)       D.pEmail.innerText        = user.email;
                    if (D.statCmdsSent) D.statCmdsSent.innerText  = APP.state.currentAdminData.cmds_sent || 0;
                    if (D.statLastLogin) D.statLastLogin.innerText = APP.state.currentAdminData.last_login
                        ? new Date(APP.state.currentAdminData.last_login).toLocaleString() : 'N/A';

                    if (D.loadingOverlay) D.loadingOverlay.classList.add('hidden');
                } else {
                    // Account not provisioned — reject immediately, do NOT auto-create
                    logToTerminal(`[SECURITY] Unauthorized login attempt: ${user.email} — account not provisioned.`, 'error');
                    if (D.loadingOverlay) D.loadingOverlay.classList.add('hidden');
                    APP.auth.signOut().then(() => {
                        D.dashboardContainer.classList.add('hidden');
                        D.authContainer.classList.remove('hidden');
                        D.authError.innerText = '[DENIED] Account not provisioned. Contact super admin.';
                    });
                }
            });

            APP.startDeviceListener();
        } else {
            APP.state.currentLoggedUser = null;
            if (D.loadingOverlay) D.loadingOverlay.classList.add('hidden');
            D.dashboardContainer.classList.add('hidden');
            D.authContainer.classList.remove('hidden');
        }
    });
};
