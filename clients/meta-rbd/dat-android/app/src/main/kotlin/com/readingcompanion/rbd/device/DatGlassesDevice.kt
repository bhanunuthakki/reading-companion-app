// DatGlassesDevice — the REAL Meta DAT implementation of GlassesDevice.
//
// ENTIRELY COMMENTED OUT ON PURPOSE. The demo target is the phone emulator with
// zero Meta artifacts (thought-partner-spec.md §8.1); this file exists so the
// hardware seam is written down at real coordinates, not re-invented later. The
// main build must NEVER depend on Meta's maven resolving — do not uncomment
// without also uncommenting the mwdat-* dependencies in app/build.gradle.kts
// and adding Meta's maven repo in settings.gradle.kts.
//
// TODO(DAT): to go live on hardware (xr-glasses-dev-guide/03-meta-glasses.md):
//   1. settings.gradle.kts — add Meta's Maven repo per
//      https://github.com/facebook/meta-wearables-dat-android
//   2. app/build.gradle.kts — uncomment:
//        implementation("com.meta.wearable:mwdat-core:<version>")
//        implementation("com.meta.wearable:mwdat-camera:<version>")
//        debugImplementation("com.meta.wearable:mwdat-mockdevice:<version>")
//   3. res/values/strings.xml — set mwdat_app_id from the Wearables Developer
//      Center (the manifest <meta-data com.meta.wearable.mwdat.APPLICATION_ID>
//      already points at it).
//   4. Uncomment this file, finish the TODO(DAT) bodies against the current
//      DAT API (the names below follow the DAT sample apps; verify against the
//      release you pin — the toolkit is in developer preview and churns).
//   5. Develop against mwdat-mockdevice FIRST (03-meta-glasses.md: simulates
//      camera frames, audio, gesture events, permissions without hardware),
//      then a paired device via Developer Mode + a release channel
//      (100-tester cap during preview).
//
// What DAT gives this class (03-meta-glasses.md "What hardware does DAT
// expose"): stills + 720p30 BLE video, 5-mic beamformed single stream,
// mono/stereo speaker out, cooked gestures. What it does NOT give (never work
// around): raw EMG, Meta AI pipeline, custom wake words, face recognition.
//
// package com.readingcompanion.rbd.device
//
// import android.content.Context
// import com.meta.wearable.mwdat.core.WearableDeviceManager          // TODO(DAT): verify class names
// import com.meta.wearable.mwdat.camera.CameraController              // against the pinned release
//
// class DatGlassesDevice(private val context: Context) : GlassesDevice {
//
//     private var listener: GlassesDevice.Listener? = null
//     private var dat: WearableDeviceManager? = null
//
//     // DAT has no explicit on-face sensor in the public preview; wear state is
//     // inferred from device-connection state (thought-partner-spec.md §6:
//     // "Meta DAT infers from device-connection state").
//     @Volatile private var worn = false
//     override val isWorn: Boolean get() = worn
//
//     override fun connect(listener: GlassesDevice.Listener) {
//         this.listener = listener
//         // TODO(DAT): entry point + device discovery/registration.
//         // dat = WearableDeviceManager.getInstance(context)
//         // dat.registerDeviceListener { device, connected ->
//         //     worn = connected                       // connection ≈ on-face proxy
//         //     listener.onConnectionState(connected, "DAT device ${device.name}")
//         //     listener.onWearState(connected)
//         // }
//         // TODO(DAT): cooked gesture subscription (Neural Band / temple):
//         // dat.gestures.onTap        { listener.onGesture(GlassesDevice.Gesture.TAP) }
//         // dat.gestures.onLongPressStart { listener.onGesture(GlassesDevice.Gesture.LONG_PRESS_START) }
//         // dat.gestures.onLongPressEnd   { listener.onGesture(GlassesDevice.Gesture.LONG_PRESS_END) }
//     }
//
//     override fun disconnect() {
//         // TODO(DAT): dat?.disconnect()
//         listener = null
//     }
//
//     override fun captureStill(onJpeg: (ByteArray) -> Unit, onError: (Throwable) -> Unit) {
//         // One still per call — the alerted-level action. 04-cameras.md: stills
//         // are higher-res than the 720p30 BLE stream; transfer is a 1–2 MB BLE
//         // burst (hardware-capability-spec.md §5 budgets 800–1500 ms; fire at
//         // gesture-down, in parallel with the user's speech).
//         // TODO(DAT): dat.camera.captureStill(
//         //     onResult = { jpegBytes -> onJpeg(jpegBytes) },
//         //     onError = { e -> onError(e) },
//         // )
//     }
//
//     override fun startMicCapture(onPcmChunk: (ByteArray) -> Unit, onError: (Throwable) -> Unit) {
//         // 05-audio.md: the OS beamforms the 5-mic array to a single processed
//         // stream; there is no raw per-mic access. Open ONLY during the PTT
//         // window (hardware-capability-spec.md §2 — mic ≤ 10 s at alerted).
//         // TODO(DAT): dat.audio.startCapture { chunk -> onPcmChunk(chunk) }
//     }
//
//     override fun stopMicCapture() {
//         // TODO(DAT): dat.audio.stopCapture()
//     }
//
//     override fun playAudio(pcm16MonoLe: ByteArray, sampleRateHz: Int) {
//         // Open-ear speakers, mono playback (05-audio.md). Core emits 24 kHz
//         // mono PCM16; resample here if the pinned DAT release expects another
//         // rate — fail loudly rather than play garbled audio.
//         // TODO(DAT): dat.audio.play(pcm16MonoLe, sampleRateHz)
//     }
//
//     override fun playEarcon() {
//         // TODO(DAT): pre-render the earcon as PCM and route through
//         // dat.audio.play — ToneGenerator plays on the PHONE speaker, which is
//         // the wrong surface once real glasses are connected.
//     }
// }
