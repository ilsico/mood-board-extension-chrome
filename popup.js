const DB_NAME = 'MoodboardDB';
const STORE_NAME = 'boards_store';

let isActive = false;
let activeTabId = null;

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

async function getCaptureState(tabId) {
  const stored = await chrome.storage.local.get('mb_capture_active_tabs');
  const tabs = stored.mb_capture_active_tabs || {};
  return tabs[tabId] || null;
}

async function setCaptureState(tabId, boardId) {
  const stored = await chrome.storage.local.get('mb_capture_active_tabs');
  const tabs = stored.mb_capture_active_tabs || {};
  if (boardId == null) {
    delete tabs[tabId];
  } else {
    tabs[tabId] = boardId;
  }
  await chrome.storage.local.set({ mb_capture_active_tabs: tabs });
}

async function populateBoardSelect() {
  const select = document.getElementById('board-select');
  const boards = await getBoardsFromDB();

  select.innerHTML = '';

  if (!Array.isArray(boards) || boards.length === 0) {
    const opt = document.createElement('option');
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = 'Aucun board — créez-en un d\'abord';
    select.appendChild(opt);
    return;
  }

  const sorted = [...boards].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  sorted.forEach((board) => {
    const opt = document.createElement('option');
    opt.value = board.id;
    opt.textContent = board.name || 'Board sans nom';
    select.appendChild(opt);
  });

  const stored = await chrome.storage.local.get('mb_capture_board_id');
  const savedId = stored.mb_capture_board_id;
  if (savedId && sorted.some((b) => b.id === savedId)) {
    select.value = savedId;
  }
}

function setErrorMessage(text) {
  let el = document.getElementById('capture-error');
  if (!el) {
    el = document.createElement('p');
    el.id = 'capture-error';
    el.style.cssText = 'font-size:11px;color:#e03600;margin-top:6px;';
    document.getElementById('capture-btn').insertAdjacentElement('afterend', el);
  }
  el.textContent = text;
}

function clearErrorMessage() {
  const el = document.getElementById('capture-error');
  if (el) el.remove();
}

function deactivateCapture() {
  const btn = document.getElementById('capture-btn');
  btn.classList.remove('active');
  btn.textContent = 'Activer le mode capture';
  isActive = false;
  if (activeTabId !== null) {
    chrome.runtime.sendMessage({ type: 'MB_CAPTURE_STOP', tabId: activeTabId }).catch(() => {});
    setCaptureState(activeTabId, null);
    activeTabId = null;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await populateBoardSelect();

  const select = document.getElementById('board-select');
  select.addEventListener('change', async () => {
    const newBoardId = select.value;
    chrome.storage.local.set({ mb_capture_board_id: newBoardId });

    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0];
    if (!activeTab) return;

    const captureBoard = await getCaptureState(activeTab.id);
    if (captureBoard === null) return;

    chrome.runtime.sendMessage({ type: 'MB_CAPTURE_UPDATE_BOARD', tabId: activeTab.id, boardId: newBoardId }).catch(() => {});
    await setCaptureState(activeTab.id, newBoardId);
  });

  const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = currentTabs[0];
  if (currentTab) {
    const activeBoardId = await getCaptureState(currentTab.id);
    if (activeBoardId !== null) {
      isActive = true;
      activeTabId = currentTab.id;
      const btn = document.getElementById('capture-btn');
      btn.classList.add('active');
      btn.textContent = 'Désactiver le mode capture';
    }
  }

  document.getElementById('open-main-btn').addEventListener('click', async () => {
    const url = chrome.runtime.getURL('index.html');
    const tabs = await chrome.tabs.query({ url });
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true });
    } else {
      chrome.tabs.create({ url });
    }
  });

  document.getElementById('capture-btn').addEventListener('click', async () => {
    if (isActive) {
      deactivateCapture();
      clearErrorMessage();
      return;
    }

    const boardId = select.value;
    if (!boardId || select.options[select.selectedIndex]?.disabled) return;

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab) return;

    const url = tab.url || '';
    if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:')) {
      setErrorMessage('Mode indisponible sur cette page');
      return;
    }

    clearErrorMessage();
    isActive = true;
    activeTabId = tab.id;

    const btn = document.getElementById('capture-btn');
    btn.classList.add('active');
    btn.textContent = 'Désactiver le mode capture';

    chrome.runtime.sendMessage({ type: 'MB_CAPTURE_START', boardId, tabId: tab.id }).catch(() => {});
    await setCaptureState(tab.id, boardId);
  });

  document.getElementById('figma-export-btn').addEventListener('click', async () => {
    const statusEl = document.getElementById('figma-status');
    const btn = document.getElementById('figma-export-btn');
    statusEl.className = '';
    statusEl.textContent = 'Recherche du Moodboard…';
    btn.classList.add('loading');

    const moodboardUrl = chrome.runtime.getURL('index.html');
    const tabs = await chrome.tabs.query({ url: moodboardUrl });
    if (tabs.length === 0) {
      statusEl.className = 'err';
      statusEl.textContent = '⚠ Ouvrez d\'abord le Moodboard.';
      btn.classList.remove('loading');
      return;
    }

    try {
      await chrome.tabs.sendMessage(tabs[0].id, { type: 'MB_FIGMA_EXPORT' });
      statusEl.className = 'ok';
      statusEl.textContent = '✅ JSON téléchargé !';
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = ''; }, 3000);
    } catch (e) {
      statusEl.className = 'err';
      statusEl.textContent = '⚠ ' + e.message;
    }
    btn.classList.remove('loading');
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'MB_BOARDS_MODIFIED') {
      populateBoardSelect();
    } else if (msg.type === 'MB_CAPTURE_STOPPED') {
      if (msg.tabId != null) setCaptureState(msg.tabId, null);
      const btn = document.getElementById('capture-btn');
      btn.classList.remove('active');
      btn.textContent = 'Activer le mode capture';
      isActive = false;
      activeTabId = null;
    }
  });
});
