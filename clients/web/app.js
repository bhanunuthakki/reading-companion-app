/**
 * app.js — the Thought Partner phone client (MVP, milestone M1).
 *
 * One WS v2 connection to the Core plus REST for durable state. The whole
 * felt loop lives here: capture → ask → triage beat → background job →
 * polite delivery (glasses sim strip) → digest in the thread, all offline.
 *
 * Contract quirks honored (core/README.md):
 *  - job_update "queued" arrives BEFORE ask_routed — correlate by jobId.
 *  - Wear defaults to NOT worn; the wear toggle sends { type:"wear" }.
 *  - A "hold" deliver leaves the job digest_ready; the digest is fetched
 *    over REST and shown with a "delivered to phone" note.
 *  - The offline capture extract marker is an absence, never content.
 */
import { api, CoreSocket } from "./net.js";
import {
  createRecognizer,
  earcon,
  fileToJpegBase64,
  openCamera,
  snapVideoFrame,
  speak,
  speechRecognitionAvailable,
  stopStream,
} from "./media.js";

const OFFLINE_MARKER = "[extraction unavailable offline — set GEMINI_API_KEY]";
const OFFLINE_MARKER_LABEL = "extraction unavailable (offline)";
const BACKGROUND_BEAT = "On it — I'll come back.";
const MAX_BADGES = 3;
const MAX_DELIVERY_LOG = 3;

const $ = (id) => document.getElementById(id);
const els = {
  connDot: $("conn-dot"),
  modelTag: $("model-tag"),
  banner: $("banner"),
  wearToggle: $("wear-toggle"),
  wearLabel: $("wear-label"),
  glassesBadges: $("glasses-badges"),
  deliveryLog: $("delivery-log"),
  newThread: $("new-thread"),
  threadRail: $("thread-rail"),
  memoryInput: $("memory-input"),
  memoryResults: $("memory-results"),
  threadHead: $("thread-head"),
  threadTopic: $("thread-topic"),
  ceilingSelect: $("ceiling-select"),
  timeline: $("timeline"),
  pendingCapture: $("pending-capture"),
  askStatus: $("ask-status"),
  captureBtn: $("capture-btn"),
  askInput: $("ask-input"),
  micBtn: $("mic-btn"),
  sendBtn: $("send-btn"),
  capturePanel: $("capture-panel"),
  captureClose: $("capture-close"),
  captureVideo: $("capture-video"),
  captureError: $("capture-error"),
  captureKind: $("capture-kind"),
  snapBtn: $("snap-btn"),
  uploadBtn: $("upload-btn"),
  uploadInput: $("upload-input"),
  captureStatus: $("capture-status"),
};

const state = {
  threads: [], // ThreadSummary[] (REST, newest first)
  activeThreadId: null, // null = composing a new thread
  detail: null, // { thread, jobs } for the active thread
  jobLive: new Map(), // jobId → latest live JobState (overrides persisted)
  jobThread: new Map(), // jobId → threadId (from ask_routed + thread details)
  holdDelivered: new Set(), // jobIds whose digest arrived via a hold deliver
  expandedDigests: new Set(), // jobIds with the digest body expanded
  pendingCapture: null, // { id, kind } — attached to the next ask
  pendingAsk: null, // question awaiting ask_routed
  beat: null, // ephemeral "On it" line in the timeline
  worn: false,
  cameraStream: null,
};

const sock = new CoreSocket({ onMessage: onCoreMessage, onState: onSocketState });

// ── Small helpers ───────────────────────────────────────────────────────────

/** The offline extraction marker is an absence, not content — never render it raw. */
function displayable(text) {
  return typeof text === "string" ? text.split(OFFLINE_MARKER).join(OFFLINE_MARKER_LABEL) : "";
}

