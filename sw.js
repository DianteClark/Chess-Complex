// Network-first service worker with a short timeout; cached copy for offline solo play.
const CACHE = 'cc-v10.2.2';
const CORE = ['./', 'index.html', 'privacy.html', 'css/style.css', 'manifest.webmanifest',
  'js/main.js', 'js/data.js', 'js/engine.js', 'js/render.js', 'js/world.js', 'js/fx.js', 'js/pieces.js', 'js/audio.js', 'js/music.js', 'js/net.js', 'js/tutorial.js', 'js/codex.js', 'js/progression.js', 'js/store.js', 'js/storeui.js', 'css/store10.css', 'js/menus.js', 'css/menus10.css', 'js/announcer.js', 'css/ui10.css', 'js/input.js', 'js/hazards10.js', 'js/chat.js', 'js/voice.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await Promise.race([fetch(req), timeout(4000)]);
      if (res && res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy))); }
      return res;
    } catch {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === 'navigate') return (await caches.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
