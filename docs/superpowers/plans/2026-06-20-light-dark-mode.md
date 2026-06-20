# Light / Dark Mode par Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un bouton toggle bas-gauche qui bascule entre mode sombre (existant) et mode clair par board, avec persistance dans les données du board.

**Architecture:** Une classe CSS `body.light-mode` porte tous les overrides de tokens. Le thème est stocké dans `board.theme` ('dark'|'light') et appliqué à `openBoard()`. Le bouton `#theme-toggle-btn` est dans un nouveau dock `#theme-dock` positionné `bottom: 16px; left: 16px`.

**Tech Stack:** CSS custom properties, vanilla JS, IndexedDB (via `saveBoards()` existant)

## Global Constraints

- Zéro `console.log` dans app.js
- Structure IIFE inviolable — tout le code reste dans `App = (function(){...})()`
- Pas de refactoring non demandé — modifier uniquement les lignes concernées
- Lire le code autour du point d'insertion avant chaque edit

---

### Task 1 : CSS tokens light-mode + correction connecteurs dark

**Files:**
- Modify: `index.html:2197-2201` (stroke connecteurs) et après la section `:root` (block light-mode)

**Interfaces:**
- Produit: classe `body.light-mode` avec tous les tokens nécessaires pour les tâches suivantes

- [ ] **Step 1 : Corriger la couleur des connecteurs en dark mode**

Dans `index.html` à la ligne 2198, remplacer :
```css
      .el-connection line {
        stroke: #1a1a2e;
        stroke-width: 1.5;
        stroke-linecap: round;
      }
```
par :
```css
      .el-connection line {
        stroke: #F2F2F2;
        stroke-width: 1.5;
        stroke-linecap: round;
      }
```

- [ ] **Step 2 : Ajouter le block CSS `body.light-mode`**

Après le bloc `:root { ... }` (qui se termine à la ligne 51 de `index.html`), insérer le bloc suivant (entre la fin de `:root` et le bloc `body {`) :

```css
      /* ===== LIGHT MODE OVERRIDES ===== */
      body.light-mode {
        --bg-app: #C7C7C7;
        --bg-canvas: #F2F2F2;
        --bg-input: #b0b0b0;
        --fg: #222222;
        --fg-inv: #F2F2F2;
      }
      body.light-mode .el-connection line {
        stroke: #2C2C2C;
      }
      body.light-mode .tool-btn svg {
        color: #222222 !important;
        stroke: #222222;
      }
      body.light-mode .tool-btn:hover svg,
      body.light-mode .tool-btn.active svg {
        color: #222222 !important;
        stroke: #222222;
      }
```

- [ ] **Step 3 : Vérifier manuellement**

  1. Recharger l'extension dans `chrome://extensions`
  2. Ouvrir un board
  3. Dans la console DevTools, taper : `document.body.classList.add('light-mode')`
  4. Vérifier : fond canvas `#F2F2F2`, toolbar `#C7C7C7`, textes sombres, icônes toolbar sombres
  5. Ajouter un connecteur, vérifier que sa couleur est `#2C2C2C`
  6. `document.body.classList.remove('light-mode')` : vérifier retour au dark, connecteurs `#F2F2F2`

- [ ] **Step 4 : Commit**

```bash
git add index.html
git commit -m "feat: tokens CSS light-mode + correction stroke connecteurs dark"
```

---

### Task 2 : HTML/CSS — icônes currentColor + dock #theme-dock + masquage

**Files:**
- Modify: `index.html` (CSS dock, listes masquage, HTML dock, attributs SVG)

**Interfaces:**
- Consomme: tokens `body.light-mode` définis en Task 1
- Produit: `#theme-toggle-btn` présent dans le DOM, icônes dock droite adaptées au thème

- [ ] **Step 1 : Rendre les icônes du dock droite adaptées au thème**

Dans `index.html`, changer les attributs `stroke="white"` des deux boutons `.collab-btn` (`#tool-export` et `#collab-btn`) en `stroke="currentColor"`. La classe `.collab-btn` a déjà `color: var(--fg)` en CSS — `currentColor` suivra donc automatiquement le token.

Remplacer (ligne ~2941) :
```html
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
            <path d="M12 10v6"/>
            <path d="m15 13-3 3-3-3"/>
          </svg>
```
par :
```html
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
            <path d="M12 10v6"/>
            <path d="m15 13-3 3-3-3"/>
          </svg>
```

Remplacer (ligne ~2948) :
```html
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <path d="M16 3.128a4 4 0 0 1 0 7.744"/>
            <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
            <circle cx="9" cy="7" r="4"/>
          </svg>
```
par :
```html
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <path d="M16 3.128a4 4 0 0 1 0 7.744"/>
            <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
            <circle cx="9" cy="7" r="4"/>
          </svg>
```

- [ ] **Step 2 : Ajouter le CSS du dock #theme-dock**

Après le bloc CSS de `#share-collab-dock` (qui se termine ~ligne 623), ajouter :

```css
      /* ===== DOCK THÈME (bas gauche) ===== */
      #theme-dock {
        position: fixed;
        bottom: 16px;
        left: 16px;
        z-index: 300;
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 12px;
      }
```

- [ ] **Step 3 : Masquer #theme-dock en preview-mode**

Dans le sélecteur `body.preview-mode` qui liste les éléments masqués (autour de la ligne 468), ajouter `body.preview-mode #theme-dock,` dans la liste, par exemple après `body.preview-mode #share-collab-dock,` :

```css
      body.preview-mode #share-collab-dock,
      body.preview-mode #theme-dock,
```

