# Google Android XR client (Glimmer + Projected)

The Android XR thin client of the [Core](../../core) for the Background Thought & Research Partner ([thought-partner-spec.md](../../thought-partner-spec.md) §8.2). One Kotlin/Compose activity that — on real AI glasses — runs on the **phone** under the Jetpack **Projected** runtime and renders a glanceable **additive** surface on the eyewear. It speaks **WS v2** (`ask` / `capture` / `wear` / `job_cancel` in; `ask_routed` / `job_update` / `deliver` / `capture_stored` out) plus the retained v1 session messages, and renders the same surface grammar as the Meta 600×600 web-app: **one thing on stage — hint → wait → badge → pinch → TLDR card (≤3 citation titles) → dismiss.**

Status: **build-ready, two-surface**. The default build depends only on stable artifacts; the alpha Jetpack XR path is isolated behind a Gradle property.

## Build & run

Prereqs on this machine: JDK 17 (`C:\Users\bhanu\android-toolchain\jdk17`), Gradle 8.9 (`C:\Users\bhanu\android-toolchain\gradle-8.9`), Android SDK (`C:\Users\bhanu\AppData\Local\Android\Sdk`, set in `local.properties`).

```powershell
cd clients\android-xr
$env:JAVA_HOME = "C:\Users\bhanu\android-toolchain\jdk17"
$env:ANDROID_HOME = "C:\Users\bhanu\AppData\Local\Android\Sdk"

C:\Users\bhanu\android-toolchain\gradle-8.9\bin\gradle.bat assembleDebug        # default (stable) build
C:\Users\bhanu\android-toolchain\gradle-8.9\bin\gradle.bat testDebugUnitTest    # pure-JVM tests

# install on whichever AVD is running (ai_glasses or companion_phone):
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r app\build\outputs\apk\debug\app-debug.apk
```

Start the Core first (`cd core && npm start`, port 4000). From any emulator, the host machine is `10.0.2.2` — the app's default Core URL is `ws://10.0.2.2:4000/ws`, editable and persisted (SharedPreferences) on the surface's phone-harness panel.

## The two-surface architecture (graceful degradation)

`androidx.xr.glimmer` / `androidx.xr.projected` are **alpha** (DP4) and may not resolve or may churn. So the app has one `GlassesSurfaceBinding` seam, swapped per **source set** at build time — the default build never compiles an alpha import:

| | Default build (`assembleDebug`) | Glimmer build (`-PenableGlimmer=true assembleDebug`) |
|---|---|---|
| Source set | `src/surface-phone` | `src/surface-glimmer` (+ `src/surface-glimmer-test`) |
| Surface | `PhonePreviewSurface` — plain Compose, faithful rendition of the glasses surface: dark **additive** look (black = transparent on a waveguide), square stage, one-thing-at-a-time grammar, focus-outline styling, Title-Chip-style header | `GlimmerSurface` — real Glimmer composables (`TitleChip`, `Card`, focus outlines, Google Sans Flex via Glimmer defaults) |
| Wear state | `ManualWearSource` — explicit UI toggle (honest: no on-face sensor on an AVD) | `ProjectedLifecycleWearSource` — DP4 **Device Availability API** wear lifecycle (`onResume`/`onPause` fire on-wear) |
| Dependencies | stable only (Compose BOM, OkHttp, CameraX, coroutines) | + `androidx.xr.glimmer:glimmer:1.0.0-alpha07` (**unverified**), `androidx.xr.projected:projected:1.0.0-alpha07` (**unverified**), `androidx.xr.projected:projected-testing:1.0.0-alpha07` (documented in [12-io-2026-updates.md](../../../xr-glasses-dev-guide/12-io-2026-updates.md)) |
| Runs on | **ai_glasses AVD** and any phone AVD — the AI Glasses Developer Preview image runs standard Android apps | real Projected-hosted glasses / future emulator support, once the alpha artifacts resolve |

Everything else — `WsCodec`, `SurfaceStateMachine`, `CoreClient` (reconnect w/ backoff), `CoreRest`, `CompanionViewModel`, `CaptureController`, `SpeechInput`, `AudioCues` — is shared `src/main` code used by both surfaces.

### ai_glasses AVD vs phone AVD

Both use the **same default build**. The ai_glasses AVD (system image `system-images;android-36;ai-glasses;x86_64`) is the primary run target and exercises the square glanceable surface at glasses-like proportions; the `companion_phone` AVD is the compatibility check plus the natural home of the "phone harness" panel (wear toggle, Core URL, typed ask). No flavor/property switch between them.

### Wear-state plumbing

