# Corner-only Resize + No Drag Outline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-corner resize handle system with 4 invisible corner hit zones and suppress the selection outline while dragging an element.

**Architecture:** Change 2 is a single CSS rule. Change 1 removes the old `.resize-handle`/`#single-resize-handle` system from HTML, CSS, and JS, and replaces it with 4 screen-space overlay divs (`#resize-corner-nw/ne/sw/se`) positioned by a new `updateCornerHandles()` function, with a new `setupCornerHandles()` mousedown handler and a RAF-based `handleResizeMouse()`.

**Tech Stack:** Vanilla JS (IIFE), HTML/CSS, Chrome Extension MV3. No build step — edit files directly. Load extension at `chrome://extensions` (Developer Mode → Load unpacked) to test.

---

## File map

| File | Changes |
|---|---|
| `index.html` | CSS: remove `.resize-handle`, `#single-resize-handle` blocks; update preview/readonly selectors; add 4 corner handle CSS; add drag-outline rule. HTML: replace `#single-resize-handle` div with 4 corner divs. |
| `app.js` | Remove `.resize-handle` append in `makeElement()`; remove in-element `resize-handle` mousedown block; add 6 new globals; add `updateCornerHandles()`, `setupCornerHandles()`, `_scheduleResizeFrame()`; rewrite `handleResizeMouse()`; update mouseup handler; update undo/redo for `'resize'`. |

---

## Task 1 — Change 2: suppress selection outline during drag

**Files:**
- Modify: `index.html` (CSS section, near line 1172)

- [ ] **Step 1: Add CSS rule**

In `index.html`, find:
```css
      .board-element.selected {
        outline: 1px solid #000000;
        outline-offset: 3px;
      }
```
Change to:
```css
      .board-element.selected {
        outline: 1px solid #000000;
        outline-offset: 3px;
      }
      .board-element.selected.is-dragging { outline: none; }
```

- [ ] **Step 2: Verify manually**

Reload extension. Open a board, click an element — selection outline should appear. Click+drag the same element — outline should disappear during the drag and reappear on release.

- [ ] **Step 3: Commit**

```
git add index.html
git commit -m "feat: suppress selection outline during element drag"
```

---

## Task 2 — Remove old resize CSS from index.html

**Files:**
- Modify: `index.html` (5 CSS edits)

- [ ] **Step 1: Update `body.preview-mode` hide selector**

Find (lines ~613–618):
```css
      body.preview-mode #single-resize-handle,
      body.preview-mode #multi-resize-handle,
      body.preview-mode .resize-handle,
      body.preview-mode .color-eyedropper {
```
Replace with:
```css
      body.preview-mode #multi-resize-handle,
      body.preview-mode #resize-corner-nw,
      body.preview-mode #resize-corner-ne,
      body.preview-mode #resize-corner-sw,
      body.preview-mode #resize-corner-se,
      body.preview-mode .color-eyedropper {
```

- [ ] **Step 2: Remove `.resize-handle` and `#single-resize-handle` CSS blocks**

Find and remove the entire block from `.resize-handle {` through the closing brace of `#single-resize-handle::before`, plus the comment line and `.board-element.selected .resize-handle` rule. The exact text to remove:

```css
      .resize-handle {
        position: absolute;
        bottom: -11px;
        right: -11px;
        width: 14px;
        height: 14px;
        background: #ff3c00;
        border-radius: 0;
        cursor: se-resize;
        display: none;
        z-index: 20;
        transform-origin: center center;
      }
      .resize-handle::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 48px;
        height: 48px;
      }
      /* Le handle in-canvas est remplacé par #single-resize-handle en screen-space */
      .board-element.selected .resize-handle {
        display: none;
      }
      #single-resize-handle {
        position: absolute;
        width: 6px;
        height: 6px;
        background: #ff3c00;
        border-radius: 0;
        cursor: se-resize;
        display: none;
        z-index: 9000;
        transform: translate(-50%, -50%);
      }
      #single-resize-handle::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 48px;
        height: 48px;
      }
```

- [ ] **Step 3: Update `body.readonly-mode` hide selector**