- [ ] **Step 4 : Masquer #theme-dock en readonly-mode**

Dans le sélecteur `body.readonly-mode` (autour de la ligne 2478), ajouter après `body.readonly-mode #collab-btn,` :

```css
      body.readonly-mode #collab-btn,
      body.readonly-mode #theme-dock,
```

- [ ] **Step 5 : Ajouter le HTML du dock #theme-dock**

Juste avant la div `<div id="broken-images-banner"...` (ligne ~2974), insérer :

```html
      <div id="theme-dock">
        <button id="theme-toggle-btn" class="collab-btn" title="Basculer mode clair / sombre">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>
          </svg>
        </button>
      </div>
```

(Le bouton affiche la lune par défaut car le mode par défaut est dark. Le JS mettra à jour l'icône via `_updateThemeIcon()`.)

- [ ] **Step 6 : Vérifier manuellement**

  1. Recharger l'extension
  2. Ouvrir un board
  3. Vérifier que le bouton apparaît en bas à gauche (48×48, même style que les boutons du dock droite)
  4. Vérifier que le bouton disparaît en mode preview (Ctrl+P ou bouton preview)
  5. `document.body.classList.add('light-mode')` dans la console : icônes dock droite deviennent sombres

- [ ] **Step 7 : Commit**

```bash
git add index.html
git commit -m "feat: dock theme bas-gauche + icônes currentColor"
```

---

### Task 3 : JS — persistance thème, toggle, icône

**Files:**
- Modify: `app.js:161` (`saveCurrentBoard`), `app.js:444` (`setupUIEvents`), `app.js:1148` (`openBoard`), `app.js:1238` (`goHome`)

**Interfaces:**
- Consomme: `#theme-toggle-btn` du DOM (Task 2), tokens `body.light-mode` (Task 1)
- Produit: `board.theme` persisté dans `boards[]` via `saveBoards()`

- [ ] **Step 1 : Ajouter `_updateThemeIcon()` et `toggleTheme()` dans app.js**

Ces deux fonctions sont à ajouter juste avant `function setupUIEvents()` (ligne 444).

```js
  const _ICON_MOON = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>';
  const _ICON_SUN = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';

  function _updateThemeIcon() {
    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;
    const isLight = document.body.classList.contains('light-mode');
    btn.innerHTML = isLight ? _ICON_SUN : _ICON_MOON;
    btn.title = isLight ? 'Passer en mode sombre' : 'Passer en mode clair';
  }

  function toggleTheme() {
    document.body.classList.toggle('light-mode');
    _updateThemeIcon();
    saveCurrentBoard();
  }
```

- [ ] **Step 2 : Brancher l'event listener dans `setupUIEvents()`**

Dans `setupUIEvents()` (ligne 444), après la ligne `addEvt('back-btn', 'click', () => goHome());` (ligne 476), ajouter :

```js
    addEvt('theme-toggle-btn', 'click', toggleTheme);
```

- [ ] **Step 3 : Persister `board.theme` dans `saveCurrentBoard()`**

Dans `saveCurrentBoard()` (ligne 161), avant `board.savedAt = Date.now();` (ligne 222), ajouter :

```js
    board.theme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
```

Le contexte doit ressembler à :
```js
    board.elements = elements;
    board.theme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
    board.savedAt = Date.now();
    saveBoards();
```

- [ ] **Step 4 : Appliquer le thème dans `openBoard()`**

Dans `openBoard()` (ligne 1148), à l'intérieur du callback `setTimeout(() => { ... }, 0)`, après `updateZoomDisplay();` (ligne 1220), ajouter :

```js
        const _theme = board.theme || 'dark';
        document.body.classList.toggle('light-mode', _theme === 'light');
        _updateThemeIcon();
```

Le contexte doit ressembler à :
```js
        applyTransform();
        updateZoomDisplay();
        const _theme = board.theme || 'dark';
        document.body.classList.toggle('light-mode', _theme === 'light');
        _updateThemeIcon();
        if (board.elements && board.elements.length) {
```

- [ ] **Step 5 : Nettoyer `light-mode` dans `goHome()`**

Dans `goHome()` (ligne 1238), ajouter `document.body.classList.remove('light-mode');` **après** le bloc `try/catch` qui appelle `saveCurrentBoard()` et **avant** `document.getElementById('board-screen').style.display = 'none'`. Cet ordre garantit que le thème est sauvegardé avant d'être retiré.

Le résultat doit ressembler à :
```js
    document.body.classList.remove('readonly-mode');
    try {
      saveCurrentBoard();
    } catch (e) {
      console.warn('Erreur sauvegarde:', e);
    }
    document.body.classList.remove('light-mode');
    document.getElementById('board-screen').style.display = 'none';
```

- [ ] **Step 6 : Vérifier manuellement — scénario complet**

  1. Recharger l'extension
  2. Ouvrir un board — icône lune visible en bas à gauche, mode sombre
  3. Cliquer le bouton → mode clair, icône soleil, fond `#F2F2F2`
  4. Cliquer à nouveau → retour dark, icône lune
  5. Repasser en clair, cliquer "Retour" (back-btn) → retour home, corps sans `light-mode`
  6. Rouvrir le même board → mode clair restauré automatiquement, icône soleil
  7. Ouvrir un autre board → mode sombre (par défaut), icône lune
  8. Revenir au premier board → mode clair toujours là

- [ ] **Step 7 : Commit**

```bash
git add app.js
git commit -m "feat: persistance thème clair/sombre par board"
```
