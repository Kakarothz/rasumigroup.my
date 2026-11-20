/* Rasumi Apps invite page · background: automation node field
   Three depth layers of workflow nodes (Scan, OCR, Rename, AutoCount PO …) with data packets flowing along
   the links. Layers move with the cursor at different speeds (parallax); nodes near the cursor light up.
   Pauses when the tab is hidden, holds still with "reduce motion", no libraries (CSP-safe). */
(function () {
  'use strict';
  var cv = document.getElementById('bg'); if (!cv || !cv.getContext) return;
  var g = cv.getContext('2d'), W = 0, H = 0, DPR = Math.min(2, window.devicePixelRatio || 1);
  var mx = 0, my = 0, tx = 0, ty = 0, px = -999, py = -999, t = 0, last = 0;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var LBL = ['Scan', 'OCR', 'Rename', 'Split', 'Crop', 'Verify', 'AutoCount PO', 'Sign', 'E-mail', 'Portal sync', 'Invoice', 'Bin card', 'Transfer', 'Alert', 'Upload', 'Reconcile', 'DocuShare', 'Notify'];
  var NL = [];

  function size() { W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; g.setTransform(DPR, 0, 0, DPR, 0, 0); build(); }
  function build() {
    NL = [];
    var area = W * H / (1440 * 900);
    [0.35, 0.65, 1].forEach(function (d, li) {
      var n = Math.max(8, Math.round((li === 2 ? 14 : li === 1 ? 20 : 26) * Math.min(1.4, Math.max(.5, area))));
      var L = [];
      for (var i = 0; i < n; i++) L.push({ x: Math.random() * W * 1.2 - W * .1, y: Math.random() * H * 1.1 - H * .05, l: LBL[(i + li * 5) % LBL.length], ph: Math.random() * 6 });
      var E = [];
      L.forEach(function (a, i) {
        L.map(function (b, j) { return [j, Math.hypot(a.x - b.x, a.y - b.y)]; })
          .filter(function (x) { return x[0] !== i; }).sort(function (p, q) { return p[1] - q[1]; }).slice(0, 2)
          .forEach(function (b) { if (!E.some(function (e) { return (e[0] === i && e[1] === b[0]) || (e[0] === b[0] && e[1] === i); })) E.push([i, b[0], Math.random(), .08 + Math.random() * .12]); });
      });
      NL.push({ L: L, E: E, d: d });
    });
  }
  function rr(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  function draw() {
    g.clearRect(0, 0, W, H);
    NL.forEach(function (layer) {
      var d = layer.d, ox = -mx * 60 * d, oy = -my * 40 * d;
      var P = function (n) { return [n.x + ox + Math.sin(t * .4 + n.ph) * 6 * d, n.y + oy + Math.cos(t * .35 + n.ph) * 5 * d]; };
      layer.E.forEach(function (e) {
        var a = P(layer.L[e[0]]), b = P(layer.L[e[1]]);
        var near = d === 1 && Math.min(Math.hypot(a[0] - px, a[1] - py), Math.hypot(b[0] - px, b[1] - py)) < 180;
        g.strokeStyle = near ? 'rgba(255,92,182,.55)' : 'rgba(164,107,255,' + (0.07 + d * .11) + ')'; g.lineWidth = near ? 1.6 : 1;
        var m = (a[0] + b[0]) / 2;
        g.beginPath(); g.moveTo(a[0], a[1]); g.bezierCurveTo(m, a[1], m, b[1], b[0], b[1]); g.stroke();
        if (!reduce) e[2] = (e[2] + e[3] * 0.016) % 1;
        var u = e[2], iu = 1 - u;
        var x = iu * iu * iu * a[0] + 3 * iu * iu * u * m + 3 * iu * u * u * m + u * u * u * b[0];
        var y = iu * iu * iu * a[1] + 3 * iu * iu * u * a[1] + 3 * iu * u * u * b[1] + u * u * u * b[1];
        g.fillStyle = 'rgba(255,180,225,' + (0.25 + d * .55) + ')'; g.beginPath(); g.arc(x, y, 1.2 + d * 1.4, 0, 7); g.fill();
      });
      layer.L.forEach(function (n) {
        var p = P(n), hot = d === 1 && Math.hypot(p[0] - px, p[1] - py) < 150;
        if (d === 1) {
          g.font = '600 11px "Segoe UI",sans-serif'; var w = g.measureText(n.l).width + 22;
          rr(p[0] - w / 2, p[1] - 12, w, 24, 12);
          g.fillStyle = hot ? 'rgba(60,14,52,.95)' : 'rgba(20,12,30,.8)'; g.fill();
          g.strokeStyle = hot ? '#ff5cb6' : 'rgba(255,255,255,.12)'; g.lineWidth = 1; g.stroke();
          if (hot) { g.shadowColor = '#ff5cb6'; g.shadowBlur = 18; g.stroke(); g.shadowBlur = 0; }
          g.fillStyle = hot ? '#fff' : 'rgba(220,205,235,.62)'; g.textAlign = 'center'; g.fillText(n.l, p[0], p[1] + 4);
        } else {
          g.fillStyle = 'rgba(200,170,240,' + (0.22 + d * .38) + ')'; g.beginPath(); g.arc(p[0], p[1], 2 + d * 2, 0, 7); g.fill();
        }
      });
    });
    g.textAlign = 'left';
  }
  function loop(ts) {
    requestAnimationFrame(loop);
    if (document.hidden) { last = ts; return; }
    var dt = Math.min(50, ts - (last || ts)); last = ts;
    if (!reduce) t += dt / 1000;
    mx += (tx - mx) * .06; my += (ty - my) * .06;
    draw();
  }
  addEventListener('resize', size);
  addEventListener('pointermove', function (e) { tx = e.clientX / W * 2 - 1; ty = e.clientY / H * 2 - 1; px = e.clientX; py = e.clientY; }, { passive: true });
  addEventListener('pointerleave', function () { px = py = -999; });
  size(); requestAnimationFrame(loop);
})();
