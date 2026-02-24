// ── EXTENSION MOODBOARD INJECTOR — content.js ────────────────────────────────
//
// S'exécute dans le contexte de la page (accès direct au localStorage).
//
// Rôles :
//   • Lire mb_boards et notifier background.js → reconstruction du menu
//   • Recevoir MB_REQUEST_BOARDS → renvoyer la liste à jour
//   • Recevoir MB_INJECT         → injecter l'image, notifier app.js, renvoyer
//                                  la liste mise à jour pour synchro du menu
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

// ── Lecture et envoi de la liste des boards ───────────────────────────────────
function sendBoards() {
  const raw = localStorage.getItem('mb_boards');
  if (!raw) return;
  try {
    const boards = JSON.parse(raw);
    if (Array.isArray(boards)) {
      chrome.runtime.sendMessage({ type: 'MB_BOARDS', boards });
    }
  } catch (e) {
    // Extension rechargée à chaud : le contexte runtime est temporairement invalide
    console.warn('[MB-EXT] sendBoards :', e.message);
  }
}

// ── Réception des messages de background.js ───────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // ── background.js demande la liste des boards (changement d'onglet, etc.) ──
  if (msg.type === 'MB_REQUEST_BOARDS') {
    sendBoards();
    return; // pas de réponse async nécessaire
  }

  // ── background.js envoie une image à injecter dans un board ─────────────────
  if (msg.type === 'MB_INJECT') {
    const { boardId, base64Src, fileName } = msg;

    let boards;
    try {
      boards = JSON.parse(localStorage.getItem('mb_boards') || '[]');
    } catch {
      sendResponse({ success: false, error: 'mb_boards illisible' });
      return true;
    }

    const board = boards.find(b => b.id === boardId);
    if (!board) {
      sendResponse({ success: false, error: 'Board introuvable : ' + boardId });
      return true;
    }

    // Garantir la structure library.image
    if (!board.library)       board.library       = {};
    if (!board.library.image) board.library.image = [];

    // Créer l'item (même format qu'app.js)
    const item = {
      id:   'lib_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name: fileName,
      src:  base64Src
    };
    board.library.image.push(item);

    try {
      localStorage.setItem('mb_boards', JSON.stringify(boards));

      // Notifier app.js pour rafraîchir le panneau galerie instantanément
      window.dispatchEvent(
        new CustomEvent('mb-image-injected', { detail: { boardId } })
      );

      // Renvoyer la liste mise à jour → background.js resynchronise le menu
      sendBoards();
      sendResponse({ success: true });
    } catch (storageErr) {
      console.error('[MB-EXT] localStorage (quota dépassé ?) :', storageErr);
      sendResponse({ success: false, error: storageErr.message });
    }

    return true; // signale une réponse asynchrone à Chrome
  }
});

// ── Envoi initial au chargement de la page ────────────────────────────────────
sendBoards();
