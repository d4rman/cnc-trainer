// При добавлении нового файла в приложение: дописать его в FILES и поднять номер в CACHE.
const CACHE = 'cnc-v4';
const FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'gcode.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Сначала сеть (чтобы обновления приходили сразу), без сети берём сохранённую копию.
// shortcut: при очень плохой связи (не авиарежим) страница ждёт ответа сети; если будет мешать, добавить таймаут 3 с.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    // no-cache: всегда спрашиваем у сервера свежую версию, иначе телефон 10 минут показывает старую
    fetch(e.request.url, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
