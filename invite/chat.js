/* Rasumi Agent · guided support chat on the invitation page
   - topics and follow-up questions are quick-reply buttons inside the conversation
   - every final answer asks "Did this solve it?" -> Yes: 1-5 stars (saved) / No: leave a message for IT
   - "Contact IT" is always one tap away; the message is e-mailed to support@rasumi.com.my (reply goes to the user)
   - typed questions are matched to the knowledge base (EN + BM); anything outside Rasumi Apps gets a firm "out of scope"
   - agents answers show the real last run of each agent (invite-download action "agents")
   Backend: invite-download edge function (same invitation token + device key as the page). */
(function () {
  'use strict';
  var FN = 'https://seqlkwdghibmsfkbuwqq.supabase.co/functions/v1/invite-download';
  var KB = window.RA_KB; if (!KB) return;
  var ls = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
  var LANG = 'en', L = function () { return LANG === 'ms' ? 1 : 0; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var T = function (en, ms) { return LANG === 'ms' ? ms : en; };
  var offCount = 0, REG = null, idleT = null, lastPick = {}, awaitSolved = false, lastAI = false, userIssue = '', info = null, el = {}, transcript = [], busy = false, started = false, status = null, statusAt = 0, lastTopic = '', lastQ = '';

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
    get info() { return window.RA_INFO || info || {}; },
    date: function (s) { try { return new Date(s).toLocaleDateString(LANG === 'ms' ? 'ms-MY' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } },
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
  // how to address the user: BOD title from the server (Puan Filzah …), else the user's own style (awak / anda / you)
  function hon() { var i = window.RA_INFO || info || {}; return i.honorific && i.honorific.title ? i.honorific.title + ' ' + i.honorific.name : ''; }
  function nameOf() { return hon() || (info && info.first_name) || T('there', 'anda'); }
  function youOf() { if (hon()) return hon(); if (LANG === 'en') return 'you'; return REG === 'casual' ? 'awak' : 'anda'; }
  function capS(s) { return s.replace(/(^|[.!?]\s+|<br>)([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }); }
  function fill(s) { return capS(String(s).replace(/\{you\}/g, esc(youOf())).replace(/\{name\}/g, esc(nameOf()))); }
  function pick(key, arr) {                                   // random, never the same line twice in a row
    if (arr.length < 2) return arr[0];
    var i; do { i = Math.floor(Math.random() * arr.length); } while (i === lastPick[key]);
    lastPick[key] = i; return arr[i];
  }
  function regOf(raw) {
    var t = ' ' + String(raw).toLowerCase() + ' ';
    if (/[^a-z](kau|ko|aku|engkau|hang|weh|bro|beb)[^a-z]/.test(t)) return 'casual';
    if (/[^a-z](anda|saya|tuan|puan|encik)[^a-z]/.test(t)) return 'formal';
    return null;
  }
  // 5 minutes without anything from the user: close the chat and start again next time (old messages are wiped)
  function bump() { clearTimeout(idleT); if (started) idleT = setTimeout(onIdle, 5 * 60 * 1000); }
  function onIdle() {
    var ta = el.ms && el.ms.querySelector('.ra-form textarea');
    if (busy || (ta && ta.value.trim())) return bump();      // never lose a message being written to IT
    resetChat(true);
  }
  function resetChat(collapse) {
    clearTimeout(idleT);
    el.ms.innerHTML = ''; transcript = []; started = false; offCount = 0; awaitSolved = false; lastQ = ''; lastAI = false; REG = null;
    if (collapse) close();
  }
  function endChat() {
    userSay(T('End the conversation', 'Tamatkan perbualan'));
    agentSay(fill(T('Thank you for chatting with Rasumi Agent, {name}. Have a great day!', 'Terima kasih kerana berbual dengan Rasumi Agent, {name}. Semoga hari {you} menyenangkan!')),
      function () { setTimeout(function () { resetChat(true); }, 2500); });
  }
  // outside Rasumi Apps: small talk gets a real answer first; repeats get firmer, the 3rd in a row offers to end the chat
  function outOfScope(topic, text) {
    offCount++;
    var lv = Math.min(offCount, 3) - 1, k = LANG === 'ms' ? 'ms' : 'en', html;
    if (text && !topic) logMiss(text);
    if (offCount >= 7) {                                   // still going after many tries: close politely and start fresh
      return agentSay(fill(pick('end', LANG === 'ms'
        ? ['Saya tamatkan perbualan ini dulu, ya, {name}. Bila ada soalan tentang Rasumi Apps, buka chat semula. Terima kasih!',
           'Kita berhenti di sini dulu, {name}. Saya sentiasa ada untuk soalan Rasumi Apps. Jumpa lagi!']
        : ['I\'ll close this chat for now, {name}. Open it again any time you have a Rasumi Apps question. Thank you!',
           'Let\'s stop here for now, {name}. I\'m always here for Rasumi Apps questions. See you!'])),
        function () { setTimeout(function () { resetChat(true); }, 2500); });
    }
    if (lv === 2) {
      var pool = offCount >= 4 && KB.OFFL[k][3] ? KB.OFFL[k][3] : KB.OFFL[k][2];
      html = (topic ? fill(pick('t_' + topic.id, topic[k])) + '<br>' : '') + fill(pick(offCount >= 4 ? 'close2' : 'close', pool));
      return agentSay(html, function () {
        quick([{ label: T('End the conversation', 'Tamatkan perbualan'), cls: 'ra-mut', go: endChat },
               { label: T('I have a Rasumi Apps question', 'Saya ada soalan Rasumi Apps'), go: function () { userSay(T('I have a Rasumi Apps question', 'Saya ada soalan Rasumi Apps')); offCount = 0; topics(); } }]);
      });
    }
    html = topic ? fill(pick('t_' + topic.id, topic[k])) + '<br>' + fill(pick('r' + lv, KB.REDIRECT[k][lv])) : fill(pick('o' + lv, KB.OFFL[k][lv]));
    agentSay(html, function () { quick(topic ? [menuChip()] : [menuChip(), itChip()]); });
  }
  function chatTopic(text) { var t = norm(text); for (var i = 0; i < (KB.CHAT || []).length; i++) if (KB.CHAT[i].re.test(t)) return KB.CHAT[i]; return null; }

  var AV = '<span class="ra-av"><img src="assets/agent.webp?v=1" alt=""></span>';
  function build() {
    var fab = document.createElement('button');
    fab.className = 'ra-fab'; fab.type = 'button'; fab.setAttribute('aria-label', 'Rasumi Agent');
    fab.innerHTML = '<i class="ra-ring"></i>' + AV + '<i class="ra-dot"></i>';
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
    w.querySelector('.ra-new').onclick = function () { if (busy) return; resetChat(false); started = true; greet(); };
    el.form.onsubmit = function (e) { e.preventDefault(); typed(); };
    el.input.addEventListener('input', bump); w.addEventListener('click', bump);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && w.classList.contains('ra-open')) close(); });
    labels();
  }
  function labels() {
    el.fab.title = T('Ask Rasumi Agent', 'Tanya Rasumi Agent'); el.fab.setAttribute('aria-label', el.fab.title);
    el.w.querySelector('.ra-on').textContent = T('Online', 'Online');
    el.w.querySelector('.ra-itl').textContent = 'IT';
    el.w.querySelector('.ra-it').title = T('Leave a message for IT', 'Tinggalkan mesej untuk IT');
    el.w.querySelector('.ra-new').title = T('Start again', 'Mula semula');
    el.w.querySelector('.ra-lang').innerHTML = LANG === 'en' ? '<b>EN</b>&nbsp;|&nbsp;BM' : 'EN&nbsp;|&nbsp;<b>BM</b>';
    el.input.placeholder = T('Type a question about Rasumi Apps…', 'Taip soalan tentang Rasumi Apps…');
    el.w.querySelector('.ra-ft').textContent = T('Rasumi Agent answers about Rasumi Apps only.', 'Rasumi Agent hanya menjawab tentang Rasumi Apps.');
  }
  function open() { el.w.classList.add('ra-open'); el.fab.classList.add('ra-hide'); if (!started) { started = true; greet(); } bump(); setTimeout(function () { el.input.focus(); }, 200); }
  function close() { el.w.classList.remove('ra-open'); el.fab.classList.remove('ra-hide'); }
  function now() { return new Date().toLocaleTimeString(LANG === 'ms' ? 'ms-MY' : 'en-GB', { hour: '2-digit', minute: '2-digit' }); }
  function scroll() { el.ms.scrollTop = el.ms.scrollHeight; }
  // soft two-note chime when the agent replies (Web Audio, no sound file); quiet, and never before the user has clicked
  var actx = null;
  function chime() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var t0 = actx.currentTime;
      [[880, 0], [1318.5, 0.09]].forEach(function (n) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t0 + n[1]);
        g.gain.exponentialRampToValueAtTime(0.06, t0 + n[1] + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + 0.22);
        o.connect(g); g.connect(actx.destination);
        o.start(t0 + n[1]); o.stop(t0 + n[1] + 0.25);
      });
    } catch (e) { }
  }
  function bubble(html, me) {
    if (!me) chime();
    var r = document.createElement('div'); r.className = 'ra-row' + (me ? ' ra-me' : '');
    r.innerHTML = (me ? '' : AV) + '<div class="ra-b">' + html + '</div>';
    el.ms.appendChild(r);
    var t = document.createElement('div'); t.className = 'ra-t'; t.textContent = (me ? '' : 'Rasumi Agent · ') + now(); el.ms.appendChild(t);
    scroll(); return r;
  }
  function plain(html) { var d = document.createElement('div'); d.innerHTML = html; return (d.textContent || '').replace(/\s+/g, ' ').trim(); }
  function userSay(text) { bubble(esc(text), true); transcript.push({ who: 'user', text: text }); bump(); }
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
      // quick replies disappear once one is picked; the choice shows as the user's own message
      b.onclick = function () { if (busy || w.classList.contains('ra-used')) return; w.classList.add('ra-used'); w.remove(); awaitSolved = false; it.go(); };
      w.appendChild(b);
    });
    el.ms.appendChild(w); scroll(); return w;
  }
  function itChip() { return { label: T('Contact IT', 'Hubungi IT'), cls: 'ra-it', go: function () { userSay(T('Contact IT', 'Hubungi IT')); showNode('it'); } }; }
  function menuChip() { return { label: T('‹ Main menu', '‹ Menu utama'), cls: 'ra-mut', go: function () { userSay(T('Main menu', 'Menu utama')); topics(); } }; }

  // ---------------------------------------------------------------- flow
  function greet() {
    var name = hon() ? ' ' + esc(hon()) : (info && info.first_name ? ' ' + esc(info.first_name) : '');
    agentSay(T('Hi' + name + '! I\'m <b>Rasumi Agent</b>, here to help with anything about Rasumi Apps, from installing and signing in to using the apps every day. What can I help you with?',
               'Hai' + name + '! Saya <b>Rasumi Agent</b>, sedia membantu apa sahaja tentang Rasumi Apps, dari pemasangan dan log masuk hingga penggunaan harian. Apa yang boleh saya bantu?'), topicChips);
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
    lastAI = false; if (id !== 'secret') offCount = 0;
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
        awaitSolved = true;
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
          if (w.classList.contains('ra-used')) return; w.classList.add('ra-used'); w.remove();
          call({ action: 'rate', topic: lastTopic, question: lastQ, resolved: resolved, stars: s, ticket_no: ticket || '', lang: LANG, ai: lastAI });
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
    call({ action: 'rate', topic: lastTopic, question: lastQ, resolved: false, lang: LANG, ai: lastAI });
    agentSay(T('Sorry about that. Let IT take a look: leave a message and IT will reply to your e-mail as soon as possible, or pick another question.',
               'Maaf tentang itu. Biar IT semak: tinggalkan mesej dan IT akan membalas ke e-mel anda secepat mungkin, atau pilih soalan lain.'),
      function () { quick([{ label: T('Leave a message for IT', 'Tinggalkan mesej untuk IT'), cls: 'ra-it', go: function () { userSay(T('Leave a message for IT', 'Tinggalkan mesej untuk IT')); ticketForm(); } }, menuChip()]); });
  }
  function ticketForm() {
    var f = document.createElement('div'); f.className = 'ra-form';
    var cat = '';
    f.innerHTML = '<label>' + T('TO', 'KEPADA') + '</label><div class="ra-to">IT · support@rasumi.com.my</div>' +
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
            : T('Could not send right now. Try again, or e-mail support@rasumi.com.my.', 'Tidak dapat dihantar sekarang. Cuba lagi, atau e-mel support@rasumi.com.my.');
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
  // shortforms and chat spellings -> full words (Malay SMS style and English chat style)
  var FOLD = (function () {
    var m = {}, add = function (full, list) { list.split(' ').forEach(function (s) { m[s] = full; }); };
    // Malay
    add('tak', 'x tk tak tkde tke xk');           add('tak ada', 'xde xda takde takda tiada tade xada');
    add('tak boleh', 'xleh xblh xboleh xbleh takleh tkleh tkboleh xbole');     add('tak dapat', 'xdapat xdpt tkdpt takdpt xdapt');
    add('tak jadi', 'xjadi tkjadi');               add('tak tahu', 'xtau xtahu tktau taktau tatau');
    add('boleh', 'blh bole bleh leh boley buleh'); add('dapat', 'dpt dapet dpat dpet');
    add('nak', 'nk nk2 nok');                      add('macam', 'mcm mcam cam');
    add('macam mana', 'camne cmne camana cmana mcmana macamana mcmne camno macammana');
    add('mana', 'mne mna mn');                     add('apa', 'ape ap pe apo');
    add('kenapa', 'knp knape napa nape kenape apasal asal');   add('bagaimana', 'bgmn bgaimana');
    add('bila', 'bile bla');                       add('siapa', 'sape spa sapa');
    add('saya', 'sy sye saye sya');              add('aku', 'aq ak');
    add('awak', 'awk');                            add('kau', 'ko hang');
    add('dah', 'dh da sdh sudah udah');            add('belum', 'blm blum lum');
    add('lagi', 'lg lgi');                         add('juga', 'jgk jugak gak jg');
    add('sahaja', 'je jer ja sje saje');           add('sebab', 'sbb sbab bcoz');
    add('dengan', 'dgn ngn dng');                  add('untuk', 'utk tuk ntuk');
    add('dalam', 'dlm');                           add('kat', 'dkt dekat kt');
    add('tolong', 'tlg tlong tolonglah');          add('minta', 'mntk mintak mtk');
    add('terima kasih', 'tq tqvm tenkiu tenkyu');
    add('kena', 'kne kna');                        add('kalau', 'kl klu kalo klau');
    add('sekarang', 'skrg skrang skg');            add('orang', 'org');
    add('kawan', 'kwn');                           add('telefon', 'fon tfon tel hp handphone henfon');
    add('komputer', 'komp kompiuter');             add('masalah', 'mslh msalah');
    add('lambat', 'lmbt lembab slow');             add('sangat', 'sgt sngt');
    add('jawab', 'jwb');                           add('mesej', 'mesg msj');
    add('password', 'pw pwd passwd katalaluan'); add('akaun', 'akaon');
    add('email', 'emel eml emil e-mail mail');     add('muat turun', 'muatturun');
    add('pasang', 'psg');                          add('berapa', 'brp brape berape');
    add('harga', 'hrg');                           add('percuma', 'prcm');
    add('esok', 'esk');                            add('baru', 'bru br');
    add('betul', 'btul btl');                      add('salah', 'slh');
    add('cuba', 'cba');                       add('ini', 'ni nih');
    add('itu', 'tu tuh');                          add('ada', 'ade');
    add('pejabat', 'opis ofis office');            add('buka', 'bukak bkak bka');
    add('yang', 'yg yng');                         add('faham', 'phm fhm paham');
    add('tapi', 'tp tpi');                         add('pun', 'pn');            add('cawangan', 'cwgn branch');
    // English
    add('you', 'u yu');                            add('your', 'ur yr');
    add('are', 'r');                               add('why', 'y');
    add('please', 'pls plz plss pleas');           add('what', 'wht wat wut whut');
    add('how', 'hw');                              add('have', 'hv');
    add('can', 'cn');                              add('cannot', 'cant can\'t cnt cnnot');
    add('do not', 'dont don\'t dnt');              add('does not', 'doesnt doesn\'t');
    add('did not', 'didnt didn\'t');               add('will not', 'wont won\'t');
    add('is not', 'isnt isn\'t');                  add('i am', 'im i\'m');
    add('because', 'bcs bc coz cuz cos becoz');    add('about', 'abt');
    add('people', 'ppl');                          add('something', 'smth smtg sth');
    add('message', 'msg');                         add('thanks', 'thx thnx tnx');
    add('tomorrow', 'tmrw tmr');                   add('information', 'info');
    add('problem', 'prob prblm prb');              add('account', 'acc acct accnt');
    add('verification', 'verif verify');           add('authenticator', 'auth authenticatr');
    add('register', 'reg regis');                  add('download', 'dl dload dwnld downlod donwload dowload downlaod d/l');
    add('install', 'instal instl inst installl');  add('update', 'upd8 updt');
    add('error', 'err eror errror');               add('computer', 'comp');
    add('internet', 'net inet');
    add('2fa', '2-fa 2step twofa mfa');            add('otp', 'tac');
    m['login'] = 'log masuk login'; m['signin'] = 'sign in'; m['signup'] = 'sign up'; m['logout'] = 'log out';
    // a word may be both Malay and English shortform: keep the Malay reading for these only when the sentence is Malay (see langOf)
    return m;
  })();
  function norm(s) {
    var t = String(s || '').toLowerCase().replace(/[’']/g, '\'')
      .replace(/\b([a-z]{3,})2\b/g, '$1')                      // kawan2 -> kawan (Malay plural shorthand)
      .replace(/([a-z])\1{2,}/g, '$1')                          // tolonggg -> tolong, pleaseee -> please
      .replace(/[^\p{L}\p{N}#.+'\/ -]+/gu, ' ').replace(/ e[ -]?(mail|mel) /g, ' email ').replace(/[-\/]/g, ' ').replace(/\s+/g, ' ').trim();
    return ' ' + t.split(' ').map(function (w) { return FOLD[w] || w; }).join(' ') + ' ';
  }
  // which language did the user write in? Malay vs English by everyday words, after shortforms are expanded
  var MS = ('saya aku awak kau anda kami kita tak tidak nak mahu hendak macam mana apa kenapa bagaimana bila siapa boleh dapat dah belum lagi juga sahaja sebab dengan untuk dalam kat pada ' +
    'tolong minta terima kasih kena kalau sekarang orang kawan telefon masalah lambat sangat jawab mesej ada tiada ini itu ni tu lah kah ke pun muat turun pasang daftar lupa kata laluan hilang ' +
    'akaun jemputan guna buat cara perlu betul salah tukar baru cuba cawangan pejabat berapa harga percuma esok keluar masuk boleh ralat nampak jumpa sudah selepas sebelum kerja fail').split(' ');
  var EN = ('i you your my me we our the a an is are am was were be do does did not can cannot will would should could what how why when where who which please help want need have has ' +
    'with for from this that it to of and or but if my get got use using work working tried try still again know thanks hello hi there new old change lost forgot about because').split(' ');
  var MSW = {}, ENW = {}; MS.forEach(function (w) { MSW[w] = 1; }); EN.forEach(function (w) { ENW[w] = 1; });
  function langOf(text) {
    var raw = String(text || '').toLowerCase();
    if (/[一-鿿஀-௿؀-ۿ]/.test(raw)) return 'other';   // Chinese, Tamil, Arabic script
    var ms = 0, en = 0;
    norm(text).trim().split(' ').forEach(function (w) { if (MSW[w]) ms++; if (ENW[w]) en++; });
    if (/\b(nak|tak|x|xde|nk|mcm|camne|sy|tlg|dpt|blh|knp|lah|kah|ke)\b/.test(raw)) ms += 2;        // strong Malay chat markers
    if (/\b(sayang|syg|awak|kau|aku|jom|cantik|comel|hensem|rindu|sombong|garang|merajuk|tolong|terima kasih|boleh|kenapa|macam mana|tidak|ada|takde|dah|belum|saya|kita)\b/.test(raw)) ms += 2;   // everyday Malay words (one-word messages too)
    if (ms > en) return 'ms';
    if (en > ms) return 'en';
    return null;                                                   // not sure: keep the current language
  }
  function setLang(l) { if (l && l !== LANG) { LANG = l; labels(); } }
  var STOP = {}; (KB.STOP || []).forEach(function (w) { STOP[w] = 1; });
  function stem(w) {                                         // installing -> install, downloads -> download, passwordnya -> password
    if (w.length > 6) w = w.replace(/(nya|lah)$/, '');
    if (w.length > 5) w = w.replace(/(ing|ed)$/, '');
    if (w.length > 4 && !/ss$/.test(w)) w = w.replace(/s$/, '');
    return w;
  }
  function words(t) { return t.trim().split(' ').filter(function (w) { return w && !STOP[w]; }).map(stem); }
  function near(a, b) {                                      // one typo allowed on longer words
    if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, e = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++e > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return e + (a.length - i) + (b.length - j) <= 1;
  }
  var QW = {};                                               // meaningful words of each node's question, once
  function qwords(id) {
    if (QW[id]) return QW[id];
    var n = KB.N[id], seen = {}, out = [];
    words(norm(n.q[0] + ' ' + n.q[1])).forEach(function (w) { if (w.length > 3 && !seen[w]) { seen[w] = 1; out.push(w); } });
    return (QW[id] = out);
  }
  function rank(text) {
    var t = norm(text), tw = words(t), out = [];
    for (var i = 0; i < (KB.INTENTS || []).length; i++) if (KB.INTENTS[i][0].test(t)) return [{ id: KB.INTENTS[i][1], s: 99 }];
    if (!tw.length) return out;
    var agentWord = / (agent|agents|ejen|bot|robot) /.test(t);
    Object.keys(KB.N).forEach(function (id) {
      var n = KB.N[id], s = 0, used = {}, cov = {};        // each typed word earns points once per answer; cov = words this answer covers
      n.kw.forEach(function (k) {
        var kk = norm(k).trim(); if (!kk) return;
        if (kk.indexOf(' ') >= 0) {
          if (t.indexOf(' ' + kk + ' ') >= 0) { s += 4 + (kk.split(' ').length > 2 ? 2 : 0); words(' ' + kk + ' ').forEach(function (w) { cov[w] = 1; }); }
          else {                                              // same words in another order ("telefon saya hilang" = "hilang telefon")
            var kws = words(' ' + kk + ' ');
            if (kws.length >= 2 && kws.every(function (w) { return tw.indexOf(w) >= 0; })) { s += 3; kws.forEach(function (w) { cov[w] = 1; }); }
          }
        }
        else {
          var sk = stem(kk), hit = tw.indexOf(sk) >= 0 ? sk : (t.indexOf(' ' + kk + ' ') >= 0 && !STOP[kk] ? kk : null);
          if (hit) { cov[hit] = 1; if (!used[hit]) { used[hit] = 1; s += kk.length >= 5 ? 3 : 2; } }
          else if (sk.length >= 5) {
            var f = tw.filter(function (w) { return !used[w] && near(w, sk); })[0];
            if (f) { used[f] = 1; cov[f] = 1; s += sk.length >= 6 ? 3 : 2; }
          }
        }
      });
      var kwS = s;
      qwords(id).forEach(function (w) { if (tw.indexOf(w) >= 0) { s += 1; cov[w] = 1; } });
      if (!s) return;
      if (KB.TOPICS.indexOf(id) >= 0) s -= 2;               // prefer a precise answer over a topic menu
      if (/^g_/.test(id) && agentWord && kwS > 0) s += 3;  // "which agent sends PO" -> that group; a plain "what agents" stays on the overview
      if (s > 0) out.push({ id: id, s: s, cov: tw.filter(function (w) { return cov[w]; }).length / tw.length });
    });
    return out.sort(function (a, b) { return b.s - a.s; });
  }
  function small(text) {
    var t = norm(text);
    for (var i = 0; i < KB.SMALL.length; i++) if (KB.SMALL[i].kw.some(function (k) { return t.indexOf(norm(k)) >= 0; })) return KB.SMALL[i].a[L()];
    return null;
  }
  function suggest(list) {
    agentSay(T('I want to give you the right answer. Did you mean one of these?', 'Saya mahu beri jawapan yang tepat. Adakah anda maksudkan salah satu ini?'), function () {
      var items = list.map(function (r) { var c = KB.N[r.id]; return { label: qText(c), go: function () { userSay(qText(c)); showNode(r.id); } }; });
      items.push({ label: T('None of these', 'Bukan semua ini'), cls: 'ra-mut', go: function () { userSay(T('None of these', 'Bukan semua ini')); notSolved(); } });
      quick(items);
    });
  }
  function logMiss(text) { call({ action: 'rate', topic: 'Unanswered', question: text.slice(0, 300), resolved: false, lang: LANG }); }
  var YES = /^(yes|ya|yup|yep|yeah|ok|okay|boleh|dah|sudah|settle|solved|selesai|done|betul|correct|thanks|terima kasih|dah ok|dah boleh)( .*)?$/,
      NO = /^(no|nope|tak|tidak|belum|not yet|nah|bukan|masih|still)( .*)?$/,
      STILL = / (still|masih|tetap) | (tak jadi|tak berjaya|tak work|not working|does not work|did not work|not solved|tak selesai|dah cuba|already tried|same problem|sama juga|masih sama) /;
  function typed() {
    var text = el.input.value.trim(); if (!text || busy) return;
    el.input.value = '';
    var last = el.ms.lastElementChild, open = last && last.classList.contains('ra-qr') ? last : null;
    var rg = regOf(text); if (rg) REG = rg;
    var lg = langOf(text);
    var other = lg === 'other';
    setLang(other ? 'en' : lg);
    userSay(text);
    var nt = norm(text);
    // answer to "Did this answer your question?" typed instead of tapped
    if (awaitSolved && open) {
      if (YES.test(nt.trim()) && !STILL.test(nt)) { awaitSolved = false; open.remove(); return rateAsk(true); }
      if (NO.test(nt.trim()) || STILL.test(nt)) { awaitSolved = false; open.remove(); return notSolved(); }
    }
    // "still not working" right after an answer -> hand over to IT instead of repeating it
    if (lastQ && STILL.test(nt) && rank(text).every(function (x) { return x.s < 5; })) { awaitSolved = false; return notSolved(); }
    if (open) open.remove();
    if (other) return agentSay('I can reply in <b>English</b> or <b>Bahasa Melayu</b>. Please type your question in English or Malay, or pick a topic below.', function () {
      var r = rank(text); if (r[0] && r[0].s >= 3) showNode(r[0].id); else topicChips();
    });
    else answerTyped(text);
  }
  // is the question about Rasumi Apps at all? (only such questions may go to the AI)
  var DOM = {}; (KB.DOMAIN || []).forEach(function (w) { DOM[stem(w)] = 1; });
  function inScope(text) {
    var tw = norm(text).trim().split(' ').map(stem);
    return tw.some(function (w) { return DOM[w] || (w.length >= 5 && Object.keys(DOM).some(function (d) { return d.length >= 5 && near(w, d); })); });
  }
  function isSecret(text) { var t = norm(text); return (KB.SECRET || []).some(function (re) { return re.test(t); }); }
  function answerTyped(text) {
    var r = rank(text), top = r[0], second = r[1];
    // company figures / people's data: fixed answer, never the AI (a price question about the app itself is fine)
    var appPrice = top && top.id === 'b_cost' && /\b(app|apps|aplikasi|rasumi|licence|license|lesen|langganan|subscription|percuma|free)\b/.test(norm(text));
    if (isSecret(text) && !appPrice) { lastQ = text; return showNode('secret'); }
    var tp = (!top || top.s < 3) ? chatTopic(text) : null;   // "dah makan?", "kau AI ke?": a real answer, then back to Rasumi Apps
    if (tp) return outOfScope(tp);
    if ((KB.OFFTOPIC || []).some(function (re) { return re.test(norm(text)); })) return outOfScope(null, text);   // clearly another subject, no AI
    if ((!top || top.s < 3) && STILL.test(norm(text))) { userIssue = text; return showNode('trouble'); }
    var tw = words(norm(text));
    var sure = top && top.s >= 3 && (!second || second.s < top.s);
    // a long, specific question that only touches one keyword is better understood by the AI ("print the report on A3")
    var thin = top && top.s >= 3 && top.s < 99 && tw.length >= 4 && top.cov < 0.6;
    if (sure && !thin) { lastQ = text; return showNode(top.id); }
    if (sure && thin) return aiAsk(text, function () { lastQ = text; showNode(top.id); });   // matched a Rasumi keyword, so in scope
    if (top && top.s >= 3) {                                  // two answers fit equally well: AI first, else let the user pick
      var tied = r.filter(function (x) { return x.s === top.s; }).slice(0, 4);
      return aiAsk(text, function () { suggest(tied); });
    }
    var nt = norm(text).trim();
    if ((!top || top.s < 3) && YES.test(nt)) return agentSay(T('Great! Anything else about Rasumi Apps?', 'Baik! Ada apa-apa lagi tentang Rasumi Apps?'), function () { quick([menuChip()]); });
    if ((!top || top.s < 3) && NO.test(nt)) return notSolved();
    var s = small(text);
    if (s && (!top || words(norm(text)).length <= 2)) return agentSay(s, topicChips);
    var offTopic = function () { outOfScope(null, text); };
    // outside Rasumi Apps: fixed answer, no AI call
    if (!inScope(text)) return offTopic();
    // about Rasumi Apps but not in the fixed answers (rojak, shortforms, new phrasing): ask the AI, else the old flow
    aiAsk(text, function () {
      if (top) { logMiss(text); return suggest(r.slice(0, 3)); }
      offTopic();
    });
  }

  // ---------------------------------------------------------------- AI fallback (invite-download action "ask")
  var aiOff = false;
  function safeHtml(h) {
    return String(h || '').replace(/<(\/?)(b|ul|ol|li|br|code)\s*\/?>/gi, '\u0001$1$2\u0002').replace(/<[^>]*>/g, '').replace(/[<>]/g, '')
      .replace(/\u0001(\/?)(\w+)\u0002/g, function (m, sl, t) { return '<' + sl + t.toLowerCase() + '>'; });
  }
  function aiAsk(text, fallback) {
    if (aiOff) return fallback();
    busy = true;
    var row = document.createElement('div'); row.className = 'ra-row';
    row.innerHTML = AV + '<div class="ra-b ra-think"><i></i><i></i><i></i><span>' + T('Rasumi Agent is thinking…', 'Rasumi Agent sedang berfikir…') + '</span></div>';
    el.ms.appendChild(row); scroll();
    var i = window.RA_INFO || {};
    var hist = transcript.slice(-9, -1).map(function (m) { return { who: m.who, text: String(m.text || '').slice(0, 600) }; });
    var minWait = new Promise(function (res) { setTimeout(res, 1800 + Math.random() * 700); });
    Promise.all([call({ action: 'ask', question: text, lang: LANG, history: hist, ctx: { expires_at: i.expires_at, downloads_left: i.downloads_left } }), minWait])
      .then(function (x) { return x[0]; }, function () { return { ok: false }; })
      .then(function (r) {
        row.remove(); busy = false;
        if (!r || !r.ok) {
          if (r && (r.reason === 'off' || r.reason === 'busy')) aiOff = true;
          if (r && r.reason === 'limit') aiOff = true;
          return fallback();
        }
        if (r.lang === 'ms' || r.lang === 'en') setLang(r.lang);
        if (r.kind === 'offtopic') return outOfScope(null);
        offCount = 0;
        var h = safeHtml(r.reply);
        bubble(h); transcript.push({ who: 'agent', text: plain(h) });
        lastQ = text; lastTopic = 'AI'; lastAI = true;
        if (r.kind === 'it') return quick([itChip(), menuChip()]);
        if (r.kind === 'unknown') return quick([itChip(), menuChip()]);
        askSolved();
      });
  }

  // ---------------------------------------------------------------- start once the invitation is open
  function boot(r) { info = r; if (!el.w) build(); }
  if (window.RA_INFO) boot(window.RA_INFO);
  document.addEventListener('ra:info', function () { boot(window.RA_INFO); });
})();
