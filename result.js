document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get('captureData', (data) => {
    if (data.captureData) {
      try {
        sessionStorage.setItem('lsLastCaptureData', JSON.stringify(data.captureData));
      } catch (e) {
        console.warn("Could not cache to sessionStorage:", e);
      }
      processCapture(data.captureData);
    } else {
      const cached = sessionStorage.getItem('lsLastCaptureData');
      if (cached) {
        try {
          processCapture(JSON.parse(cached));
          return;
        } catch (e) {
          console.error("Failed to parse cached capture data:", e);
        }
      }
      document.getElementById('loading').textContent = 'No capture data found.';
    }
  });
});

async function processCapture(data) {
  const canvas = document.getElementById('result-canvas');
  const ctx = canvas.getContext('2d');
  const loading = document.getElementById('loading');
  const dpr = data.dpr || 1;

  try {
    if (data.type === 'visible') {
      const img = await loadImage(data.image);
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    } 
    else if (data.type === 'area') {
      const img = await loadImage(data.image);
      const rect = data.rect;
      
      const actualDpr = data.windowWidth ? (img.width / data.windowWidth) : dpr;
      
      const sx = Math.max(0, Math.min(img.width - 1, Math.round(rect.x * actualDpr)));
      const sy = Math.max(0, Math.min(img.height - 1, Math.round(rect.y * actualDpr)));
      const sWidth = Math.max(1, Math.min(Math.round(rect.width * actualDpr), img.width - sx));
      const sHeight = Math.max(1, Math.min(Math.round(rect.height * actualDpr), img.height - sy));

      canvas.width = sWidth;
      canvas.height = sHeight;
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
    }
    else if (data.type === 'full') {
      const segments = data.segments;
      if (segments.length === 0) return;
      
      const firstImg = await loadImage(segments[0].dataUrl);
      const actualDpr = data.windowWidth ? (firstImg.width / data.windowWidth) : dpr;
      const isWindow = data.isWindow !== false;
      const lastSeg = segments[segments.length - 1];
      const minCanvasHeight = Math.round((lastSeg.y + data.viewportHeight) * actualDpr);
      const computedHeight = Math.round(data.totalHeight * actualDpr);
      const finalCanvasHeight = Math.max(computedHeight, minCanvasHeight);

      if (isWindow) {
        canvas.width = firstImg.width;
        canvas.height = finalCanvasHeight;

        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const img = await loadImage(seg.dataUrl);
          const dy = Math.round(seg.y * actualDpr);
          const dHeight = Math.min(img.height, Math.max(0, canvas.height - dy));
          
          if (dHeight > 0) {
            ctx.drawImage(img, 0, 0, img.width, dHeight, 0, dy, img.width, dHeight);
          }
        }
      } else {
        // Internal container: crop each slice to container bounds
        const cWidth = Math.round(data.viewportWidth * actualDpr);
        canvas.width = cWidth;
        canvas.height = finalCanvasHeight;

        const sx = Math.max(0, Math.min(firstImg.width - 1, Math.round(data.boundsLeft * actualDpr)));
        const sy = Math.max(0, Math.min(firstImg.height - 1, Math.round(data.boundsTop * actualDpr)));
        const sWidth = Math.max(1, Math.min(cWidth, firstImg.width - sx));
        const sHeight = Math.max(1, Math.min(Math.round(data.viewportHeight * actualDpr), firstImg.height - sy));

        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const img = await loadImage(seg.dataUrl);
          const dy = Math.round(seg.y * actualDpr);
          const dHeight = Math.min(sHeight, Math.max(0, canvas.height - dy));
          
          if (dHeight > 0) {
            ctx.drawImage(img, sx, sy, sWidth, dHeight, 0, dy, sWidth, dHeight);
          }
        }
      }
    }
    else if (data.type === 'area_stitched') {
      const segments = data.segments;
      if (segments.length === 0) return;
      
      const firstImg = await loadImage(segments[0].dataUrl);
      const actualDpr = data.windowWidth ? (firstImg.width / data.windowWidth) : dpr;
      
      const cWidth = Math.round(data.contentWidth * actualDpr);
      const cHeight = Math.round(data.contentHeight * actualDpr);
      canvas.width = cWidth;
      canvas.height = cHeight;
      
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const img = await loadImage(seg.dataUrl);
        
        const viewportTop = seg.y;
        const viewportBottom = seg.y + data.viewportHeight;
        
        const contentTop = data.contentTop;
        const contentBottom = data.contentTop + data.contentHeight;
        
        const intersectTop = Math.max(contentTop, viewportTop);
        const intersectBottom = Math.min(contentBottom, viewportBottom);
        
        if (intersectBottom > intersectTop) {
          const screenX = data.boundsLeft + data.contentLeft - seg.x;
          const screenY = data.boundsTop + (intersectTop - seg.y);
          
          const sx = Math.max(0, Math.min(img.width - 1, Math.round(screenX * actualDpr)));
          const sy = Math.max(0, Math.min(img.height - 1, Math.round(screenY * actualDpr)));
          const sWidth = Math.max(1, Math.min(Math.round(data.contentWidth * actualDpr), img.width - sx));
          const sHeight = Math.max(1, Math.min(Math.round((intersectBottom - intersectTop) * actualDpr), img.height - sy));
          
          const dx = 0;
          const dy = Math.round((intersectTop - contentTop) * actualDpr);
          
          ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, sWidth, sHeight);
        }
      }
    }

    loading.style.display = 'none';
    window.dispatchEvent(new CustomEvent('screenshot-ready'));
  } catch (err) {
    console.error("Error processing capture:", err);
    loading.textContent = 'Failed to process screenshot: ' + (err.message || err);
  }

  function getCombinedCanvas() {
    const annotationCanvas = document.getElementById('annotation-canvas');
    if (!annotationCanvas || annotationCanvas.width === 0) return canvas;
    const combined = document.createElement('canvas');
    combined.width = canvas.width;
    combined.height = canvas.height;
    const combinedCtx = combined.getContext('2d');
    combinedCtx.drawImage(canvas, 0, 0);
    combinedCtx.drawImage(annotationCanvas, 0, 0);
    return combined;
  }

  // Setup download and clipboard handlers
  document.getElementById('copy-image').addEventListener('click', async () => {
    const copyBtn = document.getElementById('copy-image');
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copying...';
    
    try {
      exportCanvas(getCombinedCanvas(), 'image/png', 1.0, async (blob) => {
        if (!blob) {
          copyBtn.textContent = originalText;
          alert('Screenshot is too large to copy, even after scaling down.');
          return;
        }
        try {
          const item = new ClipboardItem({ 'image/png': blob });
          await navigator.clipboard.write([item]);
          
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.textContent = originalText;
          }, 2000);
        } catch (err) {
          console.error('Clipboard write error:', err);
          copyBtn.textContent = originalText;
          alert('Failed to write to clipboard.');
        }
      });
    } catch (err) {
      console.error('Error copying image: ', err);
      copyBtn.textContent = originalText;
      alert('Failed to copy image.');
    }
  });

  document.getElementById('download-png').addEventListener('click', () => downloadFile(getCombinedCanvas(), 'image/png', 'screenshot.png', 'download-png'));
  document.getElementById('download-jpg').addEventListener('click', () => downloadFile(getCombinedCanvas(), 'image/jpeg', 'screenshot.jpg', 'download-jpg'));
}

