const App = (function() {
  // ── ÉTAT ─────────────────────────────────────────────────────────────────
  let boards          = []; // chargé de façon asynchrone dans init() via loadBoardsFromStorage()
  let library         = {}; // bibliothèque du board courant — chargée dans openBoard()
  let currentBoardId  = null;
  let currentFolder   = 'all';
  let panelFolder     = 'all';
  let libPanelOpen    = false;
  let zoomLevel       = 1;
  let panX = 0, panY  = 0;
  let pendingToolDropPos = null;
  let pinchTouchSetupDone = false; // guard pour les listeners touch pinch (ne s'enregistrent qu'une fois)
  let isPanning       = false;
  let isPanningMode   = false;
  let panStart        = { x:0, y:0 };
  let history         = [];
  let historyIndex    = -1;
  let selectedEl      = null;           // élément unique sélectionné
  let multiSelected   = new Set();      // sélection multiple
  let libSelectedIds  = new Set();      // <--- LIGNE À AJOUTER POUR CORRIGER L'ERREUR
  let isResizing      = false;
  let resizeEl        = null;
  let resizeStartW=0, resizeStartH=0, resizeStartX=0, resizeStartY=0;
  let resizeRatio     = null; // ratio w/h pour les images (resize proportionnel)
  let snapThreshold   = 8;   // pixels canvas pour déclencher le snap
  let isAltDown       = false; // état de la touche Alt
  let ctrlSnap        = false; // Ctrl enfoncé → snap actif
  let renamingBoardId = null;
  let ctxTargetEl     = null;
  let videoTabMode    = 'url';
  let nextZ           = 100;
  let saveTimer       = null;
  // Stockage hors-DOM des données base64 des images (évite des attributs HTML massifs)
  const _imgStore     = new Map(); // id -> base64 src
  // Rectangle de sélection
  let isSelecting     = false;
  let selRectStart    = { x:0, y:0 };
  let isDraggingFromPanel = false; // true quand un drag vient du panneau bibliothèque
  let draggedLibItemId   = null;  // ID de l'item lib en cours de drag (pour drop sur catégorie)
  let draggedLibItems    = [];    // items sélectionnés pour drag multiple vers le board
  let fileReplaceTarget = null;    // élément .board-element à remplacer lors du prochain handleFileUpload

  //// ── PERSISTANCE (IndexedDB - Stockage illimité sur disque dur) ───────────
  const DB_NAME = 'MoodboardDB';
  const STORE_NAME = 'boards_store';

  function getDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

 async function saveBoards() {
    try {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(boards, 'mb_boards');
      
      // Force le menu clic droit à se mettre à jour
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ type: 'MB_BOARDS_MODIFIED' }).catch(() => {});
      }
    } catch(e) { console.warn('Erreur sauvegarde IndexedDB:', e); }
  }

  function saveLibrary() {
    if (!currentBoardId) return;
    const b = boards.find(x => x.id === currentBoardId);
    if (b) { b.library = library; saveBoards(); }
  }

  function loadLibraryForBoard(boardId) {
    const b = boards.find(x => x.id === boardId);
    const raw = (b && b.library) ? b.library : {};
    library = raw;
    ['typographie','couleur','logo','image'].forEach(f => { if (!library[f]) library[f] = []; });
  }

  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrentBoard, 800); }

  // Miniatures désactivées (cartes accueil sans aperçu)
  let thumbTimer = null;
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


  function saveCurrentBoard() {
    if (!currentBoardId) return;
    const board = boards.find(b => b.id === currentBoardId);
    if (!board) return;
    const elements = [];
    document.querySelectorAll('#canvas .board-element').forEach(el => {
      elements.push({
        id: el.dataset.id, type: el.dataset.type,
        x: parseFloat(el.style.left)||0, y: parseFloat(el.style.top)||0,
        w: parseFloat(el.style.width)||null, h: parseFloat(el.style.height)||null,
        z: parseInt(el.style.zIndex)||100,
        data: el.dataset.type === 'image'
          ? (_imgStore.get(el.dataset.id) || el.dataset.savedata || '')
          : (el.dataset.savedata || '')
      });
    });
    // Sauvegarder les connexions
    document.querySelectorAll('#canvas .el-connection').forEach(svg => {
      elements.push({
        type: 'connection',
        from: svg.dataset.from, to: svg.dataset.to,
        connId: svg.dataset.connId
      });
    });
    // Sauvegarder les captions
    document.querySelectorAll('#canvas .el-caption').forEach(cap => {
      elements.push({
        type: 'caption',
        x: parseFloat(cap.style.left)||0, y: parseFloat(cap.style.top)||0,
        width: cap.style.width, parentId: cap.dataset.parentId||'',
        text: cap.textContent||''
      });
    });
    board.elements = elements;
    board.savedAt = Date.now();
    saveBoards();
    scheduleThumbnail(); // mise à jour miniature en temps réel
  }

  /// ── CHARGEMENT INITIAL DES BOARDS ────────────────────────────────────────
  async function loadBoardsFromStorage() {
    // 1. Tenter de charger depuis IndexedDB (nouveau stockage illimité)
    try {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get('mb_boards');
      const data = await new Promise(resolve => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });

      if (data && Array.isArray(data) && data.length > 0) {
        boards = data;
        return;
      }
    } catch(e) { console.warn('Erreur chargement IndexedDB:', e); }

    // 2. Migration automatique de vos anciennes données limitées
    const raw = localStorage.getItem('mb_boards');
    if (raw) {
      try { 
        boards = JSON.parse(raw); 
        saveBoards(); // Transfère vos anciens boards vers le stockage illimité
      } catch { boards = []; }
    }
  }

  // ── INIT ─────────────────────────────────────────────────────────────────
  async function init() {
    await loadBoardsFromStorage();

    if (!boards.length) addBoard('Mon premier moodboard', false);
    // Migration : si une bibliothèque globale (mb_library) existe, la copier dans le premier board
    const legacyLib = localStorage.getItem('mb_library');
    if (legacyLib && boards.length) {
      try {
        const parsed = JSON.parse(legacyLib);
        const hasContent = Object.values(parsed).some(arr => arr && arr.length > 0);
        if (hasContent && !boards[0].library) {
          boards[0].library = parsed;
          saveBoards();
        }
      } catch(_) {}
      localStorage.removeItem('mb_library');
    }
    renderHome();
    setupCanvasEvents();
    setupKeyboard();
    setupMultiResizeHandle();
    document.querySelectorAll('.modal-overlay').forEach(ov => {
      ov.addEventListener('mousedown', e => { if (e.target === ov) ov.classList.add('hidden'); });
    });
    document.addEventListener('click', () => hideContextMenu());
    // Fermer le panneau texte au clic en dehors d'une note en édition
    document.addEventListener('mousedown', e => {
      if (e.detail >= 2) return; // ignorer les doubles-clics (ils déclenchent activateNoteEdit)
      const panel = document.getElementById('text-edit-panel');
      if (!panel || !panel.classList.contains('active')) return;
      if (panel.contains(e.target)) return; // clic dans le panneau → garder ouvert
      if (e.target.closest('.board-element[data-editing="1"]') || e.target.closest('.el-caption:focus')) return;
      const ta = document.querySelector('.board-element[data-editing="1"] textarea');
      if (ta) { ta.blur(); }
      else { hideTextEditPanel(); }
    }, true); // capture pour intercepter avant les autres handlers
    setupPanelDrop();
   // Fermer les lightboxes au clic sur l'overlay
    document.getElementById('lightbox-overlay').addEventListener('click', closeLightbox);
    document.getElementById('video-lightbox-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('video-lightbox-overlay')) closeVideoLightbox();
    });
    // Fermer les lightboxes à Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeLightbox(); closeVideoLightbox(); }
    });
    
    setupUIEvents(); // <-- APPEL DE LA FONCTION (très important)

  } // <--- ACCOLADE MANQUANTE POUR FERMER LA FONCTION init()

  // ── ÉVÉNEMENTS UI ───────
  function setupUIEvents() {
    // Utilitaire pour éviter de crasher si un élément n'existe pas dans le HTML
    const addEvt = (id, event, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(event, handler);
    };

    // Écran d'accueil
    addEvt('new-board-btn', 'click', () => createBoard());

    // Header board
    addEvt('back-btn', 'click', () => goHome());
    addEvt('fit-screen-btn', 'click', () => fitElementsToScreen());
    addEvt('preview-btn', 'click', () => togglePreviewMode());

    // Toolbar — outils (clic + drag)
    document.getElementById('tool-note')?.addEventListener('click', () => addNote());
    document.getElementById('tool-note')?.addEventListener('dragstart', e => toolDragStart(e, 'note'));
    
    document.getElementById('tool-color')?.addEventListener('click', () => addColorDirect());
    document.getElementById('tool-color')?.addEventListener('dragstart', e => toolDragStart(e, 'color'));
    
    document.getElementById('tool-link')?.addEventListener('click', () => openLinkModal());
    document.getElementById('tool-link')?.addEventListener('dragstart', e => toolDragStart(e, 'link'));
    
    document.getElementById('tool-file')?.addEventListener('click', () => addFile());
    document.getElementById('tool-file')?.addEventListener('dragstart', e => toolDragStart(e, 'file'));

    addEvt('tool-export', 'click', () => openExportModal());

    // Panneau texte
    addEvt('tp-roman', 'click', () => applyTextFont('helvetica-roman'));
    addEvt('tp-bold', 'click', () => applyTextFont('helvetica-bold'));
    addEvt('text-size-minus', 'click', () => applyTextSizeDelta(-1));
    addEvt('text-size-plus', 'click', () => applyTextSizeDelta(1));
    addEvt('ta-left', 'click', () => applyTextAlign('left'));
    addEvt('ta-center', 'click', () => applyTextAlign('center'));
    addEvt('ta-right', 'click', () => applyTextAlign('right'));

    // Panneau bibliothèque
    addEvt('lib-toggle-btn', 'click', () => toggleLibPanel());
    addEvt('lib-add-btn', 'click', () => uploadImages());
    
    // Les chips de dossier sont créées dynamiquement dans renderFolderChips()

    addEvt('lib-panel-search', 'input', e => searchPanelLib(e.target.value));

    document.getElementById('lib-panel-grid')?.addEventListener('click', e => {
      if (!e.target.closest('.lib-panel-item')) {
        if (typeof libSelectedIds !== 'undefined') libSelectedIds.clear();
        document.querySelectorAll('.lib-panel-item.selected-lib-item').forEach(d => d.classList.remove('selected-lib-item'));
      }
    });

    // Inputs fichiers cachés
    addEvt('file-input-images', 'change', e => handleImageUpload(e));
    addEvt('file-input-file', 'change', e => handleFileUpload(e));
    addEvt('file-input-video', 'change', e => handleVideoUpload(e));

    // Modale couleur
    addEvt('close-color-modal', 'click', () => closeColorModal());
    addEvt('color-picker-input', 'input', e => syncHex(e.target.value));
    addEvt('hex-input', 'input', e => syncColor(e.target.value));
    addEvt('add-color-btn', 'click', () => addColorElement());

    // Modale lien
    addEvt('close-link-modal', 'click', () => closeLinkModal());
    addEvt('submit-link', 'click', () => addLinkElement());

    // Modale vidéo
    addEvt('close-video-modal', 'click', () => closeVideoModal());
    addEvt('vt-url', 'click', () => switchVideoTab('url'));
    addEvt('vt-local', 'click', () => switchVideoTab('local'));
    addEvt('submit-video-url', 'click', () => addVideoURL());
    addEvt('submit-video-local', 'click', () => document.getElementById('file-input-video')?.click());

    // Modale rename
    addEvt('close-rename-modal', 'click', () => closeRenameModal());
    addEvt('rename-input', 'keydown', e => { if (e.key === 'Enter') confirmRename(); });
    addEvt('submit-rename', 'click', () => confirmRename());

    // Modale création board
    addEvt('close-create-board-modal', 'click', () => closeCreateBoardModal());
    addEvt('create-board-input', 'keydown', e => {
      if (e.key === 'Enter')  confirmCreateBoard();
      if (e.key === 'Escape') closeCreateBoardModal();
    });
    addEvt('submit-create-board', 'click', () => confirmCreateBoard());

    // Modale export
    addEvt('close-export-modal', 'click', () => closeExportModal());
    addEvt('export-png-btn', 'click', () => { exportPNG(); closeExportModal(); });
    addEvt('export-pdf-hr-btn', 'click', () => { exportPDF(2); closeExportModal(); });
    addEvt('export-pdf-lr-btn', 'click', () => { exportPDF(1); closeExportModal(); });

    // Menu contextuel
    addEvt('ctx-bring-front', 'click', () => ctxBringFront());
    addEvt('ctx-send-back', 'click', () => ctxSendBack());
    addEvt('ctx-duplicate', 'click', () => ctxDuplicate());
    addEvt('ctx-img-download', 'click', () => ctxDownloadImage());
    addEvt('ctx-img-replace', 'click', () => ctxReplaceImage());
    addEvt('ctx-img-caption', 'click', () => ctxAddCaption());
    addEvt('ctx-connect', 'click', () => ctxConnect());
    addEvt('ctx-delete', 'click', () => ctxDelete());

    // Lightbox vidéo
    addEvt('vlb-close-btn', 'click', () => closeVideoLightbox());
  }
  // ── BOARDS ───────────────────────────────────────────────────────────────
  function createBoard() {
    const input = document.getElementById('create-board-input');
    if (input) input.value = '';
    openModal('create-board-modal');
    setTimeout(() => { if (input) input.focus(); }, 80);
  }
  function closeCreateBoardModal() {
    closeModal('create-board-modal');
  }
  function confirmCreateBoard() {
    const input = document.getElementById('create-board-input');
    const name = (input ? input.value : '').trim();
        if (!name || name.length > 45) return;

    closeCreateBoardModal();
    addBoard(name);
  }

  function addBoard(name, render=true) {
    const id = 'board_' + Date.now();
    // Positionner la nouvelle carte à droite de la dernière
    const cols = Math.max(1, Math.floor((window.innerWidth - 200) / 220));
    const idx = boards.length;
    const bx = 60 + (idx % cols) * 220;
    const by = 80 + Math.floor(idx / cols) * 240;
    boards.push({
      id, name,
      created: new Date().toLocaleDateString('fr-FR'),
      savedAt: null, thumbnail:'', elements:[],
      x: bx, y: by
    });
    saveBoards();
    if (render) renderHome();
    return id;
  }

  function formatSavedAt(ts) {
        if (!ts) return { date: '', time: '' };

    const d = new Date(ts);
        const date = d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });

    const time = d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
    return { date, time };
  }

  function renderHome() {
    const canvas = document.getElementById('boards-canvas');
    canvas.innerHTML = '';
    boards.forEach((b, idx) => {
      const card = document.createElement('div');
      card.className = 'board-card';
      card.dataset.id = b.id; // pour cibler la carte lors de la mise à jour du thumbnail
      card.style.left = (b.x || 60 + (idx % 4) * 220) + 'px';
      card.style.top  = (b.y || 80 + Math.floor(idx/4) * 240) + 'px';
      card.style.animationDelay = (idx * 0.05) + 's';

      const saved = formatSavedAt(b.savedAt);
      card.innerHTML = `
        ${b.thumbnail ? `<img class="board-thumb" src="${b.thumbnail}" alt="">` : ''}

        <div class="board-info">
          <div class="board-name">${escHtml(b.name)}</div>
                    ${saved.date ? `<div class="board-save-date"><span>${saved.date}</span><span>${saved.time}</span></div>` : ''}

        </div>
        <div class="board-actions">
                   <button class="board-action-btn btn-rename"><img src="PNG/renommer.png" style="width:14px;height:14px;pointer-events:none;"></button>
          <button class="board-action-btn delete btn-delete"><img src="PNG/supprimer.png" style="width:14px;height:14px;pointer-events:none;"></button>
        </div>
      </div>
      `;

      card.querySelector('.btn-rename').addEventListener('click', (e) => { e.stopPropagation(); App.renameBoardPrompt(b.id); });
      card.querySelector('.btn-delete').addEventListener('click', (e) => { e.stopPropagation(); App.deleteBoard(b.id); });


      // Drag pour déplacer la carte — simple clic+drag, double-clic pour ouvrir
      card.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        if (e.target.closest('.board-action-btn')) return;
        e.preventDefault();
        const startX = e.clientX - (b.x || 0);
        const startY = e.clientY - (b.y || 0);
        let targetX = b.x || 0, targetY = b.y || 0;
        let curX = targetX, curY = targetY;
        let moved = false;
        let rafId = null;

        function lerp(a, z, t) { return a + (z - a) * t; }
        function rafLoop() {
          curX = lerp(curX, targetX, 0.16);
          curY = lerp(curY, targetY, 0.16);
          card.style.left = curX + 'px';
          card.style.top  = curY + 'px';
          if (Math.abs(targetX - curX) > 0.1 || Math.abs(targetY - curY) > 0.1) {
            rafId = requestAnimationFrame(rafLoop);
          } else {
            card.style.left = targetX + 'px';
            card.style.top  = targetY + 'px';
            rafId = null;
          }
        }

        function onMove(ev) {
          const nx = ev.clientX - startX;
          const ny = ev.clientY - startY;
          if (!moved && Math.abs(nx - targetX) < 4 && Math.abs(ny - targetY) < 4) return;
          moved = true;
          targetX = nx;
          targetY = ny;
          if (!rafId) rafId = requestAnimationFrame(rafLoop);
        }
        function onUp(ev) {
          if (moved) {
            b.x = Math.round(curX); b.y = Math.round(curY);
            saveBoards();
          } else {
            // Pas de déplacement = clic simple → ouvrir le board
            if (!ev.target.closest('.board-action-btn')) openBoard(b.id);
          }
          if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        }
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
      canvas.appendChild(card);
    });

    // Pan + zoom du canvas accueil
    initHomePan(canvas);
    // Appliquer le transform courant (préserve zoom/pan si on revient de board)
    applyHomeTransform(canvas);
  }

  let homePanX = 0, homePanY = 0, homeZoom = 1;

  function applyHomeTransform(cv) {
    // Clamper le pan pour que les cartes ne s'éloignent jamais entièrement de l'écran
    if (boards.length) {
      const container = document.getElementById('boards-container');
      const vw = container ? container.offsetWidth  : window.innerWidth;
      const vh = container ? container.offsetHeight : window.innerHeight;
      // Bounding box de toutes les cartes (coordonnées canvas brutes)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      boards.forEach(b => {
        const cx = b.x || 0, cy = b.y || 0;
        minX = Math.min(minX, cx); minY = Math.min(minY, cy);
        maxX = Math.max(maxX, cx + 180); maxY = Math.max(maxY, cy + 210);
      });
      const margin = 80; // px de marge minimale visible
      // En coordonnées viewport : bord gauche des cartes doit rester < vw-margin
      // bord droit des cartes doit rester > margin
      const leftEdge  = minX * homeZoom + homePanX;   // position viewport du bord gauche des cartes
      const rightEdge = maxX * homeZoom + homePanX;   // position viewport du bord droit
      const topEdge   = minY * homeZoom + homePanY;
      const botEdge   = maxY * homeZoom + homePanY;
      if (leftEdge  > vw - margin) homePanX = vw - margin - minX * homeZoom;
      if (rightEdge < margin)      homePanX = margin - maxX * homeZoom;
      if (topEdge   > vh - margin) homePanY = vh - margin - minY * homeZoom;
      if (botEdge   < margin)      homePanY = margin - maxY * homeZoom;
    }
    cv.style.transform = `translate(${homePanX}px,${homePanY}px) scale(${homeZoom})`;
    cv.style.transformOrigin = '0 0';
  }

  function initHomePan(canvas) {
    const container = document.getElementById('boards-container');

    // ── Souris : pan (clic gauche ou bouton molette sur fond) ─────────────
    container.onmousedown = e => {
      if (e.button !== 1 && e.button !== 0) return;
      if (e.target !== container && e.target !== canvas) return;
      e.preventDefault();
      const sx = e.clientX - homePanX;
      const sy = e.clientY - homePanY;
      function onMove(ev) {
        homePanX = ev.clientX - sx;
        homePanY = ev.clientY - sy;
        applyHomeTransform(canvas);
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

    // ── Molette : pan OU zoom (Alt+molette) ───────────────────────────────
    if (!container._wheelHome) {
      container._wheelHome = true;
      container.addEventListener('wheel', e => {
        e.preventDefault();
        if (e.altKey) {
          const delta = e.deltaY > 0 ? -0.08 : 0.08;
          const newZ = Math.min(Math.max(homeZoom + delta, 0.15), 4);
          const rect = container.getBoundingClientRect();
          const mx = e.clientX - rect.left, my = e.clientY - rect.top;
          homePanX = mx - (mx - homePanX) * (newZ / homeZoom);
          homePanY = my - (my - homePanY) * (newZ / homeZoom);
          homeZoom = newZ;
        } else {
          homePanX -= e.deltaX;
          homePanY -= e.deltaY;
        }
        applyHomeTransform(canvas);
      }, { passive: false });
    }

   
    // Supprimer les anciens listeners avant de réattacher
    if (container._homePinchTS) {
      container.removeEventListener('touchstart', container._homePinchTS, { capture: true });
      container.removeEventListener('touchmove',  container._homePinchTM, { capture: true });
      container.removeEventListener('touchend',   container._homePinchTE, { capture: true });
    }

    let hPinchDist = 0, hPinchZoom = 1, hPinchMX = 0, hPinchMY = 0;
    let hPanId = null, hPanSX = 0, hPanSY = 0;

    container._homePinchTS = function(e) {
      if (e.target && (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')) return;
      e.preventDefault();
      if (e.touches.length >= 2) {
        hPanId = null;
        const t1 = e.touches[0], t2 = e.touches[1];
        hPinchDist = Math.hypot(t2.clientX-t1.clientX, t2.clientY-t1.clientY);
        hPinchZoom = homeZoom;
        hPinchMX = (t1.clientX+t2.clientX)/2;
        hPinchMY = (t1.clientY+t2.clientY)/2;
      } else if (e.touches.length === 1) {
        hPinchDist = 0;
        const t = e.touches[0];
        const hit = document.elementFromPoint(t.clientX, t.clientY);
        if (hit === container || hit === canvas) {
          hPanId = t.identifier;
          hPanSX = t.clientX - homePanX;
          hPanSY = t.clientY - homePanY;
        } else { hPanId = null; }
      }
    };
    container._homePinchTM = function(e) {
      if (e.target && (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')) return;
      e.preventDefault();
      if (e.touches.length >= 2 && hPinchDist > 0) {
        const t1 = e.touches[0], t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX-t1.clientX, t2.clientY-t1.clientY);
        const newZ = Math.min(Math.max(hPinchZoom * (dist/hPinchDist), 0.15), 4);
        const rect = container.getBoundingClientRect();
        const mx = hPinchMX - rect.left, my = hPinchMY - rect.top;
        homePanX = mx - (mx - homePanX) * (newZ / homeZoom);
        homePanY = my - (my - homePanY) * (newZ / homeZoom);
        homeZoom = newZ;
        applyHomeTransform(canvas);
        updateZoomDisplay();
      } else if (e.touches.length === 1 && hPanId !== null) {
        const t = [...e.touches].find(x => x.identifier === hPanId);
        if (t) {
          homePanX = t.clientX - hPanSX;
          homePanY = t.clientY - hPanSY;
          applyHomeTransform(canvas);
        }
      }
    };
    container._homePinchTE = function(e) {
      if (e.touches.length < 2) hPinchDist = 0;
      if (e.touches.length === 0) hPanId = null;
    };

    container.addEventListener('touchstart', container._homePinchTS, { passive: false, capture: true });
    container.addEventListener('touchmove',  container._homePinchTM, { passive: false, capture: true });
    container.addEventListener('touchend',   container._homePinchTE, { passive: true,  capture: true });
  }

  function openBoard(id) {
    const board = boards.find(b => b.id === id);
    if (!board) return;
    currentBoardId = id;
    loadLibraryForBoard(id); // charger la bibliothèque propre à ce board
    document.getElementById('board-title-display').textContent = board.name;
    document.getElementById('home-screen').style.display = 'none';
    document.getElementById('board-screen').style.display = 'flex';
    // Réattacher les listeners pinch maintenant que canvas-wrapper est visible
    if (window._reattachPinch) window._reattachPinch();
    document.getElementById('canvas').innerHTML = '';
    zoomLevel=1; panX=0; panY=0; nextZ=100;
    history=[]; historyIndex=-1; selectedEl=null; multiSelected.clear();
    applyTransform(); updateZoomDisplay();
    if (board.elements && board.elements.length) {
      board.elements.forEach(e => restoreElement(e));
      // Attendre le rendu (les images sont asynchrones), puis centrer
      setTimeout(() => fitElementsToScreen(), 120);
    }
    pushHistory();
    renderPanelLib();
  }

  function goHome() {
    try { saveCurrentBoard(); } catch(e) { console.warn('Erreur sauvegarde:', e); }
    clearTimeout(thumbTimer);
    document.getElementById('board-screen').style.display = 'none';
    document.getElementById('home-screen').style.display = 'flex';
    currentBoardId=null; selectedEl=null; multiSelected.clear();
    renderHome();
  }

  function captureBoardThumbnail() {
    return new Promise((resolve, reject) => {
      const canvasEl = document.getElementById('canvas');
      const els = canvasEl.querySelectorAll('.board-element');
      if (!els.length) { reject(); return; }

      // Bounding box — même logique que fitElementsToScreen
      let minL=Infinity, minT=Infinity, maxR=-Infinity, maxB=-Infinity;
      els.forEach(el => {
        const l = parseFloat(el.style.left) || 0;
        const t = parseFloat(el.style.top)  || 0;
        const r = l + el.offsetWidth;
        const b = t + el.offsetHeight;
        if (l < minL) minL = l;
        if (t < minT) minT = t;
        if (r > maxR) maxR = r;
        if (b > maxB) maxB = b;
      });
      const contentW = maxR - minL;
      const contentH = maxB - minT;
      if (contentW <= 0 || contentH <= 0) { reject(); return; }

      // Marge proportionnelle de 7% autour du bounding box (entre les 5-10% de fitElementsToScreen)
      const marginX = contentW * 0.07;
      const marginY = contentH * 0.07;
      const cropX = minL - marginX;
      const cropY = minT - marginY;
      const cropW = contentW + marginX * 2;
      const cropH = contentH + marginY * 2;

      // Cloner le canvas dans un conteneur caché à scale(1) — le DOM visible n'est pas touché
      const ghost = canvasEl.cloneNode(true);
      ghost.style.position = 'fixed';
      ghost.style.left = '-99999px';
      ghost.style.top  = '0px';
      ghost.style.transform = 'translate(0px,0px) scale(1)';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '-1';
      document.body.appendChild(ghost);
      // Forcer le reflow pour que offsetWidth/offsetHeight soient corrects sur le ghost
      ghost.getBoundingClientRect();

      html2canvas(ghost, {
        scale: 1.5, useCORS: true, allowTaint: true,
        x: cropX, y: cropY, width: cropW, height: cropH, scrollX: 0, scrollY: 0
      }).then(c => {
        ghost.remove();
        resolve({ dataUrl: c.toDataURL('image/png'), cropW, cropH });
      }).catch(err => { ghost.remove(); reject(err); });
    });
  }

  function deleteBoard(id) {
    if (!confirm('Supprimer ce moodboard ?')) return;
    boards = boards.filter(b => b.id !== id);
    saveBoards(); renderHome();
  }

  function renameBoardPrompt(id) {
    renamingBoardId = id;
    const b = boards.find(b => b.id === id);
    document.getElementById('rename-input').value = b ? b.name : '';
    openModal('rename-modal');
    setTimeout(() => document.getElementById('rename-input').focus(), 80);
  }
  function confirmRename() {
    const val = document.getElementById('rename-input').value.trim();
    if (!val) return;
    const b = boards.find(b => b.id === renamingBoardId);
    if (b) { b.name = val; saveBoards(); renderHome(); }
    if (currentBoardId === renamingBoardId)
      document.getElementById('board-title-display').textContent = val;
    closeModal('rename-modal');
  }
  function closeRenameModal() { closeModal('rename-modal'); }

  // ── CANVAS / ZOOM / PAN ──────────────────────────────────────────────────
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
  let zoomToastTimer;
  function updateZoomDisplay() {
    const t = document.getElementById('zoom-toast');
    if (!t) return;
    t.textContent = Math.round(zoomLevel * 100) + '%';
    t.classList.add('show');
    clearTimeout(zoomToastTimer);
    zoomToastTimer = setTimeout(() => t.classList.remove('show'), 1200);
  }
  function zoomIn()     { zoomLevel = Math.min(zoomLevel+0.1,4);    applyTransform(); updateZoomDisplay(); }
  function zoomOut()    { zoomLevel = Math.max(zoomLevel-0.1,0.15); applyTransform(); updateZoomDisplay(); }
  function resetZoom()  { zoomLevel=1; panX=0; panY=0; applyTransform(); updateZoomDisplay(); }
  function fitToScreen(){ zoomLevel=0.45; panX=80; panY=60; applyTransform(); updateZoomDisplay(); }

  function fitElementsToScreen() {
    const els = document.querySelectorAll('#canvas .board-element');
    if (!els.length) return;
    // Bounding box de tous les éléments en coordonnées canvas
    let minL=Infinity, minT=Infinity, maxR=-Infinity, maxB=-Infinity;
    els.forEach(el => {
      const l = parseFloat(el.style.left)||0;
      const t = parseFloat(el.style.top) ||0;
      const r = l + el.offsetWidth;
      const b = t + el.offsetHeight;
      if (l < minL) minL = l;
      if (t < minT) minT = t;
      if (r > maxR) maxR = r;
      if (b > maxB) maxB = b;
    });
    const contentW = maxR - minL;
    const contentH = maxB - minT;
    if (contentW <= 0 || contentH <= 0) return;

    const wrapper = document.getElementById('canvas-wrapper');
    const vw = wrapper.clientWidth;
    const vh = wrapper.clientHeight;

    // 5% de marge de chaque côté autour du bounding box des éléments
    const marginX = contentW * 0.05;
    const marginY = contentH * 0.05;
    const totalW = contentW + marginX * 2;
    const totalH = contentH + marginY * 2;

    // Zoom pour que le contenu + 5% de marge tiennent dans la fenêtre
    const scaleX = vw / totalW;
    const scaleY = vh / totalH;
    zoomLevel = Math.min(Math.max(Math.min(scaleX, scaleY), 0.1), 3);

    // Pan pour centrer le bounding box + marge dans la fenêtre
    const zoneLeft = minL - marginX;
    const zoneTop  = minT - marginY;
    panX = (vw  - totalW * zoomLevel) / 2 - zoneLeft * zoomLevel;
    panY = (vh - totalH * zoomLevel) / 2 - zoneTop  * zoomLevel;

    applyTransform(); updateZoomDisplay();
  }

  // ── MODE APERÇU PLEIN ÉCRAN ─────────────────────────────────────────────
  let previewMode = false;
  let previewToastTimer = null;

  // Synchroniser previewMode si l'utilisateur quitte le plein écran via Échap/F11 natif
  document.addEventListener('fullscreenchange', () => {
    const isFs = !!document.fullscreenElement;
    if (!isFs && previewMode) {
      // Le plein écran a été quitté sans passer par togglePreviewMode → sortir du mode preview aussi
      previewMode = false;
      document.body.classList.remove('preview-mode');
    }
  });

  function togglePreviewMode() {
    previewMode = !previewMode;
    document.body.classList.toggle('preview-mode', previewMode);
    if (previewMode) {
      // Demander le plein écran natif (F11) — navigationUI:'hide' masque la vignette Chrome
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      }
      // Ajuster la vue pour remplir le plein écran
      requestAnimationFrame(() => { fitElementsToScreen(); });
      // Toast "Échap pour sortir" — utilise #preview-toast (position:fixed, non masqué par preview-mode CSS)
      const pt = document.getElementById('preview-toast');
      if (pt) {
        pt.textContent = 'Échap pour sortir';
        pt.classList.add('show');
        clearTimeout(previewToastTimer);
        previewToastTimer = setTimeout(() => pt.classList.remove('show'), 2800);
      }
    } else {
      // Quitter le plein écran natif si actif
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }

  function setupCanvasEvents() {
    const wrapper = document.getElementById('canvas-wrapper');
    const canvas  = document.getElementById('canvas');
    const selRect = document.getElementById('selection-rect');

  let wheelTargetX = null;
  let wheelTargetY = null;
  let wheelRaf = null;

  // Alt+molette = zoom, molette seule = pan
  // Alt+molette OU Pavé tactile (pinch) = zoom, molette seule = pan
 wrapper.addEventListener('wheel', e => {
    e.preventDefault();
    
    // Détecte soit Alt + Molette, soit le Pinch du pavé tactile
    if (e.altKey || e.ctrlKey) {
      // Utilisation du delta réel pour gérer le trackpad en douceur
      let zoomDelta = -(e.deltaY * 0.002);
      
      // Plafond de vitesse pour les souris classiques
      zoomDelta = Math.max(-0.15, Math.min(0.15, zoomDelta));
      
      const newZ = Math.min(Math.max(zoomLevel + zoomDelta, 0.15), 4);
      
      if (Math.abs(newZ - zoomLevel) > 0.001) {
        const rect = wrapper.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        
        panX = mx - (mx - panX) * (newZ / zoomLevel);
        panY = my - (my - panY) * (newZ / zoomLevel);
        zoomLevel = newZ;
        
        applyTransform();
        updateZoomDisplay();
      }
    } else {
      // Navigation (pan) classique à 2 doigts sans lissage
      panX -= e.deltaX;
      panY -= e.deltaY;
      applyTransform();
    }
  }, { passive: false });

// ── DÉPLACEMENT TACTILE À DEUX DOIGTS (LIBRE EN X/Y) ──
  let isTouchPanning = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let initialPanX = 0;
  let initialPanY = 0;

  wrapper.addEventListener('touchstart', e => {
    // Ne pas bloquer l'interaction si l'utilisateur touche un champ texte
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    
    // S'activer uniquement si exactement 2 doigts touchent l'écran
    if (e.touches.length === 2) {
      e.preventDefault();
      isTouchPanning = true;

      // Calcul du point central exact entre les deux doigts
      touchStartX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      touchStartY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      
      initialPanX = panX;
      initialPanY = panY;

      // Stopper l'inertie de la molette si elle était en cours
      if (wheelRaf) { cancelAnimationFrame(wheelRaf); wheelRaf = null; }
    }
  }, { passive: false });

  wrapper.addEventListener('touchmove', e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    
    if (isTouchPanning && e.touches.length === 2) {
      e.preventDefault();

      // Nouveau point central
      const currentX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const currentY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

      // Déplacement totalement libre en diagonale (aucun verrouillage d'axe)
      panX = initialPanX + (currentX - touchStartX);
      panY = initialPanY + (currentY - touchStartY);

      applyTransform();
    }
  }, { passive: false });

  wrapper.addEventListener('touchend', e => {
    // Désactiver le mode pan dès qu'on relâche un doigt
    if (e.touches.length < 2) {
      isTouchPanning = false;
    }
  }, { passive: false });

  // Sécurité pour stopper net l'inertie si on clique pour faire un pan manuel (espace + clic / clic molette)
  wrapper.addEventListener('mousedown', () => {
    if (wheelRaf) { cancelAnimationFrame(wheelRaf); wheelRaf = null; }
  }, true);

  

    // Clic molette (button 1) sur n'importe quelle zone = pan
    wrapper.addEventListener('mousedown', e => {
      if (e.button === 1) {
        e.preventDefault();
        isPanning = true;
        panStart = { x: e.clientX-panX, y: e.clientY-panY };
        wrapper.style.cursor = 'grabbing';
        return;
      }

      // Mousedown sur canvas vide : pan OU rectangle de sélection
      if (e.target !== canvas && e.target !== wrapper) return;
      if (e.button !== 0) return;

      if (isPanningMode) {
        // Mode pan (espace enfoncé)
        isPanning = true;
        panStart = { x: e.clientX-panX, y: e.clientY-panY };
        wrapper.style.cursor = 'grabbing';
        return;
      }

      // Rectangle de sélection
      hideContextMenu();
      if (!e.shiftKey) {
        deselectAll();
        multiSelected.clear();
      }
      isSelecting = true;
      const wRect = wrapper.getBoundingClientRect();
      selRectStart = { x: e.clientX-wRect.left, y: e.clientY-wRect.top };
      selRect.style.left   = selRectStart.x + 'px';
      selRect.style.top    = selRectStart.y + 'px';
      selRect.style.width  = '0px';
      selRect.style.height = '0px';
      selRect.style.display = 'block';
    });

    window.addEventListener('mousemove', e => {
      if (isPanning) {
        panX = e.clientX-panStart.x;
        panY = e.clientY-panStart.y;
        applyTransform();
      }
      if (isResizing && resizeEl) handleResizeMouse(e);
      if (isSelecting) {
        const wRect = wrapper.getBoundingClientRect();
        const cx = e.clientX-wRect.left;
        const cy = e.clientY-wRect.top;
        const x = Math.min(cx, selRectStart.x);
        const y = Math.min(cy, selRectStart.y);
        const w = Math.abs(cx-selRectStart.x);
        const h = Math.abs(cy-selRectStart.y);
        selRect.style.left   = x+'px';
        selRect.style.top    = y+'px';
        selRect.style.width  = w+'px';
        selRect.style.height = h+'px';
      }
    });

    window.addEventListener('mouseup', e => {
      if (isPanning)  { isPanning=false; wrapper.style.cursor=''; }
      if (isResizing) { isResizing=false; resizeEl=null; clearSnapGuides(); pushHistory(); scheduleSave(); }
      if (isSelecting) {
        isSelecting = false;
        selRect.style.display = 'none';
        // Calculer les éléments dans le rectangle
        const wRect  = wrapper.getBoundingClientRect();
        const rLeft  = parseFloat(selRect.style.left);
        const rTop   = parseFloat(selRect.style.top);
        const rRight = rLeft + parseFloat(selRect.style.width);
        const rBot   = rTop  + parseFloat(selRect.style.height);
        // Seulement si le rectangle a une taille significative
        if (parseFloat(selRect.style.width) > 4 || parseFloat(selRect.style.height) > 4) {
          document.querySelectorAll('#canvas .board-element').forEach(el => {
            const elRect = el.getBoundingClientRect();
            const elL = elRect.left - wRect.left;
            const elT = elRect.top  - wRect.top;
            const elR = elL + elRect.width;
            const elB = elT + elRect.height;
            if (elL < rRight && elR > rLeft && elT < rBot && elB > rTop) {
              el.classList.add('multi-selected');
              multiSelected.add(el);
            }
          });
          // Si un seul élément capturé → le traiter comme une sélection simple
          // pour qu'il ait accès à son handle individuel
          if (multiSelected.size === 1) {
            const only = [...multiSelected][0];
            only.classList.remove('multi-selected');
            multiSelected.clear();
            selectEl(only);
          } else {
            updateMultiResizeHandle();
          }
        }
      }
    });

    // Drop depuis panneau lib
    wrapper.addEventListener('dragover', e => e.preventDefault());
    wrapper.addEventListener('drop', e => {
      e.preventDefault();
      const src = e.dataTransfer.getData('text/plain');
      // Drop depuis la toolbar gauche (tool:note, tool:color, tool:link, tool:file)
      if (src && src.startsWith('tool:')) {
        const type = src.slice(5);
        const rect = wrapper.getBoundingClientRect();
        const x = (e.clientX - rect.left - panX) / zoomLevel;
        const y = (e.clientY - rect.top  - panY) / zoomLevel;
        if (type === 'note') {
          createNoteElement('', x - 115, y - 80, 230, 160);
          pushHistory(); scheduleSave();
        } else if (type === 'color') {
          createColorElement('#000000', x - 65, y - 70, 130, 140);
          pushHistory(); scheduleSave();
        } else if (type === 'link') {
          // Stocker la position pour après la saisie de l'URL
          pendingToolDropPos = { x: x - 135, y: y - 110 };
          openLinkModal();
        } else if (type === 'file') {
          pendingToolDropPos = { x: x - 130, y: y - 38 };
          document.getElementById('file-input-file').click();
        }
        return;
      }
      // Drop multiple depuis le panneau bibliothèque
      if (src === 'multi-lib' && draggedLibItems.length > 0) {
        const rect = wrapper.getBoundingClientRect();
        draggedLibItems.forEach((libItem, i) => {
          const tmpImg = new Image();
          tmpImg.onload = () => {
            const w = tmpImg.naturalWidth || 220;
            const h = tmpImg.naturalHeight || 170;
            const x = (e.clientX - rect.left - panX) / zoomLevel - w / 2 + i * 30;
            const y = (e.clientY - rect.top  - panY) / zoomLevel - h / 2 + i * 30;
            createImageElement(libItem.src, x, y, w, h);
            pushHistory(); scheduleSave();
          };
          tmpImg.onerror = () => {
            const x = (e.clientX - rect.left - panX) / zoomLevel - 110 + i * 30;
            const y = (e.clientY - rect.top  - panY) / zoomLevel -  85 + i * 30;
            createImageElement(libItem.src, x, y, 220, 170);
            pushHistory(); scheduleSave();
          };
          tmpImg.src = libItem.src;
        });
        draggedLibItems = [];
        return;
      }
      if (src && src.startsWith('data:')) {
        const rect = wrapper.getBoundingClientRect();
        const tmpImg = new Image();
        tmpImg.onload = () => {
          const w = tmpImg.naturalWidth || 220;
          const h = tmpImg.naturalHeight || 170;
          const x = (e.clientX-rect.left-panX)/zoomLevel - w/2;
          const y = (e.clientY-rect.top -panY)/zoomLevel - h/2;
          createImageElement(src, x, y, w, h);
          pushHistory(); scheduleSave();
        };
        tmpImg.onerror = () => {
          const x = (e.clientX-rect.left-panX)/zoomLevel - 110;
          const y = (e.clientY-rect.top -panY)/zoomLevel - 85;
          createImageElement(src, x, y, 220, 170);
          pushHistory(); scheduleSave();
        };
        tmpImg.src = src;
        return;
      }
      // Fichiers images droppés directement
      if (e.dataTransfer.files.length) {
        const rect = wrapper.getBoundingClientRect();
        Array.from(e.dataTransfer.files).filter(f=>f.type.startsWith('image/')).forEach((file,i)=>{
          const reader = new FileReader();
          reader.onload = ev => {
            const src = ev.target.result;
            const tmpImg = new Image();
            tmpImg.onload = () => {
              const w = tmpImg.naturalWidth || 220;
              const h = tmpImg.naturalHeight || 170;
              const x = (e.clientX-rect.left-panX)/zoomLevel - w/2 + i*24;
              const y = (e.clientY-rect.top -panY)/zoomLevel - h/2 + i*24;
              createImageElement(src, x, y, w, h);
              pushHistory(); scheduleSave();
            };
            tmpImg.onerror = () => {
              const x = (e.clientX-rect.left-panX)/zoomLevel-110+i*24;
              const y = (e.clientY-rect.top -panY)/zoomLevel-85 +i*24;
              createImageElement(src, x, y, 220, 170);
              pushHistory(); scheduleSave();
            };
            tmpImg.src = src;
          };
          reader.readAsDataURL(file);
        });
      }
    });

    wrapper.addEventListener('contextmenu', e => e.preventDefault());

    // Empêcher le scroll automatique du navigateur au clic molette sur tout le wrapper
    wrapper.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); }, true);
    // Idem sur les éléments du canvas (pour que button 1 sur un élément déclenche aussi le pan)
    document.getElementById('canvas').addEventListener('mousedown', e => {
      if (e.button === 1) {
        e.preventDefault();
        isPanning = true;
        panStart = { x: e.clientX-panX, y: e.clientY-panY };
        wrapper.style.cursor = 'grabbing';
      }
    }, true);
  }

  // ── CLAVIER ──────────────────────────────────────────────────────────────
  // ── LIGHTBOX ──────────────────────────────────────────────────────────────
  function openLightbox(src) {
    const overlay = document.getElementById('lightbox-overlay');
    const img = document.getElementById('lightbox-img');
    img.src = src;
    overlay.classList.add('show');
  }
  function closeLightbox() {
    document.getElementById('lightbox-overlay').classList.remove('show');
    document.getElementById('lightbox-img').src = '';
  }

  function setupKeyboard() {
    document.addEventListener('keydown', async e => {
      // Touches de mode (Alt, Ctrl) — traitées en premier, sans test isTyping
      if (e.key === 'Alt') { e.preventDefault(); isAltDown = true; }
      if (e.key === 'Control') ctrlSnap = true;

      if (e.code === 'Space' && !isTyping(e)) {
        e.preventDefault(); isPanningMode = true;
        document.getElementById('canvas-wrapper').style.cursor = 'grab';
      }
      if (!isTyping(e) && (e.ctrlKey||e.metaKey) && e.shiftKey && (e.key==='Z'||e.key==='z')) { e.preventDefault(); redo(); }
      else if (!isTyping(e) && (e.ctrlKey||e.metaKey) && !e.shiftKey && (e.key==='z'||e.key==='Z')) { e.preventDefault(); undo(); }
      if ((e.key==='Delete'||e.key==='Backspace') && !isTyping(e)) { e.preventDefault(); deleteSelected(); }
      if (e.key==='Escape') {
        if (previewMode) { togglePreviewMode(); return; }
        deselectAll(); multiSelected.clear(); hideContextMenu(); closeAllModals();
      }
      // (Ctrl+V géré par l'événement 'paste' ci-dessous, sans demande de permission)
    });
    document.addEventListener('keyup', e => {
      if (e.key === 'Alt') isAltDown = false;
      if (e.key === 'Control') ctrlSnap = false;
      if (e.code==='Space') {
        isPanningMode = false;
        document.getElementById('canvas-wrapper').style.cursor = '';
      }
    });
    // Sécurité : reset Alt/Ctrl si la fenêtre perd le focus
    window.addEventListener('blur', () => { isAltDown = false; ctrlSnap = false; });

    // ── COLLER IMAGE (paste natif, sans demande de permission) ───────────────
    document.addEventListener('paste', e => {
      if (isTyping(e)) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;
          const reader = new FileReader();
          reader.onload = ev => {
            const src = ev.target.result;
            const c = getCenter();
            const tmpImg = new Image();
            tmpImg.onload = () => {
              const w = tmpImg.naturalWidth || 220;
              const h = tmpImg.naturalHeight || 170;
              createImageElement(src, c.x - w/2, c.y - h/2, w, h);
              pushHistory(); scheduleSave();
            };
            tmpImg.onerror = () => {
              createImageElement(src, c.x-110, c.y-85, 220, 170);
              pushHistory(); scheduleSave();
            };
            tmpImg.src = src;
            // Ajouter aussi à la bibliothèque
            const name = 'collé_' + Date.now() + '.png';
            const libItem = { id:'lib_'+Date.now()+'_'+Math.random().toString(36).substr(2,5), name, src };
            const folder = panelFolder === 'all' ? 'image' : panelFolder;
            if (!library[folder]) library[folder] = [];
            library[folder].push(libItem);
            saveLibrary(); renderPanelLib();
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    });
  }
  function isTyping(e) {
    const active = document.activeElement;
    const inInput = el => el && (el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.isContentEditable);
    // data-editing : flag posé par les notes (textarea avec pointerEvents:none)
    const editingNote = !!document.querySelector('.board-element[data-editing="1"]');
    return inInput(active) || editingNote;
  }

  // ── HISTORIQUE ───────────────────────────────────────────────────────────
  function pushHistory() {
    // Synchroniser les valeurs des hex inputs couleur (innerHTML ne capture pas .value dynamique)
    document.querySelectorAll('#canvas .board-element[data-type="color"] .color-hex-input').forEach(inp => {
      if (inp.value) inp.setAttribute('value', inp.value);
    });
    // Synchroniser le texte des notes (textarea.value non capturé par innerHTML)
    document.querySelectorAll('#canvas .board-element[data-type="note"] textarea').forEach(ta => {
      ta.setAttribute('data-snap-value', ta.value);
      // Mettre aussi à jour dataset.savedata sur l'élément parent
      const el = ta.closest('.board-element');
      if (el) el.dataset.savedata = ta.value;
    });
    const snap = document.getElementById('canvas').innerHTML;
    if (historyIndex < history.length-1) history = history.slice(0, historyIndex+1);
    history.push(snap);
    if (history.length > 50) history.shift();
    historyIndex = history.length-1;
  }
  function undo() {
    if (historyIndex <= 0) { toast('Rien à annuler'); return; }
    historyIndex--;
    document.getElementById('canvas').innerHTML = history[historyIndex];
    reattachAllEvents();
    selectedEl=null; multiSelected.clear();
    scheduleSave(); toast('Annulé');
  }
  function redo() {
    if (historyIndex >= history.length - 1) { toast('Rien à rétablir'); return; }
    historyIndex++;
    document.getElementById('canvas').innerHTML = history[historyIndex];
    reattachAllEvents();
    selectedEl=null; multiSelected.clear();
    scheduleSave(); toast('Rétabli');
  }
  function reattachAllEvents() {
    document.querySelectorAll('#canvas .board-element').forEach(el => {
      attachElementEvents(el);
      if (el.dataset.type === 'color') reattachColorEvents(el);
      if (el.dataset.type === 'note')  reattachNoteEvents(el);
      if (el.dataset.type === 'file')  reattachFileEvents(el);
    });
  }

  // Ré-attache le double-clic d'édition sur une note clonée (Alt+drag ou undo)
  function reattachNoteEvents(el) {
    if (el._noteEventsAttached) return;
    el._noteEventsAttached = true;
    const wrap = el.querySelector('.el-note');
    const ta   = el.querySelector('textarea');
    if (!wrap || !ta) return;
    // Restaurer la valeur depuis data-snap-value (persisté dans innerHTML) ou dataset.savedata
    const snapVal = ta.getAttribute('data-snap-value');
    if (snapVal !== null && ta.value !== snapVal) ta.value = snapVal;
    else if (el.dataset.savedata && ta.value !== el.dataset.savedata) ta.value = el.dataset.savedata;
    let _noteValueOnFocus = '';
    function activateNoteEdit(e) {
      e.stopPropagation(); e.preventDefault();
      ta.style.pointerEvents = 'auto';
      ta.style.cursor = 'text';
      el.dataset.editing = '1';
      _noteValueOnFocus = ta.value;
      ta.focus();
      showTextEditPanel(el);
    }
    wrap.addEventListener('dblclick', activateNoteEdit);
    ta.addEventListener('dblclick', activateNoteEdit);
    ta.addEventListener('mousedown', e => {
      if (ta.style.pointerEvents === 'auto') e.stopPropagation();
    });
    ta.addEventListener('input', () => { el.dataset.savedata = ta.value; scheduleSave(); });
    ta.addEventListener('blur', e => {
      const panel = document.getElementById('text-edit-panel');
      const goingToPanel = (panel && e.relatedTarget && panel.contains(e.relatedTarget));
      if (goingToPanel || window._textPanelKeepOpen) return;
      ta.style.pointerEvents = 'none';
      ta.style.cursor = 'move';
      delete el.dataset.editing;
      hideTextEditPanel();
      if (!ta.value.trim()) {
        el.remove();
        if (selectedEl === el) selectedEl = null;
        multiSelected.delete(el);
        pushHistory(); scheduleSave();
      } else if (ta.value !== _noteValueOnFocus) {
        pushHistory(); scheduleSave();
      }
    });
  }

  // Ré-attache le double-clic sur une carte fichier clonée (après undo ou Alt+drag)
  function reattachFileEvents(el) {
    if (el._fileEventsAttached) return;
    el._fileEventsAttached = true;
    const vidWrap = el.querySelector('.el-file-video');
    const wrap    = el.querySelector('.el-file');
    if (vidWrap) {
      vidWrap.addEventListener('dblclick', e => {
        e.stopPropagation();
        const d = (() => { try { return JSON.parse(el.dataset.savedata||'{}'); } catch(_){return {};} })();
        if (d.src) { openVideoLightbox(d.src); return; }
        fileReplaceTarget = el;
        document.getElementById('file-input-file').click();
      });
    } else if (wrap) {
      wrap.addEventListener('dblclick', e => {
        e.stopPropagation();
        fileReplaceTarget = el;
        document.getElementById('file-input-file').click();
      });
    }
  }
  function reattachColorEvents(el) {
    // Guard : ne pas attacher les events plusieurs fois sur le même élément
    // Utiliser une propriété JS (pas dataset) pour ne pas être sérialisé dans innerHTML
    if (el._colorEventsAttached) return;
    el._colorEventsAttached = true;

    const swatch   = el.querySelector('.color-swatch');
    const hexInput = el.querySelector('.color-hex-input');
    const eyeBtn   = el.querySelector('.color-eyedropper');
    if (!swatch || !hexInput || !eyeBtn) return;

    // Restaurer la valeur depuis dataset.savedata (source de vérité)
    if (el.dataset.savedata) {
      hexInput.value = el.dataset.savedata.toUpperCase();
      swatch.style.background = el.dataset.savedata;
    }
    // Bloquer le drag depuis l'input
    hexInput.addEventListener('mousedown',  e => e.stopPropagation());
    hexInput.addEventListener('pointerdown', e => e.stopPropagation());
    function applyHexColor(val) {
      const v = val.trim().toUpperCase();
      if (/^#[0-9A-F]{3}$/.test(v) || /^#[0-9A-F]{6}$/.test(v)) {
        swatch.style.background = v; el.dataset.savedata = v; hexInput.value = v;
        pushHistory(); scheduleSave(); return true;
      }
      return false;
    }
    hexInput.addEventListener('keydown', e => { if (e.key==='Enter') { e.preventDefault(); hexInput.blur(); } e.stopPropagation(); });
    hexInput.addEventListener('blur', () => { if (!applyHexColor(hexInput.value)) hexInput.value = (el.dataset.savedata || '#000000').toUpperCase(); });
    hexInput.addEventListener('input', () => { hexInput.value = hexInput.value.toUpperCase(); const v=hexInput.value.trim(); if (/^#[0-9A-F]{3}$/.test(v)||/^#[0-9A-F]{6}$/.test(v)) swatch.style.background=v; });
    eyeBtn.addEventListener('mousedown',  e => e.stopPropagation());
    eyeBtn.addEventListener('pointerdown', e => e.stopPropagation());
    eyeBtn.addEventListener('click', e => { e.stopPropagation(); activateEyedropper(el, swatch, hexInput); });
  }

  // ── SÉLECTION ────────────────────────────────────────────────────────────
  function deselectAll() {
    document.querySelectorAll('#canvas .board-element.selected').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('#canvas .board-element.multi-selected').forEach(el => el.classList.remove('multi-selected'));
    selectedEl = null;
    multiSelected.clear();
    updateMultiResizeHandle();
    updateAllConnections();
  }

  function selectEl(el, addToMulti=false) {
    if (addToMulti) {
      // Shift+clic : toggle dans la sélection multiple
      if (multiSelected.has(el)) {
        el.classList.remove('multi-selected');
        multiSelected.delete(el);
        if (selectedEl === el) selectedEl = null;
      } else {
        // Si un selectedEl existe, le basculer en multi-selected
        if (selectedEl && selectedEl !== el) {
          selectedEl.classList.remove('selected');
          selectedEl.classList.add('multi-selected');
          multiSelected.add(selectedEl);
          selectedEl = null;
        }
        el.classList.add('multi-selected');
        multiSelected.add(el);
      }
    } else {
      deselectAll();
      el.classList.add('selected');
      selectedEl = el;
      el.style.zIndex = ++nextZ;
    }
    updateMultiResizeHandle();
  }

  // Supprime toutes les connexions liées à un élément
  function removeConnectionsForEl(el) {
    const id = el.dataset.id;
    if (!id) return;
    const canvas = document.getElementById('canvas');
    canvas.querySelectorAll('.el-connection').forEach(svg => {
      if (svg.dataset.from === id || svg.dataset.to === id) svg.remove();
    });
  }

  // Supprime toutes les captions liées à un élément
  function removeCaptionsForEl(el) {
    const id = el.dataset.id;
    if (!id) return;
    const canvas = document.getElementById('canvas');
    canvas.querySelectorAll('.el-caption').forEach(cap => {
      if (cap.dataset.parentId === id) cap.remove();
    });
  }

  function deleteSelected() {
    let count = 0;
    // Supprimer la multi-sélection
    multiSelected.forEach(el => { removeConnectionsForEl(el); removeCaptionsForEl(el); el.remove(); count++; });
    multiSelected.clear();
    if (selectedEl) { removeConnectionsForEl(selectedEl); removeCaptionsForEl(selectedEl); selectedEl.remove(); selectedEl=null; count++; }
    if (count > 0) { pushHistory(); scheduleSave(); toast(count > 1 ? count+' éléments supprimés' : 'Supprimé'); }
    else toast('Aucun élément sélectionné');
  }

  function clearBoard() {
    if (!confirm('Vider tout le board ?')) return;
    document.getElementById('canvas').innerHTML = '';
    selectedEl=null; multiSelected.clear();
    pushHistory(); scheduleSave(); toast('Board vidé');
  }

  // ── SNAP ─────────────────────────────────────────────────────────────────
  function getAllElements(exclude) {
    return Array.from(document.querySelectorAll('#canvas .board-element'))
      .filter(el => !exclude || !exclude.has(el));
  }

  function getRect(el) {
    const l = parseFloat(el.style.left) || 0;
    const t = parseFloat(el.style.top)  || 0;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    return { l, t, r: l + w, b: t + h, cx: l + w/2, cy: t + h/2, w, h };
  }

  function clearSnapGuides() {
    document.querySelectorAll('.snap-guide').forEach(g => g.remove());
  }

  function showSnapGuide(isHorizontal, pos) {
    const canvas = document.getElementById('canvas');
    const g = document.createElement('div');
    g.className = 'snap-guide ' + (isHorizontal ? 'h' : 'v');
    if (isHorizontal) g.style.top  = pos + 'px';
    else              g.style.left = pos + 'px';
    canvas.appendChild(g);
  }

  function computeSnap(dragRect, others) {
    const T  = snapThreshold / zoomLevel;
    let dx = null, dy = null;
    const guidesH = [], guidesV = [];

    // Candidats X de l'élément draggé — bords uniquement (pas centre)
    const xCands = [
      { val: dragRect.l,  side: 'l' },
      { val: dragRect.r,  side: 'r' },
    ];
    // Candidats Y — bords uniquement (pas centre)
    const yCands = [
      { val: dragRect.t,  side: 't' },
      { val: dragRect.b,  side: 'b' },
    ];

    // --- Alignement sur les bords des autres éléments (pas centres) ---
    others.forEach(other => {
      const or = getRect(other);
      const xTargets = [or.l, or.r];
      const yTargets = [or.t, or.b];

      xCands.forEach(c => {
        xTargets.forEach(target => {
          const d = target - c.val;
          if (Math.abs(d) < T) {
            if (dx === null || Math.abs(d) < Math.abs(dx)) dx = d;
            guidesV.push(target);
          }
        });
      });
      yCands.forEach(c => {
        yTargets.forEach(target => {
          const d = target - c.val;
          if (Math.abs(d) < T) {
            if (dy === null || Math.abs(d) < Math.abs(dy)) dy = d;
            guidesH.push(target);
          }
        });
      });
    });

    // Dédupliquer les guides (arrondi au pixel entier) et ne garder que ceux
    // alignés avec le snap effectif (dx/dy), pour éviter les lignes en double.
    const finalDx = dx || 0;
    const finalDy = dy || 0;
    const finalGuidesV = finalDx !== 0
      ? [...new Set(guidesV.map(v => Math.round(v)))].filter(v =>
          Math.abs(v - Math.round(dragRect.l + finalDx)) < 2 ||
          Math.abs(v - Math.round(dragRect.r + finalDx)) < 2)
      : [];
    const finalGuidesH = finalDy !== 0
      ? [...new Set(guidesH.map(v => Math.round(v)))].filter(v =>
          Math.abs(v - Math.round(dragRect.t + finalDy)) < 2 ||
          Math.abs(v - Math.round(dragRect.b + finalDy)) < 2)
      : [];
      
    return { dx: finalDx, dy: finalDy, guidesH: finalGuidesH, guidesV: finalGuidesV };
  }

  function applySnap(el, excludeSet) {
    const others = getAllElements(excludeSet || new Set([el]));
    if (!others.length) return;
    const rect = getRect(el);
    const { dx, dy, guidesH, guidesV } = computeSnap(rect, others);
    clearSnapGuides();
    if (dx) el.style.left = (parseFloat(el.style.left) + dx) + 'px';
    if (dy) el.style.top  = (parseFloat(el.style.top)  + dy) + 'px';
    guidesH.forEach(pos => showSnapGuide(true,  pos));
    guidesV.forEach(pos => showSnapGuide(false, pos));
  }

  // ── MULTI-RESIZE HANDLE ───────────────────────────────────────────────────
  function updateMultiResizeHandle() {
    const handle = document.getElementById('multi-resize-handle');
    const bbox = document.getElementById('group-bounding-box');
    const group = [...multiSelected];
    
    if (group.length < 2) { 
      handle.style.display = 'none'; 
      if (bbox) bbox.style.display = 'none';
      return; 
    }

    // Calculer le bounding box global de tous les éléments sélectionnés
    const wrapperRect = document.getElementById('canvas-wrapper').getBoundingClientRect();
    let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
    
    group.forEach(el => {
      const r = el.getBoundingClientRect();
      const left   = r.left   - wrapperRect.left;
      const top    = r.top    - wrapperRect.top;
      const right  = r.right  - wrapperRect.left;
      const bottom = r.bottom - wrapperRect.top;
      
      if (left   < minL) minL = left;
      if (top    < minT) minT = top;
      if (right  > maxR) maxR = right;
      if (bottom > maxB) maxB = bottom;
    });

    // Placer la poignée en bas à droite
    handle.style.display = 'block';
    handle.style.left = maxR + 'px';
    handle.style.top  = maxB + 'px';

    // Dessiner le cadre de sélection englobant tout le groupe
    if (bbox) {
      bbox.style.display = 'block';
      bbox.style.left = minL + 'px';
      bbox.style.top  = minT + 'px';
      bbox.style.width = (maxR - minL) + 'px';
      bbox.style.height = (maxB - minT) + 'px';
    }
  }

  function setupMultiResizeHandle() {
    const handle = document.getElementById('multi-resize-handle');
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.stopPropagation(); e.preventDefault();
      const group = [...multiSelected];
      if (group.length < 2) return;

      // Snapshot des tailles et positions initiales
      const initRects = new Map();
      group.forEach(el => {
        initRects.set(el, {
          left: parseFloat(el.style.left)||0,
          top:  parseFloat(el.style.top) ||0,
          w:    el.offsetWidth,
          h:    el.offsetHeight,
          ratio: el.dataset.ratio ? parseFloat(el.dataset.ratio) : null
        });
      });

      // Bounding box initiale du groupe entier
      let minL=Infinity, minT=Infinity, maxR=-Infinity, maxB=-Infinity;
      group.forEach(el => {
        const r = initRects.get(el);
        minL = Math.min(minL, r.left);
        minT = Math.min(minT, r.top);
        maxR = Math.max(maxR, r.left + r.w);
        maxB = Math.max(maxB, r.top  + r.h);
      });
      const initGroupW = maxR - minL;
      const initGroupH = maxB - minT;
      const startX = e.clientX, startY = e.clientY;

      const onMove = ev => {
        const dx = (ev.clientX - startX) / zoomLevel;
        const dy = (ev.clientY - startY) / zoomLevel;

        // Scale uniforme à partir du coin haut-gauche du bounding box global (minL, minT)
        const newGroupW = Math.max(40, initGroupW + dx);
        const newGroupH = Math.max(40, initGroupH + dy);
        // On prend le scale qui représente le mieux le geste (diagonale)
        const scaleW = newGroupW / initGroupW;
        const scaleH = newGroupH / initGroupH;
        // Scale uniforme : moyenne harmonique pour rester cohérent
        const scale = (scaleW + scaleH) / 2;

        group.forEach(el => {
          const r = initRects.get(el);

          // Distance de cet élément au coin haut-gauche du groupe
          const relL = r.left - minL;
          const relT = r.top  - minT;

          // Nouvelle position : ancrage = (minL, minT), chaque élément
          // se déplace proportionnellement (comme Illustrator)
          el.style.left = Math.round(minL + relL * scale) + 'px';
          el.style.top  = Math.round(minT + relT * scale) + 'px';

          // Nouvelle taille proportionnelle
          if (r.ratio) {
            const nw = Math.max(40, Math.round(r.w * scale));
            el.style.width  = nw + 'px';
            el.style.height = Math.round(nw / r.ratio) + 'px';
          } else {
            el.style.width  = Math.max(40, Math.round(r.w * scale)) + 'px';
            el.style.height = Math.max(20, Math.round(r.h * scale)) + 'px';
          }
        });
        updateMultiResizeHandle();
        group.forEach(el => updateConnectionsForEl(el));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        pushHistory(); scheduleSave();
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  // ── FACTORY ÉLÉMENT ──────────────────────────────────────────────────────
  function getCenter() {
    const w = document.getElementById('canvas-wrapper');
    const r = w.getBoundingClientRect();
    return { x:(r.width/2-panX)/zoomLevel, y:(r.height/2-panY)/zoomLevel };
  }

 function makeElement(type, x, y, w, h) {
    const el = document.createElement('div');
    el.className = 'board-element';
    el.dataset.type = type;
    el.dataset.id   = 'el_'+Date.now()+'_'+Math.random().toString(36).substr(2,5);
    el.style.left   = x+'px';
    el.style.top    = y+'px';
    if (w) el.style.width  = w+'px';
    if (h) el.style.height = h+'px';
    el.style.zIndex = ++nextZ;

    const tb = document.createElement('div');
    tb.className = 'element-toolbar';
    tb.innerHTML = `
      <button class="el-tool-btn btn-duplicate" title="Dupliquer"><img src="PNG/dupliquer.png"></button>
      <button class="el-tool-btn danger btn-delete" title="Supprimer"><img src="PNG/supprimer.png"></button>`;
    
    // Ajout des événements via JS pur pour respecter la CSP
    tb.querySelector('.btn-duplicate').addEventListener('click', function(e) {
      e.stopPropagation();
      duplicateEl(this);
    });
    tb.querySelector('.btn-delete').addEventListener('click', function(e) {
      e.stopPropagation();
      removeEl(this);
    });

    el.appendChild(tb);

    const rh = document.createElement('div');
    rh.className = 'resize-handle';
    el.appendChild(rh);

    attachElementEvents(el);
    document.getElementById('canvas').appendChild(el);
    return el;
  }
  function attachElementEvents(el) {
    el.addEventListener('mousedown', e => {
      if (e.target.classList.contains('resize-handle')) return;
      if (['BUTTON','INPUT','SELECT','TEXTAREA','IFRAME'].includes(e.target.tagName)) return;
      if (e.target.isContentEditable) return;
      if (e.button !== 0) return;
      if (el.dataset.justDragged) return;
      e.stopPropagation(); e.preventDefault();

      if (e.shiftKey) { selectEl(el, true); return; }

      if (multiSelected.has(el) && multiSelected.size > 1) {
        startGroupDrag(e, multiSelected);
        return;
      }

      selectEl(el);
      const canvasRect = document.getElementById('canvas').getBoundingClientRect();
      const startMX = (e.clientX-canvasRect.left)/zoomLevel;
      const startMY = (e.clientY-canvasRect.top) /zoomLevel;

      const origLeft = parseFloat(el.style.left)||0;
      const origTop  = parseFloat(el.style.top) ||0;

      let dragEl = el;
      let duplicated = false;
      const excludeSet = new Set([el]);
      let startLeft = parseFloat(dragEl.style.left)||0;
      let startTop  = parseFloat(dragEl.style.top) ||0;

      function doDuplicate() {
        if (duplicated) return;
        duplicated = true;
        const copy = el.cloneNode(true);
        copy.dataset.id = 'el_'+Date.now()+'_'+Math.random().toString(36).substr(2,5);
        if (el.dataset.type === 'image' && _imgStore.has(el.dataset.id))
          _imgStore.set(copy.dataset.id, _imgStore.get(el.dataset.id));
        copy.style.zIndex = ++nextZ;
        copy.style.left = dragEl.style.left;
        copy.style.top  = dragEl.style.top;
        el.style.left = origLeft + 'px';
        el.style.top  = origTop  + 'px';
        document.getElementById('canvas').appendChild(copy);
        attachElementEvents(copy);
        if (copy.dataset.type === 'color') reattachColorEvents(copy);
        if (copy.dataset.type === 'note')  reattachNoteEvents(copy);
        if (copy.dataset.type === 'file')  reattachFileEvents(copy);
        dragEl = copy;
        selectEl(dragEl);
        excludeSet.add(dragEl);
        startLeft = parseFloat(copy.style.left)||0;
        startTop  = parseFloat(copy.style.top) ||0;
      }

      if (isAltDown) doDuplicate();
      let currentStartMX = startMX;
      let currentStartMY = startMY;
      let moved = false;

      let targetX = startLeft, targetY = startTop;
      let curX = startLeft, curY = startTop;
      let rafId = null;
      let dragActive = true;
      let shiftAxisX = null;

      const lerp = (a, b, t) => a + (b - a) * t;

      function dragRAF() {
        if (!dragActive) return;
        const prevX = curX, prevY = curY;
        curX = lerp(curX, targetX, 0.22);
        curY = lerp(curY, targetY, 0.22);

        const hasMoved = Math.abs(curX - prevX) > 0.05 || Math.abs(curY - prevY) > 0.05;
        if (hasMoved) {
          dragEl.style.left = curX + 'px';
          dragEl.style.top  = curY + 'px';

          if (ctrlSnap) { applySnap(dragEl, excludeSet); } else { clearSnapGuides(); }
          updateConnectionsForEl(dragEl);

          const _elId = dragEl.dataset.id;
          if (_elId) {
            document.querySelectorAll(`.el-caption[data-parent-id="${_elId}"]`).forEach(cap => {
              cap.style.left = curX + 'px';
              cap.style.top  = (curY + dragEl.offsetHeight) + 'px';
            });
          }
        }

        rafId = requestAnimationFrame(dragRAF);
      }

      const onMove = ev => {
        if (isAltDown && !duplicated) {
          const prevAxis = shiftAxisX;
          doDuplicate();
          currentStartMX = (ev.clientX-canvasRect.left)/zoomLevel;
          currentStartMY = (ev.clientY-canvasRect.top) /zoomLevel;
          startLeft = parseFloat(dragEl.style.left)||0;
          startTop  = parseFloat(dragEl.style.top) ||0;
          curX = startLeft; curY = startTop;
          targetX = startLeft; targetY = startTop;
          shiftAxisX = prevAxis;
        }
        // Alt relâché après duplication → annuler la copie, continuer avec l'original
        if (!isAltDown && duplicated && dragEl !== el) {
          const copyLeft = curX, copyTop = curY;
          dragEl.remove();
          duplicated = false;
          dragEl = el;
          selectEl(el);
          excludeSet.delete(dragEl); // dragEl était la copie, on la retire
          // L'original reprend la position courante de la copie
          el.style.left = copyLeft + 'px';
          el.style.top  = copyTop  + 'px';
          curX = copyLeft; curY = copyTop;
          targetX = copyLeft; targetY = copyTop;
          startLeft = copyLeft; startTop = copyTop;
          currentStartMX = (ev.clientX-canvasRect.left)/zoomLevel;
          currentStartMY = (ev.clientY-canvasRect.top) /zoomLevel;
        }
        moved = true;
        const cx = (ev.clientX-canvasRect.left)/zoomLevel;
        const cy = (ev.clientY-canvasRect.top) /zoomLevel;
        let dx = cx - currentStartMX;
        let dy = cy - currentStartMY;

        if (ev.shiftKey) {
          if (shiftAxisX === null) {
            shiftAxisX = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
          }
          if (shiftAxisX === 'h') dy = 0; else dx = 0;
        } else {
          shiftAxisX = null;
        }

        targetX = startLeft + dx;
        targetY = startTop  + dy;
      };
      
      const onUp = () => {
        dragActive = false;
        document.body.classList.remove('is-dragging-el'); // <-- RETRAIT ICI
        
        cancelAnimationFrame(rafId);
        // Appliquer la position finale exacte et enlever le tilt
        dragEl.style.left = targetX + 'px';
        dragEl.style.top  = targetY + 'px';
        dragEl.style.transform = '';
        if (ctrlSnap) applySnap(dragEl, excludeSet);
        updateConnectionsForEl(dragEl); // position finale après snap éventuel
        clearSnapGuides();
        // Repositionner les captions attachées sur la position finale
        const _elId2 = dragEl.dataset.id;
        if (_elId2) {
          const finalLeft = parseFloat(dragEl.style.left);
          const finalTop  = parseFloat(dragEl.style.top);
          document.querySelectorAll(`.el-caption[data-parent-id="${_elId2}"]`).forEach(cap => {
            cap.style.left = finalLeft + 'px';
            cap.style.top  = (finalTop + dragEl.offsetHeight) + 'px';
          });
        }
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (moved || duplicated) { 
          pushHistory(); scheduleSave(); 
          
          dragEl.dataset.justDragged = "1";
          setTimeout(() => delete dragEl.dataset.justDragged, 150);
        }
      };
      
      document.body.classList.add('is-dragging-el'); // <-- AJOUT ICI
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      // Démarrer la boucle RAF
      rafId = requestAnimationFrame(dragRAF);
    });

    el.addEventListener('click', e => {
      e.stopPropagation();
      if (el.dataset.justDragged) return;
      if (!e.shiftKey) selectEl(el);
    });

    // Double-clic sur image → lightbox
    el.addEventListener('dblclick', e => {
      e.stopPropagation();
      if (el.dataset.type === 'image') {
        const img = el.querySelector('img');
        if (img) openLightbox(img.src);
      }
    });

    el.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      // Si l'élément fait partie d'une multi-sélection, ne pas désélectionner
      if (!e.shiftKey && !multiSelected.has(el)) selectEl(el);
      // Ajouter l'élément à la multi-sélection si pas encore dedans
      if (multiSelected.size > 0 && !multiSelected.has(el)) {
        el.classList.add('multi-selected');
        multiSelected.add(el);
      }
      ctxTargetEl = el;
      showContextMenu(e.clientX, e.clientY);
    });

    const rh = el.querySelector('.resize-handle');
    if (rh) {
      rh.addEventListener('mousedown', e => {
        e.stopPropagation(); e.preventDefault();
        isResizing=true; resizeEl=el;
        resizeStartW = parseFloat(el.style.width) ||el.offsetWidth;
        resizeStartH = parseFloat(el.style.height)||el.offsetHeight;
        resizeStartX = e.clientX; resizeStartY = e.clientY;
        // Pour les images : resize proportionnel
        resizeRatio = el.dataset.type === 'image' && el.dataset.ratio
          ? parseFloat(el.dataset.ratio) : null;
      });
    }
  }

  function startGroupDrag(e, group) {
    const canvasRect = document.getElementById('canvas').getBoundingClientRect();
    const startMX = (e.clientX-canvasRect.left)/zoomLevel;
    const startMY = (e.clientY-canvasRect.top) /zoomLevel;

    // Groupe actif (peut changer si duplication)
    let activeGroup = new Set(group);
    let starts = new Map();
    activeGroup.forEach(el => {
      starts.set(el, { left: parseFloat(el.style.left)||0, top: parseFloat(el.style.top)||0 });
    });
    let excludeSet = new Set(activeGroup);
    let duplicated = false;
    let moved = false;

    function doDuplicateGroup() {
      if (duplicated) return;
      duplicated = true;
      const copies = new Set();
      // Positions courantes avant duplication
      const curPositions = new Map();
      activeGroup.forEach(el => {
        curPositions.set(el, { left: parseFloat(el.style.left)||0, top: parseFloat(el.style.top)||0 });
      });
      activeGroup.forEach(el => {
        const copy = el.cloneNode(true);
        copy.dataset.id = 'el_'+Date.now()+'_'+Math.random().toString(36).substr(2,5);
        if (el.dataset.type === 'image' && _imgStore.has(el.dataset.id))
          _imgStore.set(copy.dataset.id, _imgStore.get(el.dataset.id));
        copy.style.zIndex = ++nextZ;
        const cur = curPositions.get(el);
        copy.style.left = cur.left + 'px';
        copy.style.top  = cur.top  + 'px';
        document.getElementById('canvas').appendChild(copy);
        attachElementEvents(copy);
        copies.add(copy);
      });
      // Les originaux restent, on déplace les copies
      activeGroup = copies;
      starts = new Map();
      activeGroup.forEach(el => {
        starts.set(el, { left: parseFloat(el.style.left)||0, top: parseFloat(el.style.top)||0 });
      });
      excludeSet = new Set(activeGroup);
      // Sélectionner les copies
      deselectAll();
      activeGroup.forEach(el => { el.classList.add('multi-selected'); multiSelected.add(el); });
    }

    // Alt déjà enfoncé au départ
    if (isAltDown) doDuplicateGroup();

    // Lerp state pour le multi-drag
    let targetDX = 0, targetDY = 0;
    let curDX = 0, curDY = 0;
    let groupDragActive = true;
    let groupRafId = null;
    const lerpFactor = 0.12;

    function groupDragRAF() {
      if (!groupDragActive) return;
      const prevDX = curDX, prevDY = curDY;
      curDX += (targetDX - curDX) * lerpFactor;
      curDY += (targetDY - curDY) * lerpFactor;

      const hasMoved = Math.abs(curDX - prevDX) > 0.05 || Math.abs(curDY - prevDY) > 0.05;
      if (hasMoved) {
        activeGroup.forEach(el => {
          const s = starts.get(el);
          if (!s) return;
          el.style.left = (s.left + curDX) + 'px';
          el.style.top  = (s.top  + curDY) + 'px';
        });
        activeGroup.forEach(el => updateConnectionsForEl(el));
        updateMultiResizeHandle();
      }
      groupRafId = requestAnimationFrame(groupDragRAF);
    }

    const onMove = ev => {
      // Alt enfoncé en cours → dupliquer
      if (isAltDown && !duplicated) {
        // Figer positions courantes comme nouveaux starts pour les copies
        const frozenDX = curDX, frozenDY = curDY;
        doDuplicateGroup();
        // Réinitialiser le delta pour les copies à partir de leur position actuelle
        curDX = 0; curDY = 0; targetDX = 0; targetDY = 0;
        return;
      }
      moved = true;
      const cx = (ev.clientX-canvasRect.left)/zoomLevel;
      const cy = (ev.clientY-canvasRect.top) /zoomLevel;
      let dx = cx-startMX, dy = cy-startMY;

      // Shift : contrainte axiale stricte
      if (ev.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) { dy = 0; }
        else                              { dx = 0; }
      }

      targetDX = dx; targetDY = dy;

      // Snap uniquement si Ctrl enfoncé (calculé sur position cible, appliqué via RAF)
      if (ctrlSnap) {
        const others = getAllElements(excludeSet);
        if (others.length) {
          const pivotEl = [...activeGroup][0];
          const s = starts.get(pivotEl);
          if (s) {
            const snapRect = { left: s.left+dx, top: s.top+dy, width: pivotEl.offsetWidth, height: pivotEl.offsetHeight };
            const { dx: sdx, dy: sdy, guidesH, guidesV } = computeSnap(snapRect, others);
            clearSnapGuides();
            if (sdx || sdy) { targetDX += sdx; targetDY += sdy; }
            guidesH.forEach(pos => showSnapGuide(true,  pos));
            guidesV.forEach(pos => showSnapGuide(false, pos));
          }
        }
      } else {
        clearSnapGuides();
      }
    };
    
    const onUp = () => {
      groupDragActive = false;
      document.body.classList.remove('is-dragging-el'); // <-- RETRAIT ICI
      
      if (groupRafId) { cancelAnimationFrame(groupRafId); groupRafId = null; }
      // Appliquer la position finale exacte
      activeGroup.forEach(el => {
        const s = starts.get(el);
        if (!s) return;
        el.style.left = (s.left + targetDX) + 'px';
        el.style.top  = (s.top  + targetDY) + 'px';
      });
      activeGroup.forEach(el => updateConnectionsForEl(el));
      updateMultiResizeHandle();
      _justGroupDragged = true;
      setTimeout(() => { _justGroupDragged = false; }, 80);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      clearSnapGuides();
      if (moved || duplicated) { pushHistory(); scheduleSave(); }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    groupRafId = requestAnimationFrame(groupDragRAF);
  }

  function handleResizeMouse(e) {
    const dx = (e.clientX-resizeStartX)/zoomLevel;
    const dy = (e.clientY-resizeStartY)/zoomLevel;
    let fw, fh;

    if (resizeRatio) {
      const newW = Math.max(40, resizeStartW + dx);
      const newH = Math.max(40, resizeStartH + dy);
      const scale = Math.max(newW / resizeStartW, newH / resizeStartH);
      fw = Math.max(40, Math.round(resizeStartW * scale));
      fh = Math.max(40, Math.round(fw / resizeRatio));
    } else {
      fw = Math.max(60, resizeStartW + dx);
      fh = Math.max(40, resizeStartH + dy);
    }

    resizeEl.style.width  = fw + 'px';
    resizeEl.style.height = fh + 'px';

    // ── Snap pendant le resize (seulement si Ctrl) ──────────────────────────
    if (ctrlSnap) {
      const T = snapThreshold / zoomLevel;
      const others = getAllElements(new Set([resizeEl]));
      if (others.length) {
        const elL = parseFloat(resizeEl.style.left) || 0;
        const elT = parseFloat(resizeEl.style.top)  || 0;
        let elR = elL + fw;
        let elB = elT + fh;

        let snapDX = null, snapDY = null;
        const guidesH = [], guidesV = [];

        others.forEach(other => {
          const or = getRect(other);
          const xTargets = [or.l, or.cx, or.r];
          const yTargets = [or.t, or.cy, or.b];
          xTargets.forEach(target => {
            const d = target - elR;
            if (Math.abs(d) < T && (snapDX === null || Math.abs(d) < Math.abs(snapDX))) {
              snapDX = d; guidesV.push(target);
            }
          });
          yTargets.forEach(target => {
            const d = target - elB;
            if (Math.abs(d) < T && (snapDY === null || Math.abs(d) < Math.abs(snapDY))) {
              snapDY = d; guidesH.push(target);
            }
          });
        });

        if (snapDX) {
          const snappedW = Math.max(resizeRatio ? 40 : 60, fw + snapDX);
          if (resizeRatio) {
            const snappedH = Math.round(snappedW / resizeRatio);
            resizeEl.style.width  = snappedW + 'px';
            resizeEl.style.height = snappedH + 'px';
          } else {
            resizeEl.style.width = snappedW + 'px';
          }
        }
        if (snapDY && !resizeRatio) {
          resizeEl.style.height = Math.max(40, fh + snapDY) + 'px';
        }

        clearSnapGuides();
        guidesH.forEach(pos => showSnapGuide(true,  pos));
        guidesV.forEach(pos => showSnapGuide(false, pos));
      }
    } else {
      clearSnapGuides();
    }

    // Synchroniser les captions attachées lors du resize
    const _rElId = resizeEl.dataset.id;
    if (_rElId) {
      document.querySelectorAll(`.el-caption[data-parent-id="${_rElId}"]`).forEach(cap => {
        cap.style.width = resizeEl.style.width;
        cap.style.left  = resizeEl.style.left;
        cap.style.top   = (parseFloat(resizeEl.style.top) + resizeEl.offsetHeight) + 'px';
      });
    }
    // Mettre à jour les connecteurs en temps réel
    updateConnectionsForEl(resizeEl);
  }

  // ── RESTORE ──────────────────────────────────────────────────────────────
  function restoreElement(s) {
    let el;
    if      (s.type==='image')      el = createImageElement(s.data,s.x,s.y,s.w,s.h);
    else if (s.type==='note')       el = createNoteElement(s.data,s.x,s.y,s.w,s.h);
    else if (s.type==='color')      el = createColorElement(s.data,s.x,s.y,s.w,s.h);
    else if (s.type==='link')       { const d=tryParse(s.data); el=createLinkElement(d.url,d.title,d.img,s.x,s.y); }
    else if (s.type==='video')      { const d=tryParse(s.data); el=createVideoElement(d.src,d.isEmbed,s.x,s.y,s.w,s.h); }
    else if (s.type==='file')       { const d=tryParse(s.data); if(d.isVideo) el=createVideoFileElement(d.name,d.size,d.src||'',s.x,s.y,s.w,s.h); else el=createFileElement(d.name,d.size,d.icon,s.x,s.y); }
    else if (s.type==='connection') {
      // Restaurer après que les éléments soient dans le DOM
      setTimeout(() => createConnection(s.from, s.to), 50);
      return null;
    }
   else if (s.type==='caption') {
      const cap = document.createElement('div');
      cap.classList.add('el-caption');
      cap.contentEditable = 'true';
      cap.dataset.placeholder = 'Ajouter un commentaire…';
      cap.dataset.parentId = s.parentId || '';
      cap.dataset.type = 'caption';
      cap.style.left  = s.x + 'px';
      cap.style.top   = s.y + 'px';
      if (s.width) cap.style.width = s.width;
      cap.textContent = s.text || '';
      
      // Liaison au panneau de texte
      cap.addEventListener('focus', () => showTextEditPanel(cap));
      cap.addEventListener('blur', (e) => handleCaptionBlur(e, cap));
      
      document.getElementById('canvas').appendChild(cap);
      return cap;
    }
    if (el && s.z) el.style.zIndex = s.z;
    if (el && s.id) {
      // Remap _imgStore: createImageElement a stocké sous un ID temporaire,
      // il faut le déplacer vers l'ID original sauvegardé avant de l'écraser.
      if (el.dataset.type === 'image') {
        const tempId = el.dataset.id;
        if (_imgStore.has(tempId)) {
          _imgStore.set(s.id, _imgStore.get(tempId));
          _imgStore.delete(tempId);
        }
      }
      el.dataset.id = s.id;
    }
    return el;
  }

  // ── IMAGE ─────────────────────────────────────────────────────────────────
  function createImageElement(src, x, y, w, h) {
    const doCreate = (natW, natH) => {
      let fw = w || natW || 220;
      let fh = h || natH || 170;
      // Limiter à 20% de la dimension dominante de la vue visible (en coordonnées canvas)
      if (!w && !h) {
        const wrapEl = document.getElementById('canvas-wrapper');
        const vw = (wrapEl ? wrapEl.clientWidth  : window.innerWidth)  / (zoomLevel || 1);
        const vh = (wrapEl ? wrapEl.clientHeight : window.innerHeight) / (zoomLevel || 1);
        const maxDim = Math.max(vw, vh) * 0.20;
        if (fw > maxDim) { fh = Math.round(fh * maxDim / fw); fw = Math.round(maxDim); }
        if (fh > maxDim) { fw = Math.round(fw * maxDim / fh); fh = Math.round(maxDim); }
      }
      const el = makeElement('image', x||100, y||100, fw, fh);
      _imgStore.set(el.dataset.id, src); // base64 hors-DOM → inspecteur léger
      // Stocker le ratio w/h pour le resize proportionnel
      el.dataset.ratio = (fw / fh).toFixed(6);
      // L'img est posée directement dans le board-element, sans div wrapper
      const img = document.createElement('img');
      img.src = src; img.draggable = false;
      el.insertBefore(img, el.querySelector('.element-toolbar'));
      return el;
    };
    // Si les dimensions sont déjà connues (chargement sauvegarde), créer directement
    if (w && h) return doCreate(w, h);
    // Sinon, charger l'image pour obtenir ses dimensions naturelles
    const tmpImg = new Image();
    tmpImg.onload = () => doCreate(tmpImg.naturalWidth, tmpImg.naturalHeight);
    tmpImg.onerror = () => doCreate(220, 170);
    tmpImg.src = src;
    return null; // création asynchrone
  }
  function addImageFromPanel(src) {
    const tmpImg = new Image();
    tmpImg.onload = () => {
      const c = getCenter();
      let w = tmpImg.naturalWidth || 220;
      let h = tmpImg.naturalHeight || 170;
      // Plafonner à 800×350px
      if (w > 800) { h = Math.round(h * 800 / w); w = 800; }
      if (h > 350) { w = Math.round(w * 350 / h); h = 350; }
      createImageElement(src, c.x - w/2, c.y - h/2, w, h);
      pushHistory(); scheduleSave();
    };
    tmpImg.onerror = () => {
      const c = getCenter();
      createImageElement(src, c.x-110, c.y-85, 220, 170);
      pushHistory(); scheduleSave();
    };
    tmpImg.src = src;
  }

  // ── NOTE ──────────────────────────────────────────────────────────────────
  function addNote() {
    const c = getCenter();
    createNoteElement('', c.x-110, c.y-75, 230, 160);
    pushHistory(); scheduleSave();
  }
  function createNoteElement(content, x, y, w, h) {
    w=w||230; h=h||160;
    const el = makeElement('note', x||100, y||100, w, h);
    el.dataset.savedata = content;
    const wrap = document.createElement('div');
    wrap.className = 'el-note';
    const ta = document.createElement('textarea');
    ta.placeholder = 'Écrire une note...'; ta.value = content;
    // Par défaut : non-interactif (1 clic = déplacer)
    ta.style.pointerEvents = 'none';
    ta.style.cursor = 'move';
    ta.addEventListener('input', () => { el.dataset.savedata=ta.value; scheduleSave(); });
    // Valeur au moment de l'entrée en édition — pour détecter un changement au blur
    let _noteValueOnFocus = '';
    // Double-clic sur le wrapper ou le textarea : activer l'édition + panneau texte
    function activateNoteEdit(e) {
      e.stopPropagation();
      e.preventDefault();
      ta.style.pointerEvents = 'auto';
      ta.style.cursor = 'text';
      el.dataset.editing = '1'; // signal pour isTyping() — bloque Ctrl+Z
      _noteValueOnFocus = ta.value; // mémoriser pour comparer au blur
      ta.focus();
      showTextEditPanel(el);
    }
    wrap.addEventListener('dblclick', activateNoteEdit);
    ta.addEventListener('dblclick', activateNoteEdit);
    // Un seul clic sur la textarea si déjà en mode édition → garder le focus
    ta.addEventListener('mousedown', e => {
      if (ta.style.pointerEvents === 'auto') e.stopPropagation();
    });
    // Quand le textarea perd le focus : revenir en mode déplacement
    // Si la note est vide, la supprimer. Si le texte a changé, sauvegarder un état historique.
    ta.addEventListener('blur', e => {
      // Ne pas fermer si l'utilisateur clique dans le panneau texte
      const panel = document.getElementById('text-edit-panel');
      const goingToPanel = (panel && e.relatedTarget && panel.contains(e.relatedTarget));
      if (goingToPanel || window._textPanelKeepOpen) return;
      ta.style.pointerEvents = 'none';
      ta.style.cursor = 'move';
      delete el.dataset.editing;
      hideTextEditPanel();
      if (!ta.value.trim()) {
        el.remove();
        if (selectedEl === el) selectedEl = null;
        multiSelected.delete(el);
        pushHistory(); scheduleSave();
      } else if (ta.value !== _noteValueOnFocus) {
        // Le texte a changé pendant l'édition → créer un état historique
        pushHistory(); scheduleSave();
      }
    });
    wrap.appendChild(ta);
    el.insertBefore(wrap, el.querySelector('.element-toolbar'));
    return el;
  }

  // ── COULEUR ───────────────────────────────────────────────────────────────
  function addColorDirect() {
    const c = getCenter();
    createColorElement('#000000', c.x-65, c.y-70, 130, 140);
    pushHistory(); scheduleSave();
  }
  function openColorPicker() { openModal('color-modal'); }
  function closeColorModal() { closeModal('color-modal'); }
  function syncHex(val) {
    document.getElementById('hex-input').value = val.replace('#','').toUpperCase();
    document.getElementById('hex-preview').style.background = val;
  }
  function syncColor(val) {
    if (val.length===6 && /^[0-9A-Fa-f]{6}$/.test(val)) {
      document.getElementById('color-picker-input').value = '#'+val;
      document.getElementById('hex-preview').style.background = '#'+val;
    }
  }
  function addColorElement() {
    const hex = '#'+document.getElementById('hex-input').value.trim().toUpperCase().replace('#','');
    const c = getCenter();
    createColorElement(hex, c.x-65, c.y-70, 130, 140);
    pushHistory(); scheduleSave(); closeColorModal();
  }
  function createColorElement(hex, x, y, w, h) {
    w=w||130; h=h||140;
    const el = makeElement('color', x||100, y||100, w, h);
    el.dataset.savedata = hex;
    const wrap = document.createElement('div');
    wrap.className = 'el-color';
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch'; swatch.style.background = hex;

    const info = document.createElement('div');
    info.className = 'color-info';

    // Input HEX éditable
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'color-hex-input';
    hexInput.value = (hex || '').toUpperCase();
    hexInput.maxLength = 7;
    hexInput.spellcheck = false;

    // Empêcher le drag de l'élément quand on clique sur l'input
    hexInput.addEventListener('mousedown', e => e.stopPropagation());
    hexInput.addEventListener('pointerdown', e => e.stopPropagation());

    // Mise à jour de la couleur à la saisie (hex toujours en majuscules)
    function applyHexColor(val) {
      const v = val.trim().toUpperCase();
      if (/^#[0-9A-F]{3}$/.test(v) || /^#[0-9A-F]{6}$/.test(v)) {
        swatch.style.background = v;
        el.dataset.savedata = v;
        hexInput.value = v;
        pushHistory(); scheduleSave();
        return true;
      }
      return false;
    }
    hexInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); hexInput.blur(); }
      e.stopPropagation();
    });
    hexInput.addEventListener('blur', () => {
      // Si la valeur saisie est un hex valide → appliquer
      // Sinon → toujours restaurer depuis savedata (jamais laisser vide)
      if (!applyHexColor(hexInput.value)) {
        hexInput.value = (el.dataset.savedata || hex || '#000000').toUpperCase();
      }
    });
    hexInput.addEventListener('input', () => {
      hexInput.value = hexInput.value.toUpperCase();
      const v = hexInput.value.trim();
      if (/^#[0-9A-F]{3}$/.test(v) || /^#[0-9A-F]{6}$/.test(v)) {
        swatch.style.background = v;
      }
    });

    // Bouton pipette
    const eyeBtn = document.createElement('button');
    eyeBtn.className = 'color-eyedropper';
    eyeBtn.title = 'Pipette — cliquer sur le canvas pour prendre une couleur';
    eyeBtn.innerHTML = '<img src="PNG/pipette.png" style="width:14px;height:14px;object-fit:contain;display:block;">';
    eyeBtn.addEventListener('mousedown', e => e.stopPropagation());
    eyeBtn.addEventListener('pointerdown', e => e.stopPropagation());
    eyeBtn.addEventListener('click', e => {
      e.stopPropagation();
      activateEyedropper(el, swatch, hexInput);
    });

    info.appendChild(hexInput);
    info.appendChild(eyeBtn);
    wrap.appendChild(swatch); wrap.appendChild(info);
    el.insertBefore(wrap, el.querySelector('.element-toolbar'));
    // Marquer comme déjà attaché (propriété JS, pas dataset, pour ne pas être dans innerHTML)
    el._colorEventsAttached = true;
    return el;
  }

  // ── EYEDROPPER ──────────────────────────────────────────────────────────────
  let eyedropperActive = false;
  function activateEyedropper(colorEl, swatch, hexInput) {
    // Essayer l'API EyeDropper native (Chrome 95+)
    if (window.EyeDropper) {
      const picker = new window.EyeDropper();
      picker.open().then(result => {
        const hex = result.sRGBHex.toUpperCase();
        swatch.style.background = hex;
        hexInput.value = hex;
        colorEl.dataset.savedata = hex;
        pushHistory(); scheduleSave();
      }).catch(() => {}); // annulé par l'utilisateur
      return;
    }
    // Fallback : curseur custom sur le canvas-wrapper
    if (eyedropperActive) return;
    eyedropperActive = true;
    const wrapper = document.getElementById('canvas-wrapper');
    wrapper.style.cursor = 'crosshair';
    toast('Cliquez sur une couleur du canvas');
    const onPick = e => {
      e.preventDefault(); e.stopPropagation();
      eyedropperActive = false;
      wrapper.style.cursor = '';
      wrapper.removeEventListener('click', onPick, true);
      document.removeEventListener('keydown', onKey, true);
      // Coordonnées dans le canvas-wrapper
      const wrapRect = wrapper.getBoundingClientRect();
      const cx = (e.clientX - wrapRect.left - panX) / zoomLevel;
      const cy = (e.clientY - wrapRect.top  - panY) / zoomLevel;
      // Utiliser la capture minimaliste via un tempContainer de 3×3px
      const canvasDiv = document.getElementById('canvas');
      const savedTf = canvasDiv.style.transform;
      canvasDiv.style.transform = 'translate(0px,0px) scale(1)';
      canvasDiv.getBoundingClientRect();
      html2canvas(canvasDiv, {
        scale: 1, useCORS: true, allowTaint: true,
        x: Math.round(cx) - 1, y: Math.round(cy) - 1, width: 3, height: 3,
        scrollX: 0, scrollY: 0
      }).then(cap => {
        canvasDiv.style.transform = savedTf;
        const ctx = cap.getContext('2d');
        const px = ctx.getImageData(1, 1, 1, 1).data;
        const toHex = v => v.toString(16).padStart(2,'0').toUpperCase();
        const hex = '#' + toHex(px[0]) + toHex(px[1]) + toHex(px[2]);
        swatch.style.background = hex;
        hexInput.value = hex;
        colorEl.dataset.savedata = hex;
        pushHistory(); scheduleSave();
      }).catch(() => { canvasDiv.style.transform = savedTf; toast('Impossible de lire le pixel'); });
    };
    wrapper.addEventListener('click', onPick, true);
    // Annuler avec Escape
    const onKey = e => {
      if (e.key === 'Escape') {
        eyedropperActive = false;
        wrapper.style.cursor = '';
        wrapper.removeEventListener('click', onPick, true);
        document.removeEventListener('keydown', onKey, true);
      }
    };
    document.addEventListener('keydown', onKey, true);
  }

  // ── LIEN ──────────────────────────────────────────────────────────────────
  function openLinkModal()  { openModal('link-modal'); setTimeout(()=>document.getElementById('link-url-input').focus(),80); }
  function closeLinkModal() { closeModal('link-modal'); }
  function addLinkElement() {
    const url   = document.getElementById('link-url-input').value.trim();
    const title = document.getElementById('link-title-input').value.trim() || url;
    const img   = document.getElementById('link-img-input').value.trim();
    if (!url) { toast('Entrez une URL'); return; }
    let lx, ly;
    if (pendingToolDropPos) {
      lx = pendingToolDropPos.x; ly = pendingToolDropPos.y;
      pendingToolDropPos = null;
    } else {
      const c = getCenter(); lx = c.x-140; ly = c.y-90;
    }
    createLinkElement(url, title, img, lx, ly);
    pushHistory(); scheduleSave(); closeLinkModal();
    ['link-url-input','link-title-input','link-img-input'].forEach(id => document.getElementById(id).value='');
  }
  function createLinkElement(url, title, imgSrc, x, y) {
    const el = makeElement('link', x||100, y||100, 270, 220);
    el.dataset.savedata = JSON.stringify({url,title,img:imgSrc});
    const wrap = document.createElement('div');
    wrap.className = 'el-link';
    if (imgSrc) {
      const img = document.createElement('img');
      img.className='link-image'; img.src=imgSrc; img.alt=title;
      wrap.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className='link-image-placeholder'; ph.textContent='🔗';
      wrap.appendChild(ph);
    }
    const body = document.createElement('div');
    body.className='link-body';
    body.innerHTML=`<div class="link-title">${escHtml(title)}</div><div class="link-url">${escHtml(url)}</div>`;
    wrap.appendChild(body);
    wrap.addEventListener('dblclick', ()=>window.open(url,'_blank'));
    el.insertBefore(wrap, el.querySelector('.element-toolbar'));
    return el;
  }

  // ── VIDÉO ─────────────────────────────────────────────────────────────────
  function openVideoModal()  { openModal('video-modal'); }
  function closeVideoModal() { closeModal('video-modal'); }
  function switchVideoTab(mode) {
    videoTabMode = mode;
    document.getElementById('vt-url').classList.toggle('active', mode==='url');
    document.getElementById('vt-local').classList.toggle('active', mode==='local');
    document.getElementById('video-url-section').classList.toggle('hidden', mode!=='url');
    document.getElementById('video-local-section').classList.toggle('hidden', mode!=='local');
  }
  function addVideoURL() {
    let url = document.getElementById('video-url-input').value.trim();
    if (!url) { toast('Entrez une URL'); return; }
    let embed=url, isEmbed=false;
    const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    const vm = url.match(/vimeo\.com\/(\d+)/);
    if (yt) { embed=`https://www.youtube.com/embed/${yt[1]}`; isEmbed=true; }
    if (vm) { embed=`https://player.vimeo.com/video/${vm[1]}`; isEmbed=true; }
    const c = getCenter();
    createVideoElement(embed, isEmbed, c.x-180, c.y-101, 360, 202);
    pushHistory(); scheduleSave(); closeVideoModal();
    document.getElementById('video-url-input').value='';
  }
  function handleVideoUpload(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const c = getCenter();
      createVideoElement(ev.target.result, false, c.x-180, c.y-101, 360, 202);
      pushHistory(); scheduleSave(); closeVideoModal();
    };
    reader.readAsDataURL(file);
    e.target.value='';
  }
  function createVideoElement(src, isEmbed, x, y, w, h) {
    w=w||360; h=h||202;
    const el = makeElement('video', x||100, y||100, w, h);
    el.dataset.savedata = JSON.stringify({src,isEmbed});
    
    const wrap = document.createElement('div');
    wrap.className = 'el-video';
    wrap.style.position = 'relative';
    wrap.style.cursor = 'pointer';

    // Image de fond statique
    const img = document.createElement('img');
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.display = 'block';
    img.style.pointerEvents = 'none';

    if (isEmbed) {
      const ytMatch = src.match(/youtube\.com\/embed\/([^&\s?]+)/);
      if (ytMatch) {
        img.src = `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;
      } else {
        img.style.background = '#111';
      }
    } else {
      img.style.background = '#111';
    }

    // Indicateur Play central (styles codés en dur pour s'affranchir d'éditer le CSS)
    const hint = document.createElement('div');
    hint.style.position = 'absolute';
    hint.style.top = '50%';
    hint.style.left = '50%';
    hint.style.transform = 'translate(-50%,-50%)';
    hint.style.width = '44px';
    hint.style.height = '44px';
    hint.style.background = 'rgba(255,255,255,0.18)';
    hint.style.borderRadius = '50%';
    hint.style.backdropFilter = 'blur(2px)';
    hint.style.pointerEvents = 'none';
    hint.innerHTML = '<div style="position:absolute;top:50%;left:50%;transform:translate(-38%,-50%);width:0;height:0;border-top:9px solid transparent;border-bottom:9px solid transparent;border-left:15px solid rgba(255,255,255,0.9);"></div>';

    wrap.appendChild(img);
    wrap.appendChild(hint);

    wrap.addEventListener('dblclick', e => {
      e.stopPropagation();
      openVideoLightbox(src, isEmbed);
    });

    el.insertBefore(wrap, el.querySelector('.element-toolbar'));
    return el;
  }

  // ── TOOLBAR DRAG ──────────────────────────────────────────────────────────
  function toolDragStart(e, type) {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', 'tool:' + type);
    // Ghost image transparent
    const ghost = document.createElement('div');
    ghost.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => ghost.remove(), 0);
  }

  // ── FICHIER ───────────────────────────────────────────────────────────────
  function addFile() { fileReplaceTarget = null; document.getElementById('file-input-file').click(); }
  const VIDEO_EXTS = new Set(['mp4','webm','mov','avi','mkv','ogv','m4v']);
  function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) { e.target.value=''; return; }

    // MODE REMPLACEMENT : un seul fichier remplace l'élément cible
    if (fileReplaceTarget && document.getElementById('canvas').contains(fileReplaceTarget)) {
      const target = fileReplaceTarget;
      fileReplaceTarget = null;
      const file = files[0];
      const ext  = file.name.split('.').pop().toLowerCase();
      const size = file.size<1024?file.size+'B':file.size<1048576?(file.size/1024).toFixed(1)+'KB':(file.size/1048576).toFixed(1)+'MB';
      const x = parseFloat(target.style.left)||0;
      const y = parseFloat(target.style.top) ||0;
      const w = parseFloat(target.style.width)||null;
      const h = parseFloat(target.style.height)||null;
      if (VIDEO_EXTS.has(ext)) {
        readFileAsBase64(file).then(b64 => {
          const newEl = createVideoFileElement(file.name, size, b64, x, y, w, h);
          newEl.dataset.id = target.dataset.id;
          newEl.style.zIndex = target.style.zIndex;
          target.replaceWith(newEl);
          selectEl(newEl); pushHistory(); scheduleSave();
        });
      } else {
        const icns = {pdf:'📄',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',ppt:'📋',pptx:'📋',zip:'🗜️',rar:'🗜️',mp3:'🎵',wav:'🎵',txt:'📃'};
        const newEl = createFileElement(file.name, size, icns[ext]||'file', x, y);
        newEl.dataset.id = target.dataset.id;
        newEl.style.zIndex = target.style.zIndex;
        if (w) newEl.style.width  = w + 'px';
        if (h) newEl.style.height = h + 'px';
        target.replaceWith(newEl);
        selectEl(newEl); pushHistory(); scheduleSave();
      }
      e.target.value='';
      return;
    }
    fileReplaceTarget = null;

    // MODE CRÉATION : nouveaux éléments
    files.forEach((file,i) => {
      const ext  = file.name.split('.').pop().toLowerCase();
      const size = file.size<1024?file.size+'B':file.size<1048576?(file.size/1024).toFixed(1)+'KB':(file.size/1048576).toFixed(1)+'MB';
      let baseX, baseY;
      if (pendingToolDropPos) {
        baseX = pendingToolDropPos.x + i*22;
        baseY = pendingToolDropPos.y + i*22;
      } else {
        const c = getCenter();
        baseX = c.x - 110 + i*22;
        baseY = c.y - 30  + i*22;
      }
      if (VIDEO_EXTS.has(ext)) {
        readFileAsBase64(file).then(b64 => {
          createVideoFileElement(file.name, size, b64, baseX, baseY);
          pushHistory(); scheduleSave();
        });
      } else {
        const icns = {pdf:'📄',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',ppt:'📋',pptx:'📋',zip:'🗜️',rar:'🗜️',mp3:'🎵',wav:'🎵',txt:'📃'};
        const icon = icns[ext]||'file';
        createFileElement(file.name, size, icon, baseX, baseY);
      }
    });
    pendingToolDropPos = null;
    pushHistory(); scheduleSave(); e.target.value='';
  }

  // Lire un fichier en base64 (data URL)
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = ev => resolve(ev.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function createVideoFileElement(name, size, videoSrc, x, y, w, h) {
    const el = makeElement('file', x||100, y||100, w||300, h||200);
    el.dataset.savedata = JSON.stringify({name, size, icon:'video', isVideo:true, src: videoSrc});
    const wrap = document.createElement('div');
    wrap.className = 'el-file-video';
    
    // Remplacement strict par une image (zéro balise <video> dans le DOM = zéro lag)
    const img = document.createElement('img');
    img.style.cssText = 'width:100%; height:100%; object-fit:contain; display:block; pointer-events:none; position:absolute; top:0; left:0;';
    wrap.appendChild(img);

    // Extraction isolée et destruction immédiate pour la miniature
    if (videoSrc) {
      const d = tryParse(el.dataset.savedata);
      if (d.thumb) {
        img.src = d.thumb;
      } else {
        const tempVid = document.createElement('video');
        tempVid.muted = true; tempVid.playsInline = true; tempVid.src = videoSrc;
        tempVid.onloadeddata = () => { tempVid.currentTime = 1.0; };
        tempVid.onseeked = () => {
          const canvas = document.createElement('canvas');
          canvas.width = tempVid.videoWidth; canvas.height = tempVid.videoHeight;
          canvas.getContext('2d').drawImage(tempVid, 0, 0, canvas.width, canvas.height);
          img.src = canvas.toDataURL('image/jpeg', 0.6);
          d.thumb = img.src; // Sauvegarde dans les données pour ne plus jamais recalculer
          el.dataset.savedata = JSON.stringify(d);
          tempVid.removeAttribute('src'); tempVid.load(); // Nettoyage agressif de la RAM
        };
      }
    }

    const hint = document.createElement('div');
    hint.className = 'video-play-hint';
    wrap.appendChild(hint);

    wrap.addEventListener('dblclick', e => {
      e.stopPropagation();
      const d = tryParse(el.dataset.savedata);
      const src = d.src || videoSrc;
      if (src) { openVideoLightbox(src, false); return; }
      fileReplaceTarget = el;
      document.getElementById('file-input-file').click();
    });

    el.insertBefore(wrap, el.querySelector('.element-toolbar'));
    el._fileEventsAttached = true;
    return el;
  }

  function createVideoElement(src, isEmbed, x, y, w, h) {
    w=w||360; h=h||202;
    const el = makeElement('video', x||100, y||100, w, h);
    el.dataset.savedata = JSON.stringify({src,isEmbed});
    const wrap = document.createElement('div');
    wrap.className = 'el-video';
    wrap.style.position = 'relative';

    // Remplacement strict par une image
    const img = document.createElement('img');
    img.style.cssText = 'width:100%; height:100%; object-fit:cover; display:block; pointer-events:none; background:#111;';
    
    if (isEmbed) {
      const yt = src.match(/youtube\.com\/embed\/([^&\s?]+)/);
      if (yt) img.src = `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg`;
    }
    wrap.appendChild(img);

    const hint = document.createElement('div');
    hint.className = 'video-play-hint';
    // Style forcé ici car .el-video n'a pas les CSS natifs du .video-play-hint de .el-file-video
    hint.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px;background:rgba(255,255,255,0.18);border-radius:50%;backdrop-filter:blur(2px);pointer-events:none;';
    hint.innerHTML = '<div style="position:absolute;top:50%;left:50%;transform:translate(-38%,-50%);width:0;height:0;border-top:9px solid transparent;border-bottom:9px solid transparent;border-left:15px solid rgba(255,255,255,0.9);"></div>';
    wrap.appendChild(hint);

    wrap.addEventListener('dblclick', e => {
      e.stopPropagation();
      openVideoLightbox(src, isEmbed);
    });

    el.insertBefore(wrap, el.querySelector('.element-toolbar'));
    return el;
  }

  function openVideoLightbox(src, isEmbed = false) {
    const overlay = document.getElementById('video-lightbox-overlay');
    const vid = document.getElementById('vlb-video');
    let iframe = document.getElementById('vlb-iframe');

    if (isEmbed) {
      vid.style.display = 'none';
      vid.pause();
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'vlb-iframe';
        iframe.allowFullscreen = true;
        iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
        iframe.style.cssText = 'width:92vw; height:82vh; max-width:1200px; max-height:800px; background:#000; border:none; box-shadow:0 8px 48px rgba(0,0,0,0.6); display:block;';
        overlay.appendChild(iframe);
      }
      iframe.style.display = 'block';
      iframe.src = src.includes('?') ? src + '&autoplay=1' : src + '?autoplay=1';
    } else {
      if (iframe) { iframe.style.display = 'none'; iframe.src = ''; }
      vid.style.display = 'block';
      vid.src = src;
      setTimeout(() => vid.play(), 100);
    }
    overlay.classList.add('show');
  }

  function closeVideoLightbox() {
    const overlay = document.getElementById('video-lightbox-overlay');
    const vid = document.getElementById('vlb-video');
    const iframe = document.getElementById('vlb-iframe');
    vid.pause(); vid.src = '';
    if (iframe) iframe.src = '';
    overlay.classList.remove('show');
  }

  // ── TOOLBAR ÉLÉMENTS ──────────────────────────────────────────────────────
  function removeEl(btn) {
    const el = btn.closest('.board-element');
    if (!el) return;
    if (multiSelected.has(el) && multiSelected.size > 0) {
      // Supprimer toute la sélection
      const toDelete = [...multiSelected];
      if (selectedEl && !multiSelected.has(selectedEl)) toDelete.push(selectedEl);
      toDelete.forEach(e => { removeConnectionsForEl(e); removeCaptionsForEl(e); e.remove(); });
      multiSelected.clear(); selectedEl = null;
      toast(toDelete.length + ' éléments supprimés');
    } else {
      removeConnectionsForEl(el); removeCaptionsForEl(el); el.remove(); selectedEl = null;
    }
    pushHistory(); scheduleSave();
  }
  function duplicateEl(btn) {
    const el = btn.closest('.board-element');
    if (!el) return;
    if (multiSelected.has(el) && multiSelected.size > 1) {
      // Dupliquer toute la sélection
      multiSelected.forEach(e => {
        const s = { type: e.dataset.type, x: parseFloat(e.style.left)+24, y: parseFloat(e.style.top)+24,
          w: parseFloat(e.style.width)||null, h: parseFloat(e.style.height)||null, data: e.dataset.savedata };
        restoreElement(s);
      });
      pushHistory(); scheduleSave();
      return;
    }
    const s = {
      type: el.dataset.type,
      x: parseFloat(el.style.left)+24, y: parseFloat(el.style.top)+24,
      w: parseFloat(el.style.width)||null, h: parseFloat(el.style.height)||null,
      data: el.dataset.savedata
    };
    const newEl = restoreElement(s);
    if (newEl) { selectEl(newEl); pushHistory(); scheduleSave(); }
  }

  // ── CONTEXT MENU ─────────────────────────────────────────────────────────
  function showContextMenu(x, y) {
    const menu = document.getElementById('context-menu');
    const isImage = ctxTargetEl && ctxTargetEl.dataset.type === 'image';
    const totalSel = multiSelected.size + (selectedEl && !multiSelected.has(selectedEl) ? 1 : 0);
    const canConnect = totalSel >= 2;
    document.getElementById('ctx-img-divider').style.display  = isImage ? '' : 'none';
    document.getElementById('ctx-img-download').style.display = isImage ? '' : 'none';
    document.getElementById('ctx-img-replace').style.display  = isImage ? '' : 'none';
    document.getElementById('ctx-img-caption').style.display  = isImage ? '' : 'none';
    document.getElementById('ctx-connect-divider').style.display = canConnect ? '' : 'none';
    document.getElementById('ctx-connect').style.display         = canConnect ? '' : 'none';
    menu.style.display = 'block';
    const mw=180, mh = 180;
    menu.style.left = (x+mw>window.innerWidth  ? x-mw : x)+'px';
    menu.style.top  = (y+mh>window.innerHeight ? y-mh : y)+'px';
  }

  function ctxDownloadImage() {
    if (!ctxTargetEl || ctxTargetEl.dataset.type !== 'image') return;
    const img = ctxTargetEl.querySelector('img');
    if (!img) return;
    const a = document.createElement('a');
    a.href = img.src;
    a.download = 'image_' + Date.now() + '.png';
    a.click();
    hideContextMenu();
  }

  let replaceTargetEl = null;
  function ctxReplaceImage() {
    if (!ctxTargetEl || ctxTargetEl.dataset.type !== 'image') return;
    replaceTargetEl = ctxTargetEl;
    hideContextMenu();
    const input = document.getElementById('file-input-replace');
    input.onchange = e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const src = ev.target.result;
        const img = replaceTargetEl.querySelector('img');
        if (img) {
          img.src = src;
          replaceTargetEl.dataset.savedata = src;
          // Adapter le conteneur aux dimensions de la nouvelle image
          const tmpImg = new Image();
          tmpImg.onload = () => {
            let natW = tmpImg.naturalWidth  || 220;
            let natH = tmpImg.naturalHeight || 170;
            // Conserver la largeur actuelle, adapter la hauteur selon le ratio
            const currentW = parseFloat(replaceTargetEl.style.width) || natW;
            const ratio = natW / natH;
            const newH = Math.round(currentW / ratio);
            replaceTargetEl.style.width  = currentW + 'px';
            replaceTargetEl.style.height = newH + 'px';
            replaceTargetEl.dataset.ratio = ratio.toFixed(6);
            pushHistory(); scheduleSave();
          };
          tmpImg.src = src;
        }
      };
      reader.readAsDataURL(file);
      input.value = '';
    };
    input.click();
  }
  // ── CONNEXIONS ────────────────────────────────────────────────────────────
  function getElCenter(el) {
    return {
      x: (parseFloat(el.style.left)||0) + el.offsetWidth  / 2,
      y: (parseFloat(el.style.top) ||0) + el.offsetHeight / 2
    };
  }

  function ctxConnect() {
    hideContextMenu();
    // Rassembler tous les éléments sélectionnés (multi + selectedEl)
    const allSel = new Set(multiSelected);
    if (selectedEl) allSel.add(selectedEl);
    const ids = [...allSel].map(el => el.dataset.id).filter(Boolean);
    if (ids.length < 2) return;
    // Connecter chaque paire consecutive
    for (let i = 0; i < ids.length - 1; i++) {
      createConnection(ids[i], ids[i+1]);
    }
    pushHistory(); scheduleSave();
  }

  function createConnection(fromId, toId) {
    const canvas = document.getElementById('canvas');
    const fromEl = canvas.querySelector(`[data-id="${fromId}"]`);
    const toEl   = canvas.querySelector(`[data-id="${toId}"]`);
    if (!fromEl || !toEl) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('el-connection');
    svg.dataset.from = fromId;
    svg.dataset.to   = toId;
    svg.dataset.connId = 'conn_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    svg.appendChild(line);
    canvas.insertBefore(svg, canvas.firstChild);
    updateConnection(svg, fromEl, toEl);
  }

  function updateConnection(svg, fromEl, toEl) {
    const fc = getElCenter(fromEl);
    const tc = getElCenter(toEl);
    const line = svg.querySelector('line');
    if (line) {
      line.setAttribute('x1', fc.x); line.setAttribute('y1', fc.y);
      line.setAttribute('x2', tc.x); line.setAttribute('y2', tc.y);
    }
  }

  function updateConnectionsForEl(el) {
    const canvas = document.getElementById('canvas');
    const id = el.dataset.id;
    canvas.querySelectorAll('.el-connection').forEach(svg => {
      if (svg.dataset.from === id || svg.dataset.to === id) {
        const fromEl = canvas.querySelector(`[data-id="${svg.dataset.from}"]`);
        const toEl   = canvas.querySelector(`[data-id="${svg.dataset.to}"]`);
        if (fromEl && toEl) updateConnection(svg, fromEl, toEl);
      }
    });
  }

  function updateAllConnections() {
    const canvas = document.getElementById('canvas');
    canvas.querySelectorAll('.el-connection').forEach(svg => {
      const fromEl = canvas.querySelector(`[data-id="${svg.dataset.from}"]`);
      const toEl   = canvas.querySelector(`[data-id="${svg.dataset.to}"]`);
      if (fromEl && toEl) updateConnection(svg, fromEl, toEl);
    });
  }

  // ── CAPTIONS ─────────────────────────────────────────────────────────────
  function ctxAddCaption() {
    hideContextMenu();
    if (!ctxTargetEl) return;
    const el = ctxTargetEl;
    const l = parseFloat(el.style.left)||0;
    const t = parseFloat(el.style.top) ||0;
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    const cap = document.createElement('div');
    cap.classList.add('el-caption');
    cap.contentEditable = 'true';
    cap.dataset.placeholder = 'Ajouter un commentaire…';
    cap.dataset.parentId = el.dataset.id || '';
    cap.dataset.type = 'caption';
    cap.style.left  = l + 'px';
    cap.style.top   = (t + h) + 'px';   // collée directement sous l'image
    cap.style.width = w + 'px';
    // Ajout des listeners
    cap.addEventListener('focus', () => showTextEditPanel(cap));
    cap.addEventListener('blur', (e) => handleCaptionBlur(e, cap));
    document.getElementById('canvas').appendChild(cap);
    cap.focus();
    pushHistory(); scheduleSave();
  }

  function hideContextMenu() { document.getElementById('context-menu').style.display='none'; }

  // ── PANNEAU ÉDITION TEXTE ─────────────────────────────────────────────────
  let textEditTarget = null;
  function showTextEditPanel(el) {
    textEditTarget = el;
    document.getElementById('toolbar').style.display = 'none';
    const panel = document.getElementById('text-edit-panel');
    panel.classList.add('active');
    
    // Déterminer la cible du style (le textarea dans une note, ou l'élément lui-même si c'est une caption)
    const target = el.querySelector('textarea') || el;
    
    if (target) {
      const sz = parseInt(target.style.fontSize) || 12; // 12px par défaut pour caption
      const sizeVal = document.getElementById('text-size-val');
      if (sizeVal) sizeVal.textContent = sz;
      
      const fw = target.style.fontWeight;
      document.querySelectorAll('.text-font-btn').forEach(b => b.classList.remove('active'));
      const activeId = (fw === '700' || fw === 'bold') ? 'tp-bold' : 'tp-roman';
      const activeBtn = document.getElementById(activeId);
      if (activeBtn) activeBtn.classList.add('active');
    }
    
    if (!panel._mousedownGuard) {
      panel._mousedownGuard = true;
      panel.addEventListener('mousedown', () => { window._textPanelKeepOpen = true; });
      panel.addEventListener('mouseup',   () => { window._textPanelKeepOpen = false; });
    }
  }
  function hideTextEditPanel() {
    document.getElementById('text-edit-panel').classList.remove('active');
    document.getElementById('toolbar').style.display = '';
    textEditTarget = null;
  }
  
  function handleCaptionBlur(e, cap) {
    const panel = document.getElementById('text-edit-panel');
    const goingToPanel = (panel && e.relatedTarget && panel.contains(e.relatedTarget));
    
    // Si on clique vers le panneau de texte, on ne ferme pas
    if (goingToPanel || window._textPanelKeepOpen) return;
    
    hideTextEditPanel();
    
    // Si le commentaire est vide après l'édition, on le supprime
    if (!cap.textContent.trim()) {
      cap.remove();
      pushHistory(); 
      scheduleSave();
    }
  }
  function applyTextFont(val) {
    if (!textEditTarget) return;
    
    // On cible soit le textarea (pour les notes), soit l'élément lui-même (si c'est une caption)
    const ta = textEditTarget.querySelector('textarea') || 
               (textEditTarget.classList.contains('el-caption') ? textEditTarget : null);
    
    if (!ta) return;

    const fontMap = {
      'helvetica-roman': "'HelveticaRoman','Helvetica Neue',Helvetica,Arial,sans-serif",
      'helvetica-bold':  "'HelveticaBold','Helvetica Neue',Helvetica,Arial,sans-serif"
    };

    if (fontMap[val]) {
      ta.style.fontFamily = fontMap[val];
      // Important : pour les captions, il faut forcer le poids de la police
      ta.style.fontWeight = (val === 'helvetica-bold') ? '700' : '400';
    }

    // Mettre à jour l'état visuel des boutons dans le panneau
    document.querySelectorAll('.text-font-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(val === 'helvetica-bold' ? 'tp-bold' : 'tp-roman');
    if (activeBtn) activeBtn.classList.add('active');
    
    scheduleSave();
  }
  function applyTextSizeDelta(delta) {
    if (!textEditTarget) return;
    const ta = textEditTarget.querySelector('textarea') || textEditTarget;
    if (!ta) return;
    const current = parseInt(ta.style.fontSize) || 14;
    const next = Math.min(Math.max(current + delta, 8), 72);
    ta.style.fontSize = next + 'px';
    const sizeVal = document.getElementById('text-size-val');
    if (sizeVal) sizeVal.textContent = next;
    scheduleSave();
  }
  function applyTextAlign(align) {
    if (!textEditTarget) return;
    const ta = textEditTarget.querySelector('textarea') || textEditTarget;
    if (ta) ta.style.textAlign = align;
    document.querySelectorAll('.text-align-btn').forEach(b => b.classList.remove('active'));
    const id = { left:'ta-left', center:'ta-center', right:'ta-right' }[align];
    const btn = document.getElementById(id);
    if (btn) btn.classList.add('active');
    scheduleSave();
  }

  function ctxBringFront() { if (ctxTargetEl) { ctxTargetEl.style.zIndex=++nextZ; scheduleSave(); } hideContextMenu(); }
  function ctxSendBack()   { if (ctxTargetEl) { ctxTargetEl.style.zIndex=1; scheduleSave(); } hideContextMenu(); }
  function ctxDuplicate() {
    if (!ctxTargetEl) { hideContextMenu(); return; }
    if (multiSelected.has(ctxTargetEl) && multiSelected.size > 1) {
      // Dupliquer toute la sélection multiple
      const copies = [];
      multiSelected.forEach(el => {
        const s = {
          type: el.dataset.type,
          x: parseFloat(el.style.left)+24, y: parseFloat(el.style.top)+24,
          w: parseFloat(el.style.width)||null, h: parseFloat(el.style.height)||null,
          data: el.dataset.savedata
        };
        const newEl = restoreElement(s);
        if (newEl) copies.push(newEl);
      });
      if (copies.length) { pushHistory(); scheduleSave(); }
    } else {
      const s = {
        type: ctxTargetEl.dataset.type,
        x: parseFloat(ctxTargetEl.style.left)+24, y: parseFloat(ctxTargetEl.style.top)+24,
        w: parseFloat(ctxTargetEl.style.width)||null, h: parseFloat(ctxTargetEl.style.height)||null,
        data: ctxTargetEl.dataset.savedata
      };
      const el = restoreElement(s);
      if (el) { selectEl(el); pushHistory(); scheduleSave(); }
    }
    hideContextMenu();
  }
  function ctxDelete() {
    if (ctxTargetEl) { removeConnectionsForEl(ctxTargetEl); removeCaptionsForEl(ctxTargetEl); ctxTargetEl.remove(); selectedEl=null; pushHistory(); scheduleSave(); }
    hideContextMenu();
  }

  // ── PANNEAU BIBLIOTHÈQUE ──────────────────────────────────────────────────
  function toggleLibPanel() {
    libPanelOpen = !libPanelOpen;
    const panel = document.getElementById('lib-panel');
    panel.classList.toggle('open', libPanelOpen);
    if (libPanelOpen) renderPanelLib();
  }

  // ── Rendu dynamique des chips de dossier (+ bouton "+") ─────────────────
  function renderFolderChips() {
    const foldersDiv = document.getElementById('lib-folders');
    if (!foldersDiv) return;
    foldersDiv.innerHTML = '';
    const folderLabels = { all:'Tout', typographie:'Typo', couleur:'Couleur', logo:'Logo', image:'Image' };
    const allFolders = ['all', ...Object.keys(library)];

    allFolders.forEach(f => {
      const btn = document.createElement('button');
      btn.className = 'lib-folder-chip' + (f === panelFolder ? ' active' : '');
      btn.dataset.folder = f;
      const label = folderLabels[f] || f;
      const count = f === 'all'
        ? Object.values(library).reduce((a, b) => a + b.length, 0)
        : (library[f] || []).length;
      btn.textContent = `${label} (${count})`;

      btn.addEventListener('click', () => setPanelFolder(f, btn));
      btn.addEventListener('dragover', e => {
        if (isDraggingFromPanel) { e.preventDefault(); btn.classList.add('drag-over'); }
      });
      btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
      btn.addEventListener('drop', e => {
        btn.classList.remove('drag-over');
        if (!isDraggingFromPanel) return;
        e.preventDefault(); e.stopPropagation();
        const targetFolder = btn.dataset.folder;
        if (targetFolder === 'all') return;
        // Si aucun item sélectionné, utiliser l'item draggé seul
        const idsToMove = libSelectedIds.size > 0 ? new Set(libSelectedIds) : (draggedLibItemId ? new Set([draggedLibItemId]) : new Set());
        if (idsToMove.size === 0) return;
        idsToMove.forEach(id => {
          for (const folder of Object.keys(library)) {
            if (folder === targetFolder) continue;
            const idx = library[folder].findIndex(i => i.id === id);
            if (idx !== -1) {
              const [moved] = library[folder].splice(idx, 1);
              if (!library[targetFolder]) library[targetFolder] = [];
              library[targetFolder].push(moved);
              break;
            }
          }
        });
        libSelectedIds.clear();
        draggedLibItemId = null;
        saveLibrary(); renderPanelLib();
      });
      foldersDiv.appendChild(btn);
    });

    // Bouton "+" pour créer une nouvelle catégorie
    const addBtn = document.createElement('button');
    addBtn.className = 'lib-folder-chip';
    addBtn.title = 'Nouvelle catégorie';
    addBtn.textContent = '+';
    addBtn.style.cssText = 'color:#ff3c00;font-weight:800;padding:5px 9px;';
    addBtn.addEventListener('click', () => addNewLibFolder());
    foldersDiv.appendChild(addBtn);
  }

  function renderPanelLib() {
    renderFolderChips();

    const grid  = document.getElementById('lib-panel-grid');
    const empty = document.getElementById('lib-panel-empty');
    grid.innerHTML = '';
    let items = [];
    if (panelFolder === 'all') {
      Object.keys(library).forEach(f => items = items.concat(library[f].map(i=>({...i,folder:f}))));
    } else {
      items = (library[panelFolder]||[]).map(i=>({...i,folder:panelFolder}));
    }
    const q = document.getElementById('lib-panel-search').value.toLowerCase();
    if (q) items = items.filter(i => i.name.toLowerCase().includes(q));

    if (!items.length) {
      grid.style.display='none'; empty.classList.remove('hidden'); return;
    }
    grid.style.display='grid'; empty.classList.add('hidden');

    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'lib-panel-item'; div.draggable = true;
      if (libSelectedIds.has(item.id)) div.classList.add('selected-lib-item');

      const indicator = document.createElement('div');
      indicator.className = 'lib-select-indicator';

      const img = document.createElement('img');
      img.src = item.src; img.alt = escHtml(item.name);
      // GIF : eager pour préserver l'animation (lazy bloque les GIFs)
      img.loading = item.src.startsWith('data:image/gif') ? 'eager' : 'lazy';

      const name = document.createElement('div');
      name.className = 'lib-item-name'; name.textContent = item.name;

      const delBtn = document.createElement('button');
      delBtn.className = 'lib-item-delete'; delBtn.textContent = '✕';
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        deletePanelLibItem(item.id, item.folder);
      });

      // Sélection SHIFT+clic
      div.addEventListener('click', e => {
        if (e.shiftKey) {
          // Basculer la sélection de cet item
          if (libSelectedIds.has(item.id)) {
            libSelectedIds.delete(item.id);
            div.classList.remove('selected-lib-item');
          } else {
            libSelectedIds.add(item.id);
            div.classList.add('selected-lib-item');
          }
        } else {
          // Clic simple : sélectionner uniquement cet item
          libSelectedIds.clear();
          document.querySelectorAll('.lib-panel-item.selected-lib-item').forEach(d => d.classList.remove('selected-lib-item'));
          libSelectedIds.add(item.id);
          div.classList.add('selected-lib-item');
        }
      });

      div.addEventListener('dragstart', e => {
        draggedLibItemId = item.id;
        // Drag multiple si plusieurs items sélectionnés et celui-ci en fait partie
        if (libSelectedIds.has(item.id) && libSelectedIds.size > 1) {
          draggedLibItems = [];
          libSelectedIds.forEach(id => {
            for (const f of Object.keys(library)) {
              const found = library[f].find(i => i.id === id);
              if (found) { draggedLibItems.push(found); break; }
            }
          });
          e.dataTransfer.setData('text/plain', 'multi-lib');
        } else {
          draggedLibItems = [item];
          e.dataTransfer.setData('text/plain', item.src);
        }
        isDraggingFromPanel = true;
        // Ghost = image seule sous le curseur
        const ghost = new Image();
        ghost.src = item.src;
        ghost.style.cssText = 'position:fixed;top:-200px;left:-200px;max-width:80px;max-height:80px;pointer-events:none;';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 40, 40);
        setTimeout(() => { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 0);
      });
      div.addEventListener('dragend', () => { isDraggingFromPanel = false; draggedLibItemId = null; });

      div.appendChild(indicator);
      div.appendChild(img);
      div.appendChild(name);
      div.appendChild(delBtn);
      grid.appendChild(div);
    });
  }

  function setPanelFolder(folder, btn) {
    panelFolder = folder;
    renderPanelLib();
  }

  function searchPanelLib() { renderPanelLib(); }

  function uploadImages() { document.getElementById('file-input-images').click(); }

  function handleImageUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    let done = 0;
    const total = files.length;
    // Ouvrir le panneau si ce n'est pas déjà fait
    if (!libPanelOpen) {
      libPanelOpen = true;
      document.getElementById('lib-panel').classList.add('open');
    }
    // Dossier cible : dossier actif si ce n'est pas "all", sinon 'image' par défaut
    const targetFolder = (panelFolder && panelFolder !== 'all') ? panelFolder : 'image';

    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const item = { id:'lib_'+Date.now()+'_'+Math.random().toString(36).substr(2,5), name:file.name, src:ev.target.result };
        if (!library[targetFolder]) library[targetFolder] = [];
        library[targetFolder].push(item);
        done++;
        saveLibrary();
        renderPanelLib();
        if (done === total) toast(total + ' image(s) importée(s) dans "' + targetFolder + '"');
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }

  function deletePanelLibItem(id, folder) {
    if (!library[folder]) return;
    library[folder] = library[folder].filter(i=>i.id!==id);
    libSelectedIds.delete(id);
    saveLibrary();
    renderPanelLib();
  }

  function addNewLibFolder() {
    const name = prompt('Nom de la nouvelle catégorie :');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (Object.keys(library).some(k => k.toLowerCase() === trimmed.toLowerCase())) {
      toast('Cette catégorie existe déjà.'); return;
    }
    library[trimmed] = [];
    panelFolder = trimmed;
    saveLibrary();
    renderPanelLib();
  }

  function setupPanelDrop() {
    const panel   = document.getElementById('lib-panel-content');
    const overlay = document.getElementById('lib-panel-drop-overlay');
    panel.addEventListener('dragenter', e => {
      // N'afficher l'overlay que pour les fichiers venant de l'extérieur (pas du panneau lui-même)
      if (e.dataTransfer.types.includes('Files') && !isDraggingFromPanel) overlay.classList.add('show');
    });
    panel.addEventListener('dragleave', e => {
      if (!panel.contains(e.relatedTarget)) overlay.classList.remove('show');
    });
    panel.addEventListener('dragover', e => {
      // N'accepter le drop que pour les fichiers externes
      if (!isDraggingFromPanel) e.preventDefault();
    });
    panel.addEventListener('drop', e => {
      e.preventDefault(); overlay.classList.remove('show');
      // Ignorer si le drag vient du panneau lui-même (évite la duplication)
      if (isDraggingFromPanel) { isDraggingFromPanel = false; return; }
      const files = Array.from(e.dataTransfer.files).filter(isImageFile);
      if (!files.length) return;
      let done=0;
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = ev => {
          const item = { id:'lib_'+Date.now()+'_'+Math.random().toString(36).substr(2,5), name:file.name, src:ev.target.result };
          const folder = panelFolder==='all' ? 'image' : panelFolder;
          if (!library[folder]) library[folder] = [];
          library[folder].push(item);
          if (++done===files.length) { saveLibrary(); renderPanelLib(); toast(done+' image(s) ajoutée(s)'); }
        };
        reader.readAsDataURL(file);
      });
    });
  }

  // ── EXPORT ────────────────────────────────────────────────────────────────
  // Calcule le bounding box des éléments + 10% de marge, capture le canvas
 // ── FONCTIONS D'OPTIMISATION DE TAILLE DE FICHIER ──

  // Redimensionne proprement un canvas
  function scaleCanvas(originalCanvas, scale) {
    const scaledCanvas = document.createElement('canvas');
    scaledCanvas.width = Math.round(originalCanvas.width * scale);
    scaledCanvas.height = Math.round(originalCanvas.height * scale);
    const ctx = scaledCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(originalCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
    return scaledCanvas;
  }

  // Boucle pour atteindre le poids en Mo ciblé (minMB / maxMB)
  async function optimizeFileSize(sourceCanvas, format, minMB, maxMB) {
    const minBytes = minMB * 1024 * 1024;
    const maxBytes = maxMB * 1024 * 1024;
    
    let currentCanvas = sourceCanvas;
    let quality = format === 'image/jpeg' ? 0.9 : 1.0; 
    let scale = 1.0;
    
    let dataUrl = currentCanvas.toDataURL(format, quality);
    let sizeBytes = Math.round((dataUrl.length * 3) / 4);

    let attempts = 0;
    const maxAttempts = 6; // On limite à 6 essais pour ne pas bloquer l'interface

    while (attempts < maxAttempts) {
      if (sizeBytes >= minBytes && sizeBytes <= maxBytes) {
        break; // Le fichier est dans la bonne fourchette
      }

      if (sizeBytes > maxBytes) {
        // Trop lourd : on baisse la qualité (JPEG) ou on réduit la résolution
        if (format === 'image/jpeg' && quality > 0.4) {
          quality -= 0.15;
        } else {
          scale *= 0.75; 
          currentCanvas = scaleCanvas(sourceCanvas, scale);
        }
      } else if (sizeBytes < minBytes) {
        // Trop léger : on augmente la résolution.
        // SÉCURITÉ : On bloque si la largeur dépasse 8000px pour ne pas faire crasher l'onglet
        if (currentCanvas.width * 1.3 > 8000) break; 
        
        if (format === 'image/jpeg' && quality < 1.0) {
          quality += 0.05;
        } else {
          scale *= 1.3;
          currentCanvas = scaleCanvas(sourceCanvas, scale);
        }
      }

      dataUrl = currentCanvas.toDataURL(format, quality);
      sizeBytes = Math.round((dataUrl.length * 3) / 4);
      attempts++;
    }

    return dataUrl;
  }

  // ── FONCTIONS D'EXPORT MISES À JOUR ──

  function captureBoard(exportScale = 2) {
    return new Promise((resolve, reject) => {
      const canvasEl = document.getElementById('canvas');
      const els = canvasEl.querySelectorAll('.board-element');
      if (!els.length) { reject('Aucun élément sur le board'); return; }

      let minL=Infinity, minT=Infinity, maxR=-Infinity, maxB=-Infinity;
      els.forEach(el => {
        const l = parseFloat(el.style.left)||0;
        const t = parseFloat(el.style.top) ||0;
        const r = l + (el.offsetWidth  || parseFloat(el.style.width)  || 0);
        const b = t + (el.offsetHeight || parseFloat(el.style.height) || 0);
        if (l < minL) minL = l; if (t < minT) minT = t;
        if (r > maxR) maxR = r; if (b > maxB) maxB = b;
      });

      const contentW = maxR - minL;
      const contentH = maxB - minT;
      const margin = Math.round(Math.max(contentW, contentH) * 0.05);
      const cropX = minL - margin;
      const cropY = minT - margin;
      const cropW = contentW + margin * 2;
      const cropH = contentH + margin * 2;

      const wrapperBg = getComputedStyle(document.getElementById('canvas-wrapper')).backgroundColor || '#f4f4f6';
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.top = '0px';
      container.style.left = '-99999px';
      container.style.width = cropW + 'px';
      container.style.height = cropH + 'px';
      container.style.backgroundColor = wrapperBg;
      container.style.overflow = 'hidden';

      const ghostCanvas = canvasEl.cloneNode(true);
      ghostCanvas.style.position = 'absolute';
      ghostCanvas.style.top = '0px';
      ghostCanvas.style.left = '0px';
      ghostCanvas.style.transformOrigin = '0 0';
      ghostCanvas.style.transform = `translate(${-cropX}px, ${-cropY}px) scale(1)`;
      
      ghostCanvas.style.width = (cropX + cropW + margin) + 'px';
      ghostCanvas.style.height = (cropY + cropH + margin) + 'px';

      ghostCanvas.querySelectorAll('.selected, .multi-selected').forEach(el => {
        el.classList.remove('selected', 'multi-selected');
      });
      ghostCanvas.querySelectorAll('.element-toolbar, .resize-handle, .color-eyedropper, .video-play-hint').forEach(el => el.remove());

      ghostCanvas.querySelectorAll('video').forEach(vid => { vid.style.backgroundColor = '#111'; });

      container.appendChild(ghostCanvas);
      document.body.appendChild(container);

      setTimeout(() => {
        html2canvas(container, {
          scale: exportScale,
          useCORS: true,
          allowTaint: true,
          x: 0,
          y: 0,
          width: cropW,
          height: cropH,
          scrollX: 0,
          scrollY: 0,
          backgroundColor: wrapperBg,
          logging: false
        }).then(canvas => {
          container.remove();
          resolve({ canvas, w: cropW, h: cropH });
        }).catch(err => {
          container.remove();
          reject(err);
        });
      }, 150);
    });
  }

  function exportPNG() {
    if (typeof html2canvas === 'undefined') { toast('html2canvas non chargé'); return; }
    toast('Export PNG');
    
    // Capture brute en haute définition
    captureBoard(3).then(async ({ canvas }) => {
      // Optimisation: cible de 20 Mo à 40 Mo
      const optimizedDataUrl = await optimizeFileSize(canvas, 'image/png', 20, 40);
      
      const a = document.createElement('a');
      const b = boards.find(b => b.id === currentBoardId);
      a.download = (b ? b.name : 'moodboard') + '.png';
      a.href = optimizedDataUrl;
      a.click();
      toast('PNG exporté !');
    }).catch(msg => toast(msg || 'Erreur export PNG'));
  }

  function exportPDF(quality = 2) {
    if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
      toast('Librairies PDF non chargées'); return;
    }
    
    const isHR = quality > 1;
    const label = isHR ? '— Haute résolution' : '— Basse résolution';
    toast(`Export PDF ${label}`);
    
    // Pour éviter les artefacts gris en basse résolution, on capture toujours minimum à scale 2
    const baseScale = isHR ? 3 : 2;

    captureBoard(baseScale).then(async ({ canvas, w, h }) => {
      // Cibles en Mégaoctets
      const minMB = isHR ? 20 : 5;
      const maxMB = isHR ? 40 : 20;
      
      // Optimisation
      const optimizedDataUrl = await optimizeFileSize(canvas, 'image/jpeg', minMB, maxMB);

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({
        orientation: w > h ? 'landscape' : 'portrait',
        unit: 'px',
        format: [w, h]
      });
      
      // Les dimensions physiques (w, h) du PDF restent fixes, seule la résolution de l'image change
      pdf.addImage(optimizedDataUrl, 'JPEG', 0, 0, w, h);
      
      const board = boards.find(b => b.id === currentBoardId);
      pdf.save((board ? board.name : 'moodboard') + '.pdf');
      toast('PDF exporté !');
    }).catch(msg => toast(msg || 'Erreur export PDF'));
  }

  // ── MODALES ───────────────────────────────────────────────────────────────
  function openModal(id)    { document.getElementById(id).classList.remove('hidden'); }
  function closeModal(id)   { document.getElementById(id).classList.add('hidden'); }
  function closeAllModals() {
    ['color-modal','link-modal','video-modal','rename-modal','export-modal','create-board-modal'].forEach(closeModal);
  }
  function openExportModal()  { openModal('export-modal'); }
  function closeExportModal() { closeModal('export-modal'); }

  // ── TOAST ─────────────────────────────────────────────────────────────────
  let toastTimer;
  function toast(msg) {
    const t=document.getElementById('toast');
    t.textContent=msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>t.classList.remove('show'),2600);
  }

  // ── UTILITAIRES ───────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function tryParse(s) { try { return JSON.parse(s||'{}'); } catch(e) { return {}; } }

  // ── TOGGLE TOOLBAR GAUCHE ─────────────────────────────────────────────────
  function toggleToolbar() {
    document.getElementById('toolbar').classList.toggle('collapsed');
  }

async function syncLibraryFromStorage() {
    await loadBoardsFromStorage();
    if (currentBoardId) {
      loadLibraryForBoard(currentBoardId);
      if (libPanelOpen) renderPanelLib();
    }
  }

  // ── API PUBLIQUE ──────────────────────────────────────────────────────────
  return {
    init, goHome, openBoard, addBoard, deleteBoard, renameBoardPrompt, confirmRename, closeRenameModal,
    zoomIn, zoomOut, resetZoom, fitToScreen,
    addNote, addFile,
    addColorDirect, openColorPicker, closeColorModal, syncHex, syncColor, addColorElement,
    openLinkModal, closeLinkModal, addLinkElement,
    openVideoModal, closeVideoModal, switchVideoTab, addVideoURL, handleVideoUpload,
    toggleLibPanel, renderPanelLib, setPanelFolder, searchPanelLib,
    uploadImages, handleImageUpload, deletePanelLibItem, addNewLibFolder,
    handleFileUpload,
    deleteSelected, clearBoard, undo,
    duplicateEl, removeEl,
    ctxDuplicate, ctxDelete, ctxDownloadImage, ctxReplaceImage,
    ctxConnect, ctxAddCaption,
    exportPNG, exportPDF, openExportModal, closeExportModal,
    openVideoLightbox, closeVideoLightbox,
    fitElementsToScreen, togglePreviewMode,
    applyTextFont, applyTextSize: applyTextSizeDelta, applyTextSizeDelta, applyTextAlign,
    createBoard, closeCreateBoardModal, confirmCreateBoard,
    toolDragStart,
    toast,
    syncLibraryFromStorage
  }
}());

// ── EXTENSION MOODBOARD : rafraîchissement galerie ────────────────────────────
// Déclenché par background.js après injection d'une image dans le localStorage.
window.addEventListener('mb-image-injected', () => {
  if (typeof App !== 'undefined' && typeof App.syncLibraryFromStorage === 'function') {
    App.syncLibraryFromStorage();
  }
});

window.addEventListener('DOMContentLoaded', App.init);

// ── EXTENSION MOODBOARD : Écoute des messages du background ──────────────────
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'MB_IMAGE_INJECTED') {
      if (typeof App !== 'undefined' && typeof App.syncLibraryFromStorage === 'function') {
        App.syncLibraryFromStorage();
        App.toast("Image ajoutée au Moodboard !");
      }
    }
  });
}