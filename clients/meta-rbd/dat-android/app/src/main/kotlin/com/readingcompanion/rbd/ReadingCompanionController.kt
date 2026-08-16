package com.readingcompanion.rbd

import com.readingcompanion.rbd.device.GlassesDevice

/**
 * The Client's brain (DEFINITIONS.md: Client — a per-platform thin app that
 * captures sensors and renders results, talking to the Core over WS/REST).
 * Wires the [GlassesDevice] facade to the [CoreClient] and owns the felt loop:
 *
 *   PTT gesture down ──► captureStill (fires at gesture-down, in parallel with
 *        │                speech — hardware-capability-spec.md §5)
 *        │                └► downscale ≤1024 px ─► capture ─► capture_stored
 *        └► UI starts STT
 *   PTT gesture up  ──► UI finishes STT ─► submitQuestion
 *                        └► ask { question, captureId?, threadId? }
 *   Core ──► job_update "queued" (BEFORE ask_routed — core/README.md)
 *        ──► ask_routed (fast: speak Answer now · background: job chip)
 *        ──► job_update running/digest_ready/…
 *        ──► deliver { level, tldr, badge } ─► earcon/speak via the device
 *
 * Speech-to-text deliberately lives in the UI layer (SpeechRecognizer needs an
 * Activity context and its own mic session): the controller only receives the
 * final question text. On real DAT hardware, STT would instead consume the
 * facade's startMicCapture stream.
 *
 * All callbacks may arrive on background threads (OkHttp/CameraX executors);
 * the [Ui] implementation marshals to the main thread.
 */
