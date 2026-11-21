/* Rasumi Apps · invitation page · "20 AI agents" band
   Real world globe (orthographic, no libraries) drawn behind a grid of agent tiles.
   Land outlines come from assets/globe-land.js (window.RASUMI_LAND, lon/lat x10). */
(function () {
  'use strict';
  var cv = document.getElementById('ai-globe'), grid = document.getElementById('ai-grid');
  if (!cv || !grid) return;
  var ctx = cv.getContext('2d');
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- tiles
  var TASK = ['Reading invoices', 'Matching POs', 'Renaming files', 'Checking stock', 'Drafting POs', 'Syncing branches',
    'Filing documents', 'Tracking deliveries', 'Splitting PDFs', 'Checking expiry', 'Sending reminders', 'Verifying GRN'];
  var tiles = [];
  for (var i = 0; i < 20; i++) {
    var d = document.createElement('div'); d.className = 'ai-t';
    var n = document.createElement('span'); n.textContent = 'AGENT-' + (i < 9 ? '0' : '') + (i + 1);
    var b = document.createElement('b'); b.textContent = TASK[i % TASK.length];
    d.appendChild(n); d.appendChild(b); grid.appendChild(d); tiles.push(d);
  }

  // ---- geometry
  var RAD = Math.PI / 180;
  var LAND = (window.RASUMI_LAND || []).map(function (r) {
    var o = []; for (var k = 0; k < r.length; k += 2) o.push([r[k] / 10, r[k + 1] / 10]); return o;
  });
  var POLAR = LAND.map(function (r) { var mx = -90; for (var k = 0; k < r.length; k++) if (r[k][1] > mx) mx = r[k][1]; return mx < -55; });
  // Rasumi sites (lon, lat)
  var SITES = [[101.69, 3.14], [101.52, 3.07], [102.25, 2.19], [100.63, 4.23], [102.61, 2.58], [116.07, 5.98], [101.71, 2.93]];
  var W = 0, H = 0, R = 0, cx = 0, cy = 0, dpr = 1, lon0 = 60, lat0 = -6, sinP = 0, cosP = 1;

  function size() {
    var r = cv.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.width = Math.round(r.width * dpr); H = cv.height = Math.round(r.height * dpr);
    R = Math.min(W, H) * 0.46; cx = W / 2; cy = H / 2;
    if (reduce) draw(0);
  }
  // returns [x, y, visible]
  function proj(lon, lat) {
    var l = (lon - lon0) * RAD, p = lat * RAD, cp = Math.cos(p), sp = Math.sin(p), cl = Math.cos(l);
    var x = cp * Math.sin(l), y = cosP * sp - sinP * cp * cl, c = sinP * sp + cosP * cp * cl;
    if (c < 0) { var m = Math.sqrt(x * x + y * y) || 1; x /= m; y /= m; }      // clamp hidden points to the rim
    return [cx + x * R, cy - y * R, c >= 0];
  }
  function line(pts) {               // draws only the visible runs
    var on = false;
    for (var k = 0; k < pts.length; k++) {
      var q = proj(pts[k][0], pts[k][1]);
      if (!q[2]) { on = false; continue; }
      if (on) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); on = true; }
    }
  }
  var GRAT = [];
  (function () {
    var a, b, s;
    for (a = -180; a < 180; a += 15) { s = []; for (b = -90; b <= 90; b += 3) s.push([a, b]); GRAT.push(s); }
    for (b = -75; b <= 75; b += 15) { s = []; for (a = -180; a <= 180; a += 3) s.push([a, b]); GRAT.push(s); }
  })();
  function vec(p) { var l = p[0] * RAD, t = p[1] * RAD; return [Math.cos(t) * Math.cos(l), Math.cos(t) * Math.sin(l), Math.sin(t)]; }
  function slerp(a, b, t) {            // great-circle point between two lon/lat
    var A = vec(a), B = vec(b), d = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
    if (d < 1e-6) return a;
    var s = Math.sin(d), u = Math.sin((1 - t) * d) / s, v = Math.sin(t * d) / s;
    var x = u * A[0] + v * B[0], y = u * A[1] + v * B[1], z = u * A[2] + v * B[2];
    return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD];
  }

  // ---- arcs (data packets between sites)
  var arcs = [];
  function newArc() {
    var a = Math.random() * SITES.length | 0, b = Math.random() * SITES.length | 0;
    if (a === b) b = (a + 3) % SITES.length;
    var pts = []; for (var k = 0; k <= 24; k++) pts.push(slerp(SITES[a], SITES[b], k / 24));
    arcs.push({ pts: pts, t: 0, sp: 0.007 + Math.random() * 0.006, ag: Math.random() * 20 | 0 });
  }
  for (var j = 0; j < 4; j++) newArc();
  function lightTile(i) {
    var t = tiles[i]; t.classList.add('on'); t.lastChild.textContent = TASK[Math.random() * TASK.length | 0];
    setTimeout(function () { t.classList.remove('on'); }, 1500);
  }

  // ---- frame
  var TARGET = 108;                    // between the Peninsula and Borneo
  function draw(now) {
    if (reduce) lon0 = TARGET; else lon0 += (TARGET + Math.sin(now / 4000) * 4 - lon0) * 0.02;
    sinP = Math.sin(lat0 * RAD); cosP = Math.cos(lat0 * RAD);
    ctx.clearRect(0, 0, W, H);
    // halo
    var g = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.18);
    g.addColorStop(0, 'rgba(139,61,255,.32)'); g.addColorStop(1, 'rgba(139,61,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.18, 0, 7); ctx.fill();
    // sphere
    var s = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
    s.addColorStop(0, '#1d1033'); s.addColorStop(1, '#07040d');
    ctx.fillStyle = s; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
    ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = 'rgba(201,140,255,.45)'; ctx.stroke();
    // graticule
    ctx.beginPath(); for (var k = 0; k < GRAT.length; k++) line(GRAT[k]);
    ctx.lineWidth = 0.7 * dpr; ctx.strokeStyle = 'rgba(201,140,255,.11)'; ctx.stroke();
    // land
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
    var lg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    lg.addColorStop(0, 'rgba(201,140,255,.55)'); lg.addColorStop(1, 'rgba(255,92,182,.42)');
    ctx.fillStyle = lg;
    for (k = 0; k < LAND.length; k++) {          // one fill per ring; hidden rings and Antarctica skipped
      var r = LAND[k], any = false, m, pts = [];
      if (POLAR[k]) continue;
      for (m = 0; m < r.length; m++) { var q = proj(r[m][0], r[m][1]); if (q[2]) any = true; pts.push(q); }
      if (!any) continue;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (m = 1; m < pts.length; m++) ctx.lineTo(pts[m][0], pts[m][1]);
      ctx.closePath(); ctx.fill();
    }
    ctx.beginPath(); for (k = 0; k < LAND.length; k++) line(LAND[k]);
    ctx.lineWidth = 0.8 * dpr; ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.stroke();
    ctx.restore();
    // arcs + packets
    for (k = arcs.length - 1; k >= 0; k--) {
      var a = arcs[k]; if (!reduce) a.t += a.sp;
      ctx.beginPath(); line(a.pts); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = 'rgba(255,92,182,.65)'; ctx.stroke();
      var p = a.pts[Math.min(24, Math.round(a.t * 24))], pp = proj(p[0], p[1]);
      if (pp[2]) { ctx.fillStyle = '#fff'; ctx.shadowColor = '#ff5cb6'; ctx.shadowBlur = 16 * dpr; ctx.beginPath(); ctx.arc(pp[0], pp[1], 3.5 * dpr, 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
      if (a.t >= 1) { lightTile(a.ag); arcs.splice(k, 1); newArc(); }
    }
    // sites
    for (k = 0; k < SITES.length; k++) {
      var c = proj(SITES[k][0], SITES[k][1]); if (!c[2]) continue;
      ctx.fillStyle = k % 2 ? '#c98cff' : '#34d399'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 14 * dpr;
      ctx.beginPath(); ctx.arc(c[0], c[1], 3.5 * dpr, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      if (!reduce) { var ph = (now / 900 + k * 0.3) % 1; ctx.strokeStyle = 'rgba(255,255,255,' + (1 - ph) * 0.8 + ')'; ctx.lineWidth = 1.2 * dpr; ctx.beginPath(); ctx.arc(c[0], c[1], (3.5 + ph * 14) * dpr, 0, 7); ctx.stroke(); }
    }
  }

  // ---- run only while visible
  var run = false, raf = 0, seen = false;
  function loop(t) { draw(t); raf = run ? requestAnimationFrame(loop) : 0; }
  function setRun(v) { if (reduce) return; v = v && !document.hidden; if (v && !run) { run = true; raf = requestAnimationFrame(loop); } else if (!v) { run = false; cancelAnimationFrame(raf); } }
  size(); if (reduce) lon0 = TARGET;
  window.addEventListener('resize', size);
  // the band sits inside the invitation view, which is hidden until the link is checked: a canvas measured while
  // hidden is 0 x 0, so measure again whenever its box changes (shown, rotated, resized)
  if ('ResizeObserver' in window) new ResizeObserver(function () { size(); if (reduce) draw(0); }).observe(cv);
  if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { seen = e[0].isIntersecting; if (seen && !W) size(); setRun(seen); }).observe(cv);
  else { seen = true; setRun(true); }
  document.addEventListener('visibilitychange', function () { setRun(seen); });
  if (reduce) draw(0);
})();
