document.addEventListener('DOMContentLoaded', () => {
  const resultCanvas = document.getElementById('result-canvas');
  const annotationCanvas = document.getElementById('annotation-canvas');
  const ctx = annotationCanvas.getContext('2d');
  
  let currentTool = 'pen';
  let currentColor = '#ff0000';
  let currentSize = 4;
  
  let isDrawing = false;
  let lastPos = null;
  let startPos = null;
  let previewState = null;
  
  // Undo/Redo stack
  let history = [];
  let historyStep = -1;
  
  window.addEventListener('screenshot-ready', () => {
    annotationCanvas.width = resultCanvas.width;
    annotationCanvas.height = resultCanvas.height;
    annotationCanvas.style.pointerEvents = 'auto';
    saveState(); // Initial empty state
  });
  
  // UI Bindings
  const tools = {
    'tool-pen': 'pen',
    'tool-highlight': 'highlight',
    'tool-eraser': 'eraser',
    'tool-rect': 'rect',
    'tool-crop': 'crop',
    'tool-scan': 'scan'
  };
  
  for (let id in tools) {
    document.getElementById(id).addEventListener('click', (e) => {
      document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
      e.currentTarget.classList.add('active');
      currentTool = tools[id];
    });
  }

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
      extractCanvas.getContext('2d').drawImage(combined, rx, ry, rw, rh, 0, 0, rw, rh);
      
      // 3. Initialize Tesseract
      const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: chrome.runtime.getURL('tesseract/worker.min.js'),
        corePath: chrome.runtime.getURL('tesseract/tesseract-core.wasm.js'),
        langPath: chrome.runtime.getURL('tesseract/lang-data')
      });
      
      const { data: { text } } = await worker.recognize(extractCanvas.toDataURL());
      await worker.terminate();
      
      modalText.value = text.trim() || "No text found in this area.";
      modal.classList.add('active');
    } catch (err) {
      console.error("OCR Error:", err);
      alert("Failed to extract text: " + err.message);
    } finally {
      loading.style.display = 'none';
      document.getElementById('tool-pen').click(); // switch back to pen
    }
  }

  // (rest of editor.js remains unchanged until mousedown)
  document.getElementById('color-picker').addEventListener('input', (e) => {
    currentColor = e.target.value;
  });
  
  document.getElementById('size-picker').addEventListener('input', (e) => {
    currentSize = parseInt(e.target.value, 10);
  });
  
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
    isDrawing = true;
    lastPos = getMousePos(e);
    startPos = lastPos;
    
    if (currentTool === 'rect' || currentTool === 'crop' || currentTool === 'scan') {
      previewState = ctx.getImageData(0, 0, annotationCanvas.width, annotationCanvas.height);
    }
  });
  
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
        ctx.strokeStyle = hexToRgba(currentColor, 0.4);
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = currentSize;
        ctx.strokeStyle = currentColor;
      }
      
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      lastPos = pos;
    } else if (currentTool === 'rect') {
      ctx.putImageData(previewState, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = currentSize;
      ctx.strokeStyle = currentColor;
      ctx.strokeRect(startPos.x, startPos.y, pos.x - startPos.x, pos.y - startPos.y);
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
    
    // Always update lastPos for rect, crop, and scan as well
    if (currentTool === 'rect' || currentTool === 'crop' || currentTool === 'scan') {
      lastPos = pos;
    }
  });
  
  const stopDrawing = () => {
    if (isDrawing) {
      isDrawing = false;
      
      if (currentTool === 'crop' || currentTool === 'scan') {
        const rx = Math.min(startPos.x, lastPos.x);
        const ry = Math.min(startPos.y, lastPos.y);
        const rw = Math.abs(lastPos.x - startPos.x);
        const rh = Math.abs(lastPos.y - startPos.y);
        
        if (rw > 10 && rh > 10) {
          if (currentTool === 'crop') {
            applyCrop(rx, ry, rw, rh);
          } else if (currentTool === 'scan') {
            performOCR(rx, ry, rw, rh);
            ctx.putImageData(previewState, 0, 0); // clear the scan selection box
          }
        } else {
          ctx.putImageData(previewState, 0, 0);
        }
      } else {
        saveState();
      }
    }
  };
  
  annotationCanvas.addEventListener('mouseup', stopDrawing);
  annotationCanvas.addEventListener('mouseout', stopDrawing);
});
