// Offline-first service worker. Cache name changes whenever any shipped file changes.
const CACHE = 'ram-1.0.0-97ae6a569f';
const ASSETS = [
 "./",
 "./css/app.css",
 "./data/evidence.json",
 "./data/logic_spec.json",
 "./data/ui_strings.json",
 "./icons/icon-192.png",
 "./icons/icon-512.png",
 "./icons/icon-maskable-512.png",
 "./index.html",
 "./js/app.js",
 "./js/engine.js",
 "./manifest.webmanifest",
 "./vendor/fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2",
 "./vendor/fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2",
 "./vendor/fonts/ibm-plex-sans-latin-400-normal.woff2",
 "./vendor/fonts/ibm-plex-sans-latin-600-normal.woff2"
];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match('./index.html'))));
});
