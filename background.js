const ROOT_ID = 'mb-root';
let rebuilding = false;

// ── UTILITAIRES INDEXEDDB ────────────────────────────────────────────────────
const DB_NAME = 'MoodboardDB';
const STORE_NAME = 'boards_store';

function getDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function getBoardsFromDB() {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get('mb_boards');
    return await new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

async function saveBoardsToDB(boards) {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(boards, 'mb_boards');
  } catch (err) {
    console.error('[MB-EXT] Erreur sauvegarde DB:', err);
  }
}

// ── RECONSTRUCTION COMPLÈTE DU MENU ──────────────────────────────────────────
async function rebuildMenus(boards) {
  if (rebuilding) return;
  rebuilding = true;
  try {
    await chrome.contextMenus.removeAll();
    await chrome.contextMenus.create({
      id: ROOT_ID,
      title: 'Ajouter au Moodboard',
      contexts: ['image'],
    });
    if (!Array.isArray(boards) || boards.length === 0) return;
    for (const board of boards) {
      await chrome.contextMenus.create({
        id: 'mb-board-' + board.id,
        parentId: ROOT_ID,
        title: board.name || 'Board sans nom',
        contexts: ['image'],
      });
    }
  } finally {
    rebuilding = false;
  }
}

// ── DÉCLENCHEURS ─────────────────────────────────────────────────────────────

// Reconstruire les menus quand l'app nous informe d'une modification
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'MB_BOARDS_MODIFIED') {
    getBoardsFromDB().then(rebuildMenus);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  rebuildMenus(await getBoardsFromDB());
});

chrome.runtime.onStartup.addListener(async () => {
  rebuildMenus(await getBoardsFromDB());
});

// ── CLIC SUR L'ICÔNE → OUVRIR / FOCUSER LE MOODBOARD ────────────────────────
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('index.html');
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

  const boardId = menuId.replace('mb-board-', '');
  const imageUrl = info.srcUrl;
  if (!imageUrl) return;

  if (
    imageUrl.startsWith('chrome://') ||
    imageUrl.startsWith('file://') ||
    imageUrl.startsWith('edge://')
  ) {
    console.warn('[MB-EXT] URL non téléchargeable (schéma interdit) :', imageUrl);
    return;
  }

  let base64Src;
  if (imageUrl.startsWith('data:')) {
    base64Src = imageUrl;
  } else {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      let mimeType = blob.type;
      if (!mimeType || mimeType === 'application/octet-stream') {
        const ext = imageUrl.split('?')[0].split('.').pop().toLowerCase();
        const mimeMap = {
          svg: 'image/svg+xml',
          webp: 'image/webp',
          gif: 'image/gif',
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          avif: 'image/avif',
          bmp: 'image/bmp',
        };
        mimeType = mimeMap[ext] || 'image/jpeg';
      }
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
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
      : imageUrl.split('/').pop().split('?')[0] || 'image.jpg'
  );

  // Écriture directe dans IndexedDB
  const boards = await getBoardsFromDB();
  const board = boards.find((b) => b.id === boardId);

  if (!board) return;

  if (!board.library) board.library = {};
  if (!board.library.image) board.library.image = [];

  board.library.image.push({
    id: 'lib_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name: fileName,
    src: base64Src,
  });

  await saveBoardsToDB(boards);

  // Avertir app.js que la bibliothèque a changé
  chrome.runtime.sendMessage({ type: 'MB_IMAGE_INJECTED' }).catch(() => {});
});
