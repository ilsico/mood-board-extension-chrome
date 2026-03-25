# Drag GPU Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate drag lag by switching from `left/top` layout writes to `transform: translate3d` during drag, add CSS GPU hints, and throttle connection updates.

**Architecture:** During drag, `style.left/top` are frozen at the drag-start position; all visual movement is applied via `style.transform = translate3d(dx, dy, 0)`. On mouseup the transform is cleared and `left/top` are committed to the final position (already done in existing `onUp`). Utility functions `getRect` and `getElCenter` are updated to decode the transform offset so connections and snap remain accurate. No test framework exists — verification is manual in Chrome.

**Tech Stack:** Vanilla JS, Chrome Extension (Manifest V3), no build step. Load unpacked extension in `chrome://extensions` to test.

---

## How to test after each task

1. Open `chrome://extensions` → click **Reload** on the extension
2. Open a new tab → click the extension icon to open a board
3. Add 2–3 elements and at least one connection (right-click two elements → Connect)
4. Drag elements and verify behaviour matches the checklist in each task

---

### Task 1: CSS GPU hints

**Files:**
- Modify: `index.html:861-867` (`.board-element` rule)
- Modify: `index.html:1642-1651` (`.el-connection` rule)

**Step 1: Add GPU hints to `.board-element`**

Current block (line 861):
```css
.board-element {
  position: absolute;
  cursor:
    url("data:image/svg+xml,...") 2 2,
    default;
}
```

Add three lines inside the rule (after `position: absolute;`):
```css
.board-element {
  position: absolute;
  will-change: transform;
  backface-visibility: hidden;
  transform: translateZ(0);
  cursor:
    url("data:image/svg+xml,...") 2 2,
    default;
}
```

**Step 2: Add GPU hints to `.el-connection`**

Current block (line 1642):
```css
.el-connection {
  position: absolute;
  top: 0;
  left: 0;
  width: 8000px;
  height: 8000px;
  pointer-events: none;
  z-index: 1;
  overflow: visible;
}
```

Add two lines (after `overflow: visible;`):
```css
.el-connection {
  position: absolute;
  top: 0;
  left: 0;
  width: 8000px;
  height: 8000px;
  pointer-events: none;
  z-index: 1;
  overflow: visible;
  backface-visibility: hidden;
  transform: translateZ(0);
}
```

**Step 3: Manual verification**

Reload extension. Open board. Visually confirm elements still look identical (no layout shift, no missing borders). The `translateZ(0)` on `.board-element` creates a new stacking context — confirm selection outline (`outline: 2.5px solid black`) still shows correctly on selected elements.

**Step 4: Commit**

```bash
git add index.html
git commit -m "perf: add GPU compositing hints to board-element and el-connection"
```

---

### Task 2: Update `getRect` and `getElCenter` to decode translate3d offset

These two functions read `parseFloat(el.style.left)` to get position. When `style.left` is frozen during translate3d drag (upcoming Task 4), they must also read the transform offset.

**Files:**
- Modify: `app.js:1964-1969` (`getRect`)
- Modify: `app.js:3789-3793` (`getElCenter`)

**Step 1: Add transform-parsing helper inline in `getRect`**

Current `getRect` (line 1964):
```javascript
function getRect(el) {
  const l = parseFloat(el.style.left) || 0;
  const t = parseFloat(el.style.top) || 0;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  return { l, t, r: l + w, b: t + h, cx: l + w / 2, cy: t + h / 2, w, h };
}
```

Replace with:
```javascript
function getRect(el) {
  const l = parseFloat(el.style.left) || 0;
  const t = parseFloat(el.style.top) || 0;
  let tx = 0, ty = 0;
  const tr = el.style.transform;
  if (tr) {
    const m = tr.match(/translate3d\(\s*([-\d.]+)px,\s*([-\d.]+)px/);
    if (m) { tx = parseFloat(m[1]); ty = parseFloat(m[2]); }
  }
  const left = l + tx;
  const top  = t + ty;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  return { l: left, t: top, r: left + w, b: top + h, cx: left + w / 2, cy: top + h / 2, w, h };
}
```

**Step 2: Add transform-parsing inline in `getElCenter`**

Current `getElCenter` (line 3789):
```javascript
function getElCenter(el) {
  return {
    x: (parseFloat(el.style.left) || 0) + el.offsetWidth / 2,
    y: (parseFloat(el.style.top) || 0) + el.offsetHeight / 2,
  };
}
```

