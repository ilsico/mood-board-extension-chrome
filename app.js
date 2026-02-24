const App = (() => {

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
  // Rectangle de sélection
  let isSelecting     = false;
  let selRectStart    = { x:0, y:0 };
  let isDraggingFromPanel = false; // true quand un drag vient du panneau bibliothèque
  let _justGroupDragged  = false;  // true brièvement après un group drag pour bloquer le click post-mouseup
  let libSelectedIds = new Set();  // IDs des items sélectionnés dans le panneau lib
  let fileReplaceTarget = null;    // élément .board-element à remplacer lors du prochain handleFileUpload

  let multiResizeHandle = document.getElementById('multi-resize-handle') || document.createElement('div');
  multiResizeHandle.id = 'multi-resize-handle';
  document.querySelector('.canvas-wrapper').appendChild(multiResizeHandle);


  // Curseur "main ouverte" orange pour le mode pan (clic molette / espace)
  const HAND_CURSOR = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23ff3c00" width="24" height="24"><path d="M19 10h-1V7c0-1.1-.9-2-2-2s-2 .9-2 2v1h-1V5c0-1.1-.9-2-2-2s-2 .9-2 2v3H8V6.5c0-1.1-.9-2-2-2s-2 .9-2 2V15c0 3.86 3.14 7 7 7h3c4.97 0 9-4.03 9-9v-1c0-1.1-.9-2-2-2z"/></svg>') 12 12, grabbing`;

  // ── PERSISTANCE ──────────────────────────────────────────────────────────
  function saveBoards() {
    // localStorage — synchrone, accessible à app.js même hors extension
    try { localStorage.setItem('mb_boards', JSON.stringify(boards)); } catch(e) { /* quota dépassé — ignoré silencieusement */ }
    // chrome.storage.local — accessible depuis background.js (menu contextuel, injection)
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ mb_boards: boards }).catch(e => console.warn('chrome.storage.local:', e));
    }
  }
  // saveLibrary : sauvegarde la bibliothèque dans le board courant (pas de clé globale)
  function saveLibrary() {
    if (!currentBoardId) return;
    const b = boards.find(x => x.id === currentBoardId);
    if (b) { b.library = library; saveBoards(); }
  }
  // Charger la bibliothèque du board courant (appelé dans openBoard)
  function loadLibraryForBoard(boardId) {
    const b = boards.find(x => x.id === boardId);
    const raw = (b && b.library) ? b.library : {};
    library = raw;
    ['typographie','couleur','logo','image'].forEach(f => { if (!library[f]) library[f] = []; });
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrentBoard, 800); }

  // Miniatures — générées 3s après chaque saveCurrentBoard
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
        z: parseInt(el.style.zIndex)||100, data: el.dataset.savedata||''
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

  // ── CHARGEMENT INITIAL DES BOARDS ────────────────────────────────────────
  // Priorité : chrome.storage.local (source de vérité extension) → localStorage
  async function loadBoardsFromStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const result = await chrome.storage.local.get('mb_boards');
        if (Array.isArray(result.mb_boards) && result.mb_boards.length > 0) {
          boards = result.mb_boards;
          return;
        }
      } catch(e) { /* hors contexte extension */ }
    }
    const raw = localStorage.getItem('mb_boards');
    if (raw) { try { boards = JSON.parse(raw); } catch { boards = []; } }
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
      if (e.target.closest('.board-element[data-editing="1"]')) return; // clic sur la note en cours
      // Clic ailleurs → fermer en blurrant le div contenteditable actif
      const ta = document.querySelector('.board-element[data-editing="1"] div[contenteditable]');
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
    setupUIEvents();

    // Auto-save toutes les 2 minutes
    setInterval(() => {
      if (currentBoardId) saveCurrentBoard();
    }, 2 * 60 * 1000);

    // ── Sauvegarde avant fermeture de la page ────────────────────────────────
    // visibilitychange : déclenche une sauvegarde dès que l'onglet est masqué
    // (l'utilisateur bascule vers un autre onglet ou minimise — précède souvent la fermeture)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && currentBoardId) {
        clearTimeout(saveTimer);
        saveCurrentBoard();
      }
    });
    // pagehide : déclenché quand la page est sur le point d'être déchargée (fermeture, navigation)
    window.addEventListener('pagehide', () => {
      if (currentBoardId) { clearTimeout(saveTimer); saveCurrentBoard(); }
    });
    // beforeunload : dernière chance — sauvegarde synchrone (localStorage est synchrone)
    // Ne pas retourner de chaîne (évite la boîte de dialogue native du navigateur)
    window.addEventListener('beforeunload', () => {
      if (currentBoardId) { clearTimeout(saveTimer); saveCurrentBoard(); }
    });
  }

  // ── ÉVÉNEMENTS UI (remplace tous les handlers inline de index.html) ───────
  function setupUIEvents() {
    // Écran d'accueil
    document.getElementById('new-board-btn').addEventListener('click', () => createBoard());

    // Header board
    document.getElementById('back-btn').addEventListener('click', () => goHome());

    // Fit / Preview
    document.getElementById('fit-screen-btn').addEventListener('click', () => fitElementsToScreen());
    document.getElementById('preview-btn').addEventListener('click', () => togglePreviewMode());

    // Toolbar — outils (clic + drag)
    const toolNote  = document.getElementById('tool-note');
    const toolColor = document.getElementById('tool-color');
    const toolLink  = document.getElementById('tool-link');
    const toolFile  = document.getElementById('tool-file');
    toolNote .addEventListener('click',     () => addNote());
    toolNote .addEventListener('dragstart', e  => toolDragStart(e, 'note'));
    toolColor.addEventListener('click',     () => addColorDirect());
    toolColor.addEventListener('dragstart', e  => toolDragStart(e, 'color'));
    toolLink .addEventListener('click',     () => openLinkModal());
    toolLink .addEventListener('dragstart', e  => toolDragStart(e, 'link'));
    toolFile .addEventListener('click',     () => addFile());
    toolFile .addEventListener('dragstart', e  => toolDragStart(e, 'file'));
    document.getElementById('tool-export').addEventListener('click', () => openExportModal());

    // Panneau texte
    document.getElementById('tp-roman')       .addEventListener('click', () => applyTextFont('helvetica-roman'));
    document.getElementById('tp-bold')        .addEventListener('click', () => applyTextFont('helvetica-bold'));
    document.getElementById('text-size-minus').addEventListener('click', () => applyTextSizeDelta(-1));
    document.getElementById('text-size-plus') .addEventListener('click', () => applyTextSizeDelta(1));
    document.getElementById('ta-left')        .addEventListener('click', () => applyTextAlign('left'));
    document.getElementById('ta-center')      .addEventListener('click', () => applyTextAlign('center'));
    document.getElementById('ta-right')       .addEventListener('click', () => applyTextAlign('right'));
    document.getElementById('tp-list-ul')     .addEventListener('click', () => {
      if (!textEditTarget || textEditTarget.dataset.type !== 'note') return;
      const cd = textEditTarget.querySelector('div[contenteditable]');
      if (cd) { cd.focus(); }
      document.execCommand('insertUnorderedList');
      const isActive = !!textEditTarget.querySelector('ul');
      document.getElementById('tp-list-ul').classList.toggle('active', isActive);
      document.getElementById('tp-list-ol').classList.remove('active');
      scheduleSave();
    });
    document.getElementById('tp-list-ol')     .addEventListener('click', () => {
      if (!textEditTarget || textEditTarget.dataset.type !== 'note') return;
      const cd = textEditTarget.querySelector('div[contenteditable]');
      if (cd) { cd.focus(); }
      document.execCommand('insertOrderedList');
      const isActive = !!textEditTarget.querySelector('ol');
      document.getElementById('tp-list-ol').classList.toggle('active', isActive);
      document.getElementById('tp-list-ul').classList.remove('active');
      scheduleSave();
    });

    // Panneau bibliothèque
    document.getElementById('lib-toggle-btn').addEventListener('click', () => toggleLibPanel());
    document.getElementById('lib-add-btn')   .addEventListener('click', () => uploadImages());
    document.querySelectorAll('.lib-folder-chip').forEach(btn => {
      btn.addEventListener('click', () => setPanelFolder(btn.dataset.folder, btn));
      btn.addEventListener('dragover', e => {
        if (isDraggingFromPanel) { e.preventDefault(); btn.classList.add('drag-over'); }
      });
      btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
      btn.addEventListener('drop', e => {
        btn.classList.remove('drag-over');
        if (!isDraggingFromPanel) return;
        e.preventDefault(); e.stopPropagation();
        const targetFolder = btn.dataset.folder;
        if (targetFolder === 'all' || !libSelectedIds.size) return;
        libSelectedIds.forEach(id => {
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
        saveLibrary(); renderPanelLib();
      });
    });
    document.getElementById('lib-panel-search').addEventListener('input', e => searchPanelLib(e.target.value));

    // Clic dans le vide du grid → désélectionner tous les items lib
    document.getElementById('lib-panel-grid').addEventListener('click', e => {
      if (!e.target.closest('.lib-panel-item')) {
        libSelectedIds.clear();
        document.querySelectorAll('.lib-panel-item.selected-lib-item').forEach(d => d.classList.remove('selected-lib-item'));
      }
    });

    // Inputs fichiers cachés
    document.getElementById('file-input-images').addEventListener('change', e => handleImageUpload(e));
    document.getElementById('file-input-file')  .addEventListener('change', e => handleFileUpload(e));
    document.getElementById('file-input-video') .addEventListener('change', e => handleVideoUpload(e));

    // Modale couleur
    document.getElementById('close-color-modal') .addEventListener('click', () => closeColorModal());
    document.getElementById('color-picker-input').addEventListener('input',  e => syncHex(e.target.value));
    document.getElementById('hex-input')         .addEventListener('input',  e => syncColor(e.target.value));
    document.getElementById('add-color-btn')     .addEventListener('click', () => addColorElement());

    // Modale lien
    document.getElementById('close-link-modal').addEventListener('click', () => closeLinkModal());
    document.getElementById('submit-link')     .addEventListener('click', () => addLinkElement());

    // Modale vidéo
    document.getElementById('close-video-modal') .addEventListener('click', () => closeVideoModal());
    document.getElementById('vt-url')            .addEventListener('click', () => switchVideoTab('url'));
    document.getElementById('vt-local')          .addEventListener('click', () => switchVideoTab('local'));
    document.getElementById('submit-video-url')  .addEventListener('click', () => addVideoURL());
    document.getElementById('submit-video-local').addEventListener('click', () => document.getElementById('file-input-video').click());

    // Modale rename
    document.getElementById('close-rename-modal').addEventListener('click', () => closeRenameModal());
    document.getElementById('rename-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') confirmRename();
    });
    document.getElementById('submit-rename').addEventListener('click', () => confirmRename());

    // Modale création board
    document.getElementById('close-create-board-modal').addEventListener('click', () => closeCreateBoardModal());
    document.getElementById('create-board-input').addEventListener('keydown', e => {
      if (e.key === 'Enter')  confirmCreateBoard();
      if (e.key === 'Escape') closeCreateBoardModal();
    });
    document.getElementById('submit-create-board').addEventListener('click', () => confirmCreateBoard());

    // Modale export
    document.getElementById('close-export-modal') .addEventListener('click', () => closeExportModal());
    document.getElementById('export-png-btn')     .addEventListener('click', () => { exportPNG();    closeExportModal(); });
    document.getElementById('export-pdf-hr-btn')  .addEventListener('click', () => { exportPDF(2);  closeExportModal(); });
    document.getElementById('export-pdf-lr-btn')  .addEventListener('click', () => { exportPDF(1);  closeExportModal(); });

    // Menu contextuel
    document.getElementById('ctx-duplicate')   .addEventListener('click', () => ctxDuplicate());
    document.getElementById('ctx-img-download').addEventListener('click', () => ctxDownloadImage());
    document.getElementById('ctx-img-replace') .addEventListener('click', () => ctxReplaceImage());
    document.getElementById('ctx-img-caption') .addEventListener('click', () => ctxAddCaption());
    document.getElementById('ctx-connect')     .addEventListener('click', () => ctxConnect());
    document.getElementById('ctx-delete')      .addEventListener('click', () => ctxDelete());

    // Lightbox vidéo
    document.getElementById('vlb-close-btn').addEventListener('click', () => closeVideoLightbox());
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
          <button class="board-action-btn btn-rename"><img src="renommer.png" style="width:14px;height:14px;pointer-events:none;"></button>
          <button class="board-action-btn delete btn-delete"><img src="supprimer.png" style="width:14px;height:14px;pointer-events:none;"></button>
        </div>`;
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
          curX = lerp(curX, targetX, 0.12);
          curY = lerp(curY, targetY, 0.12);
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
        function onUp(_ev) {
          if (moved) {
            b.x = Math.round(curX); b.y = Math.round(curY);
            saveBoards();
          }
          if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        }
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });

      // Clic simple → sélectionner la carte (affiche les actions)
      card.addEventListener('click', e => {
        if (e.target.closest('.board-action-btn')) return;
        document.querySelectorAll('.board-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
      });
      // Double-clic → ouvrir le board
      card.addEventListener('dblclick', e => {
        if (e.target.closest('.board-action-btn')) return;
        openBoard(b.id);
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

    // Clic dans le vide → désélectionner toutes les cartes
    if (!container._clickDeselectHome) {
      container._clickDeselectHome = true;
      container.addEventListener('click', e => {
        if (!e.target.closest('.board-card')) {
          document.querySelectorAll('.board-card.selected').forEach(c => c.classList.remove('selected'));
        }
      });
    }

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

    // ── Pinch tactile : copie exacte du système board ─────────────────────
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
      let minL=Infinity, minT=Infinity, maxR=-Infinity, maxB=-Infinity;
      els.forEach(el => {
        const l=parseFloat(el.style.left)||0, t=parseFloat(el.style.top)||0;
        minL=Math.min(minL,l); minT=Math.min(minT,t);
        maxR=Math.max(maxR,l+el.offsetWidth); maxB=Math.max(maxB,t+el.offsetHeight);
      });
      const m=40, cropX=minL-m, cropY=minT-m, cropW=maxR-minL+m*2, cropH=maxB-minT+m*2;

      // Cloner le canvas dans un conteneur caché à scale(1) — le DOM visible n'est pas touché
      const ghost = canvasEl.cloneNode(true);
      ghost.style.position = 'fixed';
      ghost.style.left = '-99999px';
      ghost.style.top  = '0px';
      ghost.style.transform = 'translate(0px,0px) scale(1)';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '-1';
      document.body.appendChild(ghost);
      // Forcer le reflow
      ghost.getBoundingClientRect();

      html2canvas(ghost, {
        scale: 0.3, useCORS: true, allowTaint: true,
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
    if (!val || val.length > 45) return;
    const b = boards.find(b => b.id === renamingBoardId);
    if (b) { b.name = val; saveBoards(); renderHome(); }
    if (currentBoardId === renamingBoardId)
      document.getElementById('board-title-display').textContent = val;
    closeModal('rename-modal');
  }
  function closeRenameModal() { closeModal('rename-modal'); }

  // ── CANVAS / ZOOM / PAN ──────────────────────────────────────────────────
  function applyTransform() {
    // Bloquer le pan uniquement au zoom minimum (tout est visible, rien à déplacer)
    if (zoomLevel <= 0.15) {
      const els = document.querySelectorAll('#canvas .board-element');
      if (els.length) {
        const cw = document.querySelector('.canvas-wrapper') || document.getElementById('canvas-wrapper');
        const vw = cw ? cw.offsetWidth  : window.innerWidth;
        const vh = cw ? cw.offsetHeight : window.innerHeight;
        let minL=Infinity, minT=Infinity, maxR=-Infinity, maxB=-Infinity;
        els.forEach(el => {
          const l = parseFloat(el.style.left)||0;
          const t = parseFloat(el.style.top) ||0;
          minL=Math.min(minL,l); minT=Math.min(minT,t);
          maxR=Math.max(maxR,l+el.offsetWidth);
          maxB=Math.max(maxB,t+el.offsetHeight);
        });
        const marginX = (maxR - minL) * 0.1;
        const marginY = (maxB - minT) * 0.1;
        const panXMax = -(minL - marginX) * zoomLevel;
        const panXMin = vw - (maxR + marginX) * zoomLevel;
        const panYMax = -(minT - marginY) * zoomLevel;
        const panYMin = vh - (maxB + marginY) * zoomLevel;
        panX = (panXMin > panXMax) ? (panXMin + panXMax) / 2 : Math.max(panXMin, Math.min(panXMax, panX));
        panY = (panYMin > panYMax) ? (panYMin + panYMax) / 2 : Math.max(panYMin, Math.min(panYMax, panY));
      }
    }
    document.getElementById('canvas').style.transform = `translate(${panX}px,${panY}px) scale(${zoomLevel})`;
    // Compenser le zoom sur les poignées de resize pour qu'elles restent constantes à l'écran
    const invScale = 1 / zoomLevel;
    document.querySelectorAll('#canvas .resize-handle').forEach(h => {
      h.style.transform = `scale(${invScale})`;
    });
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

    // Alt+molette = zoom, molette seule = pan
    wrapper.addEventListener('wheel', e => {
      e.preventDefault();
      if (isPanning) return;
      if (e.altKey) {
        // Zoom centré sur la position du curseur
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        const newZ  = Math.min(Math.max(zoomLevel+delta,0.15),4);
        const rect  = wrapper.getBoundingClientRect();
        const mx = e.clientX-rect.left, my = e.clientY-rect.top;
        panX = mx-(mx-panX)*(newZ/zoomLevel);
        panY = my-(my-panY)*(newZ/zoomLevel);
        zoomLevel = newZ;
        applyTransform(); updateZoomDisplay();
      } else {
        // Navigation (pan)
        panX -= e.deltaX;
        panY -= e.deltaY;
        applyTransform();
      }
    }, { passive:false });

    // ── PINCH TO ZOOM + PAN TACTILE (Touch Events — le plus fiable) ─────────
    if (!pinchTouchSetupDone) {
      pinchTouchSetupDone = true;

      let pinchStartDist = 0, pinchStartZoom = 1, pinchMidX = 0, pinchMidY = 0;
      let touchPanStartX = null, touchPanStartY = null;
      let touchPanId = null; // identifier du doigt de pan

      // Listeners sur canvas-wrapper directement (pas sur document)
      // On les réattache à chaque openBoard via window._reattachPinch()
      function attachPinchListeners(wrapEl, canvasEl) {
        // Supprimer les anciens si existants
        if (wrapEl._pinchTS) wrapEl.removeEventListener('touchstart',  wrapEl._pinchTS, { capture: true });
        if (wrapEl._pinchTM) wrapEl.removeEventListener('touchmove',   wrapEl._pinchTM, { capture: true });
        if (wrapEl._pinchTE) wrapEl.removeEventListener('touchend',    wrapEl._pinchTE, { capture: true });

        pinchStartDist = 0; touchPanId = null;

        wrapEl._pinchTS = function(e) {
          // Laisser passer les inputs/textareas
          if (e.target && (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')) return;
          e.preventDefault();
          if (e.touches.length >= 2) {
            touchPanId = null;
            const t1 = e.touches[0], t2 = e.touches[1];
            pinchStartDist = Math.hypot(t2.clientX-t1.clientX, t2.clientY-t1.clientY);
            pinchStartZoom = zoomLevel;
            pinchMidX = (t1.clientX+t2.clientX)/2;
            pinchMidY = (t1.clientY+t2.clientY)/2;
          } else if (e.touches.length === 1) {
            pinchStartDist = 0;
            const t = e.touches[0];
            const hit = document.elementFromPoint(t.clientX, t.clientY);
            if (hit === canvasEl || hit === wrapEl) {
              touchPanId = t.identifier;
              touchPanStartX = t.clientX - panX;
              touchPanStartY = t.clientY - panY;
            } else { touchPanId = null; }
          }
        };
        wrapEl._pinchTM = function(e) {
          if (e.target && (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')) return;
          e.preventDefault();
          if (e.touches.length >= 2 && pinchStartDist > 0) {
            const t1 = e.touches[0], t2 = e.touches[1];
            const dist = Math.hypot(t2.clientX-t1.clientX, t2.clientY-t1.clientY);
            const scale = dist / pinchStartDist;
            const newZ = Math.min(Math.max(pinchStartZoom * scale, 0.15), 4);
            const rect = wrapEl.getBoundingClientRect();
            const mx = pinchMidX - rect.left, my = pinchMidY - rect.top;
            panX = mx - (mx - panX) * (newZ / zoomLevel);
            panY = my - (my - panY) * (newZ / zoomLevel);
            zoomLevel = newZ;
            applyTransform(); updateZoomDisplay();
          } else if (e.touches.length === 1 && touchPanId !== null) {
            const t = [...e.touches].find(x => x.identifier === touchPanId);
            if (t) { panX = t.clientX - touchPanStartX; panY = t.clientY - touchPanStartY; applyTransform(); }
          }
        };
        wrapEl._pinchTE = function(e) {
          if (e.touches.length < 2) pinchStartDist = 0;
          if (e.touches.length === 0) touchPanId = null;
        };

        wrapEl.addEventListener('touchstart',  wrapEl._pinchTS, { passive: false, capture: true });
        wrapEl.addEventListener('touchmove',   wrapEl._pinchTM, { passive: false, capture: true });
        wrapEl.addEventListener('touchend',    wrapEl._pinchTE, { passive: true,  capture: true });
      }

      // Attacher immédiatement (pour si on est déjà sur le board)
      attachPinchListeners(wrapper, canvas);
      // Exposer pour que openBoard puisse réattacher après display:flex
      window._reattachPinch = () => attachPinchListeners(
        document.getElementById('canvas-wrapper'),
        document.getElementById('canvas')
      );

    } // end pinchTouchSetupDone guard

    // Clic molette (button 1) sur n'importe quelle zone = pan
    wrapper.addEventListener('mousedown', e => {
      if (e.button === 1) {
        e.preventDefault();
        isPanning = true;
        panStart = { x: e.clientX-panX, y: e.clientY-panY };
        wrapper.style.cursor = HAND_CURSOR;
        return;
      }

      // Mousedown sur canvas vide : pan OU rectangle de sélection
      if (e.target !== canvas && e.target !== wrapper) return;
      if (e.button !== 0) return;

      if (isPanningMode) {
        // Mode pan (espace enfoncé)
        isPanning = true;
        panStart = { x: e.clientX-panX, y: e.clientY-panY };
        wrapper.style.cursor = HAND_CURSOR;
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
          createNoteElement('', x - 150, y - 70, 300);
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
      // Plusieurs images depuis le panneau (drag multi-sélection)
      if (src && src.startsWith('[')) {
        try {
          const srcs = JSON.parse(src);
          const rect = wrapper.getBoundingClientRect();
          const dropX = (e.clientX-rect.left-panX)/zoomLevel;
          const dropY = (e.clientY-rect.top -panY)/zoomLevel;
          srcs.forEach((imgSrc, i) => {
            const tmpImg = new Image();
            tmpImg.onload = () => {
              const nw = tmpImg.naturalWidth  || 220;
              const nh = tmpImg.naturalHeight || 170;
              const viewW = wrapper.clientWidth  / zoomLevel;
              const viewH = wrapper.clientHeight / zoomLevel;
              let fw, fh;
              if (nh > nw) { fh = viewH * 0.25; fw = (nw/nh) * fh; }
              else         { fw = viewW * 0.25; fh = (nh/nw) * fw; }
              createImageElement(imgSrc, dropX - fw/2 + i*30, dropY - fh/2 + i*30, Math.round(fw), Math.round(fh));
              pushHistory(); scheduleSave();
            };
            tmpImg.onerror = () => {
              createImageElement(imgSrc, dropX - 110 + i*30, dropY - 85 + i*30, 220, 170);
              pushHistory(); scheduleSave();
            };
            tmpImg.src = imgSrc;
          });
          return;
        } catch(_) { /* JSON invalide, continuer */ }
      }

      if (src && src.startsWith('data:')) {
        const rect = wrapper.getBoundingClientRect();
        const tmpImg = new Image();
        tmpImg.onload = () => {
          const nw = tmpImg.naturalWidth  || 220;
          const nh = tmpImg.naturalHeight || 170;
          const viewW = wrapper.clientWidth  / zoomLevel;
          const viewH = wrapper.clientHeight / zoomLevel;
          let fw, fh;
          if (nh > nw) { fh = viewH * 0.25; fw = (nw/nh) * fh; }
          else         { fw = viewW * 0.25; fh = (nh/nw) * fw; }
          const x = (e.clientX-rect.left-panX)/zoomLevel - fw/2;
          const y = (e.clientY-rect.top -panY)/zoomLevel - fh/2;
          createImageElement(src, x, y, Math.round(fw), Math.round(fh));
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
        Array.from(e.dataTransfer.files).filter(isImageFile).forEach((file,i)=>{
          const reader = new FileReader();
          reader.onload = ev => {
            const src = ev.target.result;
            const tmpImg = new Image();
            tmpImg.onload = () => {
              const nw = tmpImg.naturalWidth  || 220;
              const nh = tmpImg.naturalHeight || 170;
              const viewW = wrapper.clientWidth  / zoomLevel;
              const viewH = wrapper.clientHeight / zoomLevel;
              let fw, fh;
              if (nh > nw) { fh = viewH * 0.25; fw = (nw/nh) * fh; }
              else         { fw = viewW * 0.25; fh = (nh/nw) * fw; }
              const x = (e.clientX-rect.left-panX)/zoomLevel - fw/2 + i*30;
              const y = (e.clientY-rect.top -panY)/zoomLevel - fh/2 + i*30;
              createImageElement(src, x, y, Math.round(fw), Math.round(fh));
              pushHistory(); scheduleSave();
            };
            tmpImg.onerror = () => {
              const x = (e.clientX-rect.left-panX)/zoomLevel-110+i*30;
              const y = (e.clientY-rect.top -panY)/zoomLevel-85 +i*30;
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
        wrapper.style.cursor = HAND_CURSOR;
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
    document.addEventListener('keydown', e => {
      if (e.key === 'Alt') { e.preventDefault(); isAltDown = true; }
      if (e.key === 'Control') ctrlSnap = true;
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
    // data-editing : flag posé par les notes (div contenteditable en mode édition)
    const editingNote = !!document.querySelector('.board-element[data-editing="1"]');
    return inInput(active) || editingNote;
  }

  // ── HISTORIQUE ───────────────────────────────────────────────────────────
  function pushHistory() {
    // Synchroniser les valeurs des hex inputs couleur (innerHTML ne capture pas .value dynamique)
    document.querySelectorAll('#canvas .board-element[data-type="color"] .color-hex-input').forEach(inp => {
      if (inp.value) inp.setAttribute('value', inp.value);
    });
    // Synchroniser dataset.savedata des notes contenteditable (innerHTML est dans le DOM)
    document.querySelectorAll('#canvas .board-element[data-type="note"] div[contenteditable]').forEach(ta => {
      const el = ta.closest('.board-element');
      if (el) el.dataset.savedata = ta.innerHTML;
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
    const ta   = el.querySelector('div[contenteditable]');
    if (!wrap || !ta) return;
    // Restaurer le contenu HTML depuis dataset.savedata si nécessaire
    if (el.dataset.savedata && ta.innerHTML !== el.dataset.savedata) {
      ta.innerHTML = el.dataset.savedata;
    }
    // Assurer que l'élément est en mode auto-height
    if (!el.classList.contains('note-clipped')) {
      el.style.height = 'auto';
    }
    let _noteValueOnFocus = '';
    function activateNoteEdit(e) {
      e.stopPropagation(); e.preventDefault();
      ta.contentEditable = 'true';
      el.dataset.editing = '1';
      _noteValueOnFocus = ta.innerHTML;
      ta.focus();
      const range = document.createRange();
      range.selectNodeContents(ta);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      showTextEditPanel(el);
    }
    let _wasSelectedOnNoteMousedown = false;
    el.addEventListener('mousedown', () => {
      _wasSelectedOnNoteMousedown = el.classList.contains('selected');
    }, true);
    wrap.addEventListener('click', e => {
      if (_wasSelectedOnNoteMousedown && ta.contentEditable !== 'true' && !e.target.closest('.element-toolbar')) {
        activateNoteEdit(e);
      }
      _wasSelectedOnNoteMousedown = false;
    });
    ta.addEventListener('mousedown', e => {
      if (ta.contentEditable === 'true') e.stopPropagation();
    });
    ta.addEventListener('input', () => {
      el.dataset.savedata = ta.innerHTML;
      if (!el.classList.contains('note-clipped')) {
        el.style.height = 'auto';
      }
      scheduleSave();
    });
    ta.addEventListener('blur', e => {
      const panel = document.getElementById('text-edit-panel');
      const goingToPanel = (panel && e.relatedTarget && panel.contains(e.relatedTarget));
      if (goingToPanel || window._textPanelKeepOpen) return;
      ta.contentEditable = 'false';
      delete el.dataset.editing;
      hideTextEditPanel();
      const plainText = ta.innerHTML.replace(/<[^>]*>/g, '').trim();
      if (!plainText) {
        el.remove();
        if (selectedEl === el) selectedEl = null;
        multiSelected.delete(el);
        pushHistory(); scheduleSave();
      } else if (ta.innerHTML !== _noteValueOnFocus) {
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

  function deleteSelected() {
    let count = 0;
    // Supprimer la multi-sélection
    multiSelected.forEach(el => { removeConnectionsForEl(el); el.remove(); count++; });
    multiSelected.clear();
    if (selectedEl) { removeConnectionsForEl(selectedEl); selectedEl.remove(); selectedEl=null; count++; }
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
    const group = [...multiSelected];
    if (group.length < 2) { handle.style.display = 'none'; return; }

    // Calculer le bounding box global de tous les éléments sélectionnés
    const wrapperRect = document.getElementById('canvas-wrapper').getBoundingClientRect();
    let maxR = -Infinity, maxB = -Infinity;
    group.forEach(el => {
      const r = el.getBoundingClientRect();
      const right  = r.right  - wrapperRect.left;
      const bottom = r.bottom - wrapperRect.top;
      if (right  > maxR) maxR = right;
      if (bottom > maxB) maxB = bottom;
    });

    // Handle au coin bas-droite du bounding box global
    handle.style.display = 'block';
    handle.style.left = maxR + 'px';
    handle.style.top  = maxB + 'px';
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
      <button class="el-tool-btn" onclick="App.duplicateEl(this)" title="Dupliquer"><img src="dupliquer.png"></button>
      <button class="el-tool-btn danger" onclick="App.removeEl(this)" title="Supprimer"><img src="supprimer.png"></button>`;
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
      e.stopPropagation(); e.preventDefault();

      // Shift+clic = multi-sélection
      if (e.shiftKey) { selectEl(el, true); return; }

      // Si l'élément fait partie de la multi-sélection, déplacer tout le groupe
      if (multiSelected.has(el) && multiSelected.size > 1) {
        startGroupDrag(e, multiSelected);
        return;
      }

      selectEl(el);
      const canvasRect = document.getElementById('canvas').getBoundingClientRect();
      const startMX = (e.clientX-canvasRect.left)/zoomLevel;
      const startMY = (e.clientY-canvasRect.top) /zoomLevel;

      // Position initiale de l'élément au moment du mousedown
      const origLeft = parseFloat(el.style.left)||0;
      const origTop  = parseFloat(el.style.top) ||0;

      // dragEl = l'élément qu'on déplace (original ou copie si Alt)
      let dragEl = el;
      let duplicated = false;
      const excludeSet = new Set([el]);
      let startLeft = parseFloat(dragEl.style.left)||0;
      let startTop  = parseFloat(dragEl.style.top) ||0;

      // Crée une copie et place l'original à sa position initiale
      function doDuplicate() {
        if (duplicated) return;
        duplicated = true;
        // Cloner depuis l'original (el), pas depuis dragEl qui a bougé
        const copy = el.cloneNode(true);
        copy.dataset.id = 'el_'+Date.now()+'_'+Math.random().toString(36).substr(2,5);
        copy.style.zIndex = ++nextZ;
        // La copie part de la position COURANTE de l'élément (où la souris l'a amené)
        copy.style.left = dragEl.style.left;
        copy.style.top  = dragEl.style.top;
        // L'original revient à sa position initiale (avant le drag)
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
        // Recaler startLeft/startTop sur la position courante de la copie
        startLeft = parseFloat(copy.style.left)||0;
        startTop  = parseFloat(copy.style.top) ||0;
        // Recaler startMX/startMY sur la position souris actuelle (sera géré via startMX/startMY globaux)
      }

      // Si Alt déjà enfoncé au mousedown, dupliquer immédiatement (copie = original, original reste)
      if (isAltDown) doDuplicate();
      let currentStartMX = startMX;
      let currentStartMY = startMY;
      let moved = false;

      // Lag/Tilt : positions cibles (souris) et positions courantes (interpolées)
      let targetX = startLeft, targetY = startTop;
      let curX = startLeft, curY = startTop;
      let prevX = startLeft; // pour calculer la vélocité horizontale
      let rafId = null;
      let dragActive = true;
      let shiftAxisX = null; // null = pas encore verrouillé, 'h' ou 'v'

      const lerp = (a, b, t) => a + (b - a) * t;

      function dragRAF() {
        if (!dragActive) return;
        const lf = Math.min(1, 0.12 / Math.sqrt(zoomLevel));
        curX = lerp(curX, targetX, lf);
        curY = lerp(curY, targetY, lf);

        dragEl.style.left = curX + 'px';
        dragEl.style.top  = curY + 'px';

        // Snap uniquement si Ctrl enfoncé
        if (ctrlSnap) { applySnap(dragEl, excludeSet); } else { clearSnapGuides(); }
        updateConnectionsForEl(dragEl);

        // Déplacer les captions attachées en temps réel
        const _elId = dragEl.dataset.id;
        if (_elId) {
          document.querySelectorAll(`.el-caption[data-parent-id="${_elId}"]`).forEach(cap => {
            cap.style.left = curX + 'px';
            cap.style.top  = (curY + dragEl.offsetHeight) + 'px';
          });
        }

        rafId = requestAnimationFrame(dragRAF);
      }

      const onMove = ev => {
        // Alt pressé → créer une copie et déplacer la copie
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
        if (moved || duplicated) { pushHistory(); scheduleSave(); }
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      // Démarrer la boucle RAF
      rafId = requestAnimationFrame(dragRAF);
    });

    el.addEventListener('click', e => {
      e.stopPropagation();
      if (_justGroupDragged) return; // conserver la multi-sélection après un group drag
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
    function groupDragRAF() {
      if (!groupDragActive) return;
      const lerpFactor = Math.min(1, 0.12 / Math.sqrt(zoomLevel));
      curDX += (targetDX - curDX) * lerpFactor;
      curDY += (targetDY - curDY) * lerpFactor;
      activeGroup.forEach(el => {
        const s = starts.get(el);
        if (!s) return;
        el.style.left = (s.left + curDX) + 'px';
        el.style.top  = (s.top  + curDY) + 'px';
      });
      activeGroup.forEach(el => updateConnectionsForEl(el));
      updateMultiResizeHandle();
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

    // Pour les notes : comparer hauteur drag vs hauteur du contenu
    if (resizeEl.dataset.type === 'note') {
      const ta = resizeEl.querySelector('div[contenteditable]');
      if (ta) {
        const contentH = ta.scrollHeight + 28; // 28 = padding vertical .el-note
        if (fh < contentH) {
          // L'utilisateur réduit en dessous du contenu → mode clippé + masque de fondu
          resizeEl.style.height = fh + 'px';
          resizeEl.classList.add('note-clipped');
        } else {
          // L'utilisateur agrandit au-dessus du contenu → retour auto-height
          resizeEl.style.height = 'auto';
          resizeEl.classList.remove('note-clipped');
        }
      }
    }

    // Mettre à jour les connexions pendant le resize
    updateConnectionsForEl(resizeEl);

    // Synchroniser les captions attachées lors du resize
    const _rElId = resizeEl.dataset.id;
    if (_rElId) {
      document.querySelectorAll(`.el-caption[data-parent-id="${_rElId}"]`).forEach(cap => {
        cap.style.width = resizeEl.style.width;
        cap.style.left  = resizeEl.style.left;
        cap.style.top   = (parseFloat(resizeEl.style.top) + resizeEl.offsetHeight) + 'px';
      });
    }
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
      document.getElementById('canvas').appendChild(cap);
      return cap;
    }
    if (el && s.z) el.style.zIndex = s.z;
    if (el && s.id) el.dataset.id = s.id;
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
      el.dataset.savedata = src;
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
    createNoteElement('', c.x-150, c.y-70, 300);
    pushHistory(); scheduleSave();
  }
  function createNoteElement(content, x, y, w, h) {
    w = w || 300;
    // L'élément note utilise la hauteur automatique (min-height CSS), pas une hauteur fixe
    const el = makeElement('note', x||100, y||100, w, null);
    el.style.height = 'auto';
    el.style.minHeight = '139.5px';
    el.dataset.savedata = content || '';
    const wrap = document.createElement('div');
    wrap.className = 'el-note';
    // Div contenteditable (remplace textarea)
    const ta = document.createElement('div');
    ta.className = 'note-content';
    ta.contentEditable = 'false'; // non-interactif par défaut (1 clic = déplacer)
    ta.innerHTML = content || '';
    ta.addEventListener('input', () => {
      el.dataset.savedata = ta.innerHTML;
      // Auto-height si pas en mode clippé
      if (!el.classList.contains('note-clipped')) {
        el.style.height = 'auto';
      }
      scheduleSave();
    });
    // Valeur HTML au moment de l'entrée en édition — pour détecter un changement au blur
    let _noteValueOnFocus = '';
    function activateNoteEdit(e) {
      e.stopPropagation();
      e.preventDefault();
      ta.contentEditable = 'true';
      el.dataset.editing = '1'; // signal pour isTyping() — bloque Ctrl+Z
      _noteValueOnFocus = ta.innerHTML;
      ta.focus();
      // Placer le curseur à la fin
      const range = document.createRange();
      range.selectNodeContents(ta);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      showTextEditPanel(el);
    }
    // Clic unique quand déjà sélectionné → activer l'édition
    let _wasSelectedOnNoteMousedown = false;
    el.addEventListener('mousedown', () => {
      _wasSelectedOnNoteMousedown = el.classList.contains('selected');
    }, true);
    wrap.addEventListener('click', e => {
      if (_wasSelectedOnNoteMousedown && ta.contentEditable !== 'true' && !e.target.closest('.element-toolbar')) {
        activateNoteEdit(e);
      }
      _wasSelectedOnNoteMousedown = false;
    });
    // Clic dans le div si déjà en édition → garder le focus (stop propagation)
    ta.addEventListener('mousedown', e => {
      if (ta.contentEditable === 'true') e.stopPropagation();
    });
    // Quand le div perd le focus : revenir en mode déplacement
    ta.addEventListener('blur', e => {
      const panel = document.getElementById('text-edit-panel');
      const goingToPanel = (panel && e.relatedTarget && panel.contains(e.relatedTarget));
      if (goingToPanel || window._textPanelKeepOpen) return;
      ta.contentEditable = 'false';
      delete el.dataset.editing;
      hideTextEditPanel();
      const plainText = ta.innerHTML.replace(/<[^>]*>/g, '').trim();
      if (!plainText) {
        el.remove();
        if (selectedEl === el) selectedEl = null;
        multiSelected.delete(el);
        pushHistory(); scheduleSave();
      } else if (ta.innerHTML !== _noteValueOnFocus) {
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
    eyeBtn.innerHTML = '<img src="pipette.png" style="width:14px;height:14px;object-fit:contain;display:block;">';
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
    if (isEmbed) {
      const iframe = document.createElement('iframe');
      iframe.src=src; iframe.allowFullscreen=true;
      iframe.setAttribute('allow','accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope');
      iframe.style.pointerEvents='none';
      wrap.appendChild(iframe);
    } else {
      const v = document.createElement('video'); v.src=src; v.controls=true;
      wrap.appendChild(v);
    }
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
    // Sauvegarder le src (base64 ou objectURL) dans savedata pour la persistance
    el.dataset.savedata = JSON.stringify({name, size, icon:'video', isVideo:true, src: videoSrc});
    const wrap = document.createElement('div');
    wrap.className = 'el-file-video';
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.muted = true;
    if (videoSrc) {
      vid.src = videoSrc;
      // Aller sur la première frame pour l'aperçu
      vid.addEventListener('loadedmetadata', () => { vid.currentTime = 0.5; }, { once: true });
    }
    const hint = document.createElement('div');
    hint.className = 'video-play-hint';
    // Le triangle est rendu via ::after en CSS pur (centré optiquement)
    wrap.appendChild(vid);
    wrap.appendChild(hint);
    wrap.addEventListener('dblclick', e => {
      e.stopPropagation();
      // Récupérer le src depuis savedata (toujours à jour)
      const d = (() => { try { return JSON.parse(el.dataset.savedata||'{}'); } catch(_){return {};} })();
      const src = d.src || videoSrc;
      if (src) { openVideoLightbox(src); return; }
      // Pas de src : proposer de remplacer
      fileReplaceTarget = el;
      document.getElementById('file-input-file').click();
    });
    el.insertBefore(wrap, el.querySelector('.element-toolbar'));
    el._fileEventsAttached = true;
    return el;
  }

  function createFileElement(name, size, icon, x, y) {
    const el = makeElement('file', x||100, y||100, 260, 76);
    el.dataset.savedata = JSON.stringify({name,size,icon});
    const wrap = document.createElement('div');
    wrap.className = 'el-file';
    // Icône : utiliser fichier.png si icon==='file' / '📎' / inconnu, sinon emoji spécifique
    const iconHtml = (icon === 'file' || icon === '📎' || !icon)
      ? `<div class="file-icon"><img src="fichier.png" alt=""></div>`
      : `<div class="file-icon">${icon}</div>`;
    wrap.innerHTML = `${iconHtml}<div class="file-info"><div class="file-name">${escHtml(name)}</div><div class="file-size">${size||''}</div></div>`;
    wrap.addEventListener('dblclick', e => {
      e.stopPropagation();
      fileReplaceTarget = el; // remplacer cet élément
      document.getElementById('file-input-file').click();
    });
    el.insertBefore(wrap, el.querySelector('.element-toolbar'));
    el._fileEventsAttached = true;
    return el;
  }

  // ── LIGHTBOX VIDÉO ────────────────────────────────────────────────────────
  function openVideoLightbox(src) {
    const overlay = document.getElementById('video-lightbox-overlay');
    const vid = document.getElementById('vlb-video');
    vid.src = src;
    overlay.classList.add('show');
    vid.focus();
  }
  function closeVideoLightbox() {
    const overlay = document.getElementById('video-lightbox-overlay');
    const vid = document.getElementById('vlb-video');
    vid.pause();
    vid.src = '';
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
      toDelete.forEach(e => { removeConnectionsForEl(e); e.remove(); });
      multiSelected.clear(); selectedEl = null;
      toast(toDelete.length + ' éléments supprimés');
    } else {
      removeConnectionsForEl(el); el.remove(); selectedEl = null;
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
    // Afficher la taille courante de la zone de texte
    const ta = el.querySelector('div[contenteditable], .el-caption');
    if (ta) {
      const sz = parseInt(ta.style.fontSize) || 14;
      const sizeVal = document.getElementById('text-size-val');
      if (sizeVal) sizeVal.textContent = sz;
      // Marquer le bouton de police actif
      const fw = ta.style.fontWeight;
      document.querySelectorAll('.text-font-btn').forEach(b => b.classList.remove('active'));
      const activeId = (fw === '700' || fw === 'bold') ? 'tp-bold' : 'tp-roman';
      const activeBtn = document.getElementById(activeId);
      if (activeBtn) activeBtn.classList.add('active');
    }
    // mousedown sur le panneau : flag pour que blur ne ferme pas le panneau
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
  function applyTextFont(val) {
    if (!textEditTarget) return;
    const ta = textEditTarget.querySelector('div[contenteditable], .el-caption');
    if (!ta) return;
    const fontMap = {
      'helvetica-roman': "'HelveticaRoman','Helvetica Neue',Helvetica,Arial,sans-serif",
      'helvetica-bold':  "'HelveticaBold','Helvetica Neue',Helvetica,Arial,sans-serif"
    };
    if (fontMap[val]) {
      ta.style.fontFamily = fontMap[val];
      ta.style.fontWeight = val === 'helvetica-bold' ? '700' : '400';
    }
    // Mettre à jour l'état actif des boutons
    document.querySelectorAll('.text-font-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(val === 'helvetica-bold' ? 'tp-bold' : 'tp-roman');
    if (activeBtn) activeBtn.classList.add('active');
    scheduleSave();
  }
  function applyTextSizeDelta(delta) {
    if (!textEditTarget) return;
    const ta = textEditTarget.querySelector('div[contenteditable], .el-caption') || textEditTarget;
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
    const ta = textEditTarget.querySelector('div[contenteditable], .el-caption') || textEditTarget;
    if (ta) ta.style.textAlign = align;
    document.querySelectorAll('.text-align-btn').forEach(b => b.classList.remove('active'));
    const id = { left:'ta-left', center:'ta-center', right:'ta-right' }[align];
    const btn = document.getElementById(id);
    if (btn) btn.classList.add('active');
    scheduleSave();
  }

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
    if (!ctxTargetEl) { hideContextMenu(); return; }
    if (multiSelected.has(ctxTargetEl) && multiSelected.size > 0) {
      // Supprimer toute la sélection multiple
      const toDelete = [...multiSelected];
      if (selectedEl && !multiSelected.has(selectedEl)) toDelete.push(selectedEl);
      toDelete.forEach(el => { removeConnectionsForEl(el); el.remove(); });
      multiSelected.clear(); selectedEl = null;
      toast(toDelete.length + ' éléments supprimés');
    } else {
      removeConnectionsForEl(ctxTargetEl); ctxTargetEl.remove(); selectedEl = null;
    }
    pushHistory(); scheduleSave();
    hideContextMenu();
  }

  // ── PANNEAU BIBLIOTHÈQUE ──────────────────────────────────────────────────
  function toggleLibPanel() {
    libPanelOpen = !libPanelOpen;
    const panel = document.getElementById('lib-panel');
    panel.classList.toggle('open', libPanelOpen);
    if (libPanelOpen) renderPanelLib();
  }

  function renderPanelLib() {
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

    // Compteurs chips
    document.querySelectorAll('.lib-folder-chip').forEach(btn => {
      const f = btn.dataset.folder;
      if (f === 'all') {
        const total = Object.values(library).reduce((a,b)=>a+b.length,0);
        btn.textContent = `Tout (${total})`;
      } else {
        btn.textContent = {typographie:'Typo',couleur:'Couleur',logo:'Logo',image:'Image'}[f] + ` (${(library[f]||[]).length})`;
      }
      btn.classList.toggle('active', f === panelFolder);
    });

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

      div.appendChild(indicator);
      div.appendChild(img);
      div.appendChild(name);
      div.appendChild(delBtn);

      // Clic = sélection ; Shift+clic = ajout/retrait de la sélection
      // (ignoré si le clic est en fait la fin d'un drag)
      let _libItemDragging = false;
      div.addEventListener('click', e => {
        e.stopPropagation();
        if (_libItemDragging) { _libItemDragging = false; return; }
        if (e.shiftKey) {
          if (libSelectedIds.has(item.id)) {
            libSelectedIds.delete(item.id);
            div.classList.remove('selected-lib-item');
          } else {
            libSelectedIds.add(item.id);
            div.classList.add('selected-lib-item');
          }
        } else {
          libSelectedIds.clear();
          document.querySelectorAll('.lib-panel-item.selected-lib-item').forEach(d => d.classList.remove('selected-lib-item'));
          libSelectedIds.add(item.id);
          div.classList.add('selected-lib-item');
        }
      });

      div.addEventListener('dragstart', e => {
        _libItemDragging = true;
        // Si l'item fait partie d'une sélection multiple, embarquer tous les sélectionnés
        let srcs;
        if (libSelectedIds.has(item.id) && libSelectedIds.size > 1) {
          srcs = [];
          Object.keys(library).forEach(f => {
            library[f].forEach(i => { if (libSelectedIds.has(i.id)) srcs.push(i.src); });
          });
          e.dataTransfer.setData('text/plain', JSON.stringify(srcs));
        } else {
          e.dataTransfer.setData('text/plain', item.src);
          srcs = null;
        }
        isDraggingFromPanel = true;
        const ghost = new Image();
        ghost.src = item.src;
        ghost.style.cssText = 'position:fixed;top:-200px;left:-200px;max-width:80px;max-height:80px;pointer-events:none;';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 40, 40);
        setTimeout(() => { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 0);
      });
      div.addEventListener('dragend', () => { isDraggingFromPanel = false; _libItemDragging = false; });
      grid.appendChild(div);
    });
  }

  function setPanelFolder(folder, btn) {
    panelFolder = folder;
    renderPanelLib();
  }

  function searchPanelLib() { renderPanelLib(); }

  // Accepte les images même quand f.type est vide (ex. SVG sur certains systèmes)
  function isImageFile(f) {
    if (f.type.startsWith('image/')) return true;
    const ext = f.name.split('.').pop().toLowerCase();
    return ['jpg','jpeg','png','gif','webp','svg','bmp','ico','tiff','avif'].includes(ext);
  }

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
  // en coordonnées brutes (sans transform zoom/pan), retourne un canvas découpé.
  function captureBoard(exportScale = 2) {
    return new Promise((resolve, reject) => {
      const els = document.querySelectorAll('#canvas .board-element');
      if (!els.length) { reject('Aucun élément sur le board'); return; }

      // Bounding box en coordonnées CSS brutes (indépendant du zoom)
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
      const cropX = Math.max(0, minL - margin);
      const cropY = Math.max(0, minT - margin);
      const cropW = contentW + margin * 2;
      const cropH = contentH + margin * 2;

      // Créer un conteneur de capture en top-left (viewport = 0,0) avec opacity quasi-nulle
      // — html2canvas capture correctement les éléments dans le viewport, pas hors-écran
      const wrapperBg = getComputedStyle(document.getElementById('canvas-wrapper')).backgroundColor || '#f4f4f6';
      const tempContainer = document.createElement('div');
      tempContainer.style.cssText = [
        'position:fixed', 'top:0', 'left:0',
        'opacity:0.001',          // pratiquement invisible mais dans le viewport pour html2canvas
        `width:${cropW}px`, `height:${cropH}px`,
        `background:${wrapperBg}`,
        'overflow:hidden',
        'pointer-events:none',
        'z-index:99999'
      ].join(';');

      // Cloner chaque board-element et le repositionner dans le conteneur temp
      els.forEach(el => {
        const clone = el.cloneNode(true);
        const l = parseFloat(el.style.left)||0;
        const t = parseFloat(el.style.top) ||0;
        clone.style.position = 'absolute';
        clone.style.left = (l - cropX) + 'px';
        clone.style.top  = (t - cropY) + 'px';
        clone.style.transform = '';
        clone.classList.remove('selected','multi-selected');
        // Retirer UI non nécessaire à l'export
        clone.querySelectorAll('.element-toolbar,.resize-handle,.color-eyedropper,.video-play-hint').forEach(n => n.remove());
        // Pour les cartes vidéo-fichier : remplacer le <video> (zone noire en export)
        // par une <img> capturant la frame courante de la vraie vidéo source
        if (el.dataset.type === 'file' && el.querySelector('.el-file-video')) {
          const realVid = el.querySelector('video');
          const cloneVid = clone.querySelector('video');
          if (realVid && cloneVid && (realVid.readyState >= 2)) {
            try {
              const fc = document.createElement('canvas');
              fc.width  = realVid.videoWidth  || realVid.offsetWidth  || 300;
              fc.height = realVid.videoHeight || realVid.offsetHeight || 200;
              fc.getContext('2d').drawImage(realVid, 0, 0, fc.width, fc.height);
              const img = document.createElement('img');
              img.src = fc.toDataURL('image/png');
              img.style.cssText = cloneVid.style.cssText;
              img.style.width  = '100%';
              img.style.height = '100%';
              img.style.objectFit = 'contain';
              img.style.display = 'block';
              cloneVid.replaceWith(img);
            } catch(_) { /* canvas tainted — laisser la vidéo */ }
          } else if (cloneVid) {
            // Vidéo pas encore chargée → fond noir avec texte
            cloneVid.style.background = '#111';
          }
        }
        // Forcer visibilité complète (retirer tout display:none résiduel)
        clone.style.display = '';
        tempContainer.appendChild(clone);
      });

      // Cloner les connexions SVG
      document.querySelectorAll('#canvas .el-connection').forEach(svg => {
        const svgClone = svg.cloneNode(true);
        const svgL = parseFloat(svg.style.left)||0;
        const svgT = parseFloat(svg.style.top) ||0;
        svgClone.style.position = 'absolute';
        svgClone.style.left = (svgL - cropX) + 'px';
        svgClone.style.top  = (svgT - cropY) + 'px';
        tempContainer.appendChild(svgClone);
      });

      document.body.appendChild(tempContainer);
      // Laisser 2 frames de rendu au navigateur
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          html2canvas(tempContainer, {
            scale: exportScale, useCORS: true, allowTaint: true,
            width: cropW, height: cropH,
            x: 0, y: 0,
            scrollX: 0, scrollY: 0,
            logging: false,
            imageTimeout: 15000,
            backgroundColor: wrapperBg
          }).then(cropped => {
            document.body.removeChild(tempContainer);
            resolve({ canvas: cropped, w: cropW * exportScale, h: cropH * exportScale });
          }).catch(err => {
            if (tempContainer.parentNode) document.body.removeChild(tempContainer);
            reject(err);
          });
        });
      });
    });
  }

  function exportPNG() {
    if (typeof html2canvas === 'undefined') {
      toast('html2canvas non chargé'); return;
    }
    toast('Export PNG en cours...');
    captureBoard().then(({ canvas }) => {
      const a = document.createElement('a');
      const b = boards.find(b => b.id === currentBoardId);
      a.download = (b ? b.name : 'moodboard') + '.png';
      a.href = canvas.toDataURL('image/png');
      a.click();
      toast('PNG exporté !');
    }).catch(msg => toast(msg || 'Erreur export PNG'));
  }

  function exportPDF(quality = 2) {
    if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
      toast('Librairies PDF non chargées'); return;
    }
    const label = quality <= 1 ? 'basse résolution' : 'haute résolution';
    toast(`Export PDF ${label} en cours...`);
    captureBoard(quality).then(({ canvas, w, h }) => {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({
        orientation: w > h ? 'landscape' : 'portrait',
        unit: 'px',
        format: [w, h]
      });
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w, h);
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
// Fonction pour supprimer les éléments sélectionnés
function deleteSelectedElements() {
    Array.from(multiSelected).forEach(el => el.remove());
    multiSelected.clear();
    selectedEl = null;
    updateMultiResizeHandle();
    updateGroupToolbar();
}

// Logique pour la barre d'outils de groupe
function updateGroupToolbar() {
    const groupToolbar = document.getElementById('group-toolbar');
    if (multiSelected.size > 0) {
        const isSingleImage = multiSelected.size === 1 && Array.from(multiSelected)[0].tagName === 'IMG';
        groupToolbar.style.display = isSingleImage ? 'none' : 'block';
        const rect = getGroupBoundingRect();
        groupToolbar.style.left = `${rect.left}px`;
        groupToolbar.style.top = `${rect.top - 40}px`;
    } else {
        groupToolbar.style.display = 'none';
    }
}

// Fonction pour obtenir le rectangle englobant du groupe
function getGroupBoundingRect() {
    if (multiSelected.size === 0) return { left: 0, top: 0, right: 0, bottom: 0 };
    const rects = Array.from(multiSelected).map(el => el.getBoundingClientRect());
    const left = Math.min(...rects.map(r => r.left));
    const top = Math.min(...rects.map(r => r.top));
    const right = Math.max(...rects.map(r => r.right));
    const bottom = Math.max(...rects.map(r => r.bottom));
    return { left, top, right, bottom };
}

// Logique pour le mode Pan (déplacement avec Espace)
document.addEventListener('keydown', function(e) {
    if (e.key === ' ') {
        document.querySelector('.canvas-wrapper').classList.add('grab-cursor');
        isPanningMode = true;
    }
});

document.addEventListener('keyup', function(e) {
    if (e.key === ' ') {
        document.querySelector('.canvas-wrapper').classList.remove('grab-cursor');
        isPanningMode = false;
    }
});

// Logique pour le recadrage des notes
function handleResizeMouse(e) {
    if (isResizing && resizeEl && resizeEl.dataset.type === 'note') {
        const minWidth = 100;
        const minHeight = 50;
        const newWidth = Math.max(minWidth, resizeStartW + e.movementX);
        const newHeight = Math.max(minHeight, resizeStartH + e.movementY);

        resizeEl.style.width = `${newWidth}px`;
        resizeEl.style.height = `${newHeight}px`;

        if (resizeEl.scrollHeight > resizeEl.clientHeight) {
            resizeEl.classList.add('note-clipped');
        } else {
            resizeEl.classList.remove('note-clipped');
        }
    }
}

// Logique pour la mise à jour de la poignée de groupe
function updateMultiResizeHandle() {
    if (multiSelected.size > 0) {
        const rect = getGroupBoundingRect();
        multiResizeHandle.style.left = `${rect.right}px`;
        multiResizeHandle.style.top = `${rect.bottom}px`;
        multiResizeHandle.style.display = 'block';
    } else {
        multiResizeHandle.style.display = 'none';
    }
}

// Logique pour le raccourci Ctrl+Tab
document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        saveBoardState();
        window.location.href = 'index.html';
    }
});

