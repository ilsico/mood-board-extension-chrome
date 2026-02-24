// ── EXTENSION MOODBOARD INJECTOR — background.js (MV3 Service Worker) ────────
//
// chrome.storage.local est la source unique de vérité pour mb_boards.
//
//   app.js      → saveBoards() écrit dans chrome.storage.local
//   background  → lit chrome.storage.local pour construire le menu
//   background  → écrit dans chrome.storage.local lors d'une injection d'image
//   app.js      → chrome.storage.onChanged déclenche syncLibraryFromStorage()
//
// Aucun message bidirectionnel, aucun content script.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT_ID = 'mb-root';
let rebuilding = false;

// ── LECTURE DES BOARDS DEPUIS chrome.storage.local ───────────────────────────
async function getBoardsFromStorage() {
  try {
    const result = await chrome.storage.local.get('mb_boards');
    return Array.isArray(result.mb_boards) ? result.mb_boards : [];
  } catch {
    return [];
  }
}

// ── RECONSTRUCTION COMPLÈTE DU MENU ──────────────────────────────────────────
async function rebuildMenus(boards) {
  if (rebuilding) return;
  rebuilding = true;
  try {
    await chrome.contextMenus.removeAll();
    await chrome.contextMenus.create({
      id: ROOT_ID, title: 'Ajouter au Moodboard', contexts: ['image']
    });
    if (!Array.isArray(boards) || boards.length === 0) return;
    for (const board of boards) {
      await chrome.contextMenus.create({
        id:       'mb-board-' + board.id,
        parentId: ROOT_ID,
        title:    board.name || 'Board sans nom',
        contexts: ['image']
      });
    }
  } finally {
    rebuilding = false;
  }
}

// ── DÉCLENCHEURS ─────────────────────────────────────────────────────────────

// Reconstruction automatique dès que mb_boards change dans le stockage
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.mb_boards) {
    rebuildMenus(changes.mb_boards.newValue || []);
  }
});

// Installation / mise à jour de l'extension
chrome.runtime.onInstalled.addListener(async () => {
  rebuildMenus(await getBoardsFromStorage());
});

// Redémarrage de Chrome (service worker réveillé)
chrome.runtime.onStartup.addListener(async () => {
  rebuildMenus(await getBoardsFromStorage());
});

// ── CLIC SUR L'ICÔNE → OUVRIR / FOCUSER LE MOODBOARD ────────────────────────
chrome.action.onClicked.addListener(async () => {
  const url  = chrome.runtime.getURL('index.html');
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length > 0) {
    chrome.tabs.update(tabs[0].id, { active: true });
  } else {
    chrome.tabs.create({ url });
  }
});

// ── CLIC SUR UN ITEM DU MENU CONTEXTUEL ──────────────────────────────────────
chrome.contextMenus.onClicked.addListener(async (info) => {
  const menuId = String(info.menuItemId);
  if (!menuId.startsWith('mb-board-')) return;

  const boardId  = menuId.replace('mb-board-', '');
  const imageUrl = info.srcUrl;
  if (!imageUrl) return;

  // ── Filtre par schéma d'URL ───────────────────────────────────────────────

  // URLs non téléchargeables (chrome://, file://, edge://)
  if (imageUrl.startsWith('chrome://') || imageUrl.startsWith('file://') || imageUrl.startsWith('edge://')) {
    console.warn('[MB-EXT] URL non téléchargeable (schéma interdit) :', imageUrl);
    return;
  }

  let base64Src;

  // Data URI : déjà en base64, pas de fetch nécessaire
  if (imageUrl.startsWith('data:')) {
    base64Src = imageUrl;

  // URL classique (http:// ou https://) : fetch + conversion base64
  } else {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob        = await response.blob();
      let mimeType      = blob.type;
      if (!mimeType || mimeType === 'application/octet-stream') {
        const ext = imageUrl.split('?')[0].split('.').pop().toLowerCase();
        const mimeMap = { svg: 'image/svg+xml', webp: 'image/webp', gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', avif: 'image/avif', bmp: 'image/bmp' };
        mimeType = mimeMap[ext] || 'image/jpeg';
      }
      const arrayBuffer = await blob.arrayBuffer();
      const bytes       = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      base64Src = `data:${mimeType};base64,${btoa(binary)}`;
    } catch (err) {
      console.error('[MB-EXT] Erreur fetch image :', err);
      return;
    }
  }

  const fileName = decodeURIComponent(
    imageUrl.startsWith('data:')
      ? 'image.jpg'
      : (imageUrl.split('/').pop().split('?')[0] || 'image.jpg')
  );

  // ── Lecture, modification et écriture dans chrome.storage.local ──────────
  // L'écriture déclenche chrome.storage.onChanged dans app.js →
  //   syncLibraryFromStorage() recharge les boards en mémoire et re-rend le panneau.
  const boards = await getBoardsFromStorage();
  const board  = boards.find(b => b.id === boardId);

  if (!board) {
    console.warn('[MB-EXT] Board introuvable :', boardId);
    return;
  }

  if (!board.library)       board.library       = {};
  if (!board.library.image) board.library.image = [];

  board.library.image.push({
    id:   'lib_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name: fileName,
    src:  base64Src
  });

  try {
    await chrome.storage.local.set({ mb_boards: boards });
    // onChanged déclenche rebuildMenus() et syncLibraryFromStorage() automatiquement
  } catch (err) {
    console.error('[MB-EXT] Erreur chrome.storage.local.set :', err);
  }
});
