# Spec : Audit & remédiation complète du système undo/redo

**Date :** 2026-07-05  
**Scope :** Solo + Collab, app.js uniquement  
**Objectif :** Toutes les actions utilisateur doivent être undoable/redoable — 40 niveaux de profondeur — sans cassure sur des chaînes d'actions complexes.

---

## Contexte

L'application utilise un **système dual** :

- **Mode solo** : snapshots `innerHTML` dans `history[]` (max 50). Undo = restauration complète du canvas.
- **Mode collab** : actions structurées dans `_actionHistory[]` (max 100). Undo = `_applyReverse(action)`, Redo = `_applyForward(action)`.

La règle architecturale CLAUDE.md est : **jamais de `pushHistory()` sans `pushAction()` préalable**. Les violations de cette règle rendent les actions non-undoables en collab.

---

## Bugs confirmés

### B1 — `_actionHistory` non réinitialisé au changement de board

**Symptôme :** En collab, après avoir changé de board, Ctrl+Z peut tenter d'annuler des actions du board précédent dont les éléments n'existent plus dans le DOM.

**Cause :** Les 4 sites de board-switch réinitialisent `history = []; historyIndex = -1` mais omettent `_actionHistory` et `_actionIndex`.

**Lignes concernées :** ~1442, ~5282, ~5407, ~5458

**Fix :** Ajouter `_actionHistory = []; _actionIndex = -1;` aux 4 mêmes blocs de reset.

---

### B2 — `editText` utilisé pour les remplacements d'image

**Symptôme :** En collab, Ctrl+Z après avoir remplacé ou restauré une image ne modifie pas visuellement l'image (le DOM et `_imgStore` restent sur la nouvelle version).

**Cause :** Le remplacement d'image (ligne ~7106) utilise `pushAction({ type: 'editText', ... })`. `_applyReverse('editText')` restaure `dataset.savedata` et met à jour `.el-note-content`, mais ne touche ni `_imgStore` ni `<img>.src`.

**Fix :** Créer le type `editImage` (voir Section E).

---

### B3 — `pushHistory()` avant `pushAction()` (violations d'ordre)

**Symptôme :** Violation architecturale mineure, peut causer des désynchronisations d'index dans des scénarios d'erreur.

**Cause :** Lignes ~4331→4336 (move/duplicate) et ~7105→7106 (image replace) : `pushHistory()` est appelé avant `pushAction()`.

**Fix :** Inverser l'ordre — toujours `pushAction()` en premier, `pushHistory()` ensuite.

---

### B4 — `_imgStore` non resynchronisé après undo/redo solo

**Symptôme :** Après un undo solo d'une opération impliquant des images, `_imgStore` contient des données de la session courante. Les duplications ou `_captureElState()` post-undo lisent le mauvais src.

**Cause :** Le chemin solo de `undo()`/`redo()` restaure `canvas.innerHTML` mais ne re-synchronise pas `_imgStore` avec le contenu DOM restauré.

**Fix :** Ajouter une fonction `_resyncImgStore()` appelée après `reattachAllEvents()` dans les deux chemins solo.

```
_resyncImgStore() :
  Pour chaque .board-element[data-type="image"] img dans #canvas :
    si img.src commence par "data:" :
      _imgStore.set(el.dataset.id, img.src)
```

---

### B5 — Note blur handler dans `createNoteElement` sans `pushAction`

**Symptôme :** En collab, les éditions de texte sur notes ne sont jamais undoables. Ce n'est pas limité aux "notes fraîches" : en collab, `reattachAllEvents()` n'est jamais appelé, donc TOUTES les notes dans TOUTE la session utilisent le handler de `createNoteElement`.

**Cause :** Il existe deux handlers de blur pour les notes :
- `createNoteElement` (lignes ~5829–5856) : `pushHistory()` uniquement, pas de `pushAction()`.
- `reattachNoteEvents` (lignes ~3400–3433) : `pushAction()` correct + `pushHistory()`.

**Fix :** Extraire la logique de blur dans une fonction interne `_handleNoteBlur(el, ta, noteValueOnFocus)` partagée entre les deux sites. Cette fonction gère :
- Si texte vide → `pushAction({ type: 'delete', ... })` + suppression + `pushHistory()`
- Si texte changé → `pushAction({ type: 'editText', ... })` + `pushHistory()`

---

### B6 — `_saveStyleChange` retour anticipé en collab

**Symptôme :** En collab, les changements de style de texte (police, taille, alignement) ne sont ni trackés ni undoables. La fonction retourne immédiatement sans `pushHistory()` ni `pushAction()`.

**Cause :** Ligne ~7721 : `if (Collab.isActive()) return;`

**Fix :**
- Supprimer l'early return collab.
- Ajouter une variable module `_styleEditBeforeHtml = null`.
- Capturer `_styleEditBeforeHtml = ta.innerHTML` dans `showTextEditPanel(el)` (quand le panel ouvre).
- Dans `_saveStyleChange()` : si collab actif et html changé → `pushAction({ type: 'editText', elId, before: { data: _styleEditBeforeHtml }, after: { data: ta.innerHTML } })`.
- `pushHistory()` est maintenant appelé dans les deux modes.
- `_styleEditBeforeHtml = null` dans `hideTextEditPanel()`.

