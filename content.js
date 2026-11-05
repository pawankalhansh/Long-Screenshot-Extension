// Clean up previous instance if re-injected
if (window.__lsCaptureInstance && typeof window.__lsCaptureInstance.destroy === 'function') {
  window.__lsCaptureInstance.destroy();
}

(function () {
  let overlayHost = null;
  let shadowRoot = null;
  let isCapturingArea = false;
  let isPickingContainer = false;
  let hoveredContainerEl = null;
  let lastHoveredElement = null;
  let lastToggleTime = 0;

  // Track user's active/hovered element for smart scroller targeting
  const onGlobalMouseMove = (e) => {
    if (!isCapturingArea && !isPickingContainer) {
      lastHoveredElement = e.target;
    }
  };
  window.addEventListener('mousemove', onGlobalMouseMove, { passive: true, capture: true });

  // Inject CSS for the selection overlay and container highlight
  const style = document.createElement('style');
  style.id = 'ls-capture-style';
  style.textContent = `
    .ls-capture-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.3);
      z-index: 2147483646;
      cursor: crosshair;
      display: none;
    }
    .ls-capture-rect {
      position: fixed;
      border: 2px dashed #fff;
      background: rgba(255, 255, 255, 0.1);
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
      pointer-events: none;
      display: none;
    }
    .ls-highlight-overlay {
      position: fixed;
      pointer-events: none;
      border: 2.5px solid #0078D4;
      background: rgba(0, 120, 212, 0.12);
      border-radius: 8px;
      z-index: 2147483645;
      display: none;
      transition: all 0.08s ease-out;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.8), 0 8px 24px rgba(0, 120, 212, 0.25);
    }
    .ls-highlight-badge {
      position: absolute;
      top: -28px;
      left: 8px;
      background: #0078D4;
      color: white;
      font-size: 11.5px;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 4px;
      white-space: nowrap;
      font-family: system-ui, -apple-system, sans-serif;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  const captureOverlay = document.createElement('div');
  captureOverlay.id = 'ls-capture-overlay';
  captureOverlay.className = 'ls-capture-overlay';
  const captureRect = document.createElement('div');
  captureRect.id = 'ls-capture-rect';
  captureRect.className = 'ls-capture-rect';
  captureOverlay.appendChild(captureRect);
  (document.body || document.documentElement).appendChild(captureOverlay);

  const highlightOverlay = document.createElement('div');
  highlightOverlay.id = 'ls-highlight-overlay';
  highlightOverlay.className = 'ls-highlight-overlay';
  const highlightBadge = document.createElement('div');
  highlightBadge.className = 'ls-highlight-badge';
  highlightBadge.textContent = 'Click to capture this scrolling window';
  highlightOverlay.appendChild(highlightBadge);
  (document.body || document.documentElement).appendChild(highlightOverlay);

  // Runtime message listener
  const messageListener = (request, sender, sendResponse) => {
    if (request.action === 'TOGGLE_OVERLAY') {
      toggleToolbar();
      sendResponse({ success: true });
    }
    return true;
  };
  chrome.runtime.onMessage.addListener(messageListener);

  // In-page keyboard shortcut listener
  const onKeyDown = (e) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isShortcut = 
      (e.altKey && e.shiftKey && (e.code === 'KeyS' || e.key === 's' || e.key === 'S')) ||
      (isMac && e.metaKey && e.shiftKey && (e.code === 'KeyS' || e.key === 's' || e.key === 'S'));

    if (isShortcut) {
      e.preventDefault();
      e.stopPropagation();
      toggleToolbar();
      return;
    }

    if (e.key === 'Escape' || e.code === 'Escape') {
      if (isPickingContainer) {
        e.preventDefault();
        e.stopPropagation();
        stopContainerPicker();
        return;
      }
      if (overlayHost || isCapturingArea) {
        e.preventDefault();
        e.stopPropagation();
        stopAreaCapture();
        removeToolbar();
      }
    }
  };
  window.addEventListener('keydown', onKeyDown, true);

  // Helper to traverse DOM and Shadow Roots to find scrollable container
  function getScrollableContainer(el) {
    let curr = el;
    while (curr && curr !== document.documentElement && curr !== document.body) {
      if (curr.nodeType === Node.ELEMENT_NODE) {
        const style = window.getComputedStyle(curr);
        const oy = style.overflowY;
        const isScrollableY = (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && 
                             (curr.scrollHeight > curr.clientHeight + 15);
        if (isScrollableY) {
          return curr;
        }
      }
      // Traverse up standard DOM or across Shadow Root boundaries
      curr = curr.parentElement || (curr.getRootNode && curr.getRootNode().host);
    }
    return null;
  }

  function toggleToolbar() {
    const now = Date.now();
    if (now - lastToggleTime < 350) {
      return;
    }
    lastToggleTime = now;

    if (overlayHost) {
      removeToolbar();
      stopAreaCapture();
      stopContainerPicker();
      return;
    }

    overlayHost = document.createElement('div');
    overlayHost.id = 'ls-overlay-host';
    overlayHost.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 2147483647; font-family: system-ui, -apple-system, sans-serif;';
    
    shadowRoot = overlayHost.attachShadow({ mode: 'open' });
    
    const toolbarStyle = document.createElement('style');
    toolbarStyle.textContent = `
      .toolbar {
        background: rgba(255, 255, 255, 0.96);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 12px;
        padding: 6px 12px;
        display: flex;
        gap: 8px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
        align-items: center;
        user-select: none;
      }
      button {
        background: transparent;
        border: none;
        padding: 8px 12px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13.5px;
        font-weight: 500;
        color: #2c3e50;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: background 0.15s, color 0.15s;
      }
      button:hover {
        background: rgba(0, 0, 0, 0.06);
        color: #000;
      }
      button.active {
        background: #e0f2fe;
        color: #0284c7;
      }
      .divider {
        width: 1px;
        height: 22px;
        background: rgba(0, 0, 0, 0.12);
      }
      .close-btn {
        padding: 8px;
        color: #666;
      }
      .close-btn:hover {
        background: #fee2e2;
        color: #dc2626;
      }
      svg {
        width: 18px;
        height: 18px;
      }
    `;

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    
    const iconArea = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h6v2H5v4H3V3zm12 0h6v6h-2V5h-4V3zM3 15h2v4h4v2H3v-6zm16 4h-4v2h6v-6h-2v4z"/></svg>`;
    const iconVisible = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M3 9h18"/></svg>`;
    const iconContainer = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h5M12 15l2 2 2-2M14 17v-4"/></svg>`;
    const iconFull = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 13l5 5 5-5M12 18V6"/></svg>`;
    const iconClose = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;

    toolbar.innerHTML = `
      <button id="btn-area" title="Drag to select specific area (Esc to cancel)">${iconArea} Capture area</button>
      <button id="btn-visible" title="Capture visible screen">${iconVisible} Capture visible</button>
      <button id="btn-container" title="Click any scrolling chat, modal, or box to capture entire content">${iconContainer} Capture scroll box</button>
      <button id="btn-full" title="Capture entire webpage or main feed">${iconFull} Capture full page</button>
      <div class="divider"></div>
      <button id="btn-close" class="close-btn" title="Close (Esc)">${iconClose}</button>
    `;

    shadowRoot.appendChild(toolbarStyle);
    shadowRoot.appendChild(toolbar);
    (document.body || document.documentElement).appendChild(overlayHost);

    // Event Listeners
    shadowRoot.getElementById('btn-area').addEventListener('click', (e) => {
      e.stopPropagation();
      stopContainerPicker();
      stopAreaCapture();
      startAreaCapture();
    });
    shadowRoot.getElementById('btn-visible').addEventListener('click', (e) => {
      e.stopPropagation();
      stopContainerPicker();
      stopAreaCapture();
      startVisibleCapture();
    });
    shadowRoot.getElementById('btn-container').addEventListener('click', (e) => {
      e.stopPropagation();
      stopAreaCapture();
      startContainerPicker();
    });
    shadowRoot.getElementById('btn-full').addEventListener('click', (e) => {
      e.stopPropagation();
      stopContainerPicker();
      stopAreaCapture();
      startFullPageCapture();
    });
    shadowRoot.getElementById('btn-close').addEventListener('click', (e) => {
      e.stopPropagation();
      stopContainerPicker();
      stopAreaCapture();
      removeToolbar();
    });
    
    // Default to area capture mode ready without removing toolbar
    startAreaCapture(true);
  }

  function removeToolbar() {
    if (overlayHost) {
      overlayHost.remove();
      overlayHost = null;
      shadowRoot = null;
    }
  }

  // --- Interactive Container Picker Mode ---
  function startContainerPicker() {
    stopAreaCapture();
    isPickingContainer = true;

    const toolbar = shadowRoot ? shadowRoot.querySelector('.toolbar') : null;
    if (toolbar) {
      const iconClose = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
      toolbar.innerHTML = `
        <span style="font-size: 13.5px; font-weight: 500; color: #0078D4; padding: 4px 8px;">
          Hover & click any scrolling window/chat to capture
        </span>
        <div class="divider"></div>
        <button id="btn-cancel-pick" class="close-btn" title="Cancel (Esc)">${iconClose}</button>
      `;
      shadowRoot.getElementById('btn-cancel-pick').addEventListener('click', stopContainerPicker);
    }

    highlightOverlay.style.display = 'none';
    window.addEventListener('mousemove', onPickerMouseMove, true);
    window.addEventListener('click', onPickerClick, true);
  }

  function stopContainerPicker() {
    isPickingContainer = false;
    highlightOverlay.style.display = 'none';
    window.removeEventListener('mousemove', onPickerMouseMove, true);
    window.removeEventListener('click', onPickerClick, true);
    removeToolbar();
  }

  function onPickerMouseMove(e) {
    if (!isPickingContainer) return;
    if (overlayHost && (e.composedPath().includes(overlayHost) || overlayHost.contains(e.target))) {
      highlightOverlay.style.display = 'none';
      return;
    }

    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    let target = null;
    for (let el of elements) {
      if (el === highlightOverlay || el === captureOverlay) continue;
      const container = getScrollableContainer(el);
      if (container && container !== document.body && container !== document.documentElement) {
        target = container;
        break;
      }
    }

    hoveredContainerEl = target;

    if (target) {
      const rect = target.getBoundingClientRect();
      highlightOverlay.style.left = rect.left + 'px';
      highlightOverlay.style.top = rect.top + 'px';
      highlightOverlay.style.width = rect.width + 'px';
      highlightOverlay.style.height = rect.height + 'px';
      highlightOverlay.style.display = 'block';
    } else {
      highlightOverlay.style.display = 'none';
    }
  }

  function onPickerClick(e) {
    if (!isPickingContainer) return;
    if (overlayHost && (e.composedPath().includes(overlayHost) || overlayHost.contains(e.target))) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const target = hoveredContainerEl;
    stopContainerPicker();

    if (target) {
      captureScrollContainer(target);
    }
  }

  async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function startVisibleCapture() {
    removeToolbar();
    await wait(150);
    
    chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_TAB' }, (response) => {
      if (response && response.dataUrl) {
        chrome.runtime.sendMessage({
          action: 'OPEN_RESULT',
          payload: {
            type: 'visible',
            image: response.dataUrl,
            dpr: window.devicePixelRatio,
            windowWidth: window.innerWidth
          }
        });
      }
    });
  }

  // --- Scroller Abstraction ---
  function createScroller(element) {
    if (element === window || element === document.scrollingElement || element === document.body || element === document.documentElement) {
      const se = document.scrollingElement || document.documentElement;
      return {
        element: window,
        getScrollTop: () => se.scrollTop,
        getScrollLeft: () => se.scrollLeft,
        getScrollHeight: () => Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight),
        getViewportHeight: () => window.innerHeight,
        getViewportWidth: () => window.innerWidth,
        scrollTo: (x, y) => { 
          se.scrollLeft = x; 
          se.scrollTop = y;
          try {
            window.dispatchEvent(new Event('scroll'));
            se.dispatchEvent(new Event('scroll', { bubbles: true }));
          } catch (e) {}
        },
        scrollBy: (x, y) => { 
          se.scrollLeft += x; 
          se.scrollTop += y;
          try {
            window.dispatchEvent(new Event('scroll'));
            se.dispatchEvent(new Event('scroll', { bubbles: true }));
          } catch (e) {}
        },
        hideScrollbar: () => {
          const styleEl = document.createElement('style');
          styleEl.textContent = `
            html, body { scrollbar-width: none !important; -ms-overflow-style: none !important; }
            html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; }
          `;
          (document.head || document.documentElement).appendChild(styleEl);
          return () => styleEl.remove();
        }
      };
    } else {
      return {
        element: element,
        getScrollTop: () => element.scrollTop,
        getScrollLeft: () => element.scrollLeft,
        getScrollHeight: () => element.scrollHeight,
        getViewportHeight: () => element.clientHeight,
        getViewportWidth: () => element.clientWidth,
        scrollTo: (x, y) => { 
          element.scrollLeft = x; 
          element.scrollTop = y;
          try {
            element.dispatchEvent(new Event('scroll', { bubbles: true }));
          } catch (e) {}
        },
        scrollBy: (x, y) => { 
          element.scrollLeft += x; 
          element.scrollTop += y;
          try {
            element.dispatchEvent(new Event('scroll', { bubbles: true }));
          } catch (e) {}
        },
        hideScrollbar: () => {
          const origScrollbarWidth = element.style.scrollbarWidth;
          element.style.scrollbarWidth = 'none';
          const styleEl = document.createElement('style');
          const lsId = 'ls-hsb-' + Math.random().toString(36).slice(2, 8);
          element.dataset.lsId = lsId;
          styleEl.textContent = `[data-ls-id="${lsId}"]::-webkit-scrollbar { display: none !important; }`;
          (document.head || document.documentElement).appendChild(styleEl);
          return () => {
            element.style.scrollbarWidth = origScrollbarWidth;
            styleEl.remove();
            delete element.dataset.lsId;
          };
        }
      };
    }
  }

  function findMainScroller() {
    function isScrollable(el) {
      if (el === window) {
        const se = document.scrollingElement || document.documentElement;
        if (se.scrollHeight <= se.clientHeight + 5) return false;
        const orig = se.scrollTop;
        se.scrollTop = orig + 1;
        if (se.scrollTop !== orig) {
          se.scrollTop = orig;
          return true;
        }
        se.scrollTop = orig - 1;
        const moved = se.scrollTop !== orig;
        se.scrollTop = orig;
        return moved;
      } else {
        if (el.scrollHeight <= el.clientHeight + 5) return false;
        const orig = el.scrollTop;
        el.scrollTop = orig + 1;
        if (el.scrollTop !== orig) {
          el.scrollTop = orig;
          return true;
        }
        el.scrollTop = orig - 1;
        const moved = el.scrollTop !== orig;
        el.scrollTop = orig;
        return moved;
      }
    }

    function scrollRange(el) {
      if (el === window) {
        const se = document.scrollingElement || document.documentElement;
        return se.scrollHeight - se.clientHeight;
      }
      return el.scrollHeight - el.clientHeight;
    }

    // First check if active or hovered element is inside a scroll container
    if (lastHoveredElement) {
      const hoveredContainer = getScrollableContainer(lastHoveredElement);
      if (hoveredContainer && isScrollable(hoveredContainer)) {
        return hoveredContainer;
      }
    }

    // Check visible modals/dialogs with scrollable elements
    const modals = document.querySelectorAll('[role="dialog"], [role="region"], [aria-modal="true"]');
    for (let modal of modals) {
      if (modal.offsetParent !== null) { // visible
        const container = getScrollableContainer(modal) || modal.querySelector('[style*="overflow"]');
        if (container && isScrollable(container)) {
          return container;
        }
      }
    }

    const elements = document.querySelectorAll('*');
    let bestScroller = window;
    let bestRange = isScrollable(window) ? scrollRange(window) : 0;

    for (let el of elements) {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') continue;
      if (el === document.body || el === document.documentElement) continue;
      
      if (el.scrollHeight > el.clientHeight + 10 && isScrollable(el)) {
        const range = scrollRange(el);
        if (range > bestRange) {
          bestRange = range;
          bestScroller = el;
        }
      }
    }
    
    return bestScroller;
  }

  function hideFixedElements(scrollerElement) {
    const hiddenElements = [];
    const elements = document.querySelectorAll('*');
    
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') continue;
      if (el === document.documentElement || el === document.body) continue;
      if (scrollerElement && (el === scrollerElement || el.contains(scrollerElement))) continue;
      
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      
      if (style.position === 'fixed' || style.position === 'sticky') {
        const rect = el.getBoundingClientRect();
        if (rect.height > window.innerHeight * 0.7 && rect.width > window.innerWidth * 0.7) {
          continue;
        }

        hiddenElements.push({
          el: el,
          originalOpacity: el.style.opacity,
          originalTransition: el.style.transition
        });
        el.style.transition = 'none';
        el.style.opacity = '0';
      }
    }

    return function restoreFixedElements() {
      hiddenElements.forEach(item => {
        if (item.el) {
          item.el.style.opacity = item.originalOpacity;
          setTimeout(() => {
            if (item.el) item.el.style.transition = item.originalTransition;
          }, 50);
        }
      });
    };
  }

  function findScrollerForPoint(x, y) {
    const elements = document.elementsFromPoint(x, y);
    for (let el of elements) {
      if (el === captureOverlay || el === captureRect || el === highlightOverlay) continue;
      const scrollable = getScrollableContainer(el);
      if (scrollable) {
        return scrollable;
      }
    }
    return findMainScroller();
  }

  // --- Area Capture Logic ---
  let startClientX, startClientY;
  let lastClientX, lastClientY;
  let isDragging = false;
  let scrollSpeedY = 0;
  let scrollSpeedX = 0;
  let autoScrollActive = false;
  let activeScroller = null;
  
  let contentStartX = 0;
  let contentStartY = 0;

  function startAreaCapture(keepToolbar = false) {
    if (!keepToolbar) {
      removeToolbar();
    }
    captureOverlay.style.display = 'block';
    captureRect.style.display = 'none';
    isCapturingArea = true;
    
    document.addEventListener('mousedown', onMouseDown, true);
  }

  function stopAreaCapture() {
    captureOverlay.style.display = 'none';
    captureRect.style.display = 'none';
    isCapturingArea = false;
    isDragging = false;
    autoScrollActive = false;
    document.removeEventListener('mousedown', onMouseDown, true);
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseup', onMouseUp, true);
  }

  function onMouseDown(e) {
    if (!isCapturingArea) return;
    
    if (overlayHost && (e.composedPath().includes(overlayHost) || overlayHost.contains(e.target))) {
      return;
    }
    
    removeToolbar();
    
    e.preventDefault();
    e.stopPropagation();
    
    activeScroller = createScroller(findScrollerForPoint(e.clientX, e.clientY));
    
    startClientX = e.clientX;
    startClientY = e.clientY;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    
    let boundsLeft = 0, boundsTop = 0;
    if (activeScroller.element !== window) {
      const bounds = activeScroller.element.getBoundingClientRect();
      boundsLeft = bounds.left;
      boundsTop = bounds.top;
    }
    
    contentStartX = (e.clientX - boundsLeft) + activeScroller.getScrollLeft();
    contentStartY = (e.clientY - boundsTop) + activeScroller.getScrollTop();
    
    isDragging = true;
    
    captureRect.style.left = e.clientX + 'px';
    captureRect.style.top = e.clientY + 'px';
    captureRect.style.width = '0px';
    captureRect.style.height = '0px';
    captureRect.style.display = 'block';
    
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);
    
    if (!autoScrollActive) {
      autoScrollActive = true;
      requestAnimationFrame(autoScrollLoop);
    }
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    e.stopPropagation();
    
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    
    const edgeSize = 50;
    const maxSpeed = 25;
    
    let bounds = { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
    if (activeScroller.element !== window) {
      bounds = activeScroller.element.getBoundingClientRect();
    }
    
    if (lastClientY > bounds.bottom - edgeSize) {
      scrollSpeedY = maxSpeed;
    } else if (lastClientY < bounds.top + edgeSize) {
      scrollSpeedY = -maxSpeed;
    } else {
      scrollSpeedY = 0;
    }
    
    if (lastClientX > bounds.right - edgeSize) {
      scrollSpeedX = maxSpeed;
    } else if (lastClientX < bounds.left + edgeSize) {
      scrollSpeedX = -maxSpeed;
    } else {
      scrollSpeedX = 0;
    }
  }

  function autoScrollLoop() {
    if (!autoScrollActive) return;
    
    if (isDragging) {
      if (scrollSpeedY !== 0 || scrollSpeedX !== 0) {
        activeScroller.scrollBy(scrollSpeedX, scrollSpeedY);
      }
      
      let boundsLeft = 0, boundsTop = 0;
      if (activeScroller.element !== window) {
        const bounds = activeScroller.element.getBoundingClientRect();
        boundsLeft = bounds.left;
        boundsTop = bounds.top;
      }
      
      const contentCurrentX = (lastClientX - boundsLeft) + activeScroller.getScrollLeft();
      const contentCurrentY = (lastClientY - boundsTop) + activeScroller.getScrollTop();
      
      const contentLeft = Math.min(contentStartX, contentCurrentX);
      const contentTop = Math.min(contentStartY, contentCurrentY);
      const contentWidth = Math.abs(contentCurrentX - contentStartX);
      const contentHeight = Math.abs(contentCurrentY - contentStartY);
      
      const screenX = boundsLeft + (contentLeft - activeScroller.getScrollLeft());
      const screenY = boundsTop + (contentTop - activeScroller.getScrollTop());
      
      captureRect.style.left = screenX + 'px';
      captureRect.style.top = screenY + 'px';
      captureRect.style.width = contentWidth + 'px';
      captureRect.style.height = contentHeight + 'px';
    }
    
    requestAnimationFrame(autoScrollLoop);
  }

  async function onMouseUp(e) {
    if (!isDragging) return;
    e.preventDefault();
    e.stopPropagation();
    
    let boundsLeft = 0, boundsTop = 0;
    if (activeScroller.element !== window) {
      const bounds = activeScroller.element.getBoundingClientRect();
      boundsLeft = bounds.left;
      boundsTop = bounds.top;
    }
    
    const contentCurrentX = (lastClientX - boundsLeft) + activeScroller.getScrollLeft();
    const contentCurrentY = (lastClientY - boundsTop) + activeScroller.getScrollTop();
    
    const contentLeft = Math.min(contentStartX, contentCurrentX);
    const contentTop = Math.min(contentStartY, contentCurrentY);
    const contentWidth = Math.abs(contentCurrentX - contentStartX);
    const contentHeight = Math.abs(contentCurrentY - contentStartY);
    
    const finalScroller = activeScroller; 
    
    const currentScrollX = finalScroller.getScrollLeft();
    const currentScrollY = finalScroller.getScrollTop();
    const vWidth = finalScroller.getViewportWidth();
    const vHeight = finalScroller.getViewportHeight();
    
    const isFullyVisible = 
      contentLeft >= currentScrollX &&
      contentTop >= currentScrollY &&
      (contentLeft + contentWidth) <= (currentScrollX + vWidth) &&
      (contentTop + contentHeight) <= (currentScrollY + vHeight);
      
    const screenX = boundsLeft + (contentLeft - currentScrollX);
    const screenY = boundsTop + (contentTop - currentScrollY);
    
    stopAreaCapture();
    
    if (contentWidth < 10 || contentHeight < 10) {
      return;
    }
    
    await wait(100); 
    
    if (isFullyVisible) {
      chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_TAB' }, (response) => {
        if (response && response.dataUrl) {
          chrome.runtime.sendMessage({
            action: 'OPEN_RESULT',
            payload: {
              type: 'area',
              image: response.dataUrl,
              rect: { 
                x: screenX, 
                y: screenY, 
                width: contentWidth, 
                height: contentHeight 
              },
              dpr: window.devicePixelRatio,
              windowWidth: window.innerWidth
            }
          });
        }
      });
    } else {
      await captureAreaSegments({
        left: contentLeft,
        top: contentTop,
        width: contentWidth,
        height: contentHeight,
        boundsLeft,
        boundsTop
      }, finalScroller);
    }
  }

  async function captureAreaSegments(area, scroller) {
    const originalScrollTop = scroller.getScrollTop();
    const originalScrollLeft = scroller.getScrollLeft();
    const restoreScrollbar = scroller.hideScrollbar();
    
    const viewportHeight = scroller.getViewportHeight();
    const viewportWidth = scroller.getViewportWidth();
    
    const segments = [];
    const restoreCallbacks = [];
    
    try {
      scroller.scrollTo(area.left, area.top);
      await wait(300);
      
      const MAX_AREA_SEGMENTS = 50;
      
      while (segments.length < MAX_AREA_SEGMENTS) {
        if (segments.length >= 1) {
          const restore = hideFixedElements(scroller.element);
          if (restore) restoreCallbacks.push(restore);
          await wait(50);
        }
        
        const response = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_TAB' }, resolve);
        });
        
        if (!response || !response.dataUrl) {
          break;
        }
        
        segments.push({
          y: scroller.getScrollTop(),
          x: scroller.getScrollLeft(),
          dataUrl: response.dataUrl
        });
        
        if (segments.length === 1) {
          const restore = hideFixedElements(scroller.element);
          if (restore) restoreCallbacks.push(restore);
          await wait(50);
        }
        
        const scrolledSoFar = scroller.getScrollTop() - area.top;
        if (scrolledSoFar + viewportHeight >= area.height) {
          break;
        }
        
        const previousScrollY = scroller.getScrollTop();
        scroller.scrollTo(scroller.getScrollLeft(), previousScrollY + viewportHeight);
        await wait(350);
        
        if (scroller.getScrollTop() === previousScrollY) {
          // Retry once for dynamic lazy load
          await wait(400);
          scroller.scrollTo(scroller.getScrollLeft(), previousScrollY + viewportHeight);
          await wait(350);
          if (scroller.getScrollTop() === previousScrollY) {
            break; 
          }
        }
      }
    } finally {
      while (restoreCallbacks.length > 0) {
        const restore = restoreCallbacks.pop();
        try { restore(); } catch (e) { console.error(e); }
      }
      restoreScrollbar();
      scroller.scrollTo(originalScrollLeft, originalScrollTop);
    }
    
    if (segments.length === 0) return;

    chrome.runtime.sendMessage({
      action: 'OPEN_RESULT',
      payload: {
        type: 'area_stitched',
        segments: segments,
        contentLeft: area.left,
        contentTop: area.top,
        contentWidth: area.width,
        contentHeight: area.height,
        boundsLeft: area.boundsLeft,
        boundsTop: area.boundsTop,
        viewportWidth: viewportWidth,
        viewportHeight: viewportHeight,
        dpr: window.devicePixelRatio,
        windowWidth: window.innerWidth
      }
    });
  }

  // --- Specific Scroll Container Capture (e.g. Google AI Overview chat, Twitter thread) ---
  async function captureScrollContainer(targetElement) {
    removeToolbar();
    stopContainerPicker();
    
    const scroller = createScroller(targetElement);
    const originalScrollTop = scroller.getScrollTop();
    const originalScrollLeft = scroller.getScrollLeft();
    const restoreScrollbar = scroller.hideScrollbar();
    
    const bounds = targetElement.getBoundingClientRect();
    const boundsTop = bounds.top;
    const boundsLeft = bounds.left;
    const viewportWidth = bounds.width;
    const viewportHeight = bounds.height;
    
    let totalHeight = scroller.getScrollHeight();
    
    scroller.scrollTo(scroller.getScrollLeft(), 0);
    await wait(350);
    
    const segments = [];
    const restoreCallbacks = [];
    const MAX_CONTAINER_SEGMENTS = 50;
    let maxReachedY = 0;
    
    try {
      while (segments.length < MAX_CONTAINER_SEGMENTS) {
        const response = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_TAB' }, resolve);
        });
        
        if (!response || !response.dataUrl) {
          break;
        }
        
        segments.push({
          y: scroller.getScrollTop(),
          dataUrl: response.dataUrl
        });

        maxReachedY = Math.max(maxReachedY, scroller.getScrollTop() + viewportHeight);
        
        const previousScrollY = scroller.getScrollTop();
        scroller.scrollTo(scroller.getScrollLeft(), previousScrollY + viewportHeight);
        await wait(400);
        
        if (scroller.getScrollTop() === previousScrollY) {
          // Retry for virtualized or network loaded messages
          await wait(500);
          scroller.scrollTo(scroller.getScrollLeft(), previousScrollY + viewportHeight);
          await wait(400);
          if (scroller.getScrollTop() === previousScrollY) {
            break;
          }
        }
      }
    } finally {
      while (restoreCallbacks.length > 0) {
        const restore = restoreCallbacks.pop();
        try { restore(); } catch (e) { console.error(e); }
      }
      restoreScrollbar();
      scroller.scrollTo(originalScrollLeft, originalScrollTop);
    }
    
    if (segments.length === 0) return;
    
    totalHeight = Math.max(totalHeight, maxReachedY);

    chrome.runtime.sendMessage({
      action: 'OPEN_RESULT',
      payload: {
        type: 'full',
        segments: segments,
        totalHeight: totalHeight,
        viewportHeight: viewportHeight,
        viewportWidth: viewportWidth,
        boundsTop: boundsTop,
        boundsLeft: boundsLeft,
        dpr: window.devicePixelRatio,
        windowWidth: window.innerWidth,
        isWindow: false
      }
    });
  }

  // --- Full Page Capture Logic (Supports Twitter & Infinite Feeds) ---
  async function startFullPageCapture() {
    removeToolbar();
    stopContainerPicker();
    
    const targetElement = findMainScroller();
    const scroller = createScroller(targetElement);
    
    const originalScrollTop = scroller.getScrollTop();
    const originalScrollLeft = scroller.getScrollLeft();
    const restoreScrollbar = scroller.hideScrollbar();
    
    let totalHeight = scroller.getScrollHeight();
    const viewportHeight = scroller.getViewportHeight();
    const viewportWidth = scroller.getViewportWidth();
    
    let boundsTop = 0;
    let boundsLeft = 0;
    const isWindowScroller = (scroller.element === window);
    if (!isWindowScroller) {
      const bounds = scroller.element.getBoundingClientRect();
      boundsTop = bounds.top;
      boundsLeft = bounds.left;
    }

    scroller.scrollTo(isWindowScroller ? 0 : scroller.getScrollLeft(), 0);
    await wait(350); 
    
    const segments = [];
    const restoreCallbacks = [];
    const MAX_FULL_SEGMENTS = 50;
    let maxReachedY = 0;
    
    try {
      while (segments.length < MAX_FULL_SEGMENTS) {
        if (segments.length >= 1) {
          const restore = hideFixedElements(scroller.element);
          if (restore) restoreCallbacks.push(restore);
          await wait(50);
        }
        
        const response = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_TAB' }, resolve);
        });
        
        if (!response || !response.dataUrl) {
          break;
        }
        
        segments.push({
          y: scroller.getScrollTop(),
          dataUrl: response.dataUrl
        });

        maxReachedY = Math.max(maxReachedY, scroller.getScrollTop() + viewportHeight);
        
        if (segments.length === 1) {
          const restore = hideFixedElements(scroller.element);
          if (restore) restoreCallbacks.push(restore);
          await wait(50);
        }
        
        const previousScrollY = scroller.getScrollTop();
        scroller.scrollTo(scroller.getScrollLeft(), previousScrollY + viewportHeight);
        
        // Wait for dynamic render & Twitter virtualizer
        await wait(450); 
        
        if (scroller.getScrollTop() === previousScrollY) {
          // Twitter / infinite feed retry: wait for network & virtualizer
          await wait(600);
          scroller.scrollTo(scroller.getScrollLeft(), previousScrollY + viewportHeight);
          await wait(450);
          
          if (scroller.getScrollTop() === previousScrollY) {
            break;
          }
        }
      }
    } finally {
      while (restoreCallbacks.length > 0) {
        const restore = restoreCallbacks.pop();
        try { restore(); } catch (e) { console.error(e); }
      }
      restoreScrollbar();
      scroller.scrollTo(originalScrollLeft, originalScrollTop);
    }
    
    if (segments.length === 0) return;
    
    totalHeight = Math.max(totalHeight, maxReachedY);

    chrome.runtime.sendMessage({
      action: 'OPEN_RESULT',
      payload: {
        type: 'full',
        segments: segments,
        totalHeight: totalHeight,
        viewportHeight: viewportHeight,
        viewportWidth: viewportWidth,
        boundsTop: boundsTop,
        boundsLeft: boundsLeft,
        dpr: window.devicePixelRatio,
        windowWidth: window.innerWidth,
        isWindow: isWindowScroller
      }
    });
  }

  // Save instance cleanup hook
  window.__lsCaptureInstance = {
    destroy: () => {
      stopAreaCapture();
      stopContainerPicker();
      removeToolbar();
      const existingOverlay = document.getElementById('ls-capture-overlay');
      if (existingOverlay) existingOverlay.remove();
      const existingStyle = document.getElementById('ls-capture-style');
      if (existingStyle) existingStyle.remove();
      const existingHighlight = document.getElementById('ls-highlight-overlay');
      if (existingHighlight) existingHighlight.remove();
      chrome.runtime.onMessage.removeListener(messageListener);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('mousemove', onGlobalMouseMove, true);
    }
  };
})();
