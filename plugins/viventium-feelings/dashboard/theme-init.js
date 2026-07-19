// Runs synchronously in <head> before first paint. The server injects the saved
// host-profile preference into a meta tag, so the choice survives random-port
// dashboard relaunches without exposing it in the URL.
(function () {
  var meta = document.querySelector('meta[data-viventium-theme]');
  var t = meta && /^(?:system|light|dark)$/.test(meta.content) ? meta.content : 'system';
  window.__VIVENTIUM_INITIAL_THEME__ = t;
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  var resolved = t === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : t;
  var themeColor = document.getElementById('themeColor');
  if (themeColor) themeColor.content = resolved === 'dark' ? '#0e0e10' : '#f7f7f5';
})();
