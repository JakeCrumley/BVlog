const BVLOG_CACHE_NAME = 'bvlog-shell-v1';
const BVLOG_APP_SHELL = [
  './bvlog-index.html',
  './manifest.webmanifest',
  './css/bvlog-style.css',
  './js/bvlog-model.js',
  './js/bvlog-stats.js',
  './js/bvlog-storage.js',
  './js/bvlog-cloud-config.js',
  './js/bvlog-cloud.js',
  './js/bvlog-pwa.js',
  './js/bvlog-ui.js',
  './js/bvlog-app.js',
  './San_Jose_State_Spartans_logo.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(BVLOG_CACHE_NAME)
      .then((cache) => cache.addAll(BVLOG_APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('bvlog-shell-') && key !== BVLOG_CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // Prefer the network for HTML, JS, and CSS so deployed updates appear
  // promptly. If offline, fall back to the cached app shell.
  const isUpdateSensitive = /\.(html|js|css)(?:$|\?)/i.test(new URL(request.url).pathname);
  event.respondWith(
    isUpdateSensitive
      ? fetch(request, { cache: 'no-store' })
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(BVLOG_CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => caches.match(request).then((cached) => cached || caches.match('./bvlog-index.html')))
      : caches.match(request).then((cached) => cached || fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(BVLOG_CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })),
  );
});
