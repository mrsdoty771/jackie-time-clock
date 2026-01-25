// Entry point for the frontend.
// We keep `script.js` as the file referenced by `index.html`,
// but the actual application logic lives in `app.js`.
(function loadAppJs() {
  const s = document.createElement('script');
  s.src = 'app.js';
  s.defer = true;
  document.head.appendChild(s);
})();

