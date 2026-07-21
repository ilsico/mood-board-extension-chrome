# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack & architecture
- Chrome Extension Manifest V3
- Un seul fichier JS principal : `app.js` (~11 400 lignes), structure IIFE `const App = (function(){...})()`
- `collab.js` : collaboration Firebase Realtime Database (IIFE exposé comme `window.Collab`)
- `background.js` : service worker — a son propre accès IndexedDB (même DB que app.js) pour reconstruire les menus contextuels
- `index.html` : UI statique + tout le CSS inline dans `<style>`
- `popup.html` / `popup.js` : popup extension (280px, bouton capture + sélecteur de board cible)
- Stockage : IndexedDB (`MoodboardDB`, store `boards_store`, clé `mb_boards`). **Aucun fallback localStorage en écriture** — `localStorage` n'est lu que pour migrer les données legacy (clé purgée après migration) et pour les préférences de polices.
- `saveBoards()` attend la fin réelle de la transaction et renvoie un booléen ; un échec (quota dépassé) affiche un toast. Ne jamais revenir à un `put()` non attendu.

## Chargement de l'extension pour tester
1. Ouvrir `chrome://extensions`
2. Activer "Mode développeur"
3. "Charger l'extension non empaquetée" → pointer sur ce dossier
4. Modifier les fichiers → bouton Actualiser dans chrome://extensions (pas besoin de recharger l'UI si c'est index.html)

### Pièges de test
- **Service worker** : purger avant toute vérification sur `localhost:3000`, sinon on teste l'ancien code —
  `navigator.serviceWorker.getRegistrations().then(r => r.forEach(x => x.unregister()))` puis `caches.keys().then(k => k.forEach(c => caches.delete(c)))`.
- **Onglet masqué** : `openBoard()` fait tout son travail dans un `requestAnimationFrame`, gelé dans un onglet en arrière-plan. Le board ne s'ouvre alors jamais et `currentBoardId` reste `null`, ce qui fait que `saveCurrentBoard()` sort immédiatement et « sauvegarde » 0 élément. Ce n'est pas un bug : en test automatisé, shimmer `window.requestAnimationFrame = cb => setTimeout(cb, 0)`.

### Encodage — IMPORTANT
Les fichiers sont en **UTF-8 sans BOM** et pleins d'accents. **Ne jamais** les modifier via `Get-Content`/`Set-Content` PowerShell : PowerShell 5.1 lit en ANSI, `é` devient `Ã©`, et réécrire ajoute un BOM. Utiliser l'édition de fichier normale. Après tout script d'écriture, vérifier que `[regex]::Matches($contenu,'Ã.|â€.').Count` vaut 0.

## Types d'éléments canvas
Chaque `.board-element` a un `data-type` parmi :
- `note` — zone de texte avec `<textarea>`
- `color` — swatch couleur avec `.color-hex-input`
- `link` — card lien avec image d'aperçu, titre, URL
- `image` — image (src stocké dans `_imgStore`, jamais dans le DOM)
- `connection` — connecteur SVG `.el-connection` (pas un `.board-element`)
- `caption` — légende texte `.el-caption` (pas un `.board-element`)

## Règles absolues
- **Zéro `console.*`** dans app.js, collab.js et background.js (log, warn et error compris)
- **Zéro boucle while non bornée** — les `while` existantes sont toutes soit des traversées de siblings/TreeWalker (terminaison garantie), soit bornées par un compteur
- **Ne jamais toucher à la structure IIFE** — tout le code reste dans `App = (function(){...})()`
- **Pas de refactoring non demandé** — corriger uniquement ce qui est signalé
- Avant tout edit : lire la section exacte du fichier cible

## Patterns clés à respecter

### Création d'éléments
- `makeElement(type, x, y, w, h)` → crée le `.board-element`, lui attache les events via `attachElementEvents()`, l'ajoute au `#canvas`
- **Duplication par `cloneNode` uniquement** (alt+drag : `doDuplicate`, `doDuplicateGroup`) : `cloneNode` ne copie pas les listeners posés sur les enfants, il faut donc rappeler `attachElementEvents(copy)` **plus** le `reattach*Events` du type — `color`, `note`, `file`, `link`, `video`. En oublier un donne un élément visuellement correct mais mort au double-clic.
- `duplicateEl()` et `ctxDuplicate()` passent par `restoreElement()`, qui recrée via les `create*` : rien à réattacher là.
- L'undo passe aussi par `restoreElement()` — pas de restauration par innerHTML.

### Drag RAF
`dragRAF` / `groupDragRAF` avec lerp + dirty flag `hasMoved`, `cancelAnimationFrame` dans onUp

### Historique
- **Un seul mécanisme, dans les deux modes** : `pushAction({ type, elId, before, after })` alimente `_actionHistory[]` (max 100), et `undo()`/`redo()` appliquent `_applyReverse`/`_applyForward`.
- Types d'actions : `'move'`, `'resize'`, `'create'`, `'delete'`, `'editText'`, `'editColor'`, `'groupMove'`, `'groupCreate'`, `'generic'`
- `syncDomToDataset()` (ex-`pushHistory()`) **n'est pas** l'historique : elle recopie dans le DOM sérialisable ce que seul le JS connaît (`.value` des hex inputs, innerHTML des notes vers `dataset.savedata`). `saveCurrentBoard()` lit `dataset.savedata` — la supprimer casse la sauvegarde des notes.
- Règle : **jamais de `syncDomToDataset` sans `pushAction` préalable**
- En mode collab, `undo()` **refuse** (toast) si l'élément est verrouillé ou modifié par un autre — il ne saute jamais l'action, car avancer `_actionIndex` sans appliquer l'inverse désynchronise le redo.

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
Catégories fixes : `typographie`, `couleur`, `logo`, `image`, `captures` (libellée « iPhone », alimentée par l'inbox Firebase), `__trash__`. Chaque board a sa propre `library` sérialisée dans `boards[]`.

## Écriture vers Firebase
- **`update()`, jamais `set()`** sur `boards/{id}` : `set()` écraserait les enfants frères `activity/` et `snapshotUrl`.
- **Jamais de base64 d'image dans une écriture Firebase** — sinon « Write too large ». Les trois chemins concernés (`saveCurrentBoard`, `_syncBoardElements`, `_collabMergeElements`) écrivent `data: el.storageUrl || ''`.
- `storageUrl` est l'URL Firebase Storage de l'image, posée par `_uploadBoardImagesToStorage()` au moment du partage, conservée dans `el.dataset.storageurl`, sérialisée avec le board et réhydratée par `restoreElement()`. **Ne pas casser cette chaîne** : sans elle, `data` repasse à `''` et les boards partagés affichent « Image perdue ». Le base64 reste intact en local (IndexedDB + `_imgStore`).
- **Toute nouvelle destination Storage a besoin de sa règle** dans `storage.rules` : un chemin non couvert par un bloc `match` est refusé par défaut, et l'upload échoue silencieusement. C'est ce qui arrivait à `collabImages/{boardId}/{elId}`.
- Comparer un `ServerValue.TIMESTAMP` à `_serverNow()` (collab.js), jamais à `Date.now()` : une horloge locale décalée fait disparaître des collaborateurs.

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
