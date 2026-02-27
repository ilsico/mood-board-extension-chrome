# Design — Partage Firebase (Lecture seule)
Date : 2026-02-27

## Contexte
Extension Chrome MV3 + déploiement Netlify. On ajoute la possibilité de partager un board via un lien public. Le visiteur voit une version lecture seule statique récupérée depuis Firebase Realtime Database.

## Décisions clés
- **SDK** : Firebase compat v9.23.0 (scripts non-module, compatible IIFE app.js)
- **Images** : incluses en base64 dans Firebase (simple, risque sur boards très lourds)
- **Lien** : `https://tonsite.netlify.app/?board={id}` (public, sans extension Chrome)
- **Sync auto-save** : silencieuse (pas de toast). Toast uniquement au clic "Partager".

## Modifications

### index.html
1. Ajouter CDN Firebase compat v9 (avant app.js) :
   - `firebase-app-compat.js`
   - `firebase-database-compat.js`
2. Script init Firebase inline → expose `window._fbDb = firebase.database()`
3. Bouton `#share-btn` dans `#board-header` (caché par défaut)
4. CSS `.share-btn` (style cohérent avec le header)
5. CSS `body.readonly-mode` — cache toolbar, lib-panel, back-btn, share-btn, element-toolbar, resize-handles

### app.js — saveCurrentBoard()
Après `saveBoards()`, sync Firebase silencieuse :
```js
if (window._fbDb) {
  window._fbDb.ref('boards/' + currentBoardId)
    .set({ name: board.name, elements: board.elements, savedAt: board.savedAt })
    .catch(e => console.warn('Firebase sync:', e));
}
```

### app.js — Share button handler (dans setupUIEvents)
```js
document.getElementById('share-btn').addEventListener('click', () => {
  if (!currentBoardId) return;
  saveCurrentBoard(); // sauvegarde locale d'abord
  const url = window.location.origin + window.location.pathname + '?board=' + currentBoardId;
  if (window._fbDb) {
    const board = boards.find(b => b.id === currentBoardId);
    window._fbDb.ref('boards/' + currentBoardId)
      .set({ name: board.name, elements: board.elements, savedAt: board.savedAt })
      .then(() => {
        navigator.clipboard.writeText(url);
        showToast('Lien copié dans le presse-papier');
      })
      .catch(() => showToast('Erreur cloud — lien non disponible'));
  } else {
    showToast('Firebase non disponible');
  }
});
```

### app.js — openBoard() / goHome()
- `openBoard()` : `document.getElementById('share-btn').style.display = ''`
- `goHome()` : `document.getElementById('share-btn').style.display = 'none'`

### app.js — init() — détection ?board=
Au tout début d'`init()`, avant `loadBoardsFromStorage()` :
```js
const _sharedId = new URLSearchParams(window.location.search).get('board');
if (_sharedId) { _loadSharedBoard(_sharedId); return; }
```

### app.js — nouvelle fonction _loadSharedBoard(id)
1. Vérifier `window._fbDb` disponible
2. `await _fbDb.ref('boards/'+id).get()`
3. Si snapshot vide → injecter écran d'erreur dans body (voir ci-dessous)
4. Sinon :
   - `document.body.classList.add('readonly-mode')`
   - `document.getElementById('board-screen').style.display = 'flex'`
   - Titre dans `#board-title-display`
   - `zoomLevel=1; panX=0; panY=0; applyTransform()`
   - `board.elements.forEach(e => restoreElement(e))`
   - `setTimeout(() => fitElementsToScreen(), 150)`
5. Guards dans `makeElement()` : `if (body.classList.contains('readonly-mode')) return;` au début du handler mousedown

### Écran d'erreur (board introuvable)
```html
<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
  height:100vh;gap:16px;background:#f4f4f6;">
  <div style="font-family:'HelveticaBold';font-size:26px;color:#ff3c00">MOODBOARDS</div>
  <div style="font-size:15px;color:#888">Ce moodboard n'existe pas ou a été supprimé.</div>
</div>
```

## Comportements readonly-mode
| Action | Comportement |
|--------|-------------|
| Drag élément | Désactivé (guard dans makeElement mousedown) |
| Sélection rect | Désactivé (guard dans setupCanvasEvents) |
| Pan/zoom canvas | Actif (navigation) |
| Dbl-clic image | Lightbox actif |
| Dbl-clic vidéo | Lightbox actif |
| Clic lien | `window.open()` actif |
| Édition texte/note | Désactivé (`contentEditable=false` sur captions) |
| Toolbar éléments | Caché (CSS) |
| Bouton Partager | Caché (CSS) |

## Fichiers modifiés
- `index.html` — scripts Firebase, bouton, CSS
- `app.js` — saveCurrentBoard, init, openBoard, goHome, setupUIEvents, makeElement, nouvelle fn _loadSharedBoard
