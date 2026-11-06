// Retire the legacy reader worker without caching manifests or release downloads.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('she-books-')) await caches.delete(key);
    await self.registration.unregister();
    await self.clients.claim();
  })());
});
