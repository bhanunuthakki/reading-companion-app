# DEFINITIONS — Reading Companion

**Scope:** project
**Owner:** reading-companion-app
**Inherits:** the runtime's global `DEFINITIONS.md`, when configured.

Canonical domain vocabulary. Use these terms **verbatim** in code (variables, types, functions, fields), comments, commits, and conversation. Do not coin synonyms; add a term here before using it.

## Content & sessions

- **Content** — a single consumable work the user engages with. Exactly one **ContentKind**.
- **ContentKind** — the enum of what is being consumed: `book` (physical), `kindle` (e-reader screen), `audiobook`, `podcast`. `book` and `kindle` are **visual** kinds (image pipeline applies); `audiobook` and `podcast` are **audio** kinds (rolling buffer applies). Both kinds get a dossier.
- **ContentRef** — the minimal identity of a Content: `{ kind, title, author?, isbn?, feedUrl?, episodeGuid? }`. Output of resolution, key for dossier lookup and session continuity across devices/days.
- **Session** — one persistent, resumable engagement with one Content. Holds the cursor, turn history, dossier reference, and active watchers. Identified by the ContentRef. Survives glances, days, and devices.
- **SessionState** — the session's mode: `idle | reading | listening | paused_q | ended`. `reading` is for visual kinds; `listening` for audio kinds; `paused_q` is the interrupt state during a question.
- **Cursor** — the user's position in the Content. **Polymorphic**: `PageCursor { pageId, paragraphIdx, charOffset }` for visual kinds; `TimeCursor { offsetSeconds }` for audio kinds. Resume restores the Cursor.
- **Turn** — one entry in the session's conversation history: a user query and the companion's answer (+ citations). Ordered, timestamped.

## Image pipeline (visual kinds)

- **Frame** — one captured camera image from the glasses (or phone) of the Content surface.
- **PageChange** — a detected transition from one stable page to a new stable page, derived locally (no model call) from Frames.
- **dHash** — the perceptual difference-hash of a downsampled grayscale Frame; Hamming distance between consecutive dHashes drives PageChange detection.
- **Sharpness** — variance-of-Laplacian of a Frame; a Frame below the sharpness threshold is motion-blurred and rejected (no OCR).
- **OCR** — extraction of readable text from a Frame via the vision model, returning a **PageText**.
- **PageText** — structured OCR output: `{ pageIdHint?, pageNumber?, paragraphs: Paragraph[], confidence }`. A **Paragraph** is `{ text, isHeading, isDialogue }`.
- **EscalationLevel** — the camera/mic duty level that trades battery for responsiveness: `idle` (mic only, video off) → `alerted` (single still on trigger → OCR) → `active` (audio out + low-fps video for visual cues). Decays back down on silence.

## Content dossier (all kinds — the audio middle-ground)

- **ContentResolver** — identifies a ContentRef from available cues (cover/title-page OCR, ISBN, RSS/app metadata, or an explicit user statement).
- **ContentEnricher** — builds the dossier by fanning out to enrichment sources for a resolved ContentRef.
- **ContentDossier** — the cached per-Content knowledge base: `{ ref, summary, themes[], reviews[], chapters[], transcriptUrl?, sources[] }`. Reasoned over at question time; not a live transcript.
- **EnrichmentSource** — one external provider feeding the dossier (Open Library / Google Books, Podcast Index / iTunes, web search, Semantic Scholar). Each implements a uniform fetch interface.
- **RollingBuffer** — the last N seconds of mic audio retained for on-demand transcription of "what they just said" (audio kinds). Distinct from the dossier.

## Voice

- **VoiceSession** — the vendor-agnostic streaming voice interface (start, pushPageText, pushCameraFrame, pushMicAudio, onAudioOut, onUserSpeechStart, onToolCall, end). Implementations: **GeminiLiveSession** (default), **MockVoiceSession** (offline/testing), **OpenAIRealtimeSession** (documented alternative).
- **Bargein** — the user speaking while the companion is talking; the VoiceSession must stop output immediately and transition the SessionState to `paused_q`.

## Research & watchers

- **ResearchDispatcher** — runs a research query (page/passage + question) against the model with grounded search + scholar tools, returning an **Answer**.
- **Answer** — `{ text, citations: Citation[] }`. **Citation** is `{ title, url }`. The `text` is spoken verbatim by TTS — plain prose, no markdown.
- **Tool** — a function the voice model can call mid-session: `define | summarize_so_far | translate | bookmark | lookup_context | watch`.
- **Watcher** — a standing instruction to alert the user when a topic recurs later in the Content (e.g. "tell me when she revisits the spotlight effect"). Persists across captures within a Session and fires from the **WatcherEngine** on new PageText or dossier transcript matches.

## Threads, jobs & delivery

- **Thread** — a persistent line of inquiry, keyed by topic, not by Content. Holds ordered Turns, ResearchJobs, Digests, and Watchers. A Session (content engagement) may link to Threads and vice versa; neither owns the other. Threads survive across days, devices, and Contents.
- **Capture** — one contextual grab: `{ source: glassesCamera | phoneCamera, kind: CaptureKind, frame?, extract, ts, threadId? }`. Generalizes Frame + PageText.
- **CaptureKind** — `page | document | whiteboard | screen | scene | object`. Classified by the vision model in the same call as extraction; `page` routes through the existing ImagePipeline unchanged.
- **ResearchJob** — a background unit of work: `{ id, threadId, question, captures[], state: JobState, budget: { maxTokens, maxSeconds }, digest? }`.
- **JobState** — `queued | running | digest_ready | delivered | archived | failed`. Every transition persists and is visible on the phone.
- **Digest** — the deliverable of a ResearchJob: `{ tldr, body, citations: Citation[], confidence, followups[] }`. `tldr` is ≤2 spoken-prose sentences (TTS-safe, no markdown, mirrors the existing Answer.text rule); `body` renders only on the phone.
- **InterruptLevel** — how a Digest or Watcher fire may reach the user: `hold` (phone only) < `badge` (silent display chip) < `earcon` (soft tone + badge) < `speak` (TLDR in ear). Ordered; the DeliveryEngine may only round *down*.
- **DeliveryPolicy** — per-thread + global rules mapping events to InterruptLevels, including do-not-disturb windows and the conversation-suppression rule (thought-partner-spec.md §7).
- **DeliveryEngine** — the Core module that applies DeliveryPolicy to `digest_ready` and Watcher events, chooses the surface (glasses vs phone) from wear-state and connectivity, and expires undelivered items to the phone.
- **WorkQueue** — the Core's job scheduler: concurrency cap (v1: 2), per-job budgets, cancellation, progress events over WS.
- **MemoryIndex** — cross-thread embedding index over Digests, Captures, and Turns. Answers "what did I find out about X in March?" and lets triage attach the active Thread automatically.

## Platform

- **Core** — the shared TypeScript service (`reading-companion-core`) that runs on the companion phone (or dev box) and holds all of the above.
- **Client** — a per-platform thin app that captures sensors and renders results, talking to the Core over WS/REST. The two clients: **meta-rbd** (Meta Ray-Ban Display: DAT-Android + web-app) and **android-xr** (Google: Glimmer + Projected).
- **Companion phone** — the paired phone that runs the Core and the Client; the glasses are an I/O peripheral on both platforms.
