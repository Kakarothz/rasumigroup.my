/* Rasumi Agent · guided support chat on the invitation page
   - topics and follow-up questions are quick-reply buttons inside the conversation
   - every final answer asks "Did this solve it?" -> Yes: 1-5 stars (saved) / No: leave a message for IT
   - "Contact IT" is always one tap away; the message is e-mailed to it@rasumi.com.my (reply goes to the user)
   - typed questions are matched to the knowledge base (EN + BM); anything outside Rasumi Apps gets a firm "out of scope"
   - agents answers show the real last run of each agent (invite-download action "agents")
   Backend: invite-download edge function (same invitation token + device key as the page). */
(function () {
  'use strict';
  var FN = 'https://seqlkwdghibmsfkbuwqq.supabase.co/functions/v1/invite-download';
  var KB = window.RA_KB; if (!KB) return;
  var ls = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
  var LANG = ls.get('ra_chat_lang') === 'ms' ? 'ms' : 'en', L = function () { return LANG === 'ms' ? 1 : 0; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var T = function (en, ms) { return LANG === 'ms' ? ms : en; };
  var info = null, el = {}, transcript = [], busy = false, started = false, status = null, statusAt = 0, lastTopic = '', lastQ = '';

  function call(body) {
    body.token = ls.get('rasumi_inv_t'); body.device = ls.get('rasumi_inv_d');
    return fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), referrerPolicy: 'no-referrer', cache: 'no-store' })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false, reason: 'server' }; });
  }
  function ago(iso) {
    if (!iso) return null;
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return T('just now', 'baru tadi');
    if (s < 3600) return T(Math.round(s / 60) + ' min ago', Math.round(s / 60) + ' minit lepas');
    if (s < 86400) return T(Math.round(s / 3600) + ' h ago', Math.round(s / 3600) + ' jam lepas');
    return T(Math.round(s / 86400) + ' days ago', Math.round(s / 86400) + ' hari lepas');
  }
  function loadStatus() {
    if (status && Date.now() - statusAt < 60000) return Promise.resolve(status);
    return call({ action: 'agents' }).then(function (r) { if (r && r.ok) { status = r.status || {}; statusAt = Date.now(); } return status; });
  }
  var ctx = {
    esc: esc,
    get email() { return info && info.email; },
    agentList: function (keys, lang) {
      var i = lang === 'ms' ? 1 : 0;
      return '<ul>' + keys.map(function (k) {
        var a = KB.AG.find(function (x) { return x[0] === k; }); if (!a) return '';
        var st = status && status[k], when = st ? ago(st) : null;
        var live = k === 'reports' ? T('runs on demand', 'berjalan bila diminta') : k === 'sentinel' ? T('on its own server', 'di server sendiri')
          : when ? T('last run ', 'kali terakhir ') + when : T('waiting for its first run', 'menunggu run pertama');
        return '<li><b>' + esc(a[1]) + '</b> · <span class="ra-live">' + live + '</span><br>' + esc(a[2 + i]) + '</li>';
      }).join('') + '</ul>';
    }
  };
  function answerText(node) { var a = node.a[L()]; return typeof a === 'function' ? a(ctx) : a; }
  function qText(node) { return node.q[L()]; }

  // ---------------------------------------------------------------- DOM
  var IC = {
    send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12 2-12 2z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    min: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14"/></svg>',
    redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>'
  };
  var AV = '<span class="ra-av"><img src="assets/favicon-r.png?v=2" alt=""></span>';
  function build() {
    var fab = document.createElement('button');
    fab.className = 'ra-fab'; fab.type = 'button'; fab.setAttribute('aria-label', 'Rasumi Agent');
    fab.innerHTML = AV + '<i class="ra-dot"></i><span class="ra-lbl"></span>';
    var w = document.createElement('div');
    w.className = 'ra-win'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', 'Rasumi Agent');
    w.innerHTML = '<div class="ra-hd">' + AV + '<div><b>Rasumi Agent</b><small><i></i><span class="ra-on"></span></small></div><span class="ra-sp"></span>' +
      '<button type="button" class="ra-ib ra-it" title="">' + IC.mail + '<span class="ra-itl"></span></button>' +
      '<button type="button" class="ra-ib ra-lang" title="English / Bahasa Melayu"></button>' +
      '<button type="button" class="ra-ib ra-new" title="">' + IC.redo + '</button>' +
      '<button type="button" class="ra-ib ra-close" aria-label="Close">' + IC.min + '</button></div>' +
      '<div class="ra-ms" aria-live="polite"></div>' +
      '<form class="ra-in" autocomplete="off"><input type="text" maxlength="300"><button type="submit" aria-label="Send">' + IC.send + '</button></form>' +
      '<div class="ra-ft"></div>';
    document.body.appendChild(fab); document.body.appendChild(w);
    el = { fab: fab, w: w, ms: w.querySelector('.ra-ms'), input: w.querySelector('.ra-in input'), form: w.querySelector('.ra-in') };
    fab.onclick = open;
    w.querySelector('.ra-close').onclick = close;
    w.querySelector('.ra-it').onclick = function () { if (!busy) { userSay(T('Contact IT', 'Hubungi IT')); showNode('it'); } };
    w.querySelector('.ra-lang').onclick = function () { LANG = LANG === 'en' ? 'ms' : 'en'; ls.set('ra_chat_lang', LANG); labels(); };
    w.querySelector('.ra-new').onclick = function () { if (busy) return; el.ms.innerHTML = ''; transcript = []; greet(); };
    el.form.onsubmit = function (e) { e.preventDefault(); typed(); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && w.classList.contains('ra-open')) close(); });
    labels();
  }
  function labels() {
    el.fab.querySelector('.ra-lbl').textContent = T('Ask Rasumi Agent', 'Tanya Rasumi Agent');
    el.w.querySelector('.ra-on').textContent = T('Online', 'Online');
    el.w.querySelector('.ra-itl').textContent = 'IT';
    el.w.querySelector('.ra-it').title = T('Leave a message for IT', 'Tinggalkan mesej untuk IT');
    el.w.querySelector('.ra-new').title = T('Start again', 'Mula semula');
    el.w.querySelector('.ra-lang').innerHTML = LANG === 'en' ? '<b>EN</b>&nbsp;|&nbsp;BM' : 'EN&nbsp;|&nbsp;<b>BM</b>';
    el.input.placeholder = T('Type a question about Rasumi Apps…', 'Taip soalan tentang Rasumi Apps…');
    el.w.querySelector('.ra-ft').textContent = T('Rasumi Agent answers about Rasumi Apps only.', 'Rasumi Agent hanya menjawab tentang Rasumi Apps.');
  }
  function open() { el.w.classList.add('ra-open'); el.fab.classList.add('ra-hide'); if (!started) { started = true; greet(); } setTimeout(function () { el.input.focus(); }, 200); }
  function close() { el.w.classList.remove('ra-open'); el.fab.classList.remove('ra-hide'); }
  function now() { return new Date().toLocaleTimeString(LANG === 'ms' ? 'ms-MY' : 'en-GB', { hour: '2-digit', minute: '2-digit' }); }
  function scroll() { el.ms.scrollTop = el.ms.scrollHeight; }
  function bubble(html, me) {
    var r = document.createElement('div'); r.className = 'ra-row' + (me ? ' ra-me' : '');
    r.innerHTML = (me ? '' : AV) + '<div class="ra-b">' + html + '</div>';
    el.ms.appendChild(r);
    var t = document.createElement('div'); t.className = 'ra-t'; t.textContent = (me ? '' : 'Rasumi Agent · ') + now(); el.ms.appendChild(t);
    scroll(); return r;
  }
  function plain(html) { var d = document.createElement('div'); d.innerHTML = html; return (d.textContent || '').replace(/\s+/g, ' ').trim(); }
  function userSay(text) { bubble(esc(text), true); transcript.push({ who: 'user', text: text }); }
  // the agent "thinks" for about 3 s before every reply, like a live agent
  function agentSay(html, after) {
    busy = true;
    var r = document.createElement('div'); r.className = 'ra-row';
    r.innerHTML = AV + '<div class="ra-b ra-think"><i></i><i></i><i></i><span>' + T('Rasumi Agent is thinking…', 'Rasumi Agent sedang berfikir…') + '</span></div>';
    el.ms.appendChild(r); scroll();
    var wait = 2400 + Math.random() * 900;
    setTimeout(function () {
      r.remove();
      var h = typeof html === 'function' ? html() : html;
      bubble(h); transcript.push({ who: 'agent', text: plain(h) });
      busy = false;
      if (after) after();
    }, wait);
  }
  function quick(items) {
    var w = document.createElement('div'); w.className = 'ra-qr';
    items.forEach(function (it) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'ra-q' + (it.cls ? ' ' + it.cls : ''); b.textContent = it.label;
      b.onclick = function () { if (busy || w.classList.contains('ra-used')) return; w.classList.add('ra-used'); b.classList.add('ra-pick'); it.go(); };
      w.appendChild(b);
    });
    el.ms.appendChild(w); scroll(); return w;
  }
  function itChip() { return { label: T('Contact IT', 'Hubungi IT'), cls: 'ra-it', go: function () { userSay(T('Contact IT', 'Hubungi IT')); showNode('it'); } }; }
  function menuChip() { return { label: T('‹ Main menu', '‹ Menu utama'), cls: 'ra-mut', go: function () { userSay(T('Main menu', 'Menu utama')); topics(); } }; }

  // ---------------------------------------------------------------- flow
  function greet() {
    var name = info && info.first_name ? ' ' + esc(info.first_name) : '';
    agentSay(T('Hi' + name + '! I\'m <b>Rasumi Agent</b>. I can help you install Rasumi Apps, sign in, use the apps, or tell you about our 20 agents. What do you need help with?',
               'Hai' + name + '! Saya <b>Rasumi Agent</b>. Saya boleh bantu anda pasang Rasumi Apps, log masuk, guna aplikasi, atau terangkan 20 agent kami. Apa yang anda perlukan?'), topicChips);
  }
  function topicChips() {
    quick(KB.TOPICS.map(function (id) {
      var n = KB.N[id];
      return { label: qText(n), cls: id === 'it' ? 'ra-it' : '', go: function () { userSay(qText(n)); showNode(id); } };
    }));
  }
  function topics() { agentSay(T('Sure. What else can I help you with?', 'Baik. Apa lagi yang boleh saya bantu?'), topicChips); }
  function showNode(id) {
    var n = KB.N[id]; if (!n) return;
    if (KB.TOPICS.indexOf(id) >= 0) lastTopic = qText(n);
    if (n.form) return agentSay(answerText(n), ticketForm);
    var go = function () {
      agentSay(function () { return answerText(n); }, function () {
        if (n.next.length) {
          var items = n.next.map(function (cid) { var c = KB.N[cid]; return { label: qText(c), go: function () { userSay(qText(c)); showNode(cid); } }; });
          items.push(menuChip()); quick(items);
        } else { lastQ = n.q[0]; askSolved(); }
      });
    };
    if (n.live || n.agent) loadStatus().then(go, go); else go();
  }
  function askSolved() {
    setTimeout(function () {
      agentSay(T('Did this answer your question?', 'Adakah ini menjawab soalan anda?'), function () {
        quick([
          { label: T('Yes, thanks', 'Ya, terima kasih'), go: function () { userSay(T('Yes, thanks', 'Ya, terima kasih')); rateAsk(true); } },
          { label: T('No', 'Tidak'), go: function () { userSay(T('No', 'Tidak')); notSolved(); } },
          menuChip()
        ]);
      });
    }, 250);
  }
  function rateAsk(resolved, ticket) {
    agentSay(T('Glad I could help! How would you rate this conversation?', 'Gembira dapat membantu! Berapa rating anda untuk perbualan ini?'), function () {
      var w = document.createElement('div'); w.className = 'ra-stars'; w.setAttribute('role', 'radiogroup');
      for (var i = 1; i <= 5; i++) (function (s) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = '★'; b.setAttribute('aria-label', s + ' / 5');
        b.onmouseenter = function () { w.querySelectorAll('button').forEach(function (x, j) { x.classList.toggle('on', j < s); }); };
        b.onclick = function () {
          if (w.classList.contains('ra-used')) return; w.classList.add('ra-used');
          w.querySelectorAll('button').forEach(function (x, j) { x.classList.toggle('on', j < s); });
          call({ action: 'rate', topic: lastTopic, question: lastQ, resolved: resolved, stars: s, ticket_no: ticket || '', lang: LANG });
          userSay('★'.repeat(s));
          agentSay(s >= 4 ? T('Thank you for the ' + s + '-star rating! Anything else about Rasumi Apps?', 'Terima kasih atas rating ' + s + ' bintang! Ada apa-apa lagi tentang Rasumi Apps?')
                          : T('Thank you for the feedback. We will use it to improve. Would you like to tell IT more?', 'Terima kasih atas maklum balas. Kami akan gunakan untuk penambahbaikan. Mahu beritahu IT dengan lebih lanjut?'),
            function () { quick(s >= 4 ? [menuChip()] : [itChip(), menuChip()]); });
        };
        w.appendChild(b);
      })(i);
      w.onmouseleave = function () { if (!w.classList.contains('ra-used')) w.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); }); };
      el.ms.appendChild(w); scroll();
    });
  }
  function notSolved() {
    call({ action: 'rate', topic: lastTopic, question: lastQ, resolved: false, lang: LANG });
    agentSay(T('Sorry about that. Let IT take a look: leave a message and IT will reply to your e-mail as soon as possible, or pick another question.',
               'Maaf tentang itu. Biar IT semak: tinggalkan mesej dan IT akan membalas ke e-mel anda secepat mungkin, atau pilih soalan lain.'),
      function () { quick([{ label: T('Leave a message for IT', 'Tinggalkan mesej untuk IT'), cls: 'ra-it', go: function () { userSay(T('Leave a message for IT', 'Tinggalkan mesej untuk IT')); ticketForm(); } }, menuChip()]); });
  }
  function ticketForm() {
    var f = document.createElement('div'); f.className = 'ra-form';
    var cat = '';
    f.innerHTML = '<label>' + T('TO', 'KEPADA') + '</label><div class="ra-to">IT · it@rasumi.com.my</div>' +
      '<label>' + T('REPLY GOES TO', 'BALASAN KE') + '</label><div class="ra-to">' + esc((info && info.email) || '-') + '</div>' +
      '<label>' + T('WHAT IS IT ABOUT?', 'TENTANG APA?') + '</label><div class="ra-cats"></div>' +
      '<label>' + T('YOUR MESSAGE', 'MESEJ ANDA') + '</label><textarea maxlength="4000"></textarea><div class="ra-err" hidden></div>' +
      '<div class="ra-act"><button type="button" class="ra-btn ra-sec">' + T('Cancel', 'Batal') + '</button><button type="button" class="ra-btn">' + T('Send to IT', 'Hantar kepada IT') + '</button></div>';
    var cats = f.querySelector('.ra-cats'), ta = f.querySelector('textarea'), err = f.querySelector('.ra-err');
    ta.placeholder = T('Describe the problem. Include any error message you see.', 'Terangkan masalah. Sertakan mesej ralat jika ada.');
    KB.CATS.forEach(function (c) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'ra-q'; b.textContent = c[L()];
      b.onclick = function () { cat = c[0]; cats.querySelectorAll('.ra-q').forEach(function (x) { x.classList.toggle('on', x === b); }); err.hidden = true; };
      cats.appendChild(b);
    });
    var bs = f.querySelectorAll('.ra-btn');
    bs[0].onclick = function () { f.remove(); agentSay(T('No problem. What else can I help you with?', 'Tiada masalah. Apa lagi yang boleh saya bantu?'), topicChips); };
    bs[1].onclick = function () {
      var msg = ta.value.trim();
      if (!cat) { err.textContent = T('Choose what it is about.', 'Pilih tentang apa.'); err.hidden = false; return; }
      if (msg.length < 10) { err.textContent = T('Write at least a short sentence.', 'Tulis sekurang-kurangnya satu ayat pendek.'); err.hidden = false; ta.focus(); return; }
      bs[0].disabled = bs[1].disabled = true; ta.disabled = true; bs[1].textContent = T('Sending…', 'Menghantar…');
      call({ action: 'ticket', category: cat, message: msg, lang: LANG, transcript: transcript.slice(-30) }).then(function (r) {
        if (!r || !r.ok) {
          bs[0].disabled = bs[1].disabled = false; ta.disabled = false; bs[1].textContent = T('Send to IT', 'Hantar kepada IT');
          err.textContent = r && r.reason === 'limit' ? T('You have sent the daily limit of messages. IT will reply to the earlier ones.', 'Anda sudah mencapai had mesej harian. IT akan membalas mesej terdahulu.')
            : T('Could not send right now. Try again, or e-mail it@rasumi.com.my.', 'Tidak dapat dihantar sekarang. Cuba lagi, atau e-mel it@rasumi.com.my.');
          err.hidden = false; return;
        }
        f.remove(); userSay(msg);
        lastQ = 'Ticket ' + r.ticket_no;
        agentSay(T('Your message is with IT. Reference <b>' + esc(r.ticket_no) + '</b>. IT will reply to <b>' + esc((info && info.email) || '') + '</b> as soon as possible' + (r.emailed ? '; a copy is in your inbox.' : '.'),
                   'Mesej anda telah dihantar kepada IT. Rujukan <b>' + esc(r.ticket_no) + '</b>. IT akan membalas ke <b>' + esc((info && info.email) || '') + '</b> secepat mungkin' + (r.emailed ? '; salinan ada dalam inbox anda.' : '.')),
          function () { rateAsk(null, r.ticket_no); });
      });
    };
    el.ms.appendChild(f); scroll(); ta.focus();
  }

  // ---------------------------------------------------------------- typed questions
  function norm(s) { return ' ' + String(s || '').toLowerCase().replace(/[^\p{L}\p{N}#.+ ]+/gu, ' ').replace(/\s+/g, ' ').trim() + ' '; }
  function match(text) {
    var t = norm(text), best = null, score = 0;
    Object.keys(KB.N).forEach(function (id) {
      var n = KB.N[id], s = 0;
      n.kw.forEach(function (k) { var kk = norm(k); if (t.indexOf(kk) >= 0) s += kk.length > 6 ? 3 : 2; });
      norm(n.q[0] + ' ' + n.q[1]).trim().split(' ').forEach(function (wd) { if (wd.length > 4 && t.indexOf(' ' + wd + ' ') >= 0) s += 1; });
      if (KB.TOPICS.indexOf(id) >= 0) s -= 1;                 // prefer a precise answer over a topic menu
      if (s > score) { score = s; best = id; }
    });
    return score >= 2 ? best : null;
  }
  function small(text) {
    var t = norm(text);
    for (var i = 0; i < KB.SMALL.length; i++) if (KB.SMALL[i].kw.some(function (k) { return t.indexOf(norm(k)) >= 0; })) return KB.SMALL[i].a[L()];
    return null;
  }
  function typed() {
    var text = el.input.value.trim(); if (!text || busy) return;
    el.input.value = ''; userSay(text);
    var id = match(text);
    if (id) return showNode(id);
    var s = small(text);
    if (s) return agentSay(s, topicChips);
    agentSay(KB.OFF[L()], function () { quick([menuChip(), itChip()]); });
  }

  // ---------------------------------------------------------------- start once the invitation is open
  function boot(r) { info = r; if (!el.w) build(); }
  if (window.RA_INFO) boot(window.RA_INFO);
  document.addEventListener('ra:info', function () { boot(window.RA_INFO); });
})();
