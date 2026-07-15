(function () {
  if (window.__mbCaptureLoaded === true) return;
  window.__mbCaptureLoaded = true;

  let captureActive = false;
  let currentBoardId = null;
  let floatingBtn = null;
  let overlay = null;
  let badge = null;
  let currentHoveredImg = null;
  let currentHoveredSrc = null;

  function findImageAt(x, y) {
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      if (el.tagName === 'IMG') {
        const src = el.currentSrc || el.src || '';
        const rect = el.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0;
        if (
          src &&
          (el.naturalWidth > 0 || visible) &&
          !src.startsWith('data:image/svg') &&
          !(src.startsWith('data:') && src.length < 200)
        ) {
          return { el, src };
        }
      } else {
        const bg = getComputedStyle(el).backgroundImage;
        const match = bg && bg.match(/url\(['"]?(.+?)['"]?\)/);
        if (match) {
          const bgUrl = match[1];
          if (bgUrl.startsWith('http') || bgUrl.startsWith('data:image')) {
            return { el, src: bgUrl };
          }
        }
      }
    }
    return null;
  }

  function findImageFromTarget(target) {
    let node = target;
    while (node && node.tagName !== 'BODY') {
      if (node.tagName === 'IMG') {
        const src = node.currentSrc || node.src || '';
        if (src && !src.startsWith('data:image/svg') && !(src.startsWith('data:') && src.length < 200)) {
          return { el: node, src };
        }
      }
      const bg = getComputedStyle(node).backgroundImage;
      const match = bg && bg.match(/url\(['"]?(.+?)['"]?\)/);
      if (match) {
        const bgUrl = match[1];
        if (bgUrl.startsWith('http') || bgUrl.startsWith('data:image')) {
          return { el: node, src: bgUrl };
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  function positionOverlay() {
    if (!currentHoveredImg || !overlay) return;
    const rect = currentHoveredImg.getBoundingClientRect();
    if (
      rect.width === 0 || rect.height === 0 ||
      rect.bottom < 0 || rect.top > window.innerHeight ||
      rect.right < 0 || rect.left > window.innerWidth
    ) {
      overlay.style.opacity = '0';
      return;
    }
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.opacity = '1';
  }

  function handleMouseMove(e) {
    const result = findImageAt(e.clientX, e.clientY);
    if (result) {
      currentHoveredImg = result.el;
      currentHoveredSrc = result.src;
      positionOverlay();
    } else {
      currentHoveredImg = null;
      currentHoveredSrc = null;
      if (overlay) overlay.style.opacity = '0';
    }
  }

  function handleMouseOver(e) {
    if (!captureActive) return;
    const result = findImageFromTarget(e.target);
    if (result) {
      currentHoveredImg = result.el;
      currentHoveredSrc = result.src;
      positionOverlay();
    }
  }

  function handleScroll() {
    if (!currentHoveredImg) {
      if (overlay) overlay.style.opacity = '0';
      return;
    }
    positionOverlay();
  }

  function captureCurrentImage(e) {
    if (!captureActive) return;
    let result = findImageAt(e.clientX, e.clientY);
    if (!result) result = findImageFromTarget(e.target);
    if (!result && currentHoveredImg && currentHoveredSrc) {
      result = { el: currentHoveredImg, src: currentHoveredSrc };
    }
    if (!result) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    chrome.runtime.sendMessage({ type: 'MB_CAPTURE_IMAGE', boardId: currentBoardId, imageUrl: result.src }).catch(() => {});

    badge.textContent = '✓';
    setTimeout(() => { badge.textContent = '+'; }, 600);
  }

  function handleMouseDown(e) {
    if (!captureActive || e.button !== 0 || !e.ctrlKey) return;
    captureCurrentImage(e);
  }

  function handleClick(e) {
    if (!captureActive || !e.ctrlKey) return;
    let result = findImageAt(e.clientX, e.clientY);
    if (!result) result = findImageFromTarget(e.target);
    if (!result && currentHoveredImg && currentHoveredSrc) result = { el: currentHoveredImg, src: currentHoveredSrc };
    if (!result) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      chrome.runtime.sendMessage({ type: 'MB_CAPTURE_STOP_FROM_PAGE' }).catch(() => {});
      deactivate();
    }
  }

  function activate(boardId) {
    captureActive = true;
    currentBoardId = boardId;

    overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;top:0;left:0;pointer-events:none;border:3px solid #ff3c00;' +
      'box-sizing:border-box;opacity:0;transition:opacity 0.12s;z-index:2147483646;';

    badge = document.createElement('div');
    badge.textContent = '+';
    badge.style.cssText =
      'position:absolute;top:-12px;right:-12px;width:24px;height:24px;' +
      'border-radius:50%;background:#ff3c00;color:#fff;font-size:16px;font-weight:bold;' +
      'line-height:24px;text-align:center;pointer-events:none;';
    overlay.appendChild(badge);
    document.documentElement.appendChild(overlay);

    floatingBtn = document.createElement('button');
    floatingBtn.textContent = 'Quitter le mode capture (Echap)';
    floatingBtn.style.cssText =
      'position:fixed;top:12px;left:50%;transform:translateX(-50%);' +
      'background:#ff3c00;color:#fff;font-size:12px;font-family:Arial,sans-serif;' +
      'padding:6px 12px;border:none;border-radius:0;cursor:pointer;' +
      'pointer-events:auto;z-index:2147483647;';
    floatingBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'MB_CAPTURE_STOP_FROM_PAGE' }).catch(() => {});
      deactivate();
    });
    document.documentElement.appendChild(floatingBtn);

    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('mouseover', handleMouseOver, true);
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
  }

  function deactivate() {
    captureActive = false;
    currentBoardId = null;
    currentHoveredImg = null;
    currentHoveredSrc = null;

    if (overlay) { overlay.remove(); overlay = null; badge = null; }
    if (floatingBtn) { floatingBtn.remove(); floatingBtn = null; }

    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('mouseover', handleMouseOver, true);
    window.removeEventListener('scroll', handleScroll, true);
    document.removeEventListener('mousedown', handleMouseDown, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);

    if (window.__mbCaptureListener) {
      chrome.runtime.onMessage.removeListener(window.__mbCaptureListener);
      window.__mbCaptureListener = null;
    }
    window.__mbCaptureLoaded = false;
  }

  if (window.__mbCaptureListener) {
    chrome.runtime.onMessage.removeListener(window.__mbCaptureListener);
  }

  function messageListener(msg) {
    if (msg.type === 'MB_CAPTURE_ENABLE') activate(msg.boardId);
    else if (msg.type === 'MB_CAPTURE_DISABLE') deactivate();
    else if (msg.type === 'MB_CAPTURE_UPDATE_BOARD') currentBoardId = msg.boardId;
  }
  window.__mbCaptureListener = messageListener;
  chrome.runtime.onMessage.addListener(messageListener);
})();
