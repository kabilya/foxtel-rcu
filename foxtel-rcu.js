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
  var isSBB = /ADBChromium|Foxtel_STB/i.test(navigator.userAgent);

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
      // Prefer input fields (login page), then links/buttons
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
    var _kbdRow = 1;
    var _kbdCol = 0;
    var _kbdRows = [];  // 2D array of key elements

    var KBD_LAYOUTS = [
      [{l:'@', k:'@'}, {l:'.', k:'.'}, {l:'.com', a:'dotcom'}, {l:'-', k:'-'}, {l:'_', k:'_'}],
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
      if (!_kbdOverlay) return;
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
      _kbdRow = 1;
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
      // Update letter key labels and shift key styling
      for (var r = 1; r <= 3; r++) {
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

        // UScreen <video-player> Web Component: play/pause the
        // inner <video> instead of clicking (which triggers fullscreen)
        if (focused.tagName === 'VIDEO-PLAYER' ||
            (focused.closest && focused.closest('video-player'))) {
          var vp = focused.tagName === 'VIDEO-PLAYER' ? focused : focused.closest('video-player');
          var vid = vp.querySelector('video');
          if (vid) {
            if (vid.paused) vid.play(); else vid.pause();
            e.preventDefault();
            return;
          }
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
        e.preventDefault();
        e.stopPropagation();

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
        // Always attempt to go back — history.length can be unreliable
        // on SBB. If there's no history, this is a no-op.
        window.history.back();
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
            if (video.paused) video.play(); else video.pause();
            e.preventDefault(); break;
          case 'MediaStop':
            video.pause(); video.currentTime = 0;
            e.preventDefault(); break;
          case 'p':
            // Only pause if not typing in an input
            var pTag = document.activeElement ? document.activeElement.tagName : '';
            if (pTag !== 'INPUT' && pTag !== 'TEXTAREA') {
              video.pause();
              e.preventDefault();
            }
            break;
          case 'MediaRewind':
            video.currentTime = Math.max(0, video.currentTime - 10);
            e.preventDefault(); break;
          case 'MediaFastForward':
            video.currentTime = Math.min(video.duration, video.currentTime + 10);
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
