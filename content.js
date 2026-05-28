// SubLang Content Script - Phase 3
// Video Detection Engine and Audio Capture with Deepgram Transcription

// Phase 8: Change to Render URL before deployment
const BACKEND_WS_URL = "wss://translator-muf-backend.onrender.com";

// Transcriber class (inline copy - content scripts can't use ES modules)
class Transcriber {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.onTranscript = null;
    this.backendUrl = null;
    this.audioQueue = [];
  }

  connect(backendWsUrl, language, onTranscript) {
    this.onTranscript = onTranscript;
    this.backendUrl = backendWsUrl;

    const url = backendWsUrl + "/transcribe?language=" + language;
    console.log("SubLang: attempting WS connect to", url);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.isConnected = true;
      console.log("SubLang Transcriber: WS onopen fired");
      
      // Flush queued audio chunks
      while (this.audioQueue.length > 0) {
        this.ws.send(this.audioQueue.shift());
      }
      this.audioQueue = [];
    };

   this.ws.onmessage = (event) => {
  try {
    if (event.data instanceof Blob) {
      event.data.text().then(raw => {
        const data = JSON.parse(raw);
        if (data.channel && data.channel.alternatives && data.channel.alternatives[0]) {
          const transcript = data.channel.alternatives[0].transcript;
          if (transcript && transcript.length > 0) {
            if (data.is_final === true) {
              this.onTranscript(transcript, true);
            } else {
              this.onTranscript(transcript, false);
            }
          }
        }
      });
      return;
    }
    const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
    const data = JSON.parse(raw);
        if (data.channel && data.channel.alternatives && data.channel.alternatives[0]) {
          const transcript = data.channel.alternatives[0].transcript;
          if (transcript && transcript.length > 0) {
            if (data.is_final === true) {
              this.onTranscript(transcript, true);
            } else {
              this.onTranscript(transcript, false);
            }
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    this.ws.onerror = (error) => {
      console.log("SubLang Transcriber error: " + error.message);
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      console.log("SubLang Transcriber: disconnected");
    };
  }

  sendAudio(float32Array) {
    // Convert Float32Array to Int16Array
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      let sample = float32Array[i] * 32767;
      sample = Math.max(-32768, Math.min(32767, sample));
      int16Array[i] = sample;
    }

    // Convert Int16Array to ArrayBuffer
    const arrayBuffer = int16Array.buffer;

    // Send if WebSocket is open
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(arrayBuffer);
    } else if (this.ws) {
      // Queue audio chunks until WebSocket is open
      this.audioQueue.push(arrayBuffer);
    }
  }

  disconnect() {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.close();
    }
    this.isConnected = false;
  }
}

// Module-level transcriber instance
const transcriber = new Transcriber();

// Module-level variables
let activeVideo = null;
let currentVideo = null;
let audioContext = null;
let mediaElementSource = null;
let analyser = null;
let scriptProcessor = null;
let audioBuffer = [];
let lastUrl = window.location.href;
let chunkCount = 0;
let subtitleClearTimer = null;
let lastFinalTime = 0;
let lastResetTime = 0;
let fragmentBuffer = '';
let fragmentTimer = null;
const FRAGMENT_THRESHOLD = 6;
const FRAGMENT_THRESHOLD_KO = 4;  // Lower threshold for Korean

// Video Detection
function detectVideo() {
  const videos = document.querySelectorAll("video");
  
  if (videos.length === 0) {
    chrome.runtime.sendMessage({ type: "VIDEO_NOT_FOUND" });
    return;
  }
  
  // If multiple videos exist, pick the dominant one (largest area)
  let dominantVideo = videos[0];
  let maxArea = dominantVideo.offsetWidth * dominantVideo.offsetHeight;
  
  for (let i = 1; i < videos.length; i++) {
    const area = videos[i].offsetWidth * videos[i].offsetHeight;
    if (area > maxArea) {
      maxArea = area;
      dominantVideo = videos[i];
    }
  }
  
  onVideoFound(dominantVideo);
}

