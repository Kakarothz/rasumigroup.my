// ─────────────────────────────────────────────────────────────
// devices.js — Firestore device listener, node list, and detail panel
// ─────────────────────────────────────────────────────────────
APP.startDeviceListener = function () {
    logToTerminal(`[SYSTEM] Establishing uplink to Firestore <devices> vault...`);

    if (APP.state.unsubDevices) APP.state.unsubDevices();

    APP.state.unsubDevices = APP.db.collection('devices').onSnapshot(snapshot => {
        APP.state.lastSyncTime = Date.now();
        APP.state.currentDevices = [];
        // Cap seenLogs to prevent unbounded memory growth over long sessions
        if (APP.state.seenLogs.size > 2000) APP.state.seenLogs.clear();

        snapshot.forEach(doc => {
            const data     = doc.data();
            const deviceId = doc.id;

            if (data.type === 'vims' || deviceId.toLowerCase().includes('vims')) {
                APP.state.currentDevices.push({ id: deviceId, ...data });

                if (data.live_logs && Array.isArray(data.live_logs)) {
                    data.live_logs.forEach(msg => {
                        const logKey = `${deviceId}_${msg}`;
                        if (!APP.state.seenLogs.has(logKey)) {
                            const upperMsg = msg.toUpperCase();
                            let logType = 'system';
                            if (upperMsg.includes('MANUAL TRIGGER')) logType = 'success';
                            else if (upperMsg.includes('ERROR') || upperMsg.includes('FAIL') || upperMsg.includes('WARNING')) logType = 'error';
                            else if (upperMsg.includes('IDLE')) logType = 'warning';
                            logToTerminal(`[${deviceId}] ${msg}`, logType);
                            APP.state.seenLogs.add(logKey);
                        }
                    });
                }
            }
        });

        APP.renderDevices();
        APP.generateAlerts();

        if (APP.state.activeDeviceId) {
            const upToDateDev = APP.state.currentDevices.find(d => d.id === APP.state.activeDeviceId);
            if (upToDateDev) {
                APP.openDevicePanel(upToDateDev);
            } else {
                APP.state.activeDeviceId = null;
                APP.DOM.focusEmpty.classList.remove('hidden');
                APP.DOM.focusContent.classList.add('hidden');
            }
        }
    }, err => {
        logToTerminal(`[FATAL] Firestore Uplink Failed: ${err.message}`, 'error');
    });
};

// Formats "time since last real Firestore push" for the LAST SYNC TIME card.
// This reflects the actual listener heartbeat (set in startDeviceListener's
// onSnapshot callback above) — not a decorative clock. If the listener stalls
// (backgrounded tab, dropped connection, silent Firestore error) the admin
// sees this value grow stale instead of a clock that always looks live.
APP.updateSyncDisplay = function () {
    const D = APP.DOM;
    if (!D || !D.metricSync) return;

    if (!APP.state.lastSyncTime) {
        D.metricSync.innerText = '--:--:--';
        return;
    }

    const elapsedMs = Date.now() - APP.state.lastSyncTime;
    let text;
    if (elapsedMs < 5000)          text = 'Live';
    else if (elapsedMs < 60000)    text = Math.floor(elapsedMs / 1000) + 's ago';
    else if (elapsedMs < 3600000)  text = Math.floor(elapsedMs / 60000) + 'm ago';
    else                           text = new Date(APP.state.lastSyncTime).toLocaleTimeString();

    D.metricSync.innerText = text;
    // Same 90s threshold used elsewhere for device staleness — here it flags
    // that the DASHBOARD's own connection to Firestore has gone quiet.
    D.metricSync.classList.toggle('text-error', elapsedMs > 90000);
};

