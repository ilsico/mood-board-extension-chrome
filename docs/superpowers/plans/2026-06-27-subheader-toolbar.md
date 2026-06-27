# Subheader Toolbar — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une barre permanente de 37px (`#subheader`) sous `#board-header`, regroupant les contrôles texte, alignement et export, en déplaçant les contrôles existants (mêmes IDs) depuis les trois panneaux flottants qui sont supprimés.

**Architecture:** Les boutons et champs existants sont déplacés dans `#subheader` avec leurs IDs conservés — le JS existant (listeners des boutons) fonctionne sans modification. Six occurrences de `document.getElementById('text-edit-panel')` dans app.js sont patchées pour cibler `.sb-text` à la place. `updateAlignPanel()` est patchée pour griser/dégriser `.sb-align` plutôt que show/hide l'ancien panneau flottant.

**Tech Stack:** HTML/CSS inline dans index.html, JavaScript vanilla IIFE dans app.js, Chrome Extension MV3.

## Global Constraints

- Zéro `console.log` dans app.js ou collab.js
- Ne pas toucher à la structure IIFE `const App = (function(){...})()`
- Pas de refactoring hors scope
- Couleur accentuée : `#ff3c00`
- Tous les IDs des boutons/inputs restent identiques à ceux existants
- `#board-screen` utilise un layout flex colonne — `#subheader` s'insère naturellement

---

### Task 1 : HTML — Ajouter #subheader, supprimer les anciens panneaux

**Files:**
- Modify: `index.html` (section body, autour des lignes 3213-3545)

**Interfaces:**
- Consumes: rien
- Produces: `#subheader` dans le DOM avec `.sb-text.sb-disabled`, `.sb-align.sb-disabled`, `.sb-export` ; IDs `text-size-minus`, `text-size-val`, `text-size-plus`, `tp-roman`, `tp-bold`, `ta-left`, `ta-center`, `ta-right`, `align-left`, `align-center-h`, `align-right`, `distrib-h`, `align-top`, `align-center-v`, `align-bottom`, `distrib-v`, `key-object-toggle`, `export-quality-select`, `export-fmt-pdf`, `export-fmt-png`, `export-do-btn` tous présents et uniques dans le DOM.

- [ ] **Step 1 : Insérer le HTML de #subheader après `</header>` de #board-header (~ligne 3219)**

Localiser `</header>` qui ferme `<header id="board-header">` (~ligne 3219). Insérer juste après :