Find (lines ~2171–2173):
```css
      body.readonly-mode .resize-handle,
      body.readonly-mode #single-resize-handle,
      body.readonly-mode #multi-resize-handle,
```
Replace with:
```css
      body.readonly-mode #multi-resize-handle,
      body.readonly-mode #resize-corner-nw,
      body.readonly-mode #resize-corner-ne,
      body.readonly-mode #resize-corner-sw,
      body.readonly-mode #resize-corner-se,
```

- [ ] **Step 4: Remove collab-locked `.resize-handle` rule**

Find and remove the entire block:
```css
      .board-element.collab-locked .resize-handle {
        display: none !important;
      }
```

- [ ] **Step 5: Commit**

```
git add index.html
git commit -m "refactor: remove old resize-handle and single-resize-handle CSS"
```

---

## Task 3 — Add corner handle HTML and CSS

**Files:**
- Modify: `index.html` (HTML and CSS)

- [ ] **Step 1: Replace the HTML element**

Find (line ~2564):
```html
          <div id="single-resize-handle"></div>
```
Replace with:
```html
          <div id="resize-corner-nw"></div>
          <div id="resize-corner-ne"></div>
          <div id="resize-corner-sw"></div>
          <div id="resize-corner-se"></div>
```

- [ ] **Step 2: Add corner handle CSS**

In the CSS section, immediately after the `#group-bounding-box` block (which ends with `}`), add:
```css
      #resize-corner-nw,
      #resize-corner-ne,
      #resize-corner-sw,
      #resize-corner-se {
        position: absolute;
        width: 16px;
        height: 16px;
        z-index: 9000;
        display: none;
        transform: translate(-50%, -50%);
      }
      #resize-corner-nw { cursor: nw-resize; }
      #resize-corner-ne { cursor: ne-resize; }
      #resize-corner-sw { cursor: sw-resize; }
      #resize-corner-se { cursor: se-resize; }
```

- [ ] **Step 3: Verify**

Reload extension in Chrome. No visual change expected yet (corners are invisible and hidden). Open DevTools → Elements → confirm `#resize-corner-nw` etc. exist in the DOM inside `#canvas-wrapper`.

- [ ] **Step 4: Commit**

```
git add index.html
git commit -m "feat: add 4 corner handle divs and CSS"
```

---

## Task 4 — Remove `.resize-handle` append from `makeElement()` and its event handler

**Files:**
- Modify: `app.js` (two edits)

- [ ] **Step 1: Remove from `makeElement()`**

Find (lines ~3424–3426):
```javascript
    const rh = document.createElement('div');
    rh.className = 'resize-handle';
    el.appendChild(rh);
```
Delete these 3 lines entirely. The function should go directly from `el.style.zIndex = ++nextZ;` to `attachElementEvents(el);`.

- [ ] **Step 2: Remove in-element resize-handle mousedown from `attachElementEvents()`**

Find and remove the entire block starting at `const rh = el.querySelector('.resize-handle');` through its closing brace (lines ~3827–3853):
```javascript
    const rh = el.querySelector('.resize-handle');
    if (rh) {
      rh.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (document.body.classList.contains('readonly-mode')) return;
        // Collab: vérifier et acquérir le lock
        if (typeof Collab !== 'undefined' && Collab.isActive()) {
          if (Collab.isLockedByOther(el.dataset.id)) {
            toast('Élément verrouillé');
            return;
          }
          Collab.acquireLock(el.dataset.id);
        }
        isResizing = true;
        resizeEl = el;
        resizeStartW = parseFloat(el.style.width) || el.offsetWidth;
        resizeStartH = parseFloat(el.style.height) || el.offsetHeight;
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        // Pour les images et fichiers : resize proportionnel
        resizeRatio =
          (el.dataset.type === 'image' || el.dataset.type === 'file') && el.dataset.ratio
            ? parseFloat(el.dataset.ratio)
            : null;
      });
    }
```

- [ ] **Step 3: Verify**

Reload extension. Open board, create/select an element. Right-click → DevTools → inspect the element — it should no longer contain a `.resize-handle` child div.

- [ ] **Step 4: Commit**

```
git add app.js
git commit -m "refactor: remove .resize-handle dom element and its event handler"
```

---

## Task 5 — Add new global variables

**Files:**
- Modify: `app.js` (top of IIFE, near line 30)

- [ ] **Step 1: Add 6 new variables**

