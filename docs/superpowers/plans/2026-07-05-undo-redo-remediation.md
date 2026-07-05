# Undo/Redo Full Remediation — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre toutes les actions utilisateur undoable/redoable en solo et collab sans cassures sur 40 niveaux de profondeur.

**Architecture:** Toutes les modifications sont dans `app.js` (IIFE unique). Le système dual existe déjà — on corrige les violations de la règle `pushAction → pushHistory` et on ajoute les 9 types d'action manquants dans `_applyReverse`/`_applyForward`.

**Tech Stack:** Vanilla JS, Chrome Extension MV3, IndexedDB, Firebase Realtime DB (collab).

## Global Constraints

- Zéro `console.log` dans `app.js`
- Ordre canonique : `pushAction(...)` TOUJOURS avant `pushHistory()`
- Ne jamais sortir de la structure IIFE `const App = (function(){...})()`
- Pas de refactoring non demandé au-delà du scope exact de chaque tâche
- Lire la section cible avant tout edit

---

### Task 1 : B1 — Reset `_actionHistory` au changement de board

**Files:**
- Modify: `app.js:1442`, `app.js:5282`, `app.js:5407`, `app.js:5458`

**Interfaces:**
- Produit: `_actionHistory` et `_actionIndex` toujours réinitialisés lors d'un changement de board

- [ ] **Step 1 : Lire et localiser les 4 sites**

  Lire `app.js` autour de chacune de ces lignes et confirmer la présence du bloc `history = []; historySelections = []; historyIndex = -1;`. Chaque site est dans une fonction de chargement de board différente.

- [ ] **Step 2 : Ajouter les deux lignes à chaque site**

  Pour chacun des 4 blocs (lignes ~1442, ~5282, ~5407, ~5458), ajouter IMMÉDIATEMENT APRÈS `historyIndex = -1;` :

  ```js
  _actionHistory = [];
  _actionIndex = -1;
  ```

  Exemple pour le premier site (ligne ~1442) — avant :
  ```js
  history = [];
  historySelections = [];
  historyIndex = -1;
  selectedEl = null;
  ```
  Après :
  ```js
  history = [];
  historySelections = [];
  historyIndex = -1;
  _actionHistory = [];
  _actionIndex = -1;
  selectedEl = null;
  ```

- [ ] **Step 3 : Vérifier manuellement**

  1. Ouvrir la page d'extension (`index.html` en mode dev)
  2. En mode collab : effectuer 3 actions sur board A → changer de board B → Ctrl+Z → aucune action du board A ne doit être annulée
  3. Expected: Ctrl+Z sur board B affiche "rien à annuler" ou annule uniquement une action faite sur B

- [ ] **Step 4 : Commit**

  ```bash
  git add app.js
  git commit -m "fix(undo): reset _actionHistory/_actionIndex on board switch (B1)"
  ```

---

### Task 2 : B3 — Corriger l'ordre pushHistory/pushAction

**Files:**
- Modify: `app.js:~4331` (drag move/dup), `app.js:~7105` (image replace)

**Interfaces:**
- Produit: ordre canonique `pushAction → pushHistory` respecté dans les 2 sites

- [ ] **Step 1 : Corriger le site drag (ligne ~4330)**

  Lire `app.js` lignes 4325–4360. Le bloc `if (moved || duplicated)` appelle `pushHistory()` AVANT les `pushAction(...)`. Inverser l'ordre :

  Avant :
  ```js
  if (moved || duplicated) {
    pushHistory();
    // Action-based undo: enregistrer le mouvement
    if (moved && !duplicated) {
      const finalX = parseFloat(dragEl.style.left) || 0;
      const finalY = parseFloat(dragEl.style.top) || 0;
      pushAction({
        type: 'move',
        elId: dragEl.dataset.id,
        before: { x: origLeft, y: origTop },
        after: { x: finalX, y: finalY },
      });
    } else if (duplicated) {
      const d = dragEl;
      pushAction({
  ```

  Après (déplacer `pushHistory()` à la fin du bloc, après tous les `pushAction`) :
  ```js
  if (moved || duplicated) {
    // Action-based undo: enregistrer le mouvement
    if (moved && !duplicated) {
      const finalX = parseFloat(dragEl.style.left) || 0;
      const finalY = parseFloat(dragEl.style.top) || 0;
      pushAction({
        type: 'move',
        elId: dragEl.dataset.id,
        before: { x: origLeft, y: origTop },
        after: { x: finalX, y: finalY },
      });
    } else if (duplicated) {
      const d = dragEl;
      pushAction({
  ```
  …puis trouver la fermeture du bloc `if (moved || duplicated)` et s'assurer que `pushHistory()` est le DERNIER appel du bloc.

  > Note : lire les lignes 4330–4380 pour voir la fin complète du bloc avant d'éditer.

- [ ] **Step 2 : Corriger le site image replace (ligne ~7105)**

  Lire `app.js` lignes 7095–7120. Dans `tmpImg.onload`, `pushHistory()` est à la ligne ~7105, AVANT `pushAction` à la ligne ~7106. De plus, le type est `'editText'` (incorrect — sera corrigé en Task 6). Pour l'instant, inverser uniquement l'ordre :

  Avant :
  ```js
  replaceTargetEl.dataset.ratio = ratio.toFixed(6);
  pushHistory();
  pushAction({
    type: 'editText',
  ```

  Après :
  ```js
  replaceTargetEl.dataset.ratio = ratio.toFixed(6);
  pushAction({
    type: 'editText',
  ```
  …et `pushHistory()` se déplace APRÈS le `pushAction({...})` complet (après la fermeture `}`).

- [ ] **Step 3 : Vérifier manuellement**

  En mode debug (ajouter un breakpoint temporaire dans `pushHistory` et `pushAction`) confirmer que dans les deux chemins, `pushAction` se déclenche avant `pushHistory`. Retirer le breakpoint après.

- [ ] **Step 4 : Commit**

  ```bash
  git add app.js
  git commit -m "fix(undo): invert pushHistory/pushAction call order (B3)"
  ```

---

### Task 3 : B4 — Ajouter `_resyncImgStore()` après undo/redo solo

**Files:**
- Modify: `app.js` — ajouter fonction après `reattachAllEvents` (~3337), appeler dans `undo()` (~3269) et `redo()` (~3310)

**Interfaces:**
- Consomme: `_imgStore` (Map globale), `#canvas .board-element[data-type="image"] img`
- Produit: `_imgStore` synchronisée avec le DOM après tout undo/redo solo

- [ ] **Step 1 : Ajouter `_resyncImgStore()` après `reattachAllEvents`**

  Lire `app.js` ligne 3337 (fin de `reattachAllEvents`). Insérer immédiatement après :

  ```js
  function _resyncImgStore() {
    document.querySelectorAll('#canvas .board-element[data-type="image"] img').forEach((img) => {
      if (img.src && img.src.startsWith('data:')) {
        const el = img.closest('.board-element');
        if (el && el.dataset.id) _imgStore.set(el.dataset.id, img.src);
      }
    });
  }
  ```

