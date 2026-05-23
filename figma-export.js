(function () {
  'use strict';

  /* ── Helpers ──────────────────────────────────────────────── */

  function px(val) {
    return parseFloat(val) || 0;
  }

  function getColor(val) {
    if (!val || val === 'transparent' || val === 'rgba(0, 0, 0, 0)') return null;
    return val;
  }

  function parseShadows(css) {
    if (!css || css === 'none') return [];
    var results = [];
    var re =
      /(-?\d+(?:\.\d+)?px)\s+(-?\d+(?:\.\d+)?px)\s+(-?\d+(?:\.\d+)?px)(?:\s+(-?\d+(?:\.\d+)?px))?\s+(rgba?\([^)]+\)|#[0-9a-fA-F]+|\w+)/g;
    var m;
    while ((m = re.exec(css)) !== null) {
      results.push({
        offsetX: px(m[1]),
        offsetY: px(m[2]),
        blur: px(m[3]),
        spread: m[4] ? px(m[4]) : 0,
        color: m[5],
      });
    }
    return results;
  }

  function parseBorderRadius(s) {
    return {
      tl: px(s.borderTopLeftRadius),
      tr: px(s.borderTopRightRadius),
      br: px(s.borderBottomRightRadius),
      bl: px(s.borderBottomLeftRadius),
    };
  }

  function extractBorder(s) {
    var w = px(s.borderWidth) || px(s.borderTopWidth);
    if (!w) return null;
    return { width: w, color: s.borderColor || s.borderTopColor, style: s.borderStyle || 'solid' };
  }

  function getImageSrc(el) {
    if (el.tagName === 'IMG' && el.src) return el.src;
    var bg = window.getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none') {
      var m = bg.match(/url\(["']?(.+?)["']?\)/);
      if (m) return m[1];
    }
    // SVG → sérialiser comme data URL pour capturer les icônes
    if (el.tagName.toLowerCase() === 'svg') {
      try {
        var clone = el.cloneNode(true);
        var r = el.getBoundingClientRect();
        if (r.width > 0) clone.setAttribute('width', r.width);
        if (r.height > 0) clone.setAttribute('height', r.height);
        var computedColor = window.getComputedStyle(el).color || '#000';
        var str = new XMLSerializer().serializeToString(clone);
        str = str.replace(/currentColor/g, computedColor);
        return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(str)));
      } catch (e) {}
    }
    return null;
  }

  // Extrait les styles CSS :hover applicables à un élément
  function extractHoverStyles(el) {
    var result = {};
    try {
      for (var si = 0; si < document.styleSheets.length; si++) {
        var rules;
        try {
          rules = document.styleSheets[si].cssRules;
        } catch (e) {
          continue;
        }
        if (!rules) continue;
        for (var ri = 0; ri < rules.length; ri++) {
          var rule = rules[ri];
          if (!rule.selectorText || rule.selectorText.indexOf(':hover') === -1) continue;
          var sel = rule.selectorText.replace(/:hover/g, '').trim();
          if (!sel) continue;
          try {
            if (el.matches(sel)) {
              for (var pi = 0; pi < rule.style.length; pi++) {
                var prop = rule.style[pi];
                result[prop] = rule.style.getPropertyValue(prop);
              }
            }
          } catch (e2) {}
        }
      }
    } catch (e) {}
    return Object.keys(result).length > 0 ? result : null;
  }

  // Résout line-height en pixels réels
  function resolveLineHeight(lh, fontSize) {
    if (!lh || lh === 'normal') return Math.round(fontSize * 1.2);
    if (lh.indexOf('px') !== -1) return px(lh);
    var n = parseFloat(lh);
    if (!isNaN(n)) return Math.round(n * fontSize); // multiplicateur
    return Math.round(fontSize * 1.2);
  }

  function isVisible(el) {
    var s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || px(s.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    // Garder les éléments avec width OU height > 0
    return r.width > 0 || r.height > 0;
  }

  var SKIP_TAGS = { script: 1, style: 1, meta: 1, link: 1, head: 1, noscript: 1, br: 1, hr: 1 };

  /* ── Extraction d'un nœud ─────────────────────────────────── */

  function extractNode(el, parentRect, insideBoard) {
    if (!el || el.nodeType !== 1) return null;
    if (SKIP_TAGS[el.tagName.toLowerCase()]) return null;
    if (!isVisible(el)) return null;

    var s = window.getComputedStyle(el);
    var r = el.getBoundingClientRect();
    var base = parentRect || { left: 0, top: 0 };

    var tag = el.tagName.toLowerCase();

    // Texte direct (nœuds texte enfants immédiats)
    var directText = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) directText += n.textContent;
    }
    directText = directText.trim();

    // Input / textarea : placeholder ou value
    var inputText = null;
    var isPlaceholder = false;
    if (tag === 'input' || tag === 'textarea') {
      if (el.value) {
        inputText = el.value;
      } else if (el.placeholder) {
        inputText = el.placeholder;
        isPlaceholder = true;
      }
    }

    var finalText = directText || inputText || null;

    var fontSize = px(s.fontSize);
    var fontWeight = s.fontWeight; // '400', '700', etc.
    var lineHeightPx = resolveLineHeight(s.lineHeight, fontSize);

    // Alignement horizontal du texte
    var textAlign = s.textAlign;
    if (textAlign === 'start') textAlign = 'left';
    if (textAlign === 'end') textAlign = 'right';
    if (textAlign === '-webkit-center') textAlign = 'center';

    // Layout flex (pour comprendre centrage vertical)
    var display = s.display;
    var isFlex = display === 'flex' || display === 'inline-flex';
    var flexDirection = isFlex ? s.flexDirection : null;
    var alignItems = isFlex ? s.alignItems : null; // cross-axis (vertical en row)
    var justifyContent = isFlex ? s.justifyContent : null; // main-axis
    var gap = isFlex ? px(s.gap || s.columnGap) : 0;

    // Padding
    var paddingTop = px(s.paddingTop);
    var paddingRight = px(s.paddingRight);
    var paddingBottom = px(s.paddingBottom);
    var paddingLeft = px(s.paddingLeft);

    var node = {
      id: el.id || null,
      cls: typeof el.className === 'string' ? el.className : null,
      dataType: (el.dataset && el.dataset.type) ? el.dataset.type : null,
      isContentNode: !!insideBoard,
      tag: tag,
      x: Math.round(r.left - base.left),
      y: Math.round(r.top - base.top),
      width: Math.round(r.width),
      height: Math.round(r.height),

      // Fond
      background: getColor(s.backgroundColor),
      backgroundImage: null,
      _imgSrc: getImageSrc(el),

      // Texte
      text: finalText,
      isPlaceholder: isPlaceholder,
      fontSize: fontSize,
      fontFamily: s.fontFamily,
      fontWeight: fontWeight,
      lineHeight: lineHeightPx,
      letterSpacing: s.letterSpacing,
      textAlign: textAlign,
      color: getColor(s.color),

      // Forme
      borderRadius: parseBorderRadius(s),
      border: extractBorder(s),
      opacity: px(s.opacity),
      boxShadow: parseShadows(s.boxShadow),
      overflow: s.overflow,

      // Box model
      paddingTop: paddingTop,
      paddingRight: paddingRight,
      paddingBottom: paddingBottom,
      paddingLeft: paddingLeft,

      // Layout
      display: display,
      isFlex: isFlex,
      flexDirection: flexDirection,
      alignItems: alignItems, // center / flex-start / flex-end / stretch
      justifyContent: justifyContent,
      gap: gap,

      // Stacking
      zIndex: parseInt(s.zIndex) || 0,
      position: s.position,

      // États hover (pour variants Figma)
      hoverStyles: extractHoverStyles(el),

      _absX: Math.round(r.left),
      _absY: Math.round(r.top),
      children: [],
    };

    // Propager le flag "contenu de board-element" aux enfants
    var isBoardNow = insideBoard || (el.classList && el.classList.contains('board-element'));
    for (var j = 0; j < el.children.length; j++) {
      var child = extractNode(el.children[j], r, isBoardNow);
      if (child) node.children.push(child);
    }

    return node;
  }

  /* ── Conversion images en base64 ─────────────────────────── */

  function imgToBase64(url) {
    return new Promise(function (resolve) {
      if (!url || url.startsWith('data:')) {
        resolve(url);
        return;
      }
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = img.naturalWidth || img.width;
          c.height = img.naturalHeight || img.height;
          c.getContext('2d').drawImage(img, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch (e) {
          resolve(url);
        }
      };
      img.onerror = function () {
        resolve(url);
      };
      img.src = url;
    });
  }

  function resolveImages(node) {
    var promises = [];
    function walk(n) {
      if (!n) return;
      if (n._imgSrc) {
        promises.push(
          imgToBase64(n._imgSrc).then(function (b64) {
            n.backgroundImage = b64;
          })
        );
      }
      delete n._imgSrc;
      (n.children || []).forEach(walk);
    }
    walk(node);
    return Promise.all(promises);
  }

  /* ── Téléchargement ──────────────────────────────────────── */

  function download(payload) {
    var json = JSON.stringify(payload, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'moodboard-export-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log('[figma-export] ✅ Export OK — ' + json.length + ' chars');
  }

  /* ── Point d'entrée ─────────────────────────────────────── */

  // Toujours partir de body pour capturer sidebar + toolbar + canvas
  var rootEl = document.body;

  console.log('[figma-export] Root :', rootEl.tagName);
  var tree = extractNode(rootEl, null);

  resolveImages(tree).then(function () {
    download({
      meta: {
        exportedAt: new Date().toISOString(),
        url: location.href,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        rootElement: rootEl.id || rootEl.tagName,
        devicePixelRatio: window.devicePixelRatio,
      },
      tree: tree,
    });
  });
})();
