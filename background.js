// SubLang Background Service Worker
// Handles extension lifecycle and message routing between components

// Log when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log("SubLang extension installed");
});

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "GET_STATUS":
      // Return current extension status
      sendResponse({ status: "active" });
      break;

    case "VIDEO_FOUND":
      // Log video detection and store in local storage
      console.log("Video found on tab:", sender.tab?.id, "URL:", message.url);
      chrome.storage.local.set({
        videoFound: true,
        tabId: sender.tab?.id
      });
      break;

    case "VIDEO_NOT_FOUND":
      // Store no-video state
      chrome.storage.local.set({
        videoFound: false
      });
      break;

    default:
      console.log("Unknown message type:", message.type);
  }

  // Return true to indicate async response (if needed in future)
  return true;
});

// Phase 3: API call routing will be added here
// This will handle communication with the backend server for
// transcription and translation requests