> Réutilise le type `editText` existant — pas de nouveau type nécessaire pour les styles.

---

## Orphelins (pushHistory sans pushAction)

Ces 15 opérations sont undoables en solo (snapshot innerHTML) mais **invisibles au système collab** faute de `pushAction`.

| ID | Opération | Ligne(s) | Type à utiliser |
|----|-----------|----------|-----------------|
| O1 | Group resize (multi-resize handle) | ~3972 | `groupResize` (nouveau) |
| O2 | Image restore depuis état cassé | ~5639 | `editImage` (nouveau) |
| O3 | Fichier créé — vidéo | ~6640 | `create` (existant) |
| O4 | Fichier créé — non-vidéo | ~6676 | `create` (existant) |
| O5 | Fichier remplacé — vidéo | ~6585 | `editFile` (nouveau) |
| O6 | Fichier remplacé — non-vidéo | ~6612 | `editFile` (nouveau) |
| O7 | Duplicate toolbar — single | ~6967 | `create` (existant) |
| O8 | Duplicate toolbar — multi | ~6948 | `groupCreate` (existant) |
| O9 | Connexion créée (ctxConnect) | ~7166 | `connection` (nouveau) |
| O10 | Connexion créée (boucle per-pair) | ~7346 | `connection` (nouveau) |
| O11 | Connexion supprimée (ctxDisconnect) | ~7194 | `disconnection` (nouveau) |
| O12 | Caption ajoutée (ctxAddCaption) | ~7387 | `captionCreate` (nouveau) |
| O13 | Caption supprimée (blur vide) | ~7626 | `captionDelete` (nouveau) |
| O14 | Duplicate ctx menu — single | ~7792 | `create` (existant) |
| O15 | Duplicate ctx menu — multi | ~7774 | `groupCreate` (existant) |

---

## Manques complets (aucune trace dans l'historique)

| ID | Opération | Description |
|----|-----------|-------------|
| M1 | Bring to front / Send to back | `ctxBringFront` / `ctxSendBack` : ni `pushAction` ni `pushHistory` |
| M2 | Édition texte caption existante | `handleCaptionBlur` ne pousse rien pour les changements non-vide → non-vide |

---

## Nouveaux types d'action

### `editImage`

```
before: { data: srcAvant, w: largAvant, h: hautAvant }
after:  { data: srcApres, w: largApres, h: hautApres }
elId:   id de l'élément image
```

`_applyReverse` / `_applyForward(state)` :
1. `_imgStore.set(elId, state.data)`
2. `el.querySelector('img').src = state.data`
3. `el.style.width = state.w + 'px'`, `el.style.height = state.h + 'px'`
4. Recalcule `el.dataset.ratio`
5. `updateConnectionsForEl(el)`
6. `Collab.syncElementData(elId, state.data)` + `Collab.syncElementSize(...)` si collab

Sites : image replace (~7095–7116), image restore (~5639)

---

### `groupResize`

```
before: [{ elId, x, y, w, h }, ...]   // capturé au mousedown depuis initRects
after:  [{ elId, x, y, w, h }, ...]   // capturé au mouseup
```

`_applyReverse` / `_applyForward(arr)` : pour chaque entrée du tableau :
1. `el.style.left/top/width/height`
2. `updateConnectionsForEl(el)`
3. `Collab.syncElementPosition` + `Collab.syncElementSize` si collab

Site : `setupMultiResizeHandle` `onUp` (~3972)

---

### `editFile`

```
before: { html: innerHTMLAvant, savedata: savedataAvant, w, h }
after:  { html: innerHTMLApres, savedata: savedataApres, w, h }
elId:   id de l'élément file
```

`_applyReverse` / `_applyForward(state)` :
1. Conserver la toolbar : `const toolbar = el.querySelector('.element-toolbar')`
2. `el.innerHTML = state.html`
3. Ré-insérer la toolbar
4. `el.dataset.savedata = state.savedata`
5. `el.style.width/height` si présents
6. `reattachFileEvents(el)`
7. `Collab.syncElementData(elId, state.savedata)` si collab

Sites : file replace vidéo (~6585), file replace non-vidéo (~6612)

---

### `connection`

```
connections: [{ fromId, toId, connId }, ...]
```

`_applyReverse` : supprimer chaque SVG dont `dataset.connId` correspond + `Collab.syncConnectionDelete(connId)` si collab

`_applyForward` : `createConnection(fromId, toId, connId)` pour chaque entrée + `Collab.syncConnection(connId, fromId, toId)` si collab

> `createConnection` est modifiée pour accepter un troisième paramètre `connId` optionnel. Si fourni, il remplace le connId auto-généré. Cela garantit que redo recrée exactement la même connexion (même connId, nécessaire pour la cohérence collab).

Sites : `ctxConnect` (~7166), boucle per-pair (~7346)

