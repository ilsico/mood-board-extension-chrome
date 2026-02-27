# Firebase Sharing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add read-only board sharing via Firebase Realtime Database with a "Partager" button that generates a public Netlify link.

**Architecture:** Firebase compat v9 SDK loaded via CDN (non-module scripts, compatible with the existing IIFE app.js). `saveCurrentBoard()` syncs to Firebase fire-and-forget. A `?board=ID` URL param triggers static read-only mode using the existing `restoreElement()` infrastructure.

**Tech Stack:** Firebase Realtime Database (compat v9.23.0 CDN), Vanilla JS IIFE, HTML/CSS

> **Note:** No test framework exists in this project. Each task includes manual browser verification steps instead of unit tests.

---

## Quick Reference

- `toast(msg)` — function at app.js:3684 (shows toast at bottom center)
- `attachElementEvents(el)` — app.js:1747, contains the drag mousedown handler
- `setupUIEvents()` — app.js:246, add share-btn listener here
- `saveCurrentBoard()` — app.js:127, add Firebase sync after `saveBoards()`
- `openBoard(id)` — app.js:632
- `goHome()` — app.js:656
- `init()` — app.js:193, add `?board=` check at the very top
- `restoreElement(s)` — app.js:2204
- Firebase config: apiKey=`AIzaSyBX9Su8qOUfTPjXkVvioA6i5pQBk9f6GMs`, projectId=`moodboard-app-b21b9`, databaseURL=`https://moodboard-app-b21b9-default-rtdb.firebaseio.com`

---

## Task 1 — Firebase SDK & init in index.html

**Files:**
- Modify: `index.html` (before `<script src="app.js">`)

**Step 1: Add Firebase compat CDN scripts + init**

In `index.html`, find the line `<script src="app.js"></script>` and insert BEFORE it:

```html
<!-- Firebase compat v9 (non-module, compatible IIFE) -->
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js"></script>
<script>
  try {
    firebase.initializeApp({
      apiKey: "AIzaSyBX9Su8qOUfTPjXkVvioA6i5pQBk9f6GMs",
      authDomain: "moodboard-app-b21b9.firebaseapp.com",
      projectId: "moodboard-app-b21b9",
      storageBucket: "moodboard-app-b21b9.firebasestorage.app",
      messagingSenderId: "467105545598",
      appId: "1:467105545598:web:72fceeaa8c4d0c949b472f",
      databaseURL: "https://moodboard-app-b21b9-default-rtdb.firebaseio.com"
    });
    window._fbDb = firebase.database();
  } catch(e) {
    console.warn('Firebase init failed:', e);
    window._fbDb = null;
  }
</script>
```

> **Important:** The `databaseURL` is required for Realtime Database — it's NOT in the user's original snippet. Find it in Firebase Console → Realtime Database → the URL shown (format: `https://<project>-default-rtdb.firebaseio.com`).

**Step 2: Verify Firebase loads**

Open `index.html` in a browser (not extension), open DevTools Console, type:
```
window._fbDb
```
Expected: Firebase Database object (not `null`, not `undefined`).

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add Firebase compat v9 SDK and init"
```

---

## Task 2 — Share Button HTML

**Files:**
- Modify: `index.html` — inside `#board-header`

**Step 1: Add the button**

In `index.html`, find the `#board-header` section:
```html
<header id="board-header">
  <button class="back-btn" id="back-btn" title="Retour à l'accueil">&#8592;</button>
  <div class="board-title-display" id="board-title-display">Moodboard</div>
</header>
```

Replace it with:
```html
<header id="board-header">
  <button class="back-btn" id="back-btn" title="Retour à l'accueil">&#8592;</button>
  <div class="board-title-display" id="board-title-display">Moodboard</div>
  <button id="share-btn" class="share-btn" title="Partager ce board" style="display:none">⬆ Partager</button>
</header>
```

**Step 2: Add CSS for .share-btn**

In `index.html`, in the `<style>` section, after the `.back-btn:hover` rule (around line 134), add:

```css
.share-btn {
  background: #ff3c00; color: #fff; border: none;
  padding: 7px 14px; cursor: pointer; font-size: 13px; font-weight: 700;
  font-family: 'HelveticaBold', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  transition: background 0.15s; white-space: nowrap;
  display: flex; align-items: center; gap: 6px;
}
.share-btn:hover { background: #e03500; }
```

**Step 3: Verify**

Open in browser, open a board. The button is hidden (`display:none`) — that's expected for now. We'll wire show/hide in Task 4.

Temporarily test in console:
```js
document.getElementById('share-btn').style.display = ''
```
Expected: orange "⬆ Partager" button appears in the header top-right.

**Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add share button to board header"
```

---

## Task 3 — Read-Only Mode CSS

**Files:**
- Modify: `index.html` — `<style>` section

**Step 1: Add readonly CSS rules**

In `index.html`, in the `<style>` section, add at the end (before `</style>`):

```css
/* ===== MODE LECTURE SEULE ===== */
body.readonly-mode #toolbar,
body.readonly-mode #lib-panel,
body.readonly-mode #back-btn,
body.readonly-mode #share-btn,
body.readonly-mode .element-toolbar,
body.readonly-mode .resize-handle,
body.readonly-mode #multi-resize-handle,
body.readonly-mode #home-screen { display: none !important; }

