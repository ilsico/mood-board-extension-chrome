# PWA iPhone Companion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter Google Sign-in à l'extension, un bouton "Épingler sur l'iPhone" par board, un panneau Inbox pour importer les captures mobiles, puis construire la PWA compagnon (5 écrans) hébergée dans `/pwa/` sur Netlify.

**Architecture:** L'extension écrit les boards épinglés et les captures sous `/users/{uid}/` dans Firebase (même instance que le collab). La PWA lit ces données après Google Sign-in — même `uid`, données isolées par compte. Aucune édition du canvas sur mobile : lecture + capture uniquement.

**Tech Stack:** Vanilla JS, Firebase compat v9 (déjà bundlé dans l'extension + CDN pour la PWA), HTML/CSS mobile-first, Service Worker, Web App Manifest avec `share_target`.

## Global Constraints

- Zéro `console.log` dans `app.js` ou `collab.js`
- Tout le code dans `app.js` reste dans l'IIFE `App = (function(){...})()`
- `firebase-auth-compat.js` est déjà chargé dans `index.html` (ligne 13) — ne pas le rajouter
- Les nouveaux boutons dans `#board-header` restent cachés quand `_currentUser === null` (non connecté)
- Collab sync non altéré : `window._fbUid` et `window._fbAuthReady` continuent de fonctionner pour `collab.js`
- Boards epinglés : toujours utiliser `board.coverImage || board.snapshot` pour le thumb, jamais générer une nouvelle capture
- Images dans Firebase mobile : inclure `data` (base64) car la PWA ne peut pas lire `_imgStore`

---

## File Map

| Fichier | Action |
|---------|--------|
| `firebase-init.js` | Modifier : ajouter `onAuthStateChanged` → dispatche `fb-auth-change`, maintient `window._currentFirebaseUser` |
| `index.html` | Modifier : bouton `#google-signin-btn` + `#pin-mobile-btn` + `#inbox-btn` + `#inbox-count` + `#inbox-panel` + CSS |
| `app.js` | Modifier : `let _currentUser`, `let _pinnedBoards`, auth listener, `togglePinBoard`, `_syncBoardElements`, `_updatePinBtn`, `_isPinned`, `_syncPinnedBoards`, inbox panel, activity write |
| `pwa/index.html` | Créer : app shell HTML (5 écrans, bottom tab bar) |
| `pwa/manifest.json` | Créer : Web App Manifest + `share_target` |
| `pwa/sw.js` | Créer : Service Worker (cache statique + interception share) |
| `pwa/pwa.css` | Créer : styles mobile-first (cards 500:340, viewer, inbox, tab bar) |
| `pwa/pwa.js` | Créer : toute la logique PWA (auth, accueil, viewer, inbox, share, activité) |

---

## Task 1 — Firebase Google Sign-in (extension)

**Files:**
- Modify: `firebase-init.js`
- Modify: `index.html` (CSS + bouton `#google-signin-btn`)
- Modify: `app.js` (lignes ~14–16 état IIFE + `init()`)

**Interfaces:**
- Produces: `window._currentFirebaseUser` → `firebase.User | null`; event `fb-auth-change` (detail = user); `_currentUser` dans app.js; `document.getElementById('google-signin-btn')`

- [ ] **Step 1 — Ajouter `onAuthStateChanged` dans `firebase-init.js`**

Ouvrir `firebase-init.js`. Après la ligne `window._fbDb.ref('.info/connected').on(...)` (ligne ~44) et avant l'accolade `} catch (e) {`, ajouter :

```js
  // Maintenir une référence à l'utilisateur courant pour le mobile sync
  window._currentFirebaseUser = null;
  firebase.auth().onAuthStateChanged(function (user) {
    window._currentFirebaseUser = user;
    if (user) window._fbUid = user.uid; // met à jour le UID pour collab aussi
    document.dispatchEvent(new CustomEvent('fb-auth-change', { detail: user }));
  });
```

- [ ] **Step 2 — Ajouter le CSS du bouton Google Sign-in dans `index.html`**

Dans le bloc `<style>`, après la règle `.share-btn:hover` (~ligne 733), ajouter :

```css
      #google-signin-btn {
        display: none;
        align-items: center;
        gap: 6px;
        border: none;
        background: var(--bg-input);
        color: var(--fg);
        border-radius: 6px;
        padding: 4px 10px;
        font-family: 'HelveticaRoman', sans-serif;
        font-size: 12px;
        cursor: pointer;
        white-space: nowrap;
      }
      #google-signin-btn:hover { opacity: 0.8; }
      #google-signin-btn.visible { display: flex; }
```

- [ ] **Step 3 — Ajouter le bouton `#google-signin-btn` dans le header**

Dans `index.html`, après la ligne `</div>` qui ferme `#share-wrap` (~ligne 4140), insérer :

```html
        <button id="google-signin-btn" title="Se connecter pour épingler des boards sur l'iPhone">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20.283 10.356h-8.327v3.451h4.792c-.446 2.193-2.313 3.338-4.792 3.338a5.197 5.197 0 0 1 0-10.395c1.248 0 2.382.44 3.26 1.16l2.46-2.461A8.644 8.644 0 0 0 11.956 3a8.956 8.956 0 1 0 0 17.912c4.962 0 8.427-3.494 8.427-8.418 0-.564-.051-1.105-.1-1.138z" fill="currentColor"/>
          </svg>
          Connexion
        </button>
```

- [ ] **Step 4 — Ajouter `_currentUser` dans l'état IIFE de `app.js`**

Dans `app.js`, après `let currentBoardId = null;` (ligne 15), ajouter :

```js
  let _currentUser = null; // utilisateur Firebase Google (null si non connecté / anonyme)
  let _pinnedBoards = new Set(); // IDs des boards épinglés sur mobile
```

- [ ] **Step 5 — Écouter `fb-auth-change` dans `init()` de `app.js`**

Dans `app.js`, dans la fonction `init()`, après `await loadBoardsFromStorage();` (~ligne 452), ajouter :

```js
    document.addEventListener('fb-auth-change', function (e) {
      const user = e.detail;
      // On considère "connecté Google" uniquement si l'utilisateur n'est pas anonyme
      _currentUser = (user && !user.isAnonymous) ? user : null;
      const signinBtn = document.getElementById('google-signin-btn');
      if (signinBtn) {
        signinBtn.classList.toggle('visible', _currentUser === null);
      }
      if (_currentUser) _syncPinnedBoards();
    });
```

- [ ] **Step 6 — Handler clic Google Sign-in dans `setupUIEvents()`**

Dans `app.js`, dans `setupUIEvents()` (~ligne 493), après le premier bloc `addEvt(...)`, ajouter :

```js
    const signinBtn = document.getElementById('google-signin-btn');
    if (signinBtn) {
      signinBtn.addEventListener('click', function () {
        const provider = new firebase.auth.GoogleAuthProvider();
        firebase.auth().signInWithPopup(provider).catch(function () {
          showToast('Connexion annulée');
        });
      });
    }
```

- [ ] **Step 7 — Ajouter `_syncPinnedBoards()` dans `app.js`**

Dans `app.js`, dans la section des fonctions utilitaires (après `saveCurrentBoard` ~ligne 260), ajouter :

```js
  function _syncPinnedBoards() {
    if (!_currentUser || !window._fbDb) return;
    window._fbDb.ref('users/' + _currentUser.uid + '/pinned_boards').get().then(function (snap) {
      _pinnedBoards.clear();
      if (snap.exists()) {
        Object.keys(snap.val()).forEach(function (id) { _pinnedBoards.add(id); });
      }
    }).catch(function () {});
  }
```

- [ ] **Step 8 — Vérifier**

1. Recharger l'extension dans `chrome://extensions`
2. Ouvrir l'extension — le bouton "Connexion" doit être caché (l'utilisateur est anonyme, pas Google)
3. Ouvrir la console DevTools de la page extension — pas d'erreur JS
4. Vérifier dans Firebase console (Authentication) que l'utilisateur anonyme est toujours présent

- [ ] **Step 9 — Commit**

```bash
git add firebase-init.js index.html app.js
git commit -m "feat: Firebase Google Sign-in pour mobile sync (bouton + auth state)"
```

---

## Task 2 — Bouton Épingler sur l'iPhone + sync Firebase

**Files:**
- Modify: `index.html` (CSS + bouton `#pin-mobile-btn` dans `#board-header`)
- Modify: `app.js` (`togglePinBoard`, `_syncBoardElements`, `_updatePinBtn`, `_isPinned`, wiring dans `openBoard`/`goHome`/`setupUIEvents`)

**Interfaces:**
- Consumes: `_currentUser` (Task 1), `_pinnedBoards` (Task 1), `currentBoardId`, `boards`, `_imgStore`, `showToast`
- Produces: `#pin-mobile-btn` (visible dans un board ouvert, coloré si épinglé); Firebase `/users/{uid}/pinned_boards/{boardId}` et `/users/{uid}/boards/{boardId}/`

