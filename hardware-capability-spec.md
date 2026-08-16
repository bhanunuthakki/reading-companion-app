# Hardware Capability Spec — Going as Deep as the Platforms Allow

_Authored 2026-07-10. Companion to [thought-partner-spec.md](thought-partner-spec.md): that doc says what the product is; this one specifies how it exploits the deepest hardware and platform access each device **actually** grants — and names the enforcing module for every rule. No fantasy APIs: every capability cites the platform guide ([`../xr-glasses-dev-guide/`](../xr-glasses-dev-guide/)); everything reserved by the vendor is listed with the best legal approximation we ship instead._

Vocabulary is [DEFINITIONS.md](DEFINITIONS.md) verbatim: EscalationLevel, Capture, ResearchJob, Digest, InterruptLevel, DeliveryEngine, WorkQueue, MemoryIndex, Core, Client.

---

## 1. Access map — what we can actually touch, per device

The app never runs *on* any glasses. On every target the Core + Client run on the **companion phone**; glasses are an I/O peripheral. That makes the phone first-class hardware, listed last and mattering most.

| Device | Camera to app | Mic to app | Audio out | Display to app | Motion/other | Reserved (no access) |
|---|---|---|---|---|---|---|
| **Ray-Ban Meta Gen 1/2** ([03](../xr-glasses-dev-guide/03-meta-glasses.md)) | DAT stills (12 MP-class) + video hard-capped **720p/30 over BLE**, auto step-down | 5-mic array, **beamformed single stream** (no raw per-mic; [05](../xr-glasses-dev-guide/05-audio.md)) | Open-ear speakers, mono/stereo | — (no display) | 6-axis IMU (web-app surface); phone GPS | Meta AI pipeline, "Hey Meta", on-glasses CV, raw mic array |
| **Ray-Ban Display** ([03](../xr-glasses-dev-guide/03-meta-glasses.md)) | Same DAT camera path (native only — **web-app surface has no camera**) | Same 5-mic beamformed | Same + system audio routing | **600×600, 20° FoV, 42 ppd, 30–5,000 nits, ≤90 Hz**, user-activated, via DAT native or Web Apps sandbox | Neural Band **cooked gestures only** (pinch/swipe/twist → D-pad events in web apps; [06](../xr-glasses-dev-guide/06-neural-band.md)) | Raw EMG, SLAM/anchors (head-locked HUD only), face recognition, custom wake words |
| **Google audio glasses** (fall 2026; [12](../xr-glasses-dev-guide/12-io-2026-updates.md)) | Yes — via **projected context** (`xr-projected`, phone-side Kotlin; [02](../xr-glasses-dev-guide/02-android-xr.md)) | `RECORD_AUDIO` through projected context | Open-ear speakers | — (audio category) | Wear state via **Device Availability API** (`onResume`/`onPause` fire on-wear, DP4) | "Hey Google", exact camera specs TBD |
| **Android XR display glasses** (later) | Same projected-context path | Same | Same | Glimmer surface (additive, Compose: Card/TitleChip/Stacks, Google Sans Flex) | Same + temple-tap | Same reservations expected |
| **Galaxy XR** (dev proxy only) | **Standard Camera2/CameraX on passthrough** (`camera_id 0`), real RGB frames — the most open camera policy in XR ([02](../xr-glasses-dev-guide/02-android-xr.md), [04](../xr-glasses-dev-guide/04-cameras.md)) | 6 mics, beamforming | Spatial audio via SceneCore | Full spatial UI | Hands (26 joints), eye gaze (permissioned), depth maps, planes, local persistent anchors | Inward eye cameras, tracking cameras, raw depth IR |
| **Companion phone** | CameraX (fallback capture surface) | AudioRecord + `SpeechRecognizer` | Speaker/earbuds + **TextToSpeech** | Full app UI (the "considered" surface) | GPS, IMU, network; **foreground service** with `camera|microphone|connectedDevice` types; `PowerManager.getThermalHeadroom()`; BLE central; LE Audio APIs | — |

Two asymmetries drive the whole architecture:

