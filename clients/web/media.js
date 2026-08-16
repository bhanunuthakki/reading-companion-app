/**
 * media.js — device I/O for the phone client: camera stills (downscaled to
 * ≤1024px JPEG base64, the capture-message payload), push-to-talk dictation
 * (Web Speech API), text-to-speech, and the WebAudio earcon.
 *
 * Everything degrades visibly, never silently: callers get null / a rejected
 * promise / an availability flag and surface the state in the UI.
 */

export const MAX_CAPTURE_DIM = 1024;
const JPEG_QUALITY = 0.85;

/** Open the rear (environment) camera. Rejects with the getUserMedia error. */
export function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error("Camera API unavailable in this browser."));
  }
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
    audio: false,
  });
}

export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Draw a video/image source downscaled to ≤MAX_CAPTURE_DIM and return raw JPEG base64 (no data: prefix). */
function toJpegBase64(source, width, height) {
  const scale = Math.min(1, MAX_CAPTURE_DIM / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/** Snap a still from a live <video>. Returns raw base64, or null before the first frame. */
export function snapVideoFrame(video) {
  const { videoWidth, videoHeight } = video;
  if (!videoWidth || !videoHeight) return null;
  return toJpegBase64(video, videoWidth, videoHeight);
}

/** File-upload fallback: decode an image file and downscale it the same way. */
export function fileToJpegBase64(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(toJpegBase64(img, img.naturalWidth, img.naturalHeight));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read "${file.name}" as an image.`));
    };
    img.src = url;
  });
}

// ── Push-to-talk dictation (Web Speech API) ─────────────────────────────────

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

/** False → hide the mic button; typed asks still work. */
export const speechRecognitionAvailable = Boolean(SR);

/**
 * Hold-to-dictate recognizer: call start() on press, stop() on release;
 * onFinal fires once with the full transcript after release.
 */
export function createRecognizer({ onInterim, onFinal, onError }) {
  if (!SR) return null;
  const rec = new SR();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = "";

  rec.onresult = (event) => {
    finalText = "";
    let interim = "";
    for (let i = 0; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript;
      else interim += transcript;
    }
    onInterim((finalText + interim).trim());
  };
  rec.onerror = (event) => onError(event.error);
  rec.onend = () => {
    const text = finalText.trim();
    finalText = "";
    onFinal(text);
  };

  return {
    start() {
      finalText = "";
      try {
        rec.start();
      } catch {
        /* already started — double pointerdown; harmless */
      }
    },
    stop() {
      rec.stop();
    },
  };
}

// ── Text-to-speech ──────────────────────────────────────────────────────────

/** Speak plain text (fast answers, "on it" beats, speak-level deliveries). */
export function speak(text) {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.lang = "en-US";
  window.speechSynthesis.speak(utterance);
}

// ── Earcon (deliver level "earcon") ─────────────────────────────────────────

let audioCtx = null;

/** Two soft ascending sine blips — the "your digest is ready" tone. */
export function earcon() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  audioCtx ??= new Ctx();
  if (audioCtx.state === "suspended") void audioCtx.resume();

  const t0 = audioCtx.currentTime;
  for (const [freq, offset] of [
    [880, 0],
    [1318.5, 0.14],
  ]) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + offset);
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.13);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0 + offset);
    osc.stop(t0 + offset + 0.15);
  }
}