- [ ] **Step 1 — CSS du bouton pin dans `index.html`**

Dans `<style>`, après le CSS `#google-signin-btn` ajouté en Task 1, ajouter :

```css
      #pin-mobile-btn {
        display: none;
        border: none;
        background: none;
        color: var(--fg);
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 6px;
        opacity: 0.5;
        transition: opacity 0.15s;
      }
      #pin-mobile-btn:hover { opacity: 1; }
      #pin-mobile-btn.active { color: #ff3c00; opacity: 1; }
      #pin-mobile-btn.visible { display: flex; align-items: center; }
```

- [ ] **Step 2 — HTML du bouton pin dans `#board-header`**

Dans `index.html`, dans `<header id="board-header">` (~ligne 3778), après `<div id="collab-status-bar"...>` et avant `</header>`, insérer :

```html
        <button id="pin-mobile-btn" title="Épingler sur l'iPhone">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"/>
            <path d="M10 19v-3.96 3.15"/>
            <path d="M7 19h5"/>
            <rect width="6" height="10" x="16" y="12" rx="2"/>
          </svg>
        </button>
```

- [ ] **Step 3 — Ajouter `_isPinned`, `_updatePinBtn`, `_syncBoardElements`, `togglePinBoard` dans `app.js`**

Dans `app.js`, après `_syncPinnedBoards()` (Task 1), ajouter :

```js
  function _isPinned(boardId) {
    return _pinnedBoards.has(boardId);
  }

  function _updatePinBtn(pinned) {
    const btn = document.getElementById('pin-mobile-btn');
    if (!btn) return;
    btn.classList.toggle('active', !!pinned);
  }

  function _syncBoardElements(boardId) {
    if (!_currentUser || !window._fbDb) return;
    const board = boards.find(function (b) { return b.id === boardId; });
    if (!board || !board.elements) return;
    // Inclure les données images (base64) pour que la PWA puisse les afficher
    const payload = { name: board.name, elements: board.elements, savedAt: board.savedAt };
    window._fbDb.ref('users/' + _currentUser.uid + '/boards/' + boardId)
      .set(payload)
      .catch(function () {});
  }

  async function togglePinBoard(boardId) {
    if (!_currentUser) { showToast('Connecte-toi pour épingler sur l\'iPhone'); return; }
    if (!window._fbDb) return;
    const board = boards.find(function (b) { return b.id === boardId; });
    if (!board) return;
    const ref = window._fbDb.ref('users/' + _currentUser.uid + '/pinned_boards/' + boardId);
    const snap = await ref.get();
    if (snap.exists()) {
      await ref.remove();
      window._fbDb.ref('users/' + _currentUser.uid + '/boards/' + boardId).remove().catch(function () {});
      _pinnedBoards.delete(boardId);
      showToast('Board retiré du mobile');
      _updatePinBtn(false);
    } else {
      const thumb = board.coverImage || board.snapshot || '';
      await ref.set({ name: board.name, thumb: thumb, savedAt: board.savedAt, pinned: true });
      _pinnedBoards.add(boardId);
      _syncBoardElements(boardId);
      showToast('Board épinglé sur iPhone');
      _updatePinBtn(true);
    }
  }
```

- [ ] **Step 4 — Sync auto dans `saveCurrentBoard()` si board épinglé**

Dans `app.js`, dans `saveCurrentBoard()`, après `saveBoards()` (ligne ~251), juste avant le bloc `if (window._fbDb) {` existant, ajouter :

```js
    if (_currentUser && _isPinned(currentBoardId)) {
      _syncBoardElements(currentBoardId);
      // Mettre à jour le thumb si disponible
      if (board.coverImage || board.snapshot) {
        const thumb = board.coverImage || board.snapshot;
        window._fbDb.ref('users/' + _currentUser.uid + '/pinned_boards/' + currentBoardId + '/thumb')
          .set(thumb).catch(function () {});
      }
    }
```

- [ ] **Step 5 — Montrer/cacher le bouton pin dans `openBoard()` et `goHome()`**

Dans `app.js`, dans `openBoard()`, après `document.getElementById('board-title-display').textContent = board.name;` (~ligne 1497), ajouter :

```js
        const pinBtn = document.getElementById('pin-mobile-btn');
        if (pinBtn) {
          if (_currentUser) {
            pinBtn.classList.add('visible');
            _updatePinBtn(_isPinned(id));
          } else {
            pinBtn.classList.remove('visible');
          }
        }
```

Dans `app.js`, dans `goHome()` (~ligne 1548), après `const shareWrap = document.getElementById('share-wrap');` et `shareWrap.style.display = 'none';`, ajouter :

```js
    const pinBtn = document.getElementById('pin-mobile-btn');
    if (pinBtn) pinBtn.classList.remove('visible', 'active');
```

- [ ] **Step 6 — Wiring clic dans `setupUIEvents()`**

Dans `app.js`, dans `setupUIEvents()`, après le handler `signinBtn` (Task 1), ajouter :

```js
    const pinMobileBtn = document.getElementById('pin-mobile-btn');
    if (pinMobileBtn) {
      pinMobileBtn.addEventListener('click', function () {
        if (currentBoardId) togglePinBoard(currentBoardId);
      });
    }
```

- [ ] **Step 7 — Vérifier**

