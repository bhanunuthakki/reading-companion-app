# Cross-Platform Build Plan — Reading Companion on Meta Ray-Ban Display + Google Android XR

_Authored 2026-06-04. Supersedes the single-device v0 plan in [staged-roadmap.md](staged-roadmap.md) for the **two-platform, display-bearing** target. The Stage-0 Gen-1 RBM audio-only plan still stands as the cheapest proof; this document is the architecture for the version that runs on **both** Meta Ray-Ban Display and Google's intelligent eyewear / Android XR._

## 1. What we are building

The **Reading Companion** is an _ambient research partner_ for serious consumers of long-form content. You read a book, read on a Kindle, listen to an audiobook, or listen to a podcast. You tap your temple (or pinch the Neural Band) and ask about what you're consuming. The companion captures the context — the page you're looking at, or the passage you just heard — dispatches research to academic and web sources, and answers in your ear while you keep going. It never breaks your flow, and it remembers: a session is **persistent and resumable** across glances, across days, and across devices.

This plan covers the version supported on **two display-bearing glasses platforms simultaneously**:

| | Meta Ray-Ban Display | Google Android XR (intelligent eyewear) |
|---|---|---|
| Display | 600×600, monocular, 20° FoV, additive | In-lens additive display (later category; audio glasses first) |
| Primary input | Neural Band (sEMG) → D-pad + pinch | Gaze/touch + "Hey Google" + temple-tap |
| Glasses SDK | Wearables Device Access Toolkit (DAT) + Web Apps | Jetpack XR — Glimmer (UI) + Projected (runtime) |
| Camera to app | DAT-Android (Kotlin), 720p/30 over BLE; **web-app path has no camera** | Projected context (Kotlin), Camera2-class frames |
| Realtime model | Bring-your-own (Meta AI is reserved) | Gemini Live native, also bring-your-own |
| App runtime | On the **paired phone**; glasses are a peripheral | Activity on the **paired phone** (Projected); glasses render/input |

**The single most important architectural consequence:** on _both_ platforms the app runs on the **companion phone** and the glasses are an I/O surface (camera in, audio in/out, gesture in, glanceable display out). The Meta Web Apps sandbox — the only way to draw on the Ray-Ban Display directly — **cannot access the camera**, and both Meta DAT and Android XR camera access are native-Kotlin-only. Therefore:

> The image pipeline, content enrichment, voice session, research, and session state all live in **one shared core that runs on the phone**. Each glasses platform gets a **thin client** that captures sensors and renders results. We build the core once and port the I/O shells.

## 2. Documentation reviewed (and what each settled)

From the companion XR dev guide ([`../xr-glasses-dev-guide/`](../xr-glasses-dev-guide/)):

- **[03-meta-glasses.md](../xr-glasses-dev-guide/03-meta-glasses.md)** — DAT has three surfaces (iOS/Android native, Web Apps). Web Apps is the only path that renders on the Display, is Windows-friendly, but exposes **no camera**. DAT camera = stills + 720p/30 BLE video, phone-side processing only. Meta AI multimodal and "Hey Meta" are reserved → **we ship our own model pipeline.** 100-tester cap during preview.
- **[02-android-xr.md](../xr-glasses-dev-guide/02-android-xr.md)** — `xr-glimmer` (Compose UI for additive displays) + `xr-projected` (activity on phone, render/input on glasses). Camera via projected context. **Gemini Live is the conversational backbone** for AI glasses. Sample to mirror: `android/ai-samples` `prototype-ai-glasses`.
- **[04-cameras.md](../xr-glasses-dev-guide/04-cameras.md)** — concrete "look at object, get info" loops per platform; confirms the phone-side inference model for both targets and the BLE 720p cap on Meta.
- **[05-audio.md](../xr-glasses-dev-guide/05-audio.md)** — open-ear speakers, 5–6 mic beamforming, wake-word reservations ("Hey Meta"/"Hey Google" both taken → we use temple-tap / pinch / push-to-talk to open our own capture). Mic capture is cheap; **BLE video is the battery sink.**
- **[10-design-patterns.md](../xr-glasses-dev-guide/10-design-patterns.md)** — glances not sessions; D-pad + Enter is the whole vocabulary; additive dark UI; glasses↔phone hand-off table. Governs both display UIs.
- **[12-io-2026-updates.md](../xr-glasses-dev-guide/12-io-2026-updates.md)** — Android XR **DP4**, core libs Beta-bound; **Catalyst Program (apply by June 30 2026)** for pre-release eyewear + grants; **Gemini 3.5 Flash** (4× faster, <50% cost) is the default heavy-lift model; audio glasses ship fall 2026, display glasses later.