APP.renderDevices = function () {
    const D = APP.DOM;
    if (!D.deviceList) return;
    D.deviceList.innerHTML = '';

    let onlineCount    = 0;
    let offlineCount   = 0;
    let generatedToday = 0;
    let failedToday    = 0;

    APP.state.currentDevices.forEach(dev => {
        let LSTime = 0;
        if (dev.last_seen) {
            if (typeof dev.last_seen.toMillis === 'function') LSTime = dev.last_seen.toMillis();
            else if (typeof dev.last_seen === 'string') LSTime = Date.parse(dev.last_seen);
        }

        const isExplicitlyOffline   = dev.status === 'offline';
        const isExplicitlyHibernate = dev.status === 'hibernate';
        const isExplicitlyIdle      = dev.status === 'idle';
        const isStale               = (Date.now() - LSTime) > 90000;
        const finalOffline          = isStale || isExplicitlyOffline;

        if (finalOffline && !isExplicitlyHibernate) offlineCount++;
        else if (!isExplicitlyHibernate) onlineCount++;

        let statusColorClass = 'idle';
        let statusText       = 'IDLE';

        if (isExplicitlyHibernate) {
            statusColorClass = 'working';
            statusText       = 'HIBERNATING';
        } else if (!finalOffline) {
            if (isExplicitlyIdle) {
                statusColorClass = 'idle';
                statusText       = 'IDLE';
            } else {
                statusColorClass = 'working';
                statusText       = dev.status ? dev.status.toUpperCase() : 'ONLINE';
            }
        } else {
            statusColorClass = 'offline';
            statusText       = 'OFFLINE';
        }

        if (dev.last_report_details && dev.last_report_details.timestamp &&
            new Date(dev.last_report_details.timestamp).toDateString() === new Date().toDateString()) {
            generatedToday++;
        }

        if (dev.last_report_status && typeof dev.last_report_status === 'string' &&
            (dev.last_report_status.toLowerCase().includes('fail') ||
             dev.last_report_status.toLowerCase().includes('error'))) {
            failedToday++;
        }

        const sysInfo  = dev.sys_info || "Windows 10 | 8GB RAM";
        const sysParts = sysInfo.split('|');
        const osName   = sysParts[0] ? sysParts[0].trim() : "Windows";
        const ramInfo  = sysParts[1] ? sysParts[1].trim() : "-- RAM";
        const agentVer = dev.agent_version || "9.18.6";

        const card = document.createElement('div');
        card.className = `node-card ${APP.state.activeDeviceId === dev.id ? 'active' : ''}`;
        card.innerHTML = `
            <div class="nc-top">
                <div class="nc-status ${statusColorClass}"></div>
                <span class="nc-name">${dev.id}</span>
            </div>
            <div class="nc-bot">
                <span class="nc-state ${statusColorClass}">${statusText}</span>
                <span class="nc-time">${LSTime > 0 ? (finalOffline ? new Date(LSTime).toLocaleTimeString() : new Date().toLocaleTimeString()) : '--:--'}</span>
            </div>
            <div class="nc-sys"><i class="fa-brands fa-windows"></i> ${osName} <i class="fa-solid fa-memory"></i> ${ramInfo} <i class="fa-solid fa-microchip"></i> ${agentVer} Agent</div>
        `;

        card.addEventListener('click', () => {
            APP.state.activeDeviceId = dev.id;
            APP.renderDevices();
            APP.openDevicePanel(dev);
        });

        D.deviceList.appendChild(card);
    });

    if (D.metricActive)    D.metricActive.innerText    = onlineCount;
    if (D.metricOffline)   D.metricOffline.innerText   = offlineCount;
    if (D.metricGenerated) D.metricGenerated.innerText = generatedToday;
    if (D.metricFailed)    D.metricFailed.innerText    = failedToday;
    APP.updateSyncDisplay();

    const elOnline  = document.getElementById('stat-online');
    const elOffline = document.getElementById('stat-offline');
    if (elOnline)  elOnline.innerText  = `${onlineCount} ONLINE`;
    if (elOffline) elOffline.innerText = `${offlineCount} OFFLINE`;
};