```html
      <div id="subheader">

        <!-- ── Section Texte ─────────────────────────── -->
        <div class="sb-section sb-text sb-disabled">
          <span class="sb-label">Text.</span>
          <div class="sb-size-wrap">
            <button class="text-size-btn" id="text-size-minus" title="Réduire la taille">
              <svg width="8" height="10" viewBox="0 0 8 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 1L2 5L6 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <span class="text-size-val" id="text-size-val">14</span>
            <button class="text-size-btn" id="text-size-plus" title="Augmenter la taille">
              <svg width="8" height="10" viewBox="0 0 8 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 1L6 5L2 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
          <div class="sb-sep"></div>
          <div class="text-font-btns-row">
            <button class="text-font-btn" id="tp-roman" title="Helvetica Roman">Roman</button>
            <button class="text-font-btn" id="tp-bold" title="Helvetica Bold">Bold</button>
          </div>
          <div class="sb-sep"></div>
          <div class="text-align-btns">
            <button class="text-align-btn" id="ta-left" title="Aligner à gauche">
              <svg width="16" height="14" viewBox="0 0 20 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 3H18M2 8H13M2 13H15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="text-align-btn" id="ta-center" title="Centrer">
              <svg width="16" height="14" viewBox="0 0 20 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 3H18M5 8H15M4 13H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="text-align-btn" id="ta-right" title="Aligner à droite">
              <svg width="16" height="14" viewBox="0 0 20 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 3H18M7 8H18M5 13H18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="sb-sep-major"></div>

        <!-- ── Section Aligner ───────────────────────── -->
        <div class="sb-section sb-align sb-disabled">
          <span class="sb-label">Aligner.</span>
          <div class="align-grid">
            <button class="align-btn" id="align-left" title="Aligner les bords gauches">
              <svg width="20" height="20" viewBox="7 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 1V21M14 13H19C20.1046 13 21 13.8954 21 15V17C21 18.1046 20.1046 19 19 19H14C12.8954 19 12 18.1046 12 17V15C12 13.8954 12.8954 13 14 13ZM14 3H26C27.1046 3 28 3.89543 28 5V7C28 8.10457 27.1046 9 26 9H14C12.8954 9 12 8.10457 12 7V5C12 3.89543 12.8954 3 14 3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="align-btn" id="align-center-h" title="Centrer horizontalement">
              <svg width="20" height="20" viewBox="43 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M54 1V21M50 9H46C45.4696 9 44.9609 8.78929 44.5858 8.41421C44.2107 8.03914 44 7.53043 44 7V5C44 3.9 44.9 3 46 3H50M58 9H62C62.5304 9 63.0391 8.78929 63.4142 8.41421C63.7893 8.03914 64 7.53043 64 7V5C64 4.46957 63.7893 3.96086 63.4142 3.58579C63.0391 3.21071 62.5304 3 62 3H58M50 19H49C48.4696 19 47.9609 18.7893 47.5858 18.4142C47.2107 18.0391 47 17.5304 47 17V15C47 13.9 47.9 13 49 13H50M58 13H59C59.5304 13 60.0391 13.2107 60.4142 13.5858C60.7893 13.9609 61 14.4696 61 15V17C61 17.5304 60.7893 18.0391 60.4142 18.4142C60.0391 18.7893 59.5304 19 59 19H58" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="align-btn" id="align-right" title="Aligner les bords droits">
              <svg width="20" height="20" viewBox="79 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M100 21V1M82 3H94C95.1046 3 96 3.89543 96 5V7C96 8.10457 95.1046 9 94 9H82C80.8954 9 80 8.10457 80 7V5C80 3.89543 80.8954 3 82 3ZM89 13H94C95.1046 13 96 13.8954 96 15V17C96 18.1046 95.1046 19 94 19H89C87.8954 19 87 18.1046 87 17V15C87 13.8954 87.8954 13 89 13Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="align-btn" id="distrib-h" title="Répartir l'espacement horizontal">
              <svg width="20" height="20" viewBox="115 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M132.25 21V16M132.25 6V1M119.75 21V18M119.75 4V1M118.5 4H121C122.381 4 123.5 4.89543 123.5 6V16C123.5 17.1046 122.381 18 121 18H118.5C117.119 18 116 17.1046 116 16V6C116 4.89543 117.119 4 118.5 4ZM131 6H133.5C134.881 6 136 6.89543 136 8V14C136 15.1046 134.881 16 133.5 16H131C129.619 16 128.5 15.1046 128.5 14V8C128.5 6.89543 129.619 6 131 6Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="align-btn" id="align-top" title="Aligner les bords supérieurs">
              <svg width="20" height="20" viewBox="7 32 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M28 33H8M12 37H14C15.1046 37 16 37.8954 16 39V51C16 52.1046 15.1046 53 14 53H12C10.8954 53 10 52.1046 10 51V39C10 37.8954 10.8954 37 12 37ZM22 37H24C25.1046 37 26 37.8954 26 39V44C26 45.1046 25.1046 46 24 46H22C20.8954 46 20 45.1046 20 44V39C20 37.8954 20.8954 37 22 37Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="align-btn" id="align-center-v" title="Centrer verticalement">
              <svg width="20" height="20" viewBox="43 32 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M44 43H64M52 47V51C52 51.5304 51.7893 52.0391 51.4142 52.4142C51.0391 52.7893 50.5304 53 50 53H48C47.4696 53 46.9609 52.7893 46.5858 52.4142C46.2107 52.0391 46 51.5304 46 51V47M52 39V35C52 34.4696 51.7893 33.9609 51.4142 33.5858C51.0391 33.2107 50.5304 33 50 33H48C47.4696 33 46.9609 33.2107 46.5858 33.5858C46.2107 33.9609 46 34.4696 46 35V39M62 47V48C62 48.5304 61.7893 49.0391 61.4142 49.4142C61.0391 49.7893 60.5304 50 60 50H58C57.4696 50 56.9609 49.7893 56.5858 49.4142C56.2107 49.0391 56 48.5304 56 48V47M56 39V38C56 36.9 56.9 36 58 36H60C60.5304 36 61.0391 36.2107 61.4142 36.5858C61.7893 36.9609 62 37.4696 62 38V39" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="align-btn" id="align-bottom" title="Aligner les bords inférieurs">
              <svg width="20" height="20" viewBox="79 32 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M100 53H80M84 33H86C87.1046 33 88 33.8954 88 35V47C88 48.1046 87.1046 49 86 49H84C82.8954 49 82 48.1046 82 47V35C82 33.8954 82.8954 33 84 33ZM94 40H96C97.1046 40 98 40.8954 98 42V47C98 48.1046 97.1046 49 96 49H94C92.8954 49 92 48.1046 92 47V42C92 40.8954 92.8954 40 94 40Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="align-btn" id="distrib-v" title="Répartir l'espacement vertical">
              <svg width="20" height="20" viewBox="115 32 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M136 49.25H133M136 36.75H131M119 49.25H116M121 36.75H116M121 45.5H131C132.105 45.5 133 46.6193 133 48V50.5C133 51.8807 132.105 53 131 53H121C119.895 53 119 51.8807 119 50.5V48C119 46.6193 119.895 45.5 121 45.5ZM123 33H129C130.105 33 131 34.1193 131 35.5V38C131 39.3807 130.105 40.5 129 40.5H123C121.895 40.5 121 39.3807 121 38V35.5C121 34.1193 121.895 33 123 33Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
          <button id="key-object-toggle" title="Aligner sur objet clé">Objet clé</button>
        </div>

        <div class="sb-sep-major"></div>

        <!-- ── Section Export ────────────────────────── -->
        <div class="sb-section sb-export">
          <div class="export-select-wrap">
            <select id="export-quality-select">
              <option value="1">Basse qualité</option>
              <option value="2" selected>Bonne qualité</option>
              <option value="3">Meilleure qualité</option>
            </select>
          </div>
          <div class="export-panel-actions">
            <button class="export-fmt-btn" id="export-fmt-pdf">PDF</button>
            <button class="export-fmt-btn active" id="export-fmt-png">PNG</button>
            <button id="export-do-btn">Exporter</button>
          </div>
        </div>

      </div><!-- /#subheader -->
```

