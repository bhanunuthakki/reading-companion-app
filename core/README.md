# Reading Companion — Core

The shared brain of the Reading Companion / background thought partner. It runs on the **companion phone** (or a dev box / VPS) and both glasses clients — **Meta Ray-Ban Display** (`../clients/meta-rbd`) and **Google Android XR** (`../clients/android-xr`) — are thin clients of it over WebSocket/REST. See [`../cross-platform-build-plan.md`](../cross-platform-build-plan.md) and [`../thought-partner-spec.md`](../thought-partner-spec.md) for the why.

Written in strict TypeScript, Zod-validated throughout, test-first. **Runs and tests green with no API key** (mock voice + mock research + no-key enrichment sources + offline capture/triage); a `GEMINI_API_KEY` upgrades OCR, research, capture extraction, triage, enrichment, and streaming voice.

## What's inside

```
src/
  types.ts              Zod schemas: ContentRef, PageText, Cursor, Session, Watcher, ContentDossier,
                        Thread, Capture, ResearchJob, Digest, InterruptLevel, DeliveryPolicy…
  sessionStore.ts       SessionStore + FileSessionStore (durable) + InMemorySessionStore
  sessionManager.ts     state machine + cursor + persistence (the persistent-session runtime)
  watcherEngine.ts      standing-watcher recurrence matching
  docStore.ts           generic one-JSON-file-per-document store (internal plumbing)
  threadStore.ts        ThreadStore + FileThreadStore (THREAD_DIR) + InMemoryThreadStore
  jobStore.ts           JobStore + FileJobStore (JOB_DIR) + InMemoryJobStore — ResearchJob docs
  capture.ts            CaptureExtractor seam (offline marker | Gemini vision) + CaptureStore (CAPTURE_DIR)
  workQueue.ts          WorkQueue: job state machine, concurrency cap 2, budgets, cancel, recover
  triage.ts             TriageProvider seam: deterministic heuristic | Gemini structured output
  deliveryEngine.ts     the etiquette ladder (spec §7): decide(), DND windows, badge expiry
  memoryIndex.ts        MemoryIndex seam + LexicalMemoryIndex (TF-IDF cosine, offline)
  imagePipeline/
    pageChangeDetector.ts  dHash + variance-of-Laplacian + stability/debounce (pure)
    captureOrchestrator.ts escalation ladder IDLE→ALERTED→ACTIVE (battery)
    ocr.ts                 Gemini Flash structured OCR → PageText
  content/
    resolver.ts          ContentResolver + ResolutionHints + ContentCatalog
    enricher.ts          ContentEnricher → ContentDossier (the audio middle-ground)
    sources/             Open Library, iTunes (no key), Gemini grounded reception (key)
  voice/
    voiceSession.ts      the vendor-neutral VoiceSession seam
    geminiLive.ts        Gemini Live streaming (barge-in, video-in, tools)
    mock.ts              offline, scriptable MockVoiceSession
    openaiRealtime.ts    documented second implementation (stub)
  research/
    dispatcher.ts        ResearchProvider (fast Answer) + DigestResearchProvider (background Digest)
    tools.ts             tool specs + ToolDispatcher + system prompt
  connection.ts          SessionConnection — transport-agnostic per-client orchestration (WS v1 + v2)
  server.ts              Express (REST) + ws (live session) adapter
  redact.ts              secret redactor for logs/error strings
test/                    vitest — 145 tests, all offline
```

## Run

```bash
cd core
npm install
cp .env.example .env        # optional: add GEMINI_API_KEY to enable real model paths
npm test                    # 145 tests, no key required
npm run typecheck
npm start                   # http://localhost:4000  (ws: /ws; /app = phone web client, ../clients/web)
node scripts/wsSmoke.mjs    # offline open→say→watch→end round-trip (v1)
node scripts/wsSmokeV2.mjs  # offline wear→capture→ask→job→deliver round-trip (v2)
```

## Persistence (file-based, no database)

| What | Where (env var) | Default | Notes |
|---|---|---|---|
| Sessions | `SESSION_DIR` | `core/.sessions/` | one JSON per Content |
| Threads | `THREAD_DIR` | `core/.threads/` | one JSON per Thread |
| ResearchJobs | `JOB_DIR` | `core/.jobs/` | **jobs live in their own JobStore**, one JSON per job, rewritten on every state transition; a Thread references them via `jobIds`/`digestIds` |
| Captures | `CAPTURE_DIR` | `core/.captures/` | extract only — image bytes are never persisted (spec §9) |

A **Digest is stored on the ResearchJob that produced it**; `Thread.digestIds` lists the jobIds whose digest is ready. The MemoryIndex is in-memory and reseeded from these stores at boot. On boot the WorkQueue also recovers: persisted `queued` jobs re-enter the queue, jobs caught `running` become `failed` ("interrupted by Core restart").

## REST

| Method | Path | Body / query | Returns |
|--------|------|------|---------|
| GET | `/api/health` | — | `{ ok, voiceProvider, hasGeminiKey, model }` |
| GET | `/api/sessions` | — | session summaries, newest first |
| POST | `/api/resolve` | `{ hints: ResolutionHints }` | canonical `ContentRef` |
| POST | `/api/research` | `{ question, pageText? }` | `Answer { text, citations }` |
| POST | `/api/ocr` | `{ imageBase64 }` | `PageText` (503 without a key) |
| GET | `/api/threads` | — | `ThreadSummary[]` newest first: `{ id, topic, updatedAt, turnCount, jobCount, digestCount, deliveryCeiling }` |
| GET | `/api/threads/:id` | — | `{ thread: Thread, jobs: ResearchJob[] }` — turns in `thread.turns`, digests in `jobs[].digest` (404 if unknown) |
| PATCH | `/api/threads/:id` | `{ deliveryCeiling: "hold"\|"badge"\|"earcon"\|"speak" }` | the updated `Thread` (404 if unknown) |
| GET | `/api/memory/search` | `?q=<text>&k=<1..50, default 8>` | `{ hits: [{ threadId, kind: "digest"\|"turn"\|"capture", snippet, score }] }` |

