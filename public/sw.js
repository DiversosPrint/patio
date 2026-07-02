const CACHE_NAME = 'patio-diversos-print-v1';
const STATIC_ASSETS = ['/', '/index.html', '/styles.css', '/cards.css', '/theme.css', '/dashboard.css', '/filters.css', '/backup.css', '/pwa.css', '/app.js', '/manifest.json', '/images/logo-print.png', '/images/icon-192.png', '/images/icon-512.png', '/images/tela-login.png', '/images/Facchini.png', '/images/Randon.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))); self.clients.claim(); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) return;
  event.respondWith(fetch(event.request).then(response => { if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone())); return response; }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? caches.match('/index.html') : Response.error())));
});
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
