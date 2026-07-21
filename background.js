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

// Attend la fin réelle de la transaction : le service worker MV3 peut être arrêté
// dès que la fonction rend la main, ce qui perdrait une écriture non committée.
async function saveBoardsToDB(boards) {
  try {
    const db = await getDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(boards, 'mb_boards');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch (err) {
    return false;
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
    // Trier du plus récemment sauvegardé au plus ancien
    const sorted = [...boards].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    for (const board of sorted) {
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
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'MB_BOARDS_MODIFIED') {
    getBoardsFromDB().then(rebuildMenus);
  } else if (msg.type === 'MB_CAPTURE_START') {
    const { boardId, tabId } = msg;
    (async () => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content-capture.js'] });
      chrome.tabs.sendMessage(tabId, { type: 'MB_CAPTURE_ENABLE', boardId }).catch(() => {});
    })();
  } else if (msg.type === 'MB_CAPTURE_STOP') {
    chrome.tabs.sendMessage(msg.tabId, { type: 'MB_CAPTURE_DISABLE' }).catch(() => {});
  } else if (msg.type === 'MB_CAPTURE_IMAGE') {
    addImageToBoardLibrary(msg.boardId, msg.imageUrl);
  } else if (msg.type === 'MB_CAPTURE_UPDATE_BOARD') {
    chrome.tabs.sendMessage(msg.tabId, { type: 'MB_CAPTURE_UPDATE_BOARD', boardId: msg.boardId }).catch(() => {});
  } else if (msg.type === 'MB_CAPTURE_STOP_FROM_PAGE') {
    const tabId = sender.tab?.id;
    (async () => {
      const stored = await chrome.storage.local.get('mb_capture_active_tabs');
      const tabs = stored.mb_capture_active_tabs || {};
      delete tabs[tabId];
      await chrome.storage.local.set({ mb_capture_active_tabs: tabs });
      chrome.runtime.sendMessage({ type: 'MB_CAPTURE_STOPPED', tabId }).catch(() => {});
    })();
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  rebuildMenus(await getBoardsFromDB());
});

chrome.runtime.onStartup.addListener(async () => {
  rebuildMenus(await getBoardsFromDB());
});

// ── AJOUT IMAGE DANS LA BIBLIOTHÈQUE D'UN BOARD ──────────────────────────────
async function addImageToBoardLibrary(boardId, imageUrl) {
  if (
    imageUrl.startsWith('chrome://') ||
    imageUrl.startsWith('file://') ||
    imageUrl.startsWith('edge://')
  ) {
    return; // schéma non téléchargeable (chrome://, file://, edge://)
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
      return; // image inaccessible (CORS, 404, réseau)
    }
  }

  const fileName = decodeURIComponent(
    imageUrl.startsWith('data:')
      ? 'image.jpg'
      : imageUrl.split('/').pop().split('?')[0] || 'image.jpg'
  );

  const libItem = {
    id: 'lib_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name: fileName,
    src: base64Src,
  };

  const ok = await pushLibraryImage(boardId, libItem);
  if (ok) chrome.runtime.sendMessage({ type: 'MB_IMAGE_INJECTED' }).catch(() => {});
}

// Lecture + écriture dans UNE SEULE transaction : un get() suivi d'un put() séparé
// écraserait les modifications faites par l'UI entre les deux (clic droit rapide
// sur deux images, ou board ouvert pendant l'ajout).
function pushLibraryImage(boardId, libItem) {
  return getDB()
    .then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const getReq = store.get('mb_boards');
          let found = false;
          getReq.onsuccess = () => {
            const boards = getReq.result || [];
            const board = boards.find((b) => b.id === boardId);
            if (!board) return; // tx se termine sans écriture
            found = true;
            if (!board.library) board.library = {};
            if (!board.library.image) board.library.image = [];
            board.library.image.push(libItem);
            store.put(boards, 'mb_boards');
          };
          tx.oncomplete = () => resolve(found);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        })
    )
    .catch(() => false);
}

// ── CLIC SUR UN ITEM DU MENU CONTEXTUEL ──────────────────────────────────────
chrome.contextMenus.onClicked.addListener(async (info) => {
  const menuId = String(info.menuItemId);
  if (!menuId.startsWith('mb-board-')) return;

  const boardId = menuId.replace('mb-board-', '');
  if (!info.srcUrl) return;

  await addImageToBoardLibrary(boardId, info.srcUrl);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  const stored = await chrome.storage.local.get('mb_capture_active_tabs');
  const tabs = stored.mb_capture_active_tabs || {};
  if (!tabs[tabId]) return;
  delete tabs[tabId];
  await chrome.storage.local.set({ mb_capture_active_tabs: tabs });
  chrome.runtime.sendMessage({ type: 'MB_CAPTURE_STOPPED', tabId }).catch(() => {});
});