function getScaledCanvas(sourceCanvas, scale) {
  const scaled = document.createElement('canvas');
  scaled.width = Math.floor(sourceCanvas.width * scale);
  scaled.height = Math.floor(sourceCanvas.height * scale);
  const ctx = scaled.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0, scaled.width, scaled.height);
  return scaled;
}

function exportCanvas(canvas, mimeType, quality, callback, scale = 1.0) {
  let targetCanvas = canvas;
  if (scale < 1.0) {
    targetCanvas = getScaledCanvas(canvas, scale);
  }
  
  targetCanvas.toBlob((blob) => {
    if (blob) {
      callback(blob);
    } else {
      const nextScale = scale * 0.75;
      if (nextScale < 0.2) {
        callback(null);
      } else {
        console.warn(`Export failed at scale ${scale}, retrying at ${nextScale}`);
        exportCanvas(canvas, mimeType, quality, callback, nextScale);
      }
    }
  }, mimeType, quality);
}

function downloadFile(canvas, mimeType, filename, btnId) {
  const btn = document.getElementById(btnId);
  const originalText = btn.textContent;
  btn.textContent = 'Preparing...';
  
  exportCanvas(canvas, mimeType, 1.0, (blob) => {
    if (!blob) {
      alert('Screenshot is too large to download, even after scaling down.');
      btn.textContent = originalText;
      return;
    }
    
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
    
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    btn.textContent = originalText;
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error("Failed to load image source: " + err));
    img.src = src;
  });
}
