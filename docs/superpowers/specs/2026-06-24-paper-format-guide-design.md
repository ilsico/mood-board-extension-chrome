# Guide de format papier — Spec design
*Date : 2026-06-24*

## Résumé

Ajout d'une fonctionnalité "Guide de format papier" permettant à l'utilisateur d'afficher un cadre de référence en pointillés orange sur le canvas, représentant un format papier (A3/A4/A5 ou personnalisé), et d'exporter exactement ce cadre en recadrage strict.

---

## 1. UI — Bouton et menu flottant

### Bouton `#paper-format-btn`
- Placé dans `#theme-dock`, immédiatement à droite de `#theme-toggle-btn`
- Même classe `collab-btn`, même gap `12px` (déjà défini par `flex` + `gap: 12px` du dock)
- Icône : SVG feuille avec coins pliés, `stroke="currentColor"`, `width="20" height="20"`
- État actif (cadre visible) : classe `.active` → `background: var(--fg)`, `color: var(--fg-inv)` (idem `#collab-btn.collab-active`)
- Titre (tooltip) : `"Guide de format papier"`

### Menu flottant `#paper-format-panel`
- `position: fixed`, ancré au-dessus du bouton, même style que `#export-panel`
- Masqué par défaut, affiché au clic sur le bouton, fermé au clic extérieur
- Masqué en `preview-mode` et `readonly-mode` (même règles CSS que les autres panneaux)

### Contenu du menu
```
Rangée 1 — Formats prédéfinis :
  [ A5 ]  [ A4 ]  [ A3 ]      [↕ Portrait]  [↔ Paysage]

Séparateur

Rangée 2 — Format personnalisé :
  Largeur : [input] | Hauteur : [input] | Unité : [mm ▾ | cm | px]

Séparateur

Rangée 3 — Actions :
  [ Appliquer ]     [ Désactiver ]
```

- Les 3 boutons de format (`A5`, `A4`, `A3`) sont mutuellement exclusifs (highlight actif)
- Le toggle Portrait/Paysage permute `w` et `h`
- Le sélecteur d'unité (mm / cm / px) convertit automatiquement les valeurs affichées dans les inputs sans changer les dimensions réelles
- "Personnalisé" est sélectionné automatiquement si l'utilisateur modifie les inputs directement
- `[ Appliquer ]` → affiche le cadre et ferme le panneau
- `[ Désactiver ]` → retire le cadre, remet le bouton en état normal, ferme le panneau

---

## 2. Cadre sur le canvas

### Élément DOM
```html
<div id="paper-frame"></div>
```
Injecté directement dans `#canvas` (même parent que `.board-element`).

### Styles
```css
#paper-frame {
  position: absolute;
  pointer-events: none;  /* ne bloque pas les interactions sur les éléments */
  z-index: 9999;
  border: 2px dashed #ff3c00;
  box-sizing: border-box;
  background: transparent;
}
/* Draggable : pointer-events activés sur le border uniquement via JS */
```

### Drag du cadre
- `mousedown` sur `#paper-frame` → drag libre (translate x/y) via RAF, même pattern que `dragRAF`
- Pendant le drag, `_paperFrame.x` et `_paperFrame.y` sont mis à jour
- `pointer-events: none` remis après `mouseup`

### Positionnement initial
Au moment de `[ Appliquer ]` :
1. Calculer le bounding box des `.board-element` existants
2. Centrer le cadre sur ce bounding box
3. Si aucun élément → centrer sur le viewport visible

### État interne
```js
let _paperFrame = {
  active: false,
  x: 0, y: 0,   // position en coordonnées canvas (px)
  w: 0, h: 0,   // dimensions en px (96 DPI)
  formatLabel: '',  // ex: 'A4 Portrait'
  // Pour PDF : dimensions réelles en mm (null si format px pur)
  realW_mm: null,
  realH_mm: null,
};
```
Pas persisté dans `boards[]` — état éphémère de session.

### Formats prédéfinis (en mm → px à 96 DPI = mm × 3.7795)
| Format | Portrait (mm) | Paysage (mm) |
|--------|--------------|--------------|
| A5 | 148 × 210 | 210 × 148 |
| A4 | 210 × 297 | 297 × 210 |
| A3 | 297 × 420 | 420 × 297 |

### Conversion d'unités
- `mm → px` : `× 3.7795`
- `cm → px` : `× 37.795`
- `px → mm` : `/ 3.7795`
- `px → cm` : `/ 37.795`

---

## 3. Export avec recadrage strict

### Modification de `captureBoard(exportScale)`
Quand `_paperFrame.active === true` :
```js
const cropX = _paperFrame.x;
const cropY = _paperFrame.y;
const cropW = _paperFrame.w;
const cropH = _paperFrame.h;
// margin = 0 (le cadre EST la zone exacte, pas de marge ajoutée)
```

Avant le rendu `html2canvas`, retirer le cadre du clone fantôme :
```js
ghostCanvas.querySelector('#paper-frame')?.remove();
```

Quand `_paperFrame.active === false` : comportement actuel inchangé (bounding box éléments + marge 5%).

### Export PDF
Quand le cadre est actif et que `_paperFrame.realW_mm` est non nul (format standard ou custom en mm/cm) :
- Passer les vraies dimensions mm à jsPDF (`format: [realW_mm, realH_mm]`)
- Orientation automatique selon portrait/paysage

Quand format custom en px : utiliser les dimensions pixel converties en mm (÷ 3.7795) pour jsPDF.

---

## 4. Masquage UI

Règles CSS à ajouter (même pattern que les existantes) :
```css
body.preview-mode #paper-format-panel,
body.preview-mode #paper-format-btn { display: none; }

body.readonly-mode #paper-format-btn { display: none; }
```

Le `#paper-frame` lui-même reste visible en preview-mode (lecture seule), mais est retiré du clone ghost à l'export — pas besoin de règle CSS supplémentaire.

---

## 5. Fichiers modifiés

| Fichier | Changements |
|---------|-------------|
| `index.html` | + bouton `#paper-format-btn` dans `#theme-dock` ; + `<div id="paper-format-panel">` avec son contenu ; + styles CSS `#paper-frame`, `.paper-fmt-btn`, états light-mode |
| `app.js` | + variable `_paperFrame` ; + fonctions `openPaperFormatPanel`, `closePaperFormatPanel`, `applyPaperFormat`, `deactivatePaperFormat`, `_paperFrameDrag` ; modification `captureBoard()` ; modification `exportPDF()` ; listener click `#paper-format-btn` dans `setupUIEvents` |

---

## 6. Contraintes et non-fonctionnalités

- Le cadre n'est **pas sauvegardé** entre sessions
- Le cadre n'est **pas synchronisé** en mode collab (pas de `Collab.sync*`)
- Aucun snap du cadre aux éléments (drag libre uniquement)
- Pas de redimensionnement du cadre par poignées (les dimensions viennent toujours du menu)
- Zéro `console.log` ajouté
- Structure IIFE préservée
