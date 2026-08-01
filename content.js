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
    }
  });

  function toggleToolbar() {
    if (overlayHost) {
      removeToolbar();
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
    shadowRoot.getElementById('btn-area').addEventListener('click', () => startAreaCapture());
    shadowRoot.getElementById('btn-visible').addEventListener('click', () => startVisibleCapture());
    shadowRoot.getElementById('btn-full').addEventListener('click', () => startFullPageCapture());
    shadowRoot.getElementById('btn-close').addEventListener('click', () => removeToolbar());
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

  async function startVisibleCapture() {
    removeToolbar();
    await wait(150); // wait for UI to disappear
    
    chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_TAB' }, (response) => {
      if (response && response.dataUrl) {
        chrome.runtime.sendMessage({
          action: 'OPEN_RESULT',
          payload: {
            type: 'visible',
            image: response.dataUrl,
            dpr: window.devicePixelRatio
          }
        });
      }
    });
  }

  // --- Area Capture Logic ---
  let startX, startY;
  let lastClientX, lastClientY;
  let isDragging = false;
  let scrollSpeedY = 0;
  let scrollSpeedX = 0;
  let autoScrollActive = false;

  function startAreaCapture() {
    removeToolbar();
    captureOverlay.style.width = Math.max(document.documentElement.scrollWidth, window.innerWidth) + 'px';
    captureOverlay.style.height = Math.max(document.documentElement.scrollHeight, window.innerHeight) + 'px';
    captureOverlay.style.display = 'block';
    captureRect.style.display = 'none'; // hide until drag
    isCapturingArea = true;
    
    // Use capturing phase to intercept events early
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
    e.preventDefault();
    e.stopPropagation();
    
    startX = e.pageX;
    startY = e.pageY;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    isDragging = true;
    
    captureRect.style.left = startX + 'px';
    captureRect.style.top = startY + 'px';
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
    
    if (lastClientY > window.innerHeight - edgeSize) {
      scrollSpeedY = maxSpeed;
    } else if (lastClientY < edgeSize) {
      scrollSpeedY = -maxSpeed;
    } else {
      scrollSpeedY = 0;
    }
    
    if (lastClientX > window.innerWidth - edgeSize) {
      scrollSpeedX = maxSpeed;
    } else if (lastClientX < edgeSize) {
      scrollSpeedX = -maxSpeed;
    } else {
      scrollSpeedX = 0;
    }
  }

  function autoScrollLoop() {
    if (!autoScrollActive) return;
    
    if (isDragging) {
      if (scrollSpeedY !== 0 || scrollSpeedX !== 0) {
        window.scrollBy(scrollSpeedX, scrollSpeedY);
      }
      
      const currentX = lastClientX + window.scrollX;
      const currentY = lastClientY + window.scrollY;
      
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);
      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      
      captureRect.style.left = left + 'px';
      captureRect.style.top = top + 'px';
      captureRect.style.width = width + 'px';
      captureRect.style.height = height + 'px';
    }
    
    requestAnimationFrame(autoScrollLoop);
  }

  async function onMouseUp(e) {
    if (!isDragging) return;
    e.preventDefault();
    e.stopPropagation();
    
    // Final coordinates
    const currentX = lastClientX + window.scrollX;
    const currentY = lastClientY + window.scrollY;
    
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    
    stopAreaCapture();
    
    if (width < 10 || height < 10) {
      return;
    }
    
    await wait(100); // wait for overlay to disappear
    
    const rect = { x: left, y: top, width, height };
    
    // If the rect fits entirely in the current viewport, we can just do one capture
    if (
      left >= window.scrollX && 
      top >= window.scrollY && 
      left + width <= window.scrollX + window.innerWidth && 
      top + height <= window.scrollY + window.innerHeight
    ) {
      chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_TAB' }, (response) => {
        if (response && response.dataUrl) {
          chrome.runtime.sendMessage({
            action: 'OPEN_RESULT',
            payload: {
              type: 'area',
              image: response.dataUrl,
              rect: { 
                x: left - window.scrollX, 
                y: top - window.scrollY, 
                width, 
                height 
              },
              dpr: window.devicePixelRatio
            }
          });
        }
      });
    } else {
      // Area spans outside current viewport, need to scroll and stitch
      await captureAreaSegments(rect);
    }
  }

  async function captureAreaSegments(rect) {
    const originalScrollTop = window.scrollY;
    const originalScrollLeft = window.scrollX;
    const originalOverflow = document.documentElement.style.overflow;
    
    document.documentElement.style.overflow = 'hidden';
    
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    const segments = [];
    
    // Scroll to the top of the selected area
    window.scrollTo(originalScrollLeft, rect.y);
    await wait(300);
    
    while (true) {
      const response = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_TAB' }, resolve);
      });
      
      segments.push({
        y: window.scrollY,
        x: window.scrollX,
        dataUrl: response.dataUrl
      });
      
      if (window.scrollY + viewportHeight >= rect.y + rect.height) {
        break;
      }
      
      const previousScrollY = window.scrollY;
      window.scrollBy(0, viewportHeight);
      await wait(300);
      
      if (window.scrollY === previousScrollY) {
        break; // reached bottom
      }
    }
    
    document.documentElement.style.overflow = originalOverflow;
    window.scrollTo(originalScrollLeft, originalScrollTop);
    
    chrome.runtime.sendMessage({
      action: 'OPEN_RESULT',
      payload: {
        type: 'area_stitched',
        segments: segments,
        rect: rect,
        dpr: window.devicePixelRatio
      }
    });
  }

  // --- Full Page Capture Logic ---
  async function startFullPageCapture() {
    removeToolbar();
    
    const originalScrollTop = window.scrollY;
    const originalOverflow = document.documentElement.style.overflow;
    
    // Hide scrollbar
    document.documentElement.style.overflow = 'hidden';
    
    const totalHeight = document.documentElement.scrollHeight;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    window.scrollTo(0, 0);
    await wait(300); // Wait for initial scroll to settle and any lazy load elements to appear
    
    const segments = [];
    
    while (true) {
      // Capture current view
      const response = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_TAB' }, resolve);
      });
      
      segments.push({
        y: window.scrollY,
        dataUrl: response.dataUrl
      });
      
      const previousScrollY = window.scrollY;
      window.scrollBy(0, viewportHeight);
      await wait(300); // Wait for rendering after scroll
      
      if (window.scrollY === previousScrollY) {
        // Reached the bottom
        break;
      }
    }
    
    // Restore state
    document.documentElement.style.overflow = originalOverflow;
    window.scrollTo(0, originalScrollTop);
    
    // Send data
    chrome.runtime.sendMessage({
      action: 'OPEN_RESULT',
      payload: {
        type: 'full',
        segments: segments,
        totalHeight: totalHeight,
        viewportHeight: viewportHeight,
        viewportWidth: viewportWidth,
        dpr: window.devicePixelRatio
      }
    });
  }
}
