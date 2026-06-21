// ─────────────────────────────────────────────────────────────
// alerts.js — Real-time alert engine
// ─────────────────────────────────────────────────────────────
APP.generateAlerts = function () {
    const D      = APP.DOM;
    const alerts = [];

    // Parse percentage from either string ("45%") or number (45)
    function parsePct(val) {
        if (val == null) return null;
        if (typeof val === 'number') return val;
        const n = parseInt(String(val).replace('%', '').trim());
        return isNaN(n) ? null : n;
    }

    // Format alert timestamp from device last_seen
    function fmtAlertTime(dev) {
        if (!dev.last_seen) return 'Unknown';
        let ms = 0;
        if (typeof dev.last_seen.toMillis === 'function') ms = dev.last_seen.toMillis();
        else if (dev.last_seen.seconds) ms = dev.last_seen.seconds * 1000;
        else ms = Date.parse(dev.last_seen);
        if (!ms) return 'Unknown';
        const diff = Date.now() - ms;
        if (diff < 60000)    return 'Just now';
        if (diff < 3600000)  return Math.floor(diff / 60000) + 'm ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        return new Date(ms).toLocaleDateString();
    }

    APP.state.currentDevices.forEach(d => {
        const alertTime = fmtAlertTime(d);

        if (d.status === 'offline') {
            alerts.push({ deviceId: d.id, title: 'Node Offline', desc: d.id, icon: '<i class="fa-solid fa-triangle-exclamation text-error"></i>', time: alertTime });
        }

        const diskVal = parsePct(d.disk_usage);
        if (diskVal !== null && diskVal >= 85) {
            alerts.push({ deviceId: d.id, title: `Disk Space High (${diskVal}%)`, desc: d.id, icon: '<i class="fa-solid fa-hard-drive text-warning"></i>', time: alertTime });
        }

        const ramVal = parsePct(d.ram_usage);
        if (ramVal !== null && ramVal >= 85) {
            alerts.push({ deviceId: d.id, title: `RAM Usage High (${ramVal}%)`, desc: d.id, icon: '<i class="fa-solid fa-memory text-warning"></i>', time: alertTime });
        }

        if (d.last_report_status && typeof d.last_report_status === 'string' &&
            (d.last_report_status.toLowerCase().includes('fail') || d.last_report_status.toLowerCase().includes('error'))) {
            const reportTime = d.last_report_details?.timestamp || alertTime;
            alerts.push({ deviceId: d.id, title: 'Report Generation Failed', desc: d.id, icon: '<i class="fa-solid fa-bug text-error"></i>', time: reportTime });
        }
    });

    const count = alerts.length;

    if (D.btnViewAllAlerts) {
        if (count === 0) D.btnViewAllAlerts.classList.add('disabled');
        else D.btnViewAllAlerts.classList.remove('disabled');
    }
    if (D.notifBadge) {
        D.notifBadge.innerText = count;
        if (count > 0) D.notifBadge.classList.remove('hidden');
        else D.notifBadge.classList.add('hidden');
    }
    if (D.criticalAlertsBadge) {
        D.criticalAlertsBadge.innerText = count;
        if (count > 0) D.criticalAlertsBadge.classList.remove('hidden');
        else D.criticalAlertsBadge.classList.add('hidden');
    }

    if (D.notifDropdownList) {
        D.notifDropdownList.innerHTML = '';
        if (count === 0) {
            D.notifDropdownList.innerHTML = '<div style="padding:15px;text-align:center;color:var(--text-muted);font-size:10px;">No new alerts</div>';
        } else {
            alerts.slice(0, 5).forEach(al => {
                const el = document.createElement('div');
                el.className = 'dropdown-item';
                el.innerHTML = `${al.icon} <span style="flex:1">${al.title} - ${al.desc}</span>`;
                el.addEventListener('click', () => {
                    const targetDev = APP.state.currentDevices.find(x => x.id === al.deviceId);
                    if (targetDev) {
                        APP.openDevicePanel(targetDev);
                        D.notifDropdown.classList.add('hidden');
                    }
                });
                D.notifDropdownList.appendChild(el);
            });
        }
    }

    if (D.criticalAlertsList) {
        D.criticalAlertsList.innerHTML = '';
        if (count === 0) {
            D.criticalAlertsList.innerHTML = '<div class="empty-state" style="margin-top:20px;"><i class="fa-solid fa-check ghost-icon"></i><p>ALL SYSTEMS NORMAL</p></div>';
        } else {
            alerts.slice(0, 10).forEach(al => {
                const el = document.createElement('div');
                el.className = 'alert-item';
                el.style.cursor = 'pointer';
                el.innerHTML = `
                    ${al.icon}
                    <div class="alert-info">
                        <span class="title">${al.title}</span>
                        <span class="desc">${al.desc}</span>
                    </div>
                    <span class="time">${al.time}</span>
                `;
                el.addEventListener('click', () => {
                    const targetDev = APP.state.currentDevices.find(x => x.id === al.deviceId);
                    if (targetDev) APP.openDevicePanel(targetDev);
                });
                D.criticalAlertsList.appendChild(el);
            });
        }
    }
};
