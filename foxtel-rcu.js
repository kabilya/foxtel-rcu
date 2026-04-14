/**
 * Foxtel Business iQ SBB Remote Control (RCU) Navigation
 *
 * Standalone script for UScreen Head Code Snippets.
 * Runs on ALL pages (login, browse, video, etc.)
 * Reference: FBIQ-018 BiQ Web App Implementation Guide
 *
 * RCU Key Mapping:
 *   Arrows     -> ArrowUp/Down/Left/Right (spatial navigation)
 *   OK/Select  -> Enter (activate focused element)
 *   Back/Last  -> Escape (close menus / go back)
 *   Exit       -> "e" (SBB returns to launcher)
 *   Pause      -> "p"
 *   Play/Stop  -> MediaPlayPause / MediaStop
 *   Rewind     -> MediaRewind (-10s)
 *   Fast Fwd   -> MediaFastForward (+10s)
 */
(function() {
  'use strict';

  // Only fully activate on SBB, but focus-visible styles help desktop testing too
  var isSBB = /ADBChromium|Foxtel_STB|Linux aarch64/i.test(navigator.userAgent);

  function init() {
    if (isSBB) {
      document.body.classList.add('foxtel-sbb');

      // Make video elements focusable
      document.querySelectorAll('video').forEach(function(v) {
        if (!v.hasAttribute('tabindex')) v.setAttribute('tabindex', '0');
      });

      // Hint to the SBB that text inputs should trigger the soft keyboard
      document.querySelectorAll('input[type="email"], input[type="text"], input[type="password"], input:not([type])').forEach(function(inp) {
        if (!inp.hasAttribute('inputmode')) {
          inp.setAttribute('inputmode', inp.type === 'email' ? 'email' : 'text');
        }
        inp.setAttribute('enterkeyhint', 'done');
      });
    }

    // --- Focusable element selector ---
    var FOCUSABLE = [
      'a[href]:not([disabled]):not([aria-hidden="true"])',
      'a[data-action]:not([disabled])',
      'button:not([disabled]):not([aria-hidden="true"])',
      '[tabindex]:not([tabindex="-1"]):not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      'video',
      'video-player',
      'video-play-button',
      'ds-button',
      'ds-input',
      '[role="button"]:not([disabled])',
      '[role="switch"]',
      '[onclick]:not([disabled])'
    ].join(', ');

    function getVisibleFocusables() {
      var els = document.querySelectorAll(FOCUSABLE);
      var out = [];
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        // Use getBoundingClientRect for Web Components (offsetParent
        // can be null for custom elements even when visible)
        var rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          // Skip keyboard overlay elements
          if (_kbdOverlay && _kbdOverlay.contains(el)) continue;
          var s = window.getComputedStyle(el);
          if (s.visibility !== 'hidden' && s.display !== 'none') {
            out.push(el);
          }
        }
      }
      // CR1: Skip text-content slides — keep only image slides for navigation
      var filtered = [];
      for (var k = 0; k < out.length; k++) {
        if (out[k].classList && out[k].classList.contains('columns--card')) continue;
        filtered.push(out[k]);
      }
      out = filtered;

      // De-duplicate <a> elements with same href near each other (slider cards
      // render image + text as separate links to the same URL)
      var deduped = [];
      var seen = {};
      for (var j = 0; j < out.length; j++) {
        var el2 = out[j];
        if (el2.tagName !== 'A' || !el2.href) {
          deduped.push(el2);
          continue;
        }
        // CR2: Never dedup navigation links like "See All"
        var linkText = el2.textContent ? el2.textContent.trim() : '';
        if (linkText === 'See All' || linkText === 'See all' || linkText === 'View All') {
          deduped.push(el2);
          continue;
        }
        var href = el2.href;
        var r2 = el2.getBoundingClientRect();
        var cy2 = r2.top + r2.height / 2;
        var area2 = r2.width * r2.height;
        if (seen[href]) {
          var prev = seen[href];
          if (Math.abs(prev.cy - cy2) < 50) {
            if (area2 > prev.area) {
              deduped[prev.index] = el2;
              seen[href] = { cy: cy2, area: area2, index: prev.index };
            }
            continue;
          }
        }
        seen[href] = { cy: cy2, area: area2, index: deduped.length };
        deduped.push(el2);
      }
      out = deduped;

      return out;
    }

    function getRect(el) {
      var r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    function findNext(current, direction) {
      var all = getVisibleFocusables();
      var from = getRect(current);
      var best = null;
      var bestDist = Infinity;

      for (var i = 0; i < all.length; i++) {
        if (all[i] === current) continue;
        // Skip if candidate is a child of current or vice versa
        if (current.contains(all[i]) || all[i].contains(current)) continue;

        var to = getRect(all[i]);
        var dx = to.x - from.x;
        var dy = to.y - from.y;

        var ok = false;
        switch (direction) {
          case 'ArrowUp':    ok = dy < -5; break;
          case 'ArrowDown':  ok = dy > 5;  break;
          case 'ArrowLeft':  ok = dx < -5; break;
          case 'ArrowRight': ok = dx > 5;  break;
        }
        if (!ok) continue;

        var main, cross;
        if (direction === 'ArrowUp' || direction === 'ArrowDown') {
          main = Math.abs(dy); cross = Math.abs(dx);
        } else {
          main = Math.abs(dx); cross = Math.abs(dy);
        }
        var dist = main + cross * 3;

        if (dist < bestDist) {
          bestDist = dist;
          best = all[i];
        }
      }
      return best;
    }

    function ensureVisible(el) {
      var r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight ||
          r.left < 0 || r.right > window.innerWidth) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    }

    // Focus the best starting element on the page
    function focusFirst() {
      // Prefer video-player (video detail pages)
      var vp = document.querySelector('video-player');
      if (vp && vp.getBoundingClientRect().height > 0) {
        vp.focus();
        return;
      }
      // Then input fields (login page)
      var input = document.querySelector('input:not([type="hidden"]):not([disabled])');
      if (input && input.offsetParent !== null) {
        input.focus();
        return;
      }
      var list = getVisibleFocusables();
      if (list.length) list[0].focus();
    }

    // Find the real focusable element inside a Web Component
    function getFocusTarget(el) {
      if (!el) return el;
      // UScreen <ds-input>: focus the inner <input>
      if (el.tagName === 'DS-INPUT') {
        var inner = el.querySelector('input');
        if (inner) return inner;
      }
      // UScreen <ds-button>: uses shadowrootdelegatesfocus so
      // focusing the host element delegates to the inner button.
      // Do NOT querySelector('button') — it finds a hidden
      // off-screen fallback button instead of the shadow DOM one.
      if (el.tagName === 'DS-BUTTON') {
        return el;
      }
      return el;
    }

    // --- On-Screen Keyboard for SBB ---
    var _kbdOverlay = null;
    var _kbdOpen = false;
    var _kbdTarget = null;
    var _kbdIsPassword = false;
    var _kbdShift = false;
    var _kbdRow = 3;
    var _kbdCol = 0;
    var _kbdRows = [];  // 2D array of key elements

    var KBD_LAYOUTS = [
      [{l:'1', k:'1'}, {l:'2', k:'2'}, {l:'3', k:'3'}, {l:'4', k:'4'}, {l:'5', k:'5'}, {l:'6', k:'6'}, {l:'7', k:'7'}, {l:'8', k:'8'}, {l:'9', k:'9'}, {l:'0', k:'0'}],
      [{l:'!', k:'!'}, {l:'@', k:'@'}, {l:'#', k:'#'}, {l:'$', k:'$'}, {l:'%', k:'%'}, {l:'&', k:'&'}, {l:'*', k:'*'}, {l:'+', k:'+'}, {l:'=', k:'='}, {l:'?', k:'?'}],
      [{l:'.', k:'.'}, {l:'.com', a:'dotcom'}, {l:'-', k:'-'}, {l:'_', k:'_'}, {l:'/', k:'/'}, {l:'(', k:'('}, {l:')', k:')'}, {l:'"', k:'"'}, {l:"'", k:"'"}],
      [{l:'q'}, {l:'w'}, {l:'e'}, {l:'r'}, {l:'t'}, {l:'y'}, {l:'u'}, {l:'i'}, {l:'o'}, {l:'p'}],
      [{l:'a'}, {l:'s'}, {l:'d'}, {l:'f'}, {l:'g'}, {l:'h'}, {l:'j'}, {l:'k'}, {l:'l'}],
      [{l:'SHIFT', a:'shift', w:true}, {l:'z'}, {l:'x'}, {l:'c'}, {l:'v'}, {l:'b'}, {l:'n'}, {l:'m'}, {l:'DEL', a:'backspace', w:true}],
      [{l:'SPACE', a:'space', s:true}, {l:'DONE', a:'done', d:true}]
    ];

    function buildKeyboard() {
      _kbdOverlay = document.createElement('div');
      _kbdOverlay.id = 'sbb-kbd-overlay';

      var container = document.createElement('div');
      container.id = 'sbb-kbd-container';

      var label = document.createElement('div');
      label.id = 'sbb-kbd-label';
      label.textContent = '';
      container.appendChild(label);

      var preview = document.createElement('div');
      preview.id = 'sbb-kbd-preview';
      preview.innerHTML = '<span class="sbb-kbd-cursor">|</span>';
      container.appendChild(preview);

      var grid = document.createElement('div');
      grid.id = 'sbb-kbd-grid';

      for (var r = 0; r < KBD_LAYOUTS.length; r++) {
        var rowData = KBD_LAYOUTS[r];
        var rowEl = document.createElement('div');
        rowEl.className = 'sbb-kbd-row';
        _kbdRows[r] = [];

        for (var c = 0; c < rowData.length; c++) {
          var kd = rowData[c];
          var keyEl = document.createElement('span');
          keyEl.className = 'sbb-kbd-key';
          if (kd.w) keyEl.className += ' sbb-kbd-wide';
          if (kd.s) keyEl.className += ' sbb-kbd-space';
          if (kd.d) keyEl.className += ' sbb-kbd-done';
          keyEl.textContent = kd.l;
          if (kd.a) keyEl.setAttribute('data-action', kd.a);
          if (kd.k) keyEl.setAttribute('data-key', kd.k);
          if (!kd.a && !kd.k) keyEl.setAttribute('data-key', kd.l);
          rowEl.appendChild(keyEl);
          _kbdRows[r][c] = keyEl;
        }
        grid.appendChild(rowEl);
      }

      container.appendChild(grid);
      _kbdOverlay.appendChild(container);
      document.body.appendChild(_kbdOverlay);
    }

    function kbdUpdateHighlight() {
      for (var r = 0; r < _kbdRows.length; r++) {
        for (var c = 0; c < _kbdRows[r].length; c++) {
          var cl = _kbdRows[r][c].className.replace(/ ?sbb-kbd-highlight/g, '');
          _kbdRows[r][c].className = cl;
        }
      }
      _kbdRows[_kbdRow][_kbdCol].className += ' sbb-kbd-highlight';
    }

    function kbdUpdatePreview() {
      if (!_kbdTarget) return;
      var val = _kbdTarget.value || '';
      var preview = document.getElementById('sbb-kbd-preview');
      if (!preview) return;
      var display = '';
      if (_kbdIsPassword) {
        for (var i = 0; i < val.length; i++) display += '\u2022';
      } else {
        display = val;
      }
      preview.innerHTML = '';
      preview.appendChild(document.createTextNode(display));
      var cursor = document.createElement('span');
      cursor.className = 'sbb-kbd-cursor';
      cursor.textContent = '|';
      preview.appendChild(cursor);
    }

    function kbdFireInputEvents(el) {
      try {
        el.dispatchEvent(new Event('input', {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
      } catch (ex) {
        // Fallback for older browsers
        var evt = document.createEvent('Event');
        evt.initEvent('input', true, true);
        el.dispatchEvent(evt);
        var evt2 = document.createEvent('Event');
        evt2.initEvent('change', true, true);
        el.dispatchEvent(evt2);
      }
    }

    function openKeyboard(inputEl) {
      // Rebuild keyboard if Turbo navigation destroyed it
      if (!_kbdOverlay || !document.getElementById('sbb-kbd-overlay')) {
        _kbdOverlay = null;
        _kbdRows = [];
        buildKeyboard();
      }
      if (!_kbdOverlay) return;
      // Ensure SBB class is on body (Turbo may have replaced it)
      document.body.classList.add('foxtel-sbb');
      // Resolve to the actual <input> inside <ds-input>
      _kbdTarget = getFocusTarget(inputEl);
      // Walk up to check if it's inside a ds-input with type password
      var parent = inputEl;
      if (inputEl.tagName === 'INPUT') {
        parent = inputEl.parentElement;
        // Check shadow host if inside shadow DOM
        if (inputEl.getRootNode && inputEl.getRootNode() !== document) {
          var root = inputEl.getRootNode();
          if (root.host) parent = root.host;
        }
      }
      _kbdIsPassword = (_kbdTarget.type === 'password');

      var label = document.getElementById('sbb-kbd-label');
      if (label) {
        // Try to find a label for this input
        var labelText = '';
        if (parent && parent.tagName === 'DS-INPUT') {
          var lbl = parent.getAttribute('label') || parent.getAttribute('placeholder') || '';
          labelText = lbl;
        }
        if (!labelText && _kbdTarget.placeholder) {
          labelText = _kbdTarget.placeholder;
        }
        if (!labelText) {
          labelText = _kbdIsPassword ? 'Password' : 'Email';
        }
        label.textContent = labelText;
      }

      _kbdShift = false;
      _kbdRow = 3;
      _kbdCol = 0;
      _kbdOpen = true;
      _kbdOverlay.className = 'sbb-kbd-visible';

      kbdUpdateShiftDisplay();
      kbdUpdateHighlight();
      kbdUpdatePreview();
    }

    function closeKeyboard(advanceFocus) {
      if (!_kbdOverlay) return;
      _kbdOpen = false;
      _kbdOverlay.className = '';

      if (advanceFocus && _kbdTarget) {
        // Find the ds-input or input that was being edited
        var el = _kbdTarget;
        // Try to get the host element for spatial navigation
        if (el.getRootNode && el.getRootNode() !== document) {
          var root = el.getRootNode();
          if (root.host) el = root.host;
        }
        var next = findNext(el, 'ArrowDown');
        if (next) {
          var target = getFocusTarget(next);
          target.focus();
          ensureVisible(target);
        }
      }
      _kbdTarget = null;
    }

    function kbdNavigate(direction) {
      if (direction === 'ArrowLeft') {
        _kbdCol--;
        if (_kbdCol < 0) _kbdCol = _kbdRows[_kbdRow].length - 1;
      } else if (direction === 'ArrowRight') {
        _kbdCol++;
        if (_kbdCol >= _kbdRows[_kbdRow].length) _kbdCol = 0;
      } else if (direction === 'ArrowUp') {
        _kbdRow--;
        if (_kbdRow < 0) _kbdRow = _kbdRows.length - 1;
        if (_kbdCol >= _kbdRows[_kbdRow].length) _kbdCol = _kbdRows[_kbdRow].length - 1;
      } else if (direction === 'ArrowDown') {
        _kbdRow++;
        if (_kbdRow >= _kbdRows.length) _kbdRow = 0;
        if (_kbdCol >= _kbdRows[_kbdRow].length) _kbdCol = _kbdRows[_kbdRow].length - 1;
      }
      kbdUpdateHighlight();
    }

    function kbdUpdateShiftDisplay() {
      // Update letter key labels and shift key styling (rows 3-5 = qwerty rows)
      for (var r = 3; r <= 5; r++) {
        for (var c = 0; c < _kbdRows[r].length; c++) {
          var keyEl = _kbdRows[r][c];
          var action = keyEl.getAttribute('data-action');
          if (action === 'shift') {
            var cl = keyEl.className.replace(/ ?sbb-kbd-shift-on/g, '');
            keyEl.className = _kbdShift ? cl + ' sbb-kbd-shift-on' : cl;
          } else if (!action) {
            var k = keyEl.getAttribute('data-key');
            if (k && k.length === 1 && k >= 'a' && k <= 'z') {
              keyEl.textContent = _kbdShift ? k.toUpperCase() : k;
            }
          }
        }
      }
    }

    function kbdSelect() {
      if (!_kbdTarget) return;
      var keyEl = _kbdRows[_kbdRow][_kbdCol];
      var action = keyEl.getAttribute('data-action');

      if (action === 'shift') {
        _kbdShift = !_kbdShift;
        kbdUpdateShiftDisplay();
        kbdUpdateHighlight();
        return;
      }
      if (action === 'backspace') {
        var val = _kbdTarget.value;
        if (val.length > 0) {
          _kbdTarget.value = val.substring(0, val.length - 1);
          kbdFireInputEvents(_kbdTarget);
        }
        kbdUpdatePreview();
        return;
      }
      if (action === 'space') {
        _kbdTarget.value += ' ';
        kbdFireInputEvents(_kbdTarget);
        kbdUpdatePreview();
        return;
      }
      if (action === 'dotcom') {
        _kbdTarget.value += '.com';
        kbdFireInputEvents(_kbdTarget);
        kbdUpdatePreview();
        return;
      }
      if (action === 'done') {
        closeKeyboard(true);
        return;
      }

      // Regular character key
      var ch = keyEl.getAttribute('data-key');
      if (ch) {
        if (_kbdShift && ch.length === 1 && ch >= 'a' && ch <= 'z') {
          ch = ch.toUpperCase();
        }
        _kbdTarget.value += ch;
        kbdFireInputEvents(_kbdTarget);
        // Auto-disable shift after typing a letter (like mobile keyboards)
        if (_kbdShift) {
          _kbdShift = false;
          kbdUpdateShiftDisplay();
        }
        kbdUpdatePreview();
      }
    }

    function kbdDirectInput(key) {
      if (!_kbdTarget) return;
      var ch = key;
      if (_kbdShift && ch.length === 1 && ch >= 'a' && ch <= 'z') {
        ch = ch.toUpperCase();
        _kbdShift = false;
        kbdUpdateShiftDisplay();
      }
      _kbdTarget.value += ch;
      kbdFireInputEvents(_kbdTarget);
      kbdUpdatePreview();
    }

    if (isSBB) {
      buildKeyboard();
      focusFirst();
    }

    // --- Volume indicator ---
    var _volTimer = null;
    function showVolumeIndicator(level) {
      var el = document.getElementById('sbb-vol-indicator');
      if (!el) {
        el = document.createElement('div');
        el.id = 'sbb-vol-indicator';
        el.style.cssText = 'position:fixed;top:10%;right:5%;background:rgba(0,0,0,0.8);color:#FFB800;padding:12px 20px;border-radius:8px;font-size:24px;z-index:99998;pointer-events:none;';
        document.body.appendChild(el);
      }
      el.textContent = 'Volume: ' + Math.round(level * 100) + '%';
      el.style.display = 'block';
      if (_volTimer) clearTimeout(_volTimer);
      _volTimer = setTimeout(function() { el.style.display = 'none'; }, 1500);
    }

    // --- Fullscreen helpers ---
    function enterFullscreen(el) {
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(function() {});
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }
    }

    function exitFullscreen() {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(function() {});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
    }

    // --- HLS Fallback for SBB ---
    // UScreen's video-player component often fails to initialize its
    // internal HLS player on the SBB's Chromium 105. When we detect a
    // video with readyState 0 / networkState 3, manually load hls.js
    // and attach it to the <video> element.
    var _hlsInstance = null;
    var HLS_CDN = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.7/+esm';

    function fixVideoPlayback() {
      var vp = document.querySelector('video-player');
      if (!vp) return;
      var vid = vp.querySelector('video');
      if (!vid) return;
      // Only intervene if the video hasn't loaded (readyState 0 = HAVE_NOTHING)
      if (vid.readyState > 0) return;
      var source = vid.querySelector('source');
      if (!source || !source.src) return;
      var src = source.src;
      // Only fix .m3u8 (HLS) streams
      if (src.indexOf('.m3u8') === -1) return;

      // Dynamically import hls.js and attach to the video
      import(HLS_CDN).then(function(m) {
        var Hls = m.default;
        if (!Hls.isSupported()) return;
        // Clean up any previous instance
        if (_hlsInstance) {
          _hlsInstance.destroy();
          _hlsInstance = null;
        }
        var hls = new Hls();
        _hlsInstance = hls;
        hls.loadSource(src);
        hls.attachMedia(vid);
        hls.on(Hls.Events.ERROR, function(event, data) {
          if (data.fatal) {
            console.log('RCU: HLS fatal error', data.type, data.details);
            hls.destroy();
            _hlsInstance = null;
          }
        });
      }).catch(function(e) {
        console.log('RCU: failed to load hls.js', e.message);
      });
    }

    function scheduleVideoFix() {
      setTimeout(fixVideoPlayback, 2000);
    }
    scheduleVideoFix();
    document.addEventListener('turbo:load', scheduleVideoFix);

    // --- CR5: Auto-enable autoplay on SBB ---
    function enableAutoplay() {
      // Try checkbox-style toggles
      var checks = document.querySelectorAll('[class*="autoplay"] input[type="checkbox"]');
      for (var i = 0; i < checks.length; i++) {
        if (!checks[i].checked) {
          checks[i].checked = true;
          try { checks[i].dispatchEvent(new Event('change', {bubbles: true})); } catch (ex) {}
        }
      }
      // Try button/switch-style toggles
      var switches = document.querySelectorAll('[class*="autoplay"] [role="switch"], [class*="autoplay"] button');
      for (var j = 0; j < switches.length; j++) {
        if (switches[j].getAttribute('aria-checked') === 'false') {
          switches[j].click();
        }
      }
    }

    // --- CR3: Auto-play next video when current one ends ---
    function onVideoEnded() {
      exitFullscreen();
      // Look for "next video" section on the page
      var nextSection = document.querySelector('[class*="next-video"], [class*="up-next"], [class*="next_video"]');
      if (nextSection) {
        var link = nextSection.querySelector('a[href]');
        if (link) { window.location.href = link.href; return; }
      }
      // Fallback: find any program link below the player that isn't the current page
      var links = document.querySelectorAll('a[href*="/programs/"]');
      var current = window.location.pathname;
      for (var i = 0; i < links.length; i++) {
        if (links[i].pathname !== current) {
          window.location.href = links[i].href;
          return;
        }
      }
    }

    function setupAutoplayNext() {
      var vid = document.querySelector('video-player video') || document.querySelector('video');
      if (!vid) return;
      vid.removeEventListener('ended', onVideoEnded);
      vid.addEventListener('ended', onVideoEnded);
    }

    // --- Auto-play video on page load ---
    // SBB's embedded Chromium allows fullscreen without user gesture.
    // Desktop Chrome does not, so only auto-fullscreen on SBB.
    function autoPlayVideo() {
      var vp = document.querySelector('video-player');
      if (!vp) return;
      var vid = vp.querySelector('video');
      if (!vid) return;
      if (!vid.paused) return;
      vid.muted = false;
      vid.volume = 1;
      // If HLS hasn't loaded on SBB, trigger fallback first
      if (vid.readyState === 0 && isSBB) {
        fixVideoPlayback();
        setTimeout(function() {
          var v = document.querySelector('video-player video');
          if (v && v.paused) {
            v.muted = false;
            v.volume = 1;
            if (isSBB) enterFullscreen(v);
            v.play().catch(function() {
              v.muted = true;
              v.play().then(function() { v.muted = false; }).catch(function() {});
            });
          }
        }, 1500);
      } else {
        if (isSBB) enterFullscreen(vid);
        vid.play().catch(function() {
          vid.muted = true;
          vid.play().then(function() { vid.muted = false; }).catch(function() {});
        });
      }
    }

    setTimeout(enableAutoplay, 3000);
    setTimeout(setupAutoplayNext, 3000);
    setTimeout(autoPlayVideo, 3000);
    document.addEventListener('turbo:load', function() {
      setTimeout(enableAutoplay, 2000);
      setTimeout(setupAutoplayNext, 2000);
      setTimeout(autoPlayVideo, 3000);
    });

    // --- Main keydown handler ---
    // Use CAPTURE phase (true) so we intercept keys before shadow DOM
    // elements like <ds-input> can consume them
    document.addEventListener('keydown', function(e) {
      var key = e.key;

      // --- On-screen keyboard intercept (consumes ALL keys when open) ---
      if (_kbdOpen) {
        e.preventDefault();
        e.stopPropagation();
        if (key === 'ArrowUp' || key === 'ArrowDown' ||
            key === 'ArrowLeft' || key === 'ArrowRight') {
          kbdNavigate(key);
        } else if (key === 'Enter') {
          kbdSelect();
        } else if (key === 'Escape') {
          closeKeyboard(false);
        } else if (key === 'Backspace') {
          // Direct backspace support
          if (_kbdTarget && _kbdTarget.value.length > 0) {
            _kbdTarget.value = _kbdTarget.value.substring(0, _kbdTarget.value.length - 1);
            kbdFireInputEvents(_kbdTarget);
            kbdUpdatePreview();
          }
        } else if (/^[a-zA-Z0-9@.\-_]$/.test(key)) {
          kbdDirectInput(key);
        }
        return;
      }

      // Directional navigation (LRUD)
      if (key === 'ArrowUp' || key === 'ArrowDown' ||
          key === 'ArrowLeft' || key === 'ArrowRight') {

        // CR4: In fullscreen, Up/Down arrows control volume
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          var fsVid = document.querySelector('video');
          if (fsVid && (key === 'ArrowUp' || key === 'ArrowDown')) {
            if (key === 'ArrowUp') {
              fsVid.volume = Math.min(1, Math.round((fsVid.volume + 0.1) * 10) / 10);
              fsVid.muted = false;
            } else {
              fsVid.volume = Math.max(0, Math.round((fsVid.volume - 0.1) * 10) / 10);
            }
            showVolumeIndicator(fsVid.volume);
            e.preventDefault();
            return;
          }
        }

        // Check if we're inside a text input
        var active = document.activeElement;
        var tag = active ? active.tagName : '';
        var isInput = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');

        // Allow left/right for cursor movement in inputs
        if (isInput && (key === 'ArrowLeft' || key === 'ArrowRight')) return;

        // For Up/Down in an input: closest() can't cross shadow DOM
        // boundaries, so we find the next element by comparing Y
        // positions directly against all visible focusables
        if (isInput && (key === 'ArrowUp' || key === 'ArrowDown')) {
          e.preventDefault();
          e.stopPropagation();
          var inputRect = active.getBoundingClientRect();
          var inputCy = inputRect.top + inputRect.height / 2;
          var best = null;
          var bestDist = Infinity;
          var all = getVisibleFocusables();
          for (var j = 0; j < all.length; j++) {
            if (all[j] === active) continue;
            // Skip the parent ds-input of the current input (avoid double-match)
            if (all[j].contains && all[j].contains(active)) continue;
            var cr = all[j].getBoundingClientRect();
            var cy = cr.top + cr.height / 2;
            var dy = cy - inputCy;
            if (key === 'ArrowDown' && dy > 5 && Math.abs(dy) < bestDist) {
              bestDist = Math.abs(dy); best = all[j];
            }
            if (key === 'ArrowUp' && dy < -5 && Math.abs(dy) < bestDist) {
              bestDist = Math.abs(dy); best = all[j];
            }
          }
          if (best) {
            var target = getFocusTarget(best);
            active.blur();
            target.focus();
            ensureVisible(target);
          }
          return;
        }

        e.preventDefault();

        if (!active || active === document.body || active === document.documentElement) {
          focusFirst();
          return;
        }

        // Swiper carousel support
        var swiper = active.closest && active.closest('.swiper');
        if (swiper && swiper.swiper) {
          if (key === 'ArrowLeft') swiper.swiper.slidePrev();
          if (key === 'ArrowRight') swiper.swiper.slideNext();
        }

        var next = findNext(active, key);
        // If ArrowRight found nothing, try "See All" at similar Y level
        if (!next && key === 'ArrowRight') {
          var activeRect = active.getBoundingClientRect();
          var activeCy = activeRect.top + activeRect.height / 2;
          var seeAlls = document.querySelectorAll('.category-see-all a');
          var bestSA = null;
          var bestSADist = Infinity;
          for (var sa = 0; sa < seeAlls.length; sa++) {
            var saRect = seeAlls[sa].getBoundingClientRect();
            if (saRect.width === 0) continue;
            var saCy = saRect.top + saRect.height / 2;
            var saDistY = Math.abs(saCy - activeCy);
            if (saDistY < 150 && saDistY < bestSADist) {
              bestSADist = saDistY;
              bestSA = seeAlls[sa];
            }
          }
          if (bestSA) next = bestSA;
        }
        // If ArrowLeft from "See All", go back to nearest thumbnail
        if (!next && key === 'ArrowLeft' && active.closest && active.closest('.category-see-all')) {
          next = findNext(active, 'ArrowLeft');
          if (!next) {
            var allFocus = getVisibleFocusables();
            var actRect = active.getBoundingClientRect();
            var actCy = actRect.top + actRect.height / 2;
            var bestLeft = null;
            var bestLeftDist = Infinity;
            for (var lf = 0; lf < allFocus.length; lf++) {
              if (allFocus[lf] === active) continue;
              var lfRect = allFocus[lf].getBoundingClientRect();
              var lfCy = lfRect.top + lfRect.height / 2;
              if (Math.abs(lfCy - actCy) < 150 && lfRect.left < actRect.left) {
                var lfDist = actRect.left - lfRect.left + Math.abs(lfCy - actCy);
                if (lfDist < bestLeftDist) {
                  bestLeftDist = lfDist;
                  bestLeft = allFocus[lf];
                }
              }
            }
            if (bestLeft) next = bestLeft;
          }
        }
        if (next) {
          var target = getFocusTarget(next);
          target.focus();
          ensureVisible(target);
        }
        return;
      }

      // OK / Select (Enter)
      if (key === 'Enter') {
        var focused = document.activeElement;
        if (!focused || focused === document.body) return;

        // Input fields: on SBB, open the on-screen keyboard
        if (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA') {
          if (isSBB) {
            e.preventDefault();
            openKeyboard(focused);
            return;
          }
          // Non-SBB: allow default behavior (form submission)
          return;
        }

        // Video element: toggle play/pause
        if (focused.tagName === 'VIDEO') {
          if (focused.paused) focused.play(); else focused.pause();
          e.preventDefault();
          return;
        }

        // UScreen <video-player>: play + enter fullscreen on Enter/OK.
        // We handle this ourselves because UScreen's player fails on SBB.
        if (focused.tagName === 'VIDEO-PLAYER' ||
            (focused.closest && focused.closest('video-player'))) {
          e.preventDefault();
          e.stopPropagation();
          var vp = focused.tagName === 'VIDEO-PLAYER' ? focused : focused.closest('video-player');
          var vid = vp.querySelector('video');
          if (vid) {
            // Unmute immediately while we still have user gesture context
            vid.muted = false;
            vid.volume = 1;
            // If already playing, toggle pause and exit fullscreen
            if (!vid.paused) {
              vid.pause();
              exitFullscreen();
              return;
            }
            // Enter fullscreen on the video element
            enterFullscreen(vid);
            // If HLS hasn't loaded, trigger fallback then play
            if (vid.readyState === 0) {
              fixVideoPlayback();
              setTimeout(function() {
                var v = document.querySelector('video-player video');
                if (v) {
                  v.muted = false;
                  v.volume = 1;
                  if (v.paused) v.play().catch(function() {});
                }
              }, 1500);
            } else {
              vid.play().catch(function() {});
            }
          }
          return;
        }

        // UScreen <ds-button>: click the element directly.
        // The shadow DOM delegates focus/click to the inner button.
        // Also check for onclick handlers (e.g. "Sign in with password")
        if (focused.tagName === 'DS-BUTTON') {
          if (focused.onclick) {
            focused.onclick();
          } else {
            focused.click();
          }
          e.preventDefault();
          return;
        }

        // Theme video play-button overlay
        if (focused.closest && focused.closest('.theme\\:video--play-button')) {
          var playBtn = focused.closest('.theme\\:video--play-button');
          if (playBtn.onclick) playBtn.onclick();
          e.preventDefault();
          return;
        }

        // All other elements: simulate click
        focused.click();
        e.preventDefault();
        return;
      }

      // Back / Last (Escape)
      if (key === 'Escape') {
        // If in fullscreen, exit fullscreen and pause video
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          var fsVideo = document.querySelector('video');
          if (fsVideo && !fsVideo.paused) fsVideo.pause();
          exitFullscreen();
          e.preventDefault();
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        // Pause any playing video before navigating back
        var playingVid = document.querySelector('video');
        if (playingVid && !playingVid.paused) {
          playingVid.pause();
        }

        // Blur any focused input/button first so shadow DOM
        // doesn't swallow the event
        var ae = document.activeElement;
        if (ae && ae !== document.body) {
          ae.blur();
        }

        if (document.body.classList.contains('opened-menu')) {
          document.body.classList.remove('opened-menu');
          return;
        }
        var openFaq = document.querySelector('.faq-opened');
        if (openFaq) {
          var faqContent = openFaq.querySelector('.faq-content');
          if (faqContent) faqContent.style.height = 0;
          openFaq.classList.remove('faq-opened');
          e.preventDefault();
          return;
        }
        var openDrop = document.querySelector('.navigation-item-opened');
        if (openDrop) {
          openDrop.classList.remove('navigation-item-opened');
          e.preventDefault();
          return;
        }
        // Go back. If no history (common on SBB), fall back to catalog/home.
        var beforeBack = window.location.href;
        window.history.back();
        // Check after a short delay if navigation happened
        setTimeout(function() {
          if (window.location.href === beforeBack) {
            // history.back() didn't navigate — go to catalog
            window.location.href = '/catalog';
          }
        }, 300);
        e.preventDefault();
        return;
      }

      // Exit key — prevent typing "e" on SBB (SBB handles exit)
      if (key === 'e' && isSBB) {
        var activeTag = document.activeElement ? document.activeElement.tagName : '';
        if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
          e.preventDefault();
          return;
        }
      }

      // Media keys for video playback
      var video = document.querySelector('video');
      if (video) {
        switch (key) {
          case 'MediaPlayPause':
            if (video.paused) {
              video.muted = false;
              video.volume = 1;
              video.play();
              enterFullscreen(video);
            } else {
              video.pause();
              exitFullscreen();
            }
            e.preventDefault(); break;
          case 'MediaStop':
            video.pause(); video.currentTime = 0;
            exitFullscreen();
            e.preventDefault(); break;
          case 'p':
            // Only pause if not typing in an input
            var pTag = document.activeElement ? document.activeElement.tagName : '';
            if (pTag !== 'INPUT' && pTag !== 'TEXTAREA') {
              video.pause();
              exitFullscreen();
              e.preventDefault();
            }
            break;
          case 'MediaRewind':
            video.currentTime = Math.max(0, video.currentTime - 10);
            e.preventDefault(); break;
          case 'MediaFastForward':
            video.currentTime = Math.min(video.duration, video.currentTime + 10);
            e.preventDefault(); break;
          case 'VolumeUp':
            video.volume = Math.min(1, Math.round((video.volume + 0.1) * 10) / 10);
            video.muted = false;
            showVolumeIndicator(video.volume);
            e.preventDefault(); break;
          case 'VolumeDown':
            video.volume = Math.max(0, Math.round((video.volume - 0.1) * 10) / 10);
            showVolumeIndicator(video.volume);
            e.preventDefault(); break;
        }
      }
    }, true); // capture phase — intercept before shadow DOM

    // Prevent keyup default for navigation keys (also capture phase)
    document.addEventListener('keyup', function(e) {
      if (_kbdOpen) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Let browser handle Escape keyup in fullscreen (needed to exit fullscreen)
      if (e.key === 'Escape' && (document.fullscreenElement || document.webkitFullscreenElement)) {
        return;
      }
      var nav = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape'];
      if (nav.indexOf(e.key) !== -1) {
        var tag = document.activeElement ? document.activeElement.tagName : '';
        // Don't prevent in inputs (breaks form behavior)
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
        }
      }
    }, true);
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
