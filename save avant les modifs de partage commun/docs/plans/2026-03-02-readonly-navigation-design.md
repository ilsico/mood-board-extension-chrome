# Design : Navigation libre en mode lecture seule

**Date :** 2026-03-02
**Fichiers concernés :** `app.js`, `index.html`

---

## Contexte

Quand un visiteur ouvre un lien partagé (`?board=ID`), l'application passe en `readonly-mode` (classe sur `<body>`). Ce mode bloque correctement les modifications, mais empêche aussi la navigation sur le canvas. L'objectif est de permettre la navigation complète tout en maintenant un verrouillage strict des éléments.

---

## Ce qui fonctionne déjà en readonly-mode

- Zoom Alt/Ctrl+molette ✓
- Pan 2 doigts trackpad ✓
- Pan clic molette (button 1) ✓
- Pan espace+glisser ✓
- `#fit-screen-btn` et `#preview-btn` ✓ (ni masqués par CSS, ni bloqués par JS)

---

## Problèmes identifiés

| # | Problème | Localisation dans app.js |
|---|---|---|
| 1 | Clic-glisser fond canvas → sélection rectangle au lieu de pan | ~L1222 |
| 2 | Menu contextuel s'ouvre sur les éléments | ~L2365 |
| 3 | Handle de resize reste actif | ~L2381 |
| 4 | Drop d'images depuis l'extérieur non bloqué | ~L1311 |
| 5 | Double-clic sur note → active l'édition | ~L1643, ~L2862 |
| 6 | Delete / Ctrl+Z / Ctrl+V fonctionnent | ~L1488, ~L1519 |
| 7 | Cursor canvas = `default` au lieu de `grab` | index.html ~L1649 |
| 8 | Pinch-to-zoom inexistant (2 doigts = pan uniquement) | ~L1128 |

---

## Approche retenue : patches ciblés (Approche A)

Minimale, cohérente avec le style du code existant. Chaque point de blocage reçoit un guard explicite. Pas d'overlay, pas de listener global de capture.

---

## Changements détaillés

### app.js — 7 modifications

**1. Pan sur fond de canvas (L~1222)**
Dans `setupCanvasEvents()`, dans le handler `mousedown` du wrapper, avant le code de sélection rectangle (après les guards `isPanningMode`) :
```js
if (document.body.classList.contains('readonly-mode')) {
  isPanning = true;
  panStart = { x: e.clientX - panX, y: e.clientY - panY };
  wrapper.style.cursor = 'grabbing';
  return;
}
```

**2. Bloquer contextmenu sur éléments (L~2365)**
Dans `attachElementEvents()`, handler `contextmenu` :
```js
if (document.body.classList.contains('readonly-mode')) return;
```

**3. Bloquer resize (L~2381)**
Dans `attachElementEvents()`, handler mousedown du `resize-handle` :
```js
if (document.body.classList.contains('readonly-mode')) return;
```

**4. Bloquer drop (L~1311)**
Dans `setupCanvasEvents()`, handler `drop` :
```js
if (document.body.classList.contains('readonly-mode')) return;
```

**5. Bloquer édition de notes (L~1643 et L~2862)**
Dans les deux fonctions `activateNoteEdit` (une par type de note) :
```js
if (document.body.classList.contains('readonly-mode')) return;
```

**6. Bloquer raccourcis destructifs (L~1488, L~1476, L~1519)**
- Delete/Backspace → guard readonly
- Ctrl+Z / Ctrl+Shift+Z → guard readonly
- Handler `paste` → guard readonly

**7. Ajouter pinch-to-zoom (L~1128)**
Dans `touchstart` : stocker `initialPinchDist` (distance entre les 2 doigts) et `initialZoomLevel`.
Dans `touchmove` : calculer `ratio = newDist / initialPinchDist`, calculer `newZ = initialZoomLevel * ratio` (clampé entre 0.15 et 4), ajuster `panX/panY` pour zoomer vers le point médian.
Bénéficie à tous les modes (readonly et normal).

### index.html — 1 modification CSS

**8. Cursor grab sur canvas-wrapper (L~1649)**
```css
/* avant */
body.readonly-mode .canvas-wrapper {
  cursor: default !important;
}
/* après */
body.readonly-mode .canvas-wrapper {
  cursor: grab;
}
```
Retrait de `!important` pour que `wrapper.style.cursor = 'grabbing'` (inline JS) puisse s'appliquer pendant le drag. Les `board-element` conservent `cursor: default !important`.

---

## Comportement final attendu

| Action visiteur | Résultat |
|---|---|
| Clic-glisser sur fond | Pan du canvas |
| Molette | Pan horizontal/vertical |
| Alt/Ctrl + molette | Zoom centré sur curseur |
| Pinch (2 doigts touch) | Zoom centré sur point médian |
| 2 doigts glisser (touch) | Pan |
| Clic sur `#fit-screen-btn` | Ajuste la vue |
| Clic sur `#preview-btn` | Plein écran |
| Clic sur un élément | Rien |
| Glisser un élément | Rien |
| Double-clic note | Rien |
| Double-clic image | Ouvre la lightbox (consultation) |
| Menu contextuel | Rien |
| Resize handle | Caché (CSS) + handler bloqué |
| Delete / Ctrl+Z / Paste | Rien |
| Drop image externe | Rien |
