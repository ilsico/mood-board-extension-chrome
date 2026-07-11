# Design — PWA iPhone Companion pour Moodboard
Date : 2026-07-11

## Contexte

L'extension Chrome Moodboard est inaccessible depuis un iPhone (Safari ne supporte pas les extensions Chrome MV3, et l'IndexedDB de l'extension est cloisonnée). Ce projet ajoute une PWA compagnon hébergée sur Netlify, accessible depuis Safari iOS et ajoutée à l'écran d'accueil, qui se connecte aux données via Firebase (déjà en place pour le partage collab).

**Usages visés :**
1. Consulter ses boards épinglés (portfolio, présentation client)
2. Capturer images et URLs depuis iPhone → récupérées sur desktop
3. Voir ce qui a changé sur les boards partagés (journal passif, sans push)

---

## Architecture

### Déploiement
- Sous-dossier `/pwa/` dans le repo existant, hébergé sur Netlify
- Fichiers : `pwa/index.html`, `pwa/pwa.js`, `pwa/pwa.css`, `pwa/sw.js`, `pwa/manifest.json`
- Aucun framework, aucun build step — cohérent avec l'extension (vanilla JS)

### Firebase — structure de données
```
/users/{uid}/
  pinned_boards/           ← boards épinglés (id, nom, snapshot base64, savedAt)
    {boardId}: { name, snapshot, savedAt, pinned: true }
  boards/{boardId}/        ← données complètes (elements[]) du board épinglé
  inbox/                   ← captures iPhone en attente d'import
    {itemId}: { type: 'image'|'url', data, url, addedAt, imported: false }
  activity/                ← journal d'activité (propre à cet utilisateur : boards qu'il a modifiés)
    {eventId}: { boardId, boardName, displayName, action, at }

/boards/{boardId}/
  activity/                ← journal partagé entre tous les collaborateurs d'un board
    {eventId}: { uid, displayName, action, at }
```

### Authentification
- Firebase Auth avec Google Sign-in, partagé entre l'extension et la PWA
- Même `uid` → données isolées par compte → deux personnes utilisant le même dossier d'extension ne voient pas les boards de l'autre
- Extension : bouton "Se connecter avec Google" dans le header (visible uniquement si non connecté, disparaît une fois connecté)
- PWA : Google Sign-in au premier lancement

---

## Modifications côté extension

### index.html
- Ajouter `firebase-auth-compat.js` (CDN, avant `app.js`)
- Init Firebase Auth dans le script inline existant → expose `window._fbAuth`
- Bouton "Se connecter avec Google" `#google-signin-btn` dans le header (caché si déjà connecté)
- Icône **monitor-smartphone** (SVG Lucide inline) `#pin-mobile-btn` dans le header du board :
  - Sans texte, `title="Épingler sur l'iPhone"` (tooltip natif)
  - Caché sur l'écran d'accueil, visible uniquement dans un board ouvert
  - Toggle : actif (coloré `#ff3c00`) si le board courant est épinglé, inactif sinon
- Icône **images** (SVG Lucide inline) `#inbox-btn` dans le header :
  - Badge numérique `#inbox-count` (nombre de captures non importées)
  - Ouvre le panneau inbox `#inbox-panel`

### app.js — Authentification

```js
// Dans init(), après loadBoardsFromStorage()
if (window._fbAuth) {
  window._fbAuth.onAuthStateChanged(user => {
    _currentUser = user;
    document.getElementById('google-signin-btn').style.display = user ? 'none' : '';
    if (user) _syncPinnedBoards();
  });
}
```

```js
// Handler bouton connexion
document.getElementById('google-signin-btn').addEventListener('click', () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  window._fbAuth.signInWithPopup(provider);
});
```

### app.js — Épingler un board

```js
async function togglePinBoard(boardId) {
  if (!_currentUser) return showToast('Connecte-toi pour épingler');
  const board = boards.find(b => b.id === boardId);
  const ref = window._fbDb.ref(`users/${_currentUser.uid}/pinned_boards/${boardId}`);
  const snap = await ref.get();
  if (snap.exists()) {
    await ref.remove();
    showToast('Board retiré du mobile');
    _updatePinBtn(false);
  } else {
    const snapshot = await _generateBoardSnapshot(boardId); // canvas → base64 PNG 400px
    await ref.set({ name: board.name, snapshot, savedAt: board.savedAt, pinned: true });
    await _syncBoardElements(boardId); // écrit elements[] dans users/{uid}/boards/{boardId}
    showToast('Board épinglé sur iPhone');
    _updatePinBtn(true);
  }
}
```

### app.js — Sync automatique si board épinglé

Dans `saveCurrentBoard()`, après `saveBoards()` :
```js
if (_currentUser && _isPinned(currentBoardId)) {
  _syncBoardElements(currentBoardId);
}
```

### app.js — Panneau Inbox

- Panneau `#inbox-panel` (drawer latéral ou modal) listé les items `users/{uid}/inbox/` avec `imported: false`
- Chaque item : miniature (image) ou icône lien + URL + date
- Bouton "Importer" par item → crée l'élément sur le canvas actif (`makeElement`), marque `imported: true` dans Firebase
- Le badge `#inbox-count` écoute Firebase en temps réel (`onValue`)

### app.js — Journal d'activité (écriture)

