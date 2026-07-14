// 幸運のパチンコ — Service Worker
// TWA(Androidアプリ)がオフラインでも起動できるよう、コアファイルを事前キャッシュし、
// それ以外の画像等は初回アクセス時にキャッシュへ足していく(stale-while-revalidate)。
const CACHE_NAME = 'lucky-pachi-v13';
const CORE_ASSETS = ['./', './index.html', './game.js', './manifest.json', './assets/nikumaru.woff2', './assets/mochiy.woff2'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  const path = new URL(req.url).pathname;
  // HTML/JS は「常に最新をネットワーク優先」→ デプロイが即反映される。落ちたらキャッシュへフォールバック
  const isDoc = req.mode === 'navigate' || path.endsWith('.html') || path.endsWith('.js') || path.endsWith('/');
  if (isDoc) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 画像・フォント等は高速な stale-while-revalidate(キャッシュ優先＋裏で更新)
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => { if (res && res.status === 200) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
});
