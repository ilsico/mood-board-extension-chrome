# Firebase Storage — Synchronisation images collab — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uploader les images vers Firebase Storage au démarrage d'une session collab, stocker les URLs dans RTDB, et les re-télécharger en base64 local à la fin de session — éliminant la limite des 768 KB.

**Architecture:** L'owner uploade toutes ses images vers `collabImages/{boardId}/{elId}` au démarrage, et écrit les URLs dans RTDB. Les nouvelles images ajoutées pendant la collab suivent le même chemin. À la fin de session, chaque participant télécharge les images Storage → base64 → `_imgStore` → IndexedDB.

**Tech Stack:** Firebase Storage compat v9 (`firebase.storage()`), `putString(base64, 'data_url')`, `getDownloadURL()`, Fetch API pour le re-téléchargement base64.

## Global Constraints

- Zéro `console.log` dans `app.js` ou `collab.js` — utiliser `console.warn` uniquement pour les erreurs Firebase existantes
- La structure IIFE de `collab.js` ne change pas — tout reste dans `window.Collab = (function(){...})()`
- Pas de refactoring non demandé — ne modifier que les sections indiquées
- Le comportement solo (sans collab) reste identique à aujourd'hui, aucun upload ne se fait hors session collab
- Le chemin Storage est toujours `collabImages/{boardId}/{elId}` — un fichier par élément image

---

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `index.html` | Ajouter `<script src="firebase-storage-compat.js"></script>` |
| `firebase-storage-compat.js` | Nouveau fichier (téléchargé, non écrit à la main) |
| `app.js` | Ajouter `_imgStoreGet` et `_imgStoreSet` dans le return public (~2 lignes) |
| `collab.js` | 4 modifications : `_uploadImageToStorage`, `startSession`, `syncElementCreate`, `_downloadStorageImages` + `endSession` + `_mergeSessionToLocal` |

---

### Task 1 : Télécharger le SDK Firebase Storage et l'intégrer dans index.html

**Files:**
- Create: `firebase-storage-compat.js` (à la racine du projet)
- Modify: `index.html` ligne 14 (après `firebase-database-compat.js`)

**Interfaces:**
- Produces: `firebase.storage()` disponible globalement dans `index.html`

- [ ] **Step 1 : Télécharger `firebase-storage-compat.js`**

Les SDK existants sont la version Firebase 9.x (compat). Ouvrir ce lien dans le navigateur et sauvegarder le fichier à la racine du projet sous le nom `firebase-storage-compat.js` :

```
https://www.gstatic.com/firebasejs/9.23.0/firebase-storage-compat.js
```

Si le projet utilise une autre version et que Firebase émet une erreur de version incompatible au Step 3, essayer `9.22.2` ou `9.6.11` à la place dans l'URL.

- [ ] **Step 2 : Ajouter le script dans `index.html`**

Dans `index.html`, localiser le bloc des scripts Firebase (lignes 11-15) :

```html
<!-- Firebase compat v9 (local, compatible IIFE) -->
<script src="firebase-app-compat.js"></script>
<script src="firebase-auth-compat.js"></script>
<script src="firebase-database-compat.js"></script>
<script src="firebase-init.js"></script>
```

Remplacer par :

```html
<!-- Firebase compat v9 (local, compatible IIFE) -->
<script src="firebase-app-compat.js"></script>
<script src="firebase-auth-compat.js"></script>
<script src="firebase-database-compat.js"></script>
<script src="firebase-storage-compat.js"></script>
<script src="firebase-init.js"></script>
```

- [ ] **Step 3 : Vérifier le chargement**

Recharger l'extension dans `chrome://extensions` (bouton Actualiser), ouvrir l'index.html de l'extension, ouvrir DevTools → Console, taper :

```js
typeof firebase.storage()
```

