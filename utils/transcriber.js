// SubLang Transcriber Module - Phase 3
// Handles real-time audio transcription using Deepgram WebSocket API

class Transcriber {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.onTranscript = null;
    this.backendUrl = null;
  }

  connect(backendWsUrl, language, onTranscript) {
    this.onTranscript = onTranscript;
    this.backendUrl = backendWsUrl;

    this.ws = new WebSocket(backendWsUrl + "/transcribe?language=" + language);

    this.ws.onopen = () => {
      this.isConnected = true;
      console.log("SubLang Transcriber: connected");
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
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
    }
  }

  disconnect() {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.close();
    }
    this.isConnected = false;
  }
}

// Export single instance
export const transcriber = new Transcriber();

// Export class as default
export default Transcriber;
