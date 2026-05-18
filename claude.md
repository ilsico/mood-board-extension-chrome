# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack & architecture
- Chrome Extension Manifest V3
- Un seul fichier JS principal : `app.js` (~3700 lignes), structure IIFE `const App = (function(){...})()`
- `collab.js` : collaboration Firebase Realtime Database (IIFE exposé comme `window.Collab`)
- `background.js` : service worker — a son propre accès IndexedDB (même DB que app.js) pour reconstruire les menus contextuels
- `index.html` : UI statique + tout le CSS inline dans `<style>`
- `popup.html` / `popup.js` : popup extension (280px, bouton capture + sélecteur de board cible)
- Stockage : IndexedDB (`MoodboardDB`, store `boards_store`, clé `mb_boards`) + fallback localStorage

## Chargement de l'extension pour tester
1. Ouvrir `chrome://extensions`
2. Activer "Mode développeur"
3. "Charger l'extension non empaquetée" → pointer sur ce dossier
4. Modifier les fichiers → bouton Actualiser dans chrome://extensions (pas besoin de recharger l'UI si c'est index.html)

## Types d'éléments canvas
Chaque `.board-element` a un `data-type` parmi :
- `note` — zone de texte avec `<textarea>`
- `color` — swatch couleur avec `.color-hex-input`
- `link` — card lien avec image d'aperçu, titre, URL
- `image` — image (src stocké dans `_imgStore`, jamais dans le DOM)
- `connection` — connecteur SVG `.el-connection` (pas un `.board-element`)
- `caption` — légende texte `.el-caption` (pas un `.board-element`)

## Règles absolues
- **Zéro `console.log`** dans app.js ou collab.js
- **Zéro boucle while non bornée** (seule exception : la while de snap à ~line 3432, bornée par maxAttempts)
- **Ne jamais toucher à la structure IIFE** — tout le code reste dans `App = (function(){...})()`
- **Pas de refactoring non demandé** — corriger uniquement ce qui est signalé
- Avant tout edit : lire la section exacte du fichier cible

## Patterns clés à respecter

### Création d'éléments
- `makeElement(type, x, y, w, h)` → crée le `.board-element`, lui attache les events via `attachElementEvents()`, l'ajoute au `#canvas`
- Après un innerHTML restore (undo) ou une duplication, appeler `reattachColorEvents(el)` pour `color` et `reattachNoteEvents(el)` pour `note`

### Drag RAF
`dragRAF` / `groupDragRAF` avec lerp + dirty flag `hasMoved`, `cancelAnimationFrame` dans onUp

### Historique dual
- **Mode solo** : `pushHistory()` sérialise `canvas.innerHTML` (max 50 entrées dans `history[]`)
- **Mode collab** : `pushAction({ type, elId, before, after })` alimente `_actionHistory[]` (max 100 entrées)
- Règle : **jamais de `pushHistory` sans `pushAction` préalable**
- Types d'actions : `'move'`, `'resize'`, `'create'`, `'delete'`, `'editText'`, `'editColor'`, `'groupMove'`, `'groupCreate'`, `'generic'`

### `_imgStore`
Map `id → base64src` hors DOM pour les images — toujours propager sur duplication et remapper dans `restoreElement` (`_imgStore[tempId] → _imgStore[savedId]`)

### Listeners
`setupCanvasEvents`, `setupKeyboard`, `setupUIEvents` appelés **UNE SEULE FOIS** dans `init()`.
`initHomePan()` appelé à chaque `renderHome()` (guards internes pour éviter les doubles).

### Collab sync
Après chaque modification d'élément (position, taille, z-index, data), appeler le `Collab.sync*` correspondant si `Collab.isActive()` :
- `Collab.syncElementPosition(id, x, y, immediate?)`
- `Collab.syncElementSize(id, w, h, immediate?)`
- `Collab.syncElementZ(id, z)`
- `Collab.syncElementData(id, data)`

## Bibliothèque
Catégories fixes : `typographie`, `couleur`, `logo`, `image`, `__trash__`. Chaque board a sa propre `library` sérialisée dans `boards[]`.

## Curseur
- Couleur : `#ff3c00` partout (CSS + JS)
- Path SVG : `M2 2 L2 17 L6 13 L9 20 L11 19 L8 12 L14 12 Z`, viewBox `0 0 18 22`, hotspot `2 2`
- Défini dans : `.canvas-wrapper`, `.board-element`, `.boards-container` (index.html) + `_applyCustomCursor()` (app.js)

## Workflow de debug
1. Lire le code autour du bug AVANT de proposer un fix
2. Identifier si le bug est dans app.js, collab.js, ou index.html
3. Vérifier si la collab est concernée (oubli de sync ?)
4. Vérifier si l'undo/redo est concerné (pushAction manquant ?)
5. Ne corriger que la cause racine, pas les symptômes