// Called when a video is found
function onVideoFound(videoElement) {
  if (activeVideo === videoElement) return; // Already tracking this video
  
  activeVideo = videoElement;
  currentVideo = videoElement;
  chrome.runtime.sendMessage({
    type: "VIDEO_FOUND",
    url: window.location.href
  });
  console.log("SubLang: video detected — " + window.location.href);
  
  setupAudioCapture(videoElement);
  createSubtitleOverlay();
  
  // Guard: disconnect if already connected to avoid duplicate connections
  if (transcriber.isConnected) {
    transcriber.disconnect();
  }
  
  // Read saved language from storage and connect transcriber
  chrome.storage.local.get(['selectedLanguage'], (data) => {
    const language = data.selectedLanguage || 'ja';
    const threshold = language === 'ko' ? FRAGMENT_THRESHOLD_KO : FRAGMENT_THRESHOLD;
    
    transcriber.connect(BACKEND_WS_URL, language, async (transcript, isFinal) => {
      if (!isFinal) return;
      
      const trimmed = transcript.trim();
      if (!trimmed) return;
      
      console.log("SubLang FINAL:", trimmed);
      if (language === 'ko') {
        console.log("SubLang Korean transcript length:", trimmed.length, "threshold:", threshold);
      }
      
      // Buffer short CJK fragments — they're parts of sentences
      if (trimmed.length <= threshold) {
        fragmentBuffer += trimmed;
        if (fragmentTimer) clearTimeout(fragmentTimer);
        fragmentTimer = setTimeout(async () => {
          const toTranslate = fragmentBuffer.trim();
          fragmentBuffer = '';
          fragmentTimer = null;
          if (!toTranslate || toTranslate.length <= 1) return;
          const translated = await translateText(toTranslate, language);
          if (translated) updateSubtitle(translated, true);
        }, 800);
        return;
      }
      
      // Long enough — flush any pending buffer first
      if (fragmentBuffer) {
        const combined = fragmentBuffer + trimmed;
        fragmentBuffer = '';
        if (fragmentTimer) { clearTimeout(fragmentTimer); fragmentTimer = null }
        const translated = await translateText(combined, language);
        if (translated) updateSubtitle(translated, true);
        return;
      }
      
      // Normal flow
      const translated = await translateText(trimmed, language);
      if (translated) updateSubtitle(translated, true);
    });
  });
  
  // Add event listeners to the video element
  videoElement.addEventListener("play", () => {
    console.log("SubLang: video playing");
    resumeCapture();
  });
  
  videoElement.addEventListener("pause", () => {
    console.log("SubLang: video paused");
    pauseCapture();
  });
  
  videoElement.addEventListener("emptied", () => {
    console.log("SubLang: video changed");
    resetCapture();
  });
}

// Set up audio capture using Web Audio API
function setupAudioCapture(videoElement) {
  try {
    // Create AudioContext with explicit sample rate
    window.sublangAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    audioContext = window.sublangAudioContext;
    
    // Resume AudioContext if suspended
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    
    // Add state change listener
    audioContext.onstatechange = () => {
      console.log("SubLang AudioContext state:", audioContext.state);
    };
    
    // Use captureStream to avoid CORS issues on YouTube
    const stream = videoElement.captureStream();
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      console.error("SubLang: no audio tracks in stream!");
      return;
    }
    console.log("SubLang: audio track found:", audioTracks[0].label);
    
    // Create MediaStreamSource from stream
    mediaElementSource = audioContext.createMediaStreamSource(stream);
    
    // Create AnalyserNode
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 4096;
    
    // Create ScriptProcessorNode (deprecated but still widely supported)
    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    
    // Connect the audio graph: source -> analyser -> scriptProcessor -> destination
    mediaElementSource.connect(analyser);
    analyser.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);
    
    // Also connect source directly to destination for non-destructive audio tap
    mediaElementSource.connect(audioContext.destination);
    
    // Process audio chunks
    scriptProcessor.onaudioprocess = (event) => {
      const inputBuffer = event.inputBuffer;
      const inputData = inputBuffer.getChannelData(0); // Get mono channel from inputBuffer
      
      // Accumulate audio samples
      for (let i = 0; i < inputData.length; i++) {
        audioBuffer.push(inputData[i]);
      }
      
      // When we have 16000 samples (1 second at 16kHz), process the chunk
      if (audioBuffer.length >= 16000) {
        const chunk = audioBuffer.slice(0, 16000);
        audioBuffer = audioBuffer.slice(16000);
        onAudioChunkReady(chunk);
      }
    };
    
    console.log("SubLang: audio capture setup complete");
    
  } catch (error) {
    console.log("SubLang: captureStream failed, page may not support audio capture");
  }
}

