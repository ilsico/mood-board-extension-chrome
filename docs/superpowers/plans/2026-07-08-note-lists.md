# Note Lists — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bullet-list and todo-list modes to `el-note` elements, toggled via two new buttons in the text panel.

**Architecture:** HTML-native approach — `<ul>/<li>` elements live inside the `div[contenteditable]` (`.el-note-content`). Storage in `dataset.savedata` (already HTML) is transparent. Keyboard and checkbox behavior is handled by delegated event listeners added in `createNoteElement` and `reattachNoteEvents`.

**Tech Stack:** Vanilla JS, HTML/CSS — no new dependencies.

## Global Constraints

- Zero `console.log` in `app.js`
- No restructuring of the IIFE — all code stays inside `App = (function(){...})()`
- All new functions are `function` declarations (hoisted), placed in the `──NOTE──` section of `app.js` near line 6425
- Collab sync: call `Collab.syncElementData(id, innerHTML)` whenever `dataset.savedata` changes, if `Collab.isActive()`
- Undo: call `pushAction({ type: 'editText', elId, before: { data, style }, after: { data, style }, detail })` then `pushHistory()` for any user-facing content change
- No `pushHistory` without prior `pushAction`

---

## File Map

| File | Changes |
|------|---------|
| `index.html` | CSS: extend shared button rules + new list CSS; HTML: add `div.list-type-btns` after `.text-align-btns` |
| `app.js` | New helpers: `_detectListState`, `_updateListBtns`, `_makeListItem`, `_getBlocksInRange`, `_mergeAdjacentLists`, `_unwrapListItem`, `_exitListAfterLi`, `applyListToggle`, `_handleNoteListKeydown`, `_attachNoteCheckboxListener`; wire into `setupUIEvents`, `showTextEditPanel`, `hideTextEditPanel`, `createNoteElement`, `reattachNoteEvents` |

---

## Task 1 — CSS + HTML buttons

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces: `#list-bullet-btn`, `#list-todo-btn` buttons visible in the text panel; CSS classes `.list-type-btn`, `.list-type-btns`, `.todo-item`, `.todo-done`, `.todo-check`

- [ ] **Step 1 — Extend shared button CSS rules to include `.list-type-btn`**

Find the three shared rules (around line 1545) and add `.list-type-btn`:

```css
/* ~line 1545 — shared base */
.text-font-btn,
.text-size-btn,
.text-align-btn,
.list-type-btn {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--fg);
}
```

```css
/* ~line 1583 — shared hover */
.text-font-btn:hover,
.text-size-btn:hover,
.text-align-btn:hover,
.list-type-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}
```

```css
/* ~line 1588 — shared active */
.text-font-btn.active,
.text-align-btn.active,
.list-type-btn.active {
  background: #3d3d3d;
  border: 1px solid white;
  color: white;
}
```

And the two light-mode overrides (around line 114 and line 126):

```css
/* ~line 114 */
body.light-mode .text-font-btn.active,
body.light-mode .text-align-btn.active,
body.light-mode .list-type-btn.active {
  background: var(--bg-input);
  border-color: #222222;
  color: #222222;
}
```

```css
/* ~line 126 */
body.light-mode .text-font-btn:hover,
body.light-mode .text-size-btn:hover,
body.light-mode .text-align-btn:hover,
body.light-mode .list-type-btn:hover {
  background: rgba(0, 0, 0, 0.1);
}
```

- [ ] **Step 2 — Add `.list-type-btn` size + `.list-type-btns` wrapper CSS**

After the `.text-align-btn` rule block (around line 1582):

```css
.list-type-btn {
  width: 32px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 4px;
  transition: background 0.12s;
}
.list-type-btns {
  display: flex;
  gap: 6px;
  padding: 0 2px;
}
```

- [ ] **Step 3 — Add list rendering CSS for notes**

Add in the note CSS section (after `.el-note-content` rules, around line 2100):

```css
.el-note-content ul {
  padding-left: 18px;
  margin: 2px 0;
}
.el-note-content ul li {
  margin: 1px 0;
}
.el-note-content ul.todo-list {
  list-style: none;
  padding-left: 4px;
}
.el-note-content .todo-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.el-note-content .todo-item.todo-done span {
  opacity: 0.4;
}
.el-note-content .todo-check {
  pointer-events: auto;
  margin-top: 3px;
  flex-shrink: 0;
  cursor: pointer;
}
```

