# Spec: Corner-only proportional resize + no drag selection outline

**Date:** 2026-05-07  
**Files affected:** `app.js`, `index.html`

---

## Change 1 — Corner-only proportional resize

### Goal
Replace the current single-handle (bottom-right only) resize system for individual elements with 4 invisible corner hit zones. Resize is proportional for all types except `note` and `color`.  
The `#multi-resize-handle` (group resize, bottom-right of bounding box) is **not changed**.

---

### What gets removed

| Location | What |
|---|---|
| `index.html` | `<div id="single-resize-handle">` element |
| `index.html` CSS | `.resize-handle`, `.resize-handle::before`, `.board-element.selected .resize-handle`, `#single-resize-handle`, `#single-resize-handle::before` rules |
| `index.html` CSS | `body.preview-mode #single-resize-handle` and `body.readonly-mode #single-resize-handle` selectors |
| `app.js makeElement()` | `const rh = …; rh.className = 'resize-handle'; el.appendChild(rh);` |
| `app.js attachElementEvents()` | `el.querySelector('.resize-handle')` block and its `mousedown` handler (~lines 3827–3853) |
| `app.js` | `setupSingleResizeHandle()` function |
| `app.js` | `updateSingleResizeHandle()` function and all 16+ call sites (replaced by `updateCornerHandles()`) |

---

### What gets added

#### HTML (`index.html`, inside `canvas-wrapper`, after `#multi-resize-handle`)

```html
<div id="resize-corner-nw"></div>
<div id="resize-corner-ne"></div>
<div id="resize-corner-sw"></div>
<div id="resize-corner-se"></div>
```

#### CSS (`index.html`)

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

body.preview-mode #resize-corner-nw,
body.preview-mode #resize-corner-ne,
body.preview-mode #resize-corner-sw,
body.preview-mode #resize-corner-se,
body.readonly-mode #resize-corner-nw,
body.readonly-mode #resize-corner-ne,
body.readonly-mode #resize-corner-sw,
body.readonly-mode #resize-corner-se { display: none !important; }
```

#### JS — new global variables (alongside existing `resizeEl`, `resizeRatio`, etc.)

```js
let resizeCorner = null;        // 'nw' | 'ne' | 'sw' | 'se'
let resizeStartLeft = 0;
let resizeStartTop = 0;
let _resizeRafId = null;
let _resizeTargetW = 0, _resizeTargetH = 0;
let _resizeTargetLeft = 0, _resizeTargetTop = 0;
```

---

### `updateCornerHandles()` — replaces `updateSingleResizeHandle()`

- Called in all places where `updateSingleResizeHandle()` was called.
- If `!selectedEl || multiSelected.size > 0`: set all 4 corners `display: none`, return.
- Otherwise: read `selectedEl.getBoundingClientRect()` and `canvas-wrapper.getBoundingClientRect()`.
  - NW: `left = r.left - wRect.left`, `top = r.top - wRect.top`
  - NE: `left = r.right - wRect.left`, `top = r.top - wRect.top`
  - SW: `left = r.left - wRect.left`, `top = r.bottom - wRect.top`
  - SE: `left = r.right - wRect.left`, `top = r.bottom - wRect.top`
- Set all 4 to `display: block` and apply positions.

---

### `setupCornerHandles()` — replaces `setupSingleResizeHandle()`

Called once in `init()`. Adds a `mousedown` listener to each of the 4 corner divs.

Common logic on mousedown (same for all 4):
1. Guard: `e.button !== 0`, `readonly-mode`, Collab locked → return.
2. `e.stopPropagation(); e.preventDefault()`
3. If Collab active: `Collab.acquireLock(selectedEl.dataset.id)`
4. Set `isResizing = true`, `resizeEl = selectedEl`
5. `resizeStartW = parseFloat(selectedEl.style.width) || selectedEl.offsetWidth`
6. `resizeStartH = parseFloat(selectedEl.style.height) || selectedEl.offsetHeight`
7. `resizeStartLeft = parseFloat(selectedEl.style.left) || 0`
8. `resizeStartTop = parseFloat(selectedEl.style.top) || 0`
9. `resizeStartX = e.clientX`, `resizeStartY = e.clientY`
10. Set `resizeCorner` to the appropriate corner string.
11. Set `resizeRatio`:
    - `note` or `color` type → `null` (free resize)
    - `image` or `file` with `data-ratio` → `parseFloat(el.dataset.ratio)`
    - all other types (link, video, or image/file without `data-ratio`) → `resizeStartW / resizeStartH`

---

### `_scheduleResizeFrame()` — new helper

```js
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
      if (fw) { fw.style.transform = 'scale(' + _resizeTargetW / 260 + ')'; fw.style.transformOrigin = 'top left'; }
    }
    const _rId = resizeEl.dataset.id;
    if (_rId) {
      document.querySelectorAll(`.el-caption[data-parent-id="${_rId}"]`).forEach((cap) => {
        cap.style.width = _resizeTargetW + 'px';
        cap.style.left  = _resizeTargetLeft + 'px';
        cap.style.top   = _resizeTargetTop + _resizeTargetH + 'px';  // use target, not offsetHeight (avoids forced reflow)
      });
    }
    updateConnectionsForEl(resizeEl);
    updateCornerHandles();
  });
}
```

---

### `handleResizeMouse(e)` — updated

```
dx = (e.clientX - resizeStartX) / zoomLevel
dy = (e.clientY - resizeStartY) / zoomLevel
mins = _getMinSize(resizeEl)

