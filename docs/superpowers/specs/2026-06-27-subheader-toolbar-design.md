# Spec : Barre secondaire de contrôles (subheader)

**Date :** 2026-06-27
**Référence visuelle :** `figma/header menu.svg`

---

## Objectif

Ajouter une barre horizontale permanente (37 px) sous le `#board-header` principal, regroupant les contrôles de texte, d'alignement et d'export en un seul endroit toujours visible sur le board.

---

## Contexte décisionnel

- **Visibilité :** toujours visible sur le board (non contextuelle)
- **Cible des contrôles texte :** notes (`data-type="note"`) et captions (`data-type="caption"`)
- **Cible des contrôles alignement :** sélection multiple uniquement (≥ 2 éléments)
- **Export :** la barre remplace le bouton `#tool-export` du dock — ce bouton est supprimé
- **Approche :** déplacer les contrôles existants dans la subheader (mêmes IDs → zéro changement de logique JS pour les boutons)

---

## Structure HTML

```
#subheader
├── .sb-section.sb-text          (désactivé par défaut)
│   ├── .sb-label "Text."
│   ├── .sb-size-wrap            [<] [12] [>]   IDs: text-size-minus / text-size-val / text-size-plus
│   ├── .sb-sep
│   ├── [Roman] [Bold]           IDs: tp-roman / tp-bold
│   ├── .sb-sep
│   └── [←] [=] [→]             IDs: ta-left / ta-center / ta-right
├── .sb-sep-major
├── .sb-section.sb-align         (désactivé par défaut)
│   ├── .sb-label "Aligner."
│   ├── [align-left] [align-center-h] [align-right] [distrib-h]
│   ├── [align-top]  [align-center-v] [align-bottom] [distrib-v]
│   └── [Objet clé]              ID: key-object-toggle
├── .sb-sep-major
└── .sb-section.sb-export        (toujours actif)
    ├── [Bonne qualité ▾]        ID: export-quality-select
    ├── [PDF] [PNG]              IDs: export-fmt-pdf / export-fmt-png
    └── [Exporter]               ID: export-do-btn
```

**Supprimés du DOM :**
- `#text-edit-panel` (floating)
- `#align-panel` (floating)
- `#export-panel` (floating)
- `#tool-export` (bouton dock haut-droit)

---

## CSS

### Conteneur

```css
#subheader {
  width: 100%;
  height: 37px;
  background: var(--bg-app);
  border-bottom: 1px solid rgba(0,0,0,0.12);
  display: flex;
  align-items: center;
  flex-shrink: 0;
  z-index: 199;
  overflow: hidden;
}
```

### Sections et états

```css
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
  font-family: 'HelveticaBold', Helvetica, Arial, sans-serif;
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
```

### Size picker

```css
.sb-size-wrap {
  display: flex;
  align-items: center;
  gap: 0;
  background: var(--bg-input);
  border-radius: 4px;
  padding: 0 2px;
  height: 22px;
}

/* Réutilise .text-size-btn et .text-size-val existants, redimensionnés */
.sb-section .text-size-btn {
  width: 18px;
  height: 22px;
  background: none;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--fg);
}

.sb-section .text-size-val {
  min-width: 22px;
  text-align: center;
  font-size: 12px;
  font-family: 'HelveticaBold', Helvetica, Arial, sans-serif;
  color: var(--fg);
}
```

### Boutons generiques de la barre

```css
/* boutons alignement et texte */
.sb-section .align-btn,
.sb-section .text-align-btn,
.sb-section .text-font-btn {
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
}

.sb-section .align-btn:hover,
.sb-section .text-align-btn:hover,
.sb-section .text-font-btn:hover {
  background: var(--bg-input);
}

.sb-section .text-font-btn.active,
.sb-section .text-align-btn.active,
.sb-section .align-btn.active {
  background: var(--fg);
  color: var(--fg-inv);
}

#key-object-toggle {
  font-size: 10px;
  font-family: 'HelveticaBold', Helvetica, Arial, sans-serif;
  padding: 2px 6px;
  height: 22px;
  border: 1px solid var(--fg);
  border-radius: 4px;
  background: none;
  color: var(--fg);
  cursor: pointer;
  white-space: nowrap;
}

#key-object-toggle.active {
  background: var(--fg);
  color: var(--fg-inv);
}
```

### Export

