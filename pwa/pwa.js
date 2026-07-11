// ── Firebase init ─────────────────────────────────────────────────────────
firebase.initializeApp({
  apiKey: 'AIzaSyBX9Su8qOUfTPjXkVvioA6i5pQBk9f6GMs',
  authDomain: 'moodboard-app-b21b9.firebaseapp.com',
  databaseURL: 'https://moodboard-app-b21b9-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'moodboard-app-b21b9',
  storageBucket: 'moodboard-app-b21b9.firebasestorage.app',
  messagingSenderId: '467105545598',
  appId: '1:467105545598:web:72fceeaa8c4d0c949b472f',
});

var _db   = firebase.database();
var _auth = firebase.auth();
var _user = null;          // firebase.User — non-anonymous Google user
var _pinnedBoards = {};    // { boardId: { name, thumb, savedAt } }
var _activityDots = {};    // { boardId: bool } — nouveau depuis dernière visite
var _lastVisit = parseInt(localStorage.getItem('pwa_last_visit') || '0', 10);
var _inboxListeners = [];  // pour détacher à la déconnexion
var _activityListeners = [];

// ── Service Worker ─────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/pwa/sw.js').catch(function () {});
  navigator.serviceWorker.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'share-received') {
      _handleShareReceived(e.data.payload);
    }
  });
}

// ── Navigation ─────────────────────────────────────────────────────────────
var _currentScreen = 'home';

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
  var el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(function (b) {
    b.classList.toggle('active', b.dataset.screen === name);
  });
  _currentScreen = name;
  if (name === 'inbox') _renderInboxScreen();
  if (name === 'activity') _renderActivityScreen();
}

document.querySelectorAll('.tab-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    showScreen(btn.dataset.screen);
  });
});

document.getElementById('viewer-back-btn').addEventListener('click', function () {
  showScreen('home');
});

// ── Auth ───────────────────────────────────────────────────────────────────
document.getElementById('auth-google-btn').addEventListener('click', function () {
  var provider = new firebase.auth.GoogleAuthProvider();
  _auth.signInWithPopup(provider).catch(function (err) {
    alert('Connexion annulée : ' + err.message);
  });
});

_auth.onAuthStateChanged(function (user) {
  if (user && !user.isAnonymous) {
    _user = user;
    document.getElementById('screen-auth').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    _onSignedIn();
  } else {
    _user = null;
    document.getElementById('screen-auth').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    _teardownListeners();
  }
});

function _onSignedIn() {
  _updateProfileScreen();
  _loadPinnedBoards();
  _setupInboxBadge();
}

function _teardownListeners() {
  _inboxListeners.forEach(function (fn) { fn(); });
  _inboxListeners = [];
  _activityListeners.forEach(function (fn) { fn(); });
  _activityListeners = [];
}

// ── Accueil — boards épinglés ──────────────────────────────────────────────
function _loadPinnedBoards() {
  if (!_user) return;
  _db.ref('users/' + _user.uid + '/pinned_boards').on('value', function (snap) {
    _pinnedBoards = snap.exists() ? snap.val() : {};
    _renderHomeGrid();
    _setupActivityListener();
  });
}

function _timeAgo(ts) {
  var diff = Date.now() - ts;
  var m = Math.floor(diff / 60000);
  if (m < 2) return 'à l\'instant';
  if (m < 60) return 'il y a ' + m + ' min';
  var h = Math.floor(m / 60);
  if (h < 24) return 'il y a ' + h + 'h';
  return 'il y a ' + Math.floor(h / 24) + 'j';
}

function _renderHomeGrid() {
  var grid = document.getElementById('boards-grid');
  var ids = Object.keys(_pinnedBoards);
  if (ids.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--fg2);font-size:14px">Aucun board épinglé.<br><br>Ouvre un board dans l\'extension et clique sur l\'icône <strong>monitor</strong> pour l\'épingler.</div>';
    return;
  }
  grid.innerHTML = '';
  ids.forEach(function (id) {
    var b = _pinnedBoards[id];
    var card = document.createElement('div');
    card.className = 'board-card';
    card.dataset.id = id;
    var hasThumb = b.thumb && b.thumb.length > 10;
    var hasDot = !!_activityDots[id];
    card.innerHTML = (hasThumb
      ? '<img src="' + b.thumb + '" alt="">'
      : '<div class="board-card-empty">🎨</div>'
    ) + '<div class="board-card-info">'
      + '<div class="board-card-name">' + _esc(b.name || 'Sans titre') + '</div>'
      + '<div class="board-card-date">' + _timeAgo(b.savedAt || Date.now()) + '</div>'
      + '</div>'
      + '<div class="board-card-dot' + (hasDot ? ' visible' : '') + '"></div>';
    card.addEventListener('click', function () {
      _openBoardViewer(id, b.name || 'Sans titre');
    });
    grid.appendChild(card);
  });
}

