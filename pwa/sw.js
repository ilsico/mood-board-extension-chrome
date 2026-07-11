const CACHE = 'moodboard-pwa-v1';
const STATIC = ['/pwa/', '/pwa/pwa.js', '/pwa/pwa.css', '/pwa/manifest.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(STATIC); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  // Interception du share target (POST depuis Share Sheet iOS)
  if (e.request.method === 'POST' && e.request.url.includes('/pwa/share-target')) {
    e.respondWith(
      e.request.formData().then(function (data) {
        const title = data.get('title') || '';
        const text = data.get('text') || '';
        const url = data.get('url') || text || '';
        const file = data.get('file');
        const payload = { type: file ? 'image' : 'url', url: url, title: title };
        if (file) {
          return new Promise(function (resolve) {
            const reader = new FileReader();
            reader.onload = function () {
              payload.data = reader.result;
              self.clients.matchAll({ type: 'window' }).then(function (clients) {
                clients.forEach(function (c) { c.postMessage({ type: 'share-received', payload: payload }); });
              });
              resolve(Response.redirect('/pwa/', 303));
            };
            reader.readAsDataURL(file);
          });
        }
        self.clients.matchAll({ type: 'window' }).then(function (clients) {
          clients.forEach(function (c) { c.postMessage({ type: 'share-received', payload: payload }); });
        });
        return Response.redirect('/pwa/', 303);
      }).catch(function () { return Response.redirect('/pwa/', 303); })
    );
    return;
  }
  // Réseau d'abord pour Firebase, cache pour le reste
  if (e.request.url.includes('firebasedatabase') || e.request.url.includes('googleapis')) return;
  e.respondWith(
    fetch(e.request).catch(function () {
      return caches.match(e.request);
    })
  );
});