Replace with:
```javascript
function getElCenter(el) {
  const l = parseFloat(el.style.left) || 0;
  const t = parseFloat(el.style.top) || 0;
  let tx = 0, ty = 0;
  const tr = el.style.transform;
  if (tr) {
    const m = tr.match(/translate3d\(\s*([-\d.]+)px,\s*([-\d.]+)px/);
    if (m) { tx = parseFloat(m[1]); ty = parseFloat(m[2]); }
  }
  return {
    x: l + tx + el.offsetWidth / 2,
    y: t + ty + el.offsetHeight / 2,
  };
}
```

**Step 3: Verify backwards compatibility**

Non-dragging elements have no `style.transform` (or have `translateZ(0)` from Task 1). The regex `/translate3d\(\s*([-\d.]+)px,\s*([-\d.]+)px/` does NOT match `translateZ(0)` — `tx` and `ty` remain 0. Correct.

**Step 4: Manual verification**

Reload extension. Create two connected elements. Drag one — connections should still draw to the correct visual position (will be fully correct after Task 4, but at this stage connections continue to work since `style.left/top` are still being set normally).

**Step 5: Commit**

```bash
git add app.js
git commit -m "perf: decode translate3d offset in getRect and getElCenter"
```

---

### Task 3: Fix `doDuplicate` for translate3d

`doDuplicate` (line 2278) clones the dragged element. During a translate3d drag, `style.left` is frozen at `startLeft` — the clone would be placed at the wrong position. Also, when the original element is restored to `origLeft/origTop`, its transform must be cleared.

**Files:**
- Modify: `app.js:2278-2300` (`doDuplicate` closure)

**Step 1: Replace the body of `doDuplicate`**

Current block (lines 2278–2300):
```javascript
function doDuplicate() {
  if (duplicated) return;
  duplicated = true;
  const copy = el.cloneNode(true);
  copy.dataset.id = 'el_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  if (el.dataset.type === 'image' && _imgStore.has(el.dataset.id))
    _imgStore.set(copy.dataset.id, _imgStore.get(el.dataset.id));
  copy.style.zIndex = ++nextZ;
  copy.style.left = dragEl.style.left;
  copy.style.top = dragEl.style.top;
  el.style.left = origLeft + 'px';
  el.style.top = origTop + 'px';
  document.getElementById('canvas').appendChild(copy);
  attachElementEvents(copy);
  if (copy.dataset.type === 'color') reattachColorEvents(copy);
  if (copy.dataset.type === 'note') reattachNoteEvents(copy);
  if (copy.dataset.type === 'file') reattachFileEvents(copy);
  dragEl = copy;
  selectEl(dragEl);
  excludeSet.add(dragEl);
  startLeft = parseFloat(copy.style.left) || 0;
  startTop = parseFloat(copy.style.top) || 0;
}
```

Replace with:
```javascript
function doDuplicate() {
  if (duplicated) return;
  duplicated = true;
  const copy = el.cloneNode(true);
  copy.dataset.id = 'el_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  if (el.dataset.type === 'image' && _imgStore.has(el.dataset.id))
    _imgStore.set(copy.dataset.id, _imgStore.get(el.dataset.id));
  copy.style.zIndex = ++nextZ;
  // Position copy at current visual position (curX/curY), not frozen style.left/top
  copy.style.left = curX + 'px';
  copy.style.top  = curY + 'px';
  copy.style.transform = '';
  // Restore original element to its pre-drag position and clear its transform
  el.style.left = origLeft + 'px';
  el.style.top  = origTop + 'px';
  el.style.transform = '';
  document.getElementById('canvas').appendChild(copy);
  attachElementEvents(copy);
  if (copy.dataset.type === 'color') reattachColorEvents(copy);
  if (copy.dataset.type === 'note') reattachNoteEvents(copy);
  if (copy.dataset.type === 'file') reattachFileEvents(copy);
  dragEl = copy;
  selectEl(dragEl);
  excludeSet.add(dragEl);
  // startLeft/startTop reset to current position so translate3d offset starts at 0
  startLeft = curX;
  startTop  = curY;
}
```

**Important:** `curX` and `curY` are declared in the outer closure (lines 2309–2310) and are accessible here. At the moment `doDuplicate` is first called (on alt-press), the drag RAF may not have run yet — if called before the first RAF frame, `curX === startLeft` and `curY === startTop`, which is correct (copy placed at original position, offset zero).

**Step 2: Manual verification**

Reload extension. Add an element. Hold **Alt** and drag — a copy should appear at the cursor position (not jump to the original position). Release Alt — the copy should disappear and the original should continue dragging smoothly.

**Step 3: Commit**

