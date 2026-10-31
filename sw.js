// Network-first service worker: always fresh when online, still playable offline (solo).
const CACHE = 'cc-v1.3';
const CORE = ['./', 'index.html', 'css/style.css', 'js/main.js', 'js/data.js', 'js/engine.js', 'js/render.js', 'js/fx.js', 'js/pieces.js', 'js/audio.js', 'js/music.js', 'js/net.js', 'js/tutorial.js', 'js/codex.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
});