Find (line ~30):
```javascript
  let resizeRatio = null; // ratio w/h pour les images (resize proportionnel)
```
Replace with:
```javascript
  let resizeRatio = null; // ratio w/h pour les images (resize proportionnel)
  let resizeCorner = null; // 'nw' | 'ne' | 'sw' | 'se'
  let resizeStartLeft = 0;
  let resizeStartTop = 0;
  let _resizeRafId = null;
  let _resizeTargetW = 0, _resizeTargetH = 0;
  let _resizeTargetLeft = 0, _resizeTargetTop = 0;
```

- [ ] **Step 2: Commit**

```
git add app.js
git commit -m "feat: add resize corner globals and RAF target variables"
```

---

## Task 6 — Add `updateCornerHandles()` and replace all call sites

**Files:**
- Modify: `app.js` (add function + 7 replacements + delete old function)

- [ ] **Step 1: Add `updateCornerHandles()` immediately after `applyTransform()`**

Find (lines ~1284–1291):
```javascript
  function applyTransform() {
    // Le bloc de restriction à 0.15 a été retiré pour supprimer le glitch
    document.getElementById('canvas').style.transform =
      `translate(${panX}px,${panY}px) scale(${zoomLevel})`;

    updateMultiResizeHandle();
    updateSingleResizeHandle();
  }
```
Replace with:
```javascript
  function applyTransform() {
    // Le bloc de restriction à 0.15 a été retiré pour supprimer le glitch
    document.getElementById('canvas').style.transform =
      `translate(${panX}px,${panY}px) scale(${zoomLevel})`;

    updateMultiResizeHandle();
    updateCornerHandles();
  }

  function updateCornerHandles() {
    const corners = ['nw', 'ne', 'sw', 'se'];
    if (!selectedEl || multiSelected.size > 0) {
      corners.forEach((c) => {
        const h = document.getElementById('resize-corner-' + c);
        if (h) h.style.display = 'none';
      });
      return;
    }
    const r = selectedEl.getBoundingClientRect();
    const wRect = document.getElementById('canvas-wrapper').getBoundingClientRect();
    const pos = {
      nw: { left: r.left - wRect.left, top: r.top - wRect.top },
      ne: { left: r.right - wRect.left, top: r.top - wRect.top },
      sw: { left: r.left - wRect.left, top: r.bottom - wRect.top },
      se: { left: r.right - wRect.left, top: r.bottom - wRect.top },
    };
    corners.forEach((c) => {
      const h = document.getElementById('resize-corner-' + c);
      if (!h) return;
      h.style.display = 'block';
      h.style.left = pos[c].left + 'px';
      h.style.top = pos[c].top + 'px';
    });
  }
```

- [ ] **Step 2: Replace all remaining `updateSingleResizeHandle()` call sites**

There are 6 remaining call sites (the one in `applyTransform` was already replaced above). Replace each occurrence:

**Undo (line ~2628):**
```javascript
        updateSingleResizeHandle();
        toast('Annulé');
```
→
```javascript
        updateCornerHandles();
        toast('Annulé');
```

**Redo (line ~2664):**
```javascript
      updateSingleResizeHandle();
      toast('Rétabli');
```
→
```javascript
      updateCornerHandles();
      toast('Rétabli');
```

**`deselectAll()` (line ~2968):**
```javascript
    updateMultiResizeHandle();
    updateSingleResizeHandle();
    updateAllConnections();
```
→
```javascript
    updateMultiResizeHandle();
    updateCornerHandles();
    updateAllConnections();
```

**`selectEl()` (line ~3011):**
```javascript
    updateMultiResizeHandle();
    updateSingleResizeHandle();
    _collabSyncSelection();
```
→
```javascript
    updateMultiResizeHandle();
    updateCornerHandles();
    _collabSyncSelection();
```

**`onUp` in single-element drag (line ~3708):**
```javascript
        updateSingleResizeHandle();
        clearSnapGuides();
```
→
```javascript
        updateCornerHandles();
        clearSnapGuides();
```

**Inside `handleResizeMouse()` (line ~4311):**
Delete this call — it will be handled by `_scheduleResizeFrame()` in Task 9.
```javascript
    updateSingleResizeHandle();
  }
```
→
```javascript
  }
```
(i.e., just remove the `updateSingleResizeHandle();` line at the bottom of `handleResizeMouse`)

