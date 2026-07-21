const CACHE = 'moodboard-v4';
const ASSETS = [
  './index.html',
  './pwa-init.js',
  './app.js',
  './collab.js',
  './firebase-app-compat.js',
  './firebase-auth-compat.js',
  './firebase-database-compat.js',
  './firebase-storage-compat.js',
  './firebase-init.js',
  './html2canvas.min.js',
  './jspdf.umd.min.js',
  // Icônes extension
  './icon extension/icon16.png',
  './icon extension/icon48.png',
  './icon extension/icon128.png',
  './icon extension/icon192.png',
  './icon extension/icon512.png',
  // UI icons
  './PNG/Arrêt.png',
  './PNG/collaborer.png',
  './PNG/couleur.png',
  './PNG/curseur.png',
  './PNG/dupliquer.png',
  './PNG/exportation.png',
  './PNG/fichier-carte.png',
  './PNG/fichier.png',
  './PNG/lien.png',
  './PNG/loupe.png',
  './PNG/note.png',
  './PNG/partager.png',
  './PNG/pipette.png',
  './PNG/renommer.png',
  './PNG/retour.png',
  './PNG/sauvegarder.png',
  './PNG/supprimer.png',
  './PNG/curseur 1.svg',
  './PNG/curseur 2.svg',
  // Loading frames
  './loading/frame1.png',
  './loading/frame2.png',
  './loading/frame3.png',
  './loading/frame4.png',
  './loading/frame5.png',
  './loading/frame6.png',
  './loading/frame7.png',
  './loading/frame8.png',
  './loading/frame9.png',
];

self.addEventListener('install', e => {
  // Précache tolérant aux erreurs : addAll est atomique, un seul 404 ferait
  // échouer toute l'install et le SW ne s'activerait jamais.
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(ASSETS.map(u => c.add(u).catch(() => {})))
    )
  );
  self.skipWaiting();
});

// caches est partagé par origine : le SW de /pwa/ possède les moodboard-pwa-*.
// Un filtre sur k !== CACHE seul purgerait les siens à chaque activation, et lui les nôtres.
const _owned = k => k.startsWith('moodboard-') && !k.startsWith('moodboard-pwa-');

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => _owned(k) && k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Le code (HTML/JS/CSS) doit passer par le réseau en priorité : en cache-first,
// une mise à jour déployée n'atteint jamais les utilisateurs tant que CACHE n'est
// pas renommé. Les assets figés (images, polices) restent en cache-first.
const _isCode = url => /\.(html|js|css)(\?|$)/.test(url) || url.endsWith('/');

self.addEventListener('fetch', e => {
  // Ne pas intercepter les requêtes Firebase (réseau uniquement)
  if (e.request.url.includes('firebaseio.com') || e.request.url.includes('googleapis.com')) {
    return;
  }

  if (_isCode(e.request.url)) {
    // Réseau d'abord, cache en secours hors ligne ; on rafraîchit le cache au passage.
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          }
          return resp;
        })
        .catch(() =>
          caches.match(e.request).then(
            hit => hit || new Response('', { status: 504, statusText: 'Hors ligne' })
          )
        )
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
