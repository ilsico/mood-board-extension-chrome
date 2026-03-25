# Readonly Navigation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow pan and zoom navigation in readonly-mode while strictly locking all element interactions.

**Architecture:** Targeted guards at each event handler (Approach A). No overlay, no capture listener. The existing readonly-mode CSS class on `<body>` is used as the single source of truth. Pinch-to-zoom is added to the touch handler (benefits all modes).

**Tech Stack:** Vanilla JS (IIFE pattern), inline CSS in index.html, no build step, no test framework.

---

### Task 1: Enable left-click-drag pan on empty canvas in readonly-mode

**Files:**
- Modify: `app.js` — function `setupCanvasEvents()`, mousedown handler on `wrapper` (~L1202)

The mousedown handler currently starts a selection rectangle when the user clicks on empty canvas in non-panning mode. In readonly-mode, it should start pan instead.

**Step 1: Locate the exact insertion point**

In `app.js`, find the `mousedown` handler on `wrapper` that starts around line 1202. The block looks like:
```js
// Mousedown sur canvas vide : pan OU rectangle de sélection
if (e.target !== canvas && e.target !== wrapper) return;
if (e.button !== 0) return;

if (isPanningMode) {
  // Mode pan (espace enfoncé)
  isPanning = true;
  panStart = { x: e.clientX - panX, y: e.clientY - panY };
  wrapper.style.cursor = 'grabbing';
  return;
}

// Rectangle de sélection
hideContextMenu();
```

**Step 2: Insert the readonly pan guard after the `isPanningMode` block**

Insert immediately after the `isPanningMode` block closes (after its `return;`), before `// Rectangle de sélection`:
```js
      if (document.body.classList.contains('readonly-mode')) {
        isPanning = true;
        panStart = { x: e.clientX - panX, y: e.clientY - panY };
        wrapper.style.cursor = 'grabbing';
        return;
      }
```

**Step 3: Verify manually**

Open the extension, share a board, open the shared URL. Left-click-drag on the empty canvas background should now pan instead of showing a selection rectangle.

**Step 4: Commit**
```bash
git add app.js
git commit -m "feat: pan on canvas background click in readonly-mode"
```

---

### Task 2: Fix canvas cursor to `grab` in readonly-mode (CSS)

**Files:**
- Modify: `index.html` — CSS block `/* ===== MODE LECTURE SEULE ===== */` (~L1649)

The current rule `cursor: default !important` prevents the JS-set `grabbing` cursor from appearing during pan.

**Step 1: Find the rule**

In `index.html`, find:
```css
body.readonly-mode .canvas-wrapper {
  cursor: default !important;
}
```

**Step 2: Replace it**

Change to:
```css
body.readonly-mode .canvas-wrapper {
  cursor: grab;
}
```

Note: Removing `!important` allows JS `wrapper.style.cursor = 'grabbing'` (inline style) to take effect during pan. The grab cursor still shows when idle. `board-element` keeps its own `cursor: default !important` rule which is separate.

**Step 3: Verify manually**

In readonly-mode the cursor on the canvas should be a grab hand. While dragging, it should change to grabbing.

**Step 4: Commit**
```bash
git add index.html
git commit -m "fix: cursor grab on canvas in readonly-mode"
```

---

### Task 3: Block context menu on elements in readonly-mode

**Files:**
- Modify: `app.js` — function `attachElementEvents()`, `contextmenu` handler (~L2365)

**Step 1: Locate the contextmenu handler**

In `attachElementEvents()`, find:
```js
el.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
  // Si l'élément fait partie d'une multi-sélection, ne pas désélectionner
  if (!e.shiftKey && !multiSelected.has(el)) selectEl(el);
```

**Step 2: Insert readonly guard**

Add at the very top of the handler body, right after `e.preventDefault(); e.stopPropagation();`:
```js
      if (document.body.classList.contains('readonly-mode')) return;
```

The full handler start becomes:
```js
el.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (document.body.classList.contains('readonly-mode')) return;
  // Si l'élément fait partie d'une multi-sélection, ne pas désélectionner
  if (!e.shiftKey && !multiSelected.has(el)) selectEl(el);
```

**Step 3: Verify manually**

Right-click on any element in readonly-mode — context menu should not appear.

**Step 4: Commit**
```bash
git add app.js
git commit -m "fix: block context menu on elements in readonly-mode"
```

---

### Task 4: Block resize handle in readonly-mode

**Files:**
- Modify: `app.js` — function `attachElementEvents()`, resize handle mousedown handler (~L2381)

**Step 1: Locate the resize handle handler**