- [ ] **Step 3: Delete `updateSingleResizeHandle()` function body**

Find and delete the entire function (lines ~1293–1305):
```javascript
  function updateSingleResizeHandle() {
    const handle = document.getElementById('single-resize-handle');
    if (!handle) return;
    if (!selectedEl || multiSelected.size > 0) {
      handle.style.display = 'none';
      return;
    }
    const r = selectedEl.getBoundingClientRect();
    const wRect = document.getElementById('canvas-wrapper').getBoundingClientRect();
    handle.style.display = 'block';
    handle.style.left = r.right - wRect.left + 'px';
    handle.style.top = r.bottom - wRect.top + 'px';
  }
```

- [ ] **Step 4: Commit**

```
git add app.js
git commit -m "feat: add updateCornerHandles, replace all updateSingleResizeHandle call sites"
```

---

## Task 7 — Add `setupCornerHandles()`, update `init()`, remove old setup function

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add `setupCornerHandles()` immediately after the `updateCornerHandles()` function added in Task 6**

Insert this function after `updateCornerHandles()`:
```javascript
  function setupCornerHandles() {
    ['nw', 'ne', 'sw', 'se'].forEach((corner) => {
      const handle = document.getElementById('resize-corner-' + corner);
      if (!handle) return;
      handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        if (!selectedEl) return;
        if (document.body.classList.contains('readonly-mode')) return;
        if (typeof Collab !== 'undefined' && Collab.isActive()) {
          if (Collab.isLockedByOther(selectedEl.dataset.id)) {
            toast('Élément verrouillé');
            return;
          }
          Collab.acquireLock(selectedEl.dataset.id);
        }
        isResizing = true;
        resizeEl = selectedEl;
        resizeStartW = parseFloat(selectedEl.style.width) || selectedEl.offsetWidth;
        resizeStartH = parseFloat(selectedEl.style.height) || selectedEl.offsetHeight;
        resizeStartLeft = parseFloat(selectedEl.style.left) || 0;
        resizeStartTop = parseFloat(selectedEl.style.top) || 0;
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        resizeCorner = corner;
        const t = selectedEl.dataset.type;
        if (t === 'note' || t === 'color') {
          resizeRatio = null;
        } else if (selectedEl.dataset.ratio) {
          resizeRatio = parseFloat(selectedEl.dataset.ratio);
        } else {
          resizeRatio = resizeStartH > 0 ? resizeStartW / resizeStartH : null;
        }
      });
    });
  }
```

- [ ] **Step 2: Update `init()` to call `setupCornerHandles()` instead of `setupSingleResizeHandle()`**

Find (line ~312–313):
```javascript
    setupMultiResizeHandle();
    setupSingleResizeHandle();
```
Replace with:
```javascript
    setupMultiResizeHandle();
    setupCornerHandles();
```

- [ ] **Step 3: Delete `setupSingleResizeHandle()` function body**

Find and delete the entire function (lines ~1307–1335):
```javascript
  function setupSingleResizeHandle() {
    const handle = document.getElementById('single-resize-handle');
    if (!handle) return;
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      if (!selectedEl) return;
      if (document.body.classList.contains('readonly-mode')) return;
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        if (Collab.isLockedByOther(selectedEl.dataset.id)) {
          toast('Élément verrouillé');
          return;
        }
        Collab.acquireLock(selectedEl.dataset.id);
      }
      isResizing = true;
      resizeEl = selectedEl;
      resizeStartW = parseFloat(selectedEl.style.width) || selectedEl.offsetWidth;
      resizeStartH = parseFloat(selectedEl.style.height) || selectedEl.offsetHeight;
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      resizeRatio =
        (selectedEl.dataset.type === 'image' || selectedEl.dataset.type === 'file') &&
        selectedEl.dataset.ratio
          ? parseFloat(selectedEl.dataset.ratio)
          : null;
    });
  }
```

- [ ] **Step 4: Verify**

Reload extension. Select an element — four invisible corners should be positioned around it (confirm with DevTools: `document.getElementById('resize-corner-se').style`). No resize functionality yet (mouseup handling not updated yet).

- [ ] **Step 5: Commit**

```
git add app.js
git commit -m "feat: add setupCornerHandles, remove setupSingleResizeHandle"
```

---

## Task 8 — Replace 5 explicit `single-resize-handle` hide calls in drag handlers

