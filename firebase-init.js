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
    window._fbAuthReady = firebase
      .auth()
      .signInAnonymously()
      .then(function (cred) {
        console.log('Firebase auth OK — uid:', cred.user.uid);
        window._fbUid = cred.user.uid;
      })
      .catch(function (err) {
        console.warn('Firebase anonymous auth failed:', err);
        window._fbUid = null;
      });
  } else {
    console.warn('Firebase Auth SDK not loaded');
    window._fbAuthReady = Promise.resolve();
  }

  // Créer l'instance de base de données AVANT de forcer les WebSockets
  window._fbDb = firebase.database();

  // Force WebSocket transport — obligatoire pour les extensions Chrome MV3
  // Le long-polling injecte des <script> distants, ce qui est bloqué par
  // le CSP de MV3 (script-src 'self'). Les WebSockets passent par
  // connect-src qui accepte les domaines distants.
  // Forcer WebSocket uniquement dans une extension Chrome (MV3 bloque le long-polling)
  var isExtension = !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  if (isExtension && window._fbDb && window._fbDb.INTERNAL && typeof window._fbDb.INTERNAL.forceWebSockets === 'function') {
    window._fbDb.INTERNAL.forceWebSockets();
    console.log('Firebase: WebSocket transport forcé (MV3 mode)');
  }

  // Moniteur de connexion pour la collaboration
  window._fbDb.ref('.info/connected').on('value', function (snap) {
    document.dispatchEvent(new CustomEvent('fb-connection', { detail: !!snap.val() }));
  });
} catch (e) {
  console.warn('Firebase init failed:', e);
  window._fbDb = null;
  window._fbAuthReady = Promise.resolve();
}