1. Recharger l'extension
2. Se connecter avec Google (bouton Connexion) → le bouton disparaît
3. Ouvrir un board → le bouton pin-mobile apparaît dans le header (gris)
4. Cliquer → devient rouge (#ff3c00) + toast "Board épinglé sur iPhone"
5. Vérifier dans Firebase console : `/users/{uid}/pinned_boards/{boardId}` existe avec `thumb`, `name`, `savedAt`
6. Vérifier : `/users/{uid}/boards/{boardId}/elements` contient les éléments
7. Cliquer à nouveau → devient gris + toast "Board retiré du mobile"

- [ ] **Step 8 — Commit**

```bash
git add index.html app.js
git commit -m "feat: bouton Épingler sur iPhone avec sync Firebase et auto-update au save"
```

---

## Task 3 — Panneau Inbox (extension)

**Files:**
- Modify: `index.html` (CSS + `#inbox-btn`, `#inbox-count`, `#inbox-panel`)
- Modify: `app.js` (`_setupInboxListener`, `_renderInboxPanel`, `_importInboxItem`)

**Interfaces:**
- Consumes: `_currentUser` (Task 1), `makeElement`, `showToast`, `currentBoardId`
- Produces: `#inbox-btn` (badge en temps réel), `#inbox-panel` (drawer), import vers canvas actif, marque `imported:true` dans Firebase

- [ ] **Step 1 — CSS inbox dans `index.html`**

Dans `<style>`, après la règle `#pin-mobile-btn`, ajouter :

```css
      #inbox-btn {
        position: relative;
        display: flex;
        align-items: center;
        border: none;
        background: none;
        color: var(--fg);
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 6px;
        opacity: 0.5;
      }
      #inbox-btn:hover { opacity: 1; }
      #inbox-btn.has-items { opacity: 1; }
      #inbox-count {
        position: absolute;
        top: 0; right: 0;
        background: #ff3c00;
        color: #fff;
        border-radius: 10px;
        font-size: 10px;
        font-family: 'HelveticaBold', sans-serif;
        min-width: 16px;
        height: 16px;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 0 3px;
      }
      #inbox-count.visible { display: flex; }
      #inbox-panel {
        position: fixed;
        top: 0; right: -360px;
        width: 340px;
        height: 100%;
        background: var(--bg);
        border-left: 1px solid var(--border);
        z-index: 10000;
        transition: right 0.28s cubic-bezier(0.16,1,0.3,1);
        display: flex;
        flex-direction: column;
        padding: 0;
        box-shadow: -4px 0 20px rgba(0,0,0,0.15);
      }
      #inbox-panel.open { right: 0; }
      .inbox-panel-header {
        padding: 16px 18px 12px;
        font-family: 'HelveticaBold', sans-serif;
        font-size: 14px;
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .inbox-close-btn {
        border: none; background: none; cursor: pointer;
        color: var(--fg); opacity: 0.5; font-size: 18px; padding: 0 4px;
      }
      .inbox-close-btn:hover { opacity: 1; }
      .inbox-list { flex: 1; overflow-y: auto; padding: 8px; }
      .inbox-item {
        display: flex; align-items: center; gap: 10px;
        padding: 8px; border-radius: 8px;
        border: 1px solid var(--border);
        margin-bottom: 6px;
        background: var(--bg-input);
      }
      .inbox-item-thumb {
        width: 48px; height: 48px; border-radius: 4px;
        object-fit: cover; flex-shrink: 0; background: #222;
      }
      .inbox-item-info { flex: 1; min-width: 0; }
      .inbox-item-type {
        font-size: 10px; opacity: 0.5; text-transform: uppercase;
        font-family: 'HelveticaBold', sans-serif; letter-spacing: 0.06em;
      }
      .inbox-item-data {
        font-size: 12px; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis; margin-top: 2px;
      }
      .inbox-item-date { font-size: 10px; opacity: 0.4; margin-top: 2px; }
      .inbox-import-btn {
        border: 1px solid var(--border);
        background: none; color: var(--fg);
        border-radius: 6px; padding: 4px 8px;
        font-size: 11px; cursor: pointer; flex-shrink: 0;
        font-family: 'HelveticaRoman', sans-serif;
      }
      .inbox-import-btn:hover { background: var(--bg-input); }
      .inbox-empty {
        text-align: center; padding: 40px 20px;
        opacity: 0.4; font-size: 13px;
      }
```

- [ ] **Step 2 — HTML inbox dans `#board-header` et body**

Dans `index.html`, dans `<header id="board-header">`, après le bouton `#pin-mobile-btn`, ajouter :

```html
        <button id="inbox-btn" title="Captures depuis l'iPhone">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16"/>
            <path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2"/>
            <circle cx="13" cy="7" r="1" fill="currentColor"/>
            <rect x="8" y="2" width="14" height="14" rx="2"/>
          </svg>
          <span id="inbox-count"></span>
        </button>
```

Juste avant `</body>` (tout en bas du body), ajouter :

```html
    <div id="inbox-panel">
      <div class="inbox-panel-header">
        <span>Captures iPhone</span>
        <button class="inbox-close-btn" id="inbox-close-btn">×</button>
      </div>
      <div class="inbox-list" id="inbox-list"></div>
    </div>
```

- [ ] **Step 3 — Logique inbox dans `app.js`**

Dans `app.js`, après `togglePinBoard()` (Task 2), ajouter :

```js
  let _inboxUnsubscribe = null; // fonction pour détacher le listener Firebase inbox

  function _setupInboxListener() {
    if (!_currentUser || !window._fbDb) return;
    if (_inboxUnsubscribe) { _inboxUnsubscribe(); _inboxUnsubscribe = null; }
    const ref = window._fbDb.ref('users/' + _currentUser.uid + '/inbox');
    const handler = ref.on('value', function (snap) {
      const items = [];
      if (snap.exists()) {
        snap.forEach(function (child) {
          const v = child.val();
          if (!v.imported) items.push(Object.assign({ _key: child.key }, v));
        });
      }
      const count = items.length;
      const badge = document.getElementById('inbox-count');
      const btn = document.getElementById('inbox-btn');
      if (badge) {
        badge.textContent = count > 0 ? count : '';
        badge.classList.toggle('visible', count > 0);
      }
      if (btn) btn.classList.toggle('has-items', count > 0);
      _renderInboxPanel(items);
    });
    _inboxUnsubscribe = function () { ref.off('value', handler); };
  }

  function _renderInboxPanel(items) {
    const list = document.getElementById('inbox-list');
    if (!list) return;
    if (!items || items.length === 0) {
      list.innerHTML = '<div class="inbox-empty">Aucune capture en attente.</div>';
      return;
    }
    list.innerHTML = '';
    items.forEach(function (item) {
      const div = document.createElement('div');
      div.className = 'inbox-item';
      const isImage = item.type === 'image';
      const dateStr = item.addedAt ? new Date(item.addedAt).toLocaleDateString('fr-FR') : '';
      div.innerHTML = (isImage
        ? '<img class="inbox-item-thumb" src="' + (item.data || '') + '" alt="">'
        : '<div class="inbox-item-thumb" style="display:flex;align-items:center;justify-content:center;opacity:0.3;font-size:22px;">🔗</div>'
      ) + '<div class="inbox-item-info">'
        + '<div class="inbox-item-type">' + (isImage ? 'Image' : 'Lien') + '</div>'
        + '<div class="inbox-item-data">' + (isImage ? 'Depuis iPhone' : (item.url || '')) + '</div>'
        + '<div class="inbox-item-date">' + dateStr + '</div>'
        + '</div>'
        + '<button class="inbox-import-btn" data-key="' + item._key + '" data-type="' + item.type + '">Importer</button>';
      list.appendChild(div);
    });
    list.querySelectorAll('.inbox-import-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _importInboxItem(btn.dataset.key, btn.dataset.type, items.find(function (i) { return i._key === btn.dataset.key; }));
      });
    });
  }

  function _importInboxItem(key, type, item) {
    if (!currentBoardId) { showToast('Ouvre un board avant d\'importer'); return; }
    if (!item) return;
    const cx = (window.innerWidth / 2 - panX) / zoomLevel;
    const cy = (window.innerHeight / 2 - panY) / zoomLevel;
    if (type === 'image') {
      createImageElement(item.data, cx - 150, cy - 100, 300, null);
    } else if (type === 'url') {
      const url = item.url || '';
      const el = makeElement('link', cx - 150, cy - 60, 300, 120);
      el.dataset.savedata = JSON.stringify({ url: url, title: url, img: '' });
    }
    pushHistory();
    // Marquer importé dans Firebase
    if (_currentUser && window._fbDb) {
      window._fbDb.ref('users/' + _currentUser.uid + '/inbox/' + key + '/imported').set(true).catch(function () {});
    }
    showToast('Importé sur le canvas');
  }
```

- [ ] **Step 4 — Wiring inbox dans `setupUIEvents()`**

Dans `app.js`, dans `setupUIEvents()`, après le handler `pinMobileBtn`, ajouter :

```js
    const inboxBtn = document.getElementById('inbox-btn');
    const inboxPanel = document.getElementById('inbox-panel');
    const inboxCloseBtn = document.getElementById('inbox-close-btn');
    if (inboxBtn && inboxPanel) {
      inboxBtn.addEventListener('click', function () {
        inboxPanel.classList.toggle('open');
      });
    }
    if (inboxCloseBtn && inboxPanel) {
      inboxCloseBtn.addEventListener('click', function () {
        inboxPanel.classList.remove('open');
      });
    }
```

- [ ] **Step 5 — Démarrer le listener au login + arrêter à `goHome()`**

Dans le listener `fb-auth-change` de `init()` (Task 1), après `if (_currentUser) _syncPinnedBoards();`, ajouter :

```js
      if (_currentUser) {
        _setupInboxListener();
      } else {
        if (_inboxUnsubscribe) { _inboxUnsubscribe(); _inboxUnsubscribe = null; }
        const badge = document.getElementById('inbox-count');
        if (badge) { badge.textContent = ''; badge.classList.remove('visible'); }
      }
```

Dans `goHome()`, après la ligne `if (pinBtn) pinBtn.classList.remove(...)` (Task 2), ajouter :

```js
    const inboxPanel = document.getElementById('inbox-panel');
    if (inboxPanel) inboxPanel.classList.remove('open');
```

- [ ] **Step 6 — Vérifier**

1. Recharger l'extension, se connecter Google, ouvrir un board
2. L'icône inbox est dans le header — badge vide (aucune capture)
3. Manuellement écrire dans Firebase console sous `/users/{uid}/inbox/test1`: `{ type: 'url', url: 'https://example.com', addedAt: 1234567890, imported: false }`
4. Le badge affiche "1" en temps réel
5. Cliquer inbox → panel s'ouvre, l'item est listé
6. Cliquer "Importer" → un élément lien apparaît au centre du canvas, badge revient à 0

- [ ] **Step 7 — Commit**

```bash
git add index.html app.js
git commit -m "feat: panneau inbox captures iPhone avec badge temps réel et import canvas"
```

---

## Task 4 — Journal d'activité write (extension)

**Files:**
- Modify: `app.js` (dans `saveCurrentBoard()`)

**Interfaces:**
- Consumes: `_currentUser`, `currentBoardId`, `boards`, `Collab`
- Produces: Firebase `/boards/{boardId}/activity/{eventId}` — lisible par la PWA

- [ ] **Step 1 — Écrire dans le journal d'activité lors d'un save collab**

Dans `app.js`, dans `saveCurrentBoard()`, après `saveBoards()` (~ligne 251) et après le bloc de sync mobile (Task 2), ajouter :

```js
    if (_currentUser && !_currentUser.isAnonymous &&
        typeof Collab !== 'undefined' && Collab.isActive() && window._fbDb) {
      window._fbDb.ref('boards/' + currentBoardId + '/activity').push({
        uid: _currentUser.uid,
        displayName: _currentUser.displayName || 'Inconnu',
        photoURL: _currentUser.photoURL || '',
        action: 'modified',
        at: Date.now(),
      }).catch(function () {});
    }
```

- [ ] **Step 2 — Vérifier**

1. Recharger l'extension, se connecter Google, ouvrir un board collab
2. Modifier un élément → sauvegarder
3. Firebase console → `/boards/{boardId}/activity/` → une entrée avec `displayName`, `action: 'modified'`, `at`

- [ ] **Step 3 — Commit**

```bash
git add app.js
git commit -m "feat: écriture journal activité Firebase sur save board collab"
```

---

## Task 5 — PWA scaffold (fichiers statiques)

**Files:**
- Create: `pwa/index.html`
- Create: `pwa/manifest.json`
- Create: `pwa/sw.js`
- Create: `pwa/pwa.css`

**Interfaces:**
- Produces: app shell HTML avec 5 écrans (`#screen-home`, `#screen-viewer`, `#screen-inbox`, `#screen-activity`, `#screen-profile`); manifest installable; SW avec cache statique; CSS de base (tab bar, cards, viewer, inbox)

- [ ] **Step 1 — Créer `pwa/manifest.json`**

```json
{
  "name": "Moodboard",
  "short_name": "Moodboard",
  "description": "Vos moodboards sur iPhone",
  "display": "standalone",
  "orientation": "portrait",
  "start_url": "/pwa/",
  "scope": "/pwa/",
  "theme_color": "#111111",
  "background_color": "#111111",
  "icons": [
    { "src": "../icon extension/icon48.png", "sizes": "48x48", "type": "image/png" },
    { "src": "../icon extension/icon128.png", "sizes": "128x128", "type": "image/png" }
  ],
  "share_target": {
    "action": "/pwa/share-target",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "title": "title",
      "text": "text",
      "url": "url",
      "files": [{ "name": "file", "accept": ["image/*"] }]
    }
  }
}
```

- [ ] **Step 2 — Créer `pwa/sw.js`**

```js
const CACHE = 'moodboard-pwa-v1';
const STATIC = ['/pwa/', '/pwa/pwa.js', '/pwa/pwa.css', '/pwa/manifest.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(STATIC); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
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
      return caches.match(e.request);
    })
  );
});
```

- [ ] **Step 3 — Créer `pwa/pwa.css`**

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #111;
  --bg2: #1a1a1a;
  --fg: #f0f0f0;
  --fg2: #888;
  --border: #2a2a2a;
  --accent: #ff3c00;
  --card-ratio: calc(340 / 500);
}
@media (prefers-color-scheme: light) {
  :root { --bg: #f4f4f6; --bg2: #fff; --fg: #111; --fg2: #666; --border: #e0e0e0; }
}

html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--fg); font-family: -apple-system, 'Helvetica Neue', sans-serif; }