function _esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Profil ─────────────────────────────────────────────────────────────────
function _updateProfileScreen() {
  if (!_user) return;
  var av = document.getElementById('profile-avatar');
  var nm = document.getElementById('profile-name');
  var em = document.getElementById('profile-email');
  if (_user.photoURL) av.src = _user.photoURL; else av.style.display = 'none';
  if (nm) nm.textContent = _user.displayName || '';
  if (em) em.textContent = _user.email || '';
}

document.getElementById('profile-signout-btn').addEventListener('click', function () {
  if (confirm('Se déconnecter ?')) _auth.signOut();
});

// ── Board Viewer ────────────────────────────────────────────────────────────
var _viewerBoardId = null;

function _openBoardViewer(boardId, name) {
  _viewerBoardId = boardId;
  document.getElementById('viewer-title').textContent = name;
  var canvas = document.getElementById('viewer-canvas');
  canvas.innerHTML = '<div class="pwa-loading">Chargement…</div>';
  _viewerResetTransform();
  showScreen('viewer');
  _db.ref('users/' + _user.uid + '/boards/' + boardId).once('value').then(function (snap) {
    if (!snap.exists()) {
      canvas.innerHTML = '<div class="pwa-loading">Board introuvable.</div>';
      return;
    }
    var data = snap.val();
    canvas.innerHTML = '';
    (data.elements || []).forEach(function (el) {
      var node = _renderBoardElement(el);
      if (node) canvas.appendChild(node);
    });
  }).catch(function () {
    canvas.innerHTML = '<div class="pwa-loading">Erreur de chargement.</div>';
  });
}

function _renderBoardElement(el) {
  var type = el.type;
  var style = 'left:' + el.x + 'px;top:' + el.y + 'px;'
    + (el.w ? 'width:' + el.w + 'px;' : '')
    + (el.h ? 'height:' + el.h + 'px;' : '')
    + 'z-index:' + (el.z || 100) + ';';

  if (type === 'note') {
    var div = document.createElement('div');
    div.className = 'pwa-el note';
    div.style.cssText = style;
    div.innerHTML = el.data || '';
    if (el.style) {
      if (el.style.fontFamily) div.style.fontFamily = el.style.fontFamily;
      if (el.style.fontSize) div.style.fontSize = el.style.fontSize;
      if (el.style.fontWeight) div.style.fontWeight = el.style.fontWeight;
      if (el.style.textAlign) div.style.textAlign = el.style.textAlign;
    }
    return div;

  } else if (type === 'color') {
    var div = document.createElement('div');
    div.className = 'pwa-el color';
    div.style.cssText = style + 'background:' + (el.data || '#888') + ';';
    div.innerHTML = '<span class="color-hex">' + _esc(el.data || '') + '</span>';
    return div;

  } else if (type === 'link') {
    var d = {};
    try { d = JSON.parse(el.data); } catch (e) {}
    var div = document.createElement('div');
    div.className = 'pwa-el link';
    div.style.cssText = style;
    div.innerHTML = (d.img ? '<img class="link-thumb" src="' + _esc(d.img) + '" alt="">' : '')
      + '<div class="link-info">'
      + '<div class="link-title">' + _esc(d.title || d.url || '') + '</div>'
      + '<div class="link-url">' + _esc(d.url || '') + '</div>'
      + '</div>';
    div.addEventListener('click', function () {
      if (d.url) window.open(d.url, '_blank', 'noopener');
    });
    return div;

  } else if (type === 'image') {
    if (!el.data) return null; // image sans data → ignorer
    var img = document.createElement('img');
    img.className = 'pwa-el image-el';
    img.style.cssText = style + 'object-fit:contain;';
    img.src = el.data;
    img.addEventListener('click', function () { _openLightbox(el.data); });
    return img;

  } else if (type === 'caption') {
    var div = document.createElement('div');
    div.className = 'pwa-el caption';
    div.style.cssText = 'left:' + el.x + 'px;top:' + el.y + 'px;z-index:' + (el.z || 100) + ';';
    if (el.width) div.style.width = el.width;
    div.textContent = el.text || '';
    if (el.style && el.style.fontFamily) div.style.fontFamily = el.style.fontFamily;
    return div;
  }

  return null; // connection et autres : ignorés
}

