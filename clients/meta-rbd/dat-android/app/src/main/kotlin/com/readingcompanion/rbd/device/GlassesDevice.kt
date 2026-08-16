package com.readingcompanion.rbd.device

/**
 * GlassesDevice — the facade over glasses hardware I/O and the app's critical
 * seam. hardware-capability-spec.md §3 names this choke point: raw sensor data
 * dies as early as the platform allows, and everything above this interface
 * sees only JPEG bytes, PCM chunks, and cooked gesture events.
 *
 * The surface mirrors EXACTLY what Meta DAT provides on the phone
 * (xr-glasses-dev-guide/03-meta-glasses.md, 04-cameras.md, 05-audio.md):
 *
 *  - connect/disconnect + wear state  (DAT infers wear from device connection)
 *  - captureStill(): one JPEG          (stills are the default; 720p30 BLE
 *                                       video is reserved for escalation)
 *  - startMicCapture()/stopMicCapture(): the beamformed single mic stream
 *                                       (no raw per-mic access anywhere)
 *  - playAudio()/playEarcon():          open-ear speaker out
 *  - gesture events:                    cooked only (tap/pinch, long-press);
 *                                       raw Neural Band EMG is reserved
 *
 * Implementations:
 *  - [EmulatedGlassesDevice] — default; zero Meta artifacts. Phone camera/mic/
 *    speaker stand in for the glasses; on-screen buttons stand in for gestures.
 *  - DatGlassesDevice — the real DAT wiring, kept fully commented out in
 *    DatGlassesDevice.kt so the build NEVER depends on Meta's maven resolving.
 *
 * ── EscalationLevel seam (hardware-capability-spec.md §2) ──────────────────
 * The battery ladder (`idle → alerted → active`, DEFINITIONS.md
 * EscalationLevel) hooks in HERE when the Core's CaptureOrchestrator drives a
 * native client: `alerted` is exactly one [captureStill] per trigger (what v1
 * ships); `active` would add a `startLowFpsVideo(fps <= 1)` method to this
 * interface, feeding the v1 `frame` WS message. That method is deliberately
 * absent in v1 — no continuous frame loop exists anywhere in this app, so no
 * code path can burn the BLE radio by accident. Delivery never promotes the
 * ladder (a Digest arriving while idle costs zero sensor wake-ups).
 */
interface GlassesDevice {

    /** Cooked gestures only — mirrors DAT/Neural Band's public surface. */
    enum class Gesture {
        /** Thumb+index pinch / temple tap: confirm or dismiss. */
        TAP,

        /** Temple long-press begins: push-to-talk opens (capture + mic). */
        LONG_PRESS_START,

        /** Temple long-press released: push-to-talk closes. */
        LONG_PRESS_END,
    }

    interface Listener {
        fun onConnectionState(connected: Boolean, detail: String)

        /** On-face state. Feeds the Core's `wear` message (DeliveryEngine rule 2). */
        fun onWearState(worn: Boolean)

        fun onGesture(gesture: Gesture)
    }

    /** Latest known wear state; defaults to false (mirrors the Core's default). */
    val isWorn: Boolean

    fun connect(listener: Listener)

    fun disconnect()

    /**
     * Capture ONE still as JPEG bytes. On-demand only — this is the
     * `alerted`-level action of the EscalationLevel ladder; there is no
     * repeating variant on purpose.
     */
    fun captureStill(onJpeg: (ByteArray) -> Unit, onError: (Throwable) -> Unit)

    /**
     * Open the (beamformed) mic and stream PCM16 mono chunks at [MIC_SAMPLE_RATE_HZ]
     * until [stopMicCapture]. Used for the v1 `mic` live-voice path; the v2
     * felt loop uses platform STT instead (see ReadingCompanionController).
     */
    fun startMicCapture(onPcmChunk: (ByteArray) -> Unit, onError: (Throwable) -> Unit)

    fun stopMicCapture()

    /** Play PCM16 mono at [sampleRateHz] on the open-ear speaker (Core emits 24 kHz). */
    fun playAudio(pcm16MonoLe: ByteArray, sampleRateHz: Int)

    /** Short soft tone — the `earcon` InterruptLevel rendering. */
    fun playEarcon()

    companion object {
        /** Mic capture format offered to the Core's live voice path. */
        const val MIC_SAMPLE_RATE_HZ = 16_000

        /** Core's `audio` frames are 24 kHz mono PCM16. */
        const val CORE_AUDIO_SAMPLE_RATE_HZ = 24_000
    }
}
