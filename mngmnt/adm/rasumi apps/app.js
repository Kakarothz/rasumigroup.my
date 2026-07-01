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
  var RASUMI_SUPABASE_URL = 'https://seqlkwdghibmsfkbuwqq.supabase.co';
  var RASUMI_SUPABASE_ANON_KEY = 'sb_publishable_BotuzQAIly3eTShpQ_Lmtg_Y9_QlyDp';
  // ──────────────────────────────────────────────────────────

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
    db: null,   // rasumi-apps Firestore (Firebase)
    supa: null,   // Supabase client (Fasa 3+)
    auth: null,   // shared auth from app.js
    fbApp: null,   // second Firebase app instance
    route: 'r-dashboard',
    listeners: [],
    devices: {},
    unresolvedVibes: 0,
    unresolvedRenamer: 0,
    unresolvedVims: 0,
    unresolvedAppErrors: 0,
    appStats: {},     // keyed by app key → { today: N, errors: N, last_seen: ts }
    runsToday: 0,     // global session count today (same logic as Log Explorer)
    failedToday: 0,     // global failed-session count today
    clockTick: null,
    initialized: false,
    configOk: false,
    userRole: 'admin',    // 'superadmin' | 'admin'
    canWrite: false,      // true = write allowed for this session
    // New: telemetry state
    _selectedDevice: null,   // hostname of selected node in dashboard
    _terminal: [],         // live stream lines
    _charts: {},         // Chart.js instances
    _logCache: [],         // log entries for modal
    _recentLogs: [],         // recent logs for activity feed
    _onlineFrom: {}          // hostname → ms timestamp when device entered 'online'
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

  // ── Modal open/close (r-modal-overlay) ───────────────────────
  window.rModalOpen = function () {
    var o = $r('r-modal-overlay');
    if (o) o.classList.remove('hidden');
  };
  window.rModalClose = function (e) {
    if (e && e.target !== $r('r-modal-overlay')) return;
    var o = $r('r-modal-overlay');
    if (o) o.classList.add('hidden');
  };

  // ── Custom prompt dialog — ganti window.prompt() ───────────────
  // rPrompt({ title, label, placeholder, icon, confirmText, onConfirm, onCancel })
  // onConfirm(value) dipanggil dengan nilai input; onCancel() bila cancel/escape.
  window.rPrompt = function (opts) {
    var ov = $r('r-prompt-overlay');
    var inp = $r('r-prompt-input');
    var title = $r('r-prompt-title');
    var label = $r('r-prompt-label');
    var icon = $r('r-prompt-icon');
    var btn = $r('r-prompt-confirm-btn');
    if (!ov || !inp) return;
    if (title) title.textContent = opts.title || '';
    if (label) label.textContent = opts.label || 'Note (optional)';
    if (icon) icon.innerHTML = opts.icon ? '<i class="fa-solid ' + opts.icon + '"></i>' : '';
    if (btn) btn.textContent = opts.confirmText || 'Confirm';
    inp.placeholder = opts.placeholder || '';
    inp.value = '';
    ov.style.display = 'flex';
    setTimeout(function () { inp.focus(); }, 80);

    window._rPromptConfirm = function () {
      ov.style.display = 'none';
      if (opts.onConfirm) opts.onConfirm(inp.value.trim());
    };
    window._rPromptCancel = function () {
      ov.style.display = 'none';
      if (opts.onCancel) opts.onCancel();
    };
  };

  // Cache for detail modal lookups (populated by rLoadAppErrors)
  var _appErrorCache = {};

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

  // Maps login/branch IDs → human display name used in Log Explorer + Device Fleet
  var _BRANCH_MAP = {
    'rasumihq': 'HQ',
    'rasumifvkl': 'FVKL',
    'rasumifvt': 'FVT',
    'rasumifvl': 'FVL',
    'rasumifvg': 'FVG',
    'admin': 'ADMIN',
    'mustaqim': 'SUPER ADMIN',
    'super admin': 'SUPER ADMIN'   // agent may log display name instead of login id
  };
  function _branchName(id) {
    if (!id) return '—';
    return _BRANCH_MAP[(id || '').toLowerCase()] || id;
  }

  // Format elapsed ms as counting-up uptime: 0s → 59s → 1m 0s → 59m 59s → 1h 0m 0s …
  function fmtUptime(ms) {
    var s = Math.floor(Math.max(ms, 0) / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60), rs = s % 60;
    if (m < 60) return m + 'm ' + rs + 's';
    var h = Math.floor(m / 60), rm = m % 60;
    return h + 'h ' + rm + 'm ' + (s % 60) + 's';
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

  // Rasumi Apps status: check is_online/status field first, then timestamp.
  // is_online=false or status=OFFLINE means the app explicitly marked itself offline —
  // trust that regardless of how recent the timestamp is (avoids false ONLINE on exit).
  function deviceStatus(data) {
    if (data.is_online === false || data.status === 'OFFLINE') return 'offline';
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

  // Record when a device first entered 'online' state; reset on offline/stale.
  // Priority 1: sessionStorage — survives page refresh within same tab, so the timer
  //             continues from where it was (e.g. "1h 20m 54s" stays after F5).
  // Priority 2: last_heartbeat timestamp — fallback on first ever page load.
  // On offline: clears both in-memory and sessionStorage so next online cycle starts fresh.
  function _trackOnlineFrom(hostname, status, heartbeatTs) {
    if (status === 'online') {
      if (!RS._onlineFrom[hostname]) {
        // Try sessionStorage first (preserves timer across F5 refresh)
        var savedMs = null;
        try { savedMs = parseInt(sessionStorage.getItem('rs_on_' + hostname), 10); } catch (e) { }
        if (savedMs && !isNaN(savedMs) && savedMs > 0) {
          RS._onlineFrom[hostname] = savedMs;
        } else {
          // First page load or new online session: use last_heartbeat as approximation
          var refMs = Date.now();
          if (heartbeatTs) {
            try {
              var hbd = heartbeatTs.toDate ? heartbeatTs.toDate()
                : heartbeatTs.seconds ? new Date(heartbeatTs.seconds * 1000)
                  : new Date(heartbeatTs);
              if (!isNaN(hbd.getTime())) refMs = hbd.getTime();
            } catch (e) { }
          }
          RS._onlineFrom[hostname] = refMs;
        }
        // Persist to sessionStorage so next refresh picks it up
        try { sessionStorage.setItem('rs_on_' + hostname, RS._onlineFrom[hostname].toString()); } catch (e) { }
      }
    } else {
      // Device went offline — clear timer so next online session starts fresh
      delete RS._onlineFrom[hostname];
      try { sessionStorage.removeItem('rs_on_' + hostname); } catch (e) { }
    }
  }

  function errBadge(t) {
    var m = {
      guard_exhausted: 'r-badge-err',
      upload_retry_exhausted: 'r-badge-err',
      panic: 'r-badge-err',
      completion_failed: 'r-badge-err',
      batch_incomplete: 'r-badge-warn',
      reconciliation_incomplete: 'r-badge-warn',
      preflight_warn: 'r-badge-warn',
      batch_skip: 'r-badge-muted',
      FAILED: 'r-badge-err',
      ERROR: 'r-badge-err'
    };
    return m[t] || 'r-badge-muted';
  }

  function renameBadge(s) {
    var m = { success: 'r-badge-ok', COMPLETED: 'r-badge-ok', wrong_read: 'r-badge-warn', failed: 'r-badge-err', FAILED: 'r-badge-err', ERROR: 'r-badge-err', skipped: 'r-badge-muted' };
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

      // Pre-fetch app_settings for zero-latency tab loading
      RS.appSettingsCache = null;
      RS.supa.from('app_settings').select('*').order('id', { ascending: true }).limit(1).then(function (res) {
        if (!res.error && res.data) {
          RS.appSettingsCache = res.data[0] || {};
        }
      });

      // Background prefetch all app log tabs 2s after page load.
      // Results stored in window._rsLogCache so every tab opens instantly (no spinner).
      setTimeout(function () {
        if (!RS.supa) return;
        ['Renamer HQ', 'FV Branch', 'PDF Splitter', 'PDF Studio', 'Quick Rename', 'Scanify'].forEach(function (app) {
          _fetchAndCacheAppLogs(app);
        });
      }, 2000);

      return true;
    } catch (e) {
      console.warn('[Rasumi] Supabase init failed:', e.message);
      return false;
    }
  }

  // ── Display Preferences (theme + background) ─────────────────
  var _BG_MAP = {
    'photo': null,   // special — image file
    'dark': '#080c13',
    'navy': 'linear-gradient(135deg,#060d1a,#0d1f35)',
    'purple': 'linear-gradient(135deg,#0b0614,#17082e)',
    'forest': 'linear-gradient(135deg,#040f0a,#0a2016)',
    'ember': 'linear-gradient(135deg,#110608,#200d0a)'
  };

  window.rSetTheme = function (theme) {
    var c = $r('rasumi-container');
    if (c) {
      if (theme === 'light') c.setAttribute('data-theme', 'light');
      else c.removeAttribute('data-theme');
    }
    var darkBtn = $r('r-mode-dark-btn');
    var lightBtn = $r('r-mode-light-btn');
    if (darkBtn) {
      darkBtn.style.background = theme === 'dark' ? 'rgba(56,189,248,0.1)' : 'none';
      darkBtn.style.color = theme === 'dark' ? '#38bdf8' : '#6b7a8f';
      darkBtn.style.borderColor = theme === 'dark' ? 'rgba(56,189,248,0.35)' : 'rgba(255,255,255,0.1)';
    }
    if (lightBtn) {
      lightBtn.style.background = theme === 'light' ? 'rgba(255,255,255,0.1)' : 'none';
      lightBtn.style.color = theme === 'light' ? '#e2e8f0' : '#6b7a8f';
      lightBtn.style.borderColor = theme === 'light' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.1)';
    }
    try { localStorage.setItem('rs_theme', theme); } catch (e) { }
    if (RS.supa) {
      RS.supa.from('app_settings').update({ ui_theme: theme }).eq('id', 1)
        .then(function () { }).catch(function () { });
    }
  };

  window.rSetBackground = function (bg) {
    var bgLayer = document.getElementById('r-bg-layer');
    if (!bgLayer) return;
    if (bg === 'photo') {
      bgLayer.style.background = "url('../assets/background.jpg') center/cover no-repeat";
    } else if (bg === 'custom') {
      var customUrl = localStorage.getItem('rs_bg_custom') || sessionStorage.getItem('rs_bg_custom');
      if (customUrl) bgLayer.style.background = 'url(' + customUrl + ') center/cover no-repeat';
    } else if (_BG_MAP[bg]) {
      bgLayer.style.background = _BG_MAP[bg];
    }
    var opts = document.querySelectorAll('.r-bg-opt');
    for (var i = 0; i < opts.length; i++) {
      opts[i].style.border = opts[i].getAttribute('data-bg') === bg
        ? '2px solid rgba(56,189,248,0.5)' : '2px solid transparent';
    }
    try { localStorage.setItem('rs_bg', bg); } catch (e) { }
    if (RS.supa && bg !== 'custom') {
      RS.supa.from('app_settings').update({ ui_background: bg }).eq('id', 1)
        .then(function () { }).catch(function () { });
    }
  };

  window.rPickCustomBg = function () {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        // Compress imej guna canvas sebelum simpan ke localStorage
        var img = new Image();
        img.onload = function () {
          var maxW = 1920, maxH = 1080;
          var w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          var url = canvas.toDataURL('image/jpeg', 0.75);
          var bgLayer = document.getElementById('r-bg-layer');
          if (bgLayer) bgLayer.style.background = 'url(' + url + ') center/cover no-repeat';
          try {
            localStorage.setItem('rs_bg', 'custom');
            localStorage.setItem('rs_bg_custom', url);
          } catch (e) {
            // Cuba kualiti lebih rendah jika masih terlalu besar
            try {
              url = canvas.toDataURL('image/jpeg', 0.4);
              localStorage.setItem('rs_bg_custom', url);
              if (bgLayer) bgLayer.style.background = 'url(' + url + ') center/cover no-repeat';
            } catch (e2) { }
          }
          var opts = document.querySelectorAll('.r-bg-opt');
          for (var i = 0; i < opts.length; i++) {
            opts[i].style.border = opts[i].getAttribute('data-bg') === 'custom'
              ? '2px solid rgba(56,189,248,0.5)' : '2px solid transparent';
          }
          var customEl = document.querySelector('.r-bg-opt[data-bg="custom"]');
          if (customEl) customEl.style.backgroundImage = 'url(' + url + ')';
          try { localStorage.setItem('rs_bg', 'custom'); } catch (e) { }
          // Sync ke Supabase — semua PC/mobile akan guna wallpaper yang sama
          if (RS.supa) {
            RS.supa.from('app_settings')
              .update({ ui_background: 'custom', ui_custom_bg: url })
              .eq('id', 1)
              .then(function () { }).catch(function () { });
          }
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    };
    inp.click();
  };

  window.rToggleDisplayPanel = function (ev) {
    if (ev) ev.stopPropagation();
    var p = document.getElementById('r-display-panel');
    if (!p) return;
    p.classList.toggle('hidden');
  };

  function _restoreDisplayPrefs() {
    try {
      var theme = localStorage.getItem('rs_theme') || 'dark';
      var bg = localStorage.getItem('rs_bg') || 'photo';
      window.rSetTheme(theme);
      if (bg === 'custom') {
        var customUrl = localStorage.getItem('rs_bg_custom') || sessionStorage.getItem('rs_bg_custom');
        if (customUrl) {
          var bl = document.getElementById('r-bg-layer');
          if (bl) bl.style.background = 'url(' + customUrl + ') center/cover no-repeat';
        }
        // Kalau tiada dalam localStorage: biar dark bg (#0a0f1a) kekal
        // _loadDisplayPrefsFromSupabase akan apply custom bg selepas 300ms
      } else if (bg !== 'photo' || localStorage.getItem('rs_bg') === 'photo') {
        window.rSetBackground(bg);
      }
      // Kalau rs_bg = null/default = 'photo' tapi tiada key dalam localStorage,
      // biar dark bg — elak flash photo.jpg sebelum Supabase load
    } catch (e) { }
  }

  function _loadDisplayPrefsFromSupabase() {
    if (!RS.supa) return;
    RS.supa.from('app_settings')
      .select('ui_theme,ui_background,ui_custom_bg')
      .eq('id', 1)
      .single()
      .then(function (res) {
        if (res.error || !res.data) return;
        var d = res.data;
        // Apply tema
        if (d.ui_theme) {
          window.rSetTheme(d.ui_theme);
          try { localStorage.setItem('rs_theme', d.ui_theme); } catch (e) { }
        }
        // Apply wallpaper
        if (d.ui_background === 'custom' && d.ui_custom_bg) {
          // Hanya apply ke screen kalau tiada cache — elak "resize" bila full quality load
          var _hasBgCache = localStorage.getItem('rs_bg_custom') || sessionStorage.getItem('rs_bg_custom');
          if (!_hasBgCache) {
            var bgLayer = document.getElementById('r-bg-layer');
            if (bgLayer) bgLayer.style.background = 'url(' + d.ui_custom_bg + ') center/cover no-repeat';
          }
          // Cache full quality ke sessionStorage (quota berasingan dari localStorage)
          localStorage.setItem('rs_bg', 'custom');
          try {
            // Cuba simpan terus tanpa compress — full quality
            sessionStorage.setItem('rs_bg_custom', d.ui_custom_bg);
          } catch (e) {
            // sessionStorage penuh — compress sekali sahaja ke 1920x1080 @ 0.85
            (function (srcUrl) {
              var img = new Image();
              img.onload = function () {
                var maxW = 1920, maxH = 1080;
                var w = img.width, h = img.height;
                if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
                if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
                var cv = document.createElement('canvas');
                cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(img, 0, 0, w, h);
                try { sessionStorage.setItem('rs_bg_custom', cv.toDataURL('image/jpeg', 0.85)); } catch (e2) { }
              };
              img.src = srcUrl;
            })(d.ui_custom_bg);
          }
          try { localStorage.setItem('rs_bg_custom', d.ui_custom_bg); } catch (e) { }
          // Update custom thumbnail dalam panel
          var customEl = document.querySelector('.r-bg-opt[data-bg="custom"]');
          if (customEl) customEl.style.backgroundImage = 'url(' + d.ui_custom_bg + ')';
          var opts = document.querySelectorAll('.r-bg-opt');
          for (var i = 0; i < opts.length; i++) {
            opts[i].style.border = opts[i].getAttribute('data-bg') === 'custom'
              ? '2px solid rgba(56,189,248,0.5)' : '2px solid transparent';
          }
        } else if (d.ui_background && d.ui_background !== 'custom') {
          window.rSetBackground(d.ui_background);
          try {
            localStorage.setItem('rs_bg', d.ui_background);
            localStorage.removeItem('rs_bg_custom'); // Bersih custom jika dah tukar ke lain
          } catch (e) { }
        }
      }).catch(function () { });
  }

  // ── Container HTML ─────────────────────────────────────────
  function injectHTML() {
    if ($r('rasumi-container')) return;
    var el = document.createElement('div');
    el.id = 'rasumi-container';
    el.className = 'hidden';
    // Baca dari localStorage SYNCHRONOUSLY — wallpaper instant tanpa flash
    var _initBgStyle = (function () {
      try {
        var _sb = localStorage.getItem('rs_bg');
        // Check localStorage dulu, kemudian sessionStorage (quota berasingan)
        var _sc = localStorage.getItem('rs_bg_custom') || sessionStorage.getItem('rs_bg_custom');
        if (_sb === 'custom' && _sc) return 'url(' + _sc + ') center/cover no-repeat';
        if (_sb && _sb !== 'custom' && _sb !== 'photo' && _BG_MAP[_sb]) return _BG_MAP[_sb];
        if (_sb === 'photo') return "url('../assets/background.jpg') center/cover no-repeat";
      } catch (e) { }
      return '#0a0f1a';
    })();
    el.innerHTML = [
      // ── BACKGROUND LAYER (controlled via JS for dynamic bg switching) ──
      '<div id="r-bg-layer" style="position:absolute;inset:0;z-index:0;pointer-events:none;background:' + _initBgStyle + ';transition:background 0.4s ease"></div>',

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
      '    <button class="icon-btn" id="r-gear-btn" onclick="window.rToggleDisplayPanel(event)"><i class="fa-solid fa-gear"></i></button>',
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
      '  <div class="r-hn-item" id="rni-r-vibes"      onclick="rNav(\'r-vibes\')"><i class="fa-solid fa-file-arrow-up"></i> VIBES Agent <span class="r-nb err" id="r-nb-vibes" style="display:none"></span></div>',
      '  <div class="r-hn-item" id="rni-r-vims"       onclick="rNav(\'r-vims\')"><i class="fa-solid fa-magnifying-glass-chart"></i> VIMS Agent <span class="r-nb warn" id="r-nb-vims" style="display:none"></span></div>',
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

      // ── CUSTOM PROMPT DIALOG ──
      '<div id="r-prompt-overlay" style="display:none;position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);align-items:center;justify-content:center;">',
      '  <div id="r-prompt-box" style="background:rgba(8,12,19,0.98);border:1px solid rgba(56,189,248,0.25);border-radius:12px;width:420px;max-width:94vw;box-shadow:0 0 40px rgba(56,189,248,0.08),0 24px 60px rgba(0,0,0,0.7);font-family:var(--rc-font);">',
      '    <div style="padding:14px 18px 12px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:10px;">',
      '      <span id="r-prompt-icon" style="color:var(--rc-cyan,#38bdf8);font-size:14px"></span>',
      '      <span id="r-prompt-title" style="font-size:13px;font-weight:700;color:var(--rc-text,#e2e8f0);letter-spacing:0.05em;flex:1"></span>',
      '      <button onclick="window._rPromptCancel()" style="background:none;border:none;color:rgba(255,255,255,0.3);cursor:pointer;font-size:15px;padding:2px 4px;line-height:1;transition:color 0.12s" onmouseover="this.style.color=\'#ef4444\'" onmouseout="this.style.color=\'rgba(255,255,255,0.3)\'"><i class="fa-solid fa-xmark"></i></button>',
      '    </div>',
      '    <div style="padding:16px 18px 14px;">',
      '      <label id="r-prompt-label" style="display:block;font-size:11px;color:rgba(255,255,255,0.45);letter-spacing:0.06em;text-transform:uppercase;margin-bottom:8px"></label>',
      '      <input id="r-prompt-input" type="text" autocomplete="off" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(56,189,248,0.18);border-radius:6px;color:#e2e8f0;padding:9px 12px;font-size:13px;font-family:var(--rc-font);outline:none;transition:border-color 0.15s,box-shadow 0.15s" onfocus="this.style.borderColor=\'rgba(56,189,248,0.5)\';this.style.boxShadow=\'0 0 0 3px rgba(56,189,248,0.08)\'" onblur="this.style.borderColor=\'rgba(56,189,248,0.18)\';this.style.boxShadow=\'none\'" onkeydown="if(event.key===\'Enter\')window._rPromptConfirm();if(event.key===\'Escape\')window._rPromptCancel()" placeholder="" />',
      '    </div>',
      '    <div style="padding:10px 18px 16px;display:flex;gap:8px;justify-content:flex-end;">',
      '      <button onclick="window._rPromptCancel()" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.5);border-radius:6px;padding:7px 18px;font-size:12px;font-family:var(--rc-font);cursor:pointer;transition:background 0.12s" onmouseover="this.style.background=\'rgba(255,255,255,0.08)\'" onmouseout="this.style.background=\'rgba(255,255,255,0.04)\'">Cancel</button>',
      '      <button id="r-prompt-confirm-btn" onclick="window._rPromptConfirm()" style="background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.35);color:var(--rc-cyan,#38bdf8);border-radius:6px;padding:7px 20px;font-size:12px;font-weight:700;font-family:var(--rc-font);cursor:pointer;letter-spacing:0.04em;transition:background 0.12s,box-shadow 0.12s" onmouseover="this.style.background=\'rgba(56,189,248,0.2)\';this.style.boxShadow=\'0 0 12px rgba(56,189,248,0.15)\'" onmouseout="this.style.background=\'rgba(56,189,248,0.1)\';this.style.boxShadow=\'none\'">Confirm</button>',
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
      '                <h3 style="margin:0; font-size:14px; color:var(--rc-cyan, #38bdf8);"><i class="fa-solid fa-user-shield"></i> PROFILE COMMAND</h3>',
      '                <button id="btn-close-r-profile" style="background:none; border:none; color:var(--rc-text-dim, #9ca3af); cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>',
      '            </div>',
      '            <div style="text-align:center;position:relative;">',
      '                <button onclick="rToggleProfileEdit()" title="Edit profile" style="position:absolute;top:0;right:0;background:none;border:none;color:var(--rc-text-dim,#9ca3af);cursor:pointer;font-size:13px;padding:3px 5px;line-height:1;transition:color 0.15s;" onmouseover="this.style.color=\'#38bdf8\'" onmouseout="this.style.color=\'var(--rc-text-dim,#9ca3af)\'"><i class="fa-solid fa-pen-to-square"></i></button>',
      '                <input type="file" id="r-profile-upload" class="hidden" accept="image/*">',
      '                <div style="position:relative;display:inline-block;margin-bottom:14px;">',
      '                    <img id="r-profile-img-display" src="https://ui-avatars.com/api/?name=SA&background=0d1117&color=06b6d4" style="width:88px;height:88px;border-radius:50%;cursor:pointer;border:2px solid var(--rc-cyan,#38bdf8);display:block;object-fit:cover;" title="Click to change photo">',
      '                    <div id="r-avatar-spinner" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,0.6);border-radius:50%;align-items:center;justify-content:center;font-size:18px;color:#fff"><i class="fa-solid fa-circle-notch fa-spin"></i></div>',
      '                </div>',
      '                <div id="r-p-displayname" style="font-weight:bold;color:var(--rc-text,#fff);letter-spacing:1px;font-size:13px;">—</div>',
      '                <div id="r-p-email" style="font-size:11px;color:var(--rc-text-dim,#9ca3af);margin-top:3px;">—</div>',
      '                <div id="r-p-role-badge" style="display:inline-block;margin-top:6px;font-size:9px;font-weight:700;letter-spacing:1.5px;padding:2px 8px;border-radius:10px;background:rgba(56,189,248,0.1);color:var(--rc-cyan,#38bdf8);border:1px solid rgba(56,189,248,0.25);">—</div>',
      '                <div id="r-p-edit-panel" style="display:none;text-align:left;margin-top:14px;padding:12px 14px;background:rgba(255,255,255,0.03);border:1px solid var(--rc-border,#374151);border-radius:6px;">',
      '                    <div style="font-size:10px;color:var(--rc-text-dim,#9ca3af);letter-spacing:1px;margin-bottom:6px;">NICKNAME</div>',
      '                    <input type="text" id="r-p-nickname" placeholder="Display name (e.g. Kakar0th)" style="width:100%;box-sizing:border-box;padding:9px 12px;margin-bottom:10px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-family:inherit;font-size:12px;">',
      '                    <div style="font-size:10px;color:var(--rc-text-dim,#9ca3af);letter-spacing:1px;margin-bottom:6px;">EMAIL</div>',
      '                    <input type="email" id="r-p-edit-email" placeholder="New email address" style="width:100%;box-sizing:border-box;padding:9px 12px;margin-bottom:10px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-family:inherit;font-size:12px;">',
      '                    <div id="r-p-email-note" style="font-size:10px;color:var(--rc-text-dim,#9ca3af);margin-bottom:10px;display:none;">Supabase will send a verification to the new email. Login email updates after confirmation.</div>',
      '                    <button onclick="rSaveProfile()" style="width:100%;padding:9px;background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.35);color:var(--rc-cyan,#38bdf8);border-radius:4px;cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;">Save Changes</button>',
      '                </div>',
      '                <div style="text-align:left;margin-top:14px;border-top:1px solid var(--rc-border,#374151);padding-top:16px;">',
      '                    <div style="font-size:10px;color:var(--rc-text-dim,#9ca3af);letter-spacing:1px;margin-bottom:8px;">CHANGE PASSWORD</div>',
      '                    <input type="password" id="r-p-curr-pass" placeholder="Current password" style="width:100%;box-sizing:border-box;padding:10px 12px;margin-bottom:8px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-family:inherit;">',
      '                    <input type="password" id="r-p-new-pass" placeholder="New password (min 6 chars)" style="width:100%;box-sizing:border-box;padding:10px 12px;margin-bottom:8px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-family:inherit;">',
      '                    <input type="password" id="r-p-confirm-pass" placeholder="Confirm new password" style="width:100%;box-sizing:border-box;padding:10px 12px;margin-bottom:12px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-family:inherit;">',
      '                    <button id="btn-update-r-profile" style="width:100%;padding:12px;background:var(--rc-cyan,#38bdf8);color:#000;font-weight:bold;border:none;border-radius:4px;cursor:pointer;letter-spacing:1px;font-family:inherit;">CHANGE PASSWORD</button>',
      '                    <div id="r-p-pass-status" style="font-size:10px;margin-top:8px;text-align:center;min-height:14px;"></div>',
      '                </div>',
      '                <!-- 2FA SECTION -->',
      '                <div style="text-align:left;margin-top:14px;border-top:1px solid var(--rc-border,#374151);padding-top:16px;">',
      '                    <div style="font-size:10px;color:var(--rc-text-dim,#9ca3af);letter-spacing:1px;margin-bottom:8px;">TWO-FACTOR AUTHENTICATION</div>',
      '                    <div id="r-2fa-status" style="font-size:11px;color:#9ca3af;margin-bottom:10px;"><i class="fa-solid fa-circle-notch fa-spin"></i> Checking…</div>',
      '                    <button id="btn-r-setup-2fa" onclick="rSetup2FA()" style="display:none;width:100%;padding:10px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.35);color:var(--rc-cyan,#38bdf8);border-radius:4px;cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;letter-spacing:0.5px;">ENABLE 2FA (TOTP)</button>',
      '                    <button id="btn-r-remove-2fa" onclick="rRemove2FA()" style="display:none;width:100%;padding:10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);color:#ef4444;border-radius:4px;cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;letter-spacing:0.5px;">DISABLE 2FA</button>',
      '                    <div id="r-2fa-enroll" style="display:none;margin-top:14px;text-align:center;">',
      '                        <div style="font-size:10px;color:#9ca3af;margin-bottom:10px;line-height:1.5;">Scan with <strong style="color:#fff">Google Authenticator</strong> or <strong style="color:#fff">Authy</strong>, then enter the 6-digit code below to confirm.</div>',
      '                        <img id="r-2fa-qr" src="" style="width:156px;height:156px;background:#fff;padding:8px;border-radius:6px;margin-bottom:10px;display:block;margin-left:auto;margin-right:auto;">',
      '                        <div style="font-size:9px;color:#6b7280;margin-bottom:6px;letter-spacing:0.5px;">OR ENTER KEY MANUALLY:</div>',
      '                        <code id="r-2fa-secret" style="font-size:11px;color:var(--rc-cyan,#38bdf8);background:rgba(0,0,0,0.35);padding:6px 10px;border-radius:3px;word-break:break-all;display:block;margin-bottom:14px;text-align:left;"></code>',
      '                        <input type="text" id="r-2fa-verify-code" placeholder="Enter 6-digit code" maxlength="6" inputmode="numeric"',
      '                          style="width:100%;box-sizing:border-box;padding:11px 12px;margin-bottom:8px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;outline:none;font-family:inherit;font-size:16px;text-align:center;letter-spacing:6px;">',
      '                        <button onclick="rVerify2FA()" style="width:100%;padding:10px;background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.35);color:var(--rc-cyan,#38bdf8);border-radius:4px;cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;margin-bottom:6px;">CONFIRM &amp; ACTIVATE</button>',
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
      '          <h3 style="margin:0;font-size:13px;color:var(--rc-cyan,#38bdf8);letter-spacing:1px;"><i class="fa-solid fa-sliders"></i> SETTINGS</h3>',
      '          <button id="btn-close-settings" style="background:none;border:none;color:var(--rc-text-dim,#9ca3af);cursor:pointer;font-size:16px;"><i class="fa-solid fa-xmark"></i></button>',
      '        </div>',
      '        <div style="padding:16px 20px;display:flex;flex-direction:column;gap:10px;">',
      '          <div onclick="window.rOpenAdminsFromSettings()" style="display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid var(--rc-border,#374151);border-radius:6px;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'#38bdf8\'" onmouseout="this.style.borderColor=\'var(--rc-border,#374151)\'">',
      '            <i class="fa-solid fa-users-gear" style="font-size:20px;color:var(--rc-cyan,#38bdf8);flex-shrink:0;"></i>',
      '            <div>',
      '              <div style="font-size:12px;color:var(--rc-text,#fff);font-weight:600;letter-spacing:0.5px;">MANAGE ADMINS</div>',
      '              <div style="font-size:10px;color:var(--rc-text-dim,#6b7280);margin-top:2px;">Manage admin console access &amp; permissions</div>',
      '            </div>',
      '            <i class="fa-solid fa-chevron-right" style="margin-left:auto;color:var(--rc-text-dim,#6b7280);font-size:11px;"></i>',
      '          </div>',
      '          <div onclick="window.rOpenAppUsersFromSettings()" style="display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid var(--rc-border,#374151);border-radius:6px;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'#38bdf8\'" onmouseout="this.style.borderColor=\'var(--rc-border,#374151)\'">',
      '            <i class="fa-solid fa-id-card-clip" style="font-size:20px;color:var(--rc-cyan,#38bdf8);flex-shrink:0;"></i>',
      '            <div>',
      '              <div style="font-size:12px;color:var(--rc-text,#fff);font-weight:600;letter-spacing:0.5px;">APP USERS</div>',
      '              <div style="font-size:10px;color:var(--rc-text-dim,#6b7280);margin-top:2px;">Manage access &amp; allowed apps for each Rasumi user</div>',
      '            </div>',
      '            <i class="fa-solid fa-chevron-right" style="margin-left:auto;color:var(--rc-text-dim,#6b7280);font-size:11px;"></i>',
      '          </div>',
      '        </div>',
      '      </div>',
      '    </div>',

      '    <!-- DISPLAY SETTINGS PANEL (superadmin only) -->',
      '    <div id="r-display-panel" class="hidden" style="position:fixed;top:62px;right:116px;z-index:10002;background:rgba(8,12,19,0.97);border:1px solid rgba(56,189,248,0.18);border-radius:10px;padding:18px;width:230px;backdrop-filter:blur(20px);box-shadow:0 8px 32px rgba(0,0,0,0.6);">',
      '      <div style="font-size:10px;color:#6b7a8f;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:14px"><i class="fa-solid fa-display" style="margin-right:5px"></i>Display Settings</div>',
      '      <div style="font-size:11px;color:#9ca3af;margin-bottom:8px">Mode</div>',
      '      <div style="display:flex;gap:8px;margin-bottom:16px">',
      '        <button id="r-mode-dark-btn" onclick="window.rSetTheme(\'dark\')" style="flex:1;padding:7px 0;border-radius:6px;border:1px solid rgba(56,189,248,0.35);background:rgba(56,189,248,0.1);color:#38bdf8;font-size:11px;cursor:pointer;transition:all 0.15s"><i class="fa-solid fa-moon"></i> Dark</button>',
      '        <button id="r-mode-light-btn" onclick="window.rSetTheme(\'light\')" style="flex:1;padding:7px 0;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:none;color:#6b7a8f;font-size:11px;cursor:pointer;transition:all 0.15s"><i class="fa-solid fa-sun"></i> Light</button>',
      '      </div>',
      '      <div style="font-size:11px;color:#9ca3af;margin-bottom:8px">Background</div>',
      '      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">',
      '        <div class="r-bg-opt" data-bg="photo" onclick="window.rSetBackground(\'photo\')" title="Default Photo" style="height:40px;border-radius:6px;border:2px solid rgba(56,189,248,0.5);background:url(\'../assets/background.jpg\') center/cover;cursor:pointer"></div>',
      '        <div class="r-bg-opt" data-bg="dark" onclick="window.rSetBackground(\'dark\')" title="Pure Dark" style="height:40px;border-radius:6px;border:2px solid transparent;background:#080c13;cursor:pointer"></div>',
      '        <div class="r-bg-opt" data-bg="navy" onclick="window.rSetBackground(\'navy\')" title="Navy" style="height:40px;border-radius:6px;border:2px solid transparent;background:linear-gradient(135deg,#060d1a,#0d1f35);cursor:pointer"></div>',
      '        <div class="r-bg-opt" data-bg="purple" onclick="window.rSetBackground(\'purple\')" title="Purple" style="height:40px;border-radius:6px;border:2px solid transparent;background:linear-gradient(135deg,#0b0614,#17082e);cursor:pointer"></div>',
      '        <div class="r-bg-opt" data-bg="forest" onclick="window.rSetBackground(\'forest\')" title="Forest" style="height:40px;border-radius:6px;border:2px solid transparent;background:linear-gradient(135deg,#040f0a,#0a2016);cursor:pointer"></div>',
      '        <div class="r-bg-opt" data-bg="ember" onclick="window.rSetBackground(\'ember\')" title="Ember" style="height:40px;border-radius:6px;border:2px solid transparent;background:linear-gradient(135deg,#110608,#200d0a);cursor:pointer"></div>',
      '        <div class="r-bg-opt" data-bg="custom" onclick="window.rPickCustomBg()" title="Custom Photo" style="height:40px;border-radius:6px;border:2px dashed rgba(255,255,255,0.2);background:rgba(255,255,255,0.04) center/cover no-repeat;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#6b7a8f;font-size:13px;gap:4px"><i class="fa-solid fa-folder-open"></i></div>',
      '      </div>',
      '    </div>',

      '    <!-- MANAGE ADMINS MODAL -->',
      '    <div id="r-admins-modal" class="hidden" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.82);z-index:10001;display:flex;align-items:center;justify-content:center;">',
      '      <div style="background:var(--rc-bg,#111827);border:1px solid var(--rc-border,#374151);border-radius:8px;width:500px;max-height:78vh;display:flex;flex-direction:column;box-shadow:0 10px 30px rgba(0,0,0,0.6);">',
      '        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--rc-border,#374151);flex-shrink:0;">',
      '          <h3 style="margin:0;font-size:13px;color:var(--rc-cyan,#38bdf8);letter-spacing:1px;"><i class="fa-solid fa-users-gear"></i> MANAGE ADMINS</h3>',
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
      '            <button onclick="rAddAdmin()" style="padding:9px 16px;background:var(--rc-cyan,#38bdf8);color:#000;font-weight:700;border:none;border-radius:4px;cursor:pointer;font-size:11px;white-space:nowrap;">ADD</button>',
      '          </div>',
      '        </div>',
      '        <div id="r-admins-list" style="overflow-y:auto;padding:0 20px;flex:1;"></div>',
      '      </div>',
      '    </div>',

      '    <!-- HOSPITAL USERS MODAL -->',
      '    <div id="r-husers-modal" class="hidden" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.82);z-index:10001;display:flex;align-items:center;justify-content:center;">',
      '      <div style="background:var(--rc-bg,#111827);border:1px solid var(--rc-border,#374151);border-radius:8px;width:720px;max-width:95vw;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 10px 30px rgba(0,0,0,0.6);">',
      '        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--rc-border,#374151);flex-shrink:0;">',
      '          <h3 style="margin:0;font-size:13px;color:var(--rc-cyan,#38bdf8);letter-spacing:1px;"><i class="fa-solid fa-id-card-clip"></i> APP USERS</h3>',
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
      '            <button onclick="rAddHospitalUser()" style="padding:9px 16px;background:var(--rc-cyan,#38bdf8);color:#000;font-weight:700;border:none;border-radius:4px;cursor:pointer;font-size:11px;white-space:nowrap;">ADD</button>',
      '          </div>',
      '          <div style="font-size:10px;color:var(--rc-text-dim,#6b7280);margin-top:6px;letter-spacing:0.3px;">Add new users ID.</div>',
      '        </div>',
      '        <div id="r-husers-list" style="overflow-y:auto;padding:0 20px;flex:1;"></div>',
      '      </div>',
      '    </div>',

      '<div id="r-toasts" class="r-toasts"></div>'
    ].join('\n');
    document.body.appendChild(el);
    _restoreDisplayPrefs();
    // Fetch global display prefs from Supabase early (app_settings is public)
    setTimeout(function () { _loadDisplayPrefsFromSupabase(); }, 0);

    // Close all nav dropdowns when clicking anywhere outside
    document.addEventListener('click', function (ev) {
      var d = document.getElementById('r-nav-dropdown');
      var n = document.getElementById('notif-dropdown');
      var p = document.getElementById('r-display-panel');
      var g = document.getElementById('r-gear-btn');
      if (d && !d.classList.contains('hidden')) d.classList.add('hidden');
      if (n && !n.classList.contains('hidden')) n.classList.add('hidden');
      if (p && !p.classList.contains('hidden') && g && !g.contains(ev.target) && !p.contains(ev.target)) {
        p.classList.add('hidden');
      }
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
    if (fbStatus) fbStatus.innerHTML = '<span style="color:var(--rc-orange);font-size:10px;padding:0 21px;display:block"><i class="fa-solid fa-triangle-exclamation"></i> Config missing</span>';
  }

  // ── Enter / Exit ───────────────────────────────────────────
  window.enterRasumiMode = function () {
    injectHTML();

    // Restore cached profile image + nickname immediately (prevents flash)
    try {
      var _cachedImg = localStorage.getItem('rs_profile_img');
      if (_cachedImg) {
        var _hImg = document.querySelector('#r-profile-trigger img');
        if (_hImg) _hImg.src = _cachedImg;
      }
      var _cachedNick = localStorage.getItem('rs_nickname');
      if (_cachedNick) {
        RS.userNickname = _cachedNick;
        var _hRole = document.querySelector('#r-profile-trigger .role');
        if (_hRole) _hRole.textContent = _cachedNick;
      }
    } catch (e) { }

    // Restore cached dashboard counts immediately (prevents 0-flash on cards)
    try {
      var _cr = parseInt(localStorage.getItem('rs_cache_runs_today'), 10);
      var _cf = parseInt(localStorage.getItem('rs_cache_failed_today'), 10);
      if (!isNaN(_cr)) RS.runsToday = _cr;
      if (!isNaN(_cf)) RS.failedToday = _cf;
    } catch (e) { }

    // Attach profile modal and header button listeners to the newly injected HTML
    if (typeof window.initProfileHandlers === 'function') {
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
    if (fbStatus) fbStatus.innerHTML = '<span style="color:var(--rc-green);font-size:10px;padding:0 21px;display:block">Rasumi Apps <span class="r-live-blink">● LIVE</span></span>';

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
      // Update online device uptime counters directly in the sidebar — no DOM rebuild
      var now = Date.now();
      document.querySelectorAll('.r-nc-time[data-online]').forEach(function (te) {
        var from = RS._onlineFrom[te.getAttribute('data-online')];
        te.textContent = fmtUptime(from ? now - from : 0);
      });
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
    ).then(function () { }).catch(function () { });
    // Fetch avatar once on login
    RS.supa.from('admin_users').select('profile_img,nickname').eq('email', email).single().then(function (res) {
      if (res.error || !res.data) return;
      if (res.data.profile_img) {
        var src = res.data.profile_img;
        try { localStorage.setItem('rs_profile_img', src); } catch (e) { }
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
        try { localStorage.setItem('rs_nickname', res.data.nickname); } catch (e) { }
        var tbRole = document.querySelector('#r-profile-trigger .role');
        if (tbRole) tbRole.textContent = res.data.nickname;
      }
    }).catch(function () { });
  }

  // ── Admin Management (Super Admin only) ──────────────────────
  window.rAddAdmin = function () {
    var emailInp = document.getElementById('r-admin-new-email');
    var nickInp = document.getElementById('r-admin-new-nick');
    var passInp = document.getElementById('r-admin-new-pass');
    var permSel = document.getElementById('r-admin-new-perm');
    var email = (emailInp ? emailInp.value.trim().toLowerCase() : '');
    var password = (passInp ? passInp.value.trim() : '');
    var nickname = (nickInp ? nickInp.value.trim() : '');
    if (!email || !email.includes('@')) { rToast('Enter valid email', 'warn'); return; }
    if (email === _SUPER_ADMIN_EMAIL) { rToast('Super admin already exists', 'warn'); return; }
    if (!password) { rToast('Password is required', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not available', 'error'); return; }

    var canWrite = permSel ? permSel.value === 'write' : false;
    var addedBy = RS.currentUser ? RS.currentUser.email : '';

    rToast('Creating account…', 'info');

    // Save current session before signUp (in case Supabase email confirm is OFF — restores superadmin session)
    var _savedToken = null;
    RS.supa.auth.getSession().then(function (sr) {
      if (sr.data && sr.data.session) {
        _savedToken = { access: sr.data.session.access_token, refresh: sr.data.session.refresh_token };
      }
      // Step 1: Create Supabase Auth account
      return RS.supa.auth.signUp({ email: email, password: password });
    })
      .then(function (r) {
        // "User already registered" is OK — just update the Supabase record
        if (r.error && r.error.message && !r.error.message.toLowerCase().includes('already registered')) {
          throw new Error(r.error.message);
        }
        // If signUp signed us in (email confirm disabled), restore superadmin session
        return RS.supa.auth.getSession().then(function (sr2) {
          var nowEmail = sr2.data && sr2.data.session && sr2.data.session.user ? sr2.data.session.user.email : null;
          if (nowEmail && nowEmail !== addedBy && _savedToken) {
            return RS.supa.auth.setSession({ access_token: _savedToken.access, refresh_token: _savedToken.refresh });
          }
        });
      })
      .then(function () {
        // Step 2: Save to Supabase admin_users
        return RS.supa.from('admin_users').upsert({
          email: email,
          nickname: nickname || null,
          role: 'admin',
          can_write: canWrite,
          is_active: true,
          added_at: new Date().toISOString(),
          added_by: addedBy
        }, { onConflict: 'email' });
      })
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        rToast('Admin added: ' + email, 'success');
        if (emailInp) emailInp.value = '';
        if (nickInp) nickInp.value = '';
        if (passInp) passInp.value = '';
        if (permSel) { permSel.value = 'read'; rUpdatePermIndicator(permSel); }
        _loadAdminUsers();
      })
      .catch(function (e) { rToast('Error: ' + e.message, 'error'); });
  };

  window.rRemoveAdmin = function (email) {
    if (!RS.supa) { rToast('Supabase not available', 'error'); return; }
    RS.supa.from('admin_users').delete().eq('email', email).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      rToast('Removed: ' + email, 'success');
      _loadAdminUsers();
    }).catch(function (e) { rToast('Error: ' + e.message, 'error'); });
  };

  window.rToggleAdminPw = function (inputId) {
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
  window.rUpdateAdminPassword = function () { };

  window.rSendAdminResetEmail = function (email) {
    if (!RS.supa) { rToast('Supabase not available', 'error'); return; }
    // redirectTo: main login page of admin console (works for http:// deployments)
    var _base = (window.location.href || '').replace(/rasumi apps[\/\\].*$/, '');
    var redirectTo = _base ? _base + 'index.html' : window.location.origin;
    RS.supa.auth.resetPasswordForEmail(email, { redirectTo: redirectTo })
      .then(function (r) {
        if (r.error) throw r.error;
        rToast('Reset email sent to: ' + email, 'success');
      })
      .catch(function (err) { rToast('Error: ' + ((err && err.message) || String(err)), 'error'); });
  };

  // ── Permission indicator helpers ────────────────────────────────
  window.rUpdatePermIndicator = function (sel) {
    var tick = document.getElementById('r-admin-perm-tick');
    if (tick) tick.style.display = (sel.value === 'read') ? 'inline' : 'none';
  };

  window.rUpdateListPermIndicator = function (sel) {
    var permId = sel.id;
    var tick = document.getElementById('tick_' + permId);
    if (tick) tick.style.display = (sel.value === 'read') ? 'inline' : 'none';
  };

  window.rToggleAdminWrite = function (email, val) {
    if (!RS.supa) return;
    RS.supa.from('admin_users').update({ can_write: val }).eq('email', email).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      rToast((val ? 'Write enabled' : 'Write disabled') + ': ' + email, 'success');
    }).catch(function (e) { rToast('Error: ' + e.message, 'error'); });
  };

  function _loadAdminUsers() {
    var list = document.getElementById('r-admins-list');
    if (!list || !RS.supa) return;
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--rc-text-dim,#9ca3af);font-size:12px;"><span class="r-spin"></span> Loading…</div>';
    RS.supa.from('admin_users').select('email,role,can_write,nickname').order('email').then(function (res) {
      if (res.error) throw new Error(res.error.message);
      var rows = [];
      if (!res.data || !res.data.length) { list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--rc-text-dim,#9ca3af);font-size:12px;">No admin users</div>'; return; }
      res.data.forEach(function (d) {
        var em = d.email;
        var isSA = (em.toLowerCase() === _SUPER_ADMIN_EMAIL);
        var canW = d.can_write === true;
        var pw = d.password || '';
        var nick = d.nickname || '';
        var pwId = 'apw_' + em.replace(/[^a-z0-9]/gi, '_');
        var permId = 'prm_' + em.replace(/[^a-z0-9]/gi, '_');
        var safeEm = em.replace(/'/g, "\\'");

        var row = '<div style="padding:12px 0;border-bottom:1px solid var(--rc-border,#1f2937);">';
        // Line 1: email + nickname + role + controls
        row += '<div style="display:flex;align-items:center;justify-content:space-between;">';
        row += '<div>';
        row += '<div style="font-size:12px;color:var(--rc-text,#fff);">' + esc(em) + (nick ? ' <span style="font-size:10px;color:var(--rc-cyan,#38bdf8);">(' + esc(nick) + ')</span>' : '') + '</div>';
        row += '<div style="font-size:10px;color:var(--rc-text-dim,#6b7280);margin-top:2px;">' + (isSA ? 'SUPER ADMIN' : (canW ? 'ADMIN · Read & Write' : 'ADMIN · Read')) + '</div>';
        row += '</div>';
        if (isSA) {
          row += '<span style="font-size:10px;color:var(--rc-cyan,#38bdf8);padding:3px 8px;border:1px solid rgba(56,189,248,0.3);border-radius:10px;">Owner</span>';
        } else {
          row += '<div style="display:flex;gap:10px;align-items:center;">';
          row += '<select id="' + permId + '" onchange="rToggleAdminWrite(\'' + safeEm + '\',this.value===\'write\');rUpdateListPermIndicator(this)" style="padding:5px 8px;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border,#374151);color:#fff;border-radius:4px;font-size:11px;font-family:inherit;cursor:pointer;">';
          row += '<option value="read"' + (!canW ? ' selected' : '') + '>Read</option>';
          row += '<option value="write"' + (canW ? ' selected' : '') + '>Read &amp; Write</option>';
          row += '</select>';
          row += '<span style="font-size:13px;color:#22c55e;' + (canW ? 'display:none' : 'display:inline') + ';" id="tick_' + permId + '">✓</span>';
          row += '<button onclick="rSendAdminResetEmail(\'' + safeEm + '\')" title="Send reset email" style="background:none;border:1px solid rgba(56,189,248,0.4);color:var(--rc-cyan,#38bdf8);padding:3px 8px;border-radius:4px;font-size:10px;cursor:pointer;font-family:inherit;"><i class="fa-solid fa-envelope-circle-check"></i></button>';
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
    }).catch(function (e) {
      list.innerHTML = '<div style="padding:20px;color:#ef4444;font-size:12px;">Error: ' + esc(e.message) + '</div>';
    });
  }


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

    // ── User Auth, Role & Write Permission (Supabase Auth) ──────────
    var _SUPER_ADMIN = 'musqhaishah@gmail.com';
    if (RS.supa) {
      var _authResult = RS.supa.auth.onAuthStateChange(function (event, session) {
        var user = session ? session.user : null;
        if (!user || !user.email) { RS.currentUser = null; return; }
        RS.currentUser = user;
        var email = user.email.toLowerCase();
        var isSA = (email === _SUPER_ADMIN);

        if (isSA) {
          // Super admin — always allowed, full write
          RS.userRole = 'superadmin';
          RS.canWrite = true;
          _applyRoleUI();
          _syncProfileAvatar(user.email);
          _loadDisplayPrefsFromSupabase();
          // Update last_login for super admin
          RS.supa.from('admin_users').update({
            last_login: new Date().toISOString(),
            last_active: new Date().toISOString(),
            is_active: true
          }).eq('email', email).then(function () { }).catch(function () { });
        } else {
          // Check Supabase admin_users — dynamic whitelist
          RS.supa.from('admin_users').select('email,role,can_write,nickname,pending_email')
            .or('email.eq.' + user.email + ',pending_email.eq.' + user.email)
            .single().then(function (res) {
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
                  .then(function () { }).catch(function () { });
              }
              var dbRole = res.data.role || 'admin';
              RS.userRole = dbRole;
              RS.canWrite = dbRole === 'superadmin' || res.data.can_write === true;
              RS.userNickname = res.data.nickname || '';
              _applyRoleUI();
              _syncProfileAvatar(user.email);
              _loadDisplayPrefsFromSupabase();
              // Update last_login for this admin
              RS.supa.from('admin_users').update({
                last_login: new Date().toISOString(),
                last_active: new Date().toISOString(),
                is_active: true
              }).eq('email', user.email).then(function () { }).catch(function () { });
            }).catch(function () {
              RS.supa.auth.signOut();
              window.location.href = '../index.html';
            });
        }
      });
      addL(function () { _authResult.data.subscription.unsubscribe(); });
    }

    // ── machine_status — Supabase Realtime + Firebase bridge for v9.3 ──────────
    // Primary: Supabase (v9.4+ machines with dual-write).
    // Bridge: Firebase onSnapshot fills in v9.3 machines that don't dual-write yet.
    // Supabase always wins on conflict (same hostname in both).
    if (RS.supa) {
      // Normalize Supabase column names → field names expected by renderDevices/renderDashboard
      function _normSupa(d) {
        d.id = d.hostname;
        d._source = 'supa';
        // app_version → version
        if (d.app_version !== undefined && d.version === undefined) d.version = d.app_version;
        // cpu/ram/disk pct
        if (d.cpu_usage_pct !== undefined && d.cpu_pct === undefined) d.cpu_pct = d.cpu_usage_pct;
        if (d.ram_usage_pct !== undefined && d.ram_pct === undefined) d.ram_pct = d.ram_usage_pct;
        if (d.disk_usage_pct !== undefined && d.disk_pct === undefined) d.disk_pct = d.disk_usage_pct;
        // ram MB → GB (1 d.p.)
        if (d.ram_used_mb !== undefined && d.ram_used_gb === undefined) d.ram_used_gb = Math.round(d.ram_used_mb / 1024 * 10) / 10;
        if (d.ram_total_mb !== undefined && d.ram_total_gb === undefined) d.ram_total_gb = Math.round(d.ram_total_mb / 1024 * 10) / 10;
        d._status = deviceStatus(d);
        return d;
      }

      // Initial full fetch from Supabase
      RS.supa.from('machine_status').select('*').then(function (res) {
        if (res.error) { console.warn('[Supa] machine_status fetch:', res.error.message); }
        RS.devices = {};
        (res.data || []).forEach(function (d) {
          RS.devices[d.hostname] = _normSupa(d);
          _trackOnlineFrom(d.hostname, RS.devices[d.hostname]._status, d.last_heartbeat || d.last_seen);
        });
        updateFleetBadges();
        if (RS.route === 'r-dashboard') renderDashboard();
        if (RS.route === 'r-alerts') renderAlerts();

        // Build machine→branch_id map from logs (machine_status has no branch_id column).
        // One query per device using ilike (case-insensitive) — guarantees coverage
        // regardless of log volume or hostname capitalisation differences.
        RS._devBranchMap = {};
        var _hostnames = Object.keys(RS.devices);
        if (!RS.supa || !_hostnames.length) {
          if (RS.route === 'r-devices') renderDevices();
        } else {
          var _pending = _hostnames.length;
          _hostnames.forEach(function (h) {
            RS.supa.from('logs').select('branch_id')
              .ilike('machine', h)
              .not('branch_id', 'is', null)
              .order('timestamp', { ascending: false })
              .limit(1)
              .then(function (r) {
                if (r.data && r.data[0] && r.data[0].branch_id) {
                  RS._devBranchMap[h.toLowerCase()] = r.data[0].branch_id.toLowerCase();
                }
              })
              .catch(function () { })
              .finally(function () {
                _pending--;
                if (_pending === 0 && RS.route === 'r-devices') renderDevices();
              });
          });
        }

        // Auto-restore: re-select previously viewed device (or first online) and reload chart.
        // Fixes empty chart on page refresh — RS._selectedDevice is lost on page reload.
        if (RS.route === 'r-dashboard' && !RS._selectedDevice) {
          var savedDev = null;
          try { savedDev = sessionStorage.getItem('rs_sel_dev'); } catch (e) { }
          var autoHost = (savedDev && RS.devices[savedDev]) ? savedDev
            : (Object.values(RS.devices).filter(function (dv) { return dv._status === 'online'; })[0] || {}).id || null;
          if (autoHost) {
            RS._selectedDevice = autoHost;
            try { sessionStorage.setItem('rs_sel_dev', autoHost); } catch (e) { }
            updateSideNodeList();
            updateDashTelemetry();
            updateChartFromDevice(); // draws RAM/DISK donuts + triggers fetchCpuChart internally
          }
        }

        // Firebase bridge: covers v9.3 machines that don't dual-write to Supabase.
        // Compares timestamps — whichever source is more recent wins.
        // Once a machine upgrades to v9.4 and writes to Supabase, Supabase naturally wins.
        if (RS.db) {
          addL(RS.db.collection('machine_status').onSnapshot(function (snap) {
            snap.forEach(function (doc) {
              var fbData = doc.data();
              var fbTs = fbData.last_heartbeat;
              // Firestore SERVER_TIMESTAMP comes back as a Timestamp object
              var fbDate = fbTs ? (fbTs.toDate ? fbTs.toDate()
                : new Date(fbTs.seconds ? fbTs.seconds * 1000 : fbTs))
                : null;
              var existing = RS.devices[doc.id];
              if (existing && existing._source === 'supa') {
                // Only override Supabase entry if Firebase has a NEWER timestamp
                var supTs = existing.last_heartbeat;
                var supDate = supTs ? new Date(supTs) : null;
                if (!fbDate || (supDate && fbDate <= supDate)) return; // Supabase is fresher
              }
              var d = Object.assign({ id: doc.id, _source: 'firebase' }, fbData);
              d._status = deviceStatus(d);
              RS.devices[doc.id] = d;
              _trackOnlineFrom(doc.id, d._status, d.last_heartbeat || d.last_seen);
            });
            updateFleetBadges();
            if (RS.route === 'r-dashboard') renderDashboard();
            if (RS.route === 'r-devices') renderDevices();
            if (RS.route === 'r-alerts') renderAlerts();
          }, function (err) {
            console.warn('[Rasumi] Firebase machine_status bridge error:', err.message);
          }));
        }
      });

      // Realtime: fires only on change — no read cost between updates
      var supaChannel = RS.supa.channel('supa-machine-status')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'machine_status' },
          function (payload) {
            var d = Object.assign({}, payload.new || payload.old || {});
            if (!d.hostname) return;
            // Merge with cached entry — without REPLICA IDENTITY FULL, UPDATE events
            // only include the primary key in payload.new, so we must preserve existing fields.
            var existing = RS.devices[d.hostname] || {};
            RS.devices[d.hostname] = _normSupa(Object.assign({}, existing, d));
            _trackOnlineFrom(d.hostname, RS.devices[d.hostname]._status, RS.devices[d.hostname].last_heartbeat || RS.devices[d.hostname].last_seen);
            updateFleetBadges();
            if (RS.route === 'r-dashboard') renderDashboard();
            if (RS.route === 'r-devices') renderDevices();
            if (RS.route === 'r-alerts') renderAlerts();
          }
        ).subscribe(function (status) {
          if (status === 'SUBSCRIBED') {
            var fbStatus = document.getElementById('r-fb-status');
            if (fbStatus) fbStatus.innerHTML =
              '<span style="color:var(--rc-green);font-size:10px;padding:0 21px;display:block">' +
              'Rasumi Apps <span class="r-live-blink">● LIVE</span></span>';
          }
        });

      addL(function () { if (RS.supa) RS.supa.removeChannel(supaChannel); });

    } else {
      // Fallback: Firebase onSnapshot only (no Supabase connection)
      addL(RS.db.collection('machine_status').onSnapshot(function (snap) {
        RS.devices = {};
        snap.forEach(function (doc) {
          var d = Object.assign({ id: doc.id }, doc.data());
          d._status = deviceStatus(d);
          RS.devices[doc.id] = d;
          _trackOnlineFrom(doc.id, d._status, d.last_heartbeat || d.last_seen);
        });
        updateFleetBadges();
        if (RS.route === 'r-dashboard') renderDashboard();
        if (RS.route === 'r-devices') renderDevices();
        if (RS.route === 'r-alerts') renderAlerts();
      }, function (err) {
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
        .eq('resolved', false)
        .not('error_type', 'in', '("batch_skip","amount_unresolved","folder_not_found","row_skip_portal_lag")')
        .limit(51)
        .then(function (res) {
          var cnt = Math.min(res.count || 0, 51);
          RS.unresolvedVibes = cnt;
          var nb = $r('r-nb-vibes');
          var display = cnt > 50 ? '50+' : (cnt || '');
          if (nb) { nb.textContent = display; nb.style.display = cnt ? '' : 'none'; }
          updateAlertBadge();
          if (RS.route === 'r-dashboard') renderDashboard();
          if (RS.route === 'r-alerts') renderAlerts();
        }).catch(function () { });

      RS.supa.from('renamer_docs').select('id', { count: 'exact', head: true })
        .in('status', ['wrong_read', 'failed', 'skipped']).limit(51)
        .then(function (res) {
          var cnt = Math.min(res.count || 0, 51);
          RS.unresolvedRenamer = cnt;
          var nb = $r('r-nb-renamer');
          var display = cnt > 50 ? '50+' : (cnt || '');
          if (nb) { nb.textContent = display; nb.style.display = cnt ? '' : 'none'; }
          updateAlertBadge();
        }).catch(function () { });

      RS.supa.from('vims_results').select('id', { count: 'exact', head: true })
        .eq('status', 'skipped').limit(51)
        .then(function (res) {
          var cnt = Math.min(res.count || 0, 51);
          RS.unresolvedVims = cnt;
          var nb = $r('r-nb-vims');
          var display = cnt > 50 ? '50+' : (cnt || '');
          if (nb) { nb.textContent = display; nb.style.display = cnt ? '' : 'none'; }
          updateAlertBadge();
        }).catch(function () { });

      RS.supa.from('app_errors').select('id', { count: 'exact', head: true })
        .eq('fix_status', 'unfixed').limit(51)
        .then(function (res) {
          var cnt = Math.min(res.count || 0, 51);
          RS.unresolvedAppErrors = cnt;
          updateAlertBadge();
          if (RS.route === 'r-alerts') renderAlerts();
        }).catch(function () { });
    }
    _pollBadgeCounts(); // immediate first load
    RS._badgePollTimer = setInterval(_pollBadgeCounts, 5 * 60 * 1000); // every 5 min
    document.addEventListener('visibilitychange', _pollBadgeCounts);   // refresh on tab focus
    addL(function () {
      if (RS._badgePollTimer) { clearInterval(RS._badgePollTimer); RS._badgePollTimer = null; }
      document.removeEventListener('visibilitychange', _pollBadgeCounts);
    });

    // ── Periodic app stats refresh (every 60s) ──
    loadAppStats();
    loadGlobalTodayStats();
    RS._appStatsInterval = setInterval(function () { loadAppStats(); loadGlobalTodayStats(); }, 60000);

    // ── Seed recent logs for activity feed (Supabase, Fasa 6) ──
    if (RS.supa) {
      RS.supa.from('logs').select('*').order('timestamp', { ascending: false }).limit(30)
        .then(function (res) { RS._recentLogs = res.data || []; }).catch(function () { });
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
    return docs.slice().sort(function (a, b) {
      var ta = a[field]; var tb = b[field];
      var da = ta ? (ta.toDate ? ta.toDate() : new Date(ta.seconds ? ta.seconds * 1000 : ta)) : new Date(0);
      var db2 = tb ? (tb.toDate ? tb.toDate() : new Date(tb.seconds ? tb.seconds * 1000 : tb)) : new Date(0);
      return db2 - da; // desc
    });
  }

  // ── Global today stats — same grouping logic as Log Explorer ──
  function loadGlobalTodayStats() {
    if (!RS.supa) return;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var todayIso = today.toISOString();
    var todayDateStr = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');

    function _isToday(ts) {
      if (!ts) return false;
      var d = new Date(ts);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0') === todayDateStr;
    }

    function _commit(logMap, machineSet) {
      var groups = {};
      Object.values(logMap).forEach(function (d) {
        var gid = d.job_group_id ||
          ((d.machine || '') + '|' + (d.app_name || '') + '|' + (d.branch_id || '') + '|' + (d.timestamp || '').substring(0, 13));
        if (!groups[gid]) groups[gid] = { hasFail: false, hasCancelled: false, hasNonProc: false, hasCompFail: false, _start: null, _machine: d.machine || '' };
        var st = (d.status || '').toUpperCase();
        if (st === 'FAILED' || st === 'ERROR') { groups[gid].hasFail = true; groups[gid].hasCompFail = true; }
        if (st === 'COMPLETED') groups[gid].hasCompFail = true;
        if (st === 'CANCELLED') { groups[gid].hasCancelled = true; groups[gid].hasCompFail = true; }
        if (st !== 'PROCESSING') groups[gid].hasNonProc = true;
        if (d.timestamp && (!groups[gid]._start || d.timestamp < groups[gid]._start))
          groups[gid]._start = d.timestamp;
      });
      var sessions = Object.values(groups).filter(function (s) {
        if (!s.hasNonProc || !s.hasCompFail) return false;
        if (!s._start) return (s.hasFail || s.hasCancelled) && !!machineSet[s._machine];
        return _isToday(s._start);
      });
      RS.runsToday = sessions.length;
      RS.failedToday = sessions.filter(function (s) { return s.hasFail || s.hasCancelled; }).length;
      try {
        localStorage.setItem('rs_cache_runs_today', RS.runsToday);
        localStorage.setItem('rs_cache_failed_today', RS.failedToday);
      } catch (e) { }
      if (RS.route === 'r-dashboard') renderDashboard();
    }

    // P1 — today's valid-timestamp logs
    RS.supa.from('logs')
      .select('id,status,job_group_id,machine,app_name,branch_id,timestamp')
      .gte('timestamp', todayIso)
      .order('timestamp', { ascending: false }).limit(5000)
      .then(function (r1) {
        var logMap = {}, machineSet = {}, gidSet = {}, gids = [], machines = [];
        (r1.data || []).forEach(function (d) {
          if (d.id) logMap[d.id] = d;
          if (d.machine && !machineSet[d.machine]) { machineSet[d.machine] = true; machines.push(d.machine); }
          if (d.job_group_id && !gidSet[d.job_group_id]) { gidSet[d.job_group_id] = true; gids.push(d.job_group_id); }
        });

        if (!machines.length) { _commit(logMap, machineSet); return; }

        // P3 — null-ts logs for today's machines (catches null-ts + null-gid FAILED)
        function doP3() {
          RS.supa.from('logs')
            .select('id,status,job_group_id,machine,app_name,branch_id,timestamp')
            .is('timestamp', null).in('machine', machines).limit(500)
            .then(function (r3) {
              (r3.data || []).forEach(function (d) { if (d.id) logMap[d.id] = d; });
              _commit(logMap, machineSet);
            })
            .catch(function () { _commit(logMap, machineSet); });
        }

        // P2 — all logs sharing gids from P1 (catches null-ts FAILED with valid gid)
        if (!gids.length) { doP3(); return; }

        RS.supa.from('logs')
          .select('id,status,job_group_id,machine,app_name,branch_id,timestamp')
          .in('job_group_id', gids).limit(5000)
          .then(function (r2) {
            (r2.data || []).forEach(function (d) { if (d.id) logMap[d.id] = d; });
            doP3();
          })
          .catch(function () { doP3(); });
      }).catch(function () { });
  }

  // ── App Stats (Supabase, Fasa 6) ─────────────────────────
  function loadAppStats() {
    if (!RS.supa) return;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayIso = today.toISOString();

    var pending = RASUMI_APPS.length;
    RASUMI_APPS.forEach(function (app) {
      var names = app.firebaseNames;
      // Fetch last_ts separately (no date filter, just latest 1 record)
      var lastTsPromise = RS.supa.from('logs').select('timestamp')
        .in('app_name', names).order('timestamp', { ascending: false }).limit(1);
      // Count today's runs and errors with server-side date filter — avoids limit(200) truncation
      var todayPromise = RS.supa.from('logs').select('id,status', { count: 'exact' })
        .in('app_name', names).gte('timestamp', todayIso);
      Promise.all([lastTsPromise, todayPromise]).then(function (results) {
        var lastRow = (results[0].data || [])[0];
        var todayData = results[1].data || [];
        var lastTs = lastRow ? lastRow.timestamp : null;
        // Count sessions (by job_group_id or fallback key) — not individual log entries
        var sessionMap = {};
        todayData.forEach(function (d) {
          var gid = d.job_group_id ||
            ((d.machine || '') + '|' + (d.app_name || '') + '|' + (d.branch_id || '') + '|' + (d.timestamp || '').substring(0, 13));
          if (!sessionMap[gid]) sessionMap[gid] = { hasFail: false, hasNonProc: false, hasCompFail: false };
          var st = (d.status || '').toUpperCase();
          if (st === 'FAILED' || st === 'ERROR') { sessionMap[gid].hasFail = true; sessionMap[gid].hasCompFail = true; }
          if (st === 'COMPLETED') sessionMap[gid].hasCompFail = true;
          if (st !== 'PROCESSING') sessionMap[gid].hasNonProc = true;
        });
        var allSessions = Object.values(sessionMap);
        // Exclude phantom sessions: hasNonProc but zero actual COMPLETED/FAILED docs
        var todayCnt = allSessions.filter(function (s) { return s.hasNonProc && s.hasCompFail; }).length;
        var errCnt = allSessions.filter(function (s) { return s.hasFail; }).length;
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
    'r-renamer': 'Renamer HQ Trace',
    'r-renamer-fv': 'Renamer FV Logs',
    'r-splitter': 'PDF Splitter Logs',
    'r-studio': 'PDF Studio Logs',
    'r-quick': 'Quick Rename Logs',
    'r-scanify': 'Scanify Logs',
    'r-vibes': 'VIBES Monitor',
    'r-vims': 'VIMS Scrape',
    'r-logs': 'Log Explorer',
    'r-commands': 'Commands',
    'r-alerts': 'Alerts',
    'r-release': 'Release Management'
  };

  window.rNav = function (route) {
    _stopECG();
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
      case 'r-renamer-fv': renderAppLogs('FV Branch', 'Renamer FV', 'fa-file-invoice'); break;
      case 'r-splitter': renderAppLogs('PDF Splitter', 'PDF Splitter', 'fa-scissors'); break;
      case 'r-studio': renderAppLogs('PDF Studio', 'PDF Studio', 'fa-file-pdf'); break;
      case 'r-quick': renderAppLogs('Quick Rename', 'Quick Rename', 'fa-bolt'); break;
      case 'r-scanify': renderAppLogs('Scanify', 'Scanify', 'fa-camera'); break;
      case 'r-vibes': renderVibes(); break;
      case 'r-vims': renderVims(); break;
      case 'r-logs': renderLogs(); break;
      case 'r-commands': renderCommands(); break;
      case 'r-alerts': renderAlerts(); break;
      case 'r-release': renderReleaseMgmt(); break;
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

  // ── ECG Heartbeat Animation ──────────────────────────────
  var _ecgAnim = null;
  var _ecgOff  = 0;
  var _ECG_PTS = (function () {
    var N = 300, a = [];
    for (var i = 0; i < N; i++) {
      var t = i / N, y = 0;
      // P wave (smooth, small)
      if (t > 0.08  && t < 0.16)  y += 0.14 * Math.sin(Math.PI * (t - 0.08) / 0.08);
      // Q (sharp narrow dip)
      if (t > 0.20  && t < 0.218) y -= 0.14 * Math.sin(Math.PI * (t - 0.20) / 0.018);
      // R spike (sharp pointy — narrow window + power 0.3)
      if (t > 0.218 && t < 0.242) {
        var rp = (t - 0.218) / 0.024;
        y += Math.pow(Math.sin(Math.PI * rp), 0.3);
      }
      // S (sharp downward spike — pronounced)
      if (t > 0.242 && t < 0.262) y -= 0.55 * Math.sin(Math.PI * (t - 0.242) / 0.020);
      // T wave (pointy peak — sin^4 narrows the tip)
      if (t > 0.35  && t < 0.50)  { var tp = (t - 0.35) / 0.15; y += 0.30 * Math.pow(Math.sin(Math.PI * tp), 4); }
      a.push(y);
    }
    return a;
  })();

  function _stopECG() {
    if (_ecgAnim) { cancelAnimationFrame(_ecgAnim); _ecgAnim = null; }
  }

  function _startECG() {
    _stopECG();
    function frame() {
      var cv = document.getElementById('r-ecg-canvas');
      if (!cv) { _ecgAnim = null; return; }
      var W = cv.offsetWidth, H = cv.offsetHeight;
      if (!W || !H) { _ecgAnim = requestAnimationFrame(frame); return; }
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      var ctx = cv.getContext('2d');
      var d = RS._selectedDevice ? RS.devices[RS._selectedDevice] : null;
      var online = d && (d.status === 'ONLINE' || d._status === 'online');
      ctx.clearRect(0, 0, W, H);
      // two-level grid: fine (5px) + major (25px) — ECG paper style
      ctx.shadowBlur = 0;
      ctx.lineWidth  = 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      for (var gx = 0; gx <= W; gx += 5)  { ctx.beginPath(); ctx.moveTo(gx,0); ctx.lineTo(gx,H); ctx.stroke(); }
      for (var gy = 0; gy <= H; gy += 5)  { ctx.beginPath(); ctx.moveTo(0,gy); ctx.lineTo(W,gy); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      for (var gx2 = 0; gx2 <= W; gx2 += 25) { ctx.beginPath(); ctx.moveTo(gx2,0); ctx.lineTo(gx2,H); ctx.stroke(); }
      for (var gy2 = 0; gy2 <= H; gy2 += 25) { ctx.beginPath(); ctx.moveTo(0,gy2); ctx.lineTo(W,gy2); ctx.stroke(); }
      var mid = H * 0.50;
      var amp = H * 0.35;
      var N   = _ECG_PTS.length;
      var pps = (N * 1.6) / W;
      if (online) {
        var now = Date.now();
        // baseline wander (slow breathing ~3.2s cycle)
        var wander = amp * 0.06 * Math.sin(now / 3200);
        // beat-to-beat amplitude variation (±9%)
        var beatAmp = amp * (1 + 0.09 * Math.sin(now / 950 + 1.1));
        var dynMid  = mid + wander;
        // pass 1: outer soft glow
        ctx.beginPath();
        ctx.shadowBlur  = 0;
        ctx.strokeStyle = 'rgba(34,197,94,0.18)';
        ctx.lineWidth   = 8;
        for (var x = 0; x <= W; x++) {
          var si = Math.floor((_ecgOff + x * pps) % N);
          var yy = dynMid - beatAmp * _ECG_PTS[si];
          x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        }
        ctx.stroke();
        // pass 2: bright inner line with shadow glow
        ctx.beginPath();
        ctx.shadowBlur  = 14;
        ctx.shadowColor = '#22c55e';
        ctx.strokeStyle = '#86efac';
        ctx.lineWidth   = 1.5;
        for (var x2 = 0; x2 <= W; x2++) {
          var si2 = Math.floor((_ecgOff + x2 * pps) % N);
          var yy2 = dynMid - beatAmp * _ECG_PTS[si2];
          x2 === 0 ? ctx.moveTo(x2, yy2) : ctx.lineTo(x2, yy2);
        }
        ctx.stroke();
        // blinking dot at lead edge
        var dotVisible = Math.floor(Date.now() / 400) % 2 === 0;
        if (dotVisible) {
          var dotY = dynMid - beatAmp * _ECG_PTS[Math.floor((_ecgOff + W * pps) % N)];
          ctx.shadowBlur = 16; ctx.shadowColor = '#22c55e'; ctx.fillStyle = '#4ade80';
          ctx.beginPath(); ctx.arc(W - 3, dotY, 3, 0, Math.PI * 2); ctx.fill();
        }
        _ecgOff = (_ecgOff + 2) % N;
      } else {
        // flatline (offline) — dim green, still visible
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(34,197,94,0.35)';
        ctx.lineWidth   = 1;
        ctx.moveTo(0, mid); ctx.lineTo(W, mid);
        ctx.stroke();
      }
      _ecgAnim = requestAnimationFrame(frame);
    }
    _ecgAnim = requestAnimationFrame(frame);
  }

  // ── DASHBOARD ──────────────────────────────────────────────
  function renderDashboard() {
    var devs = Object.values(RS.devices);
    var on = devs.filter(function (d) { return d._status === 'online'; }).length;
    var st = devs.filter(function (d) { return d._status === 'stale'; }).length;
    var off = devs.filter(function (d) { return d._status === 'offline'; }).length;

    // Use global session-based counts (same logic as Log Explorer)
    var runsToday = RS.runsToday || 0;
    var errToday = RS.failedToday || 0;

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

    var selId = RS._selectedDevice;
    var selDev = selId ? RS.devices[selId] : null;

    // ── Patch-only update when dashboard DOM already exists (no flicker) ──
    if ($r('r-dash-metrics')) {
      _patchMetric('mc-on', on, 'Online now');
      _patchMetric('mc-off', off, off > 0 ? off + ' need attention' : 'All clear');
      _patchMetric('mc-runs', runsToday, 'Across all apps');
      _patchMetric('mc-err', errToday, 'Check log explorer');
      _patchMetric('mc-vibes', RS.unresolvedVibes, 'Unresolved');
      _patchMetric('mc-total', devs.length, 'Last sync: ' + lastSync);
      // Telemetry title
      var tt = $r('r-tele-title');
      if (tt) tt.innerHTML = '<i class="fa-solid fa-microchip"></i> ACTIVE TELEMETRY' +
        (selId ? ' &mdash; ' + selId : '');
      // Telemetry + health panels
      var tb = $r('r-tele-body'); if (tb) tb.innerHTML = buildTelemetryHTML(selDev);
      var hb = $r('r-health-body'); if (hb) hb.innerHTML = buildHealthHTML(selDev);
      // Recent activity
      var ra = $r('r-recent-act'); if (ra) ra.innerHTML = buildRecentActHTML();
      // App overview inner list
      var ao = $r('r-app-ov-list');
      if (ao) ao.innerHTML = RASUMI_APPS.map(function (app) {
        var stats = RS.appStats[app.key] || {};
        return '<div class="r-app-row" onclick="rNav(\'r-logs\')">' +
          '<i class="fa-solid ' + app.icon + ' r-app-ico"></i>' +
          '<span class="r-app-name">' + app.label + '</span>' +
          '<span class="r-app-cnt">Today: ' + (stats.today || 0) + '</span>' +
          ((stats.errors || 0) > 0 ? '<span class="r-app-err">' + stats.errors + ' err</span>' : '') +
          '</div>';
      }).join('');
      updateSideNodeList();
      return;  // ← skip full DOM rebuild
    }

    // ── Row 1: Metric cards (first full render only) ──
    var metricRow =
      '<div class="r-metric-row" id="r-dash-metrics">' +
      metricCard('green', on, 'TOTAL ACTIVE NODES', 'fa-circle-check', 'Online now', null, 'rCardClick(\'mc-on\')', 'mc-on') +
      metricCard('danger', off, 'OFFLINE NODES', 'fa-circle-xmark', off > 0 ? off + ' need attention' : 'All clear', null, 'rCardClick(\'mc-off\')', 'mc-off') +
      metricCard('info', runsToday, 'RUNS TODAY', 'fa-play-circle', 'Across all apps', null, 'rCardClick(\'mc-runs\')', 'mc-runs') +
      metricCard('warn', errToday, 'ISSUES TODAY', 'fa-bug', 'Failed, partial & skipped', null, 'rCardClick(\'mc-err\')', 'mc-err') +
      metricCard('purple', RS.unresolvedVibes, 'VIBES ERRORS', 'fa-triangle-exclamation', 'Unresolved', null, 'rCardClick(\'mc-vibes\')', 'mc-vibes') +
      metricCard('blue', devs.length, 'MACHINES TOTAL', 'fa-server', 'Last sync: ' + lastSync, null, 'rCardClick(\'mc-total\')', 'mc-total') +
      '</div>';

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
    var appOvHTML = '<div id="r-app-ov-list" class="r-app-list">' + RASUMI_APPS.map(function (app) {
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

      // ── Row 2: 3 columns (Telemetry | Health+ECG | Stream) ──
      '<div class="r-mid-row">' +
      '<div class="r-panel" id="r-tele-panel" style="margin:0">' +
      '<div class="r-panel-title" id="r-tele-title"><i class="fa-solid fa-microchip"></i> ACTIVE TELEMETRY' +
      (selId ? ' &mdash; ' + selId : '') +
      '</div>' +
      '<div id="r-tele-body">' + teleHTML + '</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;min-height:0;overflow:hidden">' +
      '<div class="r-panel" style="margin:0;flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden">' +
      '<div class="r-panel-title"><i class="fa-solid fa-heart-pulse"></i> NODE HEALTH</div>' +
      '<div id="r-health-body">' + healthHTML + '</div>' +
      '<div class="r-ecg-wrap">' +
      '<canvas id="r-ecg-canvas"></canvas>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="r-panel" style="margin:0;display:flex;flex-direction:column">' +
      '<div class="r-panel-title"><i class="fa-solid fa-terminal"></i> LIVE DATA STREAM</div>' +
      '<div class="r-terminal" id="r-terminal" style="flex:1;height:0;min-height:80px"><p class="r-term-line info">Waiting for log events…<span class="r-term-cursor"></span></p></div>' +
      '</div>' +
      '</div>' +

      // ── Row 3: 3 columns (Activity | Command History | App Overview) ──
      '<div class="r-bot-row">' +
      '<div class="r-panel" style="margin:0">' +
      '<div class="r-panel-title"><i class="fa-solid fa-list-check"></i> RECENT ACTIVITY</div>' +
      '<div id="r-recent-act">' + actHTML + '</div>' +
      '</div>' +
      '<div class="r-panel" style="margin:0">' +
      '<div class="r-panel-title"><i class="fa-solid fa-terminal"></i> COMMAND HISTORY</div>' +
      cmdHistHTML +
      '</div>' +
      '<div class="r-panel" style="margin:0">' +
      '<div class="r-panel-title"><i class="fa-solid fa-robot"></i> APP OVERVIEW</div>' +
      appOvHTML +
      '</div>' +
      '</div>' +

      // ── Row 4: 3 Charts ──
      '<div class="r-charts-row">' +
      '<div class="r-chart-box r-chart-cpu-box">' +
      '<div class="r-chart-hdr">' +
      '<div class="r-panel-title" style="border:none;padding:0;margin:0"><i class="fa-solid fa-microchip"></i> CPU USAGE</div>' +
      '<div class="r-chart-tabs">' +
      '<button class="r-ctab r-ctab-active" onclick="rCpuRange(\'24H\',this)">24H</button>' +
      '<button class="r-ctab" onclick="rCpuRange(\'7D\',this)">7D</button>' +
      '<button class="r-ctab" onclick="rCpuRange(\'1M\',this)">1M</button>' +
      '</div>' +
      '</div>' +
      '<div class="r-cpu-wrap"><canvas id="r-chart-cpu"></canvas><div id="r-cpu-live" class="r-cpu-live" style="display:none"></div></div>' +
      '</div>' +
      '<div class="r-chart-box"><div class="r-panel-title" style="margin-bottom:6px;border:none;padding:0"><i class="fa-solid fa-memory"></i> RAM USAGE 24H</div><canvas id="r-chart-ram"></canvas></div>' +
      '<div class="r-chart-box"><div class="r-panel-title" style="margin-bottom:6px;border:none;padding:0"><i class="fa-solid fa-hard-drive"></i> DISK USAGE 24H</div><canvas id="r-chart-disk"></canvas></div>' +
      '</div>' +

      // ── Row 5: Usage Analytics Chart ──
      '<div class="r-bot-row" style="margin-top:12px">' +
      '<div class="r-panel" style="margin:0;grid-column: 1 / -1">' +
      '<div class="r-panel-title" style="display:flex;align-items:center;gap:8px">' +
      '<i class="fa-solid fa-chart-line"></i> USAGE ANALYTICS' +
      '<div style="margin-left:auto;display:flex;gap:4px;align-items:center">' +
      '<div style="background:rgba(0,0,0,0.3);border-radius:4px;display:flex;padding:2px;margin-right:12px">' +
      '<button class="r-btn-sm" id="d-chart-by-app" style="background:rgba(56,189,248,0.2);border:none" onclick="window.rToggleDashChartType(\'app\')">By App</button>' +
      '<button class="r-btn-sm" id="d-chart-by-dev" style="background:transparent;border:none;opacity:0.6;font-weight:400" onclick="window.rToggleDashChartType(\'dev\')">By Device</button>' +
      '</div>' +
      '<button class="r-btn-sm" id="d-chart-day" style="opacity:0.45;font-weight:400" onclick="window.rToggleDashChartView(\'day\')">Day</button>' +
      '<button class="r-btn-sm" id="d-chart-week" onclick="window.rToggleDashChartView(\'week\')">Week</button>' +
      '<button class="r-btn-sm" id="d-chart-month" style="opacity:0.45;font-weight:400" onclick="window.rToggleDashChartView(\'month\')">Month</button>' +
      '</div>' +
      '</div>' +
      '<div id="d-chart-wrap" style="position:relative;height:220px;margin-top:8px">' +
      '<canvas id="d-usage-canvas" style="display:block"></canvas>' +
      '<div id="d-chart-tooltip" style="display:none;position:absolute;background:rgba(8,12,19,0.97);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px 12px;font-size:11px;pointer-events:none;z-index:10;line-height:1.9;min-width:140px"></div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:12px">' +
      '<div id="d-chart-legend" style="display:flex;gap:12px;flex-wrap:wrap;flex:1"></div>' +
      '<button class="r-btn-sm" style="background:rgba(255,255,255,0.05);color:var(--rc-text);border-color:var(--rc-border)" onclick="window.rExportDashChart()"><i class="fa-solid fa-file-excel" style="color:#22c55e"></i> Export</button>' +
      '</div>' +
      '</div>' +
      '</div>';

    // Load async: command history + charts
    loadDashCmdHist();
    initDashCharts();
    window.loadDashUsageChart(); // Load the new usage chart

    // Start live stream listener
    startLiveStream();

    // Start ECG animation
    setTimeout(_startECG, 50);
  }

  // Navigate to Log Explorer with a pre-set status filter (no flash — flag set before render)
  window.rOpenFailedLogs = function () {
    RS._pendingLogFilter = 'ISSUE';
    rNav('r-logs');
  };

  // ── Metric card builder ────────────────────────────────────
  function metricCard(cls, val, lbl, icon, sub, route, customOnclick, mid) {
    var hasAction = !!(route || customOnclick);
    var disabled = hasAction && (parseInt(val, 10) || 0) === 0;
    var click = customOnclick ? ' onclick="' + customOnclick + '"'
      : route ? ' onclick="rNav(\'' + route + '\')"' : '';
    var cursor = hasAction ? ' r-metric-card-link' : '';
    var midAttr = mid ? ' data-mid="' + mid + '"' : '';
    var disStyle = disabled ? ' style="opacity:0.4;cursor:not-allowed"' : '';
    return '<div class="r-metric-card ' + cls + cursor + '"' + click + midAttr + disStyle + '>' +
      '<div class="r-metric-label">' + lbl + '</div>' +
      '<div class="r-metric-val">' + val + '</div>' +
      '<div class="r-metric-sub">' + (sub || '') + '</div>' +
      '<i class="fa-solid ' + icon + ' r-metric-icon"></i>' +
      '</div>';
  }

  // Patch a single metric card value/sub in-place without rebuilding the DOM
  function _patchMetric(mid, val, sub) {
    var card = document.querySelector('[data-mid="' + mid + '"]');
    if (!card) return;
    var v = card.querySelector('.r-metric-val');
    var s = card.querySelector('.r-metric-sub');
    if (v) v.textContent = String(val);
    if (s && sub !== undefined) s.textContent = sub;
    // Sync disabled state for actionable cards
    if (card.classList.contains('r-metric-card-link')) {
      var disabled = (parseInt(val, 10) || 0) === 0;
      card.style.opacity = disabled ? '0.4' : '';
      card.style.cursor = disabled ? 'not-allowed' : '';
    }
  }

  function kpi(cls, val, lbl, icon, extra) {
    return '<div class="r-kpi ' + cls + '" ' + (extra || '') + '>' +
      '<div class="r-kpi-val">' + val + '</div>' +
      '<div class="r-kpi-lbl">' + lbl + '</div>' +
      '<i class="fa-solid ' + icon + ' r-kpi-ico"></i>' +
      '</div>';
  }

  // ── Metric card click handler ───────────────────────────────
  // Reads current val from DOM at click time — works with patch-only updates.
  // Returns early (no-op) if val === 0 so disabled cards don't navigate.
  window.rNavDevicesFiltered = function (status) {
    rNav('r-devices'); // renderDevices() is sync, DOM ready immediately
    var sel = $r('r-dev-stat');
    if (sel && status) { sel.value = status; rFilterDevices(''); }
  };

  window.rCardClick = function (mid) {
    var card = document.querySelector('[data-mid="' + mid + '"]');
    if (!card) return;
    var val = parseInt((card.querySelector('.r-metric-val') || {}).textContent, 10) || 0;
    if (val === 0) return;
    switch (mid) {
      case 'mc-on': rNavDevicesFiltered('online'); break;
      case 'mc-off': rNavDevicesFiltered('offline'); break;
      case 'mc-runs': rNav('r-logs'); break;
      case 'mc-err': window.rOpenFailedLogs && window.rOpenFailedLogs(); break;
      case 'mc-vibes': rNav('r-vibes'); break;
      case 'mc-total': rNav('r-devices'); break;
    }
  };

  // ── Node selection ─────────────────────────────────────────
  window.rSelectNode = function (hostname) {
    RS._selectedDevice = hostname;
    try { sessionStorage.setItem('rs_sel_dev', hostname); } catch (e) { }
    updateSideNodeList();
    if (RS.route === 'r-dashboard') updateDashTelemetry();
    else renderDashboard();
  };

  // ── Build Telemetry HTML ───────────────────────────────────
  function _fmtNetSpeed(bps) {
    if (bps === null || bps === undefined) return '—';
    if (bps >= 1048576) return (bps / 1048576).toFixed(1) + ' MB/s';
    if (bps >= 1024) return Math.round(bps / 1024) + ' KB/s';
    return Math.round(bps) + ' B/s';
  }

  function buildTelemetryHTML(d) {
    if (!d) {
      return '<div class="r-tele-empty"><i class="fa-solid fa-satellite-dish"></i>Select a node from the list</div>';
    }
    var netVal = (d.net_up_bps !== undefined || d.net_down_bps !== undefined)
      ? '<span style="color:#4ade80">↑' + _fmtNetSpeed(d.net_up_bps) + '</span> <span style="color:#38bdf8">↓' + _fmtNetSpeed(d.net_down_bps) + '</span>'
      : '—';
    var rows = [
      ['STATUS',      '<span class="r-badge ' + ({ online: 'r-badge-ok', stale: 'r-badge-warn', offline: 'r-badge-err' }[d._status] || 'r-badge-muted') + '">' + d._status.toUpperCase() + '</span>'],
      ['HOSTNAME',    '<span class="r-font-mono">' + esc(d.id || d.hostname || '—') + '</span>'],
      ['OS',          esc(d.os_name || d.os_version || d.sys_info || '—')],
      ['CURRENT JOB', esc(d.current_job || 'IDLE')],
      ['PENDING',     (d.pending_files !== undefined ? d.pending_files : '—') + ' files'],
      ['VERSION',     esc(d.version || '—')],
      ['UPTIME',      esc(d.uptime || '—')],
      ['HEARTBEAT',   fmtTs(d.last_heartbeat || d.last_seen)],
    ];
    var extraRows = [
      ['NETWORK',     netVal],
      ['IP ADDRESS',  esc(d.ip_address || '—')],
      ['PUBLIC IP',   esc(d.public_ip || '—')],
      ['BRANCH',      esc(_branchName(d.branch_id || (RS._devBranchMap && RS._devBranchMap[(d.hostname || '').toLowerCase()]) || null))],
    ];
    var rowsHTML = rows.map(function (r) {
      return '<div class="r-tele-row r-tele-row-sm"><span class="r-tele-key">' + r[0] + '</span><span class="r-tele-val">' + r[1] + '</span></div>';
    }).join('') + extraRows.map(function (r) {
      return '<div class="r-tele-row r-tele-row-sm"><span class="r-tele-key">' + r[0] + '</span><span class="r-tele-val">' + r[1] + '</span></div>';
    }).join('');
    function _tc(cmd, color, label) {
      return '<button class="r-tele-chip" style="border-color:' + color + ';color:' + color + ';background:rgba(0,0,0,0.15)" ' +
        'onclick="rSendTeleCmd(\'' + esc(d.id) + '\',\'' + cmd + '\')" title="' + cmd + '">' + (label || cmd) + '</button>';
    }
    var cmds =
      '<div class="r-tele-cmds">' +
      _tc('PING',           '#0ea5e9',         'PING') +
      _tc('RESTART',        '#f59e0b',         'RESTART') +
      _tc('KILL',           '#ef4444',         'KILL') +
      _tc('VERSION_CHECK',  '#a78bfa',         'VERSION') +
      _tc('CHECK_DISK',     '#fb923c',         'DISK') +
      _tc('GET_LOGS',       '#4ade80',         'LOGS') +
      _tc('CAPTURE_PUBLIC_IP','#22d3ee',       'LOCATION') +
      '<button class="r-tele-chip r-tele-chip-nav" onclick="rNav(\'r-device:' + esc(d.id) + '\')"><i class="fa-solid fa-eye"></i> View Details</button>' +
      '</div>';
    return '<div style="flex:1;overflow-y:auto;min-height:0">' + rowsHTML + '</div>' + cmds;
  }

  window.rSendTeleCmd = function (hostname, cmd) {
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    var user = RS.currentUser;
    RS.supa.from('commands').insert({
      target_machine: hostname, type: cmd, status: 'PENDING',
      created_at: new Date().toISOString(),
      created_by: user ? user.email : 'admin'
    }).then(function () { rToast(cmd + ' sent to ' + hostname, 'success'); })
      .catch(function (e) { rToast('Error: ' + e.message, 'error'); });
  };

  // ── View Full Log (GET_LOGS command output) ───────────────────────────────
  window.rViewFullLog = function (cmdId) {
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    // Create or reuse a floating log viewer overlay
    var ovId = 'r-fulllog-overlay';
    var existing = $r(ovId);
    if (existing) existing.remove();
    var ov = document.createElement('div');
    ov.id = ovId;
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:24px;';
    ov.innerHTML =
      '<div style="background:var(--rc-surface,#0d1117);border:1px solid var(--rc-border,#1e293b);border-radius:12px;' +
      'width:100%;max-width:820px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--rc-border,#1e293b)">' +
      '<span style="font-size:13px;font-weight:600;color:var(--rc-cyan,#38bdf8)"><i class="fa-solid fa-scroll" style="margin-right:8px"></i>Full Log Output</span>' +
      '<button onclick="document.getElementById(\'' + ovId + '\').remove()" style="background:none;border:none;color:var(--rc-muted);cursor:pointer;font-size:16px;">✕</button>' +
      '</div>' +
      '<pre id="r-fulllog-pre" style="margin:0;padding:16px;overflow:auto;font-size:11px;font-family:\'JetBrains Mono\',monospace;color:var(--rc-text);line-height:1.6;flex:1;">' +
      '<span style="color:var(--rc-muted)">Loading…</span></pre>' +
      '</div>';
    ov.addEventListener('click', function (ev) { if (ev.target === ov) ov.remove(); });
    document.body.appendChild(ov);

    RS.supa.from('command_outputs').select('content,created_at').eq('cmd_id', cmdId).limit(1)
      .then(function (res) {
        var pre = $r('r-fulllog-pre');
        if (!pre) return;
        var row = (res.data || [])[0];
        if (!row || !row.content) {
          pre.textContent = 'No log content stored for this command.';
          return;
        }
        pre.textContent = row.content;
        pre.scrollTop = pre.scrollHeight;
      })
      .catch(function (e) {
        var pre = $r('r-fulllog-pre');
        if (pre) pre.textContent = 'Error loading log: ' + (e.message || e);
      });
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
      '<div class="r-tele-row r-tele-row-sm"><span class="r-tele-key">OS</span><span class="r-tele-val">' + esc(d.os_name || d.os_version || d.sys_info || '—') + '</span></div>' +
      '<div class="r-tele-row r-tele-row-sm"><span class="r-tele-key">IP Address</span><span class="r-tele-val">' + esc(d.ip_address || '—') + '</span></div>' +
      '<div class="r-tele-row r-tele-row-sm"><span class="r-tele-key">Public IP</span><span class="r-tele-val">' + esc(d.public_ip || '—') + '</span></div>' +
      '<div class="r-tele-row r-tele-row-sm"><span class="r-tele-key">Branch</span><span class="r-tele-val">' + esc(_branchName(d.branch_id || (RS._devBranchMap && RS._devBranchMap[(d.hostname || '').toLowerCase()]) || null)) + '</span></div>';
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
    // Sort: online → stale → offline.
    // Within offline: most recently seen first; tie-break by version desc (oldest/lowest version sinks to bottom).
    var _statusOrder = { online: 0, stale: 1, offline: 2 };
    var _parseVer = function (d) { var v = d.version || d.app_version; return v ? parseFloat(v) : 0; };
    var _tsMs = function (d) {
      var ts = d.last_heartbeat || d.last_seen;
      if (!ts) return 0;
      if (ts.toDate) return ts.toDate().getTime();
      if (ts.seconds) return ts.seconds * 1000;
      return new Date(ts).getTime();
    };
    devs.sort(function (a, b) {
      var sa = _statusOrder[a._status] !== undefined ? _statusOrder[a._status] : 2;
      var sb = _statusOrder[b._status] !== undefined ? _statusOrder[b._status] : 2;
      if (sa !== sb) return sa - sb;
      // Same status tier: more recently seen first
      var ta = _tsMs(a), tb = _tsMs(b);
      if (ta !== tb) return tb - ta;
      // Same timestamp: higher version first (lower version sinks to bottom)
      return _parseVer(b) - _parseVer(a);
    });
    // Hash check — skip full rebuild if device list and statuses haven't changed.
    // The tick() function handles the online uptime counter updates each second.
    var newHash = devs.map(function (d) { return d.id + '|' + d._status + '|' + (d.id === selId ? '1' : '0'); }).join(',');
    if (panel.innerHTML && RS._sideHash === newHash) return;
    RS._sideHash = newHash;

    panel.innerHTML = devs.map(function (d) {
      var onlineAttr = d._status === 'online' ? ' data-online="' + esc(d.id) + '"' : '';
      var timeText = d._status === 'online'
        ? fmtUptime(Date.now() - (RS._onlineFrom[d.id] || Date.now()))
        : fmtElapsed(d.last_heartbeat || d.last_seen);
      return '<div class="r-node-card' + (d.id === selId ? ' active' : '') + '" onclick="rSelectNode(\'' + esc(d.id) + '\')">' +
        '<span class="r-nc-dot ' + d._status + '"></span>' +
        '<div class="r-nc-info">' +
        '<div class="r-nc-host">' + esc(d.id) + '</div>' +
        '<div class="r-nc-time"' + onlineAttr + '>' + timeText + '</div>' +
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
    updateChartFromDevice();
  }

  // ── Dashboard command history (Supabase, Fasa 6) ────────────
  function loadDashCmdHist() {
    var box = $r('r-cmd-hist-dash');
    if (!box || !RS.supa) return;
    RS.supa.from('commands').select('*').order('created_at', { ascending: false }).limit(8)
      .then(function (res) {
        var cmds = res.data || [];
        if (!cmds.length) { box.innerHTML = '<div class="r-empty" style="padding:14px">No commands yet</div>'; return; }
        box.innerHTML = '<div class="r-cmd-hist-feed">' + cmds.map(function (c) {
          return '<div class="r-ch-item">' +
            '<span class="r-badge ' + logBadge(c.status) + '" style="font-size:8px">' + esc(c.status || 'PEND') + '</span>' +
            '<span class="r-ch-cmd">' + esc(c.type || c.command || c.action || '?') + ' → ' + esc(c.target_machine || 'all') + '</span>' +
            '<span class="r-ch-time">' + fmtElapsed(c.created_at) + '</span>' +
            '</div>';
        }).join('') + '</div>';
      }).catch(function () { });
  }

  // ── Live Data Stream (Supabase Realtime, Fasa 6) ─────────
  var _liveChannel = null;
  function startLiveStream() {
    if (_liveChannel) { RS.supa.removeChannel(_liveChannel); _liveChannel = null; }
    if (!RS.supa) return;
    RS._terminal = [];

    // Seed last 20 logs on open
    RS.supa.from('logs').select('*').order('timestamp', { ascending: false }).limit(20)
      .then(function (res) {
        var rows = (res.data || []).reverse(); // oldest first for terminal display
        rows.forEach(function (e) { appendTerminalLine(e); });
      }).catch(function () { });

    // Subscribe to new INSERT events — zero polling cost
    _liveChannel = RS.supa.channel('supa-logs-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'logs' },
        function (payload) { appendTerminalLine(payload.new); }
      ).subscribe();

    addL(function () { if (_liveChannel) { RS.supa.removeChannel(_liveChannel); _liveChannel = null; } });
  }

  function appendTerminalLine(e) {
    var term = $r('r-terminal');
    if (!term) return;

    // ── PROACTIVE ALERT — toast + skip terminal for CRITICAL ───────────────
    if ((e.app_name || '').toUpperCase() === 'SYSTEM_ALERT') {
      var alertMsg = e.file_name || e.status || 'System Alert';
      var lvl = (e.status || '').toUpperCase();
      if (lvl === 'CRITICAL') {
        rToast('🔴 CRITICAL: ' + alertMsg, 'error', 10000);
      } else {
        rToast('⚠️ WARNING: ' + alertMsg, 'warn', 6000);
      }
      // Also render in terminal as a highlighted line (fall through below)
    }

    var ts = fmtTs(e.timestamp || e.created_at);
    var rawSt = e.status || '';
    var isMsg = rawSt.length > 30;
    var stCode = isMsg ? 'DEBUG' : (rawSt.toUpperCase() || 'INFO');
    var file = e.file_name || e.activity_name || '';
    var cls = stCode === 'FAILED' ? 'err' : stCode === 'COMPLETED' ? 'ok' : stCode === 'DEBUG' ? 'debug' : 'info';
    if ((e.app_name || '').toUpperCase() === 'SYSTEM_ALERT') cls = stCode === 'CRITICAL' ? 'err' : 'warn';
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
    RS._recentLogs.unshift(e);
    if (RS._recentLogs.length > 50) RS._recentLogs.pop();
    var ra = $r('r-recent-act');
    if (ra) ra.innerHTML = buildRecentActHTML();
  }

  // ── Dashboard Usage Analytics Chart ──
  var DASH_APPS = [
    { label: 'Renamer HQ', color: '#a855f7', re: /renamer\s*hq/i },
    { label: 'Renamer FV', color: '#8b5cf6', re: /fv[\s._-]branch|renamer\s*fv/i },
    { label: 'PDF Splitter', color: '#22c55e', re: /pdf[\s._-]?split/i },
    { label: 'Scanify', color: '#38bdf8', re: /scanify/i },
    { label: 'PDF Studio', color: '#eab308', re: /pdf[\s._-]?studio/i },
    { label: 'Quick Rename', color: '#f97316', re: /quick[\s._-]?rename/i },
    { label: 'Vibes Agent', color: '#ef4444', re: /vibes|vims/i },
  ];

  window.dashChartState = { view: 'week', type: 'app' }; // view: day|week|month, type: app|dev

  function _ddIsoDate(d) { return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate(); }
  function _ddIsoHour(d) { return _ddIsoDate(d) + 'T' + (d.getHours() < 10 ? '0' : '') + d.getHours() + ':00:00'; }

  window.rToggleDashChartView = function (view) {
    if (window.dashChartState.view === view) return;
    window.dashChartState.view = view;
    ['day', 'week', 'month'].forEach(function (v) {
      var btn = $r('d-chart-' + v);
      if (btn) { btn.style.opacity = view === v ? '1' : '0.45'; btn.style.fontWeight = view === v ? '600' : '400'; }
    });
    window.loadDashUsageChart();
  };

  window.rToggleDashChartType = function (type) {
    if (window.dashChartState.type === type) return;
    window.dashChartState.type = type;
    var ab = $r('d-chart-by-app'), db = $r('d-chart-by-dev');
    if (ab) { ab.style.background = type === 'app' ? 'rgba(56,189,248,0.2)' : 'transparent'; ab.style.opacity = type === 'app' ? '1' : '0.6'; ab.style.fontWeight = type === 'app' ? '600' : '400'; }
    if (db) { db.style.background = type === 'dev' ? 'rgba(56,189,248,0.2)' : 'transparent'; db.style.opacity = type === 'dev' ? '1' : '0.6'; db.style.fontWeight = type === 'dev' ? '600' : '400'; }
    window.loadDashUsageChart();
  };

  window.loadDashUsageChart = function () {
    var canvas = $r('d-usage-canvas'); if (!canvas || !RS.supa) return;
    var view = window.dashChartState.view;
    var type = window.dashChartState.type;

    var now = new Date(), labels = [], starts = [], ends = [];
    if (view === 'day') {
      var dStart = new Date(now); dStart.setHours(0, 0, 0, 0);
      for (var i = 0; i < 24; i++) {
        var dh = new Date(dStart); dh.setHours(i);
        var labelTime = i === 0 ? '12 AM' : i < 12 ? i + ' AM' : i === 12 ? '12 PM' : (i - 12) + ' PM';
        labels.push(labelTime); starts.push(_ddIsoHour(dh));
        var dhe = new Date(dh); dhe.setHours(i, 59, 59); ends.push(_ddIsoDate(dhe) + 'T' + (dhe.getHours() < 10 ? '0' : '') + dhe.getHours() + ':59:59');
      }
    } else if (view === 'week') {
      var dow = now.getDay();
      var mon = new Date(now); mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1)); mon.setHours(0, 0, 0, 0);
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (n, i) {
        var d = new Date(mon); d.setDate(mon.getDate() + i);
        labels.push(n); starts.push(_ddIsoDate(d) + 'T00:00:00'); ends.push(_ddIsoDate(d) + 'T23:59:59');
      });
    } else { // month
      var yr = now.getFullYear(), mo = now.getMonth();
      var dim = new Date(yr, mo + 1, 0).getDate();
      for (var i = 1; i <= dim; i++) {
        var d = new Date(yr, mo, i);
        labels.push(String(i)); starts.push(_ddIsoDate(d) + 'T00:00:00'); ends.push(_ddIsoDate(d) + 'T23:59:59');
      }
    }

    canvas.style.opacity = '0.35';
    // Fetch COMPLETED logs for the full range
    RS.supa.from('logs').select('app_name,machine,timestamp')
      .gte('timestamp', starts[0]).lte('timestamp', ends[ends.length - 1]).eq('status', 'COMPLETED')
      .then(function (res) {
        canvas.style.opacity = '1';
        var data = res.data || [];

        if (view === 'day') {
          var hasOutside = data.some(function (e) {
            var hrIdx = starts.findIndex(function (s, idx) { return (e.timestamp || '') >= s && (e.timestamp || '') <= ends[idx]; });
            return hrIdx !== -1 && (hrIdx < 8 || hrIdx > 17);
          });
          if (!hasOutside) {
            starts = starts.slice(8, 18);
            ends = ends.slice(8, 18);
            labels = labels.slice(8, 18);
          }
        }

        var datasets = [];

        if (type === 'app') {
          datasets = DASH_APPS.map(function (grp) {
            return {
              label: grp.label, color: grp.color,
              data: starts.map(function (s, i) {
                return data.filter(function (e) {
                  return grp.re.test(e.app_name || '') && (e.timestamp || '') >= s && (e.timestamp || '') <= ends[i];
                }).length;
              })
            };
          }).filter(function (ds) { return ds.data.some(function (v) { return v > 0; }); });
        } else {
          // Dynamic Devices
          var devMap = {};
          data.forEach(function (e) {
            var m = e.machine || 'Unknown';
            if (!devMap[m]) devMap[m] = { label: m, color: _hashColors(m), data: new Array(starts.length).fill(0) };
          });
          data.forEach(function (e) {
            var m = e.machine || 'Unknown';
            for (var i = 0; i < starts.length; i++) {
              if ((e.timestamp || '') >= starts[i] && (e.timestamp || '') <= ends[i]) {
                devMap[m].data[i]++;
                break;
              }
            }
          });
          datasets = Object.keys(devMap).map(function (k) { return devMap[k]; })
            .filter(function (ds) { return ds.data.some(function (v) { return v > 0; }); });
        }

        canvas._exportData = { datasets: datasets, labels: labels, title: 'Dash Usage ' + (type === 'app' ? 'By App' : 'By Device') };
        window.dashDrawUsageChart(canvas, datasets, labels);
        _renderDashLegend(datasets);
      }).catch(function () { canvas.style.opacity = '1'; });
  };

  function _hashColors(str) {
    if ((str || '').toLowerCase() === 'kakaroth') return ['#facc15', '#f97316', '#ef4444'];
    var h1 = 0, h2 = 0, h3 = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 = c + ((h1 << 5) - h1);
      h2 = (c * 31) + ((h2 << 4) - h2);
      h3 = (c * 17) + ((h3 << 6) - h3);
    }
    function hex(h) { var x = (h & 0x00FFFFFF).toString(16).toUpperCase(); return '#' + ('00000'.substring(0, 6 - x.length) + x); }
    return [hex(h1), hex(h2), hex(h3)];
  }

  function _renderDashLegend(datasets) {
    var lg = $r('d-chart-legend'); if (!lg) return;
    lg.innerHTML = datasets.map(function (ds) {
      var cStyle = Array.isArray(ds.color) ? 'background:linear-gradient(135deg,' + ds.color.join(',') + ')' : 'background:' + ds.color;
      return '<div style="display:flex;align-items:center;gap:4px;font-size:11px">' +
        '<div style="width:8px;height:8px;border-radius:50%;' + cStyle + '"></div>' + esc(ds.label) + '</div>';
    }).join('');
  }

  window.rExportDashChart = function () {
    var canvas = $r('d-usage-canvas');
    if (!canvas || !canvas._exportData) { rToast('No data to export', 'warn'); return; }
    var data = canvas._exportData;
    var rows = [['Category'].concat(data.labels)];
    data.datasets.forEach(function (ds) { rows.push([ds.label].concat(ds.data)); });

    var doExport = function (XLSX) {
      var ws = XLSX.utils.aoa_to_sheet(rows);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Usage Data");
      XLSX.writeFile(wb, (data.title || 'usage') + '_' + new Date().getTime() + '.xlsx');
    };

    if (window.XLSX) { doExport(window.XLSX); return; }
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = function () { doExport(window.XLSX); };
    s.onerror = function () { rToast('XLSX library unavailable', 'err'); };
    document.head.appendChild(s);
  };

  window.dashDrawUsageChart = function (canvas, datasets, labels) {
    var dpr = window.devicePixelRatio || 1;
    var wrap = canvas.parentElement;
    var W = wrap ? (wrap.offsetWidth || 800) : 800;
    var H = 220;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var pL = 46, pR = 16, pT = 14, pB = 32;
    var cW = W - pL - pR, cH = H - pT - pB, n = labels.length;
    var maxVal = 0;
    datasets.forEach(function (ds) { ds.data.forEach(function (v) { if (v > maxVal) maxVal = v; }); });
    if (!maxVal) maxVal = 10;
    var nice = Math.pow(10, Math.floor(Math.log10(maxVal)));
    maxVal = Math.ceil(maxVal / nice) * nice;

    function xP(i) { return pL + (n > 1 ? i / (n - 1) : 0.5) * cW; }
    function yP(v) { return pT + cH - (v / maxVal) * cH; }

    // Grid lines + Y labels
    for (var g = 0; g <= 4; g++) {
      var gy = pT + g / 4 * cH;
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pL, gy); ctx.lineTo(W - pR, gy); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.font = '10px var(--rc-font)'; ctx.textAlign = 'right';
      ctx.fillText(Math.round(maxVal * (1 - g / 4)), pL - 5, gy + 3);
    }
    // X labels
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    var skip = n > 20 ? 3 : n > 10 ? 2 : 1;
    labels.forEach(function (l, i) { if (i % skip === 0) ctx.fillText(l, xP(i), H - pB + 14); });

    // Lines + area fills
    datasets.forEach(function (ds) {
      var isArr = Array.isArray(ds.color);
      var mainC = isArr ? ds.color[0] : ds.color;
      var pts = ds.data.map(function (v, i) { return { x: xP(i), y: yP(v) }; });
      // Area
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) {
        var cx = (pts[i - 1].x + pts[i].x) / 2;
        ctx.bezierCurveTo(cx, pts[i - 1].y, cx, pts[i].y, pts[i].x, pts[i].y);
      }
      ctx.lineTo(pts[pts.length - 1].x, pT + cH); ctx.lineTo(pts[0].x, pT + cH); ctx.closePath();
      var grad = ctx.createLinearGradient(0, pT, 0, pT + cH);
      grad.addColorStop(0, mainC + '2e'); grad.addColorStop(1, mainC + '00');
      ctx.fillStyle = grad; ctx.fill();
      // Line
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) {
        var cx = (pts[i - 1].x + pts[i].x) / 2;
        ctx.bezierCurveTo(cx, pts[i - 1].y, cx, pts[i].y, pts[i].x, pts[i].y);
      }
      if (isArr) {
        var lineGrad = ctx.createLinearGradient(pL, 0, W - pR, 0);
        lineGrad.addColorStop(0, ds.color[0]);
        lineGrad.addColorStop(0.5, ds.color[1]);
        lineGrad.addColorStop(1, ds.color[2]);
        ctx.strokeStyle = lineGrad;
      } else {
        ctx.strokeStyle = mainC;
      }
      ctx.lineWidth = 1; ctx.stroke();
      // Dots
      pts.forEach(function (p, i) {
        if (!ds.data[i]) return;
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fillStyle = mainC; ctx.fill();
      });
    });

    canvas._base = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas._chart = { datasets: datasets, labels: labels, xP: xP, yP: yP, pL: pL, pR: pR, pT: pT, pB: pB, cW: cW, cH: cH, W: W, H: H, n: n };

    canvas.onmousemove = function (e) {
      var cd = canvas._chart; if (!cd) return;
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      if (mx < cd.pL) mx = cd.pL; if (mx > cd.W - cd.pR) mx = cd.W - cd.pR;
      var ratio = (mx - cd.pL) / cd.cW;
      var idx = Math.round(ratio * (cd.n - 1));
      if (idx < 0) idx = 0; if (idx >= cd.n) idx = cd.n - 1;

      var snapX = cd.xP(idx);
      ctx.putImageData(canvas._base, 0, 0);

      ctx.beginPath(); ctx.moveTo(snapX, cd.pT); ctx.lineTo(snapX, cd.pT + cd.cH);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);

      var tt = $r('d-chart-tooltip');
      var lines = ['<div style="color:var(--rc-text-dim);font-size:10px;margin-bottom:6px">' + cd.labels[idx] + '</div>'];
      var total = 0;
      cd.datasets.forEach(function (ds) {
        var v = ds.data[idx];
        if (!v) return;
        total += v;
        var mainC = Array.isArray(ds.color) ? ds.color[0] : ds.color;
        var cStyle = Array.isArray(ds.color) ? 'background:linear-gradient(135deg,' + ds.color.join(',') + ')' : 'background:' + ds.color;
        ctx.beginPath(); ctx.arc(snapX, cd.yP(v), 5, 0, Math.PI * 2);
        ctx.fillStyle = mainC; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#080c13'; ctx.stroke();
        lines.push('<div style="display:flex;justify-content:space-between;gap:12px">' +
          '<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;' + cStyle + ';margin-right:6px"></span>' + esc(ds.label) + '</span>' +
          '<span style="font-weight:600">' + v + '</span></div>');
      });
      if (total === 0) lines.push('<div style="color:#64748b">No data</div>');

      if (tt) {
        tt.innerHTML = lines.join('');
        tt.style.display = 'block';
        tt.style.left = (snapX > cd.W / 2 ? snapX - tt.offsetWidth - 15 : snapX + 15) + 'px';
        tt.style.top = (cd.pT + 10) + 'px';
      }
    };
    canvas.onmouseleave = function () {
      var tt = $r('d-chart-tooltip');
      if (tt) tt.style.display = 'none';
      if (canvas._base) ctx.putImageData(canvas._base, 0, 0);
    };
  };

  // ── Dashboard Charts ──
  // ── DISK: Animated gradient donut — breathing glow + rotating shimmer + tip pulse ──
  function _drawDiskDonut(canvas, pct, usedLabel) {
    if (canvas._animFrame) { cancelAnimationFrame(canvas._animFrame); canvas._animFrame = null; }

    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 220;
    var cssH = canvas.clientHeight || 155;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    var ctx = canvas.getContext('2d');
    var W = cssW, H = cssH, cx = W / 2, cy = H / 2;
    var R = Math.min(W, H) * 0.40;
    var lw = R * 0.30;
    var startA = -Math.PI / 2;
    var endA = startA + Math.PI * 2 * Math.min(Math.max(pct, 0), 100) / 100;
    var t0 = null;

    function frame(ts) {
      if (!t0) t0 = ts;
      var elapsed = ts - t0;

      // Breathing: 0→1→0 over 2s
      var breathe = (1 - Math.cos((elapsed % 2000) / 2000 * Math.PI * 2)) / 2;
      // Shimmer: highlight point sweeps along the filled arc over 3s
      var shimmerAngle = startA + ((elapsed % 3000) / 3000) * (endA - startA);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);

      // ── Track ring ──
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = lw;
      ctx.lineCap = 'butt';
      ctx.stroke();

      if (pct > 0.5) {
        var g = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
        g.addColorStop(0, '#38bdf8');
        g.addColorStop(0.45, '#b200ff');
        g.addColorStop(1, '#ff00aa');

        // Effect 1 — Breathing outer glow: spread and opacity oscillate with breathe
        ctx.beginPath();
        ctx.arc(cx, cy, R, startA, endA);
        ctx.strokeStyle = 'rgba(56,189,248,' + (0.08 + 0.14 * breathe).toFixed(2) + ')';
        ctx.lineWidth = lw + 6 + 10 * breathe;
        ctx.lineCap = 'round';
        ctx.stroke();

        // ── Main arc ──
        ctx.beginPath();
        ctx.arc(cx, cy, R, startA, endA);
        ctx.strokeStyle = g;
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Effect 2 — Rotating shimmer: white radial highlight sweeps the arc every 3s
        if (shimmerAngle >= startA && shimmerAngle <= endA) {
          var shimX = cx + R * Math.cos(shimmerAngle);
          var shimY = cy + R * Math.sin(shimmerAngle);
          var shimR = lw * 0.55;
          var sg = ctx.createRadialGradient(shimX, shimY, 0, shimX, shimY, shimR);
          sg.addColorStop(0, 'rgba(255,255,255,0.55)');
          sg.addColorStop(0.4, 'rgba(255,255,255,0.15)');
          sg.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.beginPath();
          ctx.arc(shimX, shimY, shimR, 0, Math.PI * 2);
          ctx.fillStyle = sg;
          ctx.fill();
        }

        // Effect 3 — Tip pulse: glowing spot at the leading edge beats with breathe
        var tipX = cx + R * Math.cos(endA);
        var tipY = cy + R * Math.sin(endA);
        var tipR = lw * (0.45 + 0.25 * breathe);
        var tg = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, tipR);
        tg.addColorStop(0, 'rgba(255,255,255,' + (0.7 + 0.3 * breathe).toFixed(2) + ')');
        tg.addColorStop(0.35, 'rgba(255,0,170,0.5)');
        tg.addColorStop(1, 'rgba(255,0,170,0)');
        ctx.beginPath();
        ctx.arc(tipX, tipY, tipR, 0, Math.PI * 2);
        ctx.fillStyle = tg;
        ctx.fill();
      }

      // ── Centre text ──
      ctx.shadowBlur = 0;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold ' + Math.round(H * 0.23) + 'px Inter,sans-serif';
      ctx.fillText(Math.round(pct) + '%', cx, cy - H * 0.05);
      ctx.fillStyle = '#6B7A8F';
      ctx.font = Math.round(H * 0.075) + 'px Inter,sans-serif';
      ctx.fillText(usedLabel + ' used', cx, cy + H * 0.13);

      ctx.restore();
      canvas._animFrame = requestAnimationFrame(frame);
    }

    canvas._animFrame = requestAnimationFrame(frame);
  }

  // ── RAM: Animated capsule ring — breathing glow + tip pulse via rAF ──
  function _drawRamDots(canvas, pct, usedLabel) {
    // Cancel previous animation loop on this canvas before redrawing
    if (canvas._animFrame) { cancelAnimationFrame(canvas._animFrame); canvas._animFrame = null; }

    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 220;
    var cssH = canvas.clientHeight || 155;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    var ctx = canvas.getContext('2d');
    var W = cssW, H = cssH, cx = W / 2, cy = H / 2;
    var base = Math.min(W, H);
    var ringR = base * 0.39;
    var dotW = base * 0.038;          // capsule narrow axis
    var dotH = base * 0.120;          // capsule tall axis — matches disk donut thickness
    var N = 36;                    // fewer dots = visible gap between each capsule
    var filled = Math.round(N * Math.min(Math.max(pct, 0), 100) / 100);
    var hw = dotW / 2, hh = dotH / 2, cr = hw;

    function lerpC(c1, c2, t) {
      var r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16);
      var r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16);
      return 'rgb(' + Math.round(r1 + (r2 - r1) * t) + ',' + Math.round(g1 + (g2 - g1) * t) + ',' + Math.round(b1 + (b2 - b1) * t) + ')';
    }

    // Draw a rounded-rect capsule centred at (0,0) in local space
    function pill(ctx) {
      ctx.beginPath();
      ctx.moveTo(-hw + cr, -hh);
      ctx.lineTo(hw - cr, -hh);
      ctx.arcTo(hw, -hh, hw, -hh + cr, cr);
      ctx.lineTo(hw, hh - cr);
      ctx.arcTo(hw, hh, hw - cr, hh, cr);
      ctx.lineTo(-hw + cr, hh);
      ctx.arcTo(-hw, hh, -hw, hh - cr, cr);
      ctx.lineTo(-hw, -hh + cr);
      ctx.arcTo(-hw, -hh, -hw + cr, -hh, cr);
      ctx.closePath();
    }

    var t0 = null;

    function frame(ts) {
      if (!t0) t0 = ts;
      // Breathing: smooth sine 0→1→0 over 2 seconds
      var phase = ((ts - t0) % 2000) / 2000;
      var breathe = (1 - Math.cos(phase * Math.PI * 2)) / 2;
      // glow ranges 7–18 for body dots, tip gets 2.2× at peak
      var glow = 7 + 11 * breathe;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);

      for (var i = 0; i < N; i++) {
        var a = (i / N) * Math.PI * 2 - Math.PI / 2;
        var x = cx + ringR * Math.cos(a);
        var y = cy + ringR * Math.sin(a);
        var t = i / N;
        var isTip = (i === filled - 1);

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a - Math.PI / 2);  // long axis → radial direction

        if (i < filled) {
          var col = t < 0.33 ? lerpC('#b200ff', '#38bdf8', t / 0.33)
            : t < 0.66 ? lerpC('#38bdf8', '#ff00aa', (t - 0.33) / 0.33)
              : lerpC('#ff00aa', '#b200ff', (t - 0.66) / 0.34);

          // Effect 1 — Breathing glow on all filled capsules
          pill(ctx);
          ctx.fillStyle = col;
          ctx.shadowColor = col;
          ctx.shadowBlur = isTip ? glow * 2.2 : glow;
          ctx.fill();

          // Effect 2 — Tip pulse: second fill pass doubles the brightness at the leading edge
          if (isTip) {
            pill(ctx);
            ctx.shadowBlur = glow * 1.5;
            ctx.fill();
          }
          ctx.shadowBlur = 0;
        } else {
          pill(ctx);
          ctx.fillStyle = 'rgba(255,255,255,0.06)';
          ctx.fill();
        }
        ctx.restore();
      }

      // Centre text — clear shadow before drawing
      ctx.shadowBlur = 0;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold ' + Math.round(H * 0.23) + 'px Inter,sans-serif';
      ctx.fillText(Math.round(pct) + '%', cx, cy - H * 0.05);
      ctx.fillStyle = '#6B7A8F';
      ctx.font = Math.round(H * 0.075) + 'px Inter,sans-serif';
      ctx.fillText(usedLabel + ' used', cx, cy + H * 0.13);

      ctx.restore();
      canvas._animFrame = requestAnimationFrame(frame);
    }

    canvas._animFrame = requestAnimationFrame(frame);
  }

  function initDashCharts() {
    if (typeof Chart === 'undefined') return;

    // ── CPU: Gradient line chart with 24H/7D/1M range ──
    var cpuCanvas = $r('r-chart-cpu');
    if (cpuCanvas) {
      if (RS._charts.cpu) { RS._charts.cpu.destroy(); delete RS._charts.cpu; }
      // Build blue→green 5-stop gradient along X axis
      var cpuCtx = cpuCanvas.getContext('2d');
      var cpuGrad = cpuCtx.createLinearGradient(0, 0, cpuCanvas.offsetWidth || 400, 0);
      cpuGrad.addColorStop(0, '#1a7fff');
      cpuGrad.addColorStop(0.25, '#00ccdd');
      cpuGrad.addColorStop(0.5, '#00e5aa');
      cpuGrad.addColorStop(0.75, '#00ef80');
      cpuGrad.addColorStop(1, '#39ff6e');
      // Vertical fill gradient (transparent under the line)
      var cpuFill = cpuCtx.createLinearGradient(0, 0, 0, cpuCanvas.offsetHeight || 180);
      cpuFill.addColorStop(0, 'rgba(0,220,140,0.18)');
      cpuFill.addColorStop(1, 'rgba(0,220,140,0)');
      RS._charts.cpu = new Chart(cpuCanvas, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            data: [],
            borderColor: cpuGrad,
            backgroundColor: cpuFill,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: cpuGrad,
            pointBorderColor: 'transparent',
            pointHoverRadius: 5,
            tension: 0.45,
            fill: true,
            spanGaps: false   // gaps = offline periods
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: { label: function (ctx) { return ' ' + ctx.parsed.y + '%'; } },
              backgroundColor: 'rgba(10,14,26,0.9)',
              titleColor: '#aaa', bodyColor: '#00e887',
              borderColor: 'rgba(0,220,140,0.3)', borderWidth: 1
            },
          },
          scales: {
            x: {
              grid: { color: 'rgba(255,255,255,0.04)' },
              ticks: { color: '#6B7A8F', font: { size: 8 }, maxTicksLimit: 8, maxRotation: 0 }
            },
            y: {
              grid: { color: 'rgba(255,255,255,0.04)' },
              ticks: { color: '#6B7A8F', font: { size: 8 }, stepSize: 20, callback: function (v) { return v + '%'; } },
              beginAtZero: true, max: 100
            }
          }
        }
      });
      // Custom drag-to-pan (no external plugin needed)
      _initCpuPan(RS._charts.cpu, cpuCanvas);
    }
    if (!RS._cpuRange) RS._cpuRange = '24H';

    // ── RAM: Custom dots circle — no Chart.js, drawn via _drawRamDots ──
    var ramCanvas = $r('r-chart-ram');
    if (ramCanvas) {
      if (RS._charts.ram) { RS._charts.ram.destroy(); delete RS._charts.ram; }
      RS._charts.ram = null;
      _drawRamDots(ramCanvas, 0, '0 GB');
    }

    // ── DISK: Custom gradient donut — no Chart.js, drawn via _drawDiskDonut ──
    var diskCanvas = $r('r-chart-disk');
    if (diskCanvas) {
      if (RS._charts.disk) { RS._charts.disk.destroy(); delete RS._charts.disk; }
      RS._charts.disk = null;
      _drawDiskDonut(diskCanvas, 0, '0 GB');
    }

    updateChartFromDevice();
  }

  function updateChartFromDevice() {
    var d = RS._selectedDevice ? RS.devices[RS._selectedDevice] : null;
    if (!d || typeof Chart === 'undefined') return;

    // RAM — custom dots circle
    var ramCanvas = $r('r-chart-ram');
    if (ramCanvas && d.ram_pct !== undefined) {
      var ramUsed = Math.round(d.ram_pct);
      var ramLabelUsed = d.ram_used_gb !== undefined ? d.ram_used_gb + ' GB' : ramUsed + '%';
      _drawRamDots(ramCanvas, ramUsed, ramLabelUsed);
    }

    // DISK — custom gradient donut
    var diskCanvas = $r('r-chart-disk');
    if (diskCanvas && d.disk_pct !== undefined) {
      var diskUsed = Math.round(d.disk_pct);
      var diskLabelUsed = d.disk_used_gb !== undefined ? d.disk_used_gb + ' GB' : diskUsed + '%';
      _drawDiskDonut(diskCanvas, diskUsed, diskLabelUsed);
    }

    // CPU — fetch based on current range
    if (RS.supa && d.id) fetchCpuChart(d.id, RS._cpuRange || '24H');
  }

  // ── CPU chart range toggle (called by 24H / 7D / 1M buttons) ──
  window.rCpuRange = function (range, btn) {
    RS._cpuRange = range;
    RS._cpuUserPanning = false;
    if (RS._charts.cpu && typeof RS._charts.cpu.resetZoom === 'function') {
      RS._charts.cpu.resetZoom('none');
    }
    document.querySelectorAll('.r-ctab').forEach(function (b) { b.classList.remove('r-ctab-active'); });
    if (btn) btn.classList.add('r-ctab-active');
    var d = RS._selectedDevice ? RS.devices[RS._selectedDevice] : null;
    if (d && d.id) fetchCpuChart(d.id, range);
  };

  // ── Fetch + render CPU chart for given hostname and range ──
  function fetchCpuChart(hostname, range) {
    if (!RS.supa || !hostname) return;
    var now = Date.now();
    var groupByDay = range !== '24H';
    var since;
    if (range === '24H') {
      var startDt = new Date(); startDt.setDate(startDt.getDate() - 3); startDt.setHours(0, 0, 0, 0);
      since = startDt.toISOString();
    } else {
      var msBack = range === '7D' ? 7 * 864e5 : 30 * 864e5;
      since = new Date(now - msBack).toISOString();
    }

    RS.supa.from('machine_telemetry')
      .select('cpu_pct,recorded_at')
      .eq('hostname', hostname)
      .gte('recorded_at', since)
      .order('recorded_at', { ascending: true })
      .limit(2000)
      .then(function (res) {
        var rows = res.data || [];
        var labels = [], data = [];

        var minLabel = null, maxLabel = null;
        if (!groupByDay) {
          // 24H: Fetch last 3 days to allow panning (30-min intervals)
          var startDt = new Date(); startDt.setDate(startDt.getDate() - 3); startDt.setHours(0, 0, 0, 0);
          var endDt = new Date(); endDt.setHours(23, 30, 0, 0);
          var slotMap = {};
          var current = new Date(startDt.getTime());
          while (current.getTime() <= endDt.getTime()) {
            var label = String(current.getDate()).padStart(2, '0') + '/' +
              String(current.getMonth() + 1).padStart(2, '0') + ' ' +
              String(current.getHours()).padStart(2, '0') + ':' +
              String(current.getMinutes()).padStart(2, '0');
            labels.push(label);
            data.push(0);
            slotMap[label] = data.length - 1;
            current = new Date(current.getTime() + 1800000); // add 30 mins
          }

          rows.forEach(function (r) {
            var dt = new Date(r.recorded_at);
            dt.setMinutes(Math.floor(dt.getMinutes() / 30) * 30, 0, 0);
            var label = String(dt.getDate()).padStart(2, '0') + '/' +
              String(dt.getMonth() + 1).padStart(2, '0') + ' ' +
              String(dt.getHours()).padStart(2, '0') + ':' +
              String(dt.getMinutes()).padStart(2, '0');
            var idx = slotMap[label];
            if (idx !== undefined) {
              data[idx] = r.cpu_pct != null ? Math.round(r.cpu_pct * 10) / 10 : 0;
            }
          });

          // 4-hour sliding window from now
          var nowDt = new Date();
          nowDt.setMinutes(Math.floor(nowDt.getMinutes() / 30) * 30, 0, 0);
          var minDt = new Date(nowDt.getTime() - 4 * 3600000); // 4 hours ago

          minLabel = String(minDt.getDate()).padStart(2, '0') + '/' +
            String(minDt.getMonth() + 1).padStart(2, '0') + ' ' +
            String(minDt.getHours()).padStart(2, '0') + ':' +
            String(minDt.getMinutes()).padStart(2, '0');
          maxLabel = String(nowDt.getDate()).padStart(2, '0') + '/' +
            String(nowDt.getMonth() + 1).padStart(2, '0') + ' ' +
            String(nowDt.getHours()).padStart(2, '0') + ':' +
            String(nowDt.getMinutes()).padStart(2, '0');
        } else {
          // 7D / 1M — group by calendar day, average per day
          var days = range === '7D' ? 7 : 30;
          var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          var dayMap = {};
          rows.forEach(function (r) {
            if (r.cpu_pct == null) return;
            var dt = new Date(r.recorded_at);
            var key = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
            if (!dayMap[key]) dayMap[key] = { sum: 0, n: 0 };
            dayMap[key].sum += r.cpu_pct; dayMap[key].n++;
          });
          for (var i = days - 1; i >= 0; i--) {
            var dt = new Date(now - i * 864e5);
            var key = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
            labels.push(range === '7D' ? dayNames[dt.getDay()] : (dt.getDate() + '/' + (dt.getMonth() + 1)));
            var s = dayMap[key];
            data.push(s && s.n ? Math.round(s.sum / s.n * 10) / 10 : 0);
          }
        }

        var cpuChart = RS._charts.cpu;
        if (!cpuChart) return;

        var cpuCanvas = $r('r-chart-cpu');
        var colors = _hashColors(hostname);
        if (cpuCanvas) {
          var cpuCtx = cpuCanvas.getContext('2d');
          var cpuGrad = cpuCtx.createLinearGradient(0, 0, cpuCanvas.offsetWidth || 400, 0);
          cpuGrad.addColorStop(0, colors[0]);
          cpuGrad.addColorStop(0.5, colors[1]);
          cpuGrad.addColorStop(1, colors[2]);
          var cpuFill = cpuCtx.createLinearGradient(0, 0, 0, 180);
          cpuFill.addColorStop(0, colors[0] + '40');
          cpuFill.addColorStop(1, colors[0] + '00');
          cpuChart.data.datasets[0].borderColor = cpuGrad;
          cpuChart.data.datasets[0].backgroundColor = cpuFill;
          if (cpuChart.options.plugins.tooltip) {
            cpuChart.options.plugins.tooltip.bodyColor = colors[0];
            cpuChart.options.plugins.tooltip.borderColor = colors[0] + '40';
          }
        }

        cpuChart.data.labels = labels;
        cpuChart.data.datasets[0].data = data;

        // Force array of colors for points so Chart.js clears old gradient cache
        cpuChart.data.datasets[0].pointBackgroundColor = data.map(function () { return colors[2]; });
        cpuChart.data.datasets[0].pointBorderColor = data.map(function () { return colors[2]; });
        cpuChart.data.datasets[0].pointHoverBackgroundColor = data.map(function () { return colors[2]; });
        cpuChart.data.datasets[0].borderWidth = 1;
        cpuChart.data.datasets[0].pointRadius = 1;

        // Keep continuous line to show smooth bukit shape
        cpuChart.data.datasets[0].spanGaps = true;
        if (groupByDay) {
          // 7D/1M: clear any x-axis window so full range is visible
          cpuChart.options.scales.x.min = undefined;
          cpuChart.options.scales.x.max = undefined;
        } else if (!RS._cpuUserPanning) {
          // Custom 8am - 5pm window (or wider if active)
          cpuChart.options.scales.x.min = minLabel;
          cpuChart.options.scales.x.max = maxLabel;
        }
        cpuChart.update('none');

        // Live blinking dot — only for 24H when device is currently online
        var dev = RS._selectedDevice ? RS.devices[RS._selectedDevice] : null;
        var isLive = !groupByDay && dev && deviceStatus(dev) === 'online';
        _updateCpuLiveDot(cpuChart, isLive, data);
      }).catch(function () { });
  }

  // Position the blinking overlay dot on the last non-null point
  function _updateCpuLiveDot(chart, isLive, data) {
    var dot = document.getElementById('r-cpu-live');
    if (!dot) return;
    if (!isLive) { dot.style.display = 'none'; return; }
    var lastIdx = data.length - 1;
    while (lastIdx >= 0 && data[lastIdx] == null) lastIdx--;
    if (lastIdx < 0) { dot.style.display = 'none'; return; }
    try {
      var meta = chart.getDatasetMeta(0);
      var point = meta.data[lastIdx];
      if (!point) { dot.style.display = 'none'; return; }
      dot.style.display = 'block';
      dot.style.left = point.x + 'px';
      dot.style.top = point.y + 'px';
    } catch (e) { dot.style.display = 'none'; }
  }

  // Custom drag-to-pan for CPU chart (replaces chartjs-plugin-zoom on category axes).
  // Admin drags left/right to scroll the 3-hour window; no scrollbar shown.
  function _initCpuPan(chart, canvas) {
    var dragX = null;

    function doPan(dx) {
      var lbls = chart.data.labels;
      if (!lbls || lbls.length < 2) return;
      try {
        var xScale = chart.scales.x;
        var chartPx = xScale.right - xScale.left;
        var curMin = chart.options.scales.x.min;
        var curMax = chart.options.scales.x.max;
        var minIdx = curMin !== undefined ? lbls.indexOf(curMin) : 0;
        var maxIdx = curMax !== undefined ? lbls.indexOf(curMax) : lbls.length - 1;
        if (minIdx < 0) minIdx = 0;
        if (maxIdx < 0) maxIdx = lbls.length - 1;
        var visSlots = maxIdx - minIdx + 1;
        var slotDelta = Math.round(-dx * visSlots / chartPx);
        if (slotDelta === 0) return;
        var newMin = Math.max(0, minIdx + slotDelta);
        var newMax = newMin + visSlots - 1;
        if (newMax >= lbls.length) { newMax = lbls.length - 1; newMin = Math.max(0, newMax - visSlots + 1); }
        chart.options.scales.x.min = lbls[newMin];
        chart.options.scales.x.max = lbls[newMax];
        chart.update('none');
      } catch (e) { }
    }

    // Mouse
    canvas.addEventListener('mousedown', function (e) {
      dragX = e.clientX;
      RS._cpuUserPanning = true;
      clearTimeout(RS._cpuPanTimer);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('mousemove', function (e) {
      if (dragX === null) return;
      doPan(e.clientX - dragX);
      dragX = e.clientX;
    });
    function endDrag() {
      if (dragX !== null) {
        RS._cpuPanTimer = setTimeout(function () { RS._cpuUserPanning = false; }, 8000);
      }
      dragX = null;
      canvas.style.cursor = 'grab';
    }
    canvas.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', endDrag);
    canvas.style.cursor = 'grab';

    // Touch
    canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) {
        dragX = e.touches[0].clientX;
        RS._cpuUserPanning = true;
        clearTimeout(RS._cpuPanTimer);
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', function (e) {
      if (e.touches.length === 1 && dragX !== null) {
        e.preventDefault();
        doPan(e.touches[0].clientX - dragX);
        dragX = e.touches[0].clientX;
      }
    }, { passive: false });
    canvas.addEventListener('touchend', function () {
      if (dragX !== null) RS._cpuPanTimer = setTimeout(function () { RS._cpuUserPanning = false; }, 8000);
      dragX = null;
    });
  }

  // Set CPU chart x-axis to show ~3 hours ending at current time.
  // Uses direct Chart.js options (no plugin) — avoids the silent-fail of zoomScale on category axes.
  function _cpuScrollToNow(chart) {
    try {
      var lbls = chart.data.labels;
      if (!lbls || !lbls.length) return;
      var now = new Date();
      var nowLabel = String(now.getHours()).padStart(2, '0') + ':' +
        String(Math.floor(now.getMinutes() / 10) * 10).padStart(2, '0');
      // Find closest label to current time
      var nowIdx = lbls.indexOf(nowLabel);
      if (nowIdx < 0) nowIdx = lbls.length - 1;
      var visible = 18;                                          // 18 × 10 min = ~3 hours
      var maxIdx = Math.min(nowIdx + 2, lbls.length - 1);     // slight right padding
      var minIdx = Math.max(maxIdx - visible + 1, 0);
      chart.options.scales.x.min = lbls[minIdx];
      chart.options.scales.x.max = lbls[maxIdx];
      chart.update('none');
    } catch (e) { }
  }

  // ── DEVICES ────────────────────────────────────────────────
  // Sort state for Device Fleet table
  RS._devSort = RS._devSort || { col: null, dir: 1 };

  function _devSortedDevs(devs) {
    var col = RS._devSort.col;
    var dir = RS._devSort.dir;
    if (!col) return devs;
    return devs.slice().sort(function (a, b) {
      var av, bv;
      switch (col) {
        case 'hostname': av = (a.hostname || '').toLowerCase(); bv = (b.hostname || '').toLowerCase(); break;
        case 'id': av = (RS._devBranchMap && RS._devBranchMap[(a.hostname || '').toLowerCase()] || '').toLowerCase(); bv = (RS._devBranchMap && RS._devBranchMap[(b.hostname || '').toLowerCase()] || '').toLowerCase(); break;
        case 'branch': av = _branchName((RS._devBranchMap && RS._devBranchMap[(a.hostname || '').toLowerCase()]) || '').toLowerCase(); bv = _branchName((RS._devBranchMap && RS._devBranchMap[(b.hostname || '').toLowerCase()]) || '').toLowerCase(); break;
        case 'status': av = a._status || ''; bv = b._status || ''; break;
        case 'job': av = (a.current_job || '').toLowerCase(); bv = (b.current_job || '').toLowerCase(); break;
        case 'version': av = parseFloat(a.version) || 0; bv = parseFloat(b.version) || 0; break;
        case 'heartbeat': av = (a.last_heartbeat || a.last_seen || '').toString(); bv = (b.last_heartbeat || b.last_seen || '').toString(); break;
        default: return 0;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  function _devThStyle() { return 'cursor:pointer;user-select:none;white-space:nowrap'; }

  function _devTh(label, col, width) {
    var active = RS._devSort.col === col;
    var arrow = active ? (RS._devSort.dir === 1 ? ' ↑' : ' ↓') : ' <span style="opacity:0.25">↕</span>';
    var style = _devThStyle() + (active ? ';color:#38bdf8' : '') + (width ? ';width:' + width : '');
    return '<th style="' + style + '" onclick="rSortDevices(\'' + col + '\')">' + label + arrow + '</th>';
  }

  // Map full app names → short display labels for Current Job column
  var _JOB_LABEL = {
    'renamer hq': 'RENAMER',
    'fv branch': 'RENAMER FV',
    'pdf splitter': 'SPLITTER',
    'pdf studio': 'PDF STUDIO',
    'quick rename': 'QUICK RENAME',
    'vibes automation': 'VIBES',
    'scanify': 'SCANIFY'
  };
  function _fmtJob(raw) {
    if (!raw) return null;
    var lower = raw.toLowerCase().trim();
    if (lower === 'idle' || lower === 'offline' || lower === '') return null;
    return _JOB_LABEL[lower] || raw.toUpperCase();
  }

  function renderDevices() {
    var devs = _devSortedDevs(Object.values(RS.devices));
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
      '<thead><tr>' +
      '<th style="width:32px"></th>' +
      _devTh('Hostname', 'hostname', '200px') +
      _devTh('ID', 'id', '110px') +
      _devTh('Branch', 'branch', '100px') +
      _devTh('Status', 'status', '90px') +
      _devTh('Current Job', 'job', '130px') +
      _devTh('Version', 'version', '75px') +
      _devTh('Last Heartbeat', 'heartbeat', '155px') +
      '<th style="width:90px">Action</th>' +
      '</tr></thead>' +
      '<tbody id="r-dev-tbody">' + devRows(devs) + '</tbody>' +
      '</table>' +
      '</div>' +
      '</div>';
  }

  window.rSortDevices = function (col) {
    if (RS._devSort.col === col) {
      RS._devSort.dir *= -1;
    } else {
      RS._devSort.col = col;
      RS._devSort.dir = 1;
    }
    renderDevices();
    // re-apply active filter if any
    var fq = ($r('r-dev-filter') || {}).value || '';
    var stat = ($r('r-dev-stat') || {}).value || '';
    if (fq || stat) rFilterDevices(fq);
  };

  function devRows(devs) {
    if (!devs.length) return '<tr><td colspan="9" class="r-empty-td">No machines reporting. Ensure Rasumi Apps is running.</td></tr>';
    var isSuperAdmin = RS.userRole === 'superadmin';
    return devs.map(function (d) {
      var sc = { online: 'r-badge-ok', stale: 'r-badge-warn', offline: 'r-badge-err' }[d._status] || 'r-badge-muted';
      var branchId = (d.branch_id || (RS._devBranchMap && RS._devBranchMap[(d.hostname || '').toLowerCase()]) || '').toLowerCase();
      var branchDisp = _branchName(branchId);
      var isOwner = branchDisp === 'SUPER ADMIN';  // covers 'mustaqim' OR 'super admin' in logs
      var safeHost = esc(d.id);

      // ID column — mustaqim masked for non-superadmins; permanently concealed
      var idCell;
      if (isOwner) {
        if (isSuperAdmin) {
          // Superadmin: masked by default, clickable eye to toggle reveal
          idCell = '<td class="r-font-mono" style="white-space:nowrap">' +
            '<span id="devid-' + safeHost + '" data-real="' + esc(branchId) + '" data-hidden="1" ' +
            'style="letter-spacing:2px;color:#64748b">••••••••</span>' +
            '<button onclick="event.stopPropagation();rToggleDevId(\'' + safeHost + '\')" ' +
            'id="devid-btn-' + safeHost + '" title="Reveal ID" ' +
            'style="background:none;border:none;color:rgba(255,255,255,0.25);cursor:pointer;font-size:11px;margin-left:5px;padding:0">' +
            '<i class="fa-solid fa-eye"></i></button>' +
            '</td>';
        } else {
          // Non-superadmin: permanently hidden, dimmed eye, no click
          idCell = '<td class="r-font-mono" style="white-space:nowrap">' +
            '<span style="letter-spacing:2px;color:#334155">••••••••</span>' +
            '<span title="Access restricted" style="color:rgba(255,255,255,0.1);font-size:11px;margin-left:5px">' +
            '<i class="fa-solid fa-eye-slash"></i></span>' +
            '</td>';
        }
      } else {
        idCell = '<td class="r-font-mono" style="font-size:11px;color:#94a3b8">' + esc(branchId || '—') + '</td>';
      }

      var jobLabel = _fmtJob(d.current_job);
      var jobCell = jobLabel
        ? '<span style="color:#38bdf8;font-size:11px;font-weight:600;letter-spacing:.5px">' + esc(jobLabel) + '</span>'
        : d._status === 'offline'
          ? '<span style="color:#334155">—</span>'
          : '<span style="color:#475569;font-size:11px">IDLE</span>';

      return '<tr onclick="rNav(\'r-device:' + safeHost + '\')" style="cursor:pointer">' +
        '<td><span class="r-status-dot ' + d._status + '"></span></td>' +
        '<td class="r-font-mono">' + safeHost + '</td>' +
        idCell +
        '<td style="font-size:11px;color:#94a3b8">' + esc(branchDisp) + '</td>' +
        '<td><span class="r-badge ' + sc + '">' + d._status.toUpperCase() + '</span></td>' +
        '<td>' + jobCell + '</td>' +
        '<td style="color:#94a3b8">' + esc(d.version || '—') + '</td>' +
        '<td>' + fmtTs(d.last_heartbeat || d.last_seen) + '</td>' +
        '<td><button class="r-btn-sm" onclick="event.stopPropagation();rNav(\'r-device:' + safeHost + '\')">Detail →</button></td>' +
        '</tr>';
    }).join('');
  }

  // Toggle masked ID visibility — superadmin only
  window.rToggleDevId = function (hostname) {
    if (RS.userRole !== 'superadmin') return;
    var span = document.getElementById('devid-' + hostname);
    var btn = document.getElementById('devid-btn-' + hostname);
    if (!span) return;
    var hidden = span.getAttribute('data-hidden') === '1';
    if (hidden) {
      span.textContent = span.getAttribute('data-real');
      span.style.letterSpacing = '';
      span.style.color = '#e2e8f0';
      span.setAttribute('data-hidden', '0');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
    } else {
      span.textContent = '••••••••';
      span.style.letterSpacing = '2px';
      span.style.color = '#64748b';
      span.setAttribute('data-hidden', '1');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-eye"></i>';
    }
  };

  window.rFilterDevices = function (q) {
    var stat = ($r('r-dev-stat') || {}).value || '';
    var lq = (q || '').toLowerCase();
    var devs = _devSortedDevs(Object.values(RS.devices).filter(function (d) {
      return (!lq || d.id.toLowerCase().indexOf(lq) !== -1) && (!stat || d._status === stat);
    }));
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
      '<div class="r-dev-mid-row" style="margin-bottom:12px">' +
      '<div class="r-panel" style="margin:0;grid-column:span 2;min-width:0">' +
      '<div class="r-panel-title" style="display:flex;align-items:center;gap:8px">' +
      '<i class="fa-solid fa-chart-line"></i> APP USAGE' +
      '<div style="margin-left:auto;display:flex;gap:4px">' +
      '<button class="r-btn-sm" id="dd-chart-week" onclick="rDdChartView(\'week\',\'' + esc(hostname) + '\')">Week</button>' +
      '<button class="r-btn-sm" id="dd-chart-month" onclick="rDdChartView(\'month\',\'' + esc(hostname) + '\')">Month</button>' +
      '</div>' +
      '</div>' +
      '<div id="dd-chart-wrap" style="position:relative;height:230px;margin-top:8px">' +
      '<canvas id="dd-usage-canvas" style="display:block"></canvas>' +
      '<div id="dd-chart-tooltip" style="display:none;position:absolute;background:rgba(8,12,19,0.97);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px 12px;font-size:11px;pointer-events:none;z-index:10;line-height:1.9;min-width:140px"></div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">' +
      '<div id="dd-chart-legend" style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;flex:1"></div>' +
      '<button class="r-btn-sm" onclick="rDdExportUsage(\'' + esc(hostname) + '\')" title="Export XLS"><i class="fa-solid fa-file-excel"></i> Export</button>' +
      '</div>' +
      '</div>' +
      '<div class="r-panel" style="margin:0">' +
      '<div class="r-panel-title"><i class="fa-solid fa-server"></i> SYSTEM TELEMETRY</div>' +
      buildSysTeleHTML(d) +
      '</div>' +
      '<div class="r-panel" style="margin:0;display:flex;flex-direction:column;">' +
      '<div class="r-panel-title" style="display:flex;align-items:center;justify-content:space-between;">' +
      '<span><i class="fa-solid fa-map-location-dot"></i> DEVICE LOCATION</span>' +
      '<span style="font-size:10px;color:#64748b;font-weight:normal;letter-spacing:0.5px">' + (d.geo_city ? 'LOCATION: ' + esc((d.geo_city + (d.geo_country ? ', ' + d.geo_country : '')).toUpperCase()) : 'IP: ' + esc(d.public_ip || d.ip_address || 'Unknown')) + '</span>' +
      '</div>' +
      '<div style="flex:1;position:relative;border-radius:6px;overflow:hidden;background:#0f172a;min-height:200px;">' +
      '<iframe width="100%" height="100%" frameborder="0" style="border:0;position:absolute;top:0;left:0;" src="https://maps.google.com/maps?q=' + (d.geo_lat && d.geo_lon ? (d.geo_lat + ',' + d.geo_lon) : esc(d.public_ip || d.location || 'Kuala Lumpur, Malaysia')) + '&t=k&z=15&ie=UTF8&iwloc=&output=embed" allowfullscreen></iframe>' +
      '</div>' +
      '</div>' +
      '<div class="r-panel" style="margin:0">' +
      '<div class="r-panel-title" style="display:flex;align-items:center;gap:8px">' +
      '<i class="fa-solid fa-heart-pulse"></i> DEVICE HEALTH' +
      '<div style="margin-left:auto;display:flex;gap:6px;align-items:center">' +
      '<div style="position:relative">' +
      '<button class="r-btn-sm" onclick="rDdDiskSettingsToggle(this)" title="Select disks to clean"><i class="fa-solid fa-gear"></i></button>' +
      '<div id="dd-disk-menu" class="r-health-disk-menu" style="display:none">' +
      '<div style="font-size:10px;color:#94a3b8;margin-bottom:6px;letter-spacing:0.5px;font-weight:600">SELECT DISKS TO CLEAN</div>' +
      '<div id="dd-disk-list" style="color:#475569;font-size:11px">— Run health check first —</div>' +
      '</div>' +
      '</div>' +
      '<button class="r-btn-sm" id="dd-cleanup-btn" onclick="rDdDiskCleanup(\'' + esc(hostname) + '\')">' +
      '<i class="fa-solid fa-broom"></i> Disk Clean Up</button>' +
      '<button class="r-btn-sm" id="dd-health-refresh-btn" onclick="rDdHealthRefresh(\'' + esc(hostname) + '\')">' +
      '<i class="fa-solid fa-rotate"></i> Refresh</button>' +
      '</div>' +
      '</div>' +
      '<div id="dd-health-body" style="margin-top:10px">' +
      '<div class="r-health-placeholder">' +
      '<i class="fa-solid fa-heart-pulse" style="font-size:22px;opacity:0.3;margin-bottom:8px"></i>' +
      '<span>Click <strong style="color:#64748b">Refresh</strong> to load device health data</span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="r-panel" style="margin:0;display:flex;flex-direction:column;">' +
      '<div class="r-panel-title"><i class="fa-solid fa-terminal"></i> LIVE STREAM</div>' +
      '<div class="r-terminal" id="r-terminal" style="height:270px;overflow-y:auto"><p class="r-term-line info">Showing device logs…<span class="r-term-cursor"></span></p></div>' +
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
    setTimeout(function () { if (window.rDdChartView) window.rDdChartView('week', hostname); }, 80);
    setTimeout(function () {
      var cached = RS._healthCache && RS._healthCache[hostname];
      if (cached) {
        _rDdRenderHealth(cached, hostname);
      } else if (RS.supa) {
        RS.supa.from('commands')
          .select('result,created_at')
          .eq('target_machine', hostname)
          .eq('type', 'HEALTH_CHECK')
          .in('status', ['COMPLETED', 'EXECUTED'])
          .order('created_at', { ascending: false })
          .limit(1)
          .then(function (res) {
            if (res.data && res.data[0] && res.data[0].result) {
              try { _rDdRenderHealth(JSON.parse(res.data[0].result), hostname); } catch (e) {}
            }
          });
      }
    }, 50);
  }

  window.rDdTab = function (tab, hostname) {
    qra('.r-tab').forEach(function (t) { t.classList.remove('active'); });
    var t = $r('rtab-' + tab); if (t) t.classList.add('active');
    var box = $r('r-dd-content');
    if (!box) return;
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Loading…</div>';
    switch (tab) {
      case 'activity': ddActivity(hostname, box); break;
      case 'jobs': ddJobs(hostname, box); break;
      case 'errors': ddErrors(hostname, box); break;
      case 'cmds': ddCmds(hostname, box); break;
    }
  };

  // _logCache and _recentLogs are initialized in RS state above

  function ddActivity(hostname, box) {
    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
    RS.supa.from('logs').select('*').eq('machine', hostname)
      .order('timestamp', { ascending: false }).limit(5000)
      .then(function (res) {
        _processAndRenderLogs(res.data || [], box, '');
      }).catch(function (err) { box.innerHTML = errBox(err.message); });
  }

  // ── Device Detail: App Usage Chart ────────────────────────────────────────
  var _DD_APPS = [
    { label: 'Renamer', color: '#a855f7', re: /renamer|fv[\s._-]branch/i },
    { label: 'PDF Splitter', color: '#22c55e', re: /pdf[\s._-]?split/i },
    { label: 'Scanify', color: '#38bdf8', re: /scanify/i },
    { label: 'PDF Studio', color: '#eab308', re: /pdf[\s._-]?studio/i },
    { label: 'Quick Rename', color: '#f97316', re: /quick[\s._-]?rename/i },
    { label: 'Vibes Agent', color: '#ef4444', re: /vibes/i },
  ];

  function _dd2(n) { return n < 10 ? '0' + n : String(n); }
  function _ddIsoDate(d) { return d.getFullYear() + '-' + _dd2(d.getMonth() + 1) + '-' + _dd2(d.getDate()); }

  window.rDdChartView = function (view, hostname) {
    var wb = $r('dd-chart-week'), mb = $r('dd-chart-month');
    if (wb) { wb.style.opacity = view === 'week' ? '1' : '0.45'; wb.style.fontWeight = view === 'week' ? '600' : '400'; }
    if (mb) { mb.style.opacity = view === 'month' ? '1' : '0.45'; mb.style.fontWeight = view === 'month' ? '600' : '400'; }
    var canvas = $r('dd-usage-canvas'); if (!canvas) return;

    var now = new Date(), labels = [], starts = [], ends = [];
    if (view === 'week') {
      var dow = now.getDay();
      var mon = new Date(now); mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1)); mon.setHours(0, 0, 0, 0);
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (n, i) {
        var d = new Date(mon); d.setDate(mon.getDate() + i);
        labels.push(n); starts.push(_ddIsoDate(d) + 'T00:00:00'); ends.push(_ddIsoDate(d) + 'T23:59:59');
      });
    } else {
      var yr = now.getFullYear(), mo = now.getMonth();
      var dim = new Date(yr, mo + 1, 0).getDate();
      for (var i = 1; i <= dim; i++) {
        var d = new Date(yr, mo, i);
        labels.push(String(i)); starts.push(_ddIsoDate(d) + 'T00:00:00'); ends.push(_ddIsoDate(d) + 'T23:59:59');
      }
    }

    if (!RS.supa) return;
    canvas.style.opacity = '0.35';
    RS.supa.from('logs').select('app_name,timestamp,status')
      .eq('machine', hostname).gte('timestamp', starts[0]).lte('timestamp', ends[ends.length - 1])
      .then(function (res) {
        canvas.style.opacity = '1';
        var data = res.data || [];
        var datasets = _DD_APPS.map(function (grp) {
          return {
            label: grp.label, color: grp.color,
            data: starts.map(function (s, i) {
              return data.filter(function (e) {
                return grp.re.test(e.app_name || '') &&
                  (e.timestamp || '') >= s && (e.timestamp || '') <= ends[i] &&
                  (e.status || '').toUpperCase() === 'COMPLETED';
              }).length;
            })
          };
        }).filter(function (ds) { return ds.data.some(function (v) { return v > 0; }); });

        canvas._exportData = { datasets: datasets, labels: labels, hostname: hostname };
        _ddDraw(canvas, datasets, labels);
        _ddLegend(datasets);
      }).catch(function () { canvas.style.opacity = '1'; });
  };

  function _ddDraw(canvas, datasets, labels) {
    var dpr = window.devicePixelRatio || 1;
    var wrap = canvas.parentElement;
    var W = wrap ? (wrap.offsetWidth || 640) : 640;
    var H = 200;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var pL = 46, pR = 16, pT = 14, pB = 32;
    var cW = W - pL - pR, cH = H - pT - pB, n = labels.length;
    var maxVal = 0;
    datasets.forEach(function (ds) { ds.data.forEach(function (v) { if (v > maxVal) maxVal = v; }); });
    if (!maxVal) maxVal = 10;
    var nice = Math.pow(10, Math.floor(Math.log10(maxVal)));
    maxVal = Math.ceil(maxVal / nice) * nice;

    function xP(i) { return pL + (n > 1 ? i / (n - 1) : 0.5) * cW; }
    function yP(v) { return pT + cH - (v / maxVal) * cH; }

    // Grid lines + Y labels
    for (var g = 0; g <= 4; g++) {
      var gy = pT + g / 4 * cH;
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pL, gy); ctx.lineTo(W - pR, gy); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.font = '10px monospace'; ctx.textAlign = 'right';
      ctx.fillText(Math.round(maxVal * (1 - g / 4)), pL - 5, gy + 3);
    }
    // X labels
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    var skip = n > 20 ? 3 : n > 10 ? 2 : 1;
    labels.forEach(function (l, i) { if (i % skip === 0) ctx.fillText(l, xP(i), H - pB + 14); });

    // Lines + area fills
    datasets.forEach(function (ds) {
      var isArr = Array.isArray(ds.color);
      var mainC = isArr ? ds.color[0] : ds.color;
      var pts = ds.data.map(function (v, i) { return { x: xP(i), y: yP(v) }; });
      // Area
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) {
        var cx = (pts[i - 1].x + pts[i].x) / 2;
        ctx.bezierCurveTo(cx, pts[i - 1].y, cx, pts[i].y, pts[i].x, pts[i].y);
      }
      ctx.lineTo(pts[pts.length - 1].x, pT + cH); ctx.lineTo(pts[0].x, pT + cH); ctx.closePath();
      var grad = ctx.createLinearGradient(0, pT, 0, pT + cH);
      grad.addColorStop(0, mainC + '2e'); grad.addColorStop(1, mainC + '00');
      ctx.fillStyle = grad; ctx.fill();
      // Line
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) {
        var cx = (pts[i - 1].x + pts[i].x) / 2;
        ctx.bezierCurveTo(cx, pts[i - 1].y, cx, pts[i].y, pts[i].x, pts[i].y);
      }
      if (isArr) {
        var lineGrad = ctx.createLinearGradient(pL, 0, W - pR, 0);
        lineGrad.addColorStop(0, ds.color[0]);
        lineGrad.addColorStop(0.5, ds.color[1]);
        lineGrad.addColorStop(1, ds.color[2]);
        ctx.strokeStyle = lineGrad;
      } else {
        ctx.strokeStyle = mainC;
      }
      ctx.lineWidth = 1; ctx.stroke();
      // Dots
      pts.forEach(function (p, i) {
        if (!ds.data[i]) return;
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fillStyle = mainC; ctx.fill();
      });
    });

    // Snapshot base for hover overlay
    canvas._base = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas._chart = { datasets: datasets, labels: labels, xP: xP, yP: yP, pL: pL, pR: pR, pT: pT, pB: pB, cW: cW, cH: cH, W: W, H: H, n: n };

    canvas.onmousemove = function (e) {
      var cd = canvas._chart; if (!cd) return;
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var idx = Math.round((mx - cd.pL) / cd.cW * (cd.n - 1));
      idx = Math.max(0, Math.min(cd.n - 1, idx));

      var c2 = canvas.getContext('2d');
      if (canvas._base) c2.putImageData(canvas._base, 0, 0);
      var dp = window.devicePixelRatio || 1;
      c2.setTransform(dp, 0, 0, dp, 0, 0);
      // Crosshair
      var lx = cd.xP(idx);
      c2.beginPath(); c2.moveTo(lx, cd.pT); c2.lineTo(lx, cd.pT + cd.cH);
      c2.strokeStyle = 'rgba(255,255,255,0.18)'; c2.lineWidth = 1; c2.stroke();
      // Highlight dots
      cd.datasets.forEach(function (ds) {
        var p = { x: cd.xP(idx), y: cd.yP(ds.data[idx] || 0) };
        c2.beginPath(); c2.arc(p.x, p.y, 5, 0, Math.PI * 2);
        c2.fillStyle = ds.color; c2.fill();
        c2.strokeStyle = 'rgba(255,255,255,0.75)'; c2.lineWidth = 1.5; c2.stroke();
      });

      // Tooltip
      var tip = $r('dd-chart-tooltip'); if (!tip) return;
      var html = '<div style="font-weight:600;margin-bottom:4px;color:rgba(255,255,255,0.9);font-size:12px">' + cd.labels[idx] + '</div>';
      cd.datasets.forEach(function (ds) {
        var val = ds.data[idx] || 0;
        html += '<div style="white-space:nowrap"><span style="color:' + ds.color + '">●</span> ' + ds.label + ': <b style="color:#fff">' + val + ' doc' + (val !== 1 ? 's' : '') + '</b></div>';
      });
      tip.innerHTML = html; tip.style.display = 'block';
      var tw = tip.offsetWidth || 160;
      var tx = lx + 14; if (tx + tw > cd.W - cd.pR) tx = lx - tw - 10;
      tip.style.left = tx + 'px'; tip.style.top = '8px';
    };
    canvas.onmouseleave = function () {
      var tip = $r('dd-chart-tooltip'); if (tip) tip.style.display = 'none';
      if (canvas._base) canvas.getContext('2d').putImageData(canvas._base, 0, 0);
    };
  }

  function _ddLegend(datasets) {
    var leg = $r('dd-chart-legend'); if (!leg) return;
    leg.innerHTML = !datasets.length
      ? '<span style="color:rgba(255,255,255,0.3)">No activity this period</span>'
      : datasets.map(function (ds) {
        return '<span style="display:flex;align-items:center;gap:5px">' +
          '<span style="width:9px;height:9px;border-radius:50%;background:' + ds.color + '"></span>' +
          '<span style="color:rgba(255,255,255,0.55)">' + ds.label + '</span></span>';
      }).join('');
  }

  window.rDdExportUsage = function (hostname) {
    var canvas = $r('dd-usage-canvas');
    var ed = canvas && canvas._exportData;
    if (!ed || !ed.datasets.length) { rToast('No data to export', 'warn'); return; }
    function doExport(XLSX) {
      var rows = [[''].concat(ed.datasets.map(function (d) { return d.label; }))];
      ed.labels.forEach(function (l, i) {
        rows.push([l].concat(ed.datasets.map(function (d) { return d.data[i] || 0; })));
      });
      rows.push(['TOTAL'].concat(ed.datasets.map(function (d) { return d.data.reduce(function (a, b) { return a + b; }, 0); })));
      var ws = XLSX.utils.aoa_to_sheet(rows);
      // Bold header row
      var wb2 = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb2, ws, 'Usage — ' + hostname);
      XLSX.writeFile(wb2, 'usage_' + hostname + '_' + new Date().toISOString().substring(0, 10) + '.xlsx');
      rToast('Exported', 'ok');
    }
    if (window.XLSX) { doExport(window.XLSX); return; }
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = function () { doExport(window.XLSX); };
    s.onerror = function () { rToast('XLSX library unavailable', 'err'); };
    document.head.appendChild(s);
  };
  // ── End App Usage Chart ────────────────────────────────────────────────

  // ── Device Health Card ─────────────────────────────────────────────────

  function _fmtBytes(b) {
    if (!b || b === 0) return '0 B';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = Math.floor(Math.log(b) / Math.log(1024));
    return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i];
  }

  function _healthRow(label, val) {
    return '<div class="r-health-row"><span class="r-health-label">' + label + '</span><span class="r-health-val">' + val + '</span></div>';
  }

  window.rDdHealthRefresh = function (hostname) {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    var body = $r('dd-health-body');
    var btn = $r('dd-health-refresh-btn');
    if (!body) return;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> Refreshing'; }
    body.innerHTML = '<div class="r-health-placeholder"><i class="fa-solid fa-rotate fa-spin" style="font-size:22px;opacity:0.5;display:block;margin-bottom:8px"></i>Sending HEALTH_CHECK to device…</div>';
    if (!RS.supa) {
      body.innerHTML = '<div class="r-health-placeholder" style="color:#ef4444">Supabase not ready</div>';
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Refresh'; }
      return;
    }
    var user = RS.currentUser;
    RS.supa.from('commands').insert({
      target_machine: hostname,
      type: 'HEALTH_CHECK',
      status: 'PENDING',
      created_at: new Date().toISOString(),
      created_by: user ? user.email : 'admin'
    }).select('id').then(function (res) {
      if (res.error || !res.data || !res.data[0]) {
        body.innerHTML = '<div class="r-health-placeholder" style="color:#ef4444">Failed to send command</div>';
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Refresh'; }
        return;
      }
      var cmdId = res.data[0].id;
      body.innerHTML = '<div class="r-health-placeholder"><i class="fa-solid fa-rotate fa-spin" style="font-size:22px;opacity:0.5;display:block;margin-bottom:8px"></i>Waiting for device response…</div>';
      var attempts = 0;
      var poll = setInterval(function () {
        attempts++;
        if (attempts > 30) {
          clearInterval(poll);
          body.innerHTML = '<div class="r-health-placeholder" style="color:#f59e0b"><i class="fa-solid fa-clock"></i> Timeout — device did not respond (60s)</div>';
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Refresh'; }
          return;
        }
        RS.supa.from('commands').select('status,result').eq('id', cmdId).single().then(function (r) {
          if (!r.data) return;
          if (r.data.status === 'COMPLETED' || r.data.status === 'EXECUTED') {
            clearInterval(poll);
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Refresh'; }
            try {
              _rDdRenderHealth(JSON.parse(r.data.result), hostname);
            } catch (e) {
              body.innerHTML = '<div class="r-health-placeholder" style="color:#ef4444">Invalid data from device</div>';
            }
          } else if (r.data.status === 'FAILED') {
            clearInterval(poll);
            body.innerHTML = '<div class="r-health-placeholder" style="color:#ef4444">Health check failed on device</div>';
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Refresh'; }
          }
        });
      }, 2000);
    }).catch(function (e) {
      body.innerHTML = '<div class="r-health-placeholder" style="color:#ef4444">' + esc(e.message || 'Error') + '</div>';
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Refresh'; }
    });
  };

  function _rDdRenderHealth(data, hostname) {
    var body = $r('dd-health-body');
    if (!body) return;
    var html = '<div class="r-health-grid">';

    // Storage
    if (data.disks && data.disks.length) {
      var diskHtml = data.disks.map(function (d) {
        var c = d.percent > 90 ? '#ef4444' : d.percent > 75 ? '#f59e0b' : '#22c55e';
        return '<div style="margin-bottom:5px">' +
          '<span style="color:#94a3b8;font-size:10px">' + esc(d.device) + '</span>' +
          '<span style="color:#e2e8f0;margin-left:6px">' + _fmtBytes(d.free) + ' free / ' + _fmtBytes(d.total) + '</span>' +
          '<div style="height:3px;background:#1e293b;border-radius:2px;margin-top:3px">' +
          '<div style="height:100%;width:' + d.percent + '%;background:' + c + ';border-radius:2px;transition:width 0.4s"></div>' +
          '</div></div>';
      }).join('');
      html += _healthRow('STORAGE', diskHtml);
      var dl = $r('dd-disk-list');
      if (dl) {
        dl.innerHTML = data.disks.map(function (d) {
          return '<label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:pointer">' +
            '<input type="checkbox" class="dd-disk-check" value="' + esc(d.device) + '" checked>' +
            '<span style="color:#e2e8f0">' + esc(d.device) + '</span>' +
            '<span style="color:#475569;font-size:10px">' + _fmtBytes(d.total) + '</span>' +
            '</label>';
        }).join('');
      }
    }

    // Temp files
    var tempTotal = (data.temp_size || 0) + (data.win_temp_size || 0);
    var tempClr = tempTotal > 500 * 1024 * 1024 ? '#f59e0b' : '#64748b';
    html += _healthRow('TEMP FILES',
      '<span style="color:' + tempClr + '">' + _fmtBytes(tempTotal) + '</span>' +
      (tempTotal > 500 * 1024 * 1024 ? ' <span style="font-size:10px;color:#f59e0b">⚠ High</span>' : ''));

    // Cache
    var cacheClr = (data.cache_size || 0) > 300 * 1024 * 1024 ? '#f59e0b' : '#64748b';
    html += _healthRow('CACHE',
      '<span style="color:' + cacheClr + '">' + _fmtBytes(data.cache_size || 0) + '</span>' +
      ((data.cache_size || 0) > 300 * 1024 * 1024 ? ' <span style="font-size:10px;color:#f59e0b">⚠ High</span>' : ''));

    // Battery (hidden if null = desktop)
    if (data.battery) {
      var bat = data.battery;
      var batClr = bat.percent < 20 ? '#ef4444' : bat.percent < 50 ? '#f59e0b' : '#22c55e';
      html += _healthRow('BATTERY',
        '<span style="color:' + batClr + '">' + Math.round(bat.percent) + '%</span>' +
        (bat.plugged ? ' <span style="color:#38bdf8;font-size:10px">⚡ Charging</span>' : '') +
        '<div style="height:3px;background:#1e293b;border-radius:2px;margin-top:3px;width:100px">' +
        '<div style="height:100%;width:' + Math.min(100, bat.percent) + '%;background:' + batClr + ';border-radius:2px"></div></div>');
    }

    // Disk type
    if (data.disk_types && data.disk_types.length) {
      html += _healthRow('DISK TYPE', data.disk_types.map(function (t) {
        var c = t.type === 'NVMe' ? '#38bdf8' : t.type === 'SSD' ? '#22c55e' : t.type === 'HDD' ? '#f59e0b' : '#64748b';
        // Strip redundant type prefix from friendly name (e.g. "NVMe KINGSTON..." → "KINGSTON...")
        var dispName = t.name.replace(/^(NVMe|SSD|HDD)\s+/i, '');
        return '<span style="margin-right:14px"><span style="color:#94a3b8;font-size:10px">' + esc(dispName) + '</span> <span style="color:' + c + '">' + esc(t.type) + '</span></span>';
      }).join(''));
    } else {
      html += _healthRow('DISK TYPE', '<span style="color:#334155">N/A</span>');
    }

    // Disk health
    if (data.disk_health && data.disk_health.length) {
      html += _healthRow('DISK HEALTH', data.disk_health.map(function (h) {
        var c = h.health < 70 ? '#ef4444' : h.health < 90 ? '#f59e0b' : '#22c55e';
        return '<span style="margin-right:14px"><span style="color:#94a3b8;font-size:10px">' + esc(h.name) + '</span> <span style="color:' + c + '">' + h.health + '%</span> <span style="color:#334155;font-size:10px">(' + esc(h.status || '') + ')</span></span>';
      }).join(''));
    } else {
      html += _healthRow('DISK HEALTH', '<span style="color:#334155">N/A</span>');
    }

    // Junk processes
    if (data.junk_processes && data.junk_processes.length) {
      var procs = data.junk_processes;
      html += _healthRow('JUNK PROCESSES',
        '<div><span style="color:#ef4444;font-size:10px;display:block;margin-bottom:4px">' + procs.length + ' running</span>' +
        procs.map(function (p) {
          return '<span class="r-health-pill">' + esc(p.name) + ' <span style="color:#94a3b8">' + p.memory_mb + ' MB</span></span>';
        }).join('') + '</div>');
    } else {
      html += _healthRow('JUNK PROCESSES', '<span style="color:#22c55e">✓ None detected</span>');
    }

    html += '</div>';
    html += '<div style="font-size:10px;color:#1e293b;text-align:right;margin-top:6px">Last refreshed ' + new Date().toLocaleTimeString() + '</div>';
    body.innerHTML = html;
    RS._healthCache = RS._healthCache || {};
    RS._healthCache[hostname] = data;
  }

  window.rDdDiskSettingsToggle = function (btn) {
    var menu = $r('dd-disk-menu');
    if (!menu) return;
    var isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      setTimeout(function () {
        function _closeMenu(e) {
          if (!menu.contains(e.target) && e.target !== btn) {
            menu.style.display = 'none';
            document.removeEventListener('click', _closeMenu);
          }
        }
        document.addEventListener('click', _closeMenu);
      }, 0);
    }
  };

  window.rDdDiskCleanup = function (hostname) {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    var checks = document.querySelectorAll('.dd-disk-check:checked');
    if (!checks.length) { rToast('Select at least one disk from ⚙ settings', 'warn'); return; }
    var disks = Array.from(checks).map(function (c) { return c.value; });
    if (!confirm('Remote Disk Clean Up on ' + hostname + '?\n\nDisks: ' + disks.join(', ') + '\n\nWill clear temp, cache and kill junk background processes. Cannot be undone.')) return;
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    var user = RS.currentUser;
    RS.supa.from('commands').insert({
      target_machine: hostname,
      type: 'DISK_CLEANUP',
      status: 'PENDING',
      payload: { disks: disks },
      created_at: new Date().toISOString(),
      created_by: user ? user.email : 'admin'
    }).then(function () {
      rToast('Disk Clean Up sent to ' + hostname + ' — ' + disks.join(', '), 'success');
      var menu = $r('dd-disk-menu');
      if (menu) menu.style.display = 'none';
    }).catch(function (e) { rToast('Error: ' + (e.message || e), 'error'); });
  };

  // ── End Device Health ──────────────────────────────────────────────────

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
    { val: 'renamer', label: 'Renamer' },
    { val: 'splitter', label: 'PDF Splitter' },
    { val: 'scanify', label: 'Scanify' },
    { val: 'vibes', label: 'Vibes Agent' },
    { val: 'pdfstudio', label: 'PDF Studio' },
    { val: 'quickrename', label: 'Quick Rename' },
    { val: 'vims', label: 'VIMS Scrape' }
  ];

  function ddJobs(hostname, box) {
    var opts = _DD_JOBS_FEATS.map(function (f) {
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
    var appNameMap = { splitter: 'PDF Splitter', scanify: 'Scanify', vibes: 'Vibes', pdfstudio: 'PDF Studio', quickrename: 'Quick Rename' };
    _DD_JOBS_FEATS.forEach(function (f) {
      var q;
      if (f.val === 'renamer') q = RS.supa.from('renamer_docs').select('*', { count: 'exact', head: true }).eq('hostname', hostname);
      else if (f.val === 'vims') q = RS.supa.from('vims_results').select('*', { count: 'exact', head: true }).eq('hostname', hostname);
      else q = RS.supa.from('logs').select('*', { count: 'exact', head: true }).eq('machine', hostname).ilike('app_name', '%' + (appNameMap[f.val] || f.val) + '%');
      q.then(function (res) {
        var cnt = res.count || 0;
        var sel = document.getElementById('r-jobs-feat');
        if (!sel) return;
        var opt = sel.querySelector('option[value="' + f.val + '"]');
        if (!opt) return;
        opt.textContent = cnt > 0 ? f.label + ' (' + cnt + ')' : f.label;
        opt.style.color = cnt === 0 ? 'rgba(156,163,175,0.45)' : '';
      }).catch(function () { });
    });
  }

  window.rDdJobsLoad = function (hostname) {
    var feat = (document.getElementById('r-jobs-feat') || {}).value || 'renamer';
    var box = document.getElementById('r-jobs-content');
    if (!box) return;
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Loading…</div>';

    // Renamer — dedicated table
    if (feat === 'renamer') {
      if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
      RS.supa.from('renamer_docs').select('*').eq('hostname', hostname)
        .order('timestamp', { ascending: false }).limit(200)
        .then(function (res) {
          var docs = res.data || [];
          if (!docs.length) { box.innerHTML = '<div class="r-empty">No Renamer records for this machine</div>'; return; }
          var rows = docs.map(function (e) {
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
      return;
    }

    // VIMS — dedicated table
    if (feat === 'vims') {
      if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
      RS.supa.from('vims_results').select('*').eq('hostname', hostname)
        .order('timestamp', { ascending: false }).limit(200)
        .then(function (res) {
          var docs = res.data || [];
          if (!docs.length) { box.innerHTML = '<div class="r-empty">No VIMS records for this machine</div>'; return; }
          var rows = docs.map(function (e) {
            var bc = e.status === 'success' ? 'r-badge-ok' : e.status === 'not_found' ? 'r-badge-info' : 'r-badge-warn';
            return '<tr>' +
              '<td>' + fmtTs(e.timestamp) + '</td>' +
              '<td class="r-font-mono">' + esc(e.no_do || '—') + '</td>' +
              '<td>' + esc(e.patient_name || '—') + '</td>' +
              '<td>' + (e.amount != null ? 'RM ' + Number(e.amount).toFixed(2) : '—') + '</td>' +
              '<td><span class="r-badge ' + bc + '">' + esc(e.status || '?') + '</span></td>' +
              '<td>' + esc(e.skip_reason || e.error || '—') + '</td>' +
              '</tr>';
          }).join('');
          box.innerHTML =
            '<div class="r-vims-legend">' +
            '<span class="r-badge r-badge-ok">success</span> Scraped &nbsp;' +
            '<span class="r-badge r-badge-warn">skipped</span> Bot issue &nbsp;' +
            '<span class="r-badge r-badge-info">not_found</span> DO not found in portal' +
            '</div>' +
            tableWrap(['Time', 'No. DO', 'Patient', 'Amount', 'Status', 'Reason'], rows);
        }).catch(function (err) { box.innerHTML = errBox(err.message); });
      return;
    }

    // Other features — filter logs table by app_name
    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
    var appNameMap = {
      splitter: 'PDF Splitter',
      scanify: 'Scanify',
      vibes: 'Vibes',
      pdfstudio: 'PDF Studio',
      quickrename: 'Quick Rename'
    };
    var appName = appNameMap[feat] || feat;
    RS.supa.from('logs').select('*').eq('machine', hostname).ilike('app_name', '%' + appName + '%')
      .order('timestamp', { ascending: false }).limit(200)
      .then(function (res) {
        var data = res.data || [];
        if (!data.length) { box.innerHTML = '<div class="r-empty">No ' + appName + ' logs for this machine</div>'; return; }
        var rows = data.map(function (e) {
          var st = e.status || e.state || 'INFO';
          return '<tr>' +
            '<td>' + fmtTs(e.timestamp || e.created_at) + '</td>' +
            '<td><span class="r-badge ' + logBadge(st) + '">' + esc(st) + '</span></td>' +
            '<td class="r-cell-trunc">' + esc(e.file_name || e.activity_name || e.details || e.message || '—') + '</td>' +
            '<td class="r-font-mono r-muted-sm">' + esc(e.job_group_id ? e.job_group_id.substring(0, 8) + '…' : '—') + '</td>' +
            '</tr>';
        }).join('');
        box.innerHTML = '<div class="r-log-summary"><span class="r-badge r-badge-muted">' + data.length + ' records</span></div>' +
          tableWrap(['Time', 'Status', 'Detail', 'Job ID'], rows);
      }).catch(function (err) { box.innerHTML = errBox(err.message); });
  };

  // ── TAB: ERRORS ────────────────────────────────────────────────
  var _DD_ERR_FEATS = [
    { val: 'All', label: 'All' },
    { val: 'Renamer', label: 'Renamer' },
    { val: 'PDF Splitter', label: 'PDF Splitter' },
    { val: 'Scanify', label: 'Scanify' },
    { val: 'Vibes', label: 'Vibes' },
    { val: 'PDF Studio', label: 'PDF Studio' },
    { val: 'Quick Rename', label: 'Quick Rename' },
    { val: 'VIMS', label: 'VIMS' }
  ];

  function ddErrors(hostname, box) {
    var opts = _DD_ERR_FEATS.map(function (f) {
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
    _DD_ERR_FEATS.forEach(function (f) {
      var q = RS.supa.from('app_errors').select('*', { count: 'exact', head: true }).eq('hostname', hostname);
      if (f.val !== 'All') q = q.ilike('app_name', '%' + f.val + '%');
      q.then(function (res) {
        var cnt = res.count || 0;
        var sel = document.getElementById('r-errors-feat');
        if (!sel) return;
        var opt = sel.querySelector('option[value="' + f.val + '"]');
        if (!opt) return;
        opt.textContent = cnt > 0 ? f.label + ' (' + cnt + ')' : f.label;
        opt.style.color = cnt === 0 ? 'rgba(156,163,175,0.45)' : '';
      }).catch(function () { });
    });
  }

  window.rDdErrorsLoad = function (hostname) {
    var feat = (document.getElementById('r-errors-feat') || {}).value || 'All';
    var box = document.getElementById('r-errors-content');
    if (!box) return;
    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Loading…</div>';

    var q = RS.supa.from('app_errors').select('*').eq('hostname', hostname);
    if (feat !== 'All') q = q.ilike('app_name', '%' + feat + '%');
    q.order('created_at', { ascending: false }).limit(200)
      .then(function (res) {
        var errs = res.data || [];
        if (!errs.length) {
          box.innerHTML = '<div class="r-empty">No errors' + (feat !== 'All' ? ' for ' + feat : '') + ' on this machine</div>';
          return;
        }
        var openCnt = errs.filter(function (e) { return e.fix_status !== 'fixed'; }).length;
        var fixedCnt = errs.length - openCnt;
        var summary = '<div class="r-log-summary">' +
          '<span class="r-badge r-badge-err">' + openCnt + ' open</span>' +
          '<span class="r-badge r-badge-ok">' + fixedCnt + ' fixed</span>' +
          '</div>';
        var rows = errs.map(function (e) {
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
        box.innerHTML = summary + tableWrap(['First Seen', 'Feature', 'Type', 'Message', 'Last Seen', 'Status', ''], rows);
      }).catch(function (err) { box.innerHTML = errBox(err.message); });
  };

  window.rMarkFixed = function (errorId) {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    if (!RS.supa) return;
    RS.supa.from('app_errors')
      .update({ fix_status: 'fixed', fixed_at: new Date().toISOString() })
      .eq('id', errorId)
      .then(function () {
        rToast('Marked as fixed', 'success');
        var hostname = RS._currentDdHostname;
        if (hostname) rDdErrorsLoad(hostname);
      }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── TAB: COMMANDS ──────────────────────────────────────────────
  function ddCmds(hostname, box) {
    var _chip = function(cmd, color) {
      return '<button style="border:none;background:none;color:' + color + ';font-size:11px;cursor:pointer;padding:3px 6px;white-space:nowrap" ' +
        'onclick="document.getElementById(\'r-cmd-inp\').value=\'' + cmd + '\'">' + cmd + '</button>';
    };
    var grp1 =
      _chip('PING',         '#0ea5e9') +
      _chip('KILL',         'var(--rc-red)') +
      _chip('RESTART',      '#f59e0b') +
      _chip('REFRESH_STATUS','#10b981') +
      _chip('PAUSE',        '#8b5cf6') +
      _chip('RESUME',       '#84cc16') +
      _chip('RERUN',        '#ec4899') +
      _chip('UPDATE_AGENT', '#facc15');
    var grp2 =
      _chip('VERSION_CHECK',     '#a78bfa') +
      _chip('CHECK_DISK',        '#fb923c') +
      _chip('GET_LOGS',          '#4ade80') +
      _chip('SPEED_TEST',        '#e879f9') +
      _chip('CAPTURE_PUBLIC_IP', '#22d3ee') +
      _chip('CLEAR_CACHE',       '#94a3b8') +
      _chip('CLEAR_LOGS',        '#64748b') +
      _chip('RUN_SCRIPT',        '#f97316');

    box.innerHTML =
      '<div style="margin-bottom:10px;padding:8px 10px;background:var(--rc-bg2);border-radius:6px">' +
      '<div style="display:flex;flex-wrap:wrap;gap:2px">' + grp1 + '</div>' +
      '<div style="height:1px;background:var(--rc-border);margin:6px 0"></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:2px">' + grp2 + '</div>' +
      '</div>' +
      '<div class="r-cmd-send">' +
      '<input class="r-filter-input" id="r-cmd-inp" placeholder="Click chip above or type custom command…" style="flex:1">' +
      '<button class="r-btn-primary" onclick="rSendCmd(\'' + esc(hostname) + '\')">Send</button>' +
      '</div>' +
      '<div id="r-cmd-hist" style="margin-top:14px"><div class="r-loading"><span class="r-spin"></span> Loading history…</div></div>';

    if (!RS.supa) return;
    RS.supa.from('commands').select('*').eq('target_machine', hostname)
      .order('created_at', { ascending: false }).limit(50)
      .then(function (res) {
        var hist = document.getElementById('r-cmd-hist');
        if (!hist) return;
        var cmds = res.data || [];
        if (!cmds.length) { hist.innerHTML = '<div class="r-empty">No commands sent to this machine</div>'; return; }
        var rows = cmds.map(function (c) {
          return '<tr>' +
            '<td>' + fmtTs(c.created_at) + '</td>' +
            '<td class="r-font-mono">' + esc(c.type || c.command || c.action || '—') + '</td>' +
            '<td><span class="r-badge ' + logBadge(c.status) + '">' + esc(c.status || 'PENDING') + '</span></td>' +
            '<td>' + esc(c.result_msg || '—') + '</td>' +
            '<td>' + esc(c.created_by || '—') + '</td>' +
            '</tr>';
        }).join('');
        hist.innerHTML = tableWrap(['Time', 'Command', 'Status', 'Result', 'By'], rows);
      }).catch(function (err) {
        var hist = document.getElementById('r-cmd-hist');
        if (hist) hist.innerHTML = errBox(err.message);
      });
  }

  // ── UTILITY: enrich <select> options with record counts ────────
  // table: supabase table name, hostField: column that holds hostname
  window.rEnrichSelect = function (selectId, table, hostField) {
    var sel = document.getElementById(selectId);
    if (!sel || !RS.supa) return;
    Array.prototype.forEach.call(sel.options, function (opt) {
      var val = opt.value;
      if (!val) return; // skip "All Machines" empty option
      var origLabel = opt.dataset.orig || opt.textContent.split(' (')[0];
      opt.dataset.orig = origLabel;
      var q = RS.supa.from(table).select('*', { count: 'exact', head: true });
      q = q.eq(hostField, val);
      q.then(function (res) {
        var cnt = res.count || 0;
        opt.textContent = cnt > 0 ? origLabel + ' (' + cnt + ')' : origLabel;
        opt.style.color = cnt === 0 ? 'rgba(156,163,175,0.45)' : '';
      }).catch(function () { });
    });
  };

  // ── App logs in-memory cache (keyed by app_name) ──────────
  // Avoids re-fetching Supabase on every tab switch.
  // First open: fetch + cache. Subsequent opens: instant render from cache + silent background refresh.
  window._rsLogCache = window._rsLogCache || {};

  function _fetchAndCacheAppLogs(appName, onDone) {
    if (!RS.supa) { if (onDone) onDone([]); return; }
    RS.supa.from('logs').select('*').eq('app_name', appName)
      .order('timestamp', { ascending: false }).limit(5000)
      .then(function (res) {
        var data = res.data || [];
        if (!window._rsLogCache) window._rsLogCache = {};
        window._rsLogCache[appName] = { data: data, ts: Date.now() };
        if (onDone) onDone(data);
      })
      .catch(function () { if (onDone) onDone([]); });
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
      '<option value="COMPLETED">Completed</option>' +
      '<option value="PARTIAL">Partial</option>' +
      '<option value="FAILED">Failed</option>' +
      '<option value="RUNNING">Running</option>' +
      '</select>' +
      '<button class="r-btn-sm" onclick="rLoadRenamer()">Search</button>' +
      '</div>' +
      '</div>' +
      '<div class="r-legend">' +
      '<span class="r-badge r-badge-ok">COMPLETED</span> Done &nbsp;' +
      '<span class="r-badge r-badge-err">FAILED / ERROR</span> Issue occurred &nbsp;' +
      '<span class="r-badge r-badge-warn">PROCESSING</span> In progress' +
      '</div>' +
      '<div id="r-ren-results"><div class="r-empty">Select filter and click Search</div></div>' +
      '</div>';
    rLoadRenamer();
  }

  window.rLoadRenamer = function () {
    var machine = ($r('r-ren-dev') || {}).value || '';
    var statusFilter = ($r('r-ren-stat') || {}).value || '';
    var box = $r('r-ren-results');
    if (!box) return;
    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }

    function _render(data) {
      var d = machine ? data.filter(function (l) { return l.machine === machine; }) : data;
      _processAndRenderLogs(d, box, statusFilter, 'global');
    }

    var cached = (window._rsLogCache || {})['Renamer HQ'];
    if (cached) {
      _render(cached.data);
      _fetchAndCacheAppLogs('Renamer HQ', function (fresh) {
        if ($r('r-ren-results') === box) _render(fresh);
      });
    } else {
      box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Querying…</div>';
      _fetchAndCacheAppLogs('Renamer HQ', _render);
    }
  };

  // ── APP LOG VIEWS (shared renderer for FV Branch / Splitter / Studio / Quick / Scanify) ──
  function renderAppLogs(appName, label, icon) {
    var devOpts = Object.keys(RS.devices).map(function (h) {
      return '<option value="' + esc(h) + '">' + esc(h) + '</option>';
    }).join('');
    var view = $r('r-view-area');
    if (!view) return;
    var safeId = appName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    // Store appName supaya onclick guna safeId sahaja (elak double-quote dalam attribute)
    if (!window._appNameMap) window._appNameMap = {};
    window._appNameMap[safeId] = appName;
    view.innerHTML =
      '<div class="r-panel">' +
      '<div class="r-panel-hdr">' +
      '<h3><i class="fa-solid ' + esc(icon) + '"></i> ' + esc(label) + ' Logs</h3>' +
      '<div class="r-filter-bar">' +
      '<select class="r-filter-sel" id="al-dev-' + safeId + '"><option value="">All Machines</option>' + devOpts + '</select>' +
      '<select class="r-filter-sel" id="al-stat-' + safeId + '">' +
      '<option value="">All Status</option>' +
      '<option value="COMPLETED">Completed</option>' +
      '<option value="PARTIAL">Partial</option>' +
      '<option value="FAILED">Failed</option>' +
      '<option value="RUNNING">Running</option>' +
      '</select>' +
      '<button class="r-btn-sm" onclick="rLoadAppLogs(\'' + safeId + '\')">Search</button>' +
      '</div>' +
      '</div>' +
      '<div class="r-legend">' +
      '<span class="r-badge r-badge-ok">COMPLETED</span> Done &nbsp;' +
      '<span class="r-badge r-badge-err">FAILED / ERROR</span> Issue occurred &nbsp;' +
      '<span class="r-badge r-badge-warn">PROCESSING</span> In progress' +
      '</div>' +
      '<div id="al-results-' + safeId + '"><div class="r-empty">Select filter and click Search</div></div>' +
      '</div>';
    rLoadAppLogs(safeId);
  }

  window.rLoadAppLogs = function (safeId) {
    var appName = (window._appNameMap || {})[safeId] || safeId;
    var machine = ($r('al-dev-' + safeId) || {}).value || '';
    var statusFilter = ($r('al-stat-' + safeId) || {}).value || '';
    var box = $r('al-results-' + safeId);
    if (!box) return;
    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }

    function _render(data) {
      var d = machine ? data.filter(function (l) { return l.machine === machine; }) : data;
      _processAndRenderLogs(d, box, statusFilter, 'global');
    }

    var cached = (window._rsLogCache || {})[appName];
    if (cached) {
      _render(cached.data);
      _fetchAndCacheAppLogs(appName, function (fresh) {
        if ($r('al-results-' + safeId) === box) _render(fresh);
      });
    } else {
      box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Querying…</div>';
      _fetchAndCacheAppLogs(appName, _render);
    }
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

    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }

    var supaQ = RS.supa.from('vibes_errors').select('*').order('timestamp', { ascending: false }).limit(150);
    if (resolved === 'open') supaQ = supaQ.eq('resolved', false);
    else if (resolved === 'resolved') supaQ = supaQ.eq('resolved', true);
    if (hostname) supaQ = supaQ.eq('hostname', hostname);

    supaQ.then(function (res) {
      if (res.error) { box.innerHTML = errBox(res.error.message); return; }
      var docs = (res.data || []).map(function (d) {
        return Object.assign({ id: d.id, _host: d.hostname }, d);
      }).filter(function (d) {
        // Skip alerts handled in Alerts page — exclude from VIBES Monitor
        var _skipTypes = ['batch_skip', 'amount_unresolved', 'folder_not_found', 'row_skip_portal_lag'];
        return _skipTypes.indexOf(d.error_type || d.category || '') === -1;
      });
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
          tableWrap(['Time', 'Claim No', 'Error Type', 'Message', 'Status', 'Action'], errRows) +
          '</div>' +
          '</div>';
      });
      box.innerHTML = html;
    }).catch(function (err) { box.innerHTML = errBox(err.message); });
  };

  // ── VIBES: Fix single error ────────────────────────────────
  window.rOpenFix = function (docId, hostname, table) {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    var title = $r('r-modal-title');
    var body = $r('r-modal-body');
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

  window.rSubmitVibesFix = function (docId, table) {
    var note = ($r('r-vibes-fix-note') || {}).value || '';
    if (note.trim().length < 5) { rToast('Fix note must be at least 5 characters', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    var user = RS.currentUser;
    RS.supa.from(table || 'vibes_errors').update({
      resolved: true,
      fix_note: note.trim(),
      fix_by: user ? user.email : 'admin',
      fixed_at: new Date().toISOString()
    }).eq('id', docId).then(function (res) {
      if (res.error) { rToast('Error: ' + res.error.message, 'error'); return; }
      rToast('Error marked as fixed', 'success');
      rModalClose();
      rLoadVibes();
    }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── VIBES: Clear all open errors for a run ─────────────────
  window.rClearErrors = function (runId, hostname) {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    var title = $r('r-modal-title');
    var body = $r('r-modal-body');
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

  window.rSubmitClearErrors = function (runId) {
    var note = ($r('r-vibes-clear-note') || {}).value || '';
    if (note.trim().length < 5) { rToast('Fix note required (min 5 chars)', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    var user = RS.currentUser;
    RS.supa.from('vibes_errors').update({
      resolved: true,
      fix_note: note.trim(),
      fix_by: user ? user.email : 'admin',
      fixed_at: new Date().toISOString()
    }).eq('run_id', runId).eq('resolved', false).then(function (res) {
      if (res.error) { rToast('Error: ' + res.error.message, 'error'); return; }
      rToast('All open errors in run cleared', 'success');
      rModalClose();
      rLoadVibes();
    }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── VIBES: Download run errors as JSONL ────────────────────
  window.rDownloadLog = function (runId, hostname) {
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    rToast('Preparing JSONL download…', 'info');
    RS.supa.from('vibes_errors').select('*').eq('run_id', runId)
      .order('timestamp', { ascending: true })
      .then(function (res) {
        if (res.error) { rToast('Query error: ' + res.error.message, 'error'); return; }
        var rows = (res.data || []);
        if (!rows.length) { rToast('No records for this run', 'warn'); return; }
        var jsonl = rows.map(function (r) { return JSON.stringify(r); }).join('\n');
        var blob = new Blob([jsonl], { type: 'application/jsonl' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        var safeName = (hostname || 'device').replace(/[^a-zA-Z0-9_-]/g, '_');
        a.href = url;
        a.download = 'vibes_' + safeName + '_' + runId + '.jsonl';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
        rToast('Downloaded ' + rows.length + ' error records', 'success');
      }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
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
    var hostname = ($r('r-vims-dev') || {}).value || '';
    var status = ($r('r-vims-stat') || {}).value || '';
    var box = $r('r-vims-results');
    if (!box) return;
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Querying…</div>';

    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
    var q = RS.supa.from('vims_results').select('*')
      .order('timestamp', { ascending: false }).limit(200);
    if (status) q = q.eq('status', status);
    if (hostname) q = q.eq('hostname', hostname);

    q.then(function (res) {
      var docs = (res.data || []).map(function (e) {
        return Object.assign({ _host: e.hostname }, e);
      });
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
    var now = new Date();
    var todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    var view = $r('r-view-area');
    if (!view) return;
    view.innerHTML =
      '<div class="r-panel">' +
      '<div class="r-panel-hdr">' +
      '<h3><i class="fa-solid fa-scroll"></i> Log Explorer</h3>' +
      '<div class="r-filter-bar">' +
      '<input type="date" class="r-filter-sel" id="r-log-date" value="' + todayStr + '" title="Filter by date (clear to show all)">' +
      '<select class="r-filter-sel" id="r-log-dev"><option value="">All Machines</option>' + devOpts + '</select>' +
      '<select class="r-filter-sel" id="r-log-app"><option value="">All Apps</option>' + appOpts + '</select>' +
      '<select class="r-filter-sel" id="r-log-stat">' +
      '<option value="">All Status</option>' +
      '<option value="COMPLETED">Completed</option>' +
      '<option value="PARTIAL">Partial</option>' +
      '<option value="FAILED">Failed</option>' +
      '<option value="CANCELLED">Cancelled</option>' +
      '<option value="RUNNING">Running</option>' +
      '</select>' +
      '<button class="r-btn-sm" onclick="window.rSearchAllLogs()">Search</button>' +
      '</div>' +
      '</div>' +
      '<div id="r-log-results"><div class="r-empty">Loading today\'s logs…</div></div>' +
      '</div>';
    setTimeout(function () {
      // Apply any pending filter set before navigation (e.g. from dashboard cards)
      if (RS._pendingLogFilter) {
        if (RS._pendingLogFilter === 'ISSUE') {
          // ISSUE is a dashboard-only combined filter — not in the dropdown
          RS._issueMode = true;
        } else {
          var sel = document.getElementById('r-log-stat');
          if (sel) sel.value = RS._pendingLogFilter;
        }
        RS._pendingLogFilter = null;
      }
      window.rLoadLogs();
    }, 100);
  }

  function _fmtDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    if (isNaN(d)) return '—';
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getFullYear()).slice(2);
  }
  function _fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    if (isNaN(d)) return '—';
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
  }
  function _fmtDur(startTs, endTs) {
    if (!startTs || !endTs) return '—';
    var ms = new Date(endTs) - new Date(startTs);
    if (ms <= 0) return '—';
    var min = Math.floor(ms / 60000);
    var sec = Math.floor((ms % 60000) / 1000);
    return min > 0 ? min + 'm ' + sec + 's' : sec + 's';
  }

  window.rToggleLogDetail = function (gidKey) {
    var el = document.getElementById('rld-' + gidKey);
    if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
  };

  // ── Enterprise error normalizer ───────────────────────────────
  // Maps raw Python exceptions → professional error profile
  // confirmed:true  → rootCause is definitive, rendered as "Root Cause"
  // confirmed:false → causes[] are possibilities, rendered as "Possible Causes"
  // status taxonomy: file_missing = User/File Action (not a system/app failure)
  function _normalizeError(errMsg) {
    var m = (errMsg || '').toLowerCase();
    var raw = errMsg || '';

    // ── DOCUMENT VALIDATION — "Missing: SURAT X, SURAT Y" — checked FIRST ──
    // Bukan ralat teknikal. App berfungsi betul — ia detect jenis surat tidak ada
    // dalam dokumen dan diskip secara sengaja. Tiada processing dilakukan.
    if (/^missing:/i.test(raw.trim())) {
      var missingList = raw.replace(/^missing:\s*/i, '').trim();
      return {
        code: 'VAL-1001', title: 'INCOMPLETE DOCUMENT',
        description: 'File skipped — the following document types were not found in this file.',
        rootCause: missingList,
        confirmed: true,
        type: 'validation', action: 'dismiss',
        icon: 'fa-file-circle-question', color: '#f59e0b'
      };
    }

    // ── FILE MISSING — checked FIRST (takes priority over WorkerCrash wrapper) ──
    // Pattern: WorkerCrash: no such file: 'C:/path/to/file.pdf'
    if (m.indexOf('no such file') >= 0 || m.indexOf('filenotfounderror') >= 0 ||
      m.indexOf('filenotfound') >= 0 || m.indexOf('missing file') >= 0 ||
      (m.indexOf('not found') >= 0 && (m.indexOf('file') >= 0 || m.indexOf('path') >= 0))) {
      // Extract quoted path from raw error if present
      var pathMatch = raw.match(/['"]((?:[A-Za-z]:[\\/]|\/)[^'"]+)['"]/);
      var missingPath = pathMatch ? pathMatch[1] : null;
      var desc = missingPath
        ? 'Source artifact absent at dispatch path: ' + missingPath
        : 'Source artifact absent from the declared dispatch path.';
      return {
        code: 'IO-1001', title: 'FILE MISSING',
        description: desc,
        rootCause: 'File was relocated, renamed, or purged externally after being queued — no processing was attempted by the worker.',
        confirmed: true,
        type: 'file_missing', action: 'dismiss', icon: 'fa-file-circle-xmark', color: '#f59e0b'
      };
    }

    // ── WORKER CRASH — generic, cause ambiguous ──
    if (m.indexOf('workercrash') >= 0 || m.indexOf('process pool') >= 0 ||
      m.indexOf('terminated abruptly') >= 0 || m.indexOf('killed') >= 0) {
      return {
        code: 'WRK-5001', title: 'EXECUTION FAILURE',
        description: 'Worker process terminated unexpectedly while executing task.',
        causes: ['Application crash', 'Insufficient system memory', 'Forced termination by OS', 'Unhandled exception in worker'],
        confirmed: false,
        type: 'system', action: 'acknowledge', icon: 'fa-server', color: '#94a3b8'
      };
    }

    if (m.indexOf('out of memory') >= 0 || m.indexOf('oom') >= 0 ||
      (m.indexOf('memory') >= 0 && m.indexOf('error') >= 0)) {
      return {
        code: 'SYS-3001', title: 'MEMORY EXHAUSTION',
        description: 'System exhausted available memory during task execution.',
        rootCause: 'OS-level OOM condition — kernel terminated the worker process due to insufficient physical or virtual memory.',
        confirmed: true,
        type: 'system', action: 'acknowledge', icon: 'fa-memory', color: '#94a3b8'
      };
    }
    if (m.indexOf('no space left') >= 0 || m.indexOf('disk full') >= 0 ||
      (m.indexOf('disk') >= 0 && m.indexOf('space') >= 0)) {
      return {
        code: 'SYS-3002', title: 'STORAGE FAILURE',
        description: 'Insufficient disk space available for write operation.',
        rootCause: 'Target volume exhausted — filesystem returned ENOSPC. Output directory or temp path has no remaining capacity.',
        confirmed: true,
        type: 'resource', action: 'restart', icon: 'fa-hard-drive', color: '#f59e0b'
      };
    }
    if (m.indexOf('storage') >= 0 || m.indexOf('disk') >= 0) {
      return {
        code: 'SYS-3002', title: 'STORAGE FAILURE',
        description: 'Storage-related error during operation.',
        causes: ['Target disk is full', 'Output directory quota exceeded', 'Temp file accumulation'],
        confirmed: false,
        type: 'resource', action: 'restart', icon: 'fa-hard-drive', color: '#f59e0b'
      };
    }
    if (m.indexOf('network') >= 0 || m.indexOf('connection') >= 0 || m.indexOf('timeout') >= 0 ||
      m.indexOf('socket') >= 0 || m.indexOf('offline') >= 0 || m.indexOf('unreachable') >= 0) {
      return {
        code: 'NET-4001', title: 'CONNECTIVITY FAILURE',
        description: 'Network connection lost or timed out during operation.',
        causes: ['Network instability', 'VPN disconnected', 'Remote server unreachable', 'Firewall blocking connection'],
        confirmed: false,
        type: 'network', action: 'restart', icon: 'fa-wifi', color: '#f59e0b'
      };
    }
    if (m.indexOf('permission') >= 0 || m.indexOf('access denied') >= 0 ||
      m.indexOf('unauthorized') >= 0 || m.indexOf('forbidden') >= 0) {
      return {
        code: 'SEC-2001', title: 'ACCESS DENIED',
        description: 'Operation blocked due to insufficient privileges on target path.',
        rootCause: 'Process lacks read/write privileges — OS-level ACL or UAC restriction blocked execution. Verify folder permissions and antivirus exclusion rules on this node.',
        confirmed: true,
        type: 'config', action: 'config', icon: 'fa-lock', color: '#a855f7'
      };
    }
    if (m.indexOf('segfault') >= 0 || m.indexOf('segmentation fault') >= 0 || m.indexOf('assertion') >= 0) {
      return {
        code: 'ENG-5002', title: 'RUNTIME FAULT',
        description: 'Internal engine raised a low-level fault during processing.',
        rootCause: 'Segmentation fault or assertion failure in native code — likely triggered by a corrupted or malformed input file, or a library incompatibility.',
        confirmed: true,
        type: 'bug', action: 'fix', icon: 'fa-bug', color: '#ef4444'
      };
    }
    if (m.indexOf('typeerror') >= 0 || m.indexOf('attributeerror') >= 0 ||
      m.indexOf('valueerror') >= 0 || m.indexOf('nameerror') >= 0) {
      return {
        code: 'ENG-5003', title: 'CODE EXCEPTION',
        description: 'Unhandled exception raised in application logic.',
        rootCause: 'Python exception intercepted by worker runtime — indicates a software defect, unexpected input format, or version mismatch in application code.',
        confirmed: true,
        type: 'bug', action: 'fix', icon: 'fa-bug', color: '#ef4444'
      };
    }
    // ── RENAMER FV — OCR: invoice number not found ──
    if (m.indexOf('no inv') >= 0 || m.indexOf('invoice number not found') >= 0 ||
      m.indexOf('ocr failed: no inv') >= 0 || m.indexOf('no invoice') >= 0) {
      return {
        code: 'RNM-1001', title: 'OCR: INVOICE NOT FOUND',
        description: 'Renamer could not extract a valid Invoice/DO number from this file.',
        rootCause: 'Scan quality too low, barcode interference, or document layout not recognised by OCR engine. File was skipped — manual renaming required.',
        confirmed: true,
        type: 'ocr_fail', action: 'ocr_fail', icon: 'fa-magnifying-glass', color: '#f59e0b'
      };
    }
    // ── RENAMER FV — OS rename failure (file locked, duplicate, permission) ──
    if (m.indexOf('winerror') >= 0 || m.indexOf('file exists') >= 0 ||
      m.indexOf('already exists') >= 0 || m.indexOf('cannot rename') >= 0 ||
      (m.indexOf('rename') >= 0 && (m.indexOf('error') >= 0 || m.indexOf('fail') >= 0))) {
      return {
        code: 'RNM-2001', title: 'RENAME FAILED',
        description: 'OCR extracted the invoice number but the OS refused to rename the file.',
        rootCause: 'File already exists at target path, target folder is read-only, or file is locked by another process. Manual intervention required on the node.',
        confirmed: true,
        type: 'rename_fail', action: 'acknowledge', icon: 'fa-file-pen', color: '#a855f7'
      };
    }
    if (!errMsg) {
      return {
        code: 'ERR-0000', title: 'UNKNOWN ERROR',
        description: 'An unspecified error occurred during processing.',
        causes: ['No error message captured — review system logs on the node'],
        confirmed: false,
        type: 'unknown', action: 'acknowledge', icon: 'fa-circle-xmark', color: '#64748b'
      };
    }
    return {
      code: 'ERR-9999', title: 'PROCESSING ERROR',
      description: 'An unexpected error occurred during task execution.',
      causes: ['Unknown cause — review raw error details below', 'Corrupted file', 'System instability'],
      confirmed: false,
      type: 'unknown', action: 'acknowledge', icon: 'fa-circle-xmark', color: '#64748b'
    };
  }
  // Backwards-compat alias used by session banner counts
  function _classifyErrType(errMsg) { return _normalizeError(errMsg); }

  // Toggle expanded error detail block — called from onclick in log rows
  window.rToggleErrDetail = function (id) {
    var d = document.getElementById(id);
    if (!d) return;
    var open = d.style.display !== 'none';
    d.style.display = open ? 'none' : 'block';
    var btn = document.getElementById('erdbtn_' + id);
    if (btn) btn.innerHTML = open
      ? '<i class="fa-solid fa-chevron-down"></i> Details'
      : '<i class="fa-solid fa-chevron-up"></i> Hide';
  };

  // Acknowledge a system/resource failure — admin has reviewed, punca sistem bukan kod
  window.rAcknowledgeLog = function (logId, btn) {
    if (!RS.supa || !logId || logId === 'undefined') { rToast('Log ID missing', 'warn'); return; }
    if (!_canWrite()) { rToast('Read-only — request write access', 'warn'); return; }
    rPrompt({
      title: 'Acknowledge Failure',
      icon: 'fa-eye',
      label: 'Note (optional)',
      placeholder: 'e.g. low memory, worker terminated by OS — user notified…',
      confirmText: 'Acknowledge',
      onCancel: function () { },
      onConfirm: function (note) {
        var user = RS.currentUser;
        var displayName = RS.userNickname || (user && user.email) || 'admin';
        var email = (RS.userRole === 'superadmin' ? 'SUPER ADMIN ' : 'ADMIN ') + displayName;
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
        RS.supa.from('logs').update({
          fix_status: 'acknowledged',
          fixed_by: email,
          fixed_at: new Date().toISOString(),
          fix_note: note || null
        }).eq('id', logId).select('id').then(function (res) {
          if (res.error) {
            rToast('Update failed: ' + res.error.message, 'error');
            console.error('[rAcknowledgeLog] Supabase error:', res.error);
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-eye"></i> Acknowledge'; }
            return;
          }
          if (!res.data || !res.data.length) {
            rToast('No rows updated — check Supabase RLS policy for logs table', 'warn');
            console.warn('[rAcknowledgeLog] 0 rows affected for id:', logId);
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-eye"></i> Acknowledge'; }
            return;
          }
          rToast('Acknowledged', 'success');
          window.rLoadLogs();
        }).catch(function (e) {
          rToast('Update failed: ' + e.message, 'error');
          console.error('[rAcknowledgeLog] catch:', e);
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-eye"></i> Acknowledge'; }
        });
      }
    });
  };

  // ── Checkbox multi-select for bulk acknowledge ─────────────────
  window.rSelectAllFailed = function (gKey, checked) {
    var chks = document.querySelectorAll('.r-fail-chk-' + gKey);
    chks.forEach(function (c) { c.checked = checked; });
    rUpdateFailSelection(gKey);
  };

  window.rUpdateFailSelection = function (gKey) {
    var checked = document.querySelectorAll('.r-fail-chk-' + gKey + ':checked');
    var btn = document.getElementById('r-ack-sel-' + gKey);
    var allChk = document.getElementById('chk-all-' + gKey);
    var total = document.querySelectorAll('.r-fail-chk-' + gKey);
    if (allChk) allChk.indeterminate = checked.length > 0 && checked.length < total.length;
    if (allChk) allChk.checked = checked.length === total.length && total.length > 0;
    if (btn) {
      var n = checked.length;
      btn.style.display = n > 0 ? 'inline-flex' : 'none';
      btn.innerHTML = '<i class="fa-solid fa-eye" style="margin-right:5px"></i>Acknowledge Selected (' + n + ')';
    }
  };

  window.rAcknowledgeSelected = function (gKey) {
    if (!RS.supa) return;
    if (!_canWrite()) { rToast('Read-only — request write access', 'warn'); return; }
    var chks = document.querySelectorAll('.r-fail-chk-' + gKey + ':checked');
    var ids = Array.prototype.slice.call(chks).map(function (c) { return c.dataset.id; }).filter(Boolean);
    if (!ids.length) { rToast('Nothing selected', 'warn'); return; }
    rPrompt({
      title: 'Acknowledge Selected (' + ids.length + ')',
      icon: 'fa-eye',
      label: 'Note (optional)',
      placeholder: 'e.g. low memory, worker terminated by OS — user notified…',
      confirmText: 'Acknowledge',
      onCancel: function () { },
      onConfirm: function (note) {
        var user = RS.currentUser;
        var displayName = RS.userNickname || (user && user.email) || 'admin';
        var email = (RS.userRole === 'superadmin' ? 'SUPER ADMIN ' : 'ADMIN ') + displayName;
        RS.supa.from('logs').update({
          fix_status: 'acknowledged',
          fixed_by: email,
          fixed_at: new Date().toISOString(),
          fix_note: note || null
        }).in('id', ids).select('id').then(function (res) {
          if (res.error) { rToast('Update failed: ' + res.error.message, 'error'); console.error('[rAcknowledgeSelected]', res.error); return; }
          var n = (res.data || []).length;
          if (!n) { rToast('No rows updated — check Supabase RLS policy for logs table', 'warn'); console.warn('[rAcknowledgeSelected] 0 rows affected, ids:', ids); return; }
          rToast('Acknowledged ' + n + ' records', 'success');
          window.rLoadLogs();
        }).catch(function (e) { rToast('Update failed: ' + e.message, 'error'); console.error('[rAcknowledgeSelected]', e); });
      }
    });
  };

  // Acknowledge ALL system-type failures in a session at once
  window.rAcknowledgeAll = function (gKey) {
    if (!RS.supa) return;
    if (!_canWrite()) { rToast('Read-only — request write access', 'warn'); return; }
    var data = window._rFailedLogs && window._rFailedLogs[gKey];
    if (!data || !data.logs || !data.logs.length) { rToast('No failed records', 'warn'); return; }
    var ids = data.logs.filter(function (l) { return !l.fix_status && l.id; }).map(function (l) { return l.id; });
    if (!ids.length) { rToast('All records already acknowledged', 'info'); return; }
    rPrompt({
      title: 'Acknowledge All (' + ids.length + ' failures)',
      icon: 'fa-eye',
      label: 'Note (optional)',
      placeholder: 'e.g. all low memory events — users notified…',
      confirmText: 'Acknowledge All',
      onCancel: function () { },
      onConfirm: function (note) {
        var user = RS.currentUser;
        var displayName = RS.userNickname || (user && user.email) || 'admin';
        var email = (RS.userRole === 'superadmin' ? 'SUPER ADMIN ' : 'ADMIN ') + displayName;
        RS.supa.from('logs').update({
          fix_status: 'acknowledged',
          fixed_by: email,
          fixed_at: new Date().toISOString(),
          fix_note: note || null
        }).in('id', ids).select('id').then(function (res) {
          if (res.error) { rToast('Update failed: ' + res.error.message, 'error'); console.error('[rAcknowledgeAll]', res.error); return; }
          var n = (res.data || []).length;
          if (!n) { rToast('No rows updated — check Supabase RLS policy for logs table', 'warn'); console.warn('[rAcknowledgeAll] 0 rows affected, ids:', ids); return; }
          rToast('Acknowledged ' + n + ' records', 'success');
          window.rLoadLogs();
        }).catch(function (e) { rToast('Update failed: ' + e.message, 'error'); console.error('[rAcknowledgeAll]', e); });
      }
    });
  };

  // Mark a single failed log row as fixed in Supabase
  window.rMarkLogFixed = function (logId, btn) {
    if (!RS.supa || !logId || logId === 'undefined') { rToast('Log ID missing — cannot update', 'warn'); return; }
    if (!_canWrite()) { rToast('Read-only — request write access', 'warn'); return; }
    rPrompt({
      title: 'Mark as Fixed',
      icon: 'fa-circle-check',
      label: 'Fix Note (optional)',
      placeholder: 'e.g. Updated ke v9.9.1, bug telah dipatch…',
      confirmText: 'Mark Fixed',
      onCancel: function () { },
      onConfirm: function (note) {
        var user = RS.currentUser;
        var displayName = RS.userNickname || (user && user.email) || 'admin';
        var email = (RS.userRole === 'superadmin' ? 'SUPER ADMIN ' : 'ADMIN ') + displayName;
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
        RS.supa.from('logs').update({
          fix_status: 'fixed',
          fixed_by: email,
          fixed_at: new Date().toISOString(),
          fix_note: note || null
        }).eq('id', logId).select('id').then(function (res) {
          if (res.error) {
            rToast('Update failed: ' + res.error.message, 'error');
            console.error('[rMarkLogFixed] Supabase error:', res.error);
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Mark Fixed'; }
            return;
          }
          if (!res.data || !res.data.length) {
            rToast('No rows updated — check Supabase RLS policy for logs table', 'warn');
            console.warn('[rMarkLogFixed] 0 rows affected for id:', logId);
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Mark Fixed'; }
            return;
          }
          rToast('Marked as fixed', 'success');
          window.rLoadLogs();
        }).catch(function (e) {
          rToast('Update failed: ' + e.message, 'error');
          console.error('[rMarkLogFixed] catch:', e);
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Mark Fixed'; }
        });
      }
    });
  };

  // Mark ALL unfixed bug-type failed logs in a session as fixed
  window.rMarkAllLogFixed = function (gKey) {
    if (!RS.supa) return;
    if (!_canWrite()) { rToast('Read-only — request write access', 'warn'); return; }
    var data = window._rFailedLogs && window._rFailedLogs[gKey];
    if (!data || !data.logs || !data.logs.length) { rToast('No failed records', 'warn'); return; }
    var ids = data.logs.filter(function (l) { return l.fix_status !== 'fixed' && l.id; }).map(function (l) { return l.id; });
    if (!ids.length) { rToast('All already marked fixed', 'info'); return; }
    rPrompt({
      title: 'Mark All Fixed (' + ids.length + ' failures)',
      icon: 'fa-circle-check',
      label: 'Fix Note (optional)',
      placeholder: 'e.g. patched in v9.9.1 — all affected workers updated…',
      confirmText: 'Mark All Fixed',
      onCancel: function () { },
      onConfirm: function (note) {
        var user = RS.currentUser;
        var displayName = RS.userNickname || (user && user.email) || 'admin';
        var email = (RS.userRole === 'superadmin' ? 'SUPER ADMIN ' : 'ADMIN ') + displayName;
        RS.supa.from('logs').update({
          fix_status: 'fixed',
          fixed_by: email,
          fixed_at: new Date().toISOString(),
          fix_note: note || null
        }).in('id', ids).select('id').then(function (res) {
          if (res.error) { rToast('Update failed: ' + res.error.message, 'error'); console.error('[rMarkAllLogFixed]', res.error); return; }
          var n = (res.data || []).length;
          if (!n) { rToast('No rows updated — check Supabase RLS policy for logs table', 'warn'); console.warn('[rMarkAllLogFixed] 0 rows affected, ids:', ids); return; }
          rToast('Marked ' + n + ' records as fixed', 'success');
          window.rLoadLogs();
        }).catch(function (e) { rToast('Update failed: ' + e.message, 'error'); console.error('[rMarkAllLogFixed]', e); });
      }
    });
  };

  // Copy a stored error message to clipboard
  window.rCopyLogErr = function (key) {
    var msg = window._rErrStore && window._rErrStore[key];
    if (!msg) { rToast('No error text', 'warn'); return; }
    navigator.clipboard.writeText(msg)
      .then(function () { rToast('Error copied to clipboard', 'success'); })
      .catch(function () { rToast('Copy failed — check browser permissions', 'error'); });
  };

  // Export failed logs for a session as CSV download
  window.rExportFailCsv = function (gKey) {
    var data = window._rFailedLogs && window._rFailedLogs[gKey];
    if (!data || !data.logs || !data.logs.length) { rToast('No failed records to export', 'warn'); return; }
    var lines = ['"Time","Machine","App","File","Status","Error","Duration"'];
    data.logs.forEach(function (l) {
      var row = [
        l.timestamp || '',
        data.machine,
        data.app,
        l.file_name || (l.job_info && l.job_info.file_name) || '',
        l.status || 'FAILED',
        l.error_msg || (l.job_info && (l.job_info.error || l.job_info.state)) || '',
        l.duration != null ? parseFloat(l.duration).toFixed(2) + 's' : ''
      ].map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; });
      lines.push(row.join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'failed_' + (data.machine || 'session') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    rToast('Exported ' + data.logs.length + ' failed record(s)', 'success');
  };

  window.rSearchAllLogs = function () {
    var d = document.getElementById('r-log-date');
    if (d) d.value = '';
    window.rLoadLogs();
  };

  // ── Shared session renderer — used by Log Explorer + per-app log tabs ──
  function _processAndRenderLogs(data, box, statusFilter, context) {
    // context: 'global' (Log Explorer) → show Machine + Branch
    //          'device' or undefined   → hide Machine (already known), hide Branch
    var showMachine = context === 'global';
    var showBranch = context === 'global';
    if (!data.length) { box.innerHTML = '<div class="r-empty">No logs match</div>'; return; }

    // ── Group logs into sessions ──
    var groups = {};
    var gOrder = [];
    data.forEach(function (log) {
      // Use job_group_id if present; fallback: machine+app+branch+hour bucket
      var gid = log.job_group_id ||
        ((log.machine || '') + '|' + (log.app_name || '') + '|' + (log.branch_id || '') + '|' + (log.timestamp || '').substring(0, 13));
      if (!groups[gid]) {
        groups[gid] = {
          gid: gid, logs: [], start: null, end: null,
          machine: log.machine, app: log.app_name, branch: log.branch_id,
          hasFail: false, hasCancelled: false, allProcessing: true
        };
        gOrder.push(gid);
      }
      var g = groups[gid];
      g.logs.push(log);
      var ts = log.timestamp || '';
      if (!g.start || ts < g.start) g.start = ts;
      if (!g.end || ts > g.end) g.end = ts;
      var st = (log.status || '').toUpperCase();
      if (st === 'FAILED' || st === 'ERROR') g.hasFail = true;
      if (st === 'CANCELLED') g.hasCancelled = true;
      if (st !== 'PROCESSING') g.allProcessing = false;
    });

    // Sort sessions newest-first
    var sessions = gOrder.map(function (k) { return groups[k]; })
      .sort(function (a, b) { return (b.end || '') > (a.end || '') ? 1 : -1; });

    // Auto-clean: cap at 100 sessions (unfiltered full-load only) and delete older COMPLETED rows from DB
    // NEVER delete sessions with any failures — those stay until admin takes action
    var MAX_SESSIONS = 100;
    if (!statusFilter && sessions.length > MAX_SESSIONS) {
      var oldSessions = sessions.slice(MAX_SESSIONS);
      sessions = sessions.slice(0, MAX_SESSIONS);
      var idsToDelete = [];
      oldSessions.forEach(function (s) {
        if (!s.hasFail) { // Only delete fully-completed sessions
          s.logs.forEach(function (l) { if (l.id) idsToDelete.push(l.id); });
        }
      });
      if (idsToDelete.length && RS.supa) {
        RS.supa.from('logs').delete().in('id', idsToDelete).then(function () { });
      }
    }

    // Remove phantom sessions: COMPLETED but zero actual processed docs
    // (stray logs sent after a real job ends — no file COMPLETED/FAILED entries)
    var phantomIds = [];
    sessions = sessions.filter(function (s) {
      if (s.hasFail || s.hasCancelled || s.allProcessing) return true; // keep failures, cancels + still-running
      var cCount = s.logs.filter(function (l) { return (l.status || '').toUpperCase() === 'COMPLETED'; }).length;
      var fCount = s.logs.filter(function (l) { var st = (l.status || '').toUpperCase(); return st === 'FAILED' || st === 'ERROR'; }).length;
      // Keep sessions that have a FINISH log reporting actual work (total_files > 0)
      // even when individual FAILED log rows are absent from Supabase.
      var finishLog = s.logs.find(function (l) { return (l.status || '').toUpperCase() === 'FINISH'; });
      var finishReportsWork = finishLog && finishLog.job_info && (finishLog.job_info.total_files > 0);
      if (cCount === 0 && fCount === 0 && !finishReportsWork) {
        s.logs.forEach(function (l) { if (l.id) phantomIds.push(l.id); });
        return false;
      }
      return true;
    });
    if (phantomIds.length && RS.supa) {
      RS.supa.from('logs').delete().in('id', phantomIds).then(function () { });
    }

    // Pre-compute session status for filtering + rendering.
    // Also extract FINISH log metadata (total_files, has_errors, failed_count)
    // as a reliable fallback when FAILED log entries are missing from Supabase
    // (e.g. because optional columns like error_msg / root_cause don't exist in
    // the schema and the full insert failed silently before the retry landed).
    sessions.forEach(function (g) {
      var cLen = g.logs.filter(function (l) { return (l.status || '').toUpperCase() === 'COMPLETED'; }).length;

      // Pull FINISH log metadata
      var finishLog = g.logs.find(function (l) { return (l.status || '').toUpperCase() === 'FINISH'; });
      if (finishLog) {
        var fi = finishLog.job_info || {};
        if (fi.total_files != null) g._totalFiles = parseInt(fi.total_files, 10) || null;
        if (fi.failed_count != null) g._failedCount = parseInt(fi.failed_count, 10) || 0;
        // If FINISH log reports errors but no FAILED log entries reached Supabase,
        // mark the session as having failures so STATUS becomes PARTIAL/FAILED.
        if (fi.has_errors && !g.hasFail) g.hasFail = true;
      }

      if (g.allProcessing) g._st = 'RUNNING';
      else if (g.hasFail && cLen === 0) g._st = 'FAILED';    // all files failed
      else if (g.hasFail) g._st = 'PARTIAL';   // mix success + failure
      else if (g.hasCancelled) g._st = 'CANCELLED'; // job cancelled (no failures)
      else g._st = 'COMPLETED';
    });

    // Apply session-level status filter
    if (statusFilter === 'ISSUE') {
      sessions = sessions.filter(function (g) { return g._st === 'FAILED' || g._st === 'PARTIAL' || g._st === 'CANCELLED'; });
    } else if (statusFilter === 'FAILED') {
      sessions = sessions.filter(function (g) { return g._st === 'FAILED'; });
    } else if (statusFilter === 'PARTIAL') {
      sessions = sessions.filter(function (g) { return g._st === 'PARTIAL'; });
    } else if (statusFilter === 'COMPLETED') {
      sessions = sessions.filter(function (g) { return g._st === 'COMPLETED'; });
    } else if (statusFilter === 'RUNNING') {
      sessions = sessions.filter(function (g) { return g._st === 'RUNNING'; });
    } else if (statusFilter === 'CANCELLED') {
      sessions = sessions.filter(function (g) { return g._st === 'CANCELLED'; });
    }

    if (!sessions.length) { box.innerHTML = '<div class="r-empty">No sessions match</div>'; return; }

    var rows = sessions.map(function (g, idx) {
      var completedLogs = g.logs.filter(function (l) { return (l.status || '').toUpperCase() === 'COMPLETED'; });
      var failedLogs = g.logs.filter(function (l) { var st = (l.status || '').toUpperCase(); return st === 'FAILED' || st === 'ERROR'; });
      var allValidationSkip = failedLogs.length > 0 && failedLogs.every(function (l) {
        var t = _normalizeError(l.error_msg || (l.job_info && l.job_info.error) || '').type;
        return t === 'validation' || t === 'file_missing';
      });
      var sessionSt = g._st || 'COMPLETED'; // pre-computed above
      var gKey = 'g' + idx;

      // For VIBES sessions, doc count comes from job_info.doc_count (1 log = 1 batch summary).
      // For FV Branch / renamer: prefer total_files from FINISH log (accurate even when
      // FAILED log entries are absent from Supabase), then fall back to counting log rows.
      var isVibes = (g.app || '').toUpperCase() === 'VIBES';
      var totalDocs = isVibes && g.logs.length === 1 && g.logs[0].job_info && g.logs[0].job_info.doc_count
        ? g.logs[0].job_info.doc_count
        : (g._totalFiles != null ? g._totalFiles : completedLogs.length + failedLogs.length);

      // Initialise global stores for this render
      if (!window._rErrStore) window._rErrStore = {};
      if (!window._rFailedLogs) window._rFailedLogs = {};
      // Save failed logs so export/retry buttons can reference them
      window._rFailedLogs[gKey] = { machine: g.machine || '', app: g.app || '', logs: failedLogs };

      // Detail rows
      var detailHtml;
      if (isVibes) {
        // ── VIBES: one log row per invoice, grouped by job_info.tuntutan_no ──
        var _vibesByTno = {};
        var _vibesTnoOrder = [];
        g.logs.forEach(function (l) {
          var tNo = (l.job_info && l.job_info.tuntutan_no) || '—';
          if (!_vibesByTno[tNo]) { _vibesByTno[tNo] = []; _vibesTnoOrder.push(tNo); }
          _vibesByTno[tNo].push(l);
        });
        if (!_vibesTnoOrder.length) {
          detailHtml = '<div class="r-empty" style="padding:8px">No invoice data in this batch</div>';
        } else {
          detailHtml = _vibesTnoOrder.map(function (tNo) {
            var invLogs = _vibesByTno[tNo];
            var invRows = invLogs.map(function (l) {
              var st = (l.status || '').toUpperCase();
              var isFail = st === 'FAILED' || st === 'ERROR';
              var badge = isFail ? 'r-badge-err' : 'r-badge-ok';
              var badgeLabel = isFail ? st : 'UPLOADED';
              var invNo = (l.job_info && l.job_info.invoice_no) || '—';
              var amtRaw = l.job_info && l.job_info.amount != null ? l.job_info.amount : null;
              var amtStr = amtRaw != null ? 'RM ' + parseFloat(amtRaw).toFixed(2) : '—';
              var pages = l.job_info && l.job_info.pages != null ? l.job_info.pages : '—';
              var durVal = l.duration != null ? l.duration
                : (l.job_info && l.job_info.duration_s != null ? l.job_info.duration_s : null);
              var errMsg = l.error_msg || (l.job_info && l.job_info.error) || '';
              return '<tr>' +
                '<td class="r-font-mono" style="white-space:nowrap;font-size:11px;vertical-align:top;padding-top:6px">' + _fmtTime(l.timestamp) + '</td>' +
                '<td class="r-cell-trunc r-font-mono" style="max-width:160px;font-size:11px;vertical-align:top;padding-top:6px" title="' + esc(l.file_name || '') + '">' + esc(l.file_name || '—') + '</td>' +
                '<td class="r-font-mono" style="font-size:11px;vertical-align:top;padding-top:6px">' + esc(invNo) + '</td>' +
                '<td style="font-size:11px;white-space:nowrap;vertical-align:top;padding-top:6px">' + esc(amtStr) + '</td>' +
                '<td style="vertical-align:top;padding-top:6px"><span class="r-badge ' + badge + '">' + badgeLabel + '</span></td>' +
                '<td class="r-cell-trunc" style="max-width:200px;font-size:11px;color:#64748b;vertical-align:top;padding-top:6px">' + (errMsg ? esc(errMsg) : '—') + '</td>' +
                '<td style="font-size:11px;white-space:nowrap;vertical-align:top;padding-top:6px">' + (durVal != null ? parseFloat(durVal).toFixed(2) + 's' : '—') + '</td>' +
                '<td style="font-size:11px;text-align:center;vertical-align:top;padding-top:6px">' + esc(String(pages)) + '</td>' +
                '<td style="vertical-align:top;padding-top:6px">—</td>' +
                '</tr>';
            }).join('');
            return '<div style="margin-bottom:14px">' +
              '<div style="font-size:11px;font-weight:600;color:var(--rc-cyan,#38bdf8);padding:6px 0 4px;letter-spacing:0.04em">' +
              '<i class="fa-solid fa-id-card" style="margin-right:5px;opacity:0.7"></i>No. Tuntutan: ' + esc(tNo) + '</div>' +
              tableWrap(['Time', 'File', 'DO', 'Amount', 'Status', 'Error / Detail', 'Duration', 'Pages', 'Action'], invRows) +
              '</div>';
          }).join('');
        }
      } else {
        // Default: one row per file log (non-PROCESSING, non-FINISH entries)
        var isRenamer = /renamer|fv.branch|fv branch/i.test(g.app || '');
        var fileLogs = g.logs.filter(function (l) {
          var st = (l.status || '').toUpperCase();
          return st !== 'PROCESSING' && st !== 'FINISH';
        });
        var fileRows = fileLogs.map(function (l, lIdx) {
          var st = (l.status || '').toUpperCase();
          var isFail = st === 'FAILED' || st === 'ERROR';
          var isFixed = l.fix_status === 'fixed';
          var fname = l.file_name || (l.job_info && l.job_info.file_name) || '—';
          var errMsg = l.error_msg || (l.job_info && l.job_info.error) || '';
          var logId = String(l.id || '');
          var pages = l.job_info && (l.job_info.total_pages || l.job_info.pages || l.job_info.page_count || l.job_info.num_pages || null);
          var durVal = l.duration != null ? l.duration : (l.job_info && (l.job_info.duration || l.job_info.elapsed || l.job_info.processing_time || null));
          var resultName = isRenamer
            ? (l.renamed_to || (l.job_info && l.job_info.renamed_to) || '')
            : '';
          // Normalize error to enterprise format
          var errType = isFail ? _normalizeError(errMsg) : null;
          // Store full raw error text for clipboard access
          var errKey = gKey + '_' + lIdx;
          var detKey = 'errd_' + gKey + '_' + lIdx;
          if (isFail && errMsg) window._rErrStore[errKey] = errMsg;

          // Error cell: enterprise format for failed rows; plain for others
          var errCell;
          if (isFail) {
            // confirmed=true → single definitive root cause; false → possibility list
            var diagLabel, diagBody;
            if (errType.confirmed && errType.rootCause) {
              diagLabel = '<span style="color:' + errType.color + '">●</span> Root Cause';
              diagBody = '<div style="font-size:11px;color:#cbd5e1;line-height:1.6;font-style:italic">' + esc(errType.rootCause) + '</div>';
            } else {
              var causesHtml = (errType.causes || ['Unknown — review raw error']).map(function (c) {
                return '<div style="display:flex;gap:6px;align-items:baseline">' +
                  '<span style="color:' + errType.color + ';font-size:9px;flex-shrink:0">▸</span>' +
                  '<span>' + esc(c) + '</span></div>';
              }).join('');
              diagLabel = 'Possible Causes';
              diagBody = '<div style="font-size:11px;color:#94a3b8;line-height:1.7">' + causesHtml + '</div>';
            }
            errCell =
              '<td style="padding:6px 8px 8px;vertical-align:top">' +
              // Title + code
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">' +
              '<span style="font-size:12px;font-weight:700;color:#e2e8f0;letter-spacing:0.07em">' + esc(errType.title) + '</span>' +
              '<span style="font-size:9px;font-family:\'Courier New\',monospace;color:' + errType.color + ';background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:3px;padding:1px 5px;letter-spacing:0.06em">' + esc(errType.code) + '</span>' +
              '</div>' +
              // Description
              '<div style="font-size:11px;color:#94a3b8;margin-bottom:5px;line-height:1.4">' + esc(errType.description) + '</div>' +
              // Expand/collapse detail
              '<button id="erdbtn_' + detKey + '" onclick="rToggleErrDetail(\'' + detKey + '\')" ' +
              'style="background:none;border:none;color:rgba(255,255,255,0.3);font-size:10px;padding:0;cursor:pointer;font-family:var(--rc-font);margin-bottom:2px">' +
              '<i class="fa-solid fa-chevron-down"></i> Details</button>' +
              // Collapsible detail block
              '<div id="' + detKey + '" style="display:none;margin-top:6px;padding:8px 10px;background:rgba(0,0,0,0.25);border-left:2px solid ' + errType.color + ';border-radius:0 4px 4px 0">' +
              '<div style="font-size:10px;color:#64748b;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:5px">' + diagLabel + '</div>' +
              diagBody +
              (errMsg ? '<div style="margin-top:8px;display:flex;align-items:center;gap:6px">' +
                '<button class="r-btn-sm" style="font-size:10px;padding:1px 7px" onclick="rCopyLogErr(\'' + errKey + '\')">' +
                '<i class="fa-solid fa-copy"></i> Copy Raw Error</button>' +
                '</div>' : '') +
              '</div>' +
              '</td>';
          } else {
            // For completed rows: show meaningful job_info detail, or clean dash
            var completedDetail = errMsg ||
              (l.job_info && (l.job_info.output || l.job_info.output_file || l.job_info.result || l.job_info.message)) || '';
            // Filter out redundant state strings (e.g. "completed", "done")
            var stateWords = ['completed', 'done', 'success', 'ok'];
            if (completedDetail && stateWords.indexOf(completedDetail.toLowerCase().trim()) >= 0) completedDetail = '';
            errCell = '<td class="r-cell-trunc" style="max-width:260px;vertical-align:top;padding-top:6px;color:#64748b;font-size:11px">' +
              (completedDetail ? esc(completedDetail) : '—') + '</td>';
          }

          // Action cell: depends on error type + fix_status
          var isAcked = l.fix_status === 'acknowledged';
          var actionCell = '<td style="vertical-align:top;padding-top:6px;min-width:140px">';
          if (!isFail) {
            actionCell += '</td>';
          } else if (isFixed) {
            actionCell +=
              '<div style="font-size:11px;color:var(--rc-green,#10b981);display:flex;align-items:center;gap:4px">' +
              '<i class="fa-solid fa-circle-check"></i> Fixed by ' + esc(l.fixed_by || '?') +
              '</div>' +
              (l.fix_note ? '<div style="font-size:10px;color:#d1fae5;margin-top:3px">' + esc(l.fix_note) + '</div>' : '') +
              '</td>';
          } else if (isAcked) {
            actionCell +=
              '<div style="font-size:11px;color:#94a3b8;display:flex;align-items:center;gap:4px">' +
              '<i class="fa-solid fa-eye"></i> Acknowledged by ' + esc(l.fixed_by || '?') +
              '</div>' +
              (l.fix_note ? '<div style="font-size:10px;color:#cbd5e1;margin-top:3px">' + esc(l.fix_note) + '</div>' : '') +
              '</td>';
          } else {
            // Type badge
            actionCell += '<div style="font-size:10px;color:' + errType.color + ';margin-bottom:5px">' +
              '<i class="fa-solid ' + errType.icon + '"></i> ' + errType.title + '</div>';
            if (errType.action === 'ocr_fail') {
              // OCR failure — file must be renamed manually by branch staff
              actionCell +=
                '<div style="font-size:10px;color:#f59e0b;margin-bottom:5px;font-style:italic">' +
                '<i class="fa-solid fa-triangle-exclamation" style="margin-right:3px"></i>' +
                'Rename manually at branch</div>' +
                '<button class="r-btn-sm" style="font-size:10px;padding:2px 8px;color:#f59e0b;border-color:rgba(245,158,11,0.35)" ' +
                'onclick="rAcknowledgeLog(\'' + logId + '\',this)" title="Acknowledge — note action taken (e.g. notified branch, renamed manually)">' +
                '<i class="fa-solid fa-eye"></i> Acknowledge</button>';
            } else if (errType.action === 'acknowledge') {
              // System/resource crash — admin acknowledge, bukan fix kod
              actionCell +=
                '<button class="r-btn-sm" style="font-size:10px;padding:2px 8px;color:#94a3b8;border-color:rgba(148,163,184,0.35)" ' +
                'onclick="rAcknowledgeLog(\'' + logId + '\',this)">' +
                '<i class="fa-solid fa-eye"></i> Acknowledge</button>';
            } else if (errType.action === 'fix') {
              actionCell +=
                '<button class="r-btn-sm" style="font-size:10px;padding:2px 8px;color:var(--rc-green,#10b981);border-color:rgba(16,185,129,0.3)" ' +
                'onclick="rMarkLogFixed(\'' + logId + '\',this)" title="Mark this failure as resolved after code fix">' +
                '<i class="fa-solid fa-circle-check"></i> Mark Fixed</button>';
            } else if (errType.action === 'restart') {
              actionCell +=
                '<button class="r-btn-sm" style="font-size:10px;padding:2px 8px;color:var(--rc-warn,#f59e0b);border-color:rgba(245,158,11,0.3)" ' +
                'onclick="rSendTeleCmd(\'' + esc(g.machine || '') + '\',\'RESTART\')" title="Restart Rasumi Apps on ' + esc(g.machine || '') + '">' +
                '<i class="fa-solid fa-rotate-right"></i> Restart Machine</button>';
            } else if (errType.action === 'config') {
              actionCell +=
                '<span style="font-size:10px;color:var(--rc-muted);font-style:italic">Check permissions<br>on ' + esc(g.machine || 'machine') + '</span>';
            } else if (errType.action === 'dismiss') {
              // FILE MISSING — User/File Action, not a system/app error
              // Dismiss acknowledges that admin has seen it; no code fix required
              actionCell +=
                '<div style="font-size:10px;color:#64748b;margin-bottom:5px;font-style:italic">No system action required</div>' +
                '<button class="r-btn-sm" style="font-size:10px;padding:2px 8px;color:#f59e0b;border-color:rgba(245,158,11,0.3)" ' +
                'onclick="rAcknowledgeLog(\'' + logId + '\',this)" title="Dismiss — file was absent at source, not an application failure">' +
                '<i class="fa-solid fa-xmark"></i> Dismiss</button>';
            }
            // 'none' type — no action, type badge is enough
            actionCell += '</td>';
          }

          var isValidationSkip = isFail && errType && errType.type === 'validation';
          return '<tr>' +
            (isFail && !isAcked && !isFixed && !isValidationSkip
              ? '<td style="vertical-align:top;padding-top:7px;text-align:center;width:32px"><input type="checkbox" class="r-fail-chk-' + gKey + '" data-id="' + logId + '" onchange="rUpdateFailSelection(\'' + gKey + '\')" style="cursor:pointer;accent-color:var(--rc-cyan,#38bdf8);width:14px;height:14px"></td>'
              : '<td></td>') +
            '<td class="r-font-mono" style="white-space:nowrap;vertical-align:top;padding-top:6px">' + _fmtTime(l.timestamp) + '</td>' +
            '<td class="r-cell-trunc" style="max-width:180px;vertical-align:top;padding-top:6px">' + esc(fname) + '</td>' +
            (isRenamer
              ? '<td class="r-cell-trunc r-font-mono" style="max-width:180px;vertical-align:top;padding-top:6px;color:' + (resultName ? 'var(--rc-cyan,#38bdf8)' : '#475569') + '" title="' + esc(resultName) + '">' + (resultName ? esc(resultName) : '—') + '</td>'
              : '') +
            '<td style="vertical-align:top;padding-top:6px">' +
            (function () {
              if (isFixed) return '<span class="r-badge r-badge-ok">FIXED</span>';
              if (isAcked) return '<span class="r-badge r-badge-muted">ACKED</span>';
              // Validation skip: amber SKIPPED — bukan ralat sistem/app
              if (errType && errType.type === 'validation')
                return '<span class="r-badge r-badge-warn" title="File skipped — required document types not found">SKIPPED</span>';
              // File Missing: amber badge — User/File Action, not an app failure
              if (errType && errType.type === 'file_missing')
                return '<span class="r-badge r-badge-warn" title="File was absent at dispatch — not an application error">FILE MISSING</span>';
              return '<span class="r-badge ' + logBadge(st) + '">' + st + '</span>';
            })() +
            '</td>' +
            errCell +
            '<td style="vertical-align:top;padding-top:6px;white-space:nowrap">' + (durVal != null ? parseFloat(durVal).toFixed(2) + 's' : '—') + '</td>' +
            '<td style="vertical-align:top;padding-top:6px;text-align:center;white-space:nowrap">' + (pages != null ? '<span style="font-size:11px;color:#94a3b8">' + pages + '</span>' : '—') + '</td>' +
            actionCell +
            '</tr>';
        }).join('');

        // Determine session-level error profile
        var ackedCount = failedLogs.filter(function (l) { return l.fix_status === 'acknowledged'; }).length;
        var fixedCount = failedLogs.filter(function (l) { return l.fix_status === 'fixed'; }).length;
        var resolvedCount = ackedCount + fixedCount;
        var pendingLogs = failedLogs.filter(function (l) { return !l.fix_status; });
        var pendingSysCount = pendingLogs.filter(function (l) {
          return _classifyErrType(l.error_msg || '').action === 'acknowledge';
        }).length;
        var pendingBugCount = pendingLogs.filter(function (l) {
          return _classifyErrType(l.error_msg || '').action === 'fix';
        }).length;

        // Action banner for failed/skipped sessions
        var failBanner = g.hasFail
          ? (allValidationSkip
            // ── Validation/incomplete skip banner (amber) ──
            ? '<div style="display:flex;align-items:center;gap:8px;padding:10px 0 10px 0;flex-wrap:wrap;border-bottom:1px solid rgba(245,158,11,0.2);margin-bottom:8px">' +
            '<span class="r-badge r-badge-warn" style="font-size:11px"><i class="fa-solid fa-file-circle-question"></i> ' + failedLogs.length + ' SKIPPED — Incomplete Document</span>' +
            '<span style="font-size:11px;color:#94a3b8;font-style:italic">No application error — required document types not found in file</span>' +
            (pendingLogs.length > 0
              ? '<button class="r-btn-sm" onclick="rAcknowledgeAll(\'' + gKey + '\')" style="font-size:11px;color:#f59e0b;border-color:rgba(245,158,11,0.35)"><i class="fa-solid fa-xmark"></i> Dismiss All (' + pendingLogs.length + ')</button>'
              : '') +
            '</div>'
            // ── Partial / full failure banner ──
            : '<div style="display:flex;align-items:center;gap:8px;padding:10px 0 10px 0;flex-wrap:wrap;border-bottom:1px solid ' + (sessionSt === 'PARTIAL' ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)') + ';margin-bottom:8px">' +
            '<span class="r-badge ' + (sessionSt === 'PARTIAL' ? 'r-badge-warn' : 'r-badge-err') + '" style="font-size:11px"><i class="fa-solid fa-circle-xmark"></i> ' + failedLogs.length + ' FAILED' +
            (resolvedCount ? ' <span style="opacity:0.7;font-weight:400">(' + resolvedCount + ' resolved)</span>' : '') +
            '</span>' +
            (pendingSysCount > 0
              ? '<button class="r-btn-sm" onclick="rAcknowledgeAll(\'' + gKey + '\')" ' +
              'style="font-size:11px;color:#94a3b8;border-color:rgba(148,163,184,0.35)">' +
              '<i class="fa-solid fa-eye"></i> Acknowledge All (' + pendingSysCount + ')</button>'
              : '') +
            (pendingBugCount > 0
              ? '<button class="r-btn-sm" onclick="rMarkAllLogFixed(\'' + gKey + '\')" ' +
              'title="Mark all code-level failures as fixed" ' +
              'style="font-size:11px;color:var(--rc-green,#10b981);border-color:rgba(16,185,129,0.3)">' +
              '<i class="fa-solid fa-circle-check"></i> Mark All Fixed (' + pendingBugCount + ')</button>'
              : '') +
            '<button id="r-ack-sel-' + gKey + '" class="r-btn-sm" onclick="rAcknowledgeSelected(\'' + gKey + '\')" ' +
            'style="display:none;font-size:11px;color:var(--rc-cyan,#38bdf8);border-color:rgba(56,189,248,0.35)">' +
            '<i class="fa-solid fa-eye"></i> Acknowledge Selected</button>' +
            '<button class="r-btn-sm" onclick="rExportFailCsv(\'' + gKey + '\')" ' +
            'title="Download failed file list as CSV" style="font-size:11px">' +
            '<i class="fa-solid fa-file-csv"></i> Export CSV</button>' +
            '<button class="r-btn-sm" onclick="rSendTeleCmd(\'' + esc(g.machine || '') + '\',\'RESTART\')" ' +
            'title="Restart Rasumi Apps on ' + esc(g.machine || '') + '" ' +
            'style="font-size:11px;color:var(--rc-warn,#f59e0b);border-color:rgba(245,158,11,0.35)">' +
            '<i class="fa-solid fa-rotate-right"></i> Restart ' + esc(g.machine || '') + '</button>' +
            '</div>'
          )  // close allValidationSkip ternary
          : '';

        var chkHeader = pendingSysCount > 0 || pendingBugCount > 0
          ? '<input type="checkbox" id="chk-all-' + gKey + '" onchange="rSelectAllFailed(\'' + gKey + '\',this.checked)" style="cursor:pointer;accent-color:var(--rc-cyan,#38bdf8);width:14px;height:14px" title="Select all pending">'
          : '';
        var detailHeaders = isRenamer
          ? [chkHeader, 'Time', 'File', 'Result', 'Status', 'Error / Detail', 'Duration', 'Pages', 'Action']
          : [chkHeader, 'Time', 'File', 'Status', 'Error / Detail', 'Duration', 'Pages', 'Action'];
        // When FINISH log reports more failures than FAILED log entries in Supabase
        // (happens when FAILED inserts fail silently due to schema mismatch), show
        // a notice so the admin knows files failed but names aren't available yet.
        var missingFailCount = (g._failedCount || 0) - failedLogs.length;
        // Show notice when FINISH log reports failures but no FAILED log entries
        // were received (FAILED logs may have failed to insert into Supabase).
        var missingNotice = (missingFailCount > 0 && failedLogs.length === 0)
          ? '<div style="margin-bottom:8px;padding:8px 12px;background:rgba(239,68,68,0.07);border-left:3px solid rgba(239,68,68,0.5);border-radius:0 4px 4px 0;font-size:11px;color:#fca5a5">' +
            '<i class="fa-solid fa-triangle-exclamation" style="margin-right:6px"></i>' +
            missingFailCount + ' file(s) reported as failed by engine — detailed log entries pending sync. ' +
            'Check <b>Renamer Docs</b> tab or re-run to confirm files.' +
            '</div>'
          : '';
        detailHtml = failBanner + missingNotice + (fileRows
          ? tableWrap(detailHeaders, fileRows)
          : '<div class="r-empty" style="padding:8px">No file-level data</div>');
      }

      var colSpan = 9 + (showMachine ? 1 : 0) + (showBranch ? 1 : 0);
      return '<tr>' +
        '<td>' + _fmtDate(g.start) + '</td>' +
        (showMachine ? '<td class="r-font-mono" style="font-size:11px">' + esc(g.machine || '—') + '</td>' : '') +
        (showBranch ? '<td class="r-font-mono" style="font-size:11px">' + esc(_branchName(g.branch)) + '</td>' : '') +
        '<td><span class="r-badge r-badge-purple">' + esc((/^fv.branch$/i.test(g.app || '') ? 'Renamer FV' : g.app) || '—') + '</span></td>' +
        '<td class="r-font-mono">' + _fmtTime(g.start) + '</td>' +
        '<td class="r-font-mono">' + _fmtTime(g.end) + '</td>' +
        '<td>' + (totalDocs > 0 ? totalDocs : g.allProcessing ? 'running…' : '—') + '</td>' +
        '<td>' + _fmtDur(g.start, g.end) + '</td>' +
        '<td><span class="r-badge ' + ({ COMPLETED: 'r-badge-ok', PARTIAL: 'r-badge-warn', FAILED: 'r-badge-err', RUNNING: 'r-badge-info', CANCELLED: 'r-badge-muted' }[sessionSt] || 'r-badge-muted') + '">' + sessionSt + '</span></td>' +
        '<td class="r-font-mono r-muted-sm" style="font-size:11px">' + esc((g.gid && !g.gid.includes('|') ? g.gid.substring(0, 8) + '…' : '—')) + '</td>' +
        '<td><button class="r-btn-sm" onclick="rToggleLogDetail(\'' + gKey + '\')"><i class="fa-solid fa-list"></i> View</button></td>' +
        '</tr>' +
        '<tr id="rld-' + gKey + '" style="display:none">' +
        '<td colspan="' + colSpan + '" style="padding:0 8px 12px 36px;background:rgba(0,0,0,0.25)">' + detailHtml + '</td>' +
        '</tr>';
    }).join('');

    var tbl = tableWrap(
      ['Date']
        .concat(showMachine ? ['Machine'] : [])
        .concat(showBranch ? ['Branch'] : [])
        .concat(['Application', 'Start', 'End', 'Files', 'Duration', 'Status', 'Job ID', 'Details']),
      rows);

    box.innerHTML =
      '<div class="r-results-count">' + sessions.length + ' session(s) — ' + data.length + ' log entries</div>' +
      (context !== 'global' ? '<div class="r-cmd-hist-scroll">' + tbl + '</div>' : tbl);

  }

  window.rLoadLogs = function () {
    var dateVal = ($r('r-log-date') || {}).value || '';
    var hostname = ($r('r-log-dev') || {}).value || '';
    var appName = ($r('r-log-app') || {}).value || '';
    var issueModeActive = !!RS._issueMode;
    if (RS._issueMode) RS._issueMode = false;
    var statusFilter = issueModeActive ? 'ISSUE' : (($r('r-log-stat') || {}).value || '');
    var box = $r('r-log-results');
    if (!box) return;
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Querying…</div>';
    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }

    // Helper: render + optional Issues Today banner
    function _render(data) {
      _processAndRenderLogs(data, box, statusFilter, 'global');
      if (issueModeActive) {
        var banner = document.createElement('div');
        banner.style.cssText = 'padding:6px 14px;background:rgba(239,68,68,0.07);border-bottom:1px solid rgba(239,68,68,0.18);font-size:12px;color:#ef4444;display:flex;align-items:center;gap:8px;';
        banner.innerHTML = '<i class="fa-solid fa-bug" style="font-size:11px"></i><span>ISSUE SCAN — surfacing all flagged sessions: FAILED · PARTIAL · CANCELLED</span>' +
          '<button onclick="window.rLoadLogs()" style="margin-left:auto;background:none;border:1px solid rgba(239,68,68,0.35);color:#ef4444;cursor:pointer;font-size:11px;padding:2px 8px;border-radius:4px;line-height:1.6">✕ Clear</button>';
        box.insertBefore(banner, box.firstChild);
      }
    }

    // Pass 1: fetch logs (with date filter if set)
    var q = RS.supa.from('logs').select('*')
      .order('timestamp', { ascending: false }).limit(20000);
    if (dateVal) {
      q = q.gte('timestamp', dateVal + 'T00:00:00').lte('timestamp', dateVal + 'T23:59:59');
    }
    if (hostname) q = q.eq('machine', hostname);
    if (appName) q = q.eq('app_name', appName);

    q.then(function (res) {
      var data = res.data || [];

      // No date filter or empty — render directly
      if (!dateVal || !data.length) { _render(data); return; }

      // Multi-pass: capture null-timestamp FAILED logs that get excluded by date filter
      var gidSet = {}, machineSet = {}, gids = [], machines = [];
      data.forEach(function (l) {
        if (l.job_group_id && !gidSet[l.job_group_id]) { gidSet[l.job_group_id] = true; gids.push(l.job_group_id); }
        if (l.machine && !machineSet[l.machine]) { machineSet[l.machine] = true; machines.push(l.machine); }
      });

      if (!machines.length) { _render(data); return; }

      // Build base logMap from P1
      var logMap = {};
      data.forEach(function (l) { if (l.id) logMap[l.id] = l; });

      // P3 — null-ts logs for today's machines (catches null-ts + null-gid FAILED)
      function doP3() {
        if (hostname) { _render(Object.values(logMap)); return; } // machine-specific; P1 already covers it
        RS.supa.from('logs').select('*').is('timestamp', null).in('machine', machines).limit(500)
          .then(function (r3) {
            (r3.data || []).forEach(function (l) { if (l.id) logMap[l.id] = l; });
            _render(Object.values(logMap));
          })
          .catch(function () { _render(Object.values(logMap)); });
      }

      // P2 — all logs sharing gids from P1 (catches null-ts FAILED with valid gid)
      if (!gids.length) { doP3(); return; }

      RS.supa.from('logs').select('*').in('job_group_id', gids).limit(20000)
        .then(function (r2) {
          (r2.data || []).forEach(function (l) { if (l.id) logMap[l.id] = l; });
          doP3();
        })
        .catch(function () { doP3(); });
    }).catch(function (err) { box.innerHTML = errBox(err.message); });
  };


  // ── COMMANDS ───────────────────────────────────────────────
  function _qCmd(cmd, icon, color, desc, label) {
    var display = label || cmd;
    return '<button class="r-btn-sm" title="' + esc(desc) + '" style="border:none;background:none;color:' + color + ';font-size:11px;cursor:pointer" ' +
      'onclick="var i=document.getElementById(\'r-cmd-dev-inp\')||document.getElementById(\'r-cmd-inp\');if(i){i.value=\'' + cmd + '\';if(window._rChkSend)window._rChkSend();}">' +
      '<i class="fa-solid ' + icon + '"></i> ' + display + '</button>';
  }

  function renderCommands() {
    var devOpts = Object.keys(RS.devices).map(function (h) { return '<option value="' + esc(h) + '">' + esc(h) + '</option>'; }).join('');
    var view = $r('r-view-area');
    if (!view) return;
    view.innerHTML =
      '<div class="r-panel">' +
      '<div class="r-panel-hdr"><h3><i class="fa-solid fa-terminal"></i> Remote Commands</h3></div>' +

      // Quick command chips — Group 1: System Control
      '<div class="r-cmd-section">' +
      '<h4>Quick Commands <span class="r-muted-sm">— click to fill input</span></h4>' +
      '<div style="font-size:10px;color:var(--rc-muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;margin-bottom:3px">System Control</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:5px">' +
      _qCmd('PING',        'fa-satellite-dish',       '#0ea5e9',        'Check if machine is alive — returns CPU, RAM & uptime') +
      _qCmd('KILL',        'fa-skull',                'var(--rc-red)',   'Force close Rasumi Apps immediately') +
      _qCmd('RESTART',     'fa-rotate-right',         '#f59e0b',        'Relaunch Rasumi Apps on target machine') +
      _qCmd('REFRESH',     'fa-arrows-rotate',        '#10b981',        'Force push machine status to Supabase now') +
      _qCmd('PAUSE',       'fa-pause',                '#8b5cf6',        'Pause all processing jobs') +
      _qCmd('RESUME',      'fa-play',                 '#84cc16',        'Resume paused processing jobs') +
      _qCmd('RERUN',       'fa-redo',                 '#ec4899',        'Prompt operator to retry current job') +
      _qCmd('UPDATE_AGENT','fa-arrow-up-from-bracket','#facc15',        'Check for latest version and auto-install if available', 'UPDATE') +
      '</div>' +
      // Group 2: Diagnostics & Maintenance
      '<div style="font-size:10px;color:var(--rc-muted);text-transform:uppercase;letter-spacing:1px;margin-top:7px;margin-bottom:3px">Diagnostics &amp; Maintenance</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:5px">' +
      _qCmd('VERSION_CHECK',    'fa-tag',           '#a78bfa', 'Return agent version, OS info and local IP') +
      _qCmd('CHECK_DISK',       'fa-hard-drive',    '#fb923c', 'Show free/used space on all drives with health status') +
      _qCmd('GET_LOGS',         'fa-scroll',        '#4ade80', 'Fetch latest error logs from the machine') +
      _qCmd('SPEED_TEST',       'fa-gauge-high',    '#e879f9', 'Measure internet ping, download and upload speed') +
      _qCmd('CAPTURE_PUBLIC_IP','fa-location-dot',  '#22d3ee', 'Fetch public IP and geolocation, update device map pin', 'GET_LOCATION') +
      _qCmd('CLEAR_CACHE',      'fa-broom',         '#94a3b8', 'Delete temp files and free up disk space') +
      _qCmd('CLEAR_LOGS',       'fa-trash-can',     '#64748b', 'Clear old local log files on machine') +
      _qCmd('RUN_SCRIPT',       'fa-terminal',      '#f97316', 'Execute custom PowerShell script silently (SUPER ADMIN)') +
      '</div>' +
      '</div>' +

      '<div class="r-cmd-section">' +
      '<h4>Send to Specific Machine</h4>' +
      '<div class="r-cmd-row">' +
      '<select class="r-filter-sel" id="r-cmd-dev-sel"><option value="">Select Machine</option>' + devOpts + '</select>' +
      '<input class="r-filter-input" id="r-cmd-dev-inp" placeholder="Select a quick command above or type custom…">' +
      '<button class="r-btn-primary" id="r-btn-send" disabled onclick="rSendCmd()"><i class="fa-solid fa-paper-plane"></i> Send</button>' +
      '</div>' +
      '</div>' +
      '<div class="r-cmd-section">' +
      '<h4>Broadcast to All Online Machines</h4>' +
      '<div class="r-cmd-row">' +
      '<input class="r-filter-input" id="r-broadcast-inp" placeholder="Broadcast command…">' +
      '<button class="r-btn-warn" id="r-btn-broadcast" disabled onclick="rSendBroadcast()"><i class="fa-solid fa-tower-broadcast"></i> Broadcast</button>' +
      '</div>' +
      '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--rc-border)">' +
      '<h4 style="font-size:11px;font-weight:700;color:var(--rc-text-dim);letter-spacing:0.1em;margin:0 0 8px;text-transform:uppercase">📢 Login Screen Announcement</h4>' +
      '<div class="r-ann-toolbar">' +
      '<button class="r-ann-fmt" title="Bold"          onmousedown="event.preventDefault();rAnnFmt(\'bold\')"><b>B</b></button>' +
      '<button class="r-ann-fmt" title="Italic"        onmousedown="event.preventDefault();rAnnFmt(\'italic\')"><i>I</i></button>' +
      '<button class="r-ann-fmt" title="Underline"     onmousedown="event.preventDefault();rAnnFmt(\'underline\')"><u>U</u></button>' +
      '<button class="r-ann-fmt" title="Strikethrough" onmousedown="event.preventDefault();rAnnFmt(\'strikeThrough\')"><s>S</s></button>' +
      '<select class="r-ann-font-sel" id="r-ann-font-sel" onmousedown="rAnnSaveSelection()" onchange="rAnnFont(this.value)">' +
      '<option value="">Font</option>' +
      '<option value="Inter">Inter</option>' +
      '<option value="Arial">Arial</option>' +
      '<option value="Georgia">Georgia</option>' +
      '<option value="Impact">Impact</option>' +
      '<option value="Courier New">Terminal</option>' +
      '</select>' +
      '<div class="r-ann-sep"></div>' +
      '<button class="r-ann-clr" title="White"  style="background:#ffffff" onmousedown="event.preventDefault();rAnnColor(\'#ffffff\')"></button>' +
      '<button class="r-ann-clr" title="Cyan"   style="background:#38bdf8" onmousedown="event.preventDefault();rAnnColor(\'#38bdf8\')"></button>' +
      '<button class="r-ann-clr" title="Green"  style="background:#39ff14" onmousedown="event.preventDefault();rAnnColor(\'#39ff14\')"></button>' +
      '<button class="r-ann-clr" title="Red"    style="background:#ff003c" onmousedown="event.preventDefault();rAnnColor(\'#ff003c\')"></button>' +
      '<button class="r-ann-clr" title="Amber"  style="background:#f59e0b" onmousedown="event.preventDefault();rAnnColor(\'#f59e0b\')"></button>' +
      '<button class="r-ann-clr" title="Purple" style="background:#b200ff" onmousedown="event.preventDefault();rAnnColor(\'#b200ff\')"></button>' +
      '<button class="r-ann-clr" title="Pink"   style="background:#ff00aa" onmousedown="event.preventDefault();rAnnColor(\'#ff00aa\')"></button>' +
      '<div class="r-ann-sep"></div>' +
      '<button class="r-ann-fmt" title="Emoji" onmousedown="event.preventDefault();rAnnToggleEmoji()">😀</button>' +
      '</div>' +
      '<div id="r-announce-inp" class="r-filter-input r-ann-editor" contenteditable="true" data-placeholder="Type announcement message to display on all machines login screen…"></div>' +
      '<div id="r-ann-emoji-picker" class="r-ann-emoji-picker">' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🚨\')">🚨</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'⚠️\')">⚠️</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🔴\')">🔴</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🟡\')">🟡</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🟢\')">🟢</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'⛔\')">⛔</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'✅\')">✅</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'❌\')">❌</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'💀\')">💀</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'☠️\')">☠️</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'👾\')">👾</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🤖\')">🤖</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🕵️\')">🕵️</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🔐\')">🔐</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🛡️\')">🛡️</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🔑\')">🔑</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'💻\')">💻</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🖥️\')">🖥️</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'📡\')">📡</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'📟\')">📟</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'📲\')">📲</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'💾\')">💾</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🖨️\')">🖨️</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'⌨️\')">⌨️</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'⚡\')">⚡</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🔥\')">🔥</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🎯\')">🎯</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🚀\')">🚀</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🔧\')">🔧</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'⚙️\')">⚙️</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🔮\')">🔮</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🌐\')">🌐</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'📊\')">📊</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'📈\')">📈</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🧬\')">🧬</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🧠\')">🧠</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🔎\')">🔎</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🗜️\')">🗜️</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'🦾\')">🦾</button>' +
      '<button class="r-ann-emoji" onmousedown="event.preventDefault();rAnnEmoji(\'👁️\')">👁️</button>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap">' +
      '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">' +
      '<i class="fa-regular fa-clock" style="color:var(--rc-text-dim);font-size:11px"></i>' +
      '<span style="font-size:9px;font-weight:700;color:var(--rc-text-dim);letter-spacing:0.1em;text-transform:uppercase">Duration (Hours)</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;background:rgba(255,255,255,0.05);border:1px solid var(--rc-border);border-radius:6px;overflow:hidden">' +
      '<button class="r-ann-step" onclick="var el=document.getElementById(\'r-announce-hours\');if(el&&+el.value>1)el.value=+el.value-1">−</button>' +
      '<input id="r-announce-hours" type="number" min="1" max="720" value="24" style="width:46px;text-align:center;background:none;border:none;color:var(--rc-text);font-size:13px;font-weight:600;padding:6px 0;outline:none;font-family:var(--rc-font)">' +
      '<button class="r-ann-step" onclick="var el=document.getElementById(\'r-announce-hours\');if(el&&+el.value<720)el.value=+el.value+1">+</button>' +
      '</div>' +
      '<span style="font-size:10px;color:var(--rc-text-dim);flex:1;min-width:120px">' +
      '<i class="fa-solid fa-circle-info" style="margin-right:4px;opacity:0.5"></i>Set how long this announcement will be shown' +
      '</span>' +
      '<button class="r-btn-primary" id="r-btn-announce" disabled onclick="rSendAnnouncement()" style="flex-shrink:0"><i class="fa-solid fa-paper-plane"></i> Announce</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="r-panel-hdr" style="margin-top:20px"><h3>Command History (Last 50)</h3></div>' +
      '<div id="r-cmd-hist-main" class="r-cmd-hist-scroll"><div class="r-loading"><span class="r-spin"></span> Loading…</div></div>' +
      '</div>';

    // [Fasa 6] Command history — read from Supabase
    if (RS.supa) {
      Promise.all([
        RS.supa.from('admin_users').select('email,role,nickname'),
        RS.supa.from('commands').select('*').order('created_at', { ascending: false }).limit(50)
      ]).then(function (results) {
        var box = $r('r-cmd-hist-main');
        if (!box) return;
        var adminMap = {};
        (results[0].data || []).forEach(function (u) {
          adminMap[u.email] = u;
        });
        var cmds = results[1].data || [];
        if (!cmds.length) { box.innerHTML = '<div class="r-empty">No commands sent yet</div>'; return; }
        var rows = cmds.map(function (c) {
          var createdByStr = esc(c.created_by || '—');
          var u = adminMap[c.created_by];
          if (u && u.nickname) {
            var isSA = (u.role === 'superadmin');
            var colorStr = '#38bdf8', bgStr = 'rgba(56,189,248,0.1)', borderStr = 'rgba(56,189,248,0.25)';
            if (!isSA) {
              var hash = 0, em = c.created_by || '';
              for (var i = 0; i < em.length; i++) hash = em.charCodeAt(i) + ((hash << 5) - hash);
              var hue = Math.abs(hash) % 360;
              colorStr = 'hsl(' + hue + ', 80%, 65%)';
              bgStr = 'hsla(' + hue + ', 80%, 65%, 0.1)';
              borderStr = 'hsla(' + hue + ', 80%, 65%, 0.25)';
            }
            var label = isSA ? 'SUPER ADMIN' : 'ADMIN';
            var badgeHtml = '<span style="display:inline-block;font-size:8px;font-weight:700;letter-spacing:1px;padding:2px 6px;border-radius:8px;background:' + bgStr + ';color:' + colorStr + ';border:1px solid ' + borderStr + ';' + (isSA ? '' : 'margin-right:6px;') + 'vertical-align:middle;">' + label + '</span>';
            if (isSA) {
              createdByStr = '<div style="display:flex;align-items:center;">' + badgeHtml + '</div>';
            } else {
              createdByStr = '<div style="display:flex;align-items:center;">' + badgeHtml + '<span style="font-weight:bold;">' + esc(u.nickname) + '</span></div>';
            }
          }
          var targetMac = c.target_machine || 'broadcast';
          var cmdTxt = c.type || c.command || c.action || '—';

          // Normalisasikan arahan lama
          if (cmdTxt === 'STATUS' || cmdTxt === 'REFRESH_STATUS') cmdTxt = 'REFRESH';

          var cmdColor = 'var(--rc-text)';
          if (cmdTxt === 'PING') cmdColor = '#0ea5e9';
          else if (cmdTxt === 'KILL') cmdColor = 'var(--rc-red)';
          else if (cmdTxt === 'RESTART') cmdColor = '#f59e0b';
          else if (cmdTxt === 'REFRESH') cmdColor = '#10b981';
          else if (cmdTxt === 'PAUSE') cmdColor = '#8b5cf6';
          else if (cmdTxt === 'RESUME') cmdColor = '#84cc16';
          else if (cmdTxt === 'RERUN' || cmdTxt === 'RETRY') cmdColor = '#ec4899';
          else if (cmdTxt === 'CLEAR_LOGS' || cmdTxt === 'CLEAR_CACHE') cmdColor = 'var(--rc-muted)';
          else if (cmdTxt === 'VERSION_CHECK') cmdColor = '#a78bfa';
          else if (cmdTxt === 'CHECK_DISK') cmdColor = '#fb923c';
          else if (cmdTxt === 'GET_LOGS') cmdColor = '#34d399';
          else if (cmdTxt === 'SPEED_TEST') cmdColor = '#f472b6';
          else if (cmdTxt === 'CAPTURE_PUBLIC_IP') cmdColor = '#38bdf8';
          else if (cmdTxt === 'UPDATE_AGENT') cmdColor = '#facc15';
          else if (cmdTxt === 'RUN_SCRIPT') cmdColor = '#f97316';

          // ── Result cell: detect [[FULL_LOG:cmd_id]] tag ──────────────────
          var rawResult = c.result || c.result_msg || '';
          var resultHtml;
          var fullLogMatch = rawResult.match(/\[\[FULL_LOG:([^\]]+)\]\]/);
          if (fullLogMatch) {
            var fullCmdId = fullLogMatch[1];
            var preview = rawResult.replace(/\s*\[\[FULL_LOG:[^\]]+\]\]/, '').trim();
            resultHtml = '<span style="color:var(--rc-muted);font-size:11px">' + esc(preview || '—') + '</span>' +
              ' <button class="r-btn-sm neutral" style="font-size:9px;padding:2px 6px;margin-left:4px;" ' +
              'onclick="rViewFullLog(\'' + esc(fullCmdId) + '\')">' +
              '<i class="fa-solid fa-scroll" style="margin-right:3px"></i>View Full</button>';
          } else {
            resultHtml = rawResult ? esc(rawResult) : '—';
          }

          return '<tr>' +
            '<td>' + fmtTs(c.created_at) + '</td>' +
            '<td class="r-font-mono">' + esc(targetMac) + '</td>' +
            '<td class="r-font-mono" style="color:' + cmdColor + '; font-weight: 600;">' + esc(cmdTxt) + '</td>' +
            '<td><span class="r-badge ' + logBadge(c.status) + '">' + esc(c.status || 'PENDING') + '</span></td>' +
            '<td style="max-width:340px;word-break:break-word">' + resultHtml + '</td>' +
            '<td>' + createdByStr + '</td>' +
            '<td><button class="r-btn-sm neutral" style="font-size:10px;padding:3px 8px;" onclick="rSendTeleCmd(\'' + esc(targetMac) + '\', \'' + esc(cmdTxt) + '\')" title="Rerun Command"><i class="fa-solid fa-rotate-right"></i> Rerun</button></td>' +
            '</tr>';
        }).join('');
        box.innerHTML = tableWrap(['Time', 'Target Machine', 'Command', 'Status', 'Result / Remarks', 'By', 'Action'], rows);
      }).catch(function (err) {
        var box = $r('r-cmd-hist-main');
        if (box) box.innerHTML = errBox(err.message || 'Supabase error');
      });
    } else {
      var box = $r('r-cmd-hist-main');
      if (box) box.innerHTML = '<div class="r-empty">Supabase not ready</div>';
    }
    // Enrich machine dropdown with command counts
    rEnrichSelect('r-cmd-dev-sel', 'commands', 'target_machine');
    // Wire button live-validation
    setTimeout(_initCmdBtns, 0);
  }

  function _initCmdBtns() {
    var btnSend   = $r('r-btn-send');
    var btnBcast  = $r('r-btn-broadcast');
    var btnAnn    = $r('r-btn-announce');
    var selDev    = $r('r-cmd-dev-sel');
    var inpCmd    = $r('r-cmd-dev-inp');
    var inpBcast  = $r('r-broadcast-inp');
    var edAnn     = $r('r-announce-inp');

    function chkSend() {
      var ok = selDev && selDev.value && inpCmd && inpCmd.value.trim();
      if (btnSend) btnSend.disabled = !ok;
    }
    function chkBcast() {
      var ok = inpBcast && inpBcast.value.trim();
      if (btnBcast) btnBcast.disabled = !ok;
    }
    function chkAnn() {
      var ok = edAnn && (edAnn.textContent || edAnn.innerText || '').trim();
      if (btnAnn) btnAnn.disabled = !ok;
    }

    window._rChkSend = chkSend;

    if (selDev)   selDev.addEventListener('change', chkSend);
    if (inpCmd)   inpCmd.addEventListener('input',  chkSend);
    if (inpBcast) inpBcast.addEventListener('input', chkBcast);
    if (edAnn)    edAnn.addEventListener('input',   chkAnn);

    chkSend(); chkBcast(); chkAnn();
  }

  window.rSendCmd = function (hostnameOverride) {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    var target = hostnameOverride || ($r('r-cmd-dev-sel') || {}).value || '';
    var command = hostnameOverride
      ? (($r('r-cmd-inp') || {}).value || '')
      : (($r('r-cmd-dev-inp') || {}).value || '');
    if (!target || !command) { rToast('Select machine and enter command', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    var user = RS.currentUser;
    var cmdUp = command.toUpperCase();
    var createdBy = user ? user.email : 'admin';
    // ── RUN_SCRIPT: open script editor instead of sending directly ────────
    if (cmdUp === 'RUN_SCRIPT') {
      rOpenScriptEditor(target, createdBy);
      return;
    }
    RS.supa.from('commands').insert({
      target_machine: target,
      type: cmdUp,
      status: 'PENDING',
      created_at: new Date().toISOString(),
      created_by: createdBy
    }).then(function () {
      rToast('Command "' + cmdUp + '" sent to ' + target, 'success');
      var inp = $r('r-cmd-dev-inp') || $r('r-cmd-inp');
      if (inp) inp.value = '';
    }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── RUN_SCRIPT: Script editor modal ──────────────────────────────────────
  window.rOpenScriptEditor = function (target, createdBy) {
    var ovId = 'r-script-editor-ov';
    var ex = $r(ovId); if (ex) ex.remove();
    var ov = document.createElement('div');
    ov.id = ovId;
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;padding:24px;';
    ov.innerHTML =
      '<div style="background:var(--rc-surface,#0d1117);border:1px solid #f97316;border-radius:12px;' +
      'width:100%;max-width:700px;display:flex;flex-direction:column;overflow:hidden;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--rc-border,#1e293b)">' +
      '<span style="font-size:13px;font-weight:600;color:#f97316"><i class="fa-solid fa-terminal" style="margin-right:8px"></i>RUN_SCRIPT → ' + esc(target) + '</span>' +
      '<button onclick="document.getElementById(\'' + ovId + '\').remove()" style="background:none;border:none;color:var(--rc-muted);cursor:pointer;font-size:18px;line-height:1">✕</button>' +
      '</div>' +
      '<div style="padding:16px">' +
      '<div style="font-size:11px;color:var(--rc-muted);margin-bottom:8px">' +
      '<i class="fa-solid fa-shield-halved" style="color:#f97316;margin-right:4px"></i>' +
      'PowerShell script — runs hidden on client. Output returned here. SUPER_ADMIN only. Timeout: 30s.' +
      '</div>' +
      '<textarea id="r-script-ta" spellcheck="false" style="width:100%;height:220px;background:var(--rc-bg,#05080f);' +
      'border:1px solid var(--rc-border,#1e293b);border-radius:8px;color:var(--rc-text);' +
      'font-family:\'JetBrains Mono\',monospace;font-size:12px;line-height:1.6;padding:12px;' +
      'resize:vertical;box-sizing:border-box;outline:none;" ' +
      'placeholder="# Example&#10;Write-Output &quot;Hello from $(hostname)&quot;&#10;Get-Process | Select-Object Name,CPU | Sort-Object CPU -Descending | Select-Object -First 10"></textarea>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">' +
      '<button class="r-btn-sm neutral" onclick="document.getElementById(\'' + ovId + '\').remove()">Cancel</button>' +
      '<button class="r-btn-sm" style="background:#f97316;color:#000;border-color:#f97316;font-weight:600;" ' +
      'onclick="rSubmitScript(\'' + esc(target) + '\',\'' + esc(createdBy) + '\',\'' + ovId + '\')">' +
      '<i class="fa-solid fa-play" style="margin-right:5px"></i>Execute</button>' +
      '</div></div></div>';
    ov.addEventListener('click', function (ev) { if (ev.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    setTimeout(function () { var ta = $r('r-script-ta'); if (ta) ta.focus(); }, 80);
  };

  window.rSubmitScript = function (target, createdBy, ovId) {
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    var ta = $r('r-script-ta');
    var script = (ta ? ta.value : '').trim();
    if (!script) { rToast('Script cannot be empty', 'warn'); return; }
    RS.supa.from('commands').insert({
      target_machine: target,
      type: 'RUN_SCRIPT',
      status: 'PENDING',
      created_at: new Date().toISOString(),
      created_by: createdBy,
      payload: { script: script }
    }).then(function () {
      rToast('Script sent to ' + target, 'success');
      var ov = $r(ovId); if (ov) ov.remove();
      if (typeof renderCommands === 'function') renderCommands();
    }).catch(function (e) { rToast('Error: ' + (e.message || e), 'error'); });
  };

  window.rSendBroadcast = function () {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    var command = ($r('r-broadcast-inp') || {}).value || '';
    if (!command) { rToast('Enter broadcast command', 'warn'); return; }
    var online = Object.values(RS.devices).filter(function (d) { return d._status === 'online'; });
    if (!online.length) { rToast('No online machines', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    var user = RS.currentUser;
    var cmdUp = command.toUpperCase();
    var createdBy = user ? user.email : 'admin';
    var nowIso = new Date().toISOString();
    var supaRows = online.map(function (d) {
      return {
        target_machine: d.id,
        type: cmdUp,
        status: 'PENDING',
        is_broadcast: true,
        created_at: nowIso,
        created_by: createdBy
      };
    });
    RS.supa.from('commands').insert(supaRows).then(function () {
      rToast('Broadcast → ' + online.length + ' machine(s)', 'success');
      var inp = $r('r-broadcast-inp');
      if (inp) inp.value = '';
      renderCommands();
    }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── ANNOUNCEMENT RICH EDITOR HELPERS ────────────────────────
  window.rAnnFmt = function (cmd) {
    document.execCommand(cmd, false, null);
  };
  window.rAnnColor = function (color) {
    document.execCommand('foreColor', false, color);
  };
  // Save selection before font dropdown steals focus
  window.rAnnSaveSelection = function () {
    var sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount > 0) {
      window._annSavedRange = sel.getRangeAt(0).cloneRange();
    }
  };
  window.rAnnFont = function (fontName) {
    if (!fontName) return;
    var ed = $r('r-announce-inp');
    if (!ed) return;
    ed.focus();
    // Restore selection that was lost when dropdown opened
    if (window._annSavedRange) {
      var sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(window._annSavedRange); }
      window._annSavedRange = null;
    }
    document.execCommand('fontName', false, fontName);
    // Reset dropdown back to placeholder
    var fsel = $r('r-ann-font-sel');
    if (fsel) fsel.selectedIndex = 0;
  };
  window.rAnnToggleEmoji = function () {
    var p = $r('r-ann-emoji-picker');
    if (!p) return;
    p.style.display = p.style.display === 'flex' ? 'none' : 'flex';
  };
  window.rAnnEmoji = function (emoji) {
    var ed = $r('r-announce-inp');
    if (!ed) return;
    ed.focus();
    document.execCommand('insertText', false, emoji);
    var p = $r('r-ann-emoji-picker');
    if (p) p.style.display = 'none';
  };

  // ── ANNOUNCEMENT ────────────────────────────────────────────
  window.rSendAnnouncement = function () {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    var ed = $r('r-announce-inp');
    var message = ed ? ed.innerHTML : '';
    var textCheck = ed ? (ed.textContent || ed.innerText || '').trim() : '';
    if (!textCheck) { rToast('Enter an announcement message', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    var hoursEl = $r('r-announce-hours');
    var hours = hoursEl ? parseInt(hoursEl.value, 10) : 24;
    if (!hours || hours < 1) { rToast('Duration must be at least 1 hour', 'warn'); return; }
    var user = RS.currentUser;
    var now = new Date();
    var exp = new Date(now.getTime() + hours * 60 * 60 * 1000);
    RS.supa.from('announcements').insert({
      message: message,
      broadcast_at: now.toISOString(),
      expires_at: exp.toISOString(),
      broadcast_by: user ? user.email : 'admin'
    }).then(function () {
      rToast('📢 Announcement sent — active for ' + hours + ' hour(s)', 'success');
      if (ed) ed.innerHTML = '';
    }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── ALERTS ─────────────────────────────────────────────────
  function renderAlerts() {
    var devs = Object.values(RS.devices);
    var offline = devs.filter(function (d) { return d._status === 'offline'; });
    var stale = devs.filter(function (d) { return d._status === 'stale'; });
    var view = $r('r-view-area');
    if (!view) return;

    var appOpts = [
      'Renamer HQ', 'FV Branch', 'PDF Splitter',
      'PDF Studio', 'Quick Rename', 'Scanify', 'VIBES'
    ].map(function (a) {
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

    // ── VIBES errors ──
    if (RS.unresolvedVibes > 0) {
      html += '<div class="r-alert-section"><div class="r-alert-section-title err"><i class="fa-solid fa-bug"></i> Unresolved VIBES Errors (' + RS.unresolvedVibes + ')</div>' +
        '<div class="r-alert-item err">' + RS.unresolvedVibes + ' error(s) pending resolution.' +
        ' <button class="r-btn-sm" onclick="rNav(\'r-vibes\')">Open VIBES Monitor →</button></div></div>';
    }

    // ── VIBES Skipped Docs section ──
    html += '<div class="r-alert-section">' +
      '<div class="r-alert-section-title warn"><i class="fa-solid fa-file-circle-xmark"></i> VIBES Skipped Docs ' +
      '(<span id="vs-count">—</span> unresolved)</div>' +
      '<div id="vs-results"><div class="r-loading"><span class="r-spin"></span> Loading…</div></div>' +
      '</div>';

    // ── App errors section (loaded separately via rLoadAppErrors) ──
    html += '<div class="r-alert-section">' +
      '<div class="r-alert-section-title err"><i class="fa-solid fa-circle-exclamation"></i> App Errors — All 7 Apps ' +
      '(<span id="ae-count">' + RS.unresolvedAppErrors + '</span> unfixed)</div>' +
      '<div id="ae-results"><div class="r-empty">Click "Refresh Errors" to load</div></div>' +
      '</div>';

    html += '</div>'; // close r-panel
    view.innerHTML = html;

    // Load VIBES skipped docs
    _loadVibesSkipped();
  }

  // Metadata for each skip category
  var _SKIP_META = {
    amount_unresolved: {
      label: 'Amount Unresolved',
      faultColor: 'var(--neon-amber)',
      badge: 'r-badge-warn',
      cause: 'Cause: manual entry mismatch. No action required from system. Clear when acknowledged.'
    },
    folder_not_found: {
      label: 'Unmatch',
      faultColor: 'var(--neon-amber)',
      badge: 'r-badge-warn',
      cause: 'Cause: local storage folder missing or DO mismatch. Verify folder exists in scanner base. No system action required.'
    },
    row_skip_portal_lag: {
      label: 'Portal Unresponsive',
      faultColor: 'var(--neon-red)',
      badge: 'r-badge-err',
      cause: 'Cause: portal page lag — bot could not click Kemaskini Invois after max retries. Re-run bot to retry these rows.'
    },
    batch_skip: {
      label: 'Batch Skip',
      faultColor: 'var(--neon-amber)',
      badge: 'r-badge-warn',
      cause: 'Cause: tuntutan was skipped during batch processing. Verify DO details in VIBES portal.'
    }
  };

  function _loadVibesSkipped() {
    if (!RS.supa) return;
    var box = document.getElementById('vs-results');
    var cnt = document.getElementById('vs-count');
    if (!box) return;
    RS.supa.from('vibes_errors')
      .select('*')
      .in('error_type', ['amount_unresolved', 'folder_not_found', 'row_skip_portal_lag', 'batch_skip'])
      .eq('resolved', false)
      .order('timestamp', { ascending: false })
      .limit(100)
      .then(function (res) {
        var rows = res.data || [];
        if (cnt) cnt.textContent = rows.length;
        if (!rows.length) {
          box.innerHTML = '<div class="r-empty">Tiada doc yang di-skip. Semua tuntutan OK.</div>';
          return;
        }
        var html = rows.map(function (e) {
          var meta = _SKIP_META[e.error_type] || _SKIP_META['batch_skip'];
          var ts = e.timestamp ? new Date(e.timestamp).toLocaleString('ms-MY') : '—';
          var machine = e.hostname || '—';
          var msg = e.message || '';

          // Parse "INV {tuntutan}-{DO}-... [{name}] — {description}"
          // Extract tuntutan and DO number, and description after "—"
          var tuntutan = '—', doNum = '—', desc = msg;
          var parsed = msg.match(/^INV\s+([A-Z0-9]+)-(\d+)-[^\s]+(?:\s+\[[^\]]*\])?\s+[—\-]+\s*([\s\S]*)/);
          if (parsed) {
            tuntutan = parsed[1];
            doNum = parsed[2];
            desc = parsed[3] || '';
          }

          var detId = 'vskip-det-' + String(e.id).replace(/[^a-z0-9]/gi, '_');
          return '<div class="r-alert-item" style="border-left:3px solid ' + meta.faultColor + ';padding:8px 14px">' +
            // Compact header row (always visible)
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<span class="r-badge ' + meta.badge + '" style="font-size:10px">' + esc(meta.label) + '</span>' +
            '<span class="r-muted-sm"><i class="fa-solid fa-server" style="font-size:9px"></i> ' + esc(machine) + '</span>' +
            '<span class="r-muted-sm">' + esc(ts) + '</span>' +
            '<button class="r-btn-sm" style="margin-left:auto" onclick="var d=document.getElementById(\'' + detId + '\');d.style.display=d.style.display===\'none\'?\'\':\'none\'">Details</button>' +
            '<button class="r-btn-sm" onclick="rResolveSkip(\'' + esc(String(e.id)) + '\',this)">✓ Clear</button>' +
            '</div>' +
            // Detail block (hidden by default)
            '<div id="' + detId + '" style="display:none;margin-top:8px;font-size:11px;line-height:1.7">' +
            '<div>- <span class="r-font-mono">' + esc(tuntutan) + ' | ' + esc(doNum) + ' |</span></div>' +
            '<div style="color:var(--text-2)">- ' + esc(desc) + ' ' + esc(meta.cause) + '</div>' +
            '</div>' +
            '</div>';
        }).join('');
        box.innerHTML = html;
      }).catch(function (err) {
        if (box) box.innerHTML = '<div class="r-empty">Gagal load: ' + esc(err.message) + '</div>';
      });
  }

  window.rResolveSkip = function (id, btn) {
    if (!RS.supa || !id) return;
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    RS.supa.from('vibes_errors')
      .update({ resolved: true, fix_status: 'fixed' })
      .eq('id', id)
      .then(function () {
        rToast('Marked resolved', 'ok');
        _loadVibesSkipped();
      }).catch(function (e) {
        rToast('Failed: ' + e.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Mark Resolved'; }
      });
  };

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
  window.rToggleErrExpand = function (safeId) {
    var shortEl = $r('r-err-short-' + safeId);
    var fullEl = $r('r-err-full-' + safeId);
    var togBtn = $r('r-err-tog-' + safeId);
    if (!shortEl || !fullEl) return;
    var expanded = fullEl.style.display !== 'none';
    fullEl.style.display = expanded ? 'none' : '';
    shortEl.style.display = expanded ? '' : 'none';
    if (togBtn) togBtn.textContent = expanded ? '▼ show full' : '▲ collapse';
  };

  // ── Open detail modal for an app error ─────────────────────────
  window.rOpenAppDetails = function (id) {
    var e = _appErrorCache[id];
    if (!e) { rToast('Error not cached — reload list', 'warn'); return; }
    var title = $r('r-modal-title');
    var body = $r('r-modal-body');
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
      '<code style="background:rgba(56,189,248,0.08);padding:2px 7px;border-radius:3px;color:var(--rc-cyan,#38bdf8);font-size:12px">' + esc(e.hostname || '?') + '</code>' +
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

    var fixId = esc(e._id || e.id || '');
    var fixHost = esc(e.hostname || '');
    if (footer) footer.innerHTML = !isFixed
      ? '<button style="background:rgba(239,68,68,0.18);border:1px solid rgba(239,68,68,0.6);color:#fca5a5;border-radius:4px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0.5px" onclick="rModalClose();rOpenAppFix(\'' + fixId + '\',\'' + fixHost + '\')"><i class="fa-solid fa-circle-check"></i> Mark as Fixed</button>' +
      '<button class="r-btn-sm" onclick="rModalClose()">Close</button>'
      : '<button class="r-btn-sm" onclick="rModalClose()">Close</button>';

    rModalOpen();
  };

  window.rLoadAppErrors = function () {
    var appFilter = ($r('ae-app-filter') || {}).value || '';
    var fixFilter = ($r('ae-fix-filter') || {}).value;
    if (fixFilter === undefined) fixFilter = 'unfixed';
    var box = $r('ae-results');
    var cntEl = $r('ae-count');
    if (!box) return;
    if (!RS.supa) { box.innerHTML = '<div class="r-empty">Supabase not ready</div>'; return; }
    box.innerHTML = '<div class="r-loading"><span class="r-spin"></span> Loading…</div>';

    var supaQ = RS.supa.from('app_errors').select('*').order('last_seen', { ascending: false }).limit(100);
    if (fixFilter) supaQ = supaQ.eq('fix_status', fixFilter);
    if (appFilter) supaQ = supaQ.eq('app_name', appFilter);

    supaQ.then(function (res) {
      if (res.error) { box.innerHTML = errBox(res.error.message); return; }
      var docs = (res.data || []).map(function (d) {
        return Object.assign({ _id: d.id, _host: d.hostname }, d);
      });

      var unfixedCount = docs.filter(function (d) { return d.fix_status === 'unfixed'; }).length;
      if (cntEl) cntEl.textContent = unfixedCount;

      if (!docs.length) { box.innerHTML = '<div class="r-empty">No app errors match</div>'; return; }

      var rows = docs.map(function (e) {
        // Cache for detail modal
        _appErrorCache[e._id] = e;

        var isFixed = e.fix_status === 'fixed';
        var rowCls = isFixed ? 'r-alert-item ok' : 'r-alert-item err';
        var badge = isFixed
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
        var lastSeen = fmtTs(e.last_seen);

        // Collapsible error message block
        var msgLines = (e.error_msg || '').split('\n');
        var shortMsg = msgLines.slice(0, 2).join('\n');
        var hasMore = msgLines.length > 2;
        var safeId = String(e._id).replace(/[^a-zA-Z0-9_-]/g, '_');

        var errorBlock =
          '<div style="margin-top:8px">' +
          '<pre id="r-err-short-' + safeId + '" style="margin:0;font-size:11px;color:#fca5a5;white-space:pre-wrap;word-break:break-all;font-family:\'JetBrains Mono\',Consolas,monospace;background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.15);border-radius:3px;padding:6px 8px;line-height:1.5">' + esc(shortMsg) + '</pre>' +
          (hasMore ? '<pre id="r-err-full-' + safeId + '" style="display:none;margin:0;font-size:11px;color:#fca5a5;white-space:pre-wrap;word-break:break-all;font-family:\'JetBrains Mono\',Consolas,monospace;background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.15);border-radius:3px;padding:6px 8px;line-height:1.5">' + esc(e.error_msg || '') + '</pre>' : '') +
          (hasMore ? '<button id="r-err-tog-' + safeId + '" onclick="rToggleErrExpand(\'' + safeId + '\')" style="background:none;border:none;color:var(--rc-text-dim,#9ca3af);font-size:10px;cursor:pointer;padding:3px 0 0;letter-spacing:0.5px;font-family:inherit">▼ show full (' + (msgLines.length - 2) + ' more lines)</button>' : '') +
          '</div>';

        // Action buttons
        var detailBtn = '<button onclick="rOpenAppDetails(\'' + esc(e._id) + '\')" style="background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.3);color:var(--rc-cyan,#38bdf8);border-radius:4px;padding:5px 11px;font-size:11px;cursor:pointer;font-family:inherit;white-space:nowrap" onmouseover="this.style.background=\'rgba(56,189,248,0.16)\'" onmouseout="this.style.background=\'rgba(56,189,248,0.08)\'"><i class="fa-solid fa-magnifying-glass"></i> Details</button>';
        var fixBtn = !isFixed
          ? '<button onclick="rOpenAppFix(\'' + esc(e._id) + '\',\'' + esc(e._host) + '\')" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.5);color:#fca5a5;border-radius:4px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap" onmouseover="this.style.background=\'rgba(239,68,68,0.28)\'" onmouseout="this.style.background=\'rgba(239,68,68,0.15)\'"><i class="fa-solid fa-circle-check"></i> Mark Fixed</button>'
          : '<span style="font-size:11px;color:var(--rc-green,#10b981)"><i class="fa-solid fa-circle-check"></i> Fixed by ' + esc(e.fixed_by || '?') + '</span>';

        return '<div class="' + rowCls + '" style="flex-direction:column;align-items:flex-start;gap:6px;padding:12px 16px">' +
          // Header row: badge, app, hostname, count, lifecycle, action buttons
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%">' +
          badge +
          '<strong style="font-size:13px">' + esc(e.app_name || '?') + '</strong>' +
          '<span class="r-muted-sm">on</span>' +
          '<code style="background:rgba(56,189,248,0.08);padding:2px 7px;border-radius:3px;color:var(--rc-cyan,#38bdf8);font-size:12px">' + esc(e._host) + '</code>' +
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
    }).catch(function (err) { box.innerHTML = errBox(err.message); });
  };

  window.rOpenAppFix = function (docId, hostname) {
    var body = $r('r-modal-body');
    var footer = $r('r-modal-footer');
    var title = $r('r-modal-title');
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

  window.rSubmitAppFix = function (docId, hostname) {
    var note = ($r('r-appfix-note') || {}).value || '';
    if (note.trim().length < 5) { rToast('Fix note must be at least 5 characters', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not ready', 'error'); return; }
    var user = RS.currentUser;
    RS.supa.from('app_errors').update({
      fix_status: 'fixed',
      fix_note: note.trim(),
      fixed_by: user ? user.email : 'admin',
      fixed_at: new Date().toISOString()
    }).eq('id', docId).then(function (res) {
      if (res.error) { rToast('Error: ' + res.error.message, 'error'); return; }
      rToast('Marked as fixed — auto-deletes in 48h', 'success');
      rModalClose();
      rLoadAppErrors();
    }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
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

    function _buildUI(curVer, curUrl, curNotes, curSched, curBy, curTime, smtpEmail, smtpPass, statusBadge, isSyncing) {
      var parts = (curVer || '').split('.');
      var nextVer = (parts.length >= 2)
        ? parts[0] + '.' + (parseInt(parts[1] || '0') + 1)
        : '';

      var opac = isSyncing ? 'opacity:0.6;pointer-events:none;' : '';

      return '<div class="r-panel" style="' + opac + '">' +
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
        '<div class="r-muted-sm">Released by: <b id="r-released-by-txt">' + esc(curBy) + '</b> &nbsp;·&nbsp; ' + esc(curTime) + '</div>' +
        (curNotes ? '<div class="r-muted-sm" style="margin-top:4px">' + esc(curNotes) + '</div>' : '') +
        '</div>' +

        // SMTP config card
        '<div class="r-panel-hdr" style="margin-top:0"><h3><i class="fa-solid fa-envelope-open-text"></i> SMTP Config (Contact Admin Email) <button onclick="rEditSmtp()" style="background:none;border:none;cursor:pointer;color:var(--rc-text-dim);font-size:10px;padding:4px;margin-left:8px;" title="Edit SMTP"><i class="fa-solid fa-pencil"></i></button></h3></div>' +
        '<div class="r-fix-form" style="margin-bottom:24px">' +
        '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
        '<div class="r-fix-field" style="flex:1;min-width:200px;margin-bottom:0;">' +
        '<label>Email Address</label>' +
        '<input id="smtp-email" class="r-filter-input" style="width:100%; pointer-events:none;" tabindex="-1" placeholder="it.rasumigroup@gmail.com" value="' + esc(smtpEmail) + '" readonly oninput="rHandleSmtpInput()">' +
        '</div>' +
        '<div class="r-fix-field" style="flex:1;min-width:200px;margin-bottom:0;">' +
        '<label>Password <span class="r-muted-sm">(16-char, from Google Account → App Passwords)</span></label>' +
        '<input id="smtp-pass" type="password" class="r-filter-input" style="width:100%; pointer-events:none;" tabindex="-1" placeholder="••••••••••••••••" value="' + esc(smtpPass) + '" readonly oninput="rHandleSmtpInput()">' +
        '</div>' +
        '</div>' +
        '<div style="margin-top:4px;display:flex;gap:10px;align-items:center">' +
        '<span class="r-muted-sm" style="font-size:10px">Saved credentials are fetched by all machines — no env var needed</span>' +
        '</div>' +
        '</div>' +

        // Publish new version form
        '<div class="r-panel-hdr" style="margin-top:0"><h3>Publish New Version</h3></div>' +
        '<div class="r-fix-form">' +
        '<div class="r-fix-field">' +
        '<div id="rel-version-warn" style="font-size:10px;color:#ef4444;margin-bottom:4px;font-family:monospace;display:none;"></div>' +
        '<label>New Version <span class="r-required">*</span></label>' +
        '<input id="rel-version" class="r-filter-input" placeholder="e.g. ' + esc(nextVer) + '" style="width:160px" value="" oninput="rClearFieldWarn(\'rel-version-warn\'); rCheckReleaseForm()">' +
        '</div>' +
        '<div class="r-fix-field">' +
        '<label>Current URL</label>' +
        '<input id="rel-cur-url" class="r-filter-input" style="width:100%;opacity:0.55;cursor:default;pointer-events:none;" tabindex="-1" readonly value="' + esc(curUrl) + '">' +
        '</div>' +
        '<div class="r-fix-field">' +
        '<div id="rel-url-warn" style="font-size:10px;color:#ef4444;margin-bottom:4px;font-family:monospace;display:none;"></div>' +
        '<label>New Version URL <span class="r-required">*</span></label>' +
        '<input id="rel-url" class="r-filter-input" style="width:100%" placeholder="https://drive.usercontent.google.com/download?id=..." value="" oninput="rClearFieldWarn(\'rel-url-warn\'); rCheckReleaseForm()">' +
        '</div>' +
        '<div class="r-fix-field">' +
        '<label>Release Notes</label>' +
        '<textarea id="rel-notes" rows="3" class="r-textarea" placeholder="What\'s new in this version…"></textarea>' +
        '</div>' +
        '<div class="r-fix-field">' +
        '<label><i class="fa-solid fa-clock"></i> Scheduled Release Time <span class="r-muted-sm">(optional)</span></label>' +
        '<input id="rel-sched" type="datetime-local" class="r-filter-input" style="width:260px" value="" oninput="rCheckReleaseForm()">' +
        '<div class="r-muted-sm" style="margin-top:4px">Update prompts are triggered instantly when a new version is released.</div>' +
        '</div>' +
        '<div style="display:flex;gap:10px;margin-top:8px">' +
        '<button id="btn-deploy" class="r-btn-primary" style="flex:1;max-width:120px" onclick="rPublishRelease()"><i class="fa-solid fa-rocket"></i> Deploy</button>' +
        '<button id="btn-cancel" class="r-btn-sm" style="flex:1;max-width:120px" onclick="rCancelScheduled()" title="Cancel scheduled time">Cancel</button>' +
        '</div>' +
        '</div>' +
        '</div>';
    }

    // 1. Render UI instantly (from cache if available)
    if (RS.appSettingsCache) {
      var c = RS.appSettingsCache;
      var cVer = c.latest_version || '—';
      var cUrl = c.update_url || '—';
      var cNotes = c.release_notes || '';
      var cSched = c.scheduled_at || '';
      var cBy = c.released_by || '—';
      var cTime = c.updated_at ? fmtTs(c.updated_at) : '—';

      var nowD = new Date();
      var cBadge = '';
      if (cSched) {
        var cD = new Date(cSched);
        cBadge = cD > nowD
          ? '<span class="r-badge r-badge-warn"><i class="fa-solid fa-clock"></i> Scheduled: ' + fmtTs(cSched) + '</span>'
          : '<span class="r-badge r-badge-green"><i class="fa-solid fa-check"></i> Released</span>';
      } else if (cVer !== '—') {
        cBadge = '<span class="r-badge r-badge-green"><i class="fa-solid fa-check"></i> Live</span>';
      }

      var syncBadge = '<span class="r-badge" style="background:transparent;border:1px solid var(--rc-text-dim);color:var(--rc-text-dim);margin-left:8px;font-size:9px;"><i class="fa-solid fa-arrows-rotate fa-spin"></i> Syncing...</span>';
      view.innerHTML = _buildUI(cVer, cUrl, cNotes, cSched, cBy, cTime, c.smtp_email || 'it.rasumigroup@gmail.com', c.smtp_app_password || '', cBadge + syncBadge, false);
      if (window.rCheckReleaseForm) rCheckReleaseForm();
    } else {
      var syncBadge = '<span class="r-badge" style="background:transparent;border:1px solid var(--rc-text-dim);color:var(--rc-text-dim)"><i class="fa-solid fa-arrows-rotate fa-spin"></i> Syncing...</span>';
      view.innerHTML = _buildUI('--', 'Fetching...', '', '', 'Loading...', 'Loading...', 'Loading...', '', syncBadge, true);
      if (window.rCheckReleaseForm) rCheckReleaseForm();
    }

    // 2. Fetch real data in background
    RS.supa.from('app_settings').select('*').order('id', { ascending: true }).limit(1).then(function (res) {
      if (RS.route !== 'r-release') return; // User navigated away

      var cur = (res.data || [])[0] || {};
      RS.appSettingsCache = cur; // Update global cache
      var curVer = cur.latest_version || '—';
      var curUrl = cur.update_url || '—';
      var curNotes = cur.release_notes || '';
      var curSched = cur.scheduled_at || '';
      var curBy = cur.released_by || '—';
      var curTime = cur.updated_at ? fmtTs(cur.updated_at) : '—';
      var smtpEmail = cur.smtp_email || 'it.rasumigroup@gmail.com';
      var smtpPass = cur.smtp_app_password || '';

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

      // Re-render with real data
      view.innerHTML = _buildUI(curVer, curUrl, curNotes, curSched, curBy, curTime, smtpEmail, smtpPass, statusBadge, false);
      if (window.rCheckReleaseForm) rCheckReleaseForm();

      // If released_by is an email (old format), async-resolve to role+nickname
      if (curBy.includes('@') && RS.supa) {
        RS.supa.from('admin_users').select('role,nickname').eq('email', curBy).single()
          .then(function (res2) {
            if (RS.route !== 'r-release') return;
            if (res2.error || !res2.data) return;
            var nick = res2.data.nickname || '';
            var role = res2.data.role === 'superadmin' ? 'Super Admin' : 'Admin';
            var label = nick ? (role + ' ' + nick) : curBy;
            var el = document.getElementById('r-released-by-txt');
            if (el) el.textContent = label;
          }).catch(function () { });
      }

    }).catch(function (err) {
      if (RS.route === 'r-release') {
        view.innerHTML = '<div class="r-panel">' + errBox('Failed to load: ' + err.message) + '</div>';
      }
    });
  }

  // ── Inline field warning helpers ───────────────────────────────
  window.rShowFieldWarn = function (id, msg) {
    var el = document.getElementById(id);
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  };
  window.rClearFieldWarn = function (id) {
    var el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.textContent = ''; }
  };

  window.rCheckReleaseForm = function () {
    var vEl = $r('rel-version');
    var uEl = $r('rel-url');
    var sEl = $r('rel-sched');
    var bDep = $r('btn-deploy');
    var bCan = $r('btn-cancel');

    if (bDep && vEl && uEl) {
      if (vEl.value.trim() !== '' && uEl.value.trim() !== '') {
        bDep.style.opacity = '1';
        bDep.style.pointerEvents = 'auto';
      } else {
        bDep.style.opacity = '0.35';
        bDep.style.pointerEvents = 'none';
      }
    }

    if (bCan && sEl) {
      if (sEl.value.trim() !== '') {
        bCan.style.opacity = '1';
        bCan.style.pointerEvents = 'auto';
      } else {
        bCan.style.opacity = '0.35';
        bCan.style.pointerEvents = 'none';
      }
    }
  };

  window.rPublishRelease = function () {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    var version = ($r('rel-version') || {}).value || '';
    var url = ($r('rel-url') || {}).value || '';
    var notes = ($r('rel-notes') || {}).value || '';
    var sched = ($r('rel-sched') || {}).value || '';
    var curUrl = ($r('rel-cur-url') || {}).value || '';

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
      id: 1,
      latest_version: version.trim(),
      update_url: url.trim(),
      release_notes: notes.trim() || null,
      released_by: (function () {
        var nick = RS.userNickname || '';
        var isSA = user && user.email && user.email.toLowerCase() === _SUPER_ADMIN_EMAIL;
        var role = isSA ? 'Super Admin' : 'Admin';
        return nick ? (role + ' ' + nick) : (user ? user.email : 'admin');
      })(),
      scheduled_at: sched ? new Date(sched).toISOString() : null,
      updated_at: new Date().toISOString()
    };

    var schedMsg = sched
      ? 'Scheduled for ' + new Date(sched).toLocaleString('ms-MY', { hour12: false })
      : 'Releasing immediately to all machines';



    RS.supa.from('app_settings').upsert(payload, { onConflict: 'id' }).then(function (res) {
      if (res.error) { rToast('Error: ' + res.error.message, 'error'); return; }
      rToast(
        sched
          ? 'Release scheduled for v' + version.trim()
          : 'v' + version.trim() + ' released — all machines will update on next check!',
        'success'
      );
      renderReleaseMgmt();
    }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
  };

  window.rCancelScheduled = function () {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not available', 'error'); return; }
    RS.supa.from('app_settings')
      .update({ scheduled_at: null, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .then(function (res) {
        if (res.error) { rToast('Error: ' + res.error.message, 'error'); return; }
        rToast('Schedule cancelled — release is now live', 'success');
        renderReleaseMgmt();
      }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
  };

  window.smtpTimer = null;
  window.smtpOrigEmail = '';
  window.smtpOrigPass = '';

  window.rEditSmtp = function () {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    var emailEl = $r('smtp-email');
    var passEl = $r('smtp-pass');
    if (!emailEl || !passEl) return;

    emailEl.removeAttribute('readonly');
    passEl.removeAttribute('readonly');
    emailEl.style.pointerEvents = 'auto';
    passEl.style.pointerEvents = 'auto';
    emailEl.removeAttribute('tabindex');
    passEl.removeAttribute('tabindex');
    emailEl.focus();

    window.smtpOrigEmail = emailEl.value;
    window.smtpOrigPass = passEl.value;

    rHandleSmtpInput();
  };

  window.rHandleSmtpInput = function () {
    if (window.smtpTimer) clearTimeout(window.smtpTimer);

    window.smtpTimer = setTimeout(function () {
      var emailEl = $r('smtp-email');
      var passEl = $r('smtp-pass');
      if (!emailEl || !passEl) return;

      var currentEmail = emailEl.value;
      var currentPass = passEl.value;

      emailEl.setAttribute('readonly', 'true');
      passEl.setAttribute('readonly', 'true');
      emailEl.style.pointerEvents = 'none';
      passEl.style.pointerEvents = 'none';
      emailEl.setAttribute('tabindex', '-1');
      passEl.setAttribute('tabindex', '-1');
      emailEl.blur();
      passEl.blur();

      if (currentEmail === window.smtpOrigEmail && currentPass === window.smtpOrigPass) {
        // No changes, auto-cancel
      } else {
        // Changes made, auto-save
        rSaveSmtp();
      }
    }, 5000);
  };

  window.rSaveSmtp = function () {
    if (!_canWrite()) { rToast('Read-only — request write access from Super Admin', 'warn'); return; }
    if (!RS.supa) { rToast('Supabase not available', 'error'); return; }
    var emailEl = $r('smtp-email');
    var passEl = $r('smtp-pass');
    if (!emailEl || !passEl) return;

    var email = emailEl.value || '';
    var pass = passEl.value || '';
    if (!email || !email.includes('@')) {
      rToast('Enter valid Email address', 'warn');
      emailEl.value = window.smtpOrigEmail;
      passEl.value = window.smtpOrigPass;
      return;
    }
    if (!pass || pass.length < 8) {
      rToast('App Password too short', 'warn');
      emailEl.value = window.smtpOrigEmail;
      passEl.value = window.smtpOrigPass;
      return;
    }

    window.smtpOrigEmail = email;
    window.smtpOrigPass = pass;

    RS.supa.from('app_settings').update({
      smtp_email: email.trim(),
      smtp_app_password: pass.trim()
    }).eq('id', 1).then(function (res) {
      if (res.error) { rToast('Error: ' + res.error.message, 'error'); return; }
      rToast('SMTP credentials saved — all machines will use this on next request', 'success');
    }).catch(function (err) { rToast('Error: ' + err.message, 'error'); });
  };

  // ── Compress image to 150x150 JPEG base64 ─────────────────────
  function _compressAvatar(file, cb) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
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
    var nameEl = document.getElementById('r-p-displayname');
    var badge = document.getElementById('r-p-role-badge');
    var isSA = (user.email && user.email.toLowerCase() === _SUPER_ADMIN_EMAIL);
    if (emailEl) emailEl.textContent = user.email || '';
    var roleLabel = isSA ? 'SUPER ADMIN' : (_canWrite() ? 'ADMIN · Write' : 'ADMIN · Read-only');
    if (nameEl) nameEl.textContent = RS.userNickname || (isSA ? 'SUPER ADMIN' : 'ADMIN');
    if (badge) badge.textContent = roleLabel;
    // Load avatar + nickname from Supabase (async)
    if (RS.supa && user.email) {
      RS.supa.from('admin_users').select('profile_img,nickname').eq('email', user.email).single().then(function (res) {
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
      }).catch(function () { });
    }
  }

  // ── 2FA Management ─────────────────────────────────────────────
  window.rLoad2FAStatus = function () {
    var statusEl = document.getElementById('r-2fa-status');
    var btnSetup = document.getElementById('btn-r-setup-2fa');
    var btnRemove = document.getElementById('btn-r-remove-2fa');
    if (!RS.supa) return;
    RS.supa.auth.mfa.listFactors().then(function (res) {
      var factors = res.data || {};
      var verified = (factors.totp || []).filter(function (f) { return f.status === 'verified'; });
      if (verified.length > 0) {
        window._r2faFactorId = verified[0].id;
        if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-shield-check" style="color:#22c55e"></i> <span style="color:#22c55e">Enabled</span> <span style="color:#6b7280;font-size:9px;">(TOTP)</span>';
        if (btnSetup) btnSetup.style.display = 'none';
        if (btnRemove) btnRemove.style.display = 'block';
      } else {
        window._r2faFactorId = null;
        if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-shield-exclamation" style="color:#f59e0b"></i> <span style="color:#f59e0b">Not enabled</span>';
        if (btnSetup) btnSetup.style.display = 'block';
        if (btnRemove) btnRemove.style.display = 'none';
      }
    }).catch(function () {
      if (statusEl) statusEl.textContent = 'Could not load 2FA status.';
    });
  };

  window.rSetup2FA = function () {
    if (!RS.supa) return;
    var btnSetup = document.getElementById('btn-r-setup-2fa');
    var enrollEl = document.getElementById('r-2fa-enroll');
    var qrEl = document.getElementById('r-2fa-qr');
    var secretEl = document.getElementById('r-2fa-secret');
    if (btnSetup) { btnSetup.textContent = 'Setting up…'; btnSetup.disabled = true; }
    RS.supa.auth.mfa.enroll({ factorType: 'totp', issuer: 'Rasumi Admin', friendlyName: 'Authenticator' })
      .then(function (res) {
        if (res.error) { rToast('2FA setup error: ' + res.error.message, 'error'); if (btnSetup) { btnSetup.textContent = 'ENABLE 2FA (TOTP)'; btnSetup.disabled = false; } return; }
        window._r2faEnrollId = res.data.id;
        if (qrEl) qrEl.src = res.data.totp.qr_code;
        if (secretEl) secretEl.textContent = res.data.totp.secret;
        if (enrollEl) enrollEl.style.display = 'block';
        if (btnSetup) btnSetup.style.display = 'none';
        setTimeout(function () { var c = document.getElementById('r-2fa-verify-code'); if (c) c.focus(); }, 150);
      }).catch(function (e) {
        rToast('2FA error: ' + e.message, 'error');
        if (btnSetup) { btnSetup.textContent = 'ENABLE 2FA (TOTP)'; btnSetup.disabled = false; }
      });
  };

  window.rVerify2FA = function () {
    if (!RS.supa || !window._r2faEnrollId) { rToast('Enrollment session expired. Try again.', 'error'); return; }
    var codeEl = document.getElementById('r-2fa-verify-code');
    var code = (codeEl ? codeEl.value : '').replace(/\s/g, '');
    if (!code || code.length !== 6) { rToast('Enter the 6-digit code', 'warn'); return; }
    RS.supa.auth.mfa.challenge({ factorId: window._r2faEnrollId })
      .then(function (res) {
        if (res.error) { rToast('Challenge error: ' + res.error.message, 'error'); return; }
        return RS.supa.auth.mfa.verify({ factorId: window._r2faEnrollId, challengeId: res.data.id, code: code });
      }).then(function (res) {
        if (!res) return;
        if (res.error) { rToast('Invalid code — ' + res.error.message, 'error'); return; }
        rToast('2FA activated! Use your authenticator app on next login.', 'success');
        var enrollEl = document.getElementById('r-2fa-enroll');
        if (enrollEl) enrollEl.style.display = 'none';
        if (codeEl) codeEl.value = '';
        window._r2faEnrollId = null;
        window.rLoad2FAStatus();
      }).catch(function (e) { rToast('Error: ' + e.message, 'error'); });
  };

  window.rCancel2FA = function () {
    if (window._r2faEnrollId && RS.supa) {
      RS.supa.auth.mfa.unenroll({ factorId: window._r2faEnrollId }).catch(function () { });
      window._r2faEnrollId = null;
    }
    var enrollEl = document.getElementById('r-2fa-enroll');
    if (enrollEl) enrollEl.style.display = 'none';
    var btnSetup = document.getElementById('btn-r-setup-2fa');
    if (btnSetup) { btnSetup.textContent = 'ENABLE 2FA (TOTP)'; btnSetup.disabled = false; btnSetup.style.display = 'block'; }
  };

  window.rRemove2FA = function () {
    if (!window._r2faFactorId || !RS.supa) { rToast('No 2FA factor found', 'warn'); return; }
    if (!confirm('Disable 2FA? You will only need your password to log in.')) return;
    RS.supa.auth.mfa.unenroll({ factorId: window._r2faFactorId })
      .then(function (res) {
        if (res.error) { rToast('Error: ' + res.error.message, 'error'); return; }
        rToast('2FA disabled.', 'success');
        window._r2faFactorId = null;
        window.rLoad2FAStatus();
      }).catch(function (e) { rToast('Error: ' + e.message, 'error'); });
  };

  // ── Open profile modal (called from inline onclick) ────────────
  window.rLogout = function () {
    if (RS && RS.supa) {
      RS.supa.auth.signOut().then(function () {
        window.location.reload();
      }).catch(function (err) {
        console.error('Logout error:', err);
        window.location.reload();
      });
    } else {
      window.location.reload();
    }
  };

  window.rOpenProfile = function () {
    var nav = document.getElementById('r-nav-dropdown');
    if (nav) nav.classList.add('hidden');
    var modal = document.getElementById('r-profile-modal');
    if (modal) modal.classList.remove('hidden');
    _populateProfileModal();
    if (typeof window.rLoad2FAStatus === 'function') window.rLoad2FAStatus();
  };

  window.rToggleProfileEdit = function () {
    var panel = document.getElementById('r-p-edit-panel');
    if (!panel) return;
    var open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    if (!open) {
      // Pre-fill current values
      var nickInp = document.getElementById('r-p-nickname');
      var emailInp = document.getElementById('r-p-edit-email');
      if (nickInp) nickInp.value = RS.userNickname || '';
      if (emailInp) emailInp.value = (RS.currentUser && RS.currentUser.email) || '';
      if (nickInp) nickInp.focus();
    }
  };

  window.rSaveProfile = function () {
    if (!RS.supa || !RS.currentUser) return;
    var nickInp = document.getElementById('r-p-nickname');
    var emailInp = document.getElementById('r-p-edit-email');
    var nick = nickInp ? nickInp.value.trim() : '';
    var newEmail = emailInp ? emailInp.value.trim().toLowerCase() : '';
    var curEmail = RS.currentUser.email || '';
    var changed = false;

    // ── 1. Nickname change ────────────────────────────────────────
    if (nick && nick !== RS.userNickname) {
      RS.supa.from('admin_users').update({ nickname: nick }).eq('email', curEmail)
        .then(function (res) {
          if (res.error) { rToast('Nickname error: ' + res.error.message, 'error'); return; }
          RS.userNickname = nick;
          var nameEl = document.getElementById('r-p-displayname');
          if (nameEl) nameEl.textContent = nick;
          rToast('Nickname saved: ' + nick, 'success');
        }).catch(function (e) { rToast('Error: ' + e.message, 'error'); });
      changed = true;
    }

    // ── 2. Email change ───────────────────────────────────────────
    if (newEmail && newEmail !== curEmail) {
      if (!newEmail.includes('@')) { rToast('Invalid email address', 'warn'); return; }
      RS.supa.auth.updateUser({ email: newEmail }).then(function (res) {
        if (res.error) { rToast('Email error: ' + res.error.message, 'error'); return; }
        // Store pending_email in admin_users — auth handler resolves after confirmation
        RS.supa.from('admin_users').update({ pending_email: newEmail }).eq('email', curEmail)
          .then(function () { }).catch(function () { });
        var note = document.getElementById('r-p-email-note');
        if (note) { note.style.display = 'block'; note.textContent = 'Verification sent to ' + newEmail + '. Login email updates after you confirm from that email.'; }
        rToast('Verification sent to ' + newEmail, 'success');
      }).catch(function (e) { rToast('Error: ' + e.message, 'error'); });
      changed = true;
    }

    if (!changed) { rToast('No changes to save', 'warn'); return; }

    // Close panel (after a brief delay so user sees feedback)
    setTimeout(function () {
      var panel = document.getElementById('r-p-edit-panel');
      if (panel) panel.style.display = 'none';
    }, 1800);
  };

  // Keep legacy alias
  window.rSaveNickname = window.rSaveProfile;

  // ── Settings gateway ───────────────────────────────────────────
  window.rOpenSettings = function () {
    if (RS.userRole !== 'superadmin') return;
    var nav = document.getElementById('r-nav-dropdown');
    if (nav) nav.classList.add('hidden');
    var modal = document.getElementById('r-settings-modal');
    if (modal) modal.classList.remove('hidden');
  };

  window.rOpenAdminsFromSettings = function () {
    var sm = document.getElementById('r-settings-modal');
    if (sm) sm.classList.add('hidden');
    var modal = document.getElementById('r-admins-modal');
    if (modal) { modal.classList.remove('hidden'); _loadAdminUsers(); }
  };

  window.rOpenAppUsersFromSettings = function () {
    var sm = document.getElementById('r-settings-modal');
    if (sm) sm.classList.add('hidden');
    var modal = document.getElementById('r-husers-modal');
    if (modal) { modal.classList.remove('hidden'); _loadHospitalUsers(); }
  };

  // ── Open manage admins modal (direct, kept for back-compat) ────
  window.rOpenAdmins = function () {
    var nav = document.getElementById('r-nav-dropdown');
    if (nav) nav.classList.add('hidden');
    var modal = document.getElementById('r-admins-modal');
    if (modal) { modal.classList.remove('hidden'); _loadAdminUsers(); }
  };

  // ── Hospital Users Management ──────────────────────────────────
  var _HOSPITAL_APPS = ['Scanify', 'Renamer HQ', 'FV Branch', 'PDF Splitter', 'PDF Studio', 'Quick Rename', 'Vibes Automation'];

  window.rOpenHospitalUsers = function () {
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
    RS.supa.from('users').select('username,role,status,allowed_apps').order('username').then(function (res) {
      if (res.error) throw new Error(res.error.message);
      if (!res.data || !res.data.length) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--rc-text-dim,#9ca3af);font-size:12px;">No users found</div>';
        return;
      }
      var rows = [];
      res.data.forEach(function (u) {
        var uname = u.username;
        var role = u.role || 'VIEWER';
        var status = u.status || 'ACTIVE';
        var apps = Array.isArray(u.allowed_apps) ? u.allowed_apps : [];
        var isMaster = (uname === 'mustaqim' || role === 'SUPER_ADMIN');
        var isActive = (status === 'ACTIVE');
        var safeId = uname.replace(/[^a-z0-9]/gi, '_');

        var roleColor = role === 'SUPER_ADMIN' ? '#38bdf8' : role === 'ADMIN' ? '#8b5cf6' : role === 'BRANCH_USER' ? '#10b981' : '#9ca3af';

        var row = '<div style="padding:14px 0;border-bottom:1px solid var(--rc-border,#1f2937);">';
        // Username + role badge + status toggle
        row += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">';
        row += '<div style="display:flex;align-items:center;gap:8px;">';
        row += '<span style="font-size:12px;color:var(--rc-text,#fff);font-weight:600;">' + esc(uname) + '</span>';
        row += '<span style="font-size:9px;padding:2px 7px;border-radius:10px;border:1px solid ' + roleColor + ';color:' + roleColor + ';letter-spacing:0.5px;">' + esc(role) + '</span>';
        row += '</div>';
        if (isMaster) {
          row += '<span style="font-size:10px;color:var(--rc-cyan,#38bdf8);padding:3px 8px;border:1px solid rgba(56,189,248,0.3);border-radius:10px;">Owner</span>';
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
        _HOSPITAL_APPS.forEach(function (app) {
          var appId = 'uapp_' + safeId + '_' + app.replace(/[^a-z0-9]/gi, '_');
          var checked = apps.indexOf(app) !== -1;
          if (isMaster) {
            row += '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--rc-text-dim,#9ca3af);opacity:0.55;cursor:not-allowed;">';
            row += '<input type="checkbox"' + (checked ? ' checked' : '') + ' disabled style="cursor:not-allowed;accent-color:var(--rc-cyan,#38bdf8);"> ' + esc(app);
            row += '</label>';
          } else {
            row += '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--rc-text-dim,#d1d5db);cursor:pointer;">';
            row += '<input type="checkbox" id="' + appId + '"' + (checked ? ' checked' : '') + ' style="cursor:pointer;accent-color:var(--rc-cyan,#38bdf8);"> ' + esc(app);
            row += '</label>';
          }
        });
        row += '</div>';
        if (!isMaster) {
          row += '<button onclick="rSaveUserApps(\'' + uname.replace(/'/g, "\\'") + '\')" ';
          row += 'style="padding:4px 14px;background:var(--rc-cyan,#38bdf8);color:#000;font-weight:700;border:none;border-radius:4px;font-size:10px;cursor:pointer;font-family:inherit;letter-spacing:0.5px;">SAVE APPS</button>';
        }
        row += '</div>';
        rows.push(row);
      });
      list.innerHTML = rows.join('');
    }).catch(function (e) {
      if (list) list.innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;font-size:12px;">Error: ' + esc(e.message || String(e)) + '</div>';
    });
  }

  window.rAddHospitalUser = function () {
    if (RS.userRole !== 'superadmin') return;
    if (!RS.supa) { rToast('Supabase not available', 'error'); return; }
    var unameInp = document.getElementById('r-huser-new-username');
    var roleInp = document.getElementById('r-huser-new-role');
    var username = unameInp ? unameInp.value.trim().toLowerCase() : '';
    var role = roleInp ? roleInp.value : 'BRANCH_USER';
    if (!username) { rToast('Username is required', 'error'); return; }
    if (!/^[a-z0-9_]+$/.test(username)) { rToast('Username: huruf kecil, angka, underscore sahaja', 'error'); return; }
    // Insert new user — password defaults to username (plain text, same as legacy seed pattern)
    RS.supa.from('users').insert({
      username: username,
      role: role,
      status: 'ACTIVE',
      allowed_apps: [],
      failed_login_count: 0,
      created_at_utc: new Date().toISOString()
    }).then(function (res) {
      if (res.error) {
        if (res.error.code === '23505') { rToast('Username sudah wujud: ' + username, 'error'); }
        else { throw new Error(res.error.message); }
        return;
      }
      rToast('User added: ' + username + ' (' + role + ')', 'success');
      if (unameInp) unameInp.value = '';
      _loadHospitalUsers();
    }).catch(function (e) { rToast('Error: ' + (e.message || String(e)), 'error'); });
  };

  window.rToggleHospitalUserStatus = function (username, newStatus) {
    if (RS.userRole !== 'superadmin') return;
    if (!RS.supa) { rToast('Supabase not available', 'error'); return; }
    RS.supa.from('users').update({ status: newStatus }).eq('username', username).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      rToast(username + ' → ' + newStatus, newStatus === 'ACTIVE' ? 'success' : 'info');
      _loadHospitalUsers();
    }).catch(function (e) { rToast('Error: ' + (e.message || String(e)), 'error'); });
  };

  window.rSaveUserApps = function (username) {
    if (RS.userRole !== 'superadmin') return;
    if (!RS.supa) { rToast('Supabase not available', 'error'); return; }
    var safeId = username.replace(/[^a-z0-9]/gi, '_');
    var apps = [];
    _HOSPITAL_APPS.forEach(function (app) {
      var appId = 'uapp_' + safeId + '_' + app.replace(/[^a-z0-9]/gi, '_');
      var cb = document.getElementById(appId);
      if (cb && cb.checked) apps.push(app);
    });
    RS.supa.from('users').update({ allowed_apps: apps }).eq('username', username).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      rToast(username + ' — ' + apps.length + '/' + _HOSPITAL_APPS.length + ' apps saved', 'success');
    }).catch(function (e) { rToast('Error: ' + (e.message || String(e)), 'error'); });
  };

  // ── Profile Modal Handlers ────────────────────────────────────
  window.initProfileHandlers = function () {
    // Close buttons
    var btnClose = document.getElementById('btn-close-r-profile');
    var modal = document.getElementById('r-profile-modal');
    if (btnClose && modal) btnClose.addEventListener('click', function () { modal.classList.add('hidden'); });

    var btnCloseSettings = document.getElementById('btn-close-settings');
    var settingsModal = document.getElementById('r-settings-modal');
    if (btnCloseSettings && settingsModal) btnCloseSettings.addEventListener('click', function () { settingsModal.classList.add('hidden'); });

    var btnCloseAdmins = document.getElementById('btn-close-admins');
    var adminsModal = document.getElementById('r-admins-modal');
    if (btnCloseAdmins && adminsModal) btnCloseAdmins.addEventListener('click', function () { adminsModal.classList.add('hidden'); });

    var btnCloseHusers = document.getElementById('btn-close-husers');
    var husersModal = document.getElementById('r-husers-modal');
    if (btnCloseHusers && husersModal) btnCloseHusers.addEventListener('click', function () { husersModal.classList.add('hidden'); });

    // Avatar: immediate upload on file select → compress → save to Supabase
    var imgDisplay = document.getElementById('r-profile-img-display');
    var imgUpload = document.getElementById('r-profile-upload');
    var spinner = document.getElementById('r-avatar-spinner');

    if (imgDisplay && imgUpload) {
      imgDisplay.addEventListener('click', function () { imgUpload.click(); });
      imgUpload.addEventListener('change', function (e) {
        if (!e.target.files || !e.target.files[0]) return;
        var file = e.target.files[0];
        var user = RS.currentUser;
        if (!user || !user.email) { rToast('Not authenticated', 'error'); return; }
        if (!RS.supa) { rToast('Supabase not available', 'error'); return; }
        if (spinner) spinner.style.display = 'flex';
        _compressAvatar(file, function (dataUrl) {
          imgDisplay.src = dataUrl;
          RS.supa.from('admin_users').update({ profile_img: dataUrl }).eq('email', user.email).then(function (res) {
            if (spinner) spinner.style.display = 'none';
            if (res.error) { rToast('Upload failed', 'error'); return; }
            var hImg = document.querySelector('#r-profile-trigger img');
            if (hImg) hImg.src = dataUrl;
            rToast('Photo updated', 'success');
          }).catch(function (err) { if (spinner) spinner.style.display = 'none'; rToast('Error: ' + err.message, 'error'); });
        });
      });
    }

    // Password change — verify current via signIn → updateUser (Supabase Auth)
    var btnPwd = document.getElementById('btn-update-r-profile');
    if (btnPwd) {
      btnPwd.addEventListener('click', function () {
        var currPass = (document.getElementById('r-p-curr-pass') || {}).value || '';
        var np = (document.getElementById('r-p-new-pass') || {}).value || '';
        var cp = (document.getElementById('r-p-confirm-pass') || {}).value || '';
        var statusEl = document.getElementById('r-p-pass-status');
        function setStatus(msg, col) { if (statusEl) { statusEl.textContent = msg; statusEl.style.color = col || '#9ca3af'; } }
        setStatus('');
        if (!currPass) { rToast('Enter current password', 'warn'); return; }
        if (!np || np.length < 6) { rToast('New password must be at least 6 characters', 'warn'); return; }
        if (np !== cp) { rToast('Passwords do not match', 'warn'); return; }
        var user = RS.currentUser;
        if (!user || !user.email) { rToast('Not authenticated', 'error'); return; }
        setStatus('Verifying…', '#9ca3af');
        btnPwd.disabled = true;
        // Step 1: Verify current password
        RS.supa.auth.signInWithPassword({ email: user.email, password: currPass })
          .then(function (r) {
            if (r.error) { var e = new Error(r.error.message); e.isWrongPass = true; throw e; }
            setStatus('Updating password…', '#9ca3af');
            // Step 2: Update Supabase Auth password
            return RS.supa.auth.updateUser({ password: np });
          })
          .then(function (r) {
            if (r.error) throw new Error(r.error.message);
            // Step 3: Sync to admin_users record
            RS.supa.from('admin_users').update({ password: np }).eq('email', user.email)
              .then(function (res) {
                if (res.error) { rToast('Password ✓ — record sync failed: ' + res.error.message, 'warn'); }
                else { rToast('Password updated & saved', 'success'); }
              })
              .catch(function () { rToast('Password ✓ — record sync failed', 'warn'); });
            setStatus('');
            btnPwd.disabled = false;
            document.getElementById('r-p-curr-pass').value = '';
            document.getElementById('r-p-new-pass').value = '';
            document.getElementById('r-p-confirm-pass').value = '';
          })
          .catch(function (err) {
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
