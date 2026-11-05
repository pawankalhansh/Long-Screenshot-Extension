document.addEventListener('DOMContentLoaded', () => {
  const resultCanvas = document.getElementById('result-canvas');
  const annotationCanvas = document.getElementById('annotation-canvas');
  const ctx = annotationCanvas.getContext('2d');
  
  let currentTool = 'crop';
  let isDrawing = false;
  let lastPos = { x: 0, y: 0 };
  let startPos = { x: 0, y: 0 };
  let outlineColor = '#ff0000';
  let fillColor = 'transparent';
  let currentSize = 4;
  
  // Undo/Redo stack (capped to avoid memory exhaustion)
  let history = [];
  let historyStep = -1;
  let previewState = null;
  
  window.addEventListener('screenshot-ready', () => {
    annotationCanvas.width = resultCanvas.width;
    annotationCanvas.height = resultCanvas.height;
    annotationCanvas.style.pointerEvents = 'auto';
    saveState(true); // Initial state
    updateCursor(); // Initialize cursor
  });
  
  // UI Bindings
  const tools = {
    'tool-pen': 'pen',
    'tool-highlight': 'highlight',
    'tool-eraser': 'eraser',
    'tool-rect': 'rect',
    'tool-circle': 'circle',
    'tool-line': 'line',
    'tool-arrow': 'arrow',
    'tool-crop': 'crop',
    'tool-scan': 'scan'
  };
  
  for (let id in tools) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', (e) => {
        document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
        e.currentTarget.classList.add('active');
        currentTool = tools[id];
        updateCursor();
      });
    }
  }

  function updateCursor() {
    if (currentTool === 'crop' || currentTool === 'rect' || currentTool === 'scan') {
      annotationCanvas.style.cursor = 'crosshair';
    } else {
      const size = currentTool === 'pen' ? currentSize : currentSize * 4;
      const cursorSize = Math.max(size + 4, 16);
      const canvas = document.createElement('canvas');
      canvas.width = cursorSize;
      canvas.height = cursorSize;
      const c = canvas.getContext('2d');
      
      c.beginPath();
      c.arc(cursorSize / 2, cursorSize / 2, size / 2, 0, Math.PI * 2);
      
      if (currentTool === 'eraser') {
        c.strokeStyle = '#000';
        c.lineWidth = 1;
        c.stroke();
        c.strokeStyle = '#fff';
        c.beginPath();
        c.arc(cursorSize / 2, cursorSize / 2, (size / 2) - 1, 0, Math.PI * 2);
        c.stroke();
      } else {
        c.fillStyle = currentTool === 'highlight' ? hexToRgba(outlineColor, 0.4) : outlineColor;
        c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.8)';
        c.lineWidth = 1;
        c.stroke();
      }
      
      const dataUrl = canvas.toDataURL();
      annotationCanvas.style.cursor = `url(${dataUrl}) ${cursorSize/2} ${cursorSize/2}, crosshair`;
    }
  }

  // Dropdown Logic
  let activeColorTarget = null;
  const colorMenu = document.getElementById('color-menu');
  const btnOutline = document.getElementById('btn-outline');
  const btnFill = document.getElementById('btn-fill');
  const indOutline = document.getElementById('indicator-outline');
  const indFill = document.getElementById('indicator-fill');

  function openColorMenu(target, btnElement) {
    if (activeColorTarget === target && colorMenu.classList.contains('active')) {
      colorMenu.classList.remove('active');
      return;
    }
    activeColorTarget = target;
    colorMenu.classList.add('active');
    
    colorMenu.style.left = btnElement.offsetLeft + 'px';
    document.getElementById('menu-title').textContent = target === 'outline' ? 'Outline Color' : 'Fill Color';
    
    const activeColor = target === 'outline' ? outlineColor : fillColor;
    document.querySelectorAll('.color-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.color === activeColor);
    });
  }

  if (btnOutline) btnOutline.addEventListener('click', () => openColorMenu('outline', btnOutline));
  if (btnFill) btnFill.addEventListener('click', () => openColorMenu('fill', btnFill));

  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
      const color = e.currentTarget.dataset.color;
      document.querySelectorAll('.color-swatch').forEach(sw => sw.classList.remove('active'));
      e.currentTarget.classList.add('active');
      
      if (activeColorTarget === 'outline') {
        outlineColor = color;
        if (color === 'transparent') {
           indOutline.classList.add('transparent');
           indOutline.style.background = '';
        } else {
           indOutline.classList.remove('transparent');
           indOutline.style.background = color;
        }
      } else {
        fillColor = color;
        if (color === 'transparent') {
           indFill.classList.add('transparent');
           indFill.style.background = '';
        } else {
           indFill.classList.remove('transparent');
           indFill.style.background = color;
        }
      }
      updateCursor();
    });
  });

  const menuSizePicker = document.getElementById('menu-size-picker');
  if (menuSizePicker) {
    menuSizePicker.addEventListener('input', (e) => {
      currentSize = parseInt(e.target.value, 10);
      updateCursor();
    });
  }

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown-group') && colorMenu) {
      colorMenu.classList.remove('active');
    }
  });

  // Modal logic
  const modal = document.getElementById('ocr-modal');
  const modalText = document.getElementById('ocr-result-text');
  const closeModalBtn = document.getElementById('close-modal');
  
  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
      modal.classList.remove('active');
    });
  }

  // Close dialogs with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.code === 'Escape') {
      if (modal && modal.classList.contains('active')) {
        modal.classList.remove('active');
      }
      if (colorMenu && colorMenu.classList.contains('active')) {
        colorMenu.classList.remove('active');
      }
    }
  });
  
  const copyOcrBtn = document.getElementById('copy-ocr-text');
  if (copyOcrBtn) {
    copyOcrBtn.addEventListener('click', async (e) => {
      try {
        await navigator.clipboard.writeText(modalText.value);
        const btn = e.target;
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = originalText, 2000);
      } catch (err) {
        console.error('Failed to copy text', err);
      }
    });
  }

  async function performOCR(rx, ry, rw, rh) {
    rx = Math.max(0, Math.min(resultCanvas.width - 1, Math.round(rx)));
    ry = Math.max(0, Math.min(resultCanvas.height - 1, Math.round(ry)));
    rw = Math.max(1, Math.min(Math.round(rw), resultCanvas.width - rx));
    rh = Math.max(1, Math.min(Math.round(rh), resultCanvas.height - ry));

    const loading = document.getElementById('loading');
    loading.textContent = "Scanning for text...";
    loading.style.display = 'flex';
    
    try {
      const combined = document.createElement('canvas');
      combined.width = resultCanvas.width;
      combined.height = resultCanvas.height;
      const combinedCtx = combined.getContext('2d');
      combinedCtx.drawImage(resultCanvas, 0, 0);
      
      const tempAnn = document.createElement('canvas');
      tempAnn.width = annotationCanvas.width;
      tempAnn.height = annotationCanvas.height;
      if (previewState) {
        tempAnn.getContext('2d').putImageData(previewState, 0, 0);
        combinedCtx.drawImage(tempAnn, 0, 0);
      }
      
      const extractCanvas = document.createElement('canvas');
      extractCanvas.width = rw;
      extractCanvas.height = rh;
      const exCtx = extractCanvas.getContext('2d');
      exCtx.drawImage(combined, rx, ry, rw, rh, 0, 0, rw, rh);
      
      const scale = 4;
      const processCanvas = document.createElement('canvas');
      processCanvas.width = rw * scale;
      processCanvas.height = rh * scale;
      const pCtx = processCanvas.getContext('2d');
      pCtx.imageSmoothingEnabled = true;
      pCtx.imageSmoothingQuality = 'high';
      pCtx.drawImage(extractCanvas, 0, 0, rw * scale, rh * scale);
      
      modalText.textContent = "Loading Tesseract OCR engine...";
      
      const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: chrome.runtime.getURL('tesseract/worker.min.js'),
        corePath: chrome.runtime.getURL('tesseract/tesseract-core.wasm.js'),
        langPath: chrome.runtime.getURL('tesseract/lang-data'),
        workerBlobURL: false,
        gzip: false,
        logger: m => console.log('Tesseract:', m)
      });
      
      await worker.setParameters({
        tessedit_pageseg_mode: '3',
      });
      
      modalText.textContent = "Scanning image for text...";
      
      const { data: { text } } = await worker.recognize(processCanvas.toDataURL());
      await worker.terminate();
      
      modalText.value = text.trim() || "No text found in this area.";
      modal.classList.add('active');
    } catch (err) {
      console.error("OCR Error:", err);
      alert("Failed to extract text: " + (err.message || err));
      modal.classList.remove('active');
    } finally {
      loading.style.display = 'none';
    }
  }

  const btnUndo = document.getElementById('btn-undo');
  if (btnUndo) {
    btnUndo.addEventListener('click', () => {
      if (historyStep > 0) {
        historyStep--;
        restoreState(history[historyStep]);
      }
    });
  }
  
  const btnRedo = document.getElementById('btn-redo');
  if (btnRedo) {
    btnRedo.addEventListener('click', () => {
      if (historyStep < history.length - 1) {
        historyStep++;
        restoreState(history[historyStep]);
      }
    });
  }
  
  // Drawing logic
  function getMousePos(evt) {
    const rect = annotationCanvas.getBoundingClientRect();
    const scaleX = annotationCanvas.width / (rect.width || 1);
    const scaleY = annotationCanvas.height / (rect.height || 1);
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY
    };
  }
  
  function hexToRgba(hex, alpha) {
    let r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  
  // Save state with memory safety: only duplicate resultCanvas on crop!
  function saveState(isCrop = false) {
    historyStep++;
    history = history.slice(0, historyStep);
    
    // Cap history to 15 items to prevent browser tab running out of memory
    if (history.length > 15) {
      history.shift();
      historyStep--;
    }
    
    history.push({
      ann: annotationCanvas.toDataURL(),
      res: isCrop ? resultCanvas.toDataURL() : null,
      width: annotationCanvas.width,
      height: annotationCanvas.height
    });
  }
  
  function restoreState(state) {
    if (!state) return;
    
    if (typeof state === 'string') {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(img, 0, 0);
      };
      img.src = state;
      return;
    }

    if (annotationCanvas.width !== state.width || annotationCanvas.height !== state.height) {
      annotationCanvas.width = state.width;
      annotationCanvas.height = state.height;
      resultCanvas.width = state.width;
      resultCanvas.height = state.height;
    }

    const annImg = new Image();
    annImg.onload = () => {
      ctx.clearRect(0, 0, state.width, state.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(annImg, 0, 0);
    };
    annImg.src = state.ann;

    if (state.res) {
      const resImg = new Image();
      resImg.onload = () => {
        const resCtx = resultCanvas.getContext('2d');
        resCtx.clearRect(0, 0, state.width, state.height);
        resCtx.globalCompositeOperation = 'source-over';
        resCtx.drawImage(resImg, 0, 0);
      };
      resImg.src = state.res;
    }
  }
  
  function applyCrop(rx, ry, rw, rh) {
    rx = Math.max(0, Math.min(resultCanvas.width - 1, Math.round(rx)));
    ry = Math.max(0, Math.min(resultCanvas.height - 1, Math.round(ry)));
    rw = Math.max(1, Math.min(Math.round(rw), resultCanvas.width - rx));
    rh = Math.max(1, Math.min(Math.round(rh), resultCanvas.height - ry));

    const tempAnn = document.createElement('canvas');
    tempAnn.width = annotationCanvas.width;
    tempAnn.height = annotationCanvas.height;
    if (previewState) {
      tempAnn.getContext('2d').putImageData(previewState, 0, 0);
    }
    
    const croppedAnn = document.createElement('canvas');
    croppedAnn.width = rw; croppedAnn.height = rh;
    croppedAnn.getContext('2d').drawImage(tempAnn, rx, ry, rw, rh, 0, 0, rw, rh);
    
    const croppedRes = document.createElement('canvas');
    croppedRes.width = rw; croppedRes.height = rh;
    croppedRes.getContext('2d').drawImage(resultCanvas, rx, ry, rw, rh, 0, 0, rw, rh);
    
    annotationCanvas.width = rw;
    annotationCanvas.height = rh;
    resultCanvas.width = rw;
    resultCanvas.height = rh;
    
    ctx.clearRect(0, 0, rw, rh);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(croppedAnn, 0, 0);
    
    const resCtx = resultCanvas.getContext('2d');
    resCtx.clearRect(0, 0, rw, rh);
    resCtx.globalCompositeOperation = 'source-over';
    resCtx.drawImage(croppedRes, 0, 0);
    
    saveState(true); // Result canvas changed
  }
  
  annotationCanvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDrawing = true;
    lastPos = getMousePos(e);
    startPos = lastPos;
    
    if (['rect', 'circle', 'line', 'arrow', 'crop', 'scan'].includes(currentTool)) {
      previewState = ctx.getImageData(0, 0, annotationCanvas.width, annotationCanvas.height);
    }
  });
  
  function drawArrowhead(ctx, x, y, angle) {
    const headlen = Math.max(10, currentSize * 3);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - headlen * Math.cos(angle - Math.PI / 6), y - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x - headlen * Math.cos(angle + Math.PI / 6), y - headlen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function applyShapeStyles(ctx) {
    ctx.lineWidth = currentSize;
    ctx.strokeStyle = outlineColor === 'transparent' ? 'rgba(0,0,0,0)' : outlineColor;
    ctx.fillStyle = fillColor === 'transparent' ? 'rgba(0,0,0,0)' : fillColor;
  }
  
  annotationCanvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const pos = getMousePos(e);
    
    if (currentTool === 'pen' || currentTool === 'highlight' || currentTool === 'eraser') {
      ctx.beginPath();
      ctx.moveTo(lastPos.x, lastPos.y);
      ctx.lineTo(pos.x, pos.y);
      
      if (currentTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = currentSize * 4;
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else if (currentTool === 'highlight') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = currentSize * 4;
        ctx.strokeStyle = hexToRgba(outlineColor, 0.4);
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = currentSize;
        ctx.strokeStyle = outlineColor === 'transparent' ? '#000' : outlineColor;
      }
      
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      lastPos = pos;
    } else if (currentTool === 'rect') {
      ctx.putImageData(previewState, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      applyShapeStyles(ctx);
      
      if (fillColor !== 'transparent') ctx.fillRect(startPos.x, startPos.y, pos.x - startPos.x, pos.y - startPos.y);
      if (outlineColor !== 'transparent') ctx.strokeRect(startPos.x, startPos.y, pos.x - startPos.x, pos.y - startPos.y);
    } else if (currentTool === 'circle') {
      ctx.putImageData(previewState, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      applyShapeStyles(ctx);
      
      const radiusX = Math.abs(pos.x - startPos.x) / 2;
      const radiusY = Math.abs(pos.y - startPos.y) / 2;
      const centerX = Math.min(startPos.x, pos.x) + radiusX;
      const centerY = Math.min(startPos.y, pos.y) + radiusY;
      
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      if (fillColor !== 'transparent') ctx.fill();
      if (outlineColor !== 'transparent') ctx.stroke();
    } else if (currentTool === 'line') {
      ctx.putImageData(previewState, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      applyShapeStyles(ctx);
      
      ctx.beginPath();
      ctx.moveTo(startPos.x, startPos.y);
      ctx.lineTo(pos.x, pos.y);
      if (outlineColor !== 'transparent') ctx.stroke();
    } else if (currentTool === 'arrow') {
      ctx.putImageData(previewState, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      applyShapeStyles(ctx);
      
      const angle = Math.atan2(pos.y - startPos.y, pos.x - startPos.x);
      
      ctx.beginPath();
      ctx.moveTo(startPos.x, startPos.y);
      ctx.lineTo(pos.x, pos.y);
      if (outlineColor !== 'transparent') ctx.stroke();
      
      if (outlineColor !== 'transparent') {
        ctx.fillStyle = outlineColor;
        drawArrowhead(ctx, pos.x, pos.y, angle);
      }
    } else if (currentTool === 'crop' || currentTool === 'scan') {
      ctx.putImageData(previewState, 0, 0);
      
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, annotationCanvas.width, annotationCanvas.height);
      
      const rx = Math.min(startPos.x, pos.x);
      const ry = Math.min(startPos.y, pos.y);
      const rw = Math.abs(pos.x - startPos.x);
      const rh = Math.abs(pos.y - startPos.y);
      
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.fillRect(rx, ry, rw, rh);
      
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = currentTool === 'scan' ? '#0078D4' : '#fff';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }
    
    if (['rect', 'circle', 'line', 'arrow', 'crop', 'scan'].includes(currentTool)) {
      lastPos = pos;
    }
  });
  
  const stopDrawing = (e) => {
    if (isDrawing) {
      isDrawing = false;
      
      if (currentTool === 'crop' || currentTool === 'scan') {
        if (previewState) {
          ctx.putImageData(previewState, 0, 0);
        }
        
        let finalPos;
        if (e && e.clientX) {
           finalPos = getMousePos(e);
        } else {
           finalPos = lastPos;
        }
        
        const rx = Math.min(startPos.x, finalPos.x);
        const ry = Math.min(startPos.y, finalPos.y);
        const rw = Math.abs(finalPos.x - startPos.x);
        const rh = Math.abs(finalPos.y - startPos.y);
        
        if (rw > 10 && rh > 10) {
          if (currentTool === 'crop') {
            applyCrop(rx, ry, rw, rh);
          } else if (currentTool === 'scan') {
            performOCR(rx, ry, rw, rh);
          }
        }
      } else {
        saveState(false);
      }
    }
  };
  
  window.addEventListener('mouseup', stopDrawing);
});
