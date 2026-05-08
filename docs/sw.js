// SQUATWOLF Event Inventory — service worker
// Cache strategy: stale-while-revalidate for static + CDN; bypass Supabase.

const CACHE = 'eit-v23';

const PRECACHE = [
  './',
  './index.html',
  './app.compiled.js',
  './styles.css',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
];

// Domains we're happy to cache responses from (static delivery)
const CACHEABLE_HOSTS = [
  'cdn.jsdelivr.net',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache Supabase API or storage — must always be live.
  if (url.hostname.endsWith('.supabase.co')) return;

  const sameOrigin = url.origin === location.origin;
  const cacheable  = sameOrigin || CACHEABLE_HOSTS.includes(url.hostname);
  if (!cacheable) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);

    const fetchAndCache = fetch(req).then((res) => {
      // Only cache "ok" basic/CORS responses
      if (res && (res.status === 200 || res.type === 'opaque')) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    }).catch(() => null);

    // Return cache immediately if we have it; otherwise wait on network.
    return cached || (await fetchAndCache) || new Response('', { status: 504 });
  })());
});
