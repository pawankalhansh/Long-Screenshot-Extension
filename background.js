/**
 * background.js
 * Service Worker for Long Screenshot Chrome Extension (MV3).
 * Manages tab actions, port keep-alive, streaming frame capture, and IndexedDB storage.
 */

importScripts('storage.js');

// Periodically clean up old screenshot sessions (> 1 hour)
LSStorage.cleanupOldSessions().catch(err => console.warn("Cleanup error:", err));

chrome.action.onClicked.addListener((tab) => {
  console.log("Extension icon clicked on tab:", tab.id, tab.url);
  
  const RESTRICTED_PREFIXES = [
    'chrome://',
    'edge://',
    'about:',
    'view-source:',
    'devtools://',
    'chrome-extension://',
    'extension://',
    'https://chrome.google.com/webstore',
    'https://chromewebstore.google.com',
    'https://microsoftedge.microsoft.com/addons'
  ];

  if (!tab.url || RESTRICTED_PREFIXES.some(prefix => tab.url.startsWith(prefix))) {
    console.warn("Cannot run on this restricted page:", tab.url);
    return;
  }

  // Send message to toggle the overlay
  chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_OVERLAY' }).then(response => {
    console.log("Message sent to existing content script successfully.");
  }).catch((err) => {
    console.log("Content script not found. Injecting now...", err);
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    }).then(() => {
      console.log("Injected successfully. Sending toggle message...");
      return chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_OVERLAY' });
    }).catch(injectErr => {
      console.error("Failed to inject or send message:", injectErr);
    });
  });
});

// Port-based streaming pipeline to bypass MV3 IPC payload limits & prevent SW idle timeout
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'LONG_SCREENSHOT_PORT') return;

  console.log("Long screenshot port connected.");

  // Keep-alive heartbeat interval while port is open
  const keepAliveInterval = setInterval(() => {
    try {
      port.postMessage({ action: 'PING' });
    } catch (e) {
      clearInterval(keepAliveInterval);
    }
  }, 20000);

  port.onDisconnect.addListener(() => {
    clearInterval(keepAliveInterval);
    console.log("Long screenshot port disconnected.");
  });

  port.onMessage.addListener(async (msg) => {
    if (msg.action === 'PONG') {
      return; // Heartbeat ack
    }

    if (msg.action === 'START_SESSION') {
      try {
        await LSStorage.saveSession(msg.sessionData);
        port.postMessage({ action: 'SESSION_STARTED', sessionId: msg.sessionData.sessionId });
      } catch (err) {
        console.error("START_SESSION error:", err);
        port.postMessage({ action: 'ERROR', message: err.message });
      }
      return;
    }

    if (msg.action === 'CAPTURE_FRAME') {
      const { sessionId, index, y, x } = msg;
      chrome.tabs.captureVisibleTab(null, { format: 'png' }, async (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.error("Capture visible tab error:", chrome.runtime.lastError);
          port.postMessage({ action: 'CAPTURE_ERROR', index, error: chrome.runtime.lastError.message });
          return;
        }

        try {
          // Immediately convert to binary Blob and save to IndexedDB
          // This keeps content.js memory free of huge base64 strings!
          await LSStorage.saveFrame(sessionId, index, dataUrl, { y, x: x || 0, timestamp: Date.now() });
          port.postMessage({ action: 'FRAME_SAVED', sessionId, index });
        } catch (storageErr) {
          console.error("Frame storage error:", storageErr);
          port.postMessage({ action: 'CAPTURE_ERROR', index, error: storageErr.message });
        }
      });
      return;
    }

    if (msg.action === 'FINISH_SESSION') {
      const { sessionId, sessionUpdates } = msg;
      try {
        if (sessionUpdates) {
          const current = await LSStorage.getSession(sessionId);
          if (current) {
            await LSStorage.saveSession({ ...current, ...sessionUpdates });
          }
        }
        chrome.tabs.create({ url: `result.html?sessionId=${encodeURIComponent(sessionId)}` });
        port.postMessage({ action: 'SESSION_FINISHED', sessionId });
      } catch (err) {
        console.error("FINISH_SESSION error:", err);
        port.postMessage({ action: 'ERROR', message: err.message });
      }
      return;
    }
  });
});

// Fallback message listener for single visible tab captures
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'CAPTURE_VISIBLE_TAB') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error("Capture failed:", chrome.runtime.lastError);
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ dataUrl: dataUrl });
    });
    return true; 
  }

  if (request.action === 'OPEN_RESULT') {
    chrome.storage.local.set({ captureData: request.payload }, () => {
      if (chrome.runtime.lastError) {
        console.error("Storage set failed:", chrome.runtime.lastError);
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }
      chrome.tabs.create({ url: 'result.html' });
      sendResponse({ success: true });
    });
    return true;
  }
});