```css
/* Réutilise les styles .export-fmt-btn et #export-do-btn existants */
.sb-section #export-quality-select {
  height: 22px;
  font-size: 11px;
  border: 1px solid var(--fg);
  border-radius: 4px;
  background: var(--bg-app);
  color: var(--fg);
  padding: 0 4px;
  cursor: pointer;
}

.sb-section .export-fmt-btn {
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
  font-family: 'HelveticaBold', Helvetica, Arial, sans-serif;
  border: 1px solid var(--fg);
  border-radius: 4px;
  background: none;
  color: var(--fg);
  cursor: pointer;
}

.sb-section .export-fmt-btn.active {
  background: var(--fg);
  color: var(--fg-inv);
}

.sb-section #export-do-btn {
  height: 22px;
  padding: 0 10px;
  background: #ff3c00;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 11px;
  font-family: 'HelveticaBold', Helvetica, Arial, sans-serif;
  cursor: pointer;
}
```

### Masquage

```css
body.preview-mode #subheader,
body.readonly-mode #subheader {
  display: none;
}
```

---

## Changements dans `app.js`

### 1. `updateAlignPanel()` — lignes ~6998-7024

Remplacer :
```js
const panel = document.getElementById('align-panel');
if (!panel) return;
if (multiSelected.size >= 2) {
  panel.classList.add('active');
  ...
} else {
  panel.classList.remove('active');
  ...
}
updateExportPanelPosition();
```

Par :
```js
const sbAlign = document.querySelector('.sb-align');
if (sbAlign) sbAlign.classList.toggle('sb-disabled', multiSelected.size < 2);
if (multiSelected.size < 2) {
  _keyObjectMode = false;
  if (_keyObject) { _keyObject.classList.remove('key-object'); _keyObject = null; }
  const toggle = document.getElementById('key-object-toggle');
  if (toggle) toggle.classList.remove('active');
}
// Restaurer toolbar si ni texte ni multi-sélection active
const toolbar = document.getElementById('toolbar');
const sbText = document.querySelector('.sb-text');
if (toolbar && sbText && sbText.classList.contains('sb-disabled') && multiSelected.size < 2) {
  toolbar.style.display = '';
}
```

Supprimer l'appel à `updateExportPanelPosition()` (le panneau export est maintenant fixe).

### 2. `showTextEditPanel(el)` — ligne ~7166

Remplacer :
```js
const panel = document.getElementById('text-edit-panel');
panel.classList.add('active');
updateExportPanelPosition();
```
Par :
```js
document.querySelector('.sb-text')?.classList.remove('sb-disabled');
```
La ligne `toolbar.style.display = 'none'` juste avant reste inchangée.

### 3. `hideTextEditPanel()` — ligne ~7200

Remplacer :
```js
document.getElementById('text-edit-panel').classList.remove('active');
```
Par :
```js
document.querySelector('.sb-text')?.classList.add('sb-disabled');
```
L'appel à `updateAlignPanel()` qui suit reste inchangé.

### 4. Supprimer le listener `tool-export`

Dans `setupUIEvents()`, supprimer :
```js
addEvt('tool-export', 'click', () => openExportModal());
```

Et supprimer le mousedown listener qui ferme `#export-panel` sur clic extérieur (devenu inutile).

Supprimer également `openExportModal()`, `closeExportPanel()`, `closeExportModal()`, et `updateExportPanelPosition()` — ces fonctions n'auront plus de raison d'exister (les trois panneaux flottants sont retirés du DOM).

---

## Ordre d'implémentation

1. **index.html** — Ajouter `#subheader` après `#board-header`, déplacer le HTML des contrôles dedans, supprimer les anciens panneaux et `#tool-export`
2. **index.html CSS** — Ajouter les styles `.sb-*` et les overrides, masquer en preview/readonly
3. **app.js** — Patcher `updateAlignPanel()`, `showTextEditPanel()`, les blurs, et le listener export
4. **Vérification** — Tester édition note → section Text active ; multi-sélection → section Aligner active ; export PDF/PNG → fonctionne ; modes preview/readonly → barre masquée

---

## Non concerné

- Logique des fonctions `alignElements()`, `distributeElements()`, `applyTextAlign()` — inchangées
- Listeners des boutons d'alignement/texte/taille — inchangés (IDs identiques)
- `collab.js`, `background.js`, `popup.js` — non touchés
