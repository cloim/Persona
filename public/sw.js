const CACHE = 'persona-shell-v2';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const shell = await fetch('/', { cache: 'reload' });
    const html = await shell.clone().text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]);
    await cache.put('/', shell);
    await cache.addAll(['/icon.svg','/manifest.webmanifest', ...assets]);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && (event.request.mode === 'navigate' || url.pathname.startsWith('/assets/') || ['/', '/icon.svg','/manifest.webmanifest'].includes(url.pathname))) {
      const copy = response.clone(); caches.open(CACHE).then(c => c.put(event.request, copy));
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? await caches.match('/') : Response.error())));
});
