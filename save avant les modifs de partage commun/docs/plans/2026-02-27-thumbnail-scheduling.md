# Thumbnail Scheduling Refactor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Découpler la sauvegarde JSON de la génération de miniature, et capturer uniquement quand la vue est stable depuis 7 secondes.

**Architecture:** `scheduleThumbnail()` est réécrit avec un debounce de 7s et une fonction interne nommée pour le reschedule. Il est déclenché par `scheduleSave()` (modifications) et `applyTransform()` (pan/zoom), et non plus par `saveCurrentBoard()`. Si la vue bouge encore à l'expiration du timer, reschedule 7s.

**Tech Stack:** JavaScript vanilla, Chrome Extension MV3, html2canvas, IndexedDB.

---

### Task 1 : Réécriture de `scheduleThumbnail()`

**Files:**
- Modify: `app.js:89-118`

**Step 1 : Remplacer le corps de `scheduleThumbnail()`**

Lignes 89–118 actuelles :
```javascript
 function scheduleThumbnail() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    if (typeof html2canvas === 'undefined') return;
    captureBoardThumbnail()
      .then(({ dataUrl }) => {
        // Recadrer en 300×225 (format 4:3) avec 10% de marge blanche
        const tc = document.createElement('canvas');
        tc.width = 300; tc.height = 225;
        const ctx2 = tc.getContext('2d');
        ctx2.fillStyle = '#ffffff';
        ctx2.fillRect(0, 0, 300, 225);
        const img2 = new Image();
        img2.onload = () => {
          const margin = 0.10;
          const maxW = 300 * (1 - 2 * margin); // 240
          const maxH = 225 * (1 - 2 * margin); // 180
          const scale = Math.min(maxW / img2.width, maxH / img2.height);
          const dw = img2.width * scale, dh = img2.height * scale;
          const dx = (300 - dw) / 2,   dy = (225 - dh) / 2;
          ctx2.drawImage(img2, dx, dy, dw, dh);
          const thumb = tc.toDataURL('image/jpeg', 0.7);
          const board = boards.find(b => b.id === currentBoardId);
          if (board) { board.thumbnail = thumb; saveBoards(); }
        };
        img2.src = dataUrl;
      })
      .catch(() => {});
  }, 3000);
}
```

Remplacer par :
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
          // Recadrer en 300×225 (format 4:3) avec 10% de marge blanche
          const tc = document.createElement('canvas');
          tc.width = 300; tc.height = 225;
          const ctx2 = tc.getContext('2d');
          ctx2.fillStyle = '#ffffff';
          ctx2.fillRect(0, 0, 300, 225);
          const img2 = new Image();
          img2.onload = () => {
            const margin = 0.10;
            const maxW = 300 * (1 - 2 * margin); // 240
            const maxH = 225 * (1 - 2 * margin); // 180
            const scale = Math.min(maxW / img2.width, maxH / img2.height);
            const dw = img2.width * scale, dh = img2.height * scale;
            const dx = (300 - dw) / 2,   dy = (225 - dh) / 2;
            ctx2.drawImage(img2, dx, dy, dw, dh);
            const thumb = tc.toDataURL('image/jpeg', 0.7);
            const board = boards.find(b => b.id === currentBoardId);
            if (board) { board.thumbnail = thumb; saveBoards(); }
          };
          img2.src = dataUrl;
        })
        .catch(() => {});
    }, 7000);
  }
```

**Step 2 : Vérification manuelle**

Ouvrir la console Chrome → naviguer sur un board → modifier un élément → attendre sans toucher la souris → vérifier qu'aucune capture ne se produit avant 7s.

---

### Task 2 : Retirer `scheduleThumbnail()` de `saveCurrentBoard()`

**Files:**
- Modify: `app.js:157`

**Step 1 : Supprimer la ligne**

Ligne 157 actuelle :
```javascript
    scheduleThumbnail(); // mise à jour miniature en temps réel
```
→ Supprimer cette ligne entièrement.

**Step 2 : Vérification**

Modifier un élément → vérifier dans la console qu'aucune capture n'est déclenchée immédiatement après la sauvegarde (pas d'appel html2canvas dans les 3 premières secondes).

---

### Task 3 : Ajouter `scheduleThumbnail()` dans `scheduleSave()`

**Files:**
- Modify: `app.js:85`

**Step 1 : Modifier la fonction**

Ligne 85 actuelle :
```javascript
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrentBoard, 800); }
```

Remplacer par :
```javascript
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrentBoard, 800); scheduleThumbnail(); }
```

**Step 2 : Vérification**

Modifier un élément → vérifier en console que le timer thumbnail démarre (on peut ajouter un `console.log` temporaire dans `scheduleThumbnail` pour confirmer, puis le retirer).

---

### Task 4 : Ajouter `scheduleThumbnail()` dans `applyTransform()`

**Files:**
- Modify: `app.js:736-746`

**Step 1 : Modifier la fonction**

Code actuel (lignes 736–746) :
```javascript
  function applyTransform() {
    // Le bloc de restriction à 0.15 a été retiré pour supprimer le glitch
    document.getElementById('canvas').style.transform = `translate(${panX}px,${panY}px) scale(${zoomLevel})`;

    // Compenser le zoom sur les poignées de resize pour qu'elles restent constantes à l'écran
    const invScale = 1 / zoomLevel;
    document.querySelectorAll('#canvas .resize-handle').forEach(h => {
      h.style.transform = `scale(${invScale})`;
    });
    updateMultiResizeHandle();
  }
```

Ajouter `scheduleThumbnail();` avant la fermeture `}` :
```javascript
  function applyTransform() {
    // Le bloc de restriction à 0.15 a été retiré pour supprimer le glitch
    document.getElementById('canvas').style.transform = `translate(${panX}px,${panY}px) scale(${zoomLevel})`;

    // Compenser le zoom sur les poignées de resize pour qu'elles restent constantes à l'écran
    const invScale = 1 / zoomLevel;
    document.querySelectorAll('#canvas .resize-handle').forEach(h => {
      h.style.transform = `scale(${invScale})`;
    });
    updateMultiResizeHandle();
    scheduleThumbnail();
  }
```

**Step 2 : Vérification du comportement complet**

1. Charger l'extension → ouvrir un board
2. Faire un pan (clic molette + glisser) → vérifier que le timer thumbnail se réinitialise à chaque frame
3. Relâcher → attendre 7s → vérifier qu'une capture se produit et que la miniature est mise à jour sur l'écran d'accueil
4. Recommencer avec un zoom (Alt+molette) → même vérification
5. Vérifier que la sauvegarde JSON reste instantanée (pas de délai perçu sur les éléments)

**Step 3 : Commit**

```bash
git add app.js
git commit -m "perf: decouple thumbnail from save, capture only on 7s view stability"
```
