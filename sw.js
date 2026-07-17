// 幸運のパチンコ — Service Worker
// TWA(Androidアプリ)がオフラインでも起動できるよう、コアファイルを事前キャッシュし、
// それ以外の画像等は初回アクセス時にキャッシュへ足していく(stale-while-revalidate)。
const CACHE_NAME = 'lucky-pachi-v23';
const CORE_ASSETS = ['./', './index.html', './game.js', './manifest.json', './assets/nikumaru.woff2', './assets/mochiy.woff2', './assets/notokaku.woff2',
  // deco版UI装飾画像(オフライン初表示でも枠/ロゴ/ハンコ/演出が欠けないよう事前キャッシュ)
  './assets/ui_card_frame.webp', './assets/ui_shopitem_frame.webp', './assets/ui_btn_gold.webp', './assets/ui_btnframe.webp',
  './assets/ui_topbar.webp', './assets/ui_logo.webp', './assets/ui_hanko_wide.webp',
  './assets/ui_hanko_sq.webp', './assets/ui_cutin_band.webp', './assets/ui_rays_gold.webp',
  // レア度別カード枠/ショップ枠(ドラフト・ショップの中核UI。9スライス/背景で全カードに使用)
  './assets/ui_cardframe_normal.webp', './assets/ui_cardframe_rare.webp', './assets/ui_cardframe_legend.webp',
  './assets/ui_frame_normal.webp', './assets/ui_frame_rare.webp', './assets/ui_frame_legend.webp', './assets/ui_frame_panel.webp',
  './assets/ui_cfframe.webp'];  // 確認ダイアログの9スライス金枠

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
          if (res && res.status === 200) {
            const copy = res.clone();
            // SWが早期停止してもキャッシュ書込みが完走するようwaitUntilで寿命を延長
            event.waitUntil(caches.open(CACHE_NAME).then((c) => c.put(req, copy)));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || caches.match('./index.html'))  // PWA起動URL(?source=pwa等)の不一致でもオフライン起動できるようフォールバック
    );
    return;
  }

  // 画像・フォント等は高速な stale-while-revalidate(キャッシュ優先＋裏で更新)
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then(async (res) => { if (res && res.status === 200) await cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      event.waitUntil(network.then(() => undefined, () => undefined));  // 裏の再検証もSW寿命に結びつける
      return cached || network;
    })
  );
});