```bash
git add app.js
git commit -m "fix: position doDuplicate copy at visual curX/curY for translate3d drag"
```

---

### Task 4: Refactor `dragRAF` — translate3d + inline snap + connection throttle

**Files:**
- Modify: `app.js:2307-2346` (variable declarations + `dragRAF`)

**Step 1: Add `_frameCount` variable**

In the variable declarations block (line 2307), after `let shiftAxisX = null;` add:
```javascript
let _frameCount = 0;
```

**Step 2: Replace `dragRAF` body**

Current `dragRAF` (lines 2317–2346):
```javascript
function dragRAF() {
  if (!dragActive) return;
  const prevX = curX,
    prevY = curY;
  curX = lerp(curX, targetX, 0.22);
  curY = lerp(curY, targetY, 0.22);

  const hasMoved = Math.abs(curX - prevX) > 0.05 || Math.abs(curY - prevY) > 0.05;
  if (hasMoved) {
    dragEl.style.left = curX + 'px';
    dragEl.style.top = curY + 'px';

    if (ctrlSnap) {
      applySnap(dragEl, excludeSet);
    } else {
      clearSnapGuides();
    }
    updateConnectionsForEl(dragEl);

    const _elId = dragEl.dataset.id;
    if (_elId) {
      document.querySelectorAll(`.el-caption[data-parent-id="${_elId}"]`).forEach((cap) => {
        cap.style.left = curX + 'px';
        cap.style.top = curY + dragEl.offsetHeight + 'px';
      });
    }
  }

  rafId = requestAnimationFrame(dragRAF);
}
```

Replace with:
```javascript
function dragRAF() {
  if (!dragActive) return;
  const prevX = curX,
    prevY = curY;
  curX = lerp(curX, targetX, 0.22);
  curY = lerp(curY, targetY, 0.22);

  const hasMoved = Math.abs(curX - prevX) > 0.05 || Math.abs(curY - prevY) > 0.05;
  if (hasMoved) {
    // Visual offset from frozen style.left/top
    let vx = curX - startLeft;
    let vy = curY - startTop;

    // Snap: compute visual pull without touching style.left/top or targetX/targetY
    if (ctrlSnap) {
      const others = getAllElements(excludeSet);
      if (others.length) {
        const snapRect = {
          l: curX, t: curY,
          r: curX + dragEl.offsetWidth, b: curY + dragEl.offsetHeight,
          w: dragEl.offsetWidth, h: dragEl.offsetHeight,
        };
        const { dx: sdx, dy: sdy, guidesH, guidesV } = computeSnap(snapRect, others);
        clearSnapGuides();
        if (sdx) vx += sdx;
        if (sdy) vy += sdy;
        guidesH.forEach((pos) => showSnapGuide(true, pos));
        guidesV.forEach((pos) => showSnapGuide(false, pos));
      }
    } else {
      clearSnapGuides();
    }

    dragEl.style.transform = `translate3d(${vx}px,${vy}px,0)`;

    // Throttle: update connections every other frame
    if (++_frameCount % 2 === 0) {
      updateConnectionsForEl(dragEl);
    }

    const _elId = dragEl.dataset.id;
    if (_elId) {
      document.querySelectorAll(`.el-caption[data-parent-id="${_elId}"]`).forEach((cap) => {
        cap.style.left = curX + 'px';
        cap.style.top = curY + dragEl.offsetHeight + 'px';
      });
    }
  }

  rafId = requestAnimationFrame(dragRAF);
}
```

**Step 3: Verify `onUp` is correct**

Confirm `onUp` (line 2403) still reads:
```javascript
dragEl.style.left = targetX + 'px';
dragEl.style.top = targetY + 'px';
dragEl.style.transform = '';
if (ctrlSnap) applySnap(dragEl, excludeSet);
updateConnectionsForEl(dragEl);
```
This is already correct — no changes needed. The `applySnap` call here operates on committed `left/top` (transform is cleared) and serves as the final snap correction.

**Step 4: Manual verification checklist**

- [ ] Drag a single element — it follows the cursor with a smooth lerp
- [ ] Connections update while dragging (may lag by one frame — expected)
- [ ] Hold **Ctrl** while dragging — snap guides appear and element snaps to edges
- [ ] Release mouse — element lands on snapped position
- [ ] Drag with a caption attached — caption follows correctly
- [ ] Hold **Alt** and drag — copy appears at cursor; releasing Alt restores original (Task 3)
- [ ] Open DevTools Performance tab, record a drag — confirm no "Forced reflow" warnings

**Step 5: Commit**

