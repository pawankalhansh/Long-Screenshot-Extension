if (!window.lsCaptureLoaded) {
  window.lsCaptureLoaded = true;

  let overlayHost = null;
  let shadowRoot = null;
  let isCapturingArea = false;

  // Inject CSS into the page to handle the selection overlay (needs to be in main DOM to cover everything)
  const style = document.createElement('style');
  style.textContent = `
    .ls-capture-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.3);
      z-index: 2147483646;
      cursor: crosshair;
      display: none;
    }
    .ls-capture-rect {
      position: absolute;
      border: 2px dashed #fff;
      background: rgba(255, 255, 255, 0.1);
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);

  const captureOverlay = document.createElement('div');
  captureOverlay.className = 'ls-capture-overlay';
  const captureRect = document.createElement('div');
  captureRect.className = 'ls-capture-rect';
  captureOverlay.appendChild(captureRect);
  document.body.appendChild(captureOverlay);

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'TOGGLE_OVERLAY') {
      toggleToolbar();
      sendResponse({ ok: true });
    }
  });

  function toggleToolbar() {
    if (overlayHost) {
      removeToolbar();
      stopAreaCapture();
      return;
    }

    overlayHost = document.createElement('div');
    // High z-index to stay on top
    overlayHost.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 2147483647; font-family: system-ui, sans-serif;';
    
    shadowRoot = overlayHost.attachShadow({ mode: 'open' });
    
    const style = document.createElement('style');
    style.textContent = `
      .toolbar {
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 8px;
        padding: 8px;
        display: flex;
        gap: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
        align-items: center;
      }
      button {
        background: transparent;
        border: none;
        padding: 8px 12px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        color: #333;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: background 0.2s;
      }
      button:hover {
        background: rgba(0, 0, 0, 0.05);
      }
      .divider {
        width: 1px;
        height: 24px;
        background: rgba(0, 0, 0, 0.1);
      }
      .close-btn {
        padding: 8px;
        color: #666;
      }
      .close-btn:hover {
        background: #fee;
        color: #d00;
      }
      svg {
        width: 18px;
        height: 18px;
      }
    `;

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    
    // Icons (Simple SVGs)
    const iconArea = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h6v2H5v4H3V3zm12 0h6v6h-2V5h-4V3zM3 15h2v4h4v2H3v-6zm16 4h-4v2h6v-6h-2v4z"/></svg>`;
    const iconVisible = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M3 9h18"/></svg>`;
    const iconFull = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 13l5 5 5-5M12 18V6"/></svg>`; // Down arrow to indicate scrolling
    const iconClose = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;

    toolbar.innerHTML = `
      <button id="btn-area" title="Capture specific area">${iconArea} Capture area</button>
      <button id="btn-visible" title="Capture visible screen">${iconVisible} Capture visible</button>
      <button id="btn-full" title="Capture full page">${iconFull} Capture full page</button>
      <div class="divider"></div>
      <button id="btn-close" class="close-btn" title="Close">${iconClose}</button>
    `;

    shadowRoot.appendChild(style);
    shadowRoot.appendChild(toolbar);
    document.body.appendChild(overlayHost);

    // Event Listeners
    shadowRoot.getElementById('btn-area').addEventListener('click', () => {
      stopAreaCapture(); // Reset state just in case
      startAreaCapture(); // Start normally (hides toolbar)
    });
    shadowRoot.getElementById('btn-visible').addEventListener('click', () => {
      stopAreaCapture();
      startVisibleCapture();
    });
    shadowRoot.getElementById('btn-full').addEventListener('click', () => {
      stopAreaCapture();
      startFullPageCapture();
    });
    shadowRoot.getElementById('btn-close').addEventListener('click', () => {
      stopAreaCapture();
      removeToolbar();
    });
    
    // Default to area capture without removing the toolbar
    startAreaCapture(true);
  }

  function removeToolbar() {
    if (overlayHost) {
      overlayHost.remove();
      overlayHost = null;
      shadowRoot = null;
    }
  }

  async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Safe capture helper: throttles calls to stay well within Chrome's
  // MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND limit (~2/sec) and retries on failure.
  const MIN_CAPTURE_GAP = 550; // ms between captures
  let lastCaptureTime = 0;

  async function captureTab() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const gap = Date.now() - lastCaptureTime;
      if (gap < MIN_CAPTURE_GAP) {
        await wait(MIN_CAPTURE_GAP - gap);
      }
      lastCaptureTime = Date.now();

      // Keep service worker alive by using chrome.runtime.sendMessage
      // which re-wakes it if it has gone idle (MV3 30-sec timeout)
      const response = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_TAB' }, (resp) => {
            if (chrome.runtime.lastError) {
              resolve({ error: chrome.runtime.lastError.message });
            } else {
              resolve(resp);
            }
          });
        } catch (e) {
          resolve({ error: e.message });
        }
      });

      if (response && response.dataUrl) {
        return response.dataUrl;
      }

      console.warn(`[LongScreenshot] Capture attempt ${attempt + 1} failed:`, response && response.error);
      await wait(400); // longer wait before retrying (service worker might need to wake up)
    }
    throw new Error('Screen capture failed after 3 attempts. Try reloading the page or the extension.');
  }

  // Scroll and wait for the scroll to actually take effect.
  // On some laptops/browsers, CSS smooth scroll can delay the scroll
  // even with direct property assignment.
  async function scrollAndSettle(scroller, x, y) {
    scroller.scrollTo(x, y);
    
    // Wait for scroll to settle — check every 50ms for up to 800ms
    const startTime = Date.now();
    let lastPos = scroller.getScrollTop();
    await wait(100);
    
    while (Date.now() - startTime < 800) {
      const currentPos = scroller.getScrollTop();
      if (currentPos === lastPos) {
        // Scroll has settled
        return;
      }
      lastPos = currentPos;
      await wait(80);
    }
  }

  async function startVisibleCapture() {
    removeToolbar();
    await wait(150); // wait for UI to disappear
    
    try {
      const dataUrl = await captureTab();
      chrome.runtime.sendMessage({
        action: 'OPEN_RESULT',
        payload: {
          type: 'visible',
          image: dataUrl,
          dpr: window.devicePixelRatio,
          windowWidth: window.innerWidth
        }
      });
    } catch (err) {
      console.error("Visible capture failed:", err);
      alert("Capture failed: " + err.message);
    }
  }

  // --- Scroller Abstraction ---
  // Forces instant scroll by temporarily overriding CSS scroll-behavior to 'auto'.
  // Direct property assignment alone does NOT bypass smooth scroll on all browsers.

  function forceInstantScroll(el) {
    // Override CSS scroll-behavior on the element and its parents
    const targets = [document.documentElement, document.body];
    if (el && el !== document.documentElement && el !== document.body) {
      targets.push(el);
    }
    const originals = targets.map(t => ({ el: t, val: t.style.scrollBehavior }));
    targets.forEach(t => { t.style.scrollBehavior = 'auto'; });
    return () => originals.forEach(o => { o.el.style.scrollBehavior = o.val; });
  }

  function createScroller(element) {
    if (element === window || element === document.scrollingElement || element === document.body || element === document.documentElement) {
      const se = document.scrollingElement || document.documentElement;
      return {
        element: window,
        getScrollTop: () => se.scrollTop,
        getScrollLeft: () => se.scrollLeft,
        getScrollHeight: () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        getViewportHeight: () => window.innerHeight,
        getViewportWidth: () => window.innerWidth,
        scrollTo: (x, y) => {
          const restore = forceInstantScroll(se);
          se.scrollLeft = x; se.scrollTop = y;
          restore();
        },
        scrollBy: (x, y) => {
          const restore = forceInstantScroll(se);
          se.scrollLeft += x; se.scrollTop += y;
          restore();
        },
        hideScrollbar: () => {
          const styleEl = document.createElement('style');
          styleEl.textContent = `
            html, body { scrollbar-width: none !important; -ms-overflow-style: none !important; }
            html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; }
          `;
          document.head.appendChild(styleEl);
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
          const restore = forceInstantScroll(element);
          element.scrollLeft = x; element.scrollTop = y;
          restore();
        },
        scrollBy: (x, y) => {
          const restore = forceInstantScroll(element);
          element.scrollLeft += x; element.scrollTop += y;
          restore();
        },
        hideScrollbar: () => {
          const origScrollbarWidth = element.style.scrollbarWidth;
          element.style.scrollbarWidth = 'none';
          const styleEl = document.createElement('style');
          const lsId = 'ls-hsb-' + Math.random().toString(36).slice(2, 8);
          element.dataset.lsId = lsId;
          styleEl.textContent = `[data-ls-id="${lsId}"]::-webkit-scrollbar { display: none !important; }`;
          document.head.appendChild(styleEl);
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
    // Test scrollability using direct property assignment (synchronous, ignores CSS smooth scroll)
    function isScrollable(el) {
      if (el === window) {
        const se = document.scrollingElement || document.documentElement;
        const orig = se.scrollTop;
        se.scrollTop = orig + 1;
        const moved = se.scrollTop !== orig;
        se.scrollTop = orig;
        return moved;
      } else {
        const orig = el.scrollTop;
        el.scrollTop = orig + 1;
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

    // Check ALL scrollable elements, including window, and pick the one
    // with the most scrollable content. This avoids prematurely picking
    // window on SPAs that use a custom scroll container.
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

  function hideFixedElements() {
    const hiddenElements = [];
    const nodeIterator = document.createNodeIterator(document.documentElement, NodeFilter.SHOW_ELEMENT, null, false);
    let el;
    while ((el = nodeIterator.nextNode())) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      
      let shouldHide = false;
      
      if (style.position === 'fixed' || style.position === 'sticky') {
        shouldHide = true;
      }
      
      if (shouldHide) {
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
        item.el.style.opacity = item.originalOpacity;
        setTimeout(() => {
          if (item.el) item.el.style.transition = item.originalTransition;
        }, 50);
      });
    };
  }

  function findScrollerForPoint(x, y) {
    const elements = document.elementsFromPoint(x, y);
    for (let el of elements) {
      if (el === document.documentElement || el === document.body) continue;
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && el.scrollHeight > el.clientHeight) {
        return el;
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
  
  // Track start position in content space
  let contentStartX = 0;
  let contentStartY = 0;

  function startAreaCapture(keepToolbar = false) {
    if (!keepToolbar) {
      removeToolbar();
    }
    captureOverlay.style.width = Math.max(document.documentElement.scrollWidth, window.innerWidth) + 'px';
    captureOverlay.style.height = Math.max(document.documentElement.scrollHeight, window.innerHeight) + 'px';
    captureOverlay.style.display = 'block';
    captureRect.style.display = 'none'; // hide until drag
    isCapturingArea = true;
    
    document.addEventListener('mousedown', onMouseDown, true);
  }

  function stopAreaCapture() {
    captureOverlay.style.display = 'none';
    isCapturingArea = false;
    isDragging = false;
    autoScrollActive = false;
    document.removeEventListener('mousedown', onMouseDown, true);
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseup', onMouseUp, true);
  }

  function onMouseDown(e) {
    if (!isCapturingArea) return;
    
    // Ignore clicks inside the toolbar
    if (overlayHost && (e.composedPath().includes(overlayHost) || overlayHost.contains(e.target))) {
      return;
    }
    
    // Now hide the toolbar since we're actually starting a selection
    removeToolbar();
    
    e.preventDefault();
    e.stopPropagation();
    
    activeScroller = createScroller(findScrollerForPoint(e.clientX, e.clientY));
    
    startClientX = e.clientX;
    startClientY = e.clientY;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    
    // In scroller's content space:
    let boundsLeft = 0, boundsTop = 0;
    if (activeScroller.element !== window) {
      const bounds = activeScroller.element.getBoundingClientRect();
      boundsLeft = bounds.left;
      boundsTop = bounds.top;
    }
    
    contentStartX = (e.clientX - boundsLeft) + activeScroller.getScrollLeft();
    contentStartY = (e.clientY - boundsTop) + activeScroller.getScrollTop();
    
    isDragging = true;
    
    captureRect.style.left = e.pageX + 'px';
    captureRect.style.top = e.pageY + 'px';
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
      
      // Convert content coordinates back to page coordinates for the visual rectangle
      const screenX = boundsLeft + (contentLeft - activeScroller.getScrollLeft());
      const screenY = boundsTop + (contentTop - activeScroller.getScrollTop());
      
      captureRect.style.left = (screenX + window.scrollX) + 'px';
      captureRect.style.top = (screenY + window.scrollY) + 'px';
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
    
    // Check if the selection is entirely within the CURRENT viewport
    const currentScrollX = finalScroller.getScrollLeft();
    const currentScrollY = finalScroller.getScrollTop();
    const vWidth = finalScroller.getViewportWidth();
    const vHeight = finalScroller.getViewportHeight();
    
    const isFullyVisible = 
      contentLeft >= currentScrollX &&
      contentTop >= currentScrollY &&
      (contentLeft + contentWidth) <= (currentScrollX + vWidth) &&
      (contentTop + contentHeight) <= (currentScrollY + vHeight);
      
    // Screen coordinates of the selection right now
    const screenX = boundsLeft + (contentLeft - currentScrollX);
    const screenY = boundsTop + (contentTop - currentScrollY);
    
    stopAreaCapture();
    
    if (contentWidth < 10 || contentHeight < 10) {
      return;
    }
    
    await wait(100); 
    
    if (isFullyVisible) {
      try {
        const dataUrl = await captureTab();
        chrome.runtime.sendMessage({
          action: 'OPEN_RESULT',
          payload: {
            type: 'area',
            image: dataUrl,
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
      } catch (err) {
        console.error("Area capture failed:", err);
        alert("Capture failed: " + err.message);
      }
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
    const restoreFns = [];
    
    try {
      // Scroll conceptually to the top of the selection
      await scrollAndSettle(scroller, area.left, area.top);
      
      while (true) {
        // Re-hide fixed/sticky elements before each capture after the first,
        // to catch dynamically created elements (e.g. scroll-triggered sticky bars)
        if (segments.length >= 1) {
          restoreFns.push(hideFixedElements());
          await wait(60); // Let browser repaint after hiding
        }
        
        const dataUrl = await captureTab();
        
        segments.push({
          y: scroller.getScrollTop(),
          x: scroller.getScrollLeft(),
          dataUrl: dataUrl
        });
        
        if (segments.length === 1) {
          restoreFns.push(hideFixedElements());
          await wait(60);
        }
        
        const scrolledSoFar = scroller.getScrollTop() - area.top;
        
        if (scrolledSoFar + viewportHeight >= area.height) {
          break;
        }
        
        const previousScrollY = scroller.getScrollTop();
        await scrollAndSettle(scroller, scroller.getScrollLeft(), previousScrollY + viewportHeight);
        
        if (scroller.getScrollTop() === previousScrollY) {
          break; 
        }
      }
      
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
    } catch (err) {
      console.error("Area segment capture failed:", err);
      alert("Capture failed: " + err.message);
    } finally {
      while (restoreFns.length > 0) {
        const rf = restoreFns.pop();
        if (typeof rf === 'function') rf();
      }
      restoreScrollbar();
      scroller.scrollTo(originalScrollLeft, originalScrollTop);
    }
  }

  // --- Full Page Capture Logic ---
  async function startFullPageCapture() {
    removeToolbar();
    
    const scroller = createScroller(findMainScroller());
    
    const originalScrollTop = scroller.getScrollTop();
    const restoreScrollbar = scroller.hideScrollbar();
    
    const totalHeight = scroller.getScrollHeight();
    const viewportHeight = scroller.getViewportHeight();
    const viewportWidth = scroller.getViewportWidth();
    
    const segments = [];
    const restoreFns = [];
    
    try {
      await scrollAndSettle(scroller, 0, 0);
      
      while (true) {
        // Re-hide fixed/sticky elements before each capture after the first,
        // to catch dynamically created elements (e.g. scroll-triggered sticky bars)
        if (segments.length >= 1) {
          restoreFns.push(hideFixedElements());
          await wait(60); // Let browser repaint after hiding
        }
        
        const dataUrl = await captureTab();
        
        segments.push({
          y: scroller.getScrollTop(),
          dataUrl: dataUrl
        });
        
        if (segments.length === 1) {
          restoreFns.push(hideFixedElements());
          await wait(60);
        }
        
        const previousScrollY = scroller.getScrollTop();
        await scrollAndSettle(scroller, scroller.getScrollLeft(), previousScrollY + viewportHeight);
        
        if (scroller.getScrollTop() === previousScrollY) {
          break;
        }
      }
    } catch (err) {
      console.error("Full page capture failed:", err);
      alert("Capture failed: " + err.message);
      return;
    } finally {
      while (restoreFns.length > 0) {
        const rf = restoreFns.pop();
        if (typeof rf === 'function') rf();
      }
      restoreScrollbar();
      scroller.scrollTo(0, originalScrollTop);
    }
    
    let boundsTop = 0;
    let boundsLeft = 0;
    if (scroller.element !== window) {
      const bounds = scroller.element.getBoundingClientRect();
      boundsTop = bounds.top;
      boundsLeft = bounds.left;
    }

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
        windowWidth: window.innerWidth
      }
    });
  }
}