- [ ] **Step 2 : Supprimer les trois panneaux flottants du HTML**

Localiser et supprimer entièrement ces trois blocs dans `index.html` (~lignes 3446-3545) :

```
<div id="text-edit-panel">...</div>   ← supprimer
<div id="align-panel">...</div>       ← supprimer
<div id="export-panel">...</div>      ← supprimer
```

Vérifier que les balises `<div class="canvas-wrapper" id="canvas-wrapper">` et suivantes restent en place.

- [ ] **Step 3 : Supprimer le bouton #tool-export du dock**

Dans `#share-collab-dock`, supprimer ce bloc :

```html
        <button id="tool-export" class="collab-btn" title="Exporter">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
            <path d="M12 10v6"/>
            <path d="m15 13-3 3-3-3"/>
          </svg>
        </button>
```

- [ ] **Step 4 : Vérification manuelle — structure HTML**

Recharger l'extension (`chrome://extensions` → Actualiser). Ouvrir un board.

Attendu (DevTools → Elements) :
- `#subheader` présent juste après `#board-header`
- Trois `.sb-section` dans le subheader
- `.sb-text` et `.sb-align` ont la classe `sb-disabled`
- Aucun ID dupliqué (vérifier via `document.querySelectorAll('[id]')` dans la console)
- Aucune erreur JS dans la console

- [ ] **Step 5 : Commit**

```bash
git add index.html
git commit -m "feat: HTML #subheader — déplacer contrôles, supprimer panneaux flottants"
```

---

### Task 2 : CSS — Styler le #subheader

**Files:**
- Modify: `index.html` (bloc `<style>`)

**Interfaces:**
- Consumes: `#subheader` HTML de Task 1
- Produces: barre 37px visuellement correcte, sections grisées au bon endroit, boutons stylés, masquage en preview/readonly

- [ ] **Step 1 : Ajouter les styles #subheader après la règle `#board-header { ... }`**

Localiser `#board-header {` (~ligne 377). Après le `}` fermant cette règle, insérer le bloc CSS suivant :

