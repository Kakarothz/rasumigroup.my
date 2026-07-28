/**
 * VIMS AUTO SELESAI MONITOR LOGIC (v5.0 STABLE - FULL RESTORATION)
 * Author: Mustaqim | Production Grade
 */

class AdminMonitor {
    constructor() {
        this.branches = new Map();
        this.processedLogs = new Set();
        this.isInitialSync = true;
        this.expandedPcId = null; // Track which PC submenu is open
        this.config = {
            pingThresholdIdle: 60,
            pingThresholdOffline: 90,
            autoScrollFeed: true,
            errorFilter: false,
            pollRate: 2000,
            databaseURL: "https://vims-auto-selesai-default-rtdb.asia-southeast1.firebasedatabase.app",
            apiKey: "AIzaSyCE2lm0_SKnXXZCTY4jyr1kcjk9Qwfk19k" // Added API Key
        };

        this.init();
    }

    init() {
        this.cacheDOM();
        this.attachEventListeners();
        this.startStateEngine();
        this.cleanupOldLogs();
        this.startLiveMode();
    }

    cacheDOM() {
        this.dom = {
            container: document.getElementById('branch-cards-container'),
            terminal: document.getElementById('terminal-feed'),
            stats: {
                branch: document.getElementById('stat-branch'),
                devices: document.getElementById('stat-devices'),
                errors: document.getElementById('stat-errors'),
                latency: document.getElementById('stat-latency'),
                myPcId: document.getElementById('my-pc-id')
            },
            statusIndicator: document.getElementById('liveStatus'),
            globalAlert: document.getElementById('global-alert'),
            wipeBtn: document.getElementById('clearAllLogsBtn'),
            errorOverlay: document.getElementById('error-overlay'),
            feedStatus: document.getElementById('feed-status'),
            deviceMenu: document.getElementById('device-menu'),
            devicesContainer: document.getElementById('stat-devices-container')
        };
        this.lastEventTime = Date.now();
    }