External SDK/API docs that anchor the code:

- Gemini Live API — <https://ai.google.dev/gemini-api/docs/live>
- Gemini structured output — <https://ai.google.dev/gemini-api/docs/structured-output>
- OpenAI Realtime API — <https://platform.openai.com/docs/guides/realtime>
- Meta Wearables DAT (Android) — <https://github.com/facebook/meta-wearables-dat-android>; Web Apps — <https://wearables.developer.meta.com/docs/develop/webapps>
- Jetpack XR — <https://developer.android.com/develop/xr/jetpack-xr-sdk>; Glimmer — <https://developer.android.com/develop/xr/jetpack-xr-sdk/jetpack-compose-glimmer>
- Open Library — <https://openlibrary.org/developers/api>; Google Books — <https://developers.google.com/books>; Podcast Index — <https://podcastindex-org.github.io/docs-api/>; Semantic Scholar — <https://api.semanticscholar.org/>

## 3. Architecture

```
                         ┌─────────────────────────────────────────────────────────────┐
                         │            SHARED CORE  (reading-companion-core, TS/Node)     │
                         │            runs on the paired phone (or a dev box / VPS)      │
   ┌──────────┐  WS/REST │                                                               │   external
   │  META    │◄────────►│  SessionManager ── SessionStore (durable, sync-ready)         │   APIs
   │  client  │          │       │                                                       │ ◄──────────►
   │ DAT-Andrd│          │       ├── ImagePipeline   (page-change detect → OCR)          │  Gemini Flash
   │  + WebApp│          │       ├── ContentResolver + ContentEnricher → ContentDossier  │  Gemini Live
   └──────────┘          │       ├── VoiceSession    (Gemini Live | mock | OpenAI RT)    │  Google Search
                         │       ├── ResearchDispatcher + Tools                          │  Open Library
   ┌──────────┐  WS/REST │       └── WatcherEngine                                       │  Podcast Index
   │ GOOGLE   │◄────────►│                                                               │  Semantic Scholar
   │  client  │          │  HTTP (/api/*)  +  WebSocket (/ws session channel)            │
   │ XR Glimmer│         │                                                               │
   │+Projected│          └─────────────────────────────────────────────────────────────┘
   └──────────┘
```

### 3.1 Shared core (the real build — TypeScript, runs today on Windows)

A typed, tested Node package. Why TS and not Kotlin for the core: it (a) reuses the existing `v0-web` prototype, (b) runs and is fully testable on Windows today with no devices, (c) keeps one source of truth that both native clients call over a stable WS/REST contract rather than duplicating logic in Kotlin. The hot audio path can later hold a direct device→Gemini-Live socket for latency while still syncing session state through the core (documented, not built in this pass).

Modules:

- **`types.ts`** — Zod schemas + inferred types for every structured payload. No `any`.
- **`SessionStore`** — interface + durable file-backed implementation. Per-title session documents with `updatedAt`/`deviceId` so the same store satisfies _glances_ (in-memory hot path), _days-later_ (durable read), and _across-devices_ (both devices hit the same core; documents are sync-friendly for a later cloud adapter).
- **`SessionManager`** — the state machine (`IDLE → READING/LISTENING → PAUSED_Q`), the cursor, and the escalation ladder (`IDLE/ALERTED/ACTIVE`) that gates camera duty for battery.
- **`ImagePipeline`** — `PageChangeDetector` (pure dHash + variance-of-Laplacian over grayscale arrays) + `ocrPage` (Gemini Flash, structured output: paragraphs, headings, dialogue). Visual content only (book/Kindle).
- **`ContentResolver` + `ContentEnricher` → `ContentDossier`** — the audio middle-ground (see §4). Audio _and_ visual content both get a dossier.
- **`VoiceSession`** — streaming abstraction; `GeminiLiveSession`, `MockVoiceSession` (offline), `OpenAIRealtimeSession` (documented). Factory by env; runs with no key via the mock.
- **`ResearchDispatcher` + tools** — `define / summarize_so_far / translate / bookmark / lookup_context / watch`; research agent over grounded search + Semantic Scholar.
- **`WatcherEngine`** — standing watchers fire against new OCR pages and (where available) dossier transcripts.
- **`server.ts`** — Express `/api/*` + a `/ws` per-session channel.

### 3.2 Meta Ray-Ban Display client (`clients/meta-rbd/`)

Two cooperating pieces, because Meta splits camera and display across two surfaces:

- **`dat-android/`** — Kotlin DAT-Android app on the phone. Owns: camera stills/720p capture, 5-mic audio in, open-ear audio out, Neural Band **cooked gestures** (pinch=Enter, swipe=arrows, long-press=push-to-talk). Streams frames/audio to the core over WS; plays the core's audio responses. Manifest declares `mwdat.APPLICATION_ID` + permissions; `mwdat-mockdevice` lets it run without glasses.
- **`web-app/`** — the 600×600 additive display UI (HTML/CSS/JS, dark, focusable, D-pad-operable per [10-design-patterns.md](../xr-glasses-dev-guide/10-design-patterns.md)). Renders glanceable citation cards / watcher badges / session status from the core. No camera (by platform constraint).

### 3.3 Google Android XR client (`clients/android-xr/`)

One Kotlin/Compose app using **Glimmer** (UI: `Card`, `TitleChip`, `List`, focus outlines — citation cards, watcher chips) + **Projected** (activity on phone, render/input on glasses; `onResume/onPause` fire on wear via the DP4 Device Availability API). Camera via **projected context**. Audio via `RECORD_AUDIO` + open-ear out. Talks to the core over WS; may later hold a native Gemini Live socket. Manifest: XR start mode, `enableOnBackInvokedCallback`, `CAMERA`/`RECORD_AUDIO`. Mirrors the `prototype-ai-glasses` sample's shape.

### 3.4 What is shared vs platform-specific

| Concern | Where it lives |
|---|---|
| Session model, cursor, persistence, watchers | **Shared core** |
| Image pipeline (page-change detect, OCR), content dossier | **Shared core** |
| Voice session orchestration, research, tools | **Shared core** |
| WS/REST contract | **Shared core** (clients consume) |
| Camera/mic/speaker capture + routing | Per-client (Kotlin) |
| Gesture → command mapping | Per-client (Neural Band vs gaze/tap) |
| Glanceable display rendering | Per-client (Meta web-app 600×600 vs Glimmer Compose) |

## 4. The content dossier — the audio middle-ground

Podcasts and audiobooks have no page to capture, and transcribing everything live is expensive, battery-hungry, and a privacy surface. The chosen middle ground: when a session **attaches** to a recognizable title/episode, the core runs a one-time **resolve → enrich** pass and caches a `ContentDossier` — a structured knowledge base _about_ the content, not a live transcript of it.

```
attach(session) ─► ContentResolver: identify the title/episode
                     • book/Kindle: OCR cover/title page, ISBN, or user statement
                     • audiobook:    app metadata (e.g. Audible), user statement
                     • podcast:      RSS/app metadata, user statement
                        │ ContentRef { kind, title, author?, isbn?, feedUrl?, episodeGuid? }
                        ▼
                   ContentEnricher: fan out to sources, build the dossier
                     • metadata     (Open Library / Google Books / Podcast Index)
                     • reviews + reception (web search, grounded)
                     • show notes / chapter list / description
                     • published transcript IF available (podcast/show site)
                     • author + key-works context (LLM + scholar)
                        │ ContentDossier { ref, summary, themes, reviews[],
                        ▼                    chapters[], transcriptUrl?, sources[] }
                   cache on the session (durable)
```