**Files:**
- Modify: `app.js` (5 replacements inside `attachElementEvents()`)

Each occurrence is a 2-line pattern hiding the old handle. Replace every instance with a 4-corner hide. The 5 locations and their surrounding context:

- [ ] **Step 1: Replace at drag `mousedown` start (line ~3469)**

Find:
```javascript
      const _srhInit = document.getElementById('single-resize-handle');
      if (_srhInit) _srhInit.style.display = 'none';
```
Replace with:
```javascript
      ['nw', 'ne', 'sw', 'se'].forEach((c) => {
        const h = document.getElementById('resize-corner-' + c);
        if (h) h.style.display = 'none';
      });
```

- [ ] **Step 2: Replace inside `doDuplicate()` (line ~3512)**

Find:
```javascript
        const _srh = document.getElementById('single-resize-handle');
        if (_srh) _srh.style.display = 'none';
```
Replace with:
```javascript
        ['nw', 'ne', 'sw', 'se'].forEach((c) => {
          const h = document.getElementById('resize-corner-' + c);
          if (h) h.style.display = 'none';
        });
```

- [ ] **Step 3: Replace inside `dragRAF` (line ~3577)**

Find:
```javascript
          const _srh2 = document.getElementById('single-resize-handle');
          if (_srh2 && _srh2.style.display !== 'none') _srh2.style.display = 'none';
```
Replace with:
```javascript
          ['nw', 'ne', 'sw', 'se'].forEach((c) => {
            const h = document.getElementById('resize-corner-' + c);
            if (h && h.style.display !== 'none') h.style.display = 'none';
          });
```

- [ ] **Step 4: Replace in alt-release copy cancel (line ~3644)**

Find:
```javascript
          const _srh3 = document.getElementById('single-resize-handle');
          if (_srh3) _srh3.style.display = 'none';
```
Replace with:
```javascript
          ['nw', 'ne', 'sw', 'se'].forEach((c) => {
            const h = document.getElementById('resize-corner-' + c);
            if (h) h.style.display = 'none';
          });
```

- [ ] **Step 5: Replace at start of drag listener block (line ~3788)**

Find:
```javascript
      const _srh = document.getElementById('single-resize-handle');
      if (_srh) _srh.style.display = 'none';
```
Replace with:
```javascript
      ['nw', 'ne', 'sw', 'se'].forEach((c) => {
        const h = document.getElementById('resize-corner-' + c);
        if (h) h.style.display = 'none';
      });
```

- [ ] **Step 6: Verify**

Reload extension. Select an element — corner handles appear. Start dragging — corner handles hide. Release — `updateCornerHandles()` fires in `onUp` so handles reappear at the new position.

- [ ] **Step 7: Commit**

```
git add app.js
git commit -m "feat: update drag hide calls from single-resize-handle to corner handles"
```

---

## Task 9 — Add `_scheduleResizeFrame()` and rewrite `handleResizeMouse()`

**Files:**
- Modify: `app.js` (replace `handleResizeMouse` function entirely)

- [ ] **Step 1: Replace `handleResizeMouse()` with the new version**

Find the entire existing function (lines ~4205–4312):
```javascript
  function handleResizeMouse(e) {
    const dx = (e.clientX - resizeStartX) / zoomLevel;
    ...
    updateSingleResizeHandle();
  }
```
(The function starts at `function handleResizeMouse(e) {` and ends with the closing `}` before `// ── RESTORE ──`)

