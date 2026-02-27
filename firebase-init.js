try {
  firebase.initializeApp({
    apiKey: "AIzaSyBX9Su8qOUfTPjXkVvioA6i5pQBk9f6GMs",
    authDomain: "moodboard-app-b21b9.firebaseapp.com",
    projectId: "moodboard-app-b21b9",
    storageBucket: "moodboard-app-b21b9.firebasestorage.app",
    messagingSenderId: "467105545598",
    appId: "1:467105545598:web:72fceeaa8c4d0c949b472f",
    databaseURL: "https://moodboard-app-b21b9-default-rtdb.firebaseio.com",
  });
  window._fbDb = firebase.database();
} catch (e) {
  console.warn("Firebase init failed:", e);
  window._fbDb = null;
}
