document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get('captureData', (data) => {
    if (data.captureData) {
      processCapture(data.captureData);
      // Optional: Clear storage to free memory
      chrome.storage.local.remove('captureData');
    } else {
      document.getElementById('loading').textContent = 'No capture data found.';
    }
  });
});

async function processCapture(data) {
  const canvas = document.getElementById('result-canvas');
  const ctx = canvas.getContext('2d');
  const loading = document.getElementById('loading');
  const dpr = data.dpr || 1;

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
    
    const sx = Math.round(rect.x * actualDpr);
    const sy = Math.round(rect.y * actualDpr);
    const sWidth = Math.round(rect.width * actualDpr);
    const sHeight = Math.round(rect.height * actualDpr);

    canvas.width = sWidth;
    canvas.height = sHeight;
    ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
  }
  else if (data.type === 'full') {
    // We have segments
    const segments = data.segments;
    if (segments.length === 0) return;
    
    const firstImg = await loadImage(segments[0].dataUrl);
    const actualDpr = data.windowWidth ? (firstImg.width / data.windowWidth) : dpr;
    
    canvas.width = firstImg.width;
    canvas.height = Math.round(data.totalHeight * actualDpr);

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const img = await loadImage(seg.dataUrl);
      const dy = Math.round(seg.y * actualDpr);
      
      ctx.drawImage(img, 0, dy, img.width, img.height);
    }
  }
  else if (data.type === 'area_stitched') {
    const segments = data.segments;
    if (segments.length === 0) return;
    
    const firstImg = await loadImage(segments[0].dataUrl);
    const actualDpr = data.windowWidth ? (firstImg.width / data.windowWidth) : dpr;
    
    canvas.width = Math.round(data.contentWidth * actualDpr);
    canvas.height = Math.round(data.contentHeight * actualDpr);
    
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const img = await loadImage(seg.dataUrl);
      
      // Viewport bounds in content space
      const viewportTop = seg.y;
      const viewportBottom = seg.y + data.viewportHeight;
      const viewportLeft = seg.x;
      const viewportRight = seg.x + data.viewportWidth;
      
      // Selection bounds in content space
      const contentTop = data.contentTop;
      const contentBottom = data.contentTop + data.contentHeight;
      const contentLeft = data.contentLeft;
      const contentRight = data.contentLeft + data.contentWidth;
      
      // Intersection in content space
      const intersectTop = Math.max(contentTop, viewportTop);
      const intersectBottom = Math.min(contentBottom, viewportBottom);
      const intersectLeft = Math.max(contentLeft, viewportLeft);
      const intersectRight = Math.min(contentRight, viewportRight);
      
      if (intersectBottom > intersectTop && intersectRight > intersectLeft) {
        // Screen (image) coordinates to crop from
        const sx = Math.round((data.boundsLeft + (intersectLeft - viewportLeft)) * actualDpr);
        const sy = Math.round((data.boundsTop + (intersectTop - viewportTop)) * actualDpr);
        const sWidth = Math.round((intersectRight - intersectLeft) * actualDpr);
        const sHeight = Math.round((intersectBottom - intersectTop) * actualDpr);
        
        // Canvas coordinates to draw to
        const dx = Math.round((intersectLeft - contentLeft) * actualDpr);
        const dy = Math.round((intersectTop - contentTop) * actualDpr);
        
        ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, sWidth, sHeight);
      }
    }
  }

  loading.style.display = 'none';
  window.dispatchEvent(new CustomEvent('screenshot-ready'));

  function getCombinedCanvas() {
    const annotationCanvas = document.getElementById('annotation-canvas');
    if (!annotationCanvas || annotationCanvas.width === 0) return canvas; // Fallback if no annotations
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
      getCombinedCanvas().toBlob(async (blob) => {
        if (!blob) {
          copyBtn.textContent = originalText;
          alert('Failed to copy image.');
          return;
        }
        const item = new ClipboardItem({ 'image/png': blob });
        await navigator.clipboard.write([item]);
        
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = originalText;
        }, 2000);
      }, 'image/png');
    } catch (err) {
      console.error('Error copying image: ', err);
      copyBtn.textContent = originalText;
      alert('Failed to copy image.');
    }
  });

  document.getElementById('download-png').addEventListener('click', () => download(getCombinedCanvas(), 'image/png', 'screenshot.png'));
  document.getElementById('download-jpg').addEventListener('click', () => download(getCombinedCanvas(), 'image/jpeg', 'screenshot.jpg'));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function download(canvas, mimeType, filename) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL(mimeType, 1.0); // 1.0 quality for JPG
  link.click();
}
