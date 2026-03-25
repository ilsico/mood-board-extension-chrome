# Design — Refonte du système de miniatures (scheduleThumbnail)

**Date :** 2026-02-27
**Fichier cible :** `app.js`

## Problème

`saveCurrentBoard()` appelle `scheduleThumbnail()` à chaque sauvegarde, ce qui déclenche des captures html2canvas trop fréquentes et provoque des lags.

## Objectif

Séparer la persistance des données (rapide, fréquente) de la génération de miniature (coûteuse, uniquement quand la vue est stable).

## Design validé

### 1. Découplage — retirer l'appel dans `saveCurrentBoard()`

Supprimer la ligne `scheduleThumbnail()` (~ligne 149) dans `saveCurrentBoard()`.

### 2. Nouveau `scheduleThumbnail()` — debounce 7s + guard + reschedule 7s

```javascript
function scheduleThumbnail() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(function doCapture() {
    if (isPanning || isTouchPanning || wheelRaf !== null) {
      thumbTimer = setTimeout(doCapture, 7000);
      return;
    }
    if (typeof html2canvas === 'undefined') return;
    captureBoardThumbnail()
      .then(({ dataUrl }) => {
        // logique existante inchangée (redimensionnement 300×225 JPEG 0.7)
      })
      .catch(() => {});
  }, 7000);
}
```

### 3. Deux nouveaux points d'appel

**`scheduleSave()`** — couvre toutes les modifications d'éléments :
```javascript
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrentBoard, 800);
  scheduleThumbnail();
}
```

**`applyTransform()`** — couvre pan + zoom :
```javascript
function applyTransform() {
  // ... code existant ...
  scheduleThumbnail();
}
```

### Flux résultant

```
Modification élément  →  scheduleSave()   →  scheduleThumbnail() [reset 7s]
Pan / Zoom            →  applyTransform() →  scheduleThumbnail() [reset 7s]

Après 7s d'inactivité complète :
  ├─ isPanning / isTouchPanning / wheelRaf actif → reschedule 7s
  └─ Vue stable → html2canvas capture → thumbnail sauvé dans IndexedDB
```

## Ce qui ne change pas

- `captureBoardThumbnail()` — inchangé
- Redimensionnement 300×225 JPEG 0.7 — inchangé
- `saveCurrentBoard()` — juste retrait de l'appel `scheduleThumbnail()`
- Tous les autres appels à `scheduleSave()` — inchangés
