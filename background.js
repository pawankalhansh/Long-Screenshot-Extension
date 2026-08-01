chrome.action.onClicked.addListener((tab) => {
  console.log("Extension icon clicked on tab:", tab.id, tab.url);
  
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('https://chrome.google.com/webstore') || tab.url.startsWith('https://microsoftedge.microsoft.com/addons')) {
    console.warn("Cannot run on this restricted page.");
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
      chrome.tabs.create({ url: 'result.html' });
      sendResponse({ success: true });
    });
    return true;
  }
});
