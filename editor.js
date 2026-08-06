document.addEventListener('DOMContentLoaded', () => {
  const resultCanvas = document.getElementById('result-canvas');
  const annotationCanvas = document.getElementById('annotation-canvas');
  const ctx = annotationCanvas.getContext('2d');
  
  let currentTool = 'pen';
  let isDrawing = false;
  let lastPos = { x: 0, y: 0 };
  let startPos = { x: 0, y: 0 };
  let outlineColor = '#ff0000';
  let fillColor = 'transparent';
  let currentSize = 4;
  
  // Undo/Redo stack
  let history = [];
  let historyStep = -1;
  let previewState = null;
  
  window.addEventListener('screenshot-ready', () => {
    annotationCanvas.width = resultCanvas.width;
    annotationCanvas.height = resultCanvas.height;
    annotationCanvas.style.pointerEvents = 'auto';
    saveState(); // Initial empty state
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
    document.getElementById(id).addEventListener('click', (e) => {
      document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
      e.currentTarget.classList.add('active');
      currentTool = tools[id];
      updateCursor();
    });
  }

  function updateCursor() {
    if (currentTool === 'crop' || currentTool === 'rect' || currentTool === 'scan') {
      annotationCanvas.style.cursor = 'crosshair';
    } else {
      const size = currentTool === 'pen' ? currentSize : currentSize * 4;
      const cursorSize = Math.max(size + 4, 16); // Ensure cursor canvas is at least 16x16
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

  // Premium UI Dropdown Logic
  let activeColorTarget = null; // 'outline' or 'fill'
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
    
    // Position menu under the correct button
    colorMenu.style.left = btnElement.offsetLeft + 'px';
    document.getElementById('menu-title').textContent = target === 'outline' ? 'Outline Color' : 'Fill Color';
    
    // Highlight correct swatch
    const activeColor = target === 'outline' ? outlineColor : fillColor;
    document.querySelectorAll('.color-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.color === activeColor);
    });
  }

  btnOutline.addEventListener('click', () => openColorMenu('outline', btnOutline));
  btnFill.addEventListener('click', () => openColorMenu('fill', btnFill));

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

  document.getElementById('menu-size-picker').addEventListener('input', (e) => {
    currentSize = parseInt(e.target.value, 10);
    updateCursor();
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown-group')) {
      colorMenu.classList.remove('active');
    }
  });

  // Modal logic
  const modal = document.getElementById('ocr-modal');
  const modalText = document.getElementById('ocr-result-text');
  
  document.getElementById('close-modal').addEventListener('click', () => {
    modal.classList.remove('active');
  });
  
  document.getElementById('copy-ocr-text').addEventListener('click', async (e) => {
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

  async function performOCR(rx, ry, rw, rh) {
    const loading = document.getElementById('loading');
    loading.textContent = "Scanning for text...";
    loading.style.display = 'flex';
    
    try {
      // 1. Get the combined canvas to scan both image and any annotations
      const combined = document.createElement('canvas');
      combined.width = resultCanvas.width;
      combined.height = resultCanvas.height;
      const combinedCtx = combined.getContext('2d');
      combinedCtx.drawImage(resultCanvas, 0, 0);
      
      // We must use previewState for annotation because current annotationCanvas has the dark overlay
      const tempAnn = document.createElement('canvas');
      tempAnn.width = annotationCanvas.width;
      tempAnn.height = annotationCanvas.height;
      tempAnn.getContext('2d').putImageData(previewState, 0, 0);
      combinedCtx.drawImage(tempAnn, 0, 0);
      
      // 2. Extract just the selected area
      const extractCanvas = document.createElement('canvas');
      extractCanvas.width = rw;
      extractCanvas.height = rh;
      const exCtx = extractCanvas.getContext('2d');
      exCtx.drawImage(combined, rx, ry, rw, rh, 0, 0, rw, rh);
      
      // 2.5 ADAPTIVE LOCAL THRESHOLDING
      // Problem: Global contrast/inversion fails on gradient backgrounds (skin, photos)
      // because hair/skin features get amplified into false text.
      // Solution: Compare each pixel to its LOCAL neighborhood (via Gaussian blur).
      // Text ALWAYS deviates from its immediate surroundings — regardless of bg color.
      // |pixel - localMean| > threshold → text → black
      // otherwise → background → white
      // This produces a clean document-like image for Tesseract.
      
      const scale = 3;
      const pw = rw * scale, ph = rh * scale;
      
      // Step A: Upscale + grayscale
      const grayCanvas = document.createElement('canvas');
      grayCanvas.width = pw; grayCanvas.height = ph;
      const gCtx = grayCanvas.getContext('2d');
      gCtx.imageSmoothingEnabled = true;
      gCtx.imageSmoothingQuality = 'high';
      gCtx.filter = 'grayscale(1)';
      gCtx.drawImage(extractCanvas, 0, 0, pw, ph);
      gCtx.filter = 'none';
      
      // Step B: Create blurred copy = local mean approximation
      const blurCanvas = document.createElement('canvas');
      blurCanvas.width = pw; blurCanvas.height = ph;
      const bCtx = blurCanvas.getContext('2d');
      bCtx.filter = 'blur(20px)';
      bCtx.drawImage(grayCanvas, 0, 0);
      bCtx.filter = 'none';
      
      // Step C: Adaptive threshold — compare original to local mean
      const origData = gCtx.getImageData(0, 0, pw, ph);
      const blurData = bCtx.getImageData(0, 0, pw, ph);
      const processCanvas = document.createElement('canvas');
      processCanvas.width = pw; processCanvas.height = ph;
      const pCtx = processCanvas.getContext('2d');
      const outData = pCtx.createImageData(pw, ph);
      
      const T = 15; // deviation threshold — pixels must differ from local mean by this much
      for (let i = 0; i < origData.data.length; i += 4) {
        const orig = origData.data[i];
        const localMean = blurData.data[i];
        const diff = Math.abs(orig - localMean);
        
        // Text deviates from background → BLACK (0), background is uniform → WHITE (255)
        const val = diff > T ? 0 : 255;
        outData.data[i] = outData.data[i+1] = outData.data[i+2] = val;
        outData.data[i+3] = 255;
      }
      pCtx.putImageData(outData, 0, 0);
      
      modalText.textContent = "Loading Tesseract OCR engine...";
      
      // 3. Initialize Tesseract
      const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: chrome.runtime.getURL('tesseract/worker.min.js'),
        corePath: chrome.runtime.getURL('tesseract/tesseract-core.wasm.js'),
        langPath: chrome.runtime.getURL('tesseract/lang-data'),
        workerBlobURL: false,
        gzip: false,
        logger: m => console.log('Tesseract:', m)
      });
      
      await worker.setParameters({
        tessedit_pageseg_mode: '6',
      });
      
      modalText.textContent = "Scanning image for text...";
      
      // 4. OCR on the adaptively-thresholded image
      const { data: { text, confidence } } = await worker.recognize(processCanvas.toDataURL());
      await worker.terminate();
      
      console.log('OCR result:', confidence, text.trim());
      
      // DEBUG: Show the processed image
      let debugImg = document.getElementById('debug-ocr-img');
      if (!debugImg) {
        debugImg = document.createElement('img');
        debugImg.id = 'debug-ocr-img';
        debugImg.style.maxWidth = '100%';
        debugImg.style.border = '1px solid red';
        debugImg.style.marginBottom = '10px';
        modalText.parentNode.insertBefore(debugImg, modalText);
      }
      debugImg.src = processCanvas.toDataURL();
      
      modalText.value = text.trim() || "No text found in this area.";
      modal.classList.add('active');
    } catch (err) {
      console.error("OCR Error:", err);
      alert("Failed to extract text: " + (err.message || (typeof err === 'string' ? err : JSON.stringify(err))));
      modal.style.display = 'none';
    } finally {
      loading.style.display = 'none';
      document.getElementById('tool-pen').click(); // switch back to pen
    }
  }

  // (rest of editor.js remains unchanged until mousedown)
  document.getElementById('btn-undo').addEventListener('click', () => {
    if (historyStep > 0) {
      historyStep--;
      restoreState(history[historyStep]);
    }
  });
  
  document.getElementById('btn-redo').addEventListener('click', () => {
    if (historyStep < history.length - 1) {
      historyStep++;
      restoreState(history[historyStep]);
    }
  });
  
  // Drawing logic
  function getMousePos(evt) {
    const rect = annotationCanvas.getBoundingClientRect();
    const scaleX = annotationCanvas.width / rect.width;
    const scaleY = annotationCanvas.height / rect.height;
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
  
  function saveState() {
    historyStep++;
    history = history.slice(0, historyStep);
    history.push(annotationCanvas.toDataURL());
  }
  
  function restoreState(dataUrl) {
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(img, 0, 0);
    };
    img.src = dataUrl;
  }
  
  function applyCrop(rx, ry, rw, rh) {
    // Restore preview state into a temp canvas
    const tempAnn = document.createElement('canvas');
    tempAnn.width = annotationCanvas.width;
    tempAnn.height = annotationCanvas.height;
    tempAnn.getContext('2d').putImageData(previewState, 0, 0);
    
    const croppedAnn = document.createElement('canvas');
    croppedAnn.width = rw; croppedAnn.height = rh;
    croppedAnn.getContext('2d').drawImage(tempAnn, rx, ry, rw, rh, 0, 0, rw, rh);
    
    const croppedRes = document.createElement('canvas');
    croppedRes.width = rw; croppedRes.height = rh;
    croppedRes.getContext('2d').drawImage(resultCanvas, rx, ry, rw, rh, 0, 0, rw, rh);
    
    // Resize actual canvases
    annotationCanvas.width = rw;
    annotationCanvas.height = rh;
    resultCanvas.width = rw;
    resultCanvas.height = rh;
    
    // Draw cropped data back
    ctx.clearRect(0, 0, rw, rh);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(croppedAnn, 0, 0);
    
    const resCtx = resultCanvas.getContext('2d');
    resCtx.clearRect(0, 0, rw, rh);
    resCtx.globalCompositeOperation = 'source-over';
    resCtx.drawImage(croppedRes, 0, 0);
    
    // Reset history because base canvas changed
    history = [];
    historyStep = -1;
    saveState();
    
    // Switch back to pen
    document.getElementById('tool-pen').click();
  }
  
  annotationCanvas.addEventListener('mousedown', (e) => {
    e.preventDefault(); // CRITICAL: Prevent native browser drag/text selection
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
      
      // Draw dark overlay
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, annotationCanvas.width, annotationCanvas.height);
      
      // Cut out selection box
      const rx = Math.min(startPos.x, pos.x);
      const ry = Math.min(startPos.y, pos.y);
      const rw = Math.abs(pos.x - startPos.x);
      const rh = Math.abs(pos.y - startPos.y);
      
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.fillRect(rx, ry, rw, rh);
      
      // Draw border
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = currentTool === 'scan' ? '#0078D4' : '#fff';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }
    
    // Always update lastPos for shapes, crop, and scan
    if (['rect', 'circle', 'line', 'arrow', 'crop', 'scan'].includes(currentTool)) {
      lastPos = pos;
    }
  });
  
  const stopDrawing = (e) => {
    if (isDrawing) {
      isDrawing = false;
      
      if (currentTool === 'crop' || currentTool === 'scan') {
        ctx.putImageData(previewState, 0, 0); // CRITICAL: Clear dark overlay before extracting pixels
        
        // Use current mouse position to finish the crop/scan if they released outside
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
        saveState();
      }
    }
  };
  
  window.addEventListener('mouseup', stopDrawing);
});
