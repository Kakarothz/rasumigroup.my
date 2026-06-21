// ==========================================
// 1. FIREBASE CONFIGURATION (LIVED SECURE PUMP)
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyAZCLVytR-q7bhoeQAbwu5YLVJiTf7m0gE",
    authDomain: "cspooler-admin-console.firebaseapp.com",
    projectId: "cspooler-admin-console",
    storageBucket: "cspooler-admin-console.firebasestorage.app",
    messagingSenderId: "1095696213638",
    appId: "1:1095696213638:web:4492f1fd48939369ee9307",
    measurementId: "G-TRZP96569E"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const storage = firebase.storage();

document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // 2. STATE & CACHE
    // ==========================================
    let activeDeviceId = null;
    let currentDevices = []; // Senarai cache dari Firestore

    // ==========================================
    // 3. UI CONTROLLERS & DOM ELEMENTS
    // ==========================================
    const DOM = {
        authContainer: document.getElementById('auth-container'),
        dashboardContainer: document.getElementById('dashboard-container'),
        btnLogin: document.getElementById('btn-login'),
        authEmail: document.getElementById('auth-email'),
        authPass: document.getElementById('auth-password'),
        authError: document.getElementById('auth-error'),
        deviceList: document.getElementById('device-list'),
        btnRefreshNodes: document.getElementById('btn-refresh-nodes'),

        // Nav Identity & Profile
        profileTrigger: document.getElementById('profile-trigger'),
        navDropdown: document.getElementById('nav-dropdown'),
        menuProfile: document.getElementById('menu-profile'),
        menuSettings: document.getElementById('menu-settings'),
        menuLogout: document.getElementById('menu-logout'),
        // Anti-Flicker
        loadingOverlay: document.getElementById('loading-overlay'),

        // Settings Modal
        modalSettings: document.getElementById('settings-modal'),
        btnCloseSettings: document.getElementById('btn-close-settings'),
        adminTableBody: document.getElementById('admin-table-body'),
        btnAddAdmin: document.getElementById('btn-add-admin'),
        newAdminEmail: document.getElementById('new-admin-email'),
        newAdminPass: document.getElementById('new-admin-pass'),
        newAdminConfirm: document.getElementById('new-admin-confirm'),
        btnGenPass: document.getElementById('btn-gen-pass'),
        adminSearch: document.getElementById('admin-search'),

        // Focus Panel
        focusEmpty: document.getElementById('focus-empty'),
        focusContent: document.getElementById('focus-content'),
        activeDeviceName: document.getElementById('active-device-name'),
        tStatus: document.getElementById('t-status'),
        tLastseen: document.getElementById('t-lastseen'),
        tPrinter: document.getElementById('t-printer'),

        // Config
        btnSyncSch: document.getElementById('btn-sync-sch'),
        schStart: document.getElementById('sch-start'),
        schEnd: document.getElementById('sch-end'),

        // Log & Proof
        logTerminal: document.getElementById('log-terminal'),
        terminalInput: document.getElementById('terminal-input'),
        proofViewer: document.getElementById('proof-viewer'),
        btnProofClose: document.getElementById('btn-close-proof'),

        // Tactical Proof UI
        proofContainer: document.getElementById('proof-container'),
        proofGalleryStrip: document.getElementById('proof-gallery-strip'),

        // Commands
        cmdRestart: document.getElementById('cmd-restart'),
        cmdForce: document.getElementById('cmd-forceprint'),
        cmdRefresh: document.getElementById('cmd-refresh'),
        cmdUninstall: document.getElementById('cmd-uninstall'),

        // Fullscreen Proof
        fsModal: document.getElementById('fullscreen-proof-modal'),
        fsImg: document.getElementById('fs-proof-img'),
        btnCloseFs: document.getElementById('btn-close-fs'),
        proofClick: document.getElementById('proof-click'),

        // Profile Modal
        modalProfile: document.getElementById('profile-modal'),
        btnCloseProfile: document.getElementById('btn-close-profile'),
        profileImgDisplay: document.getElementById('profile-img-display'),
        profileUpload: document.getElementById('profile-upload'),
        pRole: document.getElementById('p-role'),
        pEmail: document.getElementById('p-email'),
        pNewPass: document.getElementById('p-new-pass'),
        pConfirmPass: document.getElementById('p-confirm-pass'),
        btnUpdateProfile: document.getElementById('btn-update-profile'),
        statLastLogin: document.getElementById('stat-last-login'),
        statCmdsSent: document.getElementById('stat-cmds-sent')
    };

    // ==========================================
    // PRIORITY 1: NAVIGATION & DROPDOWN ENGINE
    // ==========================================
    if (DOM.profileTrigger) {
        DOM.profileTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            var notif = document.getElementById('notif-dropdown');
            if (notif) notif.classList.add('hidden');
            if (DOM.navDropdown) DOM.navDropdown.classList.toggle('hidden');
        });
    }

    document.addEventListener('click', () => {
        if (DOM.navDropdown && !DOM.navDropdown.classList.contains('hidden')) {
            DOM.navDropdown.classList.add('hidden');
        }
        var notif = document.getElementById('notif-dropdown');
        if (notif && !notif.classList.contains('hidden')) {
            notif.classList.add('hidden');
        }
    });

    if (DOM.navDropdown) {
        DOM.navDropdown.addEventListener('click', (e) => e.stopPropagation());
    }

    if (DOM.menuProfile) {
        DOM.menuProfile.addEventListener('click', () => {
            if (DOM.modalProfile) DOM.modalProfile.classList.remove('hidden');
        });
    }

    if (DOM.menuSettings) {
        DOM.menuSettings.addEventListener('click', () => {
            if (DOM.modalSettings) {
                DOM.modalSettings.classList.remove('hidden');
                loadAdminsTable();
            }
        });
    }

    if (DOM.menuLogout) {
        DOM.menuLogout.addEventListener('click', () => {
            auth.signOut().then(() => {
                location.reload();
            }).catch(err => {
                alert("Sign-out Error: " + err.message);
                location.reload();
            });
        });
    }

    if (DOM.btnRefreshNodes) {
        DOM.btnRefreshNodes.addEventListener('click', () => {
            renderDevices();
            logToTerminal('[SYSTEM] Manual node refresh triggered.', 'success');
        });
    }

    if (DOM.btnCloseSettings) {
        DOM.btnCloseSettings.addEventListener('click', () => {
            DOM.modalSettings.classList.add('hidden');
        });
    }

    // ==========================================
    // 4. FIREBASE AUTHENTICATION LOGIC
    // ==========================================
    const SUPER_ADMIN = "musqhaishah@gmail.com";
    let currentLoggedUser = null;
    let currentAdminData = null; // Data dari Firestore admin_users

    DOM.btnLogin.addEventListener('click', () => {
        const email = DOM.authEmail.value;
        const pass = DOM.authPass.value;
        if (!email || !pass) return;

        DOM.btnLogin.innerText = 'AUTHENTICATING...';
        auth.signInWithEmailAndPassword(email, pass).catch(err => {
            DOM.authError.innerText = `[ERROR] ${err.message}`;
            DOM.btnLogin.innerText = 'INITIALIZE CONNECTION';
        });
    });

    DOM.authPass.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') DOM.btnLogin.click();
    });

    // Listener untuk state log masuk
    auth.onAuthStateChanged(user => {
        if (user) {
            currentLoggedUser = user;

            DOM.authContainer.classList.add('hidden');
            DOM.dashboardContainer.classList.remove('hidden');
            DOM.btnLogin.innerText = 'INITIALIZE CONNECTION';

            logToTerminal(`[SYSTEM] Authenticated as Node Commander: ${user.email}`, 'success');

            // Mula ambil data profil admin
            db.collection('admin_users').doc(user.email).onSnapshot(doc => {
                if (doc.exists) {
                    currentAdminData = doc.data(); // Fix: Restore missing data fetch
                    if (!currentAdminData.permissions) currentAdminData.permissions = {};

                    // Update header identity
                    const roleText = currentAdminData.role === 'super_admin' ? 'SUPER ADMIN' : 'ADMIN';
                    const roleSubText = currentAdminData.role === 'super_admin' ? 'Super Admin' : 'Admin';
                    if (DOM.profileTrigger) {
                        const nameEl = DOM.profileTrigger.querySelector('.name');
                        const roleEl = DOM.profileTrigger.querySelector('.role');
                        if (nameEl) nameEl.textContent = roleText;
                        if (roleEl) roleEl.textContent = roleSubText;

                        // Profile picture
                        const picEl = DOM.profileTrigger.querySelector('img');
                        if (picEl) {
                            if (currentAdminData.profile_img) {
                                picEl.src = currentAdminData.profile_img;
                                if (DOM.profileImgDisplay) DOM.profileImgDisplay.src = currentAdminData.profile_img;
                            } else {
                                const initials = user.email.substring(0, 2).toUpperCase();
                                const avatarUrl = `https://ui-avatars.com/api/?name=${initials}&background=8b5cf6&color=fff`;
                                picEl.src = avatarUrl;
                                if (DOM.profileImgDisplay) DOM.profileImgDisplay.src = avatarUrl;
                            }
                        }
                    }

                    if (DOM.pRole) DOM.pRole.innerText = currentAdminData.role.replace('_', ' ');
                    if (DOM.pEmail) DOM.pEmail.innerText = user.email;
                    if (DOM.statCmdsSent) DOM.statCmdsSent.innerText = currentAdminData.cmds_sent || 0;
                    if (DOM.statLastLogin) DOM.statLastLogin.innerText = currentAdminData.last_login ? new Date(currentAdminData.last_login).toLocaleString() : 'N/A';

                    // --- ANTI-FLICKER: Only hide overlay AFTER profile data is ready ---
                    if (DOM.loadingOverlay) DOM.loadingOverlay.classList.add('hidden');
                } else {
                    // Initialize if missing
                    db.collection('admin_users').doc(user.email).set({
                        email: user.email,
                        role: user.email === SUPER_ADMIN ? "super_admin" : "admin",
                        last_login: Date.now(),
                        cmds_sent: 0,
                        permissions: { can_restart: true, can_print: true, can_refresh: true, can_sysinfo: true, can_sweep: true, can_schedule: true }
                    });
                }
            });

            // Mula sedut peranti
            startDeviceListener();
        } else {
            currentLoggedUser = null;
            if (DOM.loadingOverlay) DOM.loadingOverlay.classList.add('hidden');
            DOM.dashboardContainer.classList.add('hidden');
            DOM.authContainer.classList.remove('hidden');
        }
    });

    // ==========================================
    // 5. FIRESTORE REALTIME LISTENERS
    // ==========================================
    let unsubDevices = null;
    const seenLogs = new Set(); // Cache unntuk elak duplicated logs dari ejen

    function startDeviceListener() {
        logToTerminal(`[SYSTEM] Establishing uplink to Firestore <devices> vault...`);

        if (unsubDevices) unsubDevices();

        unsubDevices = db.collection('devices').onSnapshot(snapshot => {
            currentDevices = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                const deviceId = doc.id;
                
                // FILTER: Jangan tunjukkan peranti VIMS di sini (SAMA UNTUK LOG)
                const isVims = (data.type === 'vims') || 
                               (deviceId.startsWith('VIMS_'));

                if (isVims) return;

                currentDevices.push({ id: deviceId, ...data });

                // Sync Live Logs dari Ejen! (HANYA UNTUK CAMSCANNER/SPOOLER)
                if (data.live_logs && Array.isArray(data.live_logs)) {
                    data.live_logs.forEach(msg => {
                        const logKey = `${deviceId}_${msg}`;
                        if (!seenLogs.has(logKey)) {
                            logToTerminal(`[${deviceId}] ${msg}`, 'remote');
                            seenLogs.add(logKey);
                        }
                    });
                }
            });
            renderDevices();

            // Refresh panel kalau panel tgh buka device yg baru update state nya
            if (activeDeviceId) {
                const upToDateDev = currentDevices.find(d => d.id === activeDeviceId);
                if (upToDateDev) openDevicePanel(upToDateDev);
                else { activeDeviceId = null; DOM.focusEmpty.classList.remove('hidden'); DOM.focusContent.classList.add('hidden'); }
            }
        }, err => {
            logToTerminal(`[FATAL] Firestore Uplink Failed: ${err.message}`, 'error');
        });
    }

    // --- RENDER DEVICES TO UI ---
    function renderDevices() {
        DOM.deviceList.innerHTML = '';

        let onlineCount = 0;
        let offlineCount = 0;

        currentDevices.forEach(dev => {
            let LSTime = 0;
            if (dev.last_seen) {
                if (typeof dev.last_seen.toMillis === 'function') LSTime = dev.last_seen.toMillis();
                else if (typeof dev.last_seen === 'string') LSTime = Date.parse(dev.last_seen);
            }

            // CONSOLIDATED STATUS LOGIC
            const isExplicitlyOffline = dev.status === 'offline';
            const isExplicitlyHibernate = dev.status === 'hibernate';
            const isExplicitlyIdle = dev.status === 'idle';

            // Heartbeat check (60s)
            const isStale = (Date.now() - LSTime) > 60000;
            const finalOffline = isStale || isExplicitlyOffline;
            
            if (finalOffline && !isExplicitlyHibernate) {
                offlineCount++;
            } else if (!isExplicitlyHibernate) {
                onlineCount++;
            }

            // --- RESOLVING VISUAL MAPPING ---
            let dotClass = 'dot-offline';
            let statusText = 'OFFLINE';
            let statusColorClass = 'text-status-offline';
            let cardDimClass = 'dimmed';

            if (isExplicitlyHibernate) {
                dotClass = 'dot-hibernate'; 
                statusText = 'HIBERNATE';
                statusColorClass = 'text-status-hibernate';
                cardDimClass = ''; 
            } else if (!finalOffline) {
                if (isExplicitlyIdle) {
                    dotClass = 'dot-idle';
                    statusText = 'IDLE';
                    statusColorClass = 'text-status-idle';
                } else {
                    dotClass = 'dot-online';
                    statusText = dev.status ? dev.status.toUpperCase() : 'ONLINE';
                    statusColorClass = 'text-status-online';
                }
                cardDimClass = '';
            }

            const card = document.createElement('div');
            card.className = `device-card ${activeDeviceId === dev.id ? 'active' : ''} ${cardDimClass}`;
            card.setAttribute('data-is-offline', finalOffline);
            card.innerHTML = `
            <span class="dev-name"><span class="status-dot ${dotClass}"></span> ${dev.id}</span>
            <div class="dev-meta">
                <span class="${statusColorClass}">${statusText}</span>
                <span class="live-clock">${LSTime > 0 ? (finalOffline ? new Date(LSTime).toLocaleTimeString() : new Date().toLocaleTimeString()) : '--:--'}</span>
            </div>
        `;

            card.addEventListener('click', () => {
                activeDeviceId = dev.id;
                renderDevices();
                openDevicePanel(dev);
            });

            DOM.deviceList.appendChild(card);
        });

        const elOnline = document.getElementById('stat-online');
        const elOffline = document.getElementById('stat-offline');

        elOnline.innerText = `${onlineCount} ONLINE`;
        elOffline.innerText = `${offlineCount} OFFLINE`;

        // DYNAMIC BADGE PULSE
        if (onlineCount > 0) {
            elOnline.classList.add('badge-blink');
            elOnline.classList.remove('badge-dimmed');
        } else {
            elOnline.classList.remove('badge-blink');
            elOnline.classList.add('badge-dimmed');
        }

        if (offlineCount === 0) {
            elOffline.classList.add('badge-dimmed');
        } else {
            elOffline.classList.remove('badge-dimmed');
        }
    }

    // --- RENDERING DETAIL PANEL ---
    function openDevicePanel(dev) {
        DOM.focusEmpty.classList.add('hidden');
        DOM.focusContent.classList.remove('hidden');

        DOM.activeDeviceName.innerText = `[${dev.id}]`;

        let LSTime = 0;
        if (dev.last_seen) {
            if (typeof dev.last_seen.toMillis === 'function') LSTime = dev.last_seen.toMillis();
            else if (typeof dev.last_seen === 'string') LSTime = Date.parse(dev.last_seen);
        }
        let statusText = 'OFFLINE';
        let colorClass = 'text-error';

        // Heartbeat check (60s)
        const isStale = (Date.now() - LSTime) > 60000;

        if (dev.status === 'hibernate') {
            statusText = 'HIBERNATE';
            colorClass = 'text-status-hibernate'; 
        } else if (!isStale && dev.status !== 'offline') {
            statusText = dev.status ? dev.status.toUpperCase() : "ONLINE";
            colorClass = dev.status === 'printing' ? 'text-success' : 'text-status-online';
        }

        DOM.tStatus.innerText = statusText;
        DOM.tStatus.className = `val ${colorClass}`;

        DOM.tLastseen.innerText = LSTime > 0 ? new Date(LSTime).toLocaleTimeString() : '--:--:--';
        DOM.tPrinter.innerText = dev.printer || 'N/A';

        // Tactical Visual Feed (5-Slot History Strip)
        const history = dev.proof_history || [];
        if (history.length > 0) {
            DOM.proofContainer.classList.remove('hidden');
            DOM.proofGalleryStrip.innerHTML = ''; // Clear for rebuild

            history.forEach((b64, index) => {
                const thumb = document.createElement('div');
                thumb.className = 'proof-thumb';
                thumb.innerHTML = `
                <img src="${b64}" alt="Proof ${index}">
                <div class="thumb-overlay">${index === 0 ? 'NEW' : 'HIST-' + index}</div>
            `;
                thumb.onclick = () => {
                    DOM.fsModal.classList.remove('hidden');
                    DOM.fsImg.src = b64;
                    logToTerminal(`[SYSTEM] Accessing tactical vision slot [${index}]...`, 'success');
                };
                DOM.proofGalleryStrip.appendChild(thumb);
            });
        } else {
            DOM.proofContainer.classList.add('hidden');
        }

        // --- 12-HOUR PARSER ---
        function parse12(time24) {
            if (!time24) return { h: "08", m: "00", ap: "AM" };
            let [h, m] = time24.split(':');
            let hInt = parseInt(h);
            let ap = hInt >= 12 ? 'PM' : 'AM';
            hInt = hInt % 12 || 12; // Convert 0 to 12
            let hStr = hInt < 10 ? '0' + hInt : hInt.toString();
            return { h: hStr, m: m, ap: ap };
        }

        const startData = parse12(dev.schedule_start);
        const stopData = parse12(dev.schedule_stop);

        document.getElementById('sch-start').value = `${startData.h}:${startData.m}`;
        const btnStartAP = document.getElementById('sch-start-ap');
        btnStartAP.innerText = startData.ap;
        btnStartAP.classList.toggle('active', true);

        document.getElementById('sch-stop').value = `${stopData.h}:${stopData.m}`;
        const btnStopAP = document.getElementById('sch-stop-ap');
        btnStopAP.innerText = stopData.ap;
        btnStopAP.classList.toggle('active', true);

        // Populate System Telemetry
        document.getElementById('t-sysinfo').innerText = dev.sys_info || "Awaiting 'sysinfo' command...";
    }

    // ==========================================
    // 6. FIRESTORE COMMAND DISPATCHER
    // ==========================================
    function checkPermission(perm) {
        if (currentAdminData?.role === 'super_admin') return true;
        return currentAdminData?.permissions?.[perm] === true;
    }

    // --- HARD-FIX OFFLINE GUARD HELPER ---
    function isNodeOffline(id) {
        const deviceData = currentDevices.find(d => d.id === id);
        if (!deviceData) return true;
        
        // --- HIBERNATE AWARENESS ---
        // If the device is explicitly hibernating, we do NOT treat it as "Dead/Offline" 
        // for protocol rejection purposes.
        if (deviceData.status === 'hibernate') return false;
        
        const lastSeen = deviceData.last_seen;
        let LSTime = 0;

        if (lastSeen) {
            if (typeof lastSeen.toMillis === 'function') {
                LSTime = lastSeen.toMillis();
            } else if (lastSeen.seconds) {
                LSTime = lastSeen.seconds * 1000;
            } else {
                LSTime = Date.parse(lastSeen);
            }
        }
        
        // If time is invalid or older than 15 mins, it's OFFLINE
        if (!LSTime || isNaN(LSTime)) return true;
        return (Date.now() - LSTime > 900000);
    }

    const ACTION_PERM_MAP = {
        'RESTART_AGENT': 'can_restart',
        'FORCE_PRINT': 'can_print',
        'REFRESH_UI': 'can_refresh',
        'PING': 'can_refresh',
        'GET_SYSINFO': 'can_sysinfo',
        'CLEAR_CACHE': 'can_sweep',
        'SHUTDOWN_AGENT': 'can_kill',
        'UNINSTALL_AGENT': 'can_uninstall',
        'UPDATE_SCHEDULE': 'can_schedule'
    };

    function pushCommand(actionName, requiredPerm = null) {
        if (!activeDeviceId) return;

        // --- HARD-FIX GUARD ---
        if (isNodeOffline(activeDeviceId)) {
            logToTerminal(`[SYSTEM] Unsuccessful: Device [${activeDeviceId}] is OFFLINE. Protocol rejected.`, 'error');
            return;
        }

        // Check Permission (Manual override if passed, or use map)
        const permToVerify = requiredPerm || ACTION_PERM_MAP[actionName];
        if (permToVerify && !checkPermission(permToVerify)) return;

        logToTerminal(`[CMD] Routing directive '${actionName}' to Node [${activeDeviceId}]...`, 'system');

        const cmdDoc = db.collection('commands').doc(activeDeviceId);
        cmdDoc.set({
            action: actionName,
            payload: "",
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            status: "pending"
        }).then(() => {
            logToTerminal(`[CMD] ${actionName} -> UPLOADED TO CLOUD. Awaiting node fetch!`, 'success');
            // Counter admin
            if (currentLoggedUser) {
                db.collection('admin_users').doc(currentLoggedUser.email).update({
                    cmds_sent: firebase.firestore.FieldValue.increment(1)
                });
            }
        }).catch(err => {
            logToTerminal(`[ERROR] Command dropped: ${err.message}`, 'error');
        });
    }

    DOM.cmdRestart.addEventListener('click', () => pushCommand('RESTART_AGENT'));
    DOM.cmdForce.addEventListener('click', () => pushCommand('FORCE_PRINT'));
    DOM.cmdRefresh.addEventListener('click', () => pushCommand('REFRESH_UI'));
    DOM.cmdUninstall.addEventListener('click', async () => {
        if (!activeDeviceId) return logToTerminal('ERROR: No target node selected.', 'error');
        const confirmed1 = await showCyberConfirm("SYSTEM DECOMMISSION", `Do you want to permanently remove the agent from [${activeDeviceId}]? IT will not start with Windows.`, "danger");
        if (confirmed1) {
            const confirmed2 = await showCyberConfirm("FINAL CLEARANCE", `Are you ABSOLUTELY SURE you want to decommission [${activeDeviceId}]? This cannot be undone remotely.`, "danger");
            if (confirmed2) {
                pushCommand('UNINSTALL_AGENT');
            }
        }
    });
    DOM.btnSyncSch.addEventListener('click', () => {
        if (!activeDeviceId) return;
        const startVal = document.getElementById('sch-start').value;
        const startAP = document.getElementById('sch-start-ap').innerText;
        const stopVal = document.getElementById('sch-stop').value;
        const stopAP = document.getElementById('sch-stop-ap').innerText;

        function to24(time12, ap) {
            let [h, m] = time12.split(':');
            let hInt = parseInt(h);
            if (ap === 'PM' && hInt < 12) hInt += 12;
            if (ap === 'AM' && hInt === 12) hInt = 0;
            return `${hInt.toString().padStart(2, '0')}:${m}`;
        }

        const start = to24(startVal, startAP);
        const end = to24(stopVal, stopAP);

        // Clean UI: Stop the rotation alert
        DOM.btnSyncSch.classList.remove('sync-alert');

        logToTerminal(`[CMD] Applying Schedule Patch ${start} - ${end} to Node [${activeDeviceId}]...`, 'system');

        // Sync into commands collection
        db.collection('commands').doc(activeDeviceId).set({
            action: "UPDATE_SCHEDULE",
            payload: `${start}|${end}`,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            status: "pending"
        }).then(() => {
            logToTerminal(`[CMD] SCHEDULE SYNC_OK. Sent to Cloud.`, 'success');

            // --- PERSISTENCE LAYER ---
            // Save to device document so agent can read it on BOOT
            db.collection('devices').doc(activeDeviceId).update({
                schedule_start: start,
                schedule_stop: end
            });

            // Counter admin
            db.collection('admin_users').doc(currentLoggedUser.email).update({
                cmds_sent: firebase.firestore.FieldValue.increment(1)
            });
        });
    });

    // --- TACTICAL KEYBOARD ENGINE FOR SCHEDULE ---
    function setupTacticalInputs() {
        const inputs = [document.getElementById('sch-start'), document.getElementById('sch-stop')];
        const apBtns = [document.getElementById('sch-start-ap'), document.getElementById('sch-stop-ap')];

        apBtns.forEach(btn => {
            if (!btn) return;
            btn.addEventListener('click', () => {
                btn.innerText = btn.innerText === 'AM' ? 'PM' : 'AM';
                btn.classList.add('active');
                document.getElementById('btn-sync-sch').classList.add('sync-alert');
            });
        });
        
        inputs.forEach((input, index) => {
            if (!input) return;
            
            input.addEventListener('input', (e) => {
                let val = input.value.replace(/[^0-9]/g, ''); // Numbers only
                
                // Logic: 8 vs 1 (First digit handling)
                if (val.length === 1) {
                    const firstDigit = parseInt(val);
                    if (firstDigit >= 2 && firstDigit <= 9) {
                        input.value = `0${firstDigit}:`;
                    }
                } 
                // Auto-colon at 2 digits
                else if (val.length === 2) {
                    input.value = `${val.slice(0, 2)}:`;
                }
                // Full mask HH:MM
                else if (val.length > 2) {
                    input.value = `${val.slice(0, 2)}:${val.slice(2, 4)}`;
                }

                // Alert synchronization: Rotation active!
                document.getElementById('btn-sync-sch').classList.add('sync-alert');
                
                // Auto-jump to NEXT field (TO)
                if (input.value.length === 5 && index === 0) {
                    inputs[1].focus();
                }
            });

            // Tab / Backspace survival
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && input.value.endsWith(':')) {
                    input.value = input.value.slice(0, -1);
                }
            });
        });
    }

    // Call engine once DOM is ready (assuming inside main load)
    setupTacticalInputs();

    // ==========================================
    // 8. PROFILE MANAGEMENT LOGIC
    // ==========================================
    // --- PROFILE CONTROLS (DEPRECATED: Moved to Dropdown Controller) ---
    DOM.btnCloseProfile.addEventListener('click', () => DOM.modalProfile.classList.add('hidden'));

    DOM.profileImgDisplay.addEventListener('click', () => DOM.profileUpload.click());

    let pendingProfileFile = null;

    DOM.profileUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            pendingProfileFile = file;
            // Visual Preview First
            const reader = new FileReader();
            reader.onload = (ev) => {
                const base64 = ev.target.result;
                DOM.profileImgDisplay.src = base64;
            };
            reader.readAsDataURL(file);
        }
    });

    DOM.btnUpdateProfile.addEventListener('click', () => {
        const newPass = DOM.pNewPass.value;
        const confirmPass = DOM.pConfirmPass.value;
        
        const hasPasswordUpdate = (newPass !== "" || confirmPass !== "");

        if (hasPasswordUpdate) {
            if (newPass !== confirmPass) {
                alert("Passwords mismatch!");
                return;
            }
            if (newPass.length < 6) {
                alert("Password must be at least 6 characters.");
                return;
            }
        }

        var promises = [];
        
        // 1. Password Update
        if (hasPasswordUpdate && auth.currentUser) {
            promises.push(auth.currentUser.updatePassword(newPass).then(() => "Password updated successfully."));
        }

        // 2. Profile Image Update
        if (pendingProfileFile && currentLoggedUser && currentLoggedUser.email) {
            var storageRef = firebase.storage().ref();
            var fileRef = storageRef.child('users/' + currentLoggedUser.email + '/profile/' + pendingProfileFile.name);
            
            DOM.profileImgDisplay.style.opacity = '0.5';
            var imgPromise = fileRef.put(pendingProfileFile).then(snapshot => {
                return snapshot.ref.getDownloadURL();
            }).then(url => {
                return db.collection('admin_users').doc(currentLoggedUser.email).update({
                    profile_img: url
                }).then(() => url);
            }).then(url => {
                DOM.profileImgDisplay.style.opacity = '1';
                logToTerminal(`[PROFILE] Avatar saved to user folder and synced successfully.`, 'success');
                if(DOM.profileTrigger) DOM.profileTrigger.querySelector('img').src = url;
                pendingProfileFile = null;
                return "Avatar saved to user folder and synced.";
            }).catch(err => {
                DOM.profileImgDisplay.style.opacity = '1';
                throw new Error("Avatar sync failed: " + err.message);
            });
            promises.push(imgPromise);
        }

        if (promises.length === 0) {
            alert("No changes to update.");
            return;
        }

        Promise.all(promises).then(results => {
            alert(results.join("\\n"));
            DOM.pNewPass.value = '';
            DOM.pConfirmPass.value = '';
            DOM.modalProfile.classList.add('hidden');
        }).catch(err => {
            alert("Error updating account: " + err.message);
        });
    });

    // --- HELPER LOG ---
    window.logToTerminal = function (msg, type = 'system') {
        const line = document.createElement('div');
        line.className = `log-line ${type}`;

        // MASA HANYA untuk output LIVE STREAM (remote dari Ejen)
        if (type === 'remote') {
            line.innerText = msg; // Ejen dah ada [19:00:33]
        } else {
            line.innerText = msg; // 'root@spooler:~# help' atau '[SYSTEM] ...' tiada masa
        }

        DOM.logTerminal.appendChild(line);
        DOM.logTerminal.scrollTop = DOM.logTerminal.scrollHeight;
    }

    DOM.btnProofClose.addEventListener('click', () => {
        DOM.proofViewer.classList.add('hidden');
    });

    DOM.proofClick.addEventListener('click', () => {
        DOM.fsModal.classList.remove('hidden');
    });

    DOM.btnCloseFs.addEventListener('click', () => {
        DOM.fsModal.classList.add('hidden');
    });

    // ==========================================
    // 7. ADMIN SETTINGS MANAGEMENT (V2)
    // ==========================================
    
    // --- Password Generator ---
    DOM.btnGenPass.addEventListener('click', () => {
        const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
        let retVal = "";
        for (let i = 0; i < 12; ++i) {
            retVal += charset.charAt(Math.floor(Math.random() * charset.length));
        }
        DOM.newAdminPass.value = retVal;
        DOM.newAdminConfirm.value = retVal;
    });

    // --- Search Filter ---
    DOM.adminSearch.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const rows = DOM.adminTableBody.querySelectorAll('tr');
        rows.forEach(row => {
            const text = row.innerText.toLowerCase();
            row.style.display = text.includes(term) ? '' : 'none';
        });
    });

    function loadAdminsTable() {
        db.collection('admin_users').orderBy('created_at', 'desc').get().then(snapshot => {
            DOM.adminTableBody.innerHTML = '';
            const meSuper = currentLoggedUser.email === SUPER_ADMIN;

            snapshot.forEach(doc => {
                const admin = doc.data();
                const tr = document.createElement('tr');
                
                const joined = admin.created_at ? new Date(admin.created_at.toMillis()).toLocaleDateString() : 'LEGACY';
                const lastActive = admin.last_active ? formatLastActive(admin.last_active) : 'NEVER';
                
                // Clearance Summary (Pills)
                let clearanceHtml = `<div class="clearance-wrap">`;
                const perms = ['can_restart','can_print','can_refresh','can_sysinfo','can_sweep','can_kill','can_uninstall','can_schedule'];
                perms.forEach(p => {
                    const pVal = admin.permissions ? admin.permissions[p] : admin[p]; // Support legacy or nested
                    if (pVal) {
                        const label = p.replace('can_', '').toUpperCase();
                        clearanceHtml += `<span class="permissions-pill">${label}</span>`;
                    }
                });
                clearanceHtml += `<button class="permissions-manage-btn" onclick="managePermissions('${admin.email}')"><i class="fa-solid fa-gear"></i></button></div>`;

                tr.innerHTML = `
                    <td class="admin-id-col">${admin.email}</td>
                    <td><span class="badge-${admin.email === SUPER_ADMIN ? 'super' : 'operator'}">${admin.email === SUPER_ADMIN ? 'SUPER' : 'OPERATOR'}</span></td>
                    <td>${clearanceHtml}</td>
                    <td class="timestamp-col">${joined}</td>
                    <td class="timestamp-col">${lastActive}</td>
                    <td>CORE_ENC</td>
                    <td style="text-align:center">
                        ${admin.email !== SUPER_ADMIN ? `<button class="icon-btn btn-revoke" onclick="revokeAccess('${admin.email}')" title="Revoke Access"><i class="fa-solid fa-trash-can"></i></button>` : '<i class="fa-solid fa-lock text-muted"></i>'}
                    </td>
                `;
                DOM.adminTableBody.appendChild(tr);
            });
        });
    }

    function formatLastActive(ts) {
        const diff = Date.now() - ts.toMillis();
        if (diff < 60000) return 'JUST NOW';
        if (diff < 3600000) return Math.floor(diff/60000) + 'm AGO';
        if (diff < 86400000) return Math.floor(diff/3600000) + 'h AGO';
        return new Date(ts.toMillis()).toLocaleDateString();
    }

    window.revokeAccess = async function(email) {
        const confirmed = await showCyberConfirm("REVOKE ACCESS", `Are you sure you want to permanently remove access for operator [${email}]?`, "danger");
        if (confirmed) {
            // Delete from Firestore DB first
            db.collection('admin_users').doc(email).delete().then(() => {
                logToTerminal(`[SECURITY] Access revoked for operator: ${email}`, 'error');
                loadAdminsTable();
            }).catch(err => alert("Revoke Failed: " + err.message));
        }
    }

    window.managePermissions = function(email) {
        db.collection('admin_users').doc(email).get().then(doc => {
            const data = doc.data();
            const matrixHtml = `
                <div class="tactical-matrix">
                    ${Object.keys(ACTION_PERM_MAP).filter((v,i,a) => a.indexOf(v) === i).map(action => {
                        const perm = ACTION_PERM_MAP[action];
                        const pVal = data.permissions ? data.permissions[perm] : data[perm];
                        const checked = pVal ? 'checked' : '';
                        return `
                            <label class="matrix-item">
                                <input type="checkbox" ${checked} onchange="updatePerm('${email}', '${perm}', this.checked)">
                                <span>${action.replace(/_/g,' ')}</span>
                            </label>
                        `;
                    }).join('')}
                </div>
            `;
            
            const overlay = document.createElement('div');
            overlay.className = 'matrix-overlay';
            overlay.id = 'perm-matrix-overlay';
            overlay.innerHTML = `
                <div class="matrix-content cyber-box">
                    <div class="modal-header">
                        <h3>MANAGE CLEARANCES: ${email}</h3>
                        <button onclick="document.getElementById('perm-matrix-overlay').remove()" class="icon-btn text-error"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    ${matrixHtml}
                    <div style="margin-top:20px; text-align:right">
                        <button onclick="document.getElementById('perm-matrix-overlay').remove()" class="cyber-btn-small">CLOSE PROTOCOL</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
        });
    }

    window.updatePerm = function(email, perm, val) {
        // Support legacy flat structure too
        db.collection('admin_users').doc(email).update({
            [perm]: val
        }).then(() => {
            loadAdminsTable(); // Refresh pills
        });
    }

    DOM.btnAddAdmin.addEventListener('click', () => {
        const email = DOM.newAdminEmail.value.toLowerCase().trim();
        const pass = DOM.newAdminPass.value.trim();
        const confirmPass = DOM.newAdminConfirm.value.trim();

        if (!email || !pass) return alert("Missing credentials!");
        if (pass !== confirmPass) return alert("Passwords mismatch!");
        if (pass.length < 6) return alert("Password must be at least 6 characters.");

        DOM.btnAddAdmin.innerText = "GRANTING...";
        
        db.collection('admin_users').doc(email).get().then(doc => {
            if (doc.exists) {
                DOM.btnAddAdmin.innerText = "GRANT ACCESS";
                return alert("Operator already commissioned.");
            }

            // --- ISO-AUTH PROTOCOL (SECONDARY APP) ---
            // Create a temporary secondary instance to avoid auto-login of the new user
            const tempAppName = "TempRegister_" + Date.now();
            const secondaryApp = firebase.initializeApp(firebaseConfig, tempAppName);

            secondaryApp.auth().createUserWithEmailAndPassword(email, pass).then(userCred => {
                // Now switch back to main DB (db) to save the permissions
                db.collection('admin_users').doc(email).set({
                    email: email,
                    role: "operator",
                    cmds_sent: 0,
                    created_at: firebase.firestore.FieldValue.serverTimestamp(),
                    last_active: firebase.firestore.FieldValue.serverTimestamp(),
                    can_restart: true, can_print: true, can_refresh: true, can_sysinfo: true, 
                    can_sweep: false, can_kill: false, can_uninstall: false, can_schedule: true
                }).then(() => {
                    alert("COMMANDER COMMISSIONED SUCCESSFUL.");
                    DOM.newAdminEmail.value = '';
                    DOM.newAdminPass.value = '';
                    DOM.newAdminConfirm.value = '';
                    DOM.btnAddAdmin.innerText = "GRANT ACCESS";
                    loadAdminsTable();
                    
                    // CLEANUP SECONDARY INSTANCE
                    secondaryApp.delete().catch(() => {});
                });
            }).catch(err => {
                alert("Auth Error: " + err.message);
                DOM.btnAddAdmin.innerText = "GRANT ACCESS";
                // CLEANUP SECONDARY INSTANCE
                secondaryApp.delete().catch(() => {});
            });
        });
    });

    // Update timer for local offline checks (so the UI shifts to red if a node stops pinging)
    setInterval(() => {
        if (DOM.dashboardContainer.classList.contains('hidden')) return;
        renderDevices();
    }, 5000);

    // ==========================================
    // 8. COMMAND LINE INTERFACE (CLI)
    // ==========================================
    DOM.terminalInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const cmdText = DOM.terminalInput.value.trim().toLowerCase();
            if (!cmdText) return;
            if (!activeDeviceId) return logToTerminal('ERROR: No target node selected.', 'error');

            DOM.terminalInput.value = '';

            // --- HARD-FIX GUARD (CLI) ---
            // Exempt LOCAL-ONLY commands from the offline guard
            const localCommands = ['help', 'clear'];
            const isLocal = localCommands.includes(cmdText.split(' ')[0]);
            
            if (!isLocal && isNodeOffline(activeDeviceId)) {
                logToTerminal(`root@spooler:~# ${cmdText}`);
                logToTerminal(`[SYSTEM] Unsuccessful: Device [${activeDeviceId}] is OFFLINE. Protocol rejected.`, 'error');
                return;
            }

            await processTerminalCommand(cmdText);
        }
    });

    async function processTerminalCommand(cmdRaw) {
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
print <node_id>               - Force execute immediate print sweep
schedule <id> <H:i> <H:i>     - Override operating hours

[ADVANCED ARSENAL]
sysinfo <node_id>             - Request detailed hardware/OS telemetry
sweep <node_id>               - Clear printed file cache
kill <node_id>                - Remote Emergency Shutdown
uninstall <node_id>           - Permanent Decommission (Remove Startup)

Note: If <node_id> is omitted, [ACTIVE NODE] will be targeted.`;

        let targetNode = null;
        if (args.length > 1 && !['schedule'].includes(cmd)) {
            targetNode = args[1].toUpperCase();
        } else {
            targetNode = activeDeviceId;
        }

        // Special logic for schedule with optional node_id
        if (cmd === 'schedule') {
            if (args.length === 4) { targetNode = args[1].toUpperCase(); }
        }

        switch (cmd) {
            case 'help':
                logToTerminal(helpText, 'system');
                break;
            case 'clear':
                DOM.logTerminal.innerHTML = '';
                logToTerminal('[SYSTEM] Local terminal cache cleared.', 'success');
                // --- Cloud Wipe for Active Device ---
                if (targetNode) {
                    db.collection('devices').doc(targetNode).update({
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
                pushCommandWithNode(targetNode, 'REFRESH_UI', '');
                break;
            case 'restart':
                if (!targetNode) return logToTerminal('ERROR: No target node selected.', 'error');
                pushCommandWithNode(targetNode, 'RESTART_AGENT', '');
                break;
            case 'print':
                if (!targetNode) return logToTerminal('ERROR: No target node selected.', 'error');
                pushCommandWithNode(targetNode, 'FORCE_PRINT', '');
                break;
            case 'sysinfo':
                if (!targetNode) return logToTerminal('ERROR: No target node selected.', 'error');
                pushCommandWithNode(targetNode, 'GET_SYSINFO', '');
                logToTerminal(`[SYSTEM] Telemetry request dispatched to [${targetNode}]...`, 'success');
                break;
            case 'sweep':
                if (!targetNode) return logToTerminal('ERROR: No target node selected.', 'error');
                pushCommandWithNode(targetNode, 'CLEAR_CACHE', '');
                logToTerminal(`[SYSTEM] Cache clear command sent to [${targetNode}].`, 'success');
                break;
            case 'shutdown':
                if (!targetNode) return logToTerminal('ERROR: No target node selected.', 'error');
                const confirmedShut = await showCyberConfirm("REMOTE SHUTDOWN", `DANGER: Initiating remote shutdown for [${targetNode}]. It will not restart until manual intervention. Proceed?`, "hazard");
                if (!confirmedShut) return;
                pushCommandWithNode(targetNode, 'SHUTDOWN_AGENT', '');
                break;
            case 'kill':
                if (!targetNode) return logToTerminal('ERROR: No target node selected.', 'error');
                const confirmedKill = await showCyberConfirm("EMERGENCY KILL", `Execute remote process termination for [${targetNode}]? Agent will stop immediately.`, "hazard");
                if (!confirmedKill) return;
                pushCommandWithNode(targetNode, 'KILL_AGENT', '');
                db.collection('devices').doc(targetNode).update({ status: 'offline' });
                break;
            case 'uninstall':
                const confirmedUn = await showCyberConfirm("SYSTEM DECOMMISSION", `DANGER: This will PERMANENTLY remove the agent from [${targetNode}]. Proceed?`, "danger");
                if (confirmedUn) {
                    pushCommandWithNode(targetNode, 'UNINSTALL_AGENT', '');
                }
                break;
            case 'schedule':
                let tNode = (args.length === 4) ? args[1].toUpperCase() : activeDeviceId;
                let tStart = (args.length === 4) ? args[2] : (args.length === 3 ? args[1] : null);
                let tEnd = (args.length === 4) ? args[3] : (args.length === 3 ? args[2] : null);

                if (!tNode || !tStart || !tEnd) return logToTerminal('ERROR: Invalid Syntax. Usage: schedule <node_id> 08:00 16:50', 'error');
                pushCommandWithNode(tNode, 'UPDATE_SCHEDULE', `${tStart}|${tEnd}`);
                break;
            default:
                logToTerminal(`INVALID DIRECTIVE: '${cmd}'. Type 'help' for tactical guidance.`, 'error');
        }
    }

    // Bantuan Fungsi Komunikasi untuk CLI yg tidak menggunakan butang activeDevice
    function pushCommandWithNode(nodeId, actionName, payload = '') {
        // Check Permission
        const requiredPerm = ACTION_PERM_MAP[actionName];
        if (requiredPerm && !checkPermission(requiredPerm)) return;

        logToTerminal(`[CMD] Routing directive '${actionName}' to Node [${nodeId}]...`, 'system');
        db.collection('commands').doc(nodeId).set({
            action: actionName,
            payload: payload,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            status: "pending"
        }).then(() => {
            logToTerminal(`[CMD] ${actionName} -> UPLOADED TO CLOUD. Awaiting node fetch!`, 'success');
            // Counter admin
            if (currentLoggedUser) {
                db.collection('admin_users').doc(currentLoggedUser.email).update({
                    cmds_sent: firebase.firestore.FieldValue.increment(1)
                });
            }
        }).catch(err => {
            logToTerminal(`[ERROR] Command dropped: ${err.message}`, 'error');
        });
    }
    // ==========================================
    // 10. CYBER MODAL ENGINE (HACKER STYLE)
    // ==========================================
    function showCyberConfirm(title, message, type = 'primary') {
        const overlay = document.getElementById('cyber-modal-overlay');
        const modal = document.getElementById('active-cyber-modal');
        const titleEl = document.getElementById('cyber-modal-title');
        const msgEl = document.getElementById('cyber-modal-message');
        const btnCancel = document.getElementById('cyber-modal-cancel');
        const btnConfirm = document.getElementById('cyber-modal-confirm');

        // Reset classes
        modal.classList.remove('danger', 'warning');
        if (type === 'danger' || type === 'hazard') modal.classList.add('danger');
        if (type === 'warning') modal.classList.add('warning');

        titleEl.innerText = title;
        msgEl.innerText = message;
        overlay.classList.add('active');

        return new Promise((resolve) => {
            const handleCancel = () => {
                overlay.classList.remove('active');
                btnCancel.removeEventListener('click', handleCancel);
                btnConfirm.removeEventListener('click', handleConfirm);
                resolve(false);
            };
            const handleConfirm = () => {
                overlay.classList.remove('active');
                btnCancel.removeEventListener('click', handleCancel);
                btnConfirm.removeEventListener('click', handleConfirm);
                resolve(true);
            };

            btnCancel.addEventListener('click', handleCancel);
            btnConfirm.addEventListener('click', handleConfirm);
        });
    }

    // ==========================================
    // 11. LIVE QUARTZ ENGINE (TICKS CLOCKS)
    // ==========================================
    setInterval(() => {
        const liveClocks = document.querySelectorAll('.device-card:not(.dimmed) .live-clock');
        const now = new Date().toLocaleTimeString();
        liveClocks.forEach(clock => {
            clock.innerText = now;
        });
    }, 1000);

}); // End of DOMContentLoaded