```bash
git add app.js
git commit -m "perf: use translate3d in dragRAF, inline snap, throttle connections"
```

---

### Task 5: Refactor `groupDragRAF` — translate3d + connection throttle + fix groupOnUp

**Files:**
- Modify: `app.js:2553-2581` (variable declarations + `groupDragRAF`)
- Modify: `app.js:2643-2671` (`groupOnUp`)

**Step 1: Add `_gFrameCount` variable**

In the variable declarations block (line 2553), after `const lerpFactor = 0.12;` add:
```javascript
let _gFrameCount = 0;
```

**Step 2: Replace `groupDragRAF` body**

Current `groupDragRAF` (lines 2562–2581):
```javascript
function groupDragRAF() {
  if (!groupDragActive) return;
  const prevDX = curDX,
    prevDY = curDY;
  curDX += (targetDX - curDX) * lerpFactor;
  curDY += (targetDY - curDY) * lerpFactor;

  const hasMoved = Math.abs(curDX - prevDX) > 0.05 || Math.abs(curDY - prevDY) > 0.05;
  if (hasMoved) {
    activeGroup.forEach((el) => {
      const s = starts.get(el);
      if (!s) return;
      el.style.left = s.left + curDX + 'px';
      el.style.top = s.top + curDY + 'px';
    });
    activeGroup.forEach((el) => updateConnectionsForEl(el));
    updateMultiResizeHandle();
  }
  groupRafId = requestAnimationFrame(groupDragRAF);
}
```

Replace with:
```javascript
function groupDragRAF() {
  if (!groupDragActive) return;
  const prevDX = curDX,
    prevDY = curDY;
  curDX += (targetDX - curDX) * lerpFactor;
  curDY += (targetDY - curDY) * lerpFactor;

  const hasMoved = Math.abs(curDX - prevDX) > 0.05 || Math.abs(curDY - prevDY) > 0.05;
  if (hasMoved) {
    activeGroup.forEach((el) => {
      const s = starts.get(el);
      if (!s) return;
      // s.left/s.top stay frozen; movement via transform
      el.style.transform = `translate3d(${curDX}px,${curDY}px,0)`;
    });
    // Throttle: update connections every other frame
    if (++_gFrameCount % 2 === 0) {
      activeGroup.forEach((el) => updateConnectionsForEl(el));
    }
    updateMultiResizeHandle();
  }
  groupRafId = requestAnimationFrame(groupDragRAF);
}
```

**Step 3: Fix `groupOnUp` — clear transforms after committing left/top**

Current `onUp` (line 2643), the commit block (lines 2651–2657):
```javascript
activeGroup.forEach((el) => {
  const s = starts.get(el);
  if (!s) return;
  el.style.left = s.left + targetDX + 'px';
  el.style.top = s.top + targetDY + 'px';
});
```

Replace with:
```javascript
activeGroup.forEach((el) => {
  const s = starts.get(el);
  if (!s) return;
  el.style.left = s.left + targetDX + 'px';
  el.style.top = s.top + targetDY + 'px';
  el.style.transform = '';
});
```

**Step 4: Manual verification checklist**

- [ ] Select 2+ elements (Shift+click) and drag — all move together with smooth lerp
- [ ] Connections between grouped elements update while dragging
- [ ] Release mouse — elements land at correct position with no transform residue
- [ ] Snap guides appear when **Ctrl** is held during group drag
- [ ] Hold **Alt** during group drag — copies appear at cursor positions
- [ ] Open DevTools → Elements panel: after releasing a group drag, confirm no `transform` attribute remains on any `.board-element`

**Step 5: Commit**

```bash
git add app.js
git commit -m "perf: use translate3d in groupDragRAF, throttle connections, clear transform in onUp"
```

---

## Done

All five tasks complete. The full change set:

| Change | Effect |
|--------|--------|
| CSS `will-change: transform` on `.board-element` | Browser pre-promotes element to GPU layer |
| CSS `translateZ(0)` + `backface-visibility: hidden` on `.board-element` + `.el-connection` | Forces GPU compositing |
| `getRect` + `getElCenter` decode transform offset | Snap and connection math stays accurate during translate3d drag |
| `doDuplicate` uses `curX/curY` for copy position | Alt+drag works correctly with frozen `style.left/top` |
| `dragRAF` / `groupDragRAF` use `translate3d` | Zero layout reflow per frame during drag |
| Snap computed inline in `dragRAF` without `applySnap` | Snap pull preserved; no `style.left/top` writes in RAF |
| Connection throttle (every 2nd frame) | Halves DOM scan cost during drag |
