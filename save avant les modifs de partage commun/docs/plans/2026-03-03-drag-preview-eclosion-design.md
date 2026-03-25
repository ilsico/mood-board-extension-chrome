# Design : Drag & Drop — Effet d'éclosion et de rebond du preview

Date : 2026-03-03
Statut : Approuvé

## Contexte

Le preview custom (`#drag-custom-preview`) affiche l'image en taille pleine dès le `dragstart`, même quand le curseur est encore sur le panneau bibliothèque. L'objectif est de créer une transition physique : vignette sur le panneau → taille réelle avec rebond à l'entrée sur le canvas.

## Décisions clés

- **Taille thumbnail** : lue via `getBoundingClientRect()` sur l'`<img>` de l'item au moment du `dragstart` (taille réelle rendue).
- **Détection de zone** : listener `document.addEventListener('dragover', ...)` unique, ajouté au `dragstart` et retiré au `dragend`. Zone détectée par `e.target.closest('#canvas-wrapper')`.
- **Drop** : suppression de `applyDropSnap` pour les drops lib-panel (single et multi). L'élément utilise la taille calculée (fullW / zoomLevel). Les drops de fichiers externes conservent `applyDropSnap`.

## Fichiers modifiés

- `index.html` — CSS uniquement
- `app.js` — logique dragstart, dragover, drop

---

## Design CSS (`index.html`)

### Modifications de `#drag-custom-preview`

Ajouter une transition de taille :

```css
#drag-custom-preview {
  /* existant : display:none; position:fixed; z-index:9998; pointer-events:none; transform:translate(-50%,-50%); object-fit:cover; opacity:1; */
  transition: width 0.2s ease-out, height 0.2s ease-out;
}
```

`pointer-events: none` est déjà présent, pas de changement.

### Nouvelle animation et classe

```css
@keyframes previewSnap {
  0%   { transform: translate(-50%, -50%) scale(0.9); }
  50%  { transform: translate(-50%, -50%) scale(1.05); }
  100% { transform: translate(-50%, -50%) scale(1); }
}
.preview-active-snap {
  animation: previewSnap 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}
```

Le `transform: translate(-50%, -50%)` est inclus dans les keyframes pour ne pas perdre le centrage sur le curseur pendant l'animation.

---

## Design Logique (`app.js`)

### Variables de contexte drag (scope `setupPanelEvents` ou closure équivalente)

```js
let _dragThumbW = 0, _dragThumbH = 0; // taille vignette panel
let _dragFullW = 0,  _dragFullH = 0;  // taille pleine canvas
let _previewInCanvas = false;          // flag zone courante
let _docDragOverHandler = null;        // référence pour cleanup
```

### dragstart (dans le listener sur `div` item lib)

1. Récupérer la taille rendue :
   ```js
   const imgEl = div.querySelector('img');
   const r = imgEl.getBoundingClientRect();
   _dragThumbW = r.width;
   _dragThumbH = r.height;
   ```

2. Calculer la taille pleine (même formule qu'actuellement dans `sizeCalc.onload`) et stocker dans `_dragFullW`, `_dragFullH`. La formule est exécutée de façon synchrone si les dimensions naturelles sont déjà connues via l'img rendue, ou via `Image()` asynchrone sinon.

3. Appliquer la taille thumbnail immédiatement sur le preview :
   ```js
   preview.style.width  = _dragThumbW + 'px';
   preview.style.height = _dragThumbH + 'px';
   preview.classList.remove('preview-active-snap');
   _previewInCanvas = false;
   ```

4. Ajouter le listener document :
   ```js
   _docDragOverHandler = (e) => {
     if (!isDraggingFromPanel) return;
     const preview = document.getElementById('drag-custom-preview');
     preview.style.left = e.clientX + 'px';
     preview.style.top  = e.clientY + 'px';
     preview.style.display = 'block';

     if (e.target.closest('#canvas-wrapper')) {
       if (!_previewInCanvas) {
         preview.style.width  = _dragFullW + 'px';
         preview.style.height = _dragFullH + 'px';
         preview.classList.remove('preview-active-snap');
         void preview.offsetWidth; // reflow pour relancer l'animation
         preview.classList.add('preview-active-snap');
         _previewInCanvas = true;
       }
     } else {
       if (_previewInCanvas) {
         preview.style.width  = _dragThumbW + 'px';
         preview.style.height = _dragThumbH + 'px';
         preview.classList.remove('preview-active-snap');
         _previewInCanvas = false;
       }
     }
   };
   document.addEventListener('dragover', _docDragOverHandler);
   ```

### dragend (listener sur `div` item lib)

```js
div.addEventListener('dragend', () => {
  isDraggingFromPanel = false;
  draggedLibItemId = null;
  _previewInCanvas = false;
  if (_docDragOverHandler) {
    document.removeEventListener('dragover', _docDragOverHandler);
    _docDragOverHandler = null;
  }
  document.getElementById('drag-custom-preview').style.display = 'none';
});
```

### Simplification du listener `wrapper.addEventListener('dragover', ...)`

Retirer la logique de position/display (maintenant gérée dans le listener document). Conserver uniquement `e.preventDefault()` (nécessaire pour autoriser le drop).

```js
wrapper.addEventListener('dragover', (e) => {
  e.preventDefault();
  // position gérée par _docDragOverHandler
});
```

Retirer le listener `wrapper.addEventListener('dragleave', ...)` qui cachait le preview (le preview est maintenant géré globalement).

### Drop — taille des éléments créés

Pour les drops single et multi depuis le panneau lib, utiliser `_dragFullW` et `_dragFullH` au lieu de recalculer depuis `naturalWidth` :

```js
const w = Math.round(_dragFullW / (zoomLevel || 1));
const h = Math.round(_dragFullH / (zoomLevel || 1));
const x = (e.clientX - rect.left - panX) / zoomLevel - w / 2;
const y = (e.clientY - rect.top  - panY) / zoomLevel - h / 2;
createImageElement(src, x, y, w, h);
// Pas d'applyDropSnap — l'élément apparaît directement à taille finale
```

Les drops de fichiers externes (`e.dataTransfer.files`) conservent leur logique actuelle avec `applyDropSnap`.

---

## Comportement attendu

| Situation | Preview |
|-----------|---------|
| Drag commence (curseur sur panel) | Vignette taille réelle rendue |
| Curseur entre sur le canvas | Transition CSS 0.2s → taille pleine + animation previewSnap (0.9 → 1.05 → 1.0) |
| Curseur revient sur le panel | Transition CSS 0.2s → retour taille vignette |
| Drop sur le canvas | Élément créé à taille pleine sans animation (pas de double rebond) |
| Drop annulé (dragend sans drop) | Preview masqué, listeners nettoyés |

---

## Cas non couverts (hors scope)

- Drag multiple (multi-lib) : le preview affiche l'image du premier item drag. La taille thumbnail vient de cet item. Comportement identique au single.
- `toolDragStart` (tool:note, tool:color, etc.) : non concerné par ce design (pas d'image preview).
