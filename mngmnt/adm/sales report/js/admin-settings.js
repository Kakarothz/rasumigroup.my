// ─────────────────────────────────────────────────────────────
// admin-settings.js — Admin table, permissions matrix, add operator
// ─────────────────────────────────────────────────────────────

// ── Event delegation on adminTableBody ───────────────────────
// Handles manage & revoke buttons without inline onclick (XSS-safe)
APP._initAdminTableDelegation = function () {
    const D = APP.DOM;
    if (!D.adminTableBody) return;

    D.adminTableBody.addEventListener('click', async (e) => {
        const manageBtn = e.target.closest('[data-action="manage"]');
        const revokeBtn = e.target.closest('[data-action="revoke"]');

        if (manageBtn) {
            APP._openPermMatrix(manageBtn.dataset.email);
        } else if (revokeBtn) {
            const email = revokeBtn.dataset.email;
            const confirmed = await APP.showCyberConfirm(
                "REVOKE ACCESS",
                `Are you sure you want to permanently remove access for operator [${email}]?`,
                "danger"
            );
            if (!confirmed) return;
            APP.db.collection('admin_users').doc(email).delete().then(() => {
                logToTerminal(`[SECURITY] Access revoked for operator: ${email}`, 'error');
                APP.loadAdminsTable();
            }).catch(err => alert("Revoke Failed: " + err.message));
        }
    });
};

// ── Admin table renderer ──────────────────────────────────────
APP.loadAdminsTable = function () {
    const D = APP.DOM;
    APP.db.collection('admin_users').orderBy('created_at', 'desc').get().then(snapshot => {
        D.adminTableBody.innerHTML = '';

        snapshot.forEach(doc => {
            const admin      = doc.data();
            const tr         = document.createElement('tr');
            const isSuperAdmin = admin.email === SUPER_ADMIN;

            const joined     = admin.created_at  ? new Date(admin.created_at.toMillis()).toLocaleDateString() : 'LEGACY';
            const lastActive = admin.last_active  ? APP.formatLastActive(admin.last_active) : 'NEVER';

            // Permissions are always read from nested object (standardized format)
            const perms   = ['can_restart', 'can_print', 'can_refresh', 'can_sysinfo', 'can_sweep', 'can_kill', 'can_uninstall', 'can_schedule'];
            const permObj = admin.permissions || {};

            // ── Clearance cell (DOM-built, no innerHTML injection) ──
            const clearanceTd   = document.createElement('td');
            const clearanceWrap = document.createElement('div');
            clearanceWrap.className = 'clearance-wrap';

            perms.forEach(p => {
                if (permObj[p]) {
                    const pill = document.createElement('span');
                    pill.className   = 'permissions-pill';
                    pill.textContent = p.replace('can_', '').toUpperCase();
                    clearanceWrap.appendChild(pill);
                }
            });

            const btnManage = document.createElement('button');
            btnManage.className        = 'permissions-manage-btn';
            btnManage.dataset.action   = 'manage';
            btnManage.dataset.email    = admin.email;
            btnManage.innerHTML        = '<i class="fa-solid fa-gear"></i>';
            clearanceWrap.appendChild(btnManage);
            clearanceTd.appendChild(clearanceWrap);

            // ── Action cell (revoke / locked) ──
            const actionTd = document.createElement('td');
            actionTd.style.textAlign = 'center';
            if (!isSuperAdmin) {
                const btnRevoke = document.createElement('button');
                btnRevoke.className      = 'icon-btn btn-revoke';
                btnRevoke.title          = 'Revoke Access';
                btnRevoke.dataset.action = 'revoke';
                btnRevoke.dataset.email  = admin.email;
                btnRevoke.innerHTML      = '<i class="fa-solid fa-trash-can"></i>';
                actionTd.appendChild(btnRevoke);
            } else {
                const lock = document.createElement('i');
                lock.className = 'fa-solid fa-lock text-muted';
                actionTd.appendChild(lock);
            }

            // ── Static cells (textContent = XSS-safe) ──
            const emailTd = document.createElement('td');
            emailTd.className   = 'admin-id-col';
            emailTd.textContent = admin.email;

            const roleTd    = document.createElement('td');
            const badgeSpan = document.createElement('span');
            badgeSpan.className   = `badge-${isSuperAdmin ? 'super' : 'operator'}`;
            badgeSpan.textContent = isSuperAdmin ? 'SUPER' : 'OPERATOR';
            roleTd.appendChild(badgeSpan);

            const joinedTd = document.createElement('td');
            joinedTd.className   = 'timestamp-col';
            joinedTd.textContent = joined;

            const lastActiveTd = document.createElement('td');
            lastActiveTd.className   = 'timestamp-col';
            lastActiveTd.textContent = lastActive;

            const encTd = document.createElement('td');
            encTd.textContent = 'CORE_ENC';

            tr.appendChild(emailTd);
            tr.appendChild(roleTd);
            tr.appendChild(clearanceTd);
            tr.appendChild(joinedTd);
            tr.appendChild(lastActiveTd);
            tr.appendChild(encTd);
            tr.appendChild(actionTd);

            D.adminTableBody.appendChild(tr);
        });
    });
};