class ReadingCompanionController(
    private val device: GlassesDevice,
    coreUrl: String,
) {

    interface Ui {
        fun onCoreConnection(connected: Boolean, detail: String)
        fun onDeviceConnection(connected: Boolean, detail: String)
        fun onWearState(worn: Boolean)
        fun onAskRouted(event: CoreEvent.AskRouted)
        fun onJobUpdate(jobId: String, state: JobState)
        fun onDeliver(event: CoreEvent.Deliver)

        /** PTT opened (gesture or button): start listening / show input. */
        fun onSpeechRequested()

        /** PTT released: finish listening. */
        fun onSpeechEnded()

        fun onLog(line: String)
    }

    var ui: Ui? = null

    // ── GlassesDevice.Listener (device side of the seam) ────────────────────

    private val deviceListener: GlassesDevice.Listener = object : GlassesDevice.Listener {
        override fun onConnectionState(connected: Boolean, detail: String) {
            ui?.onDeviceConnection(connected, detail)
        }

        override fun onWearState(worn: Boolean) {
            // DeliveryEngine rule 2: never deliver to glasses that aren't worn.
            // Forwarding the wear signal is this client's job.
            core.wear(worn)
            ui?.onWearState(worn)
        }

        override fun onGesture(gesture: GlassesDevice.Gesture) {
            when (gesture) {
                GlassesDevice.Gesture.LONG_PRESS_START -> {
                    // Capture fires at gesture-down, in parallel with the user's
                    // speech (hardware-capability-spec.md §5 latency budget).
                    captureStill()
                    ui?.onSpeechRequested()
                }
                GlassesDevice.Gesture.LONG_PRESS_END -> ui?.onSpeechEnded()
                GlassesDevice.Gesture.TAP ->
                    // On the display surface TAP (pinch) confirms/opens the
                    // focused card — that surface is the 600×600 web-app. Here
                    // it is logged so the gesture path is visibly alive.
                    ui?.onLog("gesture: tap (pinch) — display-surface confirm")
            }
        }
    }

    // ── CoreClient.Listener (Core side of the seam) ─────────────────────────

    private val coreListener: CoreClient.Listener = object : CoreClient.Listener {
        override fun onConnectionState(connected: Boolean, detail: String) {
            if (connected) {
                // Wear state defaults to not-worn on the Core and a new socket
                // is a new default — re-sync on every (re)connect.
                core.wear(device.isWorn)
            }
            ui?.onCoreConnection(connected, detail)
        }

        override fun onEvent(event: CoreEvent) = handleCoreEvent(event)
    }

    private val core: CoreClient = CoreClient(coreUrl, coreListener)

    /** capture_stored id awaiting its ask; consumed by [submitQuestion]. */
    @Volatile private var pendingCaptureId: String? = null

    /** Thread continuity: asks reuse the last routed threadId until [resetThread]. */
    @Volatile private var activeThreadId: String? = null

    @Volatile private var started = false

    fun start() {
        if (started) return
        started = true
        device.connect(deviceListener)
        core.connect()
    }

    fun stop() {
        if (!started) return
        started = false
        device.disconnect()
        core.shutdown()
    }

    // ── User actions (from gestures or on-screen controls) ──────────────────

    /** One still → downscale → Capture. The `alerted` EscalationLevel action. */
    fun captureStill(hintKind: String = "page") {
        device.captureStill(
            onJpeg = { jpeg ->
                try {
                    val scaled = JpegUtil.downscale(jpeg)
                    val b64 = java.util.Base64.getEncoder().encodeToString(scaled)
                    ui?.onLog("still captured: ${jpeg.size} B → ${scaled.size} B (≤${JpegUtil.MAX_DIMENSION_PX} px)")
                    core.capture(b64, hintKind, activeThreadId)
                } catch (e: Exception) {
                    ui?.onLog("capture processing FAILED: ${e.message}")
                }
            },
            onError = { e -> ui?.onLog("capture FAILED: ${e.message}") },
        )
    }

    /**
     * Send the spoken/typed question. Attaches the pending captureId (if a
     * still landed) and the active threadId (if a Thread exists). No threadId
     * → the Core auto-creates a Thread (core/README.md).
     */
    fun submitQuestion(question: String) {
        val captureId = pendingCaptureId
        pendingCaptureId = null
        core.ask(question, captureId, activeThreadId)
        ui?.onLog("ask: \"$question\"" +
            (captureId?.let { " [capture $it]" } ?: "") +
            (activeThreadId?.let { " [thread $it]" } ?: " [new thread]"))
    }

    fun cancelJob(jobId: String) {
        core.jobCancel(jobId)
        ui?.onLog("job_cancel: $jobId")
    }

    /** Start a fresh Thread on the next ask. */
    fun resetThread() {
        activeThreadId = null
        ui?.onLog("thread reset — next ask starts a new Thread")
    }

    // ── Core event routing ───────────────────────────────────────────────────

    private fun handleCoreEvent(event: CoreEvent) {
        when (event) {
            is CoreEvent.CaptureStored -> {
                pendingCaptureId = event.captureId
                ui?.onLog("capture_stored: ${event.captureId} (kind=${event.kind})")
            }
            is CoreEvent.AskRouted -> {
                activeThreadId = event.threadId
                ui?.onAskRouted(event)
            }
            is CoreEvent.JobUpdate -> ui?.onJobUpdate(event.jobId, event.state)
            is CoreEvent.Deliver -> {
                // Etiquette rendering at the device: earcon and speak both ring
                // the soft tone (spec §8.1: speak = TTS TLDR then badge; the
                // spoken TLDR itself is rendered by the UI's TextToSpeech).
                if (event.level >= InterruptLevel.EARCON) device.playEarcon()
                ui?.onDeliver(event)
            }
            is CoreEvent.AudioOut ->
                device.playAudio(event.pcm, GlassesDevice.CORE_AUDIO_SAMPLE_RATE_HZ)
            is CoreEvent.AnswerEvent ->
                ui?.onLog("answer (v1): ${event.answer.text}")
            is CoreEvent.WatcherArmed ->
                ui?.onLog("watcher armed: ${event.topic}")
            is CoreEvent.Opened ->
                ui?.onLog("session opened (v1): ${event.sessionState}")
            is CoreEvent.Transcript ->
                ui?.onLog("transcript: ${event.text}")
            CoreEvent.PageObserved ->
                ui?.onLog("page observed (v1)")
            is CoreEvent.ErrorEvent ->
                ui?.onLog("CORE ERROR: ${event.message}")
            is CoreEvent.ProtocolError ->
                ui?.onLog("PROTOCOL ERROR: ${event.message}")
            is CoreEvent.Unknown ->
                ui?.onLog("unknown frame type '${event.type}' — Core newer than client?")
        }
    }
}
