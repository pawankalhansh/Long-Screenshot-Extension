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
    
    // Scale rect by devicePixelRatio
    const sx = rect.x * dpr;
    const sy = rect.y * dpr;
    const sWidth = rect.width * dpr;
    const sHeight = rect.height * dpr;

    canvas.width = sWidth;
    canvas.height = sHeight;
    ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
  }
  else if (data.type === 'full') {
    // We have segments
    const segments = data.segments;
    if (segments.length === 0) return;
    
    canvas.width = data.viewportWidth * dpr;
    canvas.height = data.totalHeight * dpr;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const img = await loadImage(seg.dataUrl);
      
      const sx = (data.boundsLeft || 0) * dpr;
      const sy = (data.boundsTop || 0) * dpr;
      const sWidth = data.viewportWidth * dpr;
      const sHeight = data.viewportHeight * dpr;

      const dx = 0;
      const dy = (seg.y - segments[0].y) * dpr;
      
      ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, sWidth, sHeight);
    }
  }
  else if (data.type === 'area_stitched') {
    const segments = data.segments;
    if (segments.length === 0) return;
    
    canvas.width = data.contentWidth * dpr;
    canvas.height = data.contentHeight * dpr;
    
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
        const sx = (data.boundsLeft + (intersectLeft - viewportLeft)) * dpr;
        const sy = (data.boundsTop + (intersectTop - viewportTop)) * dpr;
        const sWidth = (intersectRight - intersectLeft) * dpr;
        const sHeight = (intersectBottom - intersectTop) * dpr;
        
        // Canvas coordinates to draw to
        const dx = (intersectLeft - contentLeft) * dpr;
        const dy = (intersectTop - contentTop) * dpr;
        
        ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, sWidth, sHeight);
      }
    }
  }

  loading.style.display = 'none';

  // Setup download handlers
  document.getElementById('copy-image').addEventListener('click', async () => {
    const copyBtn = document.getElementById('copy-image');
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copying...';
    
    try {
      canvas.toBlob(async (blob) => {
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

  document.getElementById('download-png').addEventListener('click', () => download(canvas, 'image/png', 'screenshot.png'));
  document.getElementById('download-jpg').addEventListener('click', () => download(canvas, 'image/jpeg', 'screenshot.jpg'));
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
