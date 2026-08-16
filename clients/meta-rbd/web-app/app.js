/*
 * Ray-Ban Display Web App — the on-glasses UI surface.
 *
 * Renders glanceable cards/badges from the Core and is operated purely by the
 * Neural Band, which Meta maps to D-PAD ARROW KEYS + ENTER on the page. This
 * file is: one WebSocket to the Core (WS v2) + arrow-key focus navigation.
 * It needs no camera/mic (the web-app path has neither) — on real glasses the
 * paired DAT-Android app captures the spoken question; in this browser preview
 * the dock actions send canned questions as the stand-in for speech.
 *
 * Interaction grammar (per xr-glasses-dev-guide/10-design-patterns.md):
 *   arrows = Neural Band swipe · Enter = pinch · ArrowUp on a card = dismiss.
 *
 * Served by the Core at /glasses, or standalone with ?core=ws://host:port/ws.
 */
const params = new URLSearchParams(location.search);
const CORE_WS = params.get("core") || `ws://${location.host}/ws`;
const CORE_HTTP = CORE_WS.replace(/^ws/, "http").replace(/\/ws$/, "");

const els = {
  status: document.getElementById("status"),
  stage: document.getElementById("stage"),
};

// Stand-ins for spoken questions (real glasses: DAT app streams the user's voice).
const RESEARCH_ASKS = [
  "compare the literature on spaced repetition versus rereading — find papers and sources",
  "find sources on whether the spotlight effect replicates in recent studies",
  "survey the evidence comparing retrieval practice with elaborative interrogation",
];
const QUICK_ASK = "define the spotlight effect";
const WATCH_TOPIC = "the spotlight effect";

const state = {
  socket: null,
  researchIdx: 0,
  threadId: null, // set by ask_routed; used to fetch the digest for a badge
  badgeJobId: null,
};

function setStatus(text) {
  els.status.textContent = text;
}

function send(message) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(message));
    return true;
  }
  setStatus("offline");
  return false;
}

// ── Stage views (one thing at a time — this is a glance, not a screen) ──────

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showHint(text) {
  els.stage.replaceChildren(el("p", "hint", text));
  focusables()[0]?.focus();
}

function showWait(text) {
  els.stage.replaceChildren(el("p", "hint wait", text));
}

/** TLDR card: big spoken-prose text + ≤3 citation titles. Never body text on glasses. */
function showCard({ text, citations, note }) {
  const card = el("article", "card");
  card.append(el("p", "answer", text));
  const list = el("ul", "citations");
  (citations || []).slice(0, 3).forEach((c, i) => list.append(el("li", null, `${i + 1}. ${c.title}`)));
  card.append(list);
  card.append(el("p", "note", note || "↑ dismiss · full digest on your phone"));
  els.stage.replaceChildren(card);
}

/** Amber badge chip; focus it so Enter (pinch) opens the digest immediately. */
function showBadge(text, { expandable } = { expandable: false }) {
  const badge = el("div", "badge");
  badge.append(el("span", "dot"), el("span", "badge-text", text));
  if (expandable) {
    badge.classList.add("focusable");
    badge.tabIndex = 0;
    badge.dataset.action = "open-digest";
  }
  els.stage.replaceChildren(badge);
  if (expandable) badge.focus();
}

function dismissStage() {
  state.badgeJobId = null;
  showHint("Tap your temple and ask about what you're reading.");
}

// ── Delivery handling (the etiquette ladder, rendered) ──────────────────────

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.06;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => ctx.close();
  } catch {
    /* audio unavailable in this browser — badge still shows */
  }
}

