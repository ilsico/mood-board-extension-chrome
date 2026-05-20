# Refonte écran d'accueil — Roue 3D inspirée de rico.supply

**Date :** 2026-05-15
**Statut :** Plan d'implémentation, en attente de validation
**Inspiration :** [rico.supply](https://rico.supply/) — carrousel 3D circulaire

---

## 1. Concept

Remplacer la vue grille/libre actuelle des boards par une **roue 3D** où :

- Les cartes sont disposées sur la circonférence d'un cercle invisible vertical situé à **droite de l'écran**
- La carte « active » est positionnée à **droite, centrée verticalement** (3 heures sur l'horloge), c'est aussi la plus grande
- Plus une carte s'éloigne de cette position (en remontant ou descendant sur le cercle), plus elle devient **petite, translucide, et z-index bas**
- Le **scroll vertical** (molette / trackpad) fait tourner toute la roue
- Un clic sur la carte centrée ouvre une **vue détaillée** (date création, date sauvegarde, nb éléments, collab, nb collaborateurs)

---

## 2. Décisions prises (issues des questions de cadrage)

| Sujet | Décision |
|---|---|
| Contenu de la roue | Boards existants de l'utilisateur |
| Portée | Remplace totalement l'écran d'accueil actuel (grille libre supprimée) |
| Interaction principale | Scroll vertical uniquement |
| Style visuel | Fidèle à rico.supply (fond clair gris, ombres douces, cartes arrondies) |
| Contenu d'une carte | Image thumbnail (existante via `b.thumbnail`) **OU** fond noir avec nom du board en blanc aligné en haut à droite si pas de thumbnail |
| Action sur carte centrée | Vue détail (date, nb éléments, statut collab, nb participants) avant ouverture |
| Actions globales | Barre flottante en bas (créer board, importer, paramètres) |
| 0 boards | Écran vide avec gros CTA « Créer mon premier board » |
| 1-3 boards | Roue réduite mais visible |
| Beaucoup de boards | Boucle infinie (scroll continu) |
| Recherche | Champ de recherche/filtre disponible |

---

## 3. Impact sur le code existant

### À supprimer / désactiver
- Logique de **drag libre** des cards (`mousedown` → `onMove` → `onUp` qui modifie `b.x`/`b.y`) : devient obsolète, les positions ne sont plus stockées
- `boards-canvas` (le conteneur scrollable libre) : remplacé par `boards-wheel`
- Menu contextuel actuel sur clic droit (à voir si on garde — utile pour rename/delete depuis la roue)

### À conserver
- `loadBoardsFromStorage()` / `saveBoards()` — inchangés
- Modèle de données `boards[]` — pas de migration nécessaire (les champs `x`, `y` deviennent simplement ignorés)
- `b.thumbnail`, `b.name`, `b.savedAt`, `b.createdAt`, `b.isCollaborative` — déjà présents
- Logique d'édition du thumbnail (`_exportEditBoardCrop`, panneau d'édition)
- `openBoard(b.id)` — toujours appelé depuis la vue détail

### À ajouter
- Nouvelle fonction `renderBoardsWheel()` qui remplace `renderBoards()`
- Fonction `updateWheel()` (recalcul des transforms à chaque scroll)
- Fonction `selectWheelCard(index)` (centrer une carte avec animation)
- Fonction `showBoardPreview(boardId)` (vue détail)
- Composant « barre flottante » en bas de l'écran
- Composant « champ de recherche »
- État `wheelAngle` (angle de rotation courant de la roue, en radians)
- État `wheelIndex` (index de la carte centrée)

---

## 4. Modèle de données

**Aucune migration nécessaire.** Les boards existants ont déjà tous les champs requis :

```js
{
  id, name, elements, createdAt, savedAt, thumbnail,
  isCollaborative, collabId, /* x, y → ignorés */
}
```

Un champ optionnel à ajouter pour la collab détaillée :
- `b.collaborators` : array d'IDs/noms des participants connectés (déjà géré par `Collab.getParticipants()` ?)

Si pas dispo, fallback côté UI : « Collab activée » sans compter les personnes.

---

## 5. Mathématiques de la roue 3D

### Géométrie

La roue est un cercle invisible de rayon `R` (~600px sur desktop) dont le **centre se trouve hors écran à gauche**, positionné de telle sorte que la **carte la plus à droite (angle 0)** soit affichée à droite de l'écran, centrée verticalement.

```
                     (visible à l'écran)
                          ↓
        cercle invisible
            ┌──────┐
           /        \
          |    ●─────│─── carte active (angle 0)
           \        /
            └──────┘
        ↑
   centre du cercle (hors écran à gauche)
```

### Position d'une carte

Pour la carte `i`, son angle sur le cercle :
```js
const N = boards.length;
const angleStep = (2 * Math.PI) / N;
const theta = i * angleStep + wheelAngle;
// theta = 0 → carte tout à droite (centre vertical)
// theta > 0 (modulo 2π) → carte remonte sur le cercle
```

Coordonnées de la carte :
```js
const cx = cssCenterX + R * Math.cos(theta);
const cy = cssCenterY + R * Math.sin(theta);
```

Avec `cssCenterX < 0` (hors écran à gauche) et `cssCenterY = window.innerHeight / 2`.

### Échelle, opacité, z-index

```js
// Distance angulaire par rapport à la position « active » (theta = 0)
const dist = Math.abs(((theta + Math.PI) % (2 * Math.PI)) - Math.PI);
// dist ∈ [0, π], 0 = active, π = à l'opposé

// Scale : 1.0 à 0 (active), descend à 0.45 vers π/2, et 0.25 au-delà
const scale = Math.max(0.25, 1 - dist * 0.5);

// Opacité : 1 → 0.15 progressivement, masquée au-delà de 3π/4
const opacity = dist > 0.75 * Math.PI ? 0 : Math.max(0.15, 1 - dist * 0.6);

// z-index : la carte active devant
const zIndex = Math.round(1000 - dist * 100);
```

### Recyclage (boucle infinie)

Pour gérer beaucoup de boards, on ne rend que les `N_visible = 8` cartes les plus proches de `theta = 0`. Les autres sont en `display:none`. À chaque tick de scroll, on recalcule quel sous-ensemble est visible.

---

## 6. Structure HTML

Remplacer le bloc actuel `#home-screen` dans `index.html` :

```html
<div id="home-screen">
  <!-- Header minimal -->
  <header class="home-header">
    <h1 class="home-main-title">MOODBOARDS</h1>
    <input type="text" id="wheel-search" placeholder="Rechercher un board…" />
  </header>

  <!-- Roue 3D -->
  <div class="boards-wheel-container" id="boards-wheel-container">
    <div class="boards-wheel" id="boards-wheel">
      <!-- cards injectées dynamiquement -->
    </div>

    <!-- Chevron next (visible sur capture rico.supply) -->
    <button class="wheel-nav-next" id="wheel-nav-next" aria-label="Suivant">
      <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
    </button>
  </div>

  <!-- Vue détail (overlay quand carte centrée cliquée) -->
  <div class="board-preview-overlay" id="board-preview-overlay" hidden>
    <div class="board-preview-card">
      <img class="board-preview-thumb" alt="" />
      <div class="board-preview-info">
        <h2 class="board-preview-name"></h2>
        <div class="board-preview-meta">
          <span data-field="created"></span>
          <span data-field="saved"></span>
          <span data-field="count"></span>
          <span data-field="collab"></span>
        </div>
        <button class="board-preview-open">Ouvrir</button>
        <button class="board-preview-close" aria-label="Fermer">×</button>
      </div>
    </div>
  </div>

  <!-- Barre flottante d'actions -->
  <div class="home-action-bar" id="home-action-bar">
    <button class="action-btn action-create">+  Nouveau board</button>
    <button class="action-btn action-import">Importer</button>
    <button class="action-btn action-settings" aria-label="Paramètres">⚙</button>
  </div>

  <!-- Empty state (0 boards) -->
  <div class="home-empty" id="home-empty" hidden>
    <p>Aucun board pour le moment.</p>
    <button class="home-empty-cta">Créer mon premier board</button>
  </div>
</div>
```

---

## 7. CSS principaux (à intégrer dans le `<style>` de `index.html`)

```css
#home-screen {
  background: #f4f4f6;   /* gris très clair, fidèle rico.supply */
}

.home-header {
  position: absolute;
  top: 0; left: 0; right: 0;
  display: flex; justify-content: space-between; align-items: center;
  padding: 24px 32px;
  z-index: 10;
}

#wheel-search {
  border: none;
  background: rgba(255,255,255,0.6);
  backdrop-filter: blur(6px);
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 13px;
  width: 220px;
  outline: none;
}

.boards-wheel-container {
  position: absolute;
  inset: 0;
  perspective: 1400px;     /* active la profondeur 3D */
  overflow: hidden;
}

.boards-wheel {
  position: absolute;
  inset: 0;
  /* Pas de transform sur le wheel lui-même : on transforme chaque carte */
}

.wheel-card {
  position: absolute;
  width: 280px;
  height: 200px;
  top: 50%; left: 50%;
  margin-top: -100px; margin-left: -140px;
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12);
  background: #000;       /* fond noir pour les cartes sans thumbnail */
  cursor: pointer;
  /* transforms appliquées en inline-style par updateWheel() */
  will-change: transform, opacity;
  transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1),
              opacity 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}

.wheel-card.dragging {
  transition: none;   /* désactive pendant le scroll inertiel */
}

.wheel-card .wheel-thumb {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}

.wheel-card .wheel-name {
  position: absolute;
  top: 14px; right: 16px;
  color: #fff;
  font-family: 'HelveticaBold', sans-serif;
  font-size: 14px;
  letter-spacing: 0.3px;
  text-align: right;
  max-width: 70%;
}

/* Chevron next */
.wheel-nav-next {
  position: absolute;
  right: 32px;
  top: 50%;
  transform: translateY(-50%);
  width: 44px; height: 44px;
  border-radius: 50%;
  background: rgba(0,0,0,0.6);
  border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  z-index: 20;
}

.wheel-nav-next svg { width: 18px; height: 18px; stroke: #fff; fill: none; stroke-width: 2; }

/* Vue détail overlay */
.board-preview-overlay {
  position: fixed; inset: 0;
  background: rgba(244, 244, 246, 0.85);
  backdrop-filter: blur(12px);
  z-index: 100;
  display: flex; align-items: center; justify-content: center;
  animation: fadeIn 0.3s ease-out;
}

.board-preview-card {
  background: #fff;
  border-radius: 20px;
  width: 480px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
}

.board-preview-thumb { width: 100%; height: 280px; object-fit: cover; background: #000; }

.board-preview-info { padding: 24px 28px; }
.board-preview-meta { display: flex; flex-wrap: wrap; gap: 12px 20px; font-size: 12px; color: #666; margin: 12px 0 20px; }

.board-preview-open {
  background: #ff3c00; color: #fff; border: none;
  padding: 10px 28px; border-radius: 999px;
  font-weight: 600; cursor: pointer;
}

/* Barre flottante */
.home-action-bar {
  position: fixed;
  bottom: 24px; left: 50%;
  transform: translateX(-50%);
  display: flex; gap: 8px;
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(10px);
  padding: 8px;
  border-radius: 999px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.08);
  z-index: 15;
}

.action-btn {
  border: none; background: transparent;
  padding: 8px 16px; border-radius: 999px;
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
.action-btn:hover { background: rgba(0,0,0,0.05); }
.action-create { background: #ff3c00; color: #fff; }
.action-create:hover { background: #e63500; }

/* Empty state */
.home-empty {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 18px;
}
```

**Important :** conserver le curseur orange custom `#ff3c00` (path SVG défini dans `CLAUDE.md`) sur `.boards-wheel-container` et `.wheel-card`.

---

## 8. Logique JavaScript (dans `app.js`, à l'intérieur de l'IIFE `App`)

### Variables d'état (à ajouter en haut de l'IIFE, près de `boards`)

```js
let wheelAngle = 0;            // angle de rotation courant (rad)
let wheelTargetAngle = 0;      // angle cible (pour easing)
let wheelRAF = null;           // requestAnimationFrame en cours
let wheelIndex = 0;            // index de la carte la plus proche du centre
let wheelFilter = '';          // texte du champ de recherche
const WHEEL_RADIUS = 600;
const WHEEL_VISIBLE_COUNT = 8; // nb de cartes rendues simultanément
```

### `renderBoardsWheel()` — remplace `renderBoards()`

```js
function renderBoardsWheel() {
  const container = document.getElementById('boards-wheel');
  const empty = document.getElementById('home-empty');
  const filtered = boards.filter(b =>
    !wheelFilter || b.name.toLowerCase().includes(wheelFilter.toLowerCase())
  );

  if (filtered.length === 0) {
    container.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  // Construire les cards une seule fois (les transforms sont updatées par updateWheel)
  container.innerHTML = '';
  filtered.forEach((b, i) => {
    const card = document.createElement('div');
    card.className = 'wheel-card';
    card.dataset.id = b.id;
    card.dataset.index = i;

    if (b.thumbnail) {
      card.innerHTML = `<img class="wheel-thumb" src="${b.thumbnail}" alt="">`;
    } else {
      // Pas de thumbnail : fond noir + nom en blanc, aligné top-right
      card.innerHTML = `<div class="wheel-name">${escHtml(b.name)}</div>`;
    }

    card.addEventListener('click', () => onWheelCardClick(i, b.id));
    container.appendChild(card);
  });

  updateWheel(filtered);
}
```

### `updateWheel(filtered)` — calcule transforms à chaque frame

```js
function updateWheel(filtered) {
  filtered = filtered || boards.filter(b =>
    !wheelFilter || b.name.toLowerCase().includes(wheelFilter.toLowerCase())
  );
  const N = filtered.length;
  if (N === 0) return;

  const angleStep = (2 * Math.PI) / Math.max(N, 6);  // min 6 pour pas trop serrer si peu de cards
  const cssCenterX = -WHEEL_RADIUS + 40;  // décale le centre hors écran
  const containerH = window.innerHeight;

  const cards = document.querySelectorAll('.wheel-card');
  let nearestIdx = 0;
  let nearestDist = Infinity;

  cards.forEach((card, i) => {
    const theta = i * angleStep + wheelAngle;
    // Normaliser dist à [0, π]
    let normalized = ((theta + Math.PI) % (2 * Math.PI));
    if (normalized < 0) normalized += 2 * Math.PI;
    const dist = Math.abs(normalized - Math.PI);

    if (dist < nearestDist) { nearestDist = dist; nearestIdx = i; }

    const x = cssCenterX + WHEEL_RADIUS * Math.cos(theta);
    const y = (containerH / 2) + WHEEL_RADIUS * Math.sin(theta);
    const scale = Math.max(0.25, 1 - dist * 0.5);
    const opacity = dist > 0.75 * Math.PI ? 0 : Math.max(0.15, 1 - dist * 0.6);

    card.style.transform =
      `translate3d(${x - window.innerWidth/2}px, ${y - containerH/2}px, 0) scale(${scale})`;
    card.style.opacity = opacity;
    card.style.zIndex = Math.round(1000 - dist * 100);
    card.style.display = dist > 0.85 * Math.PI ? 'none' : 'block';
  });

  wheelIndex = nearestIdx;
}
```

### Gestion du scroll

```js
function setupWheelScroll() {
  const container = document.getElementById('boards-wheel-container');
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheelTargetAngle += e.deltaY * 0.003;   // sensibilité scroll
    if (!wheelRAF) wheelRAF = requestAnimationFrame(wheelTick);
  }, { passive: false });
}

function wheelTick() {
  wheelAngle += (wheelTargetAngle - wheelAngle) * 0.18;  // lerp
  updateWheel();
  if (Math.abs(wheelTargetAngle - wheelAngle) > 0.001) {
    wheelRAF = requestAnimationFrame(wheelTick);
  } else {
    wheelAngle = wheelTargetAngle;
    updateWheel();
    wheelRAF = null;
  }
}
```

### Clic sur la carte centrée

```js
function onWheelCardClick(index, boardId) {
  if (index === wheelIndex) {
    // Carte déjà centrée → ouvrir la preview
    showBoardPreview(boardId);
  } else {
    // Sinon : recentrer cette carte
    const N = document.querySelectorAll('.wheel-card').length;
    const angleStep = (2 * Math.PI) / Math.max(N, 6);
    wheelTargetAngle = -index * angleStep;
    if (!wheelRAF) wheelRAF = requestAnimationFrame(wheelTick);
  }
}
```

### Vue détail

```js
function showBoardPreview(boardId) {
  const b = boards.find(x => x.id === boardId);
  if (!b) return;
  const overlay = document.getElementById('board-preview-overlay');
  overlay.querySelector('.board-preview-thumb').src = b.thumbnail || '';
  overlay.querySelector('.board-preview-name').textContent = b.name;
  overlay.querySelector('[data-field="created"]').textContent =
    'Créé ' + formatSavedAt(b.createdAt).date;
  overlay.querySelector('[data-field="saved"]').textContent =
    'Sauvegardé ' + formatSavedAt(b.savedAt).date;
  overlay.querySelector('[data-field="count"]').textContent =
    (b.elements?.length || 0) + ' éléments';
  overlay.querySelector('[data-field="collab"]').textContent =
    b.isCollaborative
      ? `Collab · ${Collab.getParticipantCount?.(b.collabId) ?? '?'} participant(s)`
      : 'Solo';
  overlay.querySelector('.board-preview-open').onclick = () => openBoard(boardId);
  overlay.querySelector('.board-preview-close').onclick = () => overlay.hidden = true;
  overlay.hidden = false;
}
```

### Recherche

```js
document.getElementById('wheel-search').addEventListener('input', (e) => {
  wheelFilter = e.target.value;
  wheelAngle = 0; wheelTargetAngle = 0;
  renderBoardsWheel();
});
```

### Boucle infinie

Pour > 8 boards, l'astuce est de **toujours répéter virtuellement les boards** en utilisant modulo dans le calcul d'index, et de garder un sous-ensemble visible glissant. Implémentation simplifiée pour la v1 : limiter le rendu aux 8 cartes les plus proches de l'angle 0, et reconstruire le DOM quand `wheelAngle` dépasse ±2π (reset au modulo).

---

## 9. Intégration avec le système existant

### Collab
- **Aucune modification** côté `collab.js`
- Toujours vérifier `Collab.isActive()` avant d'appeler les syncs
- Si l'utilisateur ouvre un board collab depuis la roue, le flow existant (`openBoard` → `Collab.join`) reste identique

### Undo/redo
- **Aucun impact** — la roue est en lecture seule, aucune action ne génère d'historique
- Les modifications (rename, delete) restent gérées par les fonctions existantes (à exposer via menu contextuel ou vue détail)

### Curseur custom
- Garder `#ff3c00` partout
- Path SVG identique au `_applyCustomCursor()` actuel
- Appliquer aux nouvelles classes : `.boards-wheel-container`, `.wheel-card`, `.board-preview-overlay`

### Listeners
- Ajouter dans `init()` un appel unique à `setupWheelScroll()`
- Ne pas dupliquer si `init()` est rappelé

---

## 10. Ordre d'implémentation suggéré

1. **HTML** : remplacer le bloc `#home-screen` dans `index.html` par la nouvelle structure
2. **CSS** : ajouter toutes les classes `.wheel-*`, `.home-action-bar`, `.board-preview-*`
3. **JS — base** : créer `renderBoardsWheel()` + `updateWheel()` avec scroll
4. **JS — interaction** : `onWheelCardClick`, recentrage avec animation
5. **JS — preview** : `showBoardPreview()` + bouton ouvrir
6. **JS — actions globales** : brancher la barre flottante (créer, importer, settings) sur les fonctions existantes
7. **JS — recherche** : filtre + reset angle
8. **JS — empty state** : 0 boards → afficher `#home-empty`
9. **Cleanup** : supprimer l'ancien `renderBoards()` (drag libre) et le CSS associé
10. **Tests** : voir checklist ci-dessous

---

## 11. Checklist de tests

- [ ] 0 boards → écran vide affiché avec CTA
- [ ] 1 board → roue affichée avec une seule carte centrée
- [ ] 3 boards → roue espacée mais lisible
- [ ] 10+ boards → seules les 8 cartes proches sont visibles, scroll fluide
- [ ] Scroll vertical fait tourner la roue, easing fluide
- [ ] Carte centrée se met à jour pendant la rotation
- [ ] Clic sur carte non centrée → recentrage animé
- [ ] Clic sur carte centrée → vue détail
- [ ] Vue détail montre toutes les infos (création, sauvegarde, nb éléments, collab)
- [ ] Bouton « Ouvrir » dans la preview → ouvre le board
- [ ] Recherche filtre en temps réel, roue se reconstruit
- [ ] Barre flottante : créer / importer / settings fonctionnels
- [ ] Curseur orange `#ff3c00` partout
- [ ] Aucun `console.log` ajouté
- [ ] Aucune nouvelle boucle while non bornée
- [ ] Structure IIFE `App` préservée

---

## 12. Points d'attention pour l'implémentation

- **Perf** : `updateWheel()` est appelé à chaque frame pendant le scroll. Garder son corps léger (pas de `querySelectorAll` à chaque tick — cacher la NodeList dans une variable module-level si nécessaire)
- **Touchpad mac** : `deltaY` peut être très petit ou très grand selon la vélocité du swipe ; tester la sensibilité `0.003` et ajuster
- **Inertie** : le lerp à `0.18` donne un effet d'inertie. À ajuster selon le feeling
- **Responsive** : sur petits écrans, réduire `WHEEL_RADIUS` (ex. `Math.min(600, window.innerWidth * 0.7)`)
- **Resize** : ajouter un `window.addEventListener('resize', updateWheel)`
- **Accessibilité** : le scroll ne marche qu'avec la molette. Garder le chevron > visible (touch + clavier-friendly fallback). Ajouter raccourcis flèches ↑/↓ plus tard ?

---

## 13. Questions ouvertes à valider

- **Direction du scroll** : scroll vers le bas = roue tourne dans quel sens ? (par défaut : sens horaire = on remonte la liste)
- **Rename / delete depuis la roue** : on garde le clic droit ? Ou on les met dans la vue détail uniquement ?
- **Drag tactile** : pas demandé mais à prévoir pour tablette ? (à différer en v2)
- **Animation d'entrée** : effet « cartes qui se mettent en place » au chargement initial ?

---

## Annexe : capture rico.supply de référence

Style : fond gris très clair, cartes avec coins arrondis ~18px, ombres douces, profondeur 3D visible par superposition des cartes éloignées, chevron rond noir transparent à droite pour navigation pas-à-pas.