/* ── App shell ── */
#app { display: flex; flex-direction: column; height: 100%; }
.screen { display: none; flex: 1; overflow: hidden; flex-direction: column; }
.screen.active { display: flex; }

/* ── Tab bar ── */
#tab-bar {
  display: flex; border-top: 1px solid var(--border);
  background: var(--bg); padding-bottom: env(safe-area-inset-bottom);
  flex-shrink: 0;
}
.tab-btn {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 3px; padding: 8px 0;
  background: none; border: none; color: var(--fg2); cursor: pointer;
  font-size: 10px; font-family: -apple-system, sans-serif;
  -webkit-tap-highlight-color: transparent;
  position: relative;
}
.tab-btn.active { color: var(--accent); }
.tab-btn svg { flex-shrink: 0; }
.tab-badge {
  position: absolute; top: 4px; right: calc(50% - 14px);
  background: var(--accent); color: #fff;
  border-radius: 10px; font-size: 9px; font-weight: bold;
  min-width: 14px; height: 14px;
  display: none; align-items: center; justify-content: center; padding: 0 3px;
}
.tab-badge.visible { display: flex; }

/* ── Screen headers ── */
.screen-header {
  padding: 16px 18px 12px;
  padding-top: calc(16px + env(safe-area-inset-top));
  font-size: 22px; font-weight: 700; flex-shrink: 0;
  display: flex; align-items: center; gap: 10px;
}
.screen-header .back-btn {
  background: none; border: none; color: var(--fg); cursor: pointer;
  padding: 4px; font-size: 20px;
}

/* ── Home screen cards ── */
#boards-grid {
  flex: 1; overflow-y: auto; padding: 12px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
}
.board-card {
  position: relative; border-radius: 4px; overflow: hidden;
  background: #000; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.board-card::before {
  content: ''; display: block;
  padding-top: calc(340 / 500 * 100%); /* ratio 500:340 */
}
.board-card img {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover;
}
.board-card-info {
  position: absolute; bottom: 0; left: 0; right: 0;
  background: linear-gradient(transparent, rgba(0,0,0,0.7));
  padding: 20px 8px 6px;
  color: #fff; font-size: 11px;
}
.board-card-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.board-card-date { font-size: 10px; opacity: 0.6; margin-top: 1px; }
.board-card-dot {
  position: absolute; top: 6px; right: 6px;
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--accent); display: none;
}
.board-card-dot.visible { display: block; }
.board-card-empty {
  position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; font-size: 28px; opacity: 0.2;
}

/* ── Board viewer ── */
#viewer-wrap {
  flex: 1; overflow: hidden; position: relative;
  touch-action: none; background: #000;
}
#viewer-canvas {
  position: absolute; transform-origin: 0 0;
}
.pwa-el {
  position: absolute; box-sizing: border-box;
}
.pwa-el.note {
  background: #1e1e1e; border: 1px solid #333;
  border-radius: 2px; padding: 8px; overflow: hidden;
  font-size: 13px; color: #f0f0f0; white-space: pre-wrap; word-break: break-word;
}
.pwa-el.color {
  border-radius: 2px;
  display: flex; align-items: flex-end; padding: 6px;
}
.pwa-el.color .color-hex { font-size: 10px; color: rgba(255,255,255,0.6); font-family: monospace; }
.pwa-el.link {
  border: 1px solid #333; border-radius: 4px; overflow: hidden;
  background: #1a1a1a; cursor: pointer;
}
.pwa-el.link img.link-thumb { width: 100%; height: 70%; object-fit: cover; display: block; }
.pwa-el.link .link-info { padding: 4px 6px; }
.pwa-el.link .link-title { font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pwa-el.link .link-url { font-size: 9px; opacity: 0.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pwa-el.image-el { object-fit: contain; cursor: pointer; }
.pwa-el.caption { font-size: 12px; opacity: 0.6; max-width: 200px; }

/* Lightbox */
#lightbox {
  position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 9999;
  display: none; align-items: center; justify-content: center;
  -webkit-tap-highlight-color: transparent;
}
#lightbox.open { display: flex; }
#lightbox img { max-width: 100%; max-height: 100%; object-fit: contain; }

/* ── Inbox ── */
#inbox-scroll { flex: 1; overflow-y: auto; }
.inbox-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px; border-bottom: 1px solid var(--border);
}
.inbox-thumb {
  width: 48px; height: 48px; border-radius: 6px;
  object-fit: cover; background: var(--border); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px;
}
.inbox-item-info { flex: 1; min-width: 0; }
.inbox-item-label { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.inbox-item-date { font-size: 11px; color: var(--fg2); margin-top: 2px; }
.inbox-empty { text-align: center; padding: 60px 20px; color: var(--fg2); font-size: 14px; }

#inbox-add-bar {
  padding: 10px 16px; border-top: 1px solid var(--border);
  display: flex; gap: 8px; padding-bottom: calc(10px + env(safe-area-inset-bottom));
  flex-shrink: 0;
}
.inbox-add-btn {
  flex: 1; padding: 10px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--bg2);
  color: var(--fg); font-size: 13px; cursor: pointer; text-align: center;
}
.inbox-add-btn:active { opacity: 0.7; }