1. **Meta splits camera and display across two surfaces** (native Kotlin gets the camera, the 600×600 web sandbox gets the display). Android XR unifies them behind one projected activity. Hence the Meta client is two cooperating pieces and the Android XR client is one.
2. **Only the phone has trustworthy compute.** All on-device ML (ML Kit, TFLite, MediaPipe, Gemini Nano-class) runs phone-side. Both glasses platforms stream sensors to the phone; there is no third-party on-glasses execution anywhere in our lineup (the Web Apps sandbox renders DOM, it does not see sensors beyond IMU/GPS).

## 2. Power architecture — the EscalationLevel ladder as radio/DSP states

Battery is a *product* constraint: the companion must survive a 3-hour Sunday reading block on Gen 1 hardware ([staged-roadmap.md](staged-roadmap.md) battery table: naive continuous video = 1–1.5 h; ladder = 2.5–3.5 h; standby = 36 h). The ladder from `CaptureOrchestrator` maps to concrete hardware states:

| Level | Glasses radio | Glasses DSP/sensors | Phone | Modeled endurance (Gen 1 RBM) |
|---|---|---|---|---|
| **IDLE** | BLE connection alive at long connection interval; **no media streams** | Wake-word DSP is the vendor's (always-on, ~free — [05](../xr-glasses-dev-guide/05-audio.md)); our mic path CLOSED | Core process in foreground service; VAD not running | 30+ h |
| **ALERTED** | One still transfer (~1–2 MB burst), then quiet | Mic open only during PTT window (≤10 s) | On-device pre-filter + one OCR call; VAD on during window | 4–8 h (dominated by session length, not level) |
| **ACTIVE** | 0.5–1 fps video **only during live visual engagement**; decays | Mic streaming; phone-side VAD continuous | Rolling buffer transcribe-on-demand; Live session open | 2.5–3.5 h |

**Promotion triggers** (what moves the ladder up) and their real implementability today:

| Trigger | Mechanism | Status |
|---|---|---|
| Explicit PTT (temple long-press / pinch / temple-tap) | DAT gesture event / Neural Band cooked gesture / Android XR temple-tap | **Shippable now** — the only trigger v1 relies on |
| Page-rustle acoustic cue | Phone-side lightweight audio classifier on the beamformed stream | Feasible; requires ACTIVE-level mic → only valid as an ACTIVE-state page-turn detector, not an IDLE wake |
| IMU book-lift cue | Glasses IMU via DAT (web-app surface) / phone posture | Partial — IMU polling is cheap but IDLE-state subscription paths are limited; treat as ALERTED-assist, not IDLE wake |
| Custom wake word ("Hey Reader") | Phone-side detection on streamed mic | Possible but requires always-open mic stream = ACTIVE-level battery. **Rejected for v1** ([05](../xr-glasses-dev-guide/05-audio.md): always-on app mic is the single biggest drain) |

**Decay policy** (enforced in `CaptureOrchestrator`, timers injectable for tests): ACTIVE → ALERTED after **30 s** without speech or visual change; ALERTED → IDLE after **5 min** without any trigger. Delivery never promotes the ladder — a Digest arriving while IDLE renders as badge/hold without waking any media stream. Session persistence is independent of capture level (a Session spans hours at IDLE costing ~nothing; [persistent-sessions-ux.md](persistent-sessions-ux.md) §8).

**Phone-side power rules:** the Core runs inside a foreground service (required for mic/camera + Doze immunity); WS keep-alives ride the existing BLE/Wi-Fi radios; `getThermalHeadroom()` gates concurrent ResearchJobs (WorkQueue concurrency drops 2→1 above headroom 0.8); Gemini Live sessions are opened lazily at ALERTED, never held at IDLE.

## 3. Privacy architecture — every rule has an enforcing module

Principle: **the cloud sees text, not the world.** Raw sensor data dies as early in the pipeline as the platform allows.

**Frame lifecycle** (enforcing module in bold):

```
capture (LED on, platform-enforced, tamper = refusal [03])
  → phone-side pre-filter: ML Kit text detection, "is there even text/content here?"
        — free, on-device, gates every cloud call ([04])          **CaptureOrchestrator**
  → cloud extract: one structured vision call → text extract      **CaptureExtractor**
  → image bytes DISCARDED; only the extract persists              **CaptureStore** (never stores bytes)
  → extract → cursor/watchers/MemoryIndex                         **SessionManager / WatcherEngine**
```

