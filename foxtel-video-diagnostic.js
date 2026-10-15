/**
 * TEMPORARY video pipeline diagnostic for the Foxtel box. Remove when done.
 *
 * Sends ONE event per programme page, 16 seconds after load, summarising what
 * the player did. One event per video watched, so the cost is small.
 *
 * Also keeps the last state of the app in localStorage, and reports it when
 * the app comes back after a gap of more than a minute (FOX-3001).
 *
 * Paste BELOW the foxtel-rcu script tag in the UScreen head code.
 */
(function () {
  'use strict';
  var DSN = 'https://22e016b0d5141fed558ccda38beb3c41@sentry.servicepilot.com.au/9';
  var d = /^https:\/\/([0-9a-f]+)@([^/]+)\/(\d+)$/.exec(DSN);
  var STORE = d ? 'https://' + d[2] + '/api/' + d[3] + '/store/?sentry_version=7&sentry_key=' + d[1] : null;

  var timeline = [];
  var t0 = Date.now();
  var sent = false;

  function note(what, extra) {
    if (timeline.length > 40) return;
    timeline.push(((Date.now() - t0) / 1000).toFixed(1) + 's ' + what + (extra ? ' ' + extra : ''));
  }

  function vidOf() {
    var vp = document.querySelector('video-player');
    return (vp && vp.querySelector('video')) || document.querySelector('video');
  }

  function snap() {
    var v = vidOf();
    if (!v) return { video: 'none' };
    var src = v.currentSrc || v.src || '';
    var buffered = '';
    try { buffered = v.buffered.length ? Math.round(v.buffered.end(0)) + 's' : 'none'; } catch (e) {}
    return {
      readyState: v.readyState,
      networkState: v.networkState,
      paused: v.paused,
      currentTime: Math.round(v.currentTime * 10) / 10,
      buffered: buffered,
      errorCode: v.error ? v.error.code : null,
      errorMsg: v.error && v.error.message ? String(v.error.message).slice(0, 90) : null,
      srcKind: src.indexOf('blob:') === 0 ? 'blob (uScreen MSE)' : (src ? src.slice(0, 60) : 'none'),
      hlsSource: (function () {
        var s = v.querySelector('source');
        return s && s.src ? s.src.slice(0, 70) : 'no <source>';
      })()
    };
  }

  function eventId() {
    var s = '';
    for (var i = 0; i < 32; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
    return s;
  }

  function send() {
    if (sent || !STORE) return;
    sent = true;
    var final = snap();
    var data = {
      rcuVersion: window.__RCU_VERSION || 'MISSING',
      url: location.pathname,
      ua: navigator.userAgent,
      viewport: window.innerWidth + 'x' + window.innerHeight,
      fullscreen: document.body.classList.contains('rcu-fullscreen-active'),
      hlsJsLoaded: !!window.Hls || 'unknown',
      finalState: final,
      autoPlay: window.__rcuAutoPlay || '(nothing recorded)',
      timeline: timeline
    };
    try { console.log('[RCU-VIDEO]', JSON.stringify(data)); } catch (e) {}
    var evt = {
      event_id: eventId(),
      timestamp: Math.floor(Date.now() / 1000),
      platform: 'javascript', level: final.paused === false ? 'info' : 'warning',
      logger: 'foxtel-video', environment: 'foxtel-biq',
      release: 'foxtel-rcu@' + data.rcuVersion,
      message: { formatted: 'VIDEO ' + (final.paused === false ? 'played' : 'DID NOT PLAY') + ' ' + location.pathname },
      tags: {
        rcu_diag: '1', rcu_video: final.paused === false ? 'played' : 'failed',
        rcu_version: String(data.rcuVersion),
        rcu_ready: String(final.readyState), rcu_err: String(final.errorCode)
      },
      extra: data
    };
    var body = JSON.stringify(evt);
    try {
      fetch(STORE, { method: 'POST', body: body, mode: 'cors',
                     headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(function () {});
    } catch (e) {
      try { navigator.sendBeacon(STORE, new Blob([body], { type: 'text/plain;charset=UTF-8' })); } catch (e2) {}
    }
  }

  // Errors from the remote control script, and any uncaught error at all.
  // A dead remote leaves no trace otherwise: the viewer just sits there
  // pressing buttons that do nothing.
  var errorsSent = 0;
  function sendError(where, err, key) {
    if (errorsSent >= 3 || !STORE) return;
    errorsSent++;
    var evt = {
      event_id: eventId(),
      timestamp: Math.floor(Date.now() / 1000),
      platform: 'javascript', level: 'error', logger: 'foxtel-rcu',
      release: 'foxtel-rcu@' + (window.__RCU_VERSION || 'unknown'),
      environment: 'foxtel-biq',
      message: { formatted: 'RCU ERROR in ' + where + (key ? ' on key ' + key : '') + ': ' +
                            (err && err.message ? err.message : String(err)) },
      tags: { rcu_diag: '1', rcu_error: where, rcu_version: String(window.__RCU_VERSION || 'unknown') },
      extra: {
        where: where, key: key || null,
        message: err && err.message ? String(err.message).slice(0, 300) : String(err).slice(0, 300),
        stack: err && err.stack ? String(err.stack).slice(0, 1200) : '(none)',
        url: location.pathname,
        activeElement: (function () {
          var a = document.activeElement;
          return a ? a.tagName + '.' + String(a.className || '').slice(0, 60) : 'none';
        })(),
        fullscreen: document.body.classList.contains('rcu-fullscreen-active')
      }
    };
    try {
      fetch(STORE, { method: 'POST', body: JSON.stringify(evt), mode: 'cors',
                     headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(function () {});
    } catch (e) {}
  }
  window.__rcuOnError = sendError;
  window.addEventListener('error', function (ev) {
    sendError('window', ev.error || new Error(ev.message), null);
  });
  window.addEventListener('unhandledrejection', function (ev) {
    sendError('promise', ev.reason || new Error('unhandled rejection'), null);
  });

  function start() {
    if (!/^\/programs\//.test(location.pathname)) return;   // only programme pages
    note('page start');
    var v = null, tries = 0;
    var hook = setInterval(function () {
      var nv = vidOf();
      if (nv && nv !== v) {
        v = nv;
        note('video element appeared');
        ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'waiting', 'stalled', 'error', 'emptied'].forEach(function (ev) {
          v.addEventListener(ev, function () {
            note(ev, ev === 'error' && v.error ? 'code=' + v.error.code : '');
          });
        });
      }
      if (++tries > 30) clearInterval(hook);
    }, 500);

    setTimeout(function () { note('snapshot ' + JSON.stringify(snap()).slice(0, 200)); }, 7000);
    setTimeout(send, 16000);
  }

  // --- Last state before a black screen (Foxtel FOX-3001) ---
  //
  // A page that goes black cannot report anything, so each page writes its
  // state to localStorage every 10 seconds. The next page that loads reads
  // it. If the last write is more than a minute old, something stopped the
  // app between the two pages, and this sends what the last page saw: the
  // video, the memory, and whether it was on its way to the next video.
  // A normal close and relaunch also sends one event. Its content shows it.
  var LAST_KEY = 'rcu_last_state';
  var GAP_S = 60;
  var leavingTo = null;

  function mem() {
    try {
      var m = performance.memory;
      return m ? Math.round(m.usedJSHeapSize / 1048576) + '/' + Math.round(m.jsHeapSizeLimit / 1048576) + ' MB' : 'n/a';
    } catch (e) { return 'n/a'; }
  }
  function cidOf(href) { var m = /[?&]cid=(\d+)/.exec(href || ''); return m ? m[1] : ''; }
  function pagesThisRun() {
    try { return +sessionStorage.getItem('rcu_pages') || 0; } catch (e) { return -1; }
  }
  function writeLast(reason) {
    try {
      var s = snap();
      localStorage.setItem(LAST_KEY, JSON.stringify({
        at: Date.now(), reason: reason, path: location.pathname, cid: cidOf(location.search),
        leavingTo: leavingTo, pages: pagesThisRun(), mem: mem(),
        fullscreen: document.body ? document.body.classList.contains('rcu-fullscreen-active') : null,
        video: s.video === 'none' ? 'none' :
          [s.paused ? 'paused' : 'playing', 't' + s.currentTime, 'rs' + s.readyState,
           'ns' + s.networkState, 'err' + s.errorCode, s.srcKind].join(' ')
      }));
    } catch (e) {}
  }
  function checkLast() {
    var last = null;
    try { last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch (e) {}
    if (!last || !last.at || !STORE) return;
    var gap = Math.round((Date.now() - last.at) / 1000);
    if (gap < GAP_S || gap > 6 * 3600) return;
    var kind = last.leavingTo ? 'leaving' :
               last.reason === 'page hide' ? 'closed' :
               (/^\/programs\//.test(last.path) ? 'programme' : 'browse');
    var evt = {
      event_id: eventId(), timestamp: Math.floor(Date.now() / 1000),
      platform: 'javascript', level: kind === 'leaving' ? 'warning' : 'info',
      logger: 'foxtel-session', environment: 'foxtel-biq',
      release: 'foxtel-rcu@' + (window.__RCU_VERSION || 'unknown'),
      message: { formatted: 'LAST STATE ' + kind + ' (' + gap + 's gap) ' + last.path +
                            (last.leavingTo ? ' -> cid ' + cidOf(last.leavingTo) : '') },
      tags: { rcu_diag: '1', rcu_last: kind, rcu_version: String(window.__RCU_VERSION || 'unknown') },
      extra: { last: last, gapSeconds: gap, nowPath: location.pathname, ua: navigator.userAgent }
    };
    try {
      fetch(STORE, { method: 'POST', body: JSON.stringify(evt), mode: 'cors', keepalive: true,
                     headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(function () {});
    } catch (e) {}
  }

  checkLast();
  try { sessionStorage.setItem('rcu_pages', String(pagesThisRun() + 1)); } catch (e) {}
  writeLast('page load');
  setInterval(function () { writeLast('tick'); }, 10000);
  document.addEventListener('turbo:before-visit', function (ev) {
    leavingTo = ev && ev.detail && ev.detail.url ? String(ev.detail.url) : 'unknown';
    writeLast('leaving');
  });
  document.addEventListener('turbo:load', function () {
    leavingTo = null;
    try { sessionStorage.setItem('rcu_pages', String(pagesThisRun() + 1)); } catch (e) {}
    writeLast('page load');
  });
  document.addEventListener('ended', function () { writeLast('video ended'); }, true);
  window.addEventListener('pagehide', function () { writeLast('page hide'); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  document.addEventListener('turbo:load', function () { sent = false; timeline = []; t0 = Date.now(); start(); });
})();