// ── Permissions matrix modal ──────────────────────────────────
APP._openPermMatrix = function (email) {
    APP.db.collection('admin_users').doc(email).get().then(doc => {
        const data    = doc.data();
        const permObj = data.permissions || {};

        // Build overlay entirely via DOM — no innerHTML with user-controlled data
        const overlay = document.createElement('div');
        overlay.className = 'matrix-overlay';
        overlay.id        = 'perm-matrix-overlay';

        const content = document.createElement('div');
        content.className = 'matrix-content cyber-box';

        // Header
        const header = document.createElement('div');
        header.className = 'modal-header';

        const heading = document.createElement('h3');
        heading.textContent = `MANAGE CLEARANCES: ${email}`;   // textContent — safe

        const btnCloseHeader = document.createElement('button');
        btnCloseHeader.className = 'icon-btn text-error';
        btnCloseHeader.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        btnCloseHeader.addEventListener('click', () => overlay.remove());

        header.appendChild(heading);
        header.appendChild(btnCloseHeader);

        // Matrix checkboxes
        const matrix = document.createElement('div');
        matrix.className = 'tactical-matrix';

        Object.keys(APP.ACTION_PERM_MAP)
            .filter((v, i, a) => a.indexOf(v) === i)
            .forEach(action => {
                const perm = APP.ACTION_PERM_MAP[action];
                const pVal = permObj[perm] || false;

                const label    = document.createElement('label');
                label.className = 'matrix-item';

                const checkbox    = document.createElement('input');
                checkbox.type     = 'checkbox';
                checkbox.checked  = pVal;
                // Store context in dataset — no inline handlers
                checkbox.dataset.email = email;
                checkbox.dataset.perm  = perm;
                checkbox.addEventListener('change', function () {
                    APP._updatePerm(this.dataset.email, this.dataset.perm, this.checked);
                });

                const span = document.createElement('span');
                span.textContent = action.replace(/_/g, ' ');

                label.appendChild(checkbox);
                label.appendChild(span);
                matrix.appendChild(label);
            });

        // Footer
        const footer = document.createElement('div');
        footer.style.cssText = 'margin-top:20px; text-align:right';

        const btnClose = document.createElement('button');
        btnClose.className   = 'cyber-btn-small';
        btnClose.textContent = 'CLOSE PROTOCOL';
        btnClose.addEventListener('click', () => overlay.remove());
        footer.appendChild(btnClose);

        content.appendChild(header);
        content.appendChild(matrix);
        content.appendChild(footer);
        overlay.appendChild(content);
        document.body.appendChild(overlay);
    });
};

// ── Permission updater ────────────────────────────────────────
// Uses Firestore dot-notation to update nested permissions object
APP._updatePerm = function (email, perm, val) {
    APP.db.collection('admin_users').doc(email).update({
        [`permissions.${perm}`]: val
    }).then(() => {
        APP.loadAdminsTable();
    }).catch(err => {
        logToTerminal(`[SECURITY] Permission update failed: ${err.message}`, 'error');
    });
};

// ── Init ──────────────────────────────────────────────────────
APP.initAdminSettings = function () {
    const D = APP.DOM;

    APP._initAdminTableDelegation();

    // Password generator — crypto.getRandomValues() (cryptographically secure)
    if (D.btnGenPass) {
        D.btnGenPass.addEventListener('click', () => {
            const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
            const bytes   = new Uint8Array(12);
            crypto.getRandomValues(bytes);
            let retVal = "";
            bytes.forEach(b => { retVal += charset[b % charset.length]; });
            D.newAdminPass.value    = retVal;
            D.newAdminConfirm.value = retVal;
        });
    }

    if (D.adminSearch) {
        D.adminSearch.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            D.adminTableBody.querySelectorAll('tr').forEach(row => {
                row.style.display = row.innerText.toLowerCase().includes(term) ? '' : 'none';
            });
        });
    }

    if (D.btnAddAdmin) {
        D.btnAddAdmin.addEventListener('click', () => {
            const email       = D.newAdminEmail.value.toLowerCase().trim();
            const pass        = D.newAdminPass.value.trim();
            const confirmPass = D.newAdminConfirm.value.trim();

            if (!email || !pass) return alert("Missing credentials!");
            if (pass !== confirmPass) return alert("Passwords mismatch!");
            if (pass.length < 6) return alert("Password must be at least 6 characters.");

            D.btnAddAdmin.innerText = "GRANTING...";

            APP.db.collection('admin_users').doc(email).get().then(doc => {
                if (doc.exists) {
                    D.btnAddAdmin.innerText = "GRANT ACCESS";
                    return alert("Operator already commissioned.");
                }

                const tempAppName  = "TempRegister_" + Date.now();
                const secondaryApp = firebase.initializeApp(APP.FIREBASE_CONFIG, tempAppName);

                secondaryApp.auth().createUserWithEmailAndPassword(email, pass).then(() => {
                    // Permissions stored as nested object (standardized)
                    return APP.db.collection('admin_users').doc(email).set({
                        email:       email,
                        role:        "operator",
                        cmds_sent:   0,
                        created_at:  firebase.firestore.FieldValue.serverTimestamp(),
                        last_active: firebase.firestore.FieldValue.serverTimestamp(),
                        permissions: {
                            can_restart:   true,
                            can_print:     true,
                            can_refresh:   true,
                            can_sysinfo:   true,
                            can_sweep:     false,
                            can_kill:      false,
                            can_uninstall: false,
                            can_schedule:  true
                        }
                    });
                }).then(() => {
                    alert("COMMANDER COMMISSIONED SUCCESSFUL.");
                    D.newAdminEmail.value   = '';
                    D.newAdminPass.value    = '';
                    D.newAdminConfirm.value = '';
                    D.btnAddAdmin.innerText = "GRANT ACCESS";
                    APP.loadAdminsTable();
                    secondaryApp.delete().catch(() => {});
                }).catch(err => {
                    alert("Auth Error: " + err.message);
                    D.btnAddAdmin.innerText = "GRANT ACCESS";
                    secondaryApp.delete().catch(() => {});
                });
            });
        });
    }
};
