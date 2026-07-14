/* ==========================================================
   rasumi.js — Rasumi Apps Admin Mode
   Integrated into VIMS Admin Console as a switchable mode.

   FIREBASE SETUP:
   ─ Rasumi Apps backend writes to a SEPARATE Firebase project
     (project: rasumi-apps), different from the VIMS project.
   ─ This file initialises a SECOND Firebase app for that project.
   ─ FILL IN rasumiFirebaseConfig below with your rasumi-apps
     web SDK config from:
     Firebase Console → rasumi-apps → Project Settings →
     General → Your apps → Web app → Config
   ========================================================== */

(function () {
  'use strict';

  // ── ⚠️  FILL THIS IN ──────────────────────────────────────
  // Get from: Firebase Console → rasumi-apps project →
  // Project Settings → General → Your apps → Web app → Config
  var RASUMI_FIREBASE_CONFIG = {
    apiKey: "AIzaSyBf526r_J0EfpIm-2bYYoSUnCkgNNwXnpo",
    authDomain: "rasumi-apps.firebaseapp.com",
    projectId: "rasumi-apps",
    storageBucket: "rasumi-apps.firebasestorage.app",
    messagingSenderId: "946661064873",
    appId: "1:946661064873:web:4a080de1b0be87290229b8",
    measurementId: "G-XC6MRD7QJ5"
  };
  // ──────────────────────────────────────────────────────────

  // All apps in the Rasumi Apps ecosystem
  var RASUMI_APPS = [
    { key: 'renamer_hq', label: 'Renamer HQ', icon: 'fa-file-signature', firebaseNames: ['Renamer HQ'] },
    { key: 'fv_branch', label: 'FV Branch', icon: 'fa-code-branch', firebaseNames: ['FV Branch'] },
    { key: 'quick_rename', label: 'Quick Rename', icon: 'fa-bolt', firebaseNames: ['Quick Rename'] },
    { key: 'vibes', label: 'VIBES Agent', icon: 'fa-file-arrow-up', firebaseNames: ['VIBES', 'Vibes Agent'] },
    { key: 'vims', label: 'VIMS Scraper', icon: 'fa-magnifying-glass-chart', firebaseNames: ['VIMS', 'Vims Scraper'] },
    { key: 'scanify', label: 'Scanify', icon: 'fa-scanner', firebaseNames: ['Scanify'] },
    { key: 'pdf_splitter', label: 'PDF Splitter', icon: 'fa-file-pdf', firebaseNames: ['PDF Splitter', 'pdf_studio'] },
  ];

  // ── State ──────────────────────────────────────────────────
  var RS = {
    db: null,   // rasumi-apps Firestore
    auth: null,   // shared auth from app.js
    fbApp: null,   // second Firebase app instance
    route: 'r-dashboard',
    listeners: [],
    devices: {},
    unresolvedVibes: 0,
    unresolvedRenamer: 0,
    unresolvedVims: 0,
    appStats: {},     // keyed by app key → { today: N, errors: N, last_seen: ts }
    clockTick: null,
    initialized: false,
    configOk: false,
    // New: telemetry state
    _selectedDevice: null,   // hostname of selected node in dashboard
    _terminal: [],         // live stream lines
    _charts: {},         // Chart.js instances
    _logCache: [],         // log entries for modal
    _recentLogs: []          // recent logs for activity feed
  };

  // ── Helpers ────────────────────────────────────────────────
  var $r = function (id) { return document.getElementById(id); };
  var qra = function (sel) { return [].slice.call(document.querySelectorAll('#rasumi-container ' + sel)); };

  function rToast(msg, type, dur) {
    type = type || 'info'; dur = dur || 3500;
    var box = $r('r-toasts');
    if (!box) return;
    var t = document.createElement('div');
    t.className = 'r-toast r-toast-' + type;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () {
      t.classList.add('r-toast-out');
      setTimeout(function () { if (t.parentNode) t.remove(); }, 400);
    }, dur);
  }

  function fmtTs(ts) {
    if (!ts) return '—';
    var d;
    if (ts && ts.toDate) d = ts.toDate();
    else if (ts && ts.seconds) d = new Date(ts.seconds * 1000);
    else if (typeof ts === 'string') d = new Date(ts);   // ISO string e.g. "2026-05-05T08:44:16.839636"
    else d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts).substring(0, 19).replace('T', ' ');
    return d.toLocaleString('ms-MY', {
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  }

  function fmtElapsed(ts) {
    if (!ts) return 'never';
    var d;
    if (ts && ts.toDate) d = ts.toDate();
    else if (ts && ts.seconds) d = new Date(ts.seconds * 1000);
    else d = new Date(ts);
    var s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return Math.floor(s) + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  // Rasumi Apps status: ONLINE if last_heartbeat < 5 min
  function deviceStatus(data) {
    var ts = data.last_heartbeat || data.last_seen;
    if (!ts) return 'offline';
    var d;
    if (ts.toDate) d = ts.toDate();
    else if (ts.seconds) d = new Date(ts.seconds * 1000);
    else d = new Date(ts);
    var mins = (Date.now() - d.getTime()) / 60000;
    if (mins < 5) return 'online';
    if (mins < 15) return 'stale';
    return 'offline';
  }

  function errBadge(t) {
    var m = {
      guard_exhausted: 'r-badge-err',
      upload_retry_exhausted: 'r-badge-warn',
      batch_skip: 'r-badge-muted',
      reconciliation_incomplete: 'r-badge-info',
      FAILED: 'r-badge-err',
      ERROR: 'r-badge-err'
    };
    return m[t] || 'r-badge-muted';
  }

  function renameBadge(s) {
    var m = { success: 'r-badge-ok', COMPLETED: 'r-badge-ok', wrong_read: 'r-badge-warn', failed: 'r-badge-err', FAILED: 'r-badge-err', skipped: 'r-badge-muted' };
    return m[s] || 'r-badge-muted';
  }

  function logBadge(l) {
    var m = { error: 'r-badge-err', FAILED: 'r-badge-err', warn: 'r-badge-warn', warning: 'r-badge-warn', info: 'r-badge-info', COMPLETED: 'r-badge-ok', debug: 'r-badge-muted' };
    return m[(l || '').toUpperCase()] || m[l] || 'r-badge-muted';
  }

  function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function tableWrap(headers, rows) {
    return '<div class="r-table-wrap"><table class="r-table"><thead><tr>' +
      headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function errBox(msg) {
    return '<div class="r-alert-item err"><i class="fa-solid fa-circle-xmark"></i> Error: ' + esc(msg) + '</div>';
  }

  // ── Firebase Init ──────────────────────────────────────────
  function initRasumiFirebase() {
    if (RS.db) return true;

    // Detect if config is still placeholder
    if (RASUMI_FIREBASE_CONFIG.apiKey === 'YOUR_RASUMI_APPS_API_KEY') {
      RS.configOk = false;
      return false;
    }

    try {
      // Check if already initialized under this name
      try {
        RS.fbApp = firebase.app('rasumi-apps-admin');
      } catch (e) {
        RS.fbApp = firebase.initializeApp(RASUMI_FIREBASE_CONFIG, 'rasumi-apps-admin');
      }
      RS.db = RS.fbApp.firestore();
      RS.auth = firebase.auth(); // Shared auth from VIMS (app.js)
      RS.configOk = true;
      return true;
    } catch (e) {
      RS.configOk = false;
      return false;
    }
  }

  // ── Container HTML ─────────────────────────────────────────
  function injectHTML() {
    if ($r('rasumi-container')) return;
    var el = document.createElement('div');
    el.id = 'rasumi-container';
    el.className = 'hidden';
    el.innerHTML = [
      // ── TOPBAR (full-width, VIMS style) ──
      '<header class="r-topbar">',
      '  <div class="r-tb-brand">',
      '    <div class="r-brand-icon"><i class="fa-solid fa-shield-halved"></i></div>',
      '    <div class="r-brand-text">',
      '      <div class="r-brand-name">RASUMI APPS</div>',
      '      <div class="r-brand-sub">SUPER ADMIN CONSOLE</div>',
      '    </div>',
      '    <div class="r-status-chips">',
      '      <span class="r-chip chip-on"  id="r-chip-on">0 ONLINE</span>',
      '      <span class="r-chip chip-st"  id="r-chip-st">0 STALE</span>',
      '      <span class="r-chip chip-off" id="r-chip-off">0 OFFLINE</span>',
      '    </div>',
      '  </div>',
      '  <div class="r-tb-search">',
      '    <i class="fa-solid fa-magnifying-glass"></i>',
      '    <input type="text" id="r-tb-search-inp" placeholder="Search devices, logs, commands…" oninput="rGlobalSearch(this.value)">',
      '  </div>',
      '  <div class="r-tb-actions">',
      '    <span class="r-live-dot" title="Live sync"></span>',
      '    <span class="r-clock" id="r-clock">--:--:--</span>',
      '    <button class="r-back-vims" onclick="exitRasumiMode()"><i class="fa-solid fa-left-long"></i> VIMS</button>',
      '  </div>',
      '</header>',

      // ── HORIZONTAL NAV ──
      '<nav class="r-h-nav">',
      '  <div class="r-hn-item" id="rni-r-dashboard" onclick="rNav(\'r-dashboard\')"><i class="fa-solid fa-gauge-high"></i> Dashboard</div>',
      '  <div class="r-hn-item" id="rni-r-devices"   onclick="rNav(\'r-devices\')"><i class="fa-solid fa-server"></i> Device Fleet</div>',
      '  <div class="r-hn-sep"></div>',
      '  <div class="r-hn-item" id="rni-r-renamer"   onclick="rNav(\'r-renamer\')"><i class="fa-solid fa-file-signature"></i> Renamer Trace <span class="r-nb warn" id="r-nb-renamer" style="display:none"></span></div>',
      '  <div class="r-hn-item" id="rni-r-vibes"     onclick="rNav(\'r-vibes\')"><i class="fa-solid fa-file-arrow-up"></i> VIBES Monitor <span class="r-nb err" id="r-nb-vibes" style="display:none"></span></div>',
      '  <div class="r-hn-item" id="rni-r-vims"      onclick="rNav(\'r-vims\')"><i class="fa-solid fa-magnifying-glass-chart"></i> VIMS Scrape <span class="r-nb warn" id="r-nb-vims" style="display:none"></span></div>',
      '  <div class="r-hn-sep"></div>',
      '  <div class="r-hn-item" id="rni-r-logs"      onclick="rNav(\'r-logs\')"><i class="fa-solid fa-scroll"></i> Log Explorer</div>',
      '  <div class="r-hn-item" id="rni-r-commands"  onclick="rNav(\'r-commands\')"><i class="fa-solid fa-terminal"></i> Commands</div>',
      '  <div class="r-hn-item" id="rni-r-alerts"    onclick="rNav(\'r-alerts\')"><i class="fa-solid fa-triangle-exclamation"></i> Alerts <span class="r-nb err" id="r-nb-alerts" style="display:none"></span></div>',
      '</nav>',

      // ── BODY (nodes-panel + main) ──
      '<div class="r-body-wrap">',
      '  <div class="r-nodes-panel">',
      '    <div class="r-np-title">',
      '      <i class="fa-solid fa-satellite-dish"></i> ATTACHED NODES',
      '      <span class="r-np-count" id="r-np-count">0</span>',
      '    </div>',
      '    <div class="r-np-scroll"><div class="r-node-list" id="r-side-node-list">',
      '      <div class="r-empty" style="padding:20px 10px;font-size:11px"><i class="fa-solid fa-satellite-dish"></i><br>No devices</div>',
      '    </div></div>',
      '    <div class="r-np-foot"><div class="r-fb-status" id="r-fb-status"></div></div>',
      '  </div>',
      '  <div class="r-main-wrap">',
      '    <div class="r-view-area" id="r-view-area">',
      '      <div class="r-loading"><span class="r-spin"></span> Connecting to rasumi-apps…</div>',
      '    </div>',
      '  </div>',
      '</div>',

      // ── MODAL ──
      '<div class="r-modal-overlay hidden" id="r-modal-overlay" onclick="rModalClose(event)">',
      '  <div class="r-modal-box" id="r-modal-box">',
      '    <div class="r-modal-hdr">',
      '      <span id="r-modal-title">Detail</span>',
      '      <button onclick="rModalClose()" class="r-modal-x"><i class="fa-solid fa-xmark"></i></button>',
      '    </div>',
      '    <div id="r-modal-body" class="r-modal-body"></div>',
      '    <div id="r-modal-footer" class="r-modal-footer"></div>',
      '  </div>',
      '</div>',

      '<div id="r-toasts" class="r-toasts"></div>'
    ].join('\n');
    document.body.appendChild(el);
  }

  // ── Config missing banner ──────────────────────────────────
  function showConfigBanner() {
    var view = $r('r-view-area');
    if (!view) return;
    view.innerHTML =
      '<div class="r-panel">' +
      '<div class="r-panel-hdr"><h3><i class="fa-solid fa-triangle-exclamation" style="color:var(--rc-orange)"></i> Firebase Config Required</h3></div>' +
      '<div class="r-info-box warn">' +
      '<i class="fa-solid fa-circle-info"></i>' +
      '<div>' +
      '<strong>rasumi-apps Firebase web config not set.</strong><br>' +
      'Open <code>rasumi.js</code> and fill in <code>RASUMI_FIREBASE_CONFIG</code> at the top of the file.<br><br>' +
      'Get the config from:<br>' +
      '<strong>Firebase Console → rasumi-apps project → Project Settings → General → Your apps → Web app → Config</strong><br><br>' +
      'The config looks like:<br>' +
      '<code style="display:block;white-space:pre;margin-top:8px;padding:10px;background:rgba(0,0,0,0.3);border-radius:4px">' +
      'apiKey: "AIzaSy...",\n' +
      'authDomain: "rasumi-apps.firebaseapp.com",\n' +
      'projectId: "rasumi-apps",\n' +
      'storageBucket: "rasumi-apps.appspot.com",\n' +
      'messagingSenderId: "123...",\n' +
      'appId: "1:123...:web:abc..."' +
      '</code>' +
      '</div>' +
      '</div>' +
      '</div>';

    var fbStatus = $r('r-fb-status');
    if (fbStatus) fbStatus.innerHTML = '<span style="color:var(--rc-orange);font-size:10px;padding:0 21px;display:block"><i class="fa-solid fa-triangle-exclamation"></i> Config missing</span>';
  }

  // ── Enter / Exit ───────────────────────────────────────────
  function enterRasumiMode() {
    injectHTML();
    var dc = document.getElementById('dashboard-container');
    if (dc) dc.classList.add('hidden');
    $r('rasumi-container').classList.remove('hidden');
    startClock();

    var ok = initRasumiFirebase();
    if (!ok) {
      showConfigBanner();
      return;
    }

    var fbStatus = $r('r-fb-status');
    if (fbStatus) fbStatus.innerHTML = '<span style="color:var(--rc-green);font-size:10px;padding:0 21px;display:block"><i class="fa-solid fa-circle"></i> rasumi-apps ● LIVE</span>';

    startGlobalListeners();
    rNav('r-dashboard');
  }

  window.exitRasumiMode = function () {
    clearRListeners();
    stopClock();
    var rc = $r('rasumi-container');
    if (rc) rc.classList.add('hidden');
    var dc = document.getElementById('dashboard-container');
    if (dc) dc.classList.remove('hidden');
    var ms = document.getElementById('mode-submenu');
    if (ms) ms.classList.add('hidden');
  };

  // ── Clock ──────────────────────────────────────────────────
  function startClock() {
    function tick() {
      var el = $r('r-clock');
      if (el) el.textContent = new Date().toLocaleTimeString('ms-MY', { hour12: false });
    }
    tick();
    RS.clockTick = setInterval(tick, 1000);
  }
  function stopClock() {
    if (RS.clockTick) { clearInterval(RS.clockTick); RS.clockTick = null; }
  }

  // ── Listeners ──────────────────────────────────────────────
  function addL(unsub) { RS.listeners.push(unsub); }
  function clearRListeners() { RS.listeners.forEach(function (u) { u(); }); RS.listeners = []; }

  function updateFleetBadges() {
    var devs = Object.values(RS.devices);
    var on = devs.filter(function (d) { return d._status === 'online'; }).length;
    var st = devs.filter(function (d) { return d._status === 'stale'; }).length;
    var off = devs.filter(function (d) { return d._status === 'offline'; }).length;
    var el;
    // New chip elements in topbar
    el = $r('r-chip-on'); if (el) el.textContent = on + ' ONLINE';
    el = $r('r-chip-st'); if (el) el.textContent = st + ' STALE';
    el = $r('r-chip-off'); if (el) el.textContent = off + ' OFFLINE';
    // Update side panel + dashboard telemetry
    updateSideNodeList();
    updateDashTelemetry();
  }

  function startGlobalListeners() {
    clearRListeners();

    // ── machine_status — all device heartbeats ──
    addL(RS.db.collection('machine_status').onSnapshot(function (snap) {
      RS.devices = {};
      snap.forEach(function (doc) {
        var d = Object.assign({ id: doc.id }, doc.data());
        d._status = deviceStatus(d);
        RS.devices[doc.id] = d;
      });
      updateFleetBadges();
      if (RS.route === 'r-dashboard') renderDashboard();
      if (RS.route === 'r-devices') renderDevices();
      if (RS.route === 'r-alerts') renderAlerts();
    }, function (err) {
      console.warn('[Rasumi] machine_status listener error:', err.message);
    }));

    // ── VIBES unresolved errors badge ──
    addL(RS.db.collectionGroup('vibes_errors')
      .where('resolved', '==', false)
      .onSnapshot(function (snap) {
        RS.unresolvedVibes = snap.size;
        var nb = $r('r-nb-vibes');
        if (nb) { nb.textContent = snap.size || ''; nb.style.display = snap.size ? '' : 'none'; }
        updateAlertBadge();
        if (RS.route === 'r-dashboard') renderDashboard();
        if (RS.route === 'r-alerts') renderAlerts();
      }, function (err) { /* collectionGroup may need Firestore index */ }));

    // ── Renamer issue badge ──
    addL(RS.db.collectionGroup('renamer_docs')
      .where('status', 'in', ['wrong_read', 'failed', 'skipped'])
      .onSnapshot(function (snap) {
        RS.unresolvedRenamer = snap.size;
        var nb = $r('r-nb-renamer');
        if (nb) { nb.textContent = snap.size || ''; nb.style.display = snap.size ? '' : 'none'; }
        updateAlertBadge();
      }, function (err) { /* may need index */ }));

    // ── VIMS skip badge ──
    addL(RS.db.collectionGroup('vims_results')
      .where('status', '==', 'skipped')
      .onSnapshot(function (snap) {
        RS.unresolvedVims = snap.size;
        var nb = $r('r-nb-vims');
        if (nb) { nb.textContent = snap.size || ''; nb.style.display = snap.size ? '' : 'none'; }
        updateAlertBadge();
      }, function (err) { /* may need index */ }));

    // ── Periodic app stats refresh (every 60s) ──
    loadAppStats();
    RS._appStatsInterval = setInterval(loadAppStats, 60000);

    RS.db.collection('logs').orderBy('timestamp', 'desc').limit(60).get().then(function (snap) {
      var filtered = snap.docs.map(function (d) { return d.data(); }).filter(function (x) {
        var st = (x.status || '').toUpperCase();
        return st !== 'FINISH' && st !== 'FINISHED';
      });
      var seen = {};
      RS._recentLogs = filtered.filter(function (x) {
        var key = (x.machine || '') + '|' + (x.app_name || '?') + '|' + (x.file_name || x.activity_name || '');
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }).catch(function () { });
  }

  function updateAlertBadge() {
    var tot = RS.unresolvedVibes + RS.unresolvedRenamer + RS.unresolvedVims;
    var na = $r('r-nb-alerts');
    if (na) { na.textContent = tot || ''; na.style.display = tot ? '' : 'none'; }
  }

  // ── Client-side sort helper ───────────────────────────────
  function sortByTs(docs, field) {
    field = field || 'timestamp';
    return docs.slice().sort(function (a, b) {
      var ta = a[field]; var tb = b[field];
      var da = ta ? (ta.toDate ? ta.toDate() : new Date(ta.seconds ? ta.seconds * 1000 : ta)) : new Date(0);
      var db2 = tb ? (tb.toDate ? tb.toDate() : new Date(tb.seconds ? tb.seconds * 1000 : tb)) : new Date(0);
      return db2 - da; // desc
    });
  }

  // ── App Stats (from logs collection) ──────────────────────
  function loadAppStats() {
    if (!RS.db) return;
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    // No orderBy — avoids composite index requirement; sort client-side
    var pending = RASUMI_APPS.length;
    RASUMI_APPS.forEach(function (app) {
      var names = app.firebaseNames;
      RS.db.collection('logs')
        .where('app_name', 'in', names)
        .limit(200)
        .get().then(function (snap) {
          var data = snap.docs.map(function (d) { return d.data(); });
          data = sortByTs(data);
          var todayCnt = 0, errCnt = 0, lastTs = null;
          data.forEach(function (d) {
            var ts = d.timestamp;
            if (!lastTs) lastTs = ts;
            var dt;
            if (ts && ts.toDate) dt = ts.toDate();
            else if (ts && ts.seconds) dt = new Date(ts.seconds * 1000);
            else if (ts) dt = new Date(ts);
            if (dt && dt >= today) todayCnt++;
            var st = (d.status || '').toUpperCase();
            if (st === 'FAILED' || st === 'ERROR') errCnt++;
          });
          RS.appStats[app.key] = { today: todayCnt, errors: errCnt, last_ts: lastTs };
          pending--;
          if (pending === 0 && RS.route === 'r-dashboard') renderDashboard();
        }).catch(function () { pending--; });
    });
  }

  // ── Router ─────────────────────────────────────────────────
  var LABELS = {
    'r-dashboard': 'Dashboard',
    'r-devices': 'Device Fleet',
    'r-renamer': 'Renamer Trace',
    'r-vibes': 'VIBES Monitor',
    'r-vims': 'VIMS Scrape',
    'r-logs': 'Log Explorer',
    'r-commands': 'Commands',
    'r-alerts': 'Alerts'
  };

  window.rNav = function (route) {
    RS.route = route;
    // Update horizontal nav active state
    qra('.r-hn-item').forEach(function (el) { el.classList.remove('active'); });
    var activeEl = $r('rni-' + route);
    if (activeEl) activeEl.classList.add('active');
    var lbl = $r('r-route-name');
    if (lbl) lbl.textContent = LABELS[route] || route;
    var view = $r('r-view-area');
    if (!view) return;

    if (!RS.configOk) { showConfigBanner(); return; }

    view.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Loading…</div>';

    if (route.indexOf('r-device:') === 0) {
      renderDeviceDetail(route.replace('r-device:', ''));
      return;
    }
    switch (route) {
      case 'r-dashboard': renderDashboard(); break;
      case 'r-devices': renderDevices(); break;
      case 'r-renamer': renderRenamer(); break;
      case 'r-vibes': renderVibes(); break;
      case 'r-vims': renderVims(); break;
      case 'r-logs': renderLogs(); break;
      case 'r-commands': renderCommands(); break;
      case 'r-alerts': renderAlerts(); break;
    }
  };

  // ── Global Search ──────────────────────────────────────────
  window.rGlobalSearch = function (q) {
    if (!q || q.length < 2) return;
    var lq = q.toLowerCase();
    var matches = Object.keys(RS.devices).filter(function (h) { return h.toLowerCase().indexOf(lq) !== -1; });
    if (matches.length === 1) { rNav('r-device:' + matches[0]); }
    else if (matches.length > 1) { rNav('r-devices'); }
  };

  // ── DASHBOARD ──────────────────────────────────────────────
  function renderDashboard() {
    var devs = Object.values(RS.devices);
    var on = devs.filter(function (d) { return d._status === 'online'; }).length;
    var st = devs.filter(function (d) { return d._status === 'stale'; }).length;
    var off = devs.filter(function (d) { return d._status === 'offline'; }).length;

    // Compute today's stats from appStats
    var runsToday = 0, errToday = 0, slaToday = 0;
    Object.values(RS.appStats).forEach(function (s) { runsToday += (s.today || 0); errToday += (s.errors || 0); });

    // Last sync from most recently active device
    var lastSync = '—';
    var allDevs = devs.slice().sort(function (a, b) {
      var ta = a.last_heartbeat || a.last_seen;
      var tb = b.last_heartbeat || b.last_seen;
      var da = ta ? (ta.toDate ? ta.toDate() : new Date(ta.seconds ? ta.seconds * 1000 : ta)) : new Date(0);
      var db2 = tb ? (tb.toDate ? tb.toDate() : new Date(tb.seconds ? tb.seconds * 1000 : tb)) : new Date(0);
      return db2 - da;
    });
    if (allDevs.length) lastSync = fmtElapsed(allDevs[0].last_heartbeat || allDevs[0].last_seen);

    // ── Row 1: Metric cards ──
    var metricRow =
      '<div class="r-metric-row">' +
      metricCard('green', on, 'TOTAL ACTIVE NODES', 'fa-circle-check', 'Online now') +
      metricCard('danger', off, 'OFFLINE NODES', 'fa-circle-xmark', off > 0 ? off + ' need attention' : 'All clear') +
      metricCard('info', runsToday, 'RUNS TODAY', 'fa-play-circle', 'Across all apps') +
      metricCard('warn', errToday, 'FAILED TODAY', 'fa-bug', 'Check log explorer') +
      metricCard('purple', RS.unresolvedVibes, 'VIBES ERRORS', 'fa-triangle-exclamation', 'Unresolved') +
      metricCard('blue', devs.length, 'MACHINES TOTAL', 'fa-server', 'Last sync: ' + lastSync) +
      '</div>';

    // ── Selected device ──
    var selId = RS._selectedDevice;
    var selDev = selId ? RS.devices[selId] : null;

    // ── Active Telemetry panel HTML ──
    var teleHTML = buildTelemetryHTML(selDev);

    // ── Node Health + Live Stream panel ──
    var healthHTML = buildHealthHTML(selDev);

    // ── Row 3 panels ──
    // Recent Activity from RS._recentLogs
    var actHTML = buildRecentActHTML();

    // Command History (last 8)
    var cmdHistHTML = '<div class="r-cmd-hist-feed" id="r-cmd-hist-dash"><div class="r-loading"><span class="r-spin"></span></div></div>';

    // App Overview
    var appOvHTML = '<div class="r-app-list">' + RASUMI_APPS.map(function (app) {
      var stats = RS.appStats[app.key] || {};
      return '<div class="r-app-row" onclick="rNav(\'r-logs\')">' +
        '<i class="fa-solid ' + app.icon + ' r-app-ico"></i>' +
        '<span class="r-app-name">' + app.label + '</span>' +
        '<span class="r-app-cnt">Today: ' + (stats.today || 0) + '</span>' +
        ((stats.errors || 0) > 0 ? '<span class="r-app-err">' + stats.errors + ' err</span>' : '') +
        '</div>';
    }).join('') + '</div>';

    var view = $r('r-view-area');
    if (!view) return;
    view.innerHTML =
      metricRow +

      // ── Row 2: 2 columns (Telemetry | Health+Stream) ──
      '<div class="r-mid-row">' +
      '<div class="r-panel" style="margin:0">' +
      '<div class="r-panel-title" id="r-tele-title"><i class="fa-solid fa-microchip"></i> ACTIVE TELEMETRY' +
      (selId ? ' &mdash; ' + selId : ' <span style="color:var(--rc-text-dim);font-weight:400">[SELECT A NODE]</span>') +
      '</div>' +
      '<div id="r-tele-body">' + teleHTML + '</div>' +
      '</div>' +
      '<div class="r-panel" style="margin:0">' +
      '<div class="r-panel-title"><i class="fa-solid fa-heart-pulse"></i> NODE HEALTH</div>' +
      '<div id="r-health-body">' + healthHTML + '</div>' +
      '<div class="r-panel-title" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--rc-border)"><i class="fa-solid fa-terminal"></i> LIVE DATA STREAM</div>' +
      '<div class="r-terminal" id="r-terminal"><p class="r-term-line info">Waiting for log events…<span class="r-term-cursor"></span></p></div>' +
      '</div>' +
      '</div>' +

      // ── Row 3: 3 columns (Activity | Command History | App Overview) ──
      '<div class="r-bot-row">' +
      '<div class="r-panel" style="margin:0">' +
      '<div class="r-panel-title"><i class="fa-solid fa-list-check"></i> RECENT ACTIVITY</div>' +
      '<div id="r-recent-act">' + actHTML + '</div>' +
      '</div>' +
      '<div class="r-panel" style="margin:0">' +
      '<div class="r-panel-title"><i class="fa-solid fa-terminal"></i> COMMAND HISTORY' +
      '<button class="r-btn-sm" style="margin-left:auto;font-size:9px" onclick="rNav(\'r-commands\')">ALL →</button></div>' +
      cmdHistHTML +
      '</div>' +
      '<div class="r-panel" style="margin:0">' +
      '<div class="r-panel-title"><i class="fa-solid fa-robot"></i> APP OVERVIEW</div>' +
      appOvHTML +
      '</div>' +
      '</div>' +

      // ── Row 4: 3 Charts ──
      '<div class="r-charts-row">' +
      '<div class="r-chart-box"><div class="r-panel-title" style="margin-bottom:6px;border:none;padding:0"><i class="fa-solid fa-microchip"></i> CPU USAGE 24H</div><canvas id="r-chart-cpu"></canvas></div>' +
      '<div class="r-chart-box"><div class="r-panel-title" style="margin-bottom:6px;border:none;padding:0"><i class="fa-solid fa-memory"></i> RAM USAGE 24H</div><canvas id="r-chart-ram"></canvas></div>' +
      '<div class="r-chart-box"><div class="r-panel-title" style="margin-bottom:6px;border:none;padding:0"><i class="fa-solid fa-hard-drive"></i> DISK USAGE 24H</div><canvas id="r-chart-disk"></canvas></div>' +
      '</div>';

    // Load async: command history + charts
    loadDashCmdHist();
    initDashCharts();
    // Start live stream listener
    startLiveStream();
  }

  // ── Metric card builder ────────────────────────────────────
  function metricCard(cls, val, lbl, icon, sub) {
    return '<div class="r-metric-card ' + cls + '">' +
      '<div class="r-metric-label">' + lbl + '</div>' +
      '<div class="r-metric-val">' + val + '</div>' +
      '<div class="r-metric-sub">' + (sub || '') + '</div>' +
      '<i class="fa-solid ' + icon + ' r-metric-icon"></i>' +
      '</div>';
  }

  function kpi(cls, val, lbl, icon, extra) {
    return '<div class="r-kpi ' + cls + '" ' + (extra || '') + '>' +
      '<div class="r-kpi-val">' + val + '</div>' +
      '<div class="r-kpi-lbl">' + lbl + '</div>' +
      '<i class="fa-solid ' + icon + ' r-kpi-ico"></i>' +
      '</div>';
  }

  // ── Node selection ─────────────────────────────────────────
  window.rSelectNode = function (hostname) {
    RS._selectedDevice = hostname;
    updateSideNodeList();
    if (RS.route === 'r-dashboard') updateDashTelemetry();
    else renderDashboard();
  };

  // ── Build Telemetry HTML ───────────────────────────────────
  function buildTelemetryHTML(d) {
    if (!d) {
      return '<div class="r-tele-empty"><i class="fa-solid fa-satellite-dish"></i>Select a node from the list</div>';
    }
    var rows = [
      ['STATUS', '<span class="r-badge ' + ({ online: 'r-badge-ok', stale: 'r-badge-warn', offline: 'r-badge-err' }[d._status] || 'r-badge-muted') + '">' + d._status.toUpperCase() + '</span>'],
      ['HOSTNAME', '<span class="r-font-mono">' + esc(d.id || d.hostname || '—') + '</span>'],
      ['OS', esc(d.os_name || d.sys_info || '—')],
      ['CURRENT JOB', esc(d.current_job || 'IDLE')],
      ['PENDING', (d.pending_files !== undefined ? d.pending_files : '—') + ' files'],
      ['VERSION', esc(d.version || '—')],
      ['UPTIME', esc(d.uptime || '—')],
      ['HEARTBEAT', fmtTs(d.last_heartbeat || d.last_seen)]
    ];
    var rowsHTML = rows.map(function (r) {
      return '<div class="r-tele-row"><span class="r-tele-key">' + r[0] + '</span><span class="r-tele-val">' + r[1] + '</span></div>';
    }).join('');
    var cmds =
      '<div class="r-tele-cmds">' +
      '<button class="r-btn-sm" onclick="rSendTeleCmd(\'' + esc(d.id) + '\',\'PING\')">Ping</button>' +
      '<button class="r-btn-sm" onclick="rSendTeleCmd(\'' + esc(d.id) + '\',\'RESTART\')">Restart</button>' +
      '<button class="r-btn-sm" onclick="rSendTeleCmd(\'' + esc(d.id) + '\',\'STATUS\')">Status</button>' +
      '<button class="r-btn-sm" onclick="rNav(\'r-device:' + esc(d.id) + '\')">Full Detail →</button>' +
      '</div>';
    return rowsHTML + cmds;
  }

  window.rSendTeleCmd = function (hostname, cmd) {
    var user = RS.auth ? RS.auth.currentUser : null;
    RS.db.collection('commands').add({
      target_machine: hostname, command: cmd, status: 'PENDING',
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      created_by: user ? user.email : 'admin'
    }).then(function () { rToast(cmd + ' sent to ' + hostname, 'success'); })
      .catch(function (e) { rToast('Error: ' + e.message, 'error'); });
  };

  // ── Build Health Bars HTML ─────────────────────────────────
  function buildHealthHTML(d) {
    if (!d) return '<div class="r-tele-empty" style="height:120px"><i class="fa-solid fa-heart-pulse"></i>Select a node to see health</div>';
    var cpu = d.cpu_pct !== undefined ? d.cpu_pct : null;
    var ram = d.ram_pct !== undefined ? d.ram_pct : null;
    var disk = d.disk_pct !== undefined ? d.disk_pct : null;
    var lat = d.net_latency_ms !== undefined ? d.net_latency_ms : null;
    function bar(pct, cls, label, valStr) {
      var p = pct !== null ? Math.min(100, Math.max(0, pct)) : 0;
      var fillCls = cls + (pct >= 90 ? ' danger' : pct >= 75 ? ' warn' : '');
      var display = pct !== null ? (Math.round(pct) + '%') : 'N/A';
      return '<div class="r-health-bar-row">' +
        '<div class="r-hb-header"><span class="r-hb-label">' + label + '</span>' +
        '<span class="r-hb-val">' + display + (valStr ? ' | ' + valStr : '') + '</span></div>' +
        '<div class="r-hb-track"><div class="r-hb-fill ' + fillCls + '" style="width:' + p + '%"></div></div>' +
        '</div>';
    }
    var ramGB = (d.ram_used_gb !== undefined && d.ram_total_gb !== undefined)
      ? (d.ram_used_gb + '/' + d.ram_total_gb + ' GB') : '';
    var diskGB = (d.disk_used_gb !== undefined && d.disk_total_gb !== undefined)
      ? (d.disk_used_gb + '/' + d.disk_total_gb + ' GB') : '';
    return bar(cpu, 'cpu', 'CPU', '') +
      bar(ram, 'ram', 'RAM', ramGB) +
      bar(disk, 'disk', 'DISK', diskGB) +
      '<div class="r-health-stats">' +
      '<div class="r-hs-item"><div class="r-hs-lbl">LATENCY</div><div class="r-hs-val">' + (lat !== null ? lat + ' ms' : 'N/A') + '</div></div>' +
      '<div class="r-hs-item"><div class="r-hs-lbl">UPTIME</div><div class="r-hs-val" style="font-size:10px">' + esc(d.uptime || '—') + '</div></div>' +
      '</div>';
  }

  // ── Build System Telemetry HTML ───────────────────────────
  function buildSysTeleHTML(d) {
    if (!d) return '<div class="r-tele-empty" style="height:100px"><i class="fa-solid fa-server"></i>Select a node</div>';
    function stBar(pct, cls, label, nums) {
      var p = pct !== null && pct !== undefined ? Math.min(100, Math.max(0, pct)) : 0;
      return '<div class="r-sys-tele-item">' +
        '<div class="r-st-header"><span class="r-st-label">' + label + '</span><span class="r-st-nums">' + (nums || '') + '</span></div>' +
        '<div class="r-st-track"><div class="r-st-fill ' + cls + '" style="width:' + p + '%"></div></div>' +
        '</div>';
    }
    var cpu = d.cpu_pct;
    var ram = d.ram_pct;
    var disk = d.disk_pct;
    var ramNums = (d.ram_used_gb !== undefined && d.ram_total_gb) ? d.ram_used_gb + '/' + d.ram_total_gb + ' GB' : (cpu !== undefined ? cpu + '%' : 'N/A');
    var diskNums = (d.disk_used_gb !== undefined && d.disk_total_gb) ? d.disk_used_gb + '/' + d.disk_total_gb + ' GB' : (disk !== undefined ? disk + '%' : 'N/A');
    var latMs = d.net_latency_ms !== undefined ? d.net_latency_ms : null;
    var latPct = latMs !== null ? Math.min(100, latMs / 2) : 0; // 200ms = 100%
    return stBar(cpu, 'cpu-fill', 'CPU', cpu !== undefined ? cpu + '%' : 'N/A') +
      stBar(ram, 'ram-fill', 'MEMORY', ramNums) +
      stBar(disk, 'disk-fill', 'DISK C:', diskNums) +
      stBar(latPct, 'net-fill', 'LATENCY', latMs !== null ? latMs + 'ms' : 'N/A') +
      '<div class="r-tele-row"><span class="r-tele-key">OS</span><span class="r-tele-val">' + esc(d.os_name || d.sys_info || '—') + '</span></div>';
  }

  function _pushRecentLog(e) {
    var rawSt = e.status || '';
    var isMsg = rawSt.length > 30;
    var stCode = isMsg ? 'DEBUG' : (rawSt.toUpperCase() || 'INFO');
    var isF = stCode === 'FINISH' || stCode === 'FINISHED';
    if (isF) return;

    var matchIdx = RS._recentLogs.findIndex(function (x) {
      return (x.machine || '') === (e.machine || '') &&
             (x.app_name || '?') === (e.app_name || '?') &&
             (x.file_name || x.activity_name || '') === (e.file_name || e.activity_name || '');
    });
    if (matchIdx !== -1) {
      RS._recentLogs.splice(matchIdx, 1);
    }
    RS._recentLogs.unshift(e);
    if (RS._recentLogs.length > 50) RS._recentLogs.pop();
    var ra = $r('r-recent-act');
    if (ra) ra.innerHTML = buildRecentActHTML();
  }

  // ── Build Recent Activity HTML ────────────────────────────
  function buildRecentActHTML() {
    if (!RS._recentLogs.length) {
      return '<div class="r-act-feed"><div class="r-empty" style="padding:16px">No recent logs</div></div>';
    }
    return '<div class="r-act-feed">' + RS._recentLogs.slice(0, 12).map(function (e) {
      var rawStatus = e.status || '';
      var isMsg = rawStatus.length > 30;
      var stCode = isMsg ? 'DEBUG' : (rawStatus.toUpperCase() || 'INFO');
      var isFail = stCode === 'FAILED';
      var icon = isFail ? 'fa-circle-xmark' : (stCode === 'COMPLETED' ? 'fa-circle-check' : 'fa-circle-info');
      var fileDetail = e.file_name || e.activity_name || e.details || '—';
      return '<div class="r-act-item">' +
        '<i class="fa-solid ' + icon + ' r-act-icon" style="color:' + (isFail ? 'var(--rc-red)' : stCode === 'COMPLETED' ? 'var(--rc-green)' : 'var(--rc-cyan)') + '"></i>' +
        '<div class="r-act-body">' +
        '<div class="r-act-title">' + esc(e.app_name || '?') + ' · ' + esc(fileDetail) + '</div>' +
        '<div class="r-act-meta">' + esc(e.machine || '') + ' · ' + fmtElapsed(e.timestamp || e.created_at) + '</div>' +
        '</div>' +
        '<span class="r-badge ' + logBadge(stCode) + '" style="font-size:8px">' + esc(stCode) + '</span>' +
        '</div>';
    }).join('') + '</div>';
  }

  // ── Update side nodes panel (always-visible) ──────────────
  function updateSideNodeList() {
    var panel = $r('r-side-node-list');
    if (!panel) return;
    var devs = Object.values(RS.devices);
    var selId = RS._selectedDevice;
    var cnt = $r('r-np-count');
    if (cnt) cnt.textContent = devs.length;
    if (devs.length === 0) {
      panel.innerHTML = '<div class="r-empty" style="padding:20px 10px;font-size:11px"><i class="fa-solid fa-satellite-dish"></i><br>No devices</div>';
      return;
    }
    panel.innerHTML = devs.map(function (d) {
      return '<div class="r-node-card' + (d.id === selId ? ' active' : '') + '" onclick="rSelectNode(\'' + esc(d.id) + '\')">' +
        '<span class="r-nc-dot ' + d._status + '"></span>' +
        '<div class="r-nc-info">' +
        '<div class="r-nc-host">' + esc(d.id) + '</div>' +
        '<div class="r-nc-time">' + fmtElapsed(d.last_heartbeat || d.last_seen) + '</div>' +
        '</div>' +
        '<span class="r-nc-badge ' + d._status + '">' + d._status.toUpperCase() + '</span>' +
        '</div>';
    }).join('');
  }

  // ── Update telemetry panels in-place (no full re-render) ──
  function updateDashTelemetry() {
    updateSideNodeList();
    if (RS.route !== 'r-dashboard') return;
    var d = RS._selectedDevice ? RS.devices[RS._selectedDevice] : null;
    var tb = $r('r-tele-body'); if (tb) tb.innerHTML = buildTelemetryHTML(d);
    var hb = $r('r-health-body'); if (hb) hb.innerHTML = buildHealthHTML(d);
  }

  // ── Dashboard command history ─────────────────────────────
  function loadDashCmdHist() {
    var box = $r('r-cmd-hist-dash');
    if (!box || !RS.db) return;
    RS.db.collection('commands').orderBy('created_at', 'desc').limit(8).get().then(function (snap) {
      if (snap.empty) { box.innerHTML = '<div class="r-empty" style="padding:14px">No commands yet</div>'; return; }
      box.innerHTML = '<div class="r-cmd-hist-feed">' + snap.docs.map(function (doc) {
        var c = doc.data();
        return '<div class="r-ch-item">' +
          '<span class="r-badge ' + logBadge(c.status) + '" style="font-size:8px">' + esc(c.status || 'PEND') + '</span>' +
          '<span class="r-ch-cmd">' + esc(c.command || c.action || '?') + ' → ' + esc(c.target_machine || 'all') + '</span>' +
          '<span class="r-ch-time">' + fmtElapsed(c.created_at) + '</span>' +
          '</div>';
      }).join('') + '</div>';
    }).catch(function () { });
  }

  // ── Live Data Stream ──────────────────────────────────────
  var _liveUnsub = null;
  function startLiveStream() {
    if (_liveUnsub) { _liveUnsub(); _liveUnsub = null; }
    if (!RS.db) return;
    RS._terminal = [];
    _liveUnsub = RS.db.collection('logs')
      .orderBy('timestamp', 'desc').limit(20)
      .onSnapshot(function (snap) {
        snap.docChanges().forEach(function (ch) {
          if (ch.type === 'added') {
            var e = ch.doc.data();
            appendTerminalLine(e);
          }
        });
      }, function () { });
    addL(function () { if (_liveUnsub) { _liveUnsub(); _liveUnsub = null; } });
  }

  function appendTerminalLine(e) {
    var term = $r('r-terminal');
    if (!term) return;
    var ts = fmtTs(e.timestamp || e.created_at);
    var rawSt = e.status || '';
    var isMsg = rawSt.length > 30;
    var stCode = isMsg ? 'DEBUG' : (rawSt.toUpperCase() || 'INFO');
    var file = e.file_name || e.activity_name || '';
    var cls = stCode === 'FAILED' ? 'err' : stCode === 'COMPLETED' ? 'ok' : stCode === 'DEBUG' ? 'debug' : 'info';
    var line = '[' + ts + '] [' + (e.app_name || '?') + '] ' + stCode + (file ? ' · ' + file : '');

    // Remove cursor from last line
    var last = term.querySelector('.r-term-cursor');
    if (last) last.remove();

    var p = document.createElement('p');
    p.className = 'r-term-line ' + cls;
    p.textContent = line;
    term.appendChild(p);

    // Add cursor to new last line
    var cursor = document.createElement('span');
    cursor.className = 'r-term-cursor';
    p.appendChild(cursor);

    // Keep only last 80 lines
    var lines = term.querySelectorAll('.r-term-line');
    if (lines.length > 80) lines[0].remove();

    term.scrollTop = term.scrollHeight;

    // Also update recent activity
    _pushRecentLog(e);
  }

  // ── Dashboard Charts ──────────────────────────────────────
  function initDashCharts() {
    if (typeof Chart === 'undefined') return;
    var labels = [];
    for (var i = 23; i >= 0; i--) labels.push(i + 'h');

    function makeData(color, data) {
      return { labels: labels, datasets: [{ data: data, borderColor: color, backgroundColor: color.replace(')', ',0.1)').replace('rgb', 'rgba'), borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: true }] };
    }

    var chartOpts = {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6B7A8F', font: { size: 8 }, maxTicksLimit: 6 } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6B7A8F', font: { size: 8 } }, beginAtZero: true, max: 100 }
      }
    };

    var colors = { cpu: 'rgb(0,240,255)', ram: 'rgb(178,0,255)', disk: 'rgb(245,158,11)' };
    ['cpu', 'ram', 'disk'].forEach(function (id) {
      var c = $r('r-chart-' + id);
      if (!c) return;
      if (RS._charts[id]) { RS._charts[id].destroy(); delete RS._charts[id]; }
      RS._charts[id] = new Chart(c, { type: 'line', data: makeData(colors[id], new Array(24).fill(0)), options: JSON.parse(JSON.stringify(chartOpts)) });
    });

    // If selected device has live data, fill CPU/RAM/Disk from history
    updateChartFromDevice();
  }

  function updateChartFromDevice() {
    var d = RS._selectedDevice ? RS.devices[RS._selectedDevice] : null;
    if (!d || typeof Chart === 'undefined') return;
    // Push current reading to chart (simulate rolling update)
    ['cpu', 'ram', 'disk'].forEach(function (key) {
      var chart = RS._charts[key];
      if (!chart) return;
      var val = d[key + '_pct'];
      if (val === undefined) return;
      chart.data.datasets[0].data.shift();
      chart.data.datasets[0].data.push(val);
      chart.update('none');
    });
  }

  // ── DEVICES ────────────────────────────────────────────────
  function renderDevices() {
    var devs = Object.values(RS.devices);
    var view = $r('r-view-area');
    if (!view) return;
    view.innerHTML =
      '<div class="r-panel">' +
      '<div class="r-panel-hdr">' +
      '<h3><i class="fa-solid fa-server"></i> All Machines (' + devs.length + ')</h3>' +
      '<div class="r-filter-bar">' +
      '<input class="r-filter-input" id="r-dev-filter" placeholder="Filter hostname…" oninput="rFilterDevices(this.value)">' +
      '<select class="r-filter-sel" id="r-dev-stat" onchange="rFilterDevices($r(\'r-dev-filter\').value)">' +
      '<option value="">All Status</option>' +
      '<option value="online">Online</option>' +
      '<option value="stale">Stale</option>' +
      '<option value="offline">Offline</option>' +
      '</select>' +
      '</div>' +
      '</div>' +
      '<div class="r-table-wrap">' +
      '<table class="r-table">' +
      '<thead><tr><th></th><th>Hostname</th><th>Status</th><th>Current Job</th><th>Pending Files</th><th>Version</th><th>Last Heartbeat</th><th>Action</th></tr></thead>' +
      '<tbody id="r-dev-tbody">' + devRows(devs) + '</tbody>' +
      '</table>' +
      '</div>' +
      '</div>';
  }

  function devRows(devs) {
    if (!devs.length) return '<tr><td colspan="8" class="r-empty-td">No machines reporting. Ensure Rasumi Apps is running.</td></tr>';
    return devs.map(function (d) {
      var jobStatus = (d.status || 'IDLE').toUpperCase();
      var sc = { online: 'r-badge-ok', stale: 'r-badge-warn', offline: 'r-badge-err' }[d._status] || 'r-badge-muted';
      return '<tr onclick="rNav(\'r-device:' + esc(d.id) + '\')" style="cursor:pointer">' +
        '<td><span class="r-status-dot ' + d._status + '"></span></td>' +
        '<td class="r-font-mono">' + esc(d.id) + '</td>' +
        '<td><span class="r-badge ' + sc + '">' + d._status.toUpperCase() + '</span></td>' +
        '<td>' + esc(d.current_job || jobStatus || '—') + '</td>' +
        '<td>' + (d.pending_files !== undefined ? d.pending_files : '—') + '</td>' +
        '<td>' + esc(d.version || '—') + '</td>' +
        '<td>' + fmtTs(d.last_heartbeat || d.last_seen) + '</td>' +
        '<td><button class="r-btn-sm" onclick="event.stopPropagation();rNav(\'r-device:' + esc(d.id) + '\')">Detail →</button></td>' +
        '</tr>';
    }).join('');
  }

  window.rFilterDevices = function (q) {
    var stat = ($r('r-dev-stat') || {}).value || '';
    var lq = (q || '').toLowerCase();
    var devs = Object.values(RS.devices).filter(function (d) {
      return (!lq || d.id.toLowerCase().indexOf(lq) !== -1) && (!stat || d._status === stat);
    });
    var tbody = $r('r-dev-tbody');
    if (tbody) tbody.innerHTML = devRows(devs);
  };

  // ── DEVICE DETAIL ──────────────────────────────────────────
  function renderDeviceDetail(hostname) {
    var d = RS.devices[hostname];
    var view = $r('r-view-area');
    if (!view) return;

    var metaHTML = d
      ? '<div class="r-detail-meta">' +
      '<span><b>Status:</b> ' + esc((d.status || 'IDLE').toUpperCase()) + '</span>' +
      '<span><b>Current Job:</b> ' + esc(d.current_job || '—') + '</span>' +
      '<span><b>Pending Files:</b> ' + (d.pending_files !== undefined ? d.pending_files : '—') + '</span>' +
      '<span><b>Version:</b> ' + esc(d.version || '—') + '</span>' +
      '<span><b>Last Heartbeat:</b> ' + fmtTs(d.last_heartbeat || d.last_seen) + '</span>' +
      '</div>'
      : '<div class="r-alert-item warn">Machine not in live snapshot — may be offline</div>';

    // Health panel (if telemetry data exists)
    var healthPanel = d ? (
      '<div class="r-mid-row" style="margin-bottom:12px">' +
      '<div class="r-panel" style="margin:0">' +
      '<div class="r-panel-title"><i class="fa-solid fa-heart-pulse"></i> NODE HEALTH</div>' +
      buildHealthHTML(d) +
      '</div>' +
      '<div class="r-panel" style="margin:0">' +
      '<div class="r-panel-title"><i class="fa-solid fa-server"></i> SYSTEM TELEMETRY</div>' +
      buildSysTeleHTML(d) +
      '</div>' +
      '<div class="r-panel" style="margin:0">' +
      '<div class="r-panel-title"><i class="fa-solid fa-terminal"></i> LIVE STREAM</div>' +
      '<div class="r-terminal" id="r-terminal"><p class="r-term-line info">Showing device logs…<span class="r-term-cursor"></span></p></div>' +
      '</div>' +
      '</div>'
    ) : '';

    view.innerHTML =
      '<div class="r-panel">' +
      '<div class="r-panel-hdr">' +
      '<h3>' + (d ? '<span class="r-status-dot ' + d._status + '"></span> ' : '') + esc(hostname) + '</h3>' +
      '<button class="r-btn-sm" onclick="rNav(\'r-devices\')">← Fleet</button>' +
      '<button class="r-btn-sm" onclick="rNav(\'r-dashboard\');rSelectNode(\'' + esc(hostname) + '\')">Dashboard View</button>' +
      '</div>' +
      metaHTML +
      '<div class="r-tab-bar">' +
      '<div class="r-tab active" id="rtab-activity" onclick="rDdTab(\'activity\',\'' + esc(hostname) + '\')">Activity Log</div>' +
      '<div class="r-tab"        id="rtab-vibes"    onclick="rDdTab(\'vibes\',\'' + esc(hostname) + '\')">VIBES Errors</div>' +
      '<div class="r-tab"        id="rtab-renamer"  onclick="rDdTab(\'renamer\',\'' + esc(hostname) + '\')">Renamer Docs</div>' +
      '<div class="r-tab"        id="rtab-vims"     onclick="rDdTab(\'vims\',\'' + esc(hostname) + '\')">VIMS Results</div>' +
      '<div class="r-tab"        id="rtab-cmds"     onclick="rDdTab(\'cmds\',\'' + esc(hostname) + '\')">Commands</div>' +
      '</div>' +
      '<div id="r-dd-content" class="r-dd-content"></div>' +
      '</div>' +
      healthPanel;

    rDdTab('activity', hostname);
  }

  window.rDdTab = function (tab, hostname) {
    qra('.r-tab').forEach(function (t) { t.classList.remove('active'); });
    var t = $r('rtab-' + tab); if (t) t.classList.add('active');
    var box = $r('r-dd-content');
    if (!box) return;
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Loading…</div>';
    switch (tab) {
      case 'activity': ddActivity(hostname, box); break;
      case 'vibes': ddVibes(hostname, box); break;
      case 'renamer': ddRenamer(hostname, box); break;
      case 'vims': ddVims(hostname, box); break;
      case 'cmds': ddCmds(hostname, box); break;
    }
  };

  // _logCache and _recentLogs are initialized in RS state above

  function ddActivity(hostname, box) {
    RS.db.collection('logs')
      .where('machine', '==', hostname)
      .limit(300)
      .get().then(function (snap) {
        if (snap.empty) { box.innerHTML = '<div class="r-empty">No activity logs for this machine</div>'; return; }
        RS._logCache = sortByTs(snap.docs.map(function (d) { return d.data(); }));

        var failCnt = RS._logCache.filter(function (e) {
          return (e.status || '').toUpperCase() === 'FAILED' || (e.state || '').toUpperCase() === 'FAILED';
        }).length;
        var slaCnt = RS._logCache.filter(function (e) { return e.sla_breach; }).length;

        var summary = '<div class="r-log-summary">' +
          '<span class="r-badge r-badge-muted">' + RS._logCache.length + ' records</span>' +
          (failCnt ? '<span class="r-badge r-badge-err">' + failCnt + ' FAILED</span>' : '') +
          (slaCnt ? '<span class="r-badge r-badge-warn">' + slaCnt + ' SLA BREACH</span>' : '') +
          '<span class="r-muted-sm" style="margin-left:auto">Click row → view full detail</span>' +
          '</div>';

        var rows = RS._logCache.map(function (e, i) {
          var rawStatus = e.status || e.state || '';
          var isMsg = rawStatus.length > 30;
          var stCode = isMsg ? 'DEBUG' : (rawStatus.toUpperCase() || 'INFO');
          var stState = (e.state || '').toUpperCase();
          // File/detail: file_name is the most useful field
          var fileDetail = e.file_name || e.activity_name || e.details || e.error_msg || e.error
            || e.message || e.reason || (isMsg ? rawStatus : '') || '—';
          var jobId = e.job_group_id || e.trace_id || e.run_id || '';
          var isFailed = stCode === 'FAILED' || stState === 'FAILED';
          var rowCls = isFailed ? ' style="background:rgba(255,51,85,0.04)"' : (e.sla_breach ? ' style="background:rgba(255,149,0,0.04)"' : '');

          return '<tr' + rowCls + ' onclick="rShowLogDetail(' + i + ')" style="cursor:pointer' + (isFailed ? ';background:rgba(255,51,85,0.06)' : (e.sla_breach ? ';background:rgba(255,149,0,0.04)' : '')) + '">' +
            '<td>' + fmtTs(e.timestamp || e.created_at) + '</td>' +
            '<td><span class="r-badge r-badge-purple">' + esc(e.app_name || '—') + '</span></td>' +
            '<td>' +
            '<span class="r-badge ' + logBadge(stCode) + '">' + esc(stCode) + '</span>' +
            (e.state && e.state.toUpperCase() !== stCode ? ' <span class="r-muted-sm">/' + esc(e.state) + '</span>' : '') +
            '</td>' +
            '<td class="r-cell-trunc r-font-mono" style="max-width:220px" title="' + esc(fileDetail) + '">' + esc(fileDetail) + '</td>' +
            '<td class="r-font-mono r-muted-sm">' + (jobId ? jobId.substring(0, 8) + '…' : '—') + '</td>' +
            '<td>' +
            (e.sla_breach ? '<span class="r-badge r-badge-warn">SLA!</span> ' : '') +
            (e.version ? '<span class="r-muted-sm">v' + esc(String(e.version)) + '</span>' : '') +
            '</td>' +
            '<td><button class="r-btn-sm" onclick="event.stopPropagation();rShowLogDetail(' + i + ')">Detail</button></td>' +
            '</tr>';
        }).join('');

        box.innerHTML = summary + tableWrap(['Time', 'App', 'Status/State', 'File / Detail', 'Job ID', 'Flags', ''], rows);
      }).catch(function (err) { box.innerHTML = errBox(err.message); });
  }

  window.rShowLogDetail = function (idx) {
    var e = RS._logCache[idx];
    if (!e) return;
    var title = $r('r-modal-title');
    var body = $r('r-modal-body');
    var footer = $r('r-modal-footer');
    if (title) title.textContent = (e.app_name || 'Log') + ' — ' + fmtTs(e.timestamp || e.created_at);
    if (body) {
      var rawStatus = e.status || e.state || '';
      var isMsg = rawStatus.length > 30;
      var stCode = isMsg ? 'DEBUG' : (rawStatus.toUpperCase() || 'INFO');
      var isFailed = stCode === 'FAILED' || (e.state || '').toUpperCase() === 'FAILED';

      // Build field list — show everything non-null
      var SKIP = {};  // no fields to skip — show all
      var fieldRows = Object.keys(e).map(function (k) {
        var v = e[k];
        if (v === null || v === undefined) return '';
        var display;
        if (v && v.toDate) display = '<span class="r-muted-sm">' + fmtTs(v) + '</span>';
        else if (v && v.seconds) display = '<span class="r-muted-sm">' + fmtTs(v) + '</span>';
        else if (typeof v === 'boolean') display = v
          ? '<span class="r-badge r-badge-warn">true</span>'
          : '<span class="r-badge r-badge-muted">false</span>';
        else display = '<span class="r-font-mono" style="word-break:break-all">' + esc(String(v)) + '</span>';
        return '<tr><td style="color:var(--rc-blue);font-size:11px;padding:5px 8px;width:140px;white-space:nowrap"><code>' + esc(k) + '</code></td><td style="padding:5px 8px">' + display + '</td></tr>';
      }).filter(Boolean).join('');

      body.innerHTML =
        '<div class="r-detail-meta" style="margin-bottom:14px">' +
        '<span><b>App:</b> ' + esc(e.app_name || '—') + '</span>' +
        '<span><b>Machine:</b> ' + esc(e.machine || '—') + '</span>' +
        '<span><b>Status:</b> <span class="r-badge ' + logBadge(stCode) + '">' + esc(stCode) + '</span>' +
        (e.state ? ' / <span class="r-muted-sm">' + esc(e.state) + '</span>' : '') + '</span>' +
        (e.sla_breach ? '<span class="r-badge r-badge-warn">⚠ SLA BREACH</span>' : '') +
        '</div>' +
        (isFailed
          ? '<div class="r-alert-item err" style="margin-bottom:12px"><i class="fa-solid fa-circle-xmark"></i> ' +
          esc(e.error_msg || e.error || e.message || e.details || e.reason || 'No error signature detected. Review the vibes_errors subcollection for details.') +
          '</div>'
          : '') +
        '<table style="width:100%;border-collapse:collapse">' + fieldRows + '</table>';
    }
    if (footer) footer.innerHTML = '<button class="r-btn-sm" onclick="rModalClose()">Close</button>';
    rModalOpen();
  };


  function ddVibes(hostname, box) {
    RS.db.collection('devices/' + hostname + '/vibes_errors')
      .orderBy('timestamp', 'desc').limit(100)
      .get().then(function (snap) {
        if (snap.empty) { box.innerHTML = '<div class="r-empty">No VIBES errors for this machine</div>'; return; }
        var rows = snap.docs.map(function (doc) {
          var e = Object.assign({ id: doc.id }, doc.data());
          return '<tr>' +
            '<td>' + fmtTs(e.timestamp) + '</td>' +
            '<td class="r-font-mono">' + esc(e.run_id || '—') + '</td>' +
            '<td>' + esc(e.patient_ic || e.patient_name || e.context || '—') + '</td>' +
            '<td><span class="r-badge ' + errBadge(e.error_type) + '">' + esc(e.error_type || 'unknown') + '</span></td>' +
            '<td class="r-cell-trunc">' + esc(e.message || '—') + '</td>' +
            '<td><span class="r-badge ' + (e.resolved ? 'r-badge-ok' : 'r-badge-err') + '">' + (e.resolved ? 'FIXED' : 'OPEN') + '</span></td>' +
            '<td>' + (!e.resolved
              ? '<button class="r-btn-sm" onclick="rOpenFix(\'' + esc(doc.id) + '\',\'' + esc(hostname) + '\',\'vibes_errors\')">Fix</button>'
              : '<span class="r-muted-sm">' + esc(e.fix_note || '✓') + '</span>') +
            '</td>' +
            '</tr>';
        }).join('');
        box.innerHTML = tableWrap(['Time', 'Run ID', 'Patient', 'Error Type', 'Message', 'Status', 'Action'], rows);
      }).catch(function (err) { box.innerHTML = errBox(err.message); });
  }

  function ddRenamer(hostname, box) {
    RS.db.collection('devices/' + hostname + '/renamer_docs')
      .orderBy('timestamp', 'desc').limit(200)
      .get().then(function (snap) {
        if (snap.empty) {
          box.innerHTML = '<div class="r-empty">No renamer records.<br><span class="r-muted-sm">Ensure Renamer Bot writes to <code>devices/{hostname}/renamer_docs/</code>.</span></div>';
          return;
        }
        var rows = snap.docs.map(function (doc) {
          var e = Object.assign({ id: doc.id }, doc.data());
          return '<tr>' +
            '<td>' + fmtTs(e.timestamp) + '</td>' +
            '<td class="r-font-mono r-cell-trunc" title="' + esc(e.original_name || '') + '">' + esc(e.original_name || '—') + '</td>' +
            '<td class="r-font-mono r-cell-trunc" title="' + esc(e.renamed_to || '') + '">' + esc(e.renamed_to || '—') + '</td>' +
            '<td><span class="r-badge ' + renameBadge(e.status) + '">' + esc(e.status || '?') + '</span></td>' +
            '<td>' + esc(e.error_reason || '—') + '</td>' +
            '</tr>';
        }).join('');
        box.innerHTML = tableWrap(['Time', 'Original Name', 'Renamed To', 'Status', 'Reason'], rows);
      }).catch(function (err) { box.innerHTML = errBox(err.message); });
  }

  function ddVims(hostname, box) {
    RS.db.collection('devices/' + hostname + '/vims_results')
      .orderBy('timestamp', 'desc').limit(200)
      .get().then(function (snap) {
        if (snap.empty) {
          box.innerHTML = '<div class="r-empty">No VIMS records.<br><span class="r-muted-sm">Ensure VIMS Agent writes to <code>devices/{hostname}/vims_results/</code>.</span></div>';
          return;
        }
        var rows = snap.docs.map(function (doc) {
          var e = Object.assign({ id: doc.id }, doc.data());
          var bc = e.status === 'success' ? 'r-badge-ok' : e.status === 'not_found' ? 'r-badge-info' : 'r-badge-warn';
          return '<tr>' +
            '<td>' + fmtTs(e.timestamp) + '</td>' +
            '<td class="r-font-mono">' + esc(e.no_do || '—') + '</td>' +
            '<td>' + esc(e.patient_name || '—') + '</td>' +
            '<td>' + (e.amount !== undefined && e.amount !== null ? 'RM ' + Number(e.amount).toFixed(2) : '—') + '</td>' +
            '<td><span class="r-badge ' + bc + '">' + esc(e.status || '?') + '</span></td>' +
            '<td>' + esc(e.skip_reason || e.error || '—') + '</td>' +
            '</tr>';
        }).join('');
        box.innerHTML =
          '<div class="r-vims-legend">' +
          '<span class="r-badge r-badge-ok">success</span> Scraped &nbsp;' +
          '<span class="r-badge r-badge-warn">skipped</span> Bot issue &nbsp;' +
          '<span class="r-badge r-badge-info">not_found</span> DO/INV number not found in the portal database.' +
          '</div>' +
          tableWrap(['Time', 'No. DO', 'Patient', 'Amount', 'Status', 'Reason'], rows);
      }).catch(function (err) { box.innerHTML = errBox(err.message); });
  }

  function ddCmds(hostname, box) {
    box.innerHTML =
      '<div class="r-cmd-send">' +
      '<input class="r-filter-input" id="r-cmd-inp" placeholder="Command (e.g. restart, ping, refresh)…" style="flex:1">' +
      '<button class="r-btn-primary" onclick="rSendCmd(\'' + esc(hostname) + '\')">Send</button>' +
      '</div>' +
      '<div id="r-cmd-hist" style="margin-top:14px"><div class="r-loading"><span class="r-spin"></span> Loading history…</div></div>';

    // Commands in rasumi-apps use target_machine field
    RS.db.collection('commands')
      .where('target_machine', '==', hostname)
      .orderBy('created_at', 'desc').limit(50)
      .get().then(function (snap) {
        var hist = $r('r-cmd-hist');
        if (!hist) return;
        if (snap.empty) { hist.innerHTML = '<div class="r-empty">No commands sent to this machine</div>'; return; }
        var rows = snap.docs.map(function (doc) {
          var c = doc.data();
          return '<tr>' +
            '<td>' + fmtTs(c.created_at) + '</td>' +
            '<td class="r-font-mono">' + esc(c.command || c.action || '—') + '</td>' +
            '<td><span class="r-badge ' + logBadge(c.status) + '">' + esc(c.status || 'PENDING') + '</span></td>' +
            '<td>' + esc(c.created_by || '—') + '</td>' +
            '</tr>';
        }).join('');
        hist.innerHTML = tableWrap(['Time', 'Command', 'Status', 'By'], rows);
      }).catch(function (err) {
        var hist = $r('r-cmd-hist');
        if (hist) hist.innerHTML = errBox(err.message);
      });
  }

  // ── RENAMER TRACE ──────────────────────────────────────────
  function renderRenamer() {
    var devOpts = Object.keys(RS.devices).map(function (h) { return '<option value="' + esc(h) + '">' + esc(h) + '</option>'; }).join('');
    var view = $r('r-view-area');
    if (!view) return;
    view.innerHTML =
      '<div class="r-panel">' +
      '<div class="r-panel-hdr">' +
      '<h3><i class="fa-solid fa-file-signature"></i> Renamer Bot Trace</h3>' +
      '<div class="r-filter-bar">' +
      '<select class="r-filter-sel" id="r-ren-dev"><option value="">All Machines</option>' + devOpts + '</select>' +
      '<select class="r-filter-sel" id="r-ren-stat">' +
      '<option value="">All Status</option>' +
      '<option value="success">Success</option>' +
      '<option value="wrong_read">Wrong Read</option>' +
      '<option value="failed">Failed</option>' +
      '<option value="skipped">Skipped</option>' +
      '</select>' +
      '<button class="r-btn-sm" onclick="rLoadRenamer()">Search</button>' +
      '</div>' +
      '</div>' +
      '<div class="r-legend">' +
      '<span class="r-badge r-badge-ok">success</span> Renamed correctly &nbsp;' +
      '<span class="r-badge r-badge-warn">wrong_read</span> Bot misread doc name &nbsp;' +
      '<span class="r-badge r-badge-err">failed</span> Bot error &nbsp;' +
      '<span class="r-badge r-badge-muted">skipped</span> Skipped by bot' +
      '</div>' +
      '<div id="r-ren-results"><div class="r-empty">Select filter and click Search</div></div>' +
      '</div>';
  }

  window.rLoadRenamer = function () {
    var hostname = ($r('r-ren-dev') || {}).value || '';
    var status = ($r('r-ren-stat') || {}).value || '';
    var box = $r('r-ren-results');
    if (!box) return;
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Querying…</div>';

    var q = status
      ? RS.db.collectionGroup('renamer_docs').where('status', '==', status).orderBy('timestamp', 'desc').limit(500)
      : RS.db.collectionGroup('renamer_docs').orderBy('timestamp', 'desc').limit(500);

    q.get().then(function (snap) {
      var docs = snap.docs.map(function (doc) {
        var parts = doc.ref.path.split('/');
        return Object.assign({ id: doc.id, _host: parts[1] }, doc.data());
      });
      if (hostname) docs = docs.filter(function (d) { return d._host === hostname; });
      if (!docs.length) { box.innerHTML = '<div class="r-empty">No records match</div>'; return; }
      var rows = docs.map(function (e) {
        return '<tr>' +
          '<td>' + fmtTs(e.timestamp) + '</td>' +
          '<td class="r-font-mono">' + esc(e._host) + '</td>' +
          '<td class="r-font-mono r-cell-trunc" title="' + esc(e.original_name || '') + '">' + esc(e.original_name || '—') + '</td>' +
          '<td class="r-font-mono r-cell-trunc" title="' + esc(e.renamed_to || '') + '">' + esc(e.renamed_to || '—') + '</td>' +
          '<td><span class="r-badge ' + renameBadge(e.status) + '">' + esc(e.status || '?') + '</span></td>' +
          '<td>' + esc(e.error_reason || '—') + '</td>' +
          '<td class="r-font-mono">' + esc(e.run_id || '—') + '</td>' +
          '</tr>';
      }).join('');
      box.innerHTML = '<div class="r-results-count">' + docs.length + ' record(s)</div>' +
        tableWrap(['Time', 'Machine', 'Original Name', 'Renamed To', 'Status', 'Reason', 'Run ID'], rows);
    }).catch(function (err) { box.innerHTML = errBox(err.message); });
  };

  // ── VIBES MONITOR ──────────────────────────────────────────
  function renderVibes() {
    var devOpts = Object.keys(RS.devices).map(function (h) { return '<option value="' + esc(h) + '">' + esc(h) + '</option>'; }).join('');
    var view = $r('r-view-area');
    if (!view) return;
    view.innerHTML =
      '<div class="r-panel">' +
      '<div class="r-panel-hdr">' +
      '<h3><i class="fa-solid fa-file-arrow-up"></i> VIBES Upload Monitor</h3>' +
      '<div class="r-filter-bar">' +
      '<select class="r-filter-sel" id="r-vib-dev"><option value="">All Machines</option>' + devOpts + '</select>' +
      '<select class="r-filter-sel" id="r-vib-res">' +
      '<option value="">All</option>' +
      '<option value="open">Open Only</option>' +
      '<option value="resolved">Resolved Only</option>' +
      '</select>' +
      '<button class="r-btn-sm" onclick="rLoadVibes()">Search</button>' +
      '</div>' +
      '</div>' +
      '<div class="r-legend">' +
      '<span class="r-badge r-badge-err">guard_exhausted</span> Batch aborted (15-doc stop) &nbsp;' +
      '<span class="r-badge r-badge-warn">upload_retry_exhausted</span> Max retries &nbsp;' +
      '<span class="r-badge r-badge-muted">batch_skip</span> Row skipped &nbsp;' +
      '<span class="r-badge r-badge-info">reconciliation_incomplete</span> Recon failed' +
      '</div>' +
      '<div class="r-info-box">' +
      '<i class="fa-solid fa-circle-info"></i>' +
      '<div><strong>Root Cause (15+3 pattern):</strong> <code>batch_retry_guard</code> accumulates across rows. ' +
      'Hits 5 → batch aborts. Claim pre-inserted → not retried same session. Next run picks up remaining.</div>' +
      '</div>' +
      '<div id="r-vib-results"><div class="r-empty">Select filter and click Search</div></div>' +
      '</div>';
  }

  window.rLoadVibes = function () {
    var hostname = ($r('r-vib-dev') || {}).value || '';
    var resolved = ($r('r-vib-res') || {}).value || '';
    var box = $r('r-vib-results');
    if (!box) return;
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Querying…</div>';

    var q;
    if (resolved === 'open') q = RS.db.collectionGroup('vibes_errors').where('resolved', '==', false).orderBy('timestamp', 'desc').limit(500);
    else if (resolved === 'resolved') q = RS.db.collectionGroup('vibes_errors').where('resolved', '==', true).orderBy('timestamp', 'desc').limit(500);
    else q = RS.db.collectionGroup('vibes_errors').orderBy('timestamp', 'desc').limit(500);

    q.get().then(function (snap) {
      var docs = snap.docs.map(function (doc) {
        var parts = doc.ref.path.split('/');
        return Object.assign({ id: doc.id, _host: parts[1] }, doc.data());
      });
      if (hostname) docs = docs.filter(function (d) { return d._host === hostname; });
      if (!docs.length) { box.innerHTML = '<div class="r-empty">No VIBES errors match</div>'; return; }

      var runs = {};
      docs.forEach(function (e) {
        var rid = e.run_id || 'no-run-id';
        if (!runs[rid]) runs[rid] = { rid: rid, host: e._host, time: e.timestamp, errors: [] };
        runs[rid].errors.push(e);
      });

      var html = '<div class="r-results-count">' + docs.length + ' error(s) across ' + Object.keys(runs).length + ' run(s)</div>';
      Object.values(runs).forEach(function (run) {
        var openCnt = run.errors.filter(function (e) { return !e.resolved; }).length;
        var errRows = run.errors.map(function (e) {
          return '<tr>' +
            '<td>' + fmtTs(e.timestamp) + '</td>' +
            '<td>' + esc(e.patient_ic || e.patient_name || e.context || '—') + '</td>' +
            '<td><span class="r-badge ' + errBadge(e.error_type) + '">' + esc(e.error_type || 'unknown') + '</span></td>' +
            '<td class="r-cell-trunc">' + esc(e.message || '—') + '</td>' +
            '<td><span class="r-badge ' + (e.resolved ? 'r-badge-ok' : 'r-badge-err') + '">' + (e.resolved ? 'FIXED' : 'OPEN') + '</span></td>' +
            '<td>' + (!e.resolved
              ? '<button class="r-btn-sm" onclick="rOpenFix(\'' + esc(e.id) + '\',\'' + esc(e._host) + '\',\'vibes_errors\')">Fix</button>'
              : '<span class="r-muted-sm">' + esc(e.fix_note || '✓') + '</span>') +
            '</td>' +
            '</tr>';
        }).join('');
        html +=
          '<div class="r-run-group">' +
          '<div class="r-run-hdr">' +
          '<span class="r-run-id"><i class="fa-solid fa-layer-group"></i> Run: <code>' + esc(run.rid) + '</code></span>' +
          '<span class="r-font-mono r-muted-sm">' + esc(run.host) + '</span>' +
          '<span class="r-run-time">' + fmtTs(run.time) + '</span>' +
          '<span class="r-badge ' + (openCnt ? 'r-badge-err' : 'r-badge-ok') + '">' + (openCnt ? openCnt + ' OPEN' : 'ALL FIXED') + '</span>' +
          '<div class="r-run-actions">' +
          (openCnt > 0 ? '<button class="r-btn-sm warn" onclick="rClearErrors(\'' + esc(run.rid) + '\',\'' + esc(run.host) + '\')">Clear All</button>' : '') +
          '<button class="r-btn-sm" onclick="rDownloadLog(\'' + esc(run.rid) + '\',\'' + esc(run.host) + '\')">↓ JSONL</button>' +
          '</div>' +
          '</div>' +
          '<div class="r-run-body">' +
          tableWrap(['Time', 'Patient', 'Error Type', 'Message', 'Status', 'Action'], errRows) +
          '</div>' +
          '</div>';
      });
      box.innerHTML = html;
    }).catch(function (err) { box.innerHTML = errBox(err.message); });
  };

  // ── VIMS SCRAPE ────────────────────────────────────────────
  function renderVims() {
    var devOpts = Object.keys(RS.devices).map(function (h) { return '<option value="' + esc(h) + '">' + esc(h) + '</option>'; }).join('');
    var view = $r('r-view-area');
    if (!view) return;
    view.innerHTML =
      '<div class="r-panel">' +
      '<div class="r-panel-hdr">' +
      '<h3><i class="fa-solid fa-magnifying-glass-chart"></i> VIMS Scrape Results</h3>' +
      '<div class="r-filter-bar">' +
      '<select class="r-filter-sel" id="r-vims-dev"><option value="">All Machines</option>' + devOpts + '</select>' +
      '<select class="r-filter-sel" id="r-vims-stat">' +
      '<option value="">All Status</option>' +
      '<option value="success">Success</option>' +
      '<option value="skipped">Skipped (Bot Issue)</option>' +
      '<option value="not_found">Not Found (Portal)</option>' +
      '</select>' +
      '<button class="r-btn-sm" onclick="rLoadVims()">Search</button>' +
      '</div>' +
      '</div>' +
      '<div class="r-legend">' +
      '<span class="r-badge r-badge-ok">success</span> Amount scraped &nbsp;' +
      '<span class="r-badge r-badge-warn">skipped</span> Bot skip — client application interface disruption &nbsp;' +
      '<span class="r-badge r-badge-info">not_found</span> VIMS lookup failed: DO/INV payload not found.' +
      '</div>' +
      '<div class="r-info-box warn">' +
      '<i class="fa-solid fa-triangle-exclamation"></i>' +
      '<div><strong>Proof:</strong> <code>skipped</code> = bot issue (apps problem). ' +
      '<code>not_found</code> = DO payload not found in the VIMS portal. ' +
      'Verify the user dispatch logs using the evidence telemetry.</div>' +
      '</div>' +
      '<div id="r-vims-results"><div class="r-empty">Select filter and click Search</div></div>' +
      '</div>';
  }

  window.rLoadVims = function () {
    var hostname = ($r('r-vims-dev') || {}).value || '';
    var status = ($r('r-vims-stat') || {}).value || '';
    var box = $r('r-vims-results');
    if (!box) return;
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Querying…</div>';

    var q = status
      ? RS.db.collectionGroup('vims_results').where('status', '==', status).orderBy('timestamp', 'desc').limit(1000)
      : RS.db.collectionGroup('vims_results').orderBy('timestamp', 'desc').limit(1000);

    q.get().then(function (snap) {
      var docs = snap.docs.map(function (doc) {
        var parts = doc.ref.path.split('/');
        return Object.assign({ id: doc.id, _host: parts[1] }, doc.data());
      });
      if (hostname) docs = docs.filter(function (d) { return d._host === hostname; });
      if (!docs.length) { box.innerHTML = '<div class="r-empty">No VIMS records match</div>'; return; }

      var successCnt = docs.filter(function (d) { return d.status === 'success'; }).length;
      var skipCnt = docs.filter(function (d) { return d.status === 'skipped'; }).length;
      var nfCnt = docs.filter(function (d) { return d.status === 'not_found'; }).length;

      var rows = docs.map(function (e) {
        var bc = e.status === 'success' ? 'r-badge-ok' : e.status === 'not_found' ? 'r-badge-info' : 'r-badge-warn';
        return '<tr>' +
          '<td>' + fmtTs(e.timestamp) + '</td>' +
          '<td class="r-font-mono">' + esc(e._host) + '</td>' +
          '<td class="r-font-mono">' + esc(e.no_do || '—') + '</td>' +
          '<td>' + esc(e.patient_name || '—') + '</td>' +
          '<td>' + (e.amount !== undefined && e.amount !== null ? 'RM ' + Number(e.amount).toFixed(2) : '—') + '</td>' +
          '<td><span class="r-badge ' + bc + '">' + esc(e.status || '?') + '</span></td>' +
          '<td>' + esc(e.skip_reason || e.error || '—') + '</td>' +
          '</tr>';
      }).join('');

      box.innerHTML =
        '<div class="r-summary-row">' +
        '<span class="r-badge r-badge-ok">✓ ' + successCnt + ' success</span>' +
        '<span class="r-badge r-badge-warn">⚠ ' + skipCnt + ' bot skipped</span>' +
        '<span class="r-badge r-badge-info">○ ' + nfCnt + ' not found</span>' +
        '<span class="r-muted-sm">' + docs.length + ' total</span>' +
        '</div>' +
        tableWrap(['Time', 'Machine', 'No. DO', 'Patient', 'Amount', 'Status', 'Reason'], rows);
    }).catch(function (err) { box.innerHTML = errBox(err.message); });
  };

  // ── LOG EXPLORER ───────────────────────────────────────────
  function renderLogs() {
    var devOpts = Object.keys(RS.devices).map(function (h) { return '<option value="' + esc(h) + '">' + esc(h) + '</option>'; }).join('');
    var appOpts = RASUMI_APPS.map(function (a) {
      return a.firebaseNames.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    }).join('');
    var view = $r('r-view-area');
    if (!view) return;
    view.innerHTML =
      '<div class="r-panel">' +
      '<div class="r-panel-hdr">' +
      '<h3><i class="fa-solid fa-scroll"></i> Log Explorer (logs collection)</h3>' +
      '<div class="r-filter-bar">' +
      '<select class="r-filter-sel" id="r-log-dev"><option value="">All Machines</option>' + devOpts + '</select>' +
      '<select class="r-filter-sel" id="r-log-app"><option value="">All Apps</option>' + appOpts + '</select>' +
      '<select class="r-filter-sel" id="r-log-stat">' +
      '<option value="">All Status</option>' +
      '<option value="COMPLETED">Completed</option>' +
      '<option value="FAILED">Failed</option>' +
      '</select>' +
      '<button class="r-btn-sm" onclick="rLoadLogs()">Search</button>' +
      '</div>' +
      '</div>' +
      '<div id="r-log-results"><div class="r-empty">Select filter and click Search</div></div>' +
      '</div>';
  }

  window.rLoadLogs = function () {
    var hostname = ($r('r-log-dev') || {}).value || '';
    var appName = ($r('r-log-app') || {}).value || '';
    var status = ($r('r-log-stat') || {}).value || '';
    var box = $r('r-log-results');
    if (!box) return;
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Querying…</div>';

    var q = RS.db.collection('logs').orderBy('timestamp', 'desc').limit(200);
    if (hostname && appName && status) {
      q = RS.db.collection('logs').where('machine', '==', hostname).where('app_name', '==', appName).where('status', '==', status).orderBy('timestamp', 'desc').limit(200);
    } else if (hostname && appName) {
      q = RS.db.collection('logs').where('machine', '==', hostname).where('app_name', '==', appName).orderBy('timestamp', 'desc').limit(200);
    } else if (hostname && status) {
      q = RS.db.collection('logs').where('machine', '==', hostname).where('status', '==', status).orderBy('timestamp', 'desc').limit(200);
    } else if (appName && status) {
      q = RS.db.collection('logs').where('app_name', '==', appName).where('status', '==', status).orderBy('timestamp', 'desc').limit(200);
    } else if (hostname) {
      q = RS.db.collection('logs').where('machine', '==', hostname).orderBy('timestamp', 'desc').limit(200);
    } else if (appName) {
      q = RS.db.collection('logs').where('app_name', '==', appName).orderBy('timestamp', 'desc').limit(200);
    } else if (status) {
      q = RS.db.collection('logs').where('status', '==', status).orderBy('timestamp', 'desc').limit(200);
    }

    q.get().then(function (snap) {
      if (snap.empty) { box.innerHTML = '<div class="r-empty">No logs match</div>'; return; }
      var rows = snap.docs.map(function (doc) {
        var e = doc.data();
        var st = (e.status || 'INFO').toUpperCase();
        return '<tr>' +
          '<td>' + fmtTs(e.timestamp) + '</td>' +
          '<td class="r-font-mono">' + esc(e.machine || '—') + '</td>' +
          '<td><span class="r-badge r-badge-purple">' + esc(e.app_name || '—') + '</span></td>' +
          '<td><span class="r-badge ' + logBadge(st) + '">' + st + '</span></td>' +
          '<td>' + esc(e.branch_id || '—') + '</td>' +
          '<td class="r-cell-trunc">' + esc(e.activity_name || e.details || e.error_msg || '—') + '</td>' +
          '<td>' + (e.duration !== undefined ? e.duration + 's' : '—') + '</td>' +
          '</tr>';
      }).join('');
      box.innerHTML = '<div class="r-results-count">' + snap.size + ' log(s)</div>' +
        tableWrap(['Time', 'Machine', 'App', 'Status', 'Branch', 'Details', 'Duration'], rows);
    }).catch(function (err) { box.innerHTML = errBox(err.message); });
  };

  // ── COMMANDS ───────────────────────────────────────────────
  function renderCommands() {
    var devOpts = Object.keys(RS.devices).map(function (h) { return '<option value="' + esc(h) + '">' + esc(h) + '</option>'; }).join('');
    var view = $r('r-view-area');
    if (!view) return;
    view.innerHTML =
      '<div class="r-panel">' +
      '<div class="r-panel-hdr"><h3><i class="fa-solid fa-terminal"></i> Remote Commands</h3></div>' +
      '<div class="r-info-box">' +
      '<i class="fa-solid fa-circle-info"></i>' +
      '<div>Commands are written to the <code>commands</code> collection with <code>target_machine</code> = hostname. ' +
      'The Rasumi Apps agent polls this collection and executes pending commands.</div>' +
      '</div>' +
      '<div class="r-cmd-section">' +
      '<h4>Send to Specific Machine</h4>' +
      '<div class="r-cmd-row">' +
      '<select class="r-filter-sel" id="r-cmd-dev-sel"><option value="">Select Machine</option>' + devOpts + '</select>' +
      '<input class="r-filter-input" id="r-cmd-dev-inp" placeholder="e.g. RESTART, PING, REFRESH_RENAMER">' +
      '<button class="r-btn-primary" onclick="rSendCmd()">Send</button>' +
      '</div>' +
      '</div>' +
      '<div class="r-cmd-section">' +
      '<h4>Broadcast to All Online Machines</h4>' +
      '<div class="r-cmd-row">' +
      '<input class="r-filter-input" id="r-broadcast-inp" placeholder="Broadcast command…">' +
      '<button class="r-btn-warn" onclick="rSendBroadcast()">Broadcast</button>' +
      '</div>' +
      '</div>' +
      '<div class="r-panel-hdr" style="margin-top:20px"><h3>Command History (Last 50)</h3></div>' +
      '<div id="r-cmd-hist-main"><div class="r-loading"><span class="r-spin"></span> Loading…</div></div>' +
      '</div>';

    RS.db.collection('commands').orderBy('created_at', 'desc').limit(50).get().then(function (snap) {
      var box = $r('r-cmd-hist-main');
      if (!box) return;
      if (snap.empty) { box.innerHTML = '<div class="r-empty">No commands sent yet</div>'; return; }
      var rows = snap.docs.map(function (doc) {
        var c = doc.data();
        return '<tr>' +
          '<td>' + fmtTs(c.created_at) + '</td>' +
          '<td class="r-font-mono">' + esc(c.target_machine || 'broadcast') + '</td>' +
          '<td class="r-font-mono">' + esc(c.command || c.action || '—') + '</td>' +
          '<td><span class="r-badge ' + logBadge(c.status) + '">' + esc(c.status || 'PENDING') + '</span></td>' +
          '<td>' + esc(c.created_by || '—') + '</td>' +
          '</tr>';
      }).join('');
      box.innerHTML = tableWrap(['Time', 'Target Machine', 'Command', 'Status', 'By'], rows);
    }).catch(function (err) {
      var box = $r('r-cmd-hist-main');
      if (box) box.innerHTML = errBox(err.message);
    });
  }

  window.rSendCmd = function (hostnameOverride) {
    var target = hostnameOverride || ($r('r-cmd-dev-sel') || {}).value || '';
    var command = hostnameOverride
      ? (($r('r-cmd-inp') || {}).value || '')
      : (($r('r-cmd-dev-inp') || {}).value || '');
    if (!target || !command) { rToast('Select machine and enter command', 'warn'); return; }
    var user = RS.auth ? RS.auth.currentUser : null;
    RS.db.collection('commands').add({
      target_machine: target,
      command: command.toUpperCase(),
      status: 'PENDING',
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      created_by: user ? user.email : 'admin'
    }).then(function () {
      rToast('Command "' + command + '" sent to ' + target, 'success');
      var inp = $r('r-cmd-dev-inp') || $r('r-cmd-inp');
      if (inp) inp.value = '';
    }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
  };

  window.rSendBroadcast = function () {
    var command = ($r('r-broadcast-inp') || {}).value || '';
    if (!command) { rToast('Enter broadcast command', 'warn'); return; }
    if (!confirm('Broadcast "' + command.toUpperCase() + '" to ALL online machines?')) return;
    var online = Object.values(RS.devices).filter(function (d) { return d._status === 'online'; });
    if (!online.length) { rToast('No online machines', 'warn'); return; }
    var user = RS.auth ? RS.auth.currentUser : null;
    var batch = RS.db.batch();
    online.forEach(function (d) {
      var ref = RS.db.collection('commands').doc();
      batch.set(ref, {
        target_machine: d.id,
        command: command.toUpperCase(),
        status: 'PENDING',
        is_broadcast: true,
        created_at: firebase.firestore.FieldValue.serverTimestamp(),
        created_by: user ? user.email : 'admin'
      });
    });
    batch.commit().then(function () {
      rToast('Broadcast → ' + online.length + ' machine(s)', 'success');
      var inp = $r('r-broadcast-inp');
      if (inp) inp.value = '';
      renderCommands();
    }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── ALERTS ─────────────────────────────────────────────────
  function renderAlerts() {
    var devs = Object.values(RS.devices);
    var offline = devs.filter(function (d) { return d._status === 'offline'; });
    var stale = devs.filter(function (d) { return d._status === 'stale'; });
    var view = $r('r-view-area');
    if (!view) return;

    var html = '<div class="r-panel"><div class="r-panel-hdr"><h3><i class="fa-solid fa-triangle-exclamation"></i> Active Alerts</h3></div>';

    if (!offline.length && !stale.length && !RS.unresolvedVibes) {
      html += '<div class="r-empty"><i class="fa-solid fa-circle-check"></i> No active alerts. All systems nominal.</div>';
    }

    if (offline.length) {
      html += '<div class="r-alert-section"><div class="r-alert-section-title err"><i class="fa-solid fa-circle-xmark"></i> Offline Machines (' + offline.length + ')</div>';
      offline.forEach(function (d) {
        html += '<div class="r-alert-item err"><i class="fa-solid fa-server"></i> <strong>' + esc(d.id) + '</strong> — last heartbeat ' + fmtElapsed(d.last_heartbeat || d.last_seen) +
          ' <button class="r-btn-sm" onclick="rNav(\'r-device:' + esc(d.id) + '\')">View</button></div>';
      });
      html += '</div>';
    }

    if (stale.length) {
      html += '<div class="r-alert-section"><div class="r-alert-section-title warn"><i class="fa-solid fa-clock"></i> Stale Machines (' + stale.length + ')</div>';
      stale.forEach(function (d) {
        html += '<div class="r-alert-item warn"><i class="fa-solid fa-server"></i> <strong>' + esc(d.id) + '</strong> — no heartbeat ' + fmtElapsed(d.last_heartbeat || d.last_seen) +
          ' <button class="r-btn-sm" onclick="rNav(\'r-device:' + esc(d.id) + '\')">View</button></div>';
      });
      html += '</div>';
    }

    if (RS.unresolvedVibes > 0) {
      html += '<div class="r-alert-section"><div class="r-alert-section-title err"><i class="fa-solid fa-bug"></i> Unresolved VIBES Errors (' + RS.unresolvedVibes + ')</div>' +
        '<div class="r-alert-item err">' + RS.unresolvedVibes + ' error(s) pending resolution.' +
        ' <button class="r-btn-sm" onclick="rNav(\'r-vibes\')">Open VIBES Monitor →</button></div></div>';
    }

    html += '</div>';
    view.innerHTML = html;
  }

  // ── FIX MODAL ──────────────────────────────────────────────
  window.rOpenFix = function (docId, hostname, collection) {
    var body = $r('r-modal-body');
    var footer = $r('r-modal-footer');
    var title = $r('r-modal-title');
    if (!body) return;
    if (title) title.textContent = 'Mark as Fixed';
    body.innerHTML =
      '<div class="r-fix-form">' +
      '<div class="r-fix-field">' +
      '<label>Fix Note <span class="r-required">*</span> <span class="r-muted-sm">(min 5 chars)</span></label>' +
      '<textarea id="r-fix-note" rows="4" class="r-textarea" placeholder="Describe what was done to resolve this issue…"></textarea>' +
      '</div>' +
      '<div class="r-muted-sm">Error ID: <code>' + esc(docId) + '</code> on <code>' + esc(hostname) + '</code></div>' +
      '</div>';
    if (footer) footer.innerHTML =
      '<button class="r-btn-primary" onclick="rSubmitFix(\'' + esc(docId) + '\',\'' + esc(hostname) + '\',\'' + esc(collection) + '\')">Mark Fixed</button>' +
      '<button class="r-btn-sm" onclick="rModalClose()">Cancel</button>';
    rModalOpen();
  };

  window.rSubmitFix = function (docId, hostname, collection) {
    var note = ($r('r-fix-note') || {}).value || '';
    if (note.trim().length < 5) { rToast('Fix note must be at least 5 characters', 'warn'); return; }
    var user = RS.auth ? RS.auth.currentUser : null;
    RS.db.doc('devices/' + hostname + '/' + collection + '/' + docId).update({
      resolved: true,
      fix_note: note.trim(),
      fixed_by: user ? user.email : 'admin',
      fixed_at: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      rToast('Marked as fixed', 'success');
      rModalClose();
      rNav(RS.route);
    }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
  };

  window.rClearErrors = function (runId, hostname) {
    if (!confirm('Mark ALL open errors in run "' + runId + '" as fixed?')) return;
    var user = RS.auth ? RS.auth.currentUser : null;
    RS.db.collection('devices/' + hostname + '/vibes_errors')
      .where('run_id', '==', runId).where('resolved', '==', false)
      .get().then(function (snap) {
        if (snap.empty) { rToast('No open errors in this run', 'info'); return; }
        var batch = RS.db.batch();
        snap.forEach(function (doc) {
          batch.update(doc.ref, {
            resolved: true,
            fix_note: 'Bulk cleared by admin',
            fixed_by: user ? user.email : 'admin',
            fixed_at: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        return batch.commit();
      }).then(function () {
        rToast('All errors in run cleared', 'success');
        rNav(RS.route);
      }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
  };

  window.rDownloadLog = function (runId, hostname) {
    RS.db.collection('devices/' + hostname + '/vibes_errors')
      .where('run_id', '==', runId).orderBy('timestamp', 'asc')
      .get().then(function (snap) {
        var lines = snap.docs.map(function (doc) {
          var d = Object.assign({}, doc.data());
          if (d.timestamp && d.timestamp.toDate) d.timestamp = d.timestamp.toDate().toISOString();
          if (d.fixed_at && d.fixed_at.toDate) d.fixed_at = d.fixed_at.toDate().toISOString();
          return JSON.stringify(Object.assign({ id: doc.id }, d));
        });
        var blob = new Blob([lines.join('\n')], { type: 'application/jsonl' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = hostname + '_' + runId + '_errors.jsonl'; a.click();
        URL.revokeObjectURL(url);
        rToast('JSONL downloaded', 'success');
      }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── Modal ──────────────────────────────────────────────────
  function rModalOpen() {
    var ov = $r('r-modal-overlay');
    if (ov) ov.classList.remove('hidden');
  }

  window.rModalClose = function (e) {
    if (e && e.target !== $r('r-modal-overlay')) return;
    var ov = $r('r-modal-overlay');
    if (ov) ov.classList.add('hidden');
  };

  // ── Entry Point ────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('mode-rasumi');
    if (btn) {
      btn.addEventListener('click', function () {
        var ms = document.getElementById('mode-submenu');
        if (ms) ms.classList.add('hidden');
        enterRasumiMode();
      });
    }
  });

})();
