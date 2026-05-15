# Extension Moodboard — Instructions projet

## Stack & architecture
- Chrome Extension Manifest V3
- Un seul fichier JS principal : `app.js` (~3700 lignes), structure IIFE `const App = (function(){...})()`
- `collab.js` : collaboration Firebase Realtime Database
- `background.js` : service worker
- `index.html` : UI statique + tout le CSS inline dans `<style>`
- Stockage : IndexedDB (clé `mb_boards`) + fallback localStorage

## Règles absolues
- **Zéro `console.log`** dans app.js ou collab.js
- **Zéro boucle while non bornée** (seule exception : la while de snap à ~line 3432, bornée par maxAttempts)
- **Ne jamais toucher à la structure IIFE** — tout le code reste dans `App = (function(){...})()`
- **Pas de refactoring non demandé** — corriger uniquement ce qui est signalé
- Avant tout edit : lire la section exacte du fichier cible

## Patterns clés à respecter
- **Drag RAF** : `dragRAF` / `groupDragRAF` avec lerp + dirty flag `hasMoved`, `cancelAnimationFrame` dans onUp
- **Historique** : `pushAction({ type, elId, before, after })` + `pushHistory()` — jamais de `pushHistory` sans `pushAction`
- **`_imgStore`** : Map `id → base64src` hors DOM pour les images — toujours propager sur duplication et remapper dans restoreElement
- **Listeners** : `setupCanvasEvents`, `setupKeyboard`, `setupUIEvents` appelés UNE SEULE FOIS dans `init()`
- **Collab sync** : après chaque modification d'élément (position, taille, z-index, data), appeler le `Collab.sync*` correspondant si `Collab.isActive()`

## Fonctions collab à connaître
- `Collab.syncElementPosition(id, x, y, immediate?)`
- `Collab.syncElementSize(id, w, h, immediate?)`
- `Collab.syncElementZ(id, z)`
- `Collab.syncElementData(id, data)` — pour type, contenu, couleur, etc.
- `Collab.isActive()` — toujours vérifier avant d'appeler

## Types d'actions undo/redo
`'move'`, `'resize'`, `'create'`, `'delete'`, `'editText'`, `'editColor'`, `'groupMove'`, `'groupCreate'`, `'generic'`

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