/**
 * TEMPORARY on screen keyboard diagnostic for the Foxtel box. Remove when done.
 *
 * Two testers reported that a letter on the on screen keyboard does not always
 * work on the box. It cannot be reproduced in a desktop browser, so this
 * records what the box really does.
 *
 * Sends ONE event each time the on screen keyboard closes. The event lists
 * every key the remote sent while the keyboard was open, which key was
 * highlighted, and whether the text grew by the expected amount.
 *
 * It never records what was typed. A key is named only when it is "e" or when
 * it failed. Every other key is recorded as "letter", "digit" or "symbol".
 *
 * Paste BELOW the foxtel-rcu script tag in the UScreen head code.
 */
(function () {
  'use strict';
  var DSN = 'https://22e016b0d5141fed558ccda38beb3c41@sentry.servicepilot.com.au/9';
  var d = /^https:\/\/([0-9a-f]+)@([^/]+)\/(\d+)$/.exec(DSN);
  var STORE = d ? 'https://' + d[2] + '/api/' + d[3] + '/store/?sentry_version=7&sentry_key=' + d[1] : null;
  var MAX_EVENTS = 12;      // per page load
  var MAX_LINES = 150;      // per keyboard session

  var eventsSent = 0;
  var session = null;       // one per time the keyboard is open
  var before = [];          // the last keys pressed while the keyboard was closed
  var lastDownAt = 0;

  function overlay() { return document.getElementById('sbb-kbd-overlay'); }
  function isOpen() {
    var o = overlay();
    return !!o && String(o.className).indexOf('sbb-kbd-visible') !== -1;
  }
  function highlighted() { return document.querySelector('#sbb-kbd-overlay .sbb-kbd-highlight'); }

  // The preview mirrors the field the keyboard is typing into, so it is the
  // one place this script can read the result without knowing the field.
  function previewText() {
    var p = document.getElementById('sbb-kbd-preview');
    if (!p) return null;
    var t = '';
    for (var i = 0; i < p.childNodes.length; i++) {
      if (p.childNodes[i].nodeType === 3) t += p.childNodes[i].nodeValue;
    }
    return t;
  }

  function fieldInfo() {
    var a = document.activeElement;
    var label = document.getElementById('sbb-kbd-label');
    return {
      active: a ? a.tagName + (a.type ? ':' + a.type : '') + (a.name ? ':' + a.name : '') : 'none',
      label: label ? String(label.textContent).slice(0, 40) : ''
    };
  }

  // What the highlighted key should do, without naming it unless it is "e".
  function describe(el) {
    if (!el) return { name: '(no highlight)', grow: null, ch: null };
    var action = el.getAttribute('data-action');
    if (action === 'backspace') return { name: 'DEL', grow: -1, ch: null };
    if (action === 'space') return { name: 'SPACE', grow: 1, ch: ' ' };
    if (action === 'dotcom') return { name: '.com', grow: 4, ch: 'm' };
    if (action === 'shift') return { name: 'SHIFT', grow: 0, ch: null };
    if (action === 'done') return { name: 'DONE', grow: null, ch: null };
    var k = el.getAttribute('data-key') || '';
    var shown = String(el.textContent || '');
    var kind = /^[a-z]$/i.test(k) ? 'letter' : (/^[0-9]$/.test(k) ? 'digit' : 'symbol');
    var isE = k.toLowerCase() === 'e';
    return { name: isE ? shown : kind, real: shown, grow: 1, ch: shown, isE: isE };
  }

  function eventId() {
    var s = '';
    for (var i = 0; i < 32; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
    return s;
  }

  function send(why) {
    var s = session;
    session = null;
    if (!s || !STORE || eventsSent >= MAX_EVENTS) return;
    if (!s.lines.length) return;
    eventsSent++;
    var failed = s.fails.length > 0;
    var data = {
      rcuVersion: window.__RCU_VERSION || 'MISSING',
      url: location.pathname,
      ua: navigator.userAgent,
      viewport: window.innerWidth + 'x' + window.innerHeight,
      closedBy: why,
      field: s.field,
      keysBeforeOpen: s.before,
      selects: s.selects, eSelects: s.eSelects, eFails: s.eFails,
      fails: s.fails,
      keysSeen: s.keysSeen,
      timeline: s.lines
    };
    try { console.log('[RCU-KBD]', JSON.stringify(data)); } catch (e) {}
    var evt = {
      event_id: eventId(),
      timestamp: Math.floor(Date.now() / 1000),
      platform: 'javascript', level: failed ? 'warning' : 'info',
      logger: 'foxtel-keyboard', environment: 'foxtel-biq',
      release: 'foxtel-rcu@' + data.rcuVersion,
      message: { formatted: 'KEYBOARD ' + (failed ? 'FAILED on ' + s.fails[0].key : 'ok') +
                            ' (' + s.selects + ' keys, ' + s.eSelects + ' e) ' + location.pathname },
      tags: {
        rcu_diag: '1', rcu_kbd: failed ? 'failed' : 'ok',
        rcu_kbd_e: s.eFails ? 'failed' : (s.eSelects ? 'ok' : 'not used'),
        rcu_version: String(data.rcuVersion)
      },
      extra: data
    };
    var body = JSON.stringify(evt);
    try {
      fetch(STORE, { method: 'POST', body: body, mode: 'cors', keepalive: true,
                     headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(function () {});
    } catch (e) {
      try { navigator.sendBeacon(STORE, new Blob([body], { type: 'text/plain;charset=UTF-8' })); } catch (e2) {}
    }
  }

  function startSession() {
    session = {
      t0: Date.now(), field: fieldInfo(), before: before.slice(),
      lines: [], fails: [], keysSeen: {}, selects: 0, eSelects: 0, eFails: 0
    };
  }

  function line(text) {
    if (!session || session.lines.length >= MAX_LINES) return;
    session.lines.push(((Date.now() - session.t0) / 1000).toFixed(2) + 's ' + text);
  }

  // The remote control script listens on document in the capture phase and
  // stops the event there while the keyboard is open. Listening on window in
  // the capture phase runs first, so nothing can hide a key from this script.
  window.addEventListener('keydown', function (e) {
    try {
      var now = Date.now();
      var gap = lastDownAt ? now - lastDownAt : 0;
      lastDownAt = now;
      var key = String(e.key);
      var code = e.keyCode;
      var open = isOpen();

      if (!open) {
        if (session) send('closed');
        // Printable keys could be something a person typed on a real keyboard,
        // so only their kind is kept. Named keys (Enter, Escape, "er") are safe.
        var safe = key.length > 1 ? key : (key === 'e' ? 'e' : '(1 char)');
        before.push(safe + '/' + code);
        if (before.length > 6) before.shift();
        // The Enter that opens the keyboard arrives while it is still closed.
        setTimeout(function () { if (isOpen() && !session) { startSession(); line('keyboard opened'); } }, 0);
        return;
      }

      if (!session) { startSession(); line('keyboard already open'); }
      var hl = highlighted();
      var want = describe(hl);
      var textBefore = previewText();
      var shownKey = key.length > 1 ? key : (key === 'e' ? 'e' : '(1 char)');
      session.keysSeen[shownKey + '/' + code] = (session.keysSeen[shownKey + '/' + code] || 0) + 1;
      var flags = (e.repeat ? ' REPEAT' : '') + (gap && gap < 120 ? ' FAST(' + gap + 'ms)' : '');

      setTimeout(function () {
        try {
          if (!session) return;
          var textAfter = previewText();
          var stillOpen = isOpen();
          if (key === 'Enter') {
            var lenB = textBefore === null ? -1 : textBefore.length;
            var lenA = textAfter === null ? -1 : textAfter.length;
            var grew = lenA - lenB;
            var result = 'ok';
            if (want.grow !== null && stillOpen) {
              var expected = want.grow === -1 ? (lenB > 0 ? -1 : 0) : want.grow;
              if (grew !== expected) result = 'FAIL len ' + lenB + '>' + lenA + ' expected ' + (expected >= 0 ? '+' : '') + expected;
              else if (want.ch && want.grow > 0 && textAfter.charAt(lenA - 1) !== want.ch &&
                       textAfter.charAt(lenA - 1) !== '•') result = 'FAIL wrong character';
            }
            session.selects++;
            if (want.isE) session.eSelects++;
            var name = want.name;
            if (result !== 'ok') {
              name = want.real || want.name;          // a failed key is safe to name
              session.fails.push({ key: name, result: result, at: session.lines.length, repeat: !!e.repeat, gap: gap });
              if (want.isE) session.eFails++;
            }
            line('OK on ' + name + ' -> ' + result + flags);
          } else if (key.indexOf('Arrow') === 0) {
            var nowHl = describe(highlighted());
            line(key.replace('Arrow', '') + ' -> ' + nowHl.name + (highlighted() === hl ? ' DID NOT MOVE' : '') + flags);
          } else {
            var lenB2 = textBefore === null ? -1 : textBefore.length;
            var lenA2 = textAfter === null ? -1 : textAfter.length;
            line('key ' + shownKey + '/' + code + (lenA2 !== lenB2 ? ' TYPED ' + (lenA2 - lenB2) : '') + flags);
          }
          if (!stillOpen) send(key === 'Escape' ? 'Back' : (want.name === 'DONE' ? 'DONE' : 'closed'));
        } catch (ex) {}
      }, 0);
    } catch (ex) {}
  }, true);

  // Leaving the page with the keyboard still open must not lose the session.
  window.addEventListener('pagehide', function () { if (session) send('page left'); });
  document.addEventListener('turbo:before-visit', function () { if (session) send('page left'); });
})();