Replace with:
```javascript
  function _scheduleResizeFrame() {
    if (_resizeRafId) return;
    _resizeRafId = requestAnimationFrame(() => {
      _resizeRafId = null;
      if (!isResizing || !resizeEl) return;
      resizeEl.style.width  = _resizeTargetW    + 'px';
      resizeEl.style.height = _resizeTargetH    + 'px';
      resizeEl.style.left   = _resizeTargetLeft + 'px';
      resizeEl.style.top    = _resizeTargetTop  + 'px';
      if (resizeEl.dataset.type === 'file') {
        const fw = resizeEl.querySelector('.el-file');
        if (fw) {
          fw.style.transform = 'scale(' + _resizeTargetW / 260 + ')';
          fw.style.transformOrigin = 'top left';
        }
      }
      const _rId = resizeEl.dataset.id;
      if (_rId) {
        document.querySelectorAll(`.el-caption[data-parent-id="${_rId}"]`).forEach((cap) => {
          cap.style.width = _resizeTargetW    + 'px';
          cap.style.left  = _resizeTargetLeft + 'px';
          cap.style.top   = (_resizeTargetTop + _resizeTargetH) + 'px';
        });
      }
      updateConnectionsForEl(resizeEl);
      updateCornerHandles();
    });
  }

  function handleResizeMouse(e) {
    const dx = (e.clientX - resizeStartX) / zoomLevel;
    const dy = (e.clientY - resizeStartY) / zoomLevel;
    const mins = _getMinSize(resizeEl);

    const rawW = (resizeCorner === 'se' || resizeCorner === 'ne')
      ? resizeStartW + dx : resizeStartW - dx;
    const rawH = (resizeCorner === 'se' || resizeCorner === 'sw')
      ? resizeStartH + dy : resizeStartH - dy;

    let fw, fh;
    if (resizeRatio) {
      const scale = Math.max(
        rawW / resizeStartW,
        rawH / resizeStartH,
        mins.w / resizeStartW
      );
      fw = Math.max(mins.w, Math.round(resizeStartW * scale));
      fh = Math.max(mins.h, Math.round(fw / resizeRatio));
    } else {
      fw = Math.max(mins.w, rawW);
      fh = Math.max(mins.h, rawH);
    }

    const newLeft = resizeStartLeft +
      (resizeCorner === 'sw' || resizeCorner === 'nw' ? resizeStartW - fw : 0);
    const newTop  = resizeStartTop  +
      (resizeCorner === 'ne' || resizeCorner === 'nw' ? resizeStartH - fh : 0);

    // Snap: only SE corner, unchanged behaviour
    if (ctrlSnap && resizeCorner === 'se') {
      const T = snapThreshold / zoomLevel;
      const others = getAllElements(new Set([resizeEl]));
      if (others.length) {
        const elL = newLeft;
        const elT = newTop;
        let elR = elL + fw;
        let elB = elT + fh;

        let snapDX = null, snapDY = null;
        const guidesH = [], guidesV = [];

        others.forEach((other) => {
          const or = getRect(other);
          const xTargets = [or.l, or.cx, or.r];
          const yTargets = [or.t, or.cy, or.b];
          xTargets.forEach((target) => {
            const d = target - elR;
            if (Math.abs(d) < T && (snapDX === null || Math.abs(d) < Math.abs(snapDX))) {
              snapDX = d;
              guidesV.push(target);
            }
          });
          yTargets.forEach((target) => {
            const d = target - elB;
            if (Math.abs(d) < T && (snapDY === null || Math.abs(d) < Math.abs(snapDY))) {
              snapDY = d;
              guidesH.push(target);
            }
          });
        });

        if (snapDX) {
          const snappedW = Math.max(resizeRatio ? 40 : 60, fw + snapDX);
          if (resizeRatio) {
            fw = snappedW;
            fh = Math.round(snappedW / resizeRatio);
          } else {
            fw = snappedW;
          }
        }
        if (snapDY && !resizeRatio) {
          fh = Math.max(40, fh + snapDY);
        }

        clearSnapGuides();
        guidesH.forEach((pos) => showSnapGuide(true, pos));
        guidesV.forEach((pos) => showSnapGuide(false, pos));
      }
    } else {
      clearSnapGuides();
    }

    _resizeTargetW    = fw;
    _resizeTargetH    = fh;
    _resizeTargetLeft = newLeft;
    _resizeTargetTop  = newTop;
    _scheduleResizeFrame();
  }
```

- [ ] **Step 2: Verify**

Reload extension. Select an image element. Drag any of the 4 corner handles — the element should resize in real time. Check:
- SE corner: grows/shrinks proportionally, position stays fixed.
- NW corner: grows/shrinks proportionally, element position shifts so the SE corner stays fixed.
- NE/SW corners: work similarly.
- Note element: SE and NW corners should resize freely (non-proportional).
- Color element: same free resize.

- [ ] **Step 3: Commit**

```
git add app.js
git commit -m "feat: add _scheduleResizeFrame, rewrite handleResizeMouse with 4-corner RAF logic"
```

---