- [ ] **Step 4 — Add HTML buttons after `.text-align-btns` (line 3839)**

Insert between the closing `</div>` of `.text-align-btns` and the closing `</div>` of `.sb-section.sb-text`:

```html
          <div class="list-type-btns">
            <button class="list-type-btn" id="list-bullet-btn" title="Liste à puces">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/>
                <path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>
              </svg>
            </button>
            <button class="list-type-btn" id="list-todo-btn" title="Todo liste">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/>
                <path d="m3 17 2 2 4-4"/>
                <rect x="3" y="4" width="6" height="6" rx="1"/>
              </svg>
            </button>
          </div>
```

- [ ] **Step 5 — Load extension and verify**

In `chrome://extensions`, reload the extension, open a board, double-click a note. Verify:
- Two new icons appear to the right of the align buttons in the text panel
- They appear greyed (disabled) when no note is selected
- They appear clickable (no JS errors yet) when a note is in edit mode

- [ ] **Step 6 — Commit**

```bash
git add index.html
git commit -m "feat: add list-type-btn HTML and CSS to note text panel"
```

---

## Task 2 — List state detection + toolbar wiring

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `textEditTarget` (module-scope var, set by `showTextEditPanel`), `#list-bullet-btn`, `#list-todo-btn`
- Produces: `_detectListState(ta)` → `'bullet' | 'todo' | null`; `_updateListBtns()` (no return); `applyListToggle(type)` stub

- [ ] **Step 1 — Add `_detectListState` and `_updateListBtns` near `applyTextAlign` (~line 8697)**

```javascript
function _detectListState(ta) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let node = sel.getRangeAt(0).startContainer;
  while (node && node !== ta) {
    if (node.nodeName === 'LI') {
      const ul = node.parentElement;
      if (ul && ul.nodeName === 'UL') {
        return ul.classList.contains('todo-list') ? 'todo' : 'bullet';
      }
    }
    node = node.parentElement;
  }
  return null;
}

function _updateListBtns() {
  const bulletBtn = document.getElementById('list-bullet-btn');
  const todoBtn = document.getElementById('list-todo-btn');
  if (!bulletBtn || !todoBtn) return;
  bulletBtn.classList.remove('active');
  todoBtn.classList.remove('active');
  if (!textEditTarget) return;
  const ta = textEditTarget.querySelector('.el-note-content');
  if (!ta) return;
  const state = _detectListState(ta);
  if (state === 'bullet') bulletBtn.classList.add('active');
  else if (state === 'todo') todoBtn.classList.add('active');
}
```

- [ ] **Step 2 — Add `applyListToggle` stub (replaced in Task 3)**

Directly after `_updateListBtns`:

```javascript
function applyListToggle(type) {
  // Full implementation in Task 3
  if (!textEditTarget) return;
}
```

- [ ] **Step 3 — Wire click handlers + selectionchange in `setupUIEvents` after line 920**

After `addEvt('ta-right', 'click', () => applyTextAlign('right'));`:

```javascript
addEvt('list-bullet-btn', 'click', () => applyListToggle('bullet'));
addEvt('list-todo-btn', 'click', () => applyListToggle('todo'));
document.addEventListener('selectionchange', () => {
  if (textEditTarget) _updateListBtns();
});
```

- [ ] **Step 4 — Call `_updateListBtns()` at end of `showTextEditPanel`**

In `showTextEditPanel` (~line 8277), add at the very end before the closing `}`:

```javascript
_updateListBtns();
```

- [ ] **Step 5 — Clear list button active state in `hideTextEditPanel`**

In `hideTextEditPanel` (~line 8305), after the existing `classList.add('sb-disabled')` calls:

```javascript
document.querySelectorAll('.list-type-btn').forEach((b) => b.classList.remove('active'));
```

- [ ] **Step 6 — Verify**

Reload extension. Open a note, double-click to edit. Move cursor around — no JS errors in console. Buttons don't crash when clicked (stub returns early).

- [ ] **Step 7 — Commit**

```bash
git add app.js
git commit -m "feat: list state detection and toolbar wiring (stub)"
```

---

## Task 3 — `applyListToggle` + helpers

**Files:**
- Modify: `app.js` — replace stub `applyListToggle`, add helpers in the `──NOTE──` section (~line 6425)