// Called when an audio chunk is ready
function onAudioChunkReady(buffer) {
  chunkCount++;
  
  // Silent buffer suppression
  const maxSample = Math.max(...new Float32Array(buffer).slice(0, 200).map(Math.abs));
  if (maxSample < 0.001) return; // skip silent chunk
  
  // Send audio to transcriber
  transcriber.sendAudio(new Float32Array(buffer));
  
  // Store chunk info for popup to read
  try {
    chrome.storage.local.set({
      lastChunkSize: buffer.length,
      lastChunkTime: Date.now()
    });
  } catch (e) {
    // Silently ignore extension context invalidation
  }
}

// Pause audio capture
function pauseCapture() {
  if (audioContext) {
    audioContext.suspend();
    console.log("SubLang: capture paused");
  }
}

// Resume audio capture
function resumeCapture() {
  if (audioContext) {
    audioContext.resume();
    console.log("SubLang: capture resumed");
  }
}

// Reset audio capture (for video changes)
function resetCapture() {
  transcriber.disconnect();
  
  const overlay = document.getElementById('sublang-overlay');
  if (overlay) overlay.remove();
  
  if (audioContext) {
    audioContext.close();
  }
  
  // Reset all module-level variables
  audioContext = null;
  mediaElementSource = null;
  analyser = null;
  scriptProcessor = null;
  audioBuffer = [];
  activeVideo = null;
  currentVideo = null;
  window.sublangAudioContext = null;
  chunkCount = 0;
  lastFinalTime = 0;
  if (subtitleClearTimer) {
    clearTimeout(subtitleClearTimer)
    subtitleClearTimer = null
  }
  fragmentBuffer = '';
  if (fragmentTimer) { clearTimeout(fragmentTimer); fragmentTimer = null }
  
  console.log("SubLang: capture reset");
  
  // Re-detect video after 1.5 seconds
  setTimeout(detectVideo, 1500);
}

// MutationObserver for dynamically added video elements
const observer = new MutationObserver(() => {
  if (!activeVideo) {
    detectVideo();
  }
});

// Start observing the document
if (document.body) {
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
} else {
  // Fallback if body doesn't exist yet
  document.addEventListener("DOMContentLoaded", () => {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  });
}

// YouTube SPA navigation detection
setInterval(() => {
  if (window.location.href !== lastUrl) {
    const now = Date.now()
    if (now - lastResetTime > 2000) {
      lastUrl = window.location.href
      lastResetTime = now
      console.log("SubLang: URL changed, re-detecting video")
      resetCapture()
    }
  }
}, 1000);

// Message listener for popup communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "SUBTITLES_TOGGLE":
      const overlay = document.getElementById('sublang-overlay');
      if (overlay) {
        if (message.enabled === false) {
          overlay.style.display = 'none';
        } else {
          overlay.style.display = 'block';
        }
      }
      break;
      
    case "GET_VIDEO_STATUS":
      sendResponse({
        active: activeVideo !== null,
        url: window.location.href
      });
      break;
      
    case "LANGUAGE_CHANGED":
      transcriber.disconnect();
      const threshold = message.language === 'ko' ? FRAGMENT_THRESHOLD_KO : FRAGMENT_THRESHOLD;
      transcriber.connect(BACKEND_WS_URL, message.language, async (transcript, isFinal) => {
        if (!isFinal) return;
        
        const trimmed = transcript.trim();
        if (!trimmed) return;
        
        console.log("SubLang FINAL:", trimmed);
        
        // Buffer short CJK fragments — they're parts of sentences
        if (trimmed.length <= threshold) {
          fragmentBuffer += trimmed;
          if (fragmentTimer) clearTimeout(fragmentTimer);
          fragmentTimer = setTimeout(async () => {
            const toTranslate = fragmentBuffer.trim();
            fragmentBuffer = '';
            fragmentTimer = null;
            if (!toTranslate || toTranslate.length <= 1) return;
            const translated = await translateText(toTranslate, message.language);
            if (translated) updateSubtitle(translated, true);
          }, 800);
          return;
        }
        
        // Long enough — flush any pending buffer first
        if (fragmentBuffer) {
          const combined = fragmentBuffer + trimmed;
          fragmentBuffer = '';
          if (fragmentTimer) { clearTimeout(fragmentTimer); fragmentTimer = null }
          const translated = await translateText(combined, message.language);
          if (translated) updateSubtitle(translated, true);
          return;
        }
        
        // Normal flow
        const translated = await translateText(trimmed, message.language);
        if (translated) updateSubtitle(translated, true);
      });
      console.log("SubLang: language switched to " + message.language);
      break;
      
    case "FONT_SIZE_CHANGED":
      const sizes = { small: '16px', medium: '22px', large: '28px' };
      const span = document.getElementById('sublang-subtitle-text');
      if (span) span.style.setProperty('font-size', sizes[message.size], 'important');
      break;
      
    case "SUBTITLE_POSITION":
      const overlay2 = document.getElementById('sublang-overlay');
      if (!overlay2) return;
      if (message.position === 'top') {
        overlay2.style.setProperty('bottom', 'auto', 'important');
        overlay2.style.setProperty('top', '80px', 'important');
      } else {
        overlay2.style.setProperty('top', 'auto', 'important');
        overlay2.style.setProperty('bottom', '80px', 'important');
      }
      break;
  }
  
  return true; // Keep message channel open for async response
});

