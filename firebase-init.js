try {
  firebase.initializeApp({
    apiKey: 'AIzaSyBX9Su8qOUfTPjXkVvioA6i5pQBk9f6GMs',
    authDomain: 'moodboard-app-b21b9.firebaseapp.com',
    databaseURL: 'https://moodboard-app-b21b9-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'moodboard-app-b21b9',
    storageBucket: 'moodboard-app-b21b9.firebasestorage.app',
    messagingSenderId: '467105545598',
    appId: '1:467105545598:web:72fceeaa8c4d0c949b472f',
  });

  // Auth anonyme — chaque navigateur reçoit un UID Firebase unique
  // pour que les règles de sécurité (auth != null) autorisent l'accès
  if (firebase.auth) {
    // Attendre la résolution initiale de l'état auth : si un utilisateur (Google ou anonyme)
    // est déjà connecté (session stockée), ne pas appeler signInAnonymously() qui écraserait la session.
    window._fbAuthReady = new Promise(function (resolve) {
      var _initUnsub = firebase.auth().onAuthStateChanged(function (user) {
        _initUnsub();
        if (user) {
          window._fbUid = user.uid;
          resolve();
        } else {
          firebase.auth().signInAnonymously()
            .then(function (cred) { window._fbUid = cred.user.uid; resolve(); })
            .catch(function (err) { console.warn('Firebase anonymous auth failed:', err); window._fbUid = null; resolve(); });
        }
      });
    });
  } else {
    console.warn('Firebase Auth SDK not loaded');
    window._fbAuthReady = Promise.resolve();
  }

  // Créer l'instance de base de données AVANT de forcer les WebSockets
  window._fbDb = firebase.database();
  window._fbStorage = (firebase.storage && typeof firebase.storage === 'function') ? firebase.storage() : null;

  // Force WebSocket transport — obligatoire pour les extensions Chrome MV3
  // Le long-polling injecte des <script> distants, ce qui est bloqué par
  // le CSP de MV3 (script-src 'self'). Les WebSockets passent par
  // connect-src qui accepte les domaines distants.
  // Forcer WebSocket uniquement dans une extension Chrome (MV3 bloque le long-polling)
  var isExtension = !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  if (isExtension && window._fbDb && window._fbDb.INTERNAL && typeof window._fbDb.INTERNAL.forceWebSockets === 'function') {
    window._fbDb.INTERNAL.forceWebSockets();
  }

  // Moniteur de connexion pour la collaboration
  window._fbDb.ref('.info/connected').on('value', function (snap) {
    document.dispatchEvent(new CustomEvent('fb-connection', { detail: !!snap.val() }));
  });

  // Maintenir une référence à l'utilisateur courant pour le mobile sync
  window._currentFirebaseUser = null;
  firebase.auth().onAuthStateChanged(function (user) {
    window._currentFirebaseUser = user;
    if (user) window._fbUid = user.uid; // met à jour le UID pour collab aussi
    document.dispatchEvent(new CustomEvent('fb-auth-change', { detail: user }));
  });
} catch (e) {
  console.warn('Firebase init failed:', e);
  window._fbDb = null;
  window._fbAuthReady = Promise.resolve();
}