- Frames below the sharpness gate (variance-of-Laplacian) or failing the ML Kit gate never leave the phone. Target: **≥60 % of candidate frames rejected on-device** in ACTIVE mode.
- `scene`-kind Captures are extracted with a describe-don't-identify instruction; face recognition is both platform-banned ([03](../xr-glasses-dev-guide/03-meta-glasses.md)) and product-banned. Enforced in the **CaptureExtractor prompt** and asserted in its output schema (no person-name fields exist).

**Mic policy:** the rolling buffer is a phone-RAM ring (default 60 s) that is transcribed **only on demand** ("what did they just say?"); it is never persisted, never uploaded wholesale. VAD runs phone-side and only at ALERTED+. Conversation-suppression (DeliveryEngine rule 1) reuses the same VAD — the mic that could interrupt you is the sensor that prevents interruption. Enforced: **rolling buffer in the audio client; suppression in DeliveryEngine**.

**Retention defaults per store:** CaptureStore = extracts only, per-thread purge control; ThreadStore/JobStore = durable until user deletes; MemoryIndex = derived (rebuildable, purged with its sources); raw images/audio = **never at rest anywhere**. All networked error paths through `redact.ts`. Server-side text disclosure at onboarding (extracts + questions reach model APIs) stays mandatory per [thought-partner-spec.md](thought-partner-spec.md) §9.

**Bystander posture:** capture visibility is hardware-enforced on Meta (constant LED, covered-LED refusal) and normed on Android XR; the product never offers burst/covert modes, and ACTIVE-level video requires an in-session engagement the wearer explicitly started. This is a feature, not a compliance cost — trust in the room is part of the UX.

## 4. Proactivity engine — intelligent, not needy

All unprompted behavior flows through **one choke point: DeliveryEngine**. Nothing else in the system may initiate audio or display output.

**Trigger taxonomy** (producers → DeliveryEngine events):

| Trigger | Producer | Default InterruptLevel |
|---|---|---|
| ResearchJob completes | WorkQueue → `digest_ready` | badge (display) / earcon (audio-only) |
| Watcher recurrence (topic reappears in new Capture/PageText) | WatcherEngine | badge |
| New-publication alert (standing scholarly query re-run) | scheduled ResearchJob (WorkQueue cron-style, v1.5) | hold |
| Re-engagement cue (resumed thread with undelivered digests) | SessionManager `resumed` | badge, once |
| Invited follow-up ("tell me when you're back") | job `invited` flag | speak |

**Rate limits** (DeliveryEngine policy, configurable): max **4 unprompted deliveries/hour** at badge-or-above; max **1 speak-level/hour** unless invited; everything above the cap silently degrades to hold (phone). Round-down under uncertainty is already law (spec §7 rule 5).

**Learning loop (v1.5):** every delivery records outcome — opened, dismissed, ignored-to-expiry. Per-thread ceilings auto-tune: two consecutive ignores at a level → suggest (never silently apply) dropping the thread ceiling one notch; consistent opens at hold → suggest raising. Suggestions surface on the phone only. The user's explicit ceiling is never overridden — the engine learns *within* granted budget, it does not grant itself budget.

## 5. End-to-end latency budget (PTT → ack)

Target: **pinch-to-spoken-ack ≤ 3.0 s**, matching the product's synchronous budget (spec §2).

| Hop | Budget | Notes / fallback |
|---|---|---|
| Gesture event → mic open | 150 ms | DAT/projected event dispatch |
| Speech (user) → STT final | +400 ms after end-of-speech | platform `SpeechRecognizer` / Gemini ASR; fallback: typed input |
| Still capture + BLE transfer | 800–1,500 ms (1–2 MB over BLE; [03](../xr-glasses-dev-guide/03-meta-glasses.md)) | runs **in parallel** with user speech — capture fires at gesture-down, not at question-end |
| On-device pre-filter | 80 ms | ML Kit text detector |
| Triage call | 300–600 ms | Gemini 3.5 Flash structured; offline heuristic ~0 ms |
| Ack synthesis + audio start | 300 ms | canned ack strings pre-synthesized; only the *route decision* is awaited |

Overrun fallback: if triage hasn't answered at T+2.5 s, speak the generic ack ("On it") and let the route land as a correction only if fast (a fast answer arriving later just gets spoken; a background route needs no correction). Extraction (cloud OCR, 1–3 s) is **never** on the ack path — it completes inside the ResearchJob.

