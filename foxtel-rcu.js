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

    if (isSBB) {
      focusFirst();
    }

    // --- Main keydown handler ---
    // Use CAPTURE phase (true) so we intercept keys before shadow DOM
    // elements like <ds-input> can consume them
    document.addEventListener('keydown', function(e) {
      var key = e.key;

      // Directional navigation (LRUD)
      if (key === 'ArrowUp' || key === 'ArrowDown' ||
          key === 'ArrowLeft' || key === 'ArrowRight') {

        // Check if we're inside a text input
        var active = document.activeElement;
        var tag = active ? active.tagName : '';
        var isInput = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');

        // Allow left/right for cursor movement in inputs
        if (isInput && (key === 'ArrowLeft' || key === 'ArrowRight')) return;

        // For Up/Down in an input: blur the input first so spatial
        // navigation can find the next element from its position
        if (isInput && (key === 'ArrowUp' || key === 'ArrowDown')) {
          e.preventDefault();
          e.stopPropagation();
          // Find next from the input's parent (ds-input) if it exists,
          // otherwise from the input itself
          var navFrom = active.closest && active.closest('ds-input') || active;
          var next = findNext(navFrom, key);
          if (next) {
            var target = getFocusTarget(next);
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

        // Input fields: Enter should submit the form, but on SBB
        // we also try to trigger the soft keyboard by clicking the
        // input (some STBs show the keyboard on click, not focus)
        if (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA') {
          if (isSBB && !focused._sbbKeyboardShown) {
            // First Enter press: try to trigger soft keyboard
            focused._sbbKeyboardShown = true;
            focused.click();
            e.preventDefault();
            return;
          }
          // Subsequent Enter: allow form submission
          focused._sbbKeyboardShown = false;
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
