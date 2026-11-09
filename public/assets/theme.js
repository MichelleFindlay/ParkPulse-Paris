/* Park Pulse theme loader: runs in <head> before the page paints so there is no colour flash.
   Reads the choice saved by the Mine tab (localStorage "pp:theme" = {"mode":"auto|light|dark|black","accent":"…"}). */
(function () {
  var MODES = ['auto', 'light', 'dark', 'black'];
  var ACCENTS = ['indigo', 'castle', 'ocean', 'forest', 'sunset', 'galaxy', 'gold', 'graphite'];
  function apply(t) {
    t = t || {};
    var root = document.documentElement;
    var mode = MODES.indexOf(t.mode) >= 0 ? t.mode : 'auto';
    var accent = ACCENTS.indexOf(t.accent) >= 0 ? t.accent : 'indigo';
    if (mode === 'auto') root.removeAttribute('data-mode'); else root.setAttribute('data-mode', mode);
    if (accent === 'indigo') root.removeAttribute('data-accent'); else root.setAttribute('data-accent', accent);
    // Status-bar colour follows the header colour.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var top = getComputedStyle(root).getPropertyValue('--top').trim();
      if (top) meta.setAttribute('content', top);
    }
  }
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('pp:theme') || 'null'); } catch (e) { /* blocked */ }
  apply(saved);
  window.ppTheme = { apply: apply, modes: MODES, accents: ACCENTS };
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var again = function () { var t = null; try { t = JSON.parse(localStorage.getItem('pp:theme') || 'null'); } catch (e) { /* blocked */ } apply(t); };
    if (mq.addEventListener) mq.addEventListener('change', again); else if (mq.addListener) mq.addListener(again);
  }
})();