**Interfaces:**
- Consumes: `_makeListItem(type, content)`, `_getBlocksInRange(ta, range)`, `_unwrapListItem(li, type)`, `_mergeAdjacentLists(ta)`, `_updateListBtns()`, `pushAction`, `pushHistory`, `Collab`
- Produces: `applyListToggle(type)` — fully functional; `_makeListItem(type, content)` → `HTMLLIElement` (also used by Task 4)

- [ ] **Step 1 — Add `_makeListItem` in the NOTE section (~line 6425)**

```javascript
function _makeListItem(type, content) {
  const li = document.createElement('li');
  if (type === 'todo') {
    li.className = 'todo-item';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'todo-check';
    check.setAttribute('contenteditable', 'false');
    const span = document.createElement('span');
    span.innerHTML = content || '';
    li.appendChild(check);
    li.appendChild(span);
  } else {
    li.innerHTML = content || '';
  }
  return li;
}
```

- [ ] **Step 2 — Add `_getBlocksInRange`**

```javascript
function _getBlocksInRange(ta, range) {
  const blocks = [];
  ta.childNodes.forEach((child) => {
    if (child.nodeName === 'UL') {
      child.querySelectorAll('li').forEach((li) => {
        if (range.intersectsNode(li)) blocks.push(li);
      });
    } else if (range.intersectsNode(child)) {
      blocks.push(child);
    }
  });
  return blocks;
}
```

- [ ] **Step 3 — Add `_mergeAdjacentLists`**

```javascript
function _mergeAdjacentLists(ta) {
  let changed = true;
  while (changed) {
    changed = false;
    const uls = Array.from(ta.querySelectorAll(':scope > ul'));
    for (let i = 0; i < uls.length - 1; i++) {
      const a = uls[i];
      const b = uls[i + 1];
      if (a.nextElementSibling === b) {
        const sameType =
          a.classList.contains('todo-list') === b.classList.contains('todo-list');
        if (sameType) {
          while (b.firstChild) a.appendChild(b.firstChild);
          b.remove();
          changed = true;
          break;
        }
      }
    }
  }
}
```

- [ ] **Step 4 — Add `_unwrapListItem`**

```javascript
function _unwrapListItem(li, type) {
  const ul = li.parentElement;
  if (!ul) return;
  let inner;
  if (type === 'todo') {
    const span = li.querySelector('span');
    inner = span ? span.innerHTML : '';
  } else {
    inner = li.innerHTML;
  }
  const itemsAfter = [];
  let next = li.nextElementSibling;
  while (next) {
    itemsAfter.push(next);
    next = next.nextElementSibling;
  }
  const div = document.createElement('div');
  div.innerHTML = inner || '<br>';
  li.remove();
  ul.parentNode.insertBefore(div, ul.nextSibling);
  if (itemsAfter.length > 0) {
    const newUl = document.createElement('ul');
    if (type === 'todo') newUl.className = 'todo-list';
    itemsAfter.forEach((item) => {
      item.remove();
      newUl.appendChild(item);
    });
    div.parentNode.insertBefore(newUl, div.nextSibling);
  }
  if (!ul.querySelector('li')) ul.remove();
}
```

- [ ] **Step 5 — Replace `applyListToggle` stub with full implementation**

Replace the stub added in Task 2 with:

