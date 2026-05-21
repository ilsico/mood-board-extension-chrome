const CACHE = 'moodboard-v3';
const ASSETS = [
  './index.html',
  './pwa-init.js',
  './app.js',
  './collab.js',
  './firebase-app-compat.js',
  './firebase-auth-compat.js',
  './firebase-database-compat.js',
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
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Ne pas intercepter les requêtes Firebase (réseau uniquement)
  if (e.request.url.includes('firebaseio.com') || e.request.url.includes('googleapis.com')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