function _openLightbox(src) {
  var lb = document.getElementById('lightbox');
  var img = document.getElementById('lightbox-img');
  img.src = src;
  lb.classList.add('open');
  lb.onclick = function () { lb.classList.remove('open'); img.src = ''; };
}

// ── Viewer transform ────────────────────────────────────────────────────────
var _vx = 0, _vy = 0, _vz = 1;
var _vDragStart = null;
var _vPinchDist = 0;

function _viewerResetTransform() {
  _vx = 0; _vy = 0; _vz = 1;
  _applyViewerTransform();
}

function _applyViewerTransform() {
  var c = document.getElementById('viewer-canvas');
  if (c) c.style.transform = 'translate(' + _vx + 'px,' + _vy + 'px) scale(' + _vz + ')';
}

function _pinchDist(touches) {
  var dx = touches[0].clientX - touches[1].clientX;
  var dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

var _wrap = document.getElementById('viewer-wrap');
_wrap.addEventListener('touchstart', function (e) {
  if (e.touches.length === 1) {
    _vDragStart = { x: e.touches[0].clientX - _vx, y: e.touches[0].clientY - _vy };
  } else if (e.touches.length === 2) {
    _vPinchDist = _pinchDist(e.touches);
    _vDragStart = null;
  }
}, { passive: true });

_wrap.addEventListener('touchmove', function (e) {
  e.preventDefault();
  if (e.touches.length === 1 && _vDragStart) {
    _vx = e.touches[0].clientX - _vDragStart.x;
    _vy = e.touches[0].clientY - _vDragStart.y;
    _applyViewerTransform();
  } else if (e.touches.length === 2) {
    var dist = _pinchDist(e.touches);
    var ratio = dist / _vPinchDist;
    _vz = Math.min(Math.max(_vz * ratio, 0.2), 5);
    _vPinchDist = dist;
    _applyViewerTransform();
  }
}, { passive: false });

_wrap.addEventListener('touchend', function () { _vDragStart = null; });

// ── Inbox ───────────────────────────────────────────────────────────────────
function _setupInboxBadge() {
  if (!_user) return;
  var ref = _db.ref('users/' + _user.uid + '/inbox');
  var handler = ref.on('value', function (snap) {
    var count = 0;
    if (snap.exists()) {
      snap.forEach(function (child) { if (!child.val().imported) count++; });
    }
    var badge = document.getElementById('inbox-tab-badge');
    if (badge) {
      badge.textContent = count > 0 ? count : '';
      badge.classList.toggle('visible', count > 0);
    }
    if (_currentScreen === 'inbox') _renderInboxScreen();
  });
  _inboxListeners.push(function () { ref.off('value', handler); });
}

function _renderInboxScreen() {
  if (!_user) return;
  var scroll = document.getElementById('inbox-scroll');
  _db.ref('users/' + _user.uid + '/inbox').once('value').then(function (snap) {
    var items = [];
    if (snap.exists()) {
      snap.forEach(function (child) {
        var v = child.val();
        if (!v.imported) items.push(Object.assign({ _key: child.key }, v));
      });
    }
    if (items.length === 0) {
      scroll.innerHTML = '<div class="inbox-empty">Rien pour l\'instant — partage une image<br>depuis Safari ou Photos pour commencer.</div>';
      return;
    }
    scroll.innerHTML = '';
    items.forEach(function (item) {
      var div = document.createElement('div');
      div.className = 'inbox-item';
      var isImg = item.type === 'image';
      div.innerHTML = (isImg
        ? '<img class="inbox-thumb" src="' + _esc(item.data || '') + '" alt="">'
        : '<div class="inbox-thumb">🔗</div>'
      ) + '<div class="inbox-item-info">'
        + '<div class="inbox-item-label">' + _esc(isImg ? 'Image' : (item.url || 'Lien')) + '</div>'
        + '<div class="inbox-item-date">' + (item.addedAt ? _timeAgo(item.addedAt) : '') + '</div>'
        + '</div>';
      scroll.appendChild(div);
    });
  });
}

// ── Ajouter depuis iPhone ───────────────────────────────────────────────────
document.getElementById('inbox-add-image-btn').addEventListener('click', function () {
  document.getElementById('inbox-file-input').click();
});

document.getElementById('inbox-file-input').addEventListener('change', function (e) {
  var file = e.target.files && e.target.files[0];
  if (!file || !_user) return;
  var reader = new FileReader();
  reader.onload = function () {
    _db.ref('users/' + _user.uid + '/inbox').push({
      type: 'image',
      data: reader.result,
      addedAt: Date.now(),
      imported: false,
    }).catch(function () { alert('Erreur d\'envoi.'); });
    e.target.value = '';
  };
  reader.readAsDataURL(file);
});

document.getElementById('inbox-add-url-btn').addEventListener('click', function () {
  var url = prompt('URL à capturer :');
  if (!url || !_user) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  _db.ref('users/' + _user.uid + '/inbox').push({
    type: 'url',
    url: url,
    addedAt: Date.now(),
    imported: false,
  }).catch(function () { alert('Erreur d\'envoi.'); });
});

// ── Share target (depuis Share Sheet iOS) ──────────────────────────────────
function _handleShareReceived(payload) {
  if (!_user) return;
  var item = {
    type: payload.type || 'url',
    addedAt: Date.now(),
    imported: false,
  };
  if (payload.type === 'image' && payload.data) {
    item.data = payload.data;
  } else {
    item.url = payload.url || payload.title || '';
  }
  _db.ref('users/' + _user.uid + '/inbox').push(item).catch(function () {});
  showScreen('inbox');
}

// ── Journal d'activité ──────────────────────────────────────────────────────
var _allActivity = []; // [ { boardId, boardName, ...event } ]

function _setupActivityListener() {
  // Détacher les anciens listeners activité
  _activityListeners.forEach(function (fn) { fn(); });
  _activityListeners = [];
  if (!_user) return;
  _allActivity = [];
  var ids = Object.keys(_pinnedBoards);
  ids.forEach(function (boardId) {
    var ref = _db.ref('boards/' + boardId + '/activity');
    var handler = ref.on('value', function (snap) {
      _allActivity = _allActivity.filter(function (e) { return e.boardId !== boardId; });
      if (snap.exists()) {
        snap.forEach(function (child) {
          var v = child.val();
          _allActivity.push(Object.assign({ boardId: boardId, boardName: (_pinnedBoards[boardId] || {}).name || '' }, v));
        });
      }
      _activityDots[boardId] = _allActivity.some(function (e) {
        return e.boardId === boardId && (e.at || 0) > _lastVisit;
      });
      _renderHomeGrid();
      if (_currentScreen === 'activity') _renderActivityScreen();
    });
    _activityListeners.push(function () { ref.off('value', handler); });
  });
}

function _renderActivityScreen() {
  var scroll = document.getElementById('activity-scroll');
  // Trier par date décroissante
  var sorted = _allActivity.slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  // Mettre à jour _lastVisit
  _lastVisit = Date.now();
  localStorage.setItem('pwa_last_visit', String(_lastVisit));
  // Effacer les dots
  Object.keys(_activityDots).forEach(function (id) { _activityDots[id] = false; });
  _renderHomeGrid();

  if (sorted.length === 0) {
    scroll.innerHTML = '<div class="activity-empty">Aucune activité récente.<br>Les modifications des boards partagés apparaîtront ici.</div>';
    return;
  }
  scroll.innerHTML = '';
  sorted.slice(0, 50).forEach(function (ev) {
    var div = document.createElement('div');
    div.className = 'activity-item';
    div.innerHTML = (ev.photoURL
      ? '<img class="activity-avatar" src="' + _esc(ev.photoURL) + '" alt="">'
      : '<div class="activity-avatar">👤</div>'
    ) + '<div class="activity-text">'
      + '<div><strong>' + _esc(ev.displayName || 'Quelqu\'un') + '</strong> a modifié <strong>' + _esc(ev.boardName || '') + '</strong></div>'
      + '<div class="activity-time">' + (ev.at ? _timeAgo(ev.at) : '') + '</div>'
      + '</div>';
    var bid = ev.boardId;
    div.addEventListener('click', function () {
      _openBoardViewer(bid, (_pinnedBoards[bid] || {}).name || 'Board');
    });
    scroll.appendChild(div);
  });
}