```javascript
function applyListToggle(type) {
  if (!textEditTarget) return;
  const el = textEditTarget;
  const ta = el.querySelector('.el-note-content');
  if (!ta) return;

  ta.focus();

  const beforeHtml = ta.innerHTML;
  const beforeStyle = ta.style.cssText;

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);

  const blocks = _getBlocksInRange(ta, range);
  if (blocks.length === 0) return;

  const allSameType = blocks.every((node) => {
    if (node.nodeName !== 'LI') return false;
    const ul = node.parentElement;
    return (
      ul &&
      ul.nodeName === 'UL' &&
      (type === 'todo'
        ? ul.classList.contains('todo-list')
        : !ul.classList.contains('todo-list'))
    );
  });

  if (allSameType) {
    blocks.forEach((node) => {
      if (node.nodeName === 'LI') _unwrapListItem(node, type);
    });
  } else {
    blocks.forEach((node) => {
      if (node.nodeName === 'LI') {
        const ul = node.parentElement;
        if (!ul) return;
        const currentType = ul.classList.contains('todo-list') ? 'todo' : 'bullet';
        if (currentType === type) return;
        if (type === 'todo') {
          // bullet → todo
          const text = node.innerHTML;
          node.innerHTML = '';
          node.className = 'todo-item';
          const check = document.createElement('input');
          check.type = 'checkbox';
          check.className = 'todo-check';
          check.setAttribute('contenteditable', 'false');
          const span = document.createElement('span');
          span.innerHTML = text;
          node.appendChild(check);
          node.appendChild(span);
          ul.classList.add('todo-list');
        } else {
          // todo → bullet
          const span = node.querySelector('span');
          node.innerHTML = span ? span.innerHTML : node.innerHTML;
          node.classList.remove('todo-item', 'todo-done');
          if (!ul.querySelector('li.todo-item')) ul.classList.remove('todo-list');
        }
      } else {
        // Plain block (div, text node, br)
        let content = '';
        if (node.nodeType === Node.TEXT_NODE) {
          content = node.textContent;
        } else if (node.nodeName === 'DIV') {
          content = node.innerHTML;
        }
        const li = _makeListItem(type, content);
        const ul = document.createElement('ul');
        if (type === 'todo') ul.className = 'todo-list';
        ul.appendChild(li);
        if (node.nodeType === Node.TEXT_NODE) {
          node.parentNode.insertBefore(ul, node);
          node.remove();
        } else {
          node.parentNode.replaceChild(ul, node);
        }
      }
    });
    _mergeAdjacentLists(ta);
  }

  el.dataset.savedata = ta.innerHTML;

  if (typeof Collab !== 'undefined' && Collab.isActive()) {
    Collab.syncElementData(el.dataset.id, ta.innerHTML);
  }

  const afterHtml = ta.innerHTML;
  if (afterHtml !== beforeHtml) {
    pushAction({
      type: 'editText',
      elId: el.dataset.id,
      before: { data: beforeHtml, style: beforeStyle },
      after: { data: afterHtml, style: ta.style.cssText },
      detail: type === 'bullet' ? 'Liste à puces' : 'Todo liste',
    });
    pushHistory();
  }

  _updateListBtns();
}
```

- [ ] **Step 6 — Test**

Reload extension. In a note:
1. Type three lines, select all, click bullet button → all lines become bullets
2. Select one bullet, click bullet button again → that line reverts to plain text
3. Select all bullets, click todo button → bullets convert to todos with checkboxes
4. Ctrl+Z → undo restores previous state
5. Verify button highlights match cursor position

- [ ] **Step 7 — Commit**

```bash
git add app.js
git commit -m "feat: applyListToggle with selection-based conversion and toggle off"
```

---

## Task 4 — Keyboard behavior in lists

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `_makeListItem(type, content)` (from Task 3)
- Produces: `_exitListAfterLi(li, ta, type)`, `_handleNoteListKeydown(e, ta, el)`

- [ ] **Step 1 — Add `_exitListAfterLi` in the NOTE section**

```javascript
function _exitListAfterLi(li, ta, type) {
  const ul = li.parentElement;
  const itemsAfter = [];
  let next = li.nextElementSibling;
  while (next) {
    itemsAfter.push(next);
    next = next.nextElementSibling;
  }
  const newDiv = document.createElement('div');
  const textNode = document.createTextNode('');
  newDiv.appendChild(textNode);
  li.remove();
  ul.parentNode.insertBefore(newDiv, ul.nextSibling);
  if (itemsAfter.length > 0) {
    const newUl = document.createElement('ul');
    if (type === 'todo') newUl.className = 'todo-list';
    itemsAfter.forEach((item) => {
      item.remove();
      newUl.appendChild(item);
    });
    newDiv.parentNode.insertBefore(newUl, newDiv.nextSibling);
  }
  if (!ul.querySelector('li')) ul.remove();
  const sel = window.getSelection();
  const r = document.createRange();
  r.setStart(textNode, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}
```

- [ ] **Step 2 — Add `_handleNoteListKeydown`**

