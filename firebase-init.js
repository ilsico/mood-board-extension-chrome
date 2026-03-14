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
  window._fbDb = firebase.database();
  // Moniteur de connexion pour la collaboration
  window._fbDb.ref('.info/connected').on('value', function (snap) {
    document.dispatchEvent(new CustomEvent('fb-connection', { detail: !!snap.val() }));
  });
} catch (e) {
  console.warn('Firebase init failed:', e);
  window._fbDb = null;
}