At question time the companion reasons over **three context layers**, cheapest first:
1. **Rolling buffer** — the last N seconds of mic audio, transcribed on demand → "what did they _just_ say about X?"
2. **ContentDossier** — the pre-fetched knowledge base → "what's this episode about / its reception / the claim being made."
3. **Live research** — grounded web + Semantic Scholar dispatch → "what does the literature say about that claim?"

This gives audio sessions genuine recall and depth without always-on transcription. For visual content (book/Kindle), layer 1 is the current OCR'd page instead of an audio buffer; layers 2 and 3 are identical. One model, four content types.

## 5. The three build pillars (what you asked me to build)

### 5.1 Image processing pipeline
`PageChangeDetector` (pure, TDD: dHash Hamming distance + variance-of-Laplacian sharpness gate + debounce) → `CaptureOrchestrator` (escalation ladder, capture-on-trigger to protect battery) → `ocrPage` (Gemini Flash, Zod-validated structured output marking headings/dialogue). Cheap local detection decides _when_ to spend an OCR call; OCR feeds the session cursor and watchers.

### 5.2 Connection to the voice audio model
`VoiceSession` interface → `GeminiLiveSession` (streaming, barge-in/interrupt, audio+text out, video-in for visual cues, tool-call passthrough) + `MockVoiceSession` (deterministic offline, so the whole system runs and tests green with no API key) + `OpenAIRealtimeSession` (documented second impl). Default = Gemini Live per the latency/multimodal analysis in [architecture.md](architecture.md).

### 5.3 Persistent-sessions UX
Designed in [persistent-sessions-ux.md](persistent-sessions-ux.md), implemented by `SessionManager` + `SessionStore`. Unified, content-type-polymorphic session: a `Cursor` is a page locator for visual content and a timestamp locator for audio. Resume restores cursor + history + dossier + active watchers. Scope locked via grilling: **glances, days-later-same-title, across-devices**; cross-title linkage is modeled-for but deferred.

## 6. Build sequence

1. Plan + `DEFINITIONS.md` _(this step)_.
2. Core: schemas + `SessionStore` (TDD).
3. Image pipeline: `PageChangeDetector` (TDD) + OCR + orchestrator.
4. Content resolution + enrichment → `ContentDossier` (TDD, mocked sources).
5. Voice: `VoiceSession` + `GeminiLiveSession` + `MockVoiceSession` (TDD).
6. Research dispatcher + tools + `server.ts` (HTTP/WS).
7. Scaffold Meta client (DAT-Android + web-app).
8. Scaffold Android XR client (Glimmer + Projected).
9. `persistent-sessions-ux.md` + summary.

## 7. Engineering standards (per GEMINI.md)

Strict TypeScript; Zod schemas for all structured data; TDD for new behavior (red→green→refactor) on core logic; deep modules (no shallow pass-throughs, no `*Manager` namespaces-of-free-functions); fail loudly, no silent fallbacks; imports at top; domain terms from `DEFINITIONS.md` used verbatim in code. Native scaffolds are honest skeletons (real project structure + manifests + documented integration seams against the actual SDKs), not compiling apps — they need devices/emulators the dev box doesn't have.

## 8. Explicitly out of scope for this pass

Cross-title (cross-book) reasoning; on-device offline OCR/TTS; spatial anchoring of marginalia; Neural Handwriting input; production publishing (both platforms are preview/100-tester-capped); real cloud sync backend (the store is _designed_ sync-ready, a local durable impl ships now). These map to Stage 1.5–3 in [staged-roadmap.md](staged-roadmap.md).