APP.openDevicePanel = function (dev) {
    const D = APP.DOM;
    if (D.focusEmpty)   D.focusEmpty.classList.add('hidden');
    if (D.focusContent) D.focusContent.classList.remove('hidden');

    if (D.activeDeviceName) D.activeDeviceName.innerText = `[${dev.id}]`;

    let LSTime = 0;
    if (dev.last_seen) {
        if (typeof dev.last_seen.toMillis === 'function') LSTime = dev.last_seen.toMillis();
        else if (typeof dev.last_seen === 'string') LSTime = Date.parse(dev.last_seen);
    }

    let statusText = 'OFFLINE';
    let colorClass = 'text-error';
    const isStale  = (Date.now() - LSTime) > 90000;

    if (dev.status === 'hibernate') {
        statusText = 'HIBERNATE';
        colorClass = 'text-status-hibernate';
    } else if (!isStale && dev.status !== 'offline') {
        statusText = dev.status ? dev.status.toUpperCase() : "ONLINE";
        colorClass = 'text-success';
    }

    if (D.tStatus) {
        D.tStatus.innerText  = statusText;
        D.tStatus.className  = `val ${colorClass}`;
    }
    if (D.tLastseen) D.tLastseen.innerText = LSTime > 0 ? new Date(LSTime).toLocaleTimeString() : '--:--:--';

    if (dev.last_report_details) {
        const r = dev.last_report_details;
        if (D.rsTime) D.rsTime.innerText = `TIME: ${r.timestamp || 'N/A'}`;
        if (D.rsPath) D.rsPath.innerText = `PATH: ${r.folder    || 'N/A'}`;
        if (D.rsXlsx) D.rsXlsx.innerText = `XLSX: ${r.excel     || 'N/A'}`;
        if (D.rsPdf)  D.rsPdf.innerText  = `PDF: ${r.pdf        || 'N/A'}`;

        if (D.downloadsTbody && r.excel && r.timestamp) {
            const html = `
                <tr>
                    <td>${r.excel}</td>
                    <td>${dev.id}</td>
                    <td>128 KB</td>
                    <td>${r.timestamp.split(' ')[1]}</td>
                    <td>
                        <button class="icon-btn-small text-info"><i class="fa-solid fa-download"></i></button>
                        <button class="icon-btn-small text-error"><i class="fa-solid fa-xmark"></i></button>
                    </td>
                </tr>
            `;
            if (!D.downloadsTbody.innerHTML.includes(r.excel)) {
                D.downloadsTbody.innerHTML = html + D.downloadsTbody.innerHTML;
            }
        }
    } else {
        if (D.rsTime) D.rsTime.innerText = "TIME: --";
        if (D.rsPath) D.rsPath.innerText = "PATH: --";
        if (D.rsXlsx) D.rsXlsx.innerText = "XLSX: --";
        if (D.rsPdf)  D.rsPdf.innerText  = "PDF: --";
    }

    function parse12(time24) {
        if (!time24) return { h: "08", m: "00", ap: "AM" };
        const [h, m] = time24.split(':');
        let hInt = parseInt(h);
        const ap = hInt >= 12 ? 'PM' : 'AM';
        hInt = hInt % 12 || 12;
        return { h: hInt < 10 ? '0' + hInt : hInt.toString(), m, ap };
    }

    const startData = parse12(dev.report_time || dev.schedule_stop);
    if (D.schDisplay) D.schDisplay.innerText = `${startData.h}:${startData.m}`;

    if (D.sysOsName && dev.sys_info) D.sysOsName.innerText = dev.sys_info.split('|')[0].trim() || "Windows 10";
    if (D.hmName) D.hmName.innerText = dev.id;

    // ── Real Firebase metrics — fallback to seed-based if agent hasn't pushed yet ──
    // Parse percentage value from either string ("45%") or number (45)
    function parsePct(val) {
        if (val == null) return null;
        if (typeof val === 'number') return Math.min(100, Math.max(0, Math.round(val)));
        const n = parseInt(String(val).replace('%', '').trim());
        return isNaN(n) ? null : Math.min(100, Math.max(0, n));
    }

    // Seed fallback (consistent per device if real data not available)
    let seed = 0;
    for (let i = 0; i < dev.id.length; i++) seed += dev.id.charCodeAt(i);

    const cpuPct  = parsePct(dev.cpu_usage)  ?? ((seed % 60) + 10);
    const ramPct  = parsePct(dev.ram_usage)  ?? ((seed % 40) + 30);
    const diskPct = parsePct(dev.disk_usage) ?? ((seed % 30) + 50);
    const netMs   = (typeof dev.ping_ms === 'number') ? dev.ping_ms : ((seed % 20) + 2);

    // Parse actual hardware totals from sys_info or dedicated fields
    // Agent should push sys_info like "Windows 10 | 16GB RAM | 512GB Disk"
    const sysStr      = dev.sys_info || '';
    const ramMatch    = sysStr.match(/(\d+)\s*GB\s*RAM/i);
    const diskMatch   = sysStr.match(/(\d+)\s*GB\s*(?:Disk|HDD|SSD|Storage)/i);
    const totalRamGB  = dev.total_ram  ? parseFloat(dev.total_ram)  : (ramMatch  ? parseInt(ramMatch[1])  : 8);
    const totalDiskGB = dev.total_disk ? parseFloat(dev.total_disk) : (diskMatch ? parseInt(diskMatch[1]) : 256);

    const uptimeDisplay = dev.uptime || dev.up_time || ('-- uptime');

    if (D.barCpu)  D.barCpu.style.width  = cpuPct + '%';
    if (D.pctCpu)  D.pctCpu.innerText    = cpuPct + '%';
    if (D.barRam)  D.barRam.style.width  = ramPct + '%';
    if (D.pctRam)  D.pctRam.innerText    = ramPct + '%';
    if (D.barDisk) D.barDisk.style.width = diskPct + '%';
    if (D.pctDisk) D.pctDisk.innerText   = diskPct + '%';
    if (D.pctNet)  D.pctNet.innerText    = netMs + ' ms';
    if (D.pctUp)   D.pctUp.innerText     = uptimeDisplay;

    if (D.sysCpuBar)  D.sysCpuBar.style.width  = cpuPct + '%';
    if (D.sysCpuPct)  D.sysCpuPct.innerText     = cpuPct + '%';
    if (D.sysRamBar)  D.sysRamBar.style.width   = ramPct + '%';
    if (D.sysRamPct)  D.sysRamPct.innerText      = ramPct + '%';
    if (D.sysDiskBar) D.sysDiskBar.style.width   = diskPct + '%';
    if (D.sysDiskPct) D.sysDiskPct.innerText     = diskPct + '%';

    if (D.sysRamVal)  D.sysRamVal.innerText  = ((ramPct / 100) * totalRamGB).toFixed(1) + ' / ' + totalRamGB + 'GB';
    if (D.sysDiskVal) D.sysDiskVal.innerText = ((diskPct / 100) * totalDiskGB).toFixed(0) + ' / ' + totalDiskGB + 'GB';
    if (D.sysUpVal)   D.sysUpVal.innerText   = uptimeDisplay;

    if (D.globalVersion) D.globalVersion.innerText = dev.agent_version || "9.18.7";

    // Update charts with real Firebase data for this device
    if (typeof APP.updateCharts === 'function') APP.updateCharts(dev);
};
