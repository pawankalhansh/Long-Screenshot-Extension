function isRestrictedUrl(url) {
  if (!url) return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('view-source:') ||
    url.startsWith('devtools://') ||
    url.startsWith('https://chrome.google.com/webstore') ||
    url.startsWith('https://chromewebstore.google.com') ||
    url.startsWith('https://microsoftedge.microsoft.com/addons')
  );
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
    console.log("Content script not responding or tab was reloaded. Injecting now...", err);
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

chrome.action.onClicked.addListener((tab) => {
  handleToggle(tab);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === '_execute_action') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      handleToggle(tab);
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'CAPTURE_VISIBLE_TAB') {
    let responded = false;
    const safeSendResponse = (data) => {
      if (!responded) {
        responded = true;
        try { sendResponse(data); } catch (e) {}
      }
    };

    const safetyTimer = setTimeout(() => {
      safeSendResponse({ error: "Capture timeout in background" });
    }, 4000);

    const targetWindowId = (sender && sender.tab && sender.tab.windowId) ? sender.tab.windowId : null;
    const format = request.format || 'jpeg';
    const quality = request.quality || 95;
    const captureOptions = (format === 'png') ? { format: 'png' } : { format: 'jpeg', quality: quality };

    try {
      chrome.tabs.captureVisibleTab(targetWindowId, captureOptions, (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.warn("Window-specific capture failed, trying null fallback:", chrome.runtime.lastError.message);
          try {
            chrome.tabs.captureVisibleTab(null, captureOptions, (fallbackUrl) => {
              clearTimeout(safetyTimer);
              if (chrome.runtime.lastError) {
                safeSendResponse({ error: chrome.runtime.lastError.message });
              } else {
                safeSendResponse({ dataUrl: fallbackUrl });
              }
            });
          } catch (fallbackErr) {
            clearTimeout(safetyTimer);
            safeSendResponse({ error: fallbackErr.message });
          }
          return;
        }
        clearTimeout(safetyTimer);
        safeSendResponse({ dataUrl: dataUrl });
      });
    } catch (err) {
      clearTimeout(safetyTimer);
      safeSendResponse({ error: err.message });
    }
    return true; 
  }

  // Opens result tab directly without transferring heavy image data through IPC (avoids 64MiB limit)
  if (request.action === 'OPEN_RESULT_TAB') {
    const createProperties = { url: 'result.html' };
    if (sender && sender.tab && typeof sender.tab.windowId === 'number') {
      createProperties.windowId = sender.tab.windowId;
    }
    chrome.tabs.create(createProperties, () => {
      if (chrome.runtime.lastError) {
        chrome.tabs.create({ url: 'result.html' });
      }
    });
    sendResponse({ success: true });
    return true;
  }

  // Legacy fallback if payload passed
  if (request.action === 'OPEN_RESULT') {
    chrome.storage.local.set({ captureData: request.payload }, () => {
      if (chrome.runtime.lastError) {
        console.error("Failed to store captureData:", chrome.runtime.lastError.message);
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }
      chrome.tabs.create({ url: 'result.html' });
      sendResponse({ success: true });
    });
    return true;
  }
});
