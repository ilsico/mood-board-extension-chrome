# Drag Preview Éclosion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ajouter un effet d'éclosion au preview custom du drag : vignette taille réelle sur le panneau bibliothèque, puis transition vers la taille pleine avec rebond 90%→105%→100% dès l'entrée sur le canvas.

**Architecture:** Listener `document.dragover` ajouté/retiré dynamiquement pendant chaque drag. Le preview stocke ses deux tailles (thumb/full) via des propriétés JS sur l'élément DOM. Zéro nouvelle variable globale : les propriétés sont attachées directement au nœud `#drag-custom-preview`.

**Tech Stack:** Vanilla JS (ES6+), CSS animations, Chrome Extension MV3, aucun test framework — vérification manuelle dans l'extension chargée en mode développeur.

**Design doc :** `docs/plans/2026-03-03-drag-preview-eclosion-design.md`

---

## Avant de commencer

Charger l'extension en mode développeur (chrome://extensions → « Charger l'extension non empaquetée » → pointer sur le dossier). Avoir une bibliothèque avec au moins 2–3 images pour tester.

---

### Task 1 : CSS — Transition de taille et animation previewSnap

**Files:**
- Modify: `index.html` (bloc `<style>` interne, autour de la ligne 1564)

**Contexte :** `#drag-custom-preview` a déjà `pointer-events: none` et `transform: translate(-50%, -50%)`. On ajoute une transition de taille et une nouvelle animation.

**Step 1 : Localiser le bloc CSS à modifier**

Dans `index.html`, chercher le sélecteur `#drag-custom-preview` (≈ ligne 1564). Il ressemble à :

```css
#drag-custom-preview {
  display: none;
  position: fixed;
  z-index: 9998;
  pointer-events: none;
  transform: translate(-50%, -50%);
  object-fit: cover;
  opacity: 1;
}
```

**Step 2 : Ajouter la transition de taille**

Ajouter `transition: width 0.2s ease-out, height 0.2s ease-out;` au sélecteur existant :

```css
#drag-custom-preview {
  display: none;
  position: fixed;
  z-index: 9998;
  pointer-events: none;
  transform: translate(-50%, -50%);
  object-fit: cover;
  opacity: 1;
  transition: width 0.2s ease-out, height 0.2s ease-out;
}
```

**Step 3 : Ajouter l'animation previewSnap juste après le bloc existant**

Insérer après la règle `#drag-custom-preview { ... }` :

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

Note importante : `transform: translate(-50%, -50%)` **doit figurer dans chaque keyframe** sinon l'image perd son centrage sur le curseur pendant l'animation.

**Step 4 : Vérification manuelle**

Recharger l'extension. Pas encore de comportement visible (la classe `.preview-active-snap` n'est pas encore ajoutée par JS). Ouvrir DevTools → Elements → sélectionner `#drag-custom-preview` → ajouter manuellement la classe `preview-active-snap` → vérifier que l'animation se joue (scale 0.9 → 1.05 → 1.0).

**Step 5 : Commit**

```bash
git add index.html
git commit -m "feat: add previewSnap animation and size transition to drag preview"
```

---

### Task 2 : app.js — dragstart : capturer les deux tailles et initialiser le preview

**Files:**
- Modify: `app.js` (listener `dragstart` sur `div` item lib, ≈ ligne 4248)

