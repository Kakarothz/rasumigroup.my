/* ═══════════════════════════════════════════════════════════
   RASUMI ADMIN CONSOLE — admin.js
   Firebase Firestore real-time admin monitor

   ⚠ SETUP: Fill in FIREBASE_CONFIG below with your project's
   config from Firebase Console → Project Settings → Your apps.
═══════════════════════════════════════════════════════════ */

/* ─── 1. FIREBASE CONFIG ──────────────────────────────── */
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

/* ─── 2. INIT ─────────────────────────────────────────── */
firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db   = firebase.firestore();

// Enable offline persistence
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

/* ─── 2b. SUPABASE CLIENT ─────────────────────────────── */
// app_errors and logs now live in Supabase — vibes_errors stays in Firestore.
const supa = supabase.createClient(
  'https://seqlkwdghibmsfkbuwqq.supabase.co',
  'sb_publishable_BotuzQAIly3eTShpQ_Lmtg_Y9_QlyDp'
);

/* ─── 3. STATE ────────────────────────────────────────── */
const STATE = {
  user:          null,
  currentRoute:  null,
  listeners:     [],          // active onSnapshot unsubs
  devices:       {},          // hostname → machine_status doc
  alertCount:    0,
  sidebarOpen:   true,
  filterCache:   {},          // per-view filter values
  pageCache:     {},          // pagination cursors
};

/* ─── 4. UTILS ────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const el = (tag, cls, html='') => { const e = document.createElement(tag); if(cls) e.className=cls; if(html) e.innerHTML=html; return e; };

function fmt(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('en-MY', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-MY', { day:'2-digit', month:'short', year:'numeric' });
}
function ago(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - d)/1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}
function deviceStatus(doc) {
  if (!doc?.lastSeen) return 'offline';
  const diff = (Date.now() - (doc.lastSeen.toDate?.() ?? new Date(doc.lastSeen)).getTime()) / 1000;
  if (diff < 300) return 'online';
  if (diff < 900) return 'stale';
  return 'offline';
}
function statusBadge(s) {
  return `<span class="badge ${s}">${s.toUpperCase()}</span>`;
}
function categoryBadge(cat) {
  const map = { guard_exhausted:'danger', batch_skip:'warn', upload_retry_exhausted:'danger',
    reconciliation_incomplete:'danger', panic:'danger', preflight_warn:'warn',
    completion_failed:'warn', bot_skip:'warn', ocr_failed:'warn',
    template_mismatch:'warn', not_found:'info', scrape_error:'danger' };
  const cls = map[cat] || 'neutral';
  return `<span class="badge ${cls}">${cat.replace(/_/g,' ')}</span>`;
}
function toast(msg, type='info', dur=4000) {
  const t = el('div', `toast ${type}`, msg);
  $('toast-container').appendChild(t);
  setTimeout(() => t.remove(), dur);
}

function clearListeners() {
  STATE.listeners.forEach(u => { try { u(); } catch(_){} });
  STATE.listeners = [];
}
function addListener(unsub) { STATE.listeners.push(unsub); }

function showModal(title, bodyHtml, footerHtml='') {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML    = bodyHtml;
  $('modal-footer').innerHTML  = footerHtml;
  $('modal-overlay').classList.remove('hidden');
}
function closeModal(e) {
  if (e && e.target !== $('modal-overlay')) return;
  $('modal-overlay').classList.add('hidden');
}

/* ─── 5. AUTH ─────────────────────────────────────────── */
function doLogin() {
  const email = $('login-email').value.trim();
  const pass  = $('login-password').value;
  if (!email || !pass) { showLoginError('Enter email and password.'); return; }
  $('login-btn').disabled = true;
  $('login-btn-text').textContent = 'Signing in…';
  $('login-spinner').classList.remove('hidden');
  auth.signInWithEmailAndPassword(email, pass)
    .catch(err => { showLoginError(err.message); resetLoginBtn(); });
}
function showLoginError(msg) {
  const e = $('login-error');
  e.textContent = msg;
  e.classList.remove('hidden');
}
function resetLoginBtn() {
  $('login-btn').disabled = false;
  $('login-btn-text').textContent = 'Sign In';
  $('login-spinner').classList.add('hidden');
}
function doSignOut() {
  auth.signOut().then(() => location.reload());
}

auth.onAuthStateChanged(user => {
  STATE.user = user;
  if (user) {
    $('login-screen').classList.add('hidden');
    $('app-shell').classList.remove('hidden');
    $('admin-name').textContent   = user.displayName || user.email.split('@')[0];
    $('admin-avatar').textContent = (user.displayName||user.email)[0].toUpperCase();
    startGlobalListeners();
    navigate('dashboard');
    startClock();
  } else {
    window.location.href = "../login.html";
  }
});

/* ─── 6. ROUTER ───────────────────────────────────────── */
const ROUTE_LABELS = {
  dashboard: 'Dashboard', devices: 'Device Fleet',
  renamer: 'Renamer Trace', vibes: 'VIBES Monitor',
  vims: 'VIMS Scrape', logs: 'Log Explorer',
  commands: 'Commands', alerts: 'Alerts',
  'device-detail': 'Device Detail',
};

function navigate(route, params={}) {
  clearListeners();
  STATE.currentRoute  = route;
  STATE.currentParams = params;
  $('topbar-route').textContent = ROUTE_LABELS[route] || route;

  // Update nav
  document.querySelectorAll('nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.route === route);
    const icon = n.querySelector('.nav-icon');
    if (icon) icon.textContent = n.classList.contains('active') ? '◆' : '⬡';
  });

  // Render view
  const vc = $('view-container');
  vc.innerHTML = '';
  const renders = {
    dashboard:     renderDashboard,
    devices:       renderDevices,
    renamer:       renderRenamer,
    vibes:         renderVibes,
    vims:          renderVims,
    logs:          renderLogs,
    commands:      renderCommands,
    alerts:        renderAlerts,
    'device-detail': renderDeviceDetail,
  };
  (renders[route] || (() => { vc.innerHTML = '<div class="empty-state"><div class="empty-icon">🚧</div><div class="empty-title">Coming soon</div></div>'; }))(params);
}

// Wire nav-items
document.querySelectorAll('nav-item').forEach(n => {
  n.addEventListener('click', () => navigate(n.dataset.route));
});

function toggleSidebar() {
  STATE.sidebarOpen = !STATE.sidebarOpen;
  document.querySelector('.sidebar').classList.toggle('collapsed', !STATE.sidebarOpen);
  document.querySelector('.sidebar-collapse-btn').title = STATE.sidebarOpen ? 'Collapse' : 'Expand';
}

function startClock() {
  setInterval(() => {
    $('topbar-time').textContent = new Date().toLocaleTimeString('en-MY', { hour12: false });
  }, 1000);
}