Dans `saveCurrentBoard()`, si le board est en mode collab actif :
```js
if (_currentUser && Collab.isActive()) {
  // Écrit sur le nœud du board, lisible par tous ses collaborateurs
  window._fbDb.ref(`boards/${currentBoardId}/activity`).push({
    uid: _currentUser.uid,
    displayName: _currentUser.displayName,
    action: 'modified',
    at: Date.now()
  });
}
```

La PWA lit `/boards/{boardId}/activity/` pour chaque board épinglé → affiche le feed unifié.

---

## PWA — Écrans

### Manifest (`pwa/manifest.json`)
```json
{
  "name": "Moodboard",
  "short_name": "Moodboard",
  "display": "standalone",
  "start_url": "/pwa/",
  "theme_color": "#ff3c00",
  "background_color": "#f4f4f6",
  "share_target": {
    "action": "/pwa/share",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "title": "title",
      "text": "text",
      "url": "url",
      "files": [{ "name": "file", "accept": ["image/*"] }]
    }
  },
  "icons": [{ "src": "/icon128.png", "sizes": "128x128", "type": "image/png" }]
}
```

Le champ `share_target` expose la PWA dans le Share Sheet iOS (Safari, Photos, etc.).

### ① Écran d'accueil — "Mes boards"
- Grille 2 colonnes de cards
- Chaque card : snapshot du board (image), nom, date "Modifié il y a Xh"
- Point coloré `#ff3c00` si le board a été modifié depuis la dernière ouverture de la PWA
- Tap → Board Viewer
- Badge rouge sur la tab Inbox si captures en attente

### ② Board Viewer
- Canvas rendu fidèle : éléments positionnés avec `transform: translate(x,y)` et taille réelle, dans un container scrollable
- Gestes : pan 1 doigt (`touch-action: none`, `pointermove`), pinch-zoom 2 doigts
- Tap sur élément `link` → `window.open(url, '_blank')`
- Tap sur élément `image` → lightbox plein écran (même pattern que l'extension)
- Éléments `note`, `color`, `caption` : lisibles, non éditables
- Bouton "Partager" → copie le lien Firebase public existant dans le presse-papier
- Bouton retour → revient à l'écran d'accueil

### ③ Inbox — "Captures"
- Icône images (Lucide) dans la bottom tab bar, badge numérique
- Liste des captures non importées : miniature + type (image/URL) + date
- Bouton "+" → picker galerie iOS (input `type=file accept=image/*`) ou champ URL
- Chaque item : swipe gauche pour supprimer, badge "Importé" après import desktop
- Vide : illustration + message "Rien pour l'instant — partage une image depuis Safari"

### ④ Journal d'activité
- Feed chronologique des modifications sur les boards partagés
- Chaque ligne : avatar Google + nom + board + "il y a Xmin"
- Pas de notification push — visible uniquement à l'ouverture de la PWA
- Les boards avec activité récente affichent un point coloré sur leur card (écran ①)
- Tap sur un item → ouvre le Board Viewer du board concerné

### ⑤ Profil
- Photo Google + nom + email
- Bouton "Se déconnecter"
- Toggle "Dark mode" (suit `prefers-color-scheme` par défaut)
- Lien "Télécharger l'extension" → Chrome Web Store

---

## Service Worker (`pwa/sw.js`)

- Cache statique des assets au premier install (`pwa.html`, `pwa.js`, `pwa.css`, icônes)
- Stratégie réseau-d'abord pour les données Firebase (pas de cache des données utilisateur)
- Gestion de la route `/pwa/share` pour les données du Share Sheet

---

## Icônes spécifiées

| Usage | Icône | SVG |
|-------|-------|-----|
| Épingler sur iPhone (extension, header board) | Monitor-smartphone (Lucide) | `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"/><path d="M10 19v-3.96 3.15"/><path d="M7 19h5"/><rect width="6" height="10" x="16" y="12" rx="2"/></svg>` |
| Inbox (extension + PWA tab) | Images (Lucide) | `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16"/><path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2"/><circle cx="13" cy="7" r="1" fill="currentColor"/><rect x="8" y="2" width="14" height="14" rx="2"/></svg>` |

Le bouton épingler : sans texte, `title="Épingler sur l'iPhone"` pour le tooltip hover.

---

## Fichiers à créer / modifier

| Fichier | Action |
|---------|--------|
| `index.html` | Ajouter Firebase Auth CDN, `#google-signin-btn`, `#pin-mobile-btn`, `#inbox-btn`, `#inbox-count`, `#inbox-panel` |
| `app.js` | Auth state, `togglePinBoard()`, `_syncBoardElements()`, `_generateBoardSnapshot()`, sync auto dans `saveCurrentBoard()`, panneau inbox, écriture journal activité |
| `pwa/index.html` | App shell PWA (5 écrans) |
| `pwa/pwa.js` | Logique PWA (Firebase Auth, Realtime DB listeners, viewer, inbox, activité) |
| `pwa/pwa.css` | Styles mobile-first |
| `pwa/sw.js` | Service Worker |
| `pwa/manifest.json` | Web App Manifest + share_target |

---

## Ce que cette PWA ne fait pas

- Pas d'édition des éléments canvas sur mobile (mauvaise UX, hors scope)
- Pas de création de nouveau board depuis l'iPhone
- Pas de notifications push (remplacement : journal passif + points de changement)
- Pas de mode collab actif depuis la PWA