```javascript
function _handleNoteListKeydown(e, ta, el) {
  if (e.key !== 'Enter' && e.key !== 'Backspace') return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  let node = sel.getRangeAt(0).startContainer;
  let li = null;
  while (node && node !== ta) {
    if (node.nodeName === 'LI') { li = node; break; }
    node = node.parentElement;
  }
  if (!li) return;
  const ul = li.parentElement;
  const type = ul.classList.contains('todo-list') ? 'todo' : 'bullet';
  const getText = () =>
    type === 'todo'
      ? (li.querySelector('span') ? li.querySelector('span').textContent : li.textContent)
      : li.textContent;

  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    if (!getText().trim()) {
      _exitListAfterLi(li, ta, type);
    } else {
      const newLi = _makeListItem(type, '');
      li.parentNode.insertBefore(newLi, li.nextSibling);
      const target = type === 'todo' ? newLi.querySelector('span') : newLi;
      if (target) {
        const textNode = document.createTextNode('');
        target.appendChild(textNode);
        const r = document.createRange();
        r.setStart(textNode, 0);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }
    el.dataset.savedata = ta.innerHTML;
    if (typeof Collab !== 'undefined' && Collab.isActive()) {
      Collab.syncElementData(el.dataset.id, ta.innerHTML);
    }
  } else if (e.key === 'Backspace') {
    if (getText().trim()) return;
    e.preventDefault();
    e.stopPropagation();
    _exitListAfterLi(li, ta, type);
    el.dataset.savedata = ta.innerHTML;
    if (typeof Collab !== 'undefined' && Collab.isActive()) {
      Collab.syncElementData(el.dataset.id, ta.innerHTML);
    }
  }
}
```

- [ ] **Step 3 — Wire into `createNoteElement` (before `wrap.appendChild(ta)` ~line 6503)**

```javascript
ta.addEventListener('keydown', (e) => _handleNoteListKeydown(e, ta, el));
```

- [ ] **Step 4 — Wire into `reattachNoteEvents` (after the `blur` listener ~line 3989)**

```javascript
ta.addEventListener('keydown', (e) => _handleNoteListKeydown(e, ta, el));
```

- [ ] **Step 5 — Test**

In a note with bullets:
1. Press Enter on a non-empty bullet → new bullet appears, cursor inside
2. Press Enter on the new (empty) bullet → exits list, cursor in plain div below
3. Press Backspace on an empty bullet → same as double-Enter
4. Check that Backspace on non-empty bullet still deletes characters normally

- [ ] **Step 6 — Commit**

```bash
git add app.js
git commit -m "feat: Enter/Backspace keyboard behavior in note lists"
```

---

## Task 5 — Checkbox interactivity outside edit mode

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `pushAction`, `pushHistory`, `Collab`
- Produces: `_attachNoteCheckboxListener(wrap, ta, el)`

- [ ] **Step 1 — Add `_attachNoteCheckboxListener` in the NOTE section**

```javascript
function _attachNoteCheckboxListener(wrap, ta, el) {
  let _checkBeforeHtml = null;

  wrap.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.todo-check')) return;
    e.stopPropagation();
    _checkBeforeHtml = ta.innerHTML;
  });

  wrap.addEventListener('change', (e) => {
    const check = e.target.closest('.todo-check');
    if (!check) return;
    const li = check.closest('li');
    if (li) li.classList.toggle('todo-done', check.checked);
    el.dataset.savedata = ta.innerHTML;
    if (typeof Collab !== 'undefined' && Collab.isActive()) {
      Collab.syncElementData(el.dataset.id, ta.innerHTML);
    }
    if (_checkBeforeHtml !== null && _checkBeforeHtml !== ta.innerHTML) {
      pushAction({
        type: 'editText',
        elId: el.dataset.id,
        before: { data: _checkBeforeHtml, style: ta.style.cssText },
        after: { data: ta.innerHTML, style: ta.style.cssText },
        detail: check.checked ? 'Todo coché' : 'Todo décoché',
      });
      pushHistory();
    }
    _checkBeforeHtml = null;
  });
}
```

- [ ] **Step 2 — Wire into `createNoteElement` (before `wrap.appendChild(ta)` ~line 6503, after the keydown listener)**

```javascript
_attachNoteCheckboxListener(wrap, ta, el);
```

- [ ] **Step 3 — Wire into `reattachNoteEvents` (after the keydown listener added in Task 4)**

```javascript
_attachNoteCheckboxListener(wrap, ta, el);
```

- [ ] **Step 4 — Test**

In a note with todo items:
1. **Outside edit mode** (note not double-clicked): click a checkbox → it toggles, text greys out, Ctrl+Z undoes the check
2. **Inside edit mode** (note double-clicked): click a checkbox → it toggles and text greys out (browser default + our change handler)
3. Reload the board → checked state is preserved
4. In collab mode (if testable): check syncs to other clients

- [ ] **Step 5 — Commit**

```bash
git add app.js
git commit -m "feat: checkbox interactivity with undo and collab sync in todo lists"
```