**Contexte :** Le `dragstart` actuel calcule la taille pleine via un `Image()` asynchrone et l'applique directement au preview. On le remplace pour :
1. Lire la taille thumbnail depuis l'`<img>` rendue
2. Calculer la taille pleine (même formule, mais stockée sur le preview sans l'appliquer tout de suite)
3. Afficher le preview en taille thumbnail dès le départ

**Step 1 : Lire le dragstart actuel**

Repérer le bloc `sizeCalc.onload` (≈ lignes 4272–4283) qui contient la formule de calcul de la taille pleine. Il ressemble à :

```js
const sizeCalc = new Image();
sizeCalc.onload = () => {
  const wrapEl = document.getElementById('canvas-wrapper');
  const vw = (wrapEl ? wrapEl.clientWidth : window.innerWidth) / (zoomLevel || 1);
  const vh = (wrapEl ? wrapEl.clientHeight : window.innerHeight) / (zoomLevel || 1);
  const maxDim = Math.max(vw, vh) * 0.2;
  let fw = sizeCalc.naturalWidth || 220;
  let fh = sizeCalc.naturalHeight || 170;
  if (fw > maxDim) { fh = Math.round(fh * maxDim / fw); fw = Math.round(maxDim); }
  if (fh > maxDim) { fw = Math.round(fw * maxDim / fh); fh = Math.round(maxDim); }
  preview.style.width = Math.round(fw * (zoomLevel || 1)) + 'px';
  preview.style.height = Math.round(fh * (zoomLevel || 1)) + 'px';
};
sizeCalc.onerror = () => { preview.style.width = '220px'; preview.style.height = '170px'; };
sizeCalc.src = item.src;
```

**Step 2 : Remplacer ce bloc**

Remplacer l'intégralité du bloc `sizeCalc` (onload + onerror + src) par le code suivant :

```js
// Taille thumbnail : lire la taille rendue de l'img dans le panel
const itemImg = div.querySelector('img');
const thumbRect = itemImg.getBoundingClientRect();
preview._thumbW = thumbRect.width  || 132;
preview._thumbH = thumbRect.height || 120;

// Taille pleine : calculer via Image() asynchrone (naturalWidth connu après chargement)
const sizeCalc = new Image();
sizeCalc.onload = () => {
  const wrapEl = document.getElementById('canvas-wrapper');
  const vw = (wrapEl ? wrapEl.clientWidth : window.innerWidth) / (zoomLevel || 1);
  const vh = (wrapEl ? wrapEl.clientHeight : window.innerHeight) / (zoomLevel || 1);
  const maxDim = Math.max(vw, vh) * 0.2;
  let fw = sizeCalc.naturalWidth || 220;
  let fh = sizeCalc.naturalHeight || 170;
  if (fw > maxDim) { fh = Math.round(fh * maxDim / fw); fw = Math.round(maxDim); }
  if (fh > maxDim) { fw = Math.round(fw * maxDim / fh); fh = Math.round(maxDim); }
  // Stocker en pixels écran (zoomLevel déjà appliqué)
  preview._fullW = Math.round(fw * (zoomLevel || 1));
  preview._fullH = Math.round(fh * (zoomLevel || 1));
};
sizeCalc.onerror = () => {
  preview._fullW = 220;
  preview._fullH = 170;
};
sizeCalc.src = item.src;

// Appliquer immédiatement la taille thumbnail (curseur encore sur le panel)
preview.style.width  = preview._thumbW + 'px';
preview.style.height = preview._thumbH + 'px';
preview.classList.remove('preview-active-snap');
preview._inCanvas = false;
```

**Step 3 : Vérification manuelle**

Recharger l'extension. Démarrer un drag depuis le panel. Le preview doit apparaître en taille thumbnail (≈ la taille de la vignette dans la grille). La taille pleine n'est pas encore appliquée (le listener document n'est pas encore ajouté).

**Step 4 : Commit**

```bash
git add app.js
git commit -m "feat: capture thumb/full sizes at dragstart, init preview as thumbnail"
```

---

### Task 3 : app.js — listener document.dragover (détection de zone + snap)

**Files:**
- Modify: `app.js` (listener `dragstart` sur `div` item lib, juste après le code de Task 2)

**Contexte :** Ajouter un listener `document.dragover` pendant chaque drag pour détecter la zone (panel ou canvas) et mettre à jour le preview.

**Step 1 : Ajouter les variables de référence du listener juste avant le bloc dragstart**

Dans le corps de la fonction qui construit les items lib (chercher le `div.addEventListener('dragstart', ...)`, ≈ ligne 4248), on a accès à la closure. Le listener doit être défini dans le `dragstart` pour capturer `preview` et les propriétés fraîches.

**Step 2 : À la fin du bloc dragstart (après le code de Task 2), ajouter le listener document**

Juste avant la fin de la fonction `dragstart` (avant la ligne `e.dataTransfer.setDragImage(...)`), insérer :

```js
// Listener document pour détection zone canvas vs panel
const onDocDragOver = (ev) => {
  if (!isDraggingFromPanel) return;
  const p = document.getElementById('drag-custom-preview');
  p.style.left = ev.clientX + 'px';
  p.style.top  = ev.clientY + 'px';
  if (p.style.display !== 'block') p.style.display = 'block';

  if (ev.target.closest('#canvas-wrapper')) {
    // ZONE CANVAS : passer en taille pleine + jouer le snap (une seule fois)
    if (!p._inCanvas) {
      // Utiliser les valeurs calculées (ou fallback si sizeCalc pas encore terminé)
      const fw = p._fullW || 220;
      const fh = p._fullH || 170;
      p.style.width  = fw + 'px';
      p.style.height = fh + 'px';
      p.classList.remove('preview-active-snap');
      void p.offsetWidth; // force reflow pour relancer l'animation CSS
      p.classList.add('preview-active-snap');
      p._inCanvas = true;
    }
  } else {
    // ZONE PANEL ou autre : revenir en taille thumbnail
    if (p._inCanvas) {
      p.style.width  = (p._thumbW || 132) + 'px';
      p.style.height = (p._thumbH || 120) + 'px';
      p.classList.remove('preview-active-snap');
      p._inCanvas = false;
    }
  }
};
document.addEventListener('dragover', onDocDragOver);

// Stocker la ref pour cleanup dans dragend
preview._docDragOver = onDocDragOver;
```

**Step 3 : Modifier le listener dragend pour nettoyer le listener document**

Repérer `div.addEventListener('dragend', ...)` (≈ ligne 4293) :

```js
div.addEventListener('dragend', () => {
  isDraggingFromPanel = false;
  draggedLibItemId = null;
  document.getElementById('drag-custom-preview').style.display = 'none';
});
```

Le remplacer par :

```js
div.addEventListener('dragend', () => {
  isDraggingFromPanel = false;
  draggedLibItemId = null;
  const p = document.getElementById('drag-custom-preview');
  if (p._docDragOver) {
    document.removeEventListener('dragover', p._docDragOver);
    p._docDragOver = null;
  }
  p._inCanvas = false;
  p.classList.remove('preview-active-snap');
  p.style.display = 'none';
});
```

**Step 4 : Simplifier le listener wrapper.dragover existant**

Repérer `wrapper.addEventListener('dragover', ...)` (≈ ligne 1391) :

```js
wrapper.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (isDraggingFromPanel) {
    const preview = document.getElementById('drag-custom-preview');
    preview.style.left = e.clientX + 'px';
    preview.style.top = e.clientY + 'px';
    if (preview.style.display !== 'block') preview.style.display = 'block';
  }
});
```

La position et l'affichage sont maintenant gérés par `onDocDragOver`. Garder uniquement `e.preventDefault()` :

```js
wrapper.addEventListener('dragover', (e) => {
  e.preventDefault();
  // position et affichage gérés par le listener document (dragstart lib item)
});
```

**Step 5 : Supprimer le listener wrapper.dragleave qui cachait le preview**

Repérer `wrapper.addEventListener('dragleave', ...)` (≈ ligne 1400) :

```js
wrapper.addEventListener('dragleave', () => {
  if (isDraggingFromPanel)
    document.getElementById('drag-custom-preview').style.display = 'none';
});
```

Supprimer ce bloc entièrement (le preview est maintenant visible au-dessus du panel aussi).

**Step 6 : Vérification manuelle**

Recharger l'extension. Tester le drag :
- Curseur sur le panel → preview vignette petite taille ✓
- Curseur entre sur le canvas → preview s'agrandit en 0.2s + animation rebond ✓
- Curseur revient sur le panel → preview réduit en 0.2s ✓
- Drag annulé → preview disparaît ✓

**Step 7 : Commit**

```bash
git add app.js
git commit -m "feat: add document dragover zone detection with snap animation on canvas entry"
```

---

### Task 4 : app.js — Drop : utiliser la taille calculée, supprimer applyDropSnap

**Files:**
- Modify: `app.js` (listener `wrapper.drop`, ≈ lignes 1404–1480)

**Contexte :** Actuellement, le drop recalcule la taille depuis `naturalWidth/naturalHeight` (full resolution) et appelle `applyDropSnap(...)`. On remplace par la taille pré-calculée stockée dans le preview, et on retire `applyDropSnap` pour ces drops.

**Step 1 : Helper pour lire la taille full depuis le preview**

Ce helper lit `_fullW`/`_fullH` stockés sur le preview (en px écran), les convertit en coordonnées canvas (divisées par zoomLevel). À écrire une seule fois au début du handler `drop`.

Repérer `wrapper.addEventListener('drop', (e) => {` (≈ ligne 1404). Juste après `e.preventDefault()` et la ligne `document.getElementById('drag-custom-preview').style.display = 'none';`, ajouter :

```js
const _pv = document.getElementById('drag-custom-preview');
const _pvW = (_pv._fullW || 220) / (zoomLevel || 1);
const _pvH = (_pv._fullH || 170) / (zoomLevel || 1);
```

**Step 2 : Drop single depuis le panneau lib (src `data:`)**

Repérer le bloc (≈ ligne 1459–1479) :

```js
if (src && src.startsWith('data:')) {
  const rect = wrapper.getBoundingClientRect();
  const tmpImg = new Image();
  tmpImg.onload = () => {
    const w = tmpImg.naturalWidth || 220;
    const h = tmpImg.naturalHeight || 170;
    const x = (e.clientX - rect.left - panX) / zoomLevel - w / 2;
    const y = (e.clientY - rect.top - panY) / zoomLevel - h / 2;
    applyDropSnap(createImageElement(src, x, y, w, h));
    pushHistory();
    scheduleSave();
  };
  tmpImg.onerror = () => {
    const x = (e.clientX - rect.left - panX) / zoomLevel - 110;
    const y = (e.clientY - rect.top - panY) / zoomLevel - 85;
    applyDropSnap(createImageElement(src, x, y, 220, 170));
    pushHistory();
    scheduleSave();
  };
  tmpImg.src = src;
  return;
}
```

Remplacer par (utiliser `_pvW`/`_pvH`, retirer `applyDropSnap`) :

```js
if (src && src.startsWith('data:')) {
  const rect = wrapper.getBoundingClientRect();
  const w = _pvW;
  const h = _pvH;
  const x = (e.clientX - rect.left - panX) / zoomLevel - w / 2;
  const y = (e.clientY - rect.top  - panY) / zoomLevel - h / 2;
  createImageElement(src, x, y, w, h);
  pushHistory();
  scheduleSave();
  return;
}
```

Note : on peut retirer le `Image()` asynchrone car la taille a déjà été calculée pendant le drag.

**Step 3 : Drop multi depuis le panneau lib (`src === 'multi-lib'`)**

Repérer le bloc (≈ ligne 1434–1457) :

```js
if (src === 'multi-lib' && draggedLibItems.length > 0) {
  const rect = wrapper.getBoundingClientRect();
  draggedLibItems.forEach((libItem, i) => {
    const tmpImg = new Image();
    tmpImg.onload = () => {
      const w = tmpImg.naturalWidth || 220;
      const h = tmpImg.naturalHeight || 170;
      const x = (e.clientX - rect.left - panX) / zoomLevel - w / 2 + i * 30;
      const y = (e.clientY - rect.top - panY) / zoomLevel - h / 2 + i * 30;
      applyDropSnap(createImageElement(libItem.src, x, y, w, h));
      pushHistory();
      scheduleSave();
    };
    tmpImg.onerror = () => {
      const x = (e.clientX - rect.left - panX) / zoomLevel - 110 + i * 30;
      const y = (e.clientY - rect.top - panY) / zoomLevel - 85 + i * 30;
      applyDropSnap(createImageElement(libItem.src, x, y, 220, 170));
      pushHistory();
      scheduleSave();
    };
    tmpImg.src = libItem.src;
  });
  draggedLibItems = [];
  return;
}
```

Remplacer par (même taille pour tous les items du multi-drop, retirer `applyDropSnap`, retirer `Image()` asynchrone) :

```js
if (src === 'multi-lib' && draggedLibItems.length > 0) {
  const rect = wrapper.getBoundingClientRect();
  const w = _pvW;
  const h = _pvH;
  draggedLibItems.forEach((libItem, i) => {
    const x = (e.clientX - rect.left - panX) / zoomLevel - w / 2 + i * 30;
    const y = (e.clientY - rect.top  - panY) / zoomLevel - h / 2 + i * 30;
    createImageElement(libItem.src, x, y, w, h);
    pushHistory();
    scheduleSave();
  });
  draggedLibItems = [];
  return;
}
```

**Step 4 : Drop de fichiers externes (conserver applyDropSnap)**

Le bloc `e.dataTransfer.files.length` (≈ ligne 1481) conserve son comportement actuel avec `applyDropSnap` — ne pas modifier.

**Step 5 : Vérification manuelle du drop**

Recharger l'extension. Tester :
- Drop single depuis le panel → l'image apparaît directement à la taille du preview sans animation de rebond ✓
- Drop multi → chaque image apparaît à la taille du preview, décalée de 30px ✓
- Drop fichier depuis le système → animation `dropSnap` conservée ✓
- Vérifier qu'il n'y a pas de double rebond (le preview jouait `previewSnap`, l'élément sur le board ne joue pas `dropSnap`) ✓

**Step 6 : Commit**

```bash
git add app.js
git commit -m "feat: use pre-calculated preview size at drop, remove applyDropSnap for lib drops"
```

---

### Task 5 : Vérification finale et edge cases

**Files:** Aucun fichier à modifier (tests manuels)

**Step 1 : Test drag annulé (Escape ou relâche hors canvas)**

- Démarrer un drag depuis le panel
- Appuyer sur Escape (ou relâcher la souris hors du canvas)
- Le preview disparaît, aucun listener `dragover` ne reste attaché
- Vérifier dans DevTools → Performance → no orphan event listeners

**Step 2 : Test drag rapide (sizeCalc pas encore terminé)**

- Si l'image n'est pas encore chargée quand le curseur entre sur le canvas, `_fullW` est `undefined`
- Le fallback `p._fullW || 220` doit s'appliquer proprement
- Vérifier : le preview s'agrandit avec un fallback 220×170 et non `undefinedpx`

**Step 3 : Test drag multiple (multi-lib)**

- Sélectionner 3 images dans le panel (Shift+click ou Cmd+click)
- Démarrer le drag
- Le preview affiche l'image du premier item (comportement attendu)
- Vérifier que les 3 images sont bien posées sur le canvas au drop avec le bon offset

**Step 4 : Test avec zoom non-unitaire**

- Zoomer le canvas à 150% puis tester le drag
- La taille pleine doit correspondre à ~20% du viewport (ex. ≈ 300px pour un viewport 1500px large)
- Les éléments posés ne doivent pas être gigantesques ni minuscules

**Step 5 : Commit final si tout est OK**

```bash
git add -A
git commit -m "feat: complete drag preview eclosion - thumbnail to full with snap animation"
```

---

## Résumé des changements

| Fichier | Nature | Lignes approximatives |
|---------|--------|-----------------------|
| `index.html` | Ajouter `transition` à `#drag-custom-preview`, ajouter `@keyframes previewSnap` + `.preview-active-snap` | ~1564–1575 |
| `app.js` | Remplacer bloc `sizeCalc` dans `dragstart` | ~4272–4285 |
| `app.js` | Ajouter `onDocDragOver` listener dans `dragstart` | ~après 4285 |
| `app.js` | Modifier `dragend` : cleanup listener + flags | ~4293 |
| `app.js` | Simplifier `wrapper.dragover` : garder seulement `e.preventDefault()` | ~1391 |
| `app.js` | Supprimer `wrapper.dragleave` qui cachait le preview | ~1400 |
| `app.js` | Modifier drop single (`data:`) : utiliser `_pvW/_pvH`, retirer `applyDropSnap` | ~1459 |
| `app.js` | Modifier drop multi (`multi-lib`) : utiliser `_pvW/_pvH`, retirer `applyDropSnap` | ~1434 |