```css
      /* ===== SUBHEADER ===== */
      #subheader {
        width: 100%;
        height: 37px;
        background: var(--bg-app);
        border-bottom: 1px solid rgba(0, 0, 0, 0.12);
        display: flex;
        align-items: center;
        flex-shrink: 0;
        z-index: 199;
        overflow: hidden;
      }
      .sb-section {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 0 10px;
        height: 100%;
      }
      .sb-section.sb-disabled {
        opacity: 0.35;
        pointer-events: none;
      }
      .sb-label {
        font-size: 10px;
        font-family: 'HelveticaBold', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        color: var(--fg);
        opacity: 0.45;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-right: 4px;
        white-space: nowrap;
      }
      .sb-sep {
        width: 1px;
        height: 16px;
        background: var(--fg);
        opacity: 0.15;
        flex-shrink: 0;
        margin: 0 4px;
      }
      .sb-sep-major {
        width: 1px;
        height: 24px;
        background: var(--fg);
        opacity: 0.25;
        flex-shrink: 0;
      }
      /* Size picker */
      .sb-size-wrap {
        display: flex;
        align-items: center;
        background: var(--bg-input);
        border-radius: 4px;
        padding: 0 2px;
        height: 22px;
      }
      #subheader .text-size-btn {
        width: 18px;
        height: 22px;
        background: none;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: var(--fg);
        padding: 0;
      }
      #subheader .text-size-val {
        min-width: 22px;
        text-align: center;
        font-size: 12px;
        font-family: 'HelveticaBold', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        color: var(--fg);
        user-select: none;
      }
      /* Style et alignement texte */
      #subheader .text-font-btns-row {
        display: flex;
        gap: 2px;
      }
      #subheader .text-align-btns {
        display: flex;
        gap: 2px;
      }
      #subheader .text-font-btn,
      #subheader .text-align-btn {
        width: 26px;
        height: 26px;
        border: none;
        background: none;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: var(--fg);
        transition: background 0.12s;
        font-size: 11px;
        font-family: 'HelveticaBold', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        padding: 0;
      }
      #subheader .text-font-btn:hover,
      #subheader .text-align-btn:hover {
        background: var(--bg-input);
      }
      #subheader .text-font-btn.active,
      #subheader .text-align-btn.active {
        background: var(--fg);
        color: var(--fg-inv);
      }
      /* Grille d'alignement */
      #subheader .align-grid {
        display: flex;
        gap: 2px;
      }
      #subheader .align-btn {
        width: 26px;
        height: 26px;
        border: none;
        background: none;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: var(--fg);
        transition: background 0.12s;
        padding: 0;
        overflow: hidden;
      }
      #subheader .align-btn:hover {
        background: var(--bg-input);
      }
      #subheader .align-btn.active {
        background: var(--fg);
        color: var(--fg-inv);
      }
      /* Objet clé */
      #subheader #key-object-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-family: 'HelveticaBold', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        padding: 0 6px;
        height: 22px;
        width: auto;
        border: 1px solid var(--fg);
        border-radius: 4px;
        background: none;
        color: var(--fg);
        cursor: pointer;
        white-space: nowrap;
        opacity: 0.6;
        margin-left: 4px;
        transition: background 0.12s, border-color 0.12s;
      }
      #subheader #key-object-toggle:hover {
        opacity: 1;
        background: var(--bg-input);
      }
      #subheader #key-object-toggle.active {
        background: rgba(220, 65, 17, 0.15);
        border-color: #ff3c00;
        color: #ff3c00;
        opacity: 1;
      }
      /* Section export */
      #subheader .export-select-wrap {
        display: flex;
        align-items: center;
      }
      #subheader #export-quality-select {
        height: 22px;
        font-size: 11px;
        font-family: 'HelveticaBold', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        border: 1px solid var(--fg);
        border-radius: 4px;
        background: var(--bg-app);
        color: var(--fg);
        padding: 0 4px;
        cursor: pointer;
      }
      #subheader .export-panel-actions {
        display: flex;
        gap: 4px;
        align-items: center;
        margin-left: 4px;
      }
      #subheader .export-fmt-btn {
        height: 22px;
        padding: 0 8px;
        font-size: 11px;
        font-family: 'HelveticaBold', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        border: 1px solid var(--fg);
        border-radius: 4px;
        background: none;
        color: var(--fg);
        cursor: pointer;
        transition: background 0.12s, color 0.12s;
      }
      #subheader .export-fmt-btn.active {
        background: var(--fg);
        color: var(--fg-inv);
      }
      #subheader #export-do-btn {
        height: 22px;
        padding: 0 10px;
        background: #ff3c00;
        color: #fff;
        border: none;
        border-radius: 4px;
        font-size: 11px;
        font-family: 'HelveticaBold', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        cursor: pointer;
        transition: opacity 0.12s;
      }
      #subheader #export-do-btn:hover {
        opacity: 0.85;
      }
```

