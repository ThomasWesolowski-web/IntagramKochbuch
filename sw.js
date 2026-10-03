// Offline-Betrieb: die App-Dateien kommen aus dem Cache und werden im
// Hintergrund aktualisiert. Anfragen an Claude laufen nie über den Cache.
// Außerdem nimmt der Service Worker geteilte Reels an (Teilen-Menü auf Android).
const CACHE = 'kochbuch-v5';
const SHELL = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'db.js',
  'video.js',
  'extract.js',
  'vendor/anthropic-sdk.mjs',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' umgeht den Browser-Cache, damit wirklich die neuen Dateien geladen werden
  event.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Geteilte Inhalte in IndexedDB ablegen (gleiche Datenbank wie db.js).
function eingangSpeichern(eintrag) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('kochbuch', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('rezepte')) db.createObjectStore('rezepte', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('bilder')) db.createObjectStore('bilder', { keyPath: 'id' }).createIndex('rezeptId', 'rezeptId');
      if (!db.objectStoreNames.contains('eingang')) db.createObjectStore('eingang', { keyPath: 'id' });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('eingang', 'readwrite');
      const st = tx.objectStore('eingang');
      st.clear();
      st.put(eintrag);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}

async function teilenAnnehmen(request) {
  const form = await request.formData();
  const video = form.get('video');
  await eingangSpeichern({
    id: 'geteilt',
    createdAt: Date.now(),
    title: form.get('title') || '',
    text: form.get('text') || '',
    url: form.get('url') || '',
    video: video && typeof video !== 'string' && video.size ? video : null,
  });
  return Response.redirect('./#/neu?geteilt=1', 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method === 'POST' && url.pathname.endsWith('/teilen')) {
    event.respondWith(teilenAnnehmen(req));
    return;
  }
  if (req.method !== 'GET' || req.headers.has('range')) return;

  const key = req.mode === 'navigate' ? 'index.html' : req;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key, { ignoreSearch: true });
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
