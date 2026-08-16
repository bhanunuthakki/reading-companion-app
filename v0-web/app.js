const els = {
  camera: document.getElementById("camera"),
  canvas: document.getElementById("capture-canvas"),
  overlay: document.getElementById("camera-overlay"),
  overlayText: document.getElementById("overlay-text"),
  askBtn: document.getElementById("ask-btn"),
  askLabel: document.querySelector(".ask-btn-label"),
  askSub: document.querySelector(".ask-btn-sub"),
  status: document.getElementById("status"),
  log: document.getElementById("log"),
  modelTag: document.getElementById("model-tag"),
  cardTemplate: document.getElementById("card-template"),
};

const state = {
  mode: "init", // init | idle | listening | thinking | speaking
  recognition: null,
  pendingQuestion: "",
  lastCaptureBlob: null,
  stream: null,
};

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function setMode(mode, statusText) {
  state.mode = mode;
  els.askBtn.dataset.state = mode === "idle" ? "" : mode;
  els.askBtn.disabled = mode === "init" || mode === "thinking";

  const labels = {
    init: ["Ask", "initializing"],
    idle: ["Ask", "tap & speak"],
    listening: ["Listening", "tap to stop"],
    thinking: ["Thinking", "researching"],
    speaking: ["Speaking", "tap to stop"],
  };
  const [label, sub] = labels[mode] || labels.idle;
  els.askLabel.textContent = label;
  els.askSub.textContent = sub;
  if (statusText !== undefined) els.status.textContent = statusText;
}

async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false,
    });
    els.camera.srcObject = stream;
    state.stream = stream;
    els.overlay.hidden = true;
    return true;
  } catch (err) {
    els.overlayText.textContent =
      err.name === "NotAllowedError"
        ? "Camera permission denied. Reload to retry."
        : `Camera unavailable: ${err.message}`;
    return false;
  }
}

function captureFrame() {
  const video = els.camera;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;

  const canvas = els.canvas;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function initRecognition() {
  if (!SR) {
    els.status.textContent =
      "Speech recognition unsupported in this browser. Use Chrome/Edge on Android or desktop.";
    return null;
  }
  const rec = new SR();
  rec.lang = "en-US";
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalTranscript = "";

  rec.onresult = (e) => {
    let interim = "";
    finalTranscript = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalTranscript += t;
      else interim += t;
    }
    els.status.textContent = (finalTranscript + interim).trim() || "listening…";
  };

  rec.onerror = (e) => {
    console.warn("Recognition error:", e.error);
    if (e.error === "no-speech") {
      els.status.textContent = "Didn't catch that. Tap Ask and try again.";
    } else if (e.error === "not-allowed") {
      els.status.textContent = "Microphone permission denied.";
    } else {
      els.status.textContent = `Mic error: ${e.error}`;
    }
    setMode("idle");
  };

  rec.onend = () => {
    state.pendingQuestion = finalTranscript.trim();
    if (state.mode === "listening") {
      if (state.pendingQuestion) {
        runResearch(state.pendingQuestion);
      } else {
        setMode("idle", "No speech detected. Try again.");
      }
    }
  };

  return rec;
}

async function runResearch(question) {
  const imageDataUrl = captureFrame();
  if (!imageDataUrl) {
    setMode("idle", "Couldn't capture a frame. Is the camera on?");
    return;
  }

  setMode("thinking", `Researching: "${question}"`);

  try {
    const resp = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: imageDataUrl, question }),
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(errBody.detail || errBody.error || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    addCard({
      question,
      answer: data.answer,
      citations: data.citations || [],
      timestamp: data.timestamp,
    });

    speak(data.answer);
  } catch (err) {
    console.error(err);
    setMode("idle", `Research failed: ${err.message}`);
  }
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    setMode("idle", "Text-to-speech unsupported. Answer is in the log.");
    return;
  }
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.0;
  utter.pitch = 1.0;
  utter.lang = "en-US";

  utter.onstart = () => setMode("speaking", "speaking…");
  utter.onend = () => setMode("idle", "Ready.");
  utter.onerror = (e) => {
    console.warn("TTS error:", e);
    setMode("idle", "TTS error. Answer is in the log.");
  };

  window.speechSynthesis.speak(utter);
}

function addCard({ question, answer, citations, timestamp }) {
  const node = els.cardTemplate.content.firstElementChild.cloneNode(true);
  const t = new Date(timestamp || Date.now());
  node.querySelector(".card-time").textContent = t.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  node.querySelector(".card-question").textContent = `"${question}"`;
  node.querySelector(".card-answer").textContent = answer;

  const ul = node.querySelector(".card-citations");
  citations.forEach((c) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = c.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = c.title;
    li.appendChild(a);
    ul.appendChild(li);
  });

  els.log.prepend(node);
}

function onAskClick() {
  if (state.mode === "idle") {
    if (!state.recognition) {
      els.status.textContent = "Speech recognition unavailable.";
      return;
    }
    setMode("listening", "listening…");
    try {
      state.recognition.start();
    } catch (err) {
      console.warn("rec.start error:", err);
      setMode("idle", "Couldn't start mic.");
    }
  } else if (state.mode === "listening") {
    state.recognition?.stop();
  } else if (state.mode === "speaking") {
    window.speechSynthesis.cancel();
    setMode("idle", "Ready.");
  }
}

async function init() {
  setMode("init", "Initializing…");

  fetch("/api/health")
    .then((r) => r.json())
    .then((d) => {
      els.modelTag.textContent = d.model;
    })
    .catch(() => {
      els.modelTag.textContent = "no server";
    });

  const cameraOk = await initCamera();
  if (!cameraOk) {
    setMode("init", "Camera required.");
    return;
  }

  state.recognition = initRecognition();
  if (!state.recognition) {
    setMode("init", "Speech recognition unavailable in this browser.");
    return;
  }

  els.askBtn.addEventListener("click", onAskClick);
  setMode("idle", "Ready. Aim camera at the page, tap Ask, speak your question.");
}

init();
