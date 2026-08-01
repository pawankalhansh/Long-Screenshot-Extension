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
    
    // Calculate total actual height based on first image's aspect ratio or dpr
    const firstImg = await loadImage(segments[0].dataUrl);
    
    canvas.width = firstImg.width;
    canvas.height = data.totalHeight * dpr;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const img = await loadImage(seg.dataUrl);
      const dy = seg.y * dpr;
      
      ctx.drawImage(img, 0, dy, img.width, img.height);
    }
  }
  else if (data.type === 'area_stitched') {
    const segments = data.segments;
    if (segments.length === 0) return;
    
    const rect = data.rect;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const img = await loadImage(seg.dataUrl);
      
      // The segment captured the viewport at (seg.x, seg.y)
      // To draw it so the 'rect' area aligns with the canvas origin (0,0):
      const dx = (seg.x - rect.x) * dpr;
      const dy = (seg.y - rect.y) * dpr;
      
      ctx.drawImage(img, dx, dy, img.width, img.height);
    }
  }

  loading.style.display = 'none';

  // Setup download handlers
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
