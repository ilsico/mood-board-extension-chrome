# Design: GPU-Accelerated Drag Optimization

**Date:** 2026-03-03
**Status:** Approved

## Problem

Drag operations cause visible lag due to layout thrashing:

1. `dragRAF`/`groupDragRAF` write `el.style.left/top` each frame → marks layout dirty
2. `getElCenter()` then reads `el.offsetWidth` in the same frame → forces a synchronous layout flush
3. `canvas.querySelectorAll('.el-connection')` runs a full DOM scan every frame
4. No GPU compositing hints on draggable elements

## Solution: translate3d during drag + CSS GPU hints + connection throttle

### Section 1 — CSS (`index.html`)

**`.board-element`** — add:
```css
will-change: transform;
backface-visibility: hidden;
transform: translateZ(0);
```

**`.el-connection`** — add:
```css
backface-visibility: hidden;
transform: translateZ(0);
```

**`#drag-custom-preview`** — already has `pointer-events: none`. No change.

### Section 2 — `getElCenter` and `getRect` (`app.js`)

Both functions read `parseFloat(el.style.left)` as position. With translate3d, `style.left` is frozen at `startLeft` during drag. Both must parse the transform offset and add it:

```javascript
let tx = 0, ty = 0;
const t = el.style.transform;
if (t) {
  const m = t.match(/translate3d\(\s*([-\d.]+)px,\s*([-\d.]+)px/);
  if (m) { tx = parseFloat(m[1]); ty = parseFloat(m[2]); }
}
```

- `getElCenter`: returns `(left + tx) + offsetWidth/2`, `(top + ty) + offsetHeight/2`
- `getRect`: adds `tx/ty` to `l/t` before computing `r/b/cx/cy`

Key benefit: writing `transform` does not mark layout dirty, so `offsetWidth` reads no longer cause synchronous layout flushes.

### Section 3 — `dragRAF` refactor (`app.js`)

Replace `style.left/top` writes:
```javascript
// Before:
dragEl.style.left = curX + 'px';
dragEl.style.top  = curY + 'px';

// After:
dragEl.style.transform = `translate3d(${curX - startLeft}px,${curY - startTop}px,0)`;
```

**Snap**: `applySnap()` reads and writes `style.left/top` — cannot be used inside RAF with frozen left/top. Replace with inline `computeSnap` call in the RAF, passing `{ l: curX, t: curY, w, h }` as the drag rect. Add snap offsets only to the visual transform (not to `curX/curY` or `targetX/targetY`) to preserve the "magnetic pull" feel.

**Captions**: use `curX`/`curY` directly — no DOM reads needed.

**`onUp`**: Lines 2409–2411 already set `style.left = targetX`, `style.top = targetY`, `style.transform = ''`. The existing `applySnap` call in `onUp` is kept — it finalises snap on the committed `left/top`. No double-snap: the in-RAF snap only affects the visual transform.

### Section 4 — `doDuplicate` fix (`app.js`)

When alt is held mid-drag, `doDuplicate()` clones `dragEl`. The clone inherits frozen `style.left = startLeft` and `style.transform = translate3d(...)`. Fix:

1. Clear clone's transform: `copy.style.transform = ''`
2. Set clone's position to visual: `copy.style.left = curX + 'px'; copy.style.top = curY + 'px'`
3. Reset: `startLeft = curX; startTop = curY` so translate3d offset is zero for new drag

### Section 5 — `groupDragRAF` refactor (`app.js`)

Replace per-element `style.left/top` writes with transform:
```javascript
// Before:
el.style.left = s.left + curDX + 'px';
el.style.top  = s.top  + curDY + 'px';

// After:
el.style.transform = `translate3d(${curDX}px,${curDY}px,0)`;
```

`s.left/s.top` stay frozen. In `groupOnUp`, after setting final `style.left/top`, clear each element's transform: `el.style.transform = ''`.

### Section 6 — Connection throttle (`app.js`)

In both `dragRAF` and `groupDragRAF`: add a local `_frameCount` counter, increment each frame, call `updateConnectionsForEl` only when `_frameCount % 2 === 0`. Halves connection DOM work with no visible quality loss.

## Files changed

| File | Section |
|------|---------|
| `index.html` | CSS: `.board-element`, `.el-connection` |
| `app.js` | `getElCenter`, `getRect`, `dragRAF`, `doDuplicate`, `groupDragRAF`, `groupOnUp` |

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| `dropSnap` animation uses `transform: scale()` | Runs only on drop (drag inactive, transform cleared). No conflict. |
| `applySnap` in `onUp` double-snapping | In-RAF snap only touches visual transform, not `targetX/Y`. `onUp` snap applied to committed `left/top` is the authoritative final position. |
| Alt+drag clone at wrong position | Section 4 fix: clone positioned at `curX/curY`, `startLeft/startTop` reset. |
| `getRect` used by `computeSnap` for non-drag elements | Non-drag elements have no transform — `tx/ty` parse returns 0. Backwards-compatible. |
