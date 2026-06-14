const CACHE_NAME = 'monize-static-v2';

const STATIC_EXTENSIONS = [
  '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.ico', '.webp',
];

function isStaticAsset(url) {
  const pathname = new URL(url).pathname;
  if (pathname.startsWith('/_next/static/')) return true;
  return STATIC_EXTENSIONS.some(function (ext) { return pathname.endsWith(ext); });
}

// Install: activate immediately
self.addEventListener('install', function () {
  self.skipWaiting();
});

// Activate: clean up old caches, claim clients
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function (name) { return name !== CACHE_NAME; })
          .map(function (name) { return caches.delete(name); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Fetch: Cache-First for static assets, Network-Only for everything else
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  // The Cache API only supports http(s) requests. Browser extensions can inject
  // their own scripts (chrome-extension://, etc.) that the SW would otherwise try
  // to cache, throwing "Request scheme 'chrome-extension' is unsupported".
  if (!event.request.url.startsWith('http')) return;
  if (!isStaticAsset(event.request.url)) return;

  event.respondWith(
    caches.match(event.request).then(function (cachedResponse) {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then(function (networkResponse) {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }

        var responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      });
    })
  );
});