rawW = (resizeCorner === 'se' || resizeCorner === 'ne') ? resizeStartW + dx : resizeStartW - dx
rawH = (resizeCorner === 'se' || resizeCorner === 'sw') ? resizeStartH + dy : resizeStartH - dy

if resizeRatio:
  scale = max(rawW / resizeStartW, rawH / resizeStartH)
  scale = max(scale, mins.w / resizeStartW)         // enforce min width
  fw = max(mins.w, round(resizeStartW * scale))
  fh = max(mins.h, round(fw / resizeRatio))
else:
  fw = max(mins.w, rawW)
  fh = max(mins.h, rawH)

newLeft = resizeStartLeft + (resizeCorner === 'sw' || resizeCorner === 'nw' ? resizeStartW - fw : 0)
newTop  = resizeStartTop  + (resizeCorner === 'ne' || resizeCorner === 'nw' ? resizeStartH - fh : 0)

// Snap: only for SE corner (unchanged); other corners call clearSnapGuides()
if ctrlSnap && resizeCorner === 'se':
  [existing snap logic, unchanged]
else:
  clearSnapGuides()

_resizeTargetW    = fw
_resizeTargetH    = fh
_resizeTargetLeft = newLeft
_resizeTargetTop  = newTop
_scheduleResizeFrame()
```

Remove the old direct style writes (`resizeEl.style.width = ...`, etc.) and the `updateSingleResizeHandle()` call at line 4311.

---

### Explicit hide calls inside `attachElementEvents` drag handlers

Five occurrences of `document.getElementById('single-resize-handle')` live inside the drag mousedown closure (not in `updateSingleResizeHandle`). Each must be replaced with a helper call or inline code that hides all 4 corner handles:

```js
// Replace each occurrence of:
const _srh = document.getElementById('single-resize-handle');
if (_srh) _srh.style.display = 'none';

// With:
['nw','ne','sw','se'].forEach(c => {
  const h = document.getElementById('resize-corner-' + c);
  if (h) h.style.display = 'none';
});
```

Affected locations (by line in current file):
- Line 3469 — drag mousedown (`_srhInit`)
- Line 3512 — `doDuplicate()` (`_srh`)
- Line 3577 — `dragRAF` (`_srh2`)
- Line 3644 — alt-release copy cancel (`_srh3`)
- Line 3788 — start of drag listeners block (`_srh`)

---

### Mouseup handler update (in `setupCanvasEvents`)

The existing mouseup already:
- Calls `Collab.syncElementSize(...)`
- Calls `pushAction({ type: 'resize', before: { w, h }, after: { w, h } })`

**Add:**
1. `Collab.syncElementPosition(resizeEl.dataset.id, finalLeft, finalTop, true)` — only needed for SW/NW/NE corners but safe to always call.
2. Cancel any pending RAF: `if (_resizeRafId) { cancelAnimationFrame(_resizeRafId); _resizeRafId = null; }`
3. Apply final values directly (bypassing RAF): set `resizeEl.style.width/height/left/top` from the final computed values.

**Update `pushAction` payload:**
```js
pushAction({
  type: 'resize',
  elId: resizeEl.dataset.id,
  before: { w: resizeStartW, h: resizeStartH, x: resizeStartLeft, y: resizeStartTop },
  after:  { w: afterW, h: afterH, x: parseFloat(resizeEl.style.left) || 0, y: parseFloat(resizeEl.style.top) || 0 },
});
```

---

### Undo/redo update

In both `_applyBackward` and `_applyForward`, extend the `'resize'` case:

```js
case 'resize': {
  const el = document.querySelector('[data-id="' + action.elId + '"]');
  if (!el) break;
  const d = action.before; // or action.after for forward
  if (d.w) el.style.width  = d.w + 'px';
  if (d.h) el.style.height = d.h + 'px';
  if (d.x != null) el.style.left = d.x + 'px';
  if (d.y != null) el.style.top  = d.y + 'px';
  updateConnectionsForEl(el);
  if (isCollab) {
    Collab.syncElementSize(action.elId, d.w, d.h, true);
    if (d.x != null) Collab.syncElementPosition(action.elId, d.x, d.y, true);
  }
  break;
}
```

---

## Change 2 — No selection outline during drag

**One CSS rule added to `index.html`:**

```css
.board-element.selected.is-dragging { outline: none; }
```

`is-dragging` is already added to `dragEl` on `mousedown` (both single and group drag) and removed on `mouseup`. This rule suppresses the outline for the duration of any drag and restores it automatically.

---

## Build order

1. Change 2 first (1-line CSS, zero risk, quick validation).
2. Change 1: HTML → CSS → remove old JS → add new JS globals → `updateCornerHandles` → `setupCornerHandles` → `_scheduleResizeFrame` → `handleResizeMouse` → mouseup → undo/redo.