- [ ] **Step 2 : Appeler dans le chemin solo de `undo()`**

  Lire `app.js` lignes 3262–3287 (le chemin solo de `undo()`). Après `reattachAllEvents();` (ligne ~3269), ajouter :

  ```js
  _resyncImgStore();
  ```

- [ ] **Step 3 : Appeler dans le chemin solo de `redo()`**

  Lire `app.js` lignes 3304–3328 (le chemin solo de `redo()`). Après `reattachAllEvents();` (ligne ~3311), ajouter :

  ```js
  _resyncImgStore();
  ```

- [ ] **Step 4 : Vérifier manuellement**

  1. Créer une image sur le canvas
  2. Dupliquer l'image (la copie est dans `_imgStore` sous un nouvel ID)
  3. Ctrl+Z (undo) → la copie disparaît, l'original reste
  4. Dupliquer l'original à nouveau → la nouvelle copie affiche correctement l'image (sans afficher un carré cassé)

- [ ] **Step 5 : Commit**

  ```bash
  git add app.js
  git commit -m "fix(undo): resync _imgStore after solo undo/redo (B4)"
  ```

---

### Task 4 : B5 — Extraire `_handleNoteBlur()` partagé

**Files:**
- Modify: `app.js` — ajouter `_handleNoteBlur` après `reattachNoteEvents` (~3436), modifier le blur dans `reattachNoteEvents` (~3387), modifier le blur dans `createNoteElement` (~5829)

**Interfaces:**
- Consomme: `el` (board-element), `ta` (el-note-content div), `noteValueOnFocus` (string HTML capturé au focus)
- Produit: comportement identique dans les deux contextes, avec `pushAction` correct en collab

- [ ] **Step 1 : Lire les deux handlers blur actuels**

  Lire `app.js` lignes 3387–3435 (`reattachNoteEvents` — le handler correct).
  Lire `app.js` lignes 5829–5858 (`createNoteElement` — le handler sans `pushAction`).

- [ ] **Step 2 : Ajouter `_handleNoteBlur` après la fermeture de `reattachNoteEvents` (~3436)**

  ```js
  function _handleNoteBlur(e, el, ta, noteValueOnFocus) {
    const sbText = document.querySelector('.sb-text');
    const goingToPanel = sbText && e.relatedTarget && sbText.contains(e.relatedTarget);
    if (goingToPanel || window._textPanelKeepOpen) return;
    ta.contentEditable = 'false';
    delete el.dataset.editing;
    hideTextEditPanel();
    if (typeof Collab !== 'undefined' && Collab.isActive()) {
      Collab.syncElementData(el.dataset.id, ta.innerHTML, true);
      Collab.releaseLock(el.dataset.id);
    }
    if (!ta.innerText.trim()) {
      pushAction({
        type: 'delete',
        elId: el.dataset.id,
        before: {
          type: el.dataset.type,
          x: parseFloat(el.style.left) || 0,
          y: parseFloat(el.style.top) || 0,
          w: parseFloat(el.style.width) || null,
          h: parseFloat(el.style.height) || null,
          z: parseInt(el.style.zIndex) || 100,
          data: noteValueOnFocus,
        },
      });
      if (hoveredEl === el) {
        hoveredEl = null;
        updateCornerHandles();
      }
      removeConnectionsForEl(el);
      el.remove();
      if (selectedEl === el) selectedEl = null;
      multiSelected.delete(el);
      pushHistory();
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.syncElementDelete(el.dataset.id);
      }
    } else if (ta.innerHTML !== noteValueOnFocus) {
      pushAction({
        type: 'editText',
        elId: el.dataset.id,
        before: { data: noteValueOnFocus },
        after: { data: ta.innerHTML },
      });
      pushHistory();
    }
  }
  ```

- [ ] **Step 3 : Remplacer le blur dans `reattachNoteEvents` (~3387)**

  Lire les lignes 3387–3435. Remplacer tout le contenu du `ta.addEventListener('blur', ...)` par :

  ```js
  ta.addEventListener('blur', (e) => _handleNoteBlur(e, el, ta, _noteValueOnFocus));
  ```

  Supprimer l'ancien handler (lignes 3387–3435 incluses sauf la nouvelle ligne).

- [ ] **Step 4 : Remplacer le blur dans `createNoteElement` (~5829)**

  Lire les lignes 5829–5858. Remplacer tout le contenu du `ta.addEventListener('blur', ...)` par :

  ```js
  ta.addEventListener('blur', (e) => _handleNoteBlur(e, el, ta, _noteValueOnFocus));
  ```

  Supprimer l'ancien handler (lignes 5829–5858 incluses sauf la nouvelle ligne).

