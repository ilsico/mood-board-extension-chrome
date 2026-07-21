const App = (function () {
  // ── ÉTAT ─────────────────────────────────────────────────────────────────
  let boards = []; // chargé de façon asynchrone dans init() via loadBoardsFromStorage()
  // ── Roue 3D (pile verticale) ──
  let wheelPosition = 0; // index float courant de la carte active
  let wheelTargetPosition = 0; // index float cible (pour easing)
  let wheelRAF = null; // requestAnimationFrame en cours
  let snapTimeout = null; // timer de snap après scroll (magnétisme)
  let wheelIndex = 0; // index de la carte la plus proche du centre
  let _wheelScrollWired = false; // guard listener (anti-doublon si init() rappelé)
  let _wheelDetailVisible = false; // panneau d'info affiché sur la carte active
  let _wheelDetailTimeout = null; // timer différé pour showWheelDetail (annulable)
  let _cardTitleTimeout = null; // timer différé pour afficher le titre de carte
  let library = {}; // bibliothèque du board courant — chargée dans openBoard()
  let currentBoardId = null;
  let _currentUser = null; // utilisateur Firebase Google (null si non connecté / anonyme)
  let _pinnedBoards = new Set(); // IDs des boards épinglés sur mobile
  let currentFolder = 'all';
  let panelFolder = 'all';
  let libPanelOpen = false;
  let zoomLevel = 1;
  let panX = 0,
    panY = 0;
  let pendingToolDropPos = null;
  let pinchTouchSetupDone = false; // guard pour les listeners touch pinch (ne s'enregistrent qu'une fois)
  let isPanning = false;
  let isTouchPanning = false;
  let isPanningMode = false;
  let panStart = { x: 0, y: 0 };
  let selectedEl = null; // élément unique sélectionné
  let multiSelected = new Set(); // sélection multiple
  // Élément de référence pour l'alignement, défini en cliquant un élément
  // d'une multi-sélection sans le déplacer (voir _setKeyObject).
  let _keyObject = null;
  let libSelectedIds = new Set();
  let _libLastClickedId = null; // dernier item cliqué (pour Shift range)
  let isResizing = false;
  let resizeEl = null;
  let resizeStartW = 0,
    resizeStartH = 0,
    resizeStartX = 0,
    resizeStartY = 0;
  let resizeRatio = null; // ratio w/h pour les images (resize proportionnel)
  let resizeCorner = null; // 'nw' | 'ne' | 'sw' | 'se'
  let resizeStartLeft = 0;
  let resizeStartTop = 0;
  let _resizeRafId = null;
  let _resizeTargetW = 0,
    _resizeTargetH = 0;
  let _resizeTargetLeft = 0,
    _resizeTargetTop = 0;
  let hoveredEl = null;
  let _cornerHandlesTarget = null;
  let _hoverLeaveTimer = null;
  let snapThreshold = 8; // pixels canvas pour déclencher le snap
  let isAltDown = false; // état de la touche Alt
  let ctrlSnap = false; // Ctrl enfoncé → snap actif
  let _justGroupDragged = false; // guard : empêche le click après un group drag
  let renamingBoardId = null;
  let ctxTargetEl = null;
  let nextZ = 100;
  let _syncIntervalId = null;
  // Stockage hors-DOM des données base64 des images (évite des attributs HTML massifs)
  const _imgStore = new Map(); // id -> base64 src
  const _imgOrigStore = new Map(); // id -> base64 original (avant tout crop)
  let _lightboxElId = null; // id de l'élément image ouvert dans la lightbox
  let _cropRect = { x: 0, y: 0, w: 0, h: 0 }; // en px dans l'image affichée (crop-container)
  let _cropDragState = null; // null | { type: 'move'|'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w', startX, startY, startRect }
  let _cropContainerRect = null; // getBoundingClientRect du #crop-container au début du drag
  let _paperFrame = { active: false, x: 0, y: 0, w: 0, h: 0, realW_mm: null, realH_mm: null };
  let _pfpPrevUnit = 'mm';
  // Rectangle de sélection
  let isSelecting = false;
  let selRectStart = { x: 0, y: 0 };
  let isDraggingFromPanel = false; // true quand un drag vient du panneau bibliothèque
  let draggedLibItemId = null; // ID de l'item lib en cours de drag (pour drop sur catégorie)
  let draggedLibItems = []; // items sélectionnés pour drag multiple vers le board
  let fileReplaceTarget = null; // élément .board-element à remplacer lors du prochain handleFileUpload
  const SHARE_BASE_URL = 'https://moodboard-app-b21b9.web.app';

  // ── FONT SELECTOR ────────────────────────────────────────────────────────
  let _localFonts = [];           // string[] familles locales (dédupliquées, triées)
  let _gFontsList = null;         // string[] familles Google Fonts (cache, null = pas encore fetchées)
  const _loadedGFonts = new Set();// familles déjà injectées via <link> dans le <head>
  let _fontPreviewOriginal = null;// fontFamily CSS sauvegardé avant ouverture dropdown (revert Echap)
  let _fontFocusedIdx = -1;       // index de l'item focusé par les touches ↑↓
  let _fontDropdownOpen = false;  // état ouvert/fermé du dropdown

  //// ── PERSISTANCE (IndexedDB - Stockage illimité sur disque dur) ───────────
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

  // Anti-spam : saveBoards() est appelé à chaque action, on ne prévient qu'une
  // fois toutes les 10 s en cas d'échec répété.
  let _saveFailNotifiedAt = 0;
  function _notifySaveFailure(err) {
    const now = Date.now();
    if (now - _saveFailNotifiedAt < 10000) return;
    _saveFailNotifiedAt = now;
    const quota = err && (err.name === 'QuotaExceededError' || err.code === 22);
    toast(
      quota
        ? 'Stockage saturé — sauvegarde impossible, libère de la place'
        : 'Sauvegarde impossible — tes dernières modifications ne sont pas enregistrées'
    );
  }

  /**
   * Sauvegarde les boards dans IndexedDB.
   * Attend la fin réelle de la transaction : sans ça la promesse se résout avant
   * l'écriture, et un échec (quota dépassé) passait totalement inaperçu.
   * @returns {Promise<boolean>} true si l'écriture est bien committée.
   */
  async function saveBoards() {
    try {
      const db = await getDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(boards, 'mb_boards');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });

      // Force le menu clic droit à se mettre à jour
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ type: 'MB_BOARDS_MODIFIED' }).catch(() => {});
      }
      return true;
    } catch (e) {
      _notifySaveFailure(e);
      return false;
    }
  }

  function saveLibrary() {
    if (!currentBoardId) return;
    const b = boards.find((x) => x.id === currentBoardId);
    if (b) {
      b.library = library;
      saveBoards();
    }
  }

  function loadLibraryForBoard(boardId) {
    const b = boards.find((x) => x.id === boardId);
    const raw = b && b.library ? b.library : {};
    library = raw;
    ['typographie', 'couleur', 'logo', 'image', 'captures', '__trash__'].forEach((f) => {
      if (!library[f]) library[f] = [];
    });
  }

  // Miniatures désactivées (cartes accueil sans aperçu)
  let wheelRaf = null;

  // ── COMPRESSION D'IMAGE ──────────────────────────────────────────────────
  // Réduit les images lourdes (>500KB ou >maxWidth px) en JPEG via Canvas API.
  // Retourne une Promise<string> (data URL compressée ou src inchangé si déjà petit).
  function compressImage(src, maxWidth, quality) {
    maxWidth = maxWidth || 1600;
    quality = quality || 0.8;
    return new Promise(function (resolve) {
      // GIFs must never go through canvas — it only captures one frame and kills animation
      if (src && src.startsWith('data:image/gif')) {
        resolve(src);
        return;
      }
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth,
          h = img.naturalHeight;
        if (w <= maxWidth && src.length < 500000) {
          resolve(src);
          return;
        }
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }
        var cvs = document.createElement('canvas');
        cvs.width = w;
        cvs.height = h;
        var ctx = cvs.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cvs.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () {
        resolve(src);
      };
      img.src = src;
    });
  }

  function saveCurrentBoard() {
    if (!currentBoardId) return;
    // En mode collab, seul le owner sauvegarde localement
    if (typeof Collab !== 'undefined' && Collab.isActive() && !Collab.isOwner()) return;
    const board = boards.find((b) => b.id === currentBoardId);
    if (!board) return;
    const elements = [];
    document.querySelectorAll('#canvas .board-element').forEach((el) => {
      const _elStyle = (() => {
        if (el.dataset.type !== 'note') return null;
        const ta = el.querySelector('.el-note-content');
        if (!ta) return null;
        return {
          fontFamily: ta.style.fontFamily || '',
          fontWeight: ta.style.fontWeight || '',
          fontSize: ta.style.fontSize || '',
          textAlign: ta.style.textAlign || '',
        };
      })();
      const _elemData =
        el.dataset.type === 'image'
          ? _imgStore.get(el.dataset.id) || el.dataset.savedata || ''
          : el.dataset.savedata || '';
      const _elemEntry = {
        id: el.dataset.id,
        type: el.dataset.type,
        x: parseFloat(el.style.left) || 0,
        y: parseFloat(el.style.top) || 0,
        w: parseFloat(el.style.width) || null,
        h: parseFloat(el.style.height) || null,
        z: parseInt(el.style.zIndex) || 100,
        data: _elemData,
        style: _elStyle,
      };
      if (el.dataset.type === 'image') {
        const _origSrc = _imgOrigStore.get(el.dataset.id);
        if (_origSrc) _elemEntry.origData = _origSrc;
        if (el.dataset.cropdata) _elemEntry.cropdata = el.dataset.cropdata;
        // URL Firebase Storage de l'image, posée par _uploadBoardImagesToStorage.
        // Persistée avec le board pour survivre à un rechargement : sans elle, la
        // prochaine écriture Firebase remettrait data:'' et le lien de partage
        // reperdrait ses images.
        if (el.dataset.storageurl) _elemEntry.storageUrl = el.dataset.storageurl;
      }
      elements.push(_elemEntry);
    });
    // Sauvegarder les connexions
    document.querySelectorAll('#canvas .el-connection').forEach((svg) => {
      elements.push({
        type: 'connection',
        from: svg.dataset.from,
        to: svg.dataset.to,
        connId: svg.dataset.connId,
      });
    });
    // Sauvegarder les captions
    document.querySelectorAll('#canvas .el-caption').forEach((cap) => {
      elements.push({
        type: 'caption',
        capId: cap.dataset.capId || '',
        x: parseFloat(cap.style.left) || 0,
        y: parseFloat(cap.style.top) || 0,
        width: cap.style.width,
        parentId: cap.dataset.parentId || '',
        text: cap.textContent || '',
        style: {
          fontFamily: cap.style.fontFamily || '',
          fontWeight: cap.style.fontWeight || '',
          fontSize: cap.style.fontSize || '',
          textAlign: cap.style.textAlign || '',
        },
      });
    });
    board.elements = elements;
    board.theme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
    board.savedAt = Date.now();
    saveBoards();
    if (_currentUser && _isPinned(currentBoardId)) {
      _syncBoardElements(currentBoardId);
      // Mettre à jour le thumb si disponible
      if (board.coverImage || board.snapshot) {
        const thumb = board.coverImage || board.snapshot;
        window._fbDb.ref('users/' + _currentUser.uid + '/pinned_boards/' + currentBoardId + '/thumb')
          .set(thumb).catch(function () {});
      }
    }
    if (_currentUser && !_currentUser.isAnonymous &&
        typeof Collab !== 'undefined' && Collab.isActive() && window._fbDb) {
      window._fbDb.ref('boards/' + currentBoardId + '/activity').push({
        uid: _currentUser.uid,
        displayName: _currentUser.displayName || 'Inconnu',
        photoURL: _currentUser.photoURL || '',
        action: 'modified',
        at: Date.now(),
      }).catch(function () {});
    }
    // Sync Firebase — le base64 est remplacé par l'URL Storage de l'image (posée
    // par _uploadBoardImagesToStorage au partage), sinon "Write too large".
    if (window._fbDb) {
      const fbElements = board.elements.map((el) =>
        el.type === 'image'
          ? Object.assign({}, el, { data: el.storageUrl || '', origData: '' })
          : el
      );
      const payload = { name: board.name, elements: fbElements, savedAt: board.savedAt };
      // update() et pas set() : set() écraserait les enfants frères activity/ et snapshotUrl
      window._fbDb
        .ref('boards/' + currentBoardId)
        .update(payload)
        .catch(() => {});
    }
  }

  function _isPinned(boardId) {
    return _pinnedBoards.has(boardId);
  }

  function _updatePinBtn(pinned) {
    const btn = document.getElementById('pin-mobile-btn');
    if (!btn) return;
    btn.classList.toggle('active', !!pinned);
  }

  function _syncBoardElements(boardId) {
    if (!_currentUser || !window._fbDb) return;
    const board = boards.find(function (b) { return b.id === boardId; });
    if (!board || !board.elements) return;
    // Strip image base64 — les images sont affichées via snapshotUrl dans la PWA
    const fbElements = board.elements.map(function (el) {
      return el.type === 'image'
        ? Object.assign({}, el, { data: el.storageUrl || '', origData: '' })
        : el;
    });
    const payload = { name: board.name, elements: fbElements, savedAt: board.savedAt };
    // update() et pas set() : set() écraserait snapshotUrl, seule source des images côté PWA
    window._fbDb.ref('users/' + _currentUser.uid + '/boards/' + boardId)
      .update(payload)
      .catch(function () {});
  }

  async function togglePinBoard(boardId) {
    if (!_currentUser) { toast('Connecte-toi pour épingler sur l\'iPhone'); return; }
    if (!window._fbDb) return;
    const board = boards.find(function (b) { return b.id === boardId; });
    if (!board) return;
    const ref = window._fbDb.ref('users/' + _currentUser.uid + '/pinned_boards/' + boardId);
    const snap = await ref.get();
    if (snap.exists()) {
      await ref.remove();
      window._fbDb.ref('users/' + _currentUser.uid + '/boards/' + boardId).remove().catch(function () {});
      _pinnedBoards.delete(boardId);
      toast('Board retiré du mobile');
      _updatePinBtn(false);
    } else {
      const thumb = board.coverImage || board.snapshot || '';
      await ref.set({ name: board.name, thumb: thumb, savedAt: board.savedAt, pinned: true });
      _pinnedBoards.add(boardId);
      _syncBoardElements(boardId);
      toast('Board épinglé sur iPhone');
      _updatePinBtn(true);
    }
  }

  function _syncPinnedBoards() {
    if (!_currentUser || !window._fbDb) return;
    window._fbDb.ref('users/' + _currentUser.uid + '/pinned_boards').get().then(function (snap) {
      _pinnedBoards.clear();
      if (snap.exists()) {
        Object.keys(snap.val()).forEach(function (id) { _pinnedBoards.add(id); });
      }
    }).catch(function () {});
  }

  let _inboxUnsubscribe = null; // fonction pour détacher le listener Firebase inbox

  function _setupInboxListener() {
    if (!_currentUser || !window._fbDb) return;
    if (_inboxUnsubscribe) { _inboxUnsubscribe(); _inboxUnsubscribe = null; }
    const ref = window._fbDb.ref('users/' + _currentUser.uid + '/inbox');
    const handler = ref.on('value', function (snap) {
      if (!snap.exists()) return;
      let imported = 0;
      snap.forEach(function (child) {
        const v = child.val();
        if (v.imported || v.type !== 'image' || !v.data) return;
        const dateStr = v.addedAt ? new Date(v.addedAt).toLocaleDateString('fr-FR') : 'iPhone';
        const libItem = {
          id: 'cap_' + child.key,
          src: v.data,
          name: 'iPhone ' + dateStr,
        };
        // Dédupliquer par id
        if (!library['captures']) library['captures'] = [];
        if (!library['captures'].find(function (i) { return i.id === libItem.id; })) {
          library['captures'].push(libItem);
          imported++;
        }
        window._fbDb.ref('users/' + _currentUser.uid + '/inbox/' + child.key + '/imported').set(true).catch(function () {});
      });
      if (imported > 0) {
        saveLibrary();
        if (libPanelOpen) renderPanelLib();
        toast(imported === 1 ? '1 image ajoutée à la bibliothèque' : imported + ' images ajoutées à la bibliothèque');
      }
    });
    _inboxUnsubscribe = function () { ref.off('value', handler); };
  }

  function triggerManualSync() {
    if (!currentBoardId) return;
    saveCurrentBoard();
    if (typeof html2canvas === 'undefined') {
      toast('Moodboard synchronisé !');
      return;
    }
    captureBoardThumbnail()
      .then(({ dataUrl, cropW, cropH }) => {
        const maxSide = 1200;
        const ratio = Math.min(1, maxSide / Math.max(cropW, cropH));
        const tw = Math.round(cropW * ratio);
        const th = Math.round(cropH * ratio);
        const tc = document.createElement('canvas');
        tc.width = tw;
        tc.height = th;
        const ctx2 = tc.getContext('2d');
        const img2 = new Image();
        img2.onload = () => {
          ctx2.drawImage(img2, 0, 0, tw, th);
          const thumb = tc.toDataURL('image/jpeg', 0.85);
          const board = boards.find((b) => b.id === currentBoardId);
          if (board) {
            board.snapshot = thumb;
            saveBoards();
            if (window._fbDb && currentBoardId) {
              window._fbDb
                .ref('boards/' + currentBoardId + '/snapshot')
                .set(thumb)
                .catch(() => {});
              if (window._fbStorage) {
                // Capture séparée en PNG scale 2 pour la PWA (qualité maximale)
                const _sid = currentBoardId;
                _captureAndUploadSnapshot(_sid);
              }
            }
          }
          toast('Moodboard synchronisé !');
        };
        img2.src = dataUrl;
      })
      .catch(() => {
        toast('Moodboard synchronisé !');
      });
  }

  /// ── CHARGEMENT INITIAL DES BOARDS ────────────────────────────────────────
  async function loadBoardsFromStorage() {
    // 1. Tenter de charger depuis IndexedDB (nouveau stockage illimité)
    try {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get('mb_boards');
      const data = await new Promise((resolve) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });

      // Un tableau vide est une réponse valide : l'utilisateur a supprimé tous ses
      // boards. Retomber sur la migration localStorage dans ce cas ressusciterait
      // les boards effacés au rechargement suivant.
      if (Array.isArray(data)) {
        boards = data;
        boards.forEach((b) => {
          if (b.thumbnail && !b.coverImage) b.coverImage = b.thumbnail;
          if (!b.coverImage) b.coverImage = '';
          if (!b.snapshot) b.snapshot = '';
          delete b.thumbnail;
        });
        return;
      }
    } catch (e) {
      // IndexedDB indisponible : on retombe sur la migration localStorage ci-dessous
    }

    // 2. Migration automatique de vos anciennes données limitées
    const raw = localStorage.getItem('mb_boards');
    if (raw) {
      try {
        boards = JSON.parse(raw);
        boards.forEach((b) => {
          if (b.thumbnail && !b.coverImage) b.coverImage = b.thumbnail;
          if (!b.coverImage) b.coverImage = '';
          if (!b.snapshot) b.snapshot = '';
          delete b.thumbnail;
        });
        // Transfère vos anciens boards vers le stockage illimité, puis purge la clé
        // legacy — mais seulement si l'écriture a réellement réussi, sinon on
        // perdrait les données au lieu de les migrer.
        if (await saveBoards()) localStorage.removeItem('mb_boards');
      } catch {
        boards = [];
      }
    }
  }

  // ── INIT ─────────────────────────────────────────────────────────────────
  function preloadLoaderFrames() {
    for (let i = 1; i <= 9; i++) {
      const img = new Image();
      img.src = `loading/frame${i}.png`;
    }
  }

  async function init() {
    preloadLoaderFrames();
    // ── Initialisations partagées (mode normal ET lecture seule) ──
    setupCanvasEvents();
    setupKeyboard();
    setupMultiResizeHandle();
    setupCornerHandles();
    setupEdgeHandles();
    setupConnectorTool();
    setupWheelScroll();
    setupPreviewKeyboard();
    setupActionBar();
    setupWheelSearch();
    document.querySelectorAll('.modal-overlay').forEach((ov) => {
      ov.addEventListener('mousedown', (e) => {
        if (e.target === ov) ov.classList.add('hidden');
      });
    });
    document.addEventListener('click', () => {
      hideContextMenu();
      const am = document.getElementById('autosave-menu');
      if (am) am.style.display = 'none';
    });
    // Fermer le panneau texte au clic en dehors d'une note en édition
    document.addEventListener(
      'mousedown',
      (e) => {
        if (e.detail >= 2) return; // ignorer les doubles-clics (ils déclenchent activateNoteEdit)
        const sbText = document.querySelector('.sb-text');
        if (!sbText || sbText.classList.contains('sb-disabled')) return;
        if (sbText.contains(e.target)) return;
        if (
          e.target.closest('.board-element[data-editing="1"]') ||
          e.target.closest('.el-caption:focus')
        )
          return;
        const ta = document.querySelector('.board-element[data-editing="1"] textarea');
        if (ta) {
          ta.blur();
        } else {
          hideTextEditPanel();
        }
      },
      true
    ); // capture pour intercepter avant les autres handlers
    _setupEditBoardModalButtons();
    _applyCustomCursor();
    setupPanelDrop();
    // Fermer les lightboxes au clic sur l'overlay
    document.getElementById('lightbox-overlay').addEventListener('click', () => {
      if (document.getElementById('crop-ui').classList.contains('active')) return;
      closeLightbox();
    });
    document.getElementById('lightbox-content').addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('crop-ui').addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('video-lightbox-overlay').addEventListener('click', (e) => {
      if (e.target === document.getElementById('video-lightbox-overlay')) closeVideoLightbox();
    });
    // Fermer les lightboxes à Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeLightbox();
        closeVideoLightbox();
      }
    });

    // ── Détection mode collaboration : ?collab=ID ──
    const _collabId = new URLSearchParams(window.location.search).get('collab');
    if (_collabId && typeof Collab !== 'undefined') {
      const _ae = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
      };
      _ae('fit-screen-btn', () => fitElementsToScreen());
      _ae('preview-btn', () => togglePreviewMode());
      _ae('exit-preview-btn', () => togglePreviewMode());
      // Charger le board depuis Firebase et rejoindre en tant que guest
      await _loadCollabBoard(_collabId);
      return;
    }

    // ── Détection mode partage : ?board=ID ──
    const _sharedId = new URLSearchParams(window.location.search).get('board');
    if (_sharedId) {
      // Boutons de vue nécessaires en lecture seule
      const _ae = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
      };
      _ae('fit-screen-btn', () => fitElementsToScreen());
      _ae('preview-btn', () => togglePreviewMode());
      _ae('exit-preview-btn', () => togglePreviewMode());
      await _loadSharedBoard(_sharedId);
      return;
    }

    // ── Mode normal uniquement ──
    await loadBoardsFromStorage();

    document.addEventListener('fb-auth-change', function (e) {
      const user = e.detail;
      // On considère "connecté Google" uniquement si l'utilisateur n'est pas anonyme
      _currentUser = (user && !user.isAnonymous) ? user : null;
      const homeSigninBtn = document.getElementById('home-signin-btn');
      const homeUserInfo = document.getElementById('home-user-info');
      if (homeSigninBtn) homeSigninBtn.style.display = _currentUser ? 'none' : '';
      if (homeUserInfo) {
        homeUserInfo.classList.toggle('visible', !!_currentUser);
        if (_currentUser) {
          const avatar = document.getElementById('home-user-avatar');
          const name = document.getElementById('home-user-name');
          if (avatar) { avatar.src = _currentUser.photoURL || ''; avatar.style.display = _currentUser.photoURL ? '' : 'none'; }
          if (name) name.textContent = _currentUser.displayName || _currentUser.email || '';
        }
      }
      if (_currentUser) {
        _syncPinnedBoards();
        _setupInboxListener();
      } else {
        if (_inboxUnsubscribe) { _inboxUnsubscribe(); _inboxUnsubscribe = null; }
      }
    });

    // Si fb-auth-change a été dispatché avant l'enregistrement du listener (race condition au chargement),
    // on le re-déclenche manuellement une fois l'état auth stabilisé.
    if (window._fbAuthReady) {
      window._fbAuthReady.then(function () {
        document.dispatchEvent(new CustomEvent('fb-auth-change', { detail: window._currentFirebaseUser }));
      });
    }

    if (!boards.length) addBoard('Mon premier moodboard', false);
    // Migration : si une bibliothèque globale (mb_library) existe, la copier dans le premier board
    const legacyLib = localStorage.getItem('mb_library');
    if (legacyLib && boards.length) {
      try {
        const parsed = JSON.parse(legacyLib);
        const hasContent = Object.values(parsed).some((arr) => arr && arr.length > 0);
        if (hasContent && !boards[0].library) {
          boards[0].library = parsed;
          saveBoards();
        }
      } catch (_) {}
      localStorage.removeItem('mb_library');
    }
    renderBoardsWheel();
    setupUIEvents(); // <-- APPEL DE LA FONCTION (très important)
  } // <--- ACCOLADE MANQUANTE POUR FERMER LA FONCTION init()

  // ── THÈME CLAIR/SOMBRE ───────
  const _ICON_MOON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>';
  const _ICON_SUN =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';

  function _updateThemeIcon() {
    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;
    const isLight = document.body.classList.contains('light-mode');
    btn.innerHTML = isLight ? _ICON_SUN : _ICON_MOON;
    btn.title = isLight ? 'Passer en mode sombre' : 'Passer en mode clair';
  }

  function toggleTheme() {
    document.body.classList.toggle('light-mode');
    _updateThemeIcon();
    saveCurrentBoard();
  }

  // ── AUTH GOOGLE ───────
  function _signInWithGoogle() {
    const CLIENT_ID = '467105545598-mtdfgnh362ep7vfp8ln1l6cv1mku6rh1.apps.googleusercontent.com';
    const redirectUrl = chrome.identity.getRedirectURL();
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth' +
      '?client_id=' + encodeURIComponent(CLIENT_ID) +
      '&response_type=token' +
      '&redirect_uri=' + encodeURIComponent(redirectUrl) +
      '&scope=' + encodeURIComponent('email profile') +
      '&prompt=select_account';
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, function (responseUrl) {
      if (chrome.runtime.lastError || !responseUrl) {
        toast('Connexion annulée');
        return;
      }
      const params = new URLSearchParams(new URL(responseUrl).hash.substring(1));
      const accessToken = params.get('access_token');
      if (!accessToken) {
        toast('Connexion échouée');
        return;
      }
      const credential = firebase.auth.GoogleAuthProvider.credential(null, accessToken);
      firebase.auth().signInWithCredential(credential).catch(function () {
        toast('Connexion Firebase échouée');
      });
    });
  }

  // ── ÉVÉNEMENTS UI ───────
  function setupUIEvents() {
    // Utilitaire pour éviter de crasher si un élément n'existe pas dans le HTML
    const addEvt = (id, event, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(event, handler);
    };

    const homeSigninBtnEvt = document.getElementById('home-signin-btn');
    if (homeSigninBtnEvt) homeSigninBtnEvt.addEventListener('click', _signInWithGoogle);

    const homeSignoutBtn = document.getElementById('home-signout-btn');
    if (homeSignoutBtn) {
      homeSignoutBtn.addEventListener('click', function () {
        firebase.auth().signOut().then(function () {
          return firebase.auth().signInAnonymously();
        }).catch(function () {
          toast('Déconnexion échouée');
        });
      });
    }

    const pinMobileBtn = document.getElementById('pin-mobile-btn');
    if (pinMobileBtn) {
      pinMobileBtn.addEventListener('click', function () {
        if (currentBoardId) togglePinBoard(currentBoardId);
      });
    }

    // Guard mousedown pour garder sb-text actif quand on clique ses boutons
    const _sbText = document.querySelector('.sb-text');
    if (_sbText) {
      _sbText.addEventListener('mousedown', () => {
        window._textPanelKeepOpen = true;
      });
      _sbText.addEventListener('mouseup', () => {
        window._textPanelKeepOpen = false;
      });
    }

    // Écran d'accueil
    addEvt('new-board-btn', 'click', () => createBoard());
    addEvt('join-board-btn', 'click', () => {
      const input = document.getElementById('join-board-input');
      if (input) input.value = '';
      openModal('join-board-modal');
      setTimeout(() => {
        if (input) input.focus();
      }, 80);
    });
    addEvt('close-join-board-modal', 'click', () => closeModal('join-board-modal'));
    addEvt('submit-join-board', 'click', async () => {
      const input = document.getElementById('join-board-input');
      const val = input ? input.value.trim() : '';
      closeModal('join-board-modal');
      if (val) await joinBoardById(val);
    });
    const joinInput = document.getElementById('join-board-input');
    if (joinInput) {
      joinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('submit-join-board').click();
      });
    }

    // Header board
    addEvt('back-btn', 'click', () => goHome());
    addEvt('theme-toggle-btn', 'click', toggleTheme);

    // --- Guide format papier ---
    addEvt('paper-format-btn', 'click', openPaperFormatPanel);
    addEvt('pfp-apply-btn', 'click', applyPaperFormat);
    addEvt('pfp-deactivate-btn', 'click', deactivatePaperFormat);

    document.querySelectorAll('.pfp-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pfp-preset-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const fmt = _PAPER_FORMATS[btn.dataset.fmt];
        if (!fmt) return;
        const unit = document.getElementById('pfp-unit-select').value;
        const orient =
          document.querySelector('.pfp-orient-btn.active')?.dataset.orient || 'portrait';
        const wMm = orient === 'landscape' ? fmt.h : fmt.w;
        const hMm = orient === 'landscape' ? fmt.w : fmt.h;
        document.getElementById('pfp-w-input').value = _mmToUnit(wMm, unit);
        document.getElementById('pfp-h-input').value = _mmToUnit(hMm, unit);
        if (_paperFrame.active) applyPaperFormat(true);
      });
    });

    document.querySelectorAll('.pfp-orient-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pfp-orient-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const activePreset = document.querySelector('.pfp-preset-btn.active');
        if (activePreset) {
          const fmt = _PAPER_FORMATS[activePreset.dataset.fmt];
          if (!fmt) return;
          const unit = document.getElementById('pfp-unit-select').value;
          const orient = btn.dataset.orient;
          const wMm = orient === 'landscape' ? fmt.h : fmt.w;
          const hMm = orient === 'landscape' ? fmt.w : fmt.h;
          document.getElementById('pfp-w-input').value = _mmToUnit(wMm, unit);
          document.getElementById('pfp-h-input').value = _mmToUnit(hMm, unit);
        } else {
          const wIn = document.getElementById('pfp-w-input');
          const hIn = document.getElementById('pfp-h-input');
          const tmp = wIn.value;
          wIn.value = hIn.value;
          hIn.value = tmp;
        }
        if (_paperFrame.active) applyPaperFormat(true);
      });
    });

    const pfpUnitSel = document.getElementById('pfp-unit-select');
    if (pfpUnitSel) {
      pfpUnitSel.addEventListener('change', () => {
        const newUnit = pfpUnitSel.value;
        const wIn = document.getElementById('pfp-w-input');
        const hIn = document.getElementById('pfp-h-input');
        const wPx = _unitToPx(parseFloat(wIn.value) || 0, _pfpPrevUnit);
        const hPx = _unitToPx(parseFloat(hIn.value) || 0, _pfpPrevUnit);
        wIn.value = _pxToUnit(wPx, newUnit);
        hIn.value = _pxToUnit(hPx, newUnit);
        _pfpPrevUnit = newUnit;
      });
    }

    ['pfp-w-input', 'pfp-h-input'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          document.querySelectorAll('.pfp-preset-btn').forEach((b) => b.classList.remove('active'));
        });
      }
    });

    document.addEventListener('mousedown', (e) => {
      const panel = document.getElementById('paper-format-panel');
      if (!panel || !panel.classList.contains('active')) return;
      const pfpBtn = document.getElementById('paper-format-btn');
      if (!panel.contains(e.target) && (!pfpBtn || !pfpBtn.contains(e.target))) {
        closePaperFormatPanel();
      }
    });

    // Double-clic sur le titre → édition inline
    const titleEl = document.getElementById('board-title-display');
    if (titleEl) {
      titleEl.addEventListener('dblclick', () => {
        if (!currentBoardId || document.body.classList.contains('readonly-mode')) return;
        const b = boards.find((x) => x.id === currentBoardId);
        if (!b) return;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = b.name;
        input.style.cssText =
          'font-family:inherit;font-size:inherit;font-weight:inherit;color:var(--fg);background:var(--bg);border:none;border-bottom:1px solid var(--fg);outline:none;text-align:center;width:220px;max-width:100%;padding:2px 6px;box-sizing:border-box;';

        titleEl.textContent = '';
        titleEl.appendChild(input);
        input.focus();
        input.select();

        const save = () => {
          const val = input.value.trim();
          const name = val || b.name;
          if (val && val !== b.name) {
            b.name = name;
            saveBoards();
            renderBoardsWheel();
          }
          titleEl.textContent = name;
        };

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            save();
          }
          if (e.key === 'Escape') {
            titleEl.textContent = b.name;
          }
        });
        input.addEventListener('blur', save);
      });
    }
    addEvt('fit-screen-btn', 'click', () => fitElementsToScreen());
    addEvt('preview-btn', 'click', () => togglePreviewMode());
    addEvt('exit-preview-btn', 'click', () => togglePreviewMode());

    // Auto-hide du groupe fit/aperçu : fade-in au hover, fade-out 2s après la sortie
    const fitGroup = document.querySelector('.fit-btn-group');
    if (fitGroup) {
      let fitHideTimer = null;
      fitGroup.addEventListener('mouseenter', () => {
        clearTimeout(fitHideTimer);
        fitGroup.classList.add('fit-visible');
      });
      fitGroup.addEventListener('mouseleave', () => {
        clearTimeout(fitHideTimer);
        fitHideTimer = setTimeout(() => {
          fitGroup.classList.remove('fit-visible');
        }, 2000);
      });
    }
    addEvt('share-btn', 'click', (e) => {
      if (!currentBoardId) {
        toast('Aucun board ouvert');
        return;
      }
      const isCollab = typeof Collab !== 'undefined' && Collab.isActive();
      if (isCollab) {
        e.stopPropagation();
        const menu = document.getElementById('share-menu');
        if (menu) menu.classList.toggle('hidden');
        return;
      }
      _shareBoardLink();
    });
    addEvt('share-copy-id', 'click', (e) => {
      e.stopPropagation();
      if (!currentBoardId) return;
      navigator.clipboard
        .writeText(currentBoardId)
        .then(() => toast('ID du board copié !'))
        .catch(() => toast('ID : ' + currentBoardId));
      const menu = document.getElementById('share-menu');
      if (menu) menu.classList.add('hidden');
    });
    addEvt('share-copy-url', 'click', (e) => {
      e.stopPropagation();
      if (!currentBoardId) return;
      _shareBoardLink();
      const menu = document.getElementById('share-menu');
      if (menu) menu.classList.add('hidden');
    });
    document.addEventListener('click', (e) => {
      const wrap = document.getElementById('share-wrap');
      const menu = document.getElementById('share-menu');
      if (menu && wrap && !menu.classList.contains('hidden') && !wrap.contains(e.target)) {
        menu.classList.add('hidden');
      }
    });

    addEvt('history-btn', 'click', () => {
      const panel = document.getElementById('history-panel');
      if (!panel) return;
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) renderHistoryPanel();
    });

    const _histPanelEl = document.getElementById('history-panel');
    if (_histPanelEl) {
      _histPanelEl.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });
    }
    addEvt('broken-delete-all', 'click', () => {
      const brokens = document.querySelectorAll('#canvas .board-element.image-broken');
      if (!brokens.length) return;
      multiSelected.clear();
      selectedEl = null;
      brokens.forEach((el) => multiSelected.add(el));
      deleteSelected();
      setTimeout(_updateBrokenBanner, 600);
    });
    addEvt('broken-banner-close', 'click', () => {
      const b = document.getElementById('broken-images-banner');
      if (b) b.classList.add('hidden');
    });

    // Bouton Collaborer
    addEvt('collab-btn', 'click', async () => {
      if (typeof Collab === 'undefined') {
        toast('Module collab non chargé');
        return;
      }
      if (!currentBoardId || !window._fbDb) {
        toast('Firebase non disponible');
        return;
      }

      const btn = document.getElementById('collab-btn');

      if (Collab.isActive()) {
        if (btn) btn.style.display = 'none';
        return;
      }

      // Première activation : démarrer la session et marquer le board comme collaboratif
      try {
        saveCurrentBoard();
        const elements = _collabGetBoardElements();
        const ok = await Collab.startSession(currentBoardId, true, { elements });
        if (!ok) {
          toast('Impossible de démarrer la session');
          return;
        }
        // Marquer ce board comme collaboratif pour les prochaines ouvertures
        const board = boards.find((b) => b.id === currentBoardId);
        if (board) {
          board.isCollaborative = true;
          saveBoards();
        }
        navigator.clipboard
          .writeText(currentBoardId)
          .then(() => toast('Session collaborative démarrée — ID copié !'))
          .catch(() => toast('Session collaborative démarrée'));
        if (btn) btn.style.display = 'none';
        const shareWrap = document.getElementById('share-wrap');
        if (shareWrap && window._fbDb && !document.body.classList.contains('readonly-mode'))
          shareWrap.style.display = '';
        const _hb0 = document.getElementById('history-btn');
        if (_hb0 && !document.body.classList.contains('readonly-mode')) _hb0.style.display = '';
      } catch (e) {
        toast('Erreur lors du démarrage de la session');
      }
    });

    // Toolbar — outils (drag uniquement)
    document
      .getElementById('tool-note')
      ?.addEventListener('dragstart', (e) => toolDragStart(e, 'note'));

    document
      .getElementById('tool-color')
      ?.addEventListener('dragstart', (e) => toolDragStart(e, 'color'));

    document
      .getElementById('tool-link')
      ?.addEventListener('dragstart', (e) => toolDragStart(e, 'link'));

    document
      .getElementById('tool-file')
      ?.addEventListener('dragstart', (e) => toolDragStart(e, 'file'));

    addEvt('tool-connector', 'click', () => toggleConnectorMode());

    // Panneau texte
    // Sélecteur de police
    _initFontSelector();
    // Chevrons taille — hold-to-repeat (400 ms délai, puis toutes les 80 ms)
    let _szDragged = false;
    let _szRepeatTimer = null,
      _szRepeatInterval = null;
    const _stopSzRepeat = () => {
      clearTimeout(_szRepeatTimer);
      clearInterval(_szRepeatInterval);
      _szRepeatTimer = null;
      _szRepeatInterval = null;
    };
    const _startSzRepeat = (delta) => {
      _stopSzRepeat();
      applyTextSizeDelta(delta);
      _szRepeatTimer = setTimeout(() => {
        _szRepeatInterval = setInterval(() => {
          if (!textEditTarget) {
            _stopSzRepeat();
            return;
          }
          applyTextSizeDelta(delta);
        }, 80);
      }, 400);
    };
    const elSizeMinus = document.getElementById('text-size-minus');
    const elSizePlus = document.getElementById('text-size-plus');
    if (elSizeMinus) {
      elSizeMinus.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (_szDragged) return;
        _startSzRepeat(e.shiftKey ? -10 : -1);
      });
      elSizeMinus.addEventListener('mouseup', _stopSzRepeat);
      elSizeMinus.addEventListener('mouseleave', _stopSzRepeat);
    }
    if (elSizePlus) {
      elSizePlus.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (_szDragged) return;
        _startSzRepeat(e.shiftKey ? 10 : 1);
      });
      elSizePlus.addEventListener('mouseup', _stopSzRepeat);
      elSizePlus.addEventListener('mouseleave', _stopSzRepeat);
    }

    // Scrubby slider sur .sb-size-wrap (style Illustrator / Blender)
    const _sizeWrap = document.querySelector('.sb-size-wrap');
    if (_sizeWrap) {
      let _szStartX = 0,
        _szStartSize = 14,
        _szLastSize = 14;
      _sizeWrap.addEventListener('mousedown', (e) => {
        const sbText = document.querySelector('.sb-text');
        if (!sbText || sbText.classList.contains('sb-disabled')) return;
        if (!textEditTarget) return;
        e.preventDefault();
        _szDragged = false;
        _szStartX = e.clientX;
        const ta = textEditTarget.querySelector('.el-note-content') || textEditTarget;
        _szStartSize = parseInt(ta.style.fontSize) || 14;
        _szLastSize = _szStartSize;
        window._textPanelKeepOpen = true;

        const onMove = (me) => {
          const dx = me.clientX - _szStartX;
          if (Math.abs(dx) < 4) return;
          _szDragged = true;
          const newSize = Math.min(
            Math.max(_szStartSize + Math.round(dx * 1.5) * (me.shiftKey ? 10 : 1), 8),
            300
          );
          if (newSize === _szLastSize) return;
          _szLastSize = newSize;
          if (!textEditTarget) return;
          const ta2 = textEditTarget.querySelector('.el-note-content') || textEditTarget;
          ta2.style.fontSize = newSize + 'px';
          const sizeVal = document.getElementById('text-size-val');
          if (sizeVal) sizeVal.textContent = newSize;
          _collabSyncStyle();
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          window._textPanelKeepOpen = false;
          if (_szDragged) {
            _pendingStyleDetail = 'Taille texte modifiée (' + _szLastSize + ')';
            _saveStyleChange();
            setTimeout(() => {
              _szDragged = false;
            }, 50);
          }
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    }
    addEvt('ta-left', 'click', () => applyTextAlign('left'));
    addEvt('ta-center', 'click', () => applyTextAlign('center'));
    addEvt('ta-right', 'click', () => applyTextAlign('right'));
    addEvt('list-bullet-btn', 'click', () => applyListToggle('bullet'));
    addEvt('list-todo-btn', 'click', () => applyListToggle('todo'));
    document.addEventListener('selectionchange', () => {
      if (textEditTarget) _updateListBtns();
    });

    // Panneau alignement multi-sélection
    addEvt('align-left', 'click', () => alignElements('left'));
    addEvt('align-center-h', 'click', () => alignElements('center-h'));
    addEvt('align-right', 'click', () => alignElements('right'));
    addEvt('align-top', 'click', () => alignElements('top'));
    addEvt('align-center-v', 'click', () => alignElements('center-v'));
    addEvt('align-bottom', 'click', () => alignElements('bottom'));
    addEvt('distrib-h', 'click', () => distributeElements('h'));
    addEvt('distrib-v', 'click', () => distributeElements('v'));
    // Panneau bibliothèque
    addEvt('lib-toggle-btn', 'click', () => toggleLibPanel());
    addEvt('lib-add-btn', 'click', () => uploadImages());
    document.getElementById('lib-panel-empty')?.addEventListener('dblclick', () => uploadImages());

    // Les chips de dossier sont créées dynamiquement dans renderFolderChips()

    addEvt('lib-panel-search', 'input', (e) => searchPanelLib(e.target.value));

    document.getElementById('lib-panel-grid')?.addEventListener('click', (e) => {
      if (!e.target.closest('.lib-panel-item')) {
        if (typeof libSelectedIds !== 'undefined') libSelectedIds.clear();
        document
          .querySelectorAll('.lib-panel-item.selected-lib-item')
          .forEach((d) => d.classList.remove('selected-lib-item'));
      }
    });

    // Inputs fichiers cachés
    addEvt('file-input-images', 'change', (e) => handleImageUpload(e));
    addEvt('file-input-file', 'change', (e) => handleFileUpload(e));

    // Modale lien
    addEvt('close-link-modal', 'click', () => closeLinkModal());
    addEvt('submit-link', 'click', () => addLinkElement());

    // Modale rename
    addEvt('close-rename-modal', 'click', () => closeRenameModal());
    addEvt('rename-input', 'keydown', (e) => {
      if (e.key === 'Enter') confirmRename();
    });
    addEvt('submit-rename', 'click', () => confirmRename());

    // Modale création board
    addEvt('close-create-board-modal', 'click', () => closeCreateBoardModal());
    addEvt('create-board-input', 'keydown', (e) => {
      if (e.key === 'Enter') confirmCreateBoard();
      if (e.key === 'Escape') closeCreateBoardModal();
    });
    addEvt('submit-create-board', 'click', () => confirmCreateBoard());

    // Panneau export — sélection format
    addEvt('export-fmt-pdf', 'click', () => {
      document.getElementById('export-fmt-pdf').classList.add('active');
      document.getElementById('export-fmt-png').classList.remove('active');
    });
    addEvt('export-fmt-png', 'click', () => {
      document.getElementById('export-fmt-png').classList.add('active');
      document.getElementById('export-fmt-pdf').classList.remove('active');
    });
    addEvt('export-do-btn', 'click', () => {
      const quality = parseInt(document.getElementById('export-quality-select').value);
      const isPdf = document.getElementById('export-fmt-pdf').classList.contains('active');
      if (isPdf) exportPDF(quality);
      else exportPNG(quality);
    });

    // Menu contextuel
    addEvt('ctx-bring-front', 'click', () => ctxBringFront());
    addEvt('ctx-send-back', 'click', () => ctxSendBack());
    addEvt('ctx-duplicate', 'click', () => ctxDuplicate());
    addEvt('ctx-img-copy', 'click', () => ctxCopyImage());
    addEvt('ctx-img-download', 'click', () => ctxDownloadImage());
    addEvt('ctx-img-replace', 'click', () => ctxReplaceImage());
    addEvt('ctx-img-caption', 'click', () => ctxAddCaption());
    addEvt('ctx-connect', 'click', () => ctxConnect());
    addEvt('ctx-disconnect', 'click', () => ctxDisconnect());
    addEvt('ctx-delete', 'click', () => ctxDelete());

    // Crop
    addEvt('lightbox-crop-btn', 'click', (e) => {
      e.stopPropagation();
      if (_lightboxElId) openCropMode(_lightboxElId);
    });

    addEvt('lightbox-rotate-btn', 'click', (e) => {
      e.stopPropagation();
      _rotateImageCW();
    });

    addEvt('crop-confirm-btn', 'click', (e) => { e.stopPropagation(); _confirmCrop(); });
    addEvt('crop-cancel-btn', 'click', (e) => {
      e.stopPropagation();
      document.getElementById('crop-ui').classList.remove('active');
      document.getElementById('lightbox-content').style.display = 'flex';
    });

    document.getElementById('crop-frame').addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      _cropContainerRect = document.getElementById('crop-container').getBoundingClientRect();
      const handle = e.target.closest('.crop-handle');
      const type = handle
        ? (handle.classList[1] || 'move').replace('crop-', '')
        : 'move';
      _cropDragState = {
        type,
        startX: e.clientX,
        startY: e.clientY,
        startRect: { ..._cropRect },
      };
      document.addEventListener('mousemove', _onCropMouseMove);
      document.addEventListener('mouseup', _onCropMouseUp);
    });

    // Lightbox vidéo
    addEvt('vlb-close-btn', 'click', () => closeVideoLightbox());
  }
  // ── BOARDS ───────────────────────────────────────────────────────────────
  function createBoard() {
    const input = document.getElementById('create-board-input');
    if (input) input.value = '';
    openModal('create-board-modal');
    setTimeout(() => {
      if (input) input.focus();
    }, 80);
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
    const newIdx = boards.length - 1;
    wheelPosition = newIdx;
    wheelTargetPosition = newIdx;
    updateWheel();
  }

  function addBoard(name, render = true) {
    const id = 'board_' + Date.now();
    boards.push({
      id,
      name,
      created: new Date().toLocaleDateString('fr-FR'),
      savedAt: null,
      thumbnail: '',
      elements: [],
    });
    saveBoards();
    if (render) renderBoardsWheel();
    return id;
  }

  function formatSavedAt(ts) {
    if (!ts) return { date: '', time: '' };

    const d = new Date(ts);
    const date = d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return { date, time };
  }

  // ── Roue 3D — étape 3 : base (render, update, scroll) ─────────────────────
  function renderBoardsWheel() {
    hideWheelDetail();
    const container = document.getElementById('boards-wheel');
    const empty = document.getElementById('home-empty');

    if (boards.length === 0) {
      container.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    container.innerHTML = '';
    boards.forEach((b, i) => {
      const card = document.createElement('div');
      card.className = 'wheel-card';
      card.dataset.id = b.id;
      card.dataset.index = i;

      const imgSrc = b.coverImage || b.snapshot;
      if (imgSrc) {
        card.innerHTML = `<img class="wheel-thumb" src="${escHtml(imgSrc)}" alt="">`;
      } else {
        card.innerHTML = `<div class="wheel-name">${escHtml(b.name)}</div>`;
      }

      card.addEventListener('click', () => onWheelCardClick(i, b.id));
      container.appendChild(card);
    });

    updateWheel();
  }

  function updateWheel() {
    const cards = document.querySelectorAll('.wheel-card');
    const N = cards.length;
    if (N === 0) return;

    const activeIdx = ((Math.round(wheelPosition) % N) + N) % N;

    cards.forEach((card, i) => {
      const rawOffset = i - wheelPosition;
      let offset = ((rawOffset % N) + N) % N;
      if (offset > N / 2) offset -= N;

      // Masquer les cartes trop loin (anti-flash antipode).
      // Math.max(1, ...) évite de cacher la carte adjacente quand N=2.
      const MAX_VISIBLE = 4;
      const HIDE_THRESHOLD = Math.min(MAX_VISIBLE, Math.max(1, N / 2 - 0.5));
      if (Math.abs(offset) > HIDE_THRESHOLD) {
        card.style.display = 'none';
        card.style.opacity = 0;
        return;
      }

      const CARD_SPACING = 280;
      const SCALE_FACTOR = 0.72;
      const scale = Math.pow(SCALE_FACTOR, Math.abs(offset));
      const translateX = offset * CARD_SPACING;

      if (_wheelDetailVisible && !wheelRAF && i === activeIdx) {
        card.style.transform = `translateX(${translateX - 260}px) scale(1.5)`;
      } else {
        card.style.transform = `translateX(${translateX}px) scale(${scale.toFixed(4)})`;
      }
      card.style.opacity = 1;
      card.style.zIndex = Math.round(1000 - Math.abs(offset) * 10);
      card.style.display = 'block';
    });

    wheelIndex = activeIdx;
  }

  function setupWheelScroll() {
    if (_wheelScrollWired) return;
    const container = document.getElementById('boards-wheel-container');
    if (!container) return;
    container.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        hideWheelDetail();
        if (_cardTitleTimeout) {
          clearTimeout(_cardTitleTimeout);
          _cardTitleTimeout = null;
        }
        const titleEl = document.getElementById('wheel-card-title');
        if (titleEl) {
          titleEl.style.transition = 'none';
          titleEl.classList.remove('visible');
          requestAnimationFrame(() => {
            titleEl.style.transition = '';
          });
        }
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        wheelTargetPosition += delta * 0.002; // sensibilité scroll (unités d'index)
        if (!wheelRAF) wheelRAF = requestAnimationFrame(wheelTick);
        scheduleWheelSnap();
      },
      { passive: false }
    );
    window.addEventListener('resize', () => updateWheel());
    document.addEventListener('keydown', (e) => {
      if (document.getElementById('home-screen').style.display === 'none') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        hideWheelDetail();
        if (_cardTitleTimeout) {
          clearTimeout(_cardTitleTimeout);
          _cardTitleTimeout = null;
        }
        document.getElementById('wheel-card-title')?.classList.remove('visible');
        wheelTargetPosition -= 1;
        if (!wheelRAF) wheelRAF = requestAnimationFrame(wheelTick);
        scheduleWheelSnap();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        hideWheelDetail();
        if (_cardTitleTimeout) {
          clearTimeout(_cardTitleTimeout);
          _cardTitleTimeout = null;
        }
        document.getElementById('wheel-card-title')?.classList.remove('visible');
        wheelTargetPosition += 1;
        if (!wheelRAF) wheelRAF = requestAnimationFrame(wheelTick);
        scheduleWheelSnap();
      }
    });
    _wheelScrollWired = true;
  }

  let _previewKbdWired = false;
  function setupPreviewKeyboard() {
    if (_previewKbdWired) return;
    _previewKbdWired = true;
  }

  function wheelTick() {
    wheelPosition += (wheelTargetPosition - wheelPosition) * 0.18; // lerp
    updateWheel();
    if (Math.abs(wheelTargetPosition - wheelPosition) > 0.001) {
      wheelRAF = requestAnimationFrame(wheelTick);
    } else {
      wheelPosition = wheelTargetPosition;
      updateWheel();
      wheelRAF = null;
      if (_cardTitleTimeout) {
        clearTimeout(_cardTitleTimeout);
        _cardTitleTimeout = null;
      }
      _cardTitleTimeout = setTimeout(() => {
        _cardTitleTimeout = null;
        if (_wheelDetailVisible) return;
        const titleEl = document.getElementById('wheel-card-title');
        if (titleEl && boards.length > 0) {
          const idx = ((Math.round(wheelPosition) % boards.length) + boards.length) % boards.length;
          const b = boards[idx];
          titleEl.textContent = b ? b.name || '' : '';
          titleEl.classList.add('visible');
        }
      }, 300);
    }
  }

  function scheduleWheelSnap() {
    if (snapTimeout) clearTimeout(snapTimeout);
    snapTimeout = setTimeout(() => {
      const N = boards.length;
      if (N === 0) return;
      wheelTargetPosition = Math.round(wheelTargetPosition);
      // Aucun clamp — la roue est infinie, wheelPosition peut être n'importe quel entier
      if (!wheelRAF) wheelRAF = requestAnimationFrame(wheelTick);
    }, 20);
  }

  function onWheelCardClick(index, boardId) {
    document.getElementById('wheel-card-title')?.classList.remove('visible');
    if (index === wheelIndex) {
      if (_wheelDetailVisible) {
        openBoard(boardId);
      } else {
        showWheelDetail();
      }
      return;
    }
    hideWheelDetail();
    const N = boards.length;
    let diff = index - wheelIndex;
    if (diff > N / 2) diff -= N;
    else if (diff < -N / 2) diff += N;
    wheelTargetPosition += diff;
    if (!wheelRAF) wheelRAF = requestAnimationFrame(wheelTick);
  }

  function showWheelDetail() {
    const N = boards.length;
    if (N === 0) return;
    const idx = ((Math.round(wheelPosition) % N) + N) % N;
    const b = boards[idx];
    if (!b) return;

    const panel = document.getElementById('wheel-info-panel');
    if (!panel) return;

    const wipTitle = panel.querySelector('.wip-title');
    wipTitle.textContent = b.name || '';
    wipTitle.ondblclick = () => _startWipTitleEdit(wipTitle, b);

    const createdFmt = b.createdAt ? formatSavedAt(b.createdAt) : null;
    const createdStr = createdFmt ? createdFmt.date : b.created || '';
    panel.querySelector('[data-field="created"]').textContent = createdStr
      ? 'Créé le ' + createdStr
      : '';

    const savedFmt = formatSavedAt(b.savedAt);
    panel.querySelector('[data-field="saved"]').textContent = savedFmt.date
      ? 'Modifié le ' + savedFmt.date + (savedFmt.time ? ' à ' + savedFmt.time : '')
      : '';

    panel.querySelector('[data-field="count"]').textContent =
      (b.elements?.length || 0) + ' éléments';

    const collabEl = panel.querySelector('[data-field="collab"]');
    if (b.isCollaborative) {
      const getCount = window.Collab && window.Collab.getParticipantCount;
      const n = typeof getCount === 'function' ? getCount(b.collabId) : null;
      collabEl.textContent = n !== null ? `Collab · ${n} participant(s)` : 'Collab activée';
      collabEl.style.color = '#0b36ed';
    } else {
      collabEl.textContent = 'Solo';
      collabEl.style.color = '#ff3c00';
    }

    const editThumbBtn = panel.querySelector('.wip-btn-edit-thumb');
    editThumbBtn.textContent = b.coverImage ? "Changer l'image" : 'Ajouter une image';
    editThumbBtn.onclick = () => openImagePickerForBoard(b.id);

    panel.querySelector('.wip-btn-delete').onclick = () => {
      if (!confirm('Supprimer ce board ? Cette action est définitive.')) return;
      deleteBoard(b.id);
    };

    if (_cardTitleTimeout) {
      clearTimeout(_cardTitleTimeout);
      _cardTitleTimeout = null;
    }
    document.getElementById('wheel-card-title')?.classList.remove('visible');
    _wheelDetailVisible = true;
    panel.classList.add('visible');
    updateWheel();

    // Masquer les cartes non-actives, activer l'overlay snapshot sur la carte active
    const cards = document.querySelectorAll('.wheel-card');
    const nCards = cards.length;
    const activeIdx = ((Math.round(wheelPosition) % nCards) + nCards) % nCards;
    cards.forEach((card, i) => {
      if (i !== activeIdx) {
        card.style.opacity = '0';
        card.style.pointerEvents = 'none';
      } else if (b.snapshot) {
        card.classList.add('wip-detail-active');
        let overlay = card.querySelector('.wheel-snap-overlay');
        if (!overlay) {
          overlay = document.createElement('img');
          overlay.className = 'wheel-snap-overlay';
          overlay.alt = '';
          card.appendChild(overlay);
        }
        overlay.src = b.snapshot;
      }
    });
  }

  // Renommage inline du board depuis le panneau d'infos (double-clic sur le titre).
  // Met à jour la carte en place plutôt que d'appeler renderBoardsWheel, qui fermerait
  // le panneau en cours de consultation via son hideWheelDetail initial.
  function _startWipTitleEdit(titleEl, b) {
    if (titleEl.querySelector('input')) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = b.name || '';
    input.style.cssText =
      'font-family:inherit;font-size:inherit;font-weight:inherit;color:inherit;background:transparent;border:none;border-bottom:1px solid #1a1a1a;outline:none;width:100%;padding:0;box-sizing:border-box;';

    titleEl.textContent = '';
    titleEl.appendChild(input);
    input.focus();
    input.select();

    const save = () => {
      const val = input.value.trim();
      const name = val || b.name;
      if (val && val !== b.name) {
        b.name = name;
        saveBoards();
        const card = document.querySelector('.wheel-card[data-id="' + b.id + '"]');
        const nameEl = card && card.querySelector('.wheel-name');
        if (nameEl) nameEl.textContent = name;
      }
      titleEl.textContent = name;
    };

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
      if (e.key === 'Escape') {
        titleEl.textContent = b.name || '';
      }
    });
    input.addEventListener('blur', save);
  }

  function hideWheelDetail() {
    if (_wheelDetailTimeout) {
      clearTimeout(_wheelDetailTimeout);
      _wheelDetailTimeout = null;
    }
    if (!_wheelDetailVisible) return;
    _wheelDetailVisible = false;
    const panel = document.getElementById('wheel-info-panel');
    if (panel) panel.classList.remove('visible');

    // Restaurer la visibilité et nettoyer l'overlay snapshot
    const cards = document.querySelectorAll('.wheel-card');
    cards.forEach((card) => {
      card.style.opacity = '1';
      card.style.pointerEvents = '';
      card.classList.remove('wip-detail-active');
      const overlay = card.querySelector('.wheel-snap-overlay');
      if (overlay) overlay.remove();
    });

    updateWheel();
  }

  let _actionBarWired = false;
  function setupActionBar() {
    if (_actionBarWired) return;
    const bar = document.getElementById('home-action-bar');
    if (!bar) return;

    const btnCreate = bar.querySelector('.action-create');
    const btnCollab = bar.querySelector('.action-collab');
    const btnSettings = bar.querySelector('.action-settings');

    if (btnCreate) btnCreate.addEventListener('click', () => createBoard());
    if (btnCollab)
      btnCollab.addEventListener('click', () => {
        const input = document.getElementById('join-board-input');
        if (input) input.value = '';
        openModal('join-board-modal');
        setTimeout(() => {
          if (input) input.focus();
        }, 80);
      });
    if (btnSettings) {
      btnSettings.addEventListener('click', () => toast('Paramètres — bientôt disponible'));
    }

    // Empty state CTA (même action que action-create, mais visible quand 0 boards)
    const btnEmptyCta = document.querySelector('.home-empty-cta');
    if (btnEmptyCta) btnEmptyCta.addEventListener('click', () => createBoard());

    _actionBarWired = true;
  }

  let _wheelSearchWired = false;
  function setupWheelSearch() {
    if (_wheelSearchWired) return;
    const input = document.getElementById('wheel-search');
    if (!input) return;
    input.addEventListener('input', (e) => {
      hideWheelDetail();
      const query = (e.target.value || '').toLowerCase().trim();
      if (!query) return;
      const matchIndex = boards.findIndex((b) => (b.name || '').toLowerCase().includes(query));
      if (matchIndex === -1) return;
      const N = boards.length;
      let diff = matchIndex - wheelIndex;
      if (diff > N / 2) diff -= N;
      else if (diff < -N / 2) diff += N;
      wheelTargetPosition += diff;
      if (!wheelRAF) wheelRAF = requestAnimationFrame(wheelTick);
    });
    _wheelSearchWired = true;
  }

  async function openBoard(id) {
    const board = boards.find((b) => b.id === id);
    if (!board) return;

    // Si le board a une session collab dans Firebase, le traiter comme collaboratif
    // Uniquement si on est connecté (navigator.onLine) pour éviter de bloquer indéfiniment
    if (!board.isCollaborative && window._fbDb && navigator.onLine) {
      try {
        if (window._fbAuthReady)
          await Promise.race([
            window._fbAuthReady,
            new Promise((_, reject) => setTimeout(() => reject(new Error('auth timeout')), 3000)),
          ]);
        var collabCheck = await Promise.race([
          window._fbDb.ref('collabSessions/' + id + '/elements').get(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('firebase timeout')), 3000)),
        ]);
        if (collabCheck.exists()) {
          board.isCollaborative = true;
          saveBoards();
          _openCollabBoard(board);
          return;
        }
      } catch (e) {
        /* pas grave, continuer en local */
      }
    }

    // Board collaboratif : auto-reconnexion via Firebase
    if (board.isCollaborative) {
      _openCollabBoard(board);
      return;
    }

    const loaderOverlay = document.getElementById('loader-overlay');
    const loaderFrame = loaderOverlay.querySelector('.loader-frame');
    loaderFrame.style.animation = 'none';
    void loaderFrame.offsetWidth;
    loaderFrame.style.animation = '';
    loaderOverlay.classList.remove('hidden');
    requestAnimationFrame(() =>
      setTimeout(() => {
        // setTimeout(0) : laisse le navigateur peindre le loader avant le code lourd
        currentBoardId = id;
        loadLibraryForBoard(id); // charger la bibliothèque propre à ce board
        document.getElementById('board-title-display').textContent = board.name;
        const pinBtn = document.getElementById('pin-mobile-btn');
        if (pinBtn) {
          if (_currentUser) {
            pinBtn.classList.add('visible');
            _updatePinBtn(_isPinned(id));
          } else {
            pinBtn.classList.remove('visible');
          }
        }
        const shareWrap = document.getElementById('share-wrap');
        if (shareWrap && window._fbDb && !document.body.classList.contains('readonly-mode'))
          shareWrap.style.display = '';
        const _hb1 = document.getElementById('history-btn');
        if (_hb1 && !document.body.classList.contains('readonly-mode')) _hb1.style.display = '';
        const shareMenu = document.getElementById('share-menu');
        if (shareMenu) shareMenu.classList.add('hidden');
        const collabBtn = document.getElementById('collab-btn');
        if (collabBtn) {
          collabBtn.classList.remove('collab-active');
          collabBtn.style.display = '';
        }
        document.getElementById('home-screen').style.display = 'none';
        document.getElementById('board-screen').style.display = 'flex';
        // Réattacher les listeners pinch maintenant que canvas-wrapper est visible
        if (window._reattachPinch) window._reattachPinch();
        document.getElementById('canvas').innerHTML = '';
        zoomLevel = 1;
        panX = 0;
        panY = 0;
        nextZ = 100;
        _actionHistory = [];
        _actionIndex = -1;
        selectedEl = null;
        multiSelected.clear();
        applyTransform();
        updateZoomDisplay();
        const _theme = board.theme || 'dark';
        document.body.classList.toggle('light-mode', _theme === 'light');
        _updateThemeIcon();
        if (board.elements && board.elements.length) {
          board.elements.forEach((e) => restoreElement(e));
          // Attendre le rendu (les images sont asynchrones), puis centrer
          setTimeout(() => {
            fitElementsToScreen(true);
            syncDomToDataset();
          }, 120);
        } else {
          syncDomToDataset();
        }
        renderPanelLib();
        setTimeout(_updateBrokenBanner, 200);
        setTimeout(() => loaderOverlay.classList.add('hidden'), 2000);
      }, 0)
    );
  }

  function goHome() {
    const isCollab = typeof Collab !== 'undefined' && Collab.isActive();
    setConnectorMode(false);
    deactivatePaperFormat();

    // Sauvegarder l'état courant pour les boards collaboratifs
    if (isCollab) {
      const board = boards.find((b) => b.id === currentBoardId);
      if (board) {
        board.elements = _collabGetBoardElements();
        board.savedAt = Date.now();
        saveBoards();
      }
      Collab.endSession();
    }
    // Retirer le mode lecture seule (potentiellement mis par _openCollabBoardLocal)
    document.body.classList.remove('readonly-mode');
    try {
      saveCurrentBoard();
    } catch (e) {
      // Un échec d'écriture IndexedDB est déjà signalé par saveBoards() (toast)
    }
    const _snapId = currentBoardId;
    if (_snapId && _isPinned(_snapId)) _captureAndUploadSnapshot(_snapId);
    document.body.classList.remove('light-mode');
    document.getElementById('board-screen').style.display = 'none';
    document.getElementById('home-screen').style.display = 'flex';
    const shareWrap = document.getElementById('share-wrap');
    if (shareWrap) shareWrap.style.display = 'none';
    const pinBtn = document.getElementById('pin-mobile-btn');
    if (pinBtn) pinBtn.classList.remove('visible', 'active');
    const _hbHome = document.getElementById('history-btn');
    if (_hbHome) _hbHome.style.display = 'none';
    const _hpHome = document.getElementById('history-panel');
    if (_hpHome) _hpHome.classList.add('hidden');
    const shareMenu = document.getElementById('share-menu');
    if (shareMenu) shareMenu.classList.add('hidden');
    const brokenBanner = document.getElementById('broken-images-banner');
    if (brokenBanner) brokenBanner.classList.add('hidden');
    currentBoardId = null;
    selectedEl = null;
    multiSelected.clear();
    renderBoardsWheel();
  }

  function captureBoardThumbnail(scale) {
    scale = scale || 1.5;
    return new Promise((resolve, reject) => {
      const canvasEl = document.getElementById('canvas');
      const els = canvasEl.querySelectorAll('.board-element');
      if (!els.length) {
        reject();
        return;
      }

      // Bounding box — même logique que fitElementsToScreen
      let minL = Infinity,
        minT = Infinity,
        maxR = -Infinity,
        maxB = -Infinity;
      els.forEach((el) => {
        const l = parseFloat(el.style.left) || 0;
        const t = parseFloat(el.style.top) || 0;
        const r = l + el.offsetWidth;
        const b = t + el.offsetHeight;
        if (l < minL) minL = l;
        if (t < minT) minT = t;
        if (r > maxR) maxR = r;
        if (b > maxB) maxB = b;
      });
      const contentW = maxR - minL;
      const contentH = maxB - minT;
      if (contentW <= 0 || contentH <= 0) {
        reject();
        return;
      }

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
      ghost.style.top = '0px';
      ghost.style.transform = 'translate(0px,0px) scale(1)';
      ghost.style.pointerEvents = 'none';
      // Marquer les images crossOrigin pour que useCORS fonctionne correctement
      ghost.querySelectorAll('img').forEach((img) => {
        img.crossOrigin = 'anonymous';
      });
      document.body.appendChild(ghost);
      // Forcer le reflow pour que offsetWidth/offsetHeight soient corrects sur le ghost
      ghost.getBoundingClientRect();

      html2canvas(ghost, {
        scale: scale,
        useCORS: true,
        allowTaint: true,
        x: cropX,
        y: cropY,
        width: cropW,
        height: cropH,
        scrollX: 0,
        scrollY: 0,
      })
        .then((c) => {
          ghost.remove();
          resolve({ dataUrl: c.toDataURL('image/png'), cropW, cropH });
        })
        .catch((err) => {
          ghost.remove();
          reject(err);
        });
    });
  }

  function _uploadBoardSnapshot(boardId, dataUrl, mimeType) {
    mimeType = mimeType || 'image/png';
    if (!window._fbStorage || !boardId) return Promise.resolve(null);
    var byteString = atob(dataUrl.split(',')[1]);
    var ab = new ArrayBuffer(byteString.length);
    var ia = new Uint8Array(ab);
    for (var i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    var blob = new Blob([ab], { type: mimeType });
    var ext = mimeType === 'image/png' ? 'png' : 'jpg';
    var ref = window._fbStorage.ref('boards/' + boardId + '/snapshot.' + ext);
    return ref.put(blob, { contentType: mimeType }).then(function (snap) {
      return snap.ref.getDownloadURL();
    });
  }

  /** Convertit une data URL base64 en { blob, mime } pour Firebase Storage. */
  function _dataUrlToBlob(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const mime = (dataUrl.slice(0, comma).match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(dataUrl.slice(comma + 1));
    const ab = new ArrayBuffer(bin.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < bin.length; i++) ia[i] = bin.charCodeAt(i);
    return { blob: new Blob([ab], { type: mime }), mime };
  }

  const _STORAGE_EXT = {
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
  };

  /**
   * Envoie vers Firebase Storage les images du board courant et mémorise leur URL
   * dans `dataset.storageurl`. Les écritures Firebase retirent le base64 (sinon
   * « Write too large ») : sans ces URLs, un board partagé n'a aucune image.
   * @returns {Promise<{ok:number, fail:number}>}
   */
  async function _uploadBoardImagesToStorage(boardId) {
    if (!window._fbStorage || !boardId) return { ok: 0, fail: 0 };
    const els = [...document.querySelectorAll('#canvas .board-element[data-type="image"]')];
    let ok = 0;
    let fail = 0;
    for (const el of els) {
      const id = el.dataset.id;
      const src = _imgStore.get(id) || el.dataset.savedata || '';
      if (!src) {
        fail++;
        continue;
      }
      // Déjà une URL distante (image collab par exemple) : rien à envoyer
      if (/^https?:/i.test(src)) {
        el.dataset.storageurl = src;
        ok++;
        continue;
      }
      if (!src.startsWith('data:')) {
        fail++;
        continue;
      }
      try {
        const { blob, mime } = _dataUrlToBlob(src);
        const ext = _STORAGE_EXT[mime] || 'jpg';
        // Nom de fichier sur un seul segment : la règle Storage est
        // match /boards/{boardId}/{filename}
        const ref = window._fbStorage.ref('boards/' + boardId + '/img_' + id + '.' + ext);
        const snap = await ref.put(blob, { contentType: mime });
        el.dataset.storageurl = await snap.ref.getDownloadURL();
        ok++;
      } catch (_) {
        fail++;
      }
    }
    return { ok, fail };
  }

  /**
   * Prépare le partage : envoie les images vers Storage, sauvegarde (ce qui écrit
   * les URLs dans Firebase), puis copie le lien de lecture seule.
   */
  async function _shareBoardLink() {
    if (!currentBoardId) {
      toast('Aucun board ouvert');
      return;
    }
    const nbImg = document.querySelectorAll('#canvas .board-element[data-type="image"]').length;
    if (nbImg) toast('Préparation des images…');
    const res = await _uploadBoardImagesToStorage(currentBoardId);
    saveCurrentBoard(); // écrit les URLs fraîches dans boards/{id}
    const shareUrl = SHARE_BASE_URL + '/?board=' + currentBoardId;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast(
        res.fail
          ? 'Lien copié — ' + res.fail + ' image(s) non envoyée(s)'
          : 'Lien de lecture seule copié !'
      );
    } catch (_) {
      toast('URL : ' + shareUrl);
    }
  }

  function _captureAndUploadSnapshot(boardId) {
    if (typeof html2canvas === 'undefined' || !window._fbStorage || !window._fbDb) return;
    captureBoardThumbnail(1.5).then(function (result) {
      // Redimensionner à max 1800px (longest side) pour éviter crash iOS, JPEG 92%
      var img = new Image();
      img.onload = function () {
        var maxDim = 1800;
        var w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w >= h) { h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        var jpeg = cv.toDataURL('image/jpeg', 0.92);
        _uploadBoardSnapshot(boardId, jpeg, 'image/jpeg').then(function (url) {
          if (url && window._fbDb) {
            window._fbDb.ref('boards/' + boardId + '/snapshotUrl').set(url).catch(function () {});
            if (_currentUser) {
              window._fbDb.ref('users/' + _currentUser.uid + '/boards/' + boardId + '/snapshotUrl').set(url).catch(function () {});
            }
          }
        }).catch(function () {});
      };
      img.src = result.dataUrl;
    }).catch(function () {});
  }

  function deleteBoard(id) {
    if (!id) return;
    const board = boards.find((b) => b.id === id);
    boards = boards.filter((b) => b.id !== id);
    saveBoards();
    renderBoardsWheel();
    if (typeof Collab !== 'undefined') {
      Collab.deleteSession(id);
    }
  }

  function renameBoardPrompt(id) {
    renamingBoardId = id;
    const b = boards.find((b) => b.id === id);
    document.getElementById('rename-input').value = b ? b.name : '';
    openModal('rename-modal');
    setTimeout(() => document.getElementById('rename-input').focus(), 80);
  }
  function confirmRename() {
    const val = document.getElementById('rename-input').value.trim();
    if (!val) return;
    const b = boards.find((b) => b.id === renamingBoardId);
    if (b) {
      b.name = val;
      saveBoards();
      renderBoardsWheel();
    }
    if (currentBoardId === renamingBoardId)
      document.getElementById('board-title-display').textContent = val;
    closeModal('rename-modal');
  }
  function closeRenameModal() {
    closeModal('rename-modal');
  }

  // ── CANVAS / ZOOM / PAN ──────────────────────────────────────────────────
  function clampPan() {
    const wrapper = document.getElementById('canvas-wrapper');
    const vw = wrapper ? wrapper.offsetWidth : window.innerWidth;
    const vh = wrapper ? wrapper.offsetHeight : window.innerHeight;
    const els = Array.from(document.querySelectorAll('#canvas .board-element'));
    let minX, minY, maxX, maxY;
    if (els.length) {
      minX = Math.min(...els.map((e) => parseFloat(e.style.left) || 0));
      minY = Math.min(...els.map((e) => parseFloat(e.style.top) || 0));
      maxX = Math.max(...els.map((e) => (parseFloat(e.style.left) || 0) + e.offsetWidth));
      maxY = Math.max(...els.map((e) => (parseFloat(e.style.top) || 0) + e.offsetHeight));
    } else {
      minX = 0;
      minY = 0;
      maxX = vw / zoomLevel;
      maxY = vh / zoomLevel;
    }
    const W = (maxX - minX) * zoomLevel;
    const H = (maxY - minY) * zoomLevel;
    const marginX = 0.05 * W;
    const marginY = 0.05 * H;
    const extW = W + 2 * marginX; // = 1.1 * W
    const extH = H + 2 * marginY;
    if (extW <= vw) {
      // Contenu + marge tient dans le viewport : le board ne peut pas sortir de la zone
      panX = Math.min(Math.max(panX, marginX - minX * zoomLevel), vw - maxX * zoomLevel - marginX);
    } else {
      // Zoomé : pan libre mais le bord droit/gauche du contenu reste visible (5% marge)
      panX = Math.min(Math.max(panX, marginX - maxX * zoomLevel), vw - marginX - minX * zoomLevel);
    }
    if (extH <= vh) {
      panY = Math.min(Math.max(panY, marginY - minY * zoomLevel), vh - maxY * zoomLevel - marginY);
    } else {
      panY = Math.min(Math.max(panY, marginY - maxY * zoomLevel), vh - marginY - minY * zoomLevel);
    }
  }

  function applyTransform() {
    // Le bloc de restriction à 0.15 a été retiré pour supprimer le glitch
    document.getElementById('canvas').style.transform =
      `translate(${panX}px,${panY}px) scale(${zoomLevel})`;

    updateMultiResizeHandle();
    updateCornerHandles();
  }

  function updateCornerHandles() {
    const corners = ['nw', 'ne', 'sw', 'se'];
    const edges = ['n', 'e', 's', 'w'];
    const target = multiSelected.size > 0 ? null : hoveredEl || selectedEl;
    if (!target) {
      _cornerHandlesTarget = null;
      corners.forEach((c) => {
        const h = document.getElementById('resize-corner-' + c);
        if (h) h.style.display = 'none';
      });
      edges.forEach((edge) => {
        const h = document.getElementById('resize-edge-' + edge);
        if (h) h.style.display = 'none';
      });
      return;
    }
    _cornerHandlesTarget = target;
    const r = target.getBoundingClientRect();
    const pos = {
      nw: { left: r.left, top: r.top },
      ne: { left: r.right, top: r.top },
      sw: { left: r.left, top: r.bottom },
      se: { left: r.right, top: r.bottom },
    };
    const t = target.dataset.type;
    corners.forEach((c) => {
      const h = document.getElementById('resize-corner-' + c);
      if (!h) return;
      if (t === 'note') {
        h.style.display = 'none';
        return;
      }
      h.style.display = 'block';
      h.style.left = pos[c].left + 'px';
      h.style.top = pos[c].top + 'px';
    });
    const showEdges = t === 'note' || t === 'color';
    const edgePos = {
      n: { left: (r.left + r.right) / 2, top: r.top },
      e: { left: r.right, top: (r.top + r.bottom) / 2 },
      s: { left: (r.left + r.right) / 2, top: r.bottom },
      w: { left: r.left, top: (r.top + r.bottom) / 2 },
    };
    const edgeSize = {
      n: { width: r.right - r.left, height: 12 },
      s: { width: r.right - r.left, height: 12 },
      e: { width: 12, height: r.bottom - r.top },
      w: { width: 12, height: r.bottom - r.top },
    };
    edges.forEach((edge) => {
      const h = document.getElementById('resize-edge-' + edge);
      if (!h) return;
      if (!showEdges || (t === 'note' && (edge === 'n' || edge === 's'))) {
        h.style.display = 'none';
        return;
      }
      h.style.display = 'block';
      h.style.left = edgePos[edge].left + 'px';
      h.style.top = edgePos[edge].top + 'px';
      h.style.width = edgeSize[edge].width + 'px';
      h.style.height = edgeSize[edge].height + 'px';
    });
  }

  function setupCornerHandles() {
    ['nw', 'ne', 'sw', 'se'].forEach((corner) => {
      const handle = document.getElementById('resize-corner-' + corner);
      if (!handle) return;
      handle.addEventListener('mouseenter', () => {
        clearTimeout(_hoverLeaveTimer);
      });
      handle.addEventListener('mouseleave', () => {
        _hoverLeaveTimer = setTimeout(() => {
          hoveredEl = null;
          updateCornerHandles();
        }, 200);
      });
      handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const _target = _cornerHandlesTarget;
        if (!_target) return;
        if (document.body.classList.contains('readonly-mode')) return;
        if (typeof Collab !== 'undefined' && Collab.isActive()) {
          if (Collab.isLockedByOther(_target.dataset.id)) {
            toast('Élément verrouillé');
            return;
          }
          Collab.acquireLock(_target.dataset.id);
        }
        isResizing = true;
        resizeEl = _target;
        resizeStartW = _target.offsetWidth;
        resizeStartH = _target.offsetHeight;
        resizeStartLeft = parseFloat(_target.style.left) || 0;
        resizeStartTop = parseFloat(_target.style.top) || 0;
        _resizeTargetW = resizeStartW;
        _resizeTargetH = resizeStartH;
        _resizeTargetLeft = resizeStartLeft;
        _resizeTargetTop = resizeStartTop;
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        resizeCorner = corner;
        const t = _target.dataset.type;
        if (t === 'note' || t === 'color') {
          resizeRatio = null;
        } else if (_target.dataset.ratio) {
          resizeRatio = parseFloat(_target.dataset.ratio);
        } else {
          resizeRatio = resizeStartH > 0 ? resizeStartW / resizeStartH : null;
        }
      });
    });
  }

  function setupEdgeHandles() {
    ['n', 'e', 's', 'w'].forEach((edge) => {
      const handle = document.getElementById('resize-edge-' + edge);
      if (!handle) return;
      handle.addEventListener('mouseenter', () => {
        clearTimeout(_hoverLeaveTimer);
      });
      handle.addEventListener('mouseleave', () => {
        _hoverLeaveTimer = setTimeout(() => {
          hoveredEl = null;
          updateCornerHandles();
        }, 200);
      });
      handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const _target = _cornerHandlesTarget;
        if (!_target) return;
        if (document.body.classList.contains('readonly-mode')) return;
        if (typeof Collab !== 'undefined' && Collab.isActive()) {
          if (Collab.isLockedByOther(_target.dataset.id)) {
            toast('Élément verrouillé');
            return;
          }
          Collab.acquireLock(_target.dataset.id);
        }
        isResizing = true;
        resizeEl = _target;
        resizeStartW = _target.offsetWidth;
        resizeStartH = _target.offsetHeight;
        resizeStartLeft = parseFloat(_target.style.left) || 0;
        resizeStartTop = parseFloat(_target.style.top) || 0;
        _resizeTargetW = resizeStartW;
        _resizeTargetH = resizeStartH;
        _resizeTargetLeft = resizeStartLeft;
        _resizeTargetTop = resizeStartTop;
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        resizeCorner = edge;
        resizeRatio = null;
      });
    });
  }

  function updateZoomDisplay() {}
  function zoomIn() {
    zoomLevel = Math.min(zoomLevel + 0.1, 4);
    applyTransform();
    updateZoomDisplay();
  }
  function zoomOut() {
    zoomLevel = Math.max(zoomLevel - 0.1, 0.08);
    applyTransform();
    updateZoomDisplay();
  }
  function resetZoom() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    applyTransform();
    updateZoomDisplay();
  }
  function fitToScreen() {
    zoomLevel = 0.45;
    panX = 80;
    panY = 60;
    applyTransform();
    updateZoomDisplay();
  }

  let _fitRaf = null;

  function fitElementsToScreen(instant = false) {
    const els = document.querySelectorAll('#canvas .board-element');
    if (!els.length) return;
    // Bounding box de tous les éléments en coordonnées canvas
    let minL = Infinity,
      minT = Infinity,
      maxR = -Infinity,
      maxB = -Infinity;
    els.forEach((el) => {
      const l = parseFloat(el.style.left) || 0;
      const t = parseFloat(el.style.top) || 0;
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
    const targetZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.1), 3);

    // Pan pour centrer le bounding box + marge dans la fenêtre
    const zoneLeft = minL - marginX;
    const zoneTop = minT - marginY;
    const targetPanX = (vw - totalW * targetZoom) / 2 - zoneLeft * targetZoom;
    const targetPanY = (vh - totalH * targetZoom) / 2 - zoneTop * targetZoom;

    if (instant) {
      zoomLevel = targetZoom;
      panX = targetPanX;
      panY = targetPanY;
      applyTransform();
      updateZoomDisplay();
      return;
    }

    // Animation fluide vers la cible
    if (_fitRaf) cancelAnimationFrame(_fitRaf);
    const startZoom = zoomLevel;
    const startPanX = panX;
    const startPanY = panY;
    const duration = 420;
    const startTime = performance.now();

    function easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = easeOutCubic(progress);

      zoomLevel = startZoom + (targetZoom - startZoom) * ease;
      panX = startPanX + (targetPanX - startPanX) * ease;
      panY = startPanY + (targetPanY - startPanY) * ease;

      applyTransform();
      if (progress < 1) {
        _fitRaf = requestAnimationFrame(step);
      } else {
        zoomLevel = targetZoom;
        panX = targetPanX;
        panY = targetPanY;
        applyTransform();
        updateZoomDisplay();
        _fitRaf = null;
      }
    }

    _fitRaf = requestAnimationFrame(step);
  }

  // ── MODE APERÇU PLEIN ÉCRAN ─────────────────────────────────────────────
  let previewMode = false;

  function _exitPreviewAnimated() {
    // Toujours fermer le panneau bibliothèque à la sortie du preview
    if (libPanelOpen) {
      libPanelOpen = false;
      document.getElementById('lib-panel').classList.remove('open');
    }

    const header = document.getElementById('board-header');
    const toolbar = document.getElementById('toolbar');
    const libPanel = document.getElementById('lib-panel');
    const fitGroup = document.querySelector('.fit-btn-group');
    const delay = 180;
    const duration = 380;
    const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';

    // Pré-positionner les éléments hors-écran (invisibles : couverts par le canvas ou display:none)
    header.style.transform = 'translateY(-100%)';
    toolbar.style.transform = 'translateX(-100%)';
    // lib-panel (fermé, width:0) : l'onglet dépasse de 38px à gauche → le cacher vers la droite
    libPanel.style.transform = 'translateX(38px)';
    if (fitGroup) fitGroup.style.opacity = '0';

    // Supprimer preview-mode : éléments redeviennent visibles à leur position de départ
    previewMode = false;
    document.body.classList.remove('preview-mode');

    // Forcer le reflow avant de démarrer la transition
    void toolbar.offsetWidth;

    const t = `transform ${duration}ms ${ease} ${delay}ms`;
    header.style.transition = t;
    toolbar.style.transition = t;
    libPanel.style.transition = `transform ${duration}ms ${ease} ${delay}ms, width 0.32s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.32s cubic-bezier(0.4, 0, 0.2, 1)`;
    header.style.transform = '';
    toolbar.style.transform = '';
    libPanel.style.transform = '';

    // Fade-in du groupe fit-btn avec décalage
    if (fitGroup) {
      fitGroup.style.transition = `opacity ${Math.round(duration * 0.6)}ms ease ${delay + Math.round(duration * 0.3)}ms`;
      fitGroup.style.opacity = '';
    }

    const cleanup = delay + duration + 60;
    setTimeout(() => {
      header.style.transition = '';
      toolbar.style.transition = '';
      libPanel.style.transition = '';
      libPanel.style.transform = '';
      if (fitGroup) {
        fitGroup.style.transition = '';
        fitGroup.style.opacity = '';
      }
    }, cleanup);

    requestAnimationFrame(() => fitElementsToScreen());
  }

  // Synchroniser previewMode si l'utilisateur quitte le plein écran via Échap/F11 natif
  document.addEventListener('fullscreenchange', () => {
    const isFs = !!document.fullscreenElement;
    if (!isFs && previewMode) {
      // Le plein écran a été quitté sans passer par togglePreviewMode → animation de sortie
      _exitPreviewAnimated();
    } else if (isFs && previewMode) {
      // Fullscreen effectif : recalculer le fit avec les vraies dimensions plein écran
      requestAnimationFrame(() => fitElementsToScreen(true));
    }
  });

  function togglePreviewMode() {
    previewMode = !previewMode;
    document.body.classList.toggle('preview-mode', previewMode);
    if (previewMode) {
      // Fermer le panneau bibliothèque avant d'entrer en preview
      if (libPanelOpen) {
        libPanelOpen = false;
        document.getElementById('lib-panel').classList.remove('open');
      }
      // Demander le plein écran natif (F11) — navigationUI:'hide' masque la vignette Chrome
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      }
      // Ajuster la vue (fallback si fullscreen refusé — sinon géré par fullscreenchange)
      requestAnimationFrame(() => requestAnimationFrame(() => fitElementsToScreen(true)));
    } else {
      // Quitter le plein écran natif si actif
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      _exitPreviewAnimated();
    }
  }

  function setupCanvasEvents() {
    const wrapper = document.getElementById('canvas-wrapper');
    const canvas = document.getElementById('canvas');
    const selRect = document.getElementById('selection-rect');

    // Prevent the browser from scrolling canvas-wrapper when a focused contenteditable
    // grows beyond the visible area — this scroll corrupts all getBoundingClientRect coords.
    wrapper.addEventListener(
      'scroll',
      () => {
        wrapper.scrollTop = 0;
        wrapper.scrollLeft = 0;
      },
      { passive: true }
    );

    let wheelTargetX = null;
    let wheelTargetY = null;

    // Alt+molette = zoom, molette seule = pan
    // Alt+molette OU Pavé tactile (pinch) = zoom, molette seule = pan
    const _isBoardLoading = () => {
      const ov = document.getElementById('loader-overlay');
      return !!(ov && !ov.classList.contains('hidden'));
    };
    // Bloquer wheel et touchmove pendant le chargement du board, peu importe
    // l'élément cible (le loader-overlay couvre l'écran et n'est pas dans
    // la chaîne d'ancêtres de wrapper, donc le early-return sur wrapper seul
    // ne suffit pas).
    document.addEventListener(
      'wheel',
      (e) => {
        if (_isBoardLoading()) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        if (document.getElementById('_csp_panel')) {
          e.preventDefault();
          return;
        }
        const boardScreen = document.getElementById('board-screen');
        if (boardScreen && boardScreen.style.display !== 'none') {
          const libPanel = document.getElementById('lib-panel');
          if (libPanel && libPanel.contains(e.target)) return;
          const histPanel = document.getElementById('history-panel');
          if (histPanel && histPanel.contains(e.target)) return;
          const fontDropdown = document.getElementById('font-selector-dropdown');
          if (fontDropdown && fontDropdown.contains(e.target)) return;
          e.preventDefault();
          // Les resize handles sont position:fixed rattachés au body (hors canvas-wrapper).
          // Si le target n'est pas dans le wrapper, on applique manuellement le zoom/pan
          // car le handler du wrapper ne sera jamais atteint via le bubbling.
          const wrapperEl = document.getElementById('canvas-wrapper');
          if (wrapperEl && !wrapperEl.contains(e.target)) {
            if (e.altKey || e.ctrlKey) {
              const rawMul = Math.exp(-e.deltaY * 0.01);
              const cappedMul = Math.min(Math.max(rawMul, 0.5), 2.0);
              const newZ = Math.min(Math.max(zoomLevel * cappedMul, 0.08), 4);
              if (Math.abs(newZ - zoomLevel) > 0.001) {
                const rect = wrapperEl.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;
                panX = mx - (mx - panX) * (newZ / zoomLevel);
                panY = my - (my - panY) * (newZ / zoomLevel);
                zoomLevel = newZ;
                applyTransform();
                updateZoomDisplay();
              }
            } else {
              panX -= e.deltaX;
              panY -= e.deltaY;
              clampPan();
              applyTransform();
            }
          }
        }
      },
      { capture: true, passive: false }
    );
    document.addEventListener(
      'touchmove',
      (e) => {
        if (_isBoardLoading()) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      { capture: true, passive: false }
    );
    wrapper.addEventListener(
      'wheel',
      (e) => {
        if (_isBoardLoading()) {
          e.preventDefault();
          return;
        }
        if (document.getElementById('_csp_panel')) {
          e.preventDefault();
          return;
        }
        e.preventDefault();

        // Détecte soit Alt + Molette, soit le Pinch du pavé tactile
        if (e.altKey || e.ctrlKey) {
          // Formule multiplicative : sensibilité uniforme à tous les niveaux de zoom.
          // Plafond du multiplicateur par event pour éviter un saut énorme avec
          // un cran de molette de souris classique.
          const rawMul = Math.exp(-e.deltaY * 0.01);
          const cappedMul = Math.min(Math.max(rawMul, 0.5), 2.0);
          const newZ = Math.min(Math.max(zoomLevel * cappedMul, 0.08), 4);

          if (Math.abs(newZ - zoomLevel) > 0.001) {
            const rect = wrapper.getBoundingClientRect();
            const mx = e.clientX - rect.left,
              my = e.clientY - rect.top;

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
          clampPan();
          applyTransform();
        }
      },
      { passive: false }
    );

    // ── DÉPLACEMENT TACTILE À DEUX DOIGTS (LIBRE EN X/Y) ──
    let isTouchPanning = false;
    let touchStartX = 0;
    let touchStartY = 0;
    let initialPanX = 0;
    let initialPanY = 0;
    let initialPinchDist = 0;
    let initialZoomForPinch = 1;

    wrapper.addEventListener(
      'touchstart',
      (e) => {
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
          if (wheelRaf) {
            cancelAnimationFrame(wheelRaf);
            wheelRaf = null;
          }

          const dx = e.touches[1].clientX - e.touches[0].clientX;
          const dy = e.touches[1].clientY - e.touches[0].clientY;
          initialPinchDist = Math.sqrt(dx * dx + dy * dy);
          initialZoomForPinch = zoomLevel;
        }
      },
      { passive: false }
    );

    wrapper.addEventListener(
      'touchmove',
      (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        if (_isBoardLoading()) {
          e.preventDefault();
          return;
        }

        if (isTouchPanning && e.touches.length === 2) {
          e.preventDefault();

          // Point central courant
          const currentX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const currentY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

          // Pan
          panX = initialPanX + (currentX - touchStartX);
          panY = initialPanY + (currentY - touchStartY);
          clampPan();

          // Pinch-to-zoom — sensibilité basée sur le delta en pixels
          // (indépendant de l'écartement absolu des doigts et du zoom courant)
          if (initialPinchDist > 0) {
            const dx = e.touches[1].clientX - e.touches[0].clientX;
            const dy = e.touches[1].clientY - e.touches[0].clientY;
            const newDist = Math.sqrt(dx * dx + dy * dy);
            const deltaPx = newDist - initialPinchDist;
            initialPinchDist = newDist;
            const newZ = Math.min(Math.max(zoomLevel * Math.exp(deltaPx * 0.08), 0.08), 4);

            if (Math.abs(newZ - zoomLevel) > 0.001) {
              const rect = wrapper.getBoundingClientRect();
              const mx = currentX - rect.left;
              const my = currentY - rect.top;
              panX = mx - (mx - panX) * (newZ / zoomLevel);
              panY = my - (my - panY) * (newZ / zoomLevel);
              zoomLevel = newZ;
            }
          }

          applyTransform();
        }
      },
      { passive: false }
    );

    wrapper.addEventListener(
      'touchend',
      (e) => {
        // Désactiver le mode pan dès qu'on relâche un doigt
        if (e.touches.length < 2) {
          isTouchPanning = false;
        }
      },
      { passive: false }
    );

    // Sécurité pour stopper net l'inertie si on clique pour faire un pan manuel (espace + clic / clic molette)
    wrapper.addEventListener(
      'mousedown',
      () => {
        if (wheelRaf) {
          cancelAnimationFrame(wheelRaf);
          wheelRaf = null;
        }
      },
      true
    );

    // Pan global (clic molette ou espace + clic gauche) — capturé AVANT les handlers
    // d'éléments enfants pour fonctionner même si le curseur est au-dessus d'un élément.
    let _wasJustPanning = false;
    wrapper.addEventListener(
      'mousedown',
      (e) => {
        if (document.getElementById('_csp_panel')) return;
        if (e.button === 1 || (isPanningMode && e.button === 0)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          isPanning = true;
          _wasJustPanning = true;
          panStart = { x: e.clientX - panX, y: e.clientY - panY };
          document.body.classList.add('is-panning');
        }
      },
      true
    );
    // Bloquer le click qui suit immédiatement un pan (sinon le trackpad
    // déclenche un click natif qui sélectionne l'élément cliqué).
    wrapper.addEventListener(
      'click',
      (e) => {
        if (_wasJustPanning) {
          e.preventDefault();
          e.stopImmediatePropagation();
          _wasJustPanning = false;
        }
      },
      true
    );

    // Clic molette (button 1) sur n'importe quelle zone = pan
    wrapper.addEventListener('mousedown', (e) => {
      if (document.getElementById('_csp_panel')) return;
      if (e.button === 1) {
        e.preventDefault();
        isPanning = true;
        panStart = { x: e.clientX - panX, y: e.clientY - panY };
        wrapper.style.cursor = 'grabbing';
        return;
      }

      // Mousedown sur canvas vide : pan OU rectangle de sélection
      if (e.target !== canvas && e.target !== wrapper) return;
      if (e.button !== 0) return;

      if (isPanningMode) {
        // Mode pan (espace enfoncé)
        isPanning = true;
        panStart = { x: e.clientX - panX, y: e.clientY - panY };
        wrapper.style.cursor = 'grabbing';
        return;
      }

      if (document.body.classList.contains('readonly-mode')) {
        isPanning = true;
        panStart = { x: e.clientX - panX, y: e.clientY - panY };
        wrapper.style.cursor = 'grabbing';
        return;
      }

      // Rectangle de sélection
      hideContextMenu();
      // Désélectionner les items du panneau bibliothèque
      libSelectedIds.clear();
      document
        .querySelectorAll('.lib-panel-item.selected-lib-item')
        .forEach((d) => d.classList.remove('selected-lib-item'));
      // Blur tout input actif hors canvas pour débloquer isTyping
      const ae = document.activeElement;
      if (ae && ae !== document.body && !document.getElementById('canvas').contains(ae)) {
        ae.blur();
      }
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        deselectAll();
        multiSelected.clear();
      }
      isSelecting = true;
      document.body.classList.add('is-selecting');
      const wRect = wrapper.getBoundingClientRect();
      selRectStart = { x: e.clientX - wRect.left, y: e.clientY - wRect.top };
      selRect.style.left = selRectStart.x + 'px';
      selRect.style.top = selRectStart.y + 'px';
      selRect.style.width = '0px';
      selRect.style.height = '0px';
      selRect.style.display = 'block';
    });

    window.addEventListener('mousemove', (e) => {
      // Envoyer la position du curseur pour la collaboration
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        const wRect = wrapper.getBoundingClientRect();
        const cx = (e.clientX - wRect.left - panX) / zoomLevel;
        const cy = (e.clientY - wRect.top - panY) / zoomLevel;
        Collab.sendCursor(cx, cy);
      }
      if (isPanning) {
        panX = e.clientX - panStart.x;
        panY = e.clientY - panStart.y;
        clampPan();
        applyTransform();
      }
      if (isResizing && resizeEl) handleResizeMouse(e);
      if (isSelecting) {
        const wRect = wrapper.getBoundingClientRect();
        const cx = e.clientX - wRect.left;
        const cy = e.clientY - wRect.top;
        const x = Math.min(cx, selRectStart.x);
        const y = Math.min(cy, selRectStart.y);
        const w = Math.abs(cx - selRectStart.x);
        const h = Math.abs(cy - selRectStart.y);
        selRect.style.left = x + 'px';
        selRect.style.top = y + 'px';
        selRect.style.width = w + 'px';
        selRect.style.height = h + 'px';
        // Sync du rectangle de sélection pour la collaboration
        if (typeof Collab !== 'undefined' && Collab.isActive()) {
          const canvasX = (x - panX) / zoomLevel;
          const canvasY = (y - panY) / zoomLevel;
          const canvasW = w / zoomLevel;
          const canvasH = h / zoomLevel;
          Collab.sendSelectionRect(canvasX, canvasY, canvasW, canvasH);
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (isPanning) {
        isPanning = false;
        wrapper.style.cursor = '';
        document.body.classList.remove('is-panning');
        // Reset différé : laisse passer un éventuel click event natif (consommé
        // par le capture handler), puis libère le flag pour les clicks suivants.
        setTimeout(() => {
          _wasJustPanning = false;
        }, 0);
      }
      if (isResizing) {
        // Cancel any pending RAF and apply final values immediately
        if (_resizeRafId) {
          cancelAnimationFrame(_resizeRafId);
          _resizeRafId = null;
        }
        if (resizeEl) {
          resizeEl.style.width = _resizeTargetW + 'px';
          if (resizeEl.dataset.type !== 'note') resizeEl.style.height = _resizeTargetH + 'px';
          resizeEl.style.left = _resizeTargetLeft + 'px';
          resizeEl.style.top = _resizeTargetTop + 'px';
          if (resizeEl.dataset.type === 'file') {
            const fw = resizeEl.querySelector('.el-file');
            if (fw) {
              fw.style.transform = 'scale(' + _resizeTargetW / 260 + ')';
              fw.style.transformOrigin = 'top left';
            }
          }
        }
        // Collab: sync taille + position finale + libérer le lock
        if (typeof Collab !== 'undefined' && Collab.isActive() && resizeEl) {
          const fw = parseFloat(resizeEl.style.width) || null;
          const fh = parseFloat(resizeEl.style.height) || null;
          const fx = parseFloat(resizeEl.style.left) || 0;
          const fy = parseFloat(resizeEl.style.top) || 0;
          Collab.syncElementSize(resizeEl.dataset.id, fw, fh, true);
          Collab.syncElementPosition(resizeEl.dataset.id, fx, fy, true);
          Collab.releaseLock(resizeEl.dataset.id);
          // Collab: sync la nouvelle position des captions attachées
          const _rElId = resizeEl.dataset.id;
          if (_rElId) {
            document.querySelectorAll(`.el-caption[data-parent-id="${_rElId}"]`).forEach((cap) => {
              if (cap.dataset.capId) {
                Collab.syncCaption(
                  cap.dataset.capId,
                  _rElId,
                  parseFloat(cap.style.left) || 0,
                  parseFloat(cap.style.top) || 0,
                  cap.style.width || '',
                  cap.textContent || ''
                );
              }
            });
          }
        }
        // Action-based undo for resize
        if (resizeEl) {
          const afterW = parseFloat(resizeEl.style.width) || null;
          const afterH = parseFloat(resizeEl.style.height) || null;
          const afterX = parseFloat(resizeEl.style.left) || 0;
          const afterY = parseFloat(resizeEl.style.top) || 0;
          if (afterW !== resizeStartW || afterH !== resizeStartH) {
            pushAction({
              type: 'resize',
              elId: resizeEl.dataset.id,
              before: { w: resizeStartW, h: resizeStartH, x: resizeStartLeft, y: resizeStartTop },
              after: { w: afterW, h: afterH, x: afterX, y: afterY },
            });
          }
        }
        isResizing = false;
        resizeEl = null;
        clearSnapGuides();
        syncDomToDataset();
        updateCornerHandles();
      }
      if (isSelecting) {
        isSelecting = false;
        document.body.classList.remove('is-selecting');
        selRect.style.display = 'none';
        // Effacer le rectangle de sélection distant
        if (typeof Collab !== 'undefined' && Collab.isActive()) Collab.clearSelectionRect();
        // Calculer les éléments dans le rectangle
        const wRect = wrapper.getBoundingClientRect();
        const rLeft = parseFloat(selRect.style.left);
        const rTop = parseFloat(selRect.style.top);
        const rRight = rLeft + parseFloat(selRect.style.width);
        const rBot = rTop + parseFloat(selRect.style.height);
        // Seulement si le rectangle a une taille significative
        if (parseFloat(selRect.style.width) > 4 || parseFloat(selRect.style.height) > 4) {
          document.querySelectorAll('#canvas .board-element').forEach((el) => {
            const elRect = el.getBoundingClientRect();
            const elL = elRect.left - wRect.left;
            const elT = elRect.top - wRect.top;
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
        // Sync de la sélection pour la collaboration
        _collabSyncSelection();
      }
    });

    // Drop depuis panneau lib
    wrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      // position et affichage gérés par le listener document (dragstart lib item)
    });
    wrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      const _pvEl = document.getElementById('drag-custom-preview');
      _pvEl.style.display = 'none';
      if (_pvEl._docDragOver) {
        document.removeEventListener('dragover', _pvEl._docDragOver);
        _pvEl._docDragOver = null;
      }
      _pvEl._inCanvas = false;
      const _pvW = (_pvEl._fullW || 220) / (zoomLevel || 1);
      const _pvH = (_pvEl._fullH || 170) / (zoomLevel || 1);
      if (document.body.classList.contains('readonly-mode')) return;
      const src = e.dataTransfer.getData('text/plain');
      // Drop depuis la toolbar gauche (tool:note, tool:color, tool:link, tool:file)
      if (src && src.startsWith('tool:')) {
        const type = src.slice(5);
        const rect = wrapper.getBoundingClientRect();
        const x = (e.clientX - rect.left - panX) / zoomLevel;
        const y = (e.clientY - rect.top - panY) / zoomLevel;
        if (type === 'note') {
          const ne = createNoteElement('', x - 115, y - 80, 290, 75);
          _collabSyncCreatedEl(ne);
          if (ne) pushAction({ type: 'create', elId: ne.dataset.id, after: _captureElState(ne) });
          syncDomToDataset();
        } else if (type === 'color') {
          const ce = createColorElement('#000000', x - 65, y - 64, 130, 127);
          _collabSyncCreatedEl(ce);
          if (ce) pushAction({ type: 'create', elId: ce.dataset.id, after: _captureElState(ce) });
          syncDomToDataset();
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
        const items = draggedLibItems.slice();
        draggedLibItems = [];
        const createdEls = new Array(items.length).fill(null);
        let pending = items.length;
        const onAllLoaded = () => {
          const validEls = createdEls.filter(Boolean);
          if (!validEls.length) return;
          pushAction({
            type: 'groupCreate',
            elId: validEls.map((el) => el.dataset.id),
            after: validEls.map((el) => _captureElState(el)),
          });
          syncDomToDataset();
        };
        items.forEach((libItem, i) => {
          const tmpImg = new Image();
          tmpImg.onload = () => {
            const wrapEl = document.getElementById('canvas-wrapper');
            const vw = (wrapEl ? wrapEl.clientWidth : window.innerWidth) / (zoomLevel || 1);
            const vh = (wrapEl ? wrapEl.clientHeight : window.innerHeight) / (zoomLevel || 1);
            const maxDim = Math.max(vw, vh) * 0.2;
            let w = tmpImg.naturalWidth || 220;
            let h = tmpImg.naturalHeight || 170;
            if (w > maxDim) {
              h = Math.round((h * maxDim) / w);
              w = Math.round(maxDim);
            }
            if (h > maxDim) {
              w = Math.round((w * maxDim) / h);
              h = Math.round(maxDim);
            }
            const x = (e.clientX - rect.left - panX) / zoomLevel - w / 2 + i * 30;
            const y = (e.clientY - rect.top - panY) / zoomLevel - h / 2 + i * 30;
            var libImgEl = createImageElement(libItem.src, x, y, w, h);
            if (libImgEl) {
              _collabSyncCreatedEl(libImgEl);
              createdEls[i] = libImgEl;
            }
            if (--pending === 0) onAllLoaded();
          };
          tmpImg.onerror = () => {
            const x = (e.clientX - rect.left - panX) / zoomLevel - 110 + i * 30;
            const y = (e.clientY - rect.top - panY) / zoomLevel - 85 + i * 30;
            var libImgEl = createImageElement(libItem.src, x, y, 220, 170);
            if (libImgEl) {
              _collabSyncCreatedEl(libImgEl);
              createdEls[i] = libImgEl;
            }
            if (--pending === 0) onAllLoaded();
          };
          tmpImg.src = libItem.src;
        });
        return;
      }
      if (src && src.startsWith('data:')) {
        const rect = wrapper.getBoundingClientRect();
        const w = _pvW;
        const h = _pvH;
        const x = (e.clientX - rect.left - panX) / zoomLevel - w / 2;
        const y = (e.clientY - rect.top - panY) / zoomLevel - h / 2;
        var previewImgEl = createImageElement(src, x, y, w, h);
        if (previewImgEl) _collabSyncCreatedEl(previewImgEl);
        if (previewImgEl)
          pushAction({
            type: 'create',
            elId: previewImgEl.dataset.id,
            after: _captureElState(previewImgEl),
          });
        syncDomToDataset();

        return;
      }
      // Drop d'une URL externe (depuis une autre fenêtre ou onglet Chrome)
      const _uriList = e.dataTransfer.getData('text/uri-list') || '';
      const _droppedUrl =
        _uriList
          .split('\n')
          .map((s) => s.trim())
          .find((s) => s.startsWith('http')) ||
        (src && (src.startsWith('http://') || src.startsWith('https://')) ? src : '');
      if (_droppedUrl) {
        const rect = wrapper.getBoundingClientRect();
        const _lx = (e.clientX - rect.left - panX) / zoomLevel - 135;
        const _ly = (e.clientY - rect.top - panY) / zoomLevel - 110;
        _fetchLinkMeta(_droppedUrl).then(({ title, img }) => {
          const linkEl = createLinkElement(_droppedUrl, title || _droppedUrl, img, _lx, _ly);
          _collabSyncCreatedEl(linkEl);
          if (linkEl)
            pushAction({ type: 'create', elId: linkEl.dataset.id, after: _captureElState(linkEl) });
          syncDomToDataset();
        });
        return;
      }

      // Fichiers images droppés directement
      if (e.dataTransfer.files.length) {
        const rect = wrapper.getBoundingClientRect();
        Array.from(e.dataTransfer.files)
          .filter((f) => f.type.startsWith('image/'))
          .forEach((file, i) => {
            const reader = new FileReader();
            reader.onload = async (ev) => {
              const src = await compressImage(ev.target.result);
              const tmpImg = new Image();
              tmpImg.onload = () => {
                const w = tmpImg.naturalWidth || 220;
                const h = tmpImg.naturalHeight || 170;
                const x = (e.clientX - rect.left - panX) / zoomLevel - w / 2 + i * 24;
                const y = (e.clientY - rect.top - panY) / zoomLevel - h / 2 + i * 24;
                var droppedImgEl = createImageElement(src, x, y, w, h);
                applyDropSnap(droppedImgEl);
                if (droppedImgEl) _collabSyncCreatedEl(droppedImgEl);
                if (droppedImgEl)
                  pushAction({
                    type: 'create',
                    elId: droppedImgEl.dataset.id,
                    after: _captureElState(droppedImgEl),
                  });
                syncDomToDataset();
              };
              tmpImg.onerror = () => {
                const x = (e.clientX - rect.left - panX) / zoomLevel - 110 + i * 24;
                const y = (e.clientY - rect.top - panY) / zoomLevel - 85 + i * 24;
                var droppedImgEl = createImageElement(src, x, y, 220, 170);
                applyDropSnap(droppedImgEl);
                if (droppedImgEl) _collabSyncCreatedEl(droppedImgEl);
                if (droppedImgEl)
                  pushAction({
                    type: 'create',
                    elId: droppedImgEl.dataset.id,
                    after: _captureElState(droppedImgEl),
                  });
                syncDomToDataset();
              };
              tmpImg.src = src;
            };
            reader.readAsDataURL(file);
          });
      }
    });

    wrapper.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (document.body.classList.contains('readonly-mode')) return;
      if (selectedEl || multiSelected.size > 0) {
        ctxTargetEl = selectedEl || null;
        showContextMenu(e.clientX, e.clientY);
      }
    });

    // Empêcher le scroll automatique du navigateur au clic molette sur tout le wrapper
    wrapper.addEventListener(
      'mousedown',
      (e) => {
        if (e.button === 1) e.preventDefault();
      },
      true
    );
    // Idem sur les éléments du canvas (pour que button 1 sur un élément déclenche aussi le pan)
    document.getElementById('canvas').addEventListener(
      'mousedown',
      (e) => {
        if (e.button === 1) {
          e.preventDefault();
          isPanning = true;
          panStart = { x: e.clientX - panX, y: e.clientY - panY };
          wrapper.style.cursor = 'grabbing';
        }
      },
      true
    );
  }

  // ── CLAVIER ──────────────────────────────────────────────────────────────
  // ── LIGHTBOX ──────────────────────────────────────────────────────────────
  function openLightbox(src, elId) {
    _lightboxElId = elId || null;
    const overlay = document.getElementById('lightbox-overlay');
    const img = document.getElementById('lightbox-img');
    img.src = src;
    document.getElementById('lightbox-content').style.display = 'flex';
    document.getElementById('crop-ui').classList.remove('active');
    document.getElementById('lightbox-crop-btn').style.display =
      elId ? 'flex' : 'none';
    document.getElementById('lightbox-rotate-btn').style.display =
      elId ? 'flex' : 'none';
    overlay.classList.add('show');
  }
  function closeLightbox() {
    document.getElementById('lightbox-overlay').classList.remove('show');
    document.getElementById('lightbox-img').src = '';
    document.getElementById('crop-orig-img').src = '';
    document.getElementById('crop-ui').classList.remove('active');
    document.getElementById('lightbox-content').style.display = 'flex';
    _lightboxElId = null;
    if (typeof _cropStopDrag === 'function') _cropStopDrag();
  }

  function openCropMode(elId) {
    const origSrc = _imgOrigStore.get(elId) || _imgStore.get(elId) || '';
    if (!origSrc) return;

    document.getElementById('lightbox-content').style.display = 'none';
    document.getElementById('crop-ui').classList.add('active');

    const cropImg = document.getElementById('crop-orig-img');
    cropImg.src = origSrc;

    cropImg.onload = function () {
      const imgRect = cropImg.getBoundingClientRect();
      const dispW = imgRect.width;
      const dispH = imgRect.height;

      // Récupérer le cropData existant et le mapper sur la taille d'affichage
      const el = document.querySelector('[data-id="' + elId + '"]');
      let savedCrop = null;
      if (el) {
        try { savedCrop = JSON.parse(el.dataset.cropdata || 'null'); } catch (_) {}
      }

      const origImg = new Image();
      origImg.onload = function () {
        const natW = origImg.naturalWidth;
        const natH = origImg.naturalHeight;
        const scaleX = dispW / natW;
        const scaleY = dispH / natH;

        if (savedCrop && savedCrop.w > 0 && savedCrop.h > 0) {
          _cropRect = {
            x: Math.round(savedCrop.x * scaleX),
            y: Math.round(savedCrop.y * scaleY),
            w: Math.round(savedCrop.w * scaleX),
            h: Math.round(savedCrop.h * scaleY),
          };
        } else {
          _cropRect = { x: 0, y: 0, w: Math.round(dispW), h: Math.round(dispH) };
        }
        _applyCropFrame();
      };
      origImg.src = origSrc;
    };
  }

  function _applyCropFrame() {
    const frame = document.getElementById('crop-frame');
    frame.style.left = _cropRect.x + 'px';
    frame.style.top = _cropRect.y + 'px';
    frame.style.width = _cropRect.w + 'px';
    frame.style.height = _cropRect.h + 'px';
  }

  function _cropStopDrag() {
    _cropDragState = null;
    _cropContainerRect = null;
    document.removeEventListener('mousemove', _onCropMouseMove);
    document.removeEventListener('mouseup', _onCropMouseUp);
  }

  function _onCropMouseMove(e) {
    if (!_cropDragState) return;
    const dx = e.clientX - _cropDragState.startX;
    const dy = e.clientY - _cropDragState.startY;
    const s = _cropDragState.startRect;
    const cont = _cropContainerRect;
    const MIN = 20;
    const t = _cropDragState.type;

    if (t === 'move') {
      _cropRect = {
        x: Math.round(Math.max(0, Math.min(s.x + dx, cont.width - s.w))),
        y: Math.round(Math.max(0, Math.min(s.y + dy, cont.height - s.h))),
        w: Math.round(s.w),
        h: Math.round(s.h),
      };
      _applyCropFrame();
      return;
    }

    // Coins et centre de départ
    const sL = s.x, sR = s.x + s.w, sT = s.y, sB = s.y + s.h;
    const sCx = (sL + sR) / 2, sCy = (sT + sB) / 2;
    const ratio = s.w / s.h;

    const movesR = t === 'e' || t === 'se' || t === 'ne';
    const movesL = t === 'w' || t === 'sw' || t === 'nw';
    const movesB = t === 's' || t === 'se' || t === 'sw';
    const movesT = t === 'n' || t === 'ne' || t === 'nw';

    // Bords bruts
    let L = sL, R = sR, T = sT, B = sB;
    if (movesR) R = sR + dx;
    if (movesL) L = sL + dx;
    if (movesB) B = sB + dy;
    if (movesT) T = sT + dy;

    // Alt → recadrage depuis le centre
    if (e.altKey) {
      if (movesR) L = 2 * sCx - R;
      if (movesL) R = 2 * sCx - L;
      if (movesB) T = 2 * sCy - B;
      if (movesT) B = 2 * sCy - T;
    }

    // Shift → recadrage proportionnel
    if (e.shiftKey) {
      const newW = R - L;
      const newH = B - T;
      const wChange = Math.abs(newW - s.w);
      const hChange = Math.abs(newH - s.h);

      // Point d'ancrage : centre si Alt, sinon bord opposé au handle
      const anchorX = e.altKey ? sCx : movesR ? L : movesL ? R : sCx;
      const anchorY = e.altKey ? sCy : movesB ? T : movesT ? B : sCy;

      let targetW, targetH;
      if (wChange >= hChange) {
        targetW = Math.max(MIN, newW);
        targetH = targetW / ratio;
      } else {
        targetH = Math.max(MIN, newH);
        targetW = targetH * ratio;
      }

      // Cap à l'espace disponible dans le container avant placement
      if (e.altKey) {
        const maxHW = Math.min(sCx, cont.width - sCx);
        const maxHH = Math.min(sCy, cont.height - sCy);
        targetW = Math.min(targetW, maxHW * 2);
        targetH = targetW / ratio;
        if (targetH / 2 > maxHH) { targetH = maxHH * 2; targetW = targetH * ratio; }
      } else {
        const maxW = movesR ? cont.width - anchorX : movesL ? anchorX : Math.min(anchorX, cont.width - anchorX) * 2;
        const maxH = movesB ? cont.height - anchorY : movesT ? anchorY : Math.min(anchorY, cont.height - anchorY) * 2;
        targetW = Math.min(targetW, maxW);
        targetH = targetW / ratio;
        if (targetH > maxH) { targetH = maxH; targetW = targetH * ratio; }
      }
      targetW = Math.max(MIN, targetW);
      targetH = Math.max(MIN, targetH);

      if (e.altKey) {
        L = anchorX - targetW / 2;
        R = anchorX + targetW / 2;
        T = anchorY - targetH / 2;
        B = anchorY + targetH / 2;
      } else {
        if (movesR)       { L = anchorX; R = anchorX + targetW; }
        else if (movesL)  { R = anchorX; L = anchorX - targetW; }
        else              { L = anchorX - targetW / 2; R = anchorX + targetW / 2; }

        if (movesB)       { T = anchorY; B = anchorY + targetH; }
        else if (movesT)  { B = anchorY; T = anchorY - targetH; }
        else              { T = anchorY - targetH / 2; B = anchorY + targetH / 2; }
      }
    }

    // Clamp dans le container (filet de sécurité)
    L = Math.max(0, L);
    T = Math.max(0, T);
    R = Math.min(cont.width, R);
    B = Math.min(cont.height, B);
    if (R - L < MIN) R = L + MIN;
    if (B - T < MIN) B = T + MIN;

    _cropRect = { x: Math.round(L), y: Math.round(T), w: Math.round(R - L), h: Math.round(B - T) };
    _applyCropFrame();
  }

  function _onCropMouseUp() {
    _cropStopDrag();
  }

  function _rotateImageCW() {
    const elId = _lightboxElId;
    if (!elId) return;
    const el = document.querySelector('[data-id="' + elId + '"]');
    if (!el) return;
    const src = _imgStore.get(elId) || '';
    if (!src) return;

    const tmpImg = new Image();
    tmpImg.onload = function () {
      const w = tmpImg.naturalWidth;
      const h = tmpImg.naturalHeight;
      const cvs = document.createElement('canvas');
      cvs.width = h;
      cvs.height = w;
      const ctx = cvs.getContext('2d');
      ctx.translate(h, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(tmpImg, 0, 0);
      const rotatedSrc = cvs.toDataURL('image/png');

      const oldSrc = src;
      const oldW = parseFloat(el.style.width) || null;
      const oldH = parseFloat(el.style.height) || null;

      const newRatio = h / w;
      const currentW = oldW || h;
      const newH = Math.round(currentW / newRatio);

      _imgStore.set(elId, rotatedSrc);
      const domImg = el.querySelector('img');
      if (domImg) domImg.src = rotatedSrc;
      el.style.height = newH + 'px';
      el.dataset.ratio = newRatio.toFixed(6);
      document.getElementById('lightbox-img').src = rotatedSrc;

      pushAction({
        type: 'editImage',
        elId,
        detail: 'Image pivotée',
        before: { data: oldSrc, w: oldW, h: oldH },
        after:  { data: rotatedSrc, w: currentW, h: newH },
      });
      syncDomToDataset();

      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.syncElementData(elId, rotatedSrc);
        Collab.syncElementSize(elId, currentW, newH, true);
      }
    };
    tmpImg.src = src;
  }

  function _confirmCrop() {
    const elId = _lightboxElId;
    if (!elId) return;
    const el = document.querySelector('[data-id="' + elId + '"]');
    if (!el) return;

    const cropImg = document.getElementById('crop-orig-img');
    const origSrc = _imgOrigStore.get(elId) || _imgStore.get(elId) || '';

    const dispW = cropImg.naturalWidth > 0
      ? cropImg.getBoundingClientRect().width
      : cropImg.clientWidth;
    const dispH = cropImg.naturalWidth > 0
      ? cropImg.getBoundingClientRect().height
      : cropImg.clientHeight;

    const tmpImg = new Image();
    tmpImg.onload = function () {
      const natW = tmpImg.naturalWidth;
      const natH = tmpImg.naturalHeight;
      const scaleX = natW / dispW;
      const scaleY = natH / dispH;

      const cx = Math.round(_cropRect.x * scaleX);
      const cy = Math.round(_cropRect.y * scaleY);
      const cw = Math.max(1, Math.round(_cropRect.w * scaleX));
      const ch = Math.max(1, Math.round(_cropRect.h * scaleY));

      const cvs = document.createElement('canvas');
      cvs.width = cw;
      cvs.height = ch;
      const ctx = cvs.getContext('2d');
      ctx.drawImage(tmpImg, cx, cy, cw, ch, 0, 0, cw, ch);
      const croppedSrc = cvs.toDataURL('image/png');

      // Sauvegarder l'original si c'est le premier crop
      if (!_imgOrigStore.has(elId)) {
        _imgOrigStore.set(elId, origSrc);
      }

      const oldSrc = _imgStore.get(elId) || '';
      const oldW = parseFloat(el.style.width) || null;
      const oldH = parseFloat(el.style.height) || null;

      // Capturer l'ancien cropdata AVANT mutation
      const oldCropdata = el.dataset.cropdata || '';

      // Conserver les dimensions actuelles du board-element, adapter le ratio
      const currentW = oldW || cw;
      const newRatio = cw / ch;
      const newH = Math.round(currentW / newRatio);

      _imgStore.set(elId, croppedSrc);
      const domImg = el.querySelector('img');
      if (domImg) domImg.src = croppedSrc;
      el.style.height = newH + 'px';
      el.dataset.ratio = newRatio.toFixed(6);

      // Stocker le cropData (coords dans l'image originale)
      el.dataset.cropdata = JSON.stringify({ x: cx, y: cy, w: cw, h: ch });

      pushAction({
        type: 'editImage',
        elId,
        detail: 'Image recadrée',
        before: { data: oldSrc, w: oldW, h: oldH, cropdata: oldCropdata },
        after:  { data: croppedSrc, w: currentW, h: newH, cropdata: el.dataset.cropdata },
      });
      syncDomToDataset();

      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.syncElementData(elId, croppedSrc);
        Collab.syncElementSize(elId, currentW, newH, true);
      }

      closeLightbox();
    };
    tmpImg.src = origSrc;
  }

  function setupKeyboard() {
    document.addEventListener('keydown', async (e) => {
      // Touches de mode (Alt, Ctrl) — traitées en premier, sans test isTyping
      if (e.key === 'Alt') {
        e.preventDefault();
        isAltDown = true;
      }
      if (e.key === 'Control') ctrlSnap = true;

      if (e.code === 'Space' && !isTyping(e)) {
        e.preventDefault();
        isPanningMode = true;
        document.body.classList.add('is-pan-mode');
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!document.body.classList.contains('readonly-mode')) triggerManualSync();
        return;
      }
      if (!document.body.classList.contains('readonly-mode')) {
        const _ae = document.activeElement;
        const _canUndoRedo = !isTyping(e) || (!_ae?.isContentEditable && _ae?.tagName !== 'INPUT' && _ae?.tagName !== 'TEXTAREA');
        if (
          _canUndoRedo &&
          (e.ctrlKey || e.metaKey) &&
          e.shiftKey &&
          (e.key === 'Z' || e.key === 'z')
        ) {
          e.preventDefault();
          redo();
        } else if (
          _canUndoRedo &&
          (e.ctrlKey || e.metaKey) &&
          !e.shiftKey &&
          (e.key === 'z' || e.key === 'Z')
        ) {
          e.preventDefault();
          undo();
        }
      }
      const _libDelete =
        libSelectedIds.size > 0 && document.activeElement?.id !== 'lib-panel-search';
      if ((e.key === 'Delete' || e.key === 'Backspace') && (!isTyping(e) || _libDelete)) {
        if (document.body.classList.contains('readonly-mode')) return;
        e.preventDefault();
        if (libSelectedIds.size > 0) {
          _deleteSelectedLibItems();
        } else {
          deleteSelected();
        }
      }
      if (e.key === 'Escape') {
        if (previewMode) {
          togglePreviewMode();
          return;
        }
        if (connectorMode) {
          setConnectorMode(false);
          return;
        }
        deselectAll();
        multiSelected.clear();
        hideContextMenu();
        closeAllModals();
      }
      if (
        (e.key === 'n' || e.key === 'N') &&
        !isTyping(e) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        toggleLibPanel();
      }
      if (
        (e.key === 'w' || e.key === 'W') &&
        !isTyping(e) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        toggleTheme();
      }
      if (
        (e.key === 'h' || e.key === 'H') &&
        !isTyping(e) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        const _hp = document.getElementById('history-panel');
        if (_hp) {
          _hp.classList.toggle('hidden');
          if (!_hp.classList.contains('hidden')) renderHistoryPanel();
        }
      }
      if ((e.key === 'a' || e.key === 'A') && !isTyping(e) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) {
          togglePreviewMode();
        } else {
          fitElementsToScreen();
        }
      }
      // (Ctrl+V géré par l'événement 'paste' ci-dessous, sans demande de permission)
    });
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Alt') isAltDown = false;
      if (e.key === 'Control') ctrlSnap = false;
      if (e.code === 'Space') {
        isPanningMode = false;
        document.body.classList.remove('is-pan-mode');
      }
    });
    // Sécurité : reset Alt/Ctrl si la fenêtre perd le focus
    window.addEventListener('blur', () => {
      isAltDown = false;
      ctrlSnap = false;
    });

    // ── COLLER IMAGE (paste natif, sans demande de permission) ───────────────
    document.addEventListener('paste', (e) => {
      if (isTyping(e)) return;
      if (document.body.classList.contains('readonly-mode')) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;
          const reader = new FileReader();
          reader.onload = async (ev) => {
            const src = await compressImage(ev.target.result);
            const c = getCenter();
            const tmpImg = new Image();
            tmpImg.onload = () => {
              const w = tmpImg.naturalWidth || 220;
              const h = tmpImg.naturalHeight || 170;
              var pastedImgEl = createImageElement(src, c.x - w / 2, c.y - h / 2, w, h);
              if (pastedImgEl) _collabSyncCreatedEl(pastedImgEl);
              if (pastedImgEl)
                pushAction({
                  type: 'create',
                  elId: pastedImgEl.dataset.id,
                  after: _captureElState(pastedImgEl),
                });
              syncDomToDataset();
            };
            tmpImg.onerror = () => {
              var pastedImgEl = createImageElement(src, c.x - 110, c.y - 85, 220, 170);
              if (pastedImgEl) _collabSyncCreatedEl(pastedImgEl);
              if (pastedImgEl)
                pushAction({
                  type: 'create',
                  elId: pastedImgEl.dataset.id,
                  after: _captureElState(pastedImgEl),
                });
              syncDomToDataset();
            };
            tmpImg.src = src;
            // Ajouter aussi à la bibliothèque
            const name = 'collé_' + Date.now() + '.png';
            const libItem = {
              id: 'lib_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
              name,
              src,
            };
            const folder = panelFolder === 'all' ? 'image' : panelFolder;
            if (!library[folder]) library[folder] = [];
            library[folder].push(libItem);
            saveLibrary();
            renderPanelLib();
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    });
  }
  function isTyping(e) {
    const active = document.activeElement;
    const inInput = (el) =>
      el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    // data-editing : flag posé par les notes (textarea avec pointerEvents:none)
    const editingNote = !!document.querySelector('.board-element[data-editing="1"]');
    return inInput(active) || editingNote;
  }

  // ── HISTORIQUE ───────────────────────────────────────────────────────────
  // Undo/redo par actions structurées, dans les deux modes (solo et collab).
  let _actionHistory = [];
  let _actionIndex = -1;
  const MAX_ACTIONS = 100;

  /**
   * Recopie dans le DOM sérialisable l'état que seul le JS connaît, pour que
   * la sauvegarde le voie : `.value` d'un input et l'innerHTML d'un
   * contenteditable ne sont pas des attributs.
   *
   * Anciennement `pushHistory()`, qui empilait en plus un snapshot complet de
   * `canvas.innerHTML` (images base64 comprises) dans un tableau `history[]`
   * que plus rien ne relisait depuis le passage à l'undo par actions.
   * Seule la synchronisation ci-dessous était encore utile.
   */
  function syncDomToDataset() {
    // Valeur des hex inputs couleur (l'attribut ne suit pas la propriété .value)
    document
      .querySelectorAll('#canvas .board-element[data-type="color"] .color-hex-input')
      .forEach((inp) => {
        if (inp.value) inp.setAttribute('value', inp.value);
      });
    // dataset.savedata des notes : source de vérité lue par saveCurrentBoard()
    document
      .querySelectorAll('#canvas .board-element[data-type="note"] .el-note-content')
      .forEach((div) => {
        const el = div.closest('.board-element');
        if (el) el.dataset.savedata = div.innerHTML;
      });
  }

  /**
   * Enregistre une action structurée pour le undo/redo collaboratif.
   * @param {object} action - {type, elId, before, after}
   *   type: 'move'|'resize'|'create'|'delete'|'editText'|'editColor'|'groupMove'|'generic'
   *   elId: string | string[] (pour groupMove)
   *   before: état avant l'action
   *   after: état après l'action
   */
  function pushAction(action) {
    const isCollab = typeof Collab !== 'undefined' && Collab.isActive();
    action.userId = isCollab ? Collab.getMyUserId() : 'local';
    action.timestamp = Date.now();
    if (isCollab && action.elId && !Array.isArray(action.elId)) {
      action.elementVersion = Collab.getElementVersion(action.elId);
    }
    if (_actionIndex < _actionHistory.length - 1) {
      _actionHistory = _actionHistory.slice(0, _actionIndex + 1);
    }
    _actionHistory.push(action);
    if (_actionHistory.length > MAX_ACTIONS) _actionHistory.shift();
    _actionIndex = _actionHistory.length - 1;
    renderHistoryPanel();
  }

  /** Capture l'état d'un élément pour les actions create/delete */
  function _captureElState(el) {
    return {
      type: el.dataset.type,
      x: parseFloat(el.style.left) || 0,
      y: parseFloat(el.style.top) || 0,
      w: parseFloat(el.style.width) || null,
      h: parseFloat(el.style.height) || null,
      z: parseInt(el.style.zIndex) || 100,
      data:
        el.dataset.type === 'image'
          ? _imgStore.get(el.dataset.id) || el.dataset.savedata || ''
          : el.dataset.savedata || '',
    };
  }

  function _applyReverse(action) {
    const isCollab = typeof Collab !== 'undefined' && Collab.isActive();
    switch (action.type) {
      case 'move': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (!el) break;
        el.style.left = action.before.x + 'px';
        el.style.top = action.before.y + 'px';
        updateConnectionsForEl(el);
        if (isCollab)
          Collab.syncElementPosition(action.elId, action.before.x, action.before.y, true);
        { const _elH = el.offsetHeight;
          document.querySelectorAll(`.el-caption[data-parent-id="${action.elId}"]`).forEach((cap) => {
            cap.style.left = action.before.x + 'px';
            cap.style.top = (action.before.y + _elH) + 'px';
            if (isCollab && cap.dataset.capId)
              Collab.syncCaptionPosition(cap.dataset.capId, action.before.x, action.before.y + _elH, true);
          }); }
        break;
      }
      case 'resize': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (!el) break;
        if (action.before.w) el.style.width = action.before.w + 'px';
        if (action.before.h && el.dataset.type !== 'note') el.style.height = action.before.h + 'px';
        if (action.before.x != null) el.style.left = action.before.x + 'px';
        if (action.before.y != null) el.style.top = action.before.y + 'px';
        updateConnectionsForEl(el);
        if (isCollab) {
          Collab.syncElementSize(action.elId, action.before.w, action.before.h, true);
          if (action.before.x != null)
            Collab.syncElementPosition(action.elId, action.before.x, action.before.y, true);
        }
        break;
      }
      case 'editText':
      case 'editColor': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (!el) break;
        el.dataset.savedata = action.before.data;
        if (action.type === 'editText') {
          const ta = el.querySelector('.el-note-content');
          if (ta) {
            ta.innerHTML = _noteDataToHtml(action.before.data);
            if (action.before.style !== undefined) ta.style.cssText = action.before.style;
          }
        } else {
          const swatch = el.querySelector('.color-swatch');
          if (swatch) swatch.style.backgroundColor = action.before.data;
          const hexInput = el.querySelector('.color-hex-input');
          if (hexInput) hexInput.value = action.before.data;
          _syncColorInfo(el, action.before.data);
        }
        if (isCollab) Collab.syncElementData(action.elId, action.before.data);
        break;
      }
      case 'create': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (el) {
          removeConnectionsForEl(el);
          removeCaptionsForEl(el);
          if (selectedEl === el) selectedEl = null;
          multiSelected.delete(el);
          if (hoveredEl === el) hoveredEl = null;
          if (el.dataset.type === 'image') {
            _imgStore.delete(action.elId);
            _imgOrigStore.delete(action.elId);
          }
          el.remove();
        }
        if (isCollab) Collab.syncElementDelete(action.elId);
        deselectAll();
        break;
      }
      case 'delete': {
        const restored = restoreElement({ id: action.elId, ...action.before });
        if (isCollab && restored) {
          _collabSyncCreatedEl(restored);
        }
        break;
      }
      case 'groupMove': {
        if (!Array.isArray(action.elId) || !Array.isArray(action.before)) break;
        action.elId.forEach((id, i) => {
          const el = document.querySelector('[data-id="' + id + '"]');
          if (!el || !action.before[i]) return;
          el.style.left = action.before[i].x + 'px';
          el.style.top = action.before[i].y + 'px';
          updateConnectionsForEl(el);
          if (isCollab)
            Collab.syncElementPosition(id, action.before[i].x, action.before[i].y, true);
          const _elH = el.offsetHeight;
          document.querySelectorAll(`.el-caption[data-parent-id="${id}"]`).forEach((cap) => {
            cap.style.left = action.before[i].x + 'px';
            cap.style.top = (action.before[i].y + _elH) + 'px';
            if (isCollab && cap.dataset.capId)
              Collab.syncCaptionPosition(cap.dataset.capId, action.before[i].x, action.before[i].y + _elH, true);
          });
        });
        deselectAll();
        action.elId.forEach((id) => {
          const el = document.querySelector('[data-id="' + id + '"]');
          if (el) {
            el.classList.add('multi-selected');
            multiSelected.add(el);
          }
        });
        updateAlignPanel();
        updateMultiResizeHandle();
        break;
      }
      case 'groupCreate': {
        if (!Array.isArray(action.elId)) break;
        action.elId.forEach(function (id) {
          var el = document.querySelector('[data-id="' + id + '"]');
          if (el) {
            removeConnectionsForEl(el);
            removeCaptionsForEl(el);
            if (hoveredEl === el) hoveredEl = null;
            el.remove();
          }
          if (isCollab) Collab.syncElementDelete(id);
        });
        deselectAll();
        break;
      }
      case 'libDelete': {
        if (!Array.isArray(action.before)) break;
        // Réinsérer du plus petit index au plus grand pour retrouver l'ordre original
        const sorted = action.before.slice().sort((a, b) => a.index - b.index);
        sorted.forEach((entry) => {
          if (!library[entry.folder]) library[entry.folder] = [];
          const arr = library[entry.folder];
          const idx = Math.min(entry.index, arr.length);
          arr.splice(idx, 0, entry.item);
        });
        saveLibrary();
        renderPanelLib();
        break;
      }
      case 'editImage': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (!el) break;
        const s = action.before;
        _imgStore.set(action.elId, s.data);
        const img = el.querySelector('img');
        if (img) img.src = s.data;
        if (s.w) el.style.width = s.w + 'px';
        if (s.h) el.style.height = s.h + 'px';
        if (s.w && s.h) el.dataset.ratio = (s.w / s.h).toFixed(6);
        updateConnectionsForEl(el);
        if (s.cropdata !== undefined) el.dataset.cropdata = s.cropdata || '';
        if (isCollab) {
          Collab.syncElementData(action.elId, s.data);
          Collab.syncElementSize(action.elId, s.w, s.h, true);
        }
        break;
      }
      case 'editFile': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (!el) break;
        const s = action.before;
        const d = (() => { try { return JSON.parse(s.savedata || '{}'); } catch (_) { return {}; } })();
        let newEl;
        const x = parseFloat(el.style.left) || 0;
        const y = parseFloat(el.style.top) || 0;
        if (d.isVideo) {
          newEl = createVideoFileElement(d.name, d.size, d.src || '', x, y);
        } else {
          newEl = createFileElement(d.name, d.size, d.icon, x, y);
          if (d.fileData) newEl.dataset.savedata = s.savedata;
        }
        newEl.dataset.id = action.elId;
        newEl.style.zIndex = el.style.zIndex;
        if (s.w) newEl.style.width = s.w + 'px';
        if (s.h) newEl.style.height = s.h + 'px';
        el.replaceWith(newEl);
        if (isCollab) Collab.syncElementData(action.elId, s.savedata);
        break;
      }
      case 'groupResize': {
        if (!Array.isArray(action.before)) break;
        action.before.forEach((s) => {
          const el = document.querySelector('[data-id="' + s.elId + '"]');
          if (!el) return;
          el.style.left = s.x + 'px';
          el.style.top = s.y + 'px';
          el.style.width = s.w + 'px';
          if (el.dataset.type !== 'note') el.style.height = s.h + 'px';
          updateConnectionsForEl(el);
          if (isCollab) {
            Collab.syncElementPosition(s.elId, s.x, s.y, true);
            Collab.syncElementSize(s.elId, s.w, s.h, true);
          }
        });
        break;
      }
      case 'connection': {
        if (!Array.isArray(action.connections)) break;
        action.connections.forEach(({ connId }) => {
          const svg = document.querySelector('.el-connection[data-conn-id="' + connId + '"]');
          if (svg) svg.remove();
          if (isCollab) Collab.syncConnectionDelete(connId);
        });
        break;
      }
      case 'disconnection': {
        if (!Array.isArray(action.connections)) break;
        action.connections.forEach(({ fromId, toId, connId }) => {
          const exists = document.querySelector('.el-connection[data-conn-id="' + connId + '"]');
          if (!exists) createConnection(fromId, toId, connId);
          if (isCollab) Collab.syncConnection(connId, fromId, toId);
        });
        break;
      }
      case 'captionCreate': {
        const cap = document.querySelector('[data-cap-id="' + action.capId + '"]');
        if (cap) cap.remove();
        if (isCollab && action.capId) Collab.syncCaptionDelete(action.capId);
        break;
      }
      case 'captionDelete': {
        const s = action.before;
        _createCaptionEl(action.capId, s.parentId, s.x, s.y, s.width, s.text);
        if (isCollab) Collab.syncCaption(action.capId, s.parentId, s.x, s.y, s.width, s.text);
        break;
      }
      case 'captionEdit': {
        const cap = document.querySelector('[data-cap-id="' + action.capId + '"]');
        if (!cap) break;
        cap.textContent = action.before.text;
        if (isCollab) Collab.syncCaption(action.capId, cap.dataset.parentId, parseFloat(cap.style.left) || 0, parseFloat(cap.style.top) || 0, cap.style.width || '', action.before.text);
        break;
      }
      case 'zIndex': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (!el) break;
        el.style.zIndex = action.before.z;
        if (isCollab) Collab.syncElementZ(action.elId, action.before.z);
        break;
      }
    }
  }

  function _applyForward(action) {
    const isCollab = typeof Collab !== 'undefined' && Collab.isActive();
    switch (action.type) {
      case 'move': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (!el) break;
        el.style.left = action.after.x + 'px';
        el.style.top = action.after.y + 'px';
        updateConnectionsForEl(el);
        if (isCollab) Collab.syncElementPosition(action.elId, action.after.x, action.after.y, true);
        { const _elH = el.offsetHeight;
          document.querySelectorAll(`.el-caption[data-parent-id="${action.elId}"]`).forEach((cap) => {
            cap.style.left = action.after.x + 'px';
            cap.style.top = (action.after.y + _elH) + 'px';
            if (isCollab && cap.dataset.capId)
              Collab.syncCaptionPosition(cap.dataset.capId, action.after.x, action.after.y + _elH, true);
          }); }
        break;
      }
      case 'resize': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (!el) break;
        if (action.after.w) el.style.width = action.after.w + 'px';
        if (action.after.h && el.dataset.type !== 'note') el.style.height = action.after.h + 'px';
        if (action.after.x != null) el.style.left = action.after.x + 'px';
        if (action.after.y != null) el.style.top = action.after.y + 'px';
        updateConnectionsForEl(el);
        if (isCollab) {
          Collab.syncElementSize(action.elId, action.after.w, action.after.h, true);
          if (action.after.x != null)
            Collab.syncElementPosition(action.elId, action.after.x, action.after.y, true);
        }
        break;
      }
      case 'editText':
      case 'editColor': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (!el) break;
        el.dataset.savedata = action.after.data;
        if (action.type === 'editText') {
          const ta = el.querySelector('.el-note-content');
          if (ta) {
            ta.innerHTML = _noteDataToHtml(action.after.data);
            if (action.after.style !== undefined) ta.style.cssText = action.after.style;
          }
        } else {
          const swatch = el.querySelector('.color-swatch');
          if (swatch) swatch.style.backgroundColor = action.after.data;
          const hexInput = el.querySelector('.color-hex-input');
          if (hexInput) hexInput.value = action.after.data;
          _syncColorInfo(el, action.after.data);
        }
        if (isCollab) Collab.syncElementData(action.elId, action.after.data);
        break;
      }
      case 'create': {
        const restored = restoreElement({ id: action.elId, ...action.after });
        if (isCollab && restored) _collabSyncCreatedEl(restored);
        break;
      }
      case 'delete': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (el) {
          removeConnectionsForEl(el);
          removeCaptionsForEl(el);
          if (hoveredEl === el) hoveredEl = null;
          if (el.dataset.type === 'image') {
            _imgStore.delete(action.elId);
            _imgOrigStore.delete(action.elId);
          }
          el.remove();
        }
        if (isCollab) Collab.syncElementDelete(action.elId);
        break;
      }
      case 'groupMove': {
        if (!Array.isArray(action.elId) || !Array.isArray(action.after)) break;
        action.elId.forEach((id, i) => {
          const el = document.querySelector('[data-id="' + id + '"]');
          if (!el || !action.after[i]) return;
          el.style.left = action.after[i].x + 'px';
          el.style.top = action.after[i].y + 'px';
          updateConnectionsForEl(el);
          if (isCollab) Collab.syncElementPosition(id, action.after[i].x, action.after[i].y, true);
          const _elH = el.offsetHeight;
          document.querySelectorAll(`.el-caption[data-parent-id="${id}"]`).forEach((cap) => {
            cap.style.left = action.after[i].x + 'px';
            cap.style.top = (action.after[i].y + _elH) + 'px';
            if (isCollab && cap.dataset.capId)
              Collab.syncCaptionPosition(cap.dataset.capId, action.after[i].x, action.after[i].y + _elH, true);
          });
        });
        deselectAll();
        action.elId.forEach((id) => {
          const el = document.querySelector('[data-id="' + id + '"]');
          if (el) {
            el.classList.add('multi-selected');
            multiSelected.add(el);
          }
        });
        updateAlignPanel();
        updateMultiResizeHandle();
        break;
      }
      case 'groupCreate': {
        if (!Array.isArray(action.elId) || !Array.isArray(action.after)) break;
        action.elId.forEach(function (id, i) {
          var state = action.after[i];
          if (!state) return;
          var restored = restoreElement({
            id: id,
            type: state.type,
            x: state.x,
            y: state.y,
            w: state.w,
            h: state.h,
            z: state.z,
            data: state.data,
          });
          if (isCollab && restored) _collabSyncCreatedEl(restored);
        });
        break;
      }
      case 'libDelete': {
        if (!Array.isArray(action.before)) break;
        const ids = new Set(action.before.map((e) => e.item && e.item.id).filter(Boolean));
        Object.keys(library).forEach((folder) => {
          library[folder] = library[folder].filter((it) => !ids.has(it.id));
        });
        saveLibrary();
        renderPanelLib();
        break;
      }
      case 'editImage': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (!el) break;
        const s = action.after;
        _imgStore.set(action.elId, s.data);
        const img = el.querySelector('img');
        if (img) img.src = s.data;
        if (s.w) el.style.width = s.w + 'px';
        if (s.h) el.style.height = s.h + 'px';
        if (s.w && s.h) el.dataset.ratio = (s.w / s.h).toFixed(6);
        updateConnectionsForEl(el);
        if (s.cropdata !== undefined) el.dataset.cropdata = s.cropdata || '';
        if (isCollab) {
          Collab.syncElementData(action.elId, s.data);
          Collab.syncElementSize(action.elId, s.w, s.h, true);
        }
        break;
      }
      case 'editFile': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (!el) break;
        const s = action.after;
        const d = (() => { try { return JSON.parse(s.savedata || '{}'); } catch (_) { return {}; } })();
        let newEl;
        const x = parseFloat(el.style.left) || 0;
        const y = parseFloat(el.style.top) || 0;
        if (d.isVideo) {
          newEl = createVideoFileElement(d.name, d.size, d.src || '', x, y);
        } else {
          newEl = createFileElement(d.name, d.size, d.icon, x, y);
          if (d.fileData) newEl.dataset.savedata = s.savedata;
        }
        newEl.dataset.id = action.elId;
        newEl.style.zIndex = el.style.zIndex;
        if (s.w) newEl.style.width = s.w + 'px';
        if (s.h) newEl.style.height = s.h + 'px';
        el.replaceWith(newEl);
        if (isCollab) Collab.syncElementData(action.elId, s.savedata);
        break;
      }
      case 'groupResize': {
        if (!Array.isArray(action.after)) break;
        action.after.forEach((s) => {
          const el = document.querySelector('[data-id="' + s.elId + '"]');
          if (!el) return;
          el.style.left = s.x + 'px';
          el.style.top = s.y + 'px';
          el.style.width = s.w + 'px';
          if (el.dataset.type !== 'note') el.style.height = s.h + 'px';
          updateConnectionsForEl(el);
          if (isCollab) {
            Collab.syncElementPosition(s.elId, s.x, s.y, true);
            Collab.syncElementSize(s.elId, s.w, s.h, true);
          }
        });
        break;
      }
      case 'connection': {
        if (!Array.isArray(action.connections)) break;
        action.connections.forEach(({ fromId, toId, connId }) => {
          const exists = document.querySelector('.el-connection[data-conn-id="' + connId + '"]');
          if (!exists) createConnection(fromId, toId, connId);
          if (isCollab) Collab.syncConnection(connId, fromId, toId);
        });
        break;
      }
      case 'disconnection': {
        if (!Array.isArray(action.connections)) break;
        action.connections.forEach(({ connId }) => {
          const svg = document.querySelector('.el-connection[data-conn-id="' + connId + '"]');
          if (svg) svg.remove();
          if (isCollab) Collab.syncConnectionDelete(connId);
        });
        break;
      }
      case 'captionCreate': {
        const s = action.after;
        const exists = document.querySelector('[data-cap-id="' + action.capId + '"]');
        if (!exists) _createCaptionEl(action.capId, s.parentId, s.x, s.y, s.width, s.text);
        if (isCollab) Collab.syncCaption(action.capId, s.parentId, s.x, s.y, s.width, s.text);
        break;
      }
      case 'captionDelete': {
        const cap = document.querySelector('[data-cap-id="' + action.capId + '"]');
        if (cap) cap.remove();
        if (isCollab && action.capId) Collab.syncCaptionDelete(action.capId);
        break;
      }
      case 'captionEdit': {
        const cap = document.querySelector('[data-cap-id="' + action.capId + '"]');
        if (!cap) break;
        cap.textContent = action.after.text;
        if (isCollab) Collab.syncCaption(action.capId, cap.dataset.parentId, parseFloat(cap.style.left) || 0, parseFloat(cap.style.top) || 0, cap.style.width || '', action.after.text);
        break;
      }
      case 'zIndex': {
        const el = document.querySelector('[data-id="' + action.elId + '"]');
        if (!el) break;
        el.style.zIndex = action.after.z;
        if (isCollab) Collab.syncElementZ(action.elId, action.after.z);
        break;
      }
    }
  }

  function undo() {
    const isCollab = typeof Collab !== 'undefined' && Collab.isActive();

    // Mode collab: undo par action avec vérification de conflits
    if (isCollab && _actionHistory.length > 0) {
      const NO_CONFLICT_CHECK = new Set([
        'create', 'delete', 'groupCreate', 'groupResize',
        'connection', 'disconnection',
        'captionCreate', 'captionDelete', 'captionEdit',
        'editImage', 'editFile', 'zIndex',
      ]);
      if (_actionIndex < 0) return;
      const action = _actionHistory[_actionIndex];
      // On refuse l'annulation au lieu de sauter l'action : avancer _actionIndex
      // sans appeler _applyReverse laisserait le redo réappliquer une action
      // jamais annulée, ce qui désynchronise le board.
      if (!NO_CONFLICT_CHECK.has(action.type)) {
        const elId = Array.isArray(action.elId) ? action.elId[0] : action.elId;
        if (elId && Collab.isLockedByOther(elId)) {
          toast("Impossible d'annuler : élément en cours d'édition");
          return;
        }
        if (elId && Collab.wasModifiedSince(elId, action.elementVersion || 0)) {
          toast("Impossible d'annuler : élément modifié par quelqu'un d'autre");
          return;
        }
      }
      _applyReverse(action);
      _actionIndex--;
      updateCornerHandles();
      renderHistoryPanel();
      return;
    }

    // Mode solo: undo par action (unifié)
    if (_actionIndex < 0) return;
    _applyReverse(_actionHistory[_actionIndex]);
    _actionIndex--;
    updateCornerHandles();
    deselectAll();
    renderHistoryPanel();
  }

  function redo() {
    const isCollab = typeof Collab !== 'undefined' && Collab.isActive();

    // Mode collab: redo par action
    if (isCollab && _actionHistory.length > 0) {
      if (_actionIndex >= _actionHistory.length - 1) return;
      _actionIndex++;
      const action = _actionHistory[_actionIndex];
      _applyForward(action);
      updateCornerHandles();
      renderHistoryPanel();
      return;
    }

    // Mode solo: redo par action (unifié)
    if (_actionIndex >= _actionHistory.length - 1) return;
    _actionIndex++;
    _applyForward(_actionHistory[_actionIndex]);
    updateCornerHandles();
    deselectAll();
    renderHistoryPanel();
  }
  const _EL_TYPE_LABELS = { note: 'Note', color: 'Couleur', link: 'Lien', image: 'Image', file: 'Fichier', video: 'Vidéo' };

  function _enrichedLabel(action) {
    if (action.detail) return action.detail;
    switch (action.type) {
      case 'create': {
        const t = (action.after && action.after.type) ? (_EL_TYPE_LABELS[action.after.type] || 'Élément') : 'Élément';
        return t + ' créé';
      }
      case 'delete': {
        const t = (action.before && action.before.type) ? (_EL_TYPE_LABELS[action.before.type] || 'Élément') : 'Élément';
        return t + ' supprimé';
      }
      case 'groupCreate': {
        const n = Array.isArray(action.elId) ? action.elId.length : '';
        return 'Éléments créés' + (n ? ' (' + n + ')' : '');
      }
      case 'editText': return 'Texte modifié';
      case 'editColor': return 'Couleur modifiée';
      case 'move': return 'Déplacé';
      case 'resize': return 'Redimensionné';
      case 'groupMove': return 'Groupe déplacé';
      case 'groupResize': return 'Groupe redimensionné';
      case 'connection': return 'Connexion créée';
      case 'disconnection': return 'Connexion supprimée';
      case 'captionCreate': return 'Légende ajoutée';
      case 'captionDelete': return 'Légende supprimée';
      case 'captionEdit': return 'Légende modifiée';
      case 'libDelete': return 'Bibliothèque mise à jour';
      case 'editImage': return 'Image remplacée';
      case 'editFile': return 'Fichier remplacé';
      case 'zIndex': return 'Ordre modifié';
      default: return 'Action';
    }
  }

  function renderHistoryPanel() {
    const panel = document.getElementById('history-panel');
    if (!panel || panel.classList.contains('hidden')) return;
    const list = panel.querySelector('.history-list');
    if (!list) return;
    if (_actionHistory.length === 0) {
      list.innerHTML = '<div class="history-empty">Aucune action pour l\'instant</div>';
      return;
    }
    list.innerHTML = '';
    for (let i = _actionHistory.length - 1; i >= 0; i--) {
      const action = _actionHistory[i];
      const entry = document.createElement('div');
      entry.className = 'history-entry' +
        (i === _actionIndex ? ' history-current' : (i > _actionIndex ? ' history-future' : ''));
      const label = document.createElement('span');
      label.className = 'history-label';
      label.textContent = _enrichedLabel(action);
      entry.appendChild(label);
      const idx = i;
      entry.addEventListener('click', () => _navigateHistory(idx));
      list.appendChild(entry);
    }
  }

  function _navigateHistory(targetIdx) {
    if (targetIdx === _actionIndex) return;
    if (targetIdx < _actionIndex) {
      while (_actionIndex > targetIdx) {
        _applyReverse(_actionHistory[_actionIndex]);
        _actionIndex--;
      }
    } else {
      while (_actionIndex < targetIdx) {
        _actionIndex++;
        _applyForward(_actionHistory[_actionIndex]);
      }
    }
    updateCornerHandles();
    deselectAll();
    renderHistoryPanel();
  }

  function _resyncImgStore() {
    document.querySelectorAll('#canvas .board-element[data-type="image"] img').forEach((img) => {
      if (img.src && img.src.startsWith('data:')) {
        const el = img.closest('.board-element');
        if (el && el.dataset.id) _imgStore.set(el.dataset.id, img.src);
      }
    });
  }

  // Ré-attache le double-clic d'édition sur une note clonée (Alt+drag ou undo)
  function reattachNoteEvents(el) {
    if (el._noteEventsAttached) return;
    el._noteEventsAttached = true;
    const wrap = el.querySelector('.el-note');
    const ta = el.querySelector('.el-note-content');
    if (!wrap || !ta) return;
    // Restaurer le contenu depuis dataset.savedata si le div est vide
    if (el.dataset.savedata && !ta.innerHTML.trim())
      ta.innerHTML = _noteDataToHtml(el.dataset.savedata);
    let _noteValueOnFocus = '';
    let _noteStyleOnFocus = '';
    function activateNoteEdit(e) {
      if (document.body.classList.contains('readonly-mode')) return;
      if (
        typeof Collab !== 'undefined' &&
        Collab.isActive() &&
        Collab.isLockedByOther(el.dataset.id)
      ) {
        toast("Élément en cours d'édition");
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      ta.contentEditable = 'true';
      el.dataset.editing = '1';
      _noteValueOnFocus = ta.innerHTML;
      _noteStyleOnFocus = ta.style.cssText;
      ta.focus();
      showTextEditPanel(el);
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.acquireLock(el.dataset.id);
      }
    }
    wrap.addEventListener('dblclick', activateNoteEdit);
    ta.addEventListener('dblclick', activateNoteEdit);
    ta.addEventListener('mousedown', (e) => {
      if (ta.contentEditable === 'true') e.stopPropagation();
    });
    ta.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    });
    ta.addEventListener('input', () => {
      el.dataset.savedata = ta.innerHTML;
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.syncElementData(el.dataset.id, ta.innerHTML);
      }
    });
    ta.addEventListener('blur', (e) => _handleNoteBlur(e, el, ta, _noteValueOnFocus, _noteStyleOnFocus));
    ta.addEventListener('keydown', (e) => _handleNoteListKeydown(e, ta, el));
    _attachNoteCheckboxListener(wrap, ta, el);
  }

  function _handleNoteBlur(e, el, ta, noteValueOnFocus, noteStyleOnFocus = '') {
    const sbText = document.querySelector('.sb-text');
    const goingToPanel = sbText && e.relatedTarget && sbText.contains(e.relatedTarget);
    if (goingToPanel || window._textPanelKeepOpen) return;
    ta.contentEditable = 'false';
    delete el.dataset.editing;
    hideTextEditPanel();
    if (typeof Collab !== 'undefined' && Collab.isActive()) {
      Collab.syncElementData(el.dataset.id, ta.innerHTML, true);
      Collab.releaseLock(el.dataset.id);
    }
    if (!ta.innerText.trim()) {
      pushAction({
        type: 'delete',
        elId: el.dataset.id,
        before: {
          type: el.dataset.type,
          x: parseFloat(el.style.left) || 0,
          y: parseFloat(el.style.top) || 0,
          w: parseFloat(el.style.width) || null,
          h: parseFloat(el.style.height) || null,
          z: parseInt(el.style.zIndex) || 100,
          data: noteValueOnFocus,
        },
      });
      if (hoveredEl === el) {
        hoveredEl = null;
        updateCornerHandles();
      }
      removeConnectionsForEl(el);
      el.remove();
      if (selectedEl === el) selectedEl = null;
      multiSelected.delete(el);
      syncDomToDataset();
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.syncElementDelete(el.dataset.id);
      }
    } else if (ta.innerHTML !== noteValueOnFocus || ta.style.cssText !== noteStyleOnFocus) {
      const lastAct = _actionHistory[_actionHistory.length - 1];
      const alreadyCovered = lastAct &&
        lastAct.type === 'editText' &&
        lastAct.elId === el.dataset.id &&
        lastAct.after.data === ta.innerHTML &&
        lastAct.after.style === ta.style.cssText;
      if (!alreadyCovered) {
        pushAction({
          type: 'editText',
          elId: el.dataset.id,
          before: { data: noteValueOnFocus, style: noteStyleOnFocus },
          after: { data: ta.innerHTML, style: ta.style.cssText },
        });
        syncDomToDataset();
      }
    }
  }

  // Ré-attache le double-clic sur une carte fichier clonée (après undo ou Alt+drag)
  function reattachFileEvents(el) {
    if (el._fileEventsAttached) return;
    el._fileEventsAttached = true;
    const vidWrap = el.querySelector('.el-file-video');
    const wrap = el.querySelector('.el-file');
    if (vidWrap) {
      vidWrap.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const d = (() => {
          try {
            return JSON.parse(el.dataset.savedata || '{}');
          } catch (_) {
            return {};
          }
        })();
        if (d.src) {
          openVideoLightbox(d.src);
          return;
        }
        if (document.body.classList.contains('readonly-mode')) return;
        fileReplaceTarget = el;
        document.getElementById('file-input-file').click();
      });
    } else if (wrap) {
      wrap.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        var d = {};
        try {
          d = JSON.parse(el.dataset.savedata || '{}');
        } catch (_) {}
        if (d.fileData) {
          if (typeof chrome !== 'undefined' && chrome.downloads) {
            chrome.downloads.download({
              url: d.fileData,
              filename: d.name || 'fichier',
              saveAs: true,
            });
          } else {
            var a = document.createElement('a');
            a.href = d.fileData;
            a.download = d.name || 'fichier';
            a.click();
          }
        } else {
          toast('Aucun fichier attaché');
        }
      });
    }
  }
  // Le dblclick d'un lien est posé sur .el-link, pas sur .board-element : cloneNode
  // ne le recopie pas. Sans ça, un lien dupliqué n'ouvre plus son URL.
  function reattachLinkEvents(el) {
    if (el._linkEventsAttached) return;
    el._linkEventsAttached = true;
    const wrap = el.querySelector('.el-link');
    if (!wrap) return;
    wrap.addEventListener('dblclick', () => {
      let d = {};
      try {
        d = JSON.parse(el.dataset.savedata || '{}');
      } catch (_) {}
      if (d.url) window.open(d.url, '_blank');
    });
  }

  // Même problème que reattachLinkEvents : le dblclick vit sur .el-video.
  function reattachVideoEvents(el) {
    if (el._videoEventsAttached) return;
    el._videoEventsAttached = true;
    const wrap = el.querySelector('.el-video');
    if (!wrap) return;
    wrap.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      let d = {};
      try {
        d = JSON.parse(el.dataset.savedata || '{}');
      } catch (_) {}
      if (d.src) openVideoLightbox(d.src, d.isEmbed);
    });
  }

  function reattachColorEvents(el) {
    // Guard : ne pas attacher les events plusieurs fois sur le même élément
    // Utiliser une propriété JS (pas dataset) pour ne pas être sérialisé dans innerHTML
    if (el._colorEventsAttached) return;
    el._colorEventsAttached = true;

    const swatch = el.querySelector('.color-swatch');
    const hexInput = el.querySelector('.color-hex-input');
    const eyeBtn = el.querySelector('.color-eyedropper');
    if (!swatch || !hexInput || !eyeBtn) return;

    // Restaurer la valeur depuis dataset.savedata (source de vérité)
    if (el.dataset.savedata) {
      hexInput.value = el.dataset.savedata.toUpperCase();
      swatch.style.background = el.dataset.savedata;
      _syncColorInfo(el, el.dataset.savedata);
    }
    // Lecture seule — pas d'édition directe
    hexInput.readOnly = true;
    hexInput.addEventListener('mousedown', (e) => e.stopPropagation());
    hexInput.addEventListener('pointerdown', (e) => e.stopPropagation());

    eyeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    eyeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    eyeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openColorSpectrumPicker(el, swatch, hexInput, el);
    });
  }

  // ── SÉLECTION ────────────────────────────────────────────────────────────
  function _collabSyncSelection() {
    if (typeof Collab === 'undefined' || !Collab.isActive()) return;
    const ids = [];
    if (selectedEl) ids.push(selectedEl.dataset.id);
    multiSelected.forEach((el) => ids.push(el.dataset.id));
    Collab.sendSelection(ids);
  }

  function deselectAll() {
    document
      .querySelectorAll('#canvas .board-element.selected')
      .forEach((el) => el.classList.remove('selected'));
    document
      .querySelectorAll('#canvas .board-element.multi-selected')
      .forEach((el) => el.classList.remove('multi-selected'));
    selectedEl = null;
    multiSelected.clear();
    updateMultiResizeHandle();
    updateCornerHandles();
    updateAllConnections();
    _collabSyncSelection();
  }

  function selectEl(el, addToMulti = false) {
    // Désélectionner les images de la bibliothèque pour éviter qu'un Suppr
    // ultérieur ne les efface alors que l'intention vise un élément du board.
    if (libSelectedIds.size) {
      libSelectedIds.clear();
      _libLastClickedId = null;
      document
        .querySelectorAll('.lib-panel-item.selected-lib-item')
        .forEach((d) => d.classList.remove('selected-lib-item'));
    }
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
      // Sync z-index en mode collab
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.syncElementZ(el.dataset.id, nextZ);
      }
    }
    updateMultiResizeHandle();
    updateCornerHandles();
    _collabSyncSelection();
  }

  // Supprime toutes les connexions liées à un élément
  function removeConnectionsForEl(el) {
    const id = el.dataset.id;
    if (!id) return;
    const canvas = document.getElementById('canvas');
    canvas.querySelectorAll('.el-connection').forEach((svg) => {
      if (svg.dataset.from === id || svg.dataset.to === id) {
        // Collab: sync suppression de connexion
        if (typeof Collab !== 'undefined' && Collab.isActive() && svg.dataset.connId) {
          Collab.syncConnectionDelete(svg.dataset.connId);
        }
        svg.remove();
      }
    });
  }

  // Supprime toutes les captions liées à un élément
  function removeCaptionsForEl(el) {
    const id = el.dataset.id;
    if (!id) return;
    const canvas = document.getElementById('canvas');
    canvas.querySelectorAll('.el-caption').forEach((cap) => {
      if (cap.dataset.parentId === id) {
        // Collab: sync suppression de caption
        if (typeof Collab !== 'undefined' && Collab.isActive() && cap.dataset.capId) {
          Collab.syncCaptionDelete(cap.dataset.capId);
        }
        cap.remove();
      }
    });
  }

  function applyDropSnap(el) {
    if (!el) return;
    el.classList.add('element-drop-snap');
    setTimeout(() => el.classList.remove('element-drop-snap'), 400);
  }

  function animateRemove(el, onDone) {
    el.style.pointerEvents = 'none';
    el.style.transition = 'transform 0.18s ease-in, opacity 0.18s ease-in';
    el.style.transformOrigin = 'center center';
    el.style.transform = 'scale(0)';
    el.style.opacity = '0';
    setTimeout(() => {
      el.remove();
      if (onDone) onDone();
    }, 180);
  }

  function _updateBrokenBanner() {
    const banner = document.getElementById('broken-images-banner');
    if (!banner) return;
    const count = document.querySelectorAll('#canvas .board-element.image-broken').length;
    if (count > 0) {
      const cEl = document.getElementById('broken-count');
      if (cEl) cEl.textContent = count;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }
  function deleteSelected() {
    const toDelete = [];
    multiSelected.forEach((el) => {
      removeConnectionsForEl(el);
      removeCaptionsForEl(el);
      toDelete.push(el);
    });
    multiSelected.clear();
    updateMultiResizeHandle();
    if (selectedEl) {
      removeConnectionsForEl(selectedEl);
      removeCaptionsForEl(selectedEl);
      toDelete.push(selectedEl);
      selectedEl = null;
    }
    if (!toDelete.length) {
      toast('Aucun élément sélectionné');
      return;
    }
    // Action-based undo for delete
    toDelete.forEach((el) => {
      pushAction({ type: 'delete', elId: el.dataset.id, before: _captureElState(el) });
    });
    // Collab: sync suppressions
    if (typeof Collab !== 'undefined' && Collab.isActive()) {
      toDelete.forEach((el) => Collab.syncElementDelete(el.dataset.id));
    }
    toDelete.forEach((el) => {
      if (hoveredEl === el) hoveredEl = null;
    });
    updateCornerHandles();
    let done = 0;
    toDelete.forEach((el) =>
      animateRemove(el, () => {
        if (el.dataset.type === 'image') {
          const id = el.dataset.id;
          _imgStore.delete(id);
          _imgOrigStore.delete(id);
        }
        done++;
        if (done === toDelete.length) {
          syncDomToDataset();
        }
      })
    );
  }

  function clearBoard() {
    if (!confirm('Vider tout le board ?')) return;
    document.getElementById('canvas').innerHTML = '';
    selectedEl = null;
    multiSelected.clear();
    syncDomToDataset();
  }

  // ── SNAP ─────────────────────────────────────────────────────────────────
  function getAllElements(exclude) {
    return Array.from(document.querySelectorAll('#canvas .board-element')).filter(
      (el) => !exclude || !exclude.has(el)
    );
  }

  function getRect(el) {
    const l = parseFloat(el.style.left) || 0;
    const t = parseFloat(el.style.top) || 0;
    let tx = 0,
      ty = 0;
    const tr = el.style.transform;
    if (tr) {
      const m = tr.match(/translate3d\(\s*([-\d.]+)px,\s*([-\d.]+)px/);
      if (m) {
        tx = parseFloat(m[1]);
        ty = parseFloat(m[2]);
      }
    }
    const left = l + tx;
    const top = t + ty;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    return { l: left, t: top, r: left + w, b: top + h, cx: left + w / 2, cy: top + h / 2, w, h };
  }

  function clearSnapGuides() {
    document.querySelectorAll('.snap-guide').forEach((g) => g.remove());
  }

  function showSnapGuide(isHorizontal, pos) {
    const canvas = document.getElementById('canvas');
    const g = document.createElement('div');
    g.className = 'snap-guide ' + (isHorizontal ? 'h' : 'v');
    if (isHorizontal) g.style.top = pos + 'px';
    else g.style.left = pos + 'px';
    canvas.appendChild(g);
  }

  function computeSnap(dragRect, others) {
    const T = snapThreshold / zoomLevel;
    let dx = null,
      dy = null;
    const guidesH = [],
      guidesV = [];

    // Candidats X de l'élément draggé — bords uniquement (pas centre)
    const xCands = [
      { val: dragRect.l, side: 'l' },
      { val: dragRect.r, side: 'r' },
    ];
    // Candidats Y — bords uniquement (pas centre)
    const yCands = [
      { val: dragRect.t, side: 't' },
      { val: dragRect.b, side: 'b' },
    ];

    // --- Alignement sur les bords des autres éléments (pas centres) ---
    others.forEach((other) => {
      const or = getRect(other);
      const xTargets = [or.l, or.r];
      const yTargets = [or.t, or.b];

      xCands.forEach((c) => {
        xTargets.forEach((target) => {
          const d = target - c.val;
          if (Math.abs(d) < T) {
            if (dx === null || Math.abs(d) < Math.abs(dx)) dx = d;
            guidesV.push(target);
          }
        });
      });
      yCands.forEach((c) => {
        yTargets.forEach((target) => {
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
    const finalGuidesV =
      finalDx !== 0
        ? [...new Set(guidesV.map((v) => Math.round(v)))].filter(
            (v) =>
              Math.abs(v - Math.round(dragRect.l + finalDx)) < 2 ||
              Math.abs(v - Math.round(dragRect.r + finalDx)) < 2
          )
        : [];
    const finalGuidesH =
      finalDy !== 0
        ? [...new Set(guidesH.map((v) => Math.round(v)))].filter(
            (v) =>
              Math.abs(v - Math.round(dragRect.t + finalDy)) < 2 ||
              Math.abs(v - Math.round(dragRect.b + finalDy)) < 2
          )
        : [];

    return { dx: finalDx, dy: finalDy, guidesH: finalGuidesH, guidesV: finalGuidesV };
  }

  function applySnap(el, excludeSet) {
    const others = getAllElements(excludeSet || new Set([el]));
    if (!others.length) return;
    const rect = getRect(el);
    const { dx, dy, guidesH, guidesV } = computeSnap(rect, others);
    clearSnapGuides();
    if (dx) el.style.left = parseFloat(el.style.left) + dx + 'px';
    if (dy) el.style.top = parseFloat(el.style.top) + dy + 'px';
    guidesH.forEach((pos) => showSnapGuide(true, pos));
    guidesV.forEach((pos) => showSnapGuide(false, pos));
  }

  // ── MULTI-RESIZE HANDLE ───────────────────────────────────────────────────
  function updateMultiResizeHandle() {
    const handle = document.getElementById('multi-resize-handle');
    const bbox = document.getElementById('group-bounding-box');
    const group = [...multiSelected];

    if (group.length < 2) {
      handle.style.display = 'none';
      if (bbox) bbox.style.display = 'none';
      updateAlignPanel();
      return;
    }

    // Calculer le bounding box global de tous les éléments sélectionnés
    const wrapperRect = document.getElementById('canvas-wrapper').getBoundingClientRect();
    let minL = Infinity,
      minT = Infinity,
      maxR = -Infinity,
      maxB = -Infinity;

    const selectedIds = new Set(group.map((el) => el.dataset.id));

    group.forEach((el) => {
      const r = el.getBoundingClientRect();
      const left = r.left - wrapperRect.left;
      const top = r.top - wrapperRect.top;
      const right = r.right - wrapperRect.left;
      const bottom = r.bottom - wrapperRect.top;

      if (left < minL) minL = left;
      if (top < minT) minT = top;
      if (right > maxR) maxR = right;
      if (bottom > maxB) maxB = bottom;
    });

    // Inclure les captions attachées aux éléments sélectionnés
    document.querySelectorAll('.el-caption').forEach((cap) => {
      if (!selectedIds.has(cap.dataset.parentId)) return;
      const r = cap.getBoundingClientRect();
      const left = r.left - wrapperRect.left;
      const top = r.top - wrapperRect.top;
      const right = r.right - wrapperRect.left;
      const bottom = r.bottom - wrapperRect.top;
      if (left < minL) minL = left;
      if (top < minT) minT = top;
      if (right > maxR) maxR = right;
      if (bottom > maxB) maxB = bottom;
    });

    // Placer la poignée en bas à droite
    handle.style.display = 'block';
    handle.style.left = maxR + 'px';
    handle.style.top = maxB + 'px';

    // Dessiner le cadre de sélection englobant tout le groupe
    if (bbox) {
      bbox.style.display = 'block';
      bbox.style.left = minL + 'px';
      bbox.style.top = minT + 'px';
      bbox.style.width = maxR - minL + 'px';
      bbox.style.height = maxB - minT + 'px';
    }
    updateAlignPanel();
  }

  function setupMultiResizeHandle() {
    const handle = document.getElementById('multi-resize-handle');
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const group = [...multiSelected];
      if (group.length < 2) return;

      // Snapshot des tailles et positions initiales
      const initRects = new Map();
      group.forEach((el) => {
        initRects.set(el, {
          left: parseFloat(el.style.left) || 0,
          top: parseFloat(el.style.top) || 0,
          w: el.offsetWidth,
          h: el.offsetHeight,
          ratio: el.dataset.ratio ? parseFloat(el.dataset.ratio) : null,
        });
      });

      const beforeStates = group.map((el) => {
        const r = initRects.get(el);
        return { elId: el.dataset.id, x: r.left, y: r.top, w: r.w, h: r.h };
      });

      // Bounding box initiale du groupe entier
      let minL = Infinity,
        minT = Infinity,
        maxR = -Infinity,
        maxB = -Infinity;
      group.forEach((el) => {
        const r = initRects.get(el);
        minL = Math.min(minL, r.left);
        minT = Math.min(minT, r.top);
        maxR = Math.max(maxR, r.left + r.w);
        maxB = Math.max(maxB, r.top + r.h);
      });
      const initGroupW = maxR - minL;
      const initGroupH = maxB - minT;
      const startX = e.clientX,
        startY = e.clientY;

      const onMove = (ev) => {
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

        group.forEach((el) => {
          const r = initRects.get(el);

          // Distance de cet élément au coin haut-gauche du groupe
          const relL = r.left - minL;
          const relT = r.top - minT;

          // Nouvelle position : ancrage = (minL, minT), chaque élément
          // se déplace proportionnellement (comme Illustrator)
          el.style.left = Math.round(minL + relL * scale) + 'px';
          el.style.top = Math.round(minT + relT * scale) + 'px';

          // Nouvelle taille proportionnelle
          if (r.ratio) {
            const nw = Math.max(40, Math.round(r.w * scale));
            el.style.width = nw + 'px';
            if (el.dataset.type !== 'note') el.style.height = Math.round(nw / r.ratio) + 'px';
          } else {
            el.style.width = Math.max(40, Math.round(r.w * scale)) + 'px';
            if (el.dataset.type !== 'note')
              el.style.height = Math.max(20, Math.round(r.h * scale)) + 'px';
          }
        });
        updateMultiResizeHandle();
        group.forEach((el) => updateConnectionsForEl(el));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const afterStates = group.map((el) => ({
          elId: el.dataset.id,
          x: parseFloat(el.style.left) || 0,
          y: parseFloat(el.style.top) || 0,
          w: parseFloat(el.style.width) || 0,
          h: parseFloat(el.style.height) || 0,
        }));
        if (typeof Collab !== 'undefined' && Collab.isActive()) {
          group.forEach((el) => {
            const x = parseFloat(el.style.left) || 0;
            const y = parseFloat(el.style.top) || 0;
            const w = parseFloat(el.style.width) || null;
            const h = parseFloat(el.style.height) || null;
            Collab.syncElementPosition(el.dataset.id, x, y, true);
            Collab.syncElementSize(el.dataset.id, w, h, true);
          });
        }
        pushAction({ type: 'groupResize', elId: group.map((e) => e.dataset.id), before: beforeStates, after: afterStates });
        syncDomToDataset();
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  // ── FACTORY ÉLÉMENT ──────────────────────────────────────────────────────
  function getCenter() {
    const w = document.getElementById('canvas-wrapper');
    const r = w.getBoundingClientRect();
    return { x: (r.width / 2 - panX) / zoomLevel, y: (r.height / 2 - panY) / zoomLevel };
  }

  function makeElement(type, x, y, w, h) {
    const el = document.createElement('div');
    el.className = 'board-element';
    el.dataset.type = type;
    el.dataset.id = 'el_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    if (w) el.style.width = w + 'px';
    if (h) el.style.height = h + 'px';
    el.style.zIndex = ++nextZ;

    attachElementEvents(el);
    document.getElementById('canvas').appendChild(el);
    return el;
  }
  function attachElementEvents(el) {
    el.addEventListener('mousedown', (e) => {
      if (document.body.classList.contains('readonly-mode')) return;
      if (isResizing) return;
      if (e.target.classList.contains('resize-handle')) return;
      if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'IFRAME'].includes(e.target.tagName)) return;
      if (e.target.isContentEditable) return;
      if (e.button !== 0) return;
      if (el.dataset.justDragged) return;
      // Collab: vérifier si l'élément est locké par un autre utilisateur
      if (
        typeof Collab !== 'undefined' &&
        Collab.isActive() &&
        Collab.isLockedByOther(el.dataset.id)
      ) {
        toast("Élément en cours d'édition par un autre utilisateur");
        return;
      }
      e.stopPropagation();
      e.preventDefault();

      // Blur tout input actif hors canvas (ex: barre de recherche) pour débloquer isTyping
      const ae = document.activeElement;
      if (ae && ae !== document.body && !document.getElementById('canvas').contains(ae)) {
        ae.blur();
      }

      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        selectEl(el, true);
        return;
      }

      if (multiSelected.has(el) && multiSelected.size > 1) {
        startGroupDrag(e, multiSelected, el);
        return;
      }

      const _wasSelectedBefore = selectedEl === el;
      selectEl(el);
      ['nw', 'ne', 'sw', 'se'].forEach((c) => {
        const h = document.getElementById('resize-corner-' + c);
        if (h) h.style.display = 'none';
      });
      ['n', 'e', 's', 'w'].forEach((edge) => {
        const h = document.getElementById('resize-edge-' + edge);
        if (h) h.style.display = 'none';
      });
      const canvasRect = document.getElementById('canvas').getBoundingClientRect();
      const startMX = (e.clientX - canvasRect.left) / zoomLevel;
      const startMY = (e.clientY - canvasRect.top) / zoomLevel;

      const origLeft = parseFloat(el.style.left) || 0;
      const origTop = parseFloat(el.style.top) || 0;

      let dragEl = el;
      let duplicated = false;
      const excludeSet = new Set([el]);
      let startLeft = parseFloat(dragEl.style.left) || 0;
      let startTop = parseFloat(dragEl.style.top) || 0;
      let curX = startLeft,
        curY = startTop;
      let targetX = startLeft,
        targetY = startTop;

      // Collab: acquérir le lock de manière optimiste au premier mouvement
      let _collabLockAcquired = false;
      let _collabLockPending = false;

      function doDuplicate() {
        if (duplicated) return;
        duplicated = true;
        _collabLockAcquired = false;
        const copy = el.cloneNode(true);
        copy.dataset.id = 'el_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        if (el.dataset.type === 'image' && _imgStore.has(el.dataset.id))
          _imgStore.set(copy.dataset.id, _imgStore.get(el.dataset.id));
        copy.style.zIndex = ++nextZ;
        copy.style.left = targetX + 'px';
        copy.style.top = targetY + 'px';
        copy.style.transform = '';
        // Restore original element to its pre-drag position
        el.style.left = origLeft + 'px';
        el.style.top = origTop + 'px';
        el.style.transform = '';
        document.getElementById('canvas').appendChild(copy);
        attachElementEvents(copy);
        if (copy.dataset.type === 'color') reattachColorEvents(copy);
        if (copy.dataset.type === 'note') reattachNoteEvents(copy);
        if (copy.dataset.type === 'file') reattachFileEvents(copy);
        if (copy.dataset.type === 'link') reattachLinkEvents(copy);
        if (copy.dataset.type === 'video') reattachVideoEvents(copy);
        // Marquer la copie comme "en cours de création" pour bloquer les .update() de position
        copy._collabPendingCreate = true;
        dragEl = copy;
        ['nw', 'ne', 'sw', 'se'].forEach((c) => {
          const h = document.getElementById('resize-corner-' + c);
          if (h) h.style.display = 'none';
        });
        ['n', 'e', 's', 'w'].forEach((edge) => {
          const h = document.getElementById('resize-edge-' + edge);
          if (h) h.style.display = 'none';
        });
        selectEl(dragEl);
        excludeSet.add(dragEl);
        startLeft = targetX;
        startTop = targetY;
        curX = targetX;
        curY = targetY;
        // Collab: sync la position de l'original (retour à sa place) pour le remote
        if (typeof Collab !== 'undefined' && Collab.isActive()) {
          Collab.syncElementPosition(el.dataset.id, origLeft, origTop, true);
          Collab.releaseLock(el.dataset.id);
          Collab.sendSelection([]);
        }
      }

      if (isAltDown) doDuplicate();
      let currentStartMX = startMX;
      let currentStartMY = startMY;
      let moved = false;

      let rafId = null;
      let dragActive = true;
      let shiftAxisX = null;
      let _frameCount = 0;

      const lerp = (a, b, t) => a + (b - a) * t;

      function dragRAF() {
        if (!dragActive) return;
        const prevX = curX,
          prevY = curY;
        curX = lerp(curX, targetX, 0.22);
        curY = lerp(curY, targetY, 0.22);

        const hasMoved = Math.abs(curX - prevX) > 0.05 || Math.abs(curY - prevY) > 0.05;
        if (hasMoved) {
          // Visual offset from frozen style.left/top
          let vx = curX - startLeft;
          let vy = curY - startTop;

          // Snap: compute visual pull without touching style.left/top or targetX/targetY
          if (ctrlSnap) {
            const others = getAllElements(excludeSet);
            if (others.length) {
              const snapRect = {
                l: curX,
                t: curY,
                r: curX + dragEl.offsetWidth,
                b: curY + dragEl.offsetHeight,
                w: dragEl.offsetWidth,
                h: dragEl.offsetHeight,
              };
              const { dx: sdx, dy: sdy, guidesH, guidesV } = computeSnap(snapRect, others);
              clearSnapGuides();
              if (sdx) vx += sdx;
              if (sdy) vy += sdy;
              guidesH.forEach((pos) => showSnapGuide(true, pos));
              guidesV.forEach((pos) => showSnapGuide(false, pos));
            }
          } else {
            clearSnapGuides();
          }

          dragEl.style.transform = `translate3d(${vx}px,${vy}px,0)`;
          ['nw', 'ne', 'sw', 'se'].forEach((c) => {
            const h = document.getElementById('resize-corner-' + c);
            if (h && h.style.display !== 'none') h.style.display = 'none';
          });
          ['n', 'e', 's', 'w'].forEach((edge) => {
            const h = document.getElementById('resize-edge-' + edge);
            if (h && h.style.display !== 'none') h.style.display = 'none';
          });

          // Throttle: update connections every other frame
          if (++_frameCount % 2 === 0) {
            updateConnectionsForEl(dragEl);
          }

          const _elId = dragEl.dataset.id;
          if (_elId) {
            document.querySelectorAll(`.el-caption[data-parent-id="${_elId}"]`).forEach((cap) => {
              cap.style.left = curX + 'px';
              cap.style.top = curY + dragEl.offsetHeight + 'px';
            });
          }
        }

        rafId = requestAnimationFrame(dragRAF);
      }

      const onMove = (ev) => {
        // Collab: tenter l'acquisition du lock au premier mouvement
        if (
          typeof Collab !== 'undefined' &&
          Collab.isActive() &&
          !_collabLockAcquired &&
          !_collabLockPending
        ) {
          _collabLockPending = true;
          Collab.acquireLock(dragEl.dataset.id).then((ok) => {
            _collabLockPending = false;
            if (ok) {
              _collabLockAcquired = true;
            } else {
              // Lock échoué: annuler le drag
              dragActive = false;
              cancelAnimationFrame(rafId);
              dragEl.style.left = origLeft + 'px';
              dragEl.style.top = origTop + 'px';
              dragEl.style.transform = '';
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
              toast('Élément verrouillé par un autre utilisateur');
            }
          });
        }
        if (isAltDown && !duplicated) {
          const prevAxis = shiftAxisX;
          doDuplicate();
          currentStartMX = (ev.clientX - canvasRect.left) / zoomLevel;
          currentStartMY = (ev.clientY - canvasRect.top) / zoomLevel;
          targetX = startLeft;
          targetY = startTop;
          shiftAxisX = prevAxis;
        }
        // Alt relâché → copie supprimée, original reprend drag depuis position du curseur
        if (!isAltDown && duplicated && dragEl !== el) {
          const copyX = targetX,
            copyY = targetY;
          dragEl.remove();
          duplicated = false;
          dragEl = el;
          selectEl(el);
          ['nw', 'ne', 'sw', 'se'].forEach((c) => {
            const h = document.getElementById('resize-corner-' + c);
            if (h) h.style.display = 'none';
          });
          ['n', 'e', 's', 'w'].forEach((edge) => {
            const h = document.getElementById('resize-edge-' + edge);
            if (h) h.style.display = 'none';
          });
          el.style.left = copyX + 'px';
          el.style.top = copyY + 'px';
          el.style.transform = '';
          curX = copyX;
          curY = copyY;
          targetX = copyX;
          targetY = copyY;
          startLeft = copyX;
          startTop = copyY;
          currentStartMX = (ev.clientX - canvasRect.left) / zoomLevel;
          currentStartMY = (ev.clientY - canvasRect.top) / zoomLevel;
          // Collab: sync la nouvelle position (curseur, pas P0)
          if (typeof Collab !== 'undefined' && Collab.isActive()) {
            Collab.syncElementPosition(el.dataset.id, copyX, copyY, true);
          }
          if (typeof Collab !== 'undefined' && Collab.isActive() && !_collabLockAcquired) {
            Collab.acquireLock(el.dataset.id).then(function (ok) {
              if (ok) _collabLockAcquired = true;
            });
          }
        }
        moved = true;
        const cx = (ev.clientX - canvasRect.left) / zoomLevel;
        const cy = (ev.clientY - canvasRect.top) / zoomLevel;
        let dx = cx - currentStartMX;
        let dy = cy - currentStartMY;

        if (ev.shiftKey) {
          if (shiftAxisX === null) {
            shiftAxisX = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
          }
          if (shiftAxisX === 'h') dy = 0;
          else dx = 0;
        } else {
          shiftAxisX = null;
        }

        targetX = startLeft + dx;
        targetY = startTop + dy;

        // Collab: sync position throttlée pendant le drag (pas pour les éléments en cours de création)
        if (
          typeof Collab !== 'undefined' &&
          Collab.isActive() &&
          _collabLockAcquired &&
          !dragEl._collabPendingCreate
        ) {
          Collab.syncElementPosition(dragEl.dataset.id, targetX, targetY, false);
          const _dragElH = dragEl.offsetHeight;
          document.querySelectorAll(`.el-caption[data-parent-id="${dragEl.dataset.id}"]`).forEach((cap) => {
            if (cap.dataset.capId) {
              Collab.syncCaptionPosition(cap.dataset.capId, targetX, targetY + _dragElH, false);
            }
          });
        }
      };

      const onUp = () => {
        dragActive = false;
        document.body.classList.remove('is-dragging-el'); // <-- RETRAIT ICI
        dragEl.classList.remove('is-dragging');
        dragEl.classList.remove('is-solo-dragging');
        cancelAnimationFrame(rafId);
        // Appliquer la position finale exacte et enlever le tilt
        dragEl.style.left = targetX + 'px';
        dragEl.style.top = targetY + 'px';
        dragEl.style.transform = '';
        if (ctrlSnap) applySnap(dragEl, excludeSet);
        updateConnectionsForEl(dragEl); // position finale après snap éventuel
        if (moved && !_wasSelectedBefore && !duplicated) deselectAll();
        updateCornerHandles();
        clearSnapGuides();
        // Repositionner les captions attachées sur la position finale
        const _elId2 = dragEl.dataset.id;
        if (_elId2) {
          const finalLeft = parseFloat(dragEl.style.left);
          const finalTop = parseFloat(dragEl.style.top);
          document.querySelectorAll(`.el-caption[data-parent-id="${_elId2}"]`).forEach((cap) => {
            cap.style.left = finalLeft + 'px';
            cap.style.top = finalTop + dragEl.offsetHeight + 'px';
            // Collab: sync la nouvelle position de la caption
            if (typeof Collab !== 'undefined' && Collab.isActive() && cap.dataset.capId) {
              Collab.syncCaption(
                cap.dataset.capId,
                _elId2,
                finalLeft,
                finalTop + dragEl.offsetHeight,
                cap.style.width || '',
                cap.textContent || ''
              );
            }
          });
        }
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (moved || duplicated) {
          // Action-based undo: enregistrer le mouvement
          if (moved && !duplicated) {
            const finalX = parseFloat(dragEl.style.left) || 0;
            const finalY = parseFloat(dragEl.style.top) || 0;
            pushAction({
              type: 'move',
              elId: dragEl.dataset.id,
              before: { x: origLeft, y: origTop },
              after: { x: finalX, y: finalY },
            });
          } else if (duplicated) {
            const d = dragEl;
            const _dupeLabels = { note: 'Note dupliquée', color: 'Couleur dupliquée', link: 'Lien dupliqué', image: 'Image dupliquée', file: 'Fichier dupliqué', video: 'Vidéo dupliquée' };
            pushAction({
              type: 'create',
              elId: d.dataset.id,
              after: {
                type: d.dataset.type,
                x: parseFloat(d.style.left) || 0,
                y: parseFloat(d.style.top) || 0,
                w: parseFloat(d.style.width) || null,
                h: parseFloat(d.style.height) || null,
                z: parseInt(d.style.zIndex) || 100,
                data:
                  d.dataset.type === 'image'
                    ? _imgStore.get(d.dataset.id) || ''
                    : d.dataset.savedata || '',
              },
              detail: _dupeLabels[d.dataset.type] || 'Élément dupliqué',
            });
          }
          syncDomToDataset();
          // Collab: sync la création si duplication (avec la position finale)
          if (duplicated && typeof Collab !== 'undefined' && Collab.isActive()) {
            delete dragEl._collabPendingCreate;
            _collabSyncCreatedEl(dragEl);
          }
          // Collab: sync position finale + libérer le lock (seulement pour un move, pas une duplication)
          if (
            !duplicated &&
            typeof Collab !== 'undefined' &&
            Collab.isActive() &&
            _collabLockAcquired
          ) {
            const fx = parseFloat(dragEl.style.left) || 0;
            const fy = parseFloat(dragEl.style.top) || 0;
            Collab.syncElementPosition(dragEl.dataset.id, fx, fy, true);
            Collab.releaseLock(dragEl.dataset.id);
          }
          dragEl.dataset.justDragged = '1';
          setTimeout(() => delete dragEl.dataset.justDragged, 150);
        }
      };

      document.body.classList.add('is-dragging-el'); // <-- AJOUT ICI
      dragEl.classList.add('is-dragging');
      dragEl.classList.add('is-solo-dragging');
      ['nw', 'ne', 'sw', 'se'].forEach((c) => {
        const h = document.getElementById('resize-corner-' + c);
        if (h) h.style.display = 'none';
      });
      ['n', 'e', 's', 'w'].forEach((edge) => {
        const h = document.getElementById('resize-edge-' + edge);
        if (h) h.style.display = 'none';
      });
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      // Démarrer la boucle RAF
      rafId = requestAnimationFrame(dragRAF);
    });

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.dataset.justDragged) return;
      if (_justGroupDragged) return;
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) selectEl(el);
    });

    // Double-clic sur image → lightbox
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (el.dataset.type === 'image') {
        const img = el.querySelector('img');
        if (img) openLightbox(img.src, el.dataset.id);
      }
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (document.body.classList.contains('readonly-mode')) return;
      // Si l'élément fait partie d'une multi-sélection, ne pas désélectionner
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !multiSelected.has(el)) selectEl(el);
      // Ajouter l'élément à la multi-sélection si pas encore dedans
      if (multiSelected.size > 0 && !multiSelected.has(el)) {
        el.classList.add('multi-selected');
        multiSelected.add(el);
      }
      ctxTargetEl = el;
      showContextMenu(e.clientX, e.clientY);
    });

    el.addEventListener('mouseenter', () => {
      clearTimeout(_hoverLeaveTimer);
      hoveredEl = el;
      updateCornerHandles();
    });
    el.addEventListener('mouseleave', () => {
      if (hoveredEl === el) {
        _hoverLeaveTimer = setTimeout(() => {
          hoveredEl = null;
          updateCornerHandles();
        }, 200);
      }
    });
  }

  function startGroupDrag(e, group, clickedEl) {
    // Collab: vérifier que aucun élément du groupe n'est locké par un autre
    if (typeof Collab !== 'undefined' && Collab.isActive()) {
      for (const el of group) {
        if (Collab.isLockedByOther(el.dataset.id)) {
          toast('Un élément du groupe est verrouillé');
          return;
        }
      }
    }

    const canvasRect = document.getElementById('canvas').getBoundingClientRect();
    let startMX = (e.clientX - canvasRect.left) / zoomLevel;
    let startMY = (e.clientY - canvasRect.top) / zoomLevel;

    // Groupe actif (peut changer si duplication)
    let activeGroup = new Set(group);
    let starts = new Map();
    activeGroup.forEach((el) => {
      starts.set(el, { left: parseFloat(el.style.left) || 0, top: parseFloat(el.style.top) || 0 });
    });
    let excludeSet = new Set(activeGroup);
    let duplicated = false;
    let moved = false;
    // Position initiale capturée une seule fois — jamais modifiée
    const trueInitialStarts = new Map(starts);
    // Sauvegardés lors de la duplication pour pouvoir annuler avec Alt-release
    let originalGroup = null;
    let originalStarts = null;
    let frozenDX = 0,
      frozenDY = 0;

    // Lerp state pour le multi-drag (déclaré ici pour être accessible dans doDuplicateGroup)
    let targetDX = 0,
      targetDY = 0;
    let curDX = 0,
      curDY = 0;

    // Snap sticky style Illustrator — verrou X/Y indépendants
    const _SNAP_ACQUIRE = 10;
    const _SNAP_RELEASE = 28;
    let _snapLock = { x: null, y: null }; // { raw, snap, guides[] } par axe

    function doDuplicateGroup() {
      if (duplicated) return;
      duplicated = true;
      // Sauvegarder les originaux et figer le delta courant pour pouvoir annuler (Alt-release)
      originalGroup = new Set(activeGroup);
      originalStarts = new Map(starts);
      frozenDX = curDX;
      frozenDY = curDY;
      // Restaurer les originaux à leur position initiale (invariant pendant tout le drag)
      activeGroup.forEach((el) => {
        const init = trueInitialStarts.get(el);
        if (init) {
          el.style.left = init.left + 'px';
          el.style.top = init.top + 'px';
        }
        el.style.transform = '';
      });
      const copies = new Set();
      // Positions courantes avant duplication
      const curPositions = new Map();
      activeGroup.forEach((el) => {
        const s = starts.get(el);
        if (!s) return;
        curPositions.set(el, {
          left: s.left + targetDX,
          top: s.top + targetDY,
        });
      });
      activeGroup.forEach((el) => {
        const copy = el.cloneNode(true);
        copy.dataset.id = 'el_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        if (el.dataset.type === 'image' && _imgStore.has(el.dataset.id))
          _imgStore.set(copy.dataset.id, _imgStore.get(el.dataset.id));
        copy.style.zIndex = ++nextZ;
        const cur = curPositions.get(el);
        copy.style.left = cur.left + 'px';
        copy.style.top = cur.top + 'px';
        copy.style.transform = '';
        document.getElementById('canvas').appendChild(copy);
        attachElementEvents(copy);
        if (copy.dataset.type === 'color') reattachColorEvents(copy);
        if (copy.dataset.type === 'note') reattachNoteEvents(copy);
        if (copy.dataset.type === 'file') reattachFileEvents(copy);
        if (copy.dataset.type === 'link') reattachLinkEvents(copy);
        if (copy.dataset.type === 'video') reattachVideoEvents(copy);
        copy._collabPendingCreate = true;
        copies.add(copy);
      });
      curDX = targetDX;
      curDY = targetDY;
      // Collab: libérer les locks sur les originaux + vider sélection
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        activeGroup.forEach(function (el) {
          Collab.releaseLock(el.dataset.id);
        });
        Collab.sendSelection([]);
      }
      // Les originaux restent, on déplace les copies
      activeGroup = copies;
      starts = new Map();
      activeGroup.forEach((el) => {
        starts.set(el, {
          left: parseFloat(el.style.left) || 0,
          top: parseFloat(el.style.top) || 0,
        });
      });
      excludeSet = new Set(activeGroup);
      // Sélectionner les copies
      deselectAll();
      activeGroup.forEach((el) => {
        el.classList.add('multi-selected');
        multiSelected.add(el);
      });
    }

    // Alt déjà enfoncé au départ
    if (isAltDown) doDuplicateGroup();

    let groupDragActive = true;
    let groupRafId = null;
    const lerpFactor = 0.12;
    let _gFrameCount = 0;

    function groupDragRAF() {
      if (!groupDragActive) return;
      const prevDX = curDX,
        prevDY = curDY;
      curDX += (targetDX - curDX) * lerpFactor;
      curDY += (targetDY - curDY) * lerpFactor;

      const hasMoved = Math.abs(curDX - prevDX) > 0.05 || Math.abs(curDY - prevDY) > 0.05;
      if (hasMoved) {
        activeGroup.forEach((el) => {
          const s = starts.get(el);
          if (!s) return;
          // s.left/s.top stay frozen; movement via transform
          el.style.transform = `translate3d(${curDX}px,${curDY}px,0)`;
        });
        // Throttle: update connections every other frame
        if (++_gFrameCount % 2 === 0) {
          activeGroup.forEach((el) => updateConnectionsForEl(el));
        }
        updateMultiResizeHandle();
      }
      groupRafId = requestAnimationFrame(groupDragRAF);
    }

    const onMove = (ev) => {
      // Alt enfoncé en cours → dupliquer
      if (isAltDown && !duplicated) {
        doDuplicateGroup();
        // Réinitialiser le delta pour les copies à partir de leur position actuelle
        curDX = 0;
        curDY = 0;
        targetDX = 0;
        targetDY = 0;
        startMX = (ev.clientX - canvasRect.left) / zoomLevel;
        startMY = (ev.clientY - canvasRect.top) / zoomLevel;
        return;
      }
      // Alt relâché → copies supprimées, originaux reprennent drag depuis position du curseur
      if (!isAltDown && duplicated && originalGroup) {
        const origArr = [...originalGroup];
        const copyArr = [...activeGroup]; // copies dans le même ordre
        origArr.forEach((origEl, i) => {
          const copy = copyArr[i];
          const s = starts.get(copy);
          origEl.style.left = (s ? s.left : 0) + targetDX + 'px';
          origEl.style.top = (s ? s.top : 0) + targetDY + 'px';
          origEl.style.transform = '';
          copy.remove();
        });
        activeGroup = originalGroup;
        duplicated = false;
        starts = new Map();
        activeGroup.forEach((el) => {
          starts.set(el, {
            left: parseFloat(el.style.left) || 0,
            top: parseFloat(el.style.top) || 0,
          });
        });
        curDX = 0;
        curDY = 0;
        targetDX = 0;
        targetDY = 0;
        startMX = (ev.clientX - canvasRect.left) / zoomLevel;
        startMY = (ev.clientY - canvasRect.top) / zoomLevel;
        deselectAll();
        activeGroup.forEach((el) => {
          el.classList.add('multi-selected');
          multiSelected.add(el);
        });
        excludeSet = new Set(activeGroup);
        originalGroup = null;
        return;
      }
      moved = true;
      const cx = (ev.clientX - canvasRect.left) / zoomLevel;
      const cy = (ev.clientY - canvasRect.top) / zoomLevel;
      let dx = cx - startMX,
        dy = cy - startMY;

      // Shift : contrainte axiale stricte
      if (ev.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) {
          dy = 0;
        } else {
          dx = 0;
        }
      }

      targetDX = dx;
      targetDY = dy;

      // Snap sticky style Illustrator — bounding box du groupe entier
      if (ctrlSnap) {
        const others = getAllElements(excludeSet);
        if (others.length) {
          // Relâcher le verrou si assez éloigné
          if (_snapLock.x && Math.abs(dx - _snapLock.x.raw) > _SNAP_RELEASE) _snapLock.x = null;
          if (_snapLock.y && Math.abs(dy - _snapLock.y.raw) > _SNAP_RELEASE) _snapLock.y = null;

          // Tenter d'acquérir sur les axes non verrouillés
          if (!_snapLock.x || !_snapLock.y) {
            const applyDX = _snapLock.x ? _snapLock.x.raw + _snapLock.x.snap : dx;
            const applyDY = _snapLock.y ? _snapLock.y.raw + _snapLock.y.snap : dy;
            let minL = Infinity,
              minT = Infinity,
              maxR = -Infinity,
              maxB = -Infinity;
            activeGroup.forEach((el) => {
              const s = starts.get(el);
              if (!s) return;
              const l = s.left + applyDX,
                t = s.top + applyDY;
              const r = l + el.offsetWidth,
                b = t + el.offsetHeight;
              if (l < minL) minL = l;
              if (t < minT) minT = t;
              if (r > maxR) maxR = r;
              if (b > maxB) maxB = b;
            });
            if (minL !== Infinity) {
              const snapRect = {
                l: minL,
                t: minT,
                r: maxR,
                b: maxB,
                w: maxR - minL,
                h: maxB - minT,
              };
              const { dx: sdx, dy: sdy, guidesH, guidesV } = computeSnap(snapRect, others);
              if (!_snapLock.x && sdx) _snapLock.x = { raw: dx, snap: sdx, guides: guidesV };
              if (!_snapLock.y && sdy) _snapLock.y = { raw: dy, snap: sdy, guides: guidesH };
            }
          }

          // Appliquer les verrous
          targetDX = _snapLock.x ? _snapLock.x.raw + _snapLock.x.snap : dx;
          targetDY = _snapLock.y ? _snapLock.y.raw + _snapLock.y.snap : dy;

          // Guides stockés au moment de l'accroche
          clearSnapGuides();
          if (_snapLock.x) _snapLock.x.guides.forEach((pos) => showSnapGuide(false, pos));
          if (_snapLock.y) _snapLock.y.guides.forEach((pos) => showSnapGuide(true, pos));
        }
      } else {
        _snapLock.x = null;
        _snapLock.y = null;
        clearSnapGuides();
      }
    };

    const onUp = () => {
      groupDragActive = false;
      _snapLock.x = null;
      _snapLock.y = null;
      document.body.classList.remove('is-dragging-el'); // <-- RETRAIT ICI
      activeGroup.forEach((el) => el.classList.remove('is-dragging'));

      if (groupRafId) {
        cancelAnimationFrame(groupRafId);
        groupRafId = null;
      }
      // Snap final sur la bounding box du groupe avant d'écrire les positions
      if (ctrlSnap) {
        const others = getAllElements(excludeSet);
        if (others.length) {
          let minL = Infinity,
            minT = Infinity,
            maxR = -Infinity,
            maxB = -Infinity;
          activeGroup.forEach((el) => {
            const s = starts.get(el);
            if (!s) return;
            const l = s.left + targetDX,
              t = s.top + targetDY;
            const r = l + el.offsetWidth,
              b = t + el.offsetHeight;
            if (l < minL) minL = l;
            if (t < minT) minT = t;
            if (r > maxR) maxR = r;
            if (b > maxB) maxB = b;
          });
          if (minL !== Infinity) {
            const snapRect = { l: minL, t: minT, r: maxR, b: maxB, w: maxR - minL, h: maxB - minT };
            const { dx: sdx, dy: sdy } = computeSnap(snapRect, others);
            if (sdx) targetDX += sdx;
            if (sdy) targetDY += sdy;
          }
        }
      }
      clearSnapGuides();
      // Appliquer la position finale exacte
      activeGroup.forEach((el) => {
        const s = starts.get(el);
        if (!s) return;
        el.style.left = s.left + targetDX + 'px';
        el.style.top = s.top + targetDY + 'px';
        el.style.transform = '';
      });
      activeGroup.forEach((el) => updateConnectionsForEl(el));
      updateMultiResizeHandle();
      _justGroupDragged = true;
      setTimeout(() => {
        _justGroupDragged = false;
      }, 80);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      clearSnapGuides();
      if (!moved && !duplicated && clickedEl) _setKeyObject(clickedEl);
      if (moved || duplicated) {
        syncDomToDataset();
        // Action-based undo: enregistrer le groupMove
        if (moved && !duplicated) {
          const ids = [];
          const beforeArr = [];
          const afterArr = [];
          activeGroup.forEach((el) => {
            const s = starts.get(el);
            if (!s) return;
            ids.push(el.dataset.id);
            beforeArr.push({ x: s.left, y: s.top });
            afterArr.push({ x: s.left + targetDX, y: s.top + targetDY });
          });
          pushAction({ type: 'groupMove', elId: ids, before: beforeArr, after: afterArr });
        } else if (duplicated) {
          // Enregistrer le groupe dupliqué comme UNE seule action
          var groupIds = [];
          var groupAfter = [];
          activeGroup.forEach(function (el) {
            groupIds.push(el.dataset.id);
            groupAfter.push({
              type: el.dataset.type,
              x: parseFloat(el.style.left) || 0,
              y: parseFloat(el.style.top) || 0,
              w: parseFloat(el.style.width) || null,
              h: parseFloat(el.style.height) || null,
              z: parseInt(el.style.zIndex) || 100,
              data:
                el.dataset.type === 'image'
                  ? _imgStore.get(el.dataset.id) || ''
                  : el.dataset.savedata || '',
            });
          });
          pushAction({ type: 'groupCreate', elId: groupIds, after: groupAfter, detail: 'Groupe dupliqué' });
        }
        // Collab: sync
        if (typeof Collab !== 'undefined' && Collab.isActive()) {
          if (duplicated) {
            // Sync la création de chaque copie (avec position finale)
            activeGroup.forEach(function (el) {
              delete el._collabPendingCreate;
              _collabSyncCreatedEl(el);
            });
          } else {
            // Sync positions finales + libérer les locks
            activeGroup.forEach((el) => {
              const fx = parseFloat(el.style.left) || 0;
              const fy = parseFloat(el.style.top) || 0;
              Collab.syncElementPosition(el.dataset.id, fx, fy, true);
              Collab.releaseLock(el.dataset.id);
            });
          }
        }
      }
    };
    // Collab: acquérir les locks sur tous les éléments du groupe
    if (typeof Collab !== 'undefined' && Collab.isActive()) {
      Promise.all([...activeGroup].map((el) => Collab.acquireLock(el.dataset.id))).then(
        (results) => {
          if (results.some((ok) => !ok)) {
            // Au moins un lock a échoué, libérer ceux acquis et annuler
            activeGroup.forEach((el) => Collab.releaseLock(el.dataset.id));
            toast('Un élément du groupe est verrouillé');
            return;
          }
        }
      );
    }
    activeGroup.forEach((el) => el.classList.add('is-dragging'));
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    groupRafId = requestAnimationFrame(groupDragRAF);
  }

  function _getMinSize(el) {
    const t = el && el.dataset ? el.dataset.type : '';
    if (t === 'link') {
      const hasLinkImg = el && el.querySelector('.link-image');
      return { w: 270, h: hasLinkImg ? 200 : 73 };
    }
    if (t === 'color') return { w: 130, h: 127 };
    if (t === 'file') return { w: 260, h: 76 };
    if (t === 'note') return { w: 160, h: 54 };
    return { w: 60, h: 40 };
  }

  function _scheduleResizeFrame() {
    if (_resizeRafId) return;
    _resizeRafId = requestAnimationFrame(() => {
      _resizeRafId = null;
      if (!isResizing || !resizeEl) return;
      resizeEl.style.width = _resizeTargetW + 'px';
      if (resizeEl.dataset.type !== 'note') resizeEl.style.height = _resizeTargetH + 'px';
      resizeEl.style.left = _resizeTargetLeft + 'px';
      resizeEl.style.top = _resizeTargetTop + 'px';
      if (resizeEl.dataset.type === 'file') {
        const fw = resizeEl.querySelector('.el-file');
        if (fw) {
          fw.style.transform = 'scale(' + _resizeTargetW / 260 + ')';
          fw.style.transformOrigin = 'top left';
        }
      }
      const _rId = resizeEl.dataset.id;
      if (_rId) {
        document.querySelectorAll(`.el-caption[data-parent-id="${_rId}"]`).forEach((cap) => {
          cap.style.width = _resizeTargetW + 'px';
          cap.style.left = _resizeTargetLeft + 'px';
          cap.style.top = _resizeTargetTop + _resizeTargetH + 'px';
        });
      }
      updateConnectionsForEl(resizeEl);
      updateCornerHandles();
    });
  }

  function handleResizeMouse(e) {
    const dx = (e.clientX - resizeStartX) / zoomLevel;
    const dy = (e.clientY - resizeStartY) / zoomLevel;
    const mins = _getMinSize(resizeEl);

    const rawW =
      resizeCorner === 'se' || resizeCorner === 'ne' || resizeCorner === 'e'
        ? resizeStartW + dx
        : resizeCorner === 'sw' || resizeCorner === 'nw' || resizeCorner === 'w'
          ? resizeStartW - dx
          : resizeStartW;
    const rawH =
      resizeCorner === 'se' || resizeCorner === 'sw' || resizeCorner === 's'
        ? resizeStartH + dy
        : resizeCorner === 'ne' || resizeCorner === 'nw' || resizeCorner === 'n'
          ? resizeStartH - dy
          : resizeStartH;

    let fw, fh;
    if (resizeRatio && resizeStartW > 0 && resizeStartH > 0) {
      const scale = Math.max(rawW / resizeStartW, rawH / resizeStartH, mins.w / resizeStartW);
      fw = Math.max(mins.w, Math.round(resizeStartW * scale));
      fh = Math.max(mins.h, Math.round(fw / resizeRatio));
    } else {
      fw = Math.max(mins.w, rawW);
      fh = Math.max(mins.h, rawH);
    }

    const newLeft =
      resizeStartLeft +
      (resizeCorner === 'sw' || resizeCorner === 'nw' || resizeCorner === 'w'
        ? resizeStartW - fw
        : 0);
    const newTop =
      resizeStartTop +
      (resizeCorner === 'ne' || resizeCorner === 'nw' || resizeCorner === 'n'
        ? resizeStartH - fh
        : 0);

    // Snap: only SE corner, unchanged behaviour
    if (ctrlSnap && resizeCorner === 'se') {
      const T = snapThreshold / zoomLevel;
      const others = getAllElements(new Set([resizeEl]));
      if (others.length) {
        const elL = newLeft;
        const elT = newTop;
        let elR = elL + fw;
        let elB = elT + fh;

        let snapDX = null,
          snapDY = null;
        const guidesH = [],
          guidesV = [];

        others.forEach((other) => {
          const or = getRect(other);
          const xTargets = [or.l, or.cx, or.r];
          const yTargets = [or.t, or.cy, or.b];
          xTargets.forEach((target) => {
            const d = target - elR;
            if (Math.abs(d) < T && (snapDX === null || Math.abs(d) < Math.abs(snapDX))) {
              snapDX = d;
              guidesV.push(target);
            }
          });
          yTargets.forEach((target) => {
            const d = target - elB;
            if (Math.abs(d) < T && (snapDY === null || Math.abs(d) < Math.abs(snapDY))) {
              snapDY = d;
              guidesH.push(target);
            }
          });
        });

        if (snapDX) {
          const snappedW = Math.max(resizeRatio ? 40 : 60, fw + snapDX);
          if (resizeRatio) {
            fw = snappedW;
            fh = Math.round(snappedW / resizeRatio);
          } else {
            fw = snappedW;
          }
        }
        if (snapDY && !resizeRatio) {
          fh = Math.max(40, fh + snapDY);
        }

        clearSnapGuides();
        guidesH.forEach((pos) => showSnapGuide(true, pos));
        guidesV.forEach((pos) => showSnapGuide(false, pos));
      }
    } else {
      clearSnapGuides();
    }

    _resizeTargetW = fw;
    _resizeTargetH = fh;
    _resizeTargetLeft = newLeft;
    _resizeTargetTop = newTop;
    _scheduleResizeFrame();
  }

  // ── RESTORE ──────────────────────────────────────────────────────────────
  function _applyStyleToEl(el, style) {
    if (!el || !style) return;
    const target = el.querySelector('.el-note-content') || el;
    if (style.fontFamily) {
      target.style.fontFamily = style.fontFamily;
      const _fam = style.fontFamily.split(',')[0].trim().replace(/['"]/g, '');
      if (_fam) _loadGFont(_fam);
    }
    if (style.fontWeight) target.style.fontWeight = style.fontWeight;
    if (style.fontSize) target.style.fontSize = style.fontSize;
    if (style.textAlign) target.style.textAlign = style.textAlign;
  }

  function restoreElement(s) {
    let el;
    if (s.type === 'image') el = createImageElement(s.data, s.x, s.y, s.w, s.h);
    else if (s.type === 'note') {
      el = createNoteElement(s.data, s.x, s.y, s.w, s.h);
      if (s.style) _applyStyleToEl(el, s.style);
    } else if (s.type === 'color') el = createColorElement(s.data, s.x, s.y, s.w, s.h);
    else if (s.type === 'link') {
      const d = tryParse(s.data);
      el = createLinkElement(d.url, d.title, d.img, s.x, s.y);
    } else if (s.type === 'video') {
      const d = tryParse(s.data);
      el = createVideoElement(d.src, d.isEmbed, s.x, s.y, s.w, s.h);
    } else if (s.type === 'file') {
      const d = tryParse(s.data);
      if (d.isVideo) el = createVideoFileElement(d.name, d.size, d.src || '', s.x, s.y, s.w, s.h);
      else {
        el = createFileElement(d.name, d.size, d.icon, s.x, s.y);
        // Restaurer les dimensions du conteneur (createFileElement fixe 260×76 par défaut)
        if (s.w) el.style.width = s.w + 'px';
        if (s.h) el.style.height = s.h + 'px';
        if (d.fileData) el.dataset.savedata = s.data;
      }
    } else if (s.type === 'connection') {
      // Restaurer après que les éléments soient dans le DOM
      setTimeout(() => createConnection(s.from, s.to), 50);
      return null;
    } else if (s.type === 'caption') {
      const cap = document.createElement('div');
      cap.classList.add('el-caption');
      cap.contentEditable = 'true';
      cap.dataset.placeholder = 'Ajouter un commentaire…';
      cap.dataset.parentId = s.parentId || '';
      cap.dataset.type = 'caption';
      // Toujours un capId : sans lui la caption est invisible pour la sync collab
      // et startSession en génère un autre, ce qui la duplique.
      cap.dataset.capId =
        s.capId || 'cap_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      cap.style.left = s.x + 'px';
      cap.style.top = s.y + 'px';
      if (s.width) cap.style.width = s.width;
      cap.textContent = s.text || '';
      if (s.style) _applyStyleToEl(cap, s.style);

      // Liaison au panneau de texte
      cap.addEventListener('input', () => {
        if (typeof Collab !== 'undefined' && Collab.isActive() && cap.dataset.capId) {
          Collab.syncCaptionText(cap.dataset.capId, cap.textContent);
        }
      });
      cap.addEventListener('focus', () => { _capValueOnFocus = cap.textContent; showTextEditPanel(cap); });
      cap.addEventListener('blur', (e) => handleCaptionBlur(e, cap));

      document.getElementById('canvas').appendChild(cap);
      return cap;
    }
    if (el && s.z) el.style.zIndex = s.z;
    if (el && s.type === 'file') {
      var fileWrap = el.querySelector('.el-file');
      if (fileWrap) {
        fileWrap.style.width = '260px';
        fileWrap.style.height = '76px';
        fileWrap.style.overflow = 'hidden';
        if (s.w) {
          fileWrap.style.transform = 'scale(' + s.w / 260 + ')';
          fileWrap.style.transformOrigin = 'top left';
        }
      }
    }
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
    if (s.type === 'image' && el) {
      if (s.origData && !_imgOrigStore.has(el.dataset.id)) _imgOrigStore.set(el.dataset.id, s.origData);
      if (s.cropdata) el.dataset.cropdata = s.cropdata;
      if (s.storageUrl) el.dataset.storageurl = s.storageUrl;
    }
    return el;
  }

  // ── COLLAB BOARD (rejoindre en tant que guest) ─────────────────────────
  async function _loadCollabBoard(boardId) {
    const errPage = (msg) => {
      document.body.innerHTML =
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px;background:#f4f4f6;"><div style="font-family:\'HelveticaBold\',sans-serif;font-size:26px;color:#ff3c00">MOODBOARDS</div><div style="font-size:15px;color:#888">' +
        msg +
        '</div></div>';
    };
    if (!window._fbDb) {
      errPage('Firebase non disponible.');
      return;
    }
    if (typeof Collab === 'undefined') {
      errPage('Module de collaboration non chargé.');
      return;
    }
    if (window._fbAuthReady) {
      await window._fbAuthReady;
    }
    try {
      const metaCheck = await window._fbDb.ref('collabSessions/' + boardId + '/meta').get();
      if (!metaCheck.exists()) {
        errPage("Cette session collaborative n'existe plus ou est terminée.");
        return;
      }
      // Charger le nom du board depuis boards/
      const boardSnap = await window._fbDb.ref('boards/' + boardId).get();
      const boardName = (boardSnap.exists() && boardSnap.val().name) || 'Moodboard';

      // Afficher le board screen
      document.getElementById('board-screen').style.display = 'flex';
      document.getElementById('board-title-display').textContent = boardName;
      document.getElementById('canvas').innerHTML = '';
      zoomLevel = 1;
      panX = 0;
      panY = 0;
      nextZ = 100;
      applyTransform();

      // Charger les éléments depuis la session collab
      const elemSnap = await window._fbDb.ref('collabSessions/' + boardId + '/elements').get();
      if (elemSnap.exists()) {
        elemSnap.forEach((child) => {
          const d = child.val();
          if (d.deleted) return;
          restoreElement({
            id: child.key,
            type: d.type,
            x: d.x,
            y: d.y,
            w: d.w,
            h: d.h,
            z: d.z,
            data: d.data || '',
          });
          if (d.z && d.z >= nextZ) nextZ = d.z + 1;
        });
      }
      // Charger les connexions
      const connSnap = await window._fbDb.ref('collabSessions/' + boardId + '/connections').get();
      if (connSnap.exists()) {
        connSnap.forEach((child) => {
          const d = child.val();
          setTimeout(() => createConnection(d.from, d.to), 100);
        });
      }
      // Charger les captions
      const capSnap = await window._fbDb.ref('collabSessions/' + boardId + '/captions').get();
      if (capSnap.exists()) {
        capSnap.forEach((child) => {
          const d = child.val();
          const cap = restoreElement({
            type: 'caption',
            x: d.x,
            y: d.y,
            width: d.width,
            parentId: d.parentId,
            text: d.text,
          });
          if (cap) cap.dataset.capId = child.key;
        });
      }

      setTimeout(() => fitElementsToScreen(), 150);
      syncDomToDataset();

      // Démarrer la session collab en tant que guest
      currentBoardId = boardId;
      await Collab.startSession(boardId, false);

      var collabBtn = document.getElementById('collab-btn');
      if (collabBtn) collabBtn.style.display = 'none';
      var shareWrap = document.getElementById('share-wrap');
      if (shareWrap && window._fbDb && !document.body.classList.contains('readonly-mode'))
        shareWrap.style.display = '';
      var _hb2 = document.getElementById('history-btn');
      if (_hb2 && !document.body.classList.contains('readonly-mode')) _hb2.style.display = '';

      setupUIEvents();
    } catch (e) {
      errPage('Erreur lors du chargement de la session collaborative.');
    }
  }

  // ── JOIN BOARD BY ID (rejoindre via ID depuis l'accueil) ────────────────
  async function joinBoardById(boardId) {
    boardId = (boardId || '').trim();
    if (!boardId) {
      toast('Veuillez entrer un ID de board');
      return;
    }

    // Déjà dans la liste locale ?
    const existing = boards.find((b) => b.id === boardId);
    if (existing) {
      toast('Ce board est déjà dans votre liste');
      openBoard(boardId);
      return;
    }

    if (!window._fbDb) {
      toast('Firebase non disponible');
      return;
    }
    if (typeof Collab === 'undefined') {
      toast('Module collab non chargé');
      return;
    }

    if (window._fbAuthReady) {
      await window._fbAuthReady;
    }
    try {
      const metaSnap0 = await window._fbDb.ref('collabSessions/' + boardId + '/meta').get();
      if (!metaSnap0.exists()) {
        toast("Cette session collaborative n'existe pas");
        return;
      }

      // Récupérer le nom du board
      const boardSnap = await window._fbDb.ref('boards/' + boardId).get();
      const boardName = (boardSnap.exists() && boardSnap.val().name) || 'Moodboard';

      // Ajouter à la liste locale avec le flag isCollaborative
      const cols = Math.max(1, Math.floor((window.innerWidth - 200) / 220));
      const idx = boards.length;
      boards.push({
        id: boardId,
        name: boardName,
        created: new Date().toLocaleDateString('fr-FR'),
        savedAt: Date.now(),
        thumbnail: '',
        elements: [],
        x: 60 + (idx % cols) * 220,
        y: 80 + Math.floor(idx / cols) * 240,
        isCollaborative: true,
      });
      saveBoards();
      renderBoardsWheel(); // ← AJOUTER CETTE LIGNE pour que la carte apparaisse avant navigation
      toast('Board rejoint ! Ouverture en cours…');
      openBoard(boardId);
    } catch (e) {
      toast('Erreur lors de la connexion au board');
    }
  }

  // ── OPEN COLLAB BOARD (depuis l'accueil, auto-reconnexion) ───────────────
  async function _openCollabBoard(board) {
    const loaderOverlay = document.getElementById('loader-overlay');
    const loaderFrame = loaderOverlay.querySelector('.loader-frame');
    loaderFrame.style.animation = 'none';
    void loaderFrame.offsetWidth;
    loaderFrame.style.animation = '';
    loaderOverlay.classList.remove('hidden');

    if (!window._fbDb || typeof Collab === 'undefined') {
      toast('Firebase non disponible — copie locale chargée');
      _openCollabBoardLocal(board);
      setTimeout(() => loaderOverlay.classList.add('hidden'), 2000);
      return;
    }

    if (window._fbAuthReady) {
      await window._fbAuthReady;
    }
    try {
      const metaCheck = await window._fbDb.ref('collabSessions/' + board.id + '/meta').get();
      const isActive = metaCheck.exists();

      if (isActive) {
        // Session active : charger depuis Firebase et démarrer collab
        currentBoardId = board.id;
        document.getElementById('home-screen').style.display = 'none';
        document.getElementById('board-screen').style.display = 'flex';
        document.getElementById('board-title-display').textContent = board.name;
        if (window._reattachPinch) window._reattachPinch();
        document.getElementById('canvas').innerHTML = '';
        zoomLevel = 1;
        panX = 0;
        panY = 0;
        nextZ = 100;
        _actionHistory = [];
        _actionIndex = -1;
        selectedEl = null;
        multiSelected.clear();
        applyTransform();
        updateZoomDisplay();

        // Charger éléments depuis la session collab
        const elemSnap = await window._fbDb.ref('collabSessions/' + board.id + '/elements').get();
        const _pendingImageIds = new Set();
        if (elemSnap.exists()) {
          elemSnap.forEach((child) => {
            const d = child.val();
            if (d.deleted) return;
            if (d.type === 'image' && (!d.data || d.data === 'pending')) {
              _pendingImageIds.add(child.key);
            }
            restoreElement({
              id: child.key,
              type: d.type,
              x: d.x,
              y: d.y,
              w: d.w,
              h: d.h,
              z: d.z,
              data: d.data || '',
              style: d.style || null,
            });
            if (d.z && d.z >= nextZ) nextZ = d.z + 1;
          });
        }
        // Charger connexions
        const connSnap = await window._fbDb
          .ref('collabSessions/' + board.id + '/connections')
          .get();
        if (connSnap.exists()) {
          connSnap.forEach((child) => {
            const d = child.val();
            setTimeout(() => createConnection(d.from, d.to), 100);
          });
        }
        // Charger captions
        const capSnap = await window._fbDb.ref('collabSessions/' + board.id + '/captions').get();
        if (capSnap.exists()) {
          capSnap.forEach((child) => {
            const d = child.val();
            const cap = restoreElement({
              type: 'caption',
              x: d.x,
              y: d.y,
              width: d.width,
              parentId: d.parentId,
              text: d.text,
              style: d.style || null,
            });
            if (cap) cap.dataset.capId = child.key;
          });
        }

        setTimeout(() => fitElementsToScreen(), 150);
        syncDomToDataset();
        loadLibraryForBoard(board.id);
        renderPanelLib();

        await Collab.startSession(board.id, false);

        // Récupération : pour les images marquées 'pending' sur Firebase,
        // ré-injecter la base64 depuis le stockage local si disponible et
        // ré-uploader vers Firebase pour réparer la session.
        if (_pendingImageIds.size && board.elements && board.elements.length) {
          const _localById = {};
          board.elements.forEach((e) => {
            if (e && e.id) _localById[e.id] = e;
          });
          let _recovered = 0;
          const _toUpload = [];
          _pendingImageIds.forEach((id) => {
            const local = _localById[id];
            if (
              local &&
              local.type === 'image' &&
              local.data &&
              local.data !== 'pending' &&
              /^data:/.test(local.data)
            ) {
              _imgStore.set(id, local.data);
              const elDom = document.querySelector('[data-id="' + id + '"]');
              if (elDom) {
                const imgTag = elDom.querySelector('img');
                if (imgTag) imgTag.src = local.data;
              }
              _toUpload.push({ id, data: local.data });
              _recovered++;
            }
          });
          if (_recovered) toast(_recovered + ' image(s) restaurée(s) depuis la sauvegarde locale');
          // Upload sequentially (400 ms apart) to avoid Firebase "Write too large" errors
          for (var _ri = 0; _ri < _toUpload.length; _ri++) {
            if (_ri > 0) await new Promise((r) => setTimeout(r, 400));
            if (typeof Collab !== 'undefined' && Collab.isActive()) {
              Collab.syncElementData(_toUpload[_ri].id, _toUpload[_ri].data, true);
            }
          }
        }

        setTimeout(_updateBrokenBanner, 200);

        const collabBtn = document.getElementById('collab-btn');
        if (collabBtn) collabBtn.style.display = 'none';
        const shareWrap = document.getElementById('share-wrap');
        if (shareWrap && window._fbDb && !document.body.classList.contains('readonly-mode'))
          shareWrap.style.display = '';
        const _hb3 = document.getElementById('history-btn');
        if (_hb3 && !document.body.classList.contains('readonly-mode')) _hb3.style.display = '';
      } else {
        // Pas de session Firebase : créer une nouvelle session depuis les données locales
        currentBoardId = board.id;
        document.getElementById('home-screen').style.display = 'none';
        document.getElementById('board-screen').style.display = 'flex';
        document.getElementById('board-title-display').textContent = board.name;
        if (window._reattachPinch) window._reattachPinch();
        document.getElementById('canvas').innerHTML = '';
        zoomLevel = 1;
        panX = 0;
        panY = 0;
        nextZ = 100;
        _actionHistory = [];
        _actionIndex = -1;
        selectedEl = null;
        multiSelected.clear();
        applyTransform();
        updateZoomDisplay();
        if (board.elements && board.elements.length) {
          board.elements.forEach(function (e) {
            restoreElement(e);
          });
          setTimeout(function () {
            fitElementsToScreen();
            syncDomToDataset();
          }, 120);
        } else {
          syncDomToDataset();
        }
        loadLibraryForBoard(board.id);
        renderPanelLib();
        // Démarrer une session collab comme owner avec les éléments locaux
        var localElements = _collabGetBoardElements();
        await Collab.startSession(board.id, true, { elements: localElements });
        var collabBtn2 = document.getElementById('collab-btn');
        if (collabBtn2) collabBtn2.style.display = 'none';
        var shareWrap2 = document.getElementById('share-wrap');
        if (shareWrap2 && window._fbDb && !document.body.classList.contains('readonly-mode'))
          shareWrap2.style.display = '';
        var _hb4 = document.getElementById('history-btn');
        if (_hb4 && !document.body.classList.contains('readonly-mode')) _hb4.style.display = '';
        setTimeout(_updateBrokenBanner, 200);
      }
    } catch (e) {
      toast('Erreur de connexion — copie locale chargée');
      _openCollabBoardLocal(board);
    }

    setTimeout(() => loaderOverlay.classList.add('hidden'), 2000);
  }

  function _openCollabBoardLocal(board) {
    currentBoardId = board.id;
    document.body.classList.add('readonly-mode');
    document.getElementById('home-screen').style.display = 'none';
    document.getElementById('board-screen').style.display = 'flex';
    document.getElementById('board-title-display').textContent = board.name;
    if (window._reattachPinch) window._reattachPinch();
    document.getElementById('canvas').innerHTML = '';
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    nextZ = 100;
    _actionHistory = [];
    _actionIndex = -1;
    selectedEl = null;
    multiSelected.clear();
    applyTransform();
    updateZoomDisplay();
    if (board.elements && board.elements.length) {
      board.elements.forEach((e) => restoreElement(e));
      setTimeout(() => {
        fitElementsToScreen();
        syncDomToDataset();
      }, 120);
    } else {
      syncDomToDataset();
    }
    renderPanelLib();
    const shareWrap = document.getElementById('share-wrap');
    if (shareWrap) shareWrap.style.display = 'none';
    const collabBtn = document.getElementById('collab-btn');
    if (collabBtn) collabBtn.style.display = 'none';
  }

  // ── SHARED BOARD (lecture seule) ────────────────────────────────────────
  async function _loadSharedBoard(id) {
    const errPage = (msg) => {
      document.body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px;background:#f4f4f6;"><div style="font-family:'HelveticaBold',sans-serif;font-size:26px;color:#ff3c00">MOODBOARDS</div><div style="font-size:15px;color:#888">${msg}</div></div>`;
    };
    if (!window._fbDb) {
      errPage('Firebase non disponible.');
      return;
    }
    // Attendre l'auth anonyme (les règles DB exigent auth != null).
    // Sans ça, sur iPhone Safari / navigation privée / nouveau profil,
    // la lecture est tentée avant la fin du signInAnonymously et échoue.
    if (window._fbAuthReady) {
      try {
        await window._fbAuthReady;
      } catch (_) {}
    }
    try {
      let snap = await window._fbDb.ref('boards/' + id).get();
      let isCollabSession = false;
      if (!snap.exists()) {
        // Fallback : essayer dans les sessions collaboratives
        var collabSnap = await window._fbDb.ref('collabSessions/' + id + '/elements').get();
        if (!collabSnap.exists()) {
          errPage("Ce moodboard n'existe pas ou a été supprimé.");
          return;
        }
        isCollabSession = true;
      }
      document.body.classList.add('readonly-mode');
      document.getElementById('board-screen').style.display = 'flex';
      document.getElementById('canvas').innerHTML = '';
      zoomLevel = 1;
      panX = 0;
      panY = 0;
      nextZ = 100;
      applyTransform();
      if (isCollabSession) {
        document.getElementById('board-title-display').textContent = 'Moodboard';
        var elemSnap = await window._fbDb.ref('collabSessions/' + id + '/elements').get();
        if (elemSnap.exists()) {
          elemSnap.forEach(function (child) {
            var d = child.val();
            if (d && !d.deleted) {
              restoreElement({
                id: child.key,
                type: d.type,
                x: d.x,
                y: d.y,
                w: d.w,
                h: d.h,
                z: d.z,
                data: d.data || '',
              });
            }
          });
        }
        setTimeout(function () {
          fitElementsToScreen();
        }, 150);
        syncDomToDataset();
        return;
      }
      const boardData = snap.val();
      document.getElementById('board-title-display').textContent = boardData.name || 'Moodboard';
      if (boardData.elements && boardData.elements.length) {
        boardData.elements.forEach((e) => {
          if (e.type === 'caption') {
            const cap = restoreElement(e);
            if (cap) cap.contentEditable = 'false';
          } else {
            restoreElement(e);
          }
        });
        setTimeout(() => fitElementsToScreen(), 150);
      }
    } catch (e) {
      errPage('Erreur de chargement.');
    }
  }

  // ── IMAGE ─────────────────────────────────────────────────────────────────
  function createImageElement(src, x, y, w, h) {
    const isBrokenSrc =
      !src ||
      src === 'pending' ||
      typeof src !== 'string' ||
      (!src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('blob:'));
    const doCreate = (natW, natH) => {
      let fw = w || natW || 220;
      let fh = h || natH || 170;
      // Limiter à 20% de la dimension dominante de la vue visible (en coordonnées canvas)
      if (!w && !h) {
        const wrapEl = document.getElementById('canvas-wrapper');
        const vw = (wrapEl ? wrapEl.clientWidth : window.innerWidth) / (zoomLevel || 1);
        const vh = (wrapEl ? wrapEl.clientHeight : window.innerHeight) / (zoomLevel || 1);
        const maxDim = Math.max(vw, vh) * 0.2;
        if (fw > maxDim) {
          fh = Math.round((fh * maxDim) / fw);
          fw = Math.round(maxDim);
        }
        if (fh > maxDim) {
          fw = Math.round((fw * maxDim) / fh);
          fh = Math.round(maxDim);
        }
      }
      const el = makeElement('image', x || 100, y || 100, fw, fh);
      _imgStore.set(el.dataset.id, isBrokenSrc ? '' : src);
      // Stocker le ratio w/h pour le resize proportionnel
      el.dataset.ratio = (fw / fh).toFixed(6);
      if (isBrokenSrc) {
        el.classList.add('image-broken');
        const ph = document.createElement('div');
        ph.className = 'image-broken-content';
        ph.innerHTML =
          '<div class="ib-icon">⚠</div><div class="ib-label">Image perdue</div><button class="ib-restore-btn" type="button">Restaurer</button>';
        ph.querySelector('.ib-restore-btn').addEventListener('click', (ev) => {
          ev.stopPropagation();
          _restoreBrokenImage(el);
        });
        el.insertBefore(ph, el.querySelector('.element-toolbar'));
      } else {
        const img = document.createElement('img');
        img.src = src;
        img.draggable = false;
        el.insertBefore(img, el.querySelector('.element-toolbar'));
      }
      return el;
    };
    // Si les dimensions sont déjà connues (chargement sauvegarde), créer directement
    if (w && h) return doCreate(w, h);
    // Image broken sans dimensions : utiliser un placeholder de taille par défaut
    if (isBrokenSrc) return doCreate(220, 170);
    // Sinon, charger l'image pour obtenir ses dimensions naturelles
    const tmpImg = new Image();
    tmpImg.onload = () => doCreate(tmpImg.naturalWidth, tmpImg.naturalHeight);
    tmpImg.onerror = () => doCreate(220, 170);
    tmpImg.src = src;
    return null; // création asynchrone
  }
  function _applyRestoredImageSrc(el, base64) {
    const id = el.dataset.id;
    const oldSrc = _imgStore.get(id) || '';
    const oldW = parseFloat(el.style.width) || null;
    const oldH = parseFloat(el.style.height) || null;
    _imgStore.set(id, base64);
    const placeholder = el.querySelector('.image-broken-content');
    if (placeholder) placeholder.remove();
    el.classList.remove('image-broken');
    const existingImg = el.querySelector('img');
    if (existingImg) existingImg.remove();
    const img = document.createElement('img');
    img.src = base64;
    img.draggable = false;
    el.insertBefore(img, el.querySelector('.element-toolbar'));
    if (typeof Collab !== 'undefined' && Collab.isActive()) {
      Collab.syncElementData(id, base64, true);
    }
    try {
      saveCurrentBoard();
    } catch (_) {}
    pushAction({
      type: 'editImage',
      elId: id,
      before: { data: oldSrc, w: oldW, h: oldH },
      after: { data: base64, w: parseFloat(el.style.width) || null, h: parseFloat(el.style.height) || null },
    });
    syncDomToDataset();
    _updateBrokenBanner();
    toast('Image restaurée');
  }
  function _restoreBrokenImage(el) {
    const overlay = document.createElement('div');
    overlay.className = 'restore-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'restore-modal';
    const close = () => overlay.remove();

    let libItems = [];
    if (library && typeof library === 'object') {
      Object.keys(library).forEach((folder) => {
        (library[folder] || []).forEach((it) => {
          if (it && it.src && /^data:|^https?:|^blob:/.test(it.src)) libItems.push(it);
        });
      });
    }

    let html = '<div class="rm-header">Restaurer cette image</div>';
    if (libItems.length) {
      html +=
        '<div class="rm-section-label">Depuis la bibliothèque du board (' +
        libItems.length +
        ')</div>';
      html += '<div class="rm-grid">';
      libItems.forEach((it, idx) => {
        html +=
          '<div class="rm-thumb" data-idx="' +
          idx +
          '" title="' +
          (it.name || '') +
          '"><img src="' +
          it.src +
          '" draggable="false"/></div>';
      });
      html += '</div>';
    } else {
      html += '<div class="rm-empty">La bibliothèque de ce board est vide.</div>';
    }
    html +=
      '<div class="rm-actions"><button type="button" class="rm-file-btn">Importer depuis le fichier…</button><button type="button" class="rm-cancel-btn">Annuler</button></div>';
    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    modal.querySelector('.rm-cancel-btn').addEventListener('click', close);
    modal.querySelectorAll('.rm-thumb').forEach((th) => {
      th.addEventListener('click', () => {
        const idx = parseInt(th.dataset.idx, 10);
        const it = libItems[idx];
        if (it && it.src) {
          _applyRestoredImageSrc(el, it.src);
          close();
        }
      });
    });
    modal.querySelector('.rm-file-btn').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) {
          input.remove();
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
          _applyRestoredImageSrc(el, ev.target.result);
          input.remove();
          close();
        };
        reader.readAsDataURL(file);
      });
      input.click();
    });
  }
  function addImageFromPanel(src) {
    const tmpImg = new Image();
    tmpImg.onload = () => {
      const c = getCenter();
      let w = tmpImg.naturalWidth || 220;
      let h = tmpImg.naturalHeight || 170;
      // Plafonner à 800×350px
      if (w > 800) {
        h = Math.round((h * 800) / w);
        w = 800;
      }
      if (h > 350) {
        w = Math.round((w * 350) / h);
        h = 350;
      }
      var imgEl = createImageElement(src, c.x - w / 2, c.y - h / 2, w, h);
      if (imgEl) _collabSyncCreatedEl(imgEl);
      if (imgEl)
        pushAction({ type: 'create', elId: imgEl.dataset.id, after: _captureElState(imgEl) });
      syncDomToDataset();
    };
    tmpImg.onerror = () => {
      const c = getCenter();
      var imgEl = createImageElement(src, c.x - 110, c.y - 85, 220, 170);
      if (imgEl) _collabSyncCreatedEl(imgEl);
      if (imgEl)
        pushAction({ type: 'create', elId: imgEl.dataset.id, after: _captureElState(imgEl) });
      syncDomToDataset();
    };
    tmpImg.src = src;
  }

  // ── NOTE ──────────────────────────────────────────────────────────────────
  function _exitListAfterLi(li, ta, type) {
    const ul = li.parentElement;
    const itemsAfter = [];
    let next = li.nextElementSibling;
    while (next) {
      itemsAfter.push(next);
      next = next.nextElementSibling;
    }
    // <div><br></div> : sans le <br>, le div ne génère aucune line box en
    // contenteditable (hauteur nulle, caret invisible). C'est le placeholder que
    // Chrome produit lui-même pour un paragraphe vide et qu'il remplace à la frappe.
    const newDiv = document.createElement('div');
    newDiv.appendChild(document.createElement('br'));
    li.remove();
    ul.parentNode.insertBefore(newDiv, ul.nextSibling);
    if (itemsAfter.length > 0) {
      const newUl = document.createElement('ul');
      if (type === 'todo') newUl.className = 'todo-list';
      itemsAfter.forEach((item) => {
        item.remove();
        newUl.appendChild(item);
      });
      newDiv.parentNode.insertBefore(newUl, newDiv.nextSibling);
    }
    if (!ul.querySelector('li')) ul.remove();
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(newDiv, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function _findAncestorLi(ta, node) {
    while (node && node !== ta) {
      if (node.nodeName === 'LI') return node;
      node = node.parentElement;
    }
    return null;
  }

  function _handleNoteListKeydown(e, ta, el) {
    if (e.key !== 'Enter' && e.key !== 'Backspace') return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    let li = _findAncestorLi(ta, sel.getRangeAt(0).startContainer);
    if (!li) return;
    // Re-dérivés depuis le <li> courant : supprimer une sélection peut fusionner
    // des <li>, donc ni le li ni son type ne sont stables sur toute la fonction.
    const typeOf = (n) =>
      n.parentElement && n.parentElement.classList.contains('todo-list') ? 'todo' : 'bullet';
    const textOf = (n, t) =>
      t === 'todo'
        ? (n.querySelector('span') ? n.querySelector('span').textContent : n.textContent)
        : n.textContent;

    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      // Comme Word, Entrée remplace la sélection. On délègue la suppression au
      // moteur d'édition : il fusionne les <li> partiellement couverts, là où un
      // Range.deleteContents() laisserait deux <li> tronqués côte à côte.
      if (!sel.isCollapsed) {
        document.execCommand('delete');
        li = sel.rangeCount ? _findAncestorLi(ta, sel.getRangeAt(0).startContainer) : null;
      }
      if (!li) {
        // La suppression a sorti le caret de toute liste : rien à scinder.
        el.dataset.savedata = ta.innerHTML;
        if (typeof Collab !== 'undefined' && Collab.isActive()) {
          Collab.syncElementData(el.dataset.id, ta.innerHTML);
        }
        return;
      }
      const type = typeOf(li);
      if (!textOf(li, type).trim()) {
        _exitListAfterLi(li, ta, type);
      } else {
        const editTarget = type === 'todo' ? li.querySelector('span') : li;
        let afterHtml = '';
        if (editTarget) {
          try {
            const splitRange = sel.getRangeAt(0);
            const afterRange = document.createRange();
            afterRange.setStart(splitRange.startContainer, splitRange.startOffset);
            afterRange.setEnd(editTarget, editTarget.childNodes.length);
            const frag = afterRange.extractContents();
            const tmp = document.createElement('div');
            tmp.appendChild(frag);
            afterHtml = tmp.innerHTML.replace(/<br\s*\/?>\s*$/i, '');
          } catch (_) { afterHtml = ''; }
        }
        const newLi = _makeListItem(type, afterHtml);
        li.parentNode.insertBefore(newLi, li.nextSibling);
        const target = type === 'todo' ? newLi.querySelector('span') : newLi;
        if (target) {
          let textNode = target.firstChild && target.firstChild.nodeType === Node.TEXT_NODE
            ? target.firstChild
            : null;
          if (!textNode) {
            textNode = document.createTextNode('');
            target.insertBefore(textNode, target.firstChild || null);
          }
          const r = document.createRange();
          r.setStart(textNode, 0);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
      el.dataset.savedata = ta.innerHTML;
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.syncElementData(el.dataset.id, ta.innerHTML);
      }
    } else if (e.key === 'Backspace') {
      if (!sel.isCollapsed) return;
      const type = typeOf(li);
      if (textOf(li, type).trim()) {
        // Item non vide : n'intercepter qu'en tout début d'item, où le natif
        // supprimerait la checkbox non-éditable qui précède le texte. Comme Word,
        // le premier Backspace retire la puce et repasse l'item en paragraphe.
        const editTarget = type === 'todo' ? li.querySelector('span') || li : li;
        const r0 = sel.getRangeAt(0);
        if (_textOffsetInNode(editTarget, r0.startContainer, r0.startOffset) !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const div = _unwrapListItem(li, type);
        const p = div ? _pointAtTextOffset(div, 0) : null;
        if (p) {
          const r = document.createRange();
          r.setStart(p.node, p.offset);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      } else {
        e.preventDefault();
        e.stopPropagation();
        _exitListAfterLi(li, ta, type);
      }
      el.dataset.savedata = ta.innerHTML;
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.syncElementData(el.dataset.id, ta.innerHTML);
      }
    }
  }

  // Mêmes gardes que activateNoteEdit : cocher une todo est le seul chemin
  // d'écriture d'une note qui ne passe pas par lui.
  function _todoCheckBlocked(el) {
    if (document.body.classList.contains('readonly-mode')) return 'readonly';
    if (
      typeof Collab !== 'undefined' &&
      Collab.isActive() &&
      Collab.isLockedByOther(el.dataset.id)
    ) {
      return 'locked';
    }
    return null;
  }

  function _attachNoteCheckboxListener(wrap, ta, el) {
    let _checkBeforeHtml = null;

    // preventDefault() sur le click annule l'activation de la checkbox : l'état
    // coché est restauré et 'change' n'est pas émis. Bloquer dans 'change' la
    // laisserait cochée à l'écran sans être ni persistée ni synchronisée.
    wrap.addEventListener('click', (e) => {
      if (!e.target.closest('.todo-check')) return;
      const blocked = _todoCheckBlocked(el);
      if (!blocked) return;
      e.preventDefault();
      e.stopPropagation();
      if (blocked === 'locked') toast("Élément en cours d'édition");
    });

    wrap.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.todo-check')) return;
      e.stopPropagation();
      _checkBeforeHtml = ta.innerHTML;
    });

    wrap.addEventListener('keydown', (e) => {
      if (e.key !== ' ') return;
      const cb = e.target.closest('.todo-check');
      if (!cb) return;
      e.stopPropagation();
      _checkBeforeHtml = ta.innerHTML;
    });

    wrap.addEventListener('change', (e) => {
      const check = e.target.closest('.todo-check');
      if (!check) return;
      const li = check.closest('li');
      if (li) li.classList.toggle('todo-done', check.checked);
      if (check.checked) check.setAttribute('checked', '');
      else check.removeAttribute('checked');
      el.dataset.savedata = ta.innerHTML;
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.syncElementData(el.dataset.id, ta.innerHTML);
      }
      if (_checkBeforeHtml !== null && _checkBeforeHtml !== ta.innerHTML) {
        pushAction({
          type: 'editText',
          elId: el.dataset.id,
          before: { data: _checkBeforeHtml, style: ta.style.cssText },
          after: { data: ta.innerHTML, style: ta.style.cssText },
          detail: check.checked ? 'Todo coché' : 'Todo décoché',
        });
        syncDomToDataset();
      }
      _checkBeforeHtml = null;
    });
  }

  function addNote() {
    const c = getCenter();
    const el = createNoteElement('', c.x - 110, c.y - 75, 290, 75);
    _collabSyncCreatedEl(el);
    if (el) pushAction({ type: 'create', elId: el.dataset.id, after: _captureElState(el) });
    syncDomToDataset();
  }
  function _noteDataToHtml(data) {
    if (!data) return '';
    // Si le contenu ressemble à du HTML (déjà formaté), l'utiliser tel quel
    if (/<[a-z][\s\S]*?>/i.test(data)) return data;
    // Sinon : texte brut → échapper + convertir \n en <br>
    return data
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  function createNoteElement(content, x, y, w) {
    w = w || 230;
    const el = makeElement('note', x || 100, y || 100, w);
    el.dataset.savedata = content;
    const wrap = document.createElement('div');
    wrap.className = 'el-note';
    const ta = document.createElement('div');
    ta.className = 'el-note-content';
    ta.dataset.placeholder = 'Écrire une note...';
    ta.contentEditable = 'false';
    ta.innerHTML = _noteDataToHtml(content);

    ta.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    });
    ta.addEventListener('input', () => {
      el.dataset.savedata = ta.innerHTML;
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.syncElementData(el.dataset.id, ta.innerHTML);
      }
    });

    let _noteValueOnFocus = '';
    let _noteStyleOnFocus = '';

    function activateNoteEdit(e) {
      if (document.body.classList.contains('readonly-mode')) return;
      if (
        typeof Collab !== 'undefined' &&
        Collab.isActive() &&
        Collab.isLockedByOther(el.dataset.id)
      ) {
        toast("Élément en cours d'édition");
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      ta.contentEditable = 'true';
      el.dataset.editing = '1';
      _noteValueOnFocus = ta.innerHTML;
      _noteStyleOnFocus = ta.style.cssText;
      ta.focus();
      showTextEditPanel(el);
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.acquireLock(el.dataset.id);
      }
    }

    wrap.addEventListener('dblclick', activateNoteEdit);
    ta.addEventListener('dblclick', activateNoteEdit);
    ta.addEventListener('mousedown', (e) => {
      if (ta.contentEditable === 'true') e.stopPropagation();
    });

    ta.addEventListener('blur', (e) => _handleNoteBlur(e, el, ta, _noteValueOnFocus, _noteStyleOnFocus));
    ta.addEventListener('keydown', (e) => _handleNoteListKeydown(e, ta, el));
    _attachNoteCheckboxListener(wrap, ta, el);

    wrap.appendChild(ta);
    el.insertBefore(wrap, el.querySelector('.element-toolbar'));
    return el;
  }

  // ── COULEUR ───────────────────────────────────────────────────────────────
  function addColorDirect() {
    const c = getCenter();
    const el = createColorElement('#000000', c.x - 65, c.y - 70, 130, 140);
    _collabSyncCreatedEl(el);
    if (el) pushAction({ type: 'create', elId: el.dataset.id, after: _captureElState(el) });
    syncDomToDataset();
  }
  function createColorElement(hex, x, y, w, h) {
    w = w || 130;
    h = h || 140;
    const el = makeElement('color', x || 100, y || 100, w, h);
    el.dataset.savedata = hex;
    const wrap = document.createElement('div');
    wrap.className = 'el-color';
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.background = hex;

    const info = document.createElement('div');
    info.className = 'color-info';

    // Input HEX éditable — readonly par défaut, éditable au double-clic
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'color-hex-input';
    hexInput.value = (hex || '').toUpperCase();
    hexInput.maxLength = 7;
    hexInput.spellcheck = false;
    hexInput.readOnly = true;

    // Lecture seule — pas d'édition directe
    hexInput.addEventListener('mousedown', (e) => e.stopPropagation());
    hexInput.addEventListener('pointerdown', (e) => e.stopPropagation());

    // Bouton qui ouvre le spectre de couleur
    const eyeBtn = document.createElement('button');
    eyeBtn.className = 'color-eyedropper';
    eyeBtn.title = 'Choisir une couleur';
    eyeBtn.innerHTML = `
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:14px; height:14px; display:block; pointer-events:none;">
    <path stroke-linecap="round" stroke-linejoin="round" d="M4.098 19.902a3.75 3.75 0 0 0 5.304 0l6.401-6.402M6.75 21A3.75 3.75 0 0 1 3 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 0 0 3.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008Z" />
  </svg>`;

    eyeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    eyeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    eyeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openColorSpectrumPicker(el, swatch, hexInput, el);
    });

    info.appendChild(hexInput);
    info.appendChild(eyeBtn);
    wrap.appendChild(swatch);
    wrap.appendChild(info);
    el.insertBefore(wrap, el.querySelector('.element-toolbar'));
    // Marquer comme déjà attaché (propriété JS, pas dataset, pour ne pas être dans innerHTML)
    el._colorEventsAttached = true;
    _syncColorInfo(el, hex);
    return el;
  }

  // ── EYEDROPPER ──────────────────────────────────────────────────────────────
  let eyedropperActive = false;
  function activateEyedropper(colorEl, swatch, hexInput) {
    // Essayer l'API EyeDropper native (Chrome 95+)
    if (window.EyeDropper) {
      const picker = new window.EyeDropper();
      const prevColor = colorEl.dataset.savedata || '#000000';
      picker
        .open()
        .then((result) => {
          const hex = result.sRGBHex.toUpperCase();
          swatch.style.background = hex;
          hexInput.value = hex;
          colorEl.dataset.savedata = hex;
          _syncColorInfo(colorEl, hex);
          if (hex !== prevColor) {
            pushAction({
              type: 'editColor',
              elId: colorEl.dataset.id,
              before: { data: prevColor },
              after: { data: hex },
            });
          }
          if (typeof Collab !== 'undefined' && Collab.isActive()) {
            Collab.syncElementData(colorEl.dataset.id, hex);
            Collab.releaseLock(colorEl.dataset.id);
          }
          syncDomToDataset();
        })
        .catch(() => {
          // annulé par l'utilisateur — libérer le lock
          if (typeof Collab !== 'undefined' && Collab.isActive()) {
            Collab.releaseLock(colorEl.dataset.id);
          }
        });
      return;
    }
    // Fallback : curseur custom sur le canvas-wrapper
    if (eyedropperActive) return;
    eyedropperActive = true;
    const wrapper = document.getElementById('canvas-wrapper');
    wrapper.style.cursor = 'crosshair';
    toast('Cliquez sur une couleur du canvas');
    const onPick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      eyedropperActive = false;
      wrapper.style.cursor = '';
      wrapper.removeEventListener('click', onPick, true);
      document.removeEventListener('keydown', onKey, true);
      // Coordonnées dans le canvas-wrapper
      const wrapRect = wrapper.getBoundingClientRect();
      const cx = (e.clientX - wrapRect.left - panX) / zoomLevel;
      const cy = (e.clientY - wrapRect.top - panY) / zoomLevel;
      // Utiliser la capture minimaliste via un tempContainer de 3×3px
      const canvasDiv = document.getElementById('canvas');
      const savedTf = canvasDiv.style.transform;
      canvasDiv.style.transform = 'translate(0px,0px) scale(1)';
      canvasDiv.getBoundingClientRect();
      html2canvas(canvasDiv, {
        scale: 1,
        useCORS: true,
        allowTaint: true,
        x: Math.round(cx) - 1,
        y: Math.round(cy) - 1,
        width: 3,
        height: 3,
        scrollX: 0,
        scrollY: 0,
      })
        .then((cap) => {
          canvasDiv.style.transform = savedTf;
          const ctx = cap.getContext('2d');
          const px = ctx.getImageData(1, 1, 1, 1).data;
          const toHex = (v) => v.toString(16).padStart(2, '0').toUpperCase();
          const hex = '#' + toHex(px[0]) + toHex(px[1]) + toHex(px[2]);
          const prevCol = colorEl.dataset.savedata || '#000000';
          swatch.style.background = hex;
          hexInput.value = hex;
          colorEl.dataset.savedata = hex;
          _syncColorInfo(colorEl, hex);
          if (hex !== prevCol) {
            pushAction({
              type: 'editColor',
              elId: colorEl.dataset.id,
              before: { data: prevCol },
              after: { data: hex },
            });
          }
          if (typeof Collab !== 'undefined' && Collab.isActive()) {
            Collab.syncElementData(colorEl.dataset.id, hex);
            Collab.releaseLock(colorEl.dataset.id);
          }
          syncDomToDataset();
        })
        .catch(() => {
          canvasDiv.style.transform = savedTf;
          if (typeof Collab !== 'undefined' && Collab.isActive()) {
            Collab.releaseLock(colorEl.dataset.id);
          }
          toast('Impossible de lire le pixel');
        });
    };
    wrapper.addEventListener('click', onPick, true);
    // Annuler avec Escape
    const onKey = (e) => {
      if (e.key === 'Escape') {
        eyedropperActive = false;
        wrapper.style.cursor = '';
        wrapper.removeEventListener('click', onPick, true);
        document.removeEventListener('keydown', onKey, true);
        // Collab: libérer le lock à l'annulation
        if (typeof Collab !== 'undefined' && Collab.isActive()) {
          Collab.releaseLock(colorEl.dataset.id);
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
  }

  // ── SPECTRE COULEUR ──────────────────────────────────────────────────────
  function openColorSpectrumPicker(colorEl, swatch, hexInput, anchorEl) {
    const existing = document.getElementById('_csp_panel');
    if (existing) existing.remove();

    if (typeof Collab !== 'undefined' && Collab.isActive()) {
      if (Collab.isLockedByOther(colorEl.dataset.id)) {
        toast("Élément en cours d'édition");
        return;
      }
      Collab.acquireLock(colorEl.dataset.id);
    }

    const prevColor = colorEl.dataset.savedata || '#000000';
    let currentHex = prevColor;

    function hexToHsv(hex) {
      let h = hex.replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      const r = parseInt(h.slice(0, 2), 16) / 255,
        g = parseInt(h.slice(2, 4), 16) / 255,
        b = parseInt(h.slice(4, 6), 16) / 255;
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      let hue = 0,
        sat = 0,
        val = max;
      const d = max - min;
      if (d > 0) {
        sat = d / max;
        switch (max) {
          case r:
            hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            break;
          case g:
            hue = ((b - r) / d + 2) / 6;
            break;
          case b:
            hue = ((r - g) / d + 4) / 6;
            break;
        }
      }
      return [hue * 360, sat, val];
    }
    function hsvToHex(h, s, v) {
      const i = Math.floor(h / 60) % 6,
        f = h / 60 - Math.floor(h / 60);
      const p = v * (1 - s),
        q = v * (1 - f * s),
        t = v * (1 - (1 - f) * s);
      let r, g, b;
      switch (i) {
        case 0:
          r = v;
          g = t;
          b = p;
          break;
        case 1:
          r = q;
          g = v;
          b = p;
          break;
        case 2:
          r = p;
          g = v;
          b = t;
          break;
        case 3:
          r = p;
          g = q;
          b = v;
          break;
        case 4:
          r = t;
          g = p;
          b = v;
          break;
        default:
          r = v;
          g = p;
          b = q;
      }
      return (
        '#' +
        [r, g, b]
          .map((x) =>
            Math.round(x * 255)
              .toString(16)
              .padStart(2, '0')
          )
          .join('')
          .toUpperCase()
      );
    }

    const [initH, initS, initV] = hexToHsv(prevColor);
    let hue = initH,
      sat = initS,
      val = initV;

    const panel = document.createElement('div');
    panel.id = '_csp_panel';
    panel.className = 'color-spectrum-picker';

    const gradArea = document.createElement('div');
    gradArea.className = 'csp-gradient-area';
    const whiteOv = document.createElement('div');
    whiteOv.className = 'csp-white-overlay';
    const blackOv = document.createElement('div');
    blackOv.className = 'csp-black-overlay';
    const handle = document.createElement('div');
    handle.className = 'csp-handle';
    gradArea.appendChild(whiteOv);
    gradArea.appendChild(blackOv);
    gradArea.appendChild(handle);

    const hueSlider = document.createElement('input');
    hueSlider.type = 'range';
    hueSlider.className = 'csp-hue-slider';
    hueSlider.min = 0;
    hueSlider.max = 360;
    hueSlider.step = 1;
    hueSlider.value = Math.round(hue);

    const bottom = document.createElement('div');
    bottom.className = 'csp-bottom';
    const preview = document.createElement('div');
    preview.className = 'csp-preview';

    const hexLabel = document.createElement('input');
    hexLabel.type = 'text';
    hexLabel.className = 'csp-hex-label';
    hexLabel.spellcheck = false;
    hexLabel.maxLength = 7;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'csp-copy-btn';
    copyBtn.title = 'Copier le code hex';
    copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

    const eyeBtn2 = document.createElement('button');
    eyeBtn2.className = 'csp-eyedropper-btn';
    eyeBtn2.title = "Pipette — sélectionner une couleur à l'écran";
    eyeBtn2.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12"/><path d="m18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z"/><path d="m2 22 .414-.414"/></svg>`;

    bottom.appendChild(preview);
    bottom.appendChild(hexLabel);
    bottom.appendChild(copyBtn);
    bottom.appendChild(eyeBtn2);
    panel.appendChild(gradArea);
    panel.appendChild(hueSlider);
    panel.appendChild(bottom);
    document.body.appendChild(panel);

    function updateUI() {
      gradArea.style.background = `hsl(${hue}, 100%, 50%)`;
      handle.style.left = sat * 100 + '%';
      handle.style.top = (1 - val) * 100 + '%';
      currentHex = hsvToHex(hue, sat, val);
      preview.style.background = currentHex;
      if (document.activeElement !== hexLabel) hexLabel.value = currentHex.slice(1);
      swatch.style.background = currentHex;
      hexInput.value = currentHex;
      colorEl.dataset.savedata = currentHex;
      _syncColorInfo(colorEl, currentHex);
      if (typeof Collab !== 'undefined' && Collab.isActive())
        Collab.syncElementData(colorEl.dataset.id, currentHex);
    }

    function positionPanel() {
      const rect = anchorEl.getBoundingClientRect();
      const pw = panel.offsetWidth || 280,
        ph = panel.offsetHeight || 330;
      let top = rect.bottom + 8,
        left = rect.left;
      if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
      if (left < 8) left = 8;
      if (top + ph > window.innerHeight - 8) top = rect.top - ph - 8;
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
    }

    updateUI();
    positionPanel();

    // Drag gradient
    let draggingGrad = false;
    function onGradDown(e) {
      if (e.button !== 0) return;
      draggingGrad = true;
      onGradMove(e);
      e.preventDefault();
      e.stopPropagation();
    }
    function onGradMove(e) {
      if (!draggingGrad) return;
      const rect = gradArea.getBoundingClientRect();
      sat = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      val = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
      updateUI();
    }
    function onGradUp() {
      draggingGrad = false;
    }
    gradArea.addEventListener('mousedown', onGradDown);
    window.addEventListener('mousemove', onGradMove);
    window.addEventListener('mouseup', onGradUp);

    hueSlider.addEventListener('input', () => {
      hue = parseFloat(hueSlider.value);
      updateUI();
    });
    hueSlider.addEventListener('mousedown', (e) => e.stopPropagation());
    hueSlider.addEventListener('pointerdown', (e) => e.stopPropagation());

    // Champ hex éditable — # optionnel
    hexLabel.addEventListener('mousedown', (e) => e.stopPropagation());
    hexLabel.addEventListener('pointerdown', (e) => e.stopPropagation());
    hexLabel.addEventListener('focus', () => hexLabel.select());
    hexLabel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        hexLabel.blur();
      }
      e.stopPropagation();
    });
    hexLabel.addEventListener('input', () => {
      const raw = hexLabel.value;
      const hadHash = raw.startsWith('#');
      let v = raw.replace(/#/g, '').toUpperCase();
      hexLabel.value = (hadHash ? '#' : '') + v;
      const full = '#' + (v.length === 3 ? v[0] + v[0] + v[1] + v[1] + v[2] + v[2] : v);
      if (/^#[0-9A-F]{6}$/.test(full)) {
        const [h, s, vv] = hexToHsv(full);
        hue = h;
        sat = s;
        val = vv;
        hueSlider.value = Math.round(hue);
        currentHex = full;
        preview.style.background = full;
        gradArea.style.background = `hsl(${hue}, 100%, 50%)`;
        handle.style.left = sat * 100 + '%';
        handle.style.top = (1 - val) * 100 + '%';
        swatch.style.background = full;
        hexInput.value = full;
        colorEl.dataset.savedata = full;
        _syncColorInfo(colorEl, full);
        if (typeof Collab !== 'undefined' && Collab.isActive())
          Collab.syncElementData(colorEl.dataset.id, full);
      }
    });
    hexLabel.addEventListener('blur', () => {
      hexLabel.value = currentHex.slice(1);
    });

    // Bouton copier
    const _copyOrigHTML = copyBtn.innerHTML;
    copyBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    copyBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (navigator.clipboard) navigator.clipboard.writeText(currentHex);
      copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
      copyBtn.style.background = '#ff3c00';
      copyBtn.style.color = '#fff';
      setTimeout(() => {
        copyBtn.innerHTML = _copyOrigHTML;
        copyBtn.style.background = '';
        copyBtn.style.color = '';
      }, 1000);
    });

    // Bouton pipette
    eyeBtn2.addEventListener('mousedown', (e) => e.stopPropagation());
    eyeBtn2.addEventListener('pointerdown', (e) => e.stopPropagation());
    eyeBtn2.addEventListener('click', (e) => {
      e.stopPropagation();
      closePanel(false);
      activateEyedropper(colorEl, swatch, hexInput);
    });

    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());

    function closePanel(save) {
      panel.remove();
      window.removeEventListener('mousemove', onGradMove);
      window.removeEventListener('mouseup', onGradUp);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onOutsideClick, true);
      if (save && currentHex !== prevColor) {
        pushAction({
          type: 'editColor',
          elId: colorEl.dataset.id,
          before: { data: prevColor },
          after: { data: currentHex },
        });
        syncDomToDataset();
      }
      if (typeof Collab !== 'undefined' && Collab.isActive())
        Collab.releaseLock(colorEl.dataset.id);
    }

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePanel(true);
      }
    };
    const onOutsideClick = (e) => {
      if (!panel.contains(e.target)) closePanel(true);
    };
    document.addEventListener('keydown', onKeyDown, true);
    setTimeout(() => document.addEventListener('mousedown', onOutsideClick, true), 120);
  }

  // ── LIEN ──────────────────────────────────────────────────────────────────
  function openLinkModal() {
    openModal('link-modal');
    setTimeout(() => document.getElementById('link-url-input').focus(), 80);
  }
  function closeLinkModal() {
    closeModal('link-modal');
  }
  async function _fetchLinkMeta(url) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const title =
        doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
        doc.querySelector('title')?.textContent ||
        new URL(url).hostname;
      const img =
        doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
        doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ||
        '';
      return { title: title.trim().slice(0, 120), img };
    } catch {
      try {
        return { title: new URL(url).hostname, img: '' };
      } catch {
        return { title: url, img: '' };
      }
    }
  }

  function addLinkElement() {
    const url = document.getElementById('link-url-input').value.trim();
    const title = document.getElementById('link-title-input').value.trim();
    const img = document.getElementById('link-img-input').value.trim();
    if (!url) {
      toast('Entrez une URL');
      return;
    }
    if (!title) {
      toast('Entrez un titre');
      return;
    }
    let lx, ly;
    if (pendingToolDropPos) {
      lx = pendingToolDropPos.x;
      ly = pendingToolDropPos.y;
      pendingToolDropPos = null;
    } else {
      const c = getCenter();
      lx = c.x - 140;
      ly = c.y - 90;
    }
    const linkEl = createLinkElement(url, title, img, lx, ly);
    _collabSyncCreatedEl(linkEl);
    if (linkEl)
      pushAction({ type: 'create', elId: linkEl.dataset.id, after: _captureElState(linkEl) });
    syncDomToDataset();

    closeLinkModal();
    ['link-url-input', 'link-title-input', 'link-img-input'].forEach(
      (id) => (document.getElementById(id).value = '')
    );
  }
  function _shortUrl(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }
  function createLinkElement(url, title, imgSrc, x, y) {
    const hasImg = !!imgSrc;
    const el = makeElement('link', x || 100, y || 100, 270, hasImg ? 260 : 73);
    el.dataset.savedata = JSON.stringify({ url, title, img: imgSrc });
    const wrap = document.createElement('div');
    wrap.className = 'el-link';
    if (hasImg) {
      const img = document.createElement('img');
      img.className = 'link-image';
      img.src = imgSrc;
      img.alt = title;
      img.onload = () => {
        if (!img.naturalWidth) return;
        const cardW = parseFloat(el.style.width) || 270;
        const imgH = Math.round((img.naturalHeight / img.naturalWidth) * cardW);
        const bodyH = 76;
        const totalH = imgH + bodyH;
        el.style.height = totalH + 'px';
        el.dataset.ratio = String(cardW / totalH);
        updateConnectionsForEl(el);
        updateCornerHandles();
      };
      wrap.appendChild(img);
    }
    const body = document.createElement('div');
    body.className = 'link-body';
    body.innerHTML = `<div class="link-title">${escHtml(title)}</div><div class="link-url"><svg class="link-url-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg><span>${escHtml(_shortUrl(url))}</span></div>`;
    wrap.appendChild(body);
    wrap.addEventListener('dblclick', () => window.open(url, '_blank'));
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
  function addFile() {
    fileReplaceTarget = null;
    document.getElementById('file-input-file').click();
  }
  const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogv', 'm4v']);
  function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) {
      e.target.value = '';
      return;
    }

    // MODE REMPLACEMENT : un seul fichier remplace l'élément cible
    if (fileReplaceTarget && document.getElementById('canvas').contains(fileReplaceTarget)) {
      const target = fileReplaceTarget;
      fileReplaceTarget = null;
      const file = files[0];
      const ext = file.name.split('.').pop().toLowerCase();
      const size =
        file.size < 1024
          ? file.size + 'B'
          : file.size < 1048576
            ? (file.size / 1024).toFixed(1) + 'KB'
            : (file.size / 1048576).toFixed(1) + 'MB';
      const x = parseFloat(target.style.left) || 0;
      const y = parseFloat(target.style.top) || 0;
      const w = parseFloat(target.style.width) || null;
      const h = parseFloat(target.style.height) || null;
      if (VIDEO_EXTS.has(ext)) {
        const beforeSavedata = target.dataset.savedata || '';
        const beforeW = parseFloat(target.style.width) || null;
        const beforeH = parseFloat(target.style.height) || null;
        const elId = target.dataset.id;
        readFileAsBase64(file).then((b64) => {
          const newEl = createVideoFileElement(file.name, size, b64, x, y, w, h);
          newEl.dataset.id = target.dataset.id;
          newEl.style.zIndex = target.style.zIndex;
          target.replaceWith(newEl);
          selectEl(newEl);
          pushAction({
            type: 'editFile',
            elId: elId,
            before: { savedata: beforeSavedata, w: beforeW, h: beforeH },
            after: {
              savedata: newEl.dataset.savedata,
              w: parseFloat(newEl.style.width) || null,
              h: parseFloat(newEl.style.height) || null,
            },
          });
          if (typeof Collab !== 'undefined' && Collab.isActive()) {
            Collab.syncElementData(newEl.dataset.id, newEl.dataset.savedata);
            Collab.syncElementSize(
              newEl.dataset.id,
              parseFloat(newEl.style.width) || null,
              parseFloat(newEl.style.height) || null,
              true
            );
          }
          syncDomToDataset();
        });
      } else {
        const beforeSavedata = target.dataset.savedata || '';
        const beforeW = parseFloat(target.style.width) || null;
        const beforeH = parseFloat(target.style.height) || null;
        const elId = target.dataset.id;
        const icns = {
          pdf: '📄',
          doc: '📝',
          docx: '📝',
          xls: '📊',
          xlsx: '📊',
          ppt: '📋',
          pptx: '📋',
          zip: '🗜️',
          rar: '🗜️',
          mp3: '🎵',
          wav: '🎵',
          txt: '📃',
        };
        const newEl = createFileElement(file.name, size, icns[ext] || 'file', x, y);
        newEl.dataset.id = target.dataset.id;
        newEl.style.zIndex = target.style.zIndex;
        if (w) newEl.style.width = w + 'px';
        if (h) newEl.style.height = h + 'px';
        target.replaceWith(newEl);
        selectEl(newEl);
        pushAction({
          type: 'editFile',
          elId: elId,
          before: { savedata: beforeSavedata, w: beforeW, h: beforeH },
          after: {
            savedata: newEl.dataset.savedata,
            w: parseFloat(newEl.style.width) || null,
            h: parseFloat(newEl.style.height) || null,
          },
        });
        if (typeof Collab !== 'undefined' && Collab.isActive()) {
          Collab.syncElementData(newEl.dataset.id, newEl.dataset.savedata);
        }
        syncDomToDataset();
      }
      e.target.value = '';
      return;
    }
    fileReplaceTarget = null;

    // MODE CRÉATION : nouveaux éléments
    files.forEach((file, i) => {
      const ext = file.name.split('.').pop().toLowerCase();
      const size =
        file.size < 1024
          ? file.size + 'B'
          : file.size < 1048576
            ? (file.size / 1024).toFixed(1) + 'KB'
            : (file.size / 1048576).toFixed(1) + 'MB';
      let baseX, baseY;
      if (pendingToolDropPos) {
        baseX = pendingToolDropPos.x + i * 22;
        baseY = pendingToolDropPos.y + i * 22;
      } else {
        const c = getCenter();
        baseX = c.x - 110 + i * 22;
        baseY = c.y - 30 + i * 22;
      }
      if (VIDEO_EXTS.has(ext)) {
        readFileAsBase64(file).then((b64) => {
          const el = createVideoFileElement(file.name, size, b64, baseX, baseY);
          if (el) {
            pushAction({ type: 'create', elId: el.dataset.id, after: _captureElState(el) });
          }
          syncDomToDataset();
        });
      } else {
        const icns = {
          pdf: '📄',
          doc: '📝',
          docx: '📝',
          xls: '📊',
          xlsx: '📊',
          ppt: '📋',
          pptx: '📋',
          zip: '🗜️',
          rar: '🗜️',
          mp3: '🎵',
          wav: '🎵',
          txt: '📃',
        };
        const icon = icns[ext] || 'file';
        var fileEl = createFileElement(file.name, size, icon, baseX, baseY);
        // Lire le contenu du fichier pour le stocker et permettre le téléchargement
        (function (targetEl, fileName, fileSize, fileIcon) {
          readFileAsBase64(file).then(function (b64) {
            targetEl.dataset.savedata = JSON.stringify({
              name: fileName,
              size: fileSize,
              icon: fileIcon,
              fileData: b64,
            });
            if (typeof Collab !== 'undefined' && Collab.isActive()) {
              _collabSyncCreatedEl(targetEl);
            }
            pushAction({ type: 'create', elId: targetEl.dataset.id, after: _captureElState(targetEl) });
            syncDomToDataset();
          });
        })(fileEl, file.name, size, icon);
      }
    });
    pendingToolDropPos = null;

    e.target.value = '';
  }

  // Lire un fichier en base64 (data URL)
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function createFileElement(name, size, icon, x, y) {
    const el = makeElement('file', x || 100, y || 100, 260, 76);
    el.dataset.savedata = JSON.stringify({ name, size, icon });
    const wrap = document.createElement('div');
    wrap.className = 'el-file';
    wrap.style.width = '260px';
    wrap.style.height = '76px';
    wrap.style.overflow = 'hidden';
    const iconDiv = document.createElement('div');
    iconDiv.className = 'file-icon';
    var iconImg = document.createElement('img');
    iconImg.src = 'PNG/fichier-carte.png';
    iconImg.style.cssText = 'width:36px;height:36px;object-fit:contain;pointer-events:none;';
    iconDiv.appendChild(iconImg);
    wrap.appendChild(iconDiv);
    const info = document.createElement('div');
    info.className = 'file-info';
    info.innerHTML = `<div class="file-name">${escHtml(name)}</div><div class="file-size">${escHtml(size)}</div>`;
    wrap.appendChild(info);
    el.insertBefore(wrap, el.querySelector('.element-toolbar'));
    // Double-clic : télécharger le fichier si les données existent
    wrap.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      var d = {};
      try {
        d = JSON.parse(el.dataset.savedata || '{}');
      } catch (_) {}
      if (d.fileData) {
        if (typeof chrome !== 'undefined' && chrome.downloads) {
          chrome.downloads.download({
            url: d.fileData,
            filename: d.name || 'fichier',
            saveAs: true,
          });
        } else {
          var a = document.createElement('a');
          a.href = d.fileData;
          a.download = d.name || 'fichier';
          a.click();
        }
      } else {
        toast('Aucun fichier attaché');
      }
    });
    el.dataset.ratio = (260 / 76).toFixed(6);
    return el;
  }

  function createVideoFileElement(name, size, videoSrc, x, y, w, h) {
    const el = makeElement('file', x || 100, y || 100, w || 300, h || 200);
    el.dataset.savedata = JSON.stringify({
      name,
      size,
      icon: 'video',
      isVideo: true,
      src: videoSrc,
    });
    const wrap = document.createElement('div');
    wrap.className = 'el-file-video';

    // Remplacement strict par une image (zéro balise <video> dans le DOM = zéro lag)
    const img = document.createElement('img');
    img.style.cssText =
      'width:100%; height:100%; object-fit:contain; display:block; pointer-events:none; position:absolute; top:0; left:0;';
    wrap.appendChild(img);

    // Extraction isolée et destruction immédiate pour la miniature
    if (videoSrc) {
      const d = tryParse(el.dataset.savedata);
      if (d.thumb) {
        img.src = d.thumb;
      } else {
        const tempVid = document.createElement('video');
        tempVid.muted = true;
        tempVid.playsInline = true;
        tempVid.src = videoSrc;
        tempVid.onloadeddata = () => {
          tempVid.currentTime = 1.0;
        };
        tempVid.onseeked = () => {
          const canvas = document.createElement('canvas');
          canvas.width = tempVid.videoWidth;
          canvas.height = tempVid.videoHeight;
          canvas.getContext('2d').drawImage(tempVid, 0, 0, canvas.width, canvas.height);
          img.src = canvas.toDataURL('image/jpeg', 0.6);
          d.thumb = img.src; // Sauvegarde dans les données pour ne plus jamais recalculer
          el.dataset.savedata = JSON.stringify(d);
          tempVid.removeAttribute('src');
          tempVid.load(); // Nettoyage agressif de la RAM
        };
      }
    }

    const hint = document.createElement('div');
    hint.className = 'video-play-hint';
    wrap.appendChild(hint);

    wrap.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const d = tryParse(el.dataset.savedata);
      const src = d.src || videoSrc;
      if (src) {
        openVideoLightbox(src, false);
        return;
      }
      if (document.body.classList.contains('readonly-mode')) return;
      fileReplaceTarget = el;
      document.getElementById('file-input-file').click();
    });

    el.insertBefore(wrap, el.querySelector('.element-toolbar'));
    el._fileEventsAttached = true;
    return el;
  }

  // ── VIDÉO ─────────────────────────────────────────────────────────────────
  function createVideoElement(src, isEmbed, x, y, w, h) {
    w = w || 360;
    h = h || 202;
    const el = makeElement('video', x || 100, y || 100, w, h);
    el.dataset.savedata = JSON.stringify({ src, isEmbed });
    const wrap = document.createElement('div');
    wrap.className = 'el-video';
    wrap.style.position = 'relative';
    wrap.style.cursor = 'pointer';

    // Remplacement strict par une image
    const img = document.createElement('img');
    img.style.cssText =
      'width:100%; height:100%; object-fit:cover; display:block; pointer-events:none; background:#111;';

    if (isEmbed) {
      const yt = src.match(/youtube\.com\/embed\/([^&\s?]+)/);
      if (yt) img.src = `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg`;
    }
    wrap.appendChild(img);

    const hint = document.createElement('div');
    hint.className = 'video-play-hint';
    // Style forcé ici car .el-video n'a pas les CSS natifs du .video-play-hint de .el-file-video
    hint.style.cssText =
      'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px;background:rgba(255,255,255,0.18);border-radius:50%;backdrop-filter:blur(2px);pointer-events:none;';
    hint.innerHTML =
      '<div style="position:absolute;top:50%;left:50%;transform:translate(-38%,-50%);width:0;height:0;border-top:9px solid transparent;border-bottom:9px solid transparent;border-left:15px solid rgba(255,255,255,0.9);"></div>';
    wrap.appendChild(hint);

    wrap.addEventListener('dblclick', (e) => {
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
        iframe.style.cssText =
          'width:92vw; height:82vh; max-width:1200px; max-height:800px; background:#000; border:none; box-shadow:0 8px 48px rgba(0,0,0,0.6); display:block;';
        overlay.appendChild(iframe);
      }
      iframe.style.display = 'block';
      iframe.src = src.includes('?') ? src + '&autoplay=1' : src + '?autoplay=1';
    } else {
      if (iframe) {
        iframe.style.display = 'none';
        iframe.src = '';
      }
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
    vid.pause();
    vid.src = '';
    if (iframe) iframe.src = '';
    overlay.classList.remove('show');
  }

  // ── TOOLBAR ÉLÉMENTS ──────────────────────────────────────────────────────
  function removeEl(btn) {
    const el = btn.closest('.board-element');
    if (!el) return;
    if (multiSelected.has(el) && multiSelected.size > 0) {
      const toDelete = [...multiSelected];
      if (selectedEl && !multiSelected.has(selectedEl)) toDelete.push(selectedEl);
      // Action-based undo for delete (multi)
      toDelete.forEach((e) => {
        pushAction({ type: 'delete', elId: e.dataset.id, before: _captureElState(e) });
      });
      multiSelected.clear();
      selectedEl = null;
      // Collab: sync suppression
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        toDelete.forEach((e) => Collab.syncElementDelete(e.dataset.id));
      }
      let done = 0;
      toDelete.forEach((e) => {
        removeConnectionsForEl(e);
        removeCaptionsForEl(e);
        animateRemove(e, () => {
          done++;
          if (done === toDelete.length) {
            syncDomToDataset();
          }
        });
      });
    } else {
      // Action-based undo for delete (single)
      pushAction({ type: 'delete', elId: el.dataset.id, before: _captureElState(el) });
      // Collab: sync suppression
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.syncElementDelete(el.dataset.id);
      }
      removeConnectionsForEl(el);
      removeCaptionsForEl(el);
      selectedEl = null;
      animateRemove(el, () => {
        syncDomToDataset();
      });
    }
  }
  function duplicateEl(btn) {
    const el = btn.closest('.board-element');
    if (!el) return;
    if (multiSelected.has(el) && multiSelected.size > 1) {
      const dupIds = [];
      const dupAfters = [];
      multiSelected.forEach((e) => {
        const s = {
          type: e.dataset.type,
          x: parseFloat(e.style.left) + 24,
          y: parseFloat(e.style.top) + 24,
          w: parseFloat(e.style.width) || null,
          h: parseFloat(e.style.height) || null,
          data:
            e.dataset.type === 'image'
              ? _imgStore.get(e.dataset.id) || ''
              : e.dataset.savedata || '',
        };
        var dup = restoreElement(s);
        if (dup) {
          dupIds.push(dup.dataset.id);
          dupAfters.push(_captureElState(dup));
          if (typeof Collab !== 'undefined' && Collab.isActive()) _collabSyncCreatedEl(dup);
        }
      });
      if (dupIds.length) {
        pushAction({ type: 'groupCreate', elId: dupIds, after: dupAfters });
        syncDomToDataset();
      }
      return;
    }
    const s = {
      type: el.dataset.type,
      x: parseFloat(el.style.left) + 24,
      y: parseFloat(el.style.top) + 24,
      w: parseFloat(el.style.width) || null,
      h: parseFloat(el.style.height) || null,
      data:
        el.dataset.type === 'image'
          ? _imgStore.get(el.dataset.id) || ''
          : el.dataset.savedata || '',
    };
    const newEl = restoreElement(s);
    if (newEl) {
      if (typeof Collab !== 'undefined' && Collab.isActive()) _collabSyncCreatedEl(newEl);
      selectEl(newEl);
      pushAction({ type: 'create', elId: newEl.dataset.id, after: _captureElState(newEl) });
      syncDomToDataset();
    }
  }

  // ── CONTEXT MENU ─────────────────────────────────────────────────────────
  function showContextMenu(x, y) {
    const menu = document.getElementById('context-menu');
    const isImage = ctxTargetEl && ctxTargetEl.dataset.type === 'image';
    const totalSel = multiSelected.size + (selectedEl && !multiSelected.has(selectedEl) ? 1 : 0);
    const canConnect = totalSel >= 2;
    // Compter les images dans la sélection complète
    const allSelEls = new Set(multiSelected);
    if (selectedEl) allSelEls.add(selectedEl);
    if (ctxTargetEl) allSelEls.add(ctxTargetEl);
    let selImageCount = 0;
    allSelEls.forEach((el) => { if (el.dataset.type === 'image') selImageCount++; });
    const multiImages = selImageCount >= 2;
    document.getElementById('ctx-img-divider').style.display = isImage ? '' : 'none';
    document.getElementById('ctx-img-copy').style.display = (isImage && !multiImages) ? '' : 'none';
    document.getElementById('ctx-img-download').style.display = isImage ? '' : 'none';
    document.getElementById('ctx-img-replace').style.display = (isImage && !multiImages) ? '' : 'none';
    document.getElementById('ctx-img-caption').style.display = (isImage && !multiImages) ? '' : 'none';
    document.getElementById('ctx-connect-divider').style.display = canConnect ? '' : 'none';
    document.getElementById('ctx-connect').style.display = canConnect ? '' : 'none';
    // Déconnecter : visible si au moins un élément sélectionné a une connexion
    var hasConnections = false;
    var allSelIds = new Set();
    if (ctxTargetEl) allSelIds.add(ctxTargetEl.dataset.id);
    multiSelected.forEach(function (el) {
      allSelIds.add(el.dataset.id);
    });
    if (selectedEl) allSelIds.add(selectedEl.dataset.id);
    document.querySelectorAll('.el-connection').forEach(function (svg) {
      if (allSelIds.has(svg.dataset.from) || allSelIds.has(svg.dataset.to)) {
        hasConnections = true;
      }
    });
    document.getElementById('ctx-disconnect-divider').style.display = hasConnections ? '' : 'none';
    document.getElementById('ctx-disconnect').style.display = hasConnections ? '' : 'none';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = 'block';
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    menu.style.left = (x + mw > vw ? Math.max(0, x - mw) : x) + 'px';
    menu.style.top = (y + mh > vh ? Math.max(0, y - mh) : y) + 'px';
  }

  function ctxDownloadImage() {
    // Rassembler toutes les images sélectionnées
    const allSelEls = new Set(multiSelected);
    if (selectedEl) allSelEls.add(selectedEl);
    if (ctxTargetEl) allSelEls.add(ctxTargetEl);
    const imageEls = [...allSelEls].filter((el) => el.dataset.type === 'image');
    if (imageEls.length === 0) return;
    hideContextMenu();
    const ts = Date.now();

    if (imageEls.length === 1) {
      // Une seule image : Enregistrer sous classique
      const el = imageEls[0];
      const src = _imgStore.get(el.dataset.id) || (el.querySelector('img') || {}).src || '';
      if (!src) return;
      if (typeof chrome !== 'undefined' && chrome.downloads) {
        chrome.downloads.download({ url: src, filename: 'image_' + ts + '.png', saveAs: true });
      } else {
        const a = document.createElement('a');
        a.href = src;
        a.download = 'image_' + ts + '.png';
        a.click();
      }
      return;
    }

    // Plusieurs images : choisir un dossier une seule fois, tout y sauvegarder
    if (window.showDirectoryPicker) {
      window.showDirectoryPicker().then(async (dirHandle) => {
        for (let i = 0; i < imageEls.length; i++) {
          const el = imageEls[i];
          const src = _imgStore.get(el.dataset.id) || (el.querySelector('img') || {}).src || '';
          if (!src) continue;
          const filename = 'image_' + ts + '_' + (i + 1) + '.png';
          const blob = await fetch(src).then((r) => r.blob());
          const fh = await dirHandle.getFileHandle(filename, { create: true });
          const writable = await fh.createWritable();
          await writable.write(blob);
          await writable.close();
        }
      }).catch(() => {});
    } else {
      // Fallback sans File System Access API
      imageEls.forEach((el, i) => {
        const src = _imgStore.get(el.dataset.id) || (el.querySelector('img') || {}).src || '';
        if (!src) return;
        const filename = 'image_' + ts + '_' + (i + 1) + '.png';
        if (typeof chrome !== 'undefined' && chrome.downloads) {
          setTimeout(() => chrome.downloads.download({ url: src, filename, saveAs: true }), i * 300);
        } else {
          const a = document.createElement('a');
          a.href = src;
          a.download = filename;
          setTimeout(() => a.click(), i * 300);
        }
      });
    }
  }

  function ctxCopyImage() {
    if (!ctxTargetEl || ctxTargetEl.dataset.type !== 'image') return;
    hideContextMenu();
    const src = _imgStore.get(ctxTargetEl.dataset.id) || (ctxTargetEl.querySelector('img') || {}).src || '';
    if (!src) return;
    fetch(src)
      .then((r) => r.blob())
      .then((blob) => {
        const png = blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' });
        navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      })
      .catch(() => {});
  }

  let replaceTargetEl = null;
  function ctxReplaceImage() {
    if (!ctxTargetEl || ctxTargetEl.dataset.type !== 'image') return;
    replaceTargetEl = ctxTargetEl;
    hideContextMenu();
    const input = document.getElementById('file-input-replace');
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const src = await compressImage(ev.target.result);
        const img = replaceTargetEl.querySelector('img');
        if (img) {
          var oldSrc = _imgStore.get(replaceTargetEl.dataset.id) || '';
          var oldW = parseFloat(replaceTargetEl.style.width) || null;
          var oldH = parseFloat(replaceTargetEl.style.height) || null;
          img.src = src;
          _imgStore.set(replaceTargetEl.dataset.id, src);
          replaceTargetEl.dataset.savedata = '';
          // Adapter le conteneur aux dimensions de la nouvelle image
          const tmpImg = new Image();
          tmpImg.onload = () => {
            let natW = tmpImg.naturalWidth || 220;
            let natH = tmpImg.naturalHeight || 170;
            // Conserver la largeur actuelle, adapter la hauteur selon le ratio
            const currentW = parseFloat(replaceTargetEl.style.width) || natW;
            const ratio = natW / natH;
            const newH = Math.round(currentW / ratio);
            replaceTargetEl.style.width = currentW + 'px';
            replaceTargetEl.style.height = newH + 'px';
            replaceTargetEl.dataset.ratio = ratio.toFixed(6);
            pushAction({
              type: 'editImage',
              elId: replaceTargetEl.dataset.id,
              before: { data: oldSrc, w: oldW, h: oldH },
              after: { data: src, w: currentW, h: newH },
            });
            syncDomToDataset();
            // Collab: sync la nouvelle image et les nouvelles dimensions
            if (typeof Collab !== 'undefined' && Collab.isActive()) {
              Collab.syncElementData(replaceTargetEl.dataset.id, src);
              Collab.syncElementSize(replaceTargetEl.dataset.id, currentW, newH, true);
            }
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
    const l = parseFloat(el.style.left) || 0;
    const t = parseFloat(el.style.top) || 0;
    let tx = 0,
      ty = 0;
    const tr = el.style.transform;
    if (tr) {
      const m = tr.match(/translate3d\(\s*([-\d.]+)px,\s*([-\d.]+)px/);
      if (m) {
        tx = parseFloat(m[1]);
        ty = parseFloat(m[2]);
      }
    }
    return {
      x: l + tx + el.offsetWidth / 2,
      y: t + ty + el.offsetHeight / 2,
    };
  }

  function ctxConnect() {
    hideContextMenu();
    const allSel = new Set(multiSelected);
    if (selectedEl) allSel.add(selectedEl);
    const ids = [...allSel].map((el) => el.dataset.id).filter(Boolean);
    if (ids.length < 2) return;
    const connections = [];
    for (let i = 0; i < ids.length - 1; i++) {
      const svg = createConnection(ids[i], ids[i + 1]);
      if (svg) {
        connections.push({ fromId: ids[i], toId: ids[i + 1], connId: svg.dataset.connId });
        if (typeof Collab !== 'undefined' && Collab.isActive()) {
          Collab.syncConnection(svg.dataset.connId, ids[i], ids[i + 1]);
        }
      }
    }
    if (connections.length) {
      pushAction({ type: 'connection', connections });
      syncDomToDataset();
    }
  }

  function ctxDisconnect() {
    hideContextMenu();
    var allSelIds = new Set();
    if (ctxTargetEl) allSelIds.add(ctxTargetEl.dataset.id);
    multiSelected.forEach(function (el) { allSelIds.add(el.dataset.id); });
    if (selectedEl) allSelIds.add(selectedEl.dataset.id);
    var multi = allSelIds.size >= 2;
    var toRemove = [];
    document.querySelectorAll('.el-connection').forEach(function (svg) {
      var fromIn = allSelIds.has(svg.dataset.from);
      var toIn = allSelIds.has(svg.dataset.to);
      if (multi ? fromIn && toIn : fromIn || toIn) {
        toRemove.push(svg);
      }
    });
    if (!toRemove.length) return;
    const connections = toRemove.map((svg) => ({
      fromId: svg.dataset.from,
      toId: svg.dataset.to,
      connId: svg.dataset.connId,
    }));
    toRemove.forEach(function (svg) {
      if (typeof Collab !== 'undefined' && Collab.isActive() && svg.dataset.connId) {
        Collab.syncConnectionDelete(svg.dataset.connId);
      }
      svg.remove();
    });
    pushAction({ type: 'disconnection', connections });
    syncDomToDataset();
  }

  function createConnection(fromId, toId, connId) {
    const canvas = document.getElementById('canvas');
    const fromEl = canvas.querySelector(`[data-id="${fromId}"]`);
    const toEl = canvas.querySelector(`[data-id="${toId}"]`);
    if (!fromEl || !toEl) return null;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('el-connection');
    svg.dataset.from = fromId;
    svg.dataset.to = toId;
    svg.dataset.connId = connId || 'conn_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    svg.appendChild(line);
    canvas.insertBefore(svg, canvas.firstChild);
    updateConnection(svg, fromEl, toEl);
    return svg;
  }

  function updateConnection(svg, fromEl, toEl) {
    const fc = getElCenter(fromEl);
    const tc = getElCenter(toEl);
    const line = svg.querySelector('line');
    if (line) {
      line.setAttribute('x1', fc.x);
      line.setAttribute('y1', fc.y);
      line.setAttribute('x2', tc.x);
      line.setAttribute('y2', tc.y);
    }
  }

  function updateConnectionsForEl(el) {
    const canvas = document.getElementById('canvas');
    const id = el.dataset.id;
    canvas.querySelectorAll('.el-connection').forEach((svg) => {
      if (svg.dataset.from === id || svg.dataset.to === id) {
        const fromEl = canvas.querySelector(`[data-id="${svg.dataset.from}"]`);
        const toEl = canvas.querySelector(`[data-id="${svg.dataset.to}"]`);
        if (fromEl && toEl) updateConnection(svg, fromEl, toEl);
      }
    });
  }

  function updateAllConnections() {
    const canvas = document.getElementById('canvas');
    canvas.querySelectorAll('.el-connection').forEach((svg) => {
      const fromEl = canvas.querySelector(`[data-id="${svg.dataset.from}"]`);
      const toEl = canvas.querySelector(`[data-id="${svg.dataset.to}"]`);
      if (fromEl && toEl) updateConnection(svg, fromEl, toEl);
    });
  }

  // ── MODE CONNECTEUR (outil "Connecteur") ─────────────────────────────────
  let connectorMode = false;
  let connectorDrag = null;

  function setConnectorMode(active) {
    connectorMode = !!active;
    const btn = document.getElementById('tool-connector');
    if (btn) btn.classList.toggle('active', connectorMode);
    document.body.classList.toggle('connector-mode', connectorMode);
    if (!connectorMode) cancelConnectorDrag();
  }

  function toggleConnectorMode() {
    setConnectorMode(!connectorMode);
  }

  function cancelConnectorDrag() {
    if (connectorDrag && connectorDrag.tempSvg) connectorDrag.tempSvg.remove();
    connectorDrag = null;
  }

  function setupConnectorTool() {
    document.addEventListener(
      'mousedown',
      (e) => {
        if (!connectorMode) return;
        if (e.button !== 0) return;
        const inWrapper = e.target.closest && e.target.closest('#canvas-wrapper');
        if (!inWrapper) return;
        const elTarget = e.target.closest && e.target.closest('#canvas .board-element');
        // En mode connecteur : bloquer toute interaction native (sélection, drag, panning)
        // qu'on clique sur un élément ou sur le fond du canvas
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        if (!elTarget) return;
        const canvas = document.getElementById('canvas');
        const fromCenter = getElCenter(elTarget);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('el-connection-temp');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', fromCenter.x);
        line.setAttribute('y1', fromCenter.y);
        line.setAttribute('x2', fromCenter.x);
        line.setAttribute('y2', fromCenter.y);
        svg.appendChild(line);
        canvas.appendChild(svg);
        connectorDrag = {
          fromEl: elTarget,
          fromId: elTarget.dataset.id,
          fromX: fromCenter.x,
          fromY: fromCenter.y,
          tempSvg: svg,
          tempLine: line,
        };
      },
      true
    );

    window.addEventListener('mousemove', (e) => {
      if (!connectorMode || !connectorDrag) return;
      const canvas = document.getElementById('canvas');
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / zoomLevel;
      const cy = (e.clientY - rect.top) / zoomLevel;
      connectorDrag.tempLine.setAttribute('x2', cx);
      connectorDrag.tempLine.setAttribute('y2', cy);
    });

    window.addEventListener('mouseup', (e) => {
      if (!connectorMode || !connectorDrag) return;
      const fromId = connectorDrag.fromId;
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const toEl = target ? target.closest('#canvas .board-element') : null;
      cancelConnectorDrag();
      if (!toEl) return;
      const toId = toEl.dataset.id;
      if (!toId || toId === fromId) return;
      const exists = document.querySelector(
        '.el-connection[data-from="' +
          fromId +
          '"][data-to="' +
          toId +
          '"], ' +
          '.el-connection[data-from="' +
          toId +
          '"][data-to="' +
          fromId +
          '"]'
      );
      if (exists) return;
      const svg = createConnection(fromId, toId);
      if (svg) {
        const connId = svg.dataset.connId;
        if (typeof Collab !== 'undefined' && Collab.isActive()) {
          Collab.syncConnection(connId, fromId, toId);
        }
        pushAction({ type: 'connection', connections: [{ fromId, toId, connId }] });
        syncDomToDataset();
      }
    });
  }

  // ── CAPTIONS ─────────────────────────────────────────────────────────────
  let _capValueOnFocus = '';

  function _createCaptionEl(capId, parentId, x, y, width, text) {
    const cap = document.createElement('div');
    cap.classList.add('el-caption');
    cap.contentEditable = 'true';
    cap.dataset.placeholder = 'Ajouter un commentaire…';
    cap.dataset.parentId = parentId || '';
    cap.dataset.type = 'caption';
    cap.dataset.capId = capId;
    cap.style.left = x + 'px';
    cap.style.top = y + 'px';
    if (width) cap.style.width = width;
    cap.textContent = text || '';
    cap.addEventListener('input', () => {
      if (typeof Collab !== 'undefined' && Collab.isActive() && cap.dataset.capId) {
        Collab.syncCaptionText(cap.dataset.capId, cap.textContent);
      }
    });
    cap.addEventListener('focus', () => { _capValueOnFocus = cap.textContent; showTextEditPanel(cap); });
    cap.addEventListener('blur', (e) => handleCaptionBlur(e, cap));
    document.getElementById('canvas').appendChild(cap);
    return cap;
  }

  function ctxAddCaption() {
    hideContextMenu();
    if (!ctxTargetEl) return;
    const el = ctxTargetEl;
    const l = parseFloat(el.style.left) || 0;
    const t = parseFloat(el.style.top) || 0;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const capId = 'cap_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const cap = _createCaptionEl(
      capId,
      el.dataset.id || '',
      l,
      t + h,
      w + 'px',
      ''
    );
    cap.dataset.isNew = '1';
    cap.focus();
  }

  function hideContextMenu() {
    document.getElementById('context-menu').style.display = 'none';
  }

  // ── PANNEAU ÉDITION TEXTE ─────────────────────────────────────────────────
  function _setKeyObject(el) {
    if (_keyObject) _keyObject.classList.remove('key-object');
    _keyObject = el;
    _keyObject.classList.add('key-object');
  }

  function updateAlignPanel() {
    const sbAlign = document.querySelector('.sb-align');
    const sbText = document.querySelector('.sb-text');
    const toolbar = document.getElementById('toolbar');
    if (multiSelected.size >= 2) {
      if (toolbar) toolbar.style.display = 'none';
      if (sbAlign) sbAlign.classList.remove('sb-disabled');
      if (_keyObject && !multiSelected.has(_keyObject)) {
        _keyObject.classList.remove('key-object');
        _keyObject = null;
      }
    } else {
      if (sbAlign) sbAlign.classList.add('sb-disabled');
      if (toolbar && sbText && sbText.classList.contains('sb-disabled')) {
        toolbar.style.display = '';
      }
      if (_keyObject) {
        _keyObject.classList.remove('key-object');
        _keyObject = null;
      }
    }
  }

  function alignElements(type) {
    const group = [...multiSelected];
    if (group.length < 2) return;
    const isCollab = typeof Collab !== 'undefined' && Collab.isActive();
    const ids = [],
      beforeArr = [],
      afterArr = [];
    group.forEach((el) => {
      ids.push(el.dataset.id);
      beforeArr.push({ x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0 });
    });
    let refLeft, refRight, refTop, refBottom, refCX, refCY;
    const keyEl = _keyObject && multiSelected.has(_keyObject) ? _keyObject : null;
    if (keyEl) {
      refLeft = parseFloat(keyEl.style.left) || 0;
      refTop = parseFloat(keyEl.style.top) || 0;
      refRight = refLeft + keyEl.offsetWidth;
      refBottom = refTop + keyEl.offsetHeight;
      refCX = refLeft + keyEl.offsetWidth / 2;
      refCY = refTop + keyEl.offsetHeight / 2;
    } else {
      let minL = Infinity,
        minT = Infinity,
        maxR = -Infinity,
        maxB = -Infinity;
      group.forEach((el) => {
        const l = parseFloat(el.style.left) || 0;
        const t = parseFloat(el.style.top) || 0;
        const r = l + el.offsetWidth;
        const b = t + el.offsetHeight;
        if (l < minL) minL = l;
        if (t < minT) minT = t;
        if (r > maxR) maxR = r;
        if (b > maxB) maxB = b;
      });
      refLeft = minL;
      refTop = minT;
      refRight = maxR;
      refBottom = maxB;
      refCX = (minL + maxR) / 2;
      refCY = (minT + maxB) / 2;
    }
    group.forEach((el, i) => {
      if (keyEl && el === keyEl) {
        afterArr.push({ x: beforeArr[i].x, y: beforeArr[i].y });
        return;
      }
      let newX = beforeArr[i].x,
        newY = beforeArr[i].y;
      if (type === 'left') newX = refLeft;
      else if (type === 'center-h') newX = refCX - el.offsetWidth / 2;
      else if (type === 'right') newX = refRight - el.offsetWidth;
      else if (type === 'top') newY = refTop;
      else if (type === 'center-v') newY = refCY - el.offsetHeight / 2;
      else if (type === 'bottom') newY = refBottom - el.offsetHeight;
      el.style.left = newX + 'px';
      el.style.top = newY + 'px';
      updateConnectionsForEl(el);
      if (isCollab) Collab.syncElementPosition(el.dataset.id, newX, newY, true);
      afterArr.push({ x: newX, y: newY });
    });
    const _alignLabels = { 'left': 'Aligné à gauche', 'center-h': 'Centré horizontalement', 'right': 'Aligné à droite', 'top': 'Aligné en haut', 'center-v': 'Centré verticalement', 'bottom': 'Aligné en bas' };
    pushAction({ type: 'groupMove', elId: ids, before: beforeArr, after: afterArr, detail: _alignLabels[type] || 'Alignement' });
    syncDomToDataset();
    updateMultiResizeHandle();
  }

  function distributeElements(axis) {
    const group = [...multiSelected];
    if (group.length < 3) return;
    const isCollab = typeof Collab !== 'undefined' && Collab.isActive();
    const getLeft = (el) => parseFloat(el.style.left) || 0;
    const getTop = (el) => parseFloat(el.style.top) || 0;
    const getSize = (el) => (axis === 'h' ? el.offsetWidth : el.offsetHeight);
    const getPos = (el) => (axis === 'h' ? getLeft(el) : getTop(el));
    const sorted = [...group].sort((a, b) => getPos(a) - getPos(b));
    let anchorA = sorted[0],
      anchorB = sorted[sorted.length - 1];
    const keyEl = _keyObject && multiSelected.has(_keyObject) ? _keyObject : null;
    if (keyEl) {
      let maxDist = -1;
      sorted.forEach((el) => {
        if (el === keyEl) return;
        const d = Math.abs(getPos(el) - getPos(keyEl));
        if (d > maxDist) {
          maxDist = d;
          anchorB = el;
        }
      });
      anchorA = keyEl;
      if (getPos(anchorA) > getPos(anchorB)) {
        const tmp = anchorA;
        anchorA = anchorB;
        anchorB = tmp;
      }
    }
    const startEdge = getPos(anchorA) + getSize(anchorA);
    const endEdge = getPos(anchorB);
    const inner = sorted.filter(
      (el) =>
        el !== anchorA &&
        el !== anchorB &&
        getPos(el) >= getPos(anchorA) &&
        getPos(el) <= getPos(anchorB)
    );
    if (inner.length === 0) return;
    const innerTotalSize = inner.reduce((sum, el) => sum + getSize(el), 0);
    const gap = (endEdge - startEdge - innerTotalSize) / (inner.length + 1);
    const newPosMap = new Map();
    let cursor = startEdge + gap;
    inner.forEach((el) => {
      newPosMap.set(el, cursor);
      cursor += getSize(el) + gap;
    });
    const ids = [],
      beforeArr = [],
      afterArr = [];
    group.forEach((el) => {
      const origX = getLeft(el),
        origY = getTop(el);
      ids.push(el.dataset.id);
      beforeArr.push({ x: origX, y: origY });
      if (!newPosMap.has(el)) {
        afterArr.push({ x: origX, y: origY });
        return;
      }
      const newPos = newPosMap.get(el);
      const newX = axis === 'h' ? newPos : origX;
      const newY = axis === 'h' ? origY : newPos;
      el.style.left = newX + 'px';
      el.style.top = newY + 'px';
      updateConnectionsForEl(el);
      if (isCollab) Collab.syncElementPosition(el.dataset.id, newX, newY, true);
      afterArr.push({ x: newX, y: newY });
    });
    pushAction({ type: 'groupMove', elId: ids, before: beforeArr, after: afterArr, detail: axis === 'h' ? 'Distribution horizontale' : 'Distribution verticale' });
    syncDomToDataset();
    updateMultiResizeHandle();
  }

  let textEditTarget = null;
  function showTextEditPanel(el) {
    textEditTarget = el;
    const _styleTarget = el.querySelector('.el-note-content') || el;
    _styleEditBeforeHtml = _styleTarget ? _styleTarget.innerHTML : null;
    _styleEditBeforeStyle = _styleTarget ? _styleTarget.style.cssText : null;
    document.getElementById('toolbar').style.display = 'none';
    document.querySelector('.sb-text')?.classList.remove('sb-disabled');
    const _fsBtn = document.getElementById('font-selector-btn');
    if (_fsBtn) _fsBtn.classList.remove('sb-disabled');

    // Déterminer la cible du style (le div note-content dans une note, ou l'élément lui-même si c'est une caption)
    const target = el.querySelector('.el-note-content') || el;

    if (target) {
      const sz = parseInt(target.style.fontSize) || 12; // 12px par défaut pour caption
      const sizeVal = document.getElementById('text-size-val');
      if (sizeVal) sizeVal.textContent = sz;

      const rawFamily = target.style.fontFamily || '';
      const selectorBtn = document.getElementById('font-selector-btn');
      if (selectorBtn) {
        const m = rawFamily.match(/['"]?([^'",]+)['"]?/);
        const displayFamily = m ? m[1].trim() : '—';
        selectorBtn.textContent = displayFamily;
        selectorBtn.style.fontFamily = rawFamily || 'inherit';
      }
    }
    _updateListBtns();
  }
  function hideTextEditPanel() {
    _styleEditBeforeHtml = null;
    _styleEditBeforeStyle = null;
    document.querySelector('.sb-text')?.classList.add('sb-disabled');
    const _fsBtnHide = document.getElementById('font-selector-btn');
    if (_fsBtnHide) { _fsBtnHide.classList.add('sb-disabled'); _fsBtnHide.textContent = '—'; _fsBtnHide.style.fontFamily = 'inherit'; }
    _closeFontDropdown(false);
    textEditTarget = null;
    updateAlignPanel();
    document.querySelectorAll('.list-type-btn').forEach((b) => b.classList.remove('active'));
  }

  function handleCaptionBlur(e, cap) {
    const sbText = document.querySelector('.sb-text');
    const goingToPanel = sbText && e.relatedTarget && sbText.contains(e.relatedTarget);
    if (goingToPanel || window._textPanelKeepOpen) return;

    hideTextEditPanel();

    const capId = cap.dataset.capId;
    const parentId = cap.dataset.parentId || '';
    const x = parseFloat(cap.style.left) || 0;
    const y = parseFloat(cap.style.top) || 0;
    const width = cap.style.width || '';
    const currentText = cap.textContent.trim();

    if (!currentText) {
      if (cap.dataset.isNew) {
        // Caption créée mais jamais remplie → supprimer silencieusement
        cap.remove();
        return;
      }
      // Caption existante vidée → captionDelete
      pushAction({
        type: 'captionDelete',
        capId,
        before: { parentId, x, y, width, text: _capValueOnFocus },
      });
      if (typeof Collab !== 'undefined' && Collab.isActive() && capId) {
        Collab.syncCaptionDelete(capId);
      }
      cap.remove();
      syncDomToDataset();
    } else if (cap.dataset.isNew) {
      // Nouvelle caption avec texte → captionCreate
      delete cap.dataset.isNew;
      pushAction({
        type: 'captionCreate',
        capId,
        after: { parentId, x, y, width, text: currentText },
      });
      if (typeof Collab !== 'undefined' && Collab.isActive() && capId) {
        Collab.syncCaption(capId, parentId, x, y, width, currentText);
      }
      syncDomToDataset();
    } else if (currentText !== _capValueOnFocus) {
      // Edition texte existant → captionEdit
      pushAction({
        type: 'captionEdit',
        capId,
        before: { text: _capValueOnFocus },
        after: { text: currentText },
      });
      if (typeof Collab !== 'undefined' && Collab.isActive() && capId) {
        Collab.syncCaption(capId, parentId, x, y, width, currentText);
      }
      syncDomToDataset();
    }
  }
  function applyTextFont(family, preview) {
    if (!textEditTarget) return;

    const noteDiv = textEditTarget.querySelector('.el-note-content');
    const caption = textEditTarget.classList.contains('el-caption') ? textEditTarget : null;
    const ta = noteDiv || caption;
    if (!ta) return;

    const isHelvetica = family === 'HelveticaRoman' || family === 'HelveticaBold';
    const fontFamily = isHelvetica
      ? (family === 'HelveticaBold'
          ? "'HelveticaBold','Helvetica Neue',Helvetica,Arial,sans-serif"
          : "'HelveticaRoman','Helvetica Neue',Helvetica,Arial,sans-serif")
      : ("'" + family + "', sans-serif");
    const fontWeight = '400';

    if (!isHelvetica && !_localFonts.includes(family)) _loadGFont(family);

    if (noteDiv) {
      const sel = window.getSelection();
      if (
        sel &&
        sel.rangeCount > 0 &&
        !sel.isCollapsed &&
        noteDiv.contains(sel.getRangeAt(0).commonAncestorContainer)
      ) {
        const range = sel.getRangeAt(0);
        const span = document.createElement('span');
        span.style.fontFamily = fontFamily;
        span.style.fontWeight = fontWeight;
        try {
          range.surroundContents(span);
        } catch (_) {
          const frag = range.extractContents();
          span.appendChild(frag);
          range.insertNode(span);
        }
        sel.removeAllRanges();
        const newRange = document.createRange();
        newRange.selectNodeContents(span);
        sel.addRange(newRange);
      } else {
        noteDiv.style.fontFamily = fontFamily;
        noteDiv.style.fontWeight = fontWeight;
      }
      textEditTarget.dataset.savedata = noteDiv.innerHTML;
    } else {
      ta.style.fontFamily = fontFamily;
      ta.style.fontWeight = fontWeight;
    }

    const selectorBtn = document.getElementById('font-selector-btn');
    if (selectorBtn) {
      selectorBtn.textContent = family;
      selectorBtn.style.fontFamily = fontFamily;
    }

    if (!preview) {
      _pendingStyleDetail = 'Police : ' + family;
      _collabSyncStyle();
      _saveStyleChange();
      const _recent = JSON.parse(localStorage.getItem('mb_fonts_recent') || '[]').filter((f) => f !== family);
      _recent.unshift(family);
      if (_recent.length > 10) _recent.pop();
      localStorage.setItem('mb_fonts_recent', JSON.stringify(_recent));
    }
  }

  async function _loadLocalFonts() {
    if (!window.queryLocalFonts) return;
    try {
      const fonts = await window.queryLocalFonts();
      const seen = new Set();
      _localFonts = fonts
        .filter((f) => {
          if (seen.has(f.family)) return false;
          seen.add(f.family);
          return true;
        })
        .map((f) => f.family)
        .sort((a, b) => a.localeCompare(b));
    } catch (_) {
      _localFonts = [];
    }
  }

  function _loadGFont(family) {
    if (_loadedGFonts.has(family)) return;
    _loadedGFonts.add(family);
    const url = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') + '&display=swap';
    function _inject() {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      document.head.appendChild(link);
    }
    _fetchGFontsList().then(function () {
      if (_gFontsList && _gFontsList.length > 0) {
        // List loaded — inject only if font is a known Google Font
        if (_gFontsList.includes(family)) _inject();
      } else {
        // List unavailable — probe first to avoid MIME type errors
        fetch(url).then(function (r) {
          if (r.ok && (r.headers.get('content-type') || '').includes('text/css')) _inject();
        }).catch(function () {});
      }
    });
  }

  async function _fetchGFontsList() {
    if (_gFontsList !== null) return;
    _gFontsList = [];
    try {
      const res = await fetch(
        'https://www.googleapis.com/webfonts/v1/webfonts?key=AIzaSyBEpnmNwg__zubNb1ckG98LFpkFgcGDrS4&sort=popularity'
      );
      const data = await res.json();
      _gFontsList = (data.items || []).map((f) => f.family);
    } catch (_) {
      _gFontsList = [];
    }
  }

  function _renderFontList(filter) {
    const list = document.getElementById('font-list');
    if (!list) return;
    list.innerHTML = '';
    const q = filter.toLowerCase();

    function makeSection(label) {
      const sec = document.createElement('div');
      sec.className = 'font-list-section';
      sec.textContent = label;
      list.appendChild(sec);
    }

    function makeItem(family, source) {
      const item = document.createElement('div');
      item.className = 'font-list-item';
      item.dataset.family = family;

      const nameSpan = document.createElement('span');
      nameSpan.textContent = family;
      const cssFamily = source === 'local'
        ? (family + ', sans-serif')
        : ("'" + family + "', sans-serif");
      nameSpan.style.fontFamily = cssFamily;
      if (source !== 'local') _loadGFont(family);
      item.appendChild(nameSpan);

      if (source === 'my-google') {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'font-remove-btn';
        removeBtn.textContent = '×';
        removeBtn.title = 'Retirer';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          let saved = JSON.parse(localStorage.getItem('mb_fonts_list') || '[]');
          saved = saved.filter((f) => f.family !== family);
          localStorage.setItem('mb_fonts_list', JSON.stringify(saved));
          _renderFontList(filter);
        });
        item.appendChild(removeBtn);
      } else if (source === 'google-result') {
        const addBtn = document.createElement('button');
        addBtn.className = 'font-add-btn';
        addBtn.textContent = '+';
        addBtn.title = 'Ajouter à mes polices';
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          let saved = JSON.parse(localStorage.getItem('mb_fonts_list') || '[]');
          if (!saved.some((f) => f.family === family)) {
            saved.push({ family: family, source: 'google' });
            localStorage.setItem('mb_fonts_list', JSON.stringify(saved));
          }
          _renderFontList(filter);
        });
        item.appendChild(addBtn);
      }

      item.addEventListener('mouseenter', () => {
        applyTextFont(family, true);
      });

      item.addEventListener('click', () => {
        applyTextFont(family);
        _closeFontDropdown(false);
      });

      list.appendChild(item);
    }

    const recent = JSON.parse(localStorage.getItem('mb_fonts_recent') || '[]');
    const recentFiltered = recent.filter((f) => !q || f.toLowerCase().includes(q));
    if (recentFiltered.length) {
      makeSection('Récemment utilisées');
      recentFiltered.forEach((f) => {
        const isLocal = _localFonts.includes(f);
        makeItem(f, isLocal ? 'local' : 'my-google');
      });
    }

    const localFiltered = _localFonts.filter((f) => !q || f.toLowerCase().includes(q));
    if (localFiltered.length) {
      makeSection('Polices locales');
      localFiltered.forEach((f) => makeItem(f, 'local'));
    }

    const saved = JSON.parse(localStorage.getItem('mb_fonts_list') || '[]');
    const myFiltered = saved.filter((f) => !q || f.family.toLowerCase().includes(q));
    if (myFiltered.length) {
      makeSection('Mes Google Fonts');
      myFiltered.forEach((f) => makeItem(f.family, 'my-google'));
    }

    if (filter.length >= 2) {
      if (_gFontsList === null) {
        _fetchGFontsList().then(() => _renderFontList(filter));
        const loading = document.createElement('div');
        loading.className = 'font-list-section';
        loading.textContent = 'Chargement…';
        list.appendChild(loading);
      } else {
        const savedSet = new Set(saved.map((f) => f.family));
        const localSet = new Set(_localFonts);
        const results = _gFontsList
          .filter((f) => f.toLowerCase().includes(q) && !savedSet.has(f) && !localSet.has(f))
          .slice(0, 30);
        if (results.length) {
          makeSection('Résultats Google');
          results.forEach((f) => makeItem(f, 'google-result'));
        }
      }
    }
  }

  function _updateFocusedItem(items) {
    items.forEach((it, i) => it.classList.toggle('focused', i === _fontFocusedIdx));
    const focused = items[_fontFocusedIdx];
    if (focused) {
      focused.scrollIntoView({ block: 'nearest' });
      const family = focused.dataset.family;
      if (family) applyTextFont(family, true);
    }
  }

  function _closeFontDropdown(revert) {
    if (!_fontDropdownOpen) return;
    const dropdown = document.getElementById('font-selector-dropdown');
    if (dropdown) dropdown.style.display = 'none';
    _fontDropdownOpen = false;
    if (revert && _fontPreviewOriginal !== null) {
      const m = _fontPreviewOriginal.match(/['"]?([^'",]+)['"]?/);
      if (m) applyTextFont(m[1].trim());
      else applyTextFont('HelveticaRoman');
    }
    _fontPreviewOriginal = null;
    _fontFocusedIdx = -1;
  }

  function _initFontSelector() {
    const btn = document.getElementById('font-selector-btn');
    const dropdown = document.getElementById('font-selector-dropdown');
    const searchInput = document.getElementById('font-search-input');
    const wrap = document.getElementById('font-selector-wrap');
    if (!btn || !dropdown || !searchInput || !wrap) return;

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (_fontDropdownOpen) {
        _closeFontDropdown(false);
        return;
      }
      if (btn.classList.contains('sb-disabled')) return;
      await _loadLocalFonts();
      const ta = textEditTarget
        ? (textEditTarget.querySelector('.el-note-content') || textEditTarget)
        : null;
      _fontPreviewOriginal = ta ? ta.style.fontFamily || null : null;
      _fontFocusedIdx = -1;
      searchInput.value = '';
      _renderFontList('');
      dropdown.style.display = 'flex';
      _fontDropdownOpen = true;
      searchInput.focus();
    });

    document.addEventListener('click', (e) => {
      if (_fontDropdownOpen && !wrap.contains(e.target)) _closeFontDropdown(false);
    });

    dropdown.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });

    searchInput.addEventListener('input', () => {
      _fontFocusedIdx = -1;
      _renderFontList(searchInput.value.trim());
    });

    searchInput.addEventListener('keydown', (e) => {
      const list = document.getElementById('font-list');
      if (!list) return;
      const items = list.querySelectorAll('.font-list-item[data-family]');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _fontFocusedIdx = Math.min(_fontFocusedIdx + 1, items.length - 1);
        _updateFocusedItem(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _fontFocusedIdx = Math.max(_fontFocusedIdx - 1, 0);
        _updateFocusedItem(items);
      } else if (e.key === 'Enter') {
        const focused = items[_fontFocusedIdx];
        if (focused) {
          const family = focused.dataset.family;
          if (family) { applyTextFont(family); _closeFontDropdown(false); }
        }
      } else if (e.key === 'Escape') {
        _closeFontDropdown(true);
      }
    });
  }

  function applyTextSizeDelta(delta) {
    if (!textEditTarget) return;
    const ta = textEditTarget.querySelector('.el-note-content') || textEditTarget;
    if (!ta) return;
    const current = parseInt(ta.style.fontSize) || 14;
    const next = Math.min(Math.max(current + delta, 8), 300);
    ta.style.fontSize = next + 'px';
    const sizeVal = document.getElementById('text-size-val');
    if (sizeVal) sizeVal.textContent = next;
    _pendingStyleDetail = 'Taille texte modifiée (' + next + ')';
    _collabSyncStyle();
    _saveStyleChange();
  }
  function _detectListState(ta) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let node = sel.getRangeAt(0).startContainer;
    while (node && node !== ta) {
      if (node.nodeName === 'LI') {
        const ul = node.parentElement;
        if (ul && ul.nodeName === 'UL') {
          return ul.classList.contains('todo-list') ? 'todo' : 'bullet';
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  function _updateListBtns() {
    const bulletBtn = document.getElementById('list-bullet-btn');
    const todoBtn = document.getElementById('list-todo-btn');
    if (!bulletBtn || !todoBtn) return;
    bulletBtn.classList.remove('active');
    todoBtn.classList.remove('active');
    if (!textEditTarget) return;
    const ta = textEditTarget.querySelector('.el-note-content');
    if (!ta) return;
    const state = _detectListState(ta);
    if (state === 'bullet') bulletBtn.classList.add('active');
    else if (state === 'todo') todoBtn.classList.add('active');
  }

  function _makeListItem(type, content) {
    const li = document.createElement('li');
    if (type === 'todo') {
      li.className = 'todo-item';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'todo-check';
      check.setAttribute('contenteditable', 'false');
      const span = document.createElement('span');
      span.innerHTML = content || '';
      li.appendChild(check);
      li.appendChild(span);
    } else {
      li.innerHTML = content || '';
    }
    return li;
  }

  // Isole un <li> dans son propre <ul> (même classe que le <ul> source) en scindant
  // la liste autour de lui. Retourne le <ul> ne contenant que ce <li>.
  function _isolateListItem(li) {
    const ul = li.parentElement;
    if (!ul || ul.nodeName !== 'UL') return null;
    if (ul.children.length === 1) return ul;
    const itemsAfter = [];
    let next = li.nextElementSibling;
    while (next) {
      itemsAfter.push(next);
      next = next.nextElementSibling;
    }
    const mid = document.createElement('ul');
    if (ul.className) mid.className = ul.className;
    li.remove();
    mid.appendChild(li);
    ul.parentNode.insertBefore(mid, ul.nextSibling);
    if (itemsAfter.length > 0) {
      const tail = document.createElement('ul');
      if (ul.className) tail.className = ul.className;
      itemsAfter.forEach((item) => {
        item.remove();
        tail.appendChild(item);
      });
      mid.parentNode.insertBefore(tail, mid.nextSibling);
    }
    if (!ul.querySelector('li')) ul.remove();
    return mid;
  }

  // Offset caractère du point (node, offset) depuis le début de container.
  // La checkbox d'un todo ne compte pour aucun caractère : offsets identiques
  // que l'on mesure sur le <li> ou sur son <span>.
  function _textOffsetInNode(container, node, offset) {
    if (!container || !node) return 0;
    const r = document.createRange();
    try {
      r.selectNodeContents(container);
      r.setEnd(node, offset);
    } catch (_) {
      return 0;
    }
    return r.toString().length;
  }

  // Inverse de _textOffsetInNode : retrouve {node, offset} pour un offset caractère.
  function _pointAtTextOffset(container, offset) {
    if (!container) return null;
    if (container.nodeType === Node.TEXT_NODE) {
      return { node: container, offset: Math.min(offset, container.length) };
    }
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    let remaining = offset;
    let last = null;
    let node = walker.nextNode();
    while (node) {
      if (remaining <= node.length) return { node: node, offset: remaining };
      remaining -= node.length;
      last = node;
      node = walker.nextNode();
    }
    if (last) return { node: last, offset: last.length };
    const t = document.createTextNode('');
    container.insertBefore(t, container.firstChild || null);
    return { node: t, offset: 0 };
  }

  function _getBlocksInRange(ta, range) {
    const blocks = [];
    ta.childNodes.forEach((child) => {
      if (child.nodeName === 'UL') {
        child.querySelectorAll('li').forEach((li) => {
          if (range.intersectsNode(li)) blocks.push(li);
        });
      } else if (range.intersectsNode(child)) {
        blocks.push(child);
      }
    });
    return blocks;
  }

  function _mergeAdjacentLists(ta) {
    let changed = true;
    let i = 0;
    while (changed && i++ < 50) {
      changed = false;
      const uls = Array.from(ta.querySelectorAll(':scope > ul'));
      for (let j = 0; j < uls.length - 1; j++) {
        const a = uls[j];
        const b = uls[j + 1];
        if (a.nextElementSibling === b) {
          const sameType =
            a.classList.contains('todo-list') === b.classList.contains('todo-list');
          if (sameType) {
            while (b.firstChild) a.appendChild(b.firstChild);
            b.remove();
            changed = true;
            break;
          }
        }
      }
    }
  }

  function _unwrapListItem(li, type) {
    const ul = li.parentElement;
    if (!ul) return null;
    let inner;
    if (type === 'todo') {
      const span = li.querySelector('span');
      inner = span ? span.innerHTML : '';
    } else {
      inner = li.innerHTML;
    }
    const itemsAfter = [];
    let next = li.nextElementSibling;
    while (next) {
      itemsAfter.push(next);
      next = next.nextElementSibling;
    }
    const div = document.createElement('div');
    div.innerHTML = inner || '<br>';
    li.remove();
    ul.parentNode.insertBefore(div, ul.nextSibling);
    if (itemsAfter.length > 0) {
      const newUl = document.createElement('ul');
      if (type === 'todo') newUl.className = 'todo-list';
      itemsAfter.forEach((item) => {
        item.remove();
        newUl.appendChild(item);
      });
      div.parentNode.insertBefore(newUl, div.nextSibling);
    }
    if (!ul.querySelector('li')) ul.remove();
    return div;
  }

  // Replace la sélection après remplacement des blocs : targets[i] est le conteneur
  // éditable issu de blocks[i] (null si le bloc a été supprimé).
  function _restoreSelectionInBlocks(targets, startIdx, startOff, endIdx, endOff) {
    const startC = startIdx >= 0 ? targets[startIdx] : null;
    if (!startC || !startC.isConnected) return;
    const sp = _pointAtTextOffset(startC, startOff);
    if (!sp) return;
    const r = document.createRange();
    r.setStart(sp.node, sp.offset);
    r.collapse(true);
    const endC = endIdx >= 0 ? targets[endIdx] : null;
    const inOrder = endIdx > startIdx || (endIdx === startIdx && endOff >= startOff);
    if (endC && endC.isConnected && inOrder) {
      const ep = _pointAtTextOffset(endC, endOff);
      if (ep) {
        try {
          r.setEnd(ep.node, ep.offset);
        } catch (_) {}
      }
    }
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function applyListToggle(type) {
    if (!textEditTarget) return;
    const el = textEditTarget;
    const ta = el.querySelector('.el-note-content');
    if (!ta) return;

    ta.focus();

    const beforeHtml = ta.innerHTML;
    const beforeStyle = ta.style.cssText;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    const blocks = _getBlocksInRange(ta, range);
    if (blocks.length === 0) return;

    // Mémoriser les extrémités de la sélection (bloc + offset texte) avant mutation :
    // les nœuds qui portent le caret sont détruits par la conversion.
    const findBlockIdx = (node) => {
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b === node || (b.nodeType === Node.ELEMENT_NODE && b.contains(node))) return i;
      }
      return -1;
    };
    const startIdx = findBlockIdx(range.startContainer);
    const endIdx = findBlockIdx(range.endContainer);
    const startOff =
      startIdx >= 0
        ? _textOffsetInNode(blocks[startIdx], range.startContainer, range.startOffset)
        : 0;
    const endOff =
      endIdx >= 0 ? _textOffsetInNode(blocks[endIdx], range.endContainer, range.endOffset) : 0;
    const caretTargets = new Array(blocks.length).fill(null);

    const allSameType = blocks.every((node) => {
      if (node.nodeName !== 'LI') return false;
      const ul = node.parentElement;
      return (
        ul &&
        ul.nodeName === 'UL' &&
        (type === 'todo'
          ? ul.classList.contains('todo-list')
          : !ul.classList.contains('todo-list'))
      );
    });

    if (allSameType) {
      blocks.forEach((node, idx) => {
        if (node.nodeName === 'LI') caretTargets[idx] = _unwrapListItem(node, type);
      });
    } else {
      blocks.forEach((node, idx) => {
        if (node.nodeName === 'LI') {
          const ul = node.parentElement;
          if (!ul || ul.nodeName !== 'UL') return;
          const currentType = ul.classList.contains('todo-list') ? 'todo' : 'bullet';
          if (currentType === type) {
            caretTargets[idx] = type === 'todo' ? node.querySelector('span') || node : node;
            return;
          }
          // Le type est porté par le <ul> : convertir sans scinder retirerait la puce
          // (ou la case) des items voisins non sélectionnés. _mergeAdjacentLists
          // recolle ensuite les <ul> de même type restés adjacents.
          const holder = _isolateListItem(node);
          if (!holder) return;
          if (type === 'todo') {
            // bullet → todo
            const text = node.innerHTML;
            node.innerHTML = '';
            node.className = 'todo-item';
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.className = 'todo-check';
            check.setAttribute('contenteditable', 'false');
            const span = document.createElement('span');
            span.innerHTML = text;
            node.appendChild(check);
            node.appendChild(span);
            holder.className = 'todo-list';
            caretTargets[idx] = span;
          } else {
            // todo → bullet
            const span = node.querySelector('span');
            node.innerHTML = span ? span.innerHTML : node.innerHTML;
            node.classList.remove('todo-item', 'todo-done');
            if (!node.className) node.removeAttribute('class');
            holder.removeAttribute('class');
            caretTargets[idx] = node;
          }
        } else {
          // Plain block (div, text node, br)
          if (node.nodeName === 'BR') {
            if (node.parentNode) node.parentNode.removeChild(node);
            return;
          }
          let content = '';
          if (node.nodeType === Node.TEXT_NODE) {
            content = node.textContent;
          } else if (node.nodeName === 'DIV') {
            content = node.innerHTML.replace(/<br\s*\/?>\s*$/i, '');
          }
          // Skip empty blocks
          if (!content.replace(/<br\s*\/?>/gi, '').trim()) {
            if (node.parentNode && node.nodeType !== Node.TEXT_NODE) node.parentNode.removeChild(node);
            return;
          }
          const li = _makeListItem(type, content);
          const ul = document.createElement('ul');
          if (type === 'todo') ul.className = 'todo-list';
          ul.appendChild(li);
          caretTargets[idx] = type === 'todo' ? li.querySelector('span') : li;
          if (node.nodeType === Node.TEXT_NODE) {
            node.parentNode.insertBefore(ul, node);
            node.remove();
          } else {
            node.parentNode.replaceChild(ul, node);
          }
        }
      });
      _mergeAdjacentLists(ta);
    }

    _restoreSelectionInBlocks(caretTargets, startIdx, startOff, endIdx, endOff);

    const afterHtml = ta.innerHTML;
    if (afterHtml !== beforeHtml) {
      el.dataset.savedata = ta.innerHTML;

      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.syncElementData(el.dataset.id, ta.innerHTML);
      }

      pushAction({
        type: 'editText',
        elId: el.dataset.id,
        before: { data: beforeHtml, style: beforeStyle },
        after: { data: afterHtml, style: ta.style.cssText },
        detail: type === 'bullet' ? 'Liste à puces' : 'Todo liste',
      });
      syncDomToDataset();
    }

    _updateListBtns();
  }

  function applyTextAlign(align) {
    if (!textEditTarget) return;
    const noteDiv = textEditTarget.querySelector('.el-note-content');
    if (noteDiv) {
      noteDiv.focus();
      const cmdMap = { left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight' };
      document.execCommand(cmdMap[align]);
      textEditTarget.dataset.savedata = noteDiv.innerHTML;
    } else {
      const ta = textEditTarget;
      if (ta) ta.style.textAlign = align;
    }
    document.querySelectorAll('.text-align-btn').forEach((b) => b.classList.remove('active'));
    const id = { left: 'ta-left', center: 'ta-center', right: 'ta-right' }[align];
    const btn = document.getElementById(id);
    if (btn) btn.classList.add('active');
    _pendingStyleDetail = { left: 'Texte aligné gauche', center: 'Texte centré', right: 'Texte aligné droite' }[align] || 'Alignement de texte';
    _collabSyncStyle();
    _saveStyleChange();
  }

  let _styleEditBeforeHtml = null;
  let _styleEditBeforeStyle = null;
  let _saveStyleTimer = null;
  let _pendingStyleDetail = null;
  function _saveStyleChange() {
    const detail = _pendingStyleDetail;
    _pendingStyleDetail = null;
    const isCollab = typeof Collab !== 'undefined' && Collab.isActive();
    if (!textEditTarget || _styleEditBeforeHtml === null) {
      if (!isCollab) {
        clearTimeout(_saveStyleTimer);
        _saveStyleTimer = setTimeout(() => { saveCurrentBoard(); syncDomToDataset(); }, 300);
      }
      return;
    }
    const ta = textEditTarget.querySelector('.el-note-content') || textEditTarget;
    if (!ta) return;
    const afterHtml = ta.innerHTML;
    const afterStyle = ta.style.cssText;
    if (afterHtml !== _styleEditBeforeHtml || afterStyle !== _styleEditBeforeStyle) {
      const actionObj = {
        type: 'editText',
        elId: textEditTarget.dataset.id || textEditTarget.dataset.capId,
        before: { data: _styleEditBeforeHtml, style: _styleEditBeforeStyle },
        after: { data: afterHtml, style: afterStyle },
      };
      if (detail) actionObj.detail = detail;
      pushAction(actionObj);
      _styleEditBeforeHtml = afterHtml;
      _styleEditBeforeStyle = afterStyle;
      syncDomToDataset();
    }
    if (isCollab) {
      saveCurrentBoard();
      return;
    }
    clearTimeout(_saveStyleTimer);
    _saveStyleTimer = setTimeout(() => { saveCurrentBoard(); syncDomToDataset(); }, 300);
  }

  function ctxBringFront() {
    if (ctxTargetEl) {
      const oldZ = parseInt(ctxTargetEl.style.zIndex) || 100;
      ctxTargetEl.style.zIndex = ++nextZ;
      pushAction({
        type: 'zIndex',
        elId: ctxTargetEl.dataset.id,
        before: { z: oldZ },
        after: { z: nextZ },
      });
      syncDomToDataset();
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.syncElementZ(ctxTargetEl.dataset.id, nextZ);
      }
    }
    hideContextMenu();
  }
  function ctxSendBack() {
    if (ctxTargetEl) {
      const oldZ = parseInt(ctxTargetEl.style.zIndex) || 100;
      ctxTargetEl.style.zIndex = 1;
      pushAction({
        type: 'zIndex',
        elId: ctxTargetEl.dataset.id,
        before: { z: oldZ },
        after: { z: 1 },
      });
      syncDomToDataset();
      if (typeof Collab !== 'undefined' && Collab.isActive()) {
        Collab.syncElementZ(ctxTargetEl.dataset.id, 1);
      }
    }
    hideContextMenu();
  }
  function ctxDuplicate() {
    if (!ctxTargetEl) {
      hideContextMenu();
      return;
    }
    if (multiSelected.has(ctxTargetEl) && multiSelected.size > 1) {
      const copies = [];
      multiSelected.forEach((el) => {
        const s = {
          type: el.dataset.type,
          x: parseFloat(el.style.left) + 24,
          y: parseFloat(el.style.top) + 24,
          w: parseFloat(el.style.width) || null,
          h: parseFloat(el.style.height) || null,
          data:
            el.dataset.type === 'image'
              ? _imgStore.get(el.dataset.id) || ''
              : el.dataset.savedata || '',
        };
        const newEl = restoreElement(s);
        if (newEl && el.dataset.type === 'image') {
          const origSrc = _imgOrigStore.get(el.dataset.id);
          if (origSrc && !_imgOrigStore.has(newEl.dataset.id)) _imgOrigStore.set(newEl.dataset.id, origSrc);
          if (el.dataset.cropdata) newEl.dataset.cropdata = el.dataset.cropdata;
        }
        if (newEl) {
          if (typeof Collab !== 'undefined' && Collab.isActive()) _collabSyncCreatedEl(newEl);
          copies.push(newEl);
        }
      });
      if (copies.length) {
        pushAction({
          type: 'groupCreate',
          elId: copies.map((e) => e.dataset.id),
          after: copies.map((e) => _captureElState(e)),
        });
        syncDomToDataset();
      }
    } else {
      const s = {
        type: ctxTargetEl.dataset.type,
        x: parseFloat(ctxTargetEl.style.left) + 24,
        y: parseFloat(ctxTargetEl.style.top) + 24,
        w: parseFloat(ctxTargetEl.style.width) || null,
        h: parseFloat(ctxTargetEl.style.height) || null,
        data:
          ctxTargetEl.dataset.type === 'image'
            ? _imgStore.get(ctxTargetEl.dataset.id) || ''
            : ctxTargetEl.dataset.savedata || '',
      };
      const el = restoreElement(s);
      if (el && ctxTargetEl.dataset.type === 'image') {
        const origSrc = _imgOrigStore.get(ctxTargetEl.dataset.id);
        if (origSrc && !_imgOrigStore.has(el.dataset.id)) _imgOrigStore.set(el.dataset.id, origSrc);
        if (ctxTargetEl.dataset.cropdata) el.dataset.cropdata = ctxTargetEl.dataset.cropdata;
      }
      if (el) {
        if (typeof Collab !== 'undefined' && Collab.isActive()) _collabSyncCreatedEl(el);
        selectEl(el);
        pushAction({ type: 'create', elId: el.dataset.id, after: _captureElState(el) });
        syncDomToDataset();
      }
    }
    hideContextMenu();
  }
  function ctxDelete() {
    // S'assurer que l'élément cible fait bien partie de la sélection courante
    if (ctxTargetEl) {
      if (!multiSelected.has(ctxTargetEl) && selectedEl !== ctxTargetEl) {
        selectedEl = ctxTargetEl;
      }
      ctxTargetEl = null;
    }
    hideContextMenu();
    deleteSelected();
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
    const folderLabels = {
      all: 'Tout',
      typographie: 'Typo',
      couleur: 'Couleur',
      logo: 'Logo',
      image: 'Image',
      captures: 'iPhone',
    };
    const allFolders = ['all', ...Object.keys(library).filter((k) => k !== '__trash__')];

    allFolders.forEach((f) => {
      const btn = document.createElement('button');
      btn.className = 'lib-folder-chip' + (f === panelFolder ? ' active' : '');
      btn.dataset.folder = f;
      const label = folderLabels[f] || f;
      const count =
        f === 'all'
          ? Object.entries(library)
              .filter(([k]) => k !== '__trash__')
              .reduce((a, [, b]) => a + b.length, 0)
          : (library[f] || []).length;
      btn.textContent = `${label} (${count})`;

      btn.addEventListener('click', () => setPanelFolder(f, btn));
      if (f !== 'all' && f !== 'image' && f !== 'captures' && f !== '__trash__') {
        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          _showLibFolderContextMenu(f, e.clientX, e.clientY);
        });
      }
      btn.addEventListener('dragover', (e) => {
        if (isDraggingFromPanel) {
          e.preventDefault();
          btn.classList.add('drag-over');
        }
      });
      btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
      btn.addEventListener('drop', (e) => {
        btn.classList.remove('drag-over');
        if (!isDraggingFromPanel) return;
        e.preventDefault();
        e.stopPropagation();
        const targetFolder = btn.dataset.folder;
        if (targetFolder === 'all') return;
        // Si aucun item sélectionné, utiliser l'item draggé seul
        const idsToMove =
          libSelectedIds.size > 0
            ? new Set(libSelectedIds)
            : draggedLibItemId
              ? new Set([draggedLibItemId])
              : new Set();
        if (idsToMove.size === 0) return;
        idsToMove.forEach((id) => {
          for (const folder of Object.keys(library)) {
            if (folder === targetFolder) continue;
            const idx = library[folder].findIndex((i) => i.id === id);
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
        saveLibrary();
        renderPanelLib();
      });
      foldersDiv.appendChild(btn);
    });

    const trashCount = (library['__trash__'] || []).length;
    const trashBtn = document.createElement('button');
    trashBtn.className = 'lib-folder-chip' + (panelFolder === '__trash__' ? ' active' : '');
    trashBtn.dataset.folder = '__trash__';
    trashBtn.textContent = `Corbeille (${trashCount})`;
    trashBtn.addEventListener('click', () => setPanelFolder('__trash__', trashBtn));
    foldersDiv.appendChild(trashBtn);

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

    const grid = document.getElementById('lib-panel-grid');
    const empty = document.getElementById('lib-panel-empty');
    grid.innerHTML = '';
    const existingEmptyBtn = document.getElementById('lib-trash-empty-btn');
    if (existingEmptyBtn) existingEmptyBtn.remove();
    if (panelFolder === '__trash__') {
      const trashBar = document.createElement('div');
      trashBar.id = 'lib-trash-empty-btn';
      trashBar.style.cssText = 'display:flex;gap:8px;margin:0 14px 10px;';
      const restoreSelBtn = document.createElement('button');
      restoreSelBtn.textContent = 'Restaurer la sélection';
      restoreSelBtn.style.cssText =
        'flex:1;padding:7px 0;background:rgba(255,255,255,0.08);color:#fff;border:1px solid rgba(255,255,255,0.18);font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;';
      restoreSelBtn.addEventListener('click', () => _restoreSelectedLibItems());
      const emptyBtn = document.createElement('button');
      emptyBtn.textContent = 'Vider la corbeille';
      emptyBtn.style.cssText =
        'flex:1;padding:7px 0;background:#ff3c00;color:#fff;border:none;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;';
      emptyBtn.addEventListener('click', () => {
        library['__trash__'] = [];
        saveLibrary();
        renderPanelLib();
      });
      trashBar.appendChild(restoreSelBtn);
      trashBar.appendChild(emptyBtn);
      grid.parentNode.insertBefore(trashBar, grid);
    }
    let items = [];
    if (panelFolder === 'all') {
      Object.keys(library).forEach((f) => {
        if (f === '__trash__') return;
        items = items.concat(library[f].slice().reverse().map((i) => ({ ...i, folder: f })));
      });
    } else {
      items = (library[panelFolder] || []).slice().reverse().map((i) => ({ ...i, folder: panelFolder }));
    }
    const q = document.getElementById('lib-panel-search').value.toLowerCase();
    if (q) items = items.filter((i) => i.name.toLowerCase().includes(q));

    if (!items.length) {
      grid.style.display = 'none';
      if (panelFolder !== '__trash__') {
        empty.classList.remove('hidden');
      } else {
        empty.classList.add('hidden');
      }
      return;
    }
    grid.style.display = 'grid';
    empty.classList.add('hidden');

    items.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'lib-panel-item';
      div.draggable = true;
      div.dataset.libId = item.id;
      if (libSelectedIds.has(item.id)) div.classList.add('selected-lib-item');

      const img = document.createElement('img');
      img.src = item.src;
      img.alt = escHtml(item.name);
      // GIF : eager pour préserver l'animation (lazy bloque les GIFs)
      img.loading = item.src.startsWith('data:image/gif') ? 'eager' : 'lazy';

      const name = document.createElement('div');
      name.className = 'lib-item-name';
      name.textContent = item.name;

      const delBtn = document.createElement('button');
      delBtn.className = 'lib-item-delete';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deletePanelLibItem(item.id, item.folder);
      });

      // Sélection : clic simple = cet item seul, Ctrl+clic = toggle individuel,
      // Shift+clic = sélection de plage entre l'ancre et l'item cliqué.
      div.addEventListener('click', (e) => {
        // Désélectionner les éléments du board pour éviter qu'un Suppr ultérieur
        // ne les supprime alors que l'intention est sur la bibliothèque.
        deselectAll();
        document.getElementById('lib-panel-search')?.blur();
        if (e.shiftKey && _libLastClickedId) {
          const all = Array.from(document.querySelectorAll('.lib-panel-item'));
          const startIdx = all.findIndex((n) => n.dataset.libId === _libLastClickedId);
          const endIdx = all.findIndex((n) => n.dataset.libId === item.id);
          if (startIdx !== -1 && endIdx !== -1) {
            const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
            libSelectedIds.clear();
            document
              .querySelectorAll('.lib-panel-item.selected-lib-item')
              .forEach((d) => d.classList.remove('selected-lib-item'));
            for (let i = from; i <= to; i++) {
              const id = all[i].dataset.libId;
              libSelectedIds.add(id);
              all[i].classList.add('selected-lib-item');
            }
          }
          return;
        }
        if (e.ctrlKey || e.metaKey) {
          // Ctrl/Cmd+clic : ajouter/retirer cet item sans toucher aux autres
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
          document
            .querySelectorAll('.lib-panel-item.selected-lib-item')
            .forEach((d) => d.classList.remove('selected-lib-item'));
          libSelectedIds.add(item.id);
          div.classList.add('selected-lib-item');
        }
        _libLastClickedId = item.id;
      });

      div.addEventListener('dragstart', (e) => {
        draggedLibItemId = item.id;
        // Drag multiple si plusieurs items sélectionnés et celui-ci en fait partie
        if (libSelectedIds.has(item.id) && libSelectedIds.size > 1) {
          draggedLibItems = [];
          libSelectedIds.forEach((id) => {
            for (const f of Object.keys(library)) {
              const found = library[f].find((i) => i.id === id);
              if (found) {
                draggedLibItems.push(found);
                break;
              }
            }
          });
          e.dataTransfer.setData('text/plain', 'multi-lib');
        } else {
          draggedLibItems = [item];
          e.dataTransfer.setData('text/plain', item.src);
        }
        isDraggingFromPanel = true;
        // Preview custom : suit le curseur, vignette → taille pleine selon zone
        const preview = document.getElementById('drag-custom-preview');
        preview.src = item.src;

        // Taille thumbnail : lire la taille rendue de l'img dans le panel
        const itemImg = div.querySelector('img');
        const thumbRect = itemImg.getBoundingClientRect();
        preview._thumbW = thumbRect.width || 132;
        preview._thumbH = thumbRect.height || 120;

        // Taille pleine : calculer via Image() asynchrone
        preview._fullW = 220;
        preview._fullH = 170;
        const sizeCalc = new Image();
        sizeCalc.onload = () => {
          const wrapEl = document.getElementById('canvas-wrapper');
          const vw = (wrapEl ? wrapEl.clientWidth : window.innerWidth) / (zoomLevel || 1);
          const vh = (wrapEl ? wrapEl.clientHeight : window.innerHeight) / (zoomLevel || 1);
          const maxDim = Math.max(vw, vh) * 0.2;
          let fw = sizeCalc.naturalWidth || 220;
          let fh = sizeCalc.naturalHeight || 170;
          if (fw > maxDim) {
            fh = Math.round((fh * maxDim) / fw);
            fw = Math.round(maxDim);
          }
          if (fh > maxDim) {
            fw = Math.round((fw * maxDim) / fh);
            fh = Math.round(maxDim);
          }
          // Stocker en pixels écran (zoomLevel déjà appliqué) — ne pas appliquer directement
          preview._fullW = Math.round(fw * (zoomLevel || 1));
          preview._fullH = Math.round(fh * (zoomLevel || 1));
        };
        sizeCalc.onerror = () => {
          preview._fullW = 220;
          preview._fullH = 170;
        };
        sizeCalc.src = item.src;

        // Appliquer immédiatement la taille thumbnail (curseur encore sur le panel)
        preview.style.width = preview._thumbW + 'px';
        preview.style.height = preview._thumbH + 'px';
        preview.classList.remove('preview-active-snap');
        preview._inCanvas = false;
        // Listener document pour détection zone canvas vs panel
        const onDocDragOver = (ev) => {
          if (!isDraggingFromPanel) return;
          const p = document.getElementById('drag-custom-preview');
          p.style.left = ev.clientX + 'px';
          p.style.top = ev.clientY + 'px';
          if (p.style.display !== 'block') p.style.display = 'block';

          if (ev.target.closest('#canvas-wrapper')) {
            // ZONE CANVAS : passer en taille pleine + jouer le snap (une seule fois)
            if (!p._inCanvas) {
              const fw = p._fullW || 220;
              const fh = p._fullH || 170;
              p.style.width = fw + 'px';
              p.style.height = fh + 'px';
              p.classList.remove('preview-active-snap');
              void p.offsetWidth; // force reflow pour relancer l'animation CSS
              p.classList.add('preview-active-snap');
              p._inCanvas = true;
            }
          } else {
            // ZONE PANEL ou autre : revenir en taille thumbnail
            if (p._inCanvas) {
              p.style.width = (p._thumbW || 132) + 'px';
              p.style.height = (p._thumbH || 120) + 'px';
              p.classList.remove('preview-active-snap');
              p._inCanvas = false;
            }
          }
        };
        document.addEventListener('dragover', onDocDragOver);

        // Stocker la ref pour cleanup dans dragend
        preview._docDragOver = onDocDragOver;

        // Ghost natif invisible (1×1 transparent) pour masquer le fantôme navigateur
        const emptyImg = document.createElement('img');
        emptyImg.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
        document.body.appendChild(emptyImg);
        e.dataTransfer.setDragImage(emptyImg, 0, 0);
        setTimeout(() => emptyImg.remove(), 0);
      });
      div.addEventListener('dragend', () => {
        isDraggingFromPanel = false;
        draggedLibItemId = null;
        const p = document.getElementById('drag-custom-preview');
        if (p._docDragOver) {
          document.removeEventListener('dragover', p._docDragOver);
          p._docDragOver = null;
        }
        p._inCanvas = false;
        p.classList.remove('preview-active-snap');
        p.style.display = 'none';
      });

      div.appendChild(img);
      div.appendChild(name);
      if (panelFolder === '__trash__') {
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'lib-item-restore';
        restoreBtn.textContent = '↩';
        restoreBtn.title = 'Restaurer';
        restoreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          _restoreLibItem(item.id);
        });
        div.appendChild(restoreBtn);
      }
      div.appendChild(delBtn);
      grid.appendChild(div);
    });
  }

  function setPanelFolder(folder, btn) {
    panelFolder = folder;
    renderPanelLib();
  }

  function searchPanelLib() {
    renderPanelLib();
  }

  function uploadImages() {
    document.getElementById('file-input-images').click();
  }

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
    const targetFolder = panelFolder && panelFolder !== 'all' ? panelFolder : 'image';

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const compressedSrc = await compressImage(ev.target.result);
        const item = {
          id: 'lib_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          name: file.name,
          src: compressedSrc,
        };
        if (!library[targetFolder]) library[targetFolder] = [];
        library[targetFolder].push(item);
        done++;
        saveLibrary();
        renderPanelLib();
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }

  function deletePanelLibItem(id, folder) {
    if (!library[folder]) return;
    const item = library[folder].find((i) => i.id === id);
    if (!item) return;
    library[folder] = library[folder].filter((i) => i.id !== id);
    if (folder !== '__trash__') {
      if (!library['__trash__']) library['__trash__'] = [];
      item._origFolder = folder;
      library['__trash__'].push(item);
    }
    libSelectedIds.delete(id);
    saveLibrary();
    renderPanelLib();
  }

  function _deleteSelectedLibItems() {
    if (!libSelectedIds.size) return;
    const ids = new Set(libSelectedIds);
    const removed = [];
    if (!library['__trash__']) library['__trash__'] = [];
    Object.keys(library).forEach((folder) => {
      if (folder === '__trash__') return;
      const arr = library[folder];
      for (let i = 0; i < arr.length; i++) {
        if (ids.has(arr[i].id)) removed.push({ folder, index: i, item: arr[i] });
      }
      arr.filter((it) => ids.has(it.id)).forEach((it) => { it._origFolder = folder; library['__trash__'].push(it); });
      library[folder] = arr.filter((it) => !ids.has(it.id));
    });
    libSelectedIds.clear();
    _libLastClickedId = null;
    saveLibrary();
    renderPanelLib();
    if (removed.length) {
      pushAction({ type: 'libDelete', before: removed });
      syncDomToDataset();
    }
  }

  function _restoreLibItem(id) {
    const trash = library['__trash__'] || [];
    const item = trash.find((i) => i.id === id);
    if (!item) return;
    const target = item._origFolder || 'image';
    if (!library[target]) library[target] = [];
    library['__trash__'] = trash.filter((i) => i.id !== id);
    delete item._origFolder;
    library[target].push(item);
    libSelectedIds.delete(id);
    saveLibrary();
    renderPanelLib();
  }

  function _restoreSelectedLibItems() {
    if (!libSelectedIds.size) return;
    const ids = new Set(libSelectedIds);
    const trash = library['__trash__'] || [];
    trash.forEach((item) => {
      if (!ids.has(item.id)) return;
      const target = item._origFolder || 'image';
      if (!library[target]) library[target] = [];
      delete item._origFolder;
      library[target].push(item);
    });
    library['__trash__'] = trash.filter((it) => !ids.has(it.id));
    libSelectedIds.clear();
    _libLastClickedId = null;
    saveLibrary();
    renderPanelLib();
  }

  function addNewLibFolder() {
    const name = prompt('Nom de la nouvelle catégorie :');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (Object.keys(library).some((k) => k.toLowerCase() === trimmed.toLowerCase())) {
      toast('Cette catégorie existe déjà.');
      return;
    }
    library[trimmed] = [];
    panelFolder = trimmed;
    saveLibrary();
    renderPanelLib();
  }

  function _showLibFolderContextMenu(folderName, x, y) {
    var old = document.getElementById('lib-folder-context-menu');
    if (old) old.remove();

    var menu = document.createElement('div');
    menu.id = 'lib-folder-context-menu';
    menu.style.cssText =
      'position:fixed;z-index:9999;background:#fff;border-radius:6px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.18);padding:4px 0;min-width:140px;' +
      'left:' +
      x +
      'px;top:' +
      y +
      'px;';

    function makeItem(label, isDanger, onClick) {
      var item = document.createElement('div');
      item.textContent = label;
      item.style.cssText =
        'padding:8px 16px;cursor:pointer;font-size:13px;color:' +
        (isDanger ? '#e53e3e' : '#222') +
        ';';
      item.addEventListener('mouseenter', () => (item.style.background = '#f5f5f5'));
      item.addEventListener('mouseleave', () => (item.style.background = ''));
      item.addEventListener('click', () => {
        menu.remove();
        onClick();
      });
      return item;
    }

    menu.appendChild(
      makeItem('Renommer', false, () => {
        var newName = prompt('Nouveau nom :', folderName);
        if (!newName || !newName.trim()) return;
        var trimmed = newName.trim();
        if (trimmed === folderName) return;
        if (Object.keys(library).some((k) => k.toLowerCase() === trimmed.toLowerCase())) {
          toast('Cette catégorie existe déjà.');
          return;
        }
        var newLib = {};
        Object.keys(library).forEach((k) => {
          newLib[k === folderName ? trimmed : k] = library[k];
        });
        library = newLib;
        if (panelFolder === folderName) panelFolder = trimmed;
        saveLibrary();
        renderPanelLib();
      })
    );

    menu.appendChild(
      makeItem('Supprimer', true, () => {
        delete library[folderName];
        if (panelFolder === folderName) panelFolder = 'all';
        saveLibrary();
        renderPanelLib();
      })
    );

    document.body.appendChild(menu);

    function dismiss(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('mousedown', dismiss);
      }
    }
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  }

  function setupPanelDrop() {
    const panel = document.getElementById('lib-panel-content');
    const overlay = document.getElementById('lib-panel-drop-overlay');
    panel.addEventListener('dragenter', (e) => {
      // N'afficher l'overlay que pour les fichiers venant de l'extérieur (pas du panneau lui-même)
      if (e.dataTransfer.types.includes('Files') && !isDraggingFromPanel)
        overlay.classList.add('show');
    });
    panel.addEventListener('dragleave', (e) => {
      if (!panel.contains(e.relatedTarget)) overlay.classList.remove('show');
    });
    panel.addEventListener('dragover', (e) => {
      // N'accepter le drop que pour les fichiers externes
      if (!isDraggingFromPanel) e.preventDefault();
    });
    panel.addEventListener('drop', (e) => {
      e.preventDefault();
      overlay.classList.remove('show');
      // Ignorer si le drag vient du panneau lui-même (évite la duplication)
      if (isDraggingFromPanel) {
        isDraggingFromPanel = false;
        const _pv = document.getElementById('drag-custom-preview');
        if (_pv._docDragOver) {
          document.removeEventListener('dragover', _pv._docDragOver);
          _pv._docDragOver = null;
        }
        _pv.style.display = 'none';
        _pv._inCanvas = false;
        return;
      }
      const files = Array.from(e.dataTransfer.files).filter(isImageFile);
      if (!files.length) return;
      let done = 0;
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const compressedSrc = await compressImage(ev.target.result);
          const item = {
            id: 'lib_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            name: file.name,
            src: compressedSrc,
          };
          const folder = panelFolder === 'all' ? 'image' : panelFolder;
          if (!library[folder]) library[folder] = [];
          library[folder].push(item);
          if (++done === files.length) {
            saveLibrary();
            renderPanelLib();
          }
        };
        reader.readAsDataURL(file);
      });
    });
  }

  // ── EXPORT ────────────────────────────────────────────────────────────────
  // quality : 1 = Basse, 2 = Moyenne, 3 = Haute
  // Échelles de capture et qualité JPEG correspondantes
  // ── COULEUR CONTRASTE ──────────────────────────────────────────────────────
  function _contrastColor(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.length === 3 ? h[0] + h[0] : h.slice(0, 2), 16);
    const g = parseInt(h.length === 3 ? h[1] + h[1] : h.slice(2, 4), 16);
    const b = parseInt(h.length === 3 ? h[2] + h[2] : h.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? '#000000' : '#ffffff';
  }
  function _syncColorInfo(el, hex) {
    if (!hex || !/^#[0-9A-Fa-f]{3,6}$/.test(hex)) return;
    const elColor = el.querySelector('.el-color');
    if (elColor) elColor.style.backgroundColor = hex;
    const info = el.querySelector('.color-info');
    if (info) info.style.backgroundColor = hex;
    el.style.setProperty('--color-card-contrast', _contrastColor(hex));
  }

  // ── FORMAT PAPIER ─────────────────────────────────────────────────────────
  const _PAPER_FORMATS = {
    A5: { w: 148, h: 210 },
    A4: { w: 210, h: 297 },
    A3: { w: 297, h: 420 },
  };

  function _unitToPx(val, unit) {
    if (unit === 'mm') return val * 3.7795;
    if (unit === 'cm') return val * 37.795;
    return val;
  }
  function _pxToUnit(px, unit) {
    if (unit === 'mm') return Math.round((px / 3.7795) * 10) / 10;
    if (unit === 'cm') return Math.round((px / 37.795) * 100) / 100;
    return Math.round(px);
  }
  function _mmToUnit(mm, unit) {
    if (unit === 'cm') return Math.round((mm / 10) * 100) / 100;
    if (unit === 'px') return Math.round(mm * 3.7795);
    return mm;
  }

  function openPaperFormatPanel() {
    const panel = document.getElementById('paper-format-panel');
    if (!panel) return;
    if (panel.classList.contains('active')) {
      panel.classList.remove('active');
      return;
    }
    panel.classList.add('active');
  }

  function closePaperFormatPanel() {
    const panel = document.getElementById('paper-format-panel');
    if (panel) panel.classList.remove('active');
  }

  function applyPaperFormat(keepOpen = false) {
    const wIn = document.getElementById('pfp-w-input');
    const hIn = document.getElementById('pfp-h-input');
    const unit = document.getElementById('pfp-unit-select').value;
    const wVal = parseFloat(wIn.value);
    const hVal = parseFloat(hIn.value);
    if (!wVal || !hVal || wVal <= 0 || hVal <= 0) {
      toast('Dimensions invalides');
      return;
    }
    const wPx = _unitToPx(wVal, unit);
    const hPx = _unitToPx(hVal, unit);

    let realW_mm, realH_mm;
    if (unit === 'mm') {
      realW_mm = wVal;
      realH_mm = hVal;
    } else if (unit === 'cm') {
      realW_mm = wVal * 10;
      realH_mm = hVal * 10;
    } else {
      realW_mm = wVal / 3.7795;
      realH_mm = hVal / 3.7795;
    }

    const canvasEl = document.getElementById('canvas');
    const els = canvasEl.querySelectorAll('.board-element');
    let cx = 0,
      cy = 0;
    if (els.length) {
      let minL = Infinity,
        minT = Infinity,
        maxR = -Infinity,
        maxB = -Infinity;
      els.forEach((el) => {
        const l = parseFloat(el.style.left) || 0;
        const t = parseFloat(el.style.top) || 0;
        const r = l + (el.offsetWidth || 0);
        const b = t + (el.offsetHeight || 0);
        if (l < minL) minL = l;
        if (t < minT) minT = t;
        if (r > maxR) maxR = r;
        if (b > maxB) maxB = b;
      });
      cx = (minL + maxR) / 2;
      cy = (minT + maxB) / 2;
    }

    _paperFrame = {
      active: true,
      x: cx - wPx / 2,
      y: cy - hPx / 2,
      w: wPx,
      h: hPx,
      realW_mm,
      realH_mm,
    };

    let frame = document.getElementById('paper-frame');
    if (!frame) {
      frame = document.createElement('div');
      frame.id = 'paper-frame';
      const handle = document.createElement('div');
      handle.id = 'paper-frame-handle';
      handle.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>';
      frame.appendChild(handle);
      canvasEl.appendChild(frame);
      _initPaperFrameDrag(handle);
    }
    frame.style.left = _paperFrame.x + 'px';
    frame.style.top = _paperFrame.y + 'px';
    frame.style.width = _paperFrame.w + 'px';
    frame.style.height = _paperFrame.h + 'px';

    const btn = document.getElementById('paper-format-btn');
    if (btn) btn.classList.add('active');
    if (!keepOpen) closePaperFormatPanel();
  }

  function deactivatePaperFormat() {
    _paperFrame = { active: false, x: 0, y: 0, w: 0, h: 0, realW_mm: null, realH_mm: null };
    const frame = document.getElementById('paper-frame');
    if (frame) frame.remove();
    const btn = document.getElementById('paper-format-btn');
    if (btn) btn.classList.remove('active');
    closePaperFormatPanel();
  }

  function _initPaperFrameDrag(handle) {
    let startX, startY, startFX, startFY, dragRaf, pendingX, pendingY;

    function onMove(e) {
      pendingX = startFX + (e.clientX - startX) / zoomLevel;
      pendingY = startFY + (e.clientY - startY) / zoomLevel;
      if (dragRaf) return;
      dragRaf = requestAnimationFrame(() => {
        dragRaf = null;
        _paperFrame.x = pendingX;
        _paperFrame.y = pendingY;
        const frame = document.getElementById('paper-frame');
        if (frame) {
          frame.style.left = _paperFrame.x + 'px';
          frame.style.top = _paperFrame.y + 'px';
        }
      });
    }

    function onUp() {
      cancelAnimationFrame(dragRaf);
      dragRaf = null;
      document.body.classList.remove('pfp-dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      startX = e.clientX;
      startY = e.clientY;
      startFX = _paperFrame.x;
      startFY = _paperFrame.y;
      document.body.classList.add('pfp-dragging');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  const _EXPORT_SCALES = { 1: 1, 2: 2, 3: 3 };
  const _EXPORT_JPEG_Q = { 1: 0.6, 2: 0.82, 3: 0.95 };

  // ── FONCTIONS D'EXPORT MISES À JOUR ──

  function captureBoard(exportScale = 2) {
    return new Promise((resolve, reject) => {
      const canvasEl = document.getElementById('canvas');

      let cropX, cropY, cropW, cropH, margin;

      if (_paperFrame.active) {
        cropX = _paperFrame.x;
        cropY = _paperFrame.y;
        cropW = _paperFrame.w;
        cropH = _paperFrame.h;
        margin = 0;
      } else {
        const els = canvasEl.querySelectorAll('.board-element');
        if (!els.length) {
          reject('Aucun élément sur le board');
          return;
        }
        let minL = Infinity,
          minT = Infinity,
          maxR = -Infinity,
          maxB = -Infinity;
        els.forEach((el) => {
          const l = parseFloat(el.style.left) || 0;
          const t = parseFloat(el.style.top) || 0;
          const r = l + (el.offsetWidth || parseFloat(el.style.width) || 0);
          const b = t + (el.offsetHeight || parseFloat(el.style.height) || 0);
          if (l < minL) minL = l;
          if (t < minT) minT = t;
          if (r > maxR) maxR = r;
          if (b > maxB) maxB = b;
        });
        const contentW = maxR - minL;
        const contentH = maxB - minT;
        // Marge générale (5%) + marge fixe pour les ombres portées (20px)
        margin = Math.round(Math.max(contentW, contentH) * 0.05) + 20;
        cropX = minL - margin;
        cropY = minT - margin;
        cropW = contentW + margin * 2;
        cropH = contentH + margin * 2;
      }

      // Limite canvas Chrome : évite le canvas blanc/vide à haute résolution
      // Chrome refuse silencieusement les canvas > 16 384px ou > 268 M pixels
      const _maxDim = 16384;
      const _maxArea = 268_000_000;
      const _scByDim = _maxDim / Math.max(cropW, cropH);
      const _scByArea = Math.sqrt(_maxArea / (cropW * cropH));
      const safeScale = Math.max(1, Math.floor(Math.min(exportScale, _scByDim, _scByArea)));

      const wrapperBg =
        getComputedStyle(document.getElementById('canvas-wrapper')).backgroundColor || '#f4f4f6';
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

      ghostCanvas.style.width = cropX + cropW + margin + 'px';
      ghostCanvas.style.height = cropY + cropH + margin + 'px';

      ghostCanvas.querySelectorAll('.selected, .multi-selected').forEach((el) => {
        el.classList.remove('selected', 'multi-selected');
      });
      ghostCanvas
        .querySelectorAll('.element-toolbar, .resize-handle, .color-eyedropper, .video-play-hint')
        .forEach((el) => el.remove());
      ghostCanvas.querySelector('#paper-frame')?.remove();

      ghostCanvas.querySelectorAll('video').forEach((vid) => {
        vid.style.backgroundColor = '#111';
      });

      // Bug 1 : connecteurs SVG → remplacés par un <canvas> dessiné via l'API 2D.
      // html2canvas lit les <canvas> par getImageData (zéro sérialisation SVG) → fiable
      // à toutes les échelles. L'approche SVG+viewBox échouait silencieusement car
      // html2canvas génère un <img> depuis XMLSerializer et peut rater le rendu du SVG
      // hors-document.
      ghostCanvas.querySelectorAll('.el-connection').forEach((svgEl) => {
        const line = svgEl.querySelector('line');
        if (!line) return;
        const x1 = parseFloat(line.getAttribute('x1')) || 0;
        const y1 = parseFloat(line.getAttribute('y1')) || 0;
        const x2 = parseFloat(line.getAttribute('x2')) || 0;
        const y2 = parseFloat(line.getAttribute('y2')) || 0;
        const pad = 4;
        const minX = Math.floor(Math.min(x1, x2)) - pad;
        const minY = Math.floor(Math.min(y1, y2)) - pad;
        const w = Math.ceil(Math.abs(x2 - x1)) + pad * 2;
        const h = Math.ceil(Math.abs(y2 - y1)) + pad * 2;
        const c = document.createElement('canvas');
        c.width = Math.max(1, w);
        c.height = Math.max(1, h);
        c.style.position = 'absolute';
        c.style.left = minX + 'px';
        c.style.top = minY + 'px';
        c.style.width = w + 'px';
        c.style.height = h + 'px';
        c.style.pointerEvents = 'none';
        c.style.zIndex = svgEl.style.zIndex || '1';
        const ctx = c.getContext('2d');
        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1 - minX, y1 - minY);
        ctx.lineTo(x2 - minX, y2 - minY);
        ctx.stroke();
        svgEl.parentNode.replaceChild(c, svgEl);
      });

      // Bug 2 : notes grises à faible qualité.
      // Double protection : backgroundColor (longhand) sur le board-element parent
      // + sur el-note. Si el-note (flex container) est mal rendu à scale=1, le
      // board-element blanc transparaît de toute façon. Shorthand `background` évité
      // car parsé de façon inconsistante par certaines versions de html2canvas.
      ghostCanvas.querySelectorAll('.board-element[data-type="note"]').forEach((bel) => {
        bel.style.backgroundColor = '#ffffff';
      });
      ghostCanvas.querySelectorAll('.el-note').forEach((noteWrap) => {
        noteWrap.style.backgroundColor = '#ffffff';
        noteWrap.style.boxShadow = 'none';
        const div = noteWrap.querySelector('.el-note-content');
        if (!div) return;
        div.removeAttribute('contenteditable');
        div.style.overflow = 'hidden';
        div.style.wordBreak = 'break-word';
        div.style.whiteSpace = 'pre-wrap';
      });

      // Bug 3 : cartes fichier — dimensions réelles + contenu scalé proportionnellement.
      // Sur le board, transform:scale(bw/260) scale TOUT (padding, icône, texte).
      // Sans scale dans l'export, il faut reproduire cet effet manuellement.
      ghostCanvas.querySelectorAll('.board-element[data-type="file"]').forEach((bel) => {
        const fw = bel.querySelector('.el-file');
        if (!fw) return;
        const bw = parseFloat(bel.style.width) || 260;
        const bh = parseFloat(bel.style.height) || 76;
        const sc = bw / 260;
        fw.style.transform = 'none';
        fw.style.width = bw + 'px';
        fw.style.height = bh + 'px';
        fw.style.padding = `${Math.round(16 * sc)}px ${Math.round(20 * sc)}px`;
        fw.style.gap = Math.round(14 * sc) + 'px';
        const iconDiv = fw.querySelector('.file-icon');
        if (iconDiv) {
          const sz = Math.round(36 * sc);
          const iconImg = iconDiv.querySelector('img');
          if (iconImg) {
            iconImg.style.width = sz + 'px';
            iconImg.style.height = sz + 'px';
          }
        }
        const fileName = fw.querySelector('.file-name');
        if (fileName) fileName.style.fontSize = Math.round(13 * sc) + 'px';
        const fileSize = fw.querySelector('.file-size');
        if (fileSize) fileSize.style.fontSize = Math.round(11 * sc) + 'px';
      });

      container.appendChild(ghostCanvas);
      document.body.appendChild(container);

      setTimeout(() => {
        html2canvas(container, {
          scale: safeScale,
          useCORS: true,
          allowTaint: true,
          x: 0,
          y: 0,
          width: cropW,
          height: cropH,
          windowWidth: Math.ceil(cropW),
          windowHeight: Math.ceil(cropH),
          scrollX: 0,
          scrollY: 0,
          backgroundColor: wrapperBg,
          logging: false,
        })
          .then((canvas) => {
            container.remove();
            resolve({ canvas, w: cropW, h: cropH });
          })
          .catch((err) => {
            container.remove();
            reject(err);
          });
      }, 150);
    });
  }

  function exportPNG(quality = 2) {
    if (typeof html2canvas === 'undefined') {
      toast('html2canvas non chargé');
      return;
    }
    const scale = _EXPORT_SCALES[quality] || 2;
    const labels = { 1: 'Basse', 2: 'Moyenne', 3: 'Haute' };

    captureBoard(scale)
      .then(({ canvas }) => {
        const dataUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        const b = boards.find((b) => b.id === currentBoardId);
        a.download = (b ? b.name : 'moodboard') + '.png';
        a.href = dataUrl;
        a.click();
      })
      .catch(() => {});
  }

  function exportPDF(quality = 2) {
    if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
      toast('Librairies PDF non chargées');
      return;
    }
    const scale = _EXPORT_SCALES[quality] || 2;
    const jpegQ = _EXPORT_JPEG_Q[quality] || 0.82;
    const labels = { 1: 'Basse', 2: 'Moyenne', 3: 'Haute' };

    captureBoard(scale)
      .then(({ canvas, w, h }) => {
        const dataUrl = canvas.toDataURL('image/jpeg', jpegQ);
        const { jsPDF } = window.jspdf;
        let pdf;
        if (_paperFrame.active && _paperFrame.realW_mm != null) {
          const rw = _paperFrame.realW_mm;
          const rh = _paperFrame.realH_mm;
          pdf = new jsPDF({
            orientation: rw > rh ? 'landscape' : 'portrait',
            unit: 'mm',
            format: [rw, rh],
          });
          pdf.addImage(dataUrl, 'JPEG', 0, 0, rw, rh);
        } else {
          // unit:'px' est limité à 14 400 par jsPDF → on passe en mm (limite = 14 400 mm ≈ 14 m)
          const PX_TO_MM = 25.4 / 96;
          const wMm = w * PX_TO_MM;
          const hMm = h * PX_TO_MM;
          pdf = new jsPDF({
            orientation: w > h ? 'landscape' : 'portrait',
            unit: 'mm',
            format: [wMm, hMm],
          });
          pdf.addImage(dataUrl, 'JPEG', 0, 0, wMm, hMm);
        }
        const board = boards.find((b) => b.id === currentBoardId);
        pdf.save((board ? board.name : 'moodboard') + '.pdf');
      })
      .catch(() => {});
  }

  // ── MODALES ───────────────────────────────────────────────────────────────
  function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
  }
  function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
  }
  function closeAllModals() {
    ['link-modal', 'rename-modal', 'create-board-modal', 'join-board-modal'].forEach(closeModal);
  }
  // ── CUSTOM CURSOR ─────────────────────────────────────────────────────────
  function _applyCustomCursor() {
    const svg =
      "%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 48 48'%3E%3Cpolygon fill='%23fff' points='9.33 6.2 36.21 29.13 20.7 30.84 9.33 41.53 9.33 6.2'/%3E%3Cpath fill='%23ff3c00' d='M11.83,11.62l18.36,15.66-8.93.99-1.66.18-1.22,1.14-6.56,6.16V11.62M7.59,1.68c-.13,0-.26.03-.35.08-.2.1-.41.36-.41.66v43.1c0,.36.19.62.45.74.09.04.2.07.31.07.17,0,.34-.05.48-.18l13.74-12.9,18.66-2.07c.36-.06.59-.25.68-.55.08-.25-.02-.58-.28-.81L8.07,1.85c-.14-.12-.31-.16-.48-.16h0Z'/%3E%3C/svg%3E";
    document.body.style.cursor = `url("data:image/svg+xml,${svg}") 3 1, default`;
  }

  // ── EDIT BOARD MODAL ──────────────────────────────────────────────────────
  function _setupEditBoardModalButtons() {
    const closeBtn = document.getElementById('edit-board-close-btn');
    if (!closeBtn || closeBtn._ebBtnsReady) return;
    closeBtn._ebBtnsReady = true;

    // Pas de onclick= dans le HTML → CSP extension
    closeBtn.addEventListener('click', closeEditBoardModal);
    document.getElementById('edit-board-save-btn').addEventListener('click', confirmEditBoard);
  }

  let _editBoardId = null;
  let _editImg = { src: null, naturalW: 0, naturalH: 0, scale: 1, offsetX: 0, offsetY: 0 };
  let _editDrag = null;

  // openEditBoardModal (modale complète nom + couverture) retirée : plus aucun point
  // d'entrée depuis que le menu clic-droit a été remplacé par le panneau d'infos.
  // La modale elle-même reste utilisée par openImagePickerForBoard (recadrage couverture).

  function closeEditBoardModal() {
    closeModal('edit-board-modal');
    _editBoardId = null;
    document.getElementById('edit-board-name-section').style.display = '';
    document.getElementById('edit-board-cover-section').style.display = '';
  }

  function openImagePickerForBoard(id) {
    _editBoardId = id;
    const b = boards.find((b) => b.id === id);
    if (!b) return;
    _editImg = { src: null, naturalW: 0, naturalH: 0, scale: 1, offsetX: 0, offsetY: 0 };

    const tmpInput = document.createElement('input');
    tmpInput.type = 'file';
    tmpInput.accept = '.jpg,.jpeg,.png,.webp';
    tmpInput.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(tmpInput);

    tmpInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      document.body.removeChild(tmpInput);
      if (!file) return;

      document.getElementById('edit-board-name').value = b.name || '';
      document.getElementById('edit-board-editor').style.display = 'none';
      document.getElementById('edit-board-zoom').value = 1;
      document.getElementById('edit-board-name-section').style.display = 'none';
      document.getElementById('edit-board-cover-section').style.display = 'none';

      openModal('edit-board-modal');
      _setupEditBoardImageEditor();

      const reader = new FileReader();
      reader.onload = (ev) => _loadEditBoardImage(ev.target.result);
      reader.readAsDataURL(file);
    });

    tmpInput.click();
  }

  function confirmEditBoard() {
    if (!_editBoardId) return;
    const b = boards.find((b) => b.id === _editBoardId);
    if (!b) return;

    const name = document.getElementById('edit-board-name').value.trim();
    if (name) b.name = name;

    if (_editImg.src) {
      b.coverImage = _exportEditBoardCrop();
      if (window._fbDb && _editBoardId) {
        window._fbDb
          .ref('boards/' + _editBoardId + '/coverImage')
          .set(b.coverImage)
          .catch(() => {});
      }
    }

    saveBoards();
    renderBoardsWheel();
    closeEditBoardModal();
  }


  function _loadEditBoardImage(src) {
    const img = document.getElementById('edit-board-img');
    const preview = document.getElementById('edit-board-preview');
    const editor = document.getElementById('edit-board-editor');

    // Afficher l'éditeur d'abord pour que offsetWidth soit correct
    editor.style.display = 'flex';

    const tmp = new Image();
    tmp.onload = () => {
      _editImg.src = src;
      _editImg.naturalW = tmp.naturalWidth;
      _editImg.naturalH = tmp.naturalHeight;

      // Scale initial : couvrir entièrement le cadre paysage 500:340
      const pw = preview.offsetWidth || 280;
      const ph = pw * (340 / 500);
      const coverScale = Math.max(pw / tmp.naturalWidth, ph / tmp.naturalHeight);
      _editImg.scale = coverScale;
      _editImg.offsetX = 0;
      _editImg.offsetY = 0;

      document.getElementById('edit-board-zoom').min = coverScale;
      document.getElementById('edit-board-zoom').max = coverScale * 3;
      document.getElementById('edit-board-zoom').step = coverScale * 0.005;
      document.getElementById('edit-board-zoom').value = coverScale;

      img.src = src;
      _applyEditBoardTransform();
    };
    tmp.src = src;
  }

  function _applyEditBoardTransform() {
    const img = document.getElementById('edit-board-img');
    const preview = document.getElementById('edit-board-preview');
    const pw = preview.offsetWidth;
    const ph = pw * (340 / 500);

    const iw = _editImg.naturalW * _editImg.scale;
    const ih = _editImg.naturalH * _editImg.scale;

    // Clamper offsetX/Y pour ne pas laisser de vide dans le cadre
    const maxOX = (iw - pw) / 2;
    const maxOY = (ih - ph) / 2;
    _editImg.offsetX = Math.max(-maxOX, Math.min(maxOX, _editImg.offsetX));
    _editImg.offsetY = Math.max(-maxOY, Math.min(maxOY, _editImg.offsetY));

    img.style.width = iw + 'px';
    img.style.height = ih + 'px';
    img.style.left = pw / 2 - iw / 2 + _editImg.offsetX + 'px';
    img.style.top = ph / 2 - ih / 2 + _editImg.offsetY + 'px';
  }

  function _setupEditBoardImageEditor() {
    const preview = document.getElementById('edit-board-preview');
    const zoom = document.getElementById('edit-board-zoom');
    if (preview._ebEditorReady) return;
    preview._ebEditorReady = true;

    // Drag
    preview.addEventListener('mousedown', (e) => {
      if (!_editImg.src) return;
      e.preventDefault();
      preview.classList.add('dragging');
      _editDrag = { startX: e.clientX - _editImg.offsetX, startY: e.clientY - _editImg.offsetY };

      function onMove(ev) {
        _editImg.offsetX = ev.clientX - _editDrag.startX;
        _editImg.offsetY = ev.clientY - _editDrag.startY;
        _applyEditBoardTransform();
      }
      function onUp() {
        preview.classList.remove('dragging');
        _editDrag = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    // Zoom slider
    zoom.addEventListener('input', () => {
      _editImg.scale = parseFloat(zoom.value);
      _applyEditBoardTransform();
    });
  }

  function _exportEditBoardCrop() {
    const preview = document.getElementById('edit-board-preview');
    const pw = preview.offsetWidth;

    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 680;
    const ctx = canvas.getContext('2d');

    const scaleToCanvas = 1000 / pw;
    const iw = _editImg.naturalW * _editImg.scale * scaleToCanvas;
    const ih = _editImg.naturalH * _editImg.scale * scaleToCanvas;
    const dx = 1000 / 2 - iw / 2 + _editImg.offsetX * scaleToCanvas;
    const dy = 680 / 2 - ih / 2 + _editImg.offsetY * scaleToCanvas;

    const img = new Image();
    img.src = _editImg.src;
    ctx.drawImage(img, dx, dy, iw, ih);
    return canvas.toDataURL('image/jpeg', 0.82);
  }

  // ── TOAST ─────────────────────────────────────────────────────────────────
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    // Effacer le zoom-toast s'il est visible
    const zt = document.getElementById('zoom-toast');
    if (zt) {
      zt.classList.remove('show');
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ── UTILITAIRES ───────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function tryParse(s) {
    try {
      return JSON.parse(s || '{}');
    } catch (e) {
      return {};
    }
  }

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

  // ── COLLAB HELPERS ─────────────────────────────────────────────────────
  function _collabSyncStyle() {
    if (typeof Collab === 'undefined' || !Collab.isActive() || !textEditTarget) return;
    var ta = textEditTarget.querySelector('.el-note-content') || textEditTarget;
    if (!ta) return;
    var styleObj = {
      fontFamily: ta.style.fontFamily || '',
      fontWeight: ta.style.fontWeight || '',
      fontSize: ta.style.fontSize || '',
      textAlign: ta.style.textAlign || '',
    };
    // Si c'est une caption (a un data-cap-id), sync via syncCaptionStyle
    if (textEditTarget.classList.contains('el-caption') && textEditTarget.dataset.capId) {
      Collab.syncCaptionStyle(textEditTarget.dataset.capId, styleObj);
    } else if (textEditTarget.dataset.id) {
      // C'est un board-element (note)
      Collab.syncElementStyle(textEditTarget.dataset.id, styleObj);
    }
  }

  /** Sync un élément nouvellement créé vers Firebase */
  function _collabSyncCreatedEl(el) {
    if (typeof Collab === 'undefined' || !Collab.isActive()) return;
    if (!el || !el.dataset || !el.dataset.id) return;
    var elId = el.dataset.id;
    var elType = el.dataset.type;
    var elData;
    if (elType === 'image') {
      elData = _imgStore.get(elId) || 'pending';
    } else {
      elData = el.dataset.savedata || '';
    }
    var elStyle = null;
    if (elType === 'note') {
      var ta = el.querySelector('.el-note-content');
      if (ta)
        elStyle = {
          fontFamily: ta.style.fontFamily || '',
          fontWeight: ta.style.fontWeight || '',
          fontSize: ta.style.fontSize || '',
          textAlign: ta.style.textAlign || '',
        };
    }
    Collab.syncElementCreate(
      elId,
      elType,
      parseFloat(el.style.left) || 0,
      parseFloat(el.style.top) || 0,
      parseFloat(el.style.width) || null,
      parseFloat(el.style.height) || null,
      elData,
      parseInt(el.style.zIndex) || 100,
      elStyle
    );
  }

  // ── COLLAB BRIDGE ──────────────────────────────────────────────────────
  // Fonctions internes exposées pour collab.js (préfixées _collab)
  function _collabGetZoom() {
    return zoomLevel;
  }
  function _collabGetPanX() {
    return panX;
  }
  function _collabGetPanY() {
    return panY;
  }
  function _collabRestoreElement(s) {
    return restoreElement(s);
  }
  function _collabUpdateConnections(el) {
    updateConnectionsForEl(el);
  }
  function _collabRemoveConnectionsForEl(el) {
    removeConnectionsForEl(el);
  }
  function _collabRemoveCaptionsForEl(el) {
    removeCaptionsForEl(el);
  }
  function _collabCreateConnection(from, to, connId) {
    createConnection(from, to, connId);
  }
  function _imgStoreGet(elId) {
    return _imgStore.get(elId);
  }
  function _imgStoreSet(elId, data) {
    _imgStore.set(elId, data);
  }
  function _collabDeleteImgStore(elId) {
    _imgStore.delete(elId);
  }
  function _collabMergeElements(boardId, elements) {
    const board = boards.find((b) => b.id === boardId);
    if (board) {
      board.elements = elements;
      board.savedAt = Date.now();
      saveBoards();
      if (window._fbDb) {
        // Comme saveCurrentBoard et _syncBoardElements : on écrit l'URL Storage de
        // l'image, jamais son base64, sinon l'écriture Firebase est trop grosse.
        const fbElements = board.elements.map((el) =>
          el.type === 'image'
            ? Object.assign({}, el, { data: el.storageUrl || '', origData: '' })
            : el
        );
        const payload = { name: board.name, elements: fbElements, savedAt: board.savedAt };
        if (board.thumbnail) payload.thumbnail = board.thumbnail;
        // update() et pas set() : set() écraserait les enfants frères activity/ et snapshotUrl
        window._fbDb
          .ref('boards/' + boardId)
          .update(payload)
          .catch(() => {});
      }
    }
  }
  function _collabGetBoardElements() {
    const elements = [];
    document.querySelectorAll('#canvas .board-element').forEach((el) => {
      const _elStyle = (() => {
        if (el.dataset.type !== 'note') return null;
        const ta = el.querySelector('.el-note-content');
        if (!ta) return null;
        return {
          fontFamily: ta.style.fontFamily || '',
          fontWeight: ta.style.fontWeight || '',
          fontSize: ta.style.fontSize || '',
          textAlign: ta.style.textAlign || '',
        };
      })();
      elements.push({
        id: el.dataset.id,
        type: el.dataset.type,
        x: parseFloat(el.style.left) || 0,
        y: parseFloat(el.style.top) || 0,
        w: parseFloat(el.style.width) || null,
        h: parseFloat(el.style.height) || null,
        z: parseInt(el.style.zIndex) || 100,
        data:
          el.dataset.type === 'image'
            ? _imgStore.get(el.dataset.id) || el.dataset.savedata || ''
            : el.dataset.savedata || '',
        style: _elStyle,
      });
    });
    document.querySelectorAll('#canvas .el-connection').forEach((svg) => {
      elements.push({
        type: 'connection',
        from: svg.dataset.from,
        to: svg.dataset.to,
        connId: svg.dataset.connId,
      });
    });
    document.querySelectorAll('#canvas .el-caption').forEach((cap) => {
      elements.push({
        type: 'caption',
        capId: cap.dataset.capId || '',
        x: parseFloat(cap.style.left) || 0,
        y: parseFloat(cap.style.top) || 0,
        width: cap.style.width,
        parentId: cap.dataset.parentId || '',
        text: cap.textContent || '',
        style: {
          fontFamily: cap.style.fontFamily || '',
          fontWeight: cap.style.fontWeight || '',
          fontSize: cap.style.fontSize || '',
          textAlign: cap.style.textAlign || '',
        },
      });
    });
    return elements;
  }

  function updateBoardThumbnail(boardId, thumb) {
    if (!thumb || !boardId) return;
    const board = boards.find((b) => b.id === boardId);
    if (!board || board.snapshot === thumb) return;
    board.snapshot = thumb;
    saveBoards();
    const card = document.querySelector('.wheel-card[data-id="' + boardId + '"]');
    if (card) {
      const displaySrc = board.coverImage || thumb;
      let img = card.querySelector('.wheel-thumb');
      if (!img) {
        img = document.createElement('img');
        img.className = 'wheel-thumb';
        img.alt = '';
        card.innerHTML = '';
        card.appendChild(img);
      }
      img.src = displaySrc;
    }
  }

  // ── API PUBLIQUE ──────────────────────────────────────────────────────────
  return {
    init,
    goHome,
    openBoard,
    addBoard,
    deleteBoard,
    renameBoardPrompt,
    confirmRename,
    closeRenameModal,
    zoomIn,
    zoomOut,
    resetZoom,
    fitToScreen,
    addNote,
    addFile,
    addColorDirect,
    openLinkModal,
    closeLinkModal,
    addLinkElement,
    toggleLibPanel,
    renderPanelLib,
    setPanelFolder,
    searchPanelLib,
    uploadImages,
    handleImageUpload,
    deletePanelLibItem,
    addNewLibFolder,
    handleFileUpload,
    deleteSelected,
    clearBoard,
    undo,
    duplicateEl,
    removeEl,
    ctxDuplicate,
    ctxDelete,
    ctxCopyImage,
    ctxDownloadImage,
    ctxReplaceImage,
    ctxConnect,
    ctxAddCaption,
    exportPNG,
    exportPDF,
    deactivatePaperFormat,
    closeEditBoardModal,
    confirmEditBoard,
    openVideoLightbox,
    closeVideoLightbox,
    fitElementsToScreen,
    togglePreviewMode,
    applyTextFont,
    applyTextSize: applyTextSizeDelta,
    applyTextSizeDelta,
    applyTextAlign,
    createBoard,
    closeCreateBoardModal,
    confirmCreateBoard,
    joinBoardById,
    toolDragStart,
    toast,
    syncLibraryFromStorage,
    // Collab bridge (utilisé par collab.js)
    _collabGetZoom,
    _collabGetPanX,
    _collabGetPanY,
    _collabRestoreElement,
    _collabUpdateConnections,
    _collabRemoveConnectionsForEl,
    _collabRemoveCaptionsForEl,
    _collabCreateConnection,
    _imgStoreGet,
    _imgStoreSet,
    _collabDeleteImgStore,
    _collabMergeElements,
    updateBoardThumbnail,
    _collabGetBoardElements,
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

// ── EXTENSION MOODBOARD : Écoute des messages du background ──────────────────
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'MB_IMAGE_INJECTED') {
      if (typeof App !== 'undefined' && typeof App.syncLibraryFromStorage === 'function') {
        App.syncLibraryFromStorage();
        App.toast('Image ajoutée au Moodboard !');
      }
    }
  });
}
