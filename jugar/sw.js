// Chupi Gualy sin internet: la primera vez se guarda todo el juego en el dispositivo y después abre al instante, aunque no haya conexión.
// Si hay conexión, cada vez que se abre se mira si hay una versión nueva y se usa la próxima vez.
// tools/publish-web.ps1 cambia 575088d-202610041127 por un código distinto en cada publicación.
const BUILD = '575088d-202610041127';
const CACHE = 'chupi-gualy-' + BUILD;
const CORE = [
  './', 'index.html', 'vr.js', 'pwa.js', 'manifest.webmanifest', 'logo.webp',
  'vendor/three.min.js',
  'fonts/fredoka-latin-400-normal.woff2', 'fonts/fredoka-latin-600-normal.woff2', 'fonts/fredoka-latin-700-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('chupi-gualy-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || Response.error();
  }));
});
