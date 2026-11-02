// Service worker: guarda la app para que abra rápido y funcione la interfaz sin conexión.
// Los datos (horarios, posiciones) siempre se piden a la red.
const VERSION = 'xdndandas-v4';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/app.js', 'js/config.js', 'js/flights.js', 'js/geo.js', 'js/progress.js', 'js/transitous.js', 'js/schedules.js',
  'data/airports.json', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Solo archivos propios; las APIs y el proxy van siempre a la red.
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/proxy/')) return;
  // Red primero (para tener siempre la última versión), caché si no hay conexión.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});
