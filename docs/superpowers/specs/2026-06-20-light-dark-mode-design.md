# Spec — Mode clair / sombre par board

**Date :** 2026-06-20  
**Scope :** Interface board uniquement (canvas, toolbar, docks). Écran d'accueil et modales hors scope.

---

## Objectif

Permettre à l'utilisateur de basculer entre un thème sombre (existant) et un thème clair pour chaque board individuellement, avec persistance dans les données du board.

---

## Tokens CSS

Toutes les overrides light-mode sont regroupées sous le sélecteur `body.light-mode` dans `index.html`. Les valeurs dark ne sont pas modifiées.

| Token / Élément | Dark (actuel) | Light |
|---|---|---|
| `--bg-app` | `#222222` | `#C7C7C7` |
| `--bg-canvas` | `#2C2C2C` | `#F2F2F2` |
| `--bg-input` | `#3d3d3d` | `#b0b0b0` |
| `--fg` | `#ffffff` | `#222222` |
| `--fg-inv` | `#222222` | `#F2F2F2` |
| `.el-connection line` stroke | `#F2F2F2` (changé depuis `#1a1a2e`) | `#2C2C2C` |
| `.tool-btn svg` stroke | `#fff` | `#222222` |

**Note :** La couleur actuelle des connecteurs (`#1a1a2e`) est remplacée par `#F2F2F2` même en dark — ils deviennent visibles sur fond sombre. En light ils passent à `#2C2C2C`.

---

## Bouton toggle

### Emplacement
Nouveau dock `#theme-dock` :
- `position: fixed; bottom: 16px; left: 16px; z-index: 300`
- Symétrique à `#share-collab-dock` (bottom-right)
- Masqué en `preview-mode` et `readonly-mode` (comme les autres docks)

### Bouton
- Classe `.collab-btn` (réutilise le style existant : 48×48px, `var(--bg-app)`, border-radius 8px)
- `id="theme-toggle-btn"`
- Icône affichée = mode **actif** :
  - Dark mode actif → icône Lune (Lucide `moon`)
  - Light mode actif → icône Soleil (Lucide `sun`)
- `stroke="currentColor"` pour que l'icône suive `--fg` automatiquement

---

## Persistance par board

### Structure données
Chaque board dans `boards[]` gagne une propriété optionnelle :
```
board.theme = 'dark' | 'light'   // absent = 'dark' par défaut
```

### Lecture — `openBoard(id)`
Après chargement du board :
```js
const theme = board.theme || 'dark';
document.body.classList.toggle('light-mode', theme === 'light');
_updateThemeIcon();
```

### Écriture — `saveCurrentBoard()`
Lors de la sérialisation du board :
```js
board.theme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
```

### Toggle — handler bouton
```js
document.body.classList.toggle('light-mode');
_updateThemeIcon();
saveCurrentBoard();
```

### Helper `_updateThemeIcon()`
Met à jour l'innerHTML du bouton avec l'icône SVG correspondant au mode actif.

---

## Masquage conditionnel

Le `#theme-dock` est ajouté aux sélecteurs existants dans `index.html` :
```css
body.preview-mode #theme-dock,
body.readonly-mode #theme-dock { display: none; }
```

---

## Fichiers modifiés

| Fichier | Changements |
|---|---|
| `index.html` | Tokens CSS light-mode, `#theme-dock` HTML, règles masquage, correction stroke connecteurs dark |
| `app.js` | `openBoard()` : apply theme class + update icon ; `saveCurrentBoard()` : persist `board.theme` ; event listener toggle btn ; helper `_updateThemeIcon()` |

---

## Hors scope

- Écran d'accueil (`#home-screen`) — déjà sur fond clair, inchangé
- Menus contextuels, modales, panneaux flottants (`#align-panel`, `#lib-panel`, etc.) — fond blanc existant, inchangé
- Collab (Firebase sync du thème) — non demandé