`WearStateSource.worn: StateFlow<Boolean>` (starts **false** — the Core defaults to not-worn and holds every delivery to the phone until told otherwise). Changes flow to `{ "type": "wear", "worn": … }`, re-announced on every WS (re)connect. The state machine also gates locally: a `deliver` above `hold` arriving while this client believes the glasses are off-face is presented as `hold` (etiquette rule 2, defensive, round-down only).

### The felt loop

- **Hold-to-talk** (temple-tap PTT stand-in) via platform `SpeechRecognizer`; when no recognition service exists (common on AVDs) the button becomes an **explicit typed-ask dialog** — typed input, never fabricated speech.
- **Research / Quick / Watch** dock actions send the *same canned asks* as the Meta web surface (`clients/meta-rbd/web-app/app.js`), so both clients demo the identical grammar against one Core.
- **Capture**: one CameraX still, downscaled to ≤1024 px JPEG, base64 → WS v2 `capture`. `TODO(XR)`: on real glasses the camera is reached through the **projected context** ([02-android-xr.md](../../../xr-glasses-dev-guide/02-android-xr.md), "AI-glasses camera access") — the source swaps behind `CaptureController`, the contract doesn't.
- **Delivery**: `badge` → amber chip; `earcon` → `ToneGenerator` tone + chip; `speak` → tone + `TextToSpeech` of the Digest TLDR + chip; `hold` → "waiting on your phone" hint. Expanding a badge fetches the Digest via `GET /api/threads/:id` and renders TLDR + ≤3 citation titles — never body text on glasses. Badges expire to the phone after 10 min (spec §7 rule 6).
- Runtime permission requests for `CAMERA` / `RECORD_AUDIO` at launch and again at point of use.

## Tests

Pure-JVM (JUnit4, no emulator): `gradle.bat testDebugUnitTest`

- `WsCodecTest` — WS v2 codec round-trips against the exact `core/README.md` shapes; malformed/out-of-vocabulary frames throw.
- `WearStateSourceTest` — not-worn default, toggle → `{type:"wear"}` wire mapping, wear-gated delivery.
- `SurfaceStateMachineTest` — the full grammar: hint→wait→badge→card→dismiss, `job_update "queued"` arriving before `ask_routed`, hold routing, effects (earcon/speak/expiry), cancellation, failure paths.

Glimmer-only (compiled with `-PenableGlimmer=true`): `src/surface-glimmer-test/.../ProjectedWearLifecycleTest.kt` — where **`ProjectedTestRule`** slots in (mock glasses runtime in a JVM test, DP4 `projected-testing`); asserts on-face → `ON_RESUME` → `worn=true` → wear message. Its API usage is marked unverified pending a resolvable artifact.

## Demo script (ai_glasses AVD, ~2 min)

1. `cd core && npm start` (no API key needed — offline mocks) · launch the `ai_glasses` AVD · install + open the app.
2. Header chip reads **ready**. Flip **Glasses worn (manual)** ON — this sends `{wear: worn=true}`; leave it OFF first if you want to demo rule 2 (everything holds to the phone).
3. Tap **Quick** → fast route → TLDR card appears immediately (canned Answer offline).
4. Tap **Research** → "On it — keep reading. I'll come back." → status `researching…` → ~2.5 s later (mock digest delay) an **amber badge** lands.
5. Tap the badge (pinch stand-in) → Digest TLDR card with ≤3 citation titles → tap the card to dismiss.
6. Tap **Capture** → camera still → status `captured scene` (offline extract renders as *extraction unavailable*, never as content).
7. Hold **Hold to talk** and speak (or tap when speech is unavailable → typed dialog) → ask anything with "find papers…" → watch the background loop again.
8. Toggle worn OFF, run **Research** again → the deliver arrives as `hold`: "A digest arrived quietly — it's waiting on your phone."

## What integration must check first (glimmer path)

1. Do `androidx.xr.glimmer:glimmer` / `androidx.xr.projected:projected` resolve, and at what versions? Only `projected-testing:1.0.0-alpha07` is cited verbatim in the guide; the other coordinates are inferred.
2. Reconcile `GlimmerSurface` imports/signatures (`TitleChip`, `Card`, `Button` content lambdas) and `ProjectedTestRule`'s real API with the shipped alpha.
3. Replace `ProjectedLifecycleWearSource`'s raw lifecycle observation with the dedicated Device Availability listener if the alpha exposes one.
4. Host the activity in the Projected context and swap `CaptureController`'s camera source to the projected-context camera (`/jetpack-xr-sdk/access-hardware-projected-context`).

Mirror the official [`android/ai-samples` `prototype-ai-glasses`](https://github.com/android/ai-samples/tree/prototype-ai-glasses) sample for exact Glimmer + Gemini Live shapes, and see the [Catalyst Program](../../../xr-glasses-dev-guide/12-io-2026-updates.md) for pre-release eyewear.