body.readonly-mode .board-element { cursor: default !important; }
body.readonly-mode .canvas-wrapper { cursor: default !important; }

/* Badge "Lecture seule" */
body.readonly-mode #board-title-display::after {
  content: ' — Lecture seule';
  font-size: 11px; color: #aaa; font-weight: 400;
  font-family: 'HelveticaRoman', 'Helvetica Neue', Helvetica, Arial, sans-serif;
}
```

**Step 2: Verify**

In browser console:
```js
document.body.classList.add('readonly-mode')
```
Expected: toolbar disappears, lib panel disappears, board title shows "— Lecture seule" suffix.

Remove after test:
```js
document.body.classList.remove('readonly-mode')
```

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add readonly-mode CSS rules"
```

---

## Task 4 — Firebase Sync in saveCurrentBoard()

**Files:**
- Modify: `app.js:162` (after `saveBoards()` in `saveCurrentBoard()`)

**Step 1: Add Firebase sync**

In `app.js`, find `saveCurrentBoard()` at line 127. Find the end of the function where `saveBoards()` is called (line 162):

```js
    board.elements = elements;
    board.savedAt = Date.now();
    saveBoards();
  }
```

Replace with:

```js
    board.elements = elements;
    board.savedAt = Date.now();
    saveBoards();
    // Sync Firebase (fire-and-forget, silencieux)
    if (window._fbDb) {
      window._fbDb.ref('boards/' + currentBoardId)
        .set({ name: board.name, elements: board.elements, savedAt: board.savedAt })
        .catch(e => console.warn('Firebase sync error:', e));
    }
  }
```

**Step 2: Verify**

1. Open the app in browser, open a board, add a note.
2. Wait 800ms (auto-save delay from `scheduleSave`).
3. Open Firebase Console → Realtime Database → check for `/boards/{id}` node.
4. Expected: JSON with `name`, `elements`, `savedAt` appears.

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: sync board to Firebase on save"
```

---

## Task 5 — Show/Hide Share Button

**Files:**
- Modify: `app.js:632` (`openBoard`) and `app.js:656` (`goHome`)

**Step 1: Show share-btn when opening a board**

In `openBoard()` (line 632), find:
```js
    document.getElementById('board-title-display').textContent = board.name;
```

After that line, add:
```js
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn && window._fbDb) shareBtn.style.display = '';
```

**Step 2: Hide share-btn when going home**

In `goHome()` (line 656), find:
```js
    currentBoardId=null; selectedEl=null; multiSelected.clear();
```

Before that line, add:
```js
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) shareBtn.style.display = 'none';
```

**Step 3: Verify**

1. Load the app, open a board — "⬆ Partager" button is visible in header.
2. Click back (← arrow) — button disappears.

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat: show/hide share button with board screen"
```

---

## Task 6 — Share Button Click Handler

**Files:**
- Modify: `app.js:246` (`setupUIEvents()`)

**Step 1: Add the click handler**

In `setupUIEvents()`, find the block starting with `// Header board` (around line 256):

```js
    // Header board
    addEvt('back-btn', 'click', () => goHome());
    addEvt('fit-screen-btn', 'click', () => fitElementsToScreen());
    addEvt('preview-btn', 'click', () => togglePreviewMode());
```

After `addEvt('preview-btn', ...)`, add:

```js
    addEvt('share-btn', 'click', () => {
      if (!currentBoardId || !window._fbDb) { toast('Firebase non disponible'); return; }
      saveCurrentBoard();
      const board = boards.find(b => b.id === currentBoardId);
      if (!board) return;
      const url = window.location.origin + window.location.pathname + '?board=' + currentBoardId;
      window._fbDb.ref('boards/' + currentBoardId)
        .set({ name: board.name, elements: board.elements, savedAt: board.savedAt })
        .then(() => {
          navigator.clipboard.writeText(url).catch(() => {});
          toast('Lien copié dans le presse-papier');
        })
        .catch(() => toast('Erreur cloud — lien non disponible'));
    });
```

**Step 2: Verify**

