# Firebase Storage — Synchronisation des images en collab

**Date :** 2026-06-27
**Scope :** `collab.js`, `index.html`, `manifest.json`

---

## Problème

Les images > 768 KB ne se synchronisent pas en session collab. Firebase Realtime Database (RTDB) ne supporte pas les gros payloads JSON — les images lourdes restent à l'état `'pending'` et apparaissent comme manquantes chez le collaborateur.

## Objectif

- Toutes les images synchent en collab, quelle que soit leur taille
- Le board reste 100% local et fonctionnel hors session collab (aucun changement)
- À la fin d'une session, chaque participant récupère une copie locale complète

---

## Architecture

### Stockage par contexte

| Contexte | _imgStore (mémoire) | IndexedDB (local) | RTDB | Firebase Storage |
|---|---|---|---|---|
| Solo | base64 | base64 | — | — |
| Collab actif | base64 | base64 | URL Storage | fichier image |
| Après fin session | base64 | base64 | URL Storage | fichier image |

### Chemin Storage

```
collabImages/{boardId}/{elId}
```

Un fichier par élément image, par board. Permanent (pas de suppression automatique).

### Format dans RTDB

```
elements/{elId}/data = "https://firebasestorage.googleapis.com/v0/b/..."
```

`_onElementAdded` et `_onElementChanged` sont déjà compatibles : ils font `img.src = data`, qui fonctionne avec une URL exactement comme avec un base64.

---

## Flux détaillés

### Démarrage de session (owner)

```
1. Collecter tous les éléments type='image' du canvas courant
2. Pour chaque image :
   a. Lire base64 depuis _imgStore[elId]
   b. Uploader vers collabImages/{boardId}/{elId} via firebase.storage()
   c. Récupérer l'URL de téléchargement (getDownloadURL)
3. Écrire les URLs dans le batch RTDB (startSession existant)
4. Ouvrir la session → le collaborateur peut rejoindre
```

Affichage : le bouton "Démarrer la collab" affiche `Préparation… X / Y images` pendant l'upload.

### Nouvelle image ajoutée pendant la collab

```
syncElementCreate (image) :
1. Upload base64 → Storage → URL
2. Écrire URL dans RTDB elements/{elId}/data
   (remplace la logique 'pending' + upload conditionnel actuel)
```

### Fin de session (les deux participants)

```
_downloadStorageImages() :
1. Parcourir tous les éléments image du canvas
2. Pour chaque data commençant par 'https://' :
   a. fetch(url) → blob → FileReader → base64
   b. _imgStore[elId] = base64
3. Appeler App.saveCurrentBoard() → persiste en IndexedDB
4. Déconnecter Firebase → mode solo
```

Affichage : le bouton "Terminer la collab" affiche `Sauvegarde locale… X / Y images`.

---

## Changements par fichier

### `index.html`

Ajouter avant `firebase-init.js` :
```html
<script src="firebase-storage-compat.js"></script>
```

### `manifest.json`

Ajouter `firebase-storage-compat.js` dans `web_accessible_resources` (si présent) et dans la liste des scripts chargés par la page extension.

La CSP existante couvre déjà Firebase Storage :
- `connect-src` : `https://*.googleapis.com` ✅
- `img-src` : non restreinte → URLs HTTPS autorisées ✅

### `collab.js` — 4 modifications

**1. `_uploadImageToStorage(elId, base64)` (nouvelle fonction)**
```
- Prend le base64 brut (avec ou sans préfixe data:image/...)
- Ref : firebase.storage().ref('collabImages/' + _boardId + '/' + elId)
- Upload via putString(base64, 'data_url')
- Retourne getDownloadURL() → Promise<string>
```

**2. `startSession` — upload groupé**
- Avant d'écrire le batch RTDB : uploader toutes les images, collecter les URLs
- Injecter les URLs dans le batch à la place du base64
- Mettre à jour le compteur de progression dans l'UI

**3. `syncElementCreate` — upload immédiat**
- Si `type === 'image'` : appeler `_uploadImageToStorage`, écrire l'URL dans RTDB
- Supprimer la logique `'pending'` + condition `data.length <= 786432`

**4. `_downloadStorageImages()` + hook dans `endSession` (nouvelle fonction)**
- Appelée juste avant la déconnexion Firebase
- Attend que tous les fetch soient résolus avant de sauvegarder
- Gère les échecs individuellement (image non téléchargée → URL conservée dans _imgStore)

---

## Gestion d'erreurs

| Cas | Comportement |
|---|---|
| Upload échoue (une image) | Continue avec les suivantes. Cette image reste `'pending'` dans RTDB — même dégradation qu'aujourd'hui |
| Upload échoue (perte internet au démarrage) | Toast d'erreur, session non ouverte. L'owner peut réessayer |
| Download échoue à la fin de session | L'URL reste dans `_imgStore` — image visible en ligne, absente hors-ligne |
| Firebase Storage indisponible | Fallback : base64 direct dans RTDB si < 768 KB (comportement actuel) |
| Board sans images | Démarrage instantané, aucun upload |

---

## Ce qui ne change pas

- `app.js` : aucune modification. `saveCurrentBoard` lit `_imgStore` qui contiendra du base64 après `_downloadStorageImages()`
- Comportement solo : identique, rien ne touche au flux local
- `_imgStore` en mémoire : toujours base64, Storage n'est utilisé que pour RTDB ↔ collaborateur
- Les éléments non-image (notes, couleurs, liens) : inchangés

---

## Hors scope

- Suppression automatique des fichiers Storage en fin de session
- Résolution de conflits offline
- Compression supplémentaire avant upload (images déjà compressées à 1600px/0.8 dans app.js)