Résultat attendu : `"object"` (pas d'erreur, pas de `undefined`).

- [ ] **Step 4 : Commit**

```bash
git add firebase-storage-compat.js index.html
git commit -m "feat: ajouter SDK Firebase Storage compat v9"
```

---

### Task 2 : Ajouter `_imgStoreGet` et `_imgStoreSet` dans `app.js`

**Files:**
- Modify: `app.js` — section `return { ... }` finale (autour de la ligne 8960)

**Interfaces:**
- Produces: `App._imgStoreGet(elId)` → `string | undefined`, `App._imgStoreSet(elId, data)` → `void`
- Consumes: `_imgStore` (Map déjà existante dans app.js)

- [ ] **Step 1 : Localiser le return public dans app.js**

Chercher `_collabDeleteImgStore,` dans `app.js`. La ligne se trouve dans le bloc `return { ... }` final. La section ressemble à :

```js
_collabDeleteImgStore,
updateBoardThumbnail,
_collabGetBoardElements,
```

- [ ] **Step 2 : Ajouter les deux fonctions juste avant `_collabDeleteImgStore`**

Ajouter ces deux fonctions dans la section privée (avant le `return`), dans la zone où se trouvent les autres fonctions `_collab*` (autour de la ligne 8792) :

```js
function _imgStoreGet(elId) {
  return _imgStore.get(elId);
}
function _imgStoreSet(elId, data) {
  _imgStore.set(elId, data);
}
```

Puis les exposer dans le `return { ... }` final, à côté de `_collabDeleteImgStore` :

```js
_imgStoreGet,
_imgStoreSet,
_collabDeleteImgStore,
```

- [ ] **Step 3 : Vérifier dans la console**

Recharger l'extension, ouvrir un board, ouvrir la console :

```js
typeof App._imgStoreGet  // → "function"
typeof App._imgStoreSet  // → "function"
App._imgStoreGet('inexistant')  // → undefined (pas d'erreur)
```

- [ ] **Step 4 : Commit**

```bash
git add app.js
git commit -m "feat: exposer _imgStoreGet et _imgStoreSet dans App (bridge pour collab Storage)"
```

---

### Task 3 : Ajouter `_uploadImageToStorage` dans `collab.js`

**Files:**
- Modify: `collab.js` — section `// ── UTILITAIRES ─` (autour de la ligne 38)

**Interfaces:**
- Produces: `_uploadImageToStorage(elId, base64)` → `Promise<string>` (URL de téléchargement)
- Consumes: `firebase.storage()`, `_boardId`

- [ ] **Step 1 : Ajouter la fonction après `_makeThrottle` (autour de la ligne 80)**

```js
/**
 * Upload une image base64 vers Firebase Storage.
 * Retourne l'URL de téléchargement publique.
 * Lève une erreur si l'upload échoue (à catch par l'appelant).
 */
async function _uploadImageToStorage(elId, base64) {
  const storageRef = firebase.storage().ref('collabImages/' + _boardId + '/' + elId);
  await storageRef.putString(base64, 'data_url');
  return await storageRef.getDownloadURL();
}
```

- [ ] **Step 2 : Vérifier la syntaxe**

Recharger l'extension et ouvrir un board. Dans la console (sans démarrer de session) :

```js
typeof window.Collab  // → "object" (pas d'erreur de parsing)
```

Si une erreur de syntaxe apparaît dans la console au chargement, vérifier que la fonction est bien à l'intérieur du bloc IIFE (avant le `return { ... }` final).

- [ ] **Step 3 : Commit**

```bash
git add collab.js
git commit -m "feat: ajouter _uploadImageToStorage vers Firebase Storage"
```

---

### Task 4 : Modifier `startSession` — upload groupé avec progression

**Files:**
- Modify: `collab.js` — `startSession`, bloc `if (opts && opts.elements)` (lignes 159-212)

**Interfaces:**
- Consumes: `_uploadImageToStorage`, `App._imgStoreGet`
- Produces: images uploadées vers Storage, URLs dans le batch RTDB au lieu de base64 ou `'pending'`

- [ ] **Step 1 : Remplacer le bloc `if (opts && opts.elements)` dans `startSession`**

Localiser ce bloc (ligne 159) :

```js
if (opts && opts.elements) {
  const updates = {};
  const pendingImages = [];
  opts.elements.forEach((el) => {
    // ...
  });
  if (Object.keys(updates).length) {
    await _sessionRef.update(updates);
  }
  // Upload des images individuellement ...
  for (var i = 0; i < pendingImages.length; i++) {
    // ...
  }
}
```

Remplacer **tout ce bloc** par :

```js
if (opts && opts.elements) {
  // Séparer images et autres éléments
  const imgEls = opts.elements.filter((el) => el.type === 'image' && el.data && el.data !== 'pending');
  const otherEls = opts.elements.filter((el) => el.type !== 'image');

  // Afficher progression sur le bouton collab
  const collabBtn = document.getElementById('collab-btn');
  const _btnOriginal = collabBtn ? collabBtn.innerHTML : null;
  const _setProgress = function (done, total) {
    if (collabBtn) collabBtn.textContent = total > 0 ? 'Préparation… ' + done + ' / ' + total : 'Préparation…';
  };

  // Collecter les URLs (upload séquentiel pour éviter de saturer la connexion)
  const imgUrls = {};
  _setProgress(0, imgEls.length);
  for (var imgIdx = 0; imgIdx < imgEls.length; imgIdx++) {
    var imgEl = imgEls[imgIdx];
    var base64 = (App._imgStoreGet && App._imgStoreGet(imgEl.id)) || imgEl.data;
    try {
      imgUrls[imgEl.id] = await _uploadImageToStorage(imgEl.id, base64);
    } catch (_) {
      // Tolérer l'échec d'une image : elle restera 'pending' dans RTDB
    }
    _setProgress(imgIdx + 1, imgEls.length);
  }

  // Restaurer le bouton
  if (collabBtn && _btnOriginal !== null) collabBtn.innerHTML = _btnOriginal;

  // Construire le batch RTDB
  const updates = {};
  opts.elements.forEach((el) => {
    if (el.type === 'connection') {
      updates['connections/' + el.connId] = { from: el.from, to: el.to };
    } else if (el.type === 'caption') {
      const capId = 'cap_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      updates['captions/' + capId] = {
        parentId: el.parentId || '',
        x: el.x,
        y: el.y,
        width: el.width || '',
        text: el.text || '',
      };
    } else {
      var elData;
      if (el.type === 'image') {
        elData = imgUrls[el.id] || 'pending';
      } else {
        elData = el.data || '';
      }
      updates['elements/' + el.id] = {
        x: el.x,
        y: el.y,
        w: el.w || null,
        h: el.h || null,
        z: el.z || 100,
        type: el.type,
        data: elData,
        style: el.style || null,
        version: 0,
        lastEditBy: _userId,
        lastEditAt: firebase.database.ServerValue.TIMESTAMP,
        deleted: false,
      };
    }
  });
  if (Object.keys(updates).length) {
    await _sessionRef.update(updates);
  }
}
```

- [ ] **Step 2 : Tester manuellement**

1. Ajouter 2-3 images sur un board
2. Démarrer une session collab (bouton collab → créer session)
3. Vérifier que le bouton affiche `Préparation… 1 / 3`, `2 / 3`, etc.
4. Ouvrir la console Firebase → Storage → `collabImages/{boardId}/` → les fichiers doivent être présents
5. Dans la console DevTools, ouvrir Firebase RTDB console → `collabSessions/{boardId}/elements/{elId}/data` → valeur doit être une URL `https://firebasestorage.googleapis.com/...`

- [ ] **Step 3 : Tester côté collaborateur**

Depuis un autre navigateur (ou un profil Chrome différent), rejoindre la session avec le lien de partage. Les images doivent apparaître correctement (chargées depuis les URLs Storage).

- [ ] **Step 4 : Commit**

```bash
git add collab.js
git commit -m "feat: startSession — upload groupé images vers Firebase Storage avec progression"
```

---

### Task 5 : Modifier `syncElementCreate` — upload immédiat pour les nouvelles images

**Files:**
- Modify: `collab.js` — fonction `syncElementCreate` (lignes 506-531)

**Interfaces:**
- Consumes: `_uploadImageToStorage`
- Produces: nouvelles images uploadées vers Storage pendant la session, URL dans RTDB

- [ ] **Step 1 : Remplacer `syncElementCreate`**

Localiser la fonction `syncElementCreate` (ligne 506) et remplacer **tout son contenu** par :

```js
function syncElementCreate(elId, type, x, y, w, h, data, z, style) {
  if (!_active || !_sessionRef) return;
  var _isImg = type === 'image';

  // Écrire d'abord avec 'pending' pour que le collab voie l'élément immédiatement
  _sessionRef.child('elements/' + elId).set({
    x: x,
    y: y,
    w: w || null,
    h: h || null,
    z: z || 100,
    type: type,
    data: _isImg ? 'pending' : (data || ''),
    style: style || null,
    version: 0,
    lastEditBy: _userId,
    lastEditAt: firebase.database.ServerValue.TIMESTAMP,
    deleted: false,
  });

  // Upload vers Storage puis mettre à jour RTDB avec l'URL (toutes tailles)
  if (_isImg && data && data !== 'pending') {
    _uploadImageToStorage(elId, data)
      .then(function (url) {
        if (!_active || !_sessionRef) return;
        _sessionRef.child('elements/' + elId).update({
          data: url,
          lastEditBy: _userId,
          lastEditAt: firebase.database.ServerValue.TIMESTAMP,
        });
      })
      .catch(function () {
        // Tolérer l'échec — l'image reste 'pending' dans RTDB
      });
  }
}
```

- [ ] **Step 2 : Tester manuellement**

1. Démarrer une session collab
2. Ajouter une image (même > 768 KB)
3. Depuis le profil collaborateur, vérifier que l'image apparaît correctement (URL Storage chargée)
4. Vérifier dans RTDB que `data` est bien une URL (pas `'pending'`) après quelques secondes

- [ ] **Step 3 : Commit**

```bash
git add collab.js
git commit -m "feat: syncElementCreate — upload image vers Storage (supprime limite 768 KB)"
```

---

### Task 6 : Téléchargement local à la fin de session

**Files:**
- Modify: `collab.js` — `endSession` (ligne 234), `_mergeSessionToLocal` (ligne 1260)
- Modify: `collab.js` — section utilitaires (ajouter `_downloadStorageImages`)

**Interfaces:**
- Consumes: `App._imgStoreGet`, `App._imgStoreSet`, `App.saveCurrentBoard`
- Produces: base64 dans `_imgStore` pour toutes les images Storage, sauvegarde IndexedDB

- [ ] **Step 1 : Ajouter `_downloadStorageImages` après `_uploadImageToStorage`**

```js
/**
 * Télécharge toutes les images Firebase Storage du canvas courant en base64
 * et les stocke dans _imgStore via App._imgStoreSet.
 * Appelée avant endSession pour garantir une copie locale complète.
 */
async function _downloadStorageImages(progressCb) {
  const imgEls = Array.from(document.querySelectorAll('[data-type="image"]'));
  const storagePrefix = 'https://firebasestorage.googleapis.com';
  var done = 0;
  if (progressCb) progressCb(0, imgEls.length);
  for (var i = 0; i < imgEls.length; i++) {
    var el = imgEls[i];
    var elId = el.dataset.id;
    var imgTag = el.querySelector('img');
    if (!imgTag) { done++; continue; }
    var src = imgTag.src || '';
    // Télécharger uniquement les URLs Storage (pas les base64 déjà en mémoire)
    if (src.indexOf(storagePrefix) === 0) {
      try {
        var resp = await fetch(src);
        var blob = await resp.blob();
        var base64 = await new Promise(function (resolve) {
          var reader = new FileReader();
          reader.onloadend = function () { resolve(reader.result); };
          reader.readAsDataURL(blob);
        });
        if (App._imgStoreSet) App._imgStoreSet(elId, base64);
      } catch (_) {
        // Échec toléré : l'URL reste dans _imgStore si App._imgStoreGet la retourne
      }
    }
    done++;
    if (progressCb) progressCb(done, imgEls.length);
  }
}
```

- [ ] **Step 2 : Modifier `endSession` pour appeler `_downloadStorageImages` avec progression**

Dans `endSession` (ligne 234), localiser ces lignes :

```js
// Sauvegarder les données en local avant de quitter
if (_sessionRef) {
  _mergeSessionToLocal();
}
```

Remplacer par :

```js
// Télécharger les images Storage en local puis sauvegarder
if (_sessionRef) {
  var endBtn = document.getElementById('collab-btn');
  var _endBtnOriginal = endBtn ? endBtn.innerHTML : null;
  var _setEndProgress = function (done, total) {
    if (endBtn) endBtn.textContent = total > 0 ? 'Sauvegarde… ' + done + ' / ' + total : 'Sauvegarde…';
  };
  _downloadStorageImages(_setEndProgress).then(function () {
    if (endBtn && _endBtnOriginal !== null) endBtn.innerHTML = _endBtnOriginal;
    _mergeSessionToLocal();
  });
}
```

- [ ] **Step 3 : Modifier `_mergeSessionToLocal` pour utiliser `_imgStore` en priorité**

Dans `_mergeSessionToLocal` (ligne 1260), localiser ce passage dans la boucle `elemSnap.forEach` :

```js
elements.push({
  id: child.key,
  type: d.type,
  x: d.x,
  y: d.y,
  w: d.w,
  h: d.h,
  z: d.z,
  data: d.data || '',
  style: d.style || null,
});
```

Remplacer par :

```js
var elData = d.data || '';
if (d.type === 'image' && App._imgStoreGet) {
  var localBase64 = App._imgStoreGet(child.key);
  if (localBase64) elData = localBase64;
}
elements.push({
  id: child.key,
  type: d.type,
  x: d.x,
  y: d.y,
  w: d.w,
  h: d.h,
  z: d.z,
  data: elData,
  style: d.style || null,
});
```

- [ ] **Step 4 : Tester le scénario complet**

**Côté owner :**
1. Créer un board avec 3 images (dont une > 768 KB)
2. Démarrer une session collab → vérifier progression `Préparation… X / 3`
3. Terminer la session → vérifier progression `Sauvegarde… X / 3`
4. Déconnecter le réseau (désactiver le wifi)
5. Fermer et rouvrir l'extension → le board doit s'ouvrir avec toutes les images

**Côté collaborateur :**
1. Rejoindre la session depuis un autre profil Chrome
2. Les images doivent apparaître (via URLs Storage)
3. Cliquer "Quitter la session" → `Sauvegarde… X / 3` doit s'afficher
4. Déconnecter le réseau → rouvrir l'extension → le board collaborateur doit avoir toutes les images en local

- [ ] **Step 5 : Commit**

```bash
git add collab.js
git commit -m "feat: téléchargement local des images Storage à la fin de session collab"
```

---

## Auto-vérification du plan

### Couverture spec → plan

| Exigence spec | Task couvrant |
|---|---|
| SDK Firebase Storage chargé | Task 1 |
| `_uploadImageToStorage` utilitaire | Task 3 |
| `startSession` — upload groupé + progression | Task 4 |
| `syncElementCreate` — upload immédiat, toutes tailles | Task 5 |
| `_downloadStorageImages` + progression fin de session | Task 6 |
| `_mergeSessionToLocal` — base64 local au lieu d'URL | Task 6 Step 3 |
| Bridges `_imgStoreGet` / `_imgStoreSet` dans app.js | Task 2 |
| Fallback si upload échoue → `'pending'` | Task 4 + Task 5 |
| Fallback si download échoue → URL conservée | Task 6 Step 1 |
| Comportement solo inchangé | (aucun code solo modifié) ✅ |

### Cohérence des noms

- `_uploadImageToStorage(elId, base64)` → utilisé dans Task 4 et Task 5 ✅
- `_downloadStorageImages(progressCb)` → utilisé dans Task 6 Step 2 ✅
- `App._imgStoreGet(elId)` → utilisé dans Task 4 et Task 6 ✅
- `App._imgStoreSet(elId, data)` → utilisé dans Task 6 Step 1 ✅
- `collabImages/{boardId}/{elId}` → chemin Storage cohérent Tasks 3-5 ✅