function speak(text) {
  try {
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch {
    /* TTS unavailable — badge still shows */
  }
}

function onDeliver(msg) {
  if (msg.level === "hold") {
    setStatus("on your phone");
    showHint("A digest arrived quietly — it's waiting on your phone.");
    return;
  }
  state.badgeJobId = msg.jobId;
  setStatus("digest ready");
  showBadge(msg.badge || msg.tldr || "Digest ready", { expandable: true });
  if (msg.level === "earcon") beep();
  if (msg.level === "speak") {
    beep();
    if (msg.tldr) speak(msg.tldr);
  }
}

async function openDigest() {
  if (!state.badgeJobId || !state.threadId) return;
  setStatus("opening…");
  try {
    const resp = await fetch(`${CORE_HTTP}/api/threads/${encodeURIComponent(state.threadId)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const detail = await resp.json();
    const job = (detail.jobs || []).find((j) => j.id === state.badgeJobId);
    if (!job || !job.digest) throw new Error("digest not found");
    showCard({ text: job.digest.tldr, citations: job.digest.citations });
    setStatus("ready");
  } catch {
    setStatus("error");
    showHint("Couldn't open the digest — it's still on your phone.");
  }
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case "ask_routed":
      state.threadId = msg.threadId;
      if (msg.route === "background") {
        setStatus("on it…");
        showWait("On it — keep reading. I'll come back.");
      } else if (msg.answer) {
        setStatus("ready");
        showCard({ text: msg.answer.text, citations: msg.answer.citations });
      }
      break;
    case "job_update":
      if (msg.state === "running") setStatus("researching…");
      else if (msg.state === "failed") setStatus("failed");
      break;
    case "deliver":
      onDeliver(msg);
      break;
    case "capture_stored":
      setStatus(`captured ${msg.kind}`);
      break;
    case "watcher_armed":
      setStatus("watching");
      showBadge(`Watching: ${msg.watcher.topic}`);
      break;
    // v1 session messages still arrive when a reading Session is open:
    case "opened":
      setStatus(msg.session.state);
      break;
    case "answer":
      showCard({ text: msg.answer.text, citations: msg.answer.citations });
      break;
    case "page_observed":
      setStatus("reading");
      break;
    case "error":
      setStatus("error");
      break;
    default:
      break;
  }
}

function connect() {
  setStatus("connecting…");
  const socket = new WebSocket(CORE_WS);
  state.socket = socket;
  socket.addEventListener("open", () => {
    setStatus("ready");
    // This surface IS the glasses: it is on-face by definition.
    send({ type: "wear", worn: true });
  });
  socket.addEventListener("message", (e) => handleServerMessage(JSON.parse(e.data)));
  socket.addEventListener("close", () => setStatus("offline"));
  socket.addEventListener("error", () => setStatus("offline"));
}

// ── D-pad focus model (Neural Band → arrow keys + Enter) ────────────────────

function focusables() {
  return Array.from(document.querySelectorAll(".focusable"));
}

function moveFocus(delta) {
  const items = focusables();
  if (items.length === 0) return;
  const current = items.indexOf(document.activeElement);
  const next = (current + delta + items.length) % items.length;
  items[next].focus();
}

const ACTIONS = {
  research() {
    const question = RESEARCH_ASKS[state.researchIdx % RESEARCH_ASKS.length];
    state.researchIdx += 1;
    const msg = { type: "ask", question };
    if (state.threadId) msg.threadId = state.threadId;
    if (send(msg)) setStatus("asking…");
  },
  quick() {
    const msg = { type: "ask", question: QUICK_ASK };
    if (state.threadId) msg.threadId = state.threadId;
    if (send(msg)) setStatus("asking…");
  },
  watch() {
    send({ type: "watch", topic: WATCH_TOPIC });
  },
  "open-digest": openDigest,
};

function activate(target) {
  const action = target.dataset.action;
  if (action && ACTIONS[action]) ACTIONS[action]();
}

document.addEventListener("keydown", (e) => {
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown":
      moveFocus(1);
      e.preventDefault();
      break;
    case "ArrowLeft":
      moveFocus(-1);
      e.preventDefault();
      break;
    case "ArrowUp":
      // Up = dismiss whatever is on stage (notification-preview pattern).
      if (els.stage.querySelector(".card, .badge")) dismissStage();
      else moveFocus(-1);
      e.preventDefault();
      break;
    case "Enter":
      if (document.activeElement?.classList.contains("focusable")) {
        activate(document.activeElement);
        e.preventDefault();
      }
      break;
    default:
      break;
  }
});

focusables()[0]?.focus();
connect();
