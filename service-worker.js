// Ledgerly PWA service worker — offline shell + cache
const CACHE = 'ledgerly-v2';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/app.js',
  './js/db.js',
  './js/settings.js',
  './js/llm.js',
  './js/speech.js',
  './js/views/input.js',
  './js/views/stats.js',
  './js/views/records.js',
  './js/views/settings.js',
  './vendor/chart.umd.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      // 删除所有旧版本缓存（不仅匹配 CACHE 变量，避免再次升级时踩坑）
      Promise.all(keys.filter((k) => k.startsWith('ledgerly-') && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => {
      // 通知所有客户端刷新（强制重新拉新文件）
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((c) => c.navigate(c.url));
      });
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
