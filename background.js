/**
 * background.js
 * Service Worker for Long Screenshot Chrome Extension (MV3).
 * Manages tab actions, port keep-alive, streaming frame capture, and IndexedDB storage.
 */

importScripts('storage.js');

// Periodically clean up old screenshot sessions (> 1 hour)
LSStorage.cleanupOldSessions().catch(err => console.warn("Cleanup error:", err));

function isRestrictedUrl(url) {
  if (!url) return true;
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
  return RESTRICTED_PREFIXES.some(prefix => url.startsWith(prefix));
}

function notifyRestricted(tabId) {
  if (!tabId) return;
  chrome.action.setBadgeText({ tabId, text: 'N/A' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#e53e3e' });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' });
  }, 2500);
}

async function handleToggle(tab) {
  if (!tab || !tab.id) return;
  console.log("Toggle capture requested on tab:", tab.id, tab.url);

  if (isRestrictedUrl(tab.url)) {
    console.warn("Cannot run on this restricted page:", tab.url);
    notifyRestricted(tab.id);
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_OVERLAY' });
    console.log("Message sent to existing content script successfully.");
  } catch (err) {
    console.log("Content script not responding or invalidated. Injecting now...", err);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      console.log("Injected successfully. Sending toggle message...");
      await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_OVERLAY' });
    } catch (injectErr) {
      console.error("Failed to inject or send message:", injectErr);
    }
  }
}

chrome.action.onClicked.addListener(handleToggle);

// Listen to explicit keyboard shortcut commands
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-screenshot' || command === '_execute_action') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      handleToggle(tab);
    }
  }
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