Errors: Zod validation failures → 400 `{ error }`; everything else → 500 `{ error }` (secret-redacted).

## WebSocket `/ws`

One socket per client. **v1 (reading session)** — unchanged:

```jsonc
{ "type": "open",  "ref": { "kind": "book", "title": "…" }, "deviceId": "phone" }
{ "type": "say",   "question": "what does the literature say about this?" }   // typed (client STT)
{ "type": "page",  "imageBase64": "…" }   // a captured page → OCR → cursor
{ "type": "mic",   "pcmBase64": "…" }     // stream audio to the live voice model
{ "type": "frame", "jpegBase64": "…" }    // stream a camera frame to the live voice model
{ "type": "watch", "topic": "the spotlight effect" }
{ "type": "end" }
```

Server → client (v1): `opened` · `audio` · `transcript` · `answer` · `page_observed` · `watcher_armed` · `error`.

**v2 (thought partner)** — no `open` required; works with or without a live reading session:

Client → Core:

```jsonc
{ "type": "ask",     "question": "…", "captureId": "…?", "threadId": "…?" }
{ "type": "capture", "imageBase64": "…", "hintKind": "page|document|whiteboard|screen|scene|object?", "threadId": "…?" }
{ "type": "job_cancel", "jobId": "…" }
{ "type": "wear",    "worn": true }
```

Core → client:

```jsonc
{ "type": "ask_routed",     "route": "fast" | "background", "threadId": "…",
  "answer": { "text": "…", "citations": [] },   // fast route only — speak it now
  "jobId": "…" }                                 // background route only
{ "type": "capture_stored", "captureId": "…", "kind": "whiteboard" }
{ "type": "job_update",     "jobId": "…", "state": "queued|running|digest_ready|delivered|archived|failed" }
{ "type": "deliver",        "level": "hold|badge|earcon|speak", "surface": "glasses|phone",
  "jobId": "…", "tldr": "…", "badge": "…" }      // badge is the tldr clipped to ≤140 chars
```

Behavioral contract (what a client must know):

- `ask` without `threadId` **auto-creates a Thread** (topic = the question, clipped to 80 chars) — spec §12 Q2 default. Unknown `threadId`/`captureId` → `error`.
- The `job_update` for `"queued"` is emitted during submission and arrives **before** `ask_routed`; correlate via the `jobId` in `ask_routed`.
- `deliver` fires when a job reaches `digest_ready`, after the DeliveryEngine applies the etiquette rules (spec §7): not-worn → `hold`/`phone`; conversation in the last 15 s caps at `earcon`; default completion is `badge` (display) / `earcon` (audio-only, `DEVICE_HAS_DISPLAY=false`); a question containing "tell me when you're back" / "let me know when…" upgrades that job to `speak`; DND windows and digest confidence < 0.4 round down one level; the per-thread `deliveryCeiling` clamps everything.
- After a `deliver` above `hold` the job transitions to `delivered` (another `job_update`). A `hold` deliver leaves the job `digest_ready` — the digest waits in its Thread on the phone.
- **Wear state defaults to not-worn.** Send `{ "type": "wear", "worn": true }` when glasses go on-face or every delivery will hold to the phone (rule 2).
- `capture` replies `capture_stored`; the image is discarded after extraction. Offline the extract is the literal marker `"[extraction unavailable offline — set GEMINI_API_KEY]"` — render it as "extraction unavailable", never as content.
- `job_cancel` is valid for `queued`/`running` jobs and yields `job_update "archived"`; anything else → `error`.

## Real vs mock

| Capability | No key | With `GEMINI_API_KEY` |
|---|---|---|
| Voice | `MockVoiceSession` | `GeminiLiveSession` (set `VOICE_PROVIDER=gemini`) |
| Research / "say" / fast ask | canned answer | grounded Google Search |
| Background digest | canned Digest (3 mock citations) after `MOCK_DIGEST_DELAY_MS` (default 2500, 0 in tests) | grounded search → tldr/body/followups + real citations, token spend recorded |
| Triage | deterministic heuristic (markers: literature, research, evidence, compare, sources, find papers, studies, survey, meta-analysis; or length > 140 chars → background) | Gemini structured-output router |
| Capture extraction | hinted (or `scene`) kind + offline marker — never fabricated | one structured vision call (classify + extract); kind `page` routes through the existing PageText OCR |
| OCR / "page" | 503 | Gemini Flash structured OCR |
| Enrichment | Open Library + iTunes (no key, real) | + Gemini grounded reception |
| DeliveryEngine / MemoryIndex / WorkQueue | fully offline (pure logic / TF-IDF / in-process queue) | same — no model involved |

Verified live: both WS loops run end-to-end offline (`wsSmoke.mjs` and `wsSmokeV2.mjs` green), and `/api/resolve` returns canonical Open Library data (e.g. *Dune* → ISBN `057501864X`) with no key.