/* ─── 7. GLOBAL LISTENERS ─────────────────────────────── */
function startGlobalListeners() {
  // machine_status → fleet summary + device cache
  const unsub = db.collection('machine_status').onSnapshot(snap => {
    let online=0, stale=0, offline=0;
    snap.forEach(d => {
      const data = d.data();
      STATE.devices[d.id] = data;
      const s = deviceStatus(data);
      if(s==='online') online++;
      else if(s==='stale') stale++;
      else offline++;
    });
    $('ts-online').textContent  = online;
    $('ts-stale').textContent   = stale;
    $('ts-offline').textContent = offline;
    $('badge-online').textContent = online;
    // Refresh device list on dashboard if visible (no full re-render needed)
    if (STATE.route === 'dashboard') {
      renderDashDeviceList(snap.docs);
    }
  }, err => console.error('machine_status:', err));
  STATE.listeners.push(unsub); // global, don't add to per-view

  // Badge counts — polled every 5 min instead of persistent onSnapshot.
  // onSnapshot on collectionGroup charges 1 read per agent write across all devices.
  function _pollAdminBadges() {
    if (document.visibilityState !== 'visible') return;
    db.collectionGroup('vibes_errors')
      .where('fix_status','==','unfixed')
      .limit(51)
      .get().then(snap => {
        const n = Math.min(snap.size, 51);
        const display = snap.size > 50 ? '50+' : snap.size;
        STATE.alertCount = snap.size;
        $('badge-vibes').textContent  = display;
        $('badge-alerts').textContent = display;
        $('notif-count').textContent  = display;
        $('notif-count').classList.toggle('hidden', snap.size === 0);
      }).catch(()=>{});

    db.collectionGroup('renamer_docs')
      .where('status','in',['failed','wrong_read'])
      .limit(51)
      .get().then(snap => {
        $('badge-renamer').textContent = snap.size > 50 ? '50+' : (snap.size || '');
      }).catch(()=>{});

    db.collectionGroup('vims_results')
      .where('status','==','skipped')
      .limit(51)
      .get().then(snap => {
        $('badge-vims').textContent = snap.size > 50 ? '50+' : (snap.size || '');
      }).catch(()=>{});
  }
  _pollAdminBadges();
  STATE._badgePollTimer = setInterval(_pollAdminBadges, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', _pollAdminBadges);
  STATE.listeners.push(() => {
    if (STATE._badgePollTimer) { clearInterval(STATE._badgePollTimer); STATE._badgePollTimer = null; }
    document.removeEventListener('visibilitychange', _pollAdminBadges);
  });
}

/* ════════════════════════════════════════════════════════
   8. DASHBOARD
════════════════════════════════════════════════════════ */
function renderDashboard() {
  const vc = $('view-container');
  vc.innerHTML = `
    <div class="kpi-grid" id="dash-kpis">
      <div class="kpi-card green"><div class="kpi-label">Online</div><div class="kpi-value" id="kpi-online">—</div><div class="kpi-sub">last 5 min</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Stale</div><div class="kpi-value" id="kpi-stale">—</div><div class="kpi-sub">5–15 min</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Offline</div><div class="kpi-value" id="kpi-offline">—</div><div class="kpi-sub">&gt;15 min</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Open Errors</div><div class="kpi-value" id="kpi-errors">—</div><div class="kpi-sub">unfixed</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Rename Issues</div><div class="kpi-value" id="kpi-rename">—</div><div class="kpi-sub">today</div></div>
      <div class="kpi-card warn"><div class="kpi-label">VIMS Skips</div><div class="kpi-value" id="kpi-vims">—</div><div class="kpi-sub">today</div></div>
    </div>

    <div class="chart-row">
      <div class="chart-box" style="grid-column:1/-1">
        <div class="chart-title">Error Events — Last 7 Days (all devices)</div>
        <canvas id="chart-errors" height="80"></canvas>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Live Alerts</span><span id="dash-alert-count" class="badge danger">0</span></div>
        <div class="alert-feed" id="dash-alert-feed"><div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">No open alerts</div></div></div>
      </div>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Device Status</span></div>
        <div id="dash-device-list" style="max-height:320px;overflow-y:auto"></div>
      </div>
    </div>
  `;

  // KPIs from cache
  function updateKPIs() {
    let on=0,st=0,off=0;
    Object.values(STATE.devices).forEach(d => {
      const s=deviceStatus(d);
      if(s==='online')on++; else if(s==='stale')st++; else off++;
    });
    $('kpi-online').textContent  = on;
    $('kpi-stale').textContent   = st;
    $('kpi-offline').textContent = off;
  }
  // Render from already-cached STATE.devices (global machine_status listener handles live updates)
  updateKPIs();
  renderDashDeviceList(Object.values(STATE.devices).map(d => ({ data: () => d })));
  // Re-render when global machine_status fires (it calls renderDashboard already if route matches)

  // Dashboard KPIs — one-time .get() to avoid stacking onSnapshot on top of global badge poll
  const today = new Date(); today.setHours(0,0,0,0);

  db.collectionGroup('vibes_errors')
    .where('fix_status','==','unfixed')
    .limit(100)
    .get().then(snap => {
      $('kpi-errors').textContent = snap.size > 99 ? '99+' : snap.size;
      $('dash-alert-count').textContent = snap.size > 99 ? '99+' : snap.size;
      renderDashAlerts(snap.docs);
    }).catch(()=>{});

  db.collectionGroup('renamer_docs')
    .where('status','in',['failed','wrong_read'])
    .where('ts','>=',firebase.firestore.Timestamp.fromDate(today))
    .limit(100)
    .get().then(snap => { $('kpi-rename').textContent = snap.size > 99 ? '99+' : snap.size; }).catch(()=>{});

  db.collectionGroup('vims_results')
    .where('status','==','skipped')
    .where('ts','>=',firebase.firestore.Timestamp.fromDate(today))
    .limit(100)
    .get().then(snap => { $('kpi-vims').textContent = snap.size > 99 ? '99+' : snap.size; }).catch(()=>{});

  // Chart — 7 day error trend
  loadErrorChart();
}

function renderDashAlerts(docs) {
  const feed = $('dash-alert-feed');
  if (!feed) return;
  if (!docs.length) { feed.innerHTML='<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">No open alerts</div></div>'; return; }
  feed.innerHTML = docs.slice(0,30).map(d => {
    const e = d.data();
    const lvl = e.category==='panic'||e.category==='reconciliation_incomplete' ? 'crit' : 'warn';
    return `<div class="alert-item ${lvl}" onclick="navigate('device-detail',{hostname:'${e.device_hostname}'})">
      <div class="alert-dot ${lvl}"></div>
      <div class="alert-content">
        <div class="alert-msg">[${e.device_hostname||'?'}] ${e.summary||e.category}</div>
        <div class="alert-meta">${e.category} · tuntutan: ${e.tuntutan_no||'—'}</div>
      </div>
      <div class="alert-ts">${ago(e.ts_utc)}</div>
    </div>`;
  }).join('');
}

function renderDashDeviceList(docs) {
  const el = $('dash-device-list');
  if (!el) return;
  const sorted = docs.map(d=>d.data()).sort((a,b)=>{
    const order={online:0,stale:1,offline:2};
    return (order[deviceStatus(a)]||2)-(order[deviceStatus(b)]||2);
  });
  el.innerHTML = `<table class="data-table">
    <thead><tr><th>Host</th><th>Branch</th><th>Status</th><th>Last Seen</th></tr></thead>
    <tbody>${sorted.slice(0,20).map(d=>{
      const s=deviceStatus(d);
      return `<tr class="clickable" onclick="navigate('device-detail',{hostname:'${d.hostname}'})">
        <td class="truncate text-mono" style="max-width:140px">${d.hostname||'?'}</td>
        <td class="truncate">${d.branch||'—'}</td>
        <td>${statusBadge(s)}</td>
        <td class="text-muted">${ago(d.lastSeen)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function loadErrorChart() {
  const ctx = document.getElementById('chart-errors');
  if (!ctx) return;
  const labels=[], days=7;
  for(let i=days-1;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i); d.setHours(0,0,0,0);
    labels.push(d.toLocaleDateString('en-MY',{weekday:'short',month:'short',day:'numeric'}));
  }
  // Query last 7 days errors
  const since = new Date(); since.setDate(since.getDate()-7); since.setHours(0,0,0,0);
  db.collectionGroup('vibes_errors')
    .where('ingested_at','>=',firebase.firestore.Timestamp.fromDate(since))
    .get().then(snap => {
      const counts = new Array(days).fill(0);
      const panicCounts = new Array(days).fill(0);
      snap.forEach(d => {
        const data=d.data();
        const ts = data.ingested_at?.toDate?.() || new Date(data.ts_utc);
        const dayIdx = days-1-Math.floor((Date.now()-ts.getTime())/86400000);
        if(dayIdx>=0&&dayIdx<days){ counts[dayIdx]++; if(data.category==='panic') panicCounts[dayIdx]++; }
      });
      new Chart(ctx, {
        type:'bar',
        data:{
          labels,
          datasets:[
            { label:'Total Errors', data:counts, backgroundColor:'rgba(192,132,252,0.4)', borderColor:'rgba(192,132,252,0.8)', borderWidth:1 },
            { label:'Panics', data:panicCounts, backgroundColor:'rgba(255,45,85,0.5)', borderColor:'rgba(255,45,85,0.9)', borderWidth:1 },
          ]
        },
        options:{ responsive:true, plugins:{legend:{labels:{color:'#c0c5d2',font:{size:10}}}},
          scales:{ x:{ticks:{color:'#8b91a2',font:{size:10}},grid:{color:'rgba(192,132,252,0.07)'}},
            y:{ticks:{color:'#8b91a2',font:{size:10}},grid:{color:'rgba(192,132,252,0.07)'},beginAtZero:true} } }
      });
    }).catch(()=>{});
}

/* ════════════════════════════════════════════════════════
   9. DEVICE FLEET
════════════════════════════════════════════════════════ */
function renderDevices() {
  const vc = $('view-container');
  vc.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Device Fleet</span>
        <div class="panel-actions">
          <button class="btn btn-outline btn-sm" onclick="exportDevices()">⬇ Export CSV</button>
        </div>
      </div>
      <div class="filter-bar">
        <input class="filter-input" id="dev-search" placeholder="Search hostname / branch…" oninput="filterDevices()"/>
        <select class="filter-select" id="dev-status" onchange="filterDevices()">
          <option value="">All Status</option>
          <option value="online">Online</option>
          <option value="stale">Stale</option>
          <option value="offline">Offline</option>
        </select>
        <select class="filter-select" id="dev-branch" onchange="filterDevices()">
          <option value="">All Branches</option>
        </select>
        <select class="filter-select" id="dev-version" onchange="filterDevices()">
          <option value="">All Versions</option>
        </select>
        <span id="dev-count" class="text-muted" style="font-size:11px;margin-left:auto"></span>
      </div>
      <div class="panel-body" style="overflow-x:auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>Status</th><th>Hostname</th><th>Branch</th>
              <th>Version</th><th>Last Seen</th><th>Errors (24h)</th><th>Active Apps</th><th>Actions</th>
            </tr>
          </thead>
          <tbody id="dev-tbody"><tr><td colspan="8" class="loading-row"><span class="spinner"></span> Loading…</td></tr></tbody>
        </table>
      </div>
      <div class="pagination" id="dev-pagination"></div>
    </div>`;

  let allDevices = [];
  const PAGE = 50;
  let page = 0;

  const unsub = db.collection('machine_status').onSnapshot(snap => {
    allDevices = snap.docs.map(d => ({id:d.id, ...d.data()}));
    // populate branch/version filters
    const branches = [...new Set(allDevices.map(d=>d.branch).filter(Boolean))].sort();
    const versions = [...new Set(allDevices.map(d=>d.version).filter(Boolean))].sort();
    const brSel=$('dev-branch'); const verSel=$('dev-version');
    if(brSel){const cur=brSel.value; brSel.innerHTML='<option value="">All Branches</option>'+branches.map(b=>`<option${b===cur?' selected':''}>${b}</option>`).join(''); }
    if(verSel){const cur=verSel.value; verSel.innerHTML='<option value="">All Versions</option>'+versions.map(v=>`<option${v===cur?' selected':''}>${v}</option>`).join(''); }
    filterDevices();
  });
  addListener(unsub);

  window.filterDevices = function() {
    const q  = $('dev-search')?.value.toLowerCase()||'';
    const st = $('dev-status')?.value||'';
    const br = $('dev-branch')?.value||'';
    const ver= $('dev-version')?.value||'';
    let filtered = allDevices.filter(d => {
      const s = deviceStatus(d);
      return (!q || (d.hostname||'').toLowerCase().includes(q) || (d.branch||'').toLowerCase().includes(q))
          && (!st || s===st)
          && (!br || d.branch===br)
          && (!ver|| d.version===ver);
    }).sort((a,b)=>{
      const o={online:0,stale:1,offline:2};
      return (o[deviceStatus(a)]||2)-(o[deviceStatus(b)]||2);
    });
    $('dev-count').textContent = `${filtered.length} device${filtered.length!==1?'s':''}`;
    renderDevPage(filtered, page=0);
  };

  function renderDevPage(filtered, p) {
    const start=p*PAGE, end=start+PAGE;
    const rows = filtered.slice(start,end);
    const tbody=$('dev-tbody');
    if(!tbody)return;
    if(!rows.length){ tbody.innerHTML='<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📡</div><div class="empty-title">No devices found</div></div></td></tr>'; return; }
    tbody.innerHTML = rows.map(d => {
      const s=deviceStatus(d);
      const dotCls = s==='online'?'dot-online':s==='stale'?'dot-stale':'dot-offline';
      const errs = d.errorCount24h ?? '—';
      const apps = (d.activeApps||[]).join(', ')||'—';
      return `<tr class="clickable" onclick="navigate('device-detail',{hostname:'${d.hostname}'})">
        <td><span class="device-status-dot ${dotCls}"></span>${statusBadge(s)}</td>
        <td class="text-mono truncate" style="max-width:160px">${d.hostname||'?'}</td>
        <td>${d.branch||'—'}</td>
        <td class="text-mono">${d.version||'—'}</td>
        <td class="text-muted">${ago(d.lastSeen)}</td>
        <td>${errs>0?`<span class="text-danger">${errs}</span>`:errs}</td>
        <td class="text-muted">${apps}</td>
        <td><button class="btn btn-outline btn-sm" onclick="event.stopPropagation();navigate('device-detail',{hostname:'${d.hostname}'})">View →</button></td>
      </tr>`;
    }).join('');
    // pagination
    const totalPages = Math.ceil(filtered.length/PAGE);
    const pag=$('dev-pagination');
    if(pag){
      pag.innerHTML = totalPages>1 ? `
        <button class="page-btn" ${p===0?'disabled':''} onclick="renderDevPageGlobal(${p-1})">‹ Prev</button>
        <span style="font-size:11px;color:var(--text-2)">${p+1} / ${totalPages}</span>
        <button class="page-btn" ${p>=totalPages-1?'disabled':''} onclick="renderDevPageGlobal(${p+1})">Next ›</button>
      ` : '';
    }
    window._filteredDevices = filtered;
    window._currentDevPage  = p;
  }
  window.renderDevPageGlobal = function(p) { renderDevPage(window._filteredDevices||[], p); };
  window.exportDevices = function() {
    const rows = (window._filteredDevices||allDevices).map(d=>
      [d.hostname,d.branch,deviceStatus(d),d.version,fmt(d.lastSeen)].join(','));
    const csv = ['Hostname,Branch,Status,Version,LastSeen',...rows].join('\n');
    const a=document.createElement('a'); a.href='data:text/csv,'+encodeURIComponent(csv);
    a.download='devices.csv'; a.click();
  };
}

/* ════════════════════════════════════════════════════════
   10. DEVICE DETAIL
════════════════════════════════════════════════════════ */
function renderDeviceDetail({hostname}={}) {
  if (!hostname) { $('view-container').innerHTML='<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">No device selected</div></div>'; return; }
  const vc=$('view-container');
  vc.innerHTML=`
    <div style="margin-bottom:12px">
      <button class="btn btn-outline btn-sm" onclick="navigate('devices')">← Fleet</button>
      <span style="margin-left:12px;font-family:var(--font-head);font-size:11px;color:var(--accent);letter-spacing:2px">${hostname}</span>
    </div>
    <div class="kpi-grid" id="dd-kpis" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
      <div class="kpi-card info"><div class="kpi-label">Status</div><div class="kpi-value" id="dd-status" style="font-size:1rem">—</div></div>
      <div class="kpi-card purple"><div class="kpi-label">Version</div><div class="kpi-value" id="dd-version" style="font-size:1rem">—</div></div>
      <div class="kpi-card green"><div class="kpi-label">Branch</div><div class="kpi-value" id="dd-branch" style="font-size:1rem">—</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Open Errors</div><div class="kpi-value" id="dd-errcnt">—</div></div>
    </div>
    <div class="tab-bar">
      <div class="tab active" onclick="ddTab(this,'vibes-errors')">VIBES Errors</div>
      <div class="tab" onclick="ddTab(this,'renamer-docs')">Renamer Docs</div>
      <div class="tab" onclick="ddTab(this,'vims-results')">VIMS Results</div>
      <div class="tab" onclick="ddTab(this,'device-logs')">Live Logs</div>
      <div class="tab" onclick="ddTab(this,'device-cmds')">Commands</div>
    </div>
    <div id="dd-tab-content" style="margin-top:10px"></div>
  `;

  // load device doc
  const devUnsub = db.collection('machine_status').doc(hostname).onSnapshot(d => {
    if(!d.exists){ toast('Device not found in Firestore','warn'); return; }
    const data=d.data();
    const s=deviceStatus(data);
    const se=$('dd-status'); if(se) se.innerHTML=statusBadge(s);
    const ve=$('dd-version'); if(ve) ve.textContent=data.version||'—';
    const be=$('dd-branch'); if(be) be.textContent=data.branch||'—';
  });
  addListener(devUnsub);

  // open error count
  const errUnsub = db.collection('devices').doc(hostname).collection('vibes_errors')
    .where('fix_status','==','unfixed').onSnapshot(s => {
      const el=$('dd-errcnt'); if(el) el.textContent=s.size;
    });
  addListener(errUnsub);

  window.ddTab = function(el, tab) {
    document.querySelectorAll('.tab-bar .tab').forEach(t=>t.classList.remove('active'));
    el.classList.add('active');
    ddLoadTab(tab, hostname);
  };
  ddLoadTab('vibes-errors', hostname);
}

function ddLoadTab(tab, hostname) {
  const tc=$('dd-tab-content'); if(!tc)return;

  if(tab==='vibes-errors') {
    tc.innerHTML=`<div id="ve-body"><div class="empty-state"><div class="spinner"></div></div></div>`;
    const unsub = db.collection('devices').doc(hostname).collection('vibes_errors')
      .orderBy('ts_utc','desc').limit(200)
      .onSnapshot(snap => {
        addListener(()=>{}); // placeholder
        renderVibesErrorsTab(snap.docs, hostname);
      });
    addListener(unsub);

  } else if(tab==='renamer-docs') {
    tc.innerHTML=`<div id="rd-filter" class="filter-bar">
      <select class="filter-select" id="rd-status" onchange="loadRenamerDocs('${hostname}')"><option value="">All Status</option><option value="failed">Failed</option><option value="wrong_read">Wrong Read</option><option value="skipped">Skipped</option><option value="success">Success</option></select>
      <select class="filter-select" id="rd-session" onchange="loadRenamerDocs('${hostname}')"><option value="">All Sessions</option></select>
    </div><div id="rd-body"></div>`;
    loadRenamerDocs(hostname);

  } else if(tab==='vims-results') {
    tc.innerHTML=`<div class="filter-bar">
      <select class="filter-select" id="vims-status-f" onchange="loadVimsResults('${hostname}')"><option value="">All Status</option><option value="skipped">Skipped</option><option value="not_found">Not Found</option><option value="success">Success</option><option value="error">Error</option></select>
      <select class="filter-select" id="vims-session-f" onchange="loadVimsResults('${hostname}')"><option value="">All Sessions</option></select>
    </div><div id="vr-body"></div>`;
    loadVimsResults(hostname);

  } else if(tab==='device-logs') {
    tc.innerHTML=`<div class="filter-bar">
      <select class="filter-select" id="dl-sev"><option value="">All Severity</option><option value="ERROR">ERROR</option><option value="WARN">WARN</option><option value="INFO">INFO</option></select>
      <input class="filter-input" id="dl-q" placeholder="Search event…" style="flex:1"/>
      <button class="btn btn-outline btn-sm" onclick="loadDeviceLogs('${hostname}')">Search</button>
    </div>
    <div id="dl-body" style="max-height:400px;overflow-y:auto">
      <table class="data-table"><thead><tr><th>Time</th><th>Sev</th><th>Event</th><th>Claim</th><th>Detail</th></tr></thead>
      <tbody id="dl-tbody"><tr><td colspan="5" class="loading-row"><span class="spinner"></span></td></tr></tbody></table>
    </div>`;
    loadDeviceLogs(hostname);

  } else if(tab==='device-cmds') {
    renderCommandsPanel(hostname, tc);
  }
}

function renderVibesErrorsTab(docs, hostname) {
  const body=$('ve-body'); if(!body)return;
  if(!docs.length){ body.innerHTML='<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">No VIBES errors for this device</div></div>'; return; }

  // group by run_id
  const groups = {};
  docs.forEach(d => { const e=d.data(); (groups[e.run_id||'unknown']=groups[e.run_id||'unknown']||{id:e.run_id,docs:[],ts:e.ts_utc}).docs.push({id:d.id,...e}); });

  body.innerHTML = Object.values(groups).sort((a,b)=>(b.ts||'')>(a.ts||'')?1:-1).map(g => {
    const unfixed = g.docs.filter(e=>e.fix_status==='unfixed').length;
    const cats = {};
    g.docs.forEach(e=>{ cats[e.category]=(cats[e.category]||0)+1; });
    const catStr = Object.entries(cats).map(([k,v])=>`${k}: ${v}`).join(' | ');
    const allFixed = unfixed === 0;
    return `<div class="run-group" id="rg-${g.id}">
      <div class="run-group-header" onclick="toggleRunGroup('${g.id}')">
        <span class="run-id-tag">${g.id||'?'}</span>
        <span class="run-group-meta">${g.docs.length} errors · ${catStr}</span>
        ${unfixed>0?`<span class="badge danger">${unfixed} unfixed</span>`:`<span class="badge success">All Fixed</span>`}
        ${allFixed?`<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();clearAllErrors('${hostname}','${g.id}',this)">Clear All</button>`:''}
        <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();downloadRunLog('${hostname}','${g.id}')">⬇ JSONL</button>
        <span class="run-expand-icon">▶</span>
      </div>
      <div class="run-group-body" id="rgb-${g.id}">
        <table class="data-table">
          <thead><tr><th>Time</th><th>Category</th><th>Summary</th><th>Tuntutan</th><th>Invoice</th><th>Skipped</th><th>Fix Status</th><th>Action</th></tr></thead>
          <tbody>${g.docs.map(e=>`
            <tr>
              <td class="text-mono" style="white-space:nowrap;font-size:10px">${fmt(e.ts_local||e.ts_utc)}</td>
              <td>${categoryBadge(e.category)}</td>
              <td style="max-width:200px" title="${e.summary||''}">${(e.summary||'').slice(0,60)}${e.summary?.length>60?'…':''}</td>
              <td class="text-mono">${e.tuntutan_no||'—'}</td>
              <td class="text-mono">${e.invoice_no||'—'}</td>
              <td>${e.skipped_count!=null?`<span class="text-danger">${e.skipped_count}</span>`:'—'}</td>
              <td>${e.fix_status==='fixed'?`<span class="badge success">Fixed</span>`:e.fix_status==='unfixed'?`<span class="badge danger">Open</span>`:`<span class="badge neutral">${e.fix_status}</span>`}</td>
              <td>
                ${e.fix_status==='unfixed'?`<button class="btn btn-warn btn-sm" onclick="openFixModal('${hostname}','${e.id}','${g.id}')">Fix</button>`:''}
                <button class="btn btn-outline btn-sm" onclick="showErrorDetail(${JSON.stringify(e).replace(/'/g,'&#39;')})">Detail</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

window.toggleRunGroup = function(id) {
  const h=document.querySelector(`#rg-${id} .run-group-header`);
  const b=$(`rgb-${id}`);
  if(!h||!b)return;
  h.classList.toggle('open');
  b.classList.toggle('open');
};
window.showErrorDetail = function(e) {
  if(typeof e==='string') try{e=JSON.parse(e);}catch(err){e={summary:e};}
  showModal('Error Detail', `
    <table class="data-table"><tbody>
      <tr><td class="text-muted">Category</td><td>${categoryBadge(e.category)}</td></tr>
      <tr><td class="text-muted">Summary</td><td>${e.summary||'—'}</td></tr>
      <tr><td class="text-muted">Tuntutan</td><td class="text-mono">${e.tuntutan_no||'—'}</td></tr>
      <tr><td class="text-muted">Invoice</td><td class="text-mono">${e.invoice_no||'—'}</td></tr>
      <tr><td class="text-muted">Skipped</td><td>${e.skipped_count!=null?`<span class="text-danger">${e.skipped_count}</span>`:'—'}</td></tr>
      <tr><td class="text-muted">Run ID</td><td class="text-mono">${e.run_id||'—'}</td></tr>
      <tr><td class="text-muted">App Version</td><td class="text-mono">${e.app_version||'—'}</td></tr>
      <tr><td class="text-muted">Time (local)</td><td>${fmt(e.ts_local||e.ts_utc)}</td></tr>
    </tbody></table>
    <div style="margin-top:12px;font-size:10px;color:var(--text-2);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Detail Payload</div>
    <div class="detail-json">${JSON.stringify(e.detail||{}, null, 2)}</div>
  `);
};
window.openFixModal = function(hostname, errorId, runId) {
  showModal('Mark as Fixed',
    `<div style="font-size:12px;color:var(--text-1)">Provide a resolution note before marking this error as fixed.</div>
     <textarea class="fix-note-input" id="fix-note-input" placeholder="Describe what was done to resolve this issue… (min 5 chars)"></textarea>`,
    `<button class="btn btn-danger btn-sm" onclick="closeModal()">Cancel</button>
     <button class="btn btn-success" onclick="submitFix('${hostname}','${errorId}','${runId}')">✓ Mark Fixed</button>`
  );
};
window.submitFix = function(hostname, errorId, runId) {
  const note = $('fix-note-input')?.value.trim();
  if(!note||note.length<5){ toast('Fix note must be at least 5 characters.','warn'); return; }
  db.collection('devices').doc(hostname).collection('vibes_errors').doc(errorId)
    .update({
      fix_status: 'fixed', fixed_by: STATE.user?.email||'admin',
      fixed_at: firebase.firestore.FieldValue.serverTimestamp(),
      fix_note: note
    })
    .then(()=>{ closeModal(); toast('Error marked as fixed.','success'); })
    .catch(e=>{ toast('Update failed: '+e.message,'error'); });
};
window.clearAllErrors = function(hostname, runId, btn) {
  if(!confirm(`Clear all FIXED errors for run ${runId}?`)) return;
  btn.disabled=true;
  db.collection('devices').doc(hostname).collection('vibes_errors')
    .where('run_id','==',runId).where('fix_status','==','fixed').get()
    .then(snap => {
      const batch=db.batch();
      snap.forEach(d=>batch.update(d.ref,{status:'cleared',cleared_by:STATE.user?.email||'admin',cleared_at:firebase.firestore.FieldValue.serverTimestamp()}));
      return batch.commit();
    })
    .then(()=>toast('Errors cleared.','success'))
    .catch(e=>{toast('Clear failed: '+e.message,'error'); btn.disabled=false;});
};
window.downloadRunLog = function(hostname, runId) {
  db.collection('devices').doc(hostname).collection('vibes_errors')
    .where('run_id','==',runId).orderBy('ts_utc','asc').get()
    .then(snap=>{
      const jsonl=snap.docs.map(d=>JSON.stringify(d.data())).join('\n');
      const a=document.createElement('a'); a.href='data:application/json,'+encodeURIComponent(jsonl);
      a.download=`${hostname}_${runId}.jsonl`; a.click();
    });
};

/* ─── RENAMER DOCS TAB ────────────────────────────────── */
window.loadRenamerDocs = function(hostname) {
  const statusF=$('rd-status')?.value||'';
  const sessionF=$('rd-session')?.value||'';
  let q = db.collection('devices').doc(hostname).collection('renamer_docs').orderBy('ts','desc').limit(500);
  if(statusF) q=q.where('status','==',statusF);
  if(sessionF) q=q.where('session_id','==',sessionF);

  const body=$('rd-body'); if(!body)return;
  body.innerHTML='<div class="empty-state"><span class="spinner"></span></div>';

  q.get().then(snap=>{
    if(!snap.size){body.innerHTML='<div class="empty-state"><div class="empty-icon">📁</div><div class="empty-title">No renamer doc records found</div><div class="empty-sub">The Renamer bot must write to devices/{hostname}/renamer_docs</div></div>';return;}
    // populate session dropdown
    const sessions=[...new Set(snap.docs.map(d=>d.data().session_id).filter(Boolean))];
    const sel=$('rd-session');
    if(sel&&sel.options.length<2){sessions.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;sel.appendChild(o);});}
    const issues=snap.docs.filter(d=>['failed','wrong_read','skipped'].includes(d.data().status));
    body.innerHTML=`
      <div style="padding:10px 14px;background:rgba(0,0,0,0.2);border-bottom:1px solid var(--border);display:flex;gap:16px;font-size:11px">
        <span>Total: <b>${snap.size}</b></span>
        <span class="text-danger">Issues: <b>${issues.length}</b></span>
        <span class="text-green">OK: <b>${snap.size-issues.length}</b></span>
      </div>
      <div style="max-height:420px;overflow-y:auto">
      <table class="data-table">
        <thead><tr><th>#</th><th>Status</th><th>Original Name</th><th>Expected Name</th><th>Actual Name</th><th>Error</th><th>Time</th></tr></thead>
        <tbody>${snap.docs.map((d,i)=>{
          const e=d.data();
          const isIssue=['failed','wrong_read','skipped'].includes(e.status);
          const cls=isIssue?'rename-issue-cell':'rename-ok-cell';
          const nameMismatch=e.expected_name&&e.actual_name&&e.expected_name!==e.actual_name;
          return `<tr>
            <td class="text-muted">${i+1}</td>
            <td>${categoryBadge(e.status)}</td>
            <td class="${cls} truncate" style="max-width:160px" title="${e.original_name||''}">${e.original_name||'—'}</td>
            <td class="text-mono truncate" style="max-width:160px;color:var(--info)" title="${e.expected_name||''}">${e.expected_name||'—'}</td>
            <td class="text-mono truncate" style="max-width:160px;${nameMismatch?'color:var(--warn)':''}" title="${e.actual_name||''}">${e.actual_name||'—'}</td>
            <td class="text-danger">${e.error_type||'—'}</td>
            <td class="text-muted" style="white-space:nowrap">${ago(e.ts)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
  }).catch(err=>{ body.innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">${err.message}</div></div>`; });
};

/* ─── VIMS RESULTS TAB ────────────────────────────────── */
window.loadVimsResults = function(hostname) {
  const statusF=$('vims-status-f')?.value||'';
  const sessionF=$('vims-session-f')?.value||'';
  let q = db.collection('devices').doc(hostname).collection('vims_results').orderBy('ts','desc').limit(500);
  if(statusF) q=q.where('status','==',statusF);
  if(sessionF) q=q.where('session_id','==',sessionF);

  const body=$('vr-body'); if(!body)return;
  body.innerHTML='<div class="empty-state"><span class="spinner"></span></div>';
  q.get().then(snap=>{
    if(!snap.size){body.innerHTML='<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">No VIMS result records found</div><div class="empty-sub">VIMS bot must write to devices/{hostname}/vims_results</div></div>';return;}
    const sessions=[...new Set(snap.docs.map(d=>d.data().session_id).filter(Boolean))];
    const sel=$('vims-session-f');
    if(sel&&sel.options.length<2){sessions.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;sel.appendChild(o);});}
    const skipped=snap.docs.filter(d=>d.data().status==='skipped');
    const notFound=snap.docs.filter(d=>d.data().status==='not_found');
    const errors=snap.docs.filter(d=>d.data().status==='error');
    body.innerHTML=`
      <div style="padding:10px 14px;background:rgba(0,0,0,0.2);border-bottom:1px solid var(--border);display:flex;gap:16px;font-size:11px">
        <span>Total: <b>${snap.size}</b></span>
        <span class="text-warn">Bot Skipped: <b>${skipped.length}</b></span>
        <span class="text-info">Not in Portal: <b>${notFound.length}</b></span>
        <span class="text-danger">Errors: <b>${errors.length}</b></span>
        <span class="text-green">Success: <b>${snap.size-skipped.length-notFound.length-errors.length}</b></span>
      </div>
      <div style="max-height:420px;overflow-y:auto">
      <table class="data-table">
        <thead><tr><th>#</th><th>No. Do</th><th>Status</th><th>Amount (RM)</th><th>Source</th><th>Skip Reason</th><th>Time</th></tr></thead>
        <tbody>${snap.docs.map((d,i)=>{
          const e=d.data();
          const rowCls=e.status==='skipped'?'scrape-skipped':e.status==='not_found'?'scrape-not-found':'scrape-ok';
          return `<tr class="${rowCls}">
            <td class="text-muted">${i+1}</td>
            <td class="text-mono">${e.no_do||'—'}</td>
            <td>${categoryBadge(e.status)}</td>
            <td class="${e.amount?'amount-ok':'amount-missing'}">${e.amount!=null?`RM ${Number(e.amount).toFixed(2)}`:'—'}</td>
            <td class="text-muted">${e.source||'—'}</td>
            <td class="text-warn">${e.skip_reason||'—'}</td>
            <td class="text-muted" style="white-space:nowrap">${ago(e.ts)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
  }).catch(err=>{ body.innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">${err.message}</div></div>`; });
};

/* ─── DEVICE LOGS TAB ─────────────────────────────────── */
window.loadDeviceLogs = function(hostname) {
  const sev=$('dl-sev')?.value||'';
  const q2=$('dl-q')?.value.toLowerCase()||'';
  const tbody=$('dl-tbody'); if(!tbody)return;
  tbody.innerHTML='<tr><td colspan="5" class="loading-row"><span class="spinner"></span></td></tr>';
  let ref=db.collection('logs').where('hostname','==',hostname).orderBy('ts','desc').limit(200);
  if(sev) ref=ref.where('severity','==',sev);
  ref.get().then(snap=>{
    const rows=snap.docs.map(d=>d.data()).filter(e=>!q2||(e.event||'').toLowerCase().includes(q2)||(e.claim_no||'').toLowerCase().includes(q2));
    tbody.innerHTML=rows.map(e=>`<tr class="log-row">
      <td class="log-ts">${fmt(e.ts)}</td>
      <td class="log-sev-${e.severity||'INFO'}">${e.severity||'INFO'}</td>
      <td class="log-msg">${e.event||'—'}</td>
      <td class="text-mono">${e.claim_no||'—'}</td>
      <td><button class="btn btn-outline btn-sm" onclick='showErrorDetail(${JSON.stringify(e)})'>▶</button></td>
    </tr>`).join('') || '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No logs found</div></div></td></tr>';
  });
};

/* ─── COMMANDS PANEL ──────────────────────────────────── */
function renderCommandsPanel(hostname, container) {
  container.innerHTML=`
    <div class="panel">
      <div class="panel-header"><span class="panel-title">Send Command</span></div>
      <div style="padding:14px;display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div>
          <label style="font-size:10px;color:var(--text-2);display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:1px">Command</label>
          <select class="filter-select" id="cmd-type" style="min-width:180px">
            <option value="restart_vibes">Restart VIBES Agent</option>
            <option value="restart_vims">Restart VIMS Agent</option>
            <option value="restart_all">Restart All Apps</option>
            <option value="force_log_upload">Force Log Upload</option>
            <option value="clear_errorlog">Clear Local Error Log</option>
            <option value="run_diagnostic">Run Diagnostic</option>
          </select>
        </div>
        <div style="flex:1">
          <label style="font-size:10px;color:var(--text-2);display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:1px">Note (optional)</label>
          <input class="filter-input" id="cmd-note" placeholder="Reason…" style="width:100%"/>
        </div>
        <button class="btn btn-primary" onclick="sendDeviceCommand('${hostname}')">⚡ Send</button>
      </div>
    </div>
    <div class="panel" style="margin-top:10px">
      <div class="panel-header"><span class="panel-title">Command History</span></div>
      <div id="cmd-history" style="max-height:350px;overflow-y:auto">
        <table class="data-table">
          <thead><tr><th>Time</th><th>Command</th><th>Status</th><th>By</th><th>Note</th></tr></thead>
          <tbody id="cmd-tbody"><tr><td colspan="5" class="loading-row"><span class="spinner"></span></td></tr></tbody>
        </table>
      </div>
    </div>`;
  loadCmdHistory(hostname);
}

window.sendDeviceCommand = function(hostname) {
  const type=$('cmd-type')?.value; const note=$('cmd-note')?.value||'';
  if(!type)return;
  db.collection('commands').add({
    target_hostname: hostname, command: type, note,
    status: 'queued', created_by: STATE.user?.email||'admin',
    created_at: firebase.firestore.FieldValue.serverTimestamp()
  }).then(()=>{ toast(`Command '${type}' queued for ${hostname}`,'success'); loadCmdHistory(hostname); })
    .catch(e=>toast('Error: '+e.message,'error'));
};

function loadCmdHistory(hostname) {
  const tbody=$('cmd-tbody'); if(!tbody)return;
  db.collection('commands').where('target_hostname','==',hostname)
    .orderBy('created_at','desc').limit(50).get().then(snap=>{
      tbody.innerHTML=snap.docs.map(d=>{
        const e=d.data();
        return `<tr>
          <td class="text-mono" style="white-space:nowrap">${fmt(e.created_at)}</td>
          <td class="text-mono">${e.command}</td>
          <td class="cmd-status-${e.status}">${e.status||'?'}</td>
          <td class="text-muted">${e.created_by||'—'}</td>
          <td class="text-muted">${e.note||'—'}</td>
        </tr>`;
      }).join('')||'<tr><td colspan="5" class="text-muted" style="text-align:center;padding:20px">No commands yet</td></tr>';
    });
}

/* ════════════════════════════════════════════════════════
   11. RENAMER MONITOR (cross-device)
════════════════════════════════════════════════════════ */
function renderRenamer() {
  const vc=$('view-container');
  vc.innerHTML=`
    <div class="kpi-grid">
      <div class="kpi-card danger"><div class="kpi-label">Failed</div><div class="kpi-value" id="ren-kpi-fail">—</div><div class="kpi-sub">cannot process</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Wrong Read</div><div class="kpi-value" id="ren-kpi-wr">—</div><div class="kpi-sub">OCR mismatch</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Skipped</div><div class="kpi-value" id="ren-kpi-skip">—</div><div class="kpi-sub">bot skipped</div></div>
      <div class="kpi-card green"><div class="kpi-label">Success</div><div class="kpi-value" id="ren-kpi-ok">—</div><div class="kpi-sub">renamed correctly</div></div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Renamer Doc Trace — All Devices</span>
        <div class="panel-actions">
          <button class="btn btn-outline btn-sm" onclick="exportRenamerIssues()">⬇ Export Issues CSV</button>
        </div>
      </div>
      <div class="filter-bar">
        <input class="filter-input" id="ren-q" placeholder="Search filename / hostname…" oninput="filterRenamer()"/>
        <select class="filter-select" id="ren-status" onchange="filterRenamer()">
          <option value="">All Status</option>
          <option value="failed">Failed</option>
          <option value="wrong_read">Wrong Read</option>
          <option value="skipped">Skipped</option>
          <option value="success">Success</option>
        </select>
        <select class="filter-select" id="ren-device" onchange="filterRenamer()">
          <option value="">All Devices</option>
        </select>
        <span id="ren-count" class="text-muted" style="font-size:11px;margin-left:auto"></span>
      </div>
      <div style="overflow-x:auto;max-height:500px;overflow-y:auto">
        <table class="data-table">
          <thead><tr><th>#</th><th>Device</th><th>Session</th><th>Status</th><th>Original</th><th>Expected</th><th>Actual (Bot Output)</th><th>Error Type</th><th>Time</th></tr></thead>
          <tbody id="ren-tbody"><tr><td colspan="9" class="loading-row"><span class="spinner"></span></td></tr></tbody>
        </table>
      </div>
    </div>`;

  let allRen=[];
  const unsub=db.collectionGroup('renamer_docs').orderBy('ts','desc').limit(1000)
    .onSnapshot(snap=>{
      allRen=snap.docs.map(d=>({id:d.id,...d.data()}));
      // KPIs
      $('ren-kpi-fail').textContent = allRen.filter(e=>e.status==='failed').length;
      $('ren-kpi-wr').textContent   = allRen.filter(e=>e.status==='wrong_read').length;
      $('ren-kpi-skip').textContent = allRen.filter(e=>e.status==='skipped').length;
      $('ren-kpi-ok').textContent   = allRen.filter(e=>e.status==='success').length;
      // device filter
      const devices=[...new Set(allRen.map(e=>e.hostname||e.device_hostname).filter(Boolean))].sort();
      const sel=$('ren-device');
      if(sel){const cur=sel.value;sel.innerHTML='<option value="">All Devices</option>'+devices.map(h=>`<option${h===cur?' selected':''}>${h}</option>`).join('');}
      filterRenamer();
    });
  addListener(unsub);

  window.filterRenamer=function(){
    const q=$('ren-q')?.value.toLowerCase()||'';
    const st=$('ren-status')?.value||'';
    const dev=$('ren-device')?.value||'';
    let filtered=allRen.filter(e=>{
      const host=e.hostname||e.device_hostname||'';
      return (!q||(e.original_name||'').toLowerCase().includes(q)||(e.expected_name||'').toLowerCase().includes(q)||host.toLowerCase().includes(q))
          &&(!st||e.status===st)
          &&(!dev||host===dev);
    });
    $('ren-count').textContent=`${filtered.length} doc${filtered.length!==1?'s':''}`;
    renderRenamerTable(filtered);
  };
  function renderRenamerTable(rows){
    const tbody=$('ren-tbody');if(!tbody)return;
    if(!rows.length){tbody.innerHTML='<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📄</div><div class="empty-title">No records</div></div></td></tr>';return;}
    tbody.innerHTML=rows.slice(0,200).map((e,i)=>{
      const isIssue=['failed','wrong_read','skipped'].includes(e.status);
      const mismatch=e.expected_name&&e.actual_name&&e.expected_name!==e.actual_name;
      return `<tr>
        <td class="text-muted">${i+1}</td>
        <td><span class="device-link" onclick="navigate('device-detail',{hostname:'${e.hostname||e.device_hostname||''}'})">
          ${e.hostname||e.device_hostname||'?'}</span></td>
        <td class="text-mono" style="font-size:10px;color:var(--text-2)">${(e.session_id||'').slice(0,16)}…</td>
        <td>${categoryBadge(e.status)}</td>
        <td class="text-mono truncate" style="max-width:140px" title="${e.original_name||''}">${e.original_name||'—'}</td>
        <td class="text-mono truncate" style="max-width:140px;color:var(--info)" title="${e.expected_name||''}">${e.expected_name||'—'}</td>
        <td class="text-mono truncate" style="max-width:140px;${mismatch?'color:var(--warn)':''}" title="${e.actual_name||''}">${e.actual_name||'—'}</td>
        <td class="${isIssue?'text-danger':''}">${e.error_type||'—'}</td>
        <td class="text-muted" style="white-space:nowrap">${ago(e.ts)}</td>
      </tr>`;
    }).join('');
  }
  window.exportRenamerIssues=function(){
    const issues=allRen.filter(e=>e.status!=='success');
    const csv=['Device,Session,Status,Original,Expected,Actual,ErrorType,Time',...issues.map(e=>[
      e.hostname||e.device_hostname||'',e.session_id||'',e.status,
      `"${e.original_name||''}"`,`"${e.expected_name||''}"`,`"${e.actual_name||''}"`,
      e.error_type||'',fmt(e.ts)
    ].join(','))].join('\n');
    const a=document.createElement('a');a.href='data:text/csv,'+encodeURIComponent(csv);a.download='renamer_issues.csv';a.click();
  };
}

/* ════════════════════════════════════════════════════════
   12. VIBES MONITOR (cross-device patient list trace)
════════════════════════════════════════════════════════ */
function renderVibes() {
  const vc=$('view-container');
  vc.innerHTML=`
    <div class="kpi-grid">
      <div class="kpi-card danger"><div class="kpi-label">Open Errors</div><div class="kpi-value" id="vb-kpi-open">—</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Upload Skipped</div><div class="kpi-value" id="vb-kpi-skip">—</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Panics</div><div class="kpi-value" id="vb-kpi-panic">—</div></div>
      <div class="kpi-card purple"><div class="kpi-label">Total Events</div><div class="kpi-value" id="vb-kpi-total">—</div></div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">VIBES Patient Upload Trace — All Devices</span>
        <div class="panel-actions">
          <button class="btn btn-outline btn-sm" onclick="exportVibesPatients()">⬇ Export CSV</button>
        </div>
      </div>
      <div class="filter-bar">
        <input class="filter-input" id="vb-q" placeholder="Tuntutan no / device…" oninput="filterVibesPatients()"/>
        <select class="filter-select" id="vb-vstatus" onchange="filterVibesPatients()">
          <option value="">All Upload Status</option>
          <option value="uploaded">Uploaded</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </select>
        <select class="filter-select" id="vb-wstatus" onchange="filterVibesPatients()">
          <option value="">All VIMS Status</option>
          <option value="scraped">Scraped</option>
          <option value="skipped">Bot Skipped</option>
          <option value="not_found">Not in Portal</option>
          <option value="pending">Pending</option>
        </select>
        <select class="filter-select" id="vb-device" onchange="filterVibesPatients()">
          <option value="">All Devices</option>
        </select>
        <span id="vb-count" class="text-muted" style="font-size:11px;margin-left:auto"></span>
      </div>
      <div style="overflow-x:auto;max-height:500px;overflow-y:auto">
        <table class="data-table">
          <thead><tr><th>#</th><th>Device</th><th>Run</th><th>Tuntutan No</th><th>VIMS Amount</th><th>VIMS Status</th><th>Upload Status</th><th>Skip Reason</th><th>VIBES Time</th></tr></thead>
          <tbody id="vb-tbody"><tr><td colspan="9" class="loading-row"><span class="spinner"></span></td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><span class="panel-title">VIBES Error Events (by Category)</span></div>
      <div class="filter-bar">
        <select class="filter-select" id="vbe-cat" onchange="filterVibesErrors()">
          <option value="">All Categories</option>
          <option value="guard_exhausted">guard_exhausted</option>
          <option value="batch_skip">batch_skip</option>
          <option value="upload_retry_exhausted">upload_retry_exhausted</option>
          <option value="reconciliation_incomplete">reconciliation_incomplete</option>
          <option value="panic">panic</option>
          <option value="preflight_warn">preflight_warn</option>
        </select>
        <select class="filter-select" id="vbe-device" onchange="filterVibesErrors()">
          <option value="">All Devices</option>
        </select>
        <select class="filter-select" id="vbe-fixstatus" onchange="filterVibesErrors()">
          <option value="">All Fix Status</option>
          <option value="unfixed">Unfixed</option>
          <option value="fixed">Fixed</option>
        </select>
      </div>
      <div style="overflow-x:auto;max-height:400px;overflow-y:auto">
        <table class="data-table">
          <thead><tr><th>Time</th><th>Device</th><th>Category</th><th>Summary</th><th>Tuntutan</th><th>Skipped</th><th>Fix</th><th>Action</th></tr></thead>
          <tbody id="vbe-tbody"><tr><td colspan="8" class="loading-row"><span class="spinner"></span></td></tr></tbody>
        </table>
      </div>
    </div>`;

  // VIBES error events
  let allVbErrors=[];
  const errUnsub=db.collectionGroup('vibes_errors').orderBy('ts_utc','desc').limit(500)
    .onSnapshot(snap=>{
      allVbErrors=snap.docs.map(d=>({id:d.id,...d.data()}));
      $('vb-kpi-open').textContent  = allVbErrors.filter(e=>e.fix_status==='unfixed').length;
      $('vb-kpi-skip').textContent  = allVbErrors.filter(e=>e.category==='batch_skip').length;
      $('vb-kpi-panic').textContent = allVbErrors.filter(e=>e.category==='panic').length;
      $('vb-kpi-total').textContent = allVbErrors.length;
      const devs=[...new Set(allVbErrors.map(e=>e.device_hostname).filter(Boolean))].sort();
      const sel=$('vbe-device');
      if(sel){const cur=sel.value;sel.innerHTML='<option value="">All Devices</option>'+devs.map(h=>`<option${h===cur?' selected':''}>${h}</option>`).join('');}
      filterVibesErrors();
    });
  addListener(errUnsub);

  window.filterVibesErrors=function(){
    const cat=$('vbe-cat')?.value||'';
    const dev=$('vbe-device')?.value||'';
    const fix=$('vbe-fixstatus')?.value||'';
    const rows=allVbErrors.filter(e=>(!cat||e.category===cat)&&(!dev||e.device_hostname===dev)&&(!fix||e.fix_status===fix));
    const tbody=$('vbe-tbody');if(!tbody)return;
    tbody.innerHTML=rows.slice(0,200).map(e=>`<tr>
      <td class="text-mono" style="white-space:nowrap;font-size:10px">${fmt(e.ts_local||e.ts_utc)}</td>
      <td><span class="device-link" onclick="navigate('device-detail',{hostname:'${e.device_hostname||''}'})">${e.device_hostname||'?'}</span></td>
      <td>${categoryBadge(e.category)}</td>
      <td style="max-width:180px;font-size:11px" title="${e.summary||''}">${(e.summary||'').slice(0,55)}${e.summary?.length>55?'…':''}</td>
      <td class="text-mono">${e.tuntutan_no||'—'}</td>
      <td>${e.skipped_count!=null?`<span class="text-danger">${e.skipped_count}</span>`:'—'}</td>
      <td>${e.fix_status==='fixed'?'<span class="badge success">Fixed</span>':'<span class="badge danger">Open</span>'}</td>
      <td>
        ${e.fix_status==='unfixed'?`<button class="btn btn-warn btn-sm" onclick="openFixModal('${e.device_hostname}','${e.id}','${e.run_id}')">Fix</button>`:''}
        <button class="btn btn-outline btn-sm" onclick='showErrorDetail(${JSON.stringify(e).replace(/'/g,"&#39;")})'>▶</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">No errors</div></div></td></tr>';
  };

  // Patient list trace
  let allPatients=[];
  const patUnsub=db.collectionGroup('vibes_patients').orderBy('ts_vibes','desc').limit(1000)
    .onSnapshot(snap=>{
      allPatients=snap.docs.map(d=>({id:d.id,...d.data()}));
      const devs=[...new Set(allPatients.map(e=>e.hostname||e.device_hostname).filter(Boolean))].sort();
      const sel=$('vb-device');
      if(sel){const cur=sel.value;sel.innerHTML='<option value="">All Devices</option>'+devs.map(h=>`<option${h===cur?' selected':''}>${h}</option>`).join('');}
      filterVibesPatients();
    });
  addListener(patUnsub);

  window.filterVibesPatients=function(){
    const q=$('vb-q')?.value.toLowerCase()||'';
    const vs=$('vb-vstatus')?.value||'';
    const ws=$('vb-wstatus')?.value||'';
    const dev=$('vb-device')?.value||'';
    const rows=allPatients.filter(e=>{
      const host=e.hostname||e.device_hostname||'';
      return (!q||(e.tuntutan_no||'').toLowerCase().includes(q)||host.toLowerCase().includes(q))
          &&(!vs||e.vibes_status===vs)&&(!ws||e.vims_status===ws)&&(!dev||host===dev);
    });
    $('vb-count').textContent=`${rows.length} patient${rows.length!==1?'s':''}`;
    const tbody=$('vb-tbody');if(!tbody)return;
    if(!rows.length){
      tbody.innerHTML='<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No patient records</div><div class="empty-sub">VIBES bot must write to devices/{hostname}/vibes_patients</div></div></td></tr>';
      return;
    }
    tbody.innerHTML=rows.slice(0,200).map((e,i)=>{
      const isIssue=['failed','skipped','pending'].includes(e.vibes_status);
      const vimsSkip=e.vims_status==='skipped';
      return `<tr class="${isIssue?'patient-row issue':'patient-row ok'}">
        <td class="text-muted">${i+1}</td>
        <td><span class="device-link" onclick="navigate('device-detail',{hostname:'${e.hostname||e.device_hostname||''}'})">${e.hostname||e.device_hostname||'?'}</span></td>
        <td class="text-mono" style="font-size:10px;color:var(--text-2)">${(e.run_id||'').slice(0,14)}…</td>
        <td class="text-mono">${e.tuntutan_no||'—'}</td>
        <td class="${e.vims_amount?'amount-ok':'amount-missing'}">${e.vims_amount!=null?`RM ${Number(e.vims_amount).toFixed(2)}`:'—'}</td>
        <td>${vimsSkip?`<span class="badge warn">bot skipped</span>`:categoryBadge(e.vims_status||'pending')}</td>
        <td>${categoryBadge(e.vibes_status||'pending')}</td>
        <td class="text-warn">${e.skip_reason||'—'}</td>
        <td class="text-muted" style="white-space:nowrap">${ago(e.ts_vibes)}</td>
      </tr>`;
    }).join('');
  };
  window.exportVibesPatients=function(){
    const csv=['Device,RunID,TuntutanNo,VIMSAmount,VIMSStatus,VIBESStatus,SkipReason',
      ...allPatients.map(e=>[
        e.hostname||e.device_hostname||'',e.run_id||'',e.tuntutan_no||'',
        e.vims_amount!=null?e.vims_amount:'',e.vims_status||'',e.vibes_status||'',
        `"${e.skip_reason||''}"`
      ].join(','))
    ].join('\n');
    const a=document.createElement('a');a.href='data:text/csv,'+encodeURIComponent(csv);a.download='vibes_patients.csv';a.click();
  };
}

/* ════════════════════════════════════════════════════════
   13. VIMS MONITOR (cross-device scrape trace)
════════════════════════════════════════════════════════ */
function renderVims() {
  const vc=$('view-container');
  vc.innerHTML=`
    <div class="kpi-grid">
      <div class="kpi-card green"><div class="kpi-label">Success</div><div class="kpi-value" id="vs-kpi-ok">—</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Bot Skipped</div><div class="kpi-value" id="vs-kpi-skip">—</div><div class="kpi-sub">bot issue — NOT portal</div></div>
      <div class="kpi-card info"><div class="kpi-label">Not in Portal</div><div class="kpi-value" id="vs-kpi-nf">—</div><div class="kpi-sub">portal issue</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Errors</div><div class="kpi-value" id="vs-kpi-err">—</div></div>
    </div>

    <div class="panel" style="padding:12px 14px;margin-bottom:14px;border-left:3px solid var(--warn)">
      <b style="color:var(--warn)">⚠ Distinction:</b>
      <span style="color:var(--text-1);font-size:12px;margin-left:6px">
        <b class="text-warn">Bot Skipped</b> = bot ada masalah, tak scrape. Issue datang dari apps.
        <b class="text-info" style="margin-left:12px">Not in Portal</b> = no. do tak wujud di portal VIMS. Bukan salah bot.
      </span>
    </div>

    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">VIMS Scrape Trace — All Devices</span>
        <div class="panel-actions">
          <button class="btn btn-warn btn-sm" onclick="showOnlySkipped()">Show Only Bot Skips</button>
          <button class="btn btn-outline btn-sm" onclick="exportVimsResults()">⬇ Export CSV</button>
        </div>
      </div>
      <div class="filter-bar">
        <input class="filter-input" id="vims-q" placeholder="No. Do / device…" oninput="filterVimsResults()"/>
        <select class="filter-select" id="vims-stat" onchange="filterVimsResults()">
          <option value="">All Status</option>
          <option value="success">Success</option>
          <option value="skipped">Bot Skipped</option>
          <option value="not_found">Not in Portal</option>
          <option value="error">Error</option>
        </select>
        <select class="filter-select" id="vims-dev" onchange="filterVimsResults()">
          <option value="">All Devices</option>
        </select>
        <span id="vims-count" class="text-muted" style="font-size:11px;margin-left:auto"></span>
      </div>
      <div style="overflow-x:auto;max-height:520px;overflow-y:auto">
        <table class="data-table">
          <thead><tr><th>#</th><th>Device</th><th>Session</th><th>No. Do</th><th>Status</th><th>Amount (RM)</th><th>Source</th><th>Skip Reason (Bot)</th><th>Time</th></tr></thead>
          <tbody id="vims-tbody"><tr><td colspan="9" class="loading-row"><span class="spinner"></span></td></tr></tbody>
        </table>
      </div>
    </div>`;

  let allVims=[];
  const unsub=db.collectionGroup('vims_results').orderBy('ts','desc').limit(2000)
    .onSnapshot(snap=>{
      allVims=snap.docs.map(d=>({id:d.id,...d.data()}));
      $('vs-kpi-ok').textContent   = allVims.filter(e=>e.status==='success').length;
      $('vs-kpi-skip').textContent = allVims.filter(e=>e.status==='skipped').length;
      $('vs-kpi-nf').textContent   = allVims.filter(e=>e.status==='not_found').length;
      $('vs-kpi-err').textContent  = allVims.filter(e=>e.status==='error').length;
      const devs=[...new Set(allVims.map(e=>e.hostname||e.device_hostname).filter(Boolean))].sort();
      const sel=$('vims-dev');
      if(sel){const cur=sel.value;sel.innerHTML='<option value="">All Devices</option>'+devs.map(h=>`<option${h===cur?' selected':''}>${h}</option>`).join('');}
      filterVimsResults();
    });
  addListener(unsub);

  window.showOnlySkipped=function(){ const s=$('vims-stat');if(s){s.value='skipped';}filterVimsResults(); };
  window.filterVimsResults=function(){
    const q=$('vims-q')?.value.toLowerCase()||'';
    const st=$('vims-stat')?.value||'';
    const dev=$('vims-dev')?.value||'';
    const rows=allVims.filter(e=>{
      const host=e.hostname||e.device_hostname||'';
      return (!q||(e.no_do||'').toLowerCase().includes(q)||host.toLowerCase().includes(q))
          &&(!st||e.status===st)&&(!dev||host===dev);
    });
    $('vims-count').textContent=`${rows.length} result${rows.length!==1?'s':''}`;
    const tbody=$('vims-tbody');if(!tbody)return;
    tbody.innerHTML=rows.slice(0,300).map((e,i)=>{
      const isBotSkip=e.status==='skipped';
      const isNotFound=e.status==='not_found';
      const rowCls=isBotSkip?'scrape-skipped':isNotFound?'scrape-not-found':'scrape-ok';
      return `<tr class="${rowCls}">
        <td class="text-muted">${i+1}</td>
        <td><span class="device-link" onclick="navigate('device-detail',{hostname:'${e.hostname||e.device_hostname||''}'})">${e.hostname||e.device_hostname||'?'}</span></td>
        <td class="text-mono" style="font-size:10px;color:var(--text-2)">${(e.session_id||'').slice(0,14)}…</td>
        <td class="text-mono">${e.no_do||'—'}</td>
        <td>${isBotSkip?`<span class="badge warn">🤖 Bot Skipped</span>`:isNotFound?`<span class="badge info">Not in Portal</span>`:categoryBadge(e.status)}</td>
        <td class="${e.amount?'amount-ok':'amount-missing'}">${e.amount!=null?`RM ${Number(e.amount).toFixed(2)}`:'—'}</td>
        <td class="text-muted">${e.source||'—'}</td>
        <td class="${isBotSkip?'text-warn':''}">${isBotSkip?(e.skip_reason||'unspecified'):'—'}</td>
        <td class="text-muted" style="white-space:nowrap">${ago(e.ts)}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">No VIMS results</div><div class="empty-sub">VIMS bot must write to devices/{hostname}/vims_results</div></div></td></tr>';
  };
  window.exportVimsResults=function(){
    const csv=['Device,Session,NoDo,Status,Amount,Source,SkipReason',
      ...allVims.map(e=>[
        e.hostname||e.device_hostname||'',e.session_id||'',e.no_do||'',
        e.status||'',e.amount!=null?e.amount:'',e.source||'',`"${e.skip_reason||''}"`
      ].join(','))
    ].join('\n');
    const a=document.createElement('a');a.href='data:text/csv,'+encodeURIComponent(csv);a.download='vims_results.csv';a.click();
  };
}

/* ════════════════════════════════════════════════════════
   14. LOG EXPLORER
════════════════════════════════════════════════════════ */
function renderLogs() {
  const vc=$('view-container');
  vc.innerHTML=`
    <div class="panel">
      <div class="panel-header"><span class="panel-title">Log Explorer — All Devices</span></div>
      <div class="filter-bar">
        <input class="filter-input" id="log-q" placeholder="Event / claim_no / invoice_no…"/>
        <select class="filter-select" id="log-sev">
          <option value="">All Severity</option>
          <option value="ERROR">ERROR</option>
          <option value="WARN">WARN</option>
          <option value="INFO">INFO</option>
          <option value="DEBUG">DEBUG</option>
        </select>
        <select class="filter-select" id="log-dev">
          <option value="">All Devices</option>
          ${Object.keys(STATE.devices).sort().map(h=>`<option>${h}</option>`).join('')}
        </select>
        <input class="filter-input" id="log-claim" placeholder="Claim no…" style="max-width:160px"/>
        <button class="btn btn-primary btn-sm" onclick="searchLogs()">Search</button>
        <button class="btn btn-outline btn-sm" onclick="exportLogs()">⬇ CSV</button>
      </div>
      <div style="overflow-x:auto;max-height:560px;overflow-y:auto">
        <table class="data-table">
          <thead><tr><th>Time</th><th>Device</th><th>Severity</th><th>Event</th><th>Claim</th><th>Invoice</th><th>▶</th></tr></thead>
          <tbody id="log-tbody"><tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">Enter filters and press Search</div></div></td></tr></tbody>
        </table>
      </div>
      <div class="pagination" id="log-pag"></div>
    </div>`;

  let logData=[], logCursor=null;
  window._logData=logData;

  window.searchLogs=function(){
    const tbody=$('log-tbody');if(!tbody)return;
    tbody.innerHTML='<tr><td colspan="7" class="loading-row"><span class="spinner"></span></td></tr>';
    const sev=$('log-sev')?.value||'';
    const dev=$('log-dev')?.value||'';
    const claim=$('log-claim')?.value.trim()||'';
    const q=$('log-q')?.value.toLowerCase()||'';
    let ref=db.collection('logs').orderBy('ts','desc').limit(300);
    if(sev)  ref=ref.where('severity','==',sev);
    if(dev)  ref=ref.where('hostname','==',dev);
    if(claim)ref=ref.where('claim_no','==',claim);
    ref.get().then(snap=>{
      logData=snap.docs.map(d=>({id:d.id,...d.data()})).filter(e=>!q||(e.event||'').toLowerCase().includes(q));
      window._logData=logData;
      renderLogTable(logData);
    }).catch(e=>{ tbody.innerHTML=`<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">${e.message}</div></div></td></tr>`; });
  };
  function renderLogTable(rows){
    const tbody=$('log-tbody');if(!tbody)return;
    if(!rows.length){tbody.innerHTML='<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No logs found</div></div></td></tr>';return;}
    tbody.innerHTML=rows.slice(0,200).map(e=>`<tr class="log-row">
      <td class="log-ts">${fmt(e.ts)}</td>
      <td class="log-host">${e.hostname||'?'}</td>
      <td class="log-sev-${e.severity||'INFO'}">${e.severity||'INFO'}</td>
      <td class="log-msg">${e.event||'—'}</td>
      <td class="text-mono">${e.claim_no||'—'}</td>
      <td class="text-mono">${e.invoice_no||'—'}</td>
      <td><button class="btn btn-outline btn-sm" onclick='showErrorDetail(${JSON.stringify(e).replace(/'/g,"&#39;")})'>▶</button></td>
    </tr>`).join('');
  }
  window.exportLogs=function(){
    const rows=window._logData||[];
    const csv=['Time,Device,Severity,Event,ClaimNo,InvoiceNo',
      ...rows.map(e=>[fmt(e.ts),e.hostname||'',e.severity||'',`"${e.event||''}"`,e.claim_no||'',e.invoice_no||''].join(','))
    ].join('\n');
    const a=document.createElement('a');a.href='data:text/csv,'+encodeURIComponent(csv);a.download='logs.csv';a.click();
  };
}

/* ════════════════════════════════════════════════════════
   15. COMMANDS (broadcast)
════════════════════════════════════════════════════════ */
function renderCommands() {
  const vc=$('view-container');
  const devices=Object.keys(STATE.devices).sort();
  vc.innerHTML=`
    <div class="grid-2">
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Send Command</span></div>
        <div style="padding:14px;display:flex;flex-direction:column;gap:12px">
          <div>
            <label class="section-heading" style="margin:0 0 6px">Target</label>
            <select class="filter-select" id="bc-target" onchange="updateTargetUI()" style="width:100%">
              <option value="all">📡 All Devices</option>
              <option value="branch">🏥 By Branch</option>
              <option value="single">🖥 Single Device</option>
            </select>
          </div>
          <div id="bc-target-extra"></div>
          <div>
            <label class="section-heading" style="margin:0 0 6px">Command</label>
            <select class="filter-select" id="bc-cmd" style="width:100%">
              <option value="restart_vibes">Restart VIBES Agent</option>
              <option value="restart_vims">Restart VIMS Agent</option>
              <option value="restart_all">Restart All Apps</option>
              <option value="force_log_upload">Force Log Upload</option>
              <option value="clear_errorlog">Clear Local Error Log</option>
              <option value="run_diagnostic">Run Diagnostic</option>
            </select>
          </div>
          <div>
            <label class="section-heading" style="margin:0 0 6px">Note (optional)</label>
            <input class="filter-input" id="bc-note" placeholder="Reason for command…" style="width:100%"/>
          </div>
          <button class="btn btn-primary" onclick="sendBroadcastCommand()">⚡ Send Command</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Recent Commands</span><span class="panel-actions"><button class="btn btn-outline btn-sm" onclick="loadAllCmds()">Refresh</button></span></div>
        <div style="max-height:400px;overflow-y:auto">
          <table class="data-table">
            <thead><tr><th>Time</th><th>Target</th><th>Cmd</th><th>Status</th><th>By</th></tr></thead>
            <tbody id="all-cmd-tbody"><tr><td colspan="5" class="loading-row"><span class="spinner"></span></td></tr></tbody>
          </table>
        </div>
      </div>
    </div>`;
  loadAllCmds();
  updateTargetUI();
}

window.updateTargetUI=function(){
  const t=$('bc-target')?.value||'all';
  const extra=$('bc-target-extra');
  if(!extra)return;
  if(t==='branch'){
    const branches=[...new Set(Object.values(STATE.devices).map(d=>d.branch).filter(Boolean))].sort();
    extra.innerHTML=`<select class="filter-select" id="bc-branch" style="width:100%"><option value="">Select branch…</option>${branches.map(b=>`<option>${b}</option>`).join('')}</select>`;
  } else if(t==='single'){
    const devs=Object.keys(STATE.devices).sort();
    extra.innerHTML=`<select class="filter-select" id="bc-device" style="width:100%"><option value="">Select device…</option>${devs.map(h=>`<option>${h}</option>`).join('')}</select>`;
  } else { extra.innerHTML=''; }
};

window.sendBroadcastCommand=function(){
  const t=$('bc-target')?.value||'all';
  const cmd=$('bc-cmd')?.value;
  const note=$('bc-note')?.value||'';
  if(!cmd)return;
  let targets=[];
  if(t==='all') targets=Object.keys(STATE.devices);
  else if(t==='branch'){const br=$('bc-branch')?.value;if(!br){toast('Select a branch','warn');return;}targets=Object.values(STATE.devices).filter(d=>d.branch===br).map(d=>d.hostname||d.id);}
  else{const dev=$('bc-device')?.value;if(!dev){toast('Select a device','warn');return;}targets=[dev];}
  if(!targets.length){toast('No targets','warn');return;}
  if(!confirm(`Send '${cmd}' to ${targets.length} device(s)?`))return;
  const batch=db.batch();
  targets.forEach(host=>{
    const ref=db.collection('commands').doc();
    batch.set(ref,{target_hostname:host,command:cmd,note,status:'queued',created_by:STATE.user?.email||'admin',created_at:firebase.firestore.FieldValue.serverTimestamp()});
  });
  batch.commit().then(()=>{toast(`Command '${cmd}' sent to ${targets.length} device(s)`,'success');loadAllCmds();$('bc-note').value='';})
    .catch(e=>toast('Error: '+e.message,'error'));
};

window.loadAllCmds=function(){
  const tbody=$('all-cmd-tbody');if(!tbody)return;
  const unsub=db.collection('commands').orderBy('created_at','desc').limit(100)
    .onSnapshot(snap=>{
      tbody.innerHTML=snap.docs.map(d=>{
        const e=d.data();
        return `<tr>
          <td class="text-mono" style="white-space:nowrap;font-size:10px">${fmt(e.created_at)}</td>
          <td class="text-mono truncate" style="max-width:120px">${e.target_hostname||'?'}</td>
          <td class="text-mono">${e.command}</td>
          <td class="cmd-status-${e.status||'queued'}">${e.status||'queued'}</td>
          <td class="text-muted">${e.created_by||'—'}</td>
        </tr>`;
      }).join('')||'<tr><td colspan="5" class="text-muted" style="text-align:center;padding:20px">No commands</td></tr>';
    });
  addListener(unsub);
};

/* ════════════════════════════════════════════════════════
   16. ALERTS VIEW
════════════════════════════════════════════════════════ */
function renderAlerts() {
  const vc=$('view-container');
  vc.innerHTML=`
    <div class="kpi-grid">
      <div class="kpi-card danger"><div class="kpi-label">Critical Open</div><div class="kpi-value" id="al-crit">—</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Warnings Open</div><div class="kpi-value" id="al-warn">—</div></div>
      <div class="kpi-card green"><div class="kpi-label">Fixed Today</div><div class="kpi-value" id="al-fixed">—</div></div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">All Open Alerts (Unfixed Errors)</span>
        <div class="panel-actions">
          <select class="filter-select" id="al-cat" onchange="filterAlerts()">
            <option value="">All Categories</option>
            <option value="panic">panic</option>
            <option value="reconciliation_incomplete">reconciliation_incomplete</option>
            <option value="batch_skip">batch_skip</option>
            <option value="guard_exhausted">guard_exhausted</option>
            <option value="upload_retry_exhausted">upload_retry_exhausted</option>
            <option value="ocr_failed">ocr_failed (FV Branch)</option>
          </select>
        </div>
      </div>
      <div style="max-height:600px;overflow-y:auto">
        <div id="alert-feed-main"></div>
      </div>
    </div>`;

  let allAlerts=[];
  let allAppErrors=[];

  const unsub=db.collectionGroup('vibes_errors')
    .where('fix_status','==','unfixed')
    .orderBy('ts_utc','desc').limit(200)
    .onSnapshot(snap=>{
      allAlerts=snap.docs.map(d=>({id:d.id,...d.data()}));
      const crit=allAlerts.filter(e=>['panic','reconciliation_incomplete'].includes(e.category)).length;
      $('al-crit').textContent=crit;
      $('al-warn').textContent=allAlerts.length-crit+allAppErrors.length;
      filterAlerts();
    });
  addListener(unsub);

  // app_errors — migrated from Firestore to Supabase app_errors table.
  // Poll every 30s; unsub clears the interval when navigating away.
  let _appErrInterval=null;
  window._fetchAppErrors=async function(){
    try{
      const {data,error}=await supa.from('app_errors')
        .select('*')
        .eq('fix_status','unfixed')
        .order('first_seen',{ascending:false})
        .limit(100);
      if(error) throw error;
      allAppErrors=data||[];
      const crit=allAlerts.filter(e=>['panic','reconciliation_incomplete'].includes(e.category)).length;
      $('al-warn').textContent=allAlerts.length-crit+allAppErrors.length;
      filterAlerts();
    }catch(err){
      console.error('[app_errors supabase]',err.message);
    }
  };
  window._fetchAppErrors();
  _appErrInterval=setInterval(window._fetchAppErrors,30000);
  addListener(()=>{ if(_appErrInterval){clearInterval(_appErrInterval);_appErrInterval=null;} });

  // fixed today
  const today=new Date();today.setHours(0,0,0,0);
  const fixUnsub=db.collectionGroup('vibes_errors')
    .where('fix_status','==','fixed')
    .where('fixed_at','>=',firebase.firestore.Timestamp.fromDate(today))
    .onSnapshot(snap=>{ $('al-fixed').textContent=snap.size; });
  addListener(fixUnsub);

  window.filterAlerts=function(){
    const cat=$('al-cat')?.value||'';
    const rows=allAlerts.filter(e=>!cat||e.category===cat);
    // FV app_errors shown when no filter or when ocr_failed selected
    const fvOcrErrors=allAppErrors.filter(e=>
      e.app_name==='FV Branch' && (!cat || cat==='ocr_failed'));
    const feed=$('alert-feed-main');if(!feed)return;
    if(!rows.length&&!fvOcrErrors.length){
      feed.innerHTML='<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">No open alerts</div></div>';
      return;
    }
    let html='';

    // ── FV Branch OCR failures banner ─────────────────────────────────────────
    if(fvOcrErrors.length){
      const targets=fvOcrErrors.map(e=>{
        const file=(e.job_info&&e.job_info.file_name)||'?';
        const recur=e.recur_count>1?` (×${e.recur_count})`:'';
        const cause=e.root_cause||e.error_msg||'OCR Failed';
        return `• ${file}${recur} — ${cause}`;
      }).join('\n');
      html+=`<div style="
        background:rgba(255,190,0,0.08);
        border:1px solid var(--warn);
        border-left:4px solid var(--warn);
        border-radius:6px;
        padding:14px 16px;
        margin-bottom:14px;
        font-family:var(--font-mono);
        font-size:11px;
        color:var(--text-1);
        line-height:1.7;
      ">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <span style="color:var(--warn);font-size:12px;font-weight:700;letter-spacing:1px">
            ⚠ FV BRANCH ERROR — ${fvOcrErrors.length} FILE${fvOcrErrors.length>1?'S':''}
          </span>
          <button class="btn btn-outline btn-sm" style="color:var(--warn);border-color:var(--warn)"
            onclick="dismissAllFvOcrErrors(${JSON.stringify(fvOcrErrors.map(e=>e.id)).replace(/"/g,'&quot;')})">
            ✕ CLEAR ALL
          </button>
        </div>
        <pre style="margin:0;white-space:pre-wrap;color:var(--text-1)">${targets}</pre>
        <div style="margin-top:8px;color:var(--text-2);font-size:10px;letter-spacing:1px">
          Cause: Check root_cause above — may be OCR failure, file lock (WinError 32), or rename error.
        </div>
      </div>`;
    }

    // ── Standard vibes_errors alerts ─────────────────────────────────────────
    html+=rows.map(e=>{
      const isCrit=['panic','reconciliation_incomplete'].includes(e.category);
      const lvl=isCrit?'crit':'warn';
      return `<div class="alert-item ${lvl}" onclick="navigate('device-detail',{hostname:'${e.device_hostname||''}'})">
        <div class="alert-dot ${lvl}"></div>
        <div class="alert-content">
          <div class="alert-msg">[${e.device_hostname||'?'}] ${e.summary||e.category}</div>
          <div class="alert-meta">${categoryBadge(e.category)} · tuntutan: ${e.tuntutan_no||'—'} · ${e.run_id||'—'}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <div class="alert-ts">${ago(e.ts_utc)}</div>
          <button class="btn btn-warn btn-sm" onclick="event.stopPropagation();openFixModal('${e.device_hostname}','${e.id}','${e.run_id}')">Fix</button>
        </div>
      </div>`;
    }).join('');

    feed.innerHTML=html||'<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">No open alerts</div></div>';
  };
}

// One-click dismiss for FV Branch errors (Supabase app_errors table).
// ids are Supabase row UUIDs from app_errors.id.
window.dismissAllFvOcrErrors=async function(ids){
  if(!ids||!ids.length)return;
  const label=ids.length===1?'1 FV error':`${ids.length} FV errors`;
  if(!confirm(`Dismiss ${label}? File(s) were not renamed — check FAILED.png in bug/ folder.`))return;
  try{
    const {error}=await supa.from('app_errors')
      .update({
        fix_status:'fixed',
        fixed_by:  STATE.user?.email||'admin',
        fixed_at:  new Date().toISOString(),
      })
      .in('id',ids);
    if(error) throw error;
    toast(`${label} dismissed.`,'success');
    if(typeof window._fetchAppErrors==='function') window._fetchAppErrors();
  }catch(e){
    toast('Dismiss failed: '+e.message,'error');
  }
};

/* ════════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════════ */
// Enter key on login
document.addEventListener('keydown', e => {
  if(e.key==='Enter' && $('login-screen') && !$('login-screen').classList.contains('hidden')) doLogin();
});
