/**
 * collab.js — Module de collaboration temps réel (Figma-like)
 * Dépend de : firebase-app-compat.js, firebase-database-compat.js, firebase-init.js, app.js
 * Exposé comme window.Collab (IIFE)
 */
window.Collab = (function () {
  'use strict';

  // ── ÉTAT INTERNE ────────────────────────────────────────────────────────
  let _active = false;
  let _isOwner = false;
  let _sessionRef = null; // firebase ref: collabSessions/{boardId}
  let _userId = null;
  let _userColor = null;
  let _boardId = null;
  let _listeners = []; // {ref, event, cb} pour cleanup
  let _lockCache = {}; // elId -> userId (miroir local)
  let _elementVersions = {}; // elId -> version
  let _remoteCursors = {}; // userId -> {el, targetX, targetY, curX, curY, color, visible}
  let _remoteSelections = {}; // userId -> {elIds:[], color}
  let _remoteSelRects = {}; // userId -> DOM element
  let _cursorSendTimer = null;
  let _lastSentCursor = { x: 0, y: 0, t: 0 };
  let _cursorRAFId = null;
  let _remoteLerpTargets = {}; // elId -> {x, y}
  let _remoteLerpRAFRunning = false;
  let _pendingLocks = {}; // elId -> Promise resolve
  let _userCount = 0;

  // Palette de couleurs Figma-like (8 couleurs distinctes)
  const COLORS = ['#ff3c00'];

  const CURSOR_SEND_INTERVAL = 66; // ~15 Hz
  const DRAG_SYNC_INTERVAL = 66; // ~15 Hz
  const TEXT_SYNC_DEBOUNCE = 300; // ms

  // ── UTILITAIRES ─────────────────────────────────────────────────────────

  function _lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function _hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  function _genUUID() {
    return 'u_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
  }

  /** Enregistre un listener Firebase et le stocke pour cleanup */
  function _listen(ref, event, cb) {
    ref.on(event, cb);
    _listeners.push({ ref, event, cb });
  }

  /** Crée un throttle simple (dernière valeur gagne) */
  function _makeThrottle(fn, ms) {
    let timer = null;
    let lastArgs = null;
    return function () {
      lastArgs = arguments;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        fn.apply(null, lastArgs);
      }, ms);
    };
  }

  /** Crée un debounce simple */
  function _makeDebounce(fn, ms) {
    let timer = null;
    return function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  // ── LIFECYCLE ───────────────────────────────────────────────────────────

  /**
   * Démarre une session collaborative.
   * @param {string} boardId - ID du board
   * @param {boolean} isOwner - true si l'utilisateur est le propriétaire
   * @param {object} opts - { elements: [...], boardName: string }
   */
  async function startSession(boardId, isOwner, opts) {
    if (!window._fbDb) {
      App.toast('Firebase non disponible');
      return false;
    }
    if (window._fbAuthReady) {
      await window._fbAuthReady;
    }
    if (_active) endSession();

    _boardId = boardId;
    _isOwner = isOwner;
    _userId = _genUUID();
    _active = true;
    _sessionRef = window._fbDb.ref('collabSessions/' + boardId);

    try {
      // Choisir couleur en vérifiant celles déjà prises
      const presenceSnap = await _sessionRef.child('presence').get();
      const usedColors = new Set();
      if (presenceSnap.exists()) {
        presenceSnap.forEach((child) => {
          const c = child.val().color;
          if (c) usedColors.add(c);
        });
      }
      _userColor =
        COLORS.find((c) => !usedColors.has(c)) || COLORS[_hashStr(_userId) % COLORS.length];

      // Écrire la présence
      const presenceRef = _sessionRef.child('presence/' + _userId);
      await presenceRef.set({
        color: _userColor,
        cursor: { x: 0, y: 0, visible: false },
        selection: [],
        selectionRect: { x: 0, y: 0, w: 0, h: 0, active: false },
        timestamp: firebase.database.ServerValue.TIMESTAMP,
      });
      presenceRef.onDisconnect().remove();

      if (isOwner) {
        await _sessionRef.child('meta').set({
          ownerId: _userId,
          createdAt: firebase.database.ServerValue.TIMESTAMP,
          active: true,
          maxZ: 100,
        });
        if (opts && opts.elements) {
          const updates = {};
          opts.elements.forEach((el) => {
            if (el.type === 'connection') {
              updates['connections/' + el.connId] = { from: el.from, to: el.to };
            } else if (el.type === 'caption') {
              const capId = 'cap_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
              updates['captions/' + capId] = {
                parentId: el.parentId || '',
                x: el.x,
                y: el.y,
                width: el.width || '',
                text: el.text || '',
              };
            } else {
              updates['elements/' + el.id] = {
                x: el.x,
                y: el.y,
                w: el.w || null,
                h: el.h || null,
                z: el.z || 100,
                type: el.type,
                data: el.type === 'image' ? 'pending' : el.data || '',
                version: 0,
                lastEditBy: _userId,
                lastEditAt: firebase.database.ServerValue.TIMESTAMP,
                deleted: false,
              };
            }
          });
          if (Object.keys(updates).length) {
            await _sessionRef.update(updates);
          }
        }
      }
    } catch (e) {
      // Nettoyage propre en cas d'échec Firebase
      _active = false;
      _isOwner = false;
      _sessionRef = null;
      _userId = null;
      App.toast('Erreur Firebase : ' + (e.code || e.message || 'connexion impossible'));
      return false;
    }

    // Attacher les listeners Firebase — seulement si tout a réussi
    _attachListeners();
    document.addEventListener('fb-connection', _onConnectionChange);
    window.addEventListener('blur', _onWindowBlur);
    window.addEventListener('focus', _onWindowFocus);
    _updateStatusBar();
    return true;
  }

  function endSession() {
    if (!_active) return;

    // Libérer tous les locks
    releaseAllMyLocks();

    // Supprimer la présence
    if (_sessionRef && _userId) {
      _sessionRef.child('presence/' + _userId).remove();
    }

    // Si owner: merger les données dans le board local et désactiver la session
    if (_isOwner && _sessionRef) {
      _sessionRef.child('meta/active').set(false);
      _mergeSessionToLocal();
    }

    // Détacher tous les listeners Firebase
    _listeners.forEach((l) => l.ref.off(l.event, l.cb));
    _listeners = [];

    // Nettoyer les curseurs distants du DOM
    Object.keys(_remoteCursors).forEach((uid) => {
      if (_remoteCursors[uid].el && _remoteCursors[uid].el.parentNode) {
        _remoteCursors[uid].el.remove();
      }
    });

    // Nettoyer les rectangles de sélection distants
    Object.keys(_remoteSelRects).forEach((uid) => {
      if (_remoteSelRects[uid] && _remoteSelRects[uid].parentNode) {
        _remoteSelRects[uid].remove();
      }
    });

    // Nettoyer les sélections distantes (classes CSS sur les éléments)
    _clearAllRemoteSelections();

    // Arrêter le RAF des curseurs
    if (_cursorRAFId) cancelAnimationFrame(_cursorRAFId);
    if (_remoteLerpRAFRunning) _remoteLerpRAFRunning = false;
    clearTimeout(_cursorSendTimer);

    // Retirer les listeners window
    document.removeEventListener('fb-connection', _onConnectionChange);
    window.removeEventListener('blur', _onWindowBlur);
    window.removeEventListener('focus', _onWindowFocus);

    // Reset state
    _active = false;
    _isOwner = false;
    _sessionRef = null;
    _userId = null;
    _userColor = null;
    _boardId = null;
    _lockCache = {};
    _elementVersions = {};
    _remoteCursors = {};
    _remoteSelections = {};
    _remoteSelRects = {};
    _remoteLerpTargets = {};
    _pendingLocks = {};
    _userCount = 0;

    _hideStatusBar();
  }

  // ── PRÉSENCE ────────────────────────────────────────────────────────────

  /** Envoie la position du curseur (throttled à ~15Hz) */
  function sendCursor(canvasX, canvasY) {
    if (!_active || !_sessionRef) return;
    const now = Date.now();
    if (now - _lastSentCursor.t < CURSOR_SEND_INTERVAL) return;
    _lastSentCursor = { x: canvasX, y: canvasY, t: now };
    _sessionRef.child('presence/' + _userId + '/cursor').update({
      x: canvasX,
      y: canvasY,
      visible: true,
    });
  }

  function hideCursor() {
    if (!_active || !_sessionRef) return;
    _sessionRef.child('presence/' + _userId + '/cursor/visible').set(false);
  }

  function _onWindowBlur() {
    hideCursor();
  }

  function _onWindowFocus() {
    if (!_active || !_sessionRef) return;
    _sessionRef.child('presence/' + _userId + '/cursor/visible').set(true);
  }

  function sendSelection(elementIds) {
    if (!_active || !_sessionRef) return;
    _sessionRef.child('presence/' + _userId + '/selection').set(elementIds || []);
  }

  function sendSelectionRect(x, y, w, h) {
    if (!_active || !_sessionRef) return;
    _sessionRef.child('presence/' + _userId + '/selectionRect').set({
      x: x,
      y: y,
      w: w,
      h: h,
      active: true,
    });
  }

  function clearSelectionRect() {
    if (!_active || !_sessionRef) return;
    _sessionRef.child('presence/' + _userId + '/selectionRect/active').set(false);
  }

  // ── LOCKS ───────────────────────────────────────────────────────────────

  /**
   * Tente d'acquérir un lock sur un élément via transaction Firebase.
   * @returns {Promise<boolean>} true si le lock a été acquis
   */
  function acquireLock(elementId) {
    if (!_active || !_sessionRef) return Promise.resolve(false);
    // Déjà locké par nous
    if (_lockCache[elementId] === _userId) return Promise.resolve(true);

    const lockRef = _sessionRef.child('locks/' + elementId);
    return lockRef
      .transaction((current) => {
        if (current === null) {
          return { userId: _userId, timestamp: firebase.database.ServerValue.TIMESTAMP };
        }
        if (current.userId === _userId) return current;
        return; // abort — quelqu'un d'autre a le lock
      })
      .then((result) => {
        if (result.committed) {
          lockRef.onDisconnect().remove();
          _lockCache[elementId] = _userId;
          return true;
        }
        return false;
      })
      .catch(() => false);
  }

  function releaseLock(elementId) {
    if (!_active || !_sessionRef) return;
    if (_lockCache[elementId] !== _userId) return;
    _sessionRef.child('locks/' + elementId).remove();
    _sessionRef
      .child('locks/' + elementId)
      .onDisconnect()
      .cancel();
    delete _lockCache[elementId];
  }

  function releaseAllMyLocks() {
    if (!_sessionRef) return;
    Object.keys(_lockCache).forEach((elId) => {
      if (_lockCache[elId] === _userId) {
        _sessionRef.child('locks/' + elId).remove();
        _sessionRef
          .child('locks/' + elId)
          .onDisconnect()
          .cancel();
      }
    });
    _lockCache = {};
  }

  /**
   * Vérifie (synchrone, depuis le cache local) si un élément est locké par un autre.
   * @returns {false|string} false si libre ou locké par nous, sinon userId du lockeur
   */
  function isLockedByOther(elementId) {
    const owner = _lockCache[elementId];
    if (!owner || owner === _userId) return false;
    return owner;
  }

  /** Retourne le userId qui locke un élément (ou null) */
  function getLockOwner(elementId) {
    return _lockCache[elementId] || null;
  }

  // ── SYNC ÉLÉMENTS ──────────────────────────────────────────────────────

  const _throttledPositionSync = {};

  function syncElementPosition(elId, x, y, isFinal) {
    if (!_active || !_sessionRef) return;
    if (isFinal) {
      // Écriture finale avec incrémentation de version
      const ref = _sessionRef.child('elements/' + elId);
      ref.transaction((current) => {
        if (!current || current.deleted) return current;
        current.x = x;
        current.y = y;
        current.version = (current.version || 0) + 1;
        current.lastEditBy = _userId;
        current.lastEditAt = Date.now();
        return current;
      });
      delete _throttledPositionSync[elId];
    } else {
      // Sync throttlée pendant le drag (sans version++)
      if (!_throttledPositionSync[elId]) {
        _throttledPositionSync[elId] = _makeThrottle((id, px, py) => {
          _sessionRef.child('elements/' + id).update({
            x: px,
            y: py,
            lastEditBy: _userId,
          });
        }, DRAG_SYNC_INTERVAL);
      }
      _throttledPositionSync[elId](elId, x, y);
    }
  }

  function syncElementSize(elId, w, h, isFinal) {
    if (!_active || !_sessionRef) return;
    if (isFinal) {
      const ref = _sessionRef.child('elements/' + elId);
      ref.transaction((current) => {
        if (!current || current.deleted) return current;
        current.w = w;
        current.h = h;
        current.version = (current.version || 0) + 1;
        current.lastEditBy = _userId;
        current.lastEditAt = Date.now();
        return current;
      });
    } else {
      _sessionRef.child('elements/' + elId).update({
        w: w,
        h: h,
        lastEditBy: _userId,
      });
    }
  }

  const _debouncedDataSync = {};

  function syncElementData(elId, data) {
    if (!_active || !_sessionRef) return;
    if (!_debouncedDataSync[elId]) {
      _debouncedDataSync[elId] = _makeDebounce((id, d) => {
        const ref = _sessionRef.child('elements/' + id);
        ref.transaction((current) => {
          if (!current || current.deleted) return current;
          current.data = d;
          current.version = (current.version || 0) + 1;
          current.lastEditBy = _userId;
          current.lastEditAt = Date.now();
          return current;
        });
      }, TEXT_SYNC_DEBOUNCE);
    }
    _debouncedDataSync[elId](elId, data);
  }

  function syncElementCreate(elId, type, x, y, w, h, data, z) {
    if (!_active || !_sessionRef) return;
    _sessionRef.child('elements/' + elId).set({
      x: x,
      y: y,
      w: w || null,
      h: h || null,
      z: z || 100,
      type: type,
      data: type === 'image' ? 'pending' : data || '',
      version: 0,
      lastEditBy: _userId,
      lastEditAt: firebase.database.ServerValue.TIMESTAMP,
      deleted: false,
    });
  }

  function syncElementDelete(elId) {
    if (!_active || !_sessionRef) return;
    _sessionRef.child('elements/' + elId).update({
      deleted: true,
      lastEditBy: _userId,
      lastEditAt: firebase.database.ServerValue.TIMESTAMP,
    });
    // Libérer le lock si on l'avait
    if (_lockCache[elId] === _userId) releaseLock(elId);
  }

  function syncElementZ(elId, z) {
    if (!_active || !_sessionRef) return;
    _sessionRef.child('elements/' + elId + '/z').set(z);
  }

  function syncConnection(connId, fromId, toId) {
    if (!_active || !_sessionRef) return;
    _sessionRef.child('connections/' + connId).set({ from: fromId, to: toId });
  }

  function syncConnectionDelete(connId) {
    if (!_active || !_sessionRef) return;
    _sessionRef.child('connections/' + connId).remove();
  }

  function syncCaption(captionId, parentId, x, y, width, text) {
    if (!_active || !_sessionRef) return;
    _sessionRef.child('captions/' + captionId).set({
      parentId: parentId || '',
      x: x,
      y: y,
      width: width || '',
      text: text || '',
    });
  }

  function syncCaptionDelete(captionId) {
    if (!_active || !_sessionRef) return;
    _sessionRef.child('captions/' + captionId).remove();
  }

  // ── UNDO SUPPORT ───────────────────────────────────────────────────────

  function getElementVersion(elId) {
    return _elementVersions[elId] || 0;
  }

  function wasModifiedSince(elId, sinceVersion) {
    const current = _elementVersions[elId] || 0;
    return current > sinceVersion;
  }

  // ── LISTENERS FIREBASE ─────────────────────────────────────────────────

  function _attachListeners() {
    // Présence
    _listen(_sessionRef.child('presence'), 'child_added', _onPresenceAdded);
    _listen(_sessionRef.child('presence'), 'child_changed', _onPresenceChanged);
    _listen(_sessionRef.child('presence'), 'child_removed', _onPresenceRemoved);

    // Locks
    _listen(_sessionRef.child('locks'), 'child_added', _onLockAdded);
    _listen(_sessionRef.child('locks'), 'child_changed', _onLockChanged);
    _listen(_sessionRef.child('locks'), 'child_removed', _onLockRemoved);

    // Éléments
    _listen(_sessionRef.child('elements'), 'child_added', _onElementAdded);
    _listen(_sessionRef.child('elements'), 'child_changed', _onElementChanged);
    _listen(_sessionRef.child('elements'), 'child_removed', _onElementRemoved);

    // Connexions
    _listen(_sessionRef.child('connections'), 'child_added', _onConnectionAdded);
    _listen(_sessionRef.child('connections'), 'child_removed', _onConnectionRemoved);

    // Captions
    _listen(_sessionRef.child('captions'), 'child_added', _onCaptionAdded);
    _listen(_sessionRef.child('captions'), 'child_changed', _onCaptionChanged);
    _listen(_sessionRef.child('captions'), 'child_removed', _onCaptionRemoved);

    // Méta (session active)
    _listen(_sessionRef.child('meta/active'), 'value', _onMetaActiveChanged);
  }

  // ── PRÉSENCE HANDLERS ──────────────────────────────────────────────────

  function _onPresenceAdded(snap) {
    const uid = snap.key;
    if (uid === _userId) return; // ignorer soi-même
    const data = snap.val();
    _createRemoteCursor(uid, data.color);
    _userCount++;
    _updateStatusBar();
  }

  function _onPresenceChanged(snap) {
    const uid = snap.key;
    if (uid === _userId) return;
    const data = snap.val();

    // Cursor update
    if (data.cursor) {
      _updateRemoteCursorTarget(uid, data.cursor.x, data.cursor.y, data.cursor.visible);
    }

    // Selection update
    if (data.selection !== undefined) {
      _updateRemoteSelection(uid, data.selection || [], data.color);
    }

    // Selection rectangle
    if (data.selectionRect) {
      _updateRemoteSelRect(uid, data.selectionRect, data.color);
    }
  }

  function _onPresenceRemoved(snap) {
    const uid = snap.key;
    if (uid === _userId) return;
    _removeRemoteCursor(uid);
    _clearRemoteSelection(uid);
    _removeRemoteSelRect(uid);
    _userCount--;
    _updateStatusBar();
  }

  // ── LOCK HANDLERS ─────────────────────────────────────────────────────

  function _onLockAdded(snap) {
    const elId = snap.key;
    const data = snap.val();
    _lockCache[elId] = data.userId;
    _applyLockVisual(elId, data.userId);
  }

  function _onLockChanged(snap) {
    const elId = snap.key;
    const data = snap.val();
    _lockCache[elId] = data.userId;
    _applyLockVisual(elId, data.userId);
  }

  function _onLockRemoved(snap) {
    const elId = snap.key;
    delete _lockCache[elId];
    _removeLockVisual(elId);
  }

  function _applyLockVisual(elId, lockUserId) {
    if (lockUserId === _userId) return; // pas de visual pour nos propres locks
    const el = document.querySelector('[data-id="' + elId + '"]');
    if (!el) return;
    // Trouver la couleur du lockeur
    const color = _getColorForUser(lockUserId);
    el.classList.add('collab-locked');
    el.style.setProperty('--lock-color', color || '#888');
  }

  function _removeLockVisual(elId) {
    const el = document.querySelector('[data-id="' + elId + '"]');
    if (!el) return;
    el.classList.remove('collab-locked');
    el.style.removeProperty('--lock-color');
  }

  function _getColorForUser(uid) {
    // Chercher dans les curseurs distants
    if (_remoteCursors[uid]) return _remoteCursors[uid].color;
    // Fallback
    return COLORS[_hashStr(uid) % COLORS.length];
  }

  // ── ELEMENT HANDLERS ──────────────────────────────────────────────────

  function _onElementAdded(snap) {
    const elId = snap.key;
    const data = snap.val();
    if (!data || data.deleted) return;
    // Stocker la version
    _elementVersions[elId] = data.version || 0;
    // Ignorer si créé par nous (déjà dans le DOM)
    if (data.lastEditBy === _userId) return;
    // Ignorer si l'élément existe déjà dans le DOM (chargement initial owner)
    if (document.querySelector('[data-id="' + elId + '"]')) return;
    // Créer l'élément via App.restoreElement
    if (typeof App !== 'undefined' && typeof App._collabRestoreElement === 'function') {
      App._collabRestoreElement({
        id: elId,
        type: data.type,
        x: data.x,
        y: data.y,
        w: data.w,
        h: data.h,
        z: data.z,
        data: data.data || '',
      });
    }
  }

  function _onElementChanged(snap) {
    const elId = snap.key;
    const data = snap.val();
    if (!data) return;
    // Mettre à jour la version dans le cache
    _elementVersions[elId] = data.version || 0;
    // Ignorer nos propres modifications
    if (data.lastEditBy === _userId) return;

    // Suppression (soft-delete)
    if (data.deleted) {
      _handleRemoteDelete(elId);
      return;
    }

    const el = document.querySelector('[data-id="' + elId + '"]');
    if (!el) return;

    // Position → lerp
    const curX = parseFloat(el.style.left) || 0;
    const curY = parseFloat(el.style.top) || 0;
    if (Math.abs(curX - data.x) > 0.5 || Math.abs(curY - data.y) > 0.5) {
      _remoteLerpTargets[elId] = { x: data.x, y: data.y };
      if (!_remoteLerpRAFRunning) {
        _remoteLerpRAFRunning = true;
        requestAnimationFrame(_remoteLerpRAF);
      }
    }

    // Taille
    if (data.w !== undefined && data.w !== null) {
      el.style.width = data.w + 'px';
    }
    if (data.h !== undefined && data.h !== null) {
      el.style.height = data.h + 'px';
    }

    // Z-index
    if (data.z !== undefined) {
      el.style.zIndex = data.z;
    }

    // Data (texte, couleur, etc.) — seulement pour les types non-image
    if (data.data !== undefined && data.type !== 'image') {
      _applyRemoteData(el, data.type, data.data);
    }
  }

  function _onElementRemoved(snap) {
    const elId = snap.key;
    _handleRemoteDelete(elId);
  }

  function _handleRemoteDelete(elId) {
    const el = document.querySelector('[data-id="' + elId + '"]');
    if (el) {
      // Supprimer connexions et captions liées
      if (typeof App !== 'undefined') {
        if (typeof App._collabRemoveConnectionsForEl === 'function') {
          App._collabRemoveConnectionsForEl(el);
        }
        if (typeof App._collabRemoveCaptionsForEl === 'function') {
          App._collabRemoveCaptionsForEl(el);
        }
      }
      el.remove();
    }
    // Nettoyer _imgStore
    if (typeof App !== 'undefined' && typeof App._collabDeleteImgStore === 'function') {
      App._collabDeleteImgStore(elId);
    }
    delete _elementVersions[elId];
    delete _lockCache[elId];
    delete _remoteLerpTargets[elId];
  }

  function _applyRemoteData(el, type, data) {
    if (type === 'note') {
      const ta = el.querySelector('textarea');
      if (ta && document.activeElement !== ta) {
        ta.value = data;
        ta.setAttribute('data-snap-value', data);
      }
      el.dataset.savedata = data;
    } else if (type === 'color') {
      el.dataset.savedata = data;
      const swatch = el.querySelector('.color-swatch');
      if (swatch) swatch.style.backgroundColor = data;
      const hexInput = el.querySelector('.color-hex-input');
      if (hexInput && document.activeElement !== hexInput) {
        hexInput.value = data.replace('#', '');
      }
    } else {
      el.dataset.savedata = data;
    }
  }

  // ── CONNECTION / CAPTION HANDLERS ─────────────────────────────────────

  function _onConnectionAdded(snap) {
    const connId = snap.key;
    const data = snap.val();
    if (!data) return;
    // Vérifier si la connexion existe déjà
    if (document.querySelector('[data-conn-id="' + connId + '"]')) return;
    // Créer via App
    if (typeof App !== 'undefined' && typeof App._collabCreateConnection === 'function') {
      setTimeout(() => App._collabCreateConnection(data.from, data.to), 100);
    }
  }

  function _onConnectionRemoved(snap) {
    const connId = snap.key;
    const svg = document.querySelector('[data-conn-id="' + connId + '"]');
    if (svg) svg.remove();
  }

  function _onCaptionAdded(snap) {
    const capId = snap.key;
    const data = snap.val();
    if (!data) return;
    // Vérifier si caption existe déjà
    const existing = document.querySelector('[data-cap-id="' + capId + '"]');
    if (existing) return;
    // Créer la caption
    if (typeof App !== 'undefined' && typeof App._collabRestoreElement === 'function') {
      const capEl = App._collabRestoreElement({
        type: 'caption',
        x: data.x,
        y: data.y,
        width: data.width,
        parentId: data.parentId,
        text: data.text,
      });
      if (capEl) capEl.dataset.capId = capId;
    }
  }

  function _onCaptionChanged(snap) {
    const capId = snap.key;
    const data = snap.val();
    if (!data) return;
    const cap = document.querySelector('[data-cap-id="' + capId + '"]');
    if (cap && document.activeElement !== cap) {
      cap.textContent = data.text || '';
      cap.style.left = data.x + 'px';
      cap.style.top = data.y + 'px';
      if (data.width) cap.style.width = data.width;
    }
  }

  function _onCaptionRemoved(snap) {
    const capId = snap.key;
    const cap = document.querySelector('[data-cap-id="' + capId + '"]');
    if (cap) cap.remove();
  }

  // ── META HANDLER ──────────────────────────────────────────────────────

  function _onMetaActiveChanged(snap) {
    const isSessionActive = snap.val();
    if (isSessionActive === false && !_isOwner && _active) {
      App.toast('Le propriétaire a fermé la session collaborative');
      // Passer en lecture seule
      document.body.classList.add('readonly-mode');
    }
  }

  // ── CURSEURS DISTANTS (DOM + RAF) ─────────────────────────────────────

  function _createRemoteCursor(uid, color) {
    const container = document.getElementById('collab-cursors');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'collab-cursor';
    div.dataset.userId = uid;
    div.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' +
      '<path d="M0,0 L0,14 L4,10 L8,16 L10,14 L6,8 L12,8 Z" fill="' +
      color +
      '" stroke="#fff" stroke-width="0.5"/>' +
      '</svg>';
    div.style.opacity = '0';
    container.appendChild(div);
    _remoteCursors[uid] = {
      el: div,
      targetX: 0,
      targetY: 0,
      curX: 0,
      curY: 0,
      color: color,
      visible: false,
    };
  }

  function _updateRemoteCursorTarget(uid, canvasX, canvasY, visible) {
    const cursor = _remoteCursors[uid];
    if (!cursor) return;
    cursor.targetX = canvasX;
    cursor.targetY = canvasY;
    cursor.visible = visible;
    cursor.el.style.opacity = visible ? '1' : '0';
    // Démarrer le RAF si pas en cours
    if (!_cursorRAFId) {
      _cursorRAFId = requestAnimationFrame(_cursorLerpRAF);
    }
  }

  function _removeRemoteCursor(uid) {
    const cursor = _remoteCursors[uid];
    if (cursor && cursor.el && cursor.el.parentNode) {
      cursor.el.remove();
    }
    delete _remoteCursors[uid];
  }

  /** RAF loop pour interpoler les curseurs distants */
  function _cursorLerpRAF() {
    let anyActive = false;
    const wrapper = document.getElementById('canvas-wrapper');
    // Récupérer zoom/pan depuis App (exposé)
    const zoomLevel = typeof App !== 'undefined' && App._collabGetZoom ? App._collabGetZoom() : 1;
    const panX = typeof App !== 'undefined' && App._collabGetPanX ? App._collabGetPanX() : 0;
    const panY = typeof App !== 'undefined' && App._collabGetPanY ? App._collabGetPanY() : 0;

    Object.keys(_remoteCursors).forEach((uid) => {
      const c = _remoteCursors[uid];
      if (!c || !c.el) return;
      // Convertir canvas coords → screen coords
      const screenTargetX = c.targetX * zoomLevel + panX;
      const screenTargetY = c.targetY * zoomLevel + panY;

      c.curX = _lerp(c.curX, screenTargetX, 0.15);
      c.curY = _lerp(c.curY, screenTargetY, 0.15);

      if (Math.abs(c.curX - screenTargetX) > 0.5 || Math.abs(c.curY - screenTargetY) > 0.5) {
        anyActive = true;
      }

      c.el.style.transform = 'translate(' + c.curX + 'px,' + c.curY + 'px)';
    });

    if (anyActive || Object.keys(_remoteCursors).length > 0) {
      _cursorRAFId = requestAnimationFrame(_cursorLerpRAF);
    } else {
      _cursorRAFId = null;
    }
  }

  // ── SÉLECTIONS DISTANTES ──────────────────────────────────────────────

  function _updateRemoteSelection(uid, elIds, color) {
    // Nettoyer l'ancienne sélection
    _clearRemoteSelection(uid);
    // Appliquer la nouvelle
    _remoteSelections[uid] = { elIds: elIds, color: color };
    elIds.forEach((elId) => {
      const el = document.querySelector('[data-id="' + elId + '"]');
      if (el) {
        el.classList.add('collab-selected-by-other');
        el.style.setProperty('--collab-color', color);
      }
    });
  }

  function _clearRemoteSelection(uid) {
    const sel = _remoteSelections[uid];
    if (!sel) return;
    sel.elIds.forEach((elId) => {
      const el = document.querySelector('[data-id="' + elId + '"]');
      if (el) {
        // Vérifier qu'aucun autre utilisateur ne sélectionne aussi cet élément
        let otherSelecting = false;
        Object.keys(_remoteSelections).forEach((otherUid) => {
          if (otherUid !== uid && _remoteSelections[otherUid].elIds.includes(elId)) {
            otherSelecting = true;
          }
        });
        if (!otherSelecting) {
          el.classList.remove('collab-selected-by-other');
          el.style.removeProperty('--collab-color');
        }
      }
    });
    delete _remoteSelections[uid];
  }

  function _clearAllRemoteSelections() {
    Object.keys(_remoteSelections).forEach((uid) => _clearRemoteSelection(uid));
  }

  // ── RECTANGLES DE SÉLECTION DISTANTS ─────────────────────────────────

  function _updateRemoteSelRect(uid, rect, color) {
    if (!rect.active) {
      _removeRemoteSelRect(uid);
      return;
    }
    const container = document.getElementById('collab-sel-rects');
    if (!container) return;

    let div = _remoteSelRects[uid];
    if (!div) {
      div = document.createElement('div');
      div.className = 'collab-sel-rect';
      div.dataset.userId = uid;
      container.appendChild(div);
      _remoteSelRects[uid] = div;
    }

    // Convertir canvas coords → screen coords
    const zoomLevel = typeof App !== 'undefined' && App._collabGetZoom ? App._collabGetZoom() : 1;
    const panX = typeof App !== 'undefined' && App._collabGetPanX ? App._collabGetPanX() : 0;
    const panY = typeof App !== 'undefined' && App._collabGetPanY ? App._collabGetPanY() : 0;

    div.style.left = rect.x * zoomLevel + panX + 'px';
    div.style.top = rect.y * zoomLevel + panY + 'px';
    div.style.width = rect.w * zoomLevel + 'px';
    div.style.height = rect.h * zoomLevel + 'px';
    div.style.borderColor = color;
    div.style.backgroundColor = color + '15'; // 15 = ~8% opacity
  }

  function _removeRemoteSelRect(uid) {
    const div = _remoteSelRects[uid];
    if (div && div.parentNode) div.remove();
    delete _remoteSelRects[uid];
  }

  // ── REMOTE ELEMENT LERP (mouvement distant lissé) ────────────────────

  function _remoteLerpRAF() {
    let anyActive = false;
    Object.keys(_remoteLerpTargets).forEach((elId) => {
      const el = document.querySelector('[data-id="' + elId + '"]');
      if (!el) {
        delete _remoteLerpTargets[elId];
        return;
      }
      const target = _remoteLerpTargets[elId];
      const curX = parseFloat(el.style.left) || 0;
      const curY = parseFloat(el.style.top) || 0;
      const newX = _lerp(curX, target.x, 0.2);
      const newY = _lerp(curY, target.y, 0.2);

      if (Math.abs(newX - target.x) < 0.5 && Math.abs(newY - target.y) < 0.5) {
        el.style.left = target.x + 'px';
        el.style.top = target.y + 'px';
        delete _remoteLerpTargets[elId];
      } else {
        el.style.left = newX + 'px';
        el.style.top = newY + 'px';
        anyActive = true;
      }

      // Mettre à jour les connexions
      if (typeof App !== 'undefined' && typeof App._collabUpdateConnections === 'function') {
        App._collabUpdateConnections(el);
      }
    });

    if (anyActive) {
      requestAnimationFrame(_remoteLerpRAF);
    } else {
      _remoteLerpRAFRunning = false;
    }
  }

  // ── CONNEXION ─────────────────────────────────────────────────────────

  function _onConnectionChange(e) {
    const connected = e.detail;
    const bar = document.getElementById('collab-status-bar');
    const connStatus = document.getElementById('collab-connection-status');
    if (connStatus) {
      connStatus.textContent = connected ? '' : ' — Reconnexion…';
      connStatus.style.color = connected ? '' : '#F59E0B';
    }
  }

  // ── STATUS BAR ────────────────────────────────────────────────────────

  function _updateStatusBar() {
    const bar = document.getElementById('collab-status-bar');
    const countEl = document.getElementById('collab-user-count');
    if (bar) bar.classList.remove('hidden');
    // +1 pour inclure l'utilisateur local
    const total = _userCount + 1;
    if (countEl) countEl.textContent = total + ' utilisateur' + (total > 1 ? 's' : '');
  }

  function _hideStatusBar() {
    const bar = document.getElementById('collab-status-bar');
    if (bar) bar.classList.add('hidden');
  }

  // ── MERGE SESSION → LOCAL (owner only) ────────────────────────────────

  async function _mergeSessionToLocal() {
    if (!_sessionRef) return;
    try {
      const elemSnap = await _sessionRef.child('elements').get();
      if (!elemSnap.exists()) return;
      const elements = [];
      elemSnap.forEach((child) => {
        const d = child.val();
        if (d.deleted) return;
        elements.push({
          id: child.key,
          type: d.type,
          x: d.x,
          y: d.y,
          w: d.w,
          h: d.h,
          z: d.z,
          data: d.data || '',
        });
      });
      // Ajouter les connexions
      const connSnap = await _sessionRef.child('connections').get();
      if (connSnap.exists()) {
        connSnap.forEach((child) => {
          const d = child.val();
          elements.push({ type: 'connection', from: d.from, to: d.to, connId: child.key });
        });
      }
      // Ajouter les captions
      const capSnap = await _sessionRef.child('captions').get();
      if (capSnap.exists()) {
        capSnap.forEach((child) => {
          const d = child.val();
          elements.push({
            type: 'caption',
            x: d.x,
            y: d.y,
            width: d.width,
            parentId: d.parentId,
            text: d.text,
          });
        });
      }
      // Mettre à jour le board local via App
      if (typeof App !== 'undefined' && typeof App._collabMergeElements === 'function') {
        App._collabMergeElements(_boardId, elements);
      }
    } catch (e) {
      console.warn('Collab merge error:', e);
    }
  }

  // ── API PUBLIQUE ──────────────────────────────────────────────────────

  return {
    // Lifecycle
    startSession: startSession,
    endSession: endSession,
    isActive: function () {
      return _active;
    },
    isOwner: function () {
      return _isOwner;
    },
    getMyUserId: function () {
      return _userId;
    },
    getMyColor: function () {
      return _userColor;
    },
    getBoardId: function () {
      return _boardId;
    },

    // Présence
    sendCursor: sendCursor,
    hideCursor: hideCursor,
    sendSelection: sendSelection,
    sendSelectionRect: sendSelectionRect,
    clearSelectionRect: clearSelectionRect,

    // Locks
    acquireLock: acquireLock,
    releaseLock: releaseLock,
    releaseAllMyLocks: releaseAllMyLocks,
    isLockedByOther: isLockedByOther,
    getLockOwner: getLockOwner,

    // Sync éléments
    syncElementPosition: syncElementPosition,
    syncElementSize: syncElementSize,
    syncElementData: syncElementData,
    syncElementCreate: syncElementCreate,
    syncElementDelete: syncElementDelete,
    syncElementZ: syncElementZ,
    syncConnection: syncConnection,
    syncConnectionDelete: syncConnectionDelete,
    syncCaption: syncCaption,
    syncCaptionDelete: syncCaptionDelete,

    // Undo support
    getElementVersion: getElementVersion,
    wasModifiedSince: wasModifiedSince,
  };
})();
