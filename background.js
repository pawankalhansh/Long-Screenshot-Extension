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
    // Attempt sending message to existing content script
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

// Fallback listener for commands
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
        console.error("Failed to store captureData:", chrome.runtime.lastError);
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }
      chrome.tabs.create({ url: 'result.html' });
      sendResponse({ success: true });
    });
    return true;
  }
});
