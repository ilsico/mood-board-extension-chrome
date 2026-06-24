# Guide de format papier — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un bouton "Guide de format papier" qui affiche un cadre en pointillés orange sur le canvas représentant un format papier (A3/A4/A5 ou personnalisé), et qui contraint l'export à recadrer exactement sur ce cadre.

**Architecture:** Un `<div id="paper-frame">` injecté dynamiquement dans `#canvas` (coordonnées canvas), piloté par un objet `_paperFrame` en mémoire. `captureBoard()` vérifie `_paperFrame.active` et utilise ses coordonnées à la place du bounding-box habituel. Le panel flottant `#paper-format-panel` est ancré au-dessus du `#theme-dock` (bas gauche).

**Tech Stack:** HTML/CSS/JS vanilla (Chrome Extension MV3), html2canvas, jsPDF déjà présents.

## Global Constraints

- Zéro `console.log` ajouté dans app.js ou index.html
- Structure IIFE `App = (function(){...})()` préservée — tout le JS reste à l'intérieur
- Pas de refactoring non demandé, ne modifier que ce qui est listé
- Couleur du cadre : `#ff3c00` (même orange que le curseur et les accents de l'app)
- Fichiers modifiés : `index.html` et `app.js` uniquement

---

## Fichiers modifiés

| Fichier | Zone | Changement |
|---------|------|------------|
| `index.html` | CSS ~ligne 913 | Styles `#paper-format-panel`, `.pfp-*`, `#paper-frame`, `#paper-frame-handle`, light-mode, preview/readonly |
| `index.html` | HTML ~ligne 3052 | Bouton `#paper-format-btn` dans `#theme-dock` |
| `index.html` | HTML ~ligne 3057 | `<div id="paper-format-panel">` après `#theme-dock` |
| `app.js` | ~ligne 64 | Variable `_paperFrame` + `_pfpPrevUnit` |
| `app.js` | ~ligne 7928 | Constantes `_PAPER_FORMATS` + helpers de conversion |
| `app.js` | ~ligne 7931 | Fonctions `openPaperFormatPanel`, `closePaperFormatPanel`, `applyPaperFormat`, `deactivatePaperFormat`, `_initPaperFrameDrag` |
| `app.js` | ~ligne 7933 | Modification `captureBoard()` — crop conditionnel |
| `app.js` | ~ligne 8133 | Modification `exportPDF()` — dimensions PDF réelles |
| `app.js` | ~ligne 496 | Listeners dans `setupUIEvents()` |
| `app.js` | ~ligne 1247 | Appel `deactivatePaperFormat()` dans `goHome()` |
| `app.js` | ~ligne 8729 | Exposer `deactivatePaperFormat` dans le `return` de l'IIFE |

---

## Task 1 : HTML + CSS

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces: `#paper-format-btn`, `#paper-format-panel`, CSS classes `.pfp-preset-btn`, `.pfp-orient-btn`, `.pfp-action-btn`, `#paper-frame`, `#paper-frame-handle`

- [ ] **Step 1 : Ajouter les styles CSS du panel et du cadre**

Dans `index.html`, après le bloc CSS de `#export-panel` (autour de la ligne 990), insérer :

```css
      /* ===== GUIDE FORMAT PAPIER ===== */
      #paper-format-panel {
        position: fixed;
        bottom: 76px;
        left: 16px;
        background: var(--bg-app);
        border-radius: 8px;
        display: none;
        flex-direction: column;
        z-index: 400;
        padding: 12px;
        gap: 8px;
        width: 268px;
      }
      #paper-format-panel.active {
        display: flex;
      }
      .pfp-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .pfp-spacer { flex: 1; }
      .pfp-preset-btn {
        background: var(--bg-input);
        border: 1.5px solid transparent;
        border-radius: 4px;
        color: var(--fg);
        font-size: 12px;
        font-weight: 600;
        font-family: 'Inter', sans-serif;
        padding: 0 10px;
        height: 28px;
        cursor: pointer;
        transition: border-color 0.12s;
      }
      .pfp-preset-btn:hover { border-color: rgba(255,255,255,0.2); }
      .pfp-preset-btn.active { border-color: var(--fg); }
      .pfp-orient-btn {
        background: var(--bg-input);
        border: 1.5px solid transparent;
        border-radius: 4px;
        color: var(--fg);
        font-size: 14px;
        width: 28px;
        height: 28px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: border-color 0.12s;
      }
      .pfp-orient-btn.active { border-color: var(--fg); }
      .pfp-sep {
        border: none;
        border-top: 1px solid rgba(255,255,255,0.08);
        margin: 0;
      }
      #pfp-w-input, #pfp-h-input {
        flex: 1;
        background: var(--bg-input);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 4px;
        color: var(--fg);
        font-size: 12px;
        font-family: 'Inter', sans-serif;
        padding: 4px 6px;
        height: 28px;
        min-width: 0;
        outline: none;
      }
      #pfp-unit-select {
        background: var(--bg-input);
        border: none;
        border-radius: 4px;
        color: var(--fg);
        font-size: 12px;
        font-family: 'Inter', sans-serif;
        padding: 4px 6px;
        height: 28px;
        cursor: pointer;
        outline: none;
      }
      .pfp-x {
        color: var(--fg);
        font-size: 12px;
        opacity: 0.5;
        flex-shrink: 0;
      }
      .pfp-action-btn {
        flex: 1;
        background: var(--bg-input);
        border: 1.5px solid transparent;
        border-radius: 4px;
        color: var(--fg);
        font-size: 12px;
        font-weight: 600;
        font-family: 'Inter', sans-serif;
        height: 28px;
        cursor: pointer;
        transition: border-color 0.12s, background 0.12s;
      }
      .pfp-apply { border-color: var(--fg); }
      .pfp-apply:hover { background: var(--fg); color: var(--fg-inv); }
      .pfp-deactivate:hover { border-color: rgba(255,60,0,0.5); }
      /* Cadre format papier sur le canvas */
      #paper-frame {
        position: absolute;
        pointer-events: none;
        z-index: 9999;
        border: 2px dashed #ff3c00;
        box-sizing: border-box;
        background: transparent;
      }
      #paper-frame-handle {
        position: absolute;
        top: 0;
        left: 0;
        width: 24px;
        height: 24px;
        pointer-events: auto;
        cursor: move;
        background: #ff3c00;
        border-radius: 0 0 4px 0;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.75;
      }
      #paper-frame-handle:hover { opacity: 1; }
      /* Light mode */
      body.light-mode .pfp-preset-btn,
      body.light-mode .pfp-orient-btn,
      body.light-mode .pfp-action-btn,
      body.light-mode #pfp-unit-select {
        background: var(--bg-input);
        color: #222222;
      }
      body.light-mode .pfp-preset-btn:hover { border-color: rgba(0,0,0,0.2); }
      body.light-mode .pfp-preset-btn.active,
      body.light-mode .pfp-orient-btn.active { border-color: #222222; }
      body.light-mode .pfp-apply { border-color: #222222; }
      body.light-mode .pfp-apply:hover { background: #222222; color: #F2F2F2; }
      body.light-mode .pfp-sep { border-top-color: rgba(0,0,0,0.1); }
      body.light-mode #pfp-w-input,
      body.light-mode #pfp-h-input {
        background: var(--bg-input);
        border-color: rgba(0,0,0,0.15);
        color: #222222;
      }
      body.light-mode #paper-format-btn.active svg {
        color: var(--fg-inv) !important;
      }
      /* Preview mode + readonly */
      body.preview-mode #paper-format-panel,
      body.preview-mode #paper-format-btn { display: none !important; }
      body.readonly-mode #paper-format-btn { display: none; }
```

- [ ] **Step 2 : Ajouter le style d'état actif du bouton**

Dans `index.html`, après la règle `#collab-btn.collab-active` (~ligne 721), insérer :

```css
      #paper-format-btn.active {
        background: var(--fg) !important;
        color: var(--fg-inv) !important;
      }
```

- [ ] **Step 3 : Ajouter le bouton dans `#theme-dock`**

Dans `index.html`, dans `#theme-dock` (~ligne 3051), après le `</button>` de `#theme-toggle-btn`, insérer :

```html
        <button id="paper-format-btn" class="collab-btn" title="Guide de format papier">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
            <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
          </svg>
        </button>
```

- [ ] **Step 4 : Ajouter le panel HTML après `</div>` de `#theme-dock`**

Après la balise `</div>` fermant `#theme-dock` (~ligne 3057), insérer :

```html
      <div id="paper-format-panel">
        <div class="pfp-row">
          <button class="pfp-preset-btn" data-fmt="A5">A5</button>
          <button class="pfp-preset-btn" data-fmt="A4">A4</button>
          <button class="pfp-preset-btn" data-fmt="A3">A3</button>
          <div class="pfp-spacer"></div>
          <button class="pfp-orient-btn active" data-orient="portrait" title="Portrait">↕</button>
          <button class="pfp-orient-btn" data-orient="landscape" title="Paysage">↔</button>
        </div>
        <hr class="pfp-sep" />
        <div class="pfp-row">
          <input type="number" id="pfp-w-input" min="1" step="0.1" placeholder="L" />
          <span class="pfp-x">×</span>
          <input type="number" id="pfp-h-input" min="1" step="0.1" placeholder="H" />
          <select id="pfp-unit-select">
            <option value="mm">mm</option>
            <option value="cm">cm</option>
            <option value="px">px</option>
          </select>
        </div>
        <hr class="pfp-sep" />
        <div class="pfp-row">
          <button id="pfp-apply-btn" class="pfp-action-btn pfp-apply">Appliquer</button>
          <button id="pfp-deactivate-btn" class="pfp-action-btn pfp-deactivate">Désactiver</button>
        </div>
      </div>
```

- [ ] **Step 5 : Vérification manuelle**

Recharger l'extension dans `chrome://extensions`. Ouvrir un board. Vérifier :
- Le bouton feuille apparaît à droite du bouton thème dans le dock bas-gauche, même taille/style
- En mode clair : les couleurs du bouton s'adaptent correctement
- En preview-mode (`Ctrl+P`) : le bouton est invisible

- [ ] **Step 6 : Commit**

```bash
git add index.html
git commit -m "feat: HTML/CSS guide de format papier (bouton + panel + cadre)"
```

---

## Task 2 : Variables d'état, constantes et fonctions JS

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `_PAPER_FORMATS`, `_unitToPx`, `_pxToUnit`, `_mmToUnit`
- Produces:
  - `_paperFrame: { active: bool, x: number, y: number, w: number, h: number, realW_mm: number|null, realH_mm: number|null }`
  - `_pfpPrevUnit: string` ('mm' | 'cm' | 'px')
  - `openPaperFormatPanel(): void`
  - `closePaperFormatPanel(): void`
  - `applyPaperFormat(): void`
  - `deactivatePaperFormat(): void`
  - `_initPaperFrameDrag(handle: HTMLElement): void`

- [ ] **Step 1 : Déclarer `_paperFrame` et `_pfpPrevUnit`**

Dans `app.js`, après la ligne `const _imgStore = new Map();` (~ligne 64), insérer :

```js
  let _paperFrame = { active: false, x: 0, y: 0, w: 0, h: 0, realW_mm: null, realH_mm: null };
  let _pfpPrevUnit = 'mm';
```

- [ ] **Step 2 : Déclarer les constantes et helpers de conversion**

Dans `app.js`, juste avant la ligne `const _EXPORT_SCALES` (~ligne 7928), insérer :

```js
  // ── FORMAT PAPIER ─────────────────────────────────────────────────────────
  const _PAPER_FORMATS = {
    A5: { w: 148, h: 210 },
    A4: { w: 210, h: 297 },
    A3: { w: 297, h: 420 },
  };

  function _unitToPx(val, unit) {
    if (unit === 'mm') return val * 3.7795;
    if (unit === 'cm') return val * 37.795;
    return val;
  }
  function _pxToUnit(px, unit) {
    if (unit === 'mm') return Math.round(px / 3.7795 * 10) / 10;
    if (unit === 'cm') return Math.round(px / 37.795 * 100) / 100;
    return Math.round(px);
  }
  function _mmToUnit(mm, unit) {
    if (unit === 'cm') return Math.round(mm / 10 * 100) / 100;
    if (unit === 'px') return Math.round(mm * 3.7795);
    return mm;
  }
```

- [ ] **Step 3 : Ajouter les fonctions d'ouverture/fermeture du panel**

Immédiatement après les helpers ci-dessus, insérer :

```js
  function openPaperFormatPanel() {
    const panel = document.getElementById('paper-format-panel');
    if (!panel) return;
    if (panel.classList.contains('active')) {
      panel.classList.remove('active');
      return;
    }
    panel.classList.add('active');
  }

  function closePaperFormatPanel() {
    const panel = document.getElementById('paper-format-panel');
    if (panel) panel.classList.remove('active');
  }
```

- [ ] **Step 4 : Ajouter `applyPaperFormat()`**

Immédiatement après `closePaperFormatPanel`, insérer :

```js
  function applyPaperFormat() {
    const wIn = document.getElementById('pfp-w-input');
    const hIn = document.getElementById('pfp-h-input');
    const unit = document.getElementById('pfp-unit-select').value;
    const wVal = parseFloat(wIn.value);
    const hVal = parseFloat(hIn.value);
    if (!wVal || !hVal || wVal <= 0 || hVal <= 0) {
      toast('Dimensions invalides');
      return;
    }
    const wPx = _unitToPx(wVal, unit);
    const hPx = _unitToPx(hVal, unit);

    let realW_mm, realH_mm;
    if (unit === 'mm') { realW_mm = wVal; realH_mm = hVal; }
    else if (unit === 'cm') { realW_mm = wVal * 10; realH_mm = hVal * 10; }
    else { realW_mm = wVal / 3.7795; realH_mm = hVal / 3.7795; }

    const canvasEl = document.getElementById('canvas');
    const els = canvasEl.querySelectorAll('.board-element');
    let cx = 0, cy = 0;
    if (els.length) {
      let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
      els.forEach((el) => {
        const l = parseFloat(el.style.left) || 0;
        const t = parseFloat(el.style.top) || 0;
        const r = l + (el.offsetWidth || 0);
        const b = t + (el.offsetHeight || 0);
        if (l < minL) minL = l;
        if (t < minT) minT = t;
        if (r > maxR) maxR = r;
        if (b > maxB) maxB = b;
      });
      cx = (minL + maxR) / 2;
      cy = (minT + maxB) / 2;
    }

    _paperFrame = { active: true, x: cx - wPx / 2, y: cy - hPx / 2, w: wPx, h: hPx, realW_mm, realH_mm };

    let frame = document.getElementById('paper-frame');
    if (!frame) {
      frame = document.createElement('div');
      frame.id = 'paper-frame';
      const handle = document.createElement('div');
      handle.id = 'paper-frame-handle';
      handle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>';
      frame.appendChild(handle);
      canvasEl.appendChild(frame);
      _initPaperFrameDrag(handle);
    }
    frame.style.left = _paperFrame.x + 'px';
    frame.style.top = _paperFrame.y + 'px';
    frame.style.width = _paperFrame.w + 'px';
    frame.style.height = _paperFrame.h + 'px';

    const btn = document.getElementById('paper-format-btn');
    if (btn) btn.classList.add('active');
    closePaperFormatPanel();
  }
```

- [ ] **Step 5 : Ajouter `deactivatePaperFormat()` et `_initPaperFrameDrag()`**

Immédiatement après `applyPaperFormat`, insérer :

```js
  function deactivatePaperFormat() {
    _paperFrame = { active: false, x: 0, y: 0, w: 0, h: 0, realW_mm: null, realH_mm: null };
    const frame = document.getElementById('paper-frame');
    if (frame) frame.remove();
    const btn = document.getElementById('paper-format-btn');
    if (btn) btn.classList.remove('active');
    closePaperFormatPanel();
  }

  function _initPaperFrameDrag(handle) {
    let startX, startY, startFX, startFY, dragRaf, pendingX, pendingY;

    function onMove(e) {
      pendingX = startFX + (e.clientX - startX);
      pendingY = startFY + (e.clientY - startY);
      if (dragRaf) return;
      dragRaf = requestAnimationFrame(() => {
        dragRaf = null;
        _paperFrame.x = pendingX;
        _paperFrame.y = pendingY;
        const frame = document.getElementById('paper-frame');
        if (frame) {
          frame.style.left = _paperFrame.x + 'px';
          frame.style.top = _paperFrame.y + 'px';
        }
      });
    }

    function onUp() {
      cancelAnimationFrame(dragRaf);
      dragRaf = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      startX = e.clientX;
      startY = e.clientY;
      startFX = _paperFrame.x;
      startFY = _paperFrame.y;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }
```

- [ ] **Step 6 : Exposer `deactivatePaperFormat` dans le `return` de l'IIFE**

Dans `app.js`, dans le bloc `return { ... }` à la fin de l'IIFE (~ligne 8729), après `closeExportModal,` insérer :

```js
    deactivatePaperFormat,
```

- [ ] **Step 7 : Vérification manuelle**

Recharger l'extension. Ouvrir un board. Ouvrir la console DevTools (`F12`).
Taper `App.deactivatePaperFormat()` → aucune erreur, pas de crash.
Le bouton doit ne pas être encore fonctionnel (wiring pas encore fait), c'est normal.

- [ ] **Step 8 : Commit**

```bash
git add app.js
git commit -m "feat: variables et fonctions JS guide de format papier"
```

---

## Task 3 : Event wiring dans `setupUIEvents`

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `openPaperFormatPanel()`, `closePaperFormatPanel()`, `applyPaperFormat()`, `deactivatePaperFormat()`, `_PAPER_FORMATS`, `_mmToUnit()`, `_unitToPx()`, `_pxToUnit()`, `_pfpPrevUnit`
- Produces: Tous les listeners du panel branchés

- [ ] **Step 1 : Ajouter les listeners dans `setupUIEvents`**

Dans `app.js`, dans `setupUIEvents()`, après la ligne `addEvt('theme-toggle-btn', 'click', toggleTheme);` (~ligne 496), insérer :

```js
    // --- Guide format papier ---
    addEvt('paper-format-btn', 'click', openPaperFormatPanel);
    addEvt('pfp-apply-btn', 'click', applyPaperFormat);
    addEvt('pfp-deactivate-btn', 'click', deactivatePaperFormat);

    document.querySelectorAll('.pfp-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pfp-preset-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const fmt = _PAPER_FORMATS[btn.dataset.fmt];
        if (!fmt) return;
        const unit = document.getElementById('pfp-unit-select').value;
        const orient = document.querySelector('.pfp-orient-btn.active')?.dataset.orient || 'portrait';
        const wMm = orient === 'landscape' ? fmt.h : fmt.w;
        const hMm = orient === 'landscape' ? fmt.w : fmt.h;
        document.getElementById('pfp-w-input').value = _mmToUnit(wMm, unit);
        document.getElementById('pfp-h-input').value = _mmToUnit(hMm, unit);
      });
    });

    document.querySelectorAll('.pfp-orient-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pfp-orient-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const activePreset = document.querySelector('.pfp-preset-btn.active');
        if (activePreset) {
          const fmt = _PAPER_FORMATS[activePreset.dataset.fmt];
          if (!fmt) return;
          const unit = document.getElementById('pfp-unit-select').value;
          const orient = btn.dataset.orient;
          const wMm = orient === 'landscape' ? fmt.h : fmt.w;
          const hMm = orient === 'landscape' ? fmt.w : fmt.h;
          document.getElementById('pfp-w-input').value = _mmToUnit(wMm, unit);
          document.getElementById('pfp-h-input').value = _mmToUnit(hMm, unit);
        } else {
          const wIn = document.getElementById('pfp-w-input');
          const hIn = document.getElementById('pfp-h-input');
          const tmp = wIn.value;
          wIn.value = hIn.value;
          hIn.value = tmp;
        }
      });
    });

    const pfpUnitSel = document.getElementById('pfp-unit-select');
    if (pfpUnitSel) {
      pfpUnitSel.addEventListener('change', () => {
        const newUnit = pfpUnitSel.value;
        const wIn = document.getElementById('pfp-w-input');
        const hIn = document.getElementById('pfp-h-input');
        const wPx = _unitToPx(parseFloat(wIn.value) || 0, _pfpPrevUnit);
        const hPx = _unitToPx(parseFloat(hIn.value) || 0, _pfpPrevUnit);
        wIn.value = _pxToUnit(wPx, newUnit);
        hIn.value = _pxToUnit(hPx, newUnit);
        _pfpPrevUnit = newUnit;
      });
    }

    ['pfp-w-input', 'pfp-h-input'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          document.querySelectorAll('.pfp-preset-btn').forEach((b) => b.classList.remove('active'));
        });
      }
    });

    document.addEventListener('mousedown', (e) => {
      const panel = document.getElementById('paper-format-panel');
      if (!panel || !panel.classList.contains('active')) return;
      const pfpBtn = document.getElementById('paper-format-btn');
      if (!panel.contains(e.target) && (!pfpBtn || !pfpBtn.contains(e.target))) {
        closePaperFormatPanel();
      }
    });
```

- [ ] **Step 2 : Vérification manuelle**

Recharger l'extension. Ouvrir un board.
- Cliquer le bouton feuille → le panel s'ouvre
- Cliquer "A4" → les inputs se remplissent avec 210 / 297 mm
- Toggle "Paysage" → les inputs passent à 297 / 210 mm
- Changer l'unité sur "cm" → les inputs se convertissent (~21 / ~29.7 cm)
- Modifier manuellement un input → les boutons de preset se désélectionnent
- Cliquer "Appliquer" → le panel se ferme, le cadre orange pointillé apparaît sur le canvas, le bouton passe en état actif (fond inversé)
- Glisser le handle orange en haut à gauche du cadre → le cadre se déplace
- Rouvrir le panel → "Désactiver" → le cadre disparaît, le bouton repasse en normal
- Clic extérieur au panel → le panel se ferme

- [ ] **Step 3 : Commit**

```bash
git add app.js
git commit -m "feat: wiring événements panel format papier"
```

---

## Task 4 : Modification export (`captureBoard` + `exportPDF`) + reset au changement de board

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `_paperFrame: { active, x, y, w, h, realW_mm, realH_mm }`
- Produces: `captureBoard(exportScale)` retourne `{ canvas, w: cropW, h: cropH }` en utilisant les coordonnées du cadre si actif. `exportPDF` utilise les vraies dimensions mm.

- [ ] **Step 1 : Modifier `captureBoard()` — calcul conditionnel du crop**

Dans `app.js`, dans `captureBoard(exportScale = 2)` (~ligne 7933), remplacer le bloc qui va de `const els = canvasEl.querySelectorAll('.board-element');` jusqu'à `const cropH = contentH + margin * 2;` (lignes ~7936–7964) par :

```js
      let cropX, cropY, cropW, cropH;

      if (_paperFrame.active) {
        cropX = _paperFrame.x;
        cropY = _paperFrame.y;
        cropW = _paperFrame.w;
        cropH = _paperFrame.h;
      } else {
        const els = canvasEl.querySelectorAll('.board-element');
        if (!els.length) {
          reject('Aucun élément sur le board');
          return;
        }
        let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
        els.forEach((el) => {
          const l = parseFloat(el.style.left) || 0;
          const t = parseFloat(el.style.top) || 0;
          const r = l + (el.offsetWidth || parseFloat(el.style.width) || 0);
          const b = t + (el.offsetHeight || parseFloat(el.style.height) || 0);
          if (l < minL) minL = l;
          if (t < minT) minT = t;
          if (r > maxR) maxR = r;
          if (b > maxB) maxB = b;
        });
        const contentW = maxR - minL;
        const contentH = maxB - minT;
        const margin = Math.round(Math.max(contentW, contentH) * 0.05) + 20;
        cropX = minL - margin;
        cropY = minT - margin;
        cropW = contentW + margin * 2;
        cropH = contentH + margin * 2;
      }
```

- [ ] **Step 2 : Retirer `#paper-frame` du clone fantôme**

Dans `captureBoard()`, dans le bloc qui retire les toolbars du `ghostCanvas` (~ligne 7990–7992) :

```js
      ghostCanvas
        .querySelectorAll('.element-toolbar, .resize-handle, .color-eyedropper, .video-play-hint')
        .forEach((el) => el.remove());
```

Ajouter juste après :

```js
      ghostCanvas.querySelector('#paper-frame')?.remove();
```

- [ ] **Step 3 : Modifier `exportPDF()` — dimensions PDF réelles**

Dans `app.js`, dans `exportPDF(quality = 2)` (~ligne 8133), remplacer les lignes :

```js
        const pdf = new jsPDF({
          orientation: w > h ? 'landscape' : 'portrait',
          unit: 'px',
          format: [w, h],
        });
        pdf.addImage(dataUrl, 'JPEG', 0, 0, w, h);
```

par :

```js
        let pdf;
        if (_paperFrame.active && _paperFrame.realW_mm != null) {
          const rw = _paperFrame.realW_mm;
          const rh = _paperFrame.realH_mm;
          pdf = new jsPDF({
            orientation: rw > rh ? 'landscape' : 'portrait',
            unit: 'mm',
            format: [rw, rh],
          });
          pdf.addImage(dataUrl, 'JPEG', 0, 0, rw, rh);
        } else {
          pdf = new jsPDF({
            orientation: w > h ? 'landscape' : 'portrait',
            unit: 'px',
            format: [w, h],
          });
          pdf.addImage(dataUrl, 'JPEG', 0, 0, w, h);
        }
```

- [ ] **Step 4 : Appeler `deactivatePaperFormat()` dans `goHome()`**

Dans `app.js`, dans `goHome()` (~ligne 1247), après la ligne `setConnectorMode(false);`, insérer :

```js
    deactivatePaperFormat();
```

- [ ] **Step 5 : Vérification manuelle — export PNG**

Recharger l'extension. Ouvrir un board, créer quelques éléments.
- Activer le cadre A4 Portrait
- Positionner des éléments à l'intérieur et à l'extérieur du cadre
- Exporter en PNG (qualité Moyenne)
- Vérifier que l'image exportée correspond exactement au cadre orange : éléments hors cadre coupés, zones vides remplies par la couleur de fond
- Vérifier que le cadre lui-même n'apparaît pas dans l'export

- [ ] **Step 6 : Vérification manuelle — export PDF**

- Activer le cadre A4 Portrait
- Exporter en PDF
- Ouvrir le PDF : le format de page doit être A4 (210×297 mm)

- [ ] **Step 7 : Vérification manuelle — export sans cadre inchangé**

- Désactiver le cadre
- Exporter en PNG → comportement habituel (bounding box des éléments + marge 5%)

- [ ] **Step 8 : Vérification manuelle — reset au changement de board**

- Activer un cadre sur le board courant
- Cliquer le bouton Retour (home)
- Rouvrir un autre board → aucun cadre visible, bouton sans état actif

- [ ] **Step 9 : Commit**

```bash
git add app.js
git commit -m "feat: recadrage export strict sur guide de format papier"
```

---

## Checklist de vérification finale

- [ ] Bouton visible dans le dock, même style que les voisins, gap identique
- [ ] Panel s'ouvre/ferme au clic, se ferme au clic extérieur
- [ ] A5/A4/A3 renseignent les dimensions correctes (mm/cm/px)
- [ ] Toggle portrait/paysage permute W et H (preset et custom)
- [ ] Changement d'unité convertit les valeurs affichées sans les perdre
- [ ] Saisie manuelle désélectionne le preset
- [ ] Le cadre orange apparaît centré sur le contenu au clic "Appliquer"
- [ ] Le handle (coin haut-gauche) permet de déplacer le cadre
- [ ] Bouton en état actif (fond inversé) quand le cadre est visible
- [ ] "Désactiver" retire le cadre et remet le bouton en normal
- [ ] Export PNG : zone = exactement le cadre, cadre lui-même absent
- [ ] Export PDF : format de page = dimensions réelles du format sélectionné
- [ ] Export sans cadre actif : comportement habituel inchangé
- [ ] Mode clair : panel et bouton correctement stylisés
- [ ] Preview-mode : bouton et panel masqués
- [ ] Retour home : cadre réinitialisé
