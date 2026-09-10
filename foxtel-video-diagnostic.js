/**
 * TEMPORARY video pipeline diagnostic for the Foxtel box. Remove when done.
 *
 * Sends ONE event per programme page, 16 seconds after load, summarising what
 * the player did. One event per video watched, so the cost is small.
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  document.addEventListener('turbo:load', function () { sent = false; timeline = []; t0 = Date.now(); start(); });
})();