- [ ] **Step 2 : Ajouter #subheader aux règles de masquage preview/readonly**

Localiser le bloc qui commence par `body.preview-mode #header,` (~ligne 548). Ajouter `body.preview-mode #subheader,` à cette liste.

Localiser le bloc qui commence par `body.readonly-mode #toolbar,` (~ligne 2750). Ajouter `body.readonly-mode #subheader,` à cette liste.

- [ ] **Step 3 : Supprimer les styles des anciens panneaux flottants**

Dans `<style>`, supprimer les blocs suivants (devenus orphelins) :
- `#text-edit-panel { ... }` (~ligne 824)
- `body.light-mode #text-edit-panel { ... }` (~ligne 102)
- `#text-edit-panel.active { ... }` (~ligne 840)
- `#align-panel { ... }` (~ligne 843)
- `#align-panel.active { ... }` (~ligne 858)
- `.align-panel-title { ... }` (~ligne 861)
- `#export-panel { ... }` (~ligne 932 et ses sous-règles)

**Ne pas supprimer** : `.align-grid`, `.align-btn`, `.text-align-btn`, `.text-font-btn`, `.text-size-btn`, `.text-size-val`, `.text-font-btns-row`, `.text-align-btns`, `#key-object-toggle` — ces sélecteurs sans préfixe `#subheader` peuvent coexister ; les règles `#subheader .xxx` les overrident pour les boutons du subheader.

- [ ] **Step 4 : Supprimer le style #tool-export du dock**

Localiser et supprimer le bloc :
```css
      #tool-export {
        line-height: 0;
      }
```

- [ ] **Step 5 : Vérification manuelle — visuel**

Recharger l'extension. Ouvrir un board.

Attendu :
- Barre 37px visible, fond correspondant au thème courant
- "Text." et "Aligner." grisés (opacity ~0.35)
- Section Export complète : sélecteur de qualité, [PDF] [PNG] (PNG actif/surligné), bouton [Exporter] orange
- Séparateurs fins entre sections
- Hover sur les boutons non-grisés → léger fond
- Passer en mode preview (raccourci ou URL) → barre disparaît

- [ ] **Step 6 : Commit**

```bash
git add index.html
git commit -m "feat: CSS #subheader — styles sections, masquage preview/readonly"
```

---

### Task 3 : app.js — Patcher les références aux panneaux supprimés

**Files:**
- Modify: `app.js` (8 occurrences à patcher + suppression de 4 fonctions mortes)

**Interfaces:**
- Consumes: `.sb-text`, `.sb-align`, `.sb-disabled` du DOM (Tasks 1+2)
- Produces: section Text active pendant l'édition note/caption ; section Aligner active pendant multi-sélection ; export fonctionnel ; aucun appel mort à `getElementById('text-edit-panel')` ou `getElementById('align-panel')`

- [ ] **Step 1 : Patcher `updateAlignPanel()` (~ligne 6998)**

Remplacer le corps complet de la fonction :

```js
// AVANT
function updateAlignPanel() {
  const panel = document.getElementById('align-panel');
  if (!panel) return;
  const toolbar = document.getElementById('toolbar');
  const textPanel = document.getElementById('text-edit-panel');
  if (multiSelected.size >= 2) {
    if (toolbar) toolbar.style.display = 'none';
    panel.classList.add('active');
    if (_keyObject && !multiSelected.has(_keyObject)) {
      _keyObject.classList.remove('key-object');
      _keyObject = null;
    }
  } else {
    panel.classList.remove('active');
    if (toolbar && textPanel && !textPanel.classList.contains('active')) {
      toolbar.style.display = '';
    }
    _keyObjectMode = false;
    if (_keyObject) {
      _keyObject.classList.remove('key-object');
      _keyObject = null;
    }
    const toggle = document.getElementById('key-object-toggle');
    if (toggle) toggle.classList.remove('active');
  }
  updateExportPanelPosition();
}
```

Par :

