/* Park Pulse service worker
   • network-first app + API with cached fallback (works with poor signal in queues)
   • map tiles: cache-first, kept after you've viewed them (offline map)
   • Web Push: shows notifications sent by the server, even when the app is closed */
'use strict';

const CACHE = 'park-pulse-v61';
const TILES = 'park-pulse-tiles-v2'; // v2: CORS-only tiles (required by COEP)
const DATA = 'park-pulse-data-v1'; // API responses (trip pack) — survives app updates
const MAX_TILES = 1500;
const SHELL = ['./', 'assets/app.css', 'assets/app.js', 'assets/map.js', 'assets/theme.js', 'assets/qr.js', 'assets/icon.svg', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-180.png', 'manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== TILES && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isTile = (req, url) => req.destination === 'image' && /\/\d+\/\d+\/\d+(@2x)?\.(png|jpg|jpeg|webp)$/.test(url.pathname);

async function trimTiles() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

async function tileFirst(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      cache.put(req, res.clone()).then(trimTiles);
    }
    return res;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles (any host): keep what you've seen so the map works offline.
  if (url.origin !== self.location.origin) {
    if (isTile(req, url)) event.respondWith(tileFirst(req));
    return;
  }
  // Never cache sign-in redirects, logout or downloads.
  if (url.pathname.includes('/auth/') || url.pathname.endsWith('/api/export')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(url.pathname.includes('/api/') ? DATA : CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: url.pathname.includes('/assets/') });
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const shell = await caches.match('./');
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});

// "Save map for offline" (only offered for tile servers that allow pre-fetching).
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type !== 'prefetch-tiles' || !Array.isArray(msg.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(TILES);
    let done = 0;
    for (const u of msg.urls.slice(0, MAX_TILES)) {
      try {
        if (!(await cache.match(u))) {
          const res = await fetch(u, { mode: 'cors', referrerPolicy: 'strict-origin-when-cross-origin' });
          if (!res.ok) continue;
          await cache.put(u, res);
        }
      } catch { /* skip */ }
      done++;
      if (done % 25 === 0 || done === msg.urls.length) {
        event.source?.postMessage({ type: 'prefetch-progress', done, total: msg.urls.length });
      }
    }
  })());
});

// Web Push from the Park Pulse server.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Park Pulse';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    icon: 'assets/icon.svg',
    badge: 'assets/icon.svg',
    data: { url: data.url || './' },
  }));
});

// Tapping a notification opens Park Pulse on the right screen.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          w.postMessage({ type: 'open', url: target });
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