---

### `disconnection`

```
connections: [{ fromId, toId, connId }, ...]  // capturé avant suppression
```

`_applyReverse` : `createConnection(fromId, toId)` pour chaque entrée + collab sync

`_applyForward` : supprimer chaque SVG par connId + `Collab.syncConnectionDelete` si collab

Site : `ctxDisconnect` (~7194) — capturer `toRemove` AVANT de les supprimer

---

### `captionCreate`

```
capId: string
after: { parentId, x, y, width, text }
```

`_applyReverse` : `document.querySelector('[data-cap-id="capId"]').remove()` + `Collab.syncCaptionDelete(capId)` si collab

`_applyForward` : recréer la caption depuis `after` avec le capId fixé + `Collab.syncCaption(...)` si collab

Site : `ctxAddCaption` (~7387)

---

### `captionDelete`

```
capId: string
before: { parentId, x, y, width, text }
```

`_applyReverse` : recréer la caption depuis `before` + collab sync

`_applyForward` : supprimer la caption par capId + collab sync

Site : `handleCaptionBlur` quand texte vide (~7626)

---

### `captionEdit`

```
capId: string
before: { text: texteAvant }
after:  { text: texteApres }
```

`_applyReverse` : `cap.textContent = before.text` + `Collab.syncCaption(capId, ...)` si collab

`_applyForward` : `cap.textContent = after.text` + collab sync

Site : `handleCaptionBlur` quand texte changé (non-vide → non-vide). Capturer `_capValueOnFocus` au `focus` de la caption.

---

### `zIndex`

```
elId:   id de l'élément
before: { z: ancienZ }
after:  { z: nouveauZ }
```

`_applyReverse` : `el.style.zIndex = before.z` + `Collab.syncElementZ(elId, before.z)` si collab

`_applyForward` : `el.style.zIndex = after.z` + `Collab.syncElementZ(elId, after.z)` si collab

Sites : `ctxBringFront` et `ctxSendBack` — ajouter aussi `pushHistory()` (actuellement absent)

---

## Conflit collab : liste de skip mise à jour

Dans `undo()`, le bloc de vérification de conflit exclut actuellement `create`, `delete`, `groupCreate`, `generic`. Il faut ajouter tous les nouveaux types qui ne correspondent pas à un `elId` d'élément de board :

```js
const NO_CONFLICT_CHECK = new Set([
  'create', 'delete', 'groupCreate', 'groupResize',
  'connection', 'disconnection',
  'captionCreate', 'captionDelete', 'captionEdit',
  'editImage', 'editFile', 'zIndex'
]);
```

La référence à `'generic'` dans cette liste est supprimée (type jamais utilisé).  
`'editText'` reste soumis au conflit check existant — y compris pour les styles (B6 réutilise `editText`, pas un nouveau type `editStyle`).

---

## Règle d'ordre canonique

**Dans tout le code, l'ordre est désormais :**
```js
pushAction({ type, elId, before, after });   // 1. enregistrer l'action
pushHistory();                                // 2. snapshot solo
```

Toute violation de cet ordre est un bug.

---

## Couverture après fix

### Actions solo (toutes undoable via innerHTML restore)
✅ Note créée / éditée / supprimée  
✅ Color créée / couleur changée  
✅ Image créée / remplacée / restaurée  
✅ Link créé  
✅ File créé / remplacé  
✅ Élément déplacé (single + groupe)  
✅ Élément redimensionné (single + groupe)  
✅ Élément dupliqué (single + multi, toolbar + ctx menu + alt+drag)  
✅ Élément supprimé (single + multi)  
✅ Connexion créée / supprimée  
✅ Caption créée / éditée / supprimée  
✅ Style texte modifié  
✅ Z-index modifié  
✅ Suppression bibliothèque  

### Actions collab (toutes undoable via `_applyReverse`)
Idem, avec les 9 nouveaux types + fixes B1–B6.

### Limites d'historique
- Solo : 50 snapshots (inchangé)
- Collab : 100 actions structurées (inchangé)
- Profondeur pratique : 40+ actions complexes chaînées sans cassure

---

## Tests à effectuer après implémentation

Pour chaque action de la liste de couverture :

1. **Solo — undo simple** : effectuer l'action → Ctrl+Z → état restauré correct ?
2. **Solo — redo** : Ctrl+Z puis Ctrl+Y → état re-appliqué ?
3. **Solo — chaîne 40 actions** : 40 actions variées → 40× Ctrl+Z → retour à l'état initial ?
4. **Solo — undo après switch board** : changer de board, effectuer des actions, Ctrl+Z → les actions du board précédent n'interfèrent pas ?
5. **Collab — undo simple** : même que 1 en mode collab
6. **Collab — redo** : même que 2 en mode collab
7. **Collab — undo ne casse pas les autres** : undo de ma propre action ne touche pas les éléments créés par un autre user
8. **Images post-undo** : dupliquer une image → undo → dupliquer à nouveau → l'image du duplicat est correcte (test `_imgStore` resync)