1. Open a board, click "⬆ Partager".
2. Expected: toast "Lien copié dans le presse-papier" appears.
3. Paste clipboard somewhere — expected URL: `http://localhost/...?board=el_XXXX`.
4. Check Firebase Console — board data should be up to date.

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: share button copies link and syncs to Firebase"
```

---

## Task 7 — Disable Drag in Read-Only Mode

**Files:**
- Modify: `app.js:1748` (`attachElementEvents`)

**Step 1: Add readonly guard**

In `attachElementEvents(el)` (line 1747), find the `mousedown` listener:

```js
  function attachElementEvents(el) {
    el.addEventListener('mousedown', e => {
      if (e.target.classList.contains('resize-handle')) return;
```

Add the readonly guard as the FIRST check inside the listener:

```js
  function attachElementEvents(el) {
    el.addEventListener('mousedown', e => {
      if (document.body.classList.contains('readonly-mode')) return;
      if (e.target.classList.contains('resize-handle')) return;
```

**Step 2: Verify (manual)**

1. In browser console: `document.body.classList.add('readonly-mode')`
2. Open a board, try to drag an element — nothing should move.
3. Double-click an image — lightbox should still open (dblclick is unaffected by mousedown guard).
4. Remove: `document.body.classList.remove('readonly-mode')`

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: disable element drag in readonly mode"
```

---

## Task 8 — _loadSharedBoard() Function + init() Entry Point

**Files:**
- Modify: `app.js:193` (`init()`)
- Modify: `app.js` (add `_loadSharedBoard` function after `restoreElement`)

**Step 1: Add `_loadSharedBoard` function**

In `app.js`, find the end of `restoreElement()` (around line 2250):

```js
    return el;
  }

  // ── IMAGE ──────────────────────────────────────────
```

Insert the new function between `restoreElement` and the image section:

```js
  // ── SHARED BOARD (lecture seule) ────────────────────────────────────────
  async function _loadSharedBoard(id) {
    if (!window._fbDb) {
      document.body.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px;background:#f4f4f6;"><div style="font-family:\'HelveticaBold\',sans-serif;font-size:26px;color:#ff3c00">MOODBOARDS</div><div style="font-size:15px;color:#888">Firebase non disponible.</div></div>';
      return;
    }
    try {
      const snap = await window._fbDb.ref('boards/' + id).get();
      if (!snap.exists()) {
        document.body.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px;background:#f4f4f6;"><div style="font-family:\'HelveticaBold\',sans-serif;font-size:26px;color:#ff3c00">MOODBOARDS</div><div style="font-size:15px;color:#888">Ce moodboard n\'existe pas ou a été supprimé.</div></div>';
        return;
      }
      const boardData = snap.val();
      document.body.classList.add('readonly-mode');
      document.getElementById('board-screen').style.display = 'flex';
      document.getElementById('board-title-display').textContent = boardData.name || 'Moodboard';
      document.getElementById('canvas').innerHTML = '';
      zoomLevel = 1; panX = 0; panY = 0; nextZ = 100;
      applyTransform();
      if (boardData.elements && boardData.elements.length) {
        boardData.elements.forEach(e => {
          if (e.type === 'caption') {
            const cap = restoreElement(e);
            if (cap) cap.contentEditable = 'false';
          } else {
            restoreElement(e);
          }
        });
        setTimeout(() => fitElementsToScreen(), 150);
      }
    } catch(e) {
      document.body.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px;background:#f4f4f6;"><div style="font-family:\'HelveticaBold\',sans-serif;font-size:26px;color:#ff3c00">MOODBOARDS</div><div style="font-size:15px;color:#888">Erreur de chargement.</div></div>';
    }
  }
```

**Step 2: Add `?board=` detection to `init()`**

In `init()` (line 193), find the very start of the function:

```js
  async function init() {
    await loadBoardsFromStorage();
```

Replace with:

```js
  async function init() {
    // Détection mode partage : ?board=ID
    const _sharedId = new URLSearchParams(window.location.search).get('board');
    if (_sharedId) {
      await _loadSharedBoard(_sharedId);
      return;
    }
    await loadBoardsFromStorage();
```

**Step 3: Verify read-only mode end-to-end**

1. Open a board normally, click "⬆ Partager" — note the URL in clipboard (e.g. `http://localhost/index.html?board=el_1234567_abc`).
2. Open that URL in a new tab.
3. Expected:
   - Board displays with all elements (no toolbar, no lib panel)
   - Title shows "Nom du board — Lecture seule"
   - Dragging elements does nothing
   - Double-clicking an image opens the lightbox
   - Pan/zoom with wheel still works
4. Test error: navigate to `?board=nonexistent` — expected error page.

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat: add read-only shared board loading from Firebase"
```

---

## Task 9 — Final Integration Test

**Step 1: Full flow test**

1. Open `index.html` as a web page (not extension).
2. Create a board with: 1 image, 1 note, 1 link, 1 color.
3. Click "⬆ Partager" — toast confirms "Lien copié...".
4. Open the shared URL in incognito / different browser.
5. Verify: all elements visible, nothing interactive (drag, edit), images double-click works.

**Step 2: Error state test**

Navigate to `index.html?board=does_not_exist_xyz`.
Expected: MOODBOARDS error page, not a crash.

**Step 3: Extension compatibility**

Open the Chrome extension version. `window._fbDb` should be null if Firebase CDN fails (blocked by extension CSP) — the share button will be hidden (`if (shareBtn && window._fbDb)`), and the app behaves as before.

**Step 4: Final commit**

```bash
git add .
git commit -m "feat: complete Firebase sharing with read-only mode"
```

---

## Deployment Checklist (Netlify)

1. Push repo to GitHub.
2. Connect GitHub repo to Netlify.
3. Build command: *(none — static site)*, publish directory: `.` (root).
4. In Firebase Console → Realtime Database → Rules, confirm:
   ```json
   { "rules": { ".read": true, ".write": true } }
   ```
5. Shared links will be: `https://<your-netlify-site>.netlify.app/index.html?board=<id>`