## Task 10 — Update `mouseup` handler in `setupCanvasEvents`

**Files:**
- Modify: `app.js` (inside the global `window.addEventListener('mouseup', ...)`)

- [ ] **Step 1: Update the `isResizing` block**

Find the entire `if (isResizing) {` block (lines ~1876–1917):
```javascript
      if (isResizing) {
        // Collab: sync taille finale + libérer le lock
        if (typeof Collab !== 'undefined' && Collab.isActive() && resizeEl) {
          const fw = parseFloat(resizeEl.style.width) || null;
          const fh = parseFloat(resizeEl.style.height) || null;
          Collab.syncElementSize(resizeEl.dataset.id, fw, fh, true);
          Collab.releaseLock(resizeEl.dataset.id);
          // Collab: sync la nouvelle position des captions attachées
          const _rElId = resizeEl.dataset.id;
          if (_rElId) {
            document.querySelectorAll(`.el-caption[data-parent-id="${_rElId}"]`).forEach((cap) => {
              if (cap.dataset.capId) {
                Collab.syncCaption(
                  cap.dataset.capId,
                  _rElId,
                  parseFloat(cap.style.left) || 0,
                  parseFloat(cap.style.top) || 0,
                  cap.style.width || '',
                  cap.textContent || ''
                );
              }
            });
          }
        }
        // Action-based undo for resize
        if (resizeEl) {
          const afterW = parseFloat(resizeEl.style.width) || null;
          const afterH = parseFloat(resizeEl.style.height) || null;
          if (afterW !== resizeStartW || afterH !== resizeStartH) {
            pushAction({
              type: 'resize',
              elId: resizeEl.dataset.id,
              before: { w: resizeStartW, h: resizeStartH },
              after: { w: afterW, h: afterH },
            });
          }
        }
        isResizing = false;
        resizeEl = null;
        clearSnapGuides();
        pushHistory();
      }
```
Replace with:
```javascript
      if (isResizing) {
        // Cancel any pending RAF and apply final values immediately
        if (_resizeRafId) {
          cancelAnimationFrame(_resizeRafId);
          _resizeRafId = null;
        }
        if (resizeEl) {
          resizeEl.style.width  = _resizeTargetW    + 'px';
          resizeEl.style.height = _resizeTargetH    + 'px';
          resizeEl.style.left   = _resizeTargetLeft + 'px';
          resizeEl.style.top    = _resizeTargetTop  + 'px';
          if (resizeEl.dataset.type === 'file') {
            const fw = resizeEl.querySelector('.el-file');
            if (fw) {
              fw.style.transform = 'scale(' + _resizeTargetW / 260 + ')';
              fw.style.transformOrigin = 'top left';
            }
          }
        }
        // Collab: sync taille + position finale + libérer le lock
        if (typeof Collab !== 'undefined' && Collab.isActive() && resizeEl) {
          const fw = parseFloat(resizeEl.style.width) || null;
          const fh = parseFloat(resizeEl.style.height) || null;
          const fx = parseFloat(resizeEl.style.left)  || 0;
          const fy = parseFloat(resizeEl.style.top)   || 0;
          Collab.syncElementSize(resizeEl.dataset.id, fw, fh, true);
          Collab.syncElementPosition(resizeEl.dataset.id, fx, fy, true);
          Collab.releaseLock(resizeEl.dataset.id);
          // Collab: sync la nouvelle position des captions attachées
          const _rElId = resizeEl.dataset.id;
          if (_rElId) {
            document.querySelectorAll(`.el-caption[data-parent-id="${_rElId}"]`).forEach((cap) => {
              if (cap.dataset.capId) {
                Collab.syncCaption(
                  cap.dataset.capId,
                  _rElId,
                  parseFloat(cap.style.left) || 0,
                  parseFloat(cap.style.top) || 0,
                  cap.style.width || '',
                  cap.textContent || ''
                );
              }
            });
          }
        }
        // Action-based undo for resize
        if (resizeEl) {
          const afterW = parseFloat(resizeEl.style.width)  || null;
          const afterH = parseFloat(resizeEl.style.height) || null;
          const afterX = parseFloat(resizeEl.style.left)   || 0;
          const afterY = parseFloat(resizeEl.style.top)    || 0;
          if (afterW !== resizeStartW || afterH !== resizeStartH) {
            pushAction({
              type: 'resize',
              elId: resizeEl.dataset.id,
              before: { w: resizeStartW, h: resizeStartH, x: resizeStartLeft, y: resizeStartTop },
              after:  { w: afterW,       h: afterH,       x: afterX,          y: afterY },
            });
          }
        }
        isResizing = false;
        resizeEl = null;
        clearSnapGuides();
        pushHistory();
      }
```