```js
// APRÈS
function updateAlignPanel() {
  const sbAlign = document.querySelector('.sb-align');
  const sbText = document.querySelector('.sb-text');
  const toolbar = document.getElementById('toolbar');
  if (multiSelected.size >= 2) {
    if (toolbar) toolbar.style.display = 'none';
    if (sbAlign) sbAlign.classList.remove('sb-disabled');
    if (_keyObject && !multiSelected.has(_keyObject)) {
      _keyObject.classList.remove('key-object');
      _keyObject = null;
    }
  } else {
    if (sbAlign) sbAlign.classList.add('sb-disabled');
    if (toolbar && sbText && sbText.classList.contains('sb-disabled')) {
      toolbar.style.display = '';
    }
    _keyObjectMode = false;
    if (_keyObject) {
      _keyObject.classList.remove('key-object');
      _keyObject = null;
    }
    const toggle = document.getElementById('key-object-toggle');
    if (toggle) toggle.classList.remove('active');
  }
}
```

- [ ] **Step 2 : Patcher `showTextEditPanel(el)` (~ligne 7166)**

Remplacer ces quatre lignes dans `showTextEditPanel` :

```js
// AVANT (lignes ~7169-7173)
    const alignPanel = document.getElementById('align-panel');
    if (alignPanel) alignPanel.classList.remove('active');
    const panel = document.getElementById('text-edit-panel');
    panel.classList.add('active');
    updateExportPanelPosition();
```

Par :

```js
// APRÈS
    document.querySelector('.sb-text')?.classList.remove('sb-disabled');
```

Supprimer également le bloc du mousedown guard sur `panel` (~lignes 7190-7198) :

```js
// SUPPRIMER ce bloc entier
    if (!panel._mousedownGuard) {
      panel._mousedownGuard = true;
      panel.addEventListener('mousedown', () => {
        window._textPanelKeepOpen = true;
      });
      panel.addEventListener('mouseup', () => {
        window._textPanelKeepOpen = false;
      });
    }
```

- [ ] **Step 3 : Patcher `hideTextEditPanel()` (~ligne 7200)**

Remplacer :

```js
// AVANT
  function hideTextEditPanel() {
    document.getElementById('text-edit-panel').classList.remove('active');
    textEditTarget = null;
    updateAlignPanel();
  }
```

Par :

```js
// APRÈS
  function hideTextEditPanel() {
    document.querySelector('.sb-text')?.classList.add('sb-disabled');
    textEditTarget = null;
    updateAlignPanel();
  }
```

- [ ] **Step 4 : Patcher le mousedown listener global dans `setupCanvasEvents()` (~ligne 354)**

Remplacer :

```js
// AVANT
      (e) => {
        if (e.detail >= 2) return;
        const panel = document.getElementById('text-edit-panel');
        if (!panel || !panel.classList.contains('active')) return;
        if (panel.contains(e.target)) return;
        if (
          e.target.closest('.board-element[data-editing="1"]') ||
          e.target.closest('.el-caption:focus')
        )
          return;
        const ta = document.querySelector('.board-element[data-editing="1"] textarea');
        if (ta) {
          ta.blur();
        } else {
          hideTextEditPanel();
        }
      },
```

Par :

```js
// APRÈS
      (e) => {
        if (e.detail >= 2) return;
        const sbText = document.querySelector('.sb-text');
        if (!sbText || sbText.classList.contains('sb-disabled')) return;
        if (sbText.contains(e.target)) return;
        if (
          e.target.closest('.board-element[data-editing="1"]') ||
          e.target.closest('.el-caption:focus')
        )
          return;
        const ta = document.querySelector('.board-element[data-editing="1"] textarea');
        if (ta) {
          ta.blur();
        } else {
          hideTextEditPanel();
        }
      },
```

- [ ] **Step 5 : Ajouter le mousedown guard sur `.sb-text` dans `setupUIEvents()`**

Le mousedown guard qui était créé à chaque appel de `showTextEditPanel` doit maintenant être initialisé une seule fois. Localiser la fonction `setupUIEvents()` (~ligne 761). Au début du corps de la fonction (avant les `addEvt(...)`) ajouter :

```js
    // Guard mousedown pour garder sb-text actif quand on clique ses boutons
    const _sbText = document.querySelector('.sb-text');
    if (_sbText) {
      _sbText.addEventListener('mousedown', () => { window._textPanelKeepOpen = true; });
      _sbText.addEventListener('mouseup',   () => { window._textPanelKeepOpen = false; });
    }
```

- [ ] **Step 6 : Patcher les deux blur handlers de textarea (~lignes 3207-3210 et 5611-5613)**

**Occurrence 1 (~ligne 3207)** — blur du textarea de note :

Remplacer :

```js
      const panel = document.getElementById('text-edit-panel');
      const goingToPanel = panel && e.relatedTarget && panel.contains(e.relatedTarget);
      if (goingToPanel || window._textPanelKeepOpen) return;
```

