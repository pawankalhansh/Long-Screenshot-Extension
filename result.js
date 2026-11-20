/**
 * result.js
 * Renders captured screenshots from IndexedDB (or fallback storage),
 * applies safe dimensions, handles canvas export, and coordinates editing tools.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const loading = document.getElementById('loading');
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('sessionId');

  if (sessionId && typeof LSStorage !== 'undefined') {
    try {
      const session = await LSStorage.getSession(sessionId);
      if (session) {
        const frames = await LSStorage.getFrames(sessionId);
        const segments = frames.map(f => ({
          y: f.y,
          x: f.x || 0,
          blob: f.blob,
          dataUrl: f.blob
        }));
        await processCapture({ ...session, segments });
        return;
      }
    } catch (e) {
      console.error("Failed to load session from IndexedDB:", e);
    }
  }

  // Fallback to chrome.storage.local for single-shot or legacy captures
  chrome.storage.local.get('captureData', (data) => {
    if (data && data.captureData) {
      processCapture(data.captureData);
      chrome.storage.local.remove('captureData');
    } else {
      if (loading) loading.textContent = 'No capture data found.';
    }
  });
});

function getSafeDimensions(rawWidth, rawHeight) {
  const MAX_DIM = 32767;
  const MAX_AREA = 268435456; // 16384 * 16384 (~268 Megapixels)
  let scale = 1.0;
  
  if (rawWidth > MAX_DIM) {
    scale = Math.min(scale, MAX_DIM / rawWidth);
  }
  if (rawHeight > MAX_DIM) {
    scale = Math.min(scale, MAX_DIM / rawHeight);
  }
  if ((rawWidth * scale) * (rawHeight * scale) > MAX_AREA) {
    scale = Math.min(scale, Math.sqrt(MAX_AREA / (rawWidth * rawHeight)));
  }
  
  return {
    width: Math.max(1, Math.floor(rawWidth * scale)),
    height: Math.max(1, Math.floor(rawHeight * scale)),
    scale: scale
  };
}

async function processCapture(data) {
  const canvas = document.getElementById('result-canvas');
  const ctx = canvas.getContext('2d');
  const loading = document.getElementById('loading');
  const dpr = data.dpr || 1;

  if (data.type === 'visible') {
    const firstSeg = (data.segments && data.segments.length > 0) ? data.segments[0] : null;
    const source = (firstSeg && (firstSeg.blob || firstSeg.dataUrl)) || data.image;
    const img = await loadImage(source);
    const safeDim = getSafeDimensions(img.width, img.height);
    canvas.width = safeDim.width;
    canvas.height = safeDim.height;
    if (safeDim.scale < 1.0) {
      ctx.scale(safeDim.scale, safeDim.scale);
    }
    ctx.drawImage(img, 0, 0);
  } 
  else if (data.type === 'area') {
    const firstSeg = (data.segments && data.segments.length > 0) ? data.segments[0] : null;
    const source = (firstSeg && (firstSeg.blob || firstSeg.dataUrl)) || data.image;
    const img = await loadImage(source);
    const rect = data.rect;
    
    const actualDpr = data.windowWidth ? (img.width / data.windowWidth) : dpr;
    
    const sx = Math.round(rect.x * actualDpr);
    const sy = Math.round(rect.y * actualDpr);
    const sWidth = Math.round(rect.width * actualDpr);
    const sHeight = Math.round(rect.height * actualDpr);

    const safeDim = getSafeDimensions(sWidth, sHeight);
    canvas.width = safeDim.width;
    canvas.height = safeDim.height;
    if (safeDim.scale < 1.0) {
      ctx.scale(safeDim.scale, safeDim.scale);
    }
    ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
  }
  else if (data.type === 'full') {
    const segments = data.segments || [];
    if (segments.length === 0) return;
    
    const firstImg = await loadImage(segments[0].blob || segments[0].dataUrl);
    const actualDpr = data.windowWidth ? (firstImg.width / data.windowWidth) : dpr;
    
    // Check if capture is of an inner scroller or the full window
    const isInnerScroller = (data.boundsLeft > 0 || data.boundsTop > 0 || (data.viewportWidth && data.viewportWidth < data.windowWidth - 20));
    
    const cropX = isInnerScroller ? Math.round(data.boundsLeft * actualDpr) : 0;
    const cropY = isInnerScroller ? Math.round(data.boundsTop * actualDpr) : 0;
    const cropWidth = isInnerScroller ? Math.round(data.viewportWidth * actualDpr) : firstImg.width;
    const cropHeight = isInnerScroller ? Math.round(data.viewportHeight * actualDpr) : firstImg.height;
    
    const rawWidth = cropWidth;
    const rawHeight = Math.round(data.totalHeight * actualDpr);
    
    const safeDim = getSafeDimensions(rawWidth, rawHeight);
    canvas.width = safeDim.width;
    canvas.height = safeDim.height;
    
    if (safeDim.scale < 1.0) {
      ctx.scale(safeDim.scale, safeDim.scale);
    }

    let lastEnd = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const img = await loadImage(seg.blob || seg.dataUrl);
      
      const segY = seg.y;
      const segHeight = data.viewportHeight || Math.round(firstImg.height / actualDpr);
      
      if (i === 0) {
        ctx.drawImage(img, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
        lastEnd = segY + segHeight;
      } else {
        const newContentStart = Math.max(segY, lastEnd);
        const newContentEnd = segY + segHeight;
        
        if (newContentEnd > newContentStart) {
          const sliceOffsetY = newContentStart - segY;
          const sliceHeight = newContentEnd - newContentStart;
          
          const sx = cropX;
          const sy = cropY + Math.round(sliceOffsetY * actualDpr);
          const sw = cropWidth;
          const sh = Math.round(sliceHeight * actualDpr);
          
          const dx = 0;
          const dy = Math.round(newContentStart * actualDpr);
          
          ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
          lastEnd = newContentEnd;
        }
      }
    }
  }
  else if (data.type === 'area_stitched') {
    const segments = data.segments || [];
    if (segments.length === 0) return;
    
    const firstImg = await loadImage(segments[0].blob || segments[0].dataUrl);
    const actualDpr = data.windowWidth ? (firstImg.width / data.windowWidth) : dpr;
    
    const rawWidth = Math.round(data.contentWidth * actualDpr);
    const rawHeight = Math.round(data.contentHeight * actualDpr);
    
    const safeDim = getSafeDimensions(rawWidth, rawHeight);
    canvas.width = safeDim.width;
    canvas.height = safeDim.height;
    
    if (safeDim.scale < 1.0) {
      ctx.scale(safeDim.scale, safeDim.scale);
    }
    
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const img = await loadImage(seg.blob || seg.dataUrl);
      
      // Viewport bounds in content space (Vertical only)
      const viewportTop = seg.y;
      const viewportBottom = seg.y + data.viewportHeight;
      
      // Selection bounds in content space
      const contentTop = data.contentTop;
      const contentBottom = data.contentTop + data.contentHeight;
      
      // Intersection in content space (Vertical only)
      const intersectTop = Math.max(contentTop, viewportTop);
      const intersectBottom = Math.min(contentBottom, viewportBottom);
      
      if (intersectBottom > intersectTop) {
        // Screen X of the selection's left edge
        const screenX = data.boundsLeft + data.contentLeft - (seg.x || 0);
        
        // Screen Y of the current intersecting slice
        const screenY = data.boundsTop + (intersectTop - seg.y);
        
        // Image coordinates to crop from
        const sx = Math.max(0, Math.round(screenX * actualDpr));
        const sy = Math.max(0, Math.round(screenY * actualDpr));
        const sWidth = Math.round(data.contentWidth * actualDpr);
        const sHeight = Math.round((intersectBottom - intersectTop) * actualDpr);
        
        // Canvas coordinates to draw to
        const dx = 0;
        const dy = Math.round((intersectTop - contentTop) * actualDpr);
        
        ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, sWidth, sHeight);
      }
    }
  }

  if (loading) loading.style.display = 'none';
  window.dispatchEvent(new CustomEvent('screenshot-ready'));

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

  // Setup download handlers
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

function loadImage(srcOrBlob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let objectUrl = null;
    if (srcOrBlob instanceof Blob) {
      objectUrl = URL.createObjectURL(srcOrBlob);
      img.src = objectUrl;
    } else if (typeof srcOrBlob === 'string') {
      img.src = srcOrBlob;
    } else {
      return reject(new Error('Invalid image source'));
    }
    img.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = (err) => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(err);
    };
  });
}
