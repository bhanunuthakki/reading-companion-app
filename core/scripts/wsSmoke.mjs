// Offline WebSocket smoke test for the Core server: open → say → watch → end.
// Usage: node scripts/wsSmoke.mjs  (server must be running on :4000)
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:4000/ws");
const seen = [];

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "open", ref: { kind: "book", title: "Smoke Test Book" }, deviceId: "smoke" }));
  setTimeout(() => ws.send(JSON.stringify({ type: "say", question: "what is this about?" })), 300);
  setTimeout(() => ws.send(JSON.stringify({ type: "watch", topic: "testing" })), 600);
  setTimeout(() => ws.send(JSON.stringify({ type: "end" })), 1000);
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  seen.push(msg.type);
  console.log("<-", msg.type);
});

ws.on("close", () => {
  console.log("RESULT:", seen.join(","));
  process.exit(seen.includes("opened") && seen.includes("answer") && seen.includes("watcher_armed") ? 0 : 1);
});

setTimeout(() => {
  console.log("RESULT: timeout");
  process.exit(2);
}, 5000);
