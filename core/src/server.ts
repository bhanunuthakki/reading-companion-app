/**
 * The Core server: REST for setup/one-shot calls + a WebSocket per live session.
 *
 * Runs with NO keys (mock voice + mock research + stub enrichment) so you can
 * `npm start` and exercise the loop today; a GEMINI_API_KEY upgrades OCR,
 * research, enrichment, and (with VOICE_PROVIDER=gemini) the streaming voice.
 * Both glasses clients (Meta DAT-Android, Android XR) connect here.
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import express from "express";
import dotenv from "dotenv";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import { FileSessionStore } from "./sessionStore";
import { ContentResolver, ResolutionHints } from "./content/resolver";
import { ContentEnricher } from "./content/enricher";
import { defaultEnrichmentSources, defaultCatalog } from "./content/index";
import { GeminiOcrClient, type OcrClient } from "./imagePipeline/ocr";
import { GeminiResearchProvider, MockResearchProvider } from "./research/dispatcher";
import { createVoiceSession, type VoiceProvider } from "./voice/index";
import { SessionConnection, type ServerMessage, type ThoughtPartnerDeps } from "./connection";
import { FileThreadStore } from "./threadStore";
import { FileJobStore } from "./jobStore";
import { FileCaptureStore, GeminiCaptureExtractor, OfflineCaptureExtractor } from "./capture";
import { WorkQueue } from "./workQueue";
import { GeminiTriageProvider, HeuristicTriageProvider } from "./triage";
import { DeliveryEngine } from "./deliveryEngine";
import { LexicalMemoryIndex, seedMemoryIndex } from "./memoryIndex";
import { InterruptLevel } from "./types";
import { redactSecrets } from "./redact";

dotenv.config();

const PORT = Number(process.env.PORT ?? 4000);
const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const geminiLiveModel = process.env.GEMINI_LIVE_MODEL ?? "gemini-2.5-flash-live";
const voiceProvider = z.enum(["mock", "gemini", "openai"]).catch("mock").parse(process.env.VOICE_PROVIDER);
const sessionDir = process.env.SESSION_DIR ?? ".sessions";
const threadDir = process.env.THREAD_DIR ?? ".threads";
const jobDir = process.env.JOB_DIR ?? ".jobs";
const captureDir = process.env.CAPTURE_DIR ?? ".captures";
/** Mock digests take a beat so background work FEELS like background work in demos. */
const mockDigestDelayMs = Number(process.env.MOCK_DIGEST_DELAY_MS ?? 2500);

const store = new FileSessionStore(sessionDir);
const resolver = new ContentResolver(defaultCatalog());
const enricher = new ContentEnricher(
  defaultEnrichmentSources({ ...(geminiApiKey ? { geminiApiKey } : {}), geminiModel }),
);
const research = geminiApiKey
  ? new GeminiResearchProvider(geminiApiKey, geminiModel)
  : new MockResearchProvider({ digestDelayMs: mockDigestDelayMs });
const ocr: OcrClient | undefined = geminiApiKey ? new GeminiOcrClient(geminiApiKey, geminiModel) : undefined;

// ── Thought partner (Core v2) ───────────────────────────────────────────────

const threads = new FileThreadStore(threadDir);
const jobs = new FileJobStore(jobDir);
const captures = new FileCaptureStore(captureDir);
const memory = new LexicalMemoryIndex();
const workQueue = new WorkQueue({ jobs, provider: research, concurrency: 2 });
const thoughtPartner: ThoughtPartnerDeps = {
  threads,
  captures,
  workQueue,
  triage: geminiApiKey ? new GeminiTriageProvider(geminiApiKey, geminiModel) : new HeuristicTriageProvider(),
  deliveryEngine: new DeliveryEngine(),
  captureExtractor: geminiApiKey
    ? new GeminiCaptureExtractor(geminiApiKey, geminiModel)
    : new OfflineCaptureExtractor(),
  memory,
  dndWindows: [],
  suppressWhileConversing: true,
  deviceHasDisplay: (process.env.DEVICE_HAS_DISPLAY ?? "true") !== "false",
  captureSource: "phoneCamera",
};

// Boot recovery is deliberately loud: a corrupt document should stop the server, not be skipped.
await workQueue.recover();
await seedMemoryIndex(memory, { threads, jobs, captures });

