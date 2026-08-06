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
    'tool-rect': 'rect'
  };
  
  for (let id in tools) {
    document.getElementById(id).addEventListener('click', (e) => {
      document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
      e.currentTarget.classList.add('active');
      currentTool = tools[id];
    });
  }
  
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
    // Remove any redo history
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
  
  annotationCanvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    lastPos = getMousePos(e);
    startPos = lastPos;
    
    if (currentTool === 'rect') {
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
    }
  });
  
  const stopDrawing = () => {
    if (isDrawing) {
      isDrawing = false;
      saveState();
    }
  };
  
  annotationCanvas.addEventListener('mouseup', stopDrawing);
  annotationCanvas.addEventListener('mouseout', stopDrawing);
});
