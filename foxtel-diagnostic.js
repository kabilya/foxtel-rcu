/**
 * TEMPORARY Foxtel BiQ diagnostic. Remove when we are done.
 *
 * Paste inside <script> tags in the UScreen head code, BELOW the foxtel-rcu
 * script tag. It reads window.__RCU_VERSION, which that script sets.
 *
 * It shows a panel in the top left of the TV. Read it off the screen or
 * photograph it. It needs no console and no network.
 * It also posts to the foxtel-biq Sentry project when the box can reach it,
 * capped at 6 events per page load.
 */
(function () {
  'use strict';

  var DSN = 'https://22e016b0d5141fed558ccda38beb3c41@sentry.servicepilot.com.au/9';
  var _d = /^https:\/\/([0-9a-f]+)@([^/]+)\/(\d+)$/.exec(DSN || '');
  var STORE = _d ? 'https://' + _d[2] + '/api/' + _d[3] +
                   '/store/?sentry_version=7&sentry_key=' + _d[1] : null;
  var MAX_EVENTS = 6, sent = 0;

  var keys = [], clicks = 0, netState = 'not tried';

  // ---- on screen panel -------------------------------------------------
  var panel;
  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'rcu-diag-panel';
    panel.style.cssText =
      'position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;' +
      'background:rgba(0,0,0,.86);color:#7CFC00;font:20px/1.35 monospace;' +
      'padding:10px 14px;max-width:96vw;white-space:pre;border:2px solid #7CFC00;';
    (document.body || document.documentElement).appendChild(panel);
    return panel;
  }

  function shortName(el) {
    if (!el || el === document.body) return '(body)';
    var c = String(el.className || '').trim().split(/\s+/).slice(0, 3).join('.');
    return el.tagName.toLowerCase() + (c ? '.' + c : '');
  }

  function cssLoaded() {
    try {
      var p = document.createElement('div');
      p.id = 'sbb-paused-indicator';
      document.body.appendChild(p);
      var pos = window.getComputedStyle(p).position;
      document.body.removeChild(p);
      return pos === 'fixed'; // only foxtel-rcu.css sets this
    } catch (e) { return 'err'; }
  }

  function menuState() {
    var host = document.querySelector('.header--menu-account, .navigation-item-with-dropdown, [class*="account-dropdown"]');
    if (!host) return { host: 'NOT FOUND', dd: '-' };
    var dd = host.querySelector('.navigation-dropdown, [class*="dropdown-menu"]');
    if (!dd) return { host: shortName(host) + ' (no menu inside)', dd: '-' };
    var cs = window.getComputedStyle(dd), r = dd.getBoundingClientRect();
    return {
      host: shortName(host) + (host.classList.contains('rcu-menu-open') ? ' [OPEN]' : ''),
      dd: 'disp=' + cs.display + ' vis=' + cs.visibility + ' op=' + cs.opacity +
          ' ' + Math.round(r.width) + 'x' + Math.round(r.height)
    };
  }

  // Every candidate menu host on the page, so we can see which one is the
  // account menu instead of assuming the first is.
  function hostReport() {
    var out = [];
    var hosts = document.querySelectorAll(
      '.navigation-item-with-dropdown, .header--menu-account, [class*="account-dropdown"], [class*="user-menu"]');
    for (var i = 0; i < hosts.length && i < 6; i++) {
      var h = hosts[i];
      var dd = h.querySelector('.navigation-dropdown, [class*="dropdown-menu"]');
      var hrefs = [];
      if (dd) {
        var as = dd.querySelectorAll('a[href]');
        for (var j = 0; j < as.length && j < 5; j++) hrefs.push(as[j].getAttribute('href'));
      }
      out.push({
        i: i,
        cls: String(h.className || '').slice(0, 70),
        hasImg: !!h.querySelector('img'),
        hasAvatarCls: !!h.querySelector('[class*="avatar"]'),
        hasFocus: h.contains(document.activeElement),
        ddLinks: hrefs.join(',') || '(none)'
      });
    }
    return out;
  }

  function avatarReport() {
    var out = [];
    var els = document.querySelectorAll('.header-avatar, .navigation-avatar, .navigation-dropdown-button, [class*="avatar"]');
    for (var i = 0; i < els.length && i < 6; i++) {
      var e = els[i];
      var host = e.closest ? e.closest('.navigation-item-with-dropdown, .header--menu-account') : null;
      var r = e.getBoundingClientRect();
      out.push({
        tag: e.tagName, cls: String(e.className || '').slice(0, 60),
        size: Math.round(r.width) + 'x' + Math.round(r.height),
        tabindex: e.getAttribute('tabindex'),
        inHost: host ? String(host.className || '').slice(0, 50) : 'NONE'
      });
    }
    return out;
  }

  function snapshot() {
    var m = menuState();
    return {
      scriptVersion: window.__RCU_VERSION || 'OLD-OR-MISSING',
      cssLoaded: cssLoaded(),
      sbbClass: document.body.classList.contains('foxtel-sbb'),
      viewport: window.innerWidth + 'x' + window.innerHeight,
      ua: navigator.userAgent,
      url: location.pathname,
      focus: shortName(document.activeElement),
      accountHost: m.host,
      dropdown: m.dd,
      keys: keys.slice(-6).join(' '),
      hosts: hostReport(),
      avatars: avatarReport(),
      clicks: clicks,
      network: netState
    };
  }

  function draw() {
    var s = snapshot();
    ensurePanel().textContent =
      'RCU DIAG  v=' + s.scriptVersion + '  css=' + s.cssLoaded + '  sbb=' + s.sbbClass + '\n' +
      'viewport=' + s.viewport + '   net=' + s.network + '\n' +
      'focus : ' + s.focus + '\n' +
      'host  : ' + s.accountHost + '\n' +
      'menu  : ' + s.dropdown + '\n' +
      'keys  : ' + (s.keys || '(none yet)') + '   clicks=' + s.clicks + '\n' +
      'hosts : ' + s.hosts.length + '  ' +
        s.hosts.map(function (h) {
          return '[' + h.i + (h.hasFocus ? '*' : '') + ' img=' + (h.hasImg ? 'y' : 'n') +
                 ' ' + h.ddLinks.slice(0, 28) + ']';
        }).join(' ');
  }

  // ---- sentry ----------------------------------------------------------
  function eventId() {
    var s = '';
    for (var i = 0; i < 32; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
    return s;
  }
  function send(title) {
    var data = snapshot();
    try { console.log('[RCU-DIAG] ' + title, JSON.stringify(data)); } catch (e) {}
    if (!STORE || sent >= MAX_EVENTS) return;
    sent++;
    var evt = {
      event_id: eventId(),
      timestamp: Math.floor(new Date().getTime() / 1000),
      platform: 'javascript', level: 'info', logger: 'foxtel-rcu-diag',
      release: 'foxtel-rcu@' + data.scriptVersion, environment: 'foxtel-biq',
      message: { formatted: 'RCU-DIAG ' + title },
      tags: {
        rcu_diag: '1', rcu_step: title,
        rcu_version: String(data.scriptVersion),
        rcu_viewport: String(data.viewport),
        rcu_css_loaded: String(data.cssLoaded)
      },
      extra: data
    };
    var body = JSON.stringify(evt);
    netState = 'sending';
    try {
      fetch(STORE, { method: 'POST', body: body, mode: 'cors',
                     headers: { 'Content-Type': 'text/plain;charset=UTF-8' } })
        .then(function (r) { netState = 'ok ' + r.status; draw(); })
        .catch(function (e) { netState = 'FAIL ' + (e && e.message ? e.message.slice(0, 30) : '?'); draw(); });
    } catch (e) {
      netState = 'throw';
      try { navigator.sendBeacon(STORE, new Blob([body], { type: 'text/plain;charset=UTF-8' })); } catch (e2) {}
    }
  }

  // ---- listeners -------------------------------------------------------
  function start() {
    draw();
    send('page-load');

    // What does the OK button actually send? This is the key question.
    document.addEventListener('keydown', function (e) {
      keys.push(e.key + '/' + (e.keyCode || e.which));
      draw();
      var a = document.activeElement;
      var onAvatar = a && ((a.className && /avatar|account/i.test(String(a.className))) ||
                           (a.closest && a.closest('.header--menu-account, .navigation-avatar, .navigation-item-with-dropdown')));
      // Report the first few keys whatever has focus. If OK never appears here,
      // the box is not sending a key at all and that is the whole answer.
      if (onAvatar || keys.length <= 3) {
        setTimeout(function () { draw(); send('key-' + e.key + (onAvatar ? '-on-avatar' : '')); }, 350);
      }
    }, true);

    document.addEventListener('click', function () { clicks++; draw(); }, true);
    document.addEventListener('focusin', draw, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else { start(); }
})();
