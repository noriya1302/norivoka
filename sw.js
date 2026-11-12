/* 노리보카 offline support: the app shell is cached so it opens without a connection.
   Account calls (Firebase) always go to the network. Bump CACHE when the shell changes. */
const CACHE = 'norivoka-v60';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './nori-happy.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('firebaseapp.com')) return;
  // the page itself: newest from the network, cached copy when offline (new words arrive on the next open)
  if (req.mode === 'navigate'){
    // newest page from the network, but never keep the person waiting more than 2.5s on a slow line
    const net = fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })).then(r => { if (r.ok){ const copy = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); } return r; });
    const slow = new Promise(res => setTimeout(res, 2500)).then(() => caches.match('./index.html')).then(hit => hit || net);
    e.respondWith(Promise.race([net.catch(() => caches.match('./index.html')), slow]));
    return;
  }
  // icons and the pinned Firebase SDK files: cache first
  if (url.origin === self.location.origin || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'))){
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok || r.type === 'opaque'){ const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return r;
    })));
  }
});

/* Nori's daily nudge (sent by the scheduled job in .github/workflows) */
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || '노리보카', {
    body: d.body || '노리가 기다리고 있어요', icon: d.icon || 'nori-wait.png', badge: 'badge-96.png',
    tag: d.tag || 'nori-daily', renotify: true, data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs){ if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