## 6. Scalability & productionization

The seams are already cut for growth; this section names the order they open.

1. **Storage:** file-backed DocStores (one JSON per document, `updatedAt` + `deviceId`) → a cloud `SessionStore/ThreadStore/JobStore` implementing the same interfaces; conflict policy stays last-writer-wins per document ([persistent-sessions-ux.md](persistent-sessions-ux.md) §4.3). MemoryIndex is derived data — rebuilt per node, never synced.
2. **Transport:** the WS v2 + REST contract is the stable seam. Clients never see storage or model internals; a hosted Core behind a socket gateway is a deployment change, not a client change.
3. **Compute:** Core is already event-driven; at multi-user scale it splits into stateless connection handlers + per-user WorkQueues (jobs are queue-shaped today). The 10k-user shape: gateway → per-user session actors → shared enrichment/dossier cache (dossiers are per-title, massively shareable) → model providers behind the existing seams.
4. **LLM-ops (binding, per global rules):** every model call goes through the purpose-keyed picker (triage / extract / research / voice), logs cost + latency + failure, validates output with Zod schemas, and runs under WorkQueue budgets (maxTokens/maxSeconds per job, per-day caps). Eval harness hooks: triage routing accuracy, digest tldr speakability (length/markdown lint), extraction fidelity on a fixture set — wired into the existing offline vitest suite so evals run keyless in CI.
5. **Multi-tenant later:** per-user directory partitioning now; tenant-ready schema + RLS only when a hosted Core exists (Stage 2; deliberately not built single-user).

## 7. Honest constraints register

| Wish | Actual status (per guide) | What we ship instead | Unlock signal to watch |
|---|---|---|---|
| Raw EMG from Neural Band | Cooked gestures only; D-pad events in web apps ([06](../xr-glasses-dev-guide/06-neural-band.md)) | Full D-pad grammar; pinch = universal "act" | Meta's accessibility raw-EMG carve-outs (CMU partnership) broadening |
| Custom wake word ("Hey Reader") | "Hey Meta"/"Hey Google" reserved; app-level detection = battery hole ([05](../xr-glasses-dev-guide/05-audio.md)) | PTT-first interaction as a *product identity*, not a workaround | Vendor intent-registration APIs for third-party invocation |
| On-glasses CV / pre-filtering | No third-party on-glasses execution on any target | Phone-side ML Kit gate ≤80 ms behind a BLE hop | AR1 Gen 3-class NPUs + a vendor on-device inference API |
| Meta AI / Gemini assistant pipeline reuse | Meta AI not in DAT; Gemini assistant not app-invokable | Own pipeline: Gemini Live (voice) + 3.5 Flash (lifts) behind vendor-swap seams | Meta "exploring" third-party AI access; Android XR assistant intents |
| Always-on ambient video | 720p30 BLE cap; kills battery in ~1 h ([staged-roadmap.md](staged-roadmap.md)) | EscalationLevel ladder; stills-first; ACTIVE only during live engagement | On-glasses low-power CV chips (rumored Ray-Ban Gen 3) |
| World-locked AR marginalia | No SLAM/anchors on Ray-Ban Display; head-locked HUD only ([03](../xr-glasses-dev-guide/03-meta-glasses.md)) | Glanceable 2D grammar (badge → card); spatial anchoring parked at Stage 2/3 | Orion-descendant consumer hardware (~2027); Android XR display glasses anchor APIs |
| Raw mic array / custom beamforming | OS beamforms; single processed stream | Accept the (good) vendor beamforming; VAD + rolling buffer on the processed stream | Unlikely to change; not blocking |
| On-glasses GPS everywhere | Phone GPS via DAT web apps; on-glasses GPS only on sport models ([08](../xr-glasses-dev-guide/08-other-sensors.md)) | Phone GPS when location context is ever needed (not in v1) | — |

---

*Contradictions found while grounding this spec: none material. One tension worth logging: [staged-roadmap.md](staged-roadmap.md) treats a phone-side "Hey Reader" wake word as viable (~300 ms detection); [05-audio.md](../xr-glasses-dev-guide/05-audio.md) calls app-level always-on mic the single biggest battery drain. This spec sides with the guide: wake-word listening is rejected for v1 (see §2 and §7), PTT is the invocation story.*
