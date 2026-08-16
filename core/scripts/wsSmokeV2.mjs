// Offline WS v2 smoke test for the Core server: the full thought-partner loop —
// wear → capture → ask (background) → job_update sequence → deliver → REST check.
// Usage: node scripts/wsSmokeV2.mjs  (server must be running on :4000, no key needed)
import WebSocket from "ws";

const port = process.env.PORT ?? 4000;
const ws = new WebSocket(`ws://localhost:${port}/ws`);

let captureId = null;
let jobId = null;
let threadId = null;
let deliver = null;
const jobStates = [];

// Exit via exitCode + a drained event loop: process.exit() mid-WS-teardown
// trips a libuv assertion on Windows.
const guard = setTimeout(() => {
  console.log("RESULT: timeout");
  process.exitCode = 2;
  ws.terminate();
}, 20000);
guard.unref();

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "wear", worn: true }));
  ws.send(JSON.stringify({ type: "capture", imageBase64: "AAAA", hintKind: "whiteboard" }));
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  console.log("<-", msg.type, msg.state ?? msg.route ?? msg.level ?? "");
  if (msg.type === "capture_stored") {
    captureId = msg.captureId;
    ws.send(
      JSON.stringify({
        type: "ask",
        question: "compare the literature on spaced repetition versus rereading",
        captureId,
      }),
    );
  }
  if (msg.type === "ask_routed" && msg.route === "background") {
    jobId = msg.jobId;
    threadId = msg.threadId;
  }
  if (msg.type === "job_update") jobStates.push(msg.state);
  if (msg.type === "deliver") {
    deliver = msg;
    void finish();
  }
});

async function finish() {
  const threads = await fetch(`http://localhost:${port}/api/threads`).then((r) => r.json());
  const detail = threadId
    ? await fetch(`http://localhost:${port}/api/threads/${threadId}`).then((r) => r.json())
    : null;
  const hits = await fetch(`http://localhost:${port}/api/memory/search?q=spaced%20repetition`).then((r) => r.json());

  const ok =
    Boolean(captureId && jobId && deliver) &&
    ["queued", "running", "digest_ready"].every((s) => jobStates.includes(s)) &&
    Array.isArray(threads) &&
    threads.some((t) => t.id === threadId) &&
    detail?.jobs?.some((j) => j.id === jobId && j.digest) &&
    hits.hits.length > 0;

  console.log("job states:", jobStates.join(","));
  console.log("deliver:", JSON.stringify(deliver));
  console.log("memory hits:", hits.hits.length);
  console.log("RESULT:", ok ? "PASS" : "FAIL");
  process.exitCode = ok ? 0 : 1;
  ws.send(JSON.stringify({ type: "end" })); // server closes the socket; loop drains
}
