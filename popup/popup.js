// SubLang Popup Logic - Phase 6
// Handles UI interactions, settings persistence, and communication with content script

// DOM Elements
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const statusBadge = document.getElementById('statusBadge');
const subtitleToggle = document.getElementById('subtitleToggle');
const languageSelect = document.getElementById('languageSelect');
const fontBtns = document.querySelectorAll('.font-btn');
const positionBtns = document.querySelectorAll('.position-btn');

// Initialize popup when opened
async function initializePopup() {
  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tab && tab.id) {
    // Send GET_VIDEO_STATUS message to active tab
    chrome.tabs.sendMessage(tab.id, { type: 'GET_VIDEO_STATUS' }, (response) => {
      if (response && response.active) {
        statusDot.classList.add('detected');
        statusBadge.classList.add('detected');
        statusText.textContent = 'Video Detected';
      } else {
        statusDot.classList.remove('detected');
        statusBadge.classList.remove('detected');
        statusText.textContent = 'No Video';
      }
    });
  }
  
  // Restore all saved settings from storage
  const data = await chrome.storage.local.get(['subtitlesEnabled', 'selectedLanguage', 'fontSize', 'subtitlePosition']);
  
  // Restore subtitles toggle
  if (data.subtitlesEnabled !== undefined) {
    subtitleToggle.checked = data.subtitlesEnabled;
  }
  
  // Restore language selection, default to 'ja' if not set
  if (data.selectedLanguage) {
    languageSelect.value = data.selectedLanguage;
  } else {
    // Save 'ja' as default if nothing saved
    await chrome.storage.local.set({ selectedLanguage: 'ja' });
    languageSelect.value = 'ja';
  }
  
  // Restore font size
  if (data.fontSize) {
    fontBtns.forEach(btn => {
      if (btn.dataset.size === data.fontSize) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
  
  // Restore subtitle position
  if (data.subtitlePosition) {
    positionBtns.forEach(btn => {
      if (btn.dataset.position === data.subtitlePosition) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
}

// Subtitles toggle handler
subtitleToggle.addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  
  // Save to storage
  await chrome.storage.local.set({ subtitlesEnabled: enabled });
  
  // Send message to active tab's content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'SUBTITLES_TOGGLE',
      enabled: enabled
    });
  }
});

// Language selector handler
languageSelect.addEventListener('change', async (e) => {
  const language = e.target.value;
  
  // Save to storage
  await chrome.storage.local.set({ selectedLanguage: language });
  
  // Send message to active tab's content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'LANGUAGE_CHANGED',
      language: language
    });
  }
});

// Font size button handlers
fontBtns.forEach(btn => {
  btn.addEventListener('click', async () => {
    // Update active state
    fontBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const size = btn.dataset.size;
    
    // Save to storage
    await chrome.storage.local.set({ fontSize: size });
    
    // Send message to active tab's content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'FONT_SIZE_CHANGED',
        size: size
      });
    }
  });
});

// Position button handlers
positionBtns.forEach(btn => {
  btn.addEventListener('click', async () => {
    // Update active state
    positionBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const position = btn.dataset.position;
    
    // Save to storage
    await chrome.storage.local.set({ subtitlePosition: position });
    
    // Send message to active tab's content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'SUBTITLE_POSITION',
        position: position
      });
    }
  });
});

// Initialize on popup load
initializePopup();