- [ ] **Step 5 : Vérifier manuellement**

  Mode collab :
  1. Créer une note → taper du texte → cliquer ailleurs → Ctrl+Z → le texte doit être effacé (retour à l'état vide de focus)
  2. Créer une note → ne rien taper → cliquer ailleurs → la note est supprimée → Ctrl+Z → la note réapparaît
  3. Répéter en mode solo (vérifier que le comportement est identique)

- [ ] **Step 6 : Commit**

  ```bash
  git add app.js
  git commit -m "fix(undo): extract _handleNoteBlur shared handler, fix collab note edit/delete tracking (B5)"
  ```

---

### Task 5 : B6 — Fix `_saveStyleChange` en mode collab

**Files:**
- Modify: `app.js` — ajouter `_styleEditBeforeHtml` (~7717), modifier `showTextEditPanel` (~7567), modifier `hideTextEditPanel` (~7587), modifier `_saveStyleChange` (~7718)

**Interfaces:**
- Consomme: `textEditTarget`, `_styleEditBeforeHtml` (module var)
- Produit: les changements de style de texte pushent un `editText` action en collab

- [ ] **Step 1 : Ajouter la variable module**

  Lire `app.js` ligne ~7717 (`let _saveStyleTimer = null;`). Juste avant, ajouter :

  ```js
  let _styleEditBeforeHtml = null;
  ```

- [ ] **Step 2 : Capturer dans `showTextEditPanel`**

  Lire `app.js` lignes 7567–7586 (`showTextEditPanel`). Ajouter EN DÉBUT de fonction (après `textEditTarget = el;`) :

  ```js
  const _styleTarget = el.querySelector('.el-note-content') || el;
  _styleEditBeforeHtml = _styleTarget ? _styleTarget.innerHTML : null;
  ```

- [ ] **Step 3 : Effacer dans `hideTextEditPanel`**

  Lire `app.js` lignes 7587–7591 (`hideTextEditPanel`). Ajouter EN DÉBUT :

  ```js
  _styleEditBeforeHtml = null;
  ```

- [ ] **Step 4 : Corriger `_saveStyleChange`**

  Lire `app.js` lignes 7718–7727. Remplacer toute la fonction par :

  ```js
  function _saveStyleChange() {
    const isCollab = typeof Collab !== 'undefined' && Collab.isActive();
    if (isCollab) {
      if (!textEditTarget || _styleEditBeforeHtml === null) return;
      const ta = textEditTarget.querySelector('.el-note-content') || textEditTarget;
      if (!ta) return;
      const afterHtml = ta.innerHTML;
      if (afterHtml !== _styleEditBeforeHtml) {
        pushAction({
          type: 'editText',
          elId: textEditTarget.dataset.id || textEditTarget.dataset.capId,
          before: { data: _styleEditBeforeHtml },
          after: { data: afterHtml },
        });
        _styleEditBeforeHtml = afterHtml;
        pushHistory();
      }
      saveCurrentBoard();
      return;
    }
    clearTimeout(_saveStyleTimer);
    _saveStyleTimer = setTimeout(() => {
      saveCurrentBoard();
      pushHistory();
    }, 300);
  }
  ```

- [ ] **Step 5 : Vérifier manuellement**

  Mode collab :
  1. Double-cliquer une note pour l'éditer
  2. Changer la taille du texte (bouton + ou -)
  3. Cliquer ailleurs pour fermer le panel
  4. Ctrl+Z → la taille doit revenir à la valeur précédente
  5. Ctrl+Y → la taille revient à la nouvelle valeur

- [ ] **Step 6 : Commit**

  ```bash
  git add app.js
  git commit -m "fix(undo): track style changes in collab via editText action (B6)"
  ```

---

### Task 6 : Ajouter type `editImage` + corriger B2 + O2

**Files:**
- Modify: `app.js` — ajouter case dans `_applyReverse` (~3106), ajouter case dans `_applyForward` (~3222), corriger image replace (~7095), corriger `_applyRestoredImageSrc` (~5621)

**Interfaces:**
- Produit: `editImage` undoable/redoable en solo et collab

- [ ] **Step 1 : Ajouter `editImage` dans `_applyReverse`**

  Lire `app.js` lignes 3087–3107 (fin du switch dans `_applyReverse`, avant la fermeture `}`). Ajouter avant la fermeture du switch :

  ```js
  case 'editImage': {
    const el = document.querySelector('[data-id="' + action.elId + '"]');
    if (!el) break;
    const s = action.before;
    _imgStore.set(action.elId, s.data);
    const img = el.querySelector('img');
    if (img) img.src = s.data;
    if (s.w) el.style.width = s.w + 'px';
    if (s.h) el.style.height = s.h + 'px';
    if (s.w && s.h) el.dataset.ratio = (s.w / s.h).toFixed(6);
    updateConnectionsForEl(el);
    if (isCollab) {
      Collab.syncElementData(action.elId, s.data);
      Collab.syncElementSize(action.elId, s.w, s.h, true);
    }
    break;
  }
  ```

- [ ] **Step 2 : Ajouter `editImage` dans `_applyForward`**

  Lire `app.js` lignes 3210–3222 (fin du switch dans `_applyForward`). Ajouter avant la fermeture :

  ```js
  case 'editImage': {
    const el = document.querySelector('[data-id="' + action.elId + '"]');
    if (!el) break;
    const s = action.after;
    _imgStore.set(action.elId, s.data);
    const img = el.querySelector('img');
    if (img) img.src = s.data;
    if (s.w) el.style.width = s.w + 'px';
    if (s.h) el.style.height = s.h + 'px';
    if (s.w && s.h) el.dataset.ratio = (s.w / s.h).toFixed(6);
    updateConnectionsForEl(el);
    if (isCollab) {
      Collab.syncElementData(action.elId, s.data);
      Collab.syncElementSize(action.elId, s.w, s.h, true);
    }
    break;
  }
  ```

- [ ] **Step 3 : Corriger B2 + B3 dans le remplacement d'image (~7085–7120)**

  Lire `app.js` lignes 7085–7122. Dans `reader.onload`, avant `const tmpImg = new Image();`, ajouter la capture de `oldW`/`oldH` :

  ```js
  var oldSrc = _imgStore.get(replaceTargetEl.dataset.id) || '';
  var oldW = parseFloat(replaceTargetEl.style.width) || null;
  var oldH = parseFloat(replaceTargetEl.style.height) || null;
  ```

  Dans `tmpImg.onload`, remplacer les lignes `pushHistory()` et `pushAction({type:'editText',...})` par :

  ```js
  pushAction({
    type: 'editImage',
    elId: replaceTargetEl.dataset.id,
    before: { data: oldSrc, w: oldW, h: oldH },
    after: { data: src, w: currentW, h: newH },
  });
  pushHistory();
  ```

  > Si `oldSrc`/`oldW`/`oldH` étaient déjà déclarés dans la portée de `reader.onload`, ajuster la position de la capture en conséquence. Vérifier que `oldSrc` n'est plus déclaré en doublon.

- [ ] **Step 4 : Corriger O2 dans `_applyRestoredImageSrc` (~5621)**

  Lire `app.js` lignes 5621–5642. Avant les lignes qui modifient le DOM, capturer l'état avant :

  ```js
  function _applyRestoredImageSrc(el, base64) {
    const id = el.dataset.id;
    const oldSrc = _imgStore.get(id) || '';
    const oldW = parseFloat(el.style.width) || null;
    const oldH = parseFloat(el.style.height) || null;
    // ... (code existant qui modifie _imgStore et DOM) ...
    // Remplacer `pushHistory()` à la ligne ~5639 par :
    pushAction({
      type: 'editImage',
      elId: id,
      before: { data: oldSrc, w: oldW, h: oldH },
      after: { data: base64, w: parseFloat(el.style.width) || null, h: parseFloat(el.style.height) || null },
    });
    pushHistory();
    // ... (suite : _updateBrokenBanner, toast) ...
  }
  ```

- [ ] **Step 5 : Vérifier manuellement**

  1. Créer une image → remplacer l'image (ctx menu "Remplacer") → Ctrl+Z → l'ancienne image revient
  2. Ctrl+Y → la nouvelle image revient
  3. Tester "Restaurer" sur une image cassée → Ctrl+Z → l'image redevient cassée
  4. Répéter en collab

- [ ] **Step 6 : Commit**

  ```bash
  git add app.js
  git commit -m "feat(undo): add editImage action type, fix B2+O2 image replace/restore"
  ```

---

### Task 7 : Ajouter type `groupResize` + corriger O1

**Files:**
- Modify: `app.js` — ajouter cases dans `_applyReverse`/`_applyForward`, modifier `setupMultiResizeHandle` (~3881)

**Interfaces:**
- Consomme: `beforeStates` (capturé au mousedown), `afterStates` (capturé au mouseup)
- Produit: group resize undoable/redoable en collab

- [ ] **Step 1 : Ajouter `groupResize` dans `_applyReverse`**

  Ajouter dans le switch de `_applyReverse` (avant la fermeture) :

  ```js
  case 'groupResize': {
    if (!Array.isArray(action.before)) break;
    action.before.forEach((s) => {
      const el = document.querySelector('[data-id="' + s.elId + '"]');
      if (!el) return;
      el.style.left = s.x + 'px';
      el.style.top = s.y + 'px';
      el.style.width = s.w + 'px';
      if (el.dataset.type !== 'note') el.style.height = s.h + 'px';
      updateConnectionsForEl(el);
      if (isCollab) {
        Collab.syncElementPosition(s.elId, s.x, s.y, true);
        Collab.syncElementSize(s.elId, s.w, s.h, true);
      }
    });
    break;
  }
  ```

- [ ] **Step 2 : Ajouter `groupResize` dans `_applyForward`**

  Même structure avec `action.after` :

  ```js
  case 'groupResize': {
    if (!Array.isArray(action.after)) break;
    action.after.forEach((s) => {
      const el = document.querySelector('[data-id="' + s.elId + '"]');
      if (!el) return;
      el.style.left = s.x + 'px';
      el.style.top = s.y + 'px';
      el.style.width = s.w + 'px';
      if (el.dataset.type !== 'note') el.style.height = s.h + 'px';
      updateConnectionsForEl(el);
      if (isCollab) {
        Collab.syncElementPosition(s.elId, s.x, s.y, true);
        Collab.syncElementSize(s.elId, s.w, s.h, true);
      }
    });
    break;
  }
  ```

- [ ] **Step 3 : Capturer `beforeStates` dans le mousedown de `setupMultiResizeHandle`**

  Lire `app.js` lignes 3881–3916. Après la construction de `initRects` (après le premier `group.forEach`), ajouter :

  ```js
  const beforeStates = group.map((el) => {
    const r = initRects.get(el);
    return { elId: el.dataset.id, x: r.left, y: r.top, w: r.w, h: r.h };
  });
  ```

- [ ] **Step 4 : Ajouter `pushAction` + corriger O1 dans `onUp` (~3958)**

  Lire `app.js` lignes 3958–3973. Dans `onUp`, avant le bloc collab sync existant, ajouter la capture `afterStates`, et déplacer `pushHistory()` à la fin (après `pushAction`) :

  ```js
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    const afterStates = group.map((el) => ({
      elId: el.dataset.id,
      x: parseFloat(el.style.left) || 0,
      y: parseFloat(el.style.top) || 0,
      w: parseFloat(el.style.width) || 0,
      h: parseFloat(el.style.height) || 0,
    }));
    if (typeof Collab !== 'undefined' && Collab.isActive()) {
      group.forEach((el) => {
        const x = parseFloat(el.style.left) || 0;
        const y = parseFloat(el.style.top) || 0;
        const w = parseFloat(el.style.width) || null;
        const h = parseFloat(el.style.height) || null;
        Collab.syncElementPosition(el.dataset.id, x, y, true);
        Collab.syncElementSize(el.dataset.id, w, h, true);
      });
    }
    pushAction({ type: 'groupResize', elId: group.map((e) => e.dataset.id), before: beforeStates, after: afterStates });
    pushHistory();
  };
  ```

- [ ] **Step 5 : Vérifier manuellement**

  1. Sélectionner 3 éléments (multiselect)
  2. Utiliser le handle de redimensionnement de groupe (coin bas-droit)
  3. Ctrl+Z → tous les éléments reviennent à leurs tailles/positions originales
  4. Ctrl+Y → le resize est réappliqué

- [ ] **Step 6 : Commit**

  ```bash
  git add app.js
  git commit -m "feat(undo): add groupResize action type, fix O1 multi-resize handle"
  ```

---

### Task 8 : Ajouter type `editFile` + corriger O5/O6

**Files:**
- Modify: `app.js` — ajouter cases dans `_applyReverse`/`_applyForward`, modifier le mode remplacement de `handleFileUpload` (~6553)

**Interfaces:**
- Consomme: `before`/`after` avec `{ savedata, isVideo, w, h }`
- Produit: file replace undoable/redoable

- [ ] **Step 1 : Ajouter `editFile` dans `_applyReverse`**

  ```js
  case 'editFile': {
    const el = document.querySelector('[data-id="' + action.elId + '"]');
    if (!el) break;
    const s = action.before;
    const d = (() => { try { return JSON.parse(s.savedata || '{}'); } catch (_) { return {}; } })();
    let newEl;
    const x = parseFloat(el.style.left) || 0;
    const y = parseFloat(el.style.top) || 0;
    if (d.isVideo) {
      newEl = createVideoFileElement(d.name, d.size, d.src || '', x, y);
    } else {
      newEl = createFileElement(d.name, d.size, d.icon, x, y);
      if (d.fileData) newEl.dataset.savedata = s.savedata;
    }
    newEl.dataset.id = action.elId;
    newEl.style.zIndex = el.style.zIndex;
    if (s.w) newEl.style.width = s.w + 'px';
    if (s.h) newEl.style.height = s.h + 'px';
    el.replaceWith(newEl);
    if (isCollab) Collab.syncElementData(action.elId, s.savedata);
    break;
  }
  ```

- [ ] **Step 2 : Ajouter `editFile` dans `_applyForward`**

  Même structure avec `action.after` :

  ```js
  case 'editFile': {
    const el = document.querySelector('[data-id="' + action.elId + '"]');
    if (!el) break;
    const s = action.after;
    const d = (() => { try { return JSON.parse(s.savedata || '{}'); } catch (_) { return {}; } })();
    let newEl;
    const x = parseFloat(el.style.left) || 0;
    const y = parseFloat(el.style.top) || 0;
    if (d.isVideo) {
      newEl = createVideoFileElement(d.name, d.size, d.src || '', x, y);
    } else {
      newEl = createFileElement(d.name, d.size, d.icon, x, y);
      if (d.fileData) newEl.dataset.savedata = s.savedata;
    }
    newEl.dataset.id = action.elId;
    newEl.style.zIndex = el.style.zIndex;
    if (s.w) newEl.style.width = s.w + 'px';
    if (s.h) newEl.style.height = s.h + 'px';
    el.replaceWith(newEl);
    if (isCollab) Collab.syncElementData(action.elId, s.savedata);
    break;
  }
  ```

- [ ] **Step 3 : Corriger O5 (video replace, ~6569)**

  Lire `app.js` lignes 6553–6586. Dans le bloc `if (VIDEO_EXTS.has(ext))` du mode remplacement. Avant `readFileAsBase64(file).then(...)`, capturer l'état avant :

  ```js
  const beforeSavedata = target.dataset.savedata || '';
  const beforeW = parseFloat(target.style.width) || null;
  const beforeH = parseFloat(target.style.height) || null;
  const elId = target.dataset.id;
  ```

  Dans le `.then((b64) => {...})`, après `selectEl(newEl)` et avant `if (Collab...)`, ajouter :

  ```js
  pushAction({
    type: 'editFile',
    elId: elId,
    before: { savedata: beforeSavedata, w: beforeW, h: beforeH },
    after: {
      savedata: newEl.dataset.savedata,
      w: parseFloat(newEl.style.width) || null,
      h: parseFloat(newEl.style.height) || null,
    },
  });
  ```

  Et s'assurer que `pushHistory()` reste à la fin du `.then()`.

- [ ] **Step 4 : Corriger O6 (non-video replace, ~6587)**

  Lire `app.js` lignes 6587–6614. Dans le bloc `else` (non-video replace). Avant `const icns = {...}`, capturer :

  ```js
  const beforeSavedata = target.dataset.savedata || '';
  const beforeW = parseFloat(target.style.width) || null;
  const beforeH = parseFloat(target.style.height) || null;
  const elId = target.dataset.id;
  ```

  Après `selectEl(newEl)` et avant le bloc collab, ajouter :

  ```js
  pushAction({
    type: 'editFile',
    elId: elId,
    before: { savedata: beforeSavedata, w: beforeW, h: beforeH },
    after: {
      savedata: newEl.dataset.savedata,
      w: parseFloat(newEl.style.width) || null,
      h: parseFloat(newEl.style.height) || null,
    },
  });
  ```

  `pushHistory()` reste à la fin.

- [ ] **Step 5 : Vérifier manuellement**

  1. Créer un fichier PDF → double-cliquer pour remplacer par un autre PDF → Ctrl+Z → le premier PDF revient
  2. Ctrl+Y → le second PDF revient
  3. Tester le remplacement vidéo → Ctrl+Z/Y

- [ ] **Step 6 : Commit**

  ```bash
  git add app.js
  git commit -m "feat(undo): add editFile action type, fix O5/O6 file replace tracking"
  ```

---

### Task 9 : Corriger les orphelins create (O3, O4, O7, O8, O14, O15)

**Files:**
- Modify: `app.js` — 6 sites dans `handleFileUpload`, `duplicateEl`, `ctxDuplicate`

**Interfaces:**
- Produit: toutes les duplications et créations de fichiers pushent `create` ou `groupCreate`

- [ ] **Step 1 : O7 — Duplicate toolbar single (~6967)**

  Lire `app.js` lignes 6951–6969. Dans le chemin single (`const newEl = restoreElement(s)`), ajouter avant `pushHistory()` :

  ```js
  pushAction({ type: 'create', elId: newEl.dataset.id, after: _captureElState(newEl) });
  ```

- [ ] **Step 2 : O8 — Duplicate toolbar multi (~6933–6948)**

  Lire `app.js` lignes 6931–6950. Remplacer le bloc `if (multiSelected.has(el) && multiSelected.size > 1)` par :

  ```js
  if (multiSelected.has(el) && multiSelected.size > 1) {
    const dupIds = [];
    const dupAfters = [];
    multiSelected.forEach((e) => {
      const s = {
        type: e.dataset.type,
        x: parseFloat(e.style.left) + 24,
        y: parseFloat(e.style.top) + 24,
        w: parseFloat(e.style.width) || null,
        h: parseFloat(e.style.height) || null,
        data:
          e.dataset.type === 'image'
            ? _imgStore.get(e.dataset.id) || ''
            : e.dataset.savedata || '',
      };
      var dup = restoreElement(s);
      if (dup) {
        dupIds.push(dup.dataset.id);
        dupAfters.push(_captureElState(dup));
        if (typeof Collab !== 'undefined' && Collab.isActive()) _collabSyncCreatedEl(dup);
      }
    });
    if (dupIds.length) {
      pushAction({ type: 'groupCreate', elId: dupIds, after: dupAfters });
      pushHistory();
    }
    return;
  }
  ```

  > Note: les images dans la sélection multiple retournent `null` de `restoreElement` (création async) — elles ne sont pas incluses dans l'action collab mais sont couvertes par le snapshot solo.

- [ ] **Step 3 : O14 — ctx duplicate single (~7788–7793)**

  Lire `app.js` lignes 7776–7795 (le `else` branch de `ctxDuplicate`). Ajouter avant `pushHistory()` :

  ```js
  pushAction({ type: 'create', elId: el.dataset.id, after: _captureElState(el) });
  ```

- [ ] **Step 4 : O15 — ctx duplicate multi (~7752–7775)**

  Lire `app.js` lignes 7752–7775 (le `if (multiSelected.has(ctxTargetEl)...)` branch). Remplacer par :

  ```js
  if (multiSelected.has(ctxTargetEl) && multiSelected.size > 1) {
    const copies = [];
    multiSelected.forEach((el) => {
      const s = {
        type: el.dataset.type,
        x: parseFloat(el.style.left) + 24,
        y: parseFloat(el.style.top) + 24,
        w: parseFloat(el.style.width) || null,
        h: parseFloat(el.style.height) || null,
        data:
          el.dataset.type === 'image'
            ? _imgStore.get(el.dataset.id) || ''
            : el.dataset.savedata || '',
      };
      const newEl = restoreElement(s);
      if (newEl) {
        if (typeof Collab !== 'undefined' && Collab.isActive()) _collabSyncCreatedEl(newEl);
        copies.push(newEl);
      }
    });
    if (copies.length) {
      pushAction({
        type: 'groupCreate',
        elId: copies.map((e) => e.dataset.id),
        after: copies.map((e) => _captureElState(e)),
      });
      pushHistory();
    }
  }
  ```

- [ ] **Step 5 : O3 — Video file create (~6637–6641)**

  Lire `app.js` lignes 6637–6641. Dans le `.then((b64) => {...})` du mode création vidéo :

  ```js
  readFileAsBase64(file).then((b64) => {
    const el = createVideoFileElement(file.name, size, b64, baseX, baseY);
    if (el) {
      pushAction({ type: 'create', elId: el.dataset.id, after: _captureElState(el) });
    }
    pushHistory();
  });
  ```

- [ ] **Step 6 : O4 — Non-video file create (~6658–6676)**

  Lire `app.js` lignes 6655–6677. Pour le chemin non-vidéo en mode création, déplacer le `pushAction` + `pushHistory()` à l'intérieur du `.then()` (après que `savedata` est connu) :

  ```js
  (function (targetEl, fileName, fileSize, fileIcon) {
    readFileAsBase64(file).then(function (b64) {
      targetEl.dataset.savedata = JSON.stringify({
        name: fileName,
        size: fileSize,
        icon: fileIcon,
        fileData: b64,
      });
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        _collabSyncCreatedEl(targetEl);
      }
      pushAction({ type: 'create', elId: targetEl.dataset.id, after: _captureElState(targetEl) });
      pushHistory();
    });
  })(fileEl, file.name, size, icon);
  ```

  Supprimer le `pushHistory()` à la ligne 6676 (qui était en dehors du forEach, il est maintenant remplacé par les pushes individuels dans chaque `.then()`).

- [ ] **Step 7 : Vérifier manuellement**

  1. Dupliquer un élément (toolbar) → Ctrl+Z → l'élément dupliqué disparaît → Ctrl+Y → réapparaît
  2. Sélectionner 3 éléments → dupliquer (toolbar) → Ctrl+Z → les 3 copies disparaissent en une seule fois
  3. Uploader un fichier PDF → Ctrl+Z → le fichier disparaît
  4. Uploader une vidéo → Ctrl+Z → la vidéo disparaît

- [ ] **Step 8 : Commit**

  ```bash
  git add app.js
  git commit -m "feat(undo): add pushAction for all create/duplicate operations (O3,O4,O7,O8,O14,O15)"
  ```

---

### Task 10 : Modifier `createConnection()` + ajouter `connection`/`disconnection` + corriger O9/O10/O11

**Files:**
- Modify: `app.js` — `createConnection` (~7197), `_applyReverse`/`_applyForward`, `ctxConnect` (~7146), connector tool mouseup (~7315), `ctxDisconnect` (~7169)

**Interfaces:**
- Produit: `createConnection` retourne le svg créé et accepte un `connId` optionnel pour garantir la cohérence collab au redo

- [ ] **Step 1 : Modifier `createConnection` pour accepter `connId` et retourner le SVG**

  Lire `app.js` lignes 7197–7211. Remplacer la signature et la ligne `connId` par :

  ```js
  function createConnection(fromId, toId, connId) {
    const canvas = document.getElementById('canvas');
    const fromEl = canvas.querySelector(`[data-id="${fromId}"]`);
    const toEl = canvas.querySelector(`[data-id="${toId}"]`);
    if (!fromEl || !toEl) return null;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('el-connection');
    svg.dataset.from = fromId;
    svg.dataset.to = toId;
    svg.dataset.connId = connId || 'conn_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    svg.appendChild(line);
    canvas.insertBefore(svg, canvas.firstChild);
    updateConnection(svg, fromEl, toEl);
    return svg;
  }
  ```

- [ ] **Step 2 : Ajouter `connection` dans `_applyReverse`** (undo = supprimer)

  ```js
  case 'connection': {
    if (!Array.isArray(action.connections)) break;
    action.connections.forEach(({ connId }) => {
      const svg = document.querySelector('.el-connection[data-conn-id="' + connId + '"]');
      if (svg) svg.remove();
      if (isCollab) Collab.syncConnectionDelete(connId);
    });
    break;
  }
  ```

- [ ] **Step 3 : Ajouter `connection` dans `_applyForward`** (redo = recréer)

  ```js
  case 'connection': {
    if (!Array.isArray(action.connections)) break;
    action.connections.forEach(({ fromId, toId, connId }) => {
      const exists = document.querySelector('.el-connection[data-conn-id="' + connId + '"]');
      if (!exists) createConnection(fromId, toId, connId);
      if (isCollab) Collab.syncConnection(connId, fromId, toId);
    });
    break;
  }
  ```

- [ ] **Step 4 : Ajouter `disconnection` dans `_applyReverse`** (undo = recréer)

  ```js
  case 'disconnection': {
    if (!Array.isArray(action.connections)) break;
    action.connections.forEach(({ fromId, toId, connId }) => {
      const exists = document.querySelector('.el-connection[data-conn-id="' + connId + '"]');
      if (!exists) createConnection(fromId, toId, connId);
      if (isCollab) Collab.syncConnection(connId, fromId, toId);
    });
    break;
  }
  ```

- [ ] **Step 5 : Ajouter `disconnection` dans `_applyForward`** (redo = supprimer)

  ```js
  case 'disconnection': {
    if (!Array.isArray(action.connections)) break;
    action.connections.forEach(({ connId }) => {
      const svg = document.querySelector('.el-connection[data-conn-id="' + connId + '"]');
      if (svg) svg.remove();
      if (isCollab) Collab.syncConnectionDelete(connId);
    });
    break;
  }
  ```

- [ ] **Step 6 : Corriger O9 — `ctxConnect` (~7146)**

  Lire `app.js` lignes 7146–7167. Remplacer :

  ```js
  function ctxConnect() {
    hideContextMenu();
    const allSel = new Set(multiSelected);
    if (selectedEl) allSel.add(selectedEl);
    const ids = [...allSel].map((el) => el.dataset.id).filter(Boolean);
    if (ids.length < 2) return;
    const connections = [];
    for (let i = 0; i < ids.length - 1; i++) {
      const svg = createConnection(ids[i], ids[i + 1]);
      if (svg) {
        connections.push({ fromId: ids[i], toId: ids[i + 1], connId: svg.dataset.connId });
        if (typeof Collab !== 'undefined' && Collab.isActive()) {
          Collab.syncConnection(svg.dataset.connId, ids[i], ids[i + 1]);
        }
      }
    }
    if (connections.length) {
      pushAction({ type: 'connection', connections });
      pushHistory();
    }
  }
  ```

- [ ] **Step 7 : Corriger O10 — connector tool mouseup (~7315–7347)**

  Lire `app.js` lignes 7315–7348. Dans le `window.addEventListener('mouseup', ...)` du connector tool, remplacer le bloc après `if (exists) return;` :

  ```js
  const svg = createConnection(fromId, toId);
  if (svg) {
    const connId = svg.dataset.connId;
    if (typeof Collab !== 'undefined' && Collab.isActive()) {
      Collab.syncConnection(connId, fromId, toId);
    }
    pushAction({ type: 'connection', connections: [{ fromId, toId, connId }] });
    pushHistory();
  }
  ```

- [ ] **Step 8 : Corriger O11 — `ctxDisconnect` (~7169)**

  Lire `app.js` lignes 7169–7195. Remplacer par :

  ```js
  function ctxDisconnect() {
    hideContextMenu();
    var allSelIds = new Set();
    if (ctxTargetEl) allSelIds.add(ctxTargetEl.dataset.id);
    multiSelected.forEach(function (el) { allSelIds.add(el.dataset.id); });
    if (selectedEl) allSelIds.add(selectedEl.dataset.id);
    var multi = allSelIds.size >= 2;
    var toRemove = [];
    document.querySelectorAll('.el-connection').forEach(function (svg) {
      var fromIn = allSelIds.has(svg.dataset.from);
      var toIn = allSelIds.has(svg.dataset.to);
      if (multi ? fromIn && toIn : fromIn || toIn) {
        toRemove.push(svg);
      }
    });
    if (!toRemove.length) return;
    const connections = toRemove.map((svg) => ({
      fromId: svg.dataset.from,
      toId: svg.dataset.to,
      connId: svg.dataset.connId,
    }));
    toRemove.forEach(function (svg) {
      if (typeof Collab !== 'undefined' && Collab.isActive() && svg.dataset.connId) {
        Collab.syncConnectionDelete(svg.dataset.connId);
      }
      svg.remove();
    });
    pushAction({ type: 'disconnection', connections });
    pushHistory();
  }
  ```

- [ ] **Step 9 : Vérifier manuellement**

  1. Sélectionner 2 éléments → "Connecter" → Ctrl+Z → la ligne disparaît → Ctrl+Y → réapparaît
  2. Sélectionner un élément connecté → "Déconnecter" → Ctrl+Z → la connexion revient
  3. Outil connecteur (cliquer-glisser) → Ctrl+Z → connexion supprimée

- [ ] **Step 10 : Commit**

  ```bash
  git add app.js
  git commit -m "feat(undo): add connection/disconnection action types, fix O9/O10/O11"
  ```

---

### Task 11 : Ajouter helper `_createCaptionEl()` + types caption + corriger O12/O13/M2

**Files:**
- Modify: `app.js` — ajouter `_createCaptionEl` et `_capValueOnFocus` (~7350), modifier `ctxAddCaption` (~7351), modifier `handleCaptionBlur` (~7593), modifier `restoreElement` caption branch (~5047), ajouter cases dans `_applyReverse`/`_applyForward`

**Interfaces:**
- Consomme: `_capValueOnFocus` (module var), `cap.dataset.capId`, `cap.dataset.isNew`
- Produit: création, suppression et édition de captions undoable/redoable

- [ ] **Step 1 : Ajouter `_capValueOnFocus` et `_createCaptionEl`**

  Lire `app.js` lignes 7350–7360 (zone avant `ctxAddCaption`). Ajouter juste avant `function ctxAddCaption()` :

  ```js
  let _capValueOnFocus = '';

  function _createCaptionEl(capId, parentId, x, y, width, text) {
    const cap = document.createElement('div');
    cap.classList.add('el-caption');
    cap.contentEditable = 'true';
    cap.dataset.placeholder = 'Ajouter un commentaire…';
    cap.dataset.parentId = parentId || '';
    cap.dataset.type = 'caption';
    cap.dataset.capId = capId;
    cap.style.left = x + 'px';
    cap.style.top = y + 'px';
    if (width) cap.style.width = width;
    cap.textContent = text || '';
    cap.addEventListener('focus', () => { _capValueOnFocus = cap.textContent; showTextEditPanel(cap); });
    cap.addEventListener('blur', (e) => handleCaptionBlur(e, cap));
    document.getElementById('canvas').appendChild(cap);
    return cap;
  }
  ```

- [ ] **Step 2 : Ajouter `captionCreate`, `captionDelete`, `captionEdit` dans `_applyReverse`**

  ```js
  case 'captionCreate': {
    const cap = document.querySelector('[data-cap-id="' + action.capId + '"]');
    if (cap) cap.remove();
    if (isCollab && action.capId) Collab.syncCaptionDelete(action.capId);
    break;
  }
  case 'captionDelete': {
    const s = action.before;
    const cap = _createCaptionEl(action.capId, s.parentId, s.x, s.y, s.width, s.text);
    if (isCollab) Collab.syncCaption(action.capId, s.parentId, s.x, s.y, s.width, s.text);
    break;
  }
  case 'captionEdit': {
    const cap = document.querySelector('[data-cap-id="' + action.capId + '"]');
    if (!cap) break;
    cap.textContent = action.before.text;
    if (isCollab) Collab.syncCaption(action.capId, cap.dataset.parentId, parseFloat(cap.style.left) || 0, parseFloat(cap.style.top) || 0, cap.style.width || '', action.before.text);
    break;
  }
  ```

- [ ] **Step 3 : Ajouter `captionCreate`, `captionDelete`, `captionEdit` dans `_applyForward`**

  ```js
  case 'captionCreate': {
    const s = action.after;
    const exists = document.querySelector('[data-cap-id="' + action.capId + '"]');
    if (!exists) _createCaptionEl(action.capId, s.parentId, s.x, s.y, s.width, s.text);
    if (isCollab) Collab.syncCaption(action.capId, s.parentId, s.x, s.y, s.width, s.text);
    break;
  }
  case 'captionDelete': {
    const cap = document.querySelector('[data-cap-id="' + action.capId + '"]');
    if (cap) cap.remove();
    if (isCollab && action.capId) Collab.syncCaptionDelete(action.capId);
    break;
  }
  case 'captionEdit': {
    const cap = document.querySelector('[data-cap-id="' + action.capId + '"]');
    if (!cap) break;
    cap.textContent = action.after.text;
    if (isCollab) Collab.syncCaption(action.capId, cap.dataset.parentId, parseFloat(cap.style.left) || 0, parseFloat(cap.style.top) || 0, cap.style.width || '', action.after.text);
    break;
  }
  ```

- [ ] **Step 4 : Corriger O12 — réécrire `ctxAddCaption`**

  Lire `app.js` lignes 7351–7388. Remplacer par :

  ```js
  function ctxAddCaption() {
    hideContextMenu();
    if (!ctxTargetEl) return;
    const el = ctxTargetEl;
    const l = parseFloat(el.style.left) || 0;
    const t = parseFloat(el.style.top) || 0;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const capId = 'cap_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const cap = _createCaptionEl(
      capId,
      el.dataset.id || '',
      l,
      t + h,
      w + 'px',
      ''
    );
    cap.dataset.isNew = '1';
    cap.focus();
  }
  ```

  > Note: `pushHistory()` et `pushAction` sont maintenant dans `handleCaptionBlur` — la caption vide n'est pas trackée.

- [ ] **Step 5 : Corriger O13 + M2 — réécrire `handleCaptionBlur`**

  Lire `app.js` lignes 7593–7628. Remplacer par :

  ```js
  function handleCaptionBlur(e, cap) {
    const sbText = document.querySelector('.sb-text');
    const goingToPanel = sbText && e.relatedTarget && sbText.contains(e.relatedTarget);
    if (goingToPanel || window._textPanelKeepOpen) return;

    hideTextEditPanel();

    const capId = cap.dataset.capId;
    const parentId = cap.dataset.parentId || '';
    const x = parseFloat(cap.style.left) || 0;
    const y = parseFloat(cap.style.top) || 0;
    const width = cap.style.width || '';
    const currentText = cap.textContent.trim();

    if (!currentText) {
      if (cap.dataset.isNew) {
        // Caption créée mais jamais remplie → supprimer silencieusement
        cap.remove();
        return;
      }
      // Caption existante vidée → captionDelete
      pushAction({
        type: 'captionDelete',
        capId,
        before: { parentId, x, y, width, text: _capValueOnFocus },
      });
      if (typeof Collab !== 'undefined' && Collab.isActive() && capId) {
        Collab.syncCaptionDelete(capId);
      }
      cap.remove();
      pushHistory();
    } else if (cap.dataset.isNew) {
      // Nouvelle caption avec texte → captionCreate
      delete cap.dataset.isNew;
      pushAction({
        type: 'captionCreate',
        capId,
        after: { parentId, x, y, width, text: currentText },
      });
      if (typeof Collab !== 'undefined' && Collab.isActive() && capId) {
        Collab.syncCaption(capId, parentId, x, y, width, currentText);
      }
      pushHistory();
    } else if (currentText !== _capValueOnFocus) {
      // Edition texte existant → captionEdit
      pushAction({
        type: 'captionEdit',
        capId,
        before: { text: _capValueOnFocus },
        after: { text: currentText },
      });
      if (typeof Collab !== 'undefined' && Collab.isActive() && capId) {
        Collab.syncCaption(capId, parentId, x, y, width, currentText);
      }
      pushHistory();
    }
  }
  ```

- [ ] **Step 6 : Mettre à jour le branch `caption` dans `restoreElement` (~5047)**

  Lire `app.js` lignes 5033–5051. Remplacer le listener focus actuel dans le branch caption :

  ```js
  cap.addEventListener('focus', () => showTextEditPanel(cap));
  ```

  Par :

  ```js
  cap.addEventListener('focus', () => { _capValueOnFocus = cap.textContent; showTextEditPanel(cap); });
  ```

  Et s'assurer que `cap.dataset.capId` est bien présent (c'est le cas via `if (s.capId) cap.dataset.capId = s.capId;` — vérifier si c'est déjà là, sinon ajouter).

- [ ] **Step 7 : Vérifier manuellement**

  1. Ajouter une caption via ctx menu → taper "hello" → cliquer ailleurs → Ctrl+Z → caption disparaît → Ctrl+Y → caption "hello" revient
  2. Ajouter une caption → ne rien taper → cliquer ailleurs → aucune entrée dans l'historique (caption juste supprimée silencieusement)
  3. Caption existante → double-clic → modifier le texte → Ctrl+Z → texte précédent restauré
  4. Caption existante → tout effacer → cliquer ailleurs → Ctrl+Z → caption restaurée avec son texte original

- [ ] **Step 8 : Commit**

  ```bash
  git add app.js
  git commit -m "feat(undo): add captionCreate/Delete/Edit types, fix O12/O13/M2 caption tracking"
  ```

---

### Task 12 : Ajouter type `zIndex` + corriger M1

**Files:**
- Modify: `app.js` — ajouter cases dans `_applyReverse`/`_applyForward`, réécrire `ctxBringFront` (~7729) et `ctxSendBack` (~7738)

**Interfaces:**
- Produit: bring-to-front et send-to-back undoables/redoables

- [ ] **Step 1 : Ajouter `zIndex` dans `_applyReverse`**

  ```js
  case 'zIndex': {
    const el = document.querySelector('[data-id="' + action.elId + '"]');
    if (!el) break;
    el.style.zIndex = action.before.z;
    if (isCollab) Collab.syncElementZ(action.elId, action.before.z);
    break;
  }
  ```

- [ ] **Step 2 : Ajouter `zIndex` dans `_applyForward`**

  ```js
  case 'zIndex': {
    const el = document.querySelector('[data-id="' + action.elId + '"]');
    if (!el) break;
    el.style.zIndex = action.after.z;
    if (isCollab) Collab.syncElementZ(action.elId, action.after.z);
    break;
  }
  ```

- [ ] **Step 3 : Corriger M1 — `ctxBringFront` (~7729)**

  Lire `app.js` lignes 7729–7737. Remplacer par :

  ```js
  function ctxBringFront() {
    if (ctxTargetEl) {
      const oldZ = parseInt(ctxTargetEl.style.zIndex) || 100;
      ctxTargetEl.style.zIndex = ++nextZ;
      pushAction({
        type: 'zIndex',
        elId: ctxTargetEl.dataset.id,
        before: { z: oldZ },
        after: { z: nextZ },
      });
      pushHistory();
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.syncElementZ(ctxTargetEl.dataset.id, nextZ);
      }
    }
    hideContextMenu();
  }
  ```

- [ ] **Step 4 : Corriger M1 — `ctxSendBack` (~7738)**

  Lire `app.js` lignes 7738–7746. Remplacer par :

  ```js
  function ctxSendBack() {
    if (ctxTargetEl) {
      const oldZ = parseInt(ctxTargetEl.style.zIndex) || 100;
      ctxTargetEl.style.zIndex = 1;
      pushAction({
        type: 'zIndex',
        elId: ctxTargetEl.dataset.id,
        before: { z: oldZ },
        after: { z: 1 },
      });
      pushHistory();
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.syncElementZ(ctxTargetEl.dataset.id, 1);
      }
    }
    hideContextMenu();
  }
  ```

- [ ] **Step 5 : Vérifier manuellement**

  1. Créer 3 éléments superposés → "Mettre au premier plan" → Ctrl+Z → l'élément revient à son z-index précédent
  2. "Mettre au fond" → Ctrl+Z → le z-index revient à sa valeur précédente
  3. Ctrl+Y pour les deux actions

- [ ] **Step 6 : Commit**

  ```bash
  git add app.js
  git commit -m "feat(undo): add zIndex action type, fix M1 bring-front/send-back not tracked"
  ```

---

### Task 13 : Mettre à jour `NO_CONFLICT_CHECK` dans `undo()`

**Files:**
- Modify: `app.js:~3233` (conditional dans `undo()`)

**Interfaces:**
- Produit: tous les nouveaux types exemptés du check de conflit collab, `'generic'` retiré (type jamais utilisé)

- [ ] **Step 1 : Lire le conditionnel actuel**

  Lire `app.js` lignes 3230–3255. Le bloc ressemble à :

  ```js
  if (
    action.type !== 'create' &&
    action.type !== 'delete' &&
    action.type !== 'groupCreate' &&
    action.type !== 'generic'
  ) {
  ```

- [ ] **Step 2 : Remplacer par un Set**

  Juste avant le `while (_actionIndex >= 0...)`, ajouter la déclaration du Set (ou la placer au niveau module s'il sera réutilisé) :

  Remplacer le bloc conditionnel `if (action.type !== ...)` par :

  ```js
  const NO_CONFLICT_CHECK = new Set([
    'create', 'delete', 'groupCreate', 'groupResize',
    'connection', 'disconnection',
    'captionCreate', 'captionDelete', 'captionEdit',
    'editImage', 'editFile', 'zIndex',
  ]);
  ```

  Et remplacer le `if (action.type !== 'create' && ...)` par :

  ```js
  if (!NO_CONFLICT_CHECK.has(action.type)) {
  ```

  Le reste du bloc (lock check + version check) reste identique.

  > `'generic'` est retiré de la liste : c'est un type dead-code jamais utilisé.

- [ ] **Step 3 : Vérifier**

  En mode collab avec deux users : user A fait une `move` sur un élément → user B modifie cet élément → user A Ctrl+Z → la vérification de conflit doit bloquer l'undo de A (toast "Impossible d'annuler").

  Pour les types du Set (ex: `captionCreate`) → undo passe sans conflict check, même si l'élément est modifié par un autre.

- [ ] **Step 4 : Commit**

  ```bash
  git add app.js
  git commit -m "fix(undo): update NO_CONFLICT_CHECK with all new action types, remove dead 'generic'"
  ```

---

## Test de régression final

Après l'implémentation de toutes les tâches, effectuer la séquence de tests suivante :

### Solo — chaîne 40 actions

Effectuer dans l'ordre (en mode solo) :
1. Créer note → taper texte
2. Créer couleur
3. Créer image → remplacer l'image
4. Créer fichier PDF
5. Dupliquer la note (toolbar)
6. Sélectionner note + couleur → group resize
7. Connecter note et image
8. Ajouter caption sur l'image → taper texte
9. Mettre l'image au premier plan
10. Modifier style texte de la note (taille +2)
11. Répéter des variations jusqu'à 40 actions

Puis faire 40× Ctrl+Z et vérifier que le canvas revient à l'état vide initial (ou l'état du dernier snapshot conservé).

### Collab — undo sans interférence

En mode collab avec deux onglets :
1. User A : créer note + taper texte → Ctrl+Z → vérifier que la note disparaît
2. User B : créer couleur pendant que User A annule → les actions de B ne doivent pas être affectées
3. User A : Ctrl+Y → la note revient

### Images post-undo

1. Créer image A
2. Dupliquer → image B
3. Ctrl+Z (undo de la duplication) → B disparaît
4. Dupliquer A à nouveau → nouvelle image C doit afficher correctement l'image (pas le carré cassé)
