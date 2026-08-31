# DAT-Android — the phone-side Meta client

The Kotlin half of the Meta Ray-Ban client (the other half is the 600×600
[`../web-app`](../web-app) display surface). It owns everything Meta's platform
split gives the phone: glasses camera stills, mic push-to-talk, open-ear audio
out, and gesture events — and speaks **WS v2** (plus v1) to the
[Core](../../../core). On the emulator — the demo target — it runs **without any
Meta artifacts**: the phone emulates the glasses behind the `GlassesDevice`
facade.

Vocabulary is [DEFINITIONS.md](../../../DEFINITIONS.md) verbatim: Capture,
ResearchJob, JobState, Digest, InterruptLevel, DeliveryEngine, EscalationLevel,
Thread, Client, Core.

## Build & test (Windows, no Android Studio needed)

No Gradle wrapper jar is checked in — use a system Gradle ≥ 8.7 (this machine:
8.9). `local.properties` points at the SDK; regenerate it if your SDK lives
elsewhere.

```powershell
$env:JAVA_HOME   = '<path-to-jdk17>'
$env:ANDROID_HOME = '<path-to-android-sdk>'
$env:Path         = "$env:JAVA_HOME\bin;$env:Path"
cd <repo-root>\clients\meta-rbd\dat-android

# assemble the APK
gradle.bat assembleDebug

# pure-JVM unit tests (WS protocol encode/decode + reconnect backoff)
gradle.bat testDebugUnitTest
```

APK lands at `app/build/outputs/apk/debug/app-debug.apk`.

## Architecture — the `GlassesDevice` facade

```
MainActivity (felt loop UI, STT/TTS)          on-screen buttons = gestures
        │                                              │
ReadingCompanionController  ◄── GlassesDevice.Listener ┘
   │            │
   │            ├── GlassesDevice (THE seam — hardware-capability-spec.md §3)
   │            │      ├── EmulatedGlassesDevice   ← default; zero Meta deps
   │            │      │     CameraX still · AudioRecord · AudioTrack/ToneGenerator
   │            │      └── DatGlassesDevice.kt     ← fully commented; TODO(DAT)
   │            │            mwdat-core / mwdat-camera / mwdat-mockdevice
   └── CoreClient (OkHttp WS, exponential-backoff reconnect)
          └── CoreProtocol (pure JVM: WS v1+v2 frames) + CoreEvent + BackoffPolicy
```

### Facade → DAT mapping

| `GlassesDevice` member | Emulated (default build) | Real DAT (commented seam) |
|---|---|---|
| `connect`/`disconnect` + wear | CameraX bind; wear = UI toggle | `WearableDeviceManager` device connection; wear inferred from connection state (spec §6) |
| `captureStill()` → JPEG | CameraX `ImageCapture` (emulator virtual camera) | `dat.camera.captureStill` — 1–2 MB BLE burst, fire at gesture-down |
| `startMicCapture`/`stopMicCapture` | `AudioRecord` 16 kHz mono PCM16 | 5-mic **beamformed single stream** (no raw per-mic — 05-audio.md) |
| `playAudio(pcm, rate)` | `AudioTrack` (Core emits 24 kHz mono) | `dat.audio.play` on open-ear speakers |
| `playEarcon()` | `ToneGenerator` soft ack tone | pre-rendered PCM via `dat.audio.play` |
| `Gesture.TAP` / `LONG_PRESS_*` | on-screen buttons | Neural Band pinch / temple long-press (cooked events only) |

To flip to hardware: uncomment `device/DatGlassesDevice.kt`, the `mwdat-*`
deps in `app/build.gradle.kts`, and add Meta's maven repo in
`settings.gradle.kts` (steps written at the top of `DatGlassesDevice.kt`).
The default build **never** touches Meta's maven.

### Battery discipline (hardware-capability-spec.md §2)

No continuous frame loop exists anywhere: CameraX binds an `ImageCapture` use
case only (no Preview/ImageAnalysis), and each still is one on-demand
`alerted`-level action. The EscalationLevel ladder's `active` state (≤1 fps
video → v1 `frame` messages) is a documented, deliberately-absent method on the
facade — see the seam comment in `device/GlassesDevice.kt`.

## The felt loop (WS v2)

1. **Hold** the PTT button (= temple long-press). A still fires immediately
   (parallel with your speech, per the §5 latency budget) → downscaled ≤1024 px
   → `capture` → `capture_stored` remembers the `captureId`.
2. Speak; release. `SpeechRecognizer` finalizes → `ask { question, captureId?,
   threadId? }`. No speech service / recognition error → an explicit type-in
   dialog (never fabricated input). First ask auto-creates a Thread on the Core.
3. `job_update "queued"` arrives **before** `ask_routed` — chips render
   order-independently, keyed by jobId.
4. `ask_routed`: fast → the Answer is spoken (TTS) and carded; background →
   "on it" + a live job chip (`queued → running → digest_ready → delivered`).
   Tap a queued/running chip to `job_cancel`.
5. `deliver { level, tldr, badge }` renders the etiquette ladder: `hold` = quiet
   phone entry · `badge` = amber chip · `earcon` = ToneGenerator tone + chip ·
   `speak` = tone + TTS reads the tldr. Wear defaults to **not-worn** on the
   Core — leave the wear toggle off and every delivery holds to the phone
   (DeliveryEngine rule 2), which is the fastest way to *feel* the ladder.

## Emulator demo script (10.0.2.2 = host loopback)

```powershell
# 1. Core on the host (offline mode is fine — mock digests after ~2.5 s)
cd ..\..\..\core ; npm start

# 2. Phone AVD (companion_phone), install, launch
$env:ANDROID_HOME = '<path-to-android-sdk>'
& "$env:ANDROID_HOME\emulator\emulator.exe" -avd companion_phone
& "$env:ANDROID_HOME\platform-tools\adb.exe" install app\build\outputs\apk\debug\app-debug.apk
& "$env:ANDROID_HOME\platform-tools\adb.exe" shell am start -n com.readingcompanion.rbd/.MainActivity
```

In the app: grant camera+mic → Connect (default `ws://10.0.2.2:4000/ws`,
editable, persisted) → toggle **Glasses: WORN** → hold PTT, ask *"compare the
literature on spaced repetition versus rereading"* (a background-route marker
phrase) → watch queued/running chips → digest delivers as badge/earcon; say
*"…and tell me when you're back"* to feel the `speak` upgrade. Toggle wear OFF
and repeat to see deliveries hold to the phone.

## Tests

`app/src/test/` — pure JVM (JUnit4, real `org.json` artifact, no Robolectric):

- `CoreProtocolTest` — every v2 frame shape from core/README.md (ask/capture/
  wear/job_cancel out; ask_routed/job_update/deliver/capture_stored in), the
  v1 frames, the queued-before-ask_routed contract, ladder ordering, and
  loud-failure cases (unknown JobState/route, malformed frames).
- `BackoffPolicyTest` — exponential growth, cap, reset, bounded jitter.

## What's real vs deferred

- **Real now:** the full felt loop against a live Core on the emulator, with
  the phone emulating the glasses; WS v1 remains supported (reading sessions).
- **Deferred (needs hardware/SDK):** everything inside `DatGlassesDevice.kt`'s
  comment block; publishing (DAT preview is capped at 100 testers/channel,
  general publishing "later 2026" — 03-meta-glasses.md).
