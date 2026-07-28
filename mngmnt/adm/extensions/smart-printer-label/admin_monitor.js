/**
 * VIMS Smart Printing Label - Admin Monitor v4.3
 */
const FIREBASE_URL = "https://smart-label-87910-default-rtdb.asia-southeast1.firebasedatabase.app";
const FIREBASE_SECRET = "5w3njKYG0mvxqYRE43Q0As2to2FJIEpXbdsP1M9N";

// --- STATE ---
const state = {
    branches: {},
    globalErrorCount: 0,
    latency: 0,
    filterMode: 'ALL',
    globalFeed: [], // [{ time, branch, log, type }]
    lastEventTime: 0,
    isFeedPaused: false,
    lastSyncTimestamp: Date.now(),
    lastIdleAlertTime: 0,
    pinnedBranches: [], // Array of branch names
    blacklist_local: [],
    blacklist_remote: []
};

let UI = {};

// Helper: Format Duration (e.g. 5s ago, 45m STALE)
function formatDuration(ms) {
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ${min > 10 ? '(STALE)' : 'ago'}`;
    const hr = Math.round(min / 60);
    return `${hr}h (STALE)`;
}

// Function to get clean branch name (e.g. FARMASI VETERAN (KL) -> FVKL)
function getShortName(name) {
    if (name.includes('(KL)')) return 'FVKL';
    if (name.includes('(TERENDAK)')) return 'FVT';
    return name.substring(0,6).toUpperCase();
}

// Helper: Sanitize Name for HTML IDs (e.g. "BRANCH (KL)" -> "branch_kl")
function sanitizeId(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

// --- HELPERS ---
function getAuthUrl(path) {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const connector = cleanPath.includes('?') ? '&' : '?';
    return `${FIREBASE_URL}${cleanPath}${connector}auth=${FIREBASE_SECRET}`;
}

function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'vims-toast';
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// --- LOGIC ---
async function fetchData() {
    const startTime = performance.now();
    try {
        const [presRes, logsRes] = await Promise.all([
            fetch(getAuthUrl('presence.json')),
            fetch(getAuthUrl('logs.json'))
        ]);

        const presenceData = await presRes.json();
        const logsData = await logsRes.json();
        state.latency = Math.round(performance.now() - startTime);

        processState(presenceData, logsData);
        renderStats();
        renderDashboard();
        renderGlobalFeed();

        // --- WEEKLY AUTO-CLEANUP ---
        checkWeeklyCleanup();

    } catch (e) {
        console.error("Fetch failed:", e);
    }
}

async function checkWeeklyCleanup() {
    try {
        const now = new Date();
        const lastSunday = new Date(now);
        lastSunday.setDate(now.getDate() - now.getDay());
        lastSunday.setHours(0, 0, 0, 0);
        const lastSundayTs = lastSunday.getTime();

        const configUrl = getAuthUrl('system/lastCleanupTime.json');
        const res = await fetch(configUrl);
        const lastCleanupTs = await res.json() || 0;

        if (lastSundayTs > lastCleanupTs) {
            console.log("SYSTEM: Weekly Cleanup Triggered.");
            await Promise.all([
                fetch(getAuthUrl('logs.json'), { method: 'DELETE' }),
                fetch(getAuthUrl('presence.json'), { method: 'DELETE' })
            ]);
            await fetch(configUrl, {
                method: 'PUT',
                body: JSON.stringify(lastSundayTs)
            });
        }
    } catch (e) {
        console.error("Auto-Cleanup Error:", e);
    }
}

function processState(presence, logs) {
    const now = Date.now();
    let totalErrors = 0;
    const allNames = new Set([...Object.keys(presence || {}), ...Object.keys(logs || {})]);
    
    const newEvents = [];

    allNames.forEach(name => {
        if (name === "error" || name === "UNNAMED_BRANCH" || name === "UNNAMED") return;

        if (!state.branches[name]) {
            state.branches[name] = { logs: {}, devices: {}, lastPing: 0, lastLog: 0, errorCount: 0, status: 'offline', rate: 0, printMode: 'both' };
        }

        const b = state.branches[name];
        
        // Presence logic (detect STOPPED vs OFFLINE)
        if (presence && presence[name]) {
            // Prune stale device nodes (Older than 5 minutes)
            const cleanedDevices = {};
            const deviceNodes = Object.entries(presence[name]);
            const fiveMinAgo = Date.now() - (5 * 60 * 1000);

            deviceNodes.forEach(([uid, d]) => {
                if (d.lastSeen && d.lastSeen > fiveMinAgo) {
                    cleanedDevices[uid] = d;
                }
            });

            b.devices = cleanedDevices;
            const activeDevices = Object.values(cleanedDevices);
            
            b.lastPing = activeDevices.length > 0 ? Math.max(...activeDevices.map(d => d.lastSeen || 0), 0) : 0;
            b.isBotRunning = activeDevices.some(d => d.isRunning === true);
            b.printMode = activeDevices.find(d => d.printMode)?.printMode || 'both';
        } else {
            // Heartbeat node is GONE from Firebase (Explicit STOP or Browser closed)
            b.devices = {};
            b.isBotRunning = false;
            b.lastPing = 0;
        }

        if (logs && logs[name]) {
            b.logs = logs[name];
            const logEntries = Object.values(b.logs);
            b.lastLog = Math.max(...logEntries.map(l => new Date(l.timestamp).getTime() || 0), 0);
            
            // New events (unshift to Keep newest sorted later)
            logEntries.forEach(l => {
                const ts = new Date(l.timestamp).getTime();
                if (ts > state.lastSyncTimestamp) {
                    newEvents.push({
                        time: ts,
                        branch: getShortName(name),
                        log: l.log,
                        type: l.log.includes('❌') ? 'error' : (l.log.includes('SKIP') ? 'skip' : 'info')
                    });
                }
            });

            // Calculate Activity Rate (jobs in last 5 mins)
            const fiveMinAgo = now - (5 * 60 * 1000);
            const recentJobs = logEntries.filter(l => new Date(l.timestamp).getTime() > fiveMinAgo).length;
            b.rate = Math.round(recentJobs / 5 * 10) / 10; // e.g. 1.2/min

            // 🚨 EXCLUDE "SKIP" FROM ERROR COUNT (As per user request)
            // Error only counted for hard failures (❌)
            b.errorCount = logEntries.filter(l => l.log.includes('❌')).length;
            totalErrors += b.errorCount;
        }

        const timeSinceLog = now - b.lastLog;
        const timeSincePing = now - b.lastPing;
        const todayStart = new Date().setHours(0, 0, 0, 0);
        const hasLogsToday = b.lastLog >= todayStart;
        const isPingRecent = timeSincePing > 0 && timeSincePing < 90000;
        const isLogRecent = hasLogsToday && timeSinceLog < 300000; // 5 minutes

        // --- UNIFIED LOGIC ENGINE (v4.3.3) ---
        // If presence node was explicitly deleted (lastPing=0), we force offline
        // even if logs are recent, to respect the manual STOP action.
        const hasPulse = isPingRecent || (isLogRecent && b.lastPing !== 0);

        if (hasPulse) {
            // Priority 1: Presence node confirms running state
            if (b.isBotRunning === true) {
                if (hasLogsToday && timeSinceLog > 600000) {
                    b.status = 'idle'; // Living but resting
                } else {
                    b.status = 'active'; // Living and working
                }
            } 
            // Priority 2: Presence mode says stopped, but we see recent logs? 
            // Likely a "STOP" command was sent but bot is still finishing a task.
            else if (b.isBotRunning === false && isPingRecent) {
                b.status = 'stopped';
            }
            // Priority 3: No recent presence but we see fresh logs (v4.1 or missing node).
            else {
                b.status = 'active';
            }
        } else {
            b.status = 'offline'; // Definitive dead/off
        }
    });

    // --- LIVE FEED DEDUPLICATION (v4.3.5) ---
    // Update Global Sync Tracking
    const newestLogTs = Math.max(...Object.values(state.branches).map(b => b.lastLog), 0);

    // FIRST RUN PROTECTION: If lastSyncTimestamp is 0, this is the dashboard's first fetch.
    // We initialize it to the latest log so we don't dump 24h of history into the LIVE feed.
    const isFirstLoad = (state.lastSyncTimestamp === 0);
    if (isFirstLoad && newestLogTs > 0) {
        state.lastSyncTimestamp = newestLogTs;
        state.lastEventTime = newestLogTs;
        // Don't process newEvents on the very first load to start clean
        newEvents.length = 0; 
    }

    if (newEvents.length > 0) {
        newEvents.sort((a,b) => b.time - a.time); // Newest FIRST
        state.globalFeed.unshift(...newEvents);
        
        // Update the anchor and header timer
        const latestFromNew = Math.max(...newEvents.map(e => e.time));
        state.lastSyncTimestamp = Math.max(state.lastSyncTimestamp, latestFromNew);
        state.lastEventTime = Math.max(state.lastEventTime, latestFromNew);
        
        // Limit feed size
        state.globalFeed = state.globalFeed.slice(0, 100);
    } else {
        // Update anchor even if no new events to stay current
        state.lastSyncTimestamp = Math.max(state.lastSyncTimestamp, newestLogTs);

        // Check for SYSTEM IDLE (no activity across all branches for 600s / 10m)
        if (state.lastEventTime > 0 && (now - state.lastEventTime) > 600000) {
            if ((now - state.lastIdleAlertTime) > 600000) {
                state.globalFeed.unshift({
                    time: now,
                    branch: 'SYS',
                    log: 'SYSTEM IDLE - No new DOs detected',
                    type: 'sys'
                });
                state.lastIdleAlertTime = now;
            }
        }
    }

    state.globalErrorCount = totalErrors;
}

function renderStats() {
    if (!UI.statBranch) return;
    const branches = Object.values(state.branches);
    const total = branches.length;
    const activeList = branches.filter(b => b.status === 'active' || b.status === 'idle');
    const online = activeList.length;
    
    let deviceCount = 0;
    branches.forEach(b => {
        if (b.status !== 'offline') deviceCount += Object.keys(b.devices).length;
    });

    UI.statBranch.innerText = `${online}/${total}`;
    UI.statDevices.innerText = deviceCount;
    UI.statErrors.innerText = state.globalErrorCount;
    UI.statLatency.innerText = `${state.latency}ms`;

    // Last Event Timer
    if (state.lastEventTime > 0) {
        UI.lastEventTimer.innerText = `LAST EVENT: ${formatDuration(Date.now() - state.lastEventTime)}`;
    }

    // Top Bar Status Badge (LIVE vs OFFLINE)
    if (UI.liveStatus) {
        if (online > 0) {
            UI.liveStatus.innerHTML = '● LIVE';
            UI.liveStatus.classList.add('active');
            UI.liveStatus.classList.remove('offline');
        } else {
            UI.liveStatus.innerHTML = '○ OFFLINE';
            UI.liveStatus.classList.remove('active');
            UI.liveStatus.classList.add('offline');
        }
    }

    // Global Pulse & Alerts
    const errorMsg = state.globalErrorCount > 0 ? `Detected ${state.globalErrorCount} critical failures (❌) across all branches.` : "No critical errors detected.";
    UI.globalAlert.style.display = state.globalErrorCount > 0 ? 'inline' : 'none';
    UI.globalAlert.title = errorMsg;
    UI.statErrors.title = errorMsg;
    if (state.globalErrorCount > 0) {
        UI.globalAlert.classList.add('pulse-error');
        UI.statErrors.classList.add('error');
    } else {
        UI.globalAlert.classList.remove('pulse-error');
        UI.statErrors.classList.remove('error');
    }
}

function renderGlobalFeed() {
    if (!UI.globalFeed) return;
    
    // Header Heartbeat logic
    const diff = state.lastEventTime > 0 ? formatDuration(Date.now() - state.lastEventTime) : '--';
    UI.feedStatus.innerHTML = `<span class="blink-dot"></span> idle... waiting events <span style="margin-left:10px; opacity:0.5;">last: ${diff}</span>`;

    let html = '';
    state.globalFeed.forEach(ev => {
        const time = new Date(ev.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        
        // --- PARSING LOG FOR HIGH-DENSITY FORMAT ---
        let status = '';
        let content = ev.log.replace(/❌|✔|PRINTED|READY|SYSTEM START/g, '').replace(/\|[WCB]\|$/, '').trim();
        
        if (ev.type === 'error') status = '[Error]';
        else if (ev.type === 'skip' || ev.log.includes('SKIP')) {
            status = '[Skip]';
            // Handle formats: "⤳ 11002225 - - Reason" or "11002225 - SKIP - Reason"
            let clean = content.replace('⤳', '').replace('SKIP', '').replace(/\|[WCB]\|$/, '').trim();
            // Replace sequences of " - " or " - - " with a single "/"
            content = clean.replace(/\s+-\s+-\s+/g, '/').replace(/\s+-\s+/g, '/').replace(/\/+/g, '/');
        } else if (ev.log.includes('SYSTEM IDLE')) {
            status = '[Printed]'; // user requested [Printed] for idle
            content = 'SYSTEM IDLE';
        } else {
            status = '[Printed]';
            // Clean up ID from ✔ 11008884
            content = content.replace('✔', '').trim();
        }

        const tightMsg = `${status}${ev.branch}/>${content}/${time}`;
        
        html += `
            <div class="t-line">
                <span class="t-msg">${tightMsg}</span>
            </div>
        `;
    });
    
    const activeCount = Object.values(state.branches).filter(b => b.status === 'active' || b.status === 'idle').length;
    const defaultMsg = activeCount > 0 ? 'WAITING FOR SOC DATA...' : 'NO ACTIVE SESSION';
    UI.globalFeed.innerHTML = html || `<div class="t-line sys">${defaultMsg}</div>`;

    // Reverse Feed: Newest is on top, so no scroll needed usually.
    // But if we want to ensure top is visible:
    if (!state.isFeedPaused) {
        UI.globalFeed.scrollTop = 0;
    }
}

function renderDashboard() {
    if (!UI.dashboard) return;
    
    // Weights: Pinned first, then Status (Active first, Offline last)
    const statusWeights = { 'active': 0, 'idle': 1, 'stopped': 2, 'offline': 3 };

    const names = Object.keys(state.branches).sort((a, b) => {
        // 1. Pinned Priority
        const isPinnedA = state.pinnedBranches.includes(a);
        const isPinnedB = state.pinnedBranches.includes(b);
        if (isPinnedA !== isPinnedB) return isPinnedA ? -1 : 1;

        // 2. Status Priority
        const weightA = statusWeights[state.branches[a].status] ?? 99;
        const weightB = statusWeights[state.branches[b].status] ?? 99;
        
        if (weightA !== weightB) {
            return weightA - weightB;
        }
        return a.localeCompare(b); // Alphabetical secondary sort
    });
    if (names.length === 0) return;

    if (UI.dashboard.querySelector('.empty-grid')) UI.dashboard.innerHTML = '';

    names.forEach(name => {
        const b = state.branches[name];
        const sId = sanitizeId(name);
        let card = document.getElementById(`card-${sId}`);
        if (!card) {
            card = document.createElement('div');
            card.id = `card-${sId}`;
            card.className = 'card';
            UI.dashboard.appendChild(card);
        }

        // status 'stopped' gets opacity 60% via CSS if we handle it
        card.className = `card ${b.status}`;
        card.style.opacity = (b.status === 'stopped' || b.status === 'offline') ? '0.6' : '1';

        const lastSeenSec = b.lastPing > 0 ? Math.round((Date.now() - b.lastPing) / 1000) : '--';
        
        let modeLabel = 'Both';
        if (b.printMode === 'walkin') modeLabel = 'Walk-IN';
        if (b.printMode === 'courier') modeLabel = 'Courier';

        card.innerHTML = `
            <div class="card-header">
                <div class="branch-info">
                    <div class="status-dot ${b.status}" title="${getStatusMessage(b)}"></div>
                    <div>
                        <div class="branch-name">${name}</div>
                        <div class="branch-meta">
                            <span>Jobs: ${Object.keys(b.logs).length}</span>
                            <span style="color:${b.errorCount > 0 ? 'var(--neon-red)' : 'inherit'}" title="${b.errorCount} system errors (❌) detected.">Err: ${b.errorCount}</span>
                            <span>Rate: ↑ ${b.rate}/min</span>
                            <span>Last: ${lastSeenSec}s</span>
                        </div>
                    </div>
                </div>
                <div class="card-actions">
                    <button class="btn-icon btn-pin action-pin ${state.pinnedBranches.includes(name) ? 'active' : ''}" data-branch="${name}" title="Pin to Top">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                    </button>
                    <button class="btn-icon action-download" data-branch="${name}" title="Download Logs">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    </button>
                    <button class="btn-icon btn-restart action-restart" data-branch="${name}" title="Restart Bot Remote">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                    </button>
                </div>
            </div>
            <div class="log-filter-bar">
                <span class="filter-item ${state.filterMode === 'ALL' ? 'active' : ''} action-filter" data-mode="ALL">[ ALL ]</span>
                <span class="filter-item ${state.filterMode === 'ERROR' ? 'active' : ''} action-filter" data-mode="ERROR">[ ERRORS ]</span>
                <span class="filter-item" style="cursor:default; color:var(--neon-blue); font-weight:bold;">[ ${modeLabel} ]</span>
            </div>
            <div class="card-body">${renderLogs(b)}</div>
        `;
        
        const body = card.querySelector('.card-body');
        body.scrollTop = body.scrollHeight;
    });
}

function getStatusMessage(b) {
    if (b.status === 'stopped') return "STOPPED: Extension installed but START not clicked.";
    if (b.status === 'idle') return "IDLE: Bot working fine, just no new DOs from VIMS for > 60s.";
    if (b.status === 'active') return "ACTIVE: Bot processing or recently active.";
    return b.status.toUpperCase();
}

function renderLogs(b) {
    // Sort logs by actual timestamp (numeric)
    const logs = Object.values(b.logs).sort((a,b) => {
        const tA = new Date(a.timestamp).getTime() || 0;
        const tB = new Date(b.timestamp).getTime() || 0;
        return tA - tB;
    });
    let html = '';
    let lastDateStr = null;

    logs.forEach(entry => {
        const entryDate = new Date(entry.timestamp);
        const dateStr = entryDate.toLocaleDateString('en-GB'); // "DD/MM/YYYY"

        const isError = entry.log.includes('❌');
        const isSkip = entry.log.includes('SKIP');
        const isSessionStart = entry.log.includes('[SESSION START') || entry.log.includes('SYSTEM START');

        if (state.filterMode === 'ERROR' && !isError) return;

        // --- AUTOMATIC DATE DIVIDER ---
        // If the date changes between logs, or this is a manual session start, 
        // we handle the header.
        if (lastDateStr && dateStr !== lastDateStr && !isSessionStart) {
            html += `
                <div class="session-divider" style="color: #fff; font-weight: bold; border-top: 1px dashed #333; margin: 12px 0 6px 0; padding-top: 6px; font-size: 10px; letter-spacing: 0.5px;">
                    [ NEW DAY | ${dateStr.replace(/\//g, '-')} ]
                </div>
            `;
        }
        lastDateStr = dateStr;

        if (isSessionStart) {
            html += `
                <div class="session-divider" style="color: #fff; font-weight: bold; border-top: 1px dashed #333; margin: 12px 0 6px 0; padding-top: 6px; font-size: 10px; letter-spacing: 0.5px;">
                    ${entry.log}
                </div>
            `;
            return;
        }

        const time = entryDate.toLocaleTimeString('en-GB', { hour12: false });
        
        let cls = 'neon-green';
        if (isError) cls = 'neon-red';
        else if (isSkip) cls = 'neon-blue'; // SKIP IS BLUE NOW

        const cleanMsg = entry.log.replace(/❌|✔|SKIP|PRINTED|READY|SYSTEM START/g, '').replace(/\|[WCB]\|$/, '').trim();
        let bg = isError ? 'rgba(255,123,114,0.1)' : (isSkip ? 'rgba(121,192,255,0.05)' : 'transparent');
        
        html += `
            <div class="log-line" style="background: ${bg}; padding: 1px 4px; border-radius: 2px; margin-bottom: 2px;">
                <span class="log-time" style="color: #555; min-width: 50px;">${time}</span>
                <span class="log-stat ${cls}" style="color: var(--${cls})">${isError ? '❌' : (isSkip ? '⤳' : '✔')}</span>
                <span class="log-msg" style="${isError ? 'color: var(--neon-red); font-weight: bold;' : ''} ${isSkip ? 'color: var(--neon-blue);' : ''}">${cleanMsg || entry.log}</span>
            </div>
        `;
    });
    return html || '<div style="color:var(--grey); text-align:center; margin-top:20px;">NO DATA</div>';
}

function setFilter(mode) {
    state.filterMode = mode;
    renderDashboard();
}

async function restartBranch(name) {
    if (!confirm(`RESTART ${name}?`)) return;
    try {
        await fetch(getAuthUrl(`commands/${encodeURIComponent(name)}.json`), {
            method: 'PUT',
            body: JSON.stringify({ type: 'RESTART', timestamp: Date.now() })
        });
        alert('Signal sent.');
    } catch (e) { console.error(e); }
}

function downloadLogs(name) {
    const logs = state.branches[name]?.logs;
    if (!logs) return;
    const content = Object.values(logs).sort((a,b) => a.timestamp - b.timestamp).map(l => `[${new Date(l.timestamp).toISOString()}] ${l.log}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `VIMS_${name}.txt`;
    a.click();
}

async function togglePin(name) {
    if (state.pinnedBranches.includes(name)) {
        state.pinnedBranches = state.pinnedBranches.filter(b => b !== name);
    } else {
        state.pinnedBranches.push(name);
    }
    await chrome.storage.local.set({ pinnedBranches: state.pinnedBranches });
    renderDashboard();
}

// --- BLACKLIST MANAGER LOGIC ---

async function openSettings() {
    UI.settingsModal.style.display = 'flex';
    
    // 1. Fetch Remote (Firebase)
    try {
        const res = await fetch(getAuthUrl('blacklist.json'));
        state.blacklist_remote = await res.json() || [];
    } catch (e) {
        console.error("Failed to fetch remote blacklist", e);
    }

    // 2. Fetch Local (Storage)
    const storage = await chrome.storage.local.get(['vims_local_blacklist']);
    if (storage.vims_local_blacklist) {
        state.blacklist_local = storage.vims_local_blacklist;
    } else {
        // Fallback to json file if first time
        try {
            const res = await fetch('blacklist.json');
            state.blacklist_local = await res.json();
        } catch (e) { state.blacklist_local = []; }
    }

    renderBlacklist();
}

function renderBlacklist() {
    if (!UI.blacklistContainer) return;
    UI.blacklistContainer.innerHTML = '';

    if (state.blacklist_local.length === 0) {
        UI.blacklistContainer.innerHTML = '<div style="padding:20px; text-align:center; color:var(--grey);">[ LIST EMPTY ]</div>';
        return;
    }

    state.blacklist_local.forEach((drug, index) => {
        const isSynced = state.blacklist_remote.includes(drug.toLowerCase());
        const row = document.createElement('div');
        row.className = 'blacklist-item';
        row.innerHTML = `
            <div class="item-info">
                <span style="color:#fff;">${drug.toUpperCase()}</span>
                <span class="remark-tag ${isSynced ? 'remark-synced' : 'remark-pending'}">
                    ${isSynced ? 'SYNCED' : 'PENDING'}
                </span>
            </div>
            <button class="btn-icon btn-remove-blacklist" data-index="${index}" style="color:var(--neon-red);" title="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            </button>
        `;
        UI.blacklistContainer.appendChild(row);
    });
}

function addBlacklistItem() {
    const name = UI.newDrugInput.value.trim().toLowerCase();
    const errorEl = document.getElementById('blacklistError');
    if (!name) return;
    
    const duplicate = state.blacklist_local.find(existing => 
        name.includes(existing) || existing.includes(name)
    );

    if (duplicate) {
        if (errorEl) {
            errorEl.innerText = "! ERR: TARGET ALREADY IN DATABASE";
            errorEl.style.display = 'inline';
            setTimeout(() => { if (errorEl) errorEl.style.display = 'none'; }, 3000);
        }
        UI.newDrugInput.value = ''; // Auto clear
        UI.addDrugBtn.disabled = true; // Reset state
        return;
    }
    
    if (errorEl) errorEl.style.display = 'none';
    state.blacklist_local.push(name);
    UI.newDrugInput.value = '';
    UI.addDrugBtn.disabled = true; // Reset state
    renderBlacklist();
}

function removeBlacklistItem(index) {
    state.blacklist_local.splice(index, 1);
    renderBlacklist();
}

async function saveBlacklist() {
    await chrome.storage.local.set({ vims_local_blacklist: state.blacklist_local });
    showToast("DRAFT SAVED LOCALLY");
}

async function syncBlacklistToFirebase() {
    try {
        const res = await fetch(getAuthUrl('blacklist.json'), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.blacklist_local)
        });

        if (res.ok) {
            // Update Version Timestamp for Smart Sync
            await fetch(getAuthUrl('blacklist_version.json'), {
                method: 'PUT',
                body: JSON.stringify(Date.now())
            });

            state.blacklist_remote = [...state.blacklist_local];
            renderBlacklist();
            showToast("SYNC COMPLETED (LIVE)");
        } else {
            showToast("SYNC FAILED (SERVER ERROR)");
        }
    } catch (err) {
        console.error("Sync Error:", err);
        showToast("OFFLINE - SYNC FAILED");
        // We don't update state.blacklist_remote here, 
        // which keeps items in 'PENDING' state visually
        renderBlacklist(); 
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    UI = {
        dashboard: document.getElementById('dashboard'),
        statBranch: document.getElementById('stat-branch'),
        statDevices: document.getElementById('stat-devices'),
        statErrors: document.getElementById('stat-errors'),
        statLatency: document.getElementById('stat-latency'),
        globalAlert: document.getElementById('global-alert'),
        lastEventTimer: document.getElementById('last-event-timer'),
        globalFeed: document.getElementById('global-feed'),
        feedStatus: document.getElementById('feed-status'),
        clearAllBtn: document.getElementById('clearAllLogsBtn'),
        liveStatus: document.getElementById('liveStatus'),
        settingsModal: document.getElementById('settingsModal'),
        settingsDropdown: document.getElementById('settingsDropdown'),
        blacklistContainer: document.getElementById('blacklistContainer'),
        newDrugInput: document.getElementById('newDrugInput'),
        addDrugBtn: document.getElementById('addDrugBtn')
    };

    // --- ADD DRUG BUTTON STATE LOGIC ---
    UI.newDrugInput.oninput = () => {
        UI.addDrugBtn.disabled = UI.newDrugInput.value.trim().length === 0;
    };
    UI.newDrugInput.onkeydown = (e) => {
        if (e.key === 'Enter') addBlacklistItem();
    };

    // --- SETTINGS BUTTONS ---
    document.getElementById('openSettingsBtn').onclick = (e) => {
        e.stopPropagation();
        const isVisible = UI.settingsDropdown.style.display === 'flex';
        UI.settingsDropdown.style.display = isVisible ? 'none' : 'flex';
    };

    document.getElementById('openBlacklistBtn').onclick = () => {
        UI.settingsDropdown.style.display = 'none';
        openSettings();
    };

    document.getElementById('closeSettingsBtn').onclick = () => UI.settingsModal.style.display = 'none';
    document.getElementById('addDrugBtn').onclick = addBlacklistItem;
    document.getElementById('saveBlacklistBtn').onclick = saveBlacklist;
    document.getElementById('syncBlacklistBtn').onclick = syncBlacklistToFirebase;

    // Global click handler for closing dropdown/modal
    window.onclick = (e) => { 
        if (e.target == UI.settingsModal) UI.settingsModal.style.display = 'none'; 
        if (!e.target.closest('.top-actions')) UI.settingsDropdown.style.display = 'none';
    };

    const storage = await chrome.storage.local.get(['pinnedBranches']);
    if (storage.pinnedBranches) state.pinnedBranches = storage.pinnedBranches;

    // --- EVENT DELEGATION ---
    document.addEventListener('click', (e) => {
        const target = e.target;
        
        // Use .closest() to handle clicks on nested SVG icons
        const filterBtn = target.closest('.action-filter');
        const downloadBtn = target.closest('.action-download');
        const restartBtn = target.closest('.action-restart');
        
        if (filterBtn) {
            setFilter(filterBtn.dataset.mode);
        } else if (downloadBtn) {
            downloadLogs(downloadBtn.dataset.branch);
        } else if (restartBtn) {
            restartBranch(restartBtn.dataset.branch);
        } else if (target.closest('.action-pin')) {
            const btn = target.closest('.action-pin');
            togglePin(btn.dataset.branch);
        } else if (target.closest('.btn-remove-blacklist')) {
            const btn = target.closest('.btn-remove-blacklist');
            removeBlacklistItem(btn.dataset.index);
        }
    });

    // --- SMART SCROLL LOGIC ---
    UI.globalFeed.addEventListener('scroll', () => {
        const { scrollTop, scrollHeight, clientHeight } = UI.globalFeed;
        // If user scrolls up more than 15px from bottom, pause auto-scroll
        const isAtBottom = scrollTop + clientHeight >= scrollHeight - 15;
        state.isFeedPaused = !isAtBottom;
        UI.feedStatus.innerText = state.isFeedPaused ? 'PAUSED' : 'SCROLLING';
        UI.feedStatus.style.color = state.isFeedPaused ? 'var(--neon-yellow)' : 'inherit';
    });
    
    UI.clearAllBtn.onclick = async () => {
        if (!confirm("WIPE ALL LOGS?")) return;
        await Promise.all([
            fetch(getAuthUrl('logs.json'), { method: 'DELETE' }),
            fetch(getAuthUrl('presence.json'), { method: 'DELETE' })
        ]);
        location.reload();
    };

    window.onkeydown = (e) => {
        const key = e.key.toUpperCase();
        if (key === 'E') {
            setFilter(state.filterMode === 'ERROR' ? 'ALL' : 'ERROR');
        }
        if (key === 'R') fetchData();
    };

    fetchData();
    setInterval(fetchData, 5000);
    
    // High-frequency UI updates (Counters)
    setInterval(() => {
        if (state.lastEventTime > 0 && UI.lastEventTimer) {
            const diff = Math.round((Date.now() - state.lastEventTime) / 1000);
            UI.lastEventTimer.innerText = `LAST EVENT: ${diff}s ago`;
        }
    }, 1000);
});
