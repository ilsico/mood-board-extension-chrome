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
  // Acquisitions de lock en vol (transaction Firebase non encore résolue).
  // acquireLock est asynchrone : si releaseLock survient avant sa résolution
  // (drag ou resize rapide, mouseup avant le retour réseau), on note la demande
  // ici pour relâcher le lock dès qu'il est réellement posé — sinon il reste
  // orphelin et bloque tous les autres collaborateurs sur cet élément.
  let _pendingLock = {}; // elId -> { release: bool }
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
  let _recentDataEdits = {}; // elId -> timestamp du dernier syncElementData local
  let _heartbeatTimer = null;
  let _staleCleanupTimer = null;
  // Décalage horloge locale ↔ serveur Firebase. Les timestamps de présence sont
  // écrits avec ServerValue.TIMESTAMP : les comparer à un Date.now() local fait
  // disparaître des collaborateurs bien connectés si la machine est mal réglée.
  let _serverTimeOffset = 0;
  let _serverOffsetRef = null;

  
  const COLORS = ['#0b36ed'];

  const CURSOR_SEND_INTERVAL = 16; // ~60 Hz
  const DRAG_SYNC_INTERVAL = 16; // ~60 Hz
  const TEXT_SYNC_DEBOUNCE = 300; // ms

  // ── UTILITAIRES ─────────────────────────────────────────────────────────

  var _loadedGFontsRemote = new Set();
  function _loadGFontIfNeeded(cssFontFamily) {
    if (!cssFontFamily) return;
    var family = cssFontFamily.split(',')[0].trim().replace(/['"]/g, '');
    if (!family) return;
    if (_loadedGFontsRemote.has(family)) return;
    _loadedGFontsRemote.add(family);
    var url = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') + '&display=swap';
    fetch(url).then(function (r) {
      var ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('text/css')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        document.head.appendChild(link);
      }
    }).catch(function () {});
  }

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
    const throttled = function () {
      lastArgs = arguments;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        fn.apply(null, lastArgs);
      }, ms);
    };
    throttled.cancel = function () {
      clearTimeout(timer);
      timer = null;
      lastArgs = null;
    };
    return throttled;
  }

  /**
   * Upload une image base64 vers Firebase Storage.
   * Retourne l'URL de téléchargement publique.
   * Lève une erreur si l'upload échoue (à catch par l'appelant).
   */
  async function _uploadImageToStorage(elId, base64) {
    const storageRef = firebase.storage().ref('collabImages/' + _boardId + '/' + elId);
    await storageRef.putString(base64, 'data_url');
    return await storageRef.getDownloadURL();
  }

  /**
   * Télécharge toutes les images Firebase Storage du canvas courant en base64
   * et les stocke dans _imgStore via App._imgStoreSet.
   * Appelée avant endSession pour garantir une copie locale complète.
   */
  async function _downloadStorageImages(progressCb) {
    const imgEls = Array.from(document.querySelectorAll('[data-type="image"]'));
    const storagePrefix = 'https://firebasestorage.googleapis.com';
    var done = 0;
    if (progressCb) progressCb(0, imgEls.length);
    for (var i = 0; i < imgEls.length; i++) {
      var el = imgEls[i];
      var elId = el.dataset.id;
      var imgTag = el.querySelector('img');
      if (!imgTag) { done++; continue; }
      var src = imgTag.src || '';
      // Télécharger uniquement les URLs Storage (pas les base64 déjà en mémoire)
      if (src.indexOf(storagePrefix) === 0) {
        try {
          var resp = await fetch(src);
          var blob = await resp.blob();
          var base64 = await new Promise(function (resolve) {
            var reader = new FileReader();
            reader.onloadend = function () { resolve(reader.result); };
            reader.readAsDataURL(blob);
          });
          if (App._imgStoreSet) App._imgStoreSet(elId, base64);
        } catch (_) {
          // Échec toléré : l'URL reste dans _imgStore si App._imgStoreGet la retourne
        }
      }
      done++;
      if (progressCb) progressCb(done, imgEls.length);
    }
  }

  /** Crée un debounce simple */
  function _makeDebounce(fn, ms) {
    let timer = null;
    let lastArgs = null;
    const debounced = function () {
      lastArgs = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(null, lastArgs);
      }, ms);
    };
    /** Exécute immédiatement l'appel en attente (s'il y en a un) */
    debounced.flush = function () {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      fn.apply(null, lastArgs);
    };
    debounced.cancel = function () {
      clearTimeout(timer);
      timer = null;
      lastArgs = null;
    };
    return debounced;
  }

  // ── HEARTBEAT & STALE PRESENCE CLEANUP ─────────────────────────────────

  /** Heure serveur estimée, à utiliser pour comparer des ServerValue.TIMESTAMP. */
  function _serverNow() {
    return Date.now() + _serverTimeOffset;
  }

  function _watchServerTimeOffset() {
    if (_serverOffsetRef || !window._fbDb) return;
    _serverOffsetRef = window._fbDb.ref('.info/serverTimeOffset');
    _serverOffsetRef.on('value', function (snap) {
      const v = snap.val();
      if (typeof v === 'number') _serverTimeOffset = v;
    });
  }

  function _startHeartbeat() {
    clearInterval(_heartbeatTimer);
    clearInterval(_staleCleanupTimer);
    _watchServerTimeOffset();

    // Rafraîchir notre présence toutes les 30 s.
    // On réécrit la couleur en même temps que le timestamp : si le nœud de présence
    // a été supprimé entre-temps (coupure réseau qui déclenche onDisconnect, ou
    // nettoyage des présences fantômes par un autre client), écrire le seul
    // timestamp le recréerait sans couleur. Les autres recevraient alors un
    // child_added avec color undefined → fill="undefined" → curseur noir.
    _heartbeatTimer = setInterval(function () {
      if (!_active || !_sessionRef) return;
      _sessionRef.child('presence/' + _userId).update({
        color: _userColor,
        timestamp: firebase.database.ServerValue.TIMESTAMP,
      });
    }, 30000);

    // Nettoyer les présences fantômes toutes les 60s
    _staleCleanupTimer = setInterval(function () {
      _cleanStalePresences();
    }, 60000);
  }

  function _cleanStalePresences() {
    if (!_active || !_sessionRef) return;
    _sessionRef.child('presence').get().then(function (snap) {
      if (!snap.exists()) return;
      var now = _serverNow();
      snap.forEach(function (child) {
        if (child.key === _userId) return;
        var pData = child.val();
        // 90 000 ms = 3 heartbeats manqués → présence fantôme
        if (pData.timestamp && now - pData.timestamp > 90000) {
          _sessionRef.child('presence/' + child.key).remove();
        }
      });
    });
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
    _userId = window._fbUid ? 'u_' + window._fbUid : _genUUID();
    _active = true;
    _sessionRef = window._fbDb.ref('collabSessions/' + boardId);
    // Avant le premier _serverNow() du nettoyage des présences ci-dessous
    _watchServerTimeOffset();

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

      // Nettoyer les présences périmées (> 90s = 3 heartbeats manqués)
      if (presenceSnap.exists()) {
        var now = _serverNow();
        presenceSnap.forEach(function (child) {
          if (child.key === _userId) return;
          var pData = child.val();
          if (pData.timestamp && now - pData.timestamp > 90000) {
            _sessionRef.child('presence/' + child.key).remove();
          }
        });
      }

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

      // Démarrer le heartbeat pour maintenir la présence à jour
      _startHeartbeat();

      if (isOwner) {
        await _sessionRef.child('meta').set({
          ownerId: _userId,
          createdAt: firebase.database.ServerValue.TIMESTAMP,
          active: true,
          maxZ: 100,
        });
        if (opts && opts.elements) {
          // Séparer images et autres éléments
          const imgEls = opts.elements.filter((el) => el.type === 'image' && el.data && el.data !== 'pending');
          const otherEls = opts.elements.filter((el) => el.type !== 'image');

          // Afficher progression sur le bouton collab
          const collabBtn = document.getElementById('collab-btn');
          const _btnOriginal = collabBtn ? collabBtn.innerHTML : null;
          const _setProgress = function (done, total) {
            if (collabBtn) collabBtn.textContent = total > 0 ? 'Préparation… ' + done + ' / ' + total : 'Préparation…';
          };

          // Collecter les URLs (upload séquentiel pour éviter de saturer la connexion)
          const imgUrls = {};
          _setProgress(0, imgEls.length);
          for (var imgIdx = 0; imgIdx < imgEls.length; imgIdx++) {
            var imgEl = imgEls[imgIdx];
            var base64 = (App._imgStoreGet && App._imgStoreGet(imgEl.id)) || imgEl.data;
            try {
              imgUrls[imgEl.id] = await _uploadImageToStorage(imgEl.id, base64);
            } catch (storageErr) {
              // Fallback : écrire base64 directement dans RTDB pour les petites images
              if (base64 && base64.length <= 786432) {
                imgUrls[imgEl.id] = base64;
              }
            }
            _setProgress(imgIdx + 1, imgEls.length);
          }

          // Restaurer le bouton
          if (collabBtn && _btnOriginal !== null) collabBtn.innerHTML = _btnOriginal;

          // Construire le batch RTDB
          const updates = {};
          opts.elements.forEach((el) => {
            if (el.type === 'connection') {
              updates['connections/' + el.connId] = { from: el.from, to: el.to };
            } else if (el.type === 'caption') {
              // Réutiliser le capId du DOM : en générer un nouveau ferait échouer
              // la reconnaissance dans _onCaptionAdded, qui dupliquerait la caption.
              const capId =
                el.capId || 'cap_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
              updates['captions/' + capId] = {
                parentId: el.parentId || '',
                x: el.x,
                y: el.y,
                width: el.width || '',
                text: el.text || '',
              };
            } else {
              var elData;
              if (el.type === 'image') {
                elData = imgUrls[el.id] || 'pending';
              } else {
                elData = el.data || '';
              }
              updates['elements/' + el.id] = {
                x: el.x,
                y: el.y,
                w: el.w || null,
                h: el.h || null,
                z: el.z || 100,
                type: el.type,
                data: elData,
                style: el.style || null,
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

    // Vider les timers de sync tant que _active et _sessionRef sont valides
    _flushPendingSyncs();

    // Libérer tous les locks
    releaseAllMyLocks();

    // Supprimer la présence
    if (_sessionRef && _userId) {
      _sessionRef.child('presence/' + _userId).remove();
    }

    // Télécharger les images Storage en local puis sauvegarder
    if (_sessionRef) {
      // Capturer ref et boardId : la suite d'endSession les remet à null de façon
      // synchrone, avant que le .then ci-dessous ne s'exécute.
      var _endSessionRef = _sessionRef;
      var _endBoardId = _boardId;
      var endBtn = document.getElementById('collab-btn');
      var _endBtnOriginal = endBtn ? endBtn.innerHTML : null;
      var _setEndProgress = function (done, total) {
        if (endBtn) endBtn.textContent = total > 0 ? 'Sauvegarde… ' + done + ' / ' + total : 'Sauvegarde…';
      };
      _downloadStorageImages(_setEndProgress).then(function () {
        if (endBtn && _endBtnOriginal !== null) endBtn.innerHTML = _endBtnOriginal;
        _mergeSessionToLocal(_endSessionRef, _endBoardId);
      });
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

    // Arrêter le heartbeat et le cleanup périodique
    clearInterval(_heartbeatTimer);
    clearInterval(_staleCleanupTimer);
    _heartbeatTimer = null;
    _staleCleanupTimer = null;
    if (_serverOffsetRef) {
      _serverOffsetRef.off();
      _serverOffsetRef = null;
    }

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
    _recentDataEdits = {};
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
    _pendingLock[elementId] = { release: false };
    return lockRef
      .transaction((current) => {
        if (current === null) {
          return { userId: _userId, timestamp: firebase.database.ServerValue.TIMESTAMP };
        }
        if (current.userId === _userId) return current;
        return; // abort — quelqu'un d'autre a le lock
      })
      .then((result) => {
        const pending = _pendingLock[elementId];
        delete _pendingLock[elementId];
        if (result.committed) {
          _lockCache[elementId] = _userId;
          // Libération demandée pendant l'acquisition (mouseup avant la résolution
          // de la transaction) : le lock vient d'être posé, on le retire aussitôt
          // via la ref capturée, sans dépendre de l'état de session courant.
          if (pending && pending.release) {
            lockRef.remove().catch(() => {});
            delete _lockCache[elementId];
            return false;
          }
          lockRef.onDisconnect().remove();
          return true;
        }
        return false;
      })
      .catch(() => {
        delete _pendingLock[elementId];
        return false;
      });
  }

  function releaseLock(elementId) {
    if (!_active || !_sessionRef) return;
    // Acquisition encore en vol : demander la libération à sa résolution, sinon le
    // lock serait posé juste après ce release et resterait orphelin.
    if (_pendingLock[elementId]) {
      _pendingLock[elementId].release = true;
      return;
    }
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
    // Acquisitions en vol comprises : les relâcher dès qu'elles se posent.
    Object.keys(_pendingLock).forEach((elId) => {
      _pendingLock[elId].release = true;
    });
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
  const _throttledCaptionPositionSync = {};

  function syncElementPosition(elId, x, y, isFinal) {
    if (!_active || !_sessionRef) return;
    if (isFinal) {
      // Annuler tout timer throttle en attente avant d'envoyer la position finale
      if (_throttledPositionSync[elId]) {
        _throttledPositionSync[elId].cancel();
        delete _throttledPositionSync[elId];
      }
      _sessionRef.child('elements/' + elId).update({
        x: x,
        y: y,
        version: firebase.database.ServerValue.increment(1),
        lastEditBy: _userId,
        lastEditAt: firebase.database.ServerValue.TIMESTAMP,
      });
    } else {
      // Sync throttlée pendant le drag (sans version++)
      if (!_throttledPositionSync[elId]) {
        _throttledPositionSync[elId] = _makeThrottle((id, px, py) => {
          if (!_active || !_sessionRef) return;
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
      _sessionRef.child('elements/' + elId).update({
        w: w,
        h: h,
        version: firebase.database.ServerValue.increment(1),
        lastEditBy: _userId,
        lastEditAt: firebase.database.ServerValue.TIMESTAMP,
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
  const _debouncedCaptionSync = {};

  /**
   * Vide les timers de sync en attente. Appelé par endSession AVANT la remise à
   * zéro de _sessionRef, sinon un timer en vol écrirait sur une ref nulle.
   * Les éditions de texte sont flushées (ne pas perdre les dernières frappes),
   * les positions intermédiaires de drag sont annulées (la position finale est
   * déjà partie via isFinal).
   */
  function _flushPendingSyncs() {
    [_debouncedDataSync, _debouncedCaptionSync].forEach(function (map) {
      Object.keys(map).forEach(function (k) {
        if (map[k] && map[k].flush) map[k].flush();
        delete map[k];
      });
    });
    [_throttledPositionSync, _throttledCaptionPositionSync].forEach(function (map) {
      Object.keys(map).forEach(function (k) {
        if (map[k] && map[k].cancel) map[k].cancel();
        delete map[k];
      });
    });
  }

  function syncElementData(elId, data, immediate) {
    if (!_active || !_sessionRef) return;
    // Guard against Firebase "Write too large" — skip base64 payloads over ~768 KB
    if (typeof data === 'string' && data.length > 786432) return;
    _recentDataEdits[elId] = Date.now();
    var _doSync = function (id, d) {
      if (!_active || !_sessionRef) return;
      _sessionRef.child('elements/' + id).update({
        data: d,
        version: firebase.database.ServerValue.increment(1),
        lastEditBy: _userId,
        lastEditAt: firebase.database.ServerValue.TIMESTAMP,
      });
    };
    if (immediate) {
      _doSync(elId, data);
      return;
    }
    if (!_debouncedDataSync[elId]) {
      _debouncedDataSync[elId] = _makeDebounce(_doSync, TEXT_SYNC_DEBOUNCE);
    }
    _debouncedDataSync[elId](elId, data);
  }

  function syncElementStyle(elId, styleObj) {
    if (!_active || !_sessionRef) return;
    _sessionRef.child('elements/' + elId).update({
      style: styleObj,
      version: firebase.database.ServerValue.increment(1),
      lastEditBy: _userId,
      lastEditAt: firebase.database.ServerValue.TIMESTAMP,
    });
  }

  function syncElementCreate(elId, type, x, y, w, h, data, z, style) {
    if (!_active || !_sessionRef) return;
    var _isImg = type === 'image';

    // Écrire d'abord avec 'pending' pour que le collab voie l'élément immédiatement
    _sessionRef.child('elements/' + elId).set({
      x: x,
      y: y,
      w: w || null,
      h: h || null,
      z: z || 100,
      type: type,
      data: _isImg ? 'pending' : (data || ''),
      style: style || null,
      version: 0,
      lastEditBy: _userId,
      lastEditAt: firebase.database.ServerValue.TIMESTAMP,
      deleted: false,
    });

    // Upload vers Storage puis mettre à jour RTDB avec l'URL (toutes tailles)
    if (_isImg && data && data !== 'pending') {
      _uploadImageToStorage(elId, data)
        .then(function (url) {
          if (!_active || !_sessionRef) return;
          _sessionRef.child('elements/' + elId).update({
            data: url,
            lastEditBy: _userId,
            lastEditAt: firebase.database.ServerValue.TIMESTAMP,
          });
        })
        .catch(function (storageErr) {
          // Fallback : écrire base64 directement dans RTDB pour les petites images
          if (!_active || !_sessionRef) return;
          if (data && data.length <= 786432) {
            _sessionRef.child('elements/' + elId).update({
              data: data,
              lastEditBy: _userId,
              lastEditAt: firebase.database.ServerValue.TIMESTAMP,
            });
          }
        });
    }
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
    // lastEditBy est obligatoire : _onElementChanged ignore les snapshots dont
    // lastEditBy est déjà le sien, donc un set() sur /z seul serait invisible
    // pour le dernier éditeur de l'élément.
    _sessionRef.child('elements/' + elId).update({
      z: z,
      lastEditBy: _userId,
      lastEditAt: firebase.database.ServerValue.TIMESTAMP,
    });
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
    _sessionRef.child('captions/' + captionId).update({
      parentId: parentId || '',
      x: x,
      y: y,
      width: width || '',
      text: text || '',
    });
  }

  function syncCaptionPosition(capId, x, y, isFinal) {
    if (!_active || !_sessionRef) return;
    if (isFinal) {
      if (_throttledCaptionPositionSync[capId]) {
        _throttledCaptionPositionSync[capId].cancel();
        delete _throttledCaptionPositionSync[capId];
      }
      _sessionRef.child('captions/' + capId).update({ x: x, y: y });
    } else {
      if (!_throttledCaptionPositionSync[capId]) {
        _throttledCaptionPositionSync[capId] = _makeThrottle(function (id, px, py) {
          if (!_active || !_sessionRef) return;
          _sessionRef.child('captions/' + id).update({ x: px, y: py });
        }, DRAG_SYNC_INTERVAL);
      }
      _throttledCaptionPositionSync[capId](capId, x, y);
    }
  }

  function syncCaptionText(capId, text, immediate) {
    if (!_active || !_sessionRef) return;
    var _doSync = function (id, t) {
      if (!_active || !_sessionRef) return;
      _sessionRef.child('captions/' + id).update({ text: t || '' });
    };
    if (immediate) {
      _doSync(capId, text);
      return;
    }
    if (!_debouncedCaptionSync[capId]) {
      _debouncedCaptionSync[capId] = _makeDebounce(_doSync, TEXT_SYNC_DEBOUNCE);
    }
    _debouncedCaptionSync[capId](capId, text);
  }

  function syncCaptionDelete(captionId) {
    if (!_active || !_sessionRef) return;
    _sessionRef.child('captions/' + captionId).remove();
  }

  function syncCaptionStyle(capId, styleObj) {
    if (!_active || !_sessionRef) return;
    _sessionRef.child('captions/' + capId + '/style').set(styleObj);
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

    // Thumbnail sync
    if (window._fbDb && _boardId) {
      const thumbRef = window._fbDb.ref('boards/' + _boardId + '/thumbnail');
      _listen(thumbRef, 'value', (snap) => {
        const thumb = snap.val();
        if (thumb && typeof App !== 'undefined' && App.updateBoardThumbnail) {
          App.updateBoardThumbnail(_boardId, thumb);
        }
      });
    }
  }

  // ── PRÉSENCE HANDLERS ──────────────────────────────────────────────────

  /**
   * Couleur d'une présence, toujours valide.
   * Une présence peut arriver sans couleur (nœud recréé par un heartbeat après
   * suppression). Laisser passer un undefined donnerait fill="undefined",
   * borderColor="undefined" ou la chaîne "undefined15" côté rendu — soit du noir.
   */
  function _presenceColor(uid, data) {
    return (data && data.color) || COLORS[_hashStr(uid) % COLORS.length];
  }

  function _onPresenceAdded(snap) {
    const uid = snap.key;
    if (uid === _userId) return; // ignorer soi-même
    const data = snap.val();
    // Ignorer les présences fantômes (heartbeat absent depuis > 90s)
    // Les règles Firebase empêchent souvent de supprimer l'entrée d'un autre user,
    // on les filtre donc côté client plutôt que de tenter un remove.
    // _serverNow() et pas Date.now() : data.timestamp vient de ServerValue.TIMESTAMP,
    // une horloge locale décalée ferait disparaître des collaborateurs bien présents.
    if (data.timestamp && _serverNow() - data.timestamp > 90000) return;
    _createRemoteCursor(uid, _presenceColor(uid, data));
    _updateStatusBar();
  }

  function _onPresenceChanged(snap) {
    const uid = snap.key;
    if (uid === _userId) return;
    const data = snap.val();
    const color = _presenceColor(uid, data);

    // Cursor update
    if (data.cursor) {
      _updateRemoteCursorTarget(uid, data.cursor.x, data.cursor.y, data.cursor.visible);
    }

    // Selection update
    _updateRemoteSelection(uid, Array.isArray(data.selection) ? data.selection : [], color);

    // Selection rectangle
    if (data.selectionRect) {
      _updateRemoteSelRect(uid, data.selectionRect, color);
    }
  }

  function _onPresenceRemoved(snap) {
    const uid = snap.key;
    if (uid === _userId) return;
    _removeRemoteCursor(uid);
    _clearRemoteSelection(uid);
    _removeRemoteSelRect(uid);
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
        style: data.style || null,
      });
    }
  }

  function _onElementChanged(snap) {
    const elId = snap.key;
    const data = snap.val();
    if (!data) return;
    // Ignorer nos propres modifications
    if (data.lastEditBy === _userId) return;
    // Ne compter que les éditions DISTANTES : pushAction capture elementVersion
    // avant que notre propre sync ne l'incrémente, donc compter nos écritures ici
    // ferait échouer wasModifiedSince sur nos propres actions et bloquerait notre undo.
    _elementVersions[elId] = data.version || 0;

    // Suppression (soft-delete)
    if (data.deleted) {
      _handleRemoteDelete(elId);
      return;
    }

    const el = document.querySelector('[data-id="' + elId + '"]');
    if (!el) {
      // L'élément n'existe pas dans le DOM — le créer (fallback)
      if (
        data.type &&
        typeof App !== 'undefined' &&
        typeof App._collabRestoreElement === 'function'
      ) {
        App._collabRestoreElement({
          id: elId,
          type: data.type,
          x: data.x,
          y: data.y,
          w: data.w,
          h: data.h,
          z: data.z,
          data: data.data || '',
          style: data.style || null,
        });
      }
      return;
    }

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
    if (data.h !== undefined && data.h !== null && el.dataset.type !== 'note') {
      el.style.height = data.h + 'px';
    }
    // File card : scaler le contenu interne proportionnellement (miroir de handleResizeMouse)
    if (el.dataset.type === 'file' && data.w !== undefined && data.w !== null) {
      var fileWrap = el.querySelector('.el-file');
      if (fileWrap) {
        fileWrap.style.transform = 'scale(' + data.w / 260 + ')';
        fileWrap.style.transformOrigin = 'top left';
      }
    }

    // Z-index
    if (data.z !== undefined) {
      el.style.zIndex = data.z;
    }

    // Data — protéger contre l'écrasement
    if (data.data !== undefined) {
      // Skip si on a nous-même édité les données de cet élément récemment (< 3 secondes)
      // Cela évite qu'un child_changed déclenché par un move distant
      // ne réécrive nos données locales pas encore confirmées par Firebase
      var recentLocalEdit = _recentDataEdits[elId] && Date.now() - _recentDataEdits[elId] < 3000;
      if (recentLocalEdit) {
        // On a récemment édité cet élément, ignorer les données distantes
      } else {
        var isBeingEditedLocally = false;
        if (el.dataset.editing) {
          isBeingEditedLocally = true;
        }
        var ta = el.querySelector('.el-note-content');
        if (ta && document.activeElement === ta) {
          isBeingEditedLocally = true;
        }
        var hexInput = el.querySelector('.color-hex-input');
        if (hexInput && document.activeElement === hexInput) {
          isBeingEditedLocally = true;
        }
        if (!isBeingEditedLocally) {
          _applyRemoteData(el, data.type, data.data);
        }
      }
    }
    // Style (police, taille, alignement)
    if (data.style) {
      var target = el.querySelector('.el-note-content') || el;
      if (data.style.fontSize) target.style.fontSize = data.style.fontSize;
      if (data.style.fontFamily) { target.style.fontFamily = data.style.fontFamily; _loadGFontIfNeeded(data.style.fontFamily); }
      if (data.style.fontWeight) target.style.fontWeight = data.style.fontWeight;
      if (data.style.textAlign) target.style.textAlign = data.style.textAlign;
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
      const ta = el.querySelector('.el-note-content');
      if (ta && document.activeElement !== ta) {
        ta.innerHTML = data;
      }
      el.dataset.savedata = data;
    } else if (type === 'color') {
      el.dataset.savedata = data;
      const swatch = el.querySelector('.color-swatch');
      if (swatch) swatch.style.backgroundColor = data;
      const hexInput = el.querySelector('.color-hex-input');
      if (hexInput && document.activeElement !== hexInput) {
        hexInput.value = data;
      }
      if (data && /^#[0-9A-Fa-f]{3,6}$/.test(data)) {
        const elColor = el.querySelector('.el-color');
        if (elColor) elColor.style.backgroundColor = data;
        const info = el.querySelector('.color-info');
        if (info) info.style.backgroundColor = data;
        const h = data.replace('#', '');
        const r = parseInt(h.length === 3 ? h[0] + h[0] : h.slice(0, 2), 16);
        const g = parseInt(h.length === 3 ? h[1] + h[1] : h.slice(2, 4), 16);
        const b = parseInt(h.length === 3 ? h[2] + h[2] : h.slice(4, 6), 16);
        el.style.setProperty('--color-card-contrast', (r * 299 + g * 587 + b * 114) / 1000 > 128 ? '#000000' : '#ffffff');
      }
    } else if (type === 'image') {
      if (data && data !== 'pending') {
        // Si l'élément était en état "image perdue", retirer le placeholder
        // et créer un <img> avant d'assigner la nouvelle source.
        if (el.classList.contains('image-broken')) {
          var ph = el.querySelector('.image-broken-content');
          if (ph) ph.remove();
          el.classList.remove('image-broken');
        }
        var img = el.querySelector('img');
        if (!img) {
          img = document.createElement('img');
          img.draggable = false;
          el.insertBefore(img, el.querySelector('.element-toolbar'));
        }
        img.src = data;
      }
    } else if (type === 'file') {
      el.dataset.savedata = data;
      var fd = {};
      try { fd = JSON.parse(data || '{}'); } catch (_) {}
      var isVideoCard = !!el.querySelector('.el-file-video');
      if (fd.isVideo && !isVideoCard) {
        // Changement de type fichier→vidéo : recréer via App
        if (typeof App !== 'undefined' && typeof App._collabRestoreElement === 'function') {
          var elId = el.dataset.id;
          var elZ = el.style.zIndex;
          var elX = parseFloat(el.style.left) || 0;
          var elY = parseFloat(el.style.top) || 0;
          var elW = parseFloat(el.style.width) || null;
          var elH = parseFloat(el.style.height) || null;
          el.remove();
          var newEl = App._collabRestoreElement({ id: elId, type: 'file', x: elX, y: elY, w: elW, h: elH, data: data });
          if (newEl) newEl.style.zIndex = elZ;
        }
      } else if (!fd.isVideo && isVideoCard) {
        // Changement de type vidéo→fichier : recréer
        if (typeof App !== 'undefined' && typeof App._collabRestoreElement === 'function') {
          var elId = el.dataset.id;
          var elZ = el.style.zIndex;
          var elX = parseFloat(el.style.left) || 0;
          var elY = parseFloat(el.style.top) || 0;
          var elW = parseFloat(el.style.width) || null;
          var elH = parseFloat(el.style.height) || null;
          el.remove();
          var newEl = App._collabRestoreElement({ id: elId, type: 'file', x: elX, y: elY, w: elW, h: elH, data: data });
          if (newEl) newEl.style.zIndex = elZ;
        }
      } else if (!fd.isVideo) {
        // Même type fichier : mettre à jour le visuel en place
        var nameDiv = el.querySelector('.file-name');
        var sizeDiv = el.querySelector('.file-size');
        if (nameDiv && fd.name) nameDiv.textContent = fd.name;
        if (sizeDiv && fd.size) sizeDiv.textContent = fd.size;
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
      setTimeout(() => App._collabCreateConnection(data.from, data.to, connId), 100);
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
        style: data.style || null,
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
      // Style
      if (data.style) {
        if (data.style.fontSize) cap.style.fontSize = data.style.fontSize;
        if (data.style.fontFamily) { cap.style.fontFamily = data.style.fontFamily; _loadGFontIfNeeded(data.style.fontFamily); }
        if (data.style.fontWeight) cap.style.fontWeight = data.style.fontWeight;
        if (data.style.textAlign) cap.style.textAlign = data.style.textAlign;
      }
    }
  }

  function _onCaptionRemoved(snap) {
    const capId = snap.key;
    const cap = document.querySelector('[data-cap-id="' + capId + '"]');
    if (cap) cap.remove();
  }

  // ── META HANDLER ──────────────────────────────────────────────────────

  function _onMetaActiveChanged() {
    // La session est toujours active — ne rien faire
  }

  // ── CURSEURS DISTANTS (DOM + RAF) ─────────────────────────────────────

  function _createRemoteCursor(uid, color) {
    const container = document.getElementById('collab-cursors');
    if (!container) return;
    // Filet : une présence sans couleur donnerait fill="undefined", que le SVG
    // interprète comme noir. On retombe sur la couleur déterministe du user.
    if (!color) color = COLORS[_hashStr(uid) % COLORS.length];
    const div = document.createElement('div');
    div.className = 'collab-cursor';
    div.dataset.userId = uid;
    div.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 48 48">' +
      '<polygon fill="#fff" points="9.33 6.2 36.21 29.13 20.7 30.84 9.33 41.53 9.33 6.2"/>' +
      '<path fill="' + color + '" d="M11.83,11.62l18.36,15.66-8.93.99-1.66.18-1.22,1.14-6.56,6.16V11.62M7.59,1.68c-.13,0-.26.03-.35.08-.2.1-.41.36-.41.66v43.1c0,.36.19.62.45.74.09.04.2.07.31.07.17,0,.34-.05.48-.18l13.74-12.9,18.66-2.07c.36-.06.59-.25.68-.55.08-.25-.02-.58-.28-.81L8.07,1.85c-.14-.12-.31-.16-.48-.16h0Z"/>' +
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

      c.curX = _lerp(c.curX, screenTargetX, 0.5);
      c.curY = _lerp(c.curY, screenTargetY, 0.5);

      if (Math.abs(c.curX - screenTargetX) > 0.5 || Math.abs(c.curY - screenTargetY) > 0.5) {
        anyActive = true;
      }

      c.el.style.transform = 'translate(' + c.curX + 'px,' + c.curY + 'px)';
    });

    if (anyActive) {
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
      const newX = _lerp(curX, target.x, 0.5);
      const newY = _lerp(curY, target.y, 0.5);

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
    // Dériver depuis _remoteCursors (source de vérité) + 1 pour l'utilisateur local
    const total = Object.keys(_remoteCursors).length + 1;
    if (countEl) countEl.textContent = total + ' utilisateur' + (total > 1 ? 's' : '');
  }

  function _hideStatusBar() {
    const bar = document.getElementById('collab-status-bar');
    if (bar) bar.classList.add('hidden');
  }

  // ── MERGE SESSION → LOCAL (owner only) ────────────────────────────────

  async function _mergeSessionToLocal(sessionRef, boardId) {
    if (!sessionRef) return;
    try {
      const elemSnap = await sessionRef.child('elements').get();
      if (!elemSnap.exists()) return;
      const elements = [];
      elemSnap.forEach((child) => {
        const d = child.val();
        if (d.deleted) return;
        var elData = d.data || '';
        if (d.type === 'image' && App._imgStoreGet) {
          var localBase64 = App._imgStoreGet(child.key);
          if (localBase64) elData = localBase64;
        }
        elements.push({
          id: child.key,
          type: d.type,
          x: d.x,
          y: d.y,
          w: d.w != null ? d.w : null,
          h: d.h != null ? d.h : null,
          z: d.z != null ? d.z : null,
          data: elData,
          style: d.style || null,
        });
      });
      // Ajouter les connexions
      const connSnap = await sessionRef.child('connections').get();
      if (connSnap.exists()) {
        connSnap.forEach((child) => {
          const d = child.val();
          elements.push({ type: 'connection', from: d.from, to: d.to, connId: child.key });
        });
      }
      // Ajouter les captions
      const capSnap = await sessionRef.child('captions').get();
      if (capSnap.exists()) {
        capSnap.forEach((child) => {
          const d = child.val();
          elements.push({
            type: 'caption',
            capId: child.key,
            x: d.x,
            y: d.y,
            width: d.width,
            parentId: d.parentId,
            text: d.text,
            style: d.style || null,
          });
        });
      }
      // Mettre à jour le board local via App
      if (typeof App !== 'undefined' && typeof App._collabMergeElements === 'function') {
        App._collabMergeElements(boardId, elements);
      }
    } catch (e) {
      // Merge best-effort : la copie locale reste la source de vérité
    }
  }

  function deleteSession(boardId) {
    if (!boardId || !window._fbDb) return Promise.resolve();
    return window._fbDb.ref('collabSessions/' + boardId).remove();
  }

  // ── API PUBLIQUE ──────────────────────────────────────────────────────

  return {
    // Lifecycle
    startSession: startSession,
    endSession: endSession,
    deleteSession: deleteSession,
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
    syncElementStyle: syncElementStyle,
    syncElementCreate: syncElementCreate,
    syncElementDelete: syncElementDelete,
    syncElementZ: syncElementZ,
    syncConnection: syncConnection,
    syncConnectionDelete: syncConnectionDelete,
    syncCaption: syncCaption,
    syncCaptionPosition: syncCaptionPosition,
    syncCaptionText: syncCaptionText,
    syncCaptionDelete: syncCaptionDelete,
    syncCaptionStyle: syncCaptionStyle,

    // Undo support
    getElementVersion: getElementVersion,
    wasModifiedSince: wasModifiedSince,
  };
})();