// Fonction pour sauvegarder l'état du board
function saveBoardState() {
    console.log('État du board sauvegardé');
    // Ajoutez ici la logique pour sauvegarder l'état du board
}

// Logique pour le clic sur le titre
document.querySelector('#home-screen h1').addEventListener('click', function() {
    centerViewOnElements();
});

// Fonction pour centrer la vue sur les éléments
function centerViewOnElements() {
    if (boards.length > 0 && currentBoardId) {
        const currentBoard = boards.find(board => board.id === currentBoardId);
        if (currentBoard && currentBoard.elements && currentBoard.elements.length > 0) {
            const elements = currentBoard.elements;
            const rects = elements.map(el => {
                const element = document.getElementById(el.id);
                return element ? element.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0 };
            }).filter(rect => rect.left !== 0 || rect.top !== 0 || rect.right !== 0 || rect.bottom !== 0);

            if (rects.length > 0) {
                const left = Math.min(...rects.map(r => r.left));
                const top = Math.min(...rects.map(r => r.top));
                const right = Math.max(...rects.map(r => r.right));
                const bottom = Math.max(...rects.map(r => r.bottom));

                const centerX = (left + right) / 2;
                const centerY = (top + bottom) / 2;

                window.scrollTo({
                    left: centerX - window.innerWidth / 2,
                    top: centerY - window.innerHeight / 2,
                    behavior: 'smooth'
                });
            }
        }
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
    uploadImages, handleImageUpload, deletePanelLibItem,
    handleFileUpload,
    deleteSelected, clearBoard, undo,
    duplicateEl, removeEl,
    ctxDuplicate, ctxDelete, ctxDownloadImage, ctxReplaceImage,
    ctxConnect, ctxAddCaption,
    exportPNG, exportPDF, openExportModal, closeExportModal,
    openVideoLightbox, closeVideoLightbox,
    toggleToolbar, fitElementsToScreen, togglePreviewMode,
    applyTextFont, applyTextSize: applyTextSizeDelta, applyTextSizeDelta, applyTextAlign,
    createBoard, closeCreateBoardModal, confirmCreateBoard,
    toolDragStart,
    toast,
    // ── Extension Moodboard : resynchronise library + panel depuis le stockage ──
    async syncLibraryFromStorage() {
      // chrome.storage.local en priorité (source de vérité partagée avec background.js)
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        try {
          const result = await chrome.storage.local.get('mb_boards');
          if (Array.isArray(result.mb_boards)) {
            boards = result.mb_boards;
            try { localStorage.setItem('mb_boards', JSON.stringify(boards)); } catch {}
            if (currentBoardId) { loadLibraryForBoard(currentBoardId); renderPanelLib(); }
            return;
          }
        } catch {}
      }
      // Fallback localStorage
      boards = JSON.parse(localStorage.getItem('mb_boards') || '[]');
      if (currentBoardId) { loadLibraryForBoard(currentBoardId); renderPanelLib(); }
    }
  };
})();

// ── EXTENSION MOODBOARD : rafraîchissement galerie ────────────────────────────
// Déclenché par background.js après injection d'une image dans le localStorage.
window.addEventListener('mb-image-injected', () => {
  if (typeof App !== 'undefined' && typeof App.syncLibraryFromStorage === 'function') {
    App.syncLibraryFromStorage();
  }
});

window.addEventListener('DOMContentLoaded', App.init);

// ── EXTENSION MOODBOARD : écoute chrome.storage ──────────────────────────────
// background.js écrit directement dans chrome.storage.local lors d'une injection.
// Ce listener détecte le changement et resynchronise l'état mémoire + le panneau.
// Guard : inopérant hors contexte extension (Live Server, ouverture directe…).
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.mb_boards) {
      if (typeof App !== 'undefined' && typeof App.syncLibraryFromStorage === 'function') {
        App.syncLibraryFromStorage();
      }
    }
  });
}