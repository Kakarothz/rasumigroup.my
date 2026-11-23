/* Rasumi Apps · private invitation page (invite.rasumigroup.my)
   - token arrives in the URL fragment (#i=…), is moved to this browser's storage and removed from the address bar
   - first "Open my invitation" binds the link to this browser (random device key, kept in localStorage)
   - everything is checked server side by the invite-download edge function */
(function () {
  'use strict';
  var FN = 'https://seqlkwdghibmsfkbuwqq.supabase.co/functions/v1/invite-download';
  var KT = 'rasumi_inv_t', KD = 'rasumi_inv_d';
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  // 1) token: fragment -> storage, then clean the address bar (copying the URL no longer carries the token)
  var m = /(?:^#|&)i=([A-Za-z0-9_-]{30,120})/.exec(location.hash || '');
  if (m) { store.set(KT, m[1]); history.replaceState(null, '', location.pathname + location.search); }
  var token = store.get(KT);

  // 2) device key for this browser
  var dev = store.get(KD);
  if (!dev || dev.length < 32) {
    var b = new Uint8Array(32); (window.crypto || window.msCrypto).getRandomValues(b);
    dev = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    store.set(KD, dev);
  }
  $('yr').textContent = new Date().getFullYear();

  function show(id) { ['v-load', 'v-err', 'v-open'].forEach(function (v) { $(v).hidden = v !== id; }); }
  var REASON = {
    invalid: ['This link is not available', 'The link is not valid. Open the button in your invitation e-mail again.'],
    expired: ['This invitation has expired', 'Ask IT to send you a new invitation.'],
    used: ['You have already signed up', 'Open Rasumi Apps on your PC and sign in with your e-mail.'],
    revoked: ['This link is no longer valid', 'A newer invitation may have been sent. Check your e-mail or ask IT.'],
    other_device: ['This invitation is open on another computer', 'For your security it works on the PC where it was first downloaded. If you changed PC, ask IT to reset your invitation.'],
    server: ['Something went wrong', 'Please try again in a moment.']
  };
  function fail(r) {
    var t = REASON[r] || REASON.invalid; $('err-h').textContent = t[0]; $('err-p').textContent = t[1];
    var is404 = !REASON[r] || r === 'invalid';
    document.body.classList.toggle('is404', is404);
    show('v-err');
    if (is404) decode($('e404'), '404');
  }
  // "404" scrambles for a moment, then settles (terminal style)
  function decode(el, txt) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = txt; return; }
    var G = '!<>-_/[]{}=+*^?#01ABCDEF', f = 0, N = 16;
    var it = setInterval(function () {
      f++;
      el.textContent = txt.split('').map(function (c, i) { return i / txt.length < f / N ? c : G[Math.random() * G.length | 0]; }).join('');
      if (f >= N) { clearInterval(it); el.textContent = txt; }
    }, 40);
  }

  function call(body) {
    body.token = token; body.device = dev;
    return fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), referrerPolicy: 'no-referrer', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, reason: 'server' }; });
  }

  var isWindows = /Windows NT/i.test(navigator.userAgent) && !/Windows Phone/i.test(navigator.userAgent);
  var ROLE = { VIEWER: 'Staff', OPERATOR: 'Operator', BRANCH_USER: 'Branch user', DEPT_ADMIN: 'Department admin', BOD: 'Board', ADMIN: 'Admin', SUPER_ADMIN: 'Super admin', PHARMACIST: 'Pharmacist' };
  var APP = {
    'PO Mailer': ['po_mailer', 'PO Mailer'], 'PO Auto Email': ['po_mailer', 'PO Mailer'], 'Store Management': ['store_portal', 'Store Management'],
    'Renamer HQ': ['renamer', 'PDF Renamer'], 'FV Branch': ['renamer', 'PDF Renamer'], 'PDF Splitter': ['splitter', 'PDF Splitter'], 'Scanify': ['scanify', 'Scanify']
  };
  function fmtSize(n) { return n ? (n / 1048576).toFixed(0) + ' MB' : ''; }
  function fmtDate(s) { try { return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } }

  var info = null;
  function render(r) {
    info = r;
    window.RA_INFO = { first_name: r.first_name, email: r.email, expires_at: r.expires_at, downloads_left: r.downloads_left,
      version: r.installer && r.installer.version, size: r.installer && r.installer.size, honorific: r.honorific || null };   // Rasumi Agent chat (chat.js)
    try { document.dispatchEvent(new CustomEvent('ra:info')); } catch (e) { }
    var first = r.first_name || 'there';
    $('o-name').textContent = first;
    $('who-mail').textContent = 'Invitation for ' + r.email; $('who-pill').hidden = false; $('who-help').hidden = false;
    Array.prototype.forEach.call(document.querySelectorAll('.o-mail'), function (e) { e.textContent = r.email; });
    $('st3-mail').textContent = 'Use ' + r.email;
    var f = r.installer || {};
    var ver = f.version ? 'Version ' + f.version : '';
    $('ver-eyebrow').textContent = ver ? ver + ' · Windows' : 'Windows';
    $('o-meta').innerHTML = (f.name ? '<b>' + esc(f.name) + '</b> · ' : '') + (fmtSize(f.size) ? fmtSize(f.size) + ' · ' : '') + 'Windows 10 / 11, 64-bit · link valid until <b>' + esc(fmtDate(r.expires_at)) + '</b>';
    $('o-until').textContent = 'Your invitation works until ' + fmtDate(r.expires_at) + ', on this PC only, for ' + r.email + '.';
    $('o-dl').innerHTML = (ver ? '<div><dt>Version</dt><dd>' + esc(f.version) + '</dd></div>' : '') + '<div><dt>System</dt><dd>Windows 10 / 11, 64-bit</dd></div>' +
      (f.size ? '<div><dt>Size</dt><dd>' + fmtSize(f.size) + '</dd></div>' : '') + '<div><dt>Downloads left</dt><dd id="o-left">' + r.downloads_left + '</dd></div>';
    if (!r.installer) { $('dl-err').textContent = 'The installer is being prepared. Please try again later.'; $('dl-err').hidden = false; }
    if (!isWindows) {                                   // phone / tablet: read only, nothing gets locked
      Array.prototype.forEach.call(document.querySelectorAll('.dl-btn'), function (x) { x.hidden = true; });
      $('phone-note').hidden = false;
    }
    show('v-open');
    tour(0);
  }

  // download
  Array.prototype.forEach.call(document.querySelectorAll('.dl-btn'), function (b) {
    b.addEventListener('click', function () {
      var btns = document.querySelectorAll('.dl-btn'); Array.prototype.forEach.call(btns, function (x) { x.disabled = true; });
      $('dl-err').hidden = true;
      call({ action: 'download' }).then(function (r) {
        Array.prototype.forEach.call(btns, function (x) { x.disabled = false; });
        if (r && r.ok && r.url) {
          window.location.href = r.url;                  // signed URL, valid 10 minutes, forces download
          $('dl-file').textContent = (r.name || '') + (r.size ? ' · ' + fmtSize(r.size) : '');
          $('dl-left').textContent = r.downloads_left + ' download' + (r.downloads_left === 1 ? '' : 's') + ' left on this invitation';
          if ($('o-left')) $('o-left').textContent = r.downloads_left;
          if (window.RA_INFO) window.RA_INFO.downloads_left = r.downloads_left;
          gdShow(0);
          $('dl').classList.add('on');
          var a = $('st2'), c = $('st3'); a.classList.remove('now'); a.classList.add('done'); a.querySelector('.d').textContent = '✓'; a.querySelector('.ob-s').textContent = 'Done'; c.classList.add('now'); c.querySelector('.ob-s').textContent = 'Now'; document.querySelector('.onb').classList.add('p2');
        } else if (r && r.reason === 'download_limit') {
          $('dl-err').textContent = 'This invitation has reached its download limit. Ask IT to reset it.'; $('dl-err').hidden = false;
        } else if (r && r.reason === 'not_windows') {
          $('dl-err').textContent = 'Rasumi Apps is for Windows PCs. Open this invitation e-mail on your PC to download.'; $('dl-err').hidden = false;
        } else if (r && r.reason === 'no_installer') {
          $('dl-err').textContent = 'The installer is being prepared. Please try again later.'; $('dl-err').hidden = false;
        } else if (r && ['invalid', 'expired', 'used', 'revoked', 'other_device'].indexOf(r.reason) >= 0) {
          fail(r.reason);
        } else {
          $('dl-err').textContent = 'The download could not start. Please try again.'; $('dl-err').hidden = false;
        }
      });
    });
  });
  $('dl-done').addEventListener('click', function () { $('dl').classList.remove('on'); });

  // setup guide in the download modal: real screenshots, one instruction per step
  var GD = [
    ['g1', 'Open the installer', 'When the download finishes, open <b>Rasumi_Apps_Setup</b> from your browser\'s download list (or your <b>Downloads</b> folder).'],
    ['g2', 'Allow it to run', 'Windows asks if you want to run the software: click <b>Run</b>. If you see <b>Windows protected your PC</b> instead, click <b>More info</b>, then <b>Run anyway</b>.'],
    ['g3', 'Desktop shortcut', 'Keep <b>Create a desktop shortcut</b> ticked and click <b>Next</b>.'],
    ['g4', 'Install', 'Click <b>Install</b> and wait about a minute while the files are copied.'],
    ['g6', 'Finish', 'Leave <b>Launch Rasumi Apps</b> ticked and click <b>Finish</b>. Rasumi Apps opens by itself.'],
    [null, 'Sign up', '']
  ], gdI = 0;
  function gdShow(n) {
    gdI = Math.max(0, Math.min(GD.length - 1, n));
    var g = GD[gdI], img = $('gd-img'), last = gdI === GD.length - 1;
    if (g[0]) { img.src = 'assets/guide/' + g[0] + '.webp'; img.parentNode.classList.remove('gd-app'); }
    else { img.src = 'assets/agent.webp?v=1'; img.parentNode.classList.add('gd-app'); }
    $('gd-stp').textContent = 'Step ' + (gdI + 1) + ' of ' + GD.length + ' · ' + g[1];
    $('gd-ins').innerHTML = last ? 'In Rasumi Apps press <b>Sign up</b> with <b>' + esc((info && info.email) || 'your invited e-mail') +
      '</b>, confirm the e-mail we send you, then set up <b>two-step verification</b> with an authenticator app. Questions? Ask Rasumi Agent at the bottom right.' : g[2];
    $('gd-dots').innerHTML = GD.map(function (_, k) { return '<i class="' + (k === gdI ? 'on' : '') + '"></i>'; }).join('');
    $('gd-back').disabled = gdI === 0;
    $('gd-next').textContent = last ? 'Done' : 'Next';
  }
  $('gd-back').addEventListener('click', function () { gdShow(gdI - 1); });
  $('gd-next').addEventListener('click', function () { if (gdI === GD.length - 1) $('dl').classList.remove('on'); else gdShow(gdI + 1); });
  GD.forEach(function (g) { if (g[0]) { var im = new Image(); im.src = 'assets/guide/' + g[0] + '.webp'; } });   // preload
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('dl').classList.remove('on'); });

  // product tour
  var S = 'assets/shots/', I = 'assets/icons/';
  var T = [
    { n: 'Dashboard', ic: 'renamer', h: 'Your day at a glance', p: 'Jobs, alerts and activity the moment you sign in.', b: ['Today’s totals for every app', 'Notification bell for deliveries, requests and POs', 'Quick Rename and PDF Studio one click away'], s: [['Dashboard', 'dashboard']] },
    { n: 'PDF Renamer', ic: 'renamer', h: 'Files named the way your team files them', p: 'Reads each invoice and DO and renames it for you, with live progress.', b: ['HQ and FV branch formats', 'See the file being read and the time left', 'Results listed as they finish'], s: [['HQ', 'renamer_hq'], ['FV branch', 'renamer_fv']] },
    { n: 'PDF Splitter', ic: 'splitter', h: 'One scan in, separate documents out', p: 'Splits scanned batches by document type so each one is filed correctly.', b: ['INV, DO, IC, BQBP and more detected', 'Pages of one document kept together', 'Watch each cut as it happens'], s: [['PDF Splitter', 'splitter']] },
    { n: 'Scanify', ic: 'scanify', h: 'Phone photo to clean PDF', p: 'Straighten, crop and clean photos of forms and ID cards before saving.', b: ['Drag the corners, rotate or auto align', 'ID card front and back placed on one page', 'Check every page before the PDF is saved'], s: [['Adjust crop', 'scanify_crop'], ['ID card', 'scanify_assembler']] },
    { n: 'Store Management', ic: 'store_portal', h: 'Branch stock at a glance', p: 'Stock in, stock out, transfers and movers for every branch.', b: ['Out-of-stock items flagged', 'Transfer summary by branch', 'Fast and slow movers'], s: [['Store Management', 'store_mngmnt']] },
    { n: 'PO Mailer', ic: 'po_mailer', who: 'Purchaser', h: 'From stock alert to purchase order', p: 'Stock alerts become AutoCount POs, signed and sent from one screen.', b: ['Suggested quantity and supplier for each item', 'PO created in AutoCount in one click', 'Delivery status and invoices tracked'], s: [['Stock Alert', 'po_mailer']] },
    { n: 'Store Portal', ic: 'store_portal', who: 'Pharmacist', portal: 1, h: 'Special requests go straight to the purchaser', p: 'Pick the item, set the quantity and submit. The purchaser gets it at once and turns it into a PO carrying your signature and stamp. No forms, no WhatsApp.', b: ['Search any item, or add a new one', 'UOM, price and branch balance before you submit', 'Follow every request under My requests', 'Supplier invoices ready for every delivered order'], s: [['Special Request', 'portal_special_request'], ['Delivery invoices', 'portal_delivery']] },
    { n: 'Settings', ic: 'settings', h: 'Your account, your way', p: 'Sign-in methods, two-step verification, theme and signed-in devices.', b: ['Google or Microsoft sign-in', 'Light, dark or auto theme', 'Sign out other devices'], s: [['My Profile', 'settings_profile']] }
  ];
  var tick = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m5 12 4.5 4.5L19 7"/></svg>';
  $('seg').innerHTML = T.map(function (t, i) { return '<button role="tab" data-i="' + i + '"><img src="' + I + t.ic + '.webp" alt="">' + esc(t.n) + '</button>'; }).join('');
  $('seg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) tour(+b.dataset.i); });
  $('tx').addEventListener('click', function (e) { var b = e.target.closest('.sub button'); if (b) tour(+b.dataset.i, +b.dataset.s); });
  function tour(i, si) {
    si = si || 0; var t = T[i];
    Array.prototype.forEach.call(document.querySelectorAll('#seg button'), function (b, j) { b.classList.toggle('on', j === i); b.setAttribute('aria-selected', j === i); });
    var sub = t.s.length > 1 ? '<div class="sub">' + t.s.map(function (x, j) { return '<button class="' + (j === si ? 'on' : '') + '" data-i="' + i + '" data-s="' + j + '">' + esc(x[0]) + '</button>'; }).join('') + '</div>' : '';
    $('tx').innerHTML = '<h3>' + esc(t.h) + '</h3>' + (t.who ? '<span class="who2">' + esc(t.who) + '</span>' : '') + '<p>' + esc(t.p) + '</p><ul class="ticks">' +
      t.b.map(function (x) { return '<li>' + tick + '<span>' + esc(x) + '</span></li>'; }).join('') + '</ul>' + sub;
    var im = $('timg'); im.style.opacity = 0;
    setTimeout(function () { im.src = S + t.s[si][1] + '.webp'; im.alt = t.n; im.style.opacity = 1; }, 120);
    $('tbar').innerHTML = (t.portal ? 'Store Portal' : 'Rasumi Apps') + ' · <b>' + esc(t.s[si][0]) + '</b>';
  }

  // start
  if (!token) { fail('invalid'); return; }
  call({ action: 'info', bind: false }).then(function (r) {
    if (!r || !r.ok) return fail(r && r.reason);
    render(r);
  });
})();