function makeVoice(): ReturnType<typeof createVoiceSession> {
  return createVoiceSession({
    provider: voiceProvider as VoiceProvider,
    ...(geminiApiKey ? { geminiApiKey } : {}),
    geminiLiveModel,
    ...(process.env.OPENAI_API_KEY ? { openaiApiKey: process.env.OPENAI_API_KEY } : {}),
    ...(process.env.OPENAI_REALTIME_MODEL ? { openaiModel: process.env.OPENAI_REALTIME_MODEL } : {}),
  });
}

const app = express();
app.use(express.json({ limit: "12mb" }));
// The MVP phone web client (../clients/web, static, no build step) → /app
app.use("/app", express.static(fileURLToPath(new URL("../../clients/web", import.meta.url))));
// The Ray-Ban Display 600×600 glasses surface (browser preview: arrow keys = Neural Band) → /glasses
app.use(
  "/glasses",
  express.static(fileURLToPath(new URL("../../clients/meta-rbd/web-app", import.meta.url))),
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, voiceProvider, hasGeminiKey: Boolean(geminiApiKey), model: geminiModel });
});

app.get("/api/sessions", async (_req, res) => {
  res.json(await store.list());
});

const ResolveBody = z.object({ hints: ResolutionHints });
app.post("/api/resolve", async (req, res) => {
  const { hints } = ResolveBody.parse(req.body);
  res.json(await resolver.resolve(hints));
});

const ResearchBody = z.object({ question: z.string().min(1), pageText: z.string().optional() });
app.post("/api/research", async (req, res) => {
  const body = ResearchBody.parse(req.body);
  res.json(await research.research(body));
});

const OcrBody = z.object({ imageBase64: z.string().min(1) });
app.post("/api/ocr", async (req, res) => {
  if (!ocr) {
    res.status(503).json({ error: "OCR unavailable: set GEMINI_API_KEY." });
    return;
  }
  const { imageBase64 } = OcrBody.parse(req.body);
  res.json(await ocr.ocrPage(imageBase64));
});

// ── REST v2: the phone's considered surface ─────────────────────────────────

app.get("/api/threads", async (_req, res) => {
  res.json(await threads.list());
});

app.get("/api/threads/:id", async (req, res) => {
  const thread = await threads.load(req.params.id);
  if (!thread) {
    res.status(404).json({ error: `No thread with id ${req.params.id}.` });
    return;
  }
  const jobDocs = await Promise.all(thread.jobIds.map((jobId) => jobs.load(jobId)));
  res.json({ thread, jobs: jobDocs.filter((job) => job !== null) });
});

const PatchThreadBody = z.object({ deliveryCeiling: InterruptLevel });
app.patch("/api/threads/:id", async (req, res) => {
  const { deliveryCeiling } = PatchThreadBody.parse(req.body);
  const thread = await threads.load(req.params.id);
  if (!thread) {
    res.status(404).json({ error: `No thread with id ${req.params.id}.` });
    return;
  }
  thread.deliveryCeiling = deliveryCeiling;
  res.json(await threads.save(thread));
});

const MemorySearchQuery = z.object({
  q: z.string().min(1),
  k: z.coerce.number().int().positive().max(50).optional(),
});
app.get("/api/memory/search", (req, res) => {
  const { q, k } = MemorySearchQuery.parse(req.query);
  res.json({ hits: memory.search(q, k ?? 8) });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof z.ZodError ? 400 : 500;
  const message = redactSecrets(err instanceof Error ? err.message : "Internal error.");
  res.status(status).json({ error: message });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (socket: WebSocket) => {
  const send = (msg: ServerMessage): void => socket.send(JSON.stringify(msg));
  const connection = new SessionConnection({
    store,
    voice: makeVoice(),
    research,
    enricher,
    send,
    thoughtPartner,
    ...(ocr ? { ocr } : {}),
  });

  socket.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      send({ type: "error", message: "Invalid JSON." });
      return;
    }
    void connection.handle(parsed).then(() => {
      if (typeof parsed === "object" && parsed !== null && "type" in parsed && parsed.type === "end") {
        socket.close();
      }
    });
  });
});

httpServer.listen(PORT, () => {
  console.log(`Reading Companion core on http://localhost:${PORT}  (ws: /ws)`);
  console.log(`Voice provider: ${voiceProvider} | Gemini key: ${geminiApiKey ? "yes" : "no"} | sessions: ${sessionDir}`);
  console.log(`Threads: ${threadDir} | jobs: ${jobDir} | captures: ${captureDir} | mock digest delay: ${mockDigestDelayMs}ms`);
});
