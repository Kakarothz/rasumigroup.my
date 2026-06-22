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

  // ── Supabase config (Fasa 3) ──────────────────────────────
  // Machine_status reads migrate to Supabase Realtime.
  // Uses publishable (anon) key — RLS allows read on machine_status only.
  var RASUMI_SUPABASE_URL     = 'https://seqlkwdghibmsfkbuwqq.supabase.co';
  var RASUMI_SUPABASE_ANON_KEY = 'sb_publishable_BotuzQAIly3eTShpQ_Lmtg_Y9_QlyDp';
  // ──────────────────────────────────────────────────────────

  // ── ⚠️  FILL THIS IN ──────────────────────────────────────
  // Get from: Firebase Console → rasumi-apps project →
  // Project Settings → General → Your apps → Web app → Config
  var RASUMI_FIREBASE_CONFIG = {
    apiKey:            "AIzaSyBf526r_J0EfpIm-2bYYoSUnCkgNNwXnpo",
    authDomain:        "rasumi-apps.firebaseapp.com",
    projectId:         "rasumi-apps",
    storageBucket:     "rasumi-apps.firebasestorage.app",
    messagingSenderId: "946661064873",
    appId:             "1:946661064873:web:4a080de1b0be87290229b8",
    measurementId:     "G-XC6MRD7QJ5"
  };
  // ──────────────────────────────────────────────────────────

  // All apps in the Rasumi Apps ecosystem
  var RASUMI_APPS = [
    { key: 'renamer_hq',   label: 'Renamer HQ',   icon: 'fa-file-signature',           firebaseNames: ['Renamer HQ'] },
    { key: 'fv_branch',    label: 'FV Branch',     icon: 'fa-code-branch',              firebaseNames: ['FV Branch'] },
    { key: 'quick_rename', label: 'Quick Rename',  icon: 'fa-bolt',                     firebaseNames: ['Quick Rename'] },
    { key: 'vibes',        label: 'VIBES Agent',   icon: 'fa-file-arrow-up',            firebaseNames: ['VIBES', 'Vibes Agent'] },
    { key: 'vims',         label: 'VIMS Scraper',  icon: 'fa-magnifying-glass-chart',   firebaseNames: ['VIMS', 'Vims Scraper'] },
    { key: 'scanify',      label: 'Scanify',       icon: 'fa-scanner',                  firebaseNames: ['Scanify'] },
    { key: 'pdf_splitter', label: 'PDF Splitter',  icon: 'fa-file-pdf',                 firebaseNames: ['PDF Splitter', 'pdf_studio'] },
  ];

  // ── State ──────────────────────────────────────────────────
  var RS = {
    db:          null,   // rasumi-apps Firestore (Firebase)
    supa:        null,   // Supabase client (Fasa 3+)
    auth:        null,   // shared auth from app.js
    fbApp:       null,   // second Firebase app instance
    route:       'r-dashboard',
    listeners:   [],
    devices:     {},
    unresolvedVibes:     0,
    unresolvedRenamer:   0,
    unresolvedVims:      0,
    unresolvedAppErrors: 0,
    appStats:    {},     // keyed by app key → { today: N, errors: N, last_seen: ts }
    clockTick:   null,
    initialized: false,
    configOk:    false,
    userRole:    'admin',    // 'superadmin' | 'admin'
    canWrite:    false,      // true = write allowed for this session
    // New: telemetry state
    _selectedDevice: null,   // hostname of selected node in dashboard
    _terminal:   [],         // live stream lines
    _charts:     {},         // Chart.js instances
    _logCache:   [],         // log entries for modal
    _recentLogs: []          // recent logs for activity feed
  };

  // ── Helpers ────────────────────────────────────────────────
  var $r  = function(id) { return document.getElementById(id); };
  var qra = function(sel) { return [].slice.call(document.querySelectorAll('#rasumi-container ' + sel)); };

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

  // ── Modal open/close (r-modal-overlay) ───────────────────────
  window.rModalOpen = function() {
    var o = $r('r-modal-overlay');
    if (o) o.classList.remove('hidden');
  };
  window.rModalClose = function(e) {
    if (e && e.target !== $r('r-modal-overlay')) return;
    var o = $r('r-modal-overlay');
    if (o) o.classList.add('hidden');
  };

  // Cache for detail modal lookups (populated by rLoadAppErrors)
  var _appErrorCache = {};

  function fmtTs(ts) {
    if (!ts) return '—';
    var d;
    if (ts && ts.toDate)            d = ts.toDate();
    else if (ts && ts.seconds)      d = new Date(ts.seconds * 1000);
    else if (typeof ts === 'string') d = new Date(ts);   // ISO string e.g. "2026-05-05T08:44:16.839636"
    else                             d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts).substring(0, 19).replace('T', ' ');
    return d.toLocaleString('ms-MY', {
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  }

  function fmtElapsed(ts) {
    if (!ts) return 'never';
    var d;
    if (ts && ts.toDate)       d = ts.toDate();
    else if (ts && ts.seconds) d = new Date(ts.seconds * 1000);
    else d = new Date(ts);
    var s = (Date.now() - d.getTime()) / 1000;
    if (s < 60)    return Math.floor(s) + 's ago';
    if (s < 3600)  return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  // Rasumi Apps status: check is_online/status field first, then timestamp.
  // is_online=false or status=OFFLINE means the app explicitly marked itself offline —
  // trust that regardless of how recent the timestamp is (avoids false ONLINE on exit).
  function deviceStatus(data) {
    if (data.is_online === false || data.status === 'OFFLINE') return 'offline';
    var ts = data.last_heartbeat || data.last_seen;
    if (!ts) return 'offline';
    var d;
    if (ts.toDate)       d = ts.toDate();
    else if (ts.seconds) d = new Date(ts.seconds * 1000);
    else d = new Date(ts);
    var mins = (Date.now() - d.getTime()) / 60000;
    if (mins < 5)  return 'online';
    if (mins < 15) return 'stale';
    return 'offline';
  }

  function errBadge(t) {
    var m = {
      guard_exhausted:          'r-badge-err',
      upload_retry_exhausted:   'r-badge-err',
      panic:                    'r-badge-err',
      completion_failed:        'r-badge-err',
      batch_incomplete:         'r-badge-warn',
      reconciliation_incomplete:'r-badge-warn',
      preflight_warn:           'r-badge-warn',
      batch_skip:               'r-badge-muted',
      FAILED:                   'r-badge-err',
      ERROR:                    'r-badge-err'
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
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function tableWrap(headers, rows) {
    return '<div class="r-table-wrap"><table class="r-table"><thead><tr>' +
      headers.map(function(h){ return '<th>' + h + '</th>'; }).join('') +
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
      RS.db   = RS.fbApp.firestore();
      RS.currentUser = null;    // Populated by Supabase auth listener
      RS.configOk = true;
      return true;
    } catch (e) {
      RS.configOk = false;
      return false;
    }
  }

  // ── Supabase Init (Fasa 3) ────────────────────────────────
  function initRasumiSupabase() {
    if (RS.supa) return true;
    try {
      if (typeof supabase === 'undefined' || !supabase.createClient) {
        console.warn('[Rasumi] Supabase SDK not loaded.');
        return false;
      }
      RS.supa = supabase.createClient(RASUMI_SUPABASE_URL, RASUMI_SUPABASE_ANON_KEY);
      console.log('[Rasumi] Supabase client ready.');
      return true;
    } catch (e) {
      console.warn('[Rasumi] Supabase init failed:', e.message);
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
      // ── TOP NAVIGATION (Identical to VIMS) ──
      '<nav class="top-nav" style="z-index: 9999;">',
      '  <div class="nav-brand">',
      '    <div class="brand-icon"><img src="../assets/icon.png" style="width:32px;height:32px;object-fit:contain;display:block;"></div>',
      '    <div class="brand-text">',
      '      <h1>RASUMI APPS</h1>',
      '      <span>ADMIN CONSOLE</span>',
      '    </div>',
      '    <div class="nav-status-chips">',
      '      <span id="r-chip-on" class="chip success">0 ONLINE</span>',
      '      <span id="r-chip-st" class="chip neutral" style="display:none">0 STALE</span>',
      '      <span id="r-chip-off" class="chip error">0 OFFLINE</span>',
      '    </div>',
      '  </div>',
      '  <div class="nav-search">',
      '    <i class="fa-solid fa-magnifying-glass"></i>',
      '    <input type="text" id="r-tb-search-inp" placeholder="Search devices, logs, commands…" oninput="rGlobalSearch(this.value)">',
      '    <span class="hotkey">Ctrl + K</span>',
      '  </div>',
      '  <div class="nav-actions">',
      '    <button class="icon-btn notif-btn" onclick="var p=document.getElementById(\'r-nav-dropdown\'); if(p) p.classList.add(\'hidden\'); document.getElementById(\'notif-dropdown\').classList.toggle(\'hidden\'); event.stopPropagation();"><i class="fa-regular fa-bell"></i><span id="r-nb-alerts" class="badge hidden">0</span></button>',
      '    <button class="icon-btn"><i class="fa-regular fa-circle-question"></i></button>',
      '    <button class="icon-btn"><i class="fa-solid fa-gear"></i></button>',
      '    <div class="user-profile" id="r-profile-trigger" style="cursor:pointer" onclick="var n=document.getElementById(\'notif-dropdown\'); if(n) n.classList.add(\'hidden\'); document.getElementById(\'r-nav-dropdown\').classList.toggle(\'hidden\'); event.stopPropagation();">',
      '      <img src="https://ui-avatars.com/api/?name=Super+Admin&background=8b5cf6&color=fff" alt="User">',
      '      <div class="user-info">',
      '        <span class="name">SUPER ADMIN</span>',
      '        <span class="role">Super Admin</span>',
      '      </div>',
      '    </div>',
      '    <div id="r-nav-dropdown" class="nav-dropdown hidden" style="top:60px; right:20px; position:absolute; z-index:9999;">',
      '      <div class="dropdown-item" onclick="window.location.href=\'../menu.html\'"><i class="fa-solid fa-house"></i> MAIN MENU</div>',
      '      <div class="dropdown-sep"></div>',
      '      <div class="dropdown-item" onclick="window.location.href=\'index.html\'"><i class="fa-solid fa-border-all"></i> RASUMI APPS</div>',
      '      <div class="dropdown-item" onclick="window.location.href=\'../sales report/index.html\'"><i class="fa-solid fa-shield-halved"></i> SALES REPORT</div>',
      '      <div class="dropdown-item" onclick="window.location.href=\'../camscanner/camscanner_admin/index.html\'"><i class="fa-solid fa-camera"></i> CAMSCANNER ADMIN</div>',
      '      <div class="dropdown-sep"></div>',
      '      <div class="dropdown-item" id="r-menu-profile" onclick="window.rOpenProfile()"><i class="fa-solid fa-user-gear"></i> UPDATE PROFILE</div>',
      '      <div class="dropdown-item" id="r-menu-settings" style="display:none" onclick="window.rOpenSettings()"><i class="fa-solid fa-sliders"></i> SETTINGS</div>',
      '      <div class="dropdown-item" style="color: #ff008c" onclick="window.rLogout()"><i class="fa-solid fa-right-from-bracket"></i> LOG OUT</div>',
      '    </div>',
      '    <!-- NOTIFICATION DROPDOWN -->',
      '    <div id="notif-dropdown" class="nav-dropdown hidden" style="top: 46px; right: 100px; min-width: 300px; padding-bottom: 5px; position:absolute; z-index:9999;">',
      '        <div style="padding: 12px 15px; font-size: 10px; color: var(--text-muted); border-bottom: 1px solid var(--glass-border-hi); margin-bottom: 5px;">RECENT ALERTS</div>',
      '        <div id="notif-dropdown-list" style="padding: 10px; font-size: 11px; text-align: center; color: var(--text-muted);">No new alerts</div>',
      '        <div class="dropdown-sep"></div>',
      '        <div class="dropdown-item" onclick="rNav(\'r-alerts\')" style="justify-content: center; color: var(--cyan);"><i class="fa-solid fa-arrow-right"></i> View All Alerts</div>',
      '    </div>',
      '  </div>',
      '</nav>',

      // ── HORIZONTAL NAV ──
      '<nav class="r-h-nav">',
      '  <div class="r-hn-item" id="rni-r-dashboard" onclick="rNav(\'r-dashboard\')"><i class="fa-solid fa-gauge-high"></i> Dashboard</div>',
      '  <div class="r-hn-item" id="rni-r-devices"   onclick="rNav(\'r-devices\')"><i class="fa-solid fa-server"></i> Device Fleet</div>',
      '  <div class="r-hn-sep"></div>',
      '  <div class="r-hn-item" id="rni-r-renamer"    onclick="rNav(\'r-renamer\')"><i class="fa-solid fa-file-signature"></i> Renamer HQ <span class="r-nb warn" id="r-nb-renamer" style="display:none"></span></div>',
      '  <div class="r-hn-item" id="rni-r-renamer-fv" onclick="rNav(\'r-renamer-fv\')"><i class="fa-solid fa-file-invoice"></i> Renamer FV</div>',
      '  <div class="r-hn-item" id="rni-r-splitter"   onclick="rNav(\'r-splitter\')"><i class="fa-solid fa-scissors"></i> PDF Splitter</div>',
      '  <div class="r-hn-item" id="rni-r-studio"     onclick="rNav(\'r-studio\')"><i class="fa-solid fa-file-pdf"></i> PDF Studio</div>',
      '  <div class="r-hn-item" id="rni-r-quick"      onclick="rNav(\'r-quick\')"><i class="fa-solid fa-bolt"></i> Quick Rename</div>',
      '  <div class="r-hn-item" id="rni-r-scanify"    onclick="rNav(\'r-scanify\')"><i class="fa-solid fa-camera"></i> Scanify</div>',
      '  <div class="r-hn-item" id="rni-r-vibes"      onclick="rNav(\'r-vibes\')"><i class="fa-solid fa-file-arrow-up"></i> VIBES Monitor <span class="r-nb err" id="r-nb-vibes" style="display:none"></span></div>',
      '  <div class="r-hn-item" id="rni-r-vims"       onclick="rNav(\'r-vims\')"><i class="fa-solid fa-magnifying-glass-chart"></i> VIMS Scrape <span class="r-nb warn" id="r-nb-vims" style="display:none"></span></div>',
      '  <div class="r-hn-sep"></div>',
      '  <div class="r-hn-item" id="rni-r-logs"      onclick="rNav(\'r-logs\')"><i class="fa-solid fa-scroll"></i> Log Explorer</div>',
      '  <div class="r-hn-item" id="rni-r-commands"  onclick="rNav(\'r-commands\')"><i class="fa-solid fa-terminal"></i> Commands</div>',
      '  <div class="r-hn-item" id="rni-r-alerts"    onclick="rNav(\'r-alerts\')"><i class="fa-solid fa-triangle-exclamation"></i> Alerts <span class="r-nb err" id="r-nb-alerts" style="display:none"></span></div>',
  '  <div class="r-hn-item" id="rni-r-release"   onclick="rNav(\'r-release\')"><i class="fa-solid fa-rocket"></i> Release Mgmt</div>',
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

      '    <!-- PROFILE MODAL -->',
      '    <div id="r-profile-modal" class="hidden" style="position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:10000; display:flex; align-items:center; justify-content:center;">',
      '        <div style="background:var(--rc-bg, #111827); border:1px solid var(--rc-border, #374151); border-radius:8px; width:400px; padding:20px; box-shadow:0 10px 30px rgba(0,0,0,0.5); max-height:90vh; overflow-y:auto;">',
      '            <div style="display:flex; justify-content:space-between; margin-bottom:20px; border-bottom:1px solid var(--rc-border, #374151); padding-bottom:10px;">',
      '                <h3 style="margin:0; font-size:14px; color:var(--rc-cyan, #06b6d4);"><i class="fa-solid fa-user-shield"></i> PROFILE COMMAND</h3>',
      '                <button id="btn-close-r-profile" style="background:none; border:none; color:var(--rc-text-dim, #9ca3af); cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>',
      '            </div>',
      '            <div style="text-align:center;position:relative;">',
      '                <button onclick="rToggleProfileEdit()" title="Edit profile" style="position:absolute;top:0;right:0;background:none;border:none;color:var(--rc-text-dim,#9ca3af);cursor:pointer;font-size:13px;padding:3px 5px;line-height:1;transition:color 0.15s;" onmouseover="this.style.color=\'#06b6d4\'" onmouseout="this.style.color=\'var(--rc-text-dim,#9ca3af)\'"><i class="fa-solid fa-pen-to-square"></i></button>',
      '                <input type="file" id="r-profile-upload" class="hidden" accept="image/*">',
      '                <div style="position:relative;display:inline-block;margin-bottom:14px;">',
      '                    <img id="r-profile-img-display" src="https://ui-avatars.com/api/?name=SA&background=0d1117&color=06b6d4" style="width:88px;height:88px;border-radius:50%;cursor:pointer;border:2px solid var(--rc-cyan,#06b6d4);display:block;object-fit:cover;" title="Click to change photo">',
      '                    <div id="r-avatar-spinner" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,0.6);border-radius:50%;align-items:center;justify-content:center;font-size:18px;color:#fff"><i class="fa-solid fa-circle-notch fa-spin"></i></div>',
      '                </div>',
      '                <div id="r-p-displayname" style="font-weight:bold;color:var(--rc-text,#fff);letter-spacing:1px;font-size:13px;">—</div>',
      '                <div id="r-p-email" style="font-size:11px;color:var(--rc-text-dim,#9ca3af);margin-top:3px;">—</div>',
      '                <div id="r-p-role-badge" style="display:inline-block;margin-top:6px;font-size:9px;font-weight:700;letter-spacing:1.5px;padding:2px 8px;border-radius:10px;background:rgba(0,240,255,0.1);color:var(--rc-cyan,#06b6d4);border:1px solid rgba(0,240,255,0.25);">—</div>',
      '                <div id="r-p-edit-panel" style="display:none;text-align:left;margin-top:14px;padding:12px 14px;background:rgba(255,255,255,0.03);border:1px solid var(--rc-border,#374151);border-radius:6px;">',
      '                    <div style="font-size:10px;color:var(--rc-text-dim,#9ca3af);letter-spacing:1px;margin-bottom:6px;">NICKNAME</div>',
      '                    <input type="text" id="r-p-nickname" placeholder="Display name (e.g. Kakar0th)" style="width:100%;box-sizing:border-box;padding:9px 12px;margin-bottom:10px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-family:inherit;font-size:12px;">',
      '                    <div style="font-size:10px;color:var(--rc-text-dim,#9ca3af);letter-spacing:1px;margin-bottom:6px;">EMAIL</div>',
      '                    <input type="email" id="r-p-edit-email" placeholder="New email address" style="width:100%;box-sizing:border-box;padding:9px 12px;margin-bottom:10px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-family:inherit;font-size:12px;">',
      '                    <div id="r-p-email-note" style="font-size:10px;color:var(--rc-text-dim,#9ca3af);margin-bottom:10px;display:none;">Supabase will send a verification to the new email. Login email updates after confirmation.</div>',
      '                    <button onclick="rSaveProfile()" style="width:100%;padding:9px;background:rgba(6,182,212,0.12);border:1px solid rgba(6,182,212,0.35);color:var(--rc-cyan,#06b6d4);border-radius:4px;cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;">Save Changes</button>',
      '                </div>',
      '                <div style="text-align:left;margin-top:14px;border-top:1px solid var(--rc-border,#374151);padding-top:16px;">',
      '                    <div style="font-size:10px;color:var(--rc-text-dim,#9ca3af);letter-spacing:1px;margin-bottom:8px;">CHANGE PASSWORD</div>',
      '                    <input type="password" id="r-p-curr-pass" placeholder="Current password" style="width:100%;box-sizing:border-box;padding:10px 12px;margin-bottom:8px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-family:inherit;">',
      '                    <input type="password" id="r-p-new-pass" placeholder="New password (min 6 chars)" style="width:100%;box-sizing:border-box;padding:10px 12px;margin-bottom:8px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-family:inherit;">',
      '                    <input type="password" id="r-p-confirm-pass" placeholder="Confirm new password" style="width:100%;box-sizing:border-box;padding:10px 12px;margin-bottom:12px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-family:inherit;">',
      '                    <button id="btn-update-r-profile" style="width:100%;padding:12px;background:var(--rc-cyan,#06b6d4);color:#000;font-weight:bold;border:none;border-radius:4px;cursor:pointer;letter-spacing:1px;font-family:inherit;">CHANGE PASSWORD</button>',
      '                    <div id="r-p-pass-status" style="font-size:10px;margin-top:8px;text-align:center;min-height:14px;"></div>',
      '                </div>',
      '                <!-- 2FA SECTION -->',
      '                <div style="text-align:left;margin-top:14px;border-top:1px solid var(--rc-border,#374151);padding-top:16px;">',
      '                    <div style="font-size:10px;color:var(--rc-text-dim,#9ca3af);letter-spacing:1px;margin-bottom:8px;">TWO-FACTOR AUTHENTICATION</div>',
      '                    <div id="r-2fa-status" style="font-size:11px;color:#9ca3af;margin-bottom:10px;"><i class="fa-solid fa-circle-notch fa-spin"></i> Checking…</div>',
      '                    <button id="btn-r-setup-2fa" onclick="rSetup2FA()" style="display:none;width:100%;padding:10px;background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.35);color:var(--rc-cyan,#06b6d4);border-radius:4px;cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;letter-spacing:0.5px;">ENABLE 2FA (TOTP)</button>',
      '                    <button id="btn-r-remove-2fa" onclick="rRemove2FA()" style="display:none;width:100%;padding:10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);color:#ef4444;border-radius:4px;cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;letter-spacing:0.5px;">DISABLE 2FA</button>',
      '                    <div id="r-2fa-enroll" style="display:none;margin-top:14px;text-align:center;">',
      '                        <div style="font-size:10px;color:#9ca3af;margin-bottom:10px;line-height:1.5;">Scan with <strong style="color:#fff">Google Authenticator</strong> or <strong style="color:#fff">Authy</strong>, then enter the 6-digit code below to confirm.</div>',
      '                        <img id="r-2fa-qr" src="" style="width:156px;height:156px;background:#fff;padding:8px;border-radius:6px;margin-bottom:10px;display:block;margin-left:auto;margin-right:auto;">',
      '                        <div style="font-size:9px;color:#6b7280;margin-bottom:6px;letter-spacing:0.5px;">OR ENTER KEY MANUALLY:</div>',
      '                        <code id="r-2fa-secret" style="font-size:11px;color:var(--rc-cyan,#06b6d4);background:rgba(0,0,0,0.35);padding:6px 10px;border-radius:3px;word-break:break-all;display:block;margin-bottom:14px;text-align:left;"></code>',
      '                        <input type="text" id="r-2fa-verify-code" placeholder="Enter 6-digit code" maxlength="6" inputmode="numeric"',
      '                          style="width:100%;box-sizing:border-box;padding:11px 12px;margin-bottom:8px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-family:inherit;font-size:16px;text-align:center;letter-spacing:6px;">',
      '                        <button onclick="rVerify2FA()" style="width:100%;padding:10px;background:rgba(6,182,212,0.12);border:1px solid rgba(6,182,212,0.35);color:var(--rc-cyan,#06b6d4);border-radius:4px;cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;margin-bottom:6px;">CONFIRM &amp; ACTIVATE</button>',
      '                        <button onclick="rCancel2FA()" style="width:100%;padding:8px;background:none;border:1px solid var(--rc-border,#374151);color:#6b7280;border-radius:4px;cursor:pointer;font-size:10px;font-family:inherit;">Cancel</button>',
      '                    </div>',
      '                </div>',
      '            </div>',
      '        </div>',
      '    </div>',

      '    <!-- SETTINGS GATEWAY MODAL -->',
      '    <div id="r-settings-modal" class="hidden" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.82);z-index:10001;display:flex;align-items:center;justify-content:center;">',
      '      <div style="background:var(--rc-bg,#111827);border:1px solid var(--rc-border,#374151);border-radius:8px;width:420px;max-width:95vw;box-shadow:0 10px 30px rgba(0,0,0,0.6);">',
      '        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--rc-border,#374151);">',
      '          <h3 style="margin:0;font-size:13px;color:var(--rc-cyan,#06b6d4);letter-spacing:1px;"><i class="fa-solid fa-sliders"></i> SETTINGS</h3>',
      '          <button id="btn-close-settings" style="background:none;border:none;color:var(--rc-text-dim,#9ca3af);cursor:pointer;font-size:16px;"><i class="fa-solid fa-xmark"></i></button>',
      '        </div>',
      '        <div style="padding:16px 20px;display:flex;flex-direction:column;gap:10px;">',
      '          <div onclick="window.rOpenAdminsFromSettings()" style="display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid var(--rc-border,#374151);border-radius:6px;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'#06b6d4\'" onmouseout="this.style.borderColor=\'var(--rc-border,#374151)\'">',
      '            <i class="fa-solid fa-users-gear" style="font-size:20px;color:var(--rc-cyan,#06b6d4);flex-shrink:0;"></i>',
      '            <div>',
      '              <div style="font-size:12px;color:var(--rc-text,#fff);font-weight:600;letter-spacing:0.5px;">MANAGE ADMINS</div>',
      '              <div style="font-size:10px;color:var(--rc-text-dim,#6b7280);margin-top:2px;">Manage admin console access &amp; permissions</div>',
      '            </div>',
      '            <i class="fa-solid fa-chevron-right" style="margin-left:auto;color:var(--rc-text-dim,#6b7280);font-size:11px;"></i>',
      '          </div>',
      '          <div onclick="window.rOpenAppUsersFromSettings()" style="display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid var(--rc-border,#374151);border-radius:6px;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'#06b6d4\'" onmouseout="this.style.borderColor=\'var(--rc-border,#374151)\'">',
      '            <i class="fa-solid fa-id-card-clip" style="font-size:20px;color:var(--rc-cyan,#06b6d4);flex-shrink:0;"></i>',
      '            <div>',
      '              <div style="font-size:12px;color:var(--rc-text,#fff);font-weight:600;letter-spacing:0.5px;">APP USERS</div>',
      '              <div style="font-size:10px;color:var(--rc-text-dim,#6b7280);margin-top:2px;">Manage access &amp; allowed apps for each Rasumi user</div>',
      '            </div>',
      '            <i class="fa-solid fa-chevron-right" style="margin-left:auto;color:var(--rc-text-dim,#6b7280);font-size:11px;"></i>',
      '          </div>',
      '        </div>',
      '      </div>',
      '    </div>',

      '    <!-- MANAGE ADMINS MODAL -->',
      '    <div id="r-admins-modal" class="hidden" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.82);z-index:10001;display:flex;align-items:center;justify-content:center;">',
      '      <div style="background:var(--rc-bg,#111827);border:1px solid var(--rc-border,#374151);border-radius:8px;width:500px;max-height:78vh;display:flex;flex-direction:column;box-shadow:0 10px 30px rgba(0,0,0,0.6);">',
      '        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--rc-border,#374151);flex-shrink:0;">',
      '          <h3 style="margin:0;font-size:13px;color:var(--rc-cyan,#06b6d4);letter-spacing:1px;"><i class="fa-solid fa-users-gear"></i> MANAGE ADMINS</h3>',
      '          <button id="btn-close-admins" style="background:none;border:none;color:var(--rc-text-dim,#9ca3af);cursor:pointer;font-size:16px;"><i class="fa-solid fa-xmark"></i></button>',
      '        </div>',
      '        <div style="padding:16px 20px;border-bottom:1px solid var(--rc-border,#374151);flex-shrink:0;">',
      '          <div style="font-size:10px;color:var(--rc-text-dim,#9ca3af);letter-spacing:1px;margin-bottom:8px;">ADD NEW ADMIN</div>',
      '          <div style="display:flex;gap:8px;margin-bottom:8px;">',
      '            <input id="r-admin-new-email" type="email" placeholder="admin@email.com" style="flex:1;padding:9px 12px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-size:12px;font-family:inherit;">',
      '            <input id="r-admin-new-nick" type="text" placeholder="Nickname" style="width:110px;padding:9px 12px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-size:12px;font-family:inherit;">',
      '          </div>',
      '          <div style="display:flex;gap:8px;align-items:center;">',
      '            <input id="r-admin-new-pass" type="password" placeholder="Password" style="flex:1;padding:9px 12px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-size:12px;font-family:inherit;">',
      '            <select id="r-admin-new-perm" onchange="rUpdatePermIndicator(this)" style="padding:9px 10px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-size:11px;font-family:inherit;cursor:pointer;">',
      '              <option value="read">Read</option>',
      '              <option value="write">Read &amp; Write</option>',
      '            </select>',
      '            <span id="r-admin-perm-tick" style="font-size:13px;color:#22c55e;display:inline;flex-shrink:0;">✓</span>',
      '            <button onclick="rAddAdmin()" style="padding:9px 16px;background:var(--rc-cyan,#06b6d4);color:#000;font-weight:700;border:none;border-radius:4px;cursor:pointer;font-size:11px;white-space:nowrap;">ADD</button>',
      '          </div>',
      '        </div>',
      '        <div id="r-admins-list" style="overflow-y:auto;padding:0 20px;flex:1;"></div>',
      '      </div>',
      '    </div>',

      '    <!-- HOSPITAL USERS MODAL -->',
      '    <div id="r-husers-modal" class="hidden" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.82);z-index:10001;display:flex;align-items:center;justify-content:center;">',
      '      <div style="background:var(--rc-bg,#111827);border:1px solid var(--rc-border,#374151);border-radius:8px;width:720px;max-width:95vw;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 10px 30px rgba(0,0,0,0.6);">',
      '        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--rc-border,#374151);flex-shrink:0;">',
      '          <h3 style="margin:0;font-size:13px;color:var(--rc-cyan,#06b6d4);letter-spacing:1px;"><i class="fa-solid fa-id-card-clip"></i> APP USERS</h3>',
      '          <button id="btn-close-husers" style="background:none;border:none;color:var(--rc-text-dim,#9ca3af);cursor:pointer;font-size:16px;"><i class="fa-solid fa-xmark"></i></button>',
      '        </div>',
      '        <div style="padding:12px 20px;border-bottom:1px solid var(--rc-border,#374151);flex-shrink:0;">',
      '          <div style="font-size:10px;color:var(--rc-text-dim,#9ca3af);letter-spacing:1px;margin-bottom:8px;">ADD NEW USER</div>',
      '          <div style="display:flex;gap:8px;align-items:center;">',
      '            <input id="r-huser-new-username" type="text" placeholder="Username / User ID" style="flex:1;padding:9px 12px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-size:12px;font-family:inherit;">',
      '            <select id="r-huser-new-role" style="padding:9px 10px;background:#1f2937;border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;font-size:11px;font-family:inherit;cursor:pointer;">',
      '              <option value="BRANCH_USER">BRANCH_USER</option>',
      '              <option value="ADMIN">ADMIN</option>',
      '              <option value="VIEWER">VIEWER</option>',
      '            </select>',
      '            <button onclick="rAddHospitalUser()" style="padding:9px 16px;background:var(--rc-cyan,#06b6d4);color:#000;font-weight:700;border:none;border-radius:4px;cursor:pointer;font-size:11px;white-space:nowrap;">ADD</button>',
      '          </div>',
      '          <div style="font-size:10px;color:var(--rc-text-dim,#6b7280);margin-top:6px;letter-spacing:0.3px;">Add new users ID.</div>',
      '        </div>',
      '        <div id="r-husers-list" style="overflow-y:auto;padding:0 20px;flex:1;"></div>',
      '      </div>',
      '    </div>',

      '<div id="r-toasts" class="r-toasts"></div>'
    ].join('\n');
    document.body.appendChild(el);

    // Close all nav dropdowns when clicking anywhere outside
    document.addEventListener('click', function() {
      var d = document.getElementById('r-nav-dropdown');
      var n = document.getElementById('notif-dropdown');
      if (d && !d.classList.contains('hidden')) d.classList.add('hidden');
      if (n && !n.classList.contains('hidden')) n.classList.add('hidden');
    });
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
      'Open <code>../sales report/rasumi.js</code> and fill in <code>RASUMI_FIREBASE_CONFIG</code> at the top of the file.<br><br>' +
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
    if (fbStatus) fbStatus.innerHTML = '<span style="color:var(--rc-orange);font-size:10px;padding:6px 14px;display:block"><i class="fa-solid fa-triangle-exclamation"></i> Config missing</span>';
  }

  // ── Enter / Exit ───────────────────────────────────────────
  window.enterRasumiMode = function() {
    injectHTML();
    
    // Attach profile modal and header button listeners to the newly injected HTML
    if(typeof window.initProfileHandlers === 'function') {
        window.initProfileHandlers();
    }

    var dc = document.getElementById('dashboard-container');
    if (dc) dc.classList.add('hidden');
    $r('rasumi-container').classList.remove('hidden');
    startClock();

    var ok = initRasumiFirebase();
    if (!ok) {
      showConfigBanner();
      return;
    }

    // Fasa 3: init Supabase client alongside Firebase
    initRasumiSupabase();

    var fbStatus = $r('r-fb-status');
    if (fbStatus) fbStatus.innerHTML = '<span style="color:var(--rc-green);font-size:10px;padding:6px 14px;display:block">Rasumi Apps <span class="r-live-blink">● LIVE</span></span>';

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
  function clearRListeners() { RS.listeners.forEach(function(u){ u(); }); RS.listeners = []; }

  // ── Role helpers ──────────────────────────────────────────────
  var _SUPER_ADMIN_EMAIL = 'musqhaishah@gmail.com';

  function _canWrite() { return RS.canWrite || RS.userRole === 'superadmin'; }

  function _applyRoleUI() {
    // Topbar name + role chips
    var tbName = document.querySelector('#r-profile-trigger .name');
    var tbRole = document.querySelector('#r-profile-trigger .role');
    if (tbName) tbName.textContent = RS.userRole === 'superadmin' ? 'SUPER ADMIN' : 'ADMIN';
    if (tbRole) tbRole.textContent = RS.userNickname || (RS.userRole === 'superadmin' ? 'Super Admin' : (_canWrite() ? 'Admin (Write)' : 'Admin (Read)'));
    // Show "Settings" only for super admin
    var settBtn = document.getElementById('r-menu-settings');
    if (settBtn) settBtn.style.display = RS.userRole === 'superadmin' ? '' : 'none';
    // Read-only banner
    var banner = document.getElementById('r-readonly-banner');
    if (!banner && !_canWrite()) {
      var nav = document.querySelector('.r-topbar');
      if (nav) {
        var b = document.createElement('div');
        b.id = 'r-readonly-banner';
        b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(239,68,68,0.12);border-top:1px solid rgba(239,68,68,0.4);color:#ef4444;font-size:10px;text-align:center;padding:4px;z-index:9998;letter-spacing:1px;';
        b.textContent = '⚠ READ-ONLY MODE — Contact Super Admin for write access';
        document.body.appendChild(b);
      }
    } else if (banner && _canWrite()) {
      banner.remove();
    }
  }

  function _syncProfileAvatar(email) {
    if (!RS.supa || !email) return;
    var isSA = (email.toLowerCase() === _SUPER_ADMIN_EMAIL);
    // Ensure row exists in Supabase admin_users
    RS.supa.from('admin_users').upsert(
      { email: email, role: isSA ? 'superadmin' : 'admin', can_write: isSA },
      { onConflict: 'email', ignoreDuplicates: true }
    ).then(function() {}).catch(function() {});
    // Fetch avatar once on login
    RS.supa.from('admin_users').select('profile_img,nickname').eq('email', email).single().then(function(res) {
      if (res.error || !res.data) return;
      if (res.data.profile_img) {
        var src = res.data.profile_img;
        var hImg = document.querySelector('#r-profile-trigger img');
        if (hImg) hImg.src = src;
        var sp = document.getElementById('r-avatar-spinner');
        if (!sp || sp.style.display === 'none') {
          var mImg = document.getElementById('r-profile-img-display');
          if (mImg) mImg.src = src;
        }
      }
      if (res.data.nickname) {
        RS.userNickname = res.data.nickname;
        var tbRole = document.querySelector('#r-profile-trigger .role');
        if (tbRole) tbRole.textContent = res.data.nickname;
      }
    }).catch(function() {});
  }

  // ── Admin Management (Super Admin only) ──────────────────────
  window.rAddAdmin = function() {
    var emailInp = document.getElementById('r-admin-new-email');
    var nickInp  = document.getElementById('r-admin-new-nick');
    var passInp  = document.getElementById('r-admin-new-pass');
    var permSel  = document.getElementById('r-admin-new-perm');
    var email    = (emailInp ? emailInp.value.trim().toLowerCase() : '');
    var password = (passInp  ? passInp.value.trim() : '');
    var nickname = (nickInp  ? nickInp.value.trim() : '');
    if (!email || !email.includes('@')) { rToast('Enter valid email', 'warn'); return; }
    if (email === _SUPER_ADMIN_EMAIL)   { rToast('Super admin already exists', 'warn'); return; }
    if (!password)                      { rToast('Password is required', 'warn'); return; }
    if (!RS.supa)                       { rToast('Supabase not available', 'error'); return; }

    var canWrite = permSel ? permSel.value === 'write' : false;
    var addedBy  = RS.currentUser ? RS.currentUser.email : '';

    rToast('Creating account…', 'info');

    // Save current session before signUp (in case Supabase email confirm is OFF — restores superadmin session)
    var _savedToken = null;
    RS.supa.auth.getSession().then(function(sr) {
      if (sr.data && sr.data.session) {
        _savedToken = { access: sr.data.session.access_token, refresh: sr.data.session.refresh_token };
      }
      // Step 1: Create Supabase Auth account
      return RS.supa.auth.signUp({ email: email, password: password });
    })
    .then(function(r) {
      // "User already registered" is OK — just update the Supabase record
      if (r.error && r.error.message && !r.error.message.toLowerCase().includes('already registered')) {
        throw new Error(r.error.message);
      }
      // If signUp signed us in (email confirm disabled), restore superadmin session
      return RS.supa.auth.getSession().then(function(sr2) {
        var nowEmail = sr2.data && sr2.data.session && sr2.data.session.user ? sr2.data.session.user.email : null;
        if (nowEmail && nowEmail !== addedBy && _savedToken) {
          return RS.supa.auth.setSession({ access_token: _savedToken.access, refresh_token: _savedToken.refresh });
        }
      });
    })
    .then(function() {
      // Step 2: Save to Supabase admin_users
      return RS.supa.from('admin_users').upsert({
        email:     email,
        nickname:  nickname || null,
        role:      'admin',
        can_write: canWrite,
        is_active: true,
        added_at:  new Date().toISOString(),
        added_by:  addedBy
      }, { onConflict: 'email' });
    })
    .then(function(res) {
      if (res.error) throw new Error(res.error.message);
      rToast('Admin added: ' + email, 'success');
      if (emailInp) emailInp.value = '';
      if (nickInp)  nickInp.value  = '';
      if (passInp)  passInp.value  = '';
      if (permSel)  { permSel.value = 'read'; rUpdatePermIndicator(permSel); }
      _loadAdminUsers();
    })
    .catch(function(e) { rToast('Error: ' + e.message, 'error'); });
  };

  window.rRemoveAdmin = function(email) {
    if (!RS.supa) { rToast('Supabase not available', 'error'); return; }
    RS.supa.from('admin_users').delete().eq('email', email).then(function(res) {
      if (res.error) throw new Error(res.error.message);
      rToast('Removed: ' + email, 'success');
      _loadAdminUsers();
    }).catch(function(e) { rToast('Error: ' + e.message, 'error'); });
  };

  window.rToggleAdminPw = function(inputId) {
    var inp = document.getElementById(inputId);
    if (!inp) return;
    var btn = inp.nextElementSibling;
    if (inp.type === 'password') {
      inp.type = 'text';
      if (btn) btn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
    } else {
      inp.type = 'password';
      if (btn) btn.innerHTML = '<i class="fa-solid fa-eye"></i>';
    }
  };

  // rUpdateAdminPassword removed — passwords managed via Supabase Auth only (reset email flow)
  window.rUpdateAdminPassword = function() {};

  window.rSendAdminResetEmail = function(email) {
    if (!RS.supa) { rToast('Supabase not available', 'error'); return; }
    // redirectTo: main login page of admin console (works for http:// deployments)
    var _base = (window.location.href || '').replace(/rasumi apps[\/\\].*$/, '');
    var redirectTo = _base ? _base + 'index.html' : window.location.origin;
    RS.supa.auth.resetPasswordForEmail(email, { redirectTo: redirectTo })
      .then(function(r) {
        if (r.error) throw r.error;
        rToast('Reset email sent to: ' + email, 'success');
      })
      .catch(function(err) { rToast('Error: ' + ((err && err.message) || String(err)), 'error'); });
  };

  // ── Permission indicator helpers ────────────────────────────────
  window.rUpdatePermIndicator = function(sel) {
    var tick = document.getElementById('r-admin-perm-tick');
    if (tick) tick.style.display = (sel.value === 'read') ? 'inline' : 'none';
  };

  window.rUpdateListPermIndicator = function(sel) {
    var permId = sel.id;
    var tick   = document.getElementById('tick_' + permId);
    if (tick) tick.style.display = (sel.value === 'read') ? 'inline' : 'none';
  };

  window.rToggleAdminWrite = function(email, val) {
    if (!RS.supa) return;
    RS.supa.from('admin_users').update({ can_write: val }).eq('email', email).then(function(res) {
      if (res.error) throw new Error(res.error.message);
      rToast((val ? 'Write enabled' : 'Write disabled') + ': ' + email, 'success');
    }).catch(function(e) { rToast('Error: ' + e.message, 'error'); });
  };

  function _loadAdminUsers() {
    var list = document.getElementById('r-admins-list');
    if (!list || !RS.supa) return;
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--rc-text-dim,#9ca3af);font-size:12px;"><span class="r-spin"></span> Loading…</div>';
    RS.supa.from('admin_users').select('email,role,can_write,nickname').order('email').then(function(res) {
      if (res.error) throw new Error(res.error.message);
      var rows = [];
      if (!res.data || !res.data.length) { list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--rc-text-dim,#9ca3af);font-size:12px;">No admin users</div>'; return; }
      res.data.forEach(function(d) {
        var em     = d.email;
        var isSA   = (em.toLowerCase() === _SUPER_ADMIN_EMAIL);
        var canW   = d.can_write === true;
        var pw     = d.password || '';
        var nick   = d.nickname || '';
        var pwId   = 'apw_' + em.replace(/[^a-z0-9]/gi, '_');
        var permId = 'prm_' + em.replace(/[^a-z0-9]/gi, '_');
        var safeEm = em.replace(/'/g, "\\'");

        var row = '<div style="padding:12px 0;border-bottom:1px solid var(--rc-border,#1f2937);">';
        // Line 1: email + nickname + role + controls
        row += '<div style="display:flex;align-items:center;justify-content:space-between;">';
        row += '<div>';
        row += '<div style="font-size:12px;color:var(--rc-text,#fff);">' + esc(em) + (nick ? ' <span style="font-size:10px;color:var(--rc-cyan,#06b6d4);">(' + esc(nick) + ')</span>' : '') + '</div>';
        row += '<div style="font-size:10px;color:var(--rc-text-dim,#6b7280);margin-top:2px;">' + (isSA ? 'SUPER ADMIN' : (canW ? 'ADMIN · Read & Write' : 'ADMIN · Read')) + '</div>';
        row += '</div>';
        if (isSA) {
          row += '<span style="font-size:10px;color:var(--rc-cyan,#06b6d4);padding:3px 8px;border:1px solid rgba(0,240,255,0.3);border-radius:10px;">Owner</span>';
        } else {
          row += '<div style="display:flex;gap:10px;align-items:center;">';
          row += '<select id="' + permId + '" onchange="rToggleAdminWrite(\'' + safeEm + '\',this.value===\'write\');rUpdateListPermIndicator(this)" style="padding:5px 8px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;font-size:11px;font-family:inherit;cursor:pointer;">';
          row += '<option value="read"' + (!canW ? ' selected' : '') + '>Read</option>';
          row += '<option value="write"' + (canW ? ' selected' : '') + '>Read &amp; Write</option>';
          row += '</select>';
          row += '<span style="font-size:13px;color:#22c55e;' + (canW ? 'display:none' : 'display:inline') + ';" id="tick_' + permId + '">✓</span>';
          row += '<button onclick="rSendAdminResetEmail(\'' + safeEm + '\')" title="Send reset email" style="background:none;border:1px solid rgba(6,182,212,0.4);color:var(--rc-cyan,#06b6d4);padding:3px 8px;border-radius:4px;font-size:10px;cursor:pointer;font-family:inherit;"><i class="fa-solid fa-envelope-circle-check"></i></button>';
          row += '<button onclick="rRemoveAdmin(\'' + safeEm + '\')" style="background:none;border:1px solid rgba(239,68,68,0.5);color:#ef4444;padding:3px 10px;border-radius:4px;font-size:10px;cursor:pointer;font-family:inherit;">Remove</button>';
          row += '</div>';
        }
        row += '</div>';
        // Password managed via Supabase Auth reset email only (no plaintext stored)
        if (!isSA) {
          row += '<div style="margin-top:6px;font-size:10px;color:var(--rc-text-dim,#6b7280);">';
          row += '<i class="fa-solid fa-lock" style="margin-right:4px;"></i>Password managed via Supabase Auth — use <strong>Send Reset</strong> to change.';
          row += '</div>';
        }
        row += '</div>';
        rows.push(row);
      });
      list.innerHTML = rows.join('');
    }).catch(function(e) {
      list.innerHTML = '<div style="padding:20px;color:#ef4444;font-size:12px;">Error: ' + esc(e.message) + '</div>';
    });
  }


  function updateFleetBadges() {
    var devs = Object.values(RS.devices);
    var on  = devs.filter(function(d){ return d._status === 'online';  }).length;
    var st  = devs.filter(function(d){ return d._status === 'stale';   }).length;
    var off = devs.filter(function(d){ return d._status === 'offline'; }).length;
    var el;
    // New chip elements in topbar
    el = $r('r-chip-on');  if (el) el.textContent = on  + ' ONLINE';
    el = $r('r-chip-st');  if (el) el.textContent = st  + ' STALE';
    el = $r('r-chip-off'); if (el) el.textContent = off + ' OFFLINE';
    // Update side panel + dashboard telemetry
    updateSideNodeList();
    updateDashTelemetry();
  }

  function startGlobalListeners() {
    clearRListeners();

    // ── User Auth, Role & Write Permission (Supabase Auth) ──────────
    var _SUPER_ADMIN = 'musqhaishah@gmail.com';
    if (RS.supa) {
        var _authResult = RS.supa.auth.onAuthStateChange(function(event, session) {
            var user = session ? session.user : null;
            if (!user || !user.email) { RS.currentUser = null; return; }
            RS.currentUser = user;
            var email = user.email.toLowerCase();
            var isSA  = (email === _SUPER_ADMIN);

            if (isSA) {
                // Super admin — always allowed, full write
                RS.userRole = 'superadmin';
                RS.canWrite = true;
                _applyRoleUI();
                _syncProfileAvatar(user.email);
                // Update last_login for super admin
                RS.supa.from('admin_users').update({
                    last_login:  new Date().toISOString(),
                    last_active: new Date().toISOString(),
                    is_active:   true
                }).eq('email', email).then(function(){}).catch(function(){});
            } else {
                // Check Supabase admin_users — dynamic whitelist
                RS.supa.from('admin_users').select('email,role,can_write,nickname,pending_email')
                    .or('email.eq.' + user.email + ',pending_email.eq.' + user.email)
                    .single().then(function(res) {
                    if (res.error || !res.data) {
                        // Not in admin_users — kick out
                        RS.supa.auth.signOut();
                        window.location.href = '../index.html';
                        return;
                    }
                    // Resolve pending_email — email confirmed, update the row
                    if (res.data.pending_email === user.email) {
                        RS.supa.from('admin_users')
                            .update({ email: user.email, pending_email: null })
                            .eq('pending_email', user.email)
                            .then(function(){}).catch(function(){});
                    }
                    var dbRole = res.data.role || 'admin';
                    RS.userRole = dbRole;
                    RS.canWrite = dbRole === 'superadmin' || res.data.can_write === true;
                    RS.userNickname = res.data.nickname || '';
                    _applyRoleUI();
                    _syncProfileAvatar(user.email);
                    // Update last_login for this admin
                    RS.supa.from('admin_users').update({
                        last_login:  new Date().toISOString(),
                        last_active: new Date().toISOString(),
                        is_active:   true
                    }).eq('email', user.email).then(function(){}).catch(function(){});
                }).catch(function() {
                    RS.supa.auth.signOut();
                    window.location.href = '../index.html';
                });
            }
        });
        addL(function() { _authResult.data.subscription.unsubscribe(); });
    }

    // ── machine_status — Supabase Realtime + Firebase bridge for v9.3 ──────────
    // Primary: Supabase (v9.4+ machines with dual-write).
    // Bridge: Firebase onSnapshot fills in v9.3 machines that don't dual-write yet.
    // Supabase always wins on conflict (same hostname in both).
    if (RS.supa) {
      // Normalize Supabase column names → field names expected by renderDevices/renderDashboard
      function _normSupa(d) {
        d.id      = d.hostname;
        d._source = 'supa';
        // app_version → version
        if (d.app_version  !== undefined && d.version    === undefined) d.version    = d.app_version;
        // cpu/ram/disk pct
        if (d.cpu_usage_pct  !== undefined && d.cpu_pct  === undefined) d.cpu_pct   = d.cpu_usage_pct;
        if (d.ram_usage_pct  !== undefined && d.ram_pct  === undefined) d.ram_pct   = d.ram_usage_pct;
        if (d.disk_usage_pct !== undefined && d.disk_pct === undefined) d.disk_pct  = d.disk_usage_pct;
        // ram MB → GB (1 d.p.)
        if (d.ram_used_mb  !== undefined && d.ram_used_gb  === undefined) d.ram_used_gb  = Math.round(d.ram_used_mb  / 1024 * 10) / 10;
        if (d.ram_total_mb !== undefined && d.ram_total_gb === undefined) d.ram_total_gb = Math.round(d.ram_total_mb / 1024 * 10) / 10;
        d._status = deviceStatus(d);
        return d;
      }

      // Initial full fetch from Supabase
      RS.supa.from('machine_status').select('*').then(function(res) {
        if (res.error) { console.warn('[Supa] machine_status fetch:', res.error.message); }
        RS.devices = {};
        (res.data || []).forEach(function(d) { RS.devices[d.hostname] = _normSupa(d); });
        updateFleetBadges();
        if (RS.route === 'r-dashboard') renderDashboard();
        if (RS.route === 'r-devices')   renderDevices();
        if (RS.route === 'r-alerts')    renderAlerts();

        // Firebase bridge: covers v9.3 machines that don't dual-write to Supabase.
        // Compares timestamps — whichever source is more recent wins.
        // Once a machine upgrades to v9.4 and writes to Supabase, Supabase naturally wins.
        if (RS.db) {
          addL(RS.db.collection('machine_status').onSnapshot(function(snap) {
            snap.forEach(function(doc) {
              var fbData = doc.data();
              var fbTs   = fbData.last_heartbeat;
              // Firestore SERVER_TIMESTAMP comes back as a Timestamp object
              var fbDate = fbTs ? (fbTs.toDate ? fbTs.toDate()
                                               : new Date(fbTs.seconds ? fbTs.seconds * 1000 : fbTs))
                                : null;
              var existing = RS.devices[doc.id];
              if (existing && existing._source === 'supa') {
                // Only override Supabase entry if Firebase has a NEWER timestamp
                var supTs   = existing.last_heartbeat;
                var supDate = supTs ? new Date(supTs) : null;
                if (!fbDate || (supDate && fbDate <= supDate)) return; // Supabase is fresher
              }
              var d = Object.assign({ id: doc.id, _source: 'firebase' }, fbData);
              d._status = deviceStatus(d);
              RS.devices[doc.id] = d;
            });
            updateFleetBadges();
            if (RS.route === 'r-dashboard') renderDashboard();
            if (RS.route === 'r-devices')   renderDevices();
            if (RS.route === 'r-alerts')    renderAlerts();
          }, function(err) {
            console.warn('[Rasumi] Firebase machine_status bridge error:', err.message);
          }));
        }
      });

      // Realtime: fires only on change — no read cost between updates
      var supaChannel = RS.supa.channel('supa-machine-status')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'machine_status' },
          function(payload) {
            var d = Object.assign({}, payload.new || payload.old || {});
            if (!d.hostname) return;
            // Merge with cached entry — without REPLICA IDENTITY FULL, UPDATE events
            // only include the primary key in payload.new, so we must preserve existing fields.
            var existing = RS.devices[d.hostname] || {};
            RS.devices[d.hostname] = _normSupa(Object.assign({}, existing, d));
            updateFleetBadges();
            if (RS.route === 'r-dashboard') renderDashboard();
            if (RS.route === 'r-devices')   renderDevices();
            if (RS.route === 'r-alerts')    renderAlerts();
          }
        ).subscribe(function(status) {
          if (status === 'SUBSCRIBED') {
            var fbStatus = document.getElementById('r-fb-status');
            if (fbStatus) fbStatus.innerHTML =
              '<span style="color:var(--rc-green);font-size:10px;padding:6px 14px;display:block">' +
              'Rasumi Apps <span class="r-live-blink">● LIVE</span></span>';
          }
        });

      addL(function() { if (RS.supa) RS.supa.removeChannel(supaChannel); });

    } else {
      // Fallback: Firebase onSnapshot only (no Supabase connection)
      addL(RS.db.collection('machine_status').onSnapshot(function(snap) {
        RS.devices = {};
        snap.forEach(function(doc) {
          var d = Object.assign({ id: doc.id }, doc.data());
          d._status = deviceStatus(d);
          RS.devices[doc.id] = d;
        });
        updateFleetBadges();
        if (RS.route === 'r-dashboard') renderDashboard();
        if (RS.route === 'r-devices')   renderDevices();
        if (RS.route === 'r-alerts')    renderAlerts();
      }, function(err) {
        console.warn('[Rasumi] machine_status listener error:', err.message);
      }));
    }

    // ── Badge counts — Supabase (Fasa 6) ─────────────────────────────
    // Switched from Firebase collectionGroup polling → Supabase SELECT COUNT.
    // Zero Firestore reads per poll cycle.
    function _pollBadgeCounts() {
      if (document.visibilityState !== 'visible') return;
      if (!RS.supa) return; // no Supabase yet

      RS.supa.from('vibes_errors').select('id', { count: 'exact', head: true })
        .eq('resolved', false).limit(51)
        .then(function(res) {
          var cnt = Math.min(res.count || 0, 51);
          RS.unresolvedVibes = cnt;
          var nb = $r('r-nb-vibes');
          var display = cnt > 50 ? '50+' : (cnt || '');
          if (nb) { nb.textContent = display; nb.style.display = cnt ? '' : 'none'; }
          updateAlertBadge();
          if (RS.route === 'r-dashboard') renderDashboard();
          if (RS.route === 'r-alerts')    renderAlerts();
        }).catch(function() {});

      RS.supa.from('renamer_docs').select('id', { count: 'exact', head: true })
        .in('status', ['wrong_read', 'failed', 'skipped']).limit(51)
        .then(function(res) {
          var cnt = Math.min(res.count || 0, 51);
          RS.unresolvedRenamer = cnt;
          var nb = $r('r-nb-renamer');
          var display = cnt > 50 ? '50+' : (cnt || '');
          if (nb) { nb.textContent = display; nb.style.display = cnt ? '' : 'none'; }
          updateAlertBadge();
        }).catch(function() {});

      RS.supa.from('vims_results').select('id', { count: 'exact', head: true })
        .eq('status', 'skipped').limit(51)
        .then(function(res) {
          var cnt = Math.min(res.count || 0, 51);
          RS.unresolvedVims = cnt;
          var nb = $r('r-nb-vims');
          var display = cnt > 50 ? '50+' : (cnt || '');
          if (nb) { nb.textContent = display; nb.style.display = cnt ? '' : 'none'; }
          updateAlertBadge();
        }).catch(function() {});

      RS.supa.from('app_errors').select('id', { count: 'exact', head: true })
        .eq('fix_status', 'unfixed').limit(51)
        .then(function(res) {
          var cnt = Math.min(res.count || 0, 51);
          RS.unresolvedAppErrors = cnt;
          updateAlertBadge();
          if (RS.route === 'r-alerts') renderAlerts();
        }).catch(function() {});
    }
    _pollBadgeCounts(); // immediate first load
    RS._badgePollTimer = setInterval(_pollBadgeCounts, 5 * 60 * 1000); // every 5 min
    document.addEventListener('visibilitychange', _pollBadgeCounts);   // refresh on tab focus
    addL(function() {
      if (RS._badgePollTimer) { clearInterval(RS._badgePollTimer); RS._badgePollTimer = null; }
      document.removeEventListener('visibilitychange', _pollBadgeCounts);
    });

    // ── Periodic app stats refresh (every 60s) ──
    loadAppStats();
    RS._appStatsInterval = setInterval(loadAppStats, 60000);

    // ── Seed recent logs for activity feed (Supabase, Fasa 6) ──
    if (RS.supa) {
      RS.supa.from('logs').select('*').order('timestamp', { ascending: false }).limit(30)
        .then(function(res) { RS._recentLogs = res.data || []; }).catch(function() {});
    }
  }

  function updateAlertBadge() {
    var tot = RS.unresolvedVibes + RS.unresolvedRenamer + RS.unresolvedVims + RS.unresolvedAppErrors;
    var na = $r('r-nb-alerts');
    if (na) { na.textContent = tot || ''; na.style.display = tot ? '' : 'none'; }
  }

  // ── Client-side sort helper ───────────────────────────────
  function sortByTs(docs, field) {
    field = field || 'timestamp';
    return docs.slice().sort(function(a, b) {
      var ta = a[field]; var tb = b[field];
      var da = ta ? (ta.toDate ? ta.toDate() : new Date(ta.seconds ? ta.seconds * 1000 : ta)) : new Date(0);
      var db2= tb ? (tb.toDate ? tb.toDate() : new Date(tb.seconds ? tb.seconds * 1000 : tb)) : new Date(0);
      return db2 - da; // desc
    });
  }

  // ── App Stats (Supabase, Fasa 6) ─────────────────────────
  function loadAppStats() {
    if (!RS.supa) return;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayIso = today.toISOString();

    var pending = RASUMI_APPS.length;
    RASUMI_APPS.forEach(function(app) {
      var names = app.firebaseNames;
      RS.supa.from('logs').select('*')
        .in('app_name', names)
        .order('timestamp', { ascending: false })
        .limit(200)
        .then(function(res) {
          var data = res.data || [];
          var todayCnt = 0, errCnt = 0, lastTs = null;
          data.forEach(function(d) {
            var ts = d.timestamp;
            if (!lastTs) lastTs = ts;
            if (ts && ts >= todayIso) todayCnt++;
            var st = (d.status || '').toUpperCase();
            if (st === 'FAILED' || st === 'ERROR') errCnt++;
          });
          RS.appStats[app.key] = { today: todayCnt, errors: errCnt, last_ts: lastTs };
          pending--;
          if (pending === 0 && RS.route === 'r-dashboard') renderDashboard();
        }).catch(function() { pending--; });
    });
  }

  // ── Router ─────────────────────────────────────────────────
  var LABELS = {
    'r-dashboard': 'Dashboard',
    'r-devices':   'Device Fleet',
    'r-renamer':    'Renamer HQ Trace',
    'r-renamer-fv': 'Renamer FV Logs',
    'r-splitter':   'PDF Splitter Logs',
    'r-studio':     'PDF Studio Logs',
    'r-quick':      'Quick Rename Logs',
    'r-scanify':    'Scanify Logs',
    'r-vibes':      'VIBES Monitor',
    'r-vims':       'VIMS Scrape',
    'r-logs':       'Log Explorer',
    'r-commands':   'Commands',
    'r-alerts':     'Alerts',
    'r-release':    'Release Management'
  };

  window.rNav = function (route) {
    RS.route = route;
    // Update horizontal nav active state
    qra('.r-hn-item').forEach(function(el){ el.classList.remove('active'); });
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
      case 'r-dashboard': renderDashboard();  break;
      case 'r-devices':   renderDevices();    break;
      case 'r-renamer':    renderRenamer();                                                    break;
      case 'r-renamer-fv': renderAppLogs('FV Branch',   'Renamer FV',   'fa-file-invoice'); break;
      case 'r-splitter':   renderAppLogs('PDF Splitter', 'PDF Splitter', 'fa-scissors');    break;
      case 'r-studio':     renderAppLogs('PDF Studio',   'PDF Studio',   'fa-file-pdf');    break;
      case 'r-quick':      renderAppLogs('Quick Rename', 'Quick Rename', 'fa-bolt');        break;
      case 'r-scanify':    renderAppLogs('Scanify',      'Scanify',      'fa-camera');      break;
      case 'r-vibes':      renderVibes();                                                    break;
      case 'r-vims':       renderVims();                                                     break;
      case 'r-logs':      renderLogs();       break;
      case 'r-commands':  renderCommands();      break;
      case 'r-alerts':    renderAlerts();        break;
      case 'r-release':   renderReleaseMgmt();   break;
    }
  };

  // ── Global Search ──────────────────────────────────────────
  window.rGlobalSearch = function(q) {
    if (!q || q.length < 2) return;
    var lq = q.toLowerCase();
    var matches = Object.keys(RS.devices).filter(function(h){ return h.toLowerCase().indexOf(lq) !== -1; });
    if (matches.length === 1) { rNav('r-device:' + matches[0]); }
    else if (matches.length > 1) { rNav('r-devices'); }
  };

  // ── DASHBOARD ──────────────────────────────────────────────
  function renderDashboard() {
    var devs = Object.values(RS.devices);
    var on   = devs.filter(function(d){ return d._status === 'online';  }).length;
    var st   = devs.filter(function(d){ return d._status === 'stale';   }).length;
    var off  = devs.filter(function(d){ return d._status === 'offline'; }).length;

    // Compute today's stats from appStats
    var runsToday = 0, errToday = 0, slaToday = 0;
    Object.values(RS.appStats).forEach(function(s){ runsToday += (s.today||0); errToday += (s.errors||0); });

    // Last sync from most recently active device
    var lastSync = '—';
    var allDevs = devs.slice().sort(function(a,b){
      var ta = a.last_heartbeat || a.last_seen;
      var tb = b.last_heartbeat || b.last_seen;
      var da = ta ? (ta.toDate ? ta.toDate() : new Date(ta.seconds ? ta.seconds*1000 : ta)) : new Date(0);
      var db2= tb ? (tb.toDate ? tb.toDate() : new Date(tb.seconds ? tb.seconds*1000 : tb)) : new Date(0);
      return db2 - da;
    });
    if (allDevs.length) lastSync = fmtElapsed(allDevs[0].last_heartbeat || allDevs[0].last_seen);

    // ── Row 1: Metric cards ──
    var metricRow =
      '<div class="r-metric-row">' +
        metricCard('green',  on,         'TOTAL ACTIVE NODES', 'fa-circle-check',       'Online now',              'r-devices') +
        metricCard('danger', off,        'OFFLINE NODES',      'fa-circle-xmark',       off > 0 ? off + ' need attention' : 'All clear', 'r-devices') +
        metricCard('info',   runsToday,  'RUNS TODAY',         'fa-play-circle',        'Across all apps',         'r-logs') +
        metricCard('warn',   errToday,   'FAILED TODAY',       'fa-bug',                'Check log explorer',      'r-alerts') +
        metricCard('purple', RS.unresolvedVibes, 'VIBES ERRORS','fa-triangle-exclamation', 'Unresolved',          'r-vibes') +
        metricCard('blue',   devs.length,'MACHINES TOTAL',     'fa-server',             'Last sync: ' + lastSync, 'r-devices') +
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
    var appOvHTML = '<div class="r-app-list">' + RASUMI_APPS.map(function(app) {
      var stats = RS.appStats[app.key] || {};
      return '<div class="r-app-row" onclick="rNav(\'r-logs\')">' +
        '<i class="fa-solid ' + app.icon + ' r-app-ico"></i>' +
        '<span class="r-app-name">' + app.label + '</span>' +
        '<span class="r-app-cnt">Today: ' + (stats.today||0) + '</span>' +
        ((stats.errors||0) > 0 ? '<span class="r-app-err">' + stats.errors + ' err</span>' : '') +
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
  function metricCard(cls, val, lbl, icon, sub, route) {
    var click  = route ? ' onclick="rNav(\'' + route + '\')"' : '';
    var cursor = route ? ' r-metric-card-link' : '';
    return '<div class="r-metric-card ' + cls + cursor + '"' + click + '>' +
      '<div class="r-metric-label">' + lbl + '</div>' +
      '<div class="r-metric-val">' + val + '</div>' +
      '<div class="r-metric-sub">' + (sub||'') + '</div>' +
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
  window.rSelectNode = function(hostname) {
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
      ['STATUS',    '<span class="r-badge ' + ({online:'r-badge-ok',stale:'r-badge-warn',offline:'r-badge-err'}[d._status]||'r-badge-muted') + '">' + d._status.toUpperCase() + '</span>'],
      ['HOSTNAME',  '<span class="r-font-mono">' + esc(d.id||d.hostname||'—') + '</span>'],
      ['OS',        esc(d.os_name || d.sys_info || '—')],
      ['CURRENT JOB', esc(d.current_job || 'IDLE')],
      ['PENDING',   (d.pending_files !== undefined ? d.pending_files : '—') + ' files'],
      ['VERSION',   esc(d.version || '—')],
      ['UPTIME',    esc(d.uptime || '—')],
      ['HEARTBEAT', fmtTs(d.last_heartbeat || d.last_seen)]
    ];
    var rowsHTML = rows.map(function(r){
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

  window.rSendTeleCmd = function(hostname, cmd) {
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    var user = RS.currentUser;
    RS.supa.from('commands').insert({
      target_machine: hostname, type: cmd, status: 'PENDING',
      created_at: new Date().toISOString(),
      created_by: user ? user.email : 'admin'
    }).then(function(){ rToast(cmd + ' sent to ' + hostname, 'success'); })
      .catch(function(e){ rToast('Error: ' + e.message, 'error'); });
  };

  // ── Build Health Bars HTML ─────────────────────────────────
  function buildHealthHTML(d) {
    if (!d) return '<div class="r-tele-empty" style="height:120px"><i class="fa-solid fa-heart-pulse"></i>Select a node to see health</div>';
    var cpu  = d.cpu_pct  !== undefined ? d.cpu_pct  : null;
    var ram  = d.ram_pct  !== undefined ? d.ram_pct  : null;
    var disk = d.disk_pct !== undefined ? d.disk_pct : null;
    var lat  = d.net_latency_ms !== undefined ? d.net_latency_ms : null;
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
    return bar(cpu,  'cpu',  'CPU',  '') +
           bar(ram,  'ram',  'RAM',  ramGB) +
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
        '<div class="r-st-header"><span class="r-st-label">' + label + '</span><span class="r-st-nums">' + (nums||'') + '</span></div>' +
        '<div class="r-st-track"><div class="r-st-fill ' + cls + '" style="width:' + p + '%"></div></div>' +
        '</div>';
    }
    var cpu  = d.cpu_pct;
    var ram  = d.ram_pct;
    var disk = d.disk_pct;
    var ramNums  = (d.ram_used_gb  !== undefined && d.ram_total_gb)  ? d.ram_used_gb  + '/' + d.ram_total_gb  + ' GB' : (cpu !== undefined ? cpu + '%' : 'N/A');
    var diskNums = (d.disk_used_gb !== undefined && d.disk_total_gb) ? d.disk_used_gb + '/' + d.disk_total_gb + ' GB' : (disk !== undefined ? disk + '%' : 'N/A');
    var latMs = d.net_latency_ms !== undefined ? d.net_latency_ms : null;
    var latPct = latMs !== null ? Math.min(100, latMs / 2) : 0; // 200ms = 100%
    return stBar(cpu,  'cpu-fill',  'CPU',     cpu  !== undefined ? cpu  + '%' : 'N/A') +
           stBar(ram,  'ram-fill',  'MEMORY',  ramNums) +
           stBar(disk, 'disk-fill', 'DISK C:', diskNums) +
           stBar(latPct, 'net-fill','LATENCY', latMs !== null ? latMs + 'ms' : 'N/A') +
      '<div class="r-tele-row"><span class="r-tele-key">OS</span><span class="r-tele-val">' + esc(d.os_name||d.sys_info||'—') + '</span></div>';
  }

  // ── Build Recent Activity HTML ────────────────────────────
  function buildRecentActHTML() {
    if (!RS._recentLogs.length) {
      return '<div class="r-act-feed"><div class="r-empty" style="padding:16px">No recent logs</div></div>';
    }
    return '<div class="r-act-feed">' + RS._recentLogs.slice(0,12).map(function(e) {
      var rawStatus = e.status || '';
      var isMsg     = rawStatus.length > 30;
      var stCode    = isMsg ? 'DEBUG' : (rawStatus.toUpperCase() || 'INFO');
      var isFail    = stCode === 'FAILED';
      var icon      = isFail ? 'fa-circle-xmark' : (stCode==='COMPLETED' ? 'fa-circle-check' : 'fa-circle-info');
      var fileDetail= e.file_name || e.activity_name || e.details || '—';
      return '<div class="r-act-item">' +
        '<i class="fa-solid ' + icon + ' r-act-icon" style="color:' + (isFail ? 'var(--rc-red)' : stCode==='COMPLETED' ? 'var(--rc-green)' : 'var(--rc-cyan)') + '"></i>' +
        '<div class="r-act-body">' +
          '<div class="r-act-title">' + esc(e.app_name||'?') + ' · ' + esc(fileDetail) + '</div>' +
          '<div class="r-act-meta">' + esc(e.machine||'') + ' · ' + fmtElapsed(e.timestamp||e.created_at) + '</div>' +
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
    // Sort: online → stale → offline.
    // Within offline: most recently seen first; tie-break by version desc (oldest/lowest version sinks to bottom).
    var _statusOrder = { online: 0, stale: 1, offline: 2 };
    var _parseVer = function(d) { var v = d.version || d.app_version; return v ? parseFloat(v) : 0; };
    var _tsMs = function(d) {
      var ts = d.last_heartbeat || d.last_seen;
      if (!ts) return 0;
      if (ts.toDate) return ts.toDate().getTime();
      if (ts.seconds) return ts.seconds * 1000;
      return new Date(ts).getTime();
    };
    devs.sort(function(a, b) {
      var sa = _statusOrder[a._status] !== undefined ? _statusOrder[a._status] : 2;
      var sb = _statusOrder[b._status] !== undefined ? _statusOrder[b._status] : 2;
      if (sa !== sb) return sa - sb;
      // Same status tier: more recently seen first
      var ta = _tsMs(a), tb = _tsMs(b);
      if (ta !== tb) return tb - ta;
      // Same timestamp: higher version first (lower version sinks to bottom)
      return _parseVer(b) - _parseVer(a);
    });
    panel.innerHTML = devs.map(function(d) {
      return '<div class="r-node-card' + (d.id===selId?' active':'') + '" onclick="rSelectNode(\'' + esc(d.id) + '\')">' +
        '<span class="r-nc-dot ' + d._status + '"></span>' +
        '<div class="r-nc-info">' +
          '<div class="r-nc-host">' + esc(d.id) + '</div>' +
          '<div class="r-nc-time">' + fmtElapsed(d.last_heartbeat||d.last_seen) + '</div>' +
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
    var tb = $r('r-tele-body');   if (tb) tb.innerHTML = buildTelemetryHTML(d);
    var hb = $r('r-health-body'); if (hb) hb.innerHTML = buildHealthHTML(d);
  }

  // ── Dashboard command history (Supabase, Fasa 6) ────────────
  function loadDashCmdHist() {
    var box = $r('r-cmd-hist-dash');
    if (!box || !RS.supa) return;
    RS.supa.from('commands').select('*').order('created_at', { ascending: false }).limit(8)
      .then(function(res) {
        var cmds = res.data || [];
        if (!cmds.length) { box.innerHTML = '<div class="r-empty" style="padding:14px">No commands yet</div>'; return; }
        box.innerHTML = '<div class="r-cmd-hist-feed">' + cmds.map(function(c) {
          return '<div class="r-ch-item">' +
            '<span class="r-badge ' + logBadge(c.status) + '" style="font-size:8px">' + esc(c.status||'PEND') + '</span>' +
            '<span class="r-ch-cmd">' + esc(c.type||c.command||c.action||'?') + ' → ' + esc(c.target_machine||'all') + '</span>' +
            '<span class="r-ch-time">' + fmtElapsed(c.created_at) + '</span>' +
            '</div>';
        }).join('') + '</div>';
      }).catch(function(){});
  }

  // ── Live Data Stream (Supabase Realtime, Fasa 6) ─────────
  var _liveChannel = null;
  function startLiveStream() {
    if (_liveChannel) { RS.supa.removeChannel(_liveChannel); _liveChannel = null; }
    if (!RS.supa) return;
    RS._terminal = [];

    // Seed last 20 logs on open
    RS.supa.from('logs').select('*').order('timestamp', { ascending: false }).limit(20)
      .then(function(res) {
        var rows = (res.data || []).reverse(); // oldest first for terminal display
        rows.forEach(function(e) { appendTerminalLine(e); });
      }).catch(function() {});

    // Subscribe to new INSERT events — zero polling cost
    _liveChannel = RS.supa.channel('supa-logs-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'logs' },
        function(payload) { appendTerminalLine(payload.new); }
      ).subscribe();

    addL(function() { if (_liveChannel) { RS.supa.removeChannel(_liveChannel); _liveChannel = null; } });
  }

  function appendTerminalLine(e) {
    var term = $r('r-terminal');
    if (!term) return;
    var ts = fmtTs(e.timestamp || e.created_at);
    var rawSt  = e.status || '';
    var isMsg  = rawSt.length > 30;
    var stCode = isMsg ? 'DEBUG' : (rawSt.toUpperCase() || 'INFO');
    var file   = e.file_name || e.activity_name || '';
    var cls    = stCode==='FAILED' ? 'err' : stCode==='COMPLETED' ? 'ok' : stCode==='DEBUG' ? 'debug' : 'info';
    var line   = '[' + ts + '] [' + (e.app_name||'?') + '] ' + stCode + (file ? ' · ' + file : '');

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
    RS._recentLogs.unshift(e);
    if (RS._recentLogs.length > 50) RS._recentLogs.pop();
    var ra = $r('r-recent-act');
    if (ra) ra.innerHTML = buildRecentActHTML();
  }

  // ── Dashboard Charts ──────────────────────────────────────
  function initDashCharts() {
    if (typeof Chart === 'undefined') return;
    var labels = [];
    for (var i = 23; i >= 0; i--) labels.push(i + 'h');

    function makeData(color, data) {
      return { labels: labels, datasets: [{ data: data, borderColor: color, backgroundColor: color.replace(')', ',0.1)').replace('rgb','rgba'), borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: true }] };
    }

    var chartOpts = {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6B7A8F', font: { size: 8 }, maxTicksLimit: 6 } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6B7A8F', font: { size: 8 } }, beginAtZero: true, max: 100 }
      }
    };

    var colors = { cpu:'rgb(0,240,255)', ram:'rgb(178,0,255)', disk:'rgb(245,158,11)' };
    ['cpu','ram','disk'].forEach(function(id){
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
    ['cpu','ram','disk'].forEach(function(key){
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
    return devs.map(function(d) {
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
    var lq   = (q || '').toLowerCase();
    var devs = Object.values(RS.devices).filter(function(d) {
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
          '<div class="r-tab"        id="rtab-jobs"     onclick="rDdTab(\'jobs\',\'' + esc(hostname) + '\')">Jobs</div>' +
          '<div class="r-tab"        id="rtab-errors"   onclick="rDdTab(\'errors\',\'' + esc(hostname) + '\')">Errors</div>' +
          '<div class="r-tab"        id="rtab-cmds"     onclick="rDdTab(\'cmds\',\'' + esc(hostname) + '\')">Commands</div>' +
        '</div>' +
        '<div id="r-dd-content" class="r-dd-content"></div>' +
      '</div>' +
      healthPanel;

    RS._currentDdHostname = hostname;
    rDdTab('activity', hostname);
  }

  window.rDdTab = function (tab, hostname) {
    qra('.r-tab').forEach(function(t){ t.classList.remove('active'); });
    var t = $r('rtab-' + tab); if (t) t.classList.add('active');
    var box = $r('r-dd-content');
    if (!box) return;
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Loading…</div>';
    switch (tab) {
      case 'activity': ddActivity(hostname, box); break;
      case 'jobs':     ddJobs(hostname, box);     break;
      case 'errors':   ddErrors(hostname, box);   break;
      case 'cmds':     ddCmds(hostname, box);     break;
    }
  };

  // _logCache and _recentLogs are initialized in RS state above

  function ddActivity(hostname, box) {
    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
    RS.supa.from('logs').select('*').eq('machine', hostname)
      .order('timestamp', { ascending: false }).limit(300)
      .then(function(res) {
        var data = res.data || [];
        if (!data.length) { box.innerHTML = '<div class="r-empty">No activity logs for this machine</div>'; return; }
        RS._logCache = data;

        var failCnt = RS._logCache.filter(function(e){
          return (e.status||'').toUpperCase() === 'FAILED' || (e.state||'').toUpperCase() === 'FAILED';
        }).length;
        var slaCnt = RS._logCache.filter(function(e){ return e.sla_breach; }).length;

        var summary = '<div class="r-log-summary">' +
          '<span class="r-badge r-badge-muted">' + RS._logCache.length + ' records</span>' +
          (failCnt ? '<span class="r-badge r-badge-err">' + failCnt + ' FAILED</span>' : '') +
          (slaCnt  ? '<span class="r-badge r-badge-warn">' + slaCnt + ' SLA BREACH</span>' : '') +
          '<span class="r-muted-sm" style="margin-left:auto">Click row → view full detail</span>' +
          '</div>';

        var rows = RS._logCache.map(function(e, i) {
          var rawStatus = e.status || e.state || '';
          var isMsg     = rawStatus.length > 30;
          var stCode    = isMsg ? 'DEBUG' : (rawStatus.toUpperCase() || 'INFO');
          var stState   = (e.state || '').toUpperCase();
          // File/detail: file_name is the most useful field
          var fileDetail = e.file_name || e.activity_name || e.details || e.error_msg || e.error
                         || e.message || e.reason || (isMsg ? rawStatus : '') || '—';
          var jobId = e.job_group_id || e.trace_id || e.run_id || '';
          var isFailed = stCode === 'FAILED' || stState === 'FAILED';
          var rowCls   = isFailed ? ' style="background:rgba(255,51,85,0.04)"' : (e.sla_breach ? ' style="background:rgba(255,149,0,0.04)"' : '');

          return '<tr' + rowCls + ' onclick="rShowLogDetail(' + i + ')" style="cursor:pointer' + (isFailed ? ';background:rgba(255,51,85,0.06)' : (e.sla_breach ? ';background:rgba(255,149,0,0.04)' : '')) + '">' +
            '<td>' + fmtTs(e.timestamp || e.created_at) + '</td>' +
            '<td><span class="r-badge r-badge-purple">' + esc(e.app_name || '—') + '</span></td>' +
            '<td>' +
              '<span class="r-badge ' + logBadge(stCode) + '">' + esc(stCode) + '</span>' +
              (e.state && e.state.toUpperCase() !== stCode ? ' <span class="r-muted-sm">/' + esc(e.state) + '</span>' : '') +
            '</td>' +
            '<td class="r-cell-trunc r-font-mono" style="max-width:220px" title="' + esc(fileDetail) + '">' + esc(fileDetail) + '</td>' +
            '<td class="r-font-mono r-muted-sm">' + (jobId ? jobId.substring(0,8) + '…' : '—') + '</td>' +
            '<td>' +
              (e.sla_breach ? '<span class="r-badge r-badge-warn">SLA!</span> ' : '') +
              (e.version ? '<span class="r-muted-sm">v' + esc(String(e.version)) + '</span>' : '') +
            '</td>' +
            '<td><button class="r-btn-sm" onclick="event.stopPropagation();rShowLogDetail(' + i + ')">Detail</button></td>' +
            '</tr>';
        }).join('');

        box.innerHTML = summary + tableWrap(['Time','App','Status/State','File / Detail','Job ID','Flags',''], rows);
      }).catch(function(err) { box.innerHTML = errBox(err.message); });
  }

  window.rShowLogDetail = function (idx) {
    var e = RS._logCache[idx];
    if (!e) return;
    var title = $r('r-modal-title');
    var body  = $r('r-modal-body');
    var footer = $r('r-modal-footer');
    if (title) title.textContent = (e.app_name || 'Log') + ' — ' + fmtTs(e.timestamp || e.created_at);
    if (body) {
      var rawStatus = e.status || e.state || '';
      var isMsg = rawStatus.length > 30;
      var stCode = isMsg ? 'DEBUG' : (rawStatus.toUpperCase() || 'INFO');
      var isFailed = stCode === 'FAILED' || (e.state||'').toUpperCase() === 'FAILED';

      // Build field list — show everything non-null
      var SKIP = {};  // no fields to skip — show all
      var fieldRows = Object.keys(e).map(function(k) {
        var v = e[k];
        if (v === null || v === undefined) return '';
        var display;
        if (v && v.toDate)       display = '<span class="r-muted-sm">' + fmtTs(v) + '</span>';
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
            esc(e.error_msg || e.error || e.message || e.details || e.reason || 'No error message in this log — check vibes_errors subcollection') +
            '</div>'
          : '') +
        '<table style="width:100%;border-collapse:collapse">' + fieldRows + '</table>';
    }
    if (footer) footer.innerHTML = '<button class="r-btn-sm" onclick="rModalClose()">Close</button>';
    rModalOpen();
  };


  // ── TAB: JOBS ──────────────────────────────────────────────────
  var _DD_JOBS_FEATS = [
    { val: 'renamer',     label: 'Renamer' },
    { val: 'splitter',    label: 'PDF Splitter' },
    { val: 'scanify',     label: 'Scanify' },
    { val: 'vibes',       label: 'Vibes Agent' },
    { val: 'pdfstudio',   label: 'PDF Studio' },
    { val: 'quickrename', label: 'Quick Rename' },
    { val: 'vims',        label: 'VIMS Scrape' }
  ];

  function ddJobs(hostname, box) {
    var opts = _DD_JOBS_FEATS.map(function(f) {
      return '<option value="' + f.val + '">' + f.label + '</option>';
    }).join('');
    box.innerHTML =
      '<div class="r-filter-bar" style="margin-bottom:14px">' +
        '<label style="color:var(--rc-muted);font-size:12px;margin-right:8px">Feature:</label>' +
        '<select class="r-filter-sel" id="r-jobs-feat" onchange="rDdJobsLoad(\'' + esc(hostname) + '\')">' + opts + '</select>' +
      '</div>' +
      '<div id="r-jobs-content"><div class="r-loading"><span class="r-spin"></span> Loading…</div></div>';
    rDdJobsLoad(hostname);
    _enrichJobsSelect(hostname);
  }

  function _enrichJobsSelect(hostname) {
    if (!RS.supa) return;
    var appNameMap = { splitter:'PDF Splitter', scanify:'Scanify', vibes:'Vibes', pdfstudio:'PDF Studio', quickrename:'Quick Rename' };
    _DD_JOBS_FEATS.forEach(function(f) {
      var q;
      if (f.val === 'renamer')    q = RS.supa.from('renamer_docs').select('*', {count:'exact', head:true}).eq('hostname', hostname);
      else if (f.val === 'vims')  q = RS.supa.from('vims_results').select('*', {count:'exact', head:true}).eq('hostname', hostname);
      else                        q = RS.supa.from('logs').select('*', {count:'exact', head:true}).eq('machine', hostname).ilike('app_name', '%' + (appNameMap[f.val]||f.val) + '%');
      q.then(function(res) {
        var cnt = res.count || 0;
        var sel = document.getElementById('r-jobs-feat');
        if (!sel) return;
        var opt = sel.querySelector('option[value="' + f.val + '"]');
        if (!opt) return;
        opt.textContent = cnt > 0 ? f.label + ' (' + cnt + ')' : f.label;
        opt.style.color = cnt === 0 ? 'rgba(156,163,175,0.45)' : '';
      }).catch(function() {});
    });
  }

  window.rDdJobsLoad = function(hostname) {
    var feat = (document.getElementById('r-jobs-feat') || {}).value || 'renamer';
    var box  = document.getElementById('r-jobs-content');
    if (!box) return;
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Loading…</div>';

    // Renamer — dedicated table
    if (feat === 'renamer') {
      if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
      RS.supa.from('renamer_docs').select('*').eq('hostname', hostname)
        .order('timestamp', { ascending: false }).limit(200)
        .then(function(res) {
          var docs = res.data || [];
          if (!docs.length) { box.innerHTML = '<div class="r-empty">No Renamer records for this machine</div>'; return; }
          var rows = docs.map(function(e) {
            return '<tr>' +
              '<td>' + fmtTs(e.timestamp) + '</td>' +
              '<td class="r-font-mono r-cell-trunc" title="' + esc(e.original_name||'') + '">' + esc(e.original_name||'—') + '</td>' +
              '<td class="r-font-mono r-cell-trunc" title="' + esc(e.renamed_to||'') + '">' + esc(e.renamed_to||'—') + '</td>' +
              '<td><span class="r-badge ' + renameBadge(e.status) + '">' + esc(e.status||'?') + '</span></td>' +
              '<td>' + esc(e.error_reason||'—') + '</td>' +
              '</tr>';
          }).join('');
          box.innerHTML = tableWrap(['Time','Original Name','Renamed To','Status','Reason'], rows);
        }).catch(function(err) { box.innerHTML = errBox(err.message); });
      return;
    }

    // VIMS — dedicated table
    if (feat === 'vims') {
      if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
      RS.supa.from('vims_results').select('*').eq('hostname', hostname)
        .order('timestamp', { ascending: false }).limit(200)
        .then(function(res) {
          var docs = res.data || [];
          if (!docs.length) { box.innerHTML = '<div class="r-empty">No VIMS records for this machine</div>'; return; }
          var rows = docs.map(function(e) {
            var bc = e.status === 'success' ? 'r-badge-ok' : e.status === 'not_found' ? 'r-badge-info' : 'r-badge-warn';
            return '<tr>' +
              '<td>' + fmtTs(e.timestamp) + '</td>' +
              '<td class="r-font-mono">' + esc(e.no_do||'—') + '</td>' +
              '<td>' + esc(e.patient_name||'—') + '</td>' +
              '<td>' + (e.amount != null ? 'RM ' + Number(e.amount).toFixed(2) : '—') + '</td>' +
              '<td><span class="r-badge ' + bc + '">' + esc(e.status||'?') + '</span></td>' +
              '<td>' + esc(e.skip_reason||e.error||'—') + '</td>' +
              '</tr>';
          }).join('');
          box.innerHTML =
            '<div class="r-vims-legend">' +
              '<span class="r-badge r-badge-ok">success</span> Scraped &nbsp;' +
              '<span class="r-badge r-badge-warn">skipped</span> Bot issue &nbsp;' +
              '<span class="r-badge r-badge-info">not_found</span> DO not found in portal' +
            '</div>' +
            tableWrap(['Time','No. DO','Patient','Amount','Status','Reason'], rows);
        }).catch(function(err) { box.innerHTML = errBox(err.message); });
      return;
    }

    // Other features — filter logs table by app_name
    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
    var appNameMap = {
      splitter:    'PDF Splitter',
      scanify:     'Scanify',
      vibes:       'Vibes',
      pdfstudio:   'PDF Studio',
      quickrename: 'Quick Rename'
    };
    var appName = appNameMap[feat] || feat;
    RS.supa.from('logs').select('*').eq('machine', hostname).ilike('app_name', '%' + appName + '%')
      .order('timestamp', { ascending: false }).limit(200)
      .then(function(res) {
        var data = res.data || [];
        if (!data.length) { box.innerHTML = '<div class="r-empty">No ' + appName + ' logs for this machine</div>'; return; }
        var rows = data.map(function(e) {
          var st = e.status || e.state || 'INFO';
          return '<tr>' +
            '<td>' + fmtTs(e.timestamp || e.created_at) + '</td>' +
            '<td><span class="r-badge ' + logBadge(st) + '">' + esc(st) + '</span></td>' +
            '<td class="r-cell-trunc">' + esc(e.file_name || e.activity_name || e.details || e.message || '—') + '</td>' +
            '<td class="r-font-mono r-muted-sm">' + esc(e.job_group_id ? e.job_group_id.substring(0,8)+'…' : '—') + '</td>' +
            '</tr>';
        }).join('');
        box.innerHTML = '<div class="r-log-summary"><span class="r-badge r-badge-muted">' + data.length + ' records</span></div>' +
          tableWrap(['Time','Status','Detail','Job ID'], rows);
      }).catch(function(err) { box.innerHTML = errBox(err.message); });
  };

  // ── TAB: ERRORS ────────────────────────────────────────────────
  var _DD_ERR_FEATS = [
    { val: 'All',          label: 'All' },
    { val: 'Renamer',      label: 'Renamer' },
    { val: 'PDF Splitter', label: 'PDF Splitter' },
    { val: 'Scanify',      label: 'Scanify' },
    { val: 'Vibes',        label: 'Vibes' },
    { val: 'PDF Studio',   label: 'PDF Studio' },
    { val: 'Quick Rename', label: 'Quick Rename' },
    { val: 'VIMS',         label: 'VIMS' }
  ];

  function ddErrors(hostname, box) {
    var opts = _DD_ERR_FEATS.map(function(f) {
      return '<option value="' + f.val + '">' + f.label + '</option>';
    }).join('');
    box.innerHTML =
      '<div class="r-filter-bar" style="margin-bottom:14px">' +
        '<label style="color:var(--rc-muted);font-size:12px;margin-right:8px">Feature:</label>' +
        '<select class="r-filter-sel" id="r-errors-feat" onchange="rDdErrorsLoad(\'' + esc(hostname) + '\')">' + opts + '</select>' +
      '</div>' +
      '<div id="r-errors-content"><div class="r-loading"><span class="r-spin"></span> Loading…</div></div>';
    rDdErrorsLoad(hostname);
    _enrichErrorsSelect(hostname);
  }

  function _enrichErrorsSelect(hostname) {
    if (!RS.supa) return;
    _DD_ERR_FEATS.forEach(function(f) {
      var q = RS.supa.from('app_errors').select('*', {count:'exact', head:true}).eq('hostname', hostname);
      if (f.val !== 'All') q = q.ilike('app_name', '%' + f.val + '%');
      q.then(function(res) {
        var cnt = res.count || 0;
        var sel = document.getElementById('r-errors-feat');
        if (!sel) return;
        var opt = sel.querySelector('option[value="' + f.val + '"]');
        if (!opt) return;
        opt.textContent = cnt > 0 ? f.label + ' (' + cnt + ')' : f.label;
        opt.style.color = cnt === 0 ? 'rgba(156,163,175,0.45)' : '';
      }).catch(function() {});
    });
  }

  window.rDdErrorsLoad = function(hostname) {
    var feat = (document.getElementById('r-errors-feat') || {}).value || 'All';
    var box  = document.getElementById('r-errors-content');
    if (!box) return;
    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Loading…</div>';

    var q = RS.supa.from('app_errors').select('*').eq('hostname', hostname);
    if (feat !== 'All') q = q.ilike('app_name', '%' + feat + '%');
    q.order('created_at', { ascending: false }).limit(200)
      .then(function(res) {
        var errs = res.data || [];
        if (!errs.length) {
          box.innerHTML = '<div class="r-empty">No errors' + (feat !== 'All' ? ' for ' + feat : '') + ' on this machine</div>';
          return;
        }
        var openCnt  = errs.filter(function(e){ return e.fix_status !== 'fixed'; }).length;
        var fixedCnt = errs.length - openCnt;
        var summary  = '<div class="r-log-summary">' +
          '<span class="r-badge r-badge-err">' + openCnt + ' open</span>' +
          '<span class="r-badge r-badge-ok">' + fixedCnt + ' fixed</span>' +
          '</div>';
        var rows = errs.map(function(e) {
          var isFixed = e.fix_status === 'fixed';
          return '<tr>' +
            '<td>' + fmtTs(e.created_at || e.first_seen) + '</td>' +
            '<td><span class="r-badge r-badge-purple">' + esc(e.app_name || '—') + '</span></td>' +
            '<td><span class="r-badge ' + errBadge(e.error_type) + '">' + esc(e.error_type || 'error') + '</span></td>' +
            '<td class="r-cell-trunc">' + esc(e.message || e.error_msg || '—') + '</td>' +
            '<td>' + fmtTs(e.last_seen) + '</td>' +
            '<td><span class="r-badge ' + (isFixed ? 'r-badge-ok' : 'r-badge-err') + '">' + (isFixed ? 'FIXED' : 'OPEN') + '</span></td>' +
            '<td>' + (!isFixed
              ? '<button class="r-btn-sm" onclick="rMarkFixed(\'' + esc(String(e.id)) + '\')">Fix</button>'
              : '<span class="r-muted-sm">' + esc(e.fix_note || '✓') + '</span>') +
            '</td>' +
            '</tr>';
        }).join('');
        box.innerHTML = summary + tableWrap(['First Seen','Feature','Type','Message','Last Seen','Status',''], rows);
      }).catch(function(err) { box.innerHTML = errBox(err.message); });
  };

  window.rMarkFixed = function(errorId) {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    if (!RS.supa) return;
    RS.supa.from('app_errors')
      .update({ fix_status: 'fixed', fixed_at: new Date().toISOString() })
      .eq('id', errorId)
      .then(function() {
        rToast('Marked as fixed', 'success');
        var hostname = RS._currentDdHostname;
        if (hostname) rDdErrorsLoad(hostname);
      }).catch(function(err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── TAB: COMMANDS ──────────────────────────────────────────────
  function ddCmds(hostname, box) {
    var chips = ['PING','KILL','RESTART','REFRESH_STATUS','PAUSE','RESUME','CLEAR_LOGS'];
    var chipColors = {
      PING: 'var(--cyan)', KILL: 'var(--rc-red)', RESTART: 'var(--rc-warn)',
      REFRESH_STATUS: 'var(--rc-green)', PAUSE: 'var(--rc-warn)',
      RESUME: 'var(--rc-green)', CLEAR_LOGS: 'var(--rc-muted)'
    };
    var chipsHTML = chips.map(function(cmd) {
      return '<button style="border:none;background:none;color:' + chipColors[cmd] + ';font-size:11px;cursor:pointer;padding:4px 6px" ' +
        'onclick="document.getElementById(\'r-cmd-inp\').value=\'' + cmd + '\'">' + cmd + '</button>';
    }).join('');

    box.innerHTML =
      '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;padding:8px 10px;background:var(--rc-bg2);border-radius:6px">' +
        chipsHTML +
      '</div>' +
      '<div class="r-cmd-send">' +
        '<input class="r-filter-input" id="r-cmd-inp" placeholder="Click chip above or type custom command…" style="flex:1">' +
        '<button class="r-btn-primary" onclick="rSendCmd(\'' + esc(hostname) + '\')">Send</button>' +
      '</div>' +
      '<div id="r-cmd-hist" style="margin-top:14px"><div class="r-loading"><span class="r-spin"></span> Loading history…</div></div>';

    if (!RS.supa) return;
    RS.supa.from('commands').select('*').eq('target_machine', hostname)
      .order('created_at', { ascending: false }).limit(50)
      .then(function(res) {
        var hist = document.getElementById('r-cmd-hist');
        if (!hist) return;
        var cmds = res.data || [];
        if (!cmds.length) { hist.innerHTML = '<div class="r-empty">No commands sent to this machine</div>'; return; }
        var rows = cmds.map(function(c) {
          return '<tr>' +
            '<td>' + fmtTs(c.created_at) + '</td>' +
            '<td class="r-font-mono">' + esc(c.type || c.command || c.action || '—') + '</td>' +
            '<td><span class="r-badge ' + logBadge(c.status) + '">' + esc(c.status || 'PENDING') + '</span></td>' +
            '<td>' + esc(c.result_msg || '—') + '</td>' +
            '<td>' + esc(c.created_by || '—') + '</td>' +
            '</tr>';
        }).join('');
        hist.innerHTML = tableWrap(['Time','Command','Status','Result','By'], rows);
      }).catch(function(err) {
        var hist = document.getElementById('r-cmd-hist');
        if (hist) hist.innerHTML = errBox(err.message);
      });
  }

  // ── UTILITY: enrich <select> options with record counts ────────
  // table: supabase table name, hostField: column that holds hostname
  window.rEnrichSelect = function(selectId, table, hostField) {
    var sel = document.getElementById(selectId);
    if (!sel || !RS.supa) return;
    Array.prototype.forEach.call(sel.options, function(opt) {
      var val = opt.value;
      if (!val) return; // skip "All Machines" empty option
      var origLabel = opt.dataset.orig || opt.textContent.split(' (')[0];
      opt.dataset.orig = origLabel;
      var q = RS.supa.from(table).select('*', {count:'exact', head:true});
      q = q.eq(hostField, val);
      q.then(function(res) {
        var cnt = res.count || 0;
        opt.textContent = cnt > 0 ? origLabel + ' (' + cnt + ')' : origLabel;
        opt.style.color = cnt === 0 ? 'rgba(156,163,175,0.45)' : '';
      }).catch(function() {});
    });
  };

  // ── RENAMER TRACE ──────────────────────────────────────────
  function renderRenamer() {
    var devOpts = Object.keys(RS.devices).map(function(h){ return '<option value="' + esc(h) + '">' + esc(h) + '</option>'; }).join('');
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
    rEnrichSelect('r-ren-dev', 'renamer_docs', 'hostname');
  }

  window.rLoadRenamer = function () {
    var hostname = ($r('r-ren-dev')  || {}).value || '';
    var status   = ($r('r-ren-stat') || {}).value || '';
    var box = $r('r-ren-results');
    if (!box) return;
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Querying…</div>';

    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
    var q = RS.supa.from('renamer_docs').select('*')
      .order('timestamp', { ascending: false }).limit(150);
    if (status)   q = q.eq('status', status);
    if (hostname) q = q.eq('hostname', hostname);

    q.then(function(res) {
      var docs = (res.data || []).map(function(e) {
        return Object.assign({ _host: e.hostname }, e);
      });
      if (!docs.length) { box.innerHTML = '<div class="r-empty">No records match</div>'; return; }
      var rows = docs.map(function(e) {
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
        tableWrap(['Time','Machine','Original Name','Renamed To','Status','Reason','Run ID'], rows);
    }).catch(function(err) { box.innerHTML = errBox(err.message); });
  };

  // ── APP LOG VIEWS (shared renderer for FV Branch / Splitter / Studio / Quick / Scanify) ──
  function renderAppLogs(appName, label, icon) {
    var devOpts = Object.keys(RS.devices).map(function(h) {
      return '<option value="' + esc(h) + '">' + esc(h) + '</option>';
    }).join('');
    var view = $r('r-view-area');
    if (!view) return;
    var safeId = appName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    view.innerHTML =
      '<div class="r-panel">' +
        '<div class="r-panel-hdr">' +
          '<h3><i class="fa-solid ' + esc(icon) + '"></i> ' + esc(label) + ' Logs</h3>' +
          '<div class="r-filter-bar">' +
            '<select class="r-filter-sel" id="al-dev-' + safeId + '"><option value="">All Machines</option>' + devOpts + '</select>' +
            '<select class="r-filter-sel" id="al-stat-' + safeId + '">' +
              '<option value="">All Status</option>' +
              '<option value="COMPLETED">Completed</option>' +
              '<option value="FAILED">Failed</option>' +
              '<option value="ERROR">Error</option>' +
              '<option value="PROCESSING">Processing</option>' +
            '</select>' +
            '<button class="r-btn-sm" onclick="rLoadAppLogs(' + JSON.stringify(appName) + ',' + JSON.stringify(safeId) + ')">Search</button>' +
          '</div>' +
        '</div>' +
        '<div class="r-legend">' +
          '<span class="r-badge r-badge-ok">COMPLETED</span> Done &nbsp;' +
          '<span class="r-badge r-badge-err">FAILED / ERROR</span> Issue occurred &nbsp;' +
          '<span class="r-badge r-badge-warn">PROCESSING</span> In progress' +
        '</div>' +
        '<div id="al-results-' + safeId + '"><div class="r-empty">Select filter and click Search</div></div>' +
      '</div>';
  }

  window.rLoadAppLogs = function(appName, safeId) {
    var hostname = ($r('al-dev-' + safeId) || {}).value || '';
    var status   = ($r('al-stat-' + safeId) || {}).value || '';
    var box = $r('al-results-' + safeId);
    if (!box) return;
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Querying…</div>';

    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
    var q = RS.supa.from('logs').select('*').eq('app_name', appName)
      .order('timestamp', { ascending: false }).limit(200);
    if (status)   q = q.eq('status', status);
    if (hostname) q = q.eq('machine', hostname);

    q.then(function(res) {
      var docs = res.data || [];
      if (!docs.length) { box.innerHTML = '<div class="r-empty">No records match</div>'; return; }
      var rows = docs.map(function(e) {
        var sc = e.status === 'COMPLETED' ? 'r-badge-ok' : e.status === 'PROCESSING' ? 'r-badge-warn' : 'r-badge-err';
        var errLine = e.error_msg ? esc(String(e.error_msg).split('\n')[0].substring(0, 80)) : '—';
        return '<tr>' +
          '<td>' + fmtTs(e.timestamp) + '</td>' +
          '<td class="r-font-mono">' + esc(e.machine || '—') + '</td>' +
          '<td class="r-font-mono">' + esc(e.branch_id || '—') + '</td>' +
          '<td><span class="r-badge ' + sc + '">' + esc(e.status || '?') + '</span></td>' +
          '<td>' + (e.duration != null ? parseFloat(e.duration).toFixed(2) + 's' : '—') + '</td>' +
          '<td class="r-font-mono r-cell-trunc" title="' + esc(e.error_msg || '') + '">' + errLine + '</td>' +
          '<td class="r-font-mono">' + esc(e.root_cause || '—') + '</td>' +
          '</tr>';
      }).join('');
      box.innerHTML = '<div class="r-results-count">' + docs.length + ' record(s)</div>' +
        tableWrap(['Time', 'Machine', 'User', 'Status', 'Duration', 'Error', 'Root Cause'], rows);
    }).catch(function(err) { box.innerHTML = errBox(err.message); });
  };

  // ── VIBES MONITOR ──────────────────────────────────────────
  function renderVibes() {
    var devOpts = Object.keys(RS.devices).map(function(h){ return '<option value="' + esc(h) + '">' + esc(h) + '</option>'; }).join('');
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

    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }

    var supaQ = RS.supa.from('vibes_errors').select('*').order('timestamp', { ascending: false }).limit(150);
    if (resolved === 'open')     supaQ = supaQ.eq('resolved', false);
    else if (resolved === 'resolved') supaQ = supaQ.eq('resolved', true);
    if (hostname) supaQ = supaQ.eq('hostname', hostname);

    supaQ.then(function(res) {
      if (res.error) { box.innerHTML = errBox(res.error.message); return; }
      var docs = (res.data || []).map(function(d) {
        return Object.assign({ id: d.id, _host: d.hostname }, d);
      }).filter(function(d) {
        // batch_skip = normal batch completion, bukan error sebenar
        return (d.error_type || d.category || '') !== 'batch_skip';
      });
      if (!docs.length) { box.innerHTML = '<div class="r-empty">No VIBES errors match</div>'; return; }

      var runs = {};
      docs.forEach(function(e) {
        var rid = e.run_id || 'no-run-id';
        if (!runs[rid]) runs[rid] = { rid: rid, host: e._host, time: e.timestamp, errors: [] };
        runs[rid].errors.push(e);
      });

      var html = '<div class="r-results-count">' + docs.length + ' error(s) across ' + Object.keys(runs).length + ' run(s)</div>';
      Object.values(runs).forEach(function(run) {
        var openCnt = run.errors.filter(function(e){ return !e.resolved; }).length;
        var errRows = run.errors.map(function(e) {
          return '<tr>' +
            '<td>' + fmtTs(e.timestamp) + '</td>' +
            '<td style="font-size:11px">' + esc(e.patient_ic || e.tuntutan_no || e.context || '—') + '</td>' +
            '<td><span class="r-badge ' + errBadge(e.error_type || e.category) + '">' + esc(e.error_type || e.category || 'unknown') + '</span></td>' +
            '<td class="r-cell-trunc">' + esc(e.message || e.summary || '—') + '</td>' +
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
              tableWrap(['Time','Claim No','Error Type','Message','Status','Action'], errRows) +
            '</div>' +
          '</div>';
      });
      box.innerHTML = html;
    }).catch(function(err) { box.innerHTML = errBox(err.message); });
  };

  // ── VIBES: Fix single error ────────────────────────────────
  window.rOpenFix = function(docId, hostname, table) {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    var title  = $r('r-modal-title');
    var body   = $r('r-modal-body');
    var footer = $r('r-modal-footer');
    if (!body) return;
    if (title) title.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--rc-green,#10b981)"></i> Mark Error as Fixed';
    body.innerHTML =
      '<div class="r-fix-form">' +
        '<div class="r-fix-field">' +
          '<label style="font-size:11px;color:var(--rc-text-dim,#9ca3af);letter-spacing:0.5px">FIX NOTE <span style="color:#ef4444">*</span> <span style="opacity:0.6">(min 5 chars)</span></label>' +
          '<textarea id="r-vibes-fix-note" rows="4" class="r-textarea" placeholder="Describe the resolution…" style="width:100%;box-sizing:border-box;margin-top:6px"></textarea>' +
        '</div>' +
        '<div style="margin-top:10px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:4px;font-size:11px;color:var(--rc-text-dim,#9ca3af)">' +
          '<div><i class="fa-solid fa-server"></i> Device: <code>' + esc(hostname) + '</code></div>' +
          '<div style="margin-top:4px"><i class="fa-solid fa-fingerprint"></i> ID: <code style="font-size:10px">' + esc(docId) + '</code></div>' +
        '</div>' +
      '</div>';
    if (footer) footer.innerHTML =
      '<button class="r-btn-primary" onclick="rSubmitVibesFix(\'' + esc(docId) + '\',\'' + esc(table || 'vibes_errors') + '\')"><i class="fa-solid fa-circle-check"></i> Confirm Fixed</button>' +
      '<button class="r-btn-sm" onclick="rModalClose()">Cancel</button>';
    rModalOpen();
  };

  window.rSubmitVibesFix = function(docId, table) {
    var note = ($r('r-vibes-fix-note') || {}).value || '';
    if (note.trim().length < 5) { rToast('Fix note must be at least 5 characters', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    var user = RS.currentUser;
    RS.supa.from(table || 'vibes_errors').update({
      resolved: true,
      fix_note: note.trim(),
      fix_by:   user ? user.email : 'admin',
      fixed_at: new Date().toISOString()
    }).eq('id', docId).then(function(res) {
      if (res.error) { rToast('Error: ' + res.error.message, 'error'); return; }
      rToast('Error marked as fixed', 'success');
      rModalClose();
      rLoadVibes();
    }).catch(function(err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── VIBES: Clear all open errors for a run ─────────────────
  window.rClearErrors = function(runId, hostname) {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    var title  = $r('r-modal-title');
    var body   = $r('r-modal-body');
    var footer = $r('r-modal-footer');
    if (!body) return;
    if (title) title.innerHTML = '<i class="fa-solid fa-broom" style="color:var(--rc-orange,#f59e0b)"></i> Clear All Open Errors';
    body.innerHTML =
      '<div style="padding:4px 0">' +
        '<div style="margin-bottom:12px;color:var(--rc-text,#f9fafb);font-size:13px">Mark <strong>all OPEN</strong> errors in this run as fixed?</div>' +
        '<div style="margin-bottom:12px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:4px;font-size:11px;color:var(--rc-text-dim,#9ca3af)">' +
          '<div><i class="fa-solid fa-layer-group"></i> Run: <code>' + esc(runId) + '</code></div>' +
          '<div style="margin-top:4px"><i class="fa-solid fa-server"></i> Device: <code>' + esc(hostname) + '</code></div>' +
        '</div>' +
        '<div class="r-fix-field">' +
          '<label style="font-size:11px;color:var(--rc-text-dim,#9ca3af);letter-spacing:0.5px">FIX NOTE <span style="color:#ef4444">*</span></label>' +
          '<textarea id="r-vibes-clear-note" rows="3" class="r-textarea" placeholder="e.g. Batch re-run cleared all errors…" style="width:100%;box-sizing:border-box;margin-top:6px"></textarea>' +
        '</div>' +
      '</div>';
    if (footer) footer.innerHTML =
      '<button style="background:rgba(245,158,11,0.18);border:1px solid rgba(245,158,11,0.5);color:#fcd34d;border-radius:4px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit" onclick="rSubmitClearErrors(\'' + esc(runId) + '\')"><i class="fa-solid fa-broom"></i> Clear All</button>' +
      '<button class="r-btn-sm" onclick="rModalClose()">Cancel</button>';
    rModalOpen();
  };

  window.rSubmitClearErrors = function(runId) {
    var note = ($r('r-vibes-clear-note') || {}).value || '';
    if (note.trim().length < 5) { rToast('Fix note required (min 5 chars)', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    var user = RS.currentUser;
    RS.supa.from('vibes_errors').update({
      resolved: true,
      fix_note: note.trim(),
      fix_by:   user ? user.email : 'admin',
      fixed_at: new Date().toISOString()
    }).eq('run_id', runId).eq('resolved', false).then(function(res) {
      if (res.error) { rToast('Error: ' + res.error.message, 'error'); return; }
      rToast('All open errors in run cleared', 'success');
      rModalClose();
      rLoadVibes();
    }).catch(function(err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── VIBES: Download run errors as JSONL ────────────────────
  window.rDownloadLog = function(runId, hostname) {
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    rToast('Preparing JSONL download…', 'info');
    RS.supa.from('vibes_errors').select('*').eq('run_id', runId)
      .order('timestamp', { ascending: true })
      .then(function(res) {
        if (res.error) { rToast('Query error: ' + res.error.message, 'error'); return; }
        var rows = (res.data || []);
        if (!rows.length) { rToast('No records for this run', 'warn'); return; }
        var jsonl = rows.map(function(r) { return JSON.stringify(r); }).join('\n');
        var blob = new Blob([jsonl], { type: 'application/jsonl' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        var safeName = (hostname || 'device').replace(/[^a-zA-Z0-9_-]/g, '_');
        a.href     = url;
        a.download = 'vibes_' + safeName + '_' + runId + '.jsonl';
        document.body.appendChild(a);
        a.click();
        setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
        rToast('Downloaded ' + rows.length + ' error records', 'success');
      }).catch(function(err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── VIMS SCRAPE ────────────────────────────────────────────
  function renderVims() {
    var devOpts = Object.keys(RS.devices).map(function(h){ return '<option value="' + esc(h) + '">' + esc(h) + '</option>'; }).join('');
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
          '<span class="r-badge r-badge-warn">skipped</span> Bot skip — technical issue &nbsp;' +
          '<span class="r-badge r-badge-info">not_found</span> DO not found in VIMS portal' +
        '</div>' +
        '<div class="r-info-box warn">' +
          '<i class="fa-solid fa-triangle-exclamation"></i>' +
          '<div><strong>Proof:</strong> <code>skipped</code> = bot issue (apps problem). ' +
          '<code>not_found</code> = DO not found in portal (not a bot fault). ' +
          'Use this as evidence to verify user reports.</div>' +
        '</div>' +
        '<div id="r-vims-results"><div class="r-empty">Select filter and click Search</div></div>' +
      '</div>';
    rEnrichSelect('r-vims-dev', 'vims_results', 'hostname');
  }

  window.rLoadVims = function () {
    var hostname = ($r('r-vims-dev')  || {}).value || '';
    var status   = ($r('r-vims-stat') || {}).value || '';
    var box = $r('r-vims-results');
    if (!box) return;
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Querying…</div>';

    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
    var q = RS.supa.from('vims_results').select('*')
      .order('timestamp', { ascending: false }).limit(200);
    if (status)   q = q.eq('status', status);
    if (hostname) q = q.eq('hostname', hostname);

    q.then(function(res) {
      var docs = (res.data || []).map(function(e) {
        return Object.assign({ _host: e.hostname }, e);
      });
      if (!docs.length) { box.innerHTML = '<div class="r-empty">No VIMS records match</div>'; return; }

      var successCnt = docs.filter(function(d){ return d.status === 'success';   }).length;
      var skipCnt    = docs.filter(function(d){ return d.status === 'skipped';   }).length;
      var nfCnt      = docs.filter(function(d){ return d.status === 'not_found'; }).length;

      var rows = docs.map(function(e) {
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
        tableWrap(['Time','Machine','No. DO','Patient','Amount','Status','Reason'], rows);
    }).catch(function(err) { box.innerHTML = errBox(err.message); });
  };

  // ── LOG EXPLORER ───────────────────────────────────────────
  function renderLogs() {
    var devOpts = Object.keys(RS.devices).map(function(h){ return '<option value="' + esc(h) + '">' + esc(h) + '</option>'; }).join('');
    var appOpts = RASUMI_APPS.map(function(a){
      return a.firebaseNames.map(function(n){ return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
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
    var hostname = ($r('r-log-dev')  || {}).value || '';
    var appName  = ($r('r-log-app')  || {}).value || '';
    var status   = ($r('r-log-stat') || {}).value || '';
    var box = $r('r-log-results');
    if (!box) return;
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Querying…</div>';

    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
    var q = RS.supa.from('logs').select('*')
      .order('timestamp', { ascending: false }).limit(200);
    if (hostname) q = q.eq('machine', hostname);
    if (appName)  q = q.eq('app_name', appName);
    if (status)   q = q.eq('status', status);

    q.then(function(res) {
      var data = res.data || [];
      if (!data.length) { box.innerHTML = '<div class="r-empty">No logs match</div>'; return; }
      var rows = data.map(function(e) {
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
        tableWrap(['Time','Machine','App','Status','Branch','Details','Duration'], rows);
    }).catch(function(err) { box.innerHTML = errBox(err.message); });
  };

  // ── COMMANDS ───────────────────────────────────────────────
  function _qCmd(cmd, icon, color, desc) {
    return '<button class="r-btn-sm" title="' + esc(desc) + '" style="border:none;background:none;color:' + color + ';font-size:11px;cursor:pointer" ' +
      'onclick="var i=document.getElementById(\'r-cmd-dev-inp\')||document.getElementById(\'r-cmd-inp\');if(i)i.value=\'' + cmd + '\'">' +
      '<i class="fa-solid ' + icon + '"></i> ' + cmd + '</button>';
  }

  function renderCommands() {
    var devOpts = Object.keys(RS.devices).map(function(h){ return '<option value="' + esc(h) + '">' + esc(h) + '</option>'; }).join('');
    var view = $r('r-view-area');
    if (!view) return;
    view.innerHTML =
      '<div class="r-panel">' +
        '<div class="r-panel-hdr"><h3><i class="fa-solid fa-terminal"></i> Remote Commands</h3></div>' +
        '<div class="r-info-box">' +
          '<i class="fa-solid fa-circle-info"></i>' +
          '<div>Commands write to Supabase <code>commands</code> table. Agent polls every 10s and executes pending commands.</div>' +
        '</div>' +

        // Quick command chips
        '<div class="r-cmd-section">' +
          '<h4>Quick Commands <span class="r-muted-sm">— click to fill input</span></h4>' +
          '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">' +
            _qCmd('PING',           'fa-satellite-dish', 'var(--cyan)',    'Check if machine is alive & responsive') +
            _qCmd('KILL',           'fa-skull',          'var(--rc-red)',  'Force close Rasumi Apps immediately') +
            _qCmd('RESTART',        'fa-rotate-right',   'var(--rc-warn)', 'Relaunch Rasumi Apps on target machine') +
            _qCmd('REFRESH_STATUS', 'fa-arrows-rotate',  'var(--rc-green)','Force push machine status to Supabase now') +
            _qCmd('PAUSE',          'fa-pause',          'var(--rc-warn)', 'Pause all processing jobs') +
            _qCmd('RESUME',         'fa-play',           'var(--rc-green)','Resume paused processing jobs') +
            _qCmd('RETRY',          'fa-redo',           'var(--cyan)',    'Prompt operator to retry current job') +
            _qCmd('CLEAR_LOGS',     'fa-trash-can',      'var(--rc-muted)','Clear old local log files on machine') +
          '</div>' +
        '</div>' +

        '<div class="r-cmd-section">' +
          '<h4>Send to Specific Machine</h4>' +
          '<div class="r-cmd-row">' +
            '<select class="r-filter-sel" id="r-cmd-dev-sel"><option value="">Select Machine</option>' + devOpts + '</select>' +
            '<input class="r-filter-input" id="r-cmd-dev-inp" placeholder="Select a quick command above or type custom…">' +
            '<button class="r-btn-primary" onclick="rSendCmd()">Send</button>' +
          '</div>' +
        '</div>' +
        '<div class="r-cmd-section">' +
          '<h4>Broadcast to All Online Machines</h4>' +
          '<div class="r-cmd-row">' +
            '<input class="r-filter-input" id="r-broadcast-inp" placeholder="Broadcast command…">' +
            '<button class="r-btn-warn" onclick="rSendBroadcast()">Broadcast</button>' +
          '</div>' +
          '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--rc-border)">' +
            '<h4 style="font-size:11px;font-weight:700;color:var(--rc-text-dim);letter-spacing:0.1em;margin:0 0 10px;text-transform:uppercase">📢 Login Screen Announcement</h4>' +
            '<div class="r-cmd-row" style="margin-bottom:8px">' +
              '<input class="r-filter-input" id="r-announce-inp" placeholder="Type announcement message to display on all machines login screen…">' +
            '</div>' +
            '<div class="r-cmd-row" style="align-items:center">' +
              '<span style="font-size:11px;font-weight:600;color:var(--rc-text-dim);white-space:nowrap;flex-shrink:0">Duration (hours)</span>' +
              '<input class="r-filter-input" id="r-announce-hours" type="number" min="1" max="720" value="24" style="flex:0 0 70px;text-align:center">' +
              '<button class="r-btn-primary" onclick="rSendAnnouncement()">Announce</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="r-panel-hdr" style="margin-top:20px"><h3>Command History (Last 50)</h3></div>' +
        '<div id="r-cmd-hist-main"><div class="r-loading"><span class="r-spin"></span> Loading…</div></div>' +
      '</div>';

    // [Fasa 6] Command history — read from Supabase
    if (RS.supa) {
      RS.supa.from('commands').select('*').order('created_at', { ascending: false }).limit(50)
        .then(function(res) {
          var box = $r('r-cmd-hist-main');
          if (!box) return;
          var cmds = res.data || [];
          if (!cmds.length) { box.innerHTML = '<div class="r-empty">No commands sent yet</div>'; return; }
          var rows = cmds.map(function(c) {
            return '<tr>' +
              '<td>' + fmtTs(c.created_at) + '</td>' +
              '<td class="r-font-mono">' + esc(c.target_machine || 'broadcast') + '</td>' +
              '<td class="r-font-mono">' + esc(c.type || c.command || c.action || '—') + '</td>' +
              '<td><span class="r-badge ' + logBadge(c.status) + '">' + esc(c.status || 'PENDING') + '</span></td>' +
              '<td>' + esc(c.created_by || '—') + '</td>' +
              '</tr>';
          }).join('');
          box.innerHTML = tableWrap(['Time','Target Machine','Command','Status','By'], rows);
        }).catch(function(err) {
          var box = $r('r-cmd-hist-main');
          if (box) box.innerHTML = errBox(err.message || 'Supabase error');
        });
    } else {
      var box = $r('r-cmd-hist-main');
      if (box) box.innerHTML = '<div class="r-empty">Supabase not ready</div>';
    }
    // Enrich machine dropdown with command counts
    rEnrichSelect('r-cmd-dev-sel', 'commands', 'target_machine');
  }

  window.rSendCmd = function (hostnameOverride) {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    var target  = hostnameOverride || ($r('r-cmd-dev-sel') || {}).value || '';
    var command = hostnameOverride
      ? (($r('r-cmd-inp') || {}).value || '')
      : (($r('r-cmd-dev-inp') || {}).value || '');
    if (!target || !command) { rToast('Select machine and enter command', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    var user = RS.currentUser;
    var cmdUp = command.toUpperCase();
    var createdBy = user ? user.email : 'admin';
    RS.supa.from('commands').insert({
      target_machine: target,
      type: cmdUp,
      status: 'PENDING',
      created_at: new Date().toISOString(),
      created_by: createdBy
    }).then(function() {
      rToast('Command "' + cmdUp + '" sent to ' + target, 'success');
      var inp = $r('r-cmd-dev-inp') || $r('r-cmd-inp');
      if (inp) inp.value = '';
    }).catch(function(err) { rToast('Error: ' + err.message, 'error'); });
  };

  window.rSendBroadcast = function () {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    var command = ($r('r-broadcast-inp') || {}).value || '';
    if (!command) { rToast('Enter broadcast command', 'warn'); return; }
    var online = Object.values(RS.devices).filter(function(d){ return d._status === 'online'; });
    if (!online.length) { rToast('No online machines', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    var user  = RS.currentUser;
    var cmdUp = command.toUpperCase();
    var createdBy = user ? user.email : 'admin';
    var nowIso = new Date().toISOString();
    var supaRows = online.map(function(d) {
      return {
        target_machine: d.id,
        type: cmdUp,
        status: 'PENDING',
        is_broadcast: true,
        created_at: nowIso,
        created_by: createdBy
      };
    });
    RS.supa.from('commands').insert(supaRows).then(function() {
      rToast('Broadcast → ' + online.length + ' machine(s)', 'success');
      var inp = $r('r-broadcast-inp');
      if (inp) inp.value = '';
      renderCommands();
    }).catch(function(err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── ANNOUNCEMENT ────────────────────────────────────────────
  window.rSendAnnouncement = function () {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    var message = ($r('r-announce-inp') || {}).value || '';
    if (!message.trim()) { rToast('Enter an announcement message', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    var hoursEl = $r('r-announce-hours');
    var hours   = hoursEl ? parseInt(hoursEl.value, 10) : 24;
    if (!hours || hours < 1) { rToast('Duration must be at least 1 hour', 'warn'); return; }
    var user = RS.currentUser;
    var now  = new Date();
    var exp  = new Date(now.getTime() + hours * 60 * 60 * 1000);
    RS.supa.from('announcements').insert({
      message:      message.trim(),
      broadcast_at: now.toISOString(),
      expires_at:   exp.toISOString(),
      broadcast_by: user ? user.email : 'admin'
    }).then(function () {
      rToast('📢 Announcement sent — active for ' + hours + ' hour(s)', 'success');
      var inp = $r('r-announce-inp');
      if (inp) inp.value = '';
    }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── ALERTS ─────────────────────────────────────────────────
  function renderAlerts() {
    var devs    = Object.values(RS.devices);
    var offline = devs.filter(function(d){ return d._status === 'offline'; });
    var stale   = devs.filter(function(d){ return d._status === 'stale';   });
    var view = $r('r-view-area');
    if (!view) return;

    var appOpts = [
      'Renamer HQ', 'FV Branch', 'PDF Splitter',
      'PDF Studio', 'Quick Rename', 'Scanify', 'VIBES'
    ].map(function(a) {
      return '<option value="' + esc(a) + '">' + esc(a) + '</option>';
    }).join('');

    var html =
      '<div class="r-panel">' +
        '<div class="r-panel-hdr">' +
          '<h3><i class="fa-solid fa-triangle-exclamation"></i> Active Alerts</h3>' +
          '<div class="r-filter-bar">' +
            '<select class="r-filter-sel" id="ae-app-filter">' +
              '<option value="">All Apps</option>' + appOpts +
            '</select>' +
            '<select class="r-filter-sel" id="ae-fix-filter">' +
              '<option value="unfixed">Unfixed Only</option>' +
              '<option value="">All (incl. Fixed)</option>' +
              '<option value="fixed">Fixed Only</option>' +
            '</select>' +
            '<button class="r-btn-sm" onclick="rLoadAppErrors()">Refresh Errors</button>' +
          '</div>' +
        '</div>';

    // ── Machine health alerts ──
    if (!offline.length && !stale.length) {
      html += '<div class="r-alert-item ok" style="padding:8px 12px"><i class="fa-solid fa-circle-check"></i> All machines healthy</div>';
    }
    if (offline.length) {
      html += '<div class="r-alert-section"><div class="r-alert-section-title err"><i class="fa-solid fa-circle-xmark"></i> Offline Machines (' + offline.length + ')</div>';
      offline.forEach(function(d) {
        html += '<div class="r-alert-item err"><i class="fa-solid fa-server"></i> <strong>' + esc(d.id) + '</strong> — last heartbeat ' + fmtElapsed(d.last_heartbeat || d.last_seen) +
          ' <button class="r-btn-sm" onclick="rNav(\'r-device:' + esc(d.id) + '\')">View</button></div>';
      });
      html += '</div>';
    }
    if (stale.length) {
      html += '<div class="r-alert-section"><div class="r-alert-section-title warn"><i class="fa-solid fa-clock"></i> Stale Machines (' + stale.length + ')</div>';
      stale.forEach(function(d) {
        html += '<div class="r-alert-item warn"><i class="fa-solid fa-server"></i> <strong>' + esc(d.id) + '</strong> — no heartbeat ' + fmtElapsed(d.last_heartbeat || d.last_seen) +
          ' <button class="r-btn-sm" onclick="rNav(\'r-device:' + esc(d.id) + '\')">View</button></div>';
      });
      html += '</div>';
    }

    // ── VIBES errors (existing) ──
    if (RS.unresolvedVibes > 0) {
      html += '<div class="r-alert-section"><div class="r-alert-section-title err"><i class="fa-solid fa-bug"></i> Unresolved VIBES Errors (' + RS.unresolvedVibes + ')</div>' +
        '<div class="r-alert-item err">' + RS.unresolvedVibes + ' error(s) pending resolution.' +
        ' <button class="r-btn-sm" onclick="rNav(\'r-vibes\')">Open VIBES Monitor →</button></div></div>';
    }

    // ── App errors section (loaded separately via rLoadAppErrors) ──
    html += '<div class="r-alert-section">' +
      '<div class="r-alert-section-title err"><i class="fa-solid fa-circle-exclamation"></i> App Errors — All 7 Apps ' +
        '(<span id="ae-count">' + RS.unresolvedAppErrors + '</span> unfixed)</div>' +
      '<div id="ae-results"><div class="r-empty">Click "Refresh Errors" to load</div></div>' +
    '</div>';

    html += '</div>'; // close r-panel
    view.innerHTML = html;
  }

  // Helper: format 48h remaining countdown
  function _fmt48h(ts) {
    if (!ts) return '';
    var d = ts.toDate ? ts.toDate() : new Date(ts.seconds ? ts.seconds * 1000 : ts);
    var deadline = new Date(d.getTime() + 48 * 3600 * 1000);
    var remaining = deadline - Date.now();
    if (remaining <= 0) return '<span class="r-muted-sm">deleting soon…</span>';
    var h = Math.floor(remaining / 3600000);
    var m = Math.floor((remaining % 3600000) / 60000);
    return '<span class="r-muted-sm">auto-delete in ' + h + 'h ' + m + 'm</span>';
  }

  // ── App Errors — detail row helper ────────────────────────────
  function _errDetailRow(label, value) {
    return '<div style="background:rgba(255,255,255,0.02);border:1px solid var(--rc-border,#374151);border-radius:4px;padding:8px 10px">' +
      '<div style="font-size:9px;color:var(--rc-text-dim,#6b7280);letter-spacing:1px;margin-bottom:3px">' + label.toUpperCase() + '</div>' +
      '<div style="font-size:12px;color:var(--rc-text,#f9fafb)">' + value + '</div>' +
    '</div>';
  }

  // ── Toggle expanded error text ──────────────────────────────────
  window.rToggleErrExpand = function(safeId) {
    var shortEl = $r('r-err-short-' + safeId);
    var fullEl  = $r('r-err-full-'  + safeId);
    var togBtn  = $r('r-err-tog-'   + safeId);
    if (!shortEl || !fullEl) return;
    var expanded = fullEl.style.display !== 'none';
    fullEl.style.display  = expanded ? 'none' : '';
    shortEl.style.display = expanded ? '' : 'none';
    if (togBtn) togBtn.textContent = expanded ? '▼ show full' : '▲ collapse';
  };

  // ── Open detail modal for an app error ─────────────────────────
  window.rOpenAppDetails = function(id) {
    var e = _appErrorCache[id];
    if (!e) { rToast('Error not cached — reload list', 'warn'); return; }
    var title  = $r('r-modal-title');
    var body   = $r('r-modal-body');
    var footer = $r('r-modal-footer');
    if (!body) return;

    if (title) title.innerHTML = '<i class="fa-solid fa-bug" style="color:var(--rc-red,#ef4444)"></i> ' +
      esc(e.app_name || 'App Error') + ' &mdash; <code style="font-size:11px">' + esc(e.hostname || '?') + '</code>';

    var isFixed = e.fix_status === 'fixed';
    var statusBadge = isFixed
      ? '<span class="r-badge r-badge-ok">FIXED</span>'
      : '<span class="r-badge r-badge-err">UNFIXED</span>';

    var fullMsg = e.error_msg || '—';

    body.innerHTML =
      // Status + host header
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--rc-border,#374151)">' +
        statusBadge +
        '<strong style="font-size:13px;color:var(--rc-text,#f9fafb)">' + esc(e.app_name || '?') + '</strong>' +
        '<span style="color:var(--rc-text-dim,#9ca3af);font-size:11px">on</span>' +
        '<code style="background:rgba(0,240,255,0.08);padding:2px 7px;border-radius:3px;color:var(--rc-cyan,#06b6d4);font-size:12px">' + esc(e.hostname || '?') + '</code>' +
        '<span style="color:var(--rc-text-dim,#9ca3af);font-size:11px">×' + (e.recur_count || 1) + ' occurrence(s)</span>' +
      '</div>' +

      // Error message block (full, scrollable)
      '<div style="margin-bottom:12px">' +
        '<div style="font-size:10px;color:var(--rc-text-dim,#9ca3af);letter-spacing:1px;margin-bottom:5px;font-weight:600">FULL ERROR MESSAGE</div>' +
        '<pre style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.25);border-radius:4px;padding:10px 12px;margin:0;font-size:11px;color:#fca5a5;white-space:pre-wrap;word-break:break-all;max-height:280px;overflow-y:auto;font-family:\'JetBrains Mono\',Consolas,monospace;line-height:1.5">' + esc(fullMsg) + '</pre>' +
      '</div>' +

      // Root cause
      (e.root_cause ?
        '<div style="margin-bottom:12px">' +
          '<div style="font-size:10px;color:var(--rc-text-dim,#9ca3af);letter-spacing:1px;margin-bottom:5px;font-weight:600">ROOT CAUSE</div>' +
          '<div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:4px;padding:10px 12px;font-size:12px;color:#fcd34d;line-height:1.5">' + esc(e.root_cause) + '</div>' +
        '</div>'
      : '') +

      // Metadata grid
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">' +
        _errDetailRow('Occurrences', (e.recur_count || 1) + 'x') +
        _errDetailRow('Error ID', '<code style="font-size:10px;word-break:break-all">' + esc(e._id || e.id || '?') + '</code>') +
        _errDetailRow('First Seen', fmtTs(e.first_seen)) +
        _errDetailRow('Last Seen', fmtTs(e.last_seen)) +
      '</div>' +

      // Fix info
      (isFixed ?
        '<div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.25);border-radius:4px;padding:10px 12px;font-size:12px">' +
          '<div style="color:var(--rc-green,#10b981);font-weight:700;margin-bottom:4px"><i class="fa-solid fa-circle-check"></i> Marked fixed by ' + esc(e.fixed_by || '?') + ' at ' + fmtTs(e.fixed_at) + '</div>' +
          (e.fix_note ? '<div style="color:#d1fae5;margin-top:4px;font-size:11px">' + esc(e.fix_note) + '</div>' : '') +
        '</div>'
      : '<div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:4px;padding:8px 12px;font-size:11px;color:#fca5a5"><i class="fa-solid fa-clock"></i> Not yet resolved — use the button below to mark as fixed after resolving.</div>');

    var fixId   = esc(e._id || e.id || '');
    var fixHost = esc(e.hostname || '');
    if (footer) footer.innerHTML = !isFixed
      ? '<button style="background:rgba(239,68,68,0.18);border:1px solid rgba(239,68,68,0.6);color:#fca5a5;border-radius:4px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0.5px" onclick="rModalClose();rOpenAppFix(\'' + fixId + '\',\'' + fixHost + '\')"><i class="fa-solid fa-circle-check"></i> Mark as Fixed</button>' +
        '<button class="r-btn-sm" onclick="rModalClose()">Close</button>'
      : '<button class="r-btn-sm" onclick="rModalClose()">Close</button>';

    rModalOpen();
  };

  window.rLoadAppErrors = function() {
    var appFilter = ($r('ae-app-filter')  || {}).value || '';
    var fixFilter = ($r('ae-fix-filter')  || {}).value;
    if (fixFilter === undefined) fixFilter = 'unfixed';
    var box = $r('ae-results');
    var cntEl = $r('ae-count');
    if (!box) return;
    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Loading…</div>';

    var supaQ = RS.supa.from('app_errors').select('*').order('last_seen', { ascending: false }).limit(100);
    if (fixFilter) supaQ = supaQ.eq('fix_status', fixFilter);
    if (appFilter) supaQ = supaQ.eq('app_name', appFilter);

    supaQ.then(function(res) {
      if (res.error) { box.innerHTML = errBox(res.error.message); return; }
      var docs = (res.data || []).map(function(d) {
        return Object.assign({ _id: d.id, _host: d.hostname }, d);
      });

      var unfixedCount = docs.filter(function(d) { return d.fix_status === 'unfixed'; }).length;
      if (cntEl) cntEl.textContent = unfixedCount;

      if (!docs.length) { box.innerHTML = '<div class="r-empty">No app errors match</div>'; return; }

      var rows = docs.map(function(e) {
        // Cache for detail modal
        _appErrorCache[e._id] = e;

        var isFixed = e.fix_status === 'fixed';
        var rowCls  = isFixed ? 'r-alert-item ok' : 'r-alert-item err';
        var badge   = isFixed
          ? '<span class="r-badge r-badge-ok">FIXED</span>'
          : '<span class="r-badge r-badge-err">UNFIXED</span>';

        var lifecycle = '';
        if (isFixed && e.fixed_at) {
          lifecycle = _fmt48h(e.fixed_at);
        } else if (!isFixed && e.last_seen) {
          var ls = new Date(e.last_seen);
          if (Date.now() - ls > 24 * 3600 * 1000) lifecycle = _fmt48h(e.last_seen);
        }

        var firstSeen = fmtTs(e.first_seen);
        var lastSeen  = fmtTs(e.last_seen);

        // Collapsible error message block
        var msgLines = (e.error_msg || '').split('\n');
        var shortMsg = msgLines.slice(0, 2).join('\n');
        var hasMore  = msgLines.length > 2;
        var safeId   = String(e._id).replace(/[^a-zA-Z0-9_-]/g, '_');

        var errorBlock =
          '<div style="margin-top:8px">' +
            '<pre id="r-err-short-' + safeId + '" style="margin:0;font-size:11px;color:#fca5a5;white-space:pre-wrap;word-break:break-all;font-family:\'JetBrains Mono\',Consolas,monospace;background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.15);border-radius:3px;padding:6px 8px;line-height:1.5">' + esc(shortMsg) + '</pre>' +
            (hasMore ? '<pre id="r-err-full-' + safeId + '" style="display:none;margin:0;font-size:11px;color:#fca5a5;white-space:pre-wrap;word-break:break-all;font-family:\'JetBrains Mono\',Consolas,monospace;background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.15);border-radius:3px;padding:6px 8px;line-height:1.5">' + esc(e.error_msg || '') + '</pre>' : '') +
            (hasMore ? '<button id="r-err-tog-' + safeId + '" onclick="rToggleErrExpand(\'' + safeId + '\')" style="background:none;border:none;color:var(--rc-text-dim,#9ca3af);font-size:10px;cursor:pointer;padding:3px 0 0;letter-spacing:0.5px;font-family:inherit">▼ show full (' + (msgLines.length - 2) + ' more lines)</button>' : '') +
          '</div>';

        // Action buttons
        var detailBtn = '<button onclick="rOpenAppDetails(\'' + esc(e._id) + '\')" style="background:rgba(0,240,255,0.08);border:1px solid rgba(0,240,255,0.3);color:var(--rc-cyan,#06b6d4);border-radius:4px;padding:5px 11px;font-size:11px;cursor:pointer;font-family:inherit;white-space:nowrap" onmouseover="this.style.background=\'rgba(0,240,255,0.16)\'" onmouseout="this.style.background=\'rgba(0,240,255,0.08)\'"><i class="fa-solid fa-magnifying-glass"></i> Details</button>';
        var fixBtn = !isFixed
          ? '<button onclick="rOpenAppFix(\'' + esc(e._id) + '\',\'' + esc(e._host) + '\')" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.5);color:#fca5a5;border-radius:4px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap" onmouseover="this.style.background=\'rgba(239,68,68,0.28)\'" onmouseout="this.style.background=\'rgba(239,68,68,0.15)\'"><i class="fa-solid fa-circle-check"></i> Mark Fixed</button>'
          : '<span style="font-size:11px;color:var(--rc-green,#10b981)"><i class="fa-solid fa-circle-check"></i> Fixed by ' + esc(e.fixed_by || '?') + '</span>';

        return '<div class="' + rowCls + '" style="flex-direction:column;align-items:flex-start;gap:6px;padding:12px 16px">' +
          // Header row: badge, app, hostname, count, lifecycle, action buttons
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%">' +
            badge +
            '<strong style="font-size:13px">' + esc(e.app_name || '?') + '</strong>' +
            '<span class="r-muted-sm">on</span>' +
            '<code style="background:rgba(0,240,255,0.08);padding:2px 7px;border-radius:3px;color:var(--rc-cyan,#06b6d4);font-size:12px">' + esc(e._host) + '</code>' +
            '<span class="r-muted-sm">×' + (e.recur_count || 1) + '</span>' +
            lifecycle +
            '<div style="margin-left:auto;display:flex;gap:6px;align-items:center;flex-shrink:0">' + detailBtn + fixBtn + '</div>' +
          '</div>' +
          // Root cause — highlighted if present
          (e.root_cause ? '<div style="font-size:11px;background:rgba(245,158,11,0.08);border-left:2px solid rgba(245,158,11,0.6);padding:4px 8px;border-radius:0 3px 3px 0;color:#fcd34d"><i class="fa-solid fa-circle-exclamation"></i> ' + esc(e.root_cause) + '</div>' : '') +
          // Collapsible error message
          errorBlock +
          // Timestamps
          '<div class="r-muted-sm" style="font-size:10px">First: ' + firstSeen + ' &nbsp;|&nbsp; Last: ' + lastSeen + '</div>' +
        '</div>';
      }).join('');
      box.innerHTML = rows;
    }).catch(function(err) { box.innerHTML = errBox(err.message); });
  };

  window.rOpenAppFix = function(docId, hostname) {
    var body   = $r('r-modal-body');
    var footer = $r('r-modal-footer');
    var title  = $r('r-modal-title');
    if (!body) return;
    if (title) title.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--rc-green,#10b981)"></i> Mark as Fixed';
    body.innerHTML =
      '<div class="r-fix-form">' +
        '<div class="r-fix-field">' +
          '<label style="font-size:11px;color:var(--rc-text-dim,#9ca3af);letter-spacing:0.5px">FIX NOTE <span style="color:#ef4444">*</span> <span style="opacity:0.6">(min 5 chars)</span></label>' +
          '<textarea id="r-appfix-note" rows="5" class="r-textarea" placeholder="Describe what was done to resolve this issue…" style="width:100%;box-sizing:border-box;margin-top:6px"></textarea>' +
        '</div>' +
        '<div style="margin-top:10px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:4px;font-size:11px;color:var(--rc-text-dim,#9ca3af)">' +
          '<div><i class="fa-solid fa-server"></i> Device: <code>' + esc(hostname) + '</code></div>' +
          '<div style="margin-top:4px"><i class="fa-solid fa-fingerprint"></i> Error ID: <code style="font-size:10px">' + esc(docId) + '</code></div>' +
          '<div style="margin-top:6px;color:rgba(245,158,11,0.7)"><i class="fa-solid fa-clock"></i> This error will be auto-deleted 48h after marking as fixed.</div>' +
        '</div>' +
      '</div>';
    if (footer) footer.innerHTML =
      '<button class="r-btn-primary" onclick="rSubmitAppFix(\'' + esc(docId) + '\',\'' + esc(hostname) + '\')"><i class="fa-solid fa-circle-check"></i> Confirm Fixed</button>' +
      '<button class="r-btn-sm" onclick="rModalClose()">Cancel</button>';
    rModalOpen();
  };

  window.rSubmitAppFix = function(docId, hostname) {
    var note = ($r('r-appfix-note') || {}).value || '';
    if (note.trim().length < 5) { rToast('Fix note must be at least 5 characters', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    var user = RS.currentUser;
    RS.supa.from('app_errors').update({
      fix_status: 'fixed',
      fix_note:   note.trim(),
      fixed_by:   user ? user.email : 'admin',
      fixed_at:   new Date().toISOString()
    }).eq('id', docId).then(function(res) {
      if (res.error) { rToast('Error: ' + res.error.message, 'error'); return; }
      rToast('Marked as fixed — auto-deletes in 48h', 'success');
      rModalClose();
      rLoadAppErrors();
    }).catch(function(err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── RELEASE MANAGEMENT ────────────────────────────────────
  function renderReleaseMgmt() {
    var view = $r('r-view-area');
    if (!view) return;

    // Load current settings first, then render
    if (!RS.supa) {
      view.innerHTML = '<div class="r-panel"><div class="r-empty">Supabase not ready</div></div>';
      return;
    }

    RS.supa.from('app_settings').select('*').limit(1).then(function(res) {
      var cur = (res.data || [])[0] || {};
      var curVer    = cur.latest_version || '—';
      var curUrl    = cur.update_url     || '';
      var curNotes  = cur.release_notes  || '';
      var curSched  = cur.scheduled_at   || '';
      var curBy     = cur.released_by    || '—';
      var curTime   = cur.updated_at     ? fmtTs(cur.updated_at) : '—';

      // Format scheduled for datetime-local input
      var schedLocal = '';
      if (curSched) {
        try {
          var d = new Date(curSched);
          schedLocal = new Date(d.getTime() - d.getTimezoneOffset()*60000)
            .toISOString().slice(0,16);
        } catch(e) {}
      }

      // Status badge
      var now = new Date();
      var statusBadge = '';
      if (curSched) {
        var schedD = new Date(curSched);
        statusBadge = schedD > now
          ? '<span class="r-badge r-badge-warn"><i class="fa-solid fa-clock"></i> Scheduled: ' + fmtTs(curSched) + '</span>'
          : '<span class="r-badge r-badge-green"><i class="fa-solid fa-check"></i> Released</span>';
      } else if (curVer !== '—') {
        statusBadge = '<span class="r-badge r-badge-green"><i class="fa-solid fa-check"></i> Live</span>';
      }

      view.innerHTML =
        '<div class="r-panel">' +
          '<div class="r-panel-hdr">' +
            '<h3><i class="fa-solid fa-rocket"></i> Release Management</h3>' +
          '</div>' +

          // Current release card
          '<div class="r-fix-form" style="margin-bottom:24px;background:var(--rc-bg2);border-radius:8px;padding:18px">' +
            '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' +
              '<div style="display:flex;flex-direction:column;line-height:1.1">' +
                '<span style="font-size:9px;font-weight:600;color:var(--rc-text-dim);text-transform:uppercase;letter-spacing:0.08em">version</span>' +
                '<span style="font-size:34px;font-weight:700;color:var(--cyan)">' + esc(curVer) + '</span>' +
              '</div>' +
              statusBadge +
            '</div>' +
            '<div class="r-muted-sm">Released by: <b id="r-released-by-txt">' + esc(curBy) + '</b> &nbsp;·&nbsp; ' + curTime + '</div>' +
            (curNotes ? '<div class="r-muted-sm" style="margin-top:4px">' + esc(curNotes) + '</div>' : '') +
          '</div>' +

          // SMTP config card
          '<div class="r-panel-hdr" style="margin-top:0"><h3><i class="fa-solid fa-envelope-open-text"></i> SMTP Config (Contact Admin Email)</h3></div>' +
          '<div class="r-fix-form" style="margin-bottom:24px">' +
            '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
              '<div class="r-fix-field" style="flex:1;min-width:200px">' +
                '<label>Gmail Address</label>' +
                '<input id="smtp-email" class="r-filter-input" style="width:100%" placeholder="it.rasumigroup@gmail.com" value="' + esc(cur.smtp_email || 'it.rasumigroup@gmail.com') + '">' +
              '</div>' +
              '<div class="r-fix-field" style="flex:1;min-width:200px">' +
                '<label>Gmail App Password <span class="r-muted-sm">(16-char, from Google Account → App Passwords)</span></label>' +
                '<input id="smtp-pass" type="password" class="r-filter-input" style="width:100%" placeholder="••••••••••••••••" value="' + esc(cur.smtp_app_password || '') + '">' +
              '</div>' +
            '</div>' +
            '<div style="margin-top:8px;display:flex;gap:10px;align-items:center">' +
              '<button class="r-btn-sm" onclick="rSaveSmtp()"><i class="fa-solid fa-floppy-disk"></i> Save SMTP</button>' +
              '<span class="r-muted-sm" style="font-size:10px">Saved credentials are fetched by all machines — no env var needed</span>' +
            '</div>' +
          '</div>' +

          // Publish new release form
          (function() {
            var parts   = (curVer || '').split('.');
            var nextVer = (parts.length >= 2)
              ? parts[0] + '.' + (parseInt(parts[1] || '0') + 1)
              : '';
            return (
              '<div class="r-panel-hdr" style="margin-top:0"><h3>Publish New Release</h3></div>' +
              '<div class="r-fix-form">' +
                '<div class="r-fix-field">' +
                  '<div id="rel-version-warn" style="font-size:10px;color:#ef4444;margin-bottom:4px;font-family:monospace;display:none;"></div>' +
                  '<label>New Version <span class="r-required">*</span></label>' +
                  '<input id="rel-version" class="r-filter-input" placeholder="e.g. ' + esc(nextVer) + '" style="width:160px" value="" oninput="rClearFieldWarn(\'rel-version-warn\')">' +
                '</div>' +
                '<div class="r-fix-field">' +
                  '<label>Current URL</label>' +
                  '<input id="rel-cur-url" class="r-filter-input" style="width:100%;opacity:0.55;cursor:default" readonly value="' + esc(curUrl || '—') + '">' +
                '</div>' +
                '<div class="r-fix-field">' +
                  '<div id="rel-url-warn" style="font-size:10px;color:#ef4444;margin-bottom:4px;font-family:monospace;display:none;"></div>' +
                  '<label>New Version URL <span class="r-required">*</span></label>' +
                  '<input id="rel-url" class="r-filter-input" style="width:100%" placeholder="https://drive.usercontent.google.com/download?id=..." value="" oninput="rClearFieldWarn(\'rel-url-warn\')">' +
                '</div>'
            );
          })() +
            '<div class="r-fix-field">' +
              '<label>Release Notes</label>' +
              '<textarea id="rel-notes" rows="3" class="r-textarea" placeholder="What\'s new in this version…"></textarea>' +
            '</div>' +
            '<div class="r-fix-field">' +
              '<label><i class="fa-solid fa-clock"></i> Scheduled Release Time <span class="r-muted-sm">(optional — leave empty to release immediately)</span></label>' +
              '<input id="rel-sched" type="datetime-local" class="r-filter-input" style="width:260px" value="">' +
              '<div class="r-muted-sm" style="margin-top:4px">If set, apps will only trigger update after this time. Apps check every 30 minutes.</div>' +
            '</div>' +
            '<div style="display:flex;gap:10px;margin-top:8px">' +
              '<button class="r-btn-primary" onclick="rPublishRelease()"><i class="fa-solid fa-rocket"></i> Publish Release</button>' +
              '<button class="r-btn-sm" onclick="rCancelScheduled()" title="Remove scheduled time and release immediately">Cancel Schedule</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      // If released_by is an email (old format), async-resolve to role+nickname
      if (curBy.includes('@') && RS.supa) {
        RS.supa.from('admin_users').select('role,nickname').eq('email', curBy).single()
          .then(function(res) {
            if (res.error || !res.data) return;
            var nick  = res.data.nickname || '';
            var role  = res.data.role === 'superadmin' ? 'Super Admin' : 'Admin';
            var label = nick ? (role + ' ' + nick) : curBy;
            var el    = document.getElementById('r-released-by-txt');
            if (el) el.textContent = label;
          }).catch(function() {});
      }

    }).catch(function(err) {
      view.innerHTML = '<div class="r-panel">' + errBox('Failed to load: ' + err.message) + '</div>';
    });
  }

  // ── Inline field warning helpers ───────────────────────────────
  window.rShowFieldWarn = function(id, msg) {
    var el = document.getElementById(id);
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  };
  window.rClearFieldWarn = function(id) {
    var el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.textContent = ''; }
  };

  window.rPublishRelease = function() {
    var version = ($r('rel-version') || {}).value || '';
    var url     = ($r('rel-url')     || {}).value || '';
    var notes   = ($r('rel-notes')   || {}).value || '';
    var sched   = ($r('rel-sched')   || {}).value || '';
    var curUrl  = ($r('rel-cur-url') || {}).value || '';

    // ── Version validation ──────────────────────────────────────
    if (!version.trim()) {
      rShowFieldWarn('rel-version-warn', '⚠ field cannot be empty — drop a version number');
      return;
    }
    if (!/^\d+\.\d+$/.test(version.trim())) {
      rShowFieldWarn('rel-version-warn', '⚠ invalid format — numeric only: 9.7, 10.0, 2.1');
      return;
    }

    // ── URL validation ──────────────────────────────────────────
    if (!url.trim()) {
      rShowFieldWarn('rel-url-warn', '⚠ paste the download URL to proceed');
      return;
    }
    if (url.trim() === curUrl.trim() || url.trim() === '—') {
      rShowFieldWarn('rel-url-warn', '⚠ url already live — drop a new link for this release');
      return;
    }
    if (!url.includes('drive')) {
      rShowFieldWarn('rel-url-warn', '⚠ must be a google drive link');
      return;
    }

    var user = RS.currentUser;
    var payload = {
      latest_version: version.trim(),
      update_url:     url.trim(),
      release_notes:  notes.trim() || null,
      released_by:    (function() {
        var nick = RS.userNickname || '';
        var isSA = user && user.email && user.email.toLowerCase() === _SUPER_ADMIN_EMAIL;
        var role = isSA ? 'Super Admin' : 'Admin';
        return nick ? (role + ' ' + nick) : (user ? user.email : 'admin');
      })(),
      scheduled_at:   sched ? new Date(sched).toISOString() : null,
      updated_at:     new Date().toISOString()
    };

    var schedMsg = sched
      ? 'Scheduled for ' + new Date(sched).toLocaleString('ms-MY', { hour12: false })
      : 'Releasing immediately to all machines';



    payload.id = 1; // ensure upsert targets the singleton row
    RS.supa.from('app_settings').upsert(payload, { onConflict: 'id' }).then(function(res) {
      if (res.error) { rToast('Error: ' + res.error.message, 'error'); return; }
      rToast(
        sched
          ? 'Release scheduled for v' + version.trim()
          : 'v' + version.trim() + ' released — all machines will update on next check!',
        'success'
      );
      renderReleaseMgmt();
    }).catch(function(err) { rToast('Error: ' + err.message, 'error'); });
  };

  window.rCancelScheduled = function() {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not available', 'error'); return; }
    RS.supa.from('app_settings')
      .update({ scheduled_at: null, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .then(function(res) {
        if (res.error) { rToast('Error: ' + res.error.message, 'error'); return; }
        rToast('Schedule cancelled — release is now live', 'success');
        renderReleaseMgmt();
      }).catch(function(err) { rToast('Error: ' + err.message, 'error'); });
  };

  window.rSaveSmtp = function() {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not available', 'error'); return; }
    var email = ($r('smtp-email') || {}).value || '';
    var pass  = ($r('smtp-pass')  || {}).value || '';
    if (!email || !email.includes('@')) { rToast('Enter valid Gmail address', 'warn'); return; }
    if (!pass || pass.length < 8)       { rToast('App Password too short', 'warn'); return; }
    RS.supa.from('app_settings').update({
      smtp_email:        email.trim(),
      smtp_app_password: pass.trim()
    }).eq('id', 1).then(function(res) {
      if (res.error) { rToast('Error: ' + res.error.message, 'error'); return; }
      rToast('SMTP credentials saved — all machines will use this on next request', 'success');
    }).catch(function(err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── Compress image to 150x150 JPEG base64 ─────────────────────
  function _compressAvatar(file, cb) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var SIZE = 150;
        var canvas = document.createElement('canvas');
        canvas.width = SIZE; canvas.height = SIZE;
        var ctx = canvas.getContext('2d');
        var s = Math.min(img.width, img.height);
        var sx = (img.width - s) / 2;
        var sy = (img.height - s) / 2;
        ctx.drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE);
        cb(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ── Populate profile modal with real user info ─────────────────
  function _populateProfileModal() {
    var user = RS.currentUser;
    if (!user) return;
    // Reset spinner
    var sp = document.getElementById('r-avatar-spinner');
    if (sp) sp.style.display = 'none';
    // Set text immediately (no async wait)
    var emailEl = document.getElementById('r-p-email');
    var nameEl  = document.getElementById('r-p-displayname');
    var badge   = document.getElementById('r-p-role-badge');
    var isSA    = (user.email && user.email.toLowerCase() === _SUPER_ADMIN_EMAIL);
    if (emailEl) emailEl.textContent = user.email || '';
    var roleLabel = isSA ? 'SUPER ADMIN' : (_canWrite() ? 'ADMIN · Write' : 'ADMIN · Read-only');
    if (nameEl)  nameEl.textContent  = RS.userNickname || (isSA ? 'SUPER ADMIN' : 'ADMIN');
    if (badge)   badge.textContent   = roleLabel;
    // Load avatar + nickname from Supabase (async)
    if (RS.supa && user.email) {
      RS.supa.from('admin_users').select('profile_img,nickname').eq('email', user.email).single().then(function(res) {
        if (!res.error && res.data) {
          if (res.data.profile_img) {
            var imgEl = document.getElementById('r-profile-img-display');
            if (imgEl) imgEl.src = res.data.profile_img;
          }
          var nick = res.data.nickname || '';
          var nickInp = document.getElementById('r-p-nickname');
          if (nickInp) nickInp.value = nick;
          if (nick) {
            if (nameEl) nameEl.textContent = nick;
            RS.userNickname = nick;
          }
        }
      }).catch(function() {});
    }
  }

  // ── 2FA Management ─────────────────────────────────────────────
  window.rLoad2FAStatus = function() {
    var statusEl  = document.getElementById('r-2fa-status');
    var btnSetup  = document.getElementById('btn-r-setup-2fa');
    var btnRemove = document.getElementById('btn-r-remove-2fa');
    if (!RS.supa) return;
    RS.supa.auth.mfa.listFactors().then(function(res) {
      var factors = res.data || {};
      var verified = (factors.totp || []).filter(function(f) { return f.status === 'verified'; });
      if (verified.length > 0) {
        window._r2faFactorId = verified[0].id;
        if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-shield-check" style="color:#22c55e"></i> <span style="color:#22c55e">Enabled</span> <span style="color:#6b7280;font-size:9px;">(TOTP)</span>';
        if (btnSetup)  btnSetup.style.display  = 'none';
        if (btnRemove) btnRemove.style.display = 'block';
      } else {
        window._r2faFactorId = null;
        if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-shield-exclamation" style="color:#f59e0b"></i> <span style="color:#f59e0b">Not enabled</span>';
        if (btnSetup)  btnSetup.style.display  = 'block';
        if (btnRemove) btnRemove.style.display = 'none';
      }
    }).catch(function() {
      if (statusEl) statusEl.textContent = 'Could not load 2FA status.';
    });
  };

  window.rSetup2FA = function() {
    if (!RS.supa) return;
    var btnSetup  = document.getElementById('btn-r-setup-2fa');
    var enrollEl  = document.getElementById('r-2fa-enroll');
    var qrEl      = document.getElementById('r-2fa-qr');
    var secretEl  = document.getElementById('r-2fa-secret');
    if (btnSetup) { btnSetup.textContent = 'Setting up…'; btnSetup.disabled = true; }
    RS.supa.auth.mfa.enroll({ factorType: 'totp', issuer: 'Rasumi Admin', friendlyName: 'Authenticator' })
      .then(function(res) {
        if (res.error) { rToast('2FA setup error: ' + res.error.message, 'error'); if (btnSetup) { btnSetup.textContent = 'ENABLE 2FA (TOTP)'; btnSetup.disabled = false; } return; }
        window._r2faEnrollId = res.data.id;
        if (qrEl)     qrEl.src = res.data.totp.qr_code;
        if (secretEl) secretEl.textContent = res.data.totp.secret;
        if (enrollEl) enrollEl.style.display = 'block';
        if (btnSetup) btnSetup.style.display = 'none';
        setTimeout(function() { var c = document.getElementById('r-2fa-verify-code'); if (c) c.focus(); }, 150);
      }).catch(function(e) {
        rToast('2FA error: ' + e.message, 'error');
        if (btnSetup) { btnSetup.textContent = 'ENABLE 2FA (TOTP)'; btnSetup.disabled = false; }
      });
  };

  window.rVerify2FA = function() {
    if (!RS.supa || !window._r2faEnrollId) { rToast('Enrollment session expired. Try again.', 'error'); return; }
    var codeEl = document.getElementById('r-2fa-verify-code');
    var code   = (codeEl ? codeEl.value : '').replace(/\s/g, '');
    if (!code || code.length !== 6) { rToast('Enter the 6-digit code', 'warn'); return; }
    RS.supa.auth.mfa.challenge({ factorId: window._r2faEnrollId })
      .then(function(res) {
        if (res.error) { rToast('Challenge error: ' + res.error.message, 'error'); return; }
        return RS.supa.auth.mfa.verify({ factorId: window._r2faEnrollId, challengeId: res.data.id, code: code });
      }).then(function(res) {
        if (!res) return;
        if (res.error) { rToast('Invalid code — ' + res.error.message, 'error'); return; }
        rToast('2FA activated! Use your authenticator app on next login.', 'success');
        var enrollEl = document.getElementById('r-2fa-enroll');
        if (enrollEl) enrollEl.style.display = 'none';
        if (codeEl)   codeEl.value = '';
        window._r2faEnrollId = null;
        window.rLoad2FAStatus();
      }).catch(function(e) { rToast('Error: ' + e.message, 'error'); });
  };

  window.rCancel2FA = function() {
    if (window._r2faEnrollId && RS.supa) {
      RS.supa.auth.mfa.unenroll({ factorId: window._r2faEnrollId }).catch(function() {});
      window._r2faEnrollId = null;
    }
    var enrollEl = document.getElementById('r-2fa-enroll');
    if (enrollEl) enrollEl.style.display = 'none';
    var btnSetup = document.getElementById('btn-r-setup-2fa');
    if (btnSetup) { btnSetup.textContent = 'ENABLE 2FA (TOTP)'; btnSetup.disabled = false; btnSetup.style.display = 'block'; }
  };

  window.rRemove2FA = function() {
    if (!window._r2faFactorId || !RS.supa) { rToast('No 2FA factor found', 'warn'); return; }
    if (!confirm('Disable 2FA? You will only need your password to log in.')) return;
    RS.supa.auth.mfa.unenroll({ factorId: window._r2faFactorId })
      .then(function(res) {
        if (res.error) { rToast('Error: ' + res.error.message, 'error'); return; }
        rToast('2FA disabled.', 'success');
        window._r2faFactorId = null;
        window.rLoad2FAStatus();
      }).catch(function(e) { rToast('Error: ' + e.message, 'error'); });
  };

  // ── Logout ─────────────────────────────────────────────────────
  window.rLogout = function() {
    if (RS && RS.supa) {
      RS.supa.auth.signOut().then(function() { location.reload(); }).catch(function() { location.reload(); });
    } else {
      location.reload();
    }
  };

  // ── Open profile modal (called from inline onclick) ────────────
  window.rOpenProfile = function() {
    var nav = document.getElementById('r-nav-dropdown');
    if (nav) nav.classList.add('hidden');
    var modal = document.getElementById('r-profile-modal');
    if (modal) modal.classList.remove('hidden');
    _populateProfileModal();
    if (typeof window.rLoad2FAStatus === 'function') window.rLoad2FAStatus();
  };

  window.rToggleProfileEdit = function() {
    var panel = document.getElementById('r-p-edit-panel');
    if (!panel) return;
    var open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    if (!open) {
      // Pre-fill current values
      var nickInp  = document.getElementById('r-p-nickname');
      var emailInp = document.getElementById('r-p-edit-email');
      if (nickInp)  nickInp.value  = RS.userNickname || '';
      if (emailInp) emailInp.value = (RS.currentUser && RS.currentUser.email) || '';
      if (nickInp)  nickInp.focus();
    }
  };

  window.rSaveProfile = function() {
    if (!RS.supa || !RS.currentUser) return;
    var nickInp  = document.getElementById('r-p-nickname');
    var emailInp = document.getElementById('r-p-edit-email');
    var nick     = nickInp  ? nickInp.value.trim()  : '';
    var newEmail = emailInp ? emailInp.value.trim().toLowerCase() : '';
    var curEmail = RS.currentUser.email || '';
    var changed  = false;

    // ── 1. Nickname change ────────────────────────────────────────
    if (nick && nick !== RS.userNickname) {
      RS.supa.from('admin_users').update({ nickname: nick }).eq('email', curEmail)
        .then(function(res) {
          if (res.error) { rToast('Nickname error: ' + res.error.message, 'error'); return; }
          RS.userNickname = nick;
          var nameEl = document.getElementById('r-p-displayname');
          if (nameEl) nameEl.textContent = nick;
          rToast('Nickname saved: ' + nick, 'success');
        }).catch(function(e) { rToast('Error: ' + e.message, 'error'); });
      changed = true;
    }

    // ── 2. Email change ───────────────────────────────────────────
    if (newEmail && newEmail !== curEmail) {
      if (!newEmail.includes('@')) { rToast('Invalid email address', 'warn'); return; }
      RS.supa.auth.updateUser({ email: newEmail }).then(function(res) {
        if (res.error) { rToast('Email error: ' + res.error.message, 'error'); return; }
        // Store pending_email in admin_users — auth handler resolves after confirmation
        RS.supa.from('admin_users').update({ pending_email: newEmail }).eq('email', curEmail)
          .then(function() {}).catch(function() {});
        var note = document.getElementById('r-p-email-note');
        if (note) { note.style.display = 'block'; note.textContent = 'Verification sent to ' + newEmail + '. Login email updates after you confirm from that email.'; }
        rToast('Verification sent to ' + newEmail, 'success');
      }).catch(function(e) { rToast('Error: ' + e.message, 'error'); });
      changed = true;
    }

    if (!changed) { rToast('No changes to save', 'warn'); return; }

    // Close panel (after a brief delay so user sees feedback)
    setTimeout(function() {
      var panel = document.getElementById('r-p-edit-panel');
      if (panel) panel.style.display = 'none';
    }, 1800);
  };

  // Keep legacy alias
  window.rSaveNickname = window.rSaveProfile;

  // ── Settings gateway ───────────────────────────────────────────
  window.rOpenSettings = function() {
    if (RS.userRole !== 'superadmin') return;
    var nav = document.getElementById('r-nav-dropdown');
    if (nav) nav.classList.add('hidden');
    var modal = document.getElementById('r-settings-modal');
    if (modal) modal.classList.remove('hidden');
  };

  window.rOpenAdminsFromSettings = function() {
    var sm = document.getElementById('r-settings-modal');
    if (sm) sm.classList.add('hidden');
    var modal = document.getElementById('r-admins-modal');
    if (modal) { modal.classList.remove('hidden'); _loadAdminUsers(); }
  };

  window.rOpenAppUsersFromSettings = function() {
    var sm = document.getElementById('r-settings-modal');
    if (sm) sm.classList.add('hidden');
    var modal = document.getElementById('r-husers-modal');
    if (modal) { modal.classList.remove('hidden'); _loadHospitalUsers(); }
  };

  // ── Open manage admins modal (direct, kept for back-compat) ────
  window.rOpenAdmins = function() {
    var nav = document.getElementById('r-nav-dropdown');
    if (nav) nav.classList.add('hidden');
    var modal = document.getElementById('r-admins-modal');
    if (modal) { modal.classList.remove('hidden'); _loadAdminUsers(); }
  };

  // ── Hospital Users Management ──────────────────────────────────
  var _HOSPITAL_APPS = ['Scanify','Renamer HQ','FV Branch','PDF Splitter','PDF Studio','Quick Rename','Vibes Automation'];

  window.rOpenHospitalUsers = function() {
    if (RS.userRole !== 'superadmin') return;
    var nav = document.getElementById('r-nav-dropdown');
    if (nav) nav.classList.add('hidden');
    var modal = document.getElementById('r-husers-modal');
    if (modal) { modal.classList.remove('hidden'); _loadHospitalUsers(); }
  };

  function _loadHospitalUsers() {
    var list = document.getElementById('r-husers-list');
    if (!list || !RS.supa) return;
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--rc-text-dim,#9ca3af);font-size:12px;"><span class="r-spin"></span> Loading…</div>';
    RS.supa.from('users').select('username,role,status,allowed_apps').order('username').then(function(res) {
      if (res.error) throw new Error(res.error.message);
      if (!res.data || !res.data.length) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--rc-text-dim,#9ca3af);font-size:12px;">No users found</div>';
        return;
      }
      var rows = [];
      res.data.forEach(function(u) {
        var uname    = u.username;
        var role     = u.role || 'VIEWER';
        var status   = u.status || 'ACTIVE';
        var apps     = Array.isArray(u.allowed_apps) ? u.allowed_apps : [];
        var isMaster = (uname === 'mustaqim' || role === 'SUPER_ADMIN');
        var isActive = (status === 'ACTIVE');
        var safeId   = uname.replace(/[^a-z0-9]/gi, '_');

        var roleColor = role === 'SUPER_ADMIN' ? '#06b6d4' : role === 'ADMIN' ? '#8b5cf6' : role === 'BRANCH_USER' ? '#10b981' : '#9ca3af';

        var row = '<div style="padding:14px 0;border-bottom:1px solid var(--rc-border,#1f2937);">';
        // Username + role badge + status toggle
        row += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">';
        row += '<div style="display:flex;align-items:center;gap:8px;">';
        row += '<span style="font-size:12px;color:var(--rc-text,#fff);font-weight:600;">' + esc(uname) + '</span>';
        row += '<span style="font-size:9px;padding:2px 7px;border-radius:10px;border:1px solid ' + roleColor + ';color:' + roleColor + ';letter-spacing:0.5px;">' + esc(role) + '</span>';
        row += '</div>';
        if (isMaster) {
          row += '<span style="font-size:10px;color:var(--rc-cyan,#06b6d4);padding:3px 8px;border:1px solid rgba(0,240,255,0.3);border-radius:10px;">Owner</span>';
        } else {
          var statusStyle = isActive
            ? 'background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.5);color:#10b981;'
            : 'background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);color:#ef4444;';
          var newStatus = isActive ? 'DISABLED' : 'ACTIVE';
          row += '<button onclick="rToggleHospitalUserStatus(\'' + uname.replace(/'/g, "\\'") + '\',\'' + newStatus + '\')" ';
          row += 'style="' + statusStyle + 'padding:3px 10px;border-radius:4px;font-size:10px;cursor:pointer;font-family:inherit;letter-spacing:0.5px;">';
          row += isActive ? '● ACTIVE' : '○ DISABLED';
          row += '</button>';
        }
        row += '</div>';
        // App checkboxes
        row += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:' + (isMaster ? '0' : '10px') + ';">';
        _HOSPITAL_APPS.forEach(function(app) {
          var appId   = 'uapp_' + safeId + '_' + app.replace(/[^a-z0-9]/gi, '_');
          var checked = apps.indexOf(app) !== -1;
          if (isMaster) {
            row += '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--rc-text-dim,#9ca3af);opacity:0.55;cursor:not-allowed;">';
            row += '<input type="checkbox"' + (checked ? ' checked' : '') + ' disabled style="cursor:not-allowed;accent-color:var(--rc-cyan,#06b6d4);"> ' + esc(app);
            row += '</label>';
          } else {
            row += '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--rc-text-dim,#d1d5db);cursor:pointer;">';
            row += '<input type="checkbox" id="' + appId + '"' + (checked ? ' checked' : '') + ' style="cursor:pointer;accent-color:var(--rc-cyan,#06b6d4);"> ' + esc(app);
            row += '</label>';
          }
        });
        row += '</div>';
        if (!isMaster) {
          row += '<button onclick="rSaveUserApps(\'' + uname.replace(/'/g, "\\'") + '\')" ';
          row += 'style="padding:4px 14px;background:var(--rc-cyan,#06b6d4);color:#000;font-weight:700;border:none;border-radius:4px;font-size:10px;cursor:pointer;font-family:inherit;letter-spacing:0.5px;">SAVE APPS</button>';
        }
        row += '</div>';
        rows.push(row);
      });
      list.innerHTML = rows.join('');
    }).catch(function(e) {
      if (list) list.innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;font-size:12px;">Error: ' + esc(e.message || String(e)) + '</div>';
    });
  }

  window.rAddHospitalUser = function() {
    if (RS.userRole !== 'superadmin') return;
    if (!RS.supa) { rToast('Supabase not available', 'error'); return; }
    var unameInp = document.getElementById('r-huser-new-username');
    var roleInp  = document.getElementById('r-huser-new-role');
    var username = unameInp ? unameInp.value.trim().toLowerCase() : '';
    var role     = roleInp  ? roleInp.value : 'BRANCH_USER';
    if (!username) { rToast('Username is required', 'error'); return; }
    if (!/^[a-z0-9_]+$/.test(username)) { rToast('Username: huruf kecil, angka, underscore sahaja', 'error'); return; }
    // Insert new user — password defaults to username (plain text, same as legacy seed pattern)
    RS.supa.from('users').insert({
      username:     username,
      role:         role,
      status:       'ACTIVE',
      allowed_apps: [],
      failed_login_count: 0,
      created_at_utc: new Date().toISOString()
    }).then(function(res) {
      if (res.error) {
        if (res.error.code === '23505') { rToast('Username sudah wujud: ' + username, 'error'); }
        else { throw new Error(res.error.message); }
        return;
      }
      rToast('User added: ' + username + ' (' + role + ')', 'success');
      if (unameInp) unameInp.value = '';
      _loadHospitalUsers();
    }).catch(function(e) { rToast('Error: ' + (e.message || String(e)), 'error'); });
  };

  window.rToggleHospitalUserStatus = function(username, newStatus) {
    if (RS.userRole !== 'superadmin') return;
    if (!RS.supa) { rToast('Supabase not available', 'error'); return; }
    RS.supa.from('users').update({ status: newStatus }).eq('username', username).then(function(res) {
      if (res.error) throw new Error(res.error.message);
      rToast(username + ' → ' + newStatus, newStatus === 'ACTIVE' ? 'success' : 'info');
      _loadHospitalUsers();
    }).catch(function(e) { rToast('Error: ' + (e.message || String(e)), 'error'); });
  };

  window.rSaveUserApps = function(username) {
    if (RS.userRole !== 'superadmin') return;
    if (!RS.supa) { rToast('Supabase not available', 'error'); return; }
    var safeId = username.replace(/[^a-z0-9]/gi, '_');
    var apps = [];
    _HOSPITAL_APPS.forEach(function(app) {
      var appId = 'uapp_' + safeId + '_' + app.replace(/[^a-z0-9]/gi, '_');
      var cb = document.getElementById(appId);
      if (cb && cb.checked) apps.push(app);
    });
    RS.supa.from('users').update({ allowed_apps: apps }).eq('username', username).then(function(res) {
      if (res.error) throw new Error(res.error.message);
      rToast(username + ' — ' + apps.length + '/' + _HOSPITAL_APPS.length + ' apps saved', 'success');
    }).catch(function(e) { rToast('Error: ' + (e.message || String(e)), 'error'); });
  };

  // ── Profile Modal Handlers ────────────────────────────────────
  window.initProfileHandlers = function() {
    // Close buttons
    var btnClose = document.getElementById('btn-close-r-profile');
    var modal    = document.getElementById('r-profile-modal');
    if (btnClose && modal) btnClose.addEventListener('click', function() { modal.classList.add('hidden'); });

    var btnCloseSettings = document.getElementById('btn-close-settings');
    var settingsModal    = document.getElementById('r-settings-modal');
    if (btnCloseSettings && settingsModal) btnCloseSettings.addEventListener('click', function() { settingsModal.classList.add('hidden'); });

    var btnCloseAdmins = document.getElementById('btn-close-admins');
    var adminsModal    = document.getElementById('r-admins-modal');
    if (btnCloseAdmins && adminsModal) btnCloseAdmins.addEventListener('click', function() { adminsModal.classList.add('hidden'); });

    var btnCloseHusers = document.getElementById('btn-close-husers');
    var husersModal    = document.getElementById('r-husers-modal');
    if (btnCloseHusers && husersModal) btnCloseHusers.addEventListener('click', function() { husersModal.classList.add('hidden'); });

    // Avatar: immediate upload on file select → compress → save to Supabase
    var imgDisplay = document.getElementById('r-profile-img-display');
    var imgUpload  = document.getElementById('r-profile-upload');
    var spinner    = document.getElementById('r-avatar-spinner');

    if (imgDisplay && imgUpload) {
      imgDisplay.addEventListener('click', function() { imgUpload.click(); });
      imgUpload.addEventListener('change', function(e) {
        if (!e.target.files || !e.target.files[0]) return;
        var file = e.target.files[0];
        var user = RS.currentUser;
        if (!user || !user.email) { rToast('Not authenticated', 'error'); return; }
        if (!RS.supa) { rToast('Supabase not available', 'error'); return; }
        if (spinner) spinner.style.display = 'flex';
        _compressAvatar(file, function(dataUrl) {
          imgDisplay.src = dataUrl;
          RS.supa.from('admin_users').update({ profile_img: dataUrl }).eq('email', user.email).then(function(res) {
            if (spinner) spinner.style.display = 'none';
            if (res.error) { rToast('Upload failed', 'error'); return; }
            var hImg = document.querySelector('#r-profile-trigger img');
            if (hImg) hImg.src = dataUrl;
            rToast('Photo updated', 'success');
          }).catch(function(err) { if (spinner) spinner.style.display = 'none'; rToast('Error: ' + err.message, 'error'); });
        });
      });
    }

    // Password change — verify current via signIn → updateUser (Supabase Auth)
    var btnPwd = document.getElementById('btn-update-r-profile');
    if (btnPwd) {
      btnPwd.addEventListener('click', function() {
        var currPass = (document.getElementById('r-p-curr-pass')    || {}).value || '';
        var np       = (document.getElementById('r-p-new-pass')     || {}).value || '';
        var cp       = (document.getElementById('r-p-confirm-pass') || {}).value || '';
        var statusEl = document.getElementById('r-p-pass-status');
        function setStatus(msg, col) { if (statusEl) { statusEl.textContent = msg; statusEl.style.color = col || '#9ca3af'; } }
        setStatus('');
        if (!currPass)            { rToast('Enter current password', 'warn'); return; }
        if (!np || np.length < 6) { rToast('New password must be at least 6 characters', 'warn'); return; }
        if (np !== cp)            { rToast('Passwords do not match', 'warn'); return; }
        var user = RS.currentUser;
        if (!user || !user.email) { rToast('Not authenticated', 'error'); return; }
        setStatus('Verifying…', '#9ca3af');
        btnPwd.disabled = true;
        // Step 1: Verify current password
        RS.supa.auth.signInWithPassword({ email: user.email, password: currPass })
          .then(function(r) {
            if (r.error) { var e = new Error(r.error.message); e.isWrongPass = true; throw e; }
            setStatus('Updating password…', '#9ca3af');
            // Step 2: Update Supabase Auth password
            return RS.supa.auth.updateUser({ password: np });
          })
          .then(function(r) {
            if (r.error) throw new Error(r.error.message);
            // Password updated in Supabase Auth (bcrypt) — no plaintext sync
            rToast('Password updated', 'success');
            setStatus('');
            btnPwd.disabled = false;
            document.getElementById('r-p-curr-pass').value    = '';
            document.getElementById('r-p-new-pass').value     = '';
            document.getElementById('r-p-confirm-pass').value = '';
          })
          .catch(function(err) {
            btnPwd.disabled = false;
            if (err.isWrongPass || (err.message && err.message.toLowerCase().includes('invalid'))) {
              rToast('Current password is incorrect', 'error');
              setStatus('Current password is incorrect', '#ef4444');
            } else {
              rToast('Error: ' + err.message, 'error');
              setStatus(err.message, '#ef4444');
            }
          });
      });
    }
  };

})();