- [ ] **Step 2: Verify**

Reload extension. Resize an image using NW corner. Undo (Ctrl+Z) — the element should return to its original size AND position. Redo (Ctrl+Y or Ctrl+Shift+Z) — it should go forward again.

- [ ] **Step 3: Commit**

```
git add app.js
git commit -m "feat: update mouseup to flush RAF, sync collab position, store x/y in resize action"
```

---

## Task 11 — Update undo/redo for `'resize'` to restore position

**Files:**
- Modify: `app.js` (`_applyBackward` and `_applyForward` functions)

- [ ] **Step 1: Update `_applyBackward` case `'resize'`**

Find (lines ~2405–2412):
```javascript
      case 'resize': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (!el) break;
        if (action.before.w) el.style.width = action.before.w + 'px';
        if (action.before.h) el.style.height = action.before.h + 'px';
        updateConnectionsForEl(el);
        if (isCollab) Collab.syncElementSize(action.elId, action.before.w, action.before.h, true);
        break;
      }
```
Replace with:
```javascript
      case 'resize': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (!el) break;
        if (action.before.w) el.style.width  = action.before.w + 'px';
        if (action.before.h) el.style.height = action.before.h + 'px';
        if (action.before.x != null) el.style.left = action.before.x + 'px';
        if (action.before.y != null) el.style.top  = action.before.y + 'px';
        updateConnectionsForEl(el);
        if (isCollab) {
          Collab.syncElementSize(action.elId, action.before.w, action.before.h, true);
          if (action.before.x != null)
            Collab.syncElementPosition(action.elId, action.before.x, action.before.y, true);
        }
        break;
      }
```

- [ ] **Step 2: Update `_applyForward` case `'resize'`**

Find (lines ~2511–2518):
```javascript
      case 'resize': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (!el) break;
        if (action.after.w) el.style.width = action.after.w + 'px';
        if (action.after.h) el.style.height = action.after.h + 'px';
        updateConnectionsForEl(el);
        if (isCollab) Collab.syncElementSize(action.elId, action.after.w, action.after.h, true);
        break;
      }
```
Replace with:
```javascript
      case 'resize': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (!el) break;
        if (action.after.w) el.style.width  = action.after.w + 'px';
        if (action.after.h) el.style.height = action.after.h + 'px';
        if (action.after.x != null) el.style.left = action.after.x + 'px';
        if (action.after.y != null) el.style.top  = action.after.y + 'px';
        updateConnectionsForEl(el);
        if (isCollab) {
          Collab.syncElementSize(action.elId, action.after.w, action.after.h, true);
          if (action.after.x != null)
            Collab.syncElementPosition(action.elId, action.after.x, action.after.y, true);
        }
        break;
      }
```

- [ ] **Step 3: Full end-to-end verification**

Reload extension. Run through this checklist:

1. **SE corner — image**: Select image, drag SE corner outward → proportional grow. Release. Undo → back to original size and position. Redo → restored.
2. **NW corner — image**: Drag NW corner → element grows, NW position shifts, SE corner stays fixed. Undo restores both size and position.
3. **NE corner — video**: Drag NE → width grows, top edge shifts. NE cursor shown. Free-form verify other corners.
4. **Note — SE corner**: Drag SE → free resize (non-proportional). Width and height change independently.
5. **Color element**: Same free resize as notes.
6. **Selection outline**: Click element → outline visible. Drag element → outline hidden. Release → outline back.
7. **Multi-resize handle** (group): Select 2+ elements → `#multi-resize-handle` still appears at bottom-right. Drag it → group resize works unchanged.
8. **Drag hide**: While dragging an element, DevTools confirms `#resize-corner-se` has `display: none`. After release, confirm `display: block` and correct position.

- [ ] **Step 4: Commit**

```
git add app.js
git commit -m "feat: update undo/redo resize action to restore element position (NW/NE/SW corners)"
```
