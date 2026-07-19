const CACHE = 'moodboard-pwa-v1';
const STATIC = ['/pwa/', '/pwa/pwa.js', '/pwa/pwa.css', '/pwa/manifest.json'];

self.addEventListener('install', function (e) {
  // Précache tolérant aux erreurs : addAll est atomique, un seul 404 ferait
  // échouer toute l'install et le SW ne s'activerait jamais.
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(STATIC.map(function (u) { return c.add(u).catch(function () {}); }));
  }));
  self.skipWaiting();
});

// caches est partagé par origine : le SW racine possède les autres moodboard-*.
// Un filtre sur k !== CACHE seul purgerait les siens à chaque activation, et lui les nôtres.
function _owned(k) { return k.indexOf('moodboard-pwa-') === 0; }

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return _owned(k) && k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
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
      // respondWith(undefined) lève une TypeError : hors ligne et hors cache, il faut une vraie Response
      return caches.match(e.request).then(function (hit) {
        if (hit) return hit;
        return e.request.mode === 'navigate' ? caches.match('/pwa/') : null;
      }).then(function (hit) {
        return hit || new Response('', { status: 504, statusText: 'Hors ligne' });
      });
    })
  );
});
