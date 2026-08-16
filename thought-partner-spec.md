# Background Thought & Research Partner — Cross-Platform Spec (Android XR + Meta Ray-Ban Display)

_Authored 2026-07-07. Extends [cross-platform-build-plan.md](cross-platform-build-plan.md) and the "ambient research partner" framing in [staged-roadmap.md](staged-roadmap.md). This spec generalizes the product from a **reading** companion to a **background thought and research partner**: multi-modal (phone, voice, glasses camera), silent by default, dispatching real background work and returning politely. Reading remains the flagship scenario, not the boundary._

Platform facts cite the companion guide: [02-android-xr.md](../xr-glasses-dev-guide/02-android-xr.md), [03-meta-glasses.md](../xr-glasses-dev-guide/03-meta-glasses.md), [04-cameras.md](../xr-glasses-dev-guide/04-cameras.md), [10-design-patterns.md](../xr-glasses-dev-guide/10-design-patterns.md), [12-io-2026-updates.md](../xr-glasses-dev-guide/12-io-2026-updates.md).

---

## 1. Point of departure — what the book companion already gives us

The evaluation in one table. "Carries" = reusable as-is for the thought partner; "generalize" = right idea, too reading-shaped; "missing" = new build.

| Asset | Verdict | Notes |
|---|---|---|
| Shared-core-on-phone + thin-clients architecture | **Carries** | Both platforms genuinely run apps on the paired phone (Meta DAT; Android XR Projected). Verified against the guide. This is the single most important decision already made, and it's correct. |
| `core/` implementation (72 offline tests, WS/REST, Zod, mocks) | **Carries** | SessionStore/Manager, VoiceSession seam (Gemini Live + mock), ResearchDispatcher, WatcherEngine, redact.ts. Solid foundation; extends rather than rewrites. |
| Escalation ladder (IDLE→ALERTED→ACTIVE) | **Carries** | BLE video is the battery sink on both platforms; the ladder is the enabling constraint for any all-day companion. |
| Persistent Session + polymorphic Cursor | **Generalize** | Sessions are keyed by ContentRef (a title). A thought partner also needs **Threads** — lines of inquiry not attached to any Content. Session becomes one specialization. |
| ImagePipeline (page detect → OCR → PageText) | **Generalize** | Page-shaped. Needs a **Capture** abstraction covering pages, documents, whiteboards, screens, scenes, objects. |
| ResearchDispatcher → Answer | **Generalize** | Synchronous single-shot. The wedge moment ("come back a minute later") needs a **ResearchJob** lifecycle with queued/running/digest_ready states, budgets, and polite delivery. Today the "background" in "background research" is aspirational. |
| WatcherEngine | **Generalize** | Matches topic recurrence in new PageText only. Thought-partner triggers also include new-publication alerts, time, and job completion. |
| Three-layer context (rolling buffer / dossier / live research) | **Carries** | Maps cleanly onto non-reading contexts (what I just heard / what I'm engaged with / what the world knows). |
| ContentDossier + resolver/enricher | **Carries** | Reading-specific but stays; Threads reference dossiers when their subject is a Content. |
| Cross-title memory ("second brain") | **Missing** | Deferred in every prior doc. For a *thought* partner it is the product. Promoted to a first-class module (MemoryIndex). |
| Delivery etiquette | **Missing** | Nothing decides *when and how* the partner speaks vs badges vs holds. This is the heart of "background" and is specified in §7. |
| Native clients | **Missing** | Honest skeletons only. **Zero on-glasses minutes to date** — the wedge moment has never been felt on hardware. The build plan (§10) forces a vertical slice first. |

**Overall evaluation:** the project is design-heavy and validation-light — four strong planning docs, a genuinely well-engineered core, and no end-to-end demo on any device. The domain model is one abstraction too narrow (title-keyed sessions, page-shaped captures, synchronous research) for the product the user now wants. The fix is additive, not a rewrite.

---

## 2. Product definition

**The partner is a second mind that works while yours stays on what it's doing.** You're reading, walking, cooking, standing at a whiteboard. You press the temple (or pinch the Neural Band) and say what you're wondering. The partner captures your context — the page, the whiteboard, the thing in front of you — acknowledges in under three seconds, and goes away to work. Minutes later it comes back the politest way available: a glanceable card on the display, a soft earcon, or a sentence in your ear — your choice, its judgment. Everything it finds lands in a persistent thread on your phone, cited, searchable, and connected to everything you've asked before.

**Three product principles (inherited and extended):**

1. **Never break flow.** All heavy output is asynchronous. The synchronous budget is: acknowledge + estimate ("on it — about a minute"). The device is glanceable; the *relationship* is durable (from [persistent-sessions-ux.md](persistent-sessions-ux.md)).
2. **Silent by default, proactivity by invitation.** The partner never initiates unprompted except through mechanisms the user armed: Watchers, job-completion delivery, and per-thread "keep me posted" grants. Every proactive channel has an interrupt level the user set.
3. **Glanceable on glasses, considered on phone.** Glasses get ≤5-second interactions (TLDR, chips, badges); the phone gets threads, citations, digests, settings ([10-design-patterns.md](../xr-glasses-dev-guide/10-design-patterns.md)).

**In scope (v1):** capture-and-research from glasses camera + voice; reading sessions (existing behavior, unchanged); background research jobs with polite delivery; persistent threads + cross-thread memory; phone app as the considered surface.

**Out of scope (v1):** calendar/email/task integration, meeting transcription, real-time translation, spatial anchoring, social/shared threads, offline mode. These are Stage-2 candidates and must not creep in.

---

## 3. The core loop

```
CAPTURE ──► TRIAGE ──► fast path:  ANSWER (spoken ≤5 s, from dossier/rolling buffer/model)
   │            │
   │            └────► background:  DISPATCH ResearchJob ("on it — ~1 min")
   │                        │
 context                  WORK (agents on the Core; user keeps living)
 (frame, page,              │
  location?,              DIGEST (tldr ≤2 speakable sentences + body + citations)
  active thread)            │
                          DELIVER (etiquette ladder: hold → badge → earcon → speak)
                            │
                          PERSIST (thread updated; MemoryIndex embeds digest)
```

**Triage** is a cheap model call (Gemini 3.5 Flash) that routes: answerable-now questions get a spoken Answer (existing fast path); anything needing sources, synthesis, or fan-out becomes a ResearchJob. The router must state its choice out loud ("quick answer:" vs "on it — I'll come back") so the user always knows whether to expect a return.

---

## 4. Modality matrix

| Modality | Role | Notes |
|---|---|---|
| **Voice (glasses mic)** | Primary input. All questions are spoken; no text entry on glasses. | Invocation is push-to-talk on both platforms — custom wake words are impossible ("Hey Meta" and "Hey Google" both reserved). Temple long-press (Meta DAT) / temple-tap (Android XR). |
| **Glasses camera** | Context capture at the moment of asking. One still by default; escalation ladder governs anything more. | Meta: DAT-Android stills / 720p30 BLE, native path only (web-app has **no** camera). Android XR: projected-context camera from the phone app. |
| **Glasses display** | Delivery: badges, TLDR cards, watcher chips, job status. ≤5-second interactions. | Meta RBD: 600×600, 20° FoV, additive, D-pad + Enter via Neural Band. Android XR display glasses: Glimmer (Cards, Title Chips, Stacks, Google Sans Flex). |
| **Glasses audio (open-ear)** | Acknowledgments, fast answers, spoken digests when invited. | Both platforms. On displayless devices (Gen 1/2 Ray-Ban Meta today, Google audio glasses fall 2026) this is the *only* delivery channel — the spec's audio-only degradation must be first-class, not a fallback. |
| **Phone (companion app)** | The considered surface: thread list, full digests with citations, job queue, watcher management, memory search, politeness/budget settings. Also a full capture+ask client itself (phone camera + mic) when glasses are off. | Cross-device continuity is free: both surfaces are thin clients of the same Core. |

---

## 5. Domain model — proposed DEFINITIONS.md additions

New terms (to be promoted into [DEFINITIONS.md](DEFINITIONS.md) verbatim on acceptance). Existing terms — Content, ContentRef, Session, Cursor, PageText, ContentDossier, Watcher, VoiceSession, EscalationLevel, Core, Client — are unchanged.

- **Thread** — a persistent line of inquiry, keyed by topic, not by Content. Holds ordered Turns, ResearchJobs, Digests, and Watchers. A Session (content engagement) may link to Threads and vice versa; neither owns the other. Threads survive across days, devices, and Contents.
- **Capture** — one contextual grab: `{ source: glassesCamera | phoneCamera, kind: CaptureKind, frame?, extract, ts, threadId? }`. Generalizes Frame + PageText.
- **CaptureKind** — `page | document | whiteboard | screen | scene | object`. Classified by the vision model in the same call as extraction; `page` routes through the existing ImagePipeline unchanged.
- **ResearchJob** — a background unit of work: `{ id, threadId, question, captures[], state: JobState, budget: { maxTokens, maxSeconds }, digest? }`.
- **JobState** — `queued | running | digest_ready | delivered | archived | failed`. Every transition persists and is visible on the phone.
- **Digest** — the deliverable of a ResearchJob: `{ tldr, body, citations: Citation[], confidence, followups[] }`. `tldr` is ≤2 spoken-prose sentences (TTS-safe, no markdown, mirrors the existing Answer.text rule); `body` renders only on the phone.
- **InterruptLevel** — how a Digest or Watcher fire may reach the user: `hold` (phone only) < `badge` (silent display chip) < `earcon` (soft tone + badge) < `speak` (TLDR in ear). Ordered; the DeliveryEngine may only round *down*.
- **DeliveryPolicy** — per-thread + global rules mapping events to InterruptLevels, including do-not-disturb windows and the conversation-suppression rule (§7).
- **DeliveryEngine** — the Core module that applies DeliveryPolicy to `digest_ready` and Watcher events, chooses the surface (glasses vs phone) from wear-state and connectivity, and expires undelivered items to the phone.
- **WorkQueue** — the Core's job scheduler: concurrency cap (v1: 2), per-job budgets, cancellation, progress events over WS.
- **MemoryIndex** — cross-thread embedding index over Digests, Captures, and Turns. Answers "what did I find out about X in March?" and lets triage attach the active Thread automatically.

---

## 6. Architecture

Unchanged shape — shared TypeScript Core on the phone; two thin native clients — with three new Core modules and a WS protocol extension.

```
                    ┌────────────────────────────────────────────────────────┐
  META client       │        CORE (reading-companion-core, on the phone)      │
  DAT-Android       │                                                        │
  + 600×600 web-app │  SessionManager ─ SessionStore          Gemini Live    │
        ▲           │  ThreadStore  ── MemoryIndex   (NEW)    Gemini 3.5 Fl. │
        │ WS/REST   │  ImagePipeline ─ CaptureClassifier      Search/Scholar │
        ▼           │  ContentResolver/Enricher ─ Dossier     Open Library   │
  ANDROID XR client │  VoiceSession (Live | mock | OpenAI)                   │
  Glimmer+Projected │  Triage ── WorkQueue ── JobRunner(s)    (NEW)          │
        ▲           │  WatcherEngine ── DeliveryEngine        (NEW)          │
        └──────────►│  server.ts: /api/* + /ws                               │
                    └────────────────────────────────────────────────────────┘
```

**WS protocol v2 additions** (client ↔ Core):

- Client → Core: `{ type: "ask", question, captureId?, threadId? }` · `{ type: "capture", imageBase64, hintKind? }` · `{ type: "job_cancel", jobId }` · `{ type: "wear", worn: boolean }`.
- Core → client: `job_update { jobId, state }` · `deliver { level, surface, tldr?, badge?, jobId }` · existing `audio | transcript | answer | page_observed | watcher_armed`.

The `wear` message is how DeliveryEngine knows glasses are on-face: Android XR gets it free from the DP4 Device Availability API (`onResume`/`onPause` fire on wear); Meta DAT infers from device-connection state.

**Model layer & governance.** Realtime voice: Gemini Live (existing seam; vendor-swappable). Heavy lifts (triage, extraction, research synthesis): Gemini 3.5 Flash default per I/O 2026; Claude retained as research-dispatch alternative behind the same interface. Per global LLM-ops rules every call goes through the purpose-keyed model picker with cost/latency logging and schema-validated output; ResearchJob budgets are enforced by the WorkQueue, not by trust.

---

## 7. Delivery etiquette — the heart of "background"

The partner's worth is decided less by what it finds than by *how it comes back*. Rules, in priority order:

1. **Never speak over people.** If the rolling buffer's VAD detected human conversation in the last 15 s, cap the level at `earcon`. (The mic is already streaming for invocation; this reuses it.)
2. **Never deliver to glasses that aren't worn.** No wear signal → route to phone notification, level `hold`.
3. **Default levels:** ResearchJob completion → `badge` (display devices) / `earcon` (audio-only devices). Watcher fire → `badge`. Fast-path Answer → `speak` (it was just asked for).
4. **"Tell me when you're back" upgrades this job to `speak`.** Spoken invitation at dispatch time is the natural upgrade path and costs the user nothing.
5. **Round down under uncertainty.** Any doubt (low digest confidence, DND window, level ambiguity) → next level down. A missed badge costs a glance at the phone; a wrong interruption costs trust.
6. **Everything expires to the phone.** A badge not glanced within 10 min is dismissed on-glasses; the Digest waits in its Thread. Nothing is ever *only* on the glasses.
7. **Per-thread politeness.** The phone app exposes each Thread's ceiling (`hold`…`speak`) and global DND windows. A "reading session" Thread may invite `speak`; a "general curiosity" Thread stays at `badge` forever.

**Glasses card grammar** (both platforms, per the design guide's 5-second rule): one card = TLDR (≤140 chars) + up to 3 citation titles + one action ("open on phone" = Enter/pinch). Down-arrow/swipe = next card, up = dismiss. No scrolling body text on glasses, ever.

---

## 8. Platform specifics

### 8.1 Meta Ray-Ban Display (`clients/meta-rbd`)

- **Runtime split (platform-imposed):** DAT-Android Kotlin app on the phone owns camera (stills; 720p30 BLE video reserved for escalation-ladder ACTIVE only), 5-mic audio in, open-ear audio out, and Neural Band cooked gestures. The 600×600 web-app is the display surface — no camera there, D-pad + Enter only, `.focusable` conventions, black-is-transparent additive design.
- **Invocation:** temple long-press → PTT (mic opens, one still captured at press). Neural Band pinch = select, swipe = card navigation. No wake word (reserved).
- **Delivery mapping:** `badge` = amber chip top-right of the 600×600 canvas; `earcon` = short tone via DAT audio out + badge; `speak` = TTS TLDR then badge persists.
- **Constraints accepted:** 100 testers/channel cap during preview (general publishing "later 2026"); privacy LED always on during capture, tamper = refusal (design assumes visible capture); Meta AI unavailable to third parties — we ship our own model pipeline; US-only hardware for now.
- **Dev/test:** `mwdat-mockdevice` for glasses-free development; browser + arrow keys simulate the display app end-to-end on Windows.

### 8.2 Android XR (`clients/android-xr`)

- **Runtime:** one Kotlin/Compose app; activity runs on the phone (`xr-projected`), renders/inputs on glasses (`xr-glimmer`). Camera via projected context; `CAMERA` + `RECORD_AUDIO` runtime permissions. DP4: Device Availability API gives real wear-state lifecycle (feeds `wear` messages); `ProjectedTestRule` enables JVM-level client tests; Glimmer now uses Google Sans Flex, Stacks, Title Chips.
- **Invocation:** temple-tap → PTT. Gemini Live is platform-native for the voice path (`/jetpack-xr-sdk/gemini-live`) — the Core may hand the hot audio path a direct device↔Live socket later while keeping session state authority (documented seam in the build plan, still deferred).
- **Two device waves:** **audio glasses (fall 2026)** — no display, so InterruptLevels collapse to `hold | earcon | speak` and the audio-only degradation gets exercised for real; **display glasses (later, unspecified)** — full card grammar in Glimmer (`Card`, `TitleChip`, badge chips).
- **Delivery mapping:** `badge` = Glimmer badge chip; digest card = Glimmer Card in a Stack (swipe between digests).
- **Constraints accepted:** `xr-glimmer`/`xr-projected` still alpha (API churn risk); no consumer AI-glasses hardware until fall; emulator (AI Glasses AVD) is the near-term test surface.
- **Hardware access:** no pre-release-program dependency. The emulator (AI Glasses AVD) is the test surface until retail audio glasses ship in the fall; display-glasses hardware work follows retail availability.

### 8.3 Phone app

Grows from "session log" to the product's considered half: thread list (newest activity first), digest reader (full body + tappable citations), job queue with cancel, watcher CRUD, memory search box, politeness/DND/budget settings, and a full capture+ask flow using phone camera + mic (the partner must be completely usable with no glasses at all — that is also the demo surface that needs zero preview-program approval).

---

## 9. Privacy & safety

- **Visible capture is a feature.** Both platforms hardware-signal capture (LED; tamper = refusal on Meta). The product narrative embraces it: single stills on explicit invocation, no covert continuous video. Continuous frames only in ACTIVE ladder state, which only explicit engagement reaches.
- **No face recognition, no bystander identification.** Platform-banned (Meta preview) and product-banned. CaptureKind `scene` extraction is instructed to describe, not identify, people; frames are discarded after extraction by default (configurable per thread; text extracts persist, images don't).
- **Server-side text disclosure** in onboarding (extracts + questions reach model APIs). All new networked paths route errors through `redact.ts` (existing rule, restated because every new module here is a networked path).
- **Spoken-PII caution:** the partner never asks the user to speak personal identifiers aloud in public flows (guide rule).
- **Copyright posture unchanged** from [architecture.md](architecture.md): personal research aid over content the user owns; no redistribution of extracted text.

---

## 10. Build plan

Sequenced to fix the project's actual weakness (zero on-device validation) before adding surface area. Each milestone ends in something felt, not documented.

| # | Milestone | Scope | Exit test |
|---|---|---|---|
| **M0** (1–2 wk) | **Core v2** | Thread/Capture/ResearchJob/Digest schemas; WorkQueue + JobRunner; Triage; DeliveryEngine + InterruptLevels; MemoryIndex (local embeddings); WS v2. All TDD, all offline-mockable, DEFINITIONS.md updated. | `wsSmoke` v2: ask → job → digest → deliver round-trip green offline; typecheck + full suite green. |
| **M1** (1–2 wk) | **Felt vertical slice, phone-only** | Phone client (thin Android app or the v0-web shell upgraded) does capture → ask → ack → background job → earcon/notification → digest with citations. No glasses required. | The wedge moment demoed end-to-end to one real user (you), ten times, without touching a laptop. |
| **M2** (2–3 wk) | **Meta slice** | DAT-Android client real (PTT, still capture, audio out; mock-device first, then Gen 1 RBM audio-only in-ear delivery). If/when RBD hardware: web-app digest cards + badges wired to WS v2. | On-glasses: temple-press → question → keep reading → answer in ear ≤90 s. |
| **M3** (2–3 wk) | **Android XR slice** | Glimmer+Projected client against AI Glasses AVD emulator + `ProjectedTestRule`; wear-state → DeliveryEngine wired. Hardware pass when retail devices exist. | Emulator: full card grammar (badge → card → open-on-phone) driven by a live Core session. |
| **M4** (ongoing) | **Memory + polish** | MemoryIndex surfaced (phone search + triage thread-attach); watcher triggers beyond recurrence (new-publication alert); politeness settings UI; cost dashboards per LLM-ops. | "What did I ask about X last month?" answered correctly across ≥3 threads. |

**Hardware decisions embedded:** M2's display half needs a Ray-Ban Display purchase (~$799, US) — the audio-only Gen 1 RBM path ships value regardless. M3's hardware pass waits for fall retail hardware.

**Distribution reality (unchanged):** Meta ≤100 testers/channel, general publishing "later 2026"; Android XR AI-glasses publishing path unannounced (expect Play + Glimmer/Projected). v1 is dogfood + friendly testers by design; commercial gating is a Stage-2 problem.

---

## 11. Cost model delta

Manual-capture-first keeps the expensive paths event-driven. Versus the per-hour estimate in [architecture.md](architecture.md) ($0.75–2.25/hr, continuous narration):

- Fast-path Answer: one Live exchange + optional Flash call — cents.
- ResearchJob: bounded by budget (default 150k tokens ≈ $0.05–0.15 on 3.5 Flash incl. search/scholar calls). 10 jobs + 20 fast answers + idle-mic session ≈ **$0.50–1.00 per active hour**, dominated by Live audio minutes. Continuous-video modes remain opt-in and ladder-gated.
- WorkQueue enforces per-job and per-day budget caps; the phone app shows spend. Re-cost at M1 with real logs (LLM-ops requirement, not optional).

---

## 12. Open questions (decisions needed before/at M0)

1. **Ray-Ban Display purchase:** buy now for M2's display half, or run Meta audio-only (Gen 1 RBM) until Google display glasses clarify?
2. **Thread auto-creation:** should triage silently create Threads per topic (magical, risks sprawl) or ask "new thread or continue X?" once per ambiguous ask (predictable, adds a beat)? Spec default: auto-create with phone-side merge tools.
3. **MemoryIndex location:** on-phone embeddings (private, battery cost) vs user-controlled VPS (the Stage-0 doc floated this). Spec default: on-phone, sync-ready interface.
4. **Product name:** "Reading Companion" undersells the generalized product; renaming repo/branding is deferred but the pitch needs a name.
