// Headless smoke for clients/web: drives the EXACT WS/REST flow the phone
// client uses against a running Core (from core/: npm start — no key needed).
//
//   wear on → capture (whiteboard) → ask #1 (background phrasing, capture attached)
//   → job_update queued/running/digest_ready → deliver level "badge" (default
//   policy: worn + display) → REST thread detail has the digest → GET /app is
//   served → PATCH deliveryCeiling "hold" → ask #2 on the same thread →
//   deliver level "hold" surface "phone", job stays digest_ready.
//
// Usage: node clients/web/smoke.mjs   (PORT env respected, default 4000)
import { createRequire } from "node:module";

// Resolve `ws` from core/node_modules regardless of cwd — this client itself
// has no npm package (no build step), matching v0-web conventions.
const require = createRequire(new URL("../../core/package.json", import.meta.url));
const WebSocket = require("ws");

const port = process.env.PORT ?? 4000;
const base = `http://localhost:${port}`;
const ws = new WebSocket(`ws://localhost:${port}/ws`);

// The two asks use the offline triage markers (literature/sources/survey/evidence)
// exactly like the client's placeholder copy, so both route background.
const ASK_1 = "compare the literature on spaced repetition versus rereading — find papers and sources";
const ASK_2 = "survey the evidence comparing retrieval practice with elaborative interrogation";

let captureId = null;
let threadId = null;
let jobId1 = null;
let jobId2 = null;
const jobStates = new Map(); // jobId → [states in arrival order]
const checks = [];

function check(name, ok, info = "") {
  checks.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${info ? ` — ${info}` : ""}`);
}

function statesOf(jobId) {
  return jobStates.get(jobId) ?? [];
}

// Give the Core a beat after each deliver before hitting REST: deliverDigest
// keeps persisting (thread save, markDelivered) after the WS send, and reading
// the store files mid-rename intermittently EPERMs on Windows/Drive-sync.
const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

// Exit via exitCode + a drained event loop: process.exit() mid-WS-teardown
// trips a libuv assertion on Windows (same pattern as core/scripts/wsSmokeV2.mjs).
const guard = setTimeout(() => {
  console.log("RESULT: timeout");
  process.exitCode = 2;
  ws.terminate();
}, 30000);
guard.unref();

ws.on("open", () => {
  // The client sends wear on toggle; captures ride as downscaled JPEG base64
  // (offline the bytes are never decoded, so a marker payload suffices here).
  ws.send(JSON.stringify({ type: "wear", worn: true }));
  ws.send(JSON.stringify({ type: "capture", imageBase64: "AAAA", hintKind: "whiteboard" }));
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  console.log("<-", msg.type, msg.state ?? msg.route ?? msg.level ?? "");
  void handle(msg).catch((err) => {
    console.error("smoke error:", err);
    process.exitCode = 1;
    ws.terminate();
  });
});

async function handle(msg) {
  switch (msg.type) {
    case "capture_stored": {
      captureId = msg.captureId;
      check("capture_stored kind honors hint", msg.kind === "whiteboard", msg.kind);
      // Ask #1: no threadId → the Core auto-creates the Thread (spec §12 Q2).
      ws.send(JSON.stringify({ type: "ask", question: ASK_1, captureId }));
      break;
    }
    case "job_update": {
      if (!jobStates.has(msg.jobId)) jobStates.set(msg.jobId, []);
      jobStates.get(msg.jobId).push(msg.state);
      break;
    }
    case "ask_routed": {
      check(`ask_routed route is background (${jobId1 ? "ask 2" : "ask 1"})`, msg.route === "background", msg.route);
      if (!jobId1) {
        jobId1 = msg.jobId;
        threadId = msg.threadId;
        // The contract says job_update "queued" arrives BEFORE ask_routed.
        check("job_update queued preceded ask_routed", statesOf(jobId1).includes("queued"));
      } else {
        jobId2 = msg.jobId;
        check("ask 2 stayed on the same thread", msg.threadId === threadId);
      }
      break;
    }
    case "deliver": {
      if (msg.jobId === jobId1) await afterFirstDeliver(msg);
      else if (msg.jobId === jobId2) await afterSecondDeliver(msg);
      break;
    }
    case "error": {
      check("no Core errors", false, msg.message);
      finish();
      break;
    }
    default:
      break;
  }
}

async function afterFirstDeliver(msg) {
  await settle();
  // Default policy with worn=true + display device + not invited → badge/glasses.
  check("deliver #1 level is badge (default policy, worn)", msg.level === "badge", msg.level);
  check("deliver #1 surface is glasses", msg.surface === "glasses", msg.surface);
  check("badge is ≤140 chars", typeof msg.badge === "string" && msg.badge.length <= 140);

  const detail = await fetch(`${base}/api/threads/${threadId}`).then((r) => r.json());
  const job = detail.jobs.find((j) => j.id === jobId1);
  check("REST thread detail contains digest #1", Boolean(job?.digest), job ? job.state : "job missing");

  const app = await fetch(`${base}/app/`);
  check(
    "GET /app serves the client",
    app.status === 200 && (app.headers.get("content-type") ?? "").includes("text/html"),
    `${app.status} ${app.headers.get("content-type")}`,
  );

  const patched = await fetch(`${base}/api/threads/${threadId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deliveryCeiling: "hold" }),
  }).then((r) => r.json());
  check("PATCH deliveryCeiling → hold", patched.deliveryCeiling === "hold", patched.deliveryCeiling);

  // Ask #2 exactly like the client does with an active thread selected.
  ws.send(JSON.stringify({ type: "ask", question: ASK_2, threadId }));
}

async function afterSecondDeliver(msg) {
  await settle();
  check("deliver #2 level clamped to hold", msg.level === "hold", msg.level);
  check("deliver #2 surface is phone", msg.surface === "phone", msg.surface);

  const detail = await fetch(`${base}/api/threads/${threadId}`).then((r) => r.json());
  const job1 = detail.jobs.find((j) => j.id === jobId1);
  const job2 = detail.jobs.find((j) => j.id === jobId2);
  check("job #1 reached delivered", job1?.state === "delivered", job1?.state);
  check("held job #2 stays digest_ready with digest", job2?.state === "digest_ready" && Boolean(job2?.digest), job2?.state);
  check(
    "job #1 saw queued→running→digest_ready",
    ["queued", "running", "digest_ready"].every((s) => statesOf(jobId1).includes(s)),
    statesOf(jobId1).join(","),
  );
  check("held job #2 never got a delivered update", !statesOf(jobId2).includes("delivered"), statesOf(jobId2).join(","));

  const threads = await fetch(`${base}/api/threads`).then((r) => r.json());
  const summary = threads.find((t) => t.id === threadId);
  check("thread summary shows the digests", Boolean(summary) && summary.digestCount >= 1, `digestCount ${summary?.digestCount}`);

  finish();
}

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  const ok = checks.length > 0 && checks.every(Boolean);
  console.log(`checks: ${checks.filter(Boolean).length}/${checks.length} passed`);
  console.log("RESULT:", ok ? "PASS" : "FAIL");
  process.exitCode = ok ? 0 : 1;
  ws.send(JSON.stringify({ type: "end" })); // server closes the socket; loop drains
}
