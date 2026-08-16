# Meta Ray-Ban Display client

Meta splits camera and display across two surfaces, so this client is two cooperating pieces, both thin clients of the [Core](../../core):

| Piece | Runtime | Owns | Status |
|-------|---------|------|--------|
| [`web-app/`](web-app) | HTML/JS sandbox **on the Display** (600×600) | the glanceable UI: answer cards, citations, watcher badges; Neural-Band-as-D-pad input | **functional** — runs in any browser today |
| [`dat-android/`](dat-android) | Kotlin app **on the phone** | glasses camera stills, 5-mic audio, Neural Band gestures, open-ear playback | **functional on the emulator** — WS v2 felt loop against an emulated `GlassesDevice`; real DAT wiring kept as a commented seam (`TODO(DAT)`) |

Why two pieces: the Web Apps path is the only way to render on the Ray-Ban Display, but it has **no camera/mic access**; DAT-Android has the camera/mic/gestures but doesn't draw on the display. Together they cover the device. Both talk to the same Core. See [`../../cross-platform-build-plan.md`](../../cross-platform-build-plan.md) §3.2.

## Run the display UI today (Windows-friendly)

```bash
# 1. start the Core (separate terminal)
cd ../../core && npm start

# 2. serve the web-app and open it at 600x600
cd ../clients/meta-rbd/web-app
npx http-server -p 5601 .      # or: python -m http.server 5601
# open http://localhost:5601/?core=ws://localhost:4000/ws  and size the window to 600x600
```

Arrow keys move focus, Enter activates (exactly how the Neural Band drives the page). "Ask"/"Watch"/"Recap" exercise the Core. This is the same loop Meta's web-app guide describes; deploy to any HTTPS host and add it as a release channel in the Wearables Developer Center to run on real glasses.

## Build the phone app

`dat-android/` is a standard Gradle/Kotlin project that builds and runs on the
Android emulator with **zero Meta artifacts** — the phone emulates the glasses
behind the `GlassesDevice` facade. Build commands, the facade→DAT mapping, and
the emulator demo script are in [`dat-android/README.md`](dat-android/README.md).
To go to real hardware, follow the `TODO(DAT)` steps at the top of
`dat-android/app/src/main/kotlin/com/readingcompanion/rbd/device/DatGlassesDevice.kt`
(Meta maven repo + `mwdat-*` deps + `mwdat_app_id`), developing against
`mwdat-mockdevice` first.

## What's real vs deferred

- **Real now:** the display UI, the phone app's full WS v2 felt loop (PTT →
  capture → ask → job chips → etiquette-laddered delivery) on the emulator, the
  Core WS protocol, and the session/research/voice/dossier brain behind it.
- **Deferred (needs hardware/SDK):** the DAT camera/mic/gesture wiring inside
  the commented `DatGlassesDevice`, on-glasses audio playback, and production
  publishing (DAT is capped at 100 testers during preview).