/* ── Activity ── */
#activity-scroll { flex: 1; overflow-y: auto; }
.activity-item {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.activity-avatar {
  width: 32px; height: 32px; border-radius: 50%;
  object-fit: cover; flex-shrink: 0; background: var(--border);
  display: flex; align-items: center; justify-content: center; font-size: 14px;
}
.activity-text { flex: 1; font-size: 13px; }
.activity-text strong { font-weight: 600; }
.activity-time { font-size: 11px; color: var(--fg2); margin-top: 2px; }
.activity-empty { text-align: center; padding: 60px 20px; color: var(--fg2); font-size: 14px; }

/* ── Profile ── */
#screen-profile .profile-body { padding: 24px 18px; }
.profile-avatar {
  width: 72px; height: 72px; border-radius: 50%;
  object-fit: cover; margin-bottom: 12px; background: var(--border);
}
.profile-name { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
.profile-email { font-size: 13px; color: var(--fg2); margin-bottom: 24px; }
.profile-btn {
  display: block; width: 100%; padding: 12px;
  border-radius: 8px; border: 1px solid var(--border);
  background: none; color: var(--fg); font-size: 14px;
  cursor: pointer; text-align: center; margin-bottom: 10px;
}
.profile-btn:active { opacity: 0.7; }
.profile-btn.destructive { color: var(--accent); border-color: var(--accent); }

/* ── Auth screen ── */
#screen-auth {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 16px; padding: 40px;
}
#screen-auth h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
#screen-auth p { font-size: 14px; color: var(--fg2); text-align: center; }
.google-signin-btn {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 24px; border-radius: 10px;
  border: 1px solid var(--border); background: var(--bg2);
  color: var(--fg); font-size: 15px; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.google-signin-btn:active { opacity: 0.7; }

/* ── Loading ── */
.pwa-loading { display: flex; align-items: center; justify-content: center; flex: 1; color: var(--fg2); }
```

- [ ] **Step 4 — Créer `pwa/index.html`**

```html
<!doctype html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="theme-color" content="#111111">
  <title>Moodboard</title>
  <link rel="manifest" href="manifest.json">
  <link rel="stylesheet" href="pwa.css">
</head>
<body>
  <!-- Écran auth (affiché si non connecté) -->
  <div id="screen-auth" class="screen">
    <h1>MOODBOARD</h1>
    <p>Consultez vos boards et capturez des inspirations depuis votre iPhone.</p>
    <button class="google-signin-btn" id="auth-google-btn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M20.283 10.356h-8.327v3.451h4.792c-.446 2.193-2.313 3.338-4.792 3.338a5.197 5.197 0 0 1 0-10.395c1.248 0 2.382.44 3.26 1.16l2.46-2.461A8.644 8.644 0 0 0 11.956 3a8.956 8.956 0 1 0 0 17.912c4.962 0 8.427-3.494 8.427-8.418 0-.564-.051-1.105-.1-1.138z" fill="currentColor"/>
      </svg>
      Continuer avec Google
    </button>
  </div>

  <!-- App principale -->
  <div id="app" style="display:none">
    <!-- Écran Accueil -->
    <div id="screen-home" class="screen active">
      <div class="screen-header">Mes boards</div>
      <div id="boards-grid"></div>
    </div>

    <!-- Écran Viewer -->
    <div id="screen-viewer" class="screen">
      <div class="screen-header">
        <button class="back-btn" id="viewer-back-btn">‹</button>
        <span id="viewer-title"></span>
      </div>
      <div id="viewer-wrap">
        <div id="viewer-canvas"></div>
      </div>
    </div>

    <!-- Écran Inbox -->
    <div id="screen-inbox" class="screen">
      <div class="screen-header">Captures</div>
      <div id="inbox-scroll"></div>
      <div id="inbox-add-bar">
        <button class="inbox-add-btn" id="inbox-add-image-btn">+ Image</button>
        <button class="inbox-add-btn" id="inbox-add-url-btn">+ Lien</button>
        <input id="inbox-file-input" type="file" accept="image/*" style="display:none">
      </div>
    </div>

    <!-- Écran Activité -->
    <div id="screen-activity" class="screen">
      <div class="screen-header">Activité</div>
      <div id="activity-scroll"></div>
    </div>

    <!-- Écran Profil -->
    <div id="screen-profile" class="screen">
      <div class="screen-header">Profil</div>
      <div class="profile-body">
        <img class="profile-avatar" id="profile-avatar" src="" alt="">
        <div class="profile-name" id="profile-name"></div>
        <div class="profile-email" id="profile-email"></div>
        <button class="profile-btn destructive" id="profile-signout-btn">Se déconnecter</button>
      </div>
    </div>

    <!-- Tab bar -->
    <nav id="tab-bar">
      <button class="tab-btn active" data-screen="home">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        Boards
      </button>
      <button class="tab-btn" data-screen="inbox">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16"/><path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2"/><circle cx="13" cy="7" r="1" fill="currentColor"/><rect x="8" y="2" width="14" height="14" rx="2"/></svg>
        <span class="tab-badge" id="inbox-tab-badge"></span>
        Captures
      </button>
      <button class="tab-btn" data-screen="activity">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        Activité
      </button>
      <button class="tab-btn" data-screen="profile">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        Profil
      </button>
    </nav>
  </div>

  <!-- Lightbox -->
  <div id="lightbox"><img id="lightbox-img" src="" alt=""></div>

  <!-- Firebase CDN (compat v9) -->
  <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js"></script>
  <script src="pwa.js"></script>
</body>
</html>
```

- [ ] **Step 5 — Vérifier le scaffold**

1. Créer le dossier `pwa/` s'il n'existe pas : `mkdir pwa`
2. Ouvrir `pwa/index.html` dans Chrome (menu Fichier → Ouvrir)
3. L'écran auth s'affiche avec le bouton Google
4. Pas d'erreur JS dans la console (pwa.js n'existe pas encore → erreur 404 normale)
5. Vérifier que le CSS est bien appliqué : fond sombre, texte visible

- [ ] **Step 6 — Commit**

```bash
git add pwa/
git commit -m "feat: PWA scaffold — HTML, manifest, SW, CSS (5 écrans)"
```

---

## Task 6 — PWA auth + écran d'accueil

**Files:**
- Create: `pwa/pwa.js` (début du fichier)

**Interfaces:**
- Consumes: Firebase config, `#screen-auth`, `#app`, `#boards-grid`, `#auth-google-btn`
- Produces: `_db`, `_auth`, `_user`; navigation tab bar; grille de cards 500:340 avec thumb, nom, date, dot activité

- [ ] **Step 1 — Créer `pwa/pwa.js` — init Firebase + auth**

```js
// ── Firebase init ─────────────────────────────────────────────────────────
firebase.initializeApp({
  apiKey: 'AIzaSyBX9Su8qOUfTPjXkVvioA6i5pQBk9f6GMs',
  authDomain: 'moodboard-app-b21b9.firebaseapp.com',
  databaseURL: 'https://moodboard-app-b21b9-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'moodboard-app-b21b9',
  storageBucket: 'moodboard-app-b21b9.firebasestorage.app',
  messagingSenderId: '467105545598',
  appId: '1:467105545598:web:72fceeaa8c4d0c949b472f',
});

var _db   = firebase.database();
var _auth = firebase.auth();
var _user = null;          // firebase.User — non-anonymous Google user
var _pinnedBoards = {};    // { boardId: { name, thumb, savedAt } }
var _activityDots = {};    // { boardId: bool } — nouveau depuis dernière visite
var _lastVisit = parseInt(localStorage.getItem('pwa_last_visit') || '0', 10);
var _inboxListeners = [];  // pour détacher à la déconnexion

// ── Service Worker ─────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/pwa/sw.js').catch(function () {});
  navigator.serviceWorker.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'share-received') {
      _handleShareReceived(e.data.payload);
    }
  });
}
```

- [ ] **Step 2 — Navigation tab bar**

```js
// ── Navigation ─────────────────────────────────────────────────────────────
var _currentScreen = 'home';

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
  var el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(function (b) {
    b.classList.toggle('active', b.dataset.screen === name);
  });
  _currentScreen = name;
}

document.querySelectorAll('.tab-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    showScreen(btn.dataset.screen);
  });
});

document.getElementById('viewer-back-btn').addEventListener('click', function () {
  showScreen('home');
});
```

- [ ] **Step 3 — Auth state + écran d'accueil**

```js
// ── Auth ───────────────────────────────────────────────────────────────────
document.getElementById('auth-google-btn').addEventListener('click', function () {
  var provider = new firebase.auth.GoogleAuthProvider();
  _auth.signInWithPopup(provider).catch(function (err) {
    alert('Connexion annulée : ' + err.message);
  });
});

_auth.onAuthStateChanged(function (user) {
  if (user && !user.isAnonymous) {
    _user = user;
    document.getElementById('screen-auth').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    _onSignedIn();
  } else {
    _user = null;
    document.getElementById('screen-auth').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    _teardownListeners();
  }
});

function _onSignedIn() {
  _updateProfileScreen();
  _loadPinnedBoards();
  _setupInboxBadge();
  _setupActivityListener();
}

function _teardownListeners() {
  _inboxListeners.forEach(function (fn) { fn(); });
  _inboxListeners = [];
}
```

- [ ] **Step 4 — Charger et afficher les boards épinglés**

```js
// ── Accueil — boards épinglés ──────────────────────────────────────────────
function _loadPinnedBoards() {
  if (!_user) return;
  _db.ref('users/' + _user.uid + '/pinned_boards').on('value', function (snap) {
    _pinnedBoards = snap.exists() ? snap.val() : {};
    _renderHomeGrid();
  });
}

function _timeAgo(ts) {
  var diff = Date.now() - ts;
  var m = Math.floor(diff / 60000);
  if (m < 2) return 'à l\'instant';
  if (m < 60) return 'il y a ' + m + ' min';
  var h = Math.floor(m / 60);
  if (h < 24) return 'il y a ' + h + 'h';
  return 'il y a ' + Math.floor(h / 24) + 'j';
}

function _renderHomeGrid() {
  var grid = document.getElementById('boards-grid');
  var ids = Object.keys(_pinnedBoards);
  if (ids.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--fg2);font-size:14px">Aucun board épinglé.<br><br>Ouvre un board dans l\'extension et clique sur l\'icône <strong>monitor</strong> pour l\'épingler.</div>';
    return;
  }
  grid.innerHTML = '';
  ids.forEach(function (id) {
    var b = _pinnedBoards[id];
    var card = document.createElement('div');
    card.className = 'board-card';
    card.dataset.id = id;
    var hasThumb = b.thumb && b.thumb.length > 10;
    var hasDot = !!_activityDots[id];
    card.innerHTML = (hasThumb
      ? '<img src="' + b.thumb + '" alt="">'
      : '<div class="board-card-empty">🎨</div>'
    ) + '<div class="board-card-info">'
      + '<div class="board-card-name">' + _esc(b.name || 'Sans titre') + '</div>'
      + '<div class="board-card-date">' + _timeAgo(b.savedAt || Date.now()) + '</div>'
      + '</div>'
      + '<div class="board-card-dot' + (hasDot ? ' visible' : '') + '"></div>';
    card.addEventListener('click', function () {
      _openBoardViewer(id, b.name || 'Sans titre');
    });
    grid.appendChild(card);
  });
}

function _esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```

- [ ] **Step 5 — Profil**

```js
// ── Profil ─────────────────────────────────────────────────────────────────
function _updateProfileScreen() {
  if (!_user) return;
  var av = document.getElementById('profile-avatar');
  var nm = document.getElementById('profile-name');
  var em = document.getElementById('profile-email');
  if (_user.photoURL) av.src = _user.photoURL; else av.style.display = 'none';
  if (nm) nm.textContent = _user.displayName || '';
  if (em) em.textContent = _user.email || '';
}

document.getElementById('profile-signout-btn').addEventListener('click', function () {
  if (confirm('Se déconnecter ?')) _auth.signOut();
});
```

- [ ] **Step 6 — Vérifier**

1. Ouvrir `pwa/index.html` dans Chrome desktop (ou via Netlify preview)
2. L'écran auth s'affiche
3. Cliquer "Continuer avec Google" → popup Google Sign-in
4. Se connecter → l'app s'affiche, tab bar visible
5. Si des boards ont été épinglés via l'extension (Task 2) → les cards apparaissent avec thumb 500:340 et `object-fit: cover`
6. Aucun board → message vide correct
7. Tab bar : cliquer sur chaque onglet → l'écran change
8. Profil : photo + nom + email du compte Google

- [ ] **Step 7 — Commit**

```bash
git add pwa/pwa.js
git commit -m "feat: PWA auth Google + accueil boards épinglés avec cards 500:340"
```

---

## Task 7 — PWA board viewer (pan/pinch + render éléments)

**Files:**
- Modify: `pwa/pwa.js` (ajouter `_openBoardViewer`, `_renderBoardElement`, pan/pinch handlers)

**Interfaces:**
- Consumes: `_db`, `_user`, `#viewer-canvas`, `#viewer-wrap`, `#lightbox`
- Produces: viewer fonctionnel avec pan 1 doigt, pinch-zoom 2 doigts, tap lien/image

- [ ] **Step 1 — Charger et renderer le board**

Dans `pwa/pwa.js`, après `_esc()`, ajouter :

```js
// ── Board Viewer ────────────────────────────────────────────────────────────
var _viewerBoardId = null;

function _openBoardViewer(boardId, name) {
  _viewerBoardId = boardId;
  document.getElementById('viewer-title').textContent = name;
  var canvas = document.getElementById('viewer-canvas');
  canvas.innerHTML = '<div class="pwa-loading">Chargement…</div>';
  _viewerResetTransform();
  showScreen('viewer');
  _db.ref('users/' + _user.uid + '/boards/' + boardId).once('value').then(function (snap) {
    if (!snap.exists()) {
      canvas.innerHTML = '<div class="pwa-loading">Board introuvable.</div>';
      return;
    }
    var data = snap.val();
    canvas.innerHTML = '';
    (data.elements || []).forEach(function (el) {
      var node = _renderBoardElement(el);
      if (node) canvas.appendChild(node);
    });
  }).catch(function () {
    canvas.innerHTML = '<div class="pwa-loading">Erreur de chargement.</div>';
  });
}

function _renderBoardElement(el) {
  var type = el.type;
  var style = 'left:' + el.x + 'px;top:' + el.y + 'px;'
    + (el.w ? 'width:' + el.w + 'px;' : '')
    + (el.h ? 'height:' + el.h + 'px;' : '')
    + 'z-index:' + (el.z || 100) + ';';

  if (type === 'note') {
    var div = document.createElement('div');
    div.className = 'pwa-el note';
    div.style.cssText = style;
    div.innerHTML = el.data || '';
    if (el.style) {
      if (el.style.fontFamily) div.style.fontFamily = el.style.fontFamily;
      if (el.style.fontSize) div.style.fontSize = el.style.fontSize;
      if (el.style.fontWeight) div.style.fontWeight = el.style.fontWeight;
      if (el.style.textAlign) div.style.textAlign = el.style.textAlign;
    }
    return div;

  } else if (type === 'color') {
    var div = document.createElement('div');
    div.className = 'pwa-el color';
    div.style.cssText = style + 'background:' + (el.data || '#888') + ';';
    div.innerHTML = '<span class="color-hex">' + _esc(el.data || '') + '</span>';
    return div;

  } else if (type === 'link') {
    var d = {};
    try { d = JSON.parse(el.data); } catch (e) {}
    var div = document.createElement('div');
    div.className = 'pwa-el link';
    div.style.cssText = style;
    div.innerHTML = (d.img ? '<img class="link-thumb" src="' + _esc(d.img) + '" alt="">' : '')
      + '<div class="link-info">'
      + '<div class="link-title">' + _esc(d.title || d.url || '') + '</div>'
      + '<div class="link-url">' + _esc(d.url || '') + '</div>'
      + '</div>';
    div.addEventListener('click', function () {
      if (d.url) window.open(d.url, '_blank', 'noopener');
    });
    return div;

  } else if (type === 'image') {
    if (!el.data) return null; // image sans data (collab strip) → ignorer
    var img = document.createElement('img');
    img.className = 'pwa-el image-el';
    img.style.cssText = style + 'object-fit:contain;';
    img.src = el.data;
    img.addEventListener('click', function () { _openLightbox(el.data); });
    return img;

  } else if (type === 'caption') {
    var div = document.createElement('div');
    div.className = 'pwa-el caption';
    div.style.cssText = 'left:' + el.x + 'px;top:' + el.y + 'px;z-index:' + (el.z || 100) + ';';
    if (el.width) div.style.width = el.width;
    div.textContent = el.text || '';
    if (el.style && el.style.fontFamily) div.style.fontFamily = el.style.fontFamily;
    return div;
  }

  return null; // connection et autres : ignorés
}

function _openLightbox(src) {
  var lb = document.getElementById('lightbox');
  var img = document.getElementById('lightbox-img');
  img.src = src;
  lb.classList.add('open');
  lb.onclick = function () { lb.classList.remove('open'); img.src = ''; };
}
```

- [ ] **Step 2 — Pan 1 doigt + pinch-zoom 2 doigts**

```js
// ── Viewer transform ────────────────────────────────────────────────────────
var _vx = 0, _vy = 0, _vz = 1;
var _vDragStart = null;
var _vPinchDist = 0;

function _viewerResetTransform() {
  _vx = 0; _vy = 0; _vz = 1;
  _applyViewerTransform();
}

function _applyViewerTransform() {
  var c = document.getElementById('viewer-canvas');
  if (c) c.style.transform = 'translate(' + _vx + 'px,' + _vy + 'px) scale(' + _vz + ')';
}

function _pinchDist(touches) {
  var dx = touches[0].clientX - touches[1].clientX;
  var dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

var _wrap = document.getElementById('viewer-wrap');
_wrap.addEventListener('touchstart', function (e) {
  if (e.touches.length === 1) {
    _vDragStart = { x: e.touches[0].clientX - _vx, y: e.touches[0].clientY - _vy };
  } else if (e.touches.length === 2) {
    _vPinchDist = _pinchDist(e.touches);
    _vDragStart = null;
  }
}, { passive: true });

_wrap.addEventListener('touchmove', function (e) {
  e.preventDefault();
  if (e.touches.length === 1 && _vDragStart) {
    _vx = e.touches[0].clientX - _vDragStart.x;
    _vy = e.touches[0].clientY - _vDragStart.y;
    _applyViewerTransform();
  } else if (e.touches.length === 2) {
    var dist = _pinchDist(e.touches);
    var ratio = dist / _vPinchDist;
    _vz = Math.min(Math.max(_vz * ratio, 0.2), 5);
    _vPinchDist = dist;
    _applyViewerTransform();
  }
}, { passive: false });

_wrap.addEventListener('touchend', function () { _vDragStart = null; });
```

- [ ] **Step 3 — Vérifier**

1. Épingler un board avec des éléments variés (note, image, lien, couleur) depuis l'extension
2. Ouvrir la PWA → cliquer la card du board
3. Les éléments sont positionnés correctement (même layout que le desktop)
4. Pan 1 doigt : le canvas se déplace
5. Pinch zoom 2 doigts : zoom in/out
6. Tap sur un lien → `window.open()` fonctionne
7. Tap sur une image → lightbox plein écran, tap lightbox → ferme

- [ ] **Step 4 — Commit**

```bash
git add pwa/pwa.js
git commit -m "feat: PWA viewer — render éléments, pan 1 doigt, pinch-zoom"
```

---

## Task 8 — PWA inbox (captures depuis iPhone)

**Files:**
- Modify: `pwa/pwa.js` (badge, `_renderInboxScreen`, ajout image/URL, listener temps réel)

**Interfaces:**
- Consumes: `_db`, `_user`, `#inbox-scroll`, `#inbox-tab-badge`, `#inbox-add-image-btn`, `#inbox-add-url-btn`, `#inbox-file-input`
- Produces: Firebase `/users/{uid}/inbox/{id}` avec `{ type, data?, url?, addedAt, imported:false }`; badge temps réel; liste des captures

- [ ] **Step 1 — Badge inbox temps réel**

Dans `pwa/pwa.js`, après `_renderHomeGrid()`, ajouter :

```js
// ── Inbox ───────────────────────────────────────────────────────────────────
function _setupInboxBadge() {
  if (!_user) return;
  var ref = _db.ref('users/' + _user.uid + '/inbox');
  var handler = ref.on('value', function (snap) {
    var count = 0;
    if (snap.exists()) {
      snap.forEach(function (child) { if (!child.val().imported) count++; });
    }
    var badge = document.getElementById('inbox-tab-badge');
    if (badge) {
      badge.textContent = count > 0 ? count : '';
      badge.classList.toggle('visible', count > 0);
    }
    if (_currentScreen === 'inbox') _renderInboxScreen();
  });
  _inboxListeners.push(function () { ref.off('value', handler); });
}

function _renderInboxScreen() {
  if (!_user) return;
  var scroll = document.getElementById('inbox-scroll');
  _db.ref('users/' + _user.uid + '/inbox').once('value').then(function (snap) {
    var items = [];
    if (snap.exists()) {
      snap.forEach(function (child) {
        var v = child.val();
        if (!v.imported) items.push(Object.assign({ _key: child.key }, v));
      });
    }
    if (items.length === 0) {
      scroll.innerHTML = '<div class="inbox-empty">Rien pour l\'instant — partage une image<br>depuis Safari ou Photos pour commencer.</div>';
      return;
    }
    scroll.innerHTML = '';
    items.forEach(function (item) {
      var div = document.createElement('div');
      div.className = 'inbox-item';
      var isImg = item.type === 'image';
      div.innerHTML = (isImg
        ? '<img class="inbox-thumb" src="' + _esc(item.data || '') + '" alt="">'
        : '<div class="inbox-thumb">🔗</div>'
      ) + '<div class="inbox-item-info">'
        + '<div class="inbox-item-label">' + _esc(isImg ? 'Image' : (item.url || 'Lien')) + '</div>'
        + '<div class="inbox-item-date">' + (item.addedAt ? _timeAgo(item.addedAt) : '') + '</div>'
        + '</div>';
      scroll.appendChild(div);
    });
  });
}
```

- [ ] **Step 2 — Afficher l'inbox au changement d'onglet**

Modifier la fonction `showScreen` pour appeler `_renderInboxScreen` quand on affiche l'inbox :

Trouver la ligne `_currentScreen = name;` et ajouter après :

```js
  if (name === 'inbox') _renderInboxScreen();
```

- [ ] **Step 3 — Ajouter image depuis galerie**

```js
// ── Ajouter depuis iPhone ───────────────────────────────────────────────────
document.getElementById('inbox-add-image-btn').addEventListener('click', function () {
  document.getElementById('inbox-file-input').click();
});

document.getElementById('inbox-file-input').addEventListener('change', function (e) {
  var file = e.target.files && e.target.files[0];
  if (!file || !_user) return;
  var reader = new FileReader();
  reader.onload = function () {
    _db.ref('users/' + _user.uid + '/inbox').push({
      type: 'image',
      data: reader.result,
      addedAt: Date.now(),
      imported: false,
    }).catch(function () { alert('Erreur d\'envoi.'); });
    e.target.value = '';
  };
  reader.readAsDataURL(file);
});
```

- [ ] **Step 4 — Ajouter une URL**

```js
document.getElementById('inbox-add-url-btn').addEventListener('click', function () {
  var url = prompt('URL à capturer :');
  if (!url || !_user) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  _db.ref('users/' + _user.uid + '/inbox').push({
    type: 'url',
    url: url,
    addedAt: Date.now(),
    imported: false,
  }).catch(function () { alert('Erreur d\'envoi.'); });
});
```

- [ ] **Step 5 — Vérifier**

1. Ouvrir la PWA, aller dans l'onglet "Captures"
2. État vide → message "Rien pour l'instant — partage une image..."
3. Cliquer "+ Image" → sélecteur de fichier ou galerie iOS
4. Sélectionner une image → elle apparaît dans la liste en temps réel
5. Badge sur l'onglet "Captures" affiche "1"
6. Dans l'extension desktop → le badge inbox de l'extension affiche "1" aussi
7. Importer depuis l'extension → la PWA retire l'item de la liste (badge → 0)
8. Cliquer "+ Lien" → prompt URL → l'item apparaît dans la liste

- [ ] **Step 6 — Commit**

```bash
git add pwa/pwa.js
git commit -m "feat: PWA inbox — captures image et URL, badge temps réel"
```

---

## Task 9 — PWA share target (Share Sheet iOS)

**Files:**
- Modify: `pwa/sw.js` (déjà implémenté en Task 5, vérifier la route)
- Modify: `pwa/pwa.js` (handler `_handleShareReceived`)

**Interfaces:**
- Consumes: message SW `{ type: 'share-received', payload: { type, data?, url? } }`
- Produces: `_handleShareReceived(payload)` → écrit dans Firebase inbox, redirige vers onglet Captures

- [ ] **Step 1 — Ajouter `_handleShareReceived` dans `pwa/pwa.js`**

```js
// ── Share target (depuis Share Sheet iOS) ──────────────────────────────────
function _handleShareReceived(payload) {
  if (!_user) return;
  var item = {
    type: payload.type || 'url',
    addedAt: Date.now(),
    imported: false,
  };
  if (payload.type === 'image' && payload.data) {
    item.data = payload.data;
  } else {
    item.url = payload.url || payload.title || '';
  }
  _db.ref('users/' + _user.uid + '/inbox').push(item).catch(function () {});
  showScreen('inbox');
}
```

- [ ] **Step 2 — Vérifier que `pwa/sw.js` intercepte bien `/pwa/share-target`**

Le SW a déjà la logique (Task 5). Vérifier dans Chrome DevTools → Application → Service Workers que le SW est actif pour `/pwa/`.

- [ ] **Step 3 — Tester le Share Sheet sur iPhone**

Prérequis : déployer sur Netlify (la PWA doit être accessible en HTTPS pour que la Share Sheet fonctionne).

1. Déployer sur Netlify
2. Ouvrir Safari iOS → aller sur l'URL Netlify de la PWA
3. Safari → bouton Partager → "Sur l'écran d'accueil" → ajouter
4. Ouvrir la PWA depuis l'écran d'accueil (mode standalone)
5. Aller dans Photos → sélectionner une photo → Partager → "Moodboard"
6. La PWA s'ouvre sur l'onglet Captures, l'image apparaît dans la liste

- [ ] **Step 4 — Commit**

```bash
git add pwa/pwa.js pwa/sw.js
git commit -m "feat: PWA share target handler — images et URLs depuis Share Sheet iOS"
```

---

## Task 10 — PWA journal d'activité + dots home screen

**Files:**
- Modify: `pwa/pwa.js` (`_setupActivityListener`, `_renderActivityScreen`, dots sur cards)

**Interfaces:**
- Consumes: `_db`, `_user`, `_pinnedBoards`, `_lastVisit`, `#activity-scroll`, `#boards-grid`
- Produces: feed activité depuis `/boards/{boardId}/activity/`; `_activityDots` mis à jour; dots rouges sur les cards de l'accueil

- [ ] **Step 1 — Listener activité multi-boards**

Dans `pwa/pwa.js`, après `_renderInboxScreen()` :

```js
// ── Journal d'activité ──────────────────────────────────────────────────────
var _allActivity = []; // [ { boardId, boardName, ...event } ]

function _setupActivityListener() {
  if (!_user) return;
  // Écouter l'activité de tous les boards épinglés
  // Re-appelé quand _pinnedBoards change (via le listener home)
  var ids = Object.keys(_pinnedBoards);
  ids.forEach(function (boardId) {
    var ref = _db.ref('boards/' + boardId + '/activity');
    var handler = ref.on('value', function (snap) {
      // Supprimer les anciens events de ce board
      _allActivity = _allActivity.filter(function (e) { return e.boardId !== boardId; });
      if (snap.exists()) {
        snap.forEach(function (child) {
          var v = child.val();
          _allActivity.push(Object.assign({ boardId: boardId, boardName: (_pinnedBoards[boardId] || {}).name || '' }, v));
        });
      }
      // Mettre à jour les dots (activité depuis la dernière visite)
      _activityDots[boardId] = _allActivity.some(function (e) {
        return e.boardId === boardId && (e.at || 0) > _lastVisit;
      });
      _renderHomeGrid(); // met à jour les dots sur les cards
      if (_currentScreen === 'activity') _renderActivityScreen();
    });
    _inboxListeners.push(function () { ref.off('value', handler); });
  });
}

function _renderActivityScreen() {
  var scroll = document.getElementById('activity-scroll');
  // Trier par date décroissante
  var sorted = _allActivity.slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  // Mettre à jour _lastVisit
  _lastVisit = Date.now();
  localStorage.setItem('pwa_last_visit', String(_lastVisit));
  // Effacer les dots (l'utilisateur a vu l'activité)
  Object.keys(_activityDots).forEach(function (id) { _activityDots[id] = false; });
  _renderHomeGrid();

  if (sorted.length === 0) {
    scroll.innerHTML = '<div class="activity-empty">Aucune activité récente.<br>Les modifications des boards partagés apparaîtront ici.</div>';
    return;
  }
  scroll.innerHTML = '';
  sorted.slice(0, 50).forEach(function (ev) {
    var div = document.createElement('div');
    div.className = 'activity-item';
    div.innerHTML = (ev.photoURL
      ? '<img class="activity-avatar" src="' + _esc(ev.photoURL) + '" alt="">'
      : '<div class="activity-avatar">👤</div>'
    ) + '<div class="activity-text">'
      + '<div><strong>' + _esc(ev.displayName || 'Quelqu\'un') + '</strong> a modifié <strong>' + _esc(ev.boardName || '') + '</strong></div>'
      + '<div class="activity-time">' + (ev.at ? _timeAgo(ev.at) : '') + '</div>'
      + '</div>';
    var bid = ev.boardId;
    div.addEventListener('click', function () {
      _openBoardViewer(bid, (_pinnedBoards[bid] || {}).name || 'Board');
    });
    scroll.appendChild(div);
  });
}
```

- [ ] **Step 2 — Appeler `_setupActivityListener` après le chargement des boards**

Dans `_loadPinnedBoards()`, dans le callback `on('value', ...)`, après `_renderHomeGrid();`, ajouter :

```js
    // Réinitialiser les listeners activité quand les boards épinglés changent
    _inboxListeners = _inboxListeners.filter(function (fn) {
      // ne filtrer que les listeners activité (heuristique : tous sauf le premier = inbox badge)
      return false; // on les détache tous sauf le badge — voir ci-dessous
    });
    _setupActivityListener();
```

En fait, la gestion propre : modifier `_setupActivityListener` pour que les listeners d'activité soient stockés séparément des listeners inbox :

```js
var _activityListeners = [];

function _setupActivityListener() {
  // Détacher les anciens listeners activité
  _activityListeners.forEach(function (fn) { fn(); });
  _activityListeners = [];
  if (!_user) return;
  _allActivity = [];
  var ids = Object.keys(_pinnedBoards);
  ids.forEach(function (boardId) {
    var ref = _db.ref('boards/' + boardId + '/activity');
    var handler = ref.on('value', function (snap) {
      _allActivity = _allActivity.filter(function (e) { return e.boardId !== boardId; });
      if (snap.exists()) {
        snap.forEach(function (child) {
          var v = child.val();
          _allActivity.push(Object.assign({ boardId: boardId, boardName: (_pinnedBoards[boardId] || {}).name || '' }, v));
        });
      }
      _activityDots[boardId] = _allActivity.some(function (e) {
        return e.boardId === boardId && (e.at || 0) > _lastVisit;
      });
      _renderHomeGrid();
      if (_currentScreen === 'activity') _renderActivityScreen();
    });
    _activityListeners.push(function () { ref.off('value', handler); });
  });
}
```

Et dans `_teardownListeners()`, ajouter :

```js
  _activityListeners.forEach(function (fn) { fn(); });
  _activityListeners = [];
```

Et dans `_loadPinnedBoards()`, après `_renderHomeGrid()`, remplacer par :

```js
    _renderHomeGrid();
    _setupActivityListener();
```

- [ ] **Step 3 — Afficher l'activité au changement d'onglet**

Dans `showScreen()`, après `if (name === 'inbox') _renderInboxScreen();`, ajouter :

```js
  if (name === 'activity') _renderActivityScreen();
```

- [ ] **Step 4 — Vérifier**

1. Épingler un board collab depuis l'extension → modifier un élément → sauvegarder
2. Ouvrir la PWA → aller sur "Activité" → l'événement apparaît : "Ton Nom a modifié NomBoard"
3. Sur la card de l'accueil → un point rouge est visible
4. Aller sur "Activité" → le point disparaît (lastVisit mis à jour)
5. Cliquer un item d'activité → ouvre le board viewer

- [ ] **Step 5 — Commit**

```bash
git add pwa/pwa.js
git commit -m "feat: PWA journal activité + dots home screen depuis Firebase"
```

---

## Self-Review

### Couverture spec

| Requirement spec | Implémenté dans |
|-----------------|-----------------|
| Google Sign-in extension | Task 1 |
| Données isolées par UID | Tasks 1–2 (Firebase path `/users/{uid}/`) |
| Bouton monitor-smartphone (icône exacte) | Task 2 |
| hover "Épingler sur l'iPhone" | Task 2 (attribut `title`) |
| Icône images pour inbox | Task 3 |
| Sync auto saveCurrentBoard si épinglé | Task 2 |
| Thumb = coverImage || snapshot (500:340 object-fit cover) | Tasks 2 + 6 |
| Panneau inbox extension avec badge temps réel | Task 3 |
| Import inbox → makeElement sur canvas | Task 3 |
| Journal activité write sur collab save | Task 4 |
| PWA manifest + share_target | Task 5 |
| Service Worker cache statique | Task 5 |
| Écran d'accueil — grille 2 col cards | Task 6 |
| Cards ratio 500:340, object-fit cover | Tasks 5 (CSS) + 6 |
| Dot rouge si nouveau depuis dernière visite | Task 10 |
| Board Viewer — pan 1 doigt, pinch 2 doigts | Task 7 |
| Viewer — tap lien → window.open | Task 7 |
| Viewer — tap image → lightbox | Task 7 |
| Viewer — éléments non éditables | Task 7 (pas de contenteditable) |
| Inbox PWA — liste temps réel | Task 8 |
| Inbox PWA — badge | Task 8 |
| Inbox PWA — + Image (galerie) | Task 8 |
| Inbox PWA — + Lien (prompt) | Task 8 |
| Inbox vide → message exact | Task 8 |
| Share Sheet iOS → inbox | Tasks 5 + 9 |
| Journal d'activité PWA — feed passif | Task 10 |
| Journal → ouvre viewer | Task 10 |
| Profil — photo, nom, email, déconnexion | Task 6 |
| Pas d'édition canvas sur mobile | ✓ (aucun handler d'édition implémenté) |
| Pas de notifications push | ✓ (pas de FCM) |

### Types cohérents entre tasks

- `_currentUser` (Tasks 1, 2, 3, 4) : même variable `let _currentUser = null` IIFE app.js ✓
- `_pinnedBoards` (Tasks 1, 2) : même `Set()` ✓
- `_isPinned(id)` utilisé en Task 2 défini en Task 2 ✓
- Firebase paths : `/users/{uid}/pinned_boards/`, `/users/{uid}/boards/`, `/users/{uid}/inbox/`, `/boards/{boardId}/activity/` — cohérents dans toutes les tasks ✓
- PWA `_pinnedBoards` (objet `{}`) distinct de extension `_pinnedBoards` (Set) — contextes séparés ✓

---

**Plan complet et sauvegardé dans `docs/superpowers/plans/2026-07-11-pwa-iphone-companion.md`.**

**Deux options d'exécution :**

**1. Subagent-Driven (recommandé)** — un sous-agent par task, review entre chaque task, itération rapide

**2. Inline Execution** — exécution dans cette session avec checkpoints

**Laquelle choisir ?**
