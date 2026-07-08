# Spec : Listes à puces et todo listes dans les notes

**Date :** 2026-07-08  
**Statut :** Validé

---

## Contexte

Les notes (`el-note`) utilisent un `div[contenteditable]` (`.el-note-content`) qui stocke du HTML dans `dataset.savedata`. L'ajout de listes `<ul>/<li>` s'intègre naturellement dans ce système sans modifier le format de stockage.

---

## Fonctionnalité

Deux nouveaux boutons dans le panneau texte (à droite de `.text-align-btns`) permettent d'activer une **liste à puces** ou une **todo liste** sur les lignes sélectionnées d'une note.

---

## 1. Boutons dans le panneau

Ajout d'un wrapper `div.list-type-btns` dans `index.html`, après `.text-align-btns` :

```html
<div class="list-type-btns">
  <button class="list-type-btn" id="list-bullet-btn" title="Liste à puces">
    <!-- SVG lucide-list -->
  </button>
  <button class="list-type-btn" id="list-todo-btn" title="Todo liste">
    <!-- SVG lucide-list-todo -->
  </button>
</div>
```

- Les boutons portent la classe `.active` selon le type de liste à la position du curseur
- Désactivés (`.sb-disabled`) quand aucune note n'est en édition
- Même style visuel que les boutons `.text-align-btn` existants

---

## 2. Structure HTML des listes

**Liste à puces :**
```html
<ul>
  <li>Item texte</li>
</ul>
```

**Todo liste :**
```html
<ul class="todo-list">
  <li class="todo-item">
    <input type="checkbox" class="todo-check" contenteditable="false">
    <span>Item texte</span>
  </li>
  <li class="todo-item todo-done">
    <input type="checkbox" class="todo-check" contenteditable="false" checked>
    <span>Item coché</span>
  </li>
</ul>
```

---

## 3. Comportement clavier dans les listes

Un listener `keydown` est ajouté sur `.el-note-content` (dans `createNoteElement` et `reattachNoteEvents`), actif uniquement quand le curseur est dans un `<li>` :

| Touche | Contexte | Résultat |
|--------|----------|----------|
| Entrée | `<li>` non vide | Crée un nouveau `<li>` après (même format), curseur dedans |
| Entrée | `<li>` vide | Supprime le `<li>` vide, insère `<br>` après le `<ul>`, curseur après |
| Backspace | `<li>` vide en début | Même comportement que Entrée sur `<li>` vide |

Le comportement natif du navigateur sur `<ul>` contenteditable est neutralisé (`preventDefault`) pour ces cas uniquement.

---

## 4. Conversion sélection → liste (toggle on)

Au clic sur un bouton liste avec du texte sélectionné :

1. Analyser la sélection ligne par ligne
2. Pour chaque ligne :
   - Déjà dans un `<li>` du bon type → ignorer
   - Dans un `<li>` d'un autre type → convertir vers le nouveau format
   - Texte brut / `<div>` / `<br>` → wrapper dans un `<li>` du bon format
3. Les `<li>` adjacents sont regroupés dans un seul `<ul>` (pas de `<ul>` séparés)

Au clic sur un bouton liste **sans sélection** (curseur seul dans un `<li>`) :
- Même type que le `<li>` courant → toggle off sur cet item uniquement
- Autre type → convertit cet item vers le nouveau type

---

## 5. Désactivation (toggle off)

Au clic sur le bouton actif avec des `<li>` dans la sélection :

1. Chaque `<li>` sélectionné est "déshabillé" : son contenu (texte du `<span>` ou texte brut) est extrait
2. Réinséré comme `<div>` plain dans le contenteditable
3. Si le `<ul>` parent devient vide → supprimé

---

## 6. Checkboxes interactives hors édition

Un listener `click` délégué sur `.el-note` intercepte les clics sur `.todo-check` même quand `contentEditable = 'false'`.

À chaque toggle checkbox :
1. `checked` mis à jour sur le `<input>`
2. Classe `.todo-done` ajoutée/retirée sur le `<li>` parent
3. `el.dataset.savedata = ta.innerHTML` mis à jour
4. `Collab.syncElementData(id, innerHTML)` appelé si collab active
5. `pushAction({ type: 'editText', before, after })` pour undo/redo

---

## 7. Détection d'état des boutons toolbar

À chaque `selectionchange` dans une note en édition, vérifier le nœud courant :

- Dans `<li>` d'un `<ul>` sans classe → `#list-bullet-btn.active`
- Dans `<li>` d'un `<ul.todo-list>` → `#list-todo-btn.active`
- Aucune des deux → aucun bouton actif

---

## 8. CSS

```css
/* Boutons toolbar */
.list-type-btns {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-left: 8px;
}
.list-type-btn { /* même style que .text-align-btn */ }
.list-type-btn.active { /* même style actif que les autres boutons toolbar */ }

/* Listes dans les notes */
.el-note-content ul {
  padding-left: 18px;
  margin: 2px 0;
}
.el-note-content ul li {
  margin: 1px 0;
}
.el-note-content ul.todo-list {
  list-style: none;
  padding-left: 4px;
}
.el-note-content .todo-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.el-note-content .todo-item.todo-done span {
  opacity: 0.4;
}
.el-note-content .todo-check {
  pointer-events: auto;
  margin-top: 3px;
  flex-shrink: 0;
}
```

---

## 9. Undo / Redo

Les conversions liste (toggle on/off) et les coches de todo déclenchent `pushAction({ type: 'editText', elId, before: { data, style }, after: { data, style } })` — identique à une édition de texte normale. Pas de nouveau type d'action nécessaire.

---

## 10. Fichiers modifiés

| Fichier | Changements |
|---------|-------------|
| `index.html` | Boutons `.list-type-btns` dans le panneau texte + CSS listes + CSS boutons |
| `app.js` | `createNoteElement` : listener `keydown` listes + listener `click` checkboxes ; `reattachNoteEvents` : idem ; fonctions `_applyListToggle`, `_detectListState` ; mise à jour `selectionchange` handler |
