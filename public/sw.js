// MVC Time Clock service worker.
// Purpose: make the app installable ("Add to Home Screen") and load fast.
// HTML always comes from the network when online so updates (like password eyes) show up.
// Other assets use network-first with cache fallback.

const CACHE_NAME = 'mvc-timeclock-v3';
const APP_SHELL = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET; never cache API calls.
  if (req.method !== 'GET' || req.url.includes('/api/')) return;

  // Always fetch fresh HTML/pages so UI updates are not stuck on an old Home Screen cache.
  const isPage =
    req.mode === 'navigate' ||
    req.destination === 'document' ||
    (req.headers.get('accept') || '').includes('text/html');
  if (isPage) {
    event.respondWith(
      fetch(req)
        .then((res) => res)
        .catch(() => caches.match('/index.html').then((c) => c || caches.match('/')))
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || caches.match('/index.html'))
      )
  );
});