In `attachElementEvents()`, find:
```js
const rh = el.querySelector('.resize-handle');
if (rh) {
  rh.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    isResizing = true;
```

**Step 2: Insert readonly guard**

Add immediately after `e.preventDefault();`:
```js
        if (document.body.classList.contains('readonly-mode')) return;
```

**Step 3: Verify manually**

Note: The resize handle is already hidden by CSS in readonly-mode (`body.readonly-mode .resize-handle { display: none !important; }`). This guard is a defence-in-depth safety net. Confirm no resize occurs.

**Step 4: Commit**
```bash
git add app.js
git commit -m "fix: block resize handle in readonly-mode"
```

---

### Task 5: Block drop events in readonly-mode

**Files:**
- Modify: `app.js` — function `setupCanvasEvents()`, `drop` handler on `wrapper` (~L1311)

**Step 1: Locate the drop handler**

In `setupCanvasEvents()`, find:
```js
wrapper.addEventListener('drop', (e) => {
  e.preventDefault();
  const src = e.dataTransfer.getData('text/plain');
  // Drop depuis la toolbar gauche (tool:note, tool:color, tool:link, tool:file)
  if (src && src.startsWith('tool:')) {
```

**Step 2: Insert readonly guard**

Add right after `e.preventDefault();`:
```js
      if (document.body.classList.contains('readonly-mode')) return;
```

**Step 3: Verify**

In readonly-mode, dragging an image from outside the browser onto the canvas should do nothing.

**Step 4: Commit**
```bash
git add app.js
git commit -m "fix: block drop events in readonly-mode"
```

---

### Task 6: Block note editing (dblclick) in readonly-mode

**Files:**
- Modify: `app.js` — two `activateNoteEdit` functions (~L1643 and ~L2862)

There are two separate `activateNoteEdit` closures (one per note-creation function). Both need the guard.

**Step 1: Locate the first `activateNoteEdit` (~L1643)**

Find the first occurrence:
```js
function activateNoteEdit(e) {
  e.stopPropagation();
  e.preventDefault();
  ta.style.pointerEvents = 'auto';
```

**Step 2: Insert guard**

Add immediately after the function signature opening brace, before `e.stopPropagation()`:
```js
function activateNoteEdit(e) {
  if (document.body.classList.contains('readonly-mode')) return;
  e.stopPropagation();
  e.preventDefault();
  ta.style.pointerEvents = 'auto';
```

**Step 3: Locate the second `activateNoteEdit` (~L2862)**

Find the second occurrence with the same signature and apply the exact same change.

**Step 4: Verify**

In readonly-mode, double-clicking a note should do nothing (no textarea activation, no text-edit panel).

**Step 5: Commit**
```bash
git add app.js
git commit -m "fix: block note editing dblclick in readonly-mode"
```

---

### Task 7: Block destructive keyboard shortcuts in readonly-mode

**Files:**
- Modify: `app.js` — function `setupKeyboard()`, `keydown` handler (~L1488) and `paste` handler (~L1519)

**Step 1: Locate the Delete/Backspace block (~L1488)**

Find:
```js
if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping(e)) {
  e.preventDefault();
  deleteSelected();
}
```

**Step 2: Add readonly guard**

Change to:
```js
if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping(e)) {
  if (document.body.classList.contains('readonly-mode')) return;
  e.preventDefault();
  deleteSelected();
}
```

**Step 3: Locate the undo/redo blocks (~L1471)**

Find the two undo/redo blocks:
```js
if (
  !isTyping(e) &&
  (e.ctrlKey || e.metaKey) &&
  e.shiftKey &&
  (e.key === 'Z' || e.key === 'z')
) {
  e.preventDefault();
  redo();
} else if (
  !isTyping(e) &&
  (e.ctrlKey || e.metaKey) &&
  !e.shiftKey &&
  (e.key === 'z' || e.key === 'Z')
) {
  e.preventDefault();
  undo();
}
```

**Step 4: Wrap undo/redo with readonly guard**

Add `if (document.body.classList.contains('readonly-mode')) { /* skip */ }` by inserting a guard before the undo/redo if-block:

```js
if (!document.body.classList.contains('readonly-mode')) {
  if (
    !isTyping(e) &&
    (e.ctrlKey || e.metaKey) &&
    e.shiftKey &&
    (e.key === 'Z' || e.key === 'z')
  ) {
    e.preventDefault();
    redo();
  } else if (
    !isTyping(e) &&
    (e.ctrlKey || e.metaKey) &&
    !e.shiftKey &&
    (e.key === 'z' || e.key === 'Z')
  ) {
    e.preventDefault();
    undo();
  }
}
```