// Translate text using backend DeepL API
async function translateText(text, sourceLang) {
  if (!text || text.trim() === '') return null
  if (text.trim().length <= 1) return null
  if (/^[。、！？!?.,\s]+$/.test(text.trim())) return null
  if (sourceLang === 'en') return text  // already English
  
  try {
    const response = await fetch('https://translator-muf-backend.onrender.com/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim(), sourceLang })
    })
    const data = await response.json()
    const translated = data.translated || null
    if (sourceLang === 'ko') {
      console.log('SubLang Korean translation:', text.trim(), '→', translated)
    }
    return translated
  } catch (e) {
    console.warn('SubLang: translation failed:', e.message)
    return null
  }
}

// Create subtitle overlay
function createSubtitleOverlay() {
  // Remove any existing overlay
  const existing = document.getElementById('sublang-overlay')
  if (existing) existing.remove()

  const overlay = document.createElement('div')
  overlay.id = 'sublang-overlay'
  overlay.style.cssText = `
    position: fixed !important;
    bottom: 80px !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    z-index: 2147483647 !important;
    pointer-events: none !important;
    text-align: center !important;
    width: auto !important;
    max-width: 80vw !important;
  `

  const text = document.createElement('span')
  text.id = 'sublang-subtitle-text'
  text.style.cssText = `
    display: none;
    background: rgba(0, 0, 0, 0.78) !important;
    color: #ffffff !important;
    font-size: 22px !important;
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif !important;
    font-weight: 500 !important;
    padding: 7px 16px !important;
    border-radius: 4px !important;
    line-height: 1.5 !important;
    letter-spacing: 0.2px !important;
    white-space: pre-wrap !important;
    word-break: break-word !important;
    max-width: 80vw !important;
    text-shadow: 0 1px 2px rgba(0,0,0,0.5) !important;
  `

  overlay.appendChild(text)
  document.body.appendChild(overlay)
  console.log('SubLang: overlay created and appended to body')
  return overlay
}

// Update subtitle text
function updateSubtitle(text, isFinal) {
  const span = document.getElementById('sublang-subtitle-text')
  if (!span) return
  if (!text || text.trim() === '') return

  if (subtitleClearTimer) {
    clearTimeout(subtitleClearTimer)
    subtitleClearTimer = null
  }

  // Fade in
  span.style.opacity = '0'
  span.style.display = 'inline-block'
  span.style.transition = 'opacity 0.2s ease'
  requestAnimationFrame(() => {
    span.style.opacity = '1'
  })

  span.textContent = text
  lastFinalTime = Date.now()

  // Calculate display duration based on text length
  // Minimum 2.5s, maximum 6s, ~50ms per character
  const duration = Math.min(6000, Math.max(2500, text.length * 50))

  subtitleClearTimer = setTimeout(() => {
    // Fade out smoothly
    span.style.transition = 'opacity 0.4s ease'
    span.style.opacity = '0'
    setTimeout(() => {
      span.style.display = 'none'
      span.style.opacity = '1'
      span.style.transition = ''
    }, 400)
  }, duration)
}

// Restore saved settings on load
chrome.storage.local.get(['fontSize', 'subtitlePosition'], (data) => {
  if (data.fontSize) {
    const sizes = { small: '16px', medium: '22px', large: '28px' };
    const span = document.getElementById('sublang-subtitle-text');
    if (span) span.style.setProperty('font-size', sizes[data.fontSize], 'important');
  }
  
  if (data.subtitlePosition) {
    const overlay = document.getElementById('sublang-overlay');
    if (overlay) {
      if (data.subtitlePosition === 'top') {
        overlay.style.setProperty('bottom', 'auto', 'important');
        overlay.style.setProperty('top', '80px', 'important');
      } else {
        overlay.style.setProperty('top', 'auto', 'important');
        overlay.style.setProperty('bottom', '80px', 'important');
      }
    }
  }
});

// Initial video detection on script load
detectVideo();