    attachEventListeners() {
        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'e') this.toggleErrorFilter();
            if (e.key.toLowerCase() === 'r') location.reload();
        });

        this.dom.terminal.addEventListener('scroll', () => {
            const isAtBottom = this.dom.terminal.scrollHeight - this.dom.terminal.scrollTop <= this.dom.terminal.clientHeight + 2;
            this.config.autoScrollFeed = isAtBottom;
        });

        this.dom.container.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;

            const { action, branchId, type } = target.dataset;
            if (action === 'download') this.downloadBranchLogs(branchId);
            if (action === 'refresh') this.sendRefreshCommand(branchId);
            if (action === 'filter') this.filterCardLogs(branchId, type);
        });

        // Identify "My PC ID"
        if (chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ type: "GET_CURRENT_STATS" }, (res) => {
                if (res && res.deviceId && this.dom.stats.myPcId) {
                    this.dom.stats.myPcId.textContent = `DEVICE: ${res.deviceId}`;
                }
            });
        }

        if (this.dom.wipeBtn) {
            if (this.dom.devicesContainer) {
                this.dom.devicesContainer.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleDeviceMenu();
                });
            }

            // Handle accordion toggles via delegation
            this.dom.deviceMenu.addEventListener('click', (e) => {
                e.stopPropagation();
                const btn = e.target.closest('.device-header-btn');
                if (btn && btn.dataset.pcId) {
                    this.togglePcDetail(btn.dataset.pcId);
                }
            });

            document.addEventListener('click', () => {
                if (this.dom.deviceMenu) this.dom.deviceMenu.style.display = 'none';
            });

            this.dom.wipeBtn.addEventListener('click', () => {
                if (confirm("🚨 WIPE ALL LOGS GLOBALLY? This cannot be undone.")) {
                    this.wipeAllLogs();
                }
            });
        }
    }

    startLiveMode() {
        this.syncFirebase();
        setInterval(() => this.syncFirebase(), this.config.pollRate);
        setInterval(() => this.updateFeedStatus("idle"), 60000);
    }

    async syncFirebase() {
        const fetchStart = performance.now();
        const ts = Math.floor(Date.now() / 1000);

        try {
            const baseUrl = this.config.databaseURL.endsWith('/') ? this.config.databaseURL.slice(0, -1) : this.config.databaseURL;
            const auth = `key=${this.config.apiKey}`;
            
            const [bRes, pRes, lRes] = await Promise.all([
                fetch(`${baseUrl}/branches.json?${auth}&t=${ts}`),
                fetch(`${baseUrl}/presence.json?${auth}&t=${ts}`),
                fetch(`${baseUrl}/logs.json?${auth}&t=${ts}`)
            ]);

            if (!bRes.ok || !pRes.ok) {
                console.warn(`[Firebase] Fetch error. Branches: ${bRes.status}, Presence: ${pRes.status}`);
                if (bRes.status === 403 || pRes.status === 403) {
                    this.dbStatus = "LOCKED";
                    return;
                }
                this.dbStatus = `ERR_${bRes.status || 'OFFLINE'}`;
                return;
            }

            const branchesData = await bRes.json();
            const presenceData = await pRes.json();
            const logsData = await lRes.json();

            // DEBUG LOG: See what's actually inside the database
            console.log("📂 RAW FIREBASE DATA:", { branches: branchesData, presence: presenceData });

            // Guard against Firebase error responses being treated as data
            if (branchesData && branchesData.error) {
                this.dbStatus = "LOCKED";
                return;
            }
            this.dbStatus = "CONNECTED";

            if (branchesData) {
                Object.keys(branchesData).forEach(id => {
                    if (id.toLowerCase().includes('mustaqim') || id.toLowerCase().includes('super_admin')) return;
                    if (!this.branches.has(id)) {
                        this.branches.set(id, {
                            name: branchesData[id].name || id,
                            jobs: 0, errors: 0,
                            lastHeartbeat: 0, lastActive: 0, lastLogTime: Math.floor(Date.now() / 1000),
                            state: 'OFFLINE', cardLogs: [], filter: 'all', activeModes: [], activeDevicesCount: 0
                        });
                    }
                });
            }

            if (presenceData) {
                // 1. First Pass: Aggressive Normalization and Branch Registration
                Object.keys(presenceData).forEach(id => {
                    if (id.toLowerCase().includes('mustaqim') || id.toLowerCase().includes('super_admin')) return;

                    const devices = presenceData[id];
                    let branchName = id;

                    if (devices) {
                        const firstDev = Object.values(devices).find(d => d.name);
                        if (firstDev) branchName = firstDev.name;
                    }

                    const norm = this.formatName(branchName).replace(/[()]/g, '').replace(/\s+/g, ' ').trim();

                    if (!this.branches.has(id)) {
                        this.branches.set(id, {
                            name: branchName, norm: norm, jobs: 0, errors: 0,
                            lastHeartbeat: 0, lastActive: 0, lastLogTime: Math.floor(Date.now() / 1000),
                            state: 'OFFLINE', cardLogs: [], filter: 'all', activeModes: [], activeDevicesCount: 0
                        });
                    }
                });

                // 2. Second Pass: Data Aggregation per Branch Group
                const groupData = {};
                const now = Math.floor(Date.now() / 1000);

                this.branches.forEach((b, id) => {
                    const devices = presenceData[id];
                    if (!devices) return;

                    const norm = b.norm || this.formatName(b.name);
                    if (!groupData[norm]) groupData[norm] = { ids: [], modes: new Set(), devices: 0, maxSeen: 0, anyProcessing: false, name: b.name };

                    groupData[norm].ids.push(id);

                    const deviceList = {};
                    const pcPrefixedKeys = Object.keys(devices).filter(k => k.startsWith('PC-'));

                    if (pcPrefixedKeys.length > 0) {
                        pcPrefixedKeys.forEach(key => {
                            const val = devices[key];
                            if (val && typeof val === 'object' && val.lastSeen) deviceList[key] = val;
                        });
                    } else if (devices.lastSeen && typeof devices.lastSeen === 'number') {
                        deviceList["PC-Legacy"] = devices;
                    }

                    Object.values(deviceList).forEach(dev => {
                        const lastSeen = dev.lastSeen || 0;
                        if (lastSeen > 0 && Math.abs(now - lastSeen) < 45) {
                            groupData[norm].devices++;
                            if (dev.mode) groupData[norm].modes.add(dev.mode.toLowerCase().trim());
                            if (lastSeen > groupData[norm].maxSeen) groupData[norm].maxSeen = lastSeen;
                            if (dev.status === 'PROCESSING') groupData[norm].anyProcessing = true;

                            if (!groupData[norm].pcList) groupData[norm].pcList = [];
                            const pcId = Object.keys(deviceList).find(key => deviceList[key] === dev) || "Unknown PC";
                            groupData[norm].pcList.push({ id: pcId, mode: dev.mode || 'Walk-IN' });
                        }
                    });
                });

                // 3. Third Pass: Sync back and prune
                Object.keys(groupData).forEach(norm => {
                    const group = groupData[norm];
                    const primaryId = group.ids.sort((a, b) => b.includes('_') - a.includes('_'))[0];
                    const b = this.branches.get(primaryId);

                    if (b) {
                        const prevModes = (b.activeModes || []).sort().join(',');
                        const newModes = Array.from(group.modes).sort();
                        b.activeModes = newModes;
                        b.activeDevicesCount = group.devices;
                        b.activePcList = group.pcList || [];
                        b.lastHeartbeat = group.maxSeen;
                        b.state = group.devices > 0 ? (group.anyProcessing ? 'PROCESSING' : 'ACTIVE') : 'OFFLINE';

                        if (prevModes !== newModes.join(',')) this.render();

                        if (b.activePcList.length > 0) {
                            b.activePcList.forEach(pc => {
                                const discoverKey = `DISCOVER_${primaryId}_${pc.id}`;
                                if (!this.processedLogs.has(discoverKey)) {
                                    const isLegacy = pc.id === 'PC-Legacy';
                                    const msg = isLegacy
                                        ? `⚠️ Legacy Device Connected (Outdated Version - Please Reload)`
                                        : `📡 Device Connected: ${pc.id} [${pc.mode.toUpperCase()}]`;
                                    this.addLogEntry(primaryId, msg, "system");
                                    this.processedLogs.add(discoverKey);
                                }
                            });
                        }
                    }

                    group.ids.forEach(id => {
                        if (id !== primaryId) {
                            const card = document.getElementById(`card-${id}`);
                            if (card) card.remove();
                            this.branches.delete(id);
                        }
                    });
                });
            }

            if (logsData) {
                const newLogs = [];
                Object.keys(logsData).forEach(branchId => {
                    const branchLogs = logsData[branchId];
                    if (branchLogs && typeof branchLogs === 'object') {
                        Object.keys(branchLogs).forEach(logKey => {
                            const uniqueKey = `${branchId}_${logKey}`;
                            if (!this.processedLogs.has(uniqueKey)) {
                                const log = branchLogs[logKey];
                                if (log.msg && this.isToday(log.ts)) {
                                    newLogs.push({ branchId, log, uniqueKey, sortKey: logKey });
                                } else if (!this.isInitialSync) {
                                    this.processedLogs.add(uniqueKey);
                                }
                            }
                        });
                    }
                });

                if (newLogs.length > 0) {
                    newLogs.sort((a, b) => a.log.ts !== b.log.ts ? a.log.ts - b.log.ts : a.sortKey.localeCompare(b.sortKey));

                    let lastMsg = "";
                    let lastTime = 0;

                    newLogs.forEach(i => {
                        // Deduplication: Skip if message is identical and within 60s
                        const isDuplicate = i.log.msg === lastMsg && (i.log.ts - lastTime) < 60000;
                        if (!isDuplicate) {
                            this.addLogEntry(i.branchId, i.log.msg, "branch", i.log.ts);
                            lastMsg = i.log.msg;
                            lastTime = i.log.ts;
                        }
                        this.processedLogs.add(i.uniqueKey);
                    });
                }
            }

            this.isInitialSync = false;
            if (this.dom.stats.latency) this.dom.stats.latency.textContent = `${Math.round(performance.now() - fetchStart)}ms`;

            // Immediate menu refresh for 'serta-merta' updates if open
            if (this.dom.deviceMenu && this.dom.deviceMenu.style.display === 'block') {
                this.renderDeviceMenu();
            }
        } catch (e) {
            console.error("❌ Sync Error:", e);
            this.dbStatus = "OFFLINE";
        }
    }

    startStateEngine() {
        setInterval(() => {
            this.updateBranchStates();
            this.updateGlobalStats();
            this.updateFeedStatus();
            this.render();
        }, 1000);
    }

    updateBranchStates() {
        const now = Math.floor(Date.now() / 1000);
        this.branches.forEach((branch, id) => {
            const heartbeatDiff = now - (branch.lastHeartbeat || 0);
            const logDiff = now - (branch.lastLogTime || now);
            const formerState = branch.state;

            if (heartbeatDiff > 12) {
                branch.state = 'OFFLINE';
            } else if (branch.state === 'PROCESSING') {
                branch.state = 'PROCESSING';
            } else if (logDiff < 60) {
                branch.state = 'ACTIVE';
            } else {
                branch.state = 'IDLE';
            }
        });
    }

    updateGlobalStats() {
        let onlineBranches = 0;
        let totalBranches = 0;
        let totalDevices = 0;
        let errors = 0;

        this.branches.forEach(b => {
            if (b.state !== 'OFFLINE') onlineBranches++;
            totalBranches++;
            errors += b.errors || 0;
            totalDevices += (b.activeDevicesCount || 0);
        });

        this.dom.stats.branch.textContent = `${onlineBranches}/${totalBranches}`;
        this.dom.stats.devices.textContent = totalDevices || 0;
        this.dom.stats.errors.textContent = errors;

        this.updateGlobalBadge(onlineBranches, errors);

        // Update Device Menu if open
        if (this.dom.deviceMenu && this.dom.deviceMenu.style.display === 'block') {
            this.renderDeviceMenu();
        }

        if (this.dom.errorOverlay) this.dom.errorOverlay.classList.toggle('active', errors > 0);
    }

    toggleDeviceMenu() {
        const menu = this.dom.deviceMenu;
        if (!menu) return;
        
        let totalDevices = 0;
        this.branches.forEach(b => totalDevices += (b.activeDevicesCount || 0));
        if (totalDevices === 0) return; // No click if 0

        if (menu.style.display === 'none') {
            this.renderDeviceMenu();
            menu.style.display = 'block';
        } else {
            menu.style.display = 'none';
        }
    }

    togglePcDetail(pcId) {
        this.expandedPcId = (this.expandedPcId === pcId) ? null : pcId;
        this.renderDeviceMenu();
    }

    renderDeviceMenu() {
        const menu = this.dom.deviceMenu;
        if (!menu) return;

        const allPcs = [];
        this.branches.forEach((b, branchId) => {
            if (b.activePcList && b.activePcList.length > 0) {
                b.activePcList.forEach(pc => {
                    allPcs.push({ ...pc, branchId, branchName: this.formatName(b.name) });
                });
            }
        });

        if (allPcs.length === 0) {
            menu.innerHTML = '<div class="device-empty">NO ACTIVE DEVICES</div>';
            return;
        }

        menu.innerHTML = allPcs.map(pc => {
            const isExpanded = this.expandedPcId === pc.id;
            return `
                <div class="device-accordion-item">
                    <div class="device-header-btn ${isExpanded ? 'active' : ''}" data-pc-id="${pc.id}">
                        <span>${pc.id}</span>
                    </div>
                    <div class="device-submenu ${isExpanded ? 'active' : ''}">
                        <div class="submenu-inner">
                            <div class="submenu-branch">${pc.branchName}</div>
                            <div class="submenu-mode">${pc.mode.toUpperCase()}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateGlobalBadge(onlineBranches, errors) {
        const status = this.dom.statusIndicator;
        if (!status) return;

        if (this.dbStatus === "LOCKED") {
            status.textContent = "⚠ DB LOCKED";
            status.className = "badge badge-live blinking error";
            if (this.dom.globalAlert) {
                this.dom.globalAlert.style.display = "inline-block";
                this.dom.globalAlert.textContent = "⚠ DATABASE ERROR: PLEASE CHECK FIREBASE RULES";
            }
        } else if (this.dbStatus && this.dbStatus.startsWith("ERR_")) {
            status.textContent = `○ ${this.dbStatus.replace("ERR_", "HTTP ")}`;
            status.className = "badge badge-live offline";
        } else if (this.dbStatus === "OFFLINE") {
            status.textContent = "○ OFFLINE";
            status.className = "badge badge-live offline";
        } else {
            // Database is CONNECTED
            if (onlineBranches > 0) {
                status.textContent = "● ONLINE";
                status.className = "badge badge-live blinking online";
            } else {
                status.textContent = "○ NO DEVICES";
                status.className = "badge badge-live offline";
            }
            if (this.dom.globalAlert) this.dom.globalAlert.style.display = errors > 0 ? 'inline-block' : 'none';
        }
    }

    isToday(timestamp) {
        if (!timestamp) return false;
        return new Date(timestamp).toDateString() === new Date().toDateString();
    }

    async cleanupOldLogs() {
        try {
            const baseUrl = this.config.databaseURL.endsWith('/') ? this.config.databaseURL.slice(0, -1) : this.config.databaseURL;
            const auth = `key=${this.config.apiKey}`;
            const res = await fetch(`${baseUrl}/logs.json?${auth}&t=${Date.now()}`);
            const logsData = await res.json();
            if (!logsData) return;
            const today = new Date().toLocaleDateString('en-GB');
            for (const branchId of Object.keys(logsData)) {
                for (const logKey of Object.keys(logsData[branchId])) {
                    const log = logsData[branchId][logKey];
                    if (log.date && log.date !== today) {
                        await fetch(`${baseUrl}/logs/${branchId}/${logKey}.json?${auth}`, { method: 'DELETE' });
                    }
                }
            }
        } catch (e) {
            console.error("❌ Cleanup Error:", e);
        }
    }

    async wipeAllLogs() {
        if (!confirm("This will clear ALL branch cards, presence data, and logs. Proceed?")) return;
        try {
            const baseUrl = this.config.databaseURL.endsWith('/') ? this.config.databaseURL.slice(0, -1) : this.config.databaseURL;
            const auth = `key=${this.config.apiKey}`;
            await Promise.all([
                fetch(`${baseUrl}/logs.json?${auth}`, { method: 'DELETE' }),
                fetch(`${baseUrl}/branches.json?${auth}`, { method: 'DELETE' }),
                fetch(`${baseUrl}/presence.json?${auth}`, { method: 'DELETE' })
            ]);
            location.reload();
        } catch (e) { console.error("❌ Wipe Error:", e); }
    }

    renderModeBadges(modes = []) {
        if (!modes || modes.length === 0) return '<span class="mode-badge">[ Walk-IN ]</span>';
        return modes.map(m => {
            const label = m.toLowerCase().includes('courier') ? 'Courier' : 'Walk-IN';
            return `<span class="mode-badge ${label.toLowerCase()}">[ ${label} ]</span>`;
        }).join(' ');
    }

    formatName(name) {
        if (!name) return "UNKNOWN";
        // Convert underscores to spaces, remove parentheses, and normalize spacing
        return name.toString()
            .replace(/_/g, ' ')
            .replace(/[()]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();
    }

    getShortId(id) {
        const mapping = {
            'rasumifvkl': 'FVKL',
            'rasumifvt': 'FVT',
            'rasumifvl': 'FVL',
            'rasumifvg': 'FVG',
            'mustaqim': 'Super Admin'
        };
        const normalizedId = id.toLowerCase();
        if (mapping[normalizedId]) return mapping[normalizedId];

        const branch = this.branches.get(id);
        const name = branch ? branch.name : id;

        if (id.toLowerCase().includes('fvkl') || name.toLowerCase().includes('kl')) return 'FVKL';
        if (id.toLowerCase().includes('terendak')) return 'FVT';
        if (id.toLowerCase().includes('gemas')) return 'FVG';
        if (id.toLowerCase().includes('fvl') || name.toLowerCase().includes('lumut')) return 'FVL';

        return id.substring(0, 4).toUpperCase();
    }

    addLogEntry(branchId, rawMessage, type = "branch", timestamp = null) {
        const now = timestamp ? new Date(timestamp) : new Date();
        const displayTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        const shortId = this.getShortId(branchId);
        const modeMatch = rawMessage.match(/\[(.*?)\]/);

        let status = "Processing", details = "", isError = false;

        // --- RESTORE ORIGINAL MAPPING (STRICT) ---
        if (rawMessage.includes("PROCESSING_ERROR")) {
            status = "Error";
            details = rawMessage.replace("PROCESSING_ERROR:", "").trim();
            isError = true;
        } else if (rawMessage.includes("BATCH_COMPLETED")) {
            status = "Completed";
            const count = rawMessage.match(/\d+/);
            const modeInfo = modeMatch ? `[${modeMatch[1]}]` : "";
            details = `${count ? count[0] : '??'}/Jobs${modeInfo} End Of Process`;
        } else if (rawMessage.includes("START_QUEUE")) {
            status = "Scanning";
            const countMatch = rawMessage.match(/(\d+) jobs/);
            const modeInfo = modeMatch ? `[${modeMatch[1]}]` : "";
            details = `${countMatch ? countMatch[1] : '??'}/Jobs${modeInfo}`;
        } else if (rawMessage.includes("LOGGED_IN")) {
            status = "Logged-In";
            details = now.toLocaleDateString('en-GB').replace(/\//g, '-');
        } else if (rawMessage.includes("PROCESSING")) {
            status = "Processing";
            details = rawMessage.replace("PROCESSING:", "").replace(/\[.*?\]/g, "").trim();
        } else if (rawMessage.includes("MODE_CHANGE")) {
            status = "Mode-Changed";
            details = rawMessage.replace("MODE_CHANGE:", "").replace(/\[.*?\]/g, "").trim();
        } else {
            status = "Processing";
            details = rawMessage.replace(/\[.*?\]/g, "").trim();
        }

        const entry = document.createElement('div');
        entry.className = `t-line ${type} ${isError ? 'error' : ''}`;
        if (type === "system") entry.classList.add("sys");

        // --- CONSTRUCT TERMINAL MESSAGE ---
        let terminalMsg = details;
        if (status === "Completed") {
            terminalMsg = `${status}: ${details.replace(" End Of Process", "")}`;
        } else if (status !== "Processing") {
            terminalMsg = `${status}: ${details}`;
        }

        entry.innerHTML = `
            <span class="t-time">${displayTime}</span>
            <span class="t-branch">[${type === 'system' ? 'SYS' : shortId}]/></span>
            <span class="t-msg">${terminalMsg}</span>
        `;

        const isProcessing = rawMessage.includes("PROCESSING") && !rawMessage.includes("ERROR") && !rawMessage.includes("COMPLETED");
        const skipGlobal = (type === "branch" && isProcessing && !rawMessage.includes("MODE_CHANGE")) || this.isInitialSync;

        if (!skipGlobal && this.dom.terminal) {
            this.dom.terminal.appendChild(entry);
            if (this.config.autoScrollFeed) this.dom.terminal.scrollTop = this.dom.terminal.scrollHeight;
        }

        if (type === "branch") {
            const b = this.branches.get(branchId);
            if (b && (status === "Processing" || isError || status === "Completed")) {
                // Track last activity time based on actual processing
                if (status === "Processing" || status === "Completed") {
                    const logSeconds = Math.floor(now.getTime() / 1000);
                    if (!b.lastLogTime || logSeconds > b.lastLogTime) {
                        b.lastLogTime = logSeconds;
                    }
                }

                if (!this.isInitialSync) {
                    if (status === "Processing") b.jobs = (b.jobs || 0) + 1;
                    if (isError) b.errors = (b.errors || 0) + 1;
                    if (!b.startTime) b.startTime = Date.now();
                }
                if (!b.cardLogs) b.cardLogs = [];
                b.cardLogs.push({
                    ts: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
                    msg: details, isError, mode: b.mode || 'walkin'
                });
                if (b.cardLogs.length > 50) b.cardLogs.shift();

                const card = document.getElementById(`card-${branchId}`);
                if (card) {
                    const term = card.querySelector('.card-inner-terminal');
                    this.renderCardLogs(term, b);
                }
            }
        }
        this.lastEventTime = Date.now();
    }

    updateFeedStatus(state = "idle") {
        if (!this.dom.feedStatus) return;
        const diffMs = Date.now() - this.lastEventTime;
        const diffSecs = Math.floor(diffMs / 1000);
        const timeStr = diffSecs < 60 ? `${diffSecs}s ago` : `${Math.floor(diffSecs / 60)}m ago`;

        // 10-Minute Idle Logic (600,000ms)
        const isIdleWarning = diffMs > 600000;
        const dotClass = isIdleWarning ? "blink-dot warning" : "blink-dot active";

        this.dom.feedStatus.innerHTML = `
            <span class="${dotClass}"></span> 
            ${state === "processing" ? "monitoring events" : "waiting events"} 
            <span style="opacity:0.5; margin-left:10px;">last: ${timeStr}</span>
        `;
    }

    render() {
        if (this.branches.size === 0) {
            if (!this.dom.container.querySelector('.empty-state')) {
                this.dom.container.innerHTML = `<div class="empty-state">WAITING FOR CONNECTION...</div>`;
            }
            return;
        }

        const emptyState = this.dom.container.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const sortedIds = Array.from(this.branches.keys()).sort((idA, idB) => {
            const a = this.branches.get(idA), b = this.branches.get(idB);
            const p = { 'PROCESSING': 3, 'ACTIVE': 3, 'IDLE': 2, 'OFFLINE': 1 };
            return (p[b.state] - p[a.state]) || (b.lastActive - a.lastActive);
        });

        const seenNames = new Set();
        sortedIds.forEach(id => {
            const branch = this.branches.get(id);
            const displayName = this.formatName(branch.name || id);

            // SMART FILTER: Strictly ensure no UI duplication
            if (seenNames.has(displayName)) {
                const card = document.getElementById(`card-${id}`);
                if (card) card.remove();
                return;
            }
            seenNames.add(displayName);

            let card = document.getElementById(`card-${id}`);
            if (!card) {
                card = this.createBranchCard(id, branch);
                this.dom.container.appendChild(card);
            }
            this.updateBranchCard(card, branch);
        });
    }

    createBranchCard(id, data) {
        const div = document.createElement('div');
        div.id = `card-${id}`;
        div.className = `branch-card ${data.state.toLowerCase()}`;
        div.innerHTML = `
            <div class="card-header-section">
                <div class="card-header">
                    <div class="header-left"><span class="ping-indicator"></span><span class="card-title">${this.formatName(data.name || id)}</span></div>
                    <div class="header-actions">
                        <svg class="card-icon" viewBox="0 0 24 24" data-action="download" data-branch-id="${id}"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                        <svg class="card-icon" viewBox="0 0 24 24" data-action="refresh" data-branch-id="${id}"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                    </div>
                </div>
                <div class="card-metrics-row">
                    <div class="metric-item">Jobs: <span class="m-jobs">0</span></div>
                    <div class="metric-item">Err: <span class="m-errs">0</span></div>
                    <div class="metric-item">Rate: <span class="m-rate">0.0/min</span></div>
                    <div class="metric-item">Last: <span class="m-last">0s</span></div>
                </div>
            </div>
            <div class="card-footer-row">
                <div class="footer-badges">
                    <span class="filter-badge active" data-action="filter" data-branch-id="${id}" data-type="all">[ ALL ]</span>
                    <span class="filter-badge error" data-action="filter" data-branch-id="${id}" data-type="error">[ ERRORS ]</span>
                </div>
                <div class="mode-badges">
                    ${this.renderModeBadges(data.activeModes)}
                </div>
            </div>
            <div class="card-inner-terminal"></div>
        `;
        return div;
    }

    updateBranchCard(card, b) {
        card.className = `branch-card ${b.state.toLowerCase()}`;
        card.querySelector('.m-jobs').textContent = b.jobs || 0;
        card.querySelector('.m-errs').textContent = b.errors || 0;
        card.querySelector('.m-rate').textContent = `${this.calculateRate(b)}/min`;

        // Calculate 'Last' based on last actual log/process
        const now = Math.floor(Date.now() / 1000);
        const lastLog = b.lastLogTime || b.lastActive || b.lastHeartbeat || now;
        const lastProcessDiff = now - lastLog;
        card.querySelector('.m-last').textContent = `${Math.max(0, lastProcessDiff)}s`;

        card.querySelector('.mode-badges').innerHTML = this.renderModeBadges(b.activeModes);

        const badges = card.querySelectorAll('.filter-badge');
        badges.forEach(badge => badge.classList.toggle('active', (b.filter || 'all') === badge.dataset.type));

        const term = card.querySelector('.card-inner-terminal');
        if (term) this.renderCardLogs(term, b);
    }

    filterCardLogs(branchId, type) {
        const branch = this.branches.get(branchId);
        if (!branch) return;
        branch.filter = type;
        const card = document.getElementById(`card-${branchId}`);
        if (card) {
            const term = card.querySelector('.card-inner-terminal');
            this.renderCardLogs(term, branch);
        }
    }

    renderCardLogs(term, b) {
        if (!term) return;
        const filtered = (b.cardLogs || []).filter(l => (b.filter || 'all') === 'error' ? l.isError : true);
        if (filtered.length === 0) {
            term.innerHTML = `<div class="empty-log-state">NO DATA</div>`;
            return;
        }
        term.innerHTML = filtered.map(l => {
            const isCourier = l.mode === 'Courier';
            const suffix = isCourier ? ' - - Courier' : ' - - Walk-IN';

            // Only append suffix if message is a numeric DO (or if it doesn't already contain a mode/suffix)
            let displayMsg = l.msg;
            const isNumericDO = /^\d+$/.test(displayMsg.trim());
            if (isNumericDO && !displayMsg.includes(' - - ')) {
                displayMsg += suffix;
            }

            return `
                <div class="card-log-line ${isCourier ? 'courier-tint' : ''}">
                    <span class="log-ts">${l.ts}</span>
                    <span class="log-icon ${l.isError ? 'error' : (isCourier ? 'courier' : 'success')}">${l.isError ? '✖' : '✔'}</span>
                    <span class="log-msg ${l.isError ? 'error' : (isCourier ? 'courier' : '')}">${displayMsg}</span>
                </div>
            `;
        }).join('');
        term.scrollTop = term.scrollHeight;
    }

    calculateRate(b) {
        const uptime = (Date.now() - (b.startTime || Date.now())) / 60000;
        return uptime < 0.1 ? "0.0" : (b.jobs / uptime).toFixed(1);
    }

    updateDatabaseStatus(status) {
        if (!this.dom.statusIndicator) return;
        if (status === "LOCKED") {
            this.dom.statusIndicator.textContent = "⚠ DATABASE LOCKED";
            this.dom.statusIndicator.className = "badge badge-live blinking error";
            if (this.dom.globalAlert) {
                this.dom.globalAlert.style.display = "inline-block";
                this.dom.globalAlert.textContent = "⚠ DATABASE ERROR: PLEASE CHECK FIREBASE RULES";
            }
        } else {
            const isOffline = status === "OFFLINE";
            this.dom.statusIndicator.textContent = isOffline ? "○ OFFLINE" : "● SYNC LIVE";
            this.dom.statusIndicator.className = `badge badge-live ${isOffline ? "offline" : "blinking online"}`;
            if (this.dom.globalAlert) this.dom.globalAlert.style.display = "none";
        }
    }

    sendRefreshCommand(branchId) {
        if (!confirm(`Remote refresh ${branchId}?`)) return;
        const baseUrl = this.config.databaseURL.endsWith('/') ? this.config.databaseURL.slice(0, -1) : this.config.databaseURL;
        const auth = `key=${this.config.apiKey}`;
        fetch(`${baseUrl}/commands/${branchId}/refresh.json?${auth}`, { method: 'PUT', body: JSON.stringify(Date.now()) })
            .then(() => this.addLogEntry(branchId, `REFRESHED REMOTELY`, "system"));
    }

    downloadBranchLogs(branchId) { alert(`Exporting ${branchId} logs...`); }

    toggleErrorFilter() {
        // Toggles the live SOC feed to show only error lines (hotkey 'E').
        // NOTE: does not touch this.dom.feedStatus — that node's innerHTML is
        // fully re-rendered every second by updateFeedStatus(), so anything
        // appended there would get wiped out on the next tick.
        this.config.errorFilter = !this.config.errorFilter;
        if (this.dom.terminal) {
            this.dom.terminal.classList.toggle('errors-only', this.config.errorFilter);
        }
    }
}

window.adminMonitorInstance = new AdminMonitor();