Par :

```js
      const sbText = document.querySelector('.sb-text');
      const goingToPanel = sbText && e.relatedTarget && sbText.contains(e.relatedTarget);
      if (goingToPanel || window._textPanelKeepOpen) return;
```

**Occurrence 2 (~ligne 5611)** — second blur textarea (chercher l'autre occurrence identique dans app.js) : même remplacement exact.

- [ ] **Step 7 : Patcher `handleCaptionBlur()` (~ligne 7207)**

Remplacer :

```js
  function handleCaptionBlur(e, cap) {
    const panel = document.getElementById('text-edit-panel');
    const goingToPanel = panel && e.relatedTarget && panel.contains(e.relatedTarget);

    // Si on clique vers le panneau de texte, on ne ferme pas
    if (goingToPanel || window._textPanelKeepOpen) return;
```

Par :

```js
  function handleCaptionBlur(e, cap) {
    const sbText = document.querySelector('.sb-text');
    const goingToPanel = sbText && e.relatedTarget && sbText.contains(e.relatedTarget);

    // Si on clique vers le subheader texte, on ne ferme pas
    if (goingToPanel || window._textPanelKeepOpen) return;
```

- [ ] **Step 8 : Supprimer le listener tool-export et le mousedown de fermeture export**

Dans `setupUIEvents()`, supprimer cette ligne (~ligne 762) :

```js
    addEvt('tool-export', 'click', () => openExportModal());
```

Supprimer aussi le bloc mousedown listener qui fermait l'export panel sur clic extérieur (~ligne 849). Chercher et supprimer :

```js
    document.addEventListener('mousedown', (e) => {
      const ep = document.getElementById('export-panel');
      if (!ep || !ep.classList.contains('active')) return;
      const exportBtn = document.getElementById('tool-export');
      if (!ep.contains(e.target) && (!exportBtn || !exportBtn.contains(e.target))) {
        closeExportPanel();
      }
    });
```

- [ ] **Step 9 : Vérifier et supprimer les fonctions mortes**

Vérifier qu'il ne reste plus d'appels à ces fonctions :

```bash
grep -n "openExportModal\|closeExportPanel\|closeExportModal\|updateExportPanelPosition" app.js
```

Résultat attendu : seules leurs définitions apparaissent (lignes ~8418-8446). Supprimer les quatre fonctions :

- `function openExportModal() { ... }`
- `function closeExportPanel() { ... }`
- `function closeExportModal() { ... }`
- `function updateExportPanelPosition() { ... }`

- [ ] **Step 10 : Vérification manuelle complète**

Recharger l'extension. Tester dans l'ordre :

1. **Section Texte — activation** : double-cliquer une note → "Text." devient opaque, curseur dans la note
2. **Section Texte — taille** : cliquer `<` et `>` → la taille de police change, la valeur dans le picker se met à jour
3. **Section Texte — Roman/Bold** : cliquer "Bold" → police en gras, bouton "Bold" surligné ; cliquer "Roman" → retour normal
4. **Section Texte — alignement** : cliquer ←, =, → → alignement du texte change, bouton correspondant actif
5. **Section Texte — désactivation** : cliquer hors de la note → "Text." regrisé, toolbar flottante réapparaît
6. **Section Texte — caption** : double-cliquer une caption → "Text." s'active de la même façon
7. **Section Aligner — activation** : sélectionner 2+ éléments → "Aligner." devient opaque
8. **Section Aligner — boutons** : cliquer align-left, align-top, distrib-h, distrib-v → éléments bougent correctement
9. **Section Aligner — désactivation** : désélectionner → "Aligner." regrisé
10. **Export — format** : cliquer PDF → [PDF] actif, [PNG] inactif ; cliquer PNG → inverse
11. **Export — qualité** : changer le sélecteur de qualité (aucune erreur)
12. **Export PNG** : sélectionner PNG, cliquer "Exporter" → téléchargement PNG correct
13. **Export PDF** : sélectionner PDF, cliquer "Exporter" → téléchargement PDF correct
14. **Mode preview** : activer preview → `#subheader` disparaît complètement
15. **Aucune erreur** : ouvrir DevTools → console vide d'erreurs

- [ ] **Step 11 : Commit**

```bash
git add app.js
git commit -m "feat: subheader — patcher références text-edit-panel/align-panel, supprimer fonctions export mortes"
```
