// Apply the saved (or system) colour theme before first paint to avoid a flash.
// Kept as a same-origin file (not an inline <script>) so the production CSP (script-src 'self') allows it.
(function () {
  var t = null;
  try { t = localStorage.getItem('star.theme'); } catch (e) {}
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', t);
})();
