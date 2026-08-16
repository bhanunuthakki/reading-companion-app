/**
 * net.js — the phone client's entire network surface: thin REST helpers plus
 * one auto-reconnecting WebSocket to the Core.
 *
 * REST is the source of truth (threads, digests survive any reload); the
 * socket is a live event feed that may drop and reconnect at any time. The
 * app re-syncs over REST on every reconnect, so nothing is ever lost.
 */

async function asJson(resp) {
  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new Error(message);
  }
  return resp.json();
}

export const api = {
  /** GET /api/health → { ok, voiceProvider, hasGeminiKey, model } */
  health: () => fetch("/api/health").then(asJson),
  /** GET /api/threads → ThreadSummary[] newest first */
  threads: () => fetch("/api/threads").then(asJson),
  /** GET /api/threads/:id → { thread, jobs } */
  thread: (id) => fetch(`/api/threads/${encodeURIComponent(id)}`).then(asJson),
  /** PATCH /api/threads/:id { deliveryCeiling } → updated Thread */
  setCeiling: (id, deliveryCeiling) =>
    fetch(`/api/threads/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliveryCeiling }),
    }).then(asJson),
  /** GET /api/memory/search → { hits: [{ threadId, kind, snippet, score }] } */
  memorySearch: (q, k = 8) =>
    fetch(`/api/memory/search?q=${encodeURIComponent(q)}&k=${k}`).then(asJson),
};

const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 8000;

/**
 * One WebSocket to the Core's /ws with exponential-backoff reconnection.
 *
 *   const sock = new CoreSocket({ onMessage, onState });
 *   sock.connect();
 *   sock.send({ type: "wear", worn: true });   // → false when not connected
 *
 * onState receives "connecting" | "open" | "closed" so the UI can surface
 * connection state instead of silently swallowing drops.
 */
export class CoreSocket {
  #url;
  #onMessage;
  #onState;
  #socket = null;
  #backoffMs = BACKOFF_MIN_MS;
  #retryTimer = null;

  constructor({ onMessage, onState }) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.#url = `${proto}://${location.host}/ws`;
    this.#onMessage = onMessage;
    this.#onState = onState;
  }

  get isOpen() {
    return this.#socket !== null && this.#socket.readyState === WebSocket.OPEN;
  }

  connect() {
    clearTimeout(this.#retryTimer);
    this.#onState("connecting");
    const socket = new WebSocket(this.#url);
    this.#socket = socket;

    socket.addEventListener("open", () => {
      this.#backoffMs = BACKOFF_MIN_MS;
      this.#onState("open");
    });
    socket.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return; // not a protocol frame; nothing to do
      }
      this.#onMessage(msg);
    });
    socket.addEventListener("close", () => {
      if (this.#socket !== socket) return; // superseded by a newer connect()
      this.#socket = null;
      this.#onState("closed");
      this.#retryTimer = setTimeout(() => this.connect(), this.#backoffMs);
      this.#backoffMs = Math.min(this.#backoffMs * 2, BACKOFF_MAX_MS);
    });
    // "error" always precedes "close"; reconnection is handled there.
  }

  /** Send one client→Core message. Returns false (caller surfaces it) when not connected. */
  send(msg) {
    if (!this.isOpen) return false;
    this.#socket.send(JSON.stringify(msg));
    return true;
  }
}