function shortId(id) {
  return String(id).slice(0, 8);
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

let bannerTimer = null;
function banner(text, kind = "error", ms = 6000) {
  els.banner.textContent = text;
  els.banner.dataset.kind = kind;
  els.banner.hidden = false;
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(() => (els.banner.hidden = true), ms);
}

function askStatus(text) {
  els.askStatus.textContent = text;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ── REST sync (source of truth) ─────────────────────────────────────────────

async function refreshThreads() {
  try {
    state.threads = await api.threads();
    renderThreadRail();
  } catch (err) {
    banner(`Thread list failed: ${err.message}`);
  }
}

async function refreshDetail() {
  if (!state.activeThreadId) return;
  try {
    const detail = await api.thread(state.activeThreadId);
    state.detail = detail;
    for (const jobId of detail.thread.jobIds) state.jobThread.set(jobId, detail.thread.id);
    renderThreadView();
  } catch (err) {
    banner(`Thread load failed: ${err.message}`);
  }
}

async function selectThread(threadId) {
  state.activeThreadId = threadId;
  state.detail = null;
  state.beat = null;
  renderThreadRail();
  renderThreadView();
  await refreshDetail();
  scrollTimelineToBottom(true);
}

function startNewThread() {
  state.activeThreadId = null;
  state.detail = null;
  state.beat = null;
  renderThreadRail();
  renderThreadView();
  els.askInput.focus();
}

// ── Core WS message handling ────────────────────────────────────────────────

function onCoreMessage(msg) {
  switch (msg.type) {
    case "ask_routed":
      onAskRouted(msg);
      break;
    case "capture_stored":
      onCaptureStored(msg);
      break;
    case "job_update":
      onJobUpdate(msg);
      break;
    case "deliver":
      onDeliver(msg);
      break;
    case "error":
      banner(`Core error: ${msg.message}`);
      state.pendingAsk = null;
      askStatus("");
      renderThreadView();
      break;
    default:
      break; // v1 session traffic (opened/audio/…) — not this client's surface
  }
}

function onAskRouted(msg) {
  state.pendingAsk = null;
  state.activeThreadId = msg.threadId;
  if (msg.route === "fast" && msg.answer) {
    askStatus("Quick answer.");
    speak(msg.answer.text);
  } else {
    state.beat = BACKGROUND_BEAT;
    state.jobThread.set(msg.jobId, msg.threadId);
    askStatus("Routed to background research.");
    speak(BACKGROUND_BEAT);
  }
  void refreshThreads();
  void refreshDetail().then(() => scrollTimelineToBottom(true));
}

function onCaptureStored(msg) {
  state.pendingCapture = { id: msg.captureId, kind: msg.kind };
  renderPendingCapture();
  els.captureStatus.textContent = `Stored: ${msg.kind} · ${shortId(msg.captureId)} — attached to your next ask.`;
  askStatus(`Capture ready (${msg.kind}) — it rides along with your next ask.`);
  closeCapturePanel();
}

function onJobUpdate(msg) {
  // "queued" legitimately arrives before ask_routed — record first, correlate later.
  state.jobLive.set(msg.jobId, msg.state);
  renderThreadView();
  if (msg.state !== "queued" && msg.state !== "running") {
    // digest_ready / delivered / failed / archived — REST has the durable truth.
    void refreshThreads();
    void refreshDetail();
  }
}

function onDeliver(msg) {
  const levelLabel = msg.level.toUpperCase();
  logDelivery(msg);
  if (msg.level === "hold") {
    // Nothing on glasses: the digest waits in its Thread on the phone.
    state.holdDelivered.add(msg.jobId);
    askStatus("A digest arrived quietly — delivered to phone (hold).");
  } else {
    addBadgeChip(msg);
    if (msg.level === "earcon") earcon();
    if (msg.level === "speak") speak(msg.tldr ?? msg.badge ?? "Your research is back.");
    askStatus(`Delivered at level ${levelLabel} on ${msg.surface}.`);
  }
  if (state.beat) state.beat = null;
  void refreshThreads();
  void refreshDetail();
}

function onSocketState(wsState) {
  els.connDot.dataset.state = wsState;
  if (wsState === "open") {
    if (els.banner.dataset.kind === "conn") els.banner.hidden = true;
    // Re-assert per-connection state (wear defaults to not-worn server-side)
    // and re-sync durable state — REST is the source of truth after any drop.
    if (state.worn) sock.send({ type: "wear", worn: true });
    void refreshThreads();
    void refreshDetail();
  } else if (wsState === "closed") {
    els.banner.textContent = "Connection to Core lost — reconnecting…";
    els.banner.dataset.kind = "conn";
    els.banner.hidden = false;
    clearTimeout(bannerTimer);
  }
}

// ── Glasses simulator strip ─────────────────────────────────────────────────

function logDelivery(msg) {
  const item = el("li");
  item.append(
    el("span", null, `${new Date().toLocaleTimeString([], { hour12: false })} · `),
    el("span", "lvl", msg.level),
    el("span", null, ` → ${msg.surface} · job ${shortId(msg.jobId)}`),
  );
  els.deliveryLog.prepend(item);
  while (els.deliveryLog.children.length > MAX_DELIVERY_LOG) els.deliveryLog.lastChild.remove();
}

function addBadgeChip(msg) {
  const chip = el("div", "badge-chip");
  chip.append(el("span", "badge-level", msg.level));
  chip.append(el("span", "badge-text", displayable(msg.badge ?? msg.tldr ?? "")));

  const actions = el("div", "badge-actions");
  const open = el("button", null, "open");
  open.addEventListener("click", () => {
    chip.remove();
    const threadId = state.jobThread.get(msg.jobId);
    if (threadId) void selectThread(threadId);
    else void refreshThreads();
  });
  const dismiss = el("button", null, "✕");
  dismiss.title = "Dismiss (the digest stays in its thread)";
  dismiss.addEventListener("click", () => chip.remove());
  actions.append(open, dismiss);
  chip.append(actions);

  els.glassesBadges.prepend(chip);
  while (els.glassesBadges.children.length > MAX_BADGES) els.glassesBadges.lastChild.remove();
}

function onWearToggle() {
  state.worn = els.wearToggle.checked;
  els.wearLabel.textContent = state.worn ? "worn" : "not worn";
  if (!sock.send({ type: "wear", worn: state.worn })) {
    banner("Not connected — wear state will re-send on reconnect.");
  }
}

// ── Rendering: thread rail ──────────────────────────────────────────────────

function renderThreadRail() {
  els.threadRail.replaceChildren(
    ...state.threads.map((summary) => {
      const chip = el("button", "rail-chip");
      chip.dataset.active = String(summary.id === state.activeThreadId);
      chip.append(
        el("span", null, summary.topic),
        el("span", "rail-count", `${summary.turnCount}t/${summary.jobCount}j/${summary.digestCount}d`),
      );
      chip.title = `${summary.topic}\nceiling: ${summary.deliveryCeiling} · updated ${fmtTime(summary.updatedAt)}`;
      chip.addEventListener("click", () => void selectThread(summary.id));
      return chip;
    }),
  );
}

// ── Rendering: thread view / timeline ───────────────────────────────────────

function jobStateOf(job) {
  return state.jobLive.get(job.id) ?? job.state;
}

function renderThreadView() {
  const detail = state.detail;
  if (!state.activeThreadId || !detail) {
    els.threadHead.hidden = true;
    const empty = el(
      "div",
      "timeline-empty",
      state.activeThreadId
        ? "Loading thread…"
        : "New thread. Ask something — short questions answer fast; " +
            "phrases like “compare the literature…” or “find papers on…” dispatch background research.",
    );
    els.timeline.replaceChildren(empty);
    return;
  }

  els.threadHead.hidden = false;
  els.threadTopic.textContent = detail.thread.topic;
  els.ceilingSelect.value = detail.thread.deliveryCeiling;

  const items = [
    ...detail.thread.turns.map((turn) => ({ at: turn.at, node: () => renderTurn(turn) })),
    ...detail.jobs.map((job) => ({ at: job.createdAt, node: () => renderJob(job) })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  const nodes = items.map((item) => item.node());
  if (nodes.length === 0 && !state.pendingAsk && !state.beat) {
    nodes.push(el("div", "timeline-empty", "No turns yet in this thread. Ask away."));
  }
  if (state.pendingAsk) {
    const pending = el("article", "turn pending-turn");
    const head = el("header", "item-head");
    head.append(el("time", "item-time", "…"), el("span", "item-question", `“${state.pendingAsk}”`));
    pending.append(head, el("p", "turn-answer", "Routing…"));
    nodes.push(pending);
  }
  if (state.beat) nodes.push(el("div", "beat", state.beat));

  const stick = isTimelineNearBottom();
  els.timeline.replaceChildren(...nodes);
  if (stick) scrollTimelineToBottom();
}

function renderTurn(turn) {
  const node = el("article", "turn");
  const head = el("header", "item-head");
  head.append(el("time", "item-time", fmtTime(turn.at)), el("span", "item-question", `“${turn.question}”`));
  node.append(head, el("p", "turn-answer", displayable(turn.answer.text)), renderCitations(turn.answer.citations));
  return node;
}

function renderJob(job) {
  const liveState = jobStateOf(job);
  const node = el("article", "job");

  const head = el("header", "item-head");
  head.append(el("time", "item-time", fmtTime(job.createdAt)), el("span", "item-question", `“${job.question}”`));
  const stateChip = el("span", "job-state", liveState.replace("_", " "));
  stateChip.dataset.state = liveState;
  head.append(stateChip);
  if (liveState === "queued" || liveState === "running") {
    const cancel = el("button", "job-cancel", "cancel");
    cancel.addEventListener("click", () => {
      if (!sock.send({ type: "job_cancel", jobId: job.id })) banner("Not connected — cannot cancel right now.");
    });
    head.append(cancel);
  }
  node.append(head);

  if (job.failure) node.append(el("p", "job-failure", displayable(job.failure)));

  if (job.digest) {
    const digest = el("div", "digest");
    digest.append(el("p", "digest-tldr", displayable(job.digest.tldr)));

    const details = document.createElement("details");
    details.open = state.expandedDigests.has(job.id);
    details.addEventListener("toggle", () => {
      if (details.open) state.expandedDigests.add(job.id);
      else state.expandedDigests.delete(job.id);
    });
    details.append(el("summary", null, "full digest & citations"));
    details.append(el("p", "digest-body", displayable(job.digest.body)));
    details.append(renderCitations(job.digest.citations));
    if (job.digest.followups?.length) {
      const list = el("ul", "digest-followups");
      for (const followup of job.digest.followups) list.append(el("li", null, followup));
      details.append(list);
    }
    details.append(el("p", "digest-confidence", `confidence ${job.digest.confidence.toFixed(2)}`));
    digest.append(details);
    node.append(digest);

    if (state.holdDelivered.has(job.id)) {
      node.append(el("p", "job-note", "delivered to phone (hold) — waiting here, no glasses interruption"));
    }
  }
  return node;
}

function renderCitations(citations = []) {
  const list = el("ul", "citations");
  for (const citation of citations) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = citation.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = citation.title;
    item.append(link);
    list.append(item);
  }
  return list;
}

function isTimelineNearBottom() {
  const t = els.timeline;
  return t.scrollHeight - t.scrollTop - t.clientHeight < 60;
}

function scrollTimelineToBottom(force = false) {
  if (force || isTimelineNearBottom()) els.timeline.scrollTop = els.timeline.scrollHeight;
}

// ── Ask bar ─────────────────────────────────────────────────────────────────

function sendAsk() {
  const question = els.askInput.value.trim();
  if (!question) return;
  const msg = { type: "ask", question };
  if (state.pendingCapture) msg.captureId = state.pendingCapture.id;
  if (state.activeThreadId) msg.threadId = state.activeThreadId;
  if (!sock.send(msg)) {
    banner("Not connected — reconnecting. Your question was not sent.");
    return;
  }
  state.pendingAsk = question;
  state.pendingCapture = null;
  renderPendingCapture();
  els.askInput.value = "";
  askStatus("Asking…");
  renderThreadView();
  scrollTimelineToBottom(true);
}

function renderPendingCapture() {
  if (!state.pendingCapture) {
    els.pendingCapture.hidden = true;
    els.pendingCapture.replaceChildren();
    return;
  }
  const { id, kind } = state.pendingCapture;
  els.pendingCapture.hidden = false;
  const detach = el("button", null, "✕");
  detach.title = "Detach capture";
  detach.addEventListener("click", () => {
    state.pendingCapture = null;
    renderPendingCapture();
  });
  els.pendingCapture.replaceChildren(el("span", null, `📎 ${kind} · ${shortId(id)}`), detach);
}

// ── Capture panel ───────────────────────────────────────────────────────────

async function openCapturePanel() {
  els.capturePanel.hidden = false;
  els.captureError.hidden = true;
  els.captureStatus.textContent = "";
  els.snapBtn.disabled = false;
  try {
    state.cameraStream = await openCamera();
    els.captureVideo.srcObject = state.cameraStream;
  } catch (err) {
    els.captureError.textContent =
      err.name === "NotAllowedError"
        ? "Camera permission denied — use Upload instead."
        : `Camera unavailable (${err.message}) — use Upload instead.`;
    els.captureError.hidden = false;
    els.snapBtn.disabled = true;
  }
}

function closeCapturePanel() {
  stopStream(state.cameraStream);
  state.cameraStream = null;
  els.captureVideo.srcObject = null;
  els.capturePanel.hidden = true;
}

function sendCapture(imageBase64) {
  const msg = { type: "capture", imageBase64 };
  const hint = els.captureKind.value;
  if (hint) msg.hintKind = hint;
  if (state.activeThreadId) msg.threadId = state.activeThreadId;
  if (!sock.send(msg)) {
    els.captureStatus.textContent = "Not connected — capture not sent.";
    return;
  }
  els.captureStatus.textContent = "Extracting…";
}

function onSnap() {
  const imageBase64 = snapVideoFrame(els.captureVideo);
  if (!imageBase64) {
    els.captureStatus.textContent = "No frame yet — wait for the preview, or use Upload.";
    return;
  }
  sendCapture(imageBase64);
}

async function onUploadFile(file) {
  if (!file) return;
  try {
    sendCapture(await fileToJpegBase64(file));
  } catch (err) {
    els.captureStatus.textContent = err.message;
  }
}

// ── Push-to-talk mic ────────────────────────────────────────────────────────

function wireMic() {
  if (!speechRecognitionAvailable) {
    els.micBtn.hidden = true; // graceful: typed asks still work
    return;
  }
  const recognizer = createRecognizer({
    onInterim: (text) => {
      if (text) els.askInput.value = text;
    },
    onFinal: (text) => {
      els.micBtn.dataset.state = "";
      if (text) {
        els.askInput.value = text;
        sendAsk();
      } else if (els.micBtn.dataset.wasListening === "true") {
        askStatus("Didn't catch that — hold the mic and speak.");
      }
      els.micBtn.dataset.wasListening = "false";
    },
    onError: (code) => {
      els.micBtn.dataset.state = "";
      askStatus(code === "not-allowed" ? "Microphone permission denied." : `Mic error: ${code}`);
    },
  });

  const press = (event) => {
    event.preventDefault();
    els.micBtn.dataset.state = "listening";
    els.micBtn.dataset.wasListening = "true";
    askStatus("Listening — release to send.");
    recognizer.start();
  };
  const release = () => {
    if (els.micBtn.dataset.state === "listening") recognizer.stop();
  };
  els.micBtn.addEventListener("pointerdown", press);
  els.micBtn.addEventListener("pointerup", release);
  els.micBtn.addEventListener("pointercancel", release);
  els.micBtn.addEventListener("pointerleave", release);
}

// ── Memory search ───────────────────────────────────────────────────────────

async function runMemorySearch() {
  const q = els.memoryInput.value.trim();
  if (!q) {
    els.memoryResults.hidden = true;
    els.memoryResults.replaceChildren();
    return;
  }
  try {
    const { hits } = await api.memorySearch(q);
    els.memoryResults.hidden = false;
    if (hits.length === 0) {
      els.memoryResults.replaceChildren(el("p", "memory-none", "No memory hits."));
      return;
    }
    els.memoryResults.replaceChildren(
      ...hits.map((hit) => {
        const button = el("button", "memory-hit");
        const meta = el("div", "hit-meta");
        meta.append(
          el("span", null, hit.kind),
          el("span", null, `score ${hit.score.toFixed(2)}`),
          el("span", null, `thread ${shortId(hit.threadId)}`),
        );
        button.append(meta, el("div", "hit-snippet", displayable(hit.snippet)));
        button.addEventListener("click", () => {
          els.memoryResults.hidden = true;
          void selectThread(hit.threadId);
        });
        return button;
      }),
    );
  } catch (err) {
    banner(`Memory search failed: ${err.message}`);
  }
}

// ── Politeness ceiling ──────────────────────────────────────────────────────

async function onCeilingChange() {
  if (!state.activeThreadId) return;
  try {
    const thread = await api.setCeiling(state.activeThreadId, els.ceilingSelect.value);
    if (state.detail) state.detail.thread = thread;
    askStatus(`Politeness ceiling set to ${thread.deliveryCeiling}.`);
    void refreshThreads();
  } catch (err) {
    banner(`Ceiling update failed: ${err.message}`);
    void refreshDetail(); // restore the real value in the select
  }
}

// ── Boot ────────────────────────────────────────────────────────────────────

async function init() {
  els.wearToggle.addEventListener("change", onWearToggle);
  els.newThread.addEventListener("click", startNewThread);
  els.sendBtn.addEventListener("click", sendAsk);
  els.askInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendAsk();
  });
  els.ceilingSelect.addEventListener("change", () => void onCeilingChange());
  els.memoryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void runMemorySearch();
  });
  els.memoryInput.addEventListener("input", () => {
    if (!els.memoryInput.value.trim()) {
      els.memoryResults.hidden = true;
      els.memoryResults.replaceChildren();
    }
  });
  els.captureBtn.addEventListener("click", () => void openCapturePanel());
  els.captureClose.addEventListener("click", closeCapturePanel);
  els.snapBtn.addEventListener("click", onSnap);
  els.uploadBtn.addEventListener("click", () => els.uploadInput.click());
  els.uploadInput.addEventListener("change", () => {
    void onUploadFile(els.uploadInput.files[0]);
    els.uploadInput.value = "";
  });
  wireMic();

  try {
    const health = await api.health();
    els.modelTag.textContent = health.hasGeminiKey ? health.model : `${health.model} · offline mocks`;
  } catch (err) {
    els.modelTag.textContent = "core unreachable";
    banner(`Core health check failed: ${err.message}`);
  }

  await refreshThreads();
  if (state.threads.length > 0) await selectThread(state.threads[0].id);
  else renderThreadView();

  sock.connect();
}

void init();