**Step 5: Locate the paste handler (~L1519)**

Find:
```js
document.addEventListener('paste', (e) => {
  if (isTyping(e)) return;
  const items = e.clipboardData && e.clipboardData.items;
```

**Step 6: Add readonly guard**

Add after `if (isTyping(e)) return;`:
```js
  if (document.body.classList.contains('readonly-mode')) return;
```

**Step 7: Verify**

In readonly-mode: pressing Delete should not remove elements; Ctrl+Z should not undo; pasting an image should not add an element.

**Step 8: Commit**
```bash
git add app.js
git commit -m "fix: block destructive keyboard shortcuts in readonly-mode"
```

---

### Task 8: Add pinch-to-zoom (touch) — benefits all modes

**Files:**
- Modify: `app.js` — function `setupCanvasEvents()`, `touchstart` and `touchmove` handlers (~L1128)

**Step 1: Locate `touchstart` handler (~L1128)**

Find the block that starts:
```js
wrapper.addEventListener(
  'touchstart',
  (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.touches.length === 2) {
      e.preventDefault();
      isTouchPanning = true;
      touchStartX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      touchStartY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      initialPanX = panX;
      initialPanY = panY;
      if (wheelRaf) {
        cancelAnimationFrame(wheelRaf);
        wheelRaf = null;
      }
    }
  },
```

**Step 2: Add two new variables before `touchstart`**

Before the `wrapper.addEventListener('touchstart', ...)` block, declare:
```js
let initialPinchDist = 0;
let initialZoomForPinch = 1;
```

**Step 3: Capture initial pinch distance in `touchstart`**

Inside the `if (e.touches.length === 2)` block, after the existing lines, add:
```js
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      initialPinchDist = Math.sqrt(dx * dx + dy * dy);
      initialZoomForPinch = zoomLevel;
```

**Step 4: Locate `touchmove` handler (~L1156)**

Find:
```js
if (isTouchPanning && e.touches.length === 2) {
  e.preventDefault();

  // Nouveau point central
  const currentX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
  const currentY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

  // Déplacement totalement libre en diagonale (aucun verrouillage d'axe)
  panX = initialPanX + (currentX - touchStartX);
  panY = initialPanY + (currentY - touchStartY);

  applyTransform();
}
```

**Step 5: Replace the touchmove block with pan + zoom combined**

```js
if (isTouchPanning && e.touches.length === 2) {
  e.preventDefault();

  // Point central courant
  const currentX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
  const currentY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

  // Pan
  panX = initialPanX + (currentX - touchStartX);
  panY = initialPanY + (currentY - touchStartY);

  // Pinch-to-zoom
  if (initialPinchDist > 0) {
    const dx = e.touches[1].clientX - e.touches[0].clientX;
    const dy = e.touches[1].clientY - e.touches[0].clientY;
    const newDist = Math.sqrt(dx * dx + dy * dy);
    const ratio = newDist / initialPinchDist;
    const newZ = Math.min(Math.max(initialZoomForPinch * ratio, 0.15), 4);

    if (Math.abs(newZ - zoomLevel) > 0.001) {
      const wrapper = document.getElementById('canvas-wrapper');
      const rect = wrapper.getBoundingClientRect();
      const mx = currentX - rect.left;
      const my = currentY - rect.top;
      panX = mx - (mx - panX) * (newZ / zoomLevel);
      panY = my - (my - panY) * (newZ / zoomLevel);
      zoomLevel = newZ;
    }
  }

  applyTransform();
}
```

**Step 6: Verify manually**

On a touch device or Chrome DevTools touch simulation: two-finger pinch should zoom in/out centered on the midpoint. Two-finger pan should still work.

**Step 7: Commit**
```bash
git add app.js
git commit -m "feat: add pinch-to-zoom for touch devices"
```

---

## Verification Checklist (after all tasks)

Open shared URL (`?board=ID`) and verify:

- [ ] Left-click-drag on empty canvas → pans
- [ ] Cursor = grab on canvas, grabbing while dragging
- [ ] Alt/Ctrl+molette → zooms
- [ ] Pinch gesture → zooms in/out
- [ ] 2-finger pan → pans
- [ ] `#fit-screen-btn` → ajuste la vue
- [ ] `#preview-btn` → plein écran
- [ ] Click on element → nothing happens
- [ ] Drag on element → nothing happens
- [ ] Right-click element → no context menu
- [ ] Double-click note → no edit
- [ ] Double-click image → lightbox opens
- [ ] Delete key → no deletion
- [ ] Ctrl+Z → no undo
- [ ] Paste image → no new element
- [ ] Drop image onto canvas → nothing
