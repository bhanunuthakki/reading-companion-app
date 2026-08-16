package com.readingcompanion.rbd

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.text.InputType
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.ToggleButton
import androidx.activity.ComponentActivity
import androidx.core.app.ActivityCompat
import com.readingcompanion.rbd.device.EmulatedGlassesDevice
import java.util.Locale

/**
 * The felt loop on one screen (thought-partner-spec.md §3), phone-side Meta
 * client. UI toolkit: plain programmatic Views, continuing the skeleton's
 * choice — a single dev screen with ~10 widgets doesn't justify the Compose
 * compiler, its build time, or its APK weight; the glanceable product surface
 * is the 600×600 web-app, not this screen.
 *
 * Sections top-to-bottom:
 *   1. Core URL (persisted) + connect toggle + status line
 *   2. Wear toggle (the `wear` signal; Core defaults to not-worn)
 *   3. Gesture stand-ins: hold-to-talk (temple long-press), tap (pinch),
 *      capture still
 *   4. Live ResearchJob state chips (tap a queued/running chip to cancel)
 *   5. Delivery pane: level-labeled deliveries (hold/badge/earcon/speak) —
 *      earcon rings the device tone, speak also reads the tldr via TTS
 *   6. Log pane
 */
class MainActivity : ComponentActivity(), ReadingCompanionController.Ui {

    private lateinit var device: EmulatedGlassesDevice
    private var controller: ReadingCompanionController? = null

    private lateinit var statusText: TextView
    private lateinit var coreUrlInput: EditText
    private lateinit var connectToggle: ToggleButton
    private lateinit var wearToggle: ToggleButton
    private lateinit var pttButton: Button
    private lateinit var jobsPane: LinearLayout
    private lateinit var deliveryPane: LinearLayout
    private lateinit var logView: TextView

    private val jobChips = LinkedHashMap<String, TextView>()
    private val jobStates = HashMap<String, JobState>()

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var recognizer: SpeechRecognizer? = null

    private var coreConnected = false
    private var deviceDetail = "device off"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        device = EmulatedGlassesDevice(this, this)
        tts = TextToSpeech(this) { status -> ttsReady = status == TextToSpeech.SUCCESS }

        setContentView(buildUi())
        ActivityCompat.requestPermissions(
            this,
            arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO),
            PERMISSIONS_REQUEST,
        )
    }

    override fun onDestroy() {
        controller?.stop()
        controller = null
        recognizer?.destroy()
        tts?.shutdown()
        super.onDestroy()
    }

    // ── UI construction (plain Views, programmatic) ─────────────────────────

    @SuppressLint("ClickableViewAccessibility", "SetTextI18n")
    private fun buildUi(): ScrollView {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        statusText = TextView(this).apply {
            text = "core: disconnected · device off"
            setTypeface(null, Typeface.BOLD)
        }

        coreUrlInput = EditText(this).apply {
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            hint = "ws://10.0.2.2:4000/ws"
            setText(prefs.getString(KEY_CORE_URL, DEFAULT_CORE_URL))
        }

        connectToggle = ToggleButton(this).apply {
            textOn = "Connected — tap to disconnect"
            textOff = "Connect to Core"
            setOnCheckedChangeListener { _, on ->
                if (on) startSession(prefs) else stopSession()
            }
        }

        wearToggle = ToggleButton(this).apply {
            textOn = "Glasses: WORN"
            textOff = "Glasses: not worn (deliveries hold to phone)"
            setOnCheckedChangeListener { _, on -> device.setWorn(on) }
        }

        pttButton = Button(this).apply {
            text = "HOLD to talk (temple long-press)"
            setOnTouchListener { v, ev ->
                when (ev.action) {
                    MotionEvent.ACTION_DOWN -> device.simulateLongPressStart()
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> device.simulateLongPressEnd()
                }
                false // let the button still animate
            }
        }

        val tapButton = Button(this).apply {
            text = "Tap (pinch)"
            setOnClickListener { device.simulateTap() }
        }
        val captureButton = Button(this).apply {
            text = "Capture still"
            setOnClickListener { withController { it.captureStill() } }
        }
        val typeButton = Button(this).apply {
            text = "Type a question"
            setOnClickListener { promptTypedQuestion(null) }
        }
        val newThreadButton = Button(this).apply {
            text = "New Thread"
            setOnClickListener { withController { it.resetThread() } }
        }

        jobsPane = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        deliveryPane = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        logView = TextView(this).apply {
            typeface = Typeface.MONOSPACE
            textSize = 11f
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
            addView(statusText, lp())
            addView(label("Core WebSocket URL (persisted)"))
            addView(coreUrlInput, lp())
            addView(connectToggle, lp())
            addView(wearToggle, lp())
            addView(pttButton, lp())
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(tapButton, rowLp())
                addView(captureButton, rowLp())
            }, lp())
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(typeButton, rowLp())
                addView(newThreadButton, rowLp())
            }, lp())
            addView(label("ResearchJobs (tap a queued/running chip to cancel)"))
            addView(HorizontalScrollView(this@MainActivity).apply { addView(jobsPane) }, lp())
            addView(label("Deliveries (hold < badge < earcon < speak)"))
            addView(deliveryPane, lp())
            addView(label("Log"))
            addView(logView, lp())
        }
        return ScrollView(this).apply { addView(root) }
    }

    private fun label(text: String) = TextView(this).apply {
        this.text = text
        setTypeface(null, Typeface.BOLD)
        setPadding(0, 24, 0, 4)
    }

    private fun lp() = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
    private fun rowLp() = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f)

    // ── Session lifecycle ────────────────────────────────────────────────────

    private fun startSession(prefs: android.content.SharedPreferences) {
        val url = coreUrlInput.text.toString().trim()
        if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
            log("invalid Core URL '$url' — must start with ws:// or wss://")
            connectToggle.isChecked = false
            return
        }
        prefs.edit().putString(KEY_CORE_URL, url).apply()
        coreUrlInput.isEnabled = false
        controller = ReadingCompanionController(device, url).also {
            it.ui = this
            it.start()
        }
        // Re-assert the toggle's wear state for the new session (Core default
        // is not-worn; the controller re-syncs on every reconnect too).
        device.setWorn(wearToggle.isChecked)
        log("session started → $url")
    }

    private fun stopSession() {
        controller?.stop()
        controller = null
        coreUrlInput.isEnabled = true
        coreConnected = false
        renderStatus()
        log("session stopped")
    }

    private inline fun withController(action: (ReadingCompanionController) -> Unit) {
        val c = controller
        if (c == null) log("not connected — toggle 'Connect to Core' first") else action(c)
    }

    // ── ReadingCompanionController.Ui (marshalled to main thread) ───────────

    override fun onCoreConnection(connected: Boolean, detail: String) = runOnUiThread {
        coreConnected = connected
        renderStatus()
        log("core: $detail")
    }

    override fun onDeviceConnection(connected: Boolean, detail: String) = runOnUiThread {
        deviceDetail = detail
        renderStatus()
        log("device: $detail")
    }

    override fun onWearState(worn: Boolean) = runOnUiThread {
        log("wear → ${if (worn) "worn" else "not worn"} (sent to Core)")
    }

    @SuppressLint("SetTextI18n")
    override fun onAskRouted(event: CoreEvent.AskRouted) = runOnUiThread {
        when (event.route) {
            "fast" -> {
                val answer = event.answer
                if (answer == null) {
                    log("ask_routed fast WITHOUT answer — Core contract violation")
                } else {
                    // Fast-path Answer default level is speak — it was just
                    // asked for (spec §7 rule 3).
                    addDelivery("[speak] ${answer.text}", Color.rgb(0x1B, 0x5E, 0x20))
                    answer.citations.take(3).forEachIndexed { i, c ->
                        addDelivery("    ${i + 1}. ${c.title}", Color.DKGRAY)
                    }
                    speakAloud(answer.text)
                }
            }
            "background" -> log("routed background → job ${event.jobId} (\"on it — I'll come back\")")
        }
    }

    override fun onJobUpdate(jobId: String, state: JobState) = runOnUiThread {
        jobStates[jobId] = state
        val chip = jobChips.getOrPut(jobId) {
            TextView(this).apply {
                setPadding(24, 12, 24, 12)
                setOnClickListener {
                    val current = jobStates[jobId]
                    if (current == JobState.QUEUED || current == JobState.RUNNING) {
                        withController { it.cancelJob(jobId) }
                    } else {
                        log("job $jobId is ${current?.wire} — nothing to cancel")
                    }
                }
                jobsPane.addView(this, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply {
                    marginEnd = 16
                })
            }
        }
        chip.text = "${jobId.take(8)}: ${state.wire}"
        chip.setBackgroundColor(
            when (state) {
                JobState.QUEUED -> Color.rgb(0x90, 0xA4, 0xAE)
                JobState.RUNNING -> Color.rgb(0x42, 0xA5, 0xF5)
                JobState.DIGEST_READY -> Color.rgb(0xFF, 0xB3, 0x00)
                JobState.DELIVERED -> Color.rgb(0x66, 0xBB, 0x6A)
                JobState.ARCHIVED -> Color.rgb(0xBD, 0xBD, 0xBD)
                JobState.FAILED -> Color.rgb(0xEF, 0x53, 0x50)
            },
        )
        chip.setTextColor(Color.BLACK)
    }

    override fun onDeliver(event: CoreEvent.Deliver) = runOnUiThread {
        val text = event.badge ?: event.tldr ?: "digest ready"
        when (event.level) {
            InterruptLevel.HOLD ->
                addDelivery("[hold → ${event.surface}] waiting quietly (full digest on the phone thread)", Color.GRAY)
            InterruptLevel.BADGE ->
                addDelivery("[badge] $text", AMBER)
            InterruptLevel.EARCON ->
                // The tone already rang via the device facade (controller).
                addDelivery("[earcon] $text", AMBER)
            InterruptLevel.SPEAK -> {
                addDelivery("[speak] ${event.tldr ?: text}", Color.rgb(0x1B, 0x5E, 0x20))
                event.tldr?.let { speakAloud(it) }
                    ?: log("speak-level deliver without tldr — nothing to read aloud")
            }
        }
    }

    override fun onSpeechRequested() = runOnUiThread { startSpeechInput() }

    override fun onSpeechEnded() = runOnUiThread { recognizer?.stopListening() }

    override fun onLog(line: String) = runOnUiThread { log(line) }

    // ── Speech input: SpeechRecognizer, explicit typed fallback ─────────────

    private fun startSpeechInput() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            log("no speech-recognition service on this device/emulator — type instead")
            promptTypedQuestion("Speech recognition unavailable — type your question")
            return
        }
        recognizer?.destroy()
        recognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
            setRecognitionListener(object : RecognitionListener {
                override fun onResults(results: Bundle) {
                    val question = results
                        .getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()
                        ?.trim()
                    if (question.isNullOrBlank()) {
                        log("speech: empty result — type instead")
                        promptTypedQuestion("Didn't catch that — type your question")
                    } else {
                        log("heard: \"$question\"")
                        withController { it.submitQuestion(question) }
                    }
                }

                override fun onError(error: Int) {
                    // Explicit fallback, never fabricated input.
                    log("speech error $error — type instead")
                    promptTypedQuestion("Speech failed (code $error) — type your question")
                }

                override fun onReadyForSpeech(params: Bundle?) {
                    log("listening… (release to finish)")
                }

                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            startListening(
                Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(
                        RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                    )
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag()),
            )
        }
    }

    private fun promptTypedQuestion(reason: String?) {
        val input = EditText(this).apply {
            hint = "e.g. compare the literature on spaced repetition versus rereading"
        }
        AlertDialog.Builder(this)
            .setTitle(reason ?: "Type a question")
            .setView(input)
            .setPositiveButton("Ask") { _, _ ->
                val question = input.text.toString().trim()
                if (question.isBlank()) log("empty question — nothing sent")
                else withController { it.submitQuestion(question) }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // ── Rendering helpers ────────────────────────────────────────────────────

    private fun renderStatus() {
        statusText.text =
            "core: ${if (coreConnected) "connected" else "disconnected"} · $deviceDetail"
        statusText.setTextColor(if (coreConnected) Color.rgb(0x1B, 0x5E, 0x20) else Color.rgb(0xB7, 0x1C, 0x1C))
    }

    private fun addDelivery(text: String, color: Int) {
        val entry = TextView(this).apply {
            this.text = text
            setTextColor(color)
            setPadding(8, 8, 8, 8)
        }
        deliveryPane.addView(entry, 0) // newest first
    }

    private fun speakAloud(text: String) {
        if (ttsReady) {
            tts?.speak(text, TextToSpeech.QUEUE_ADD, null, "digest-${System.nanoTime()}")
        } else {
            log("TTS not ready — spoken delivery shown as text only")
        }
    }

    private fun log(line: String) {
        logView.append("$line\n")
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != PERMISSIONS_REQUEST) return
        permissions.forEachIndexed { i, perm ->
            val granted = grantResults.getOrNull(i) == android.content.pm.PackageManager.PERMISSION_GRANTED
            log("permission $perm: ${if (granted) "granted" else "DENIED (capture/mic will fail loudly)"}")
        }
    }

    private companion object {
        const val PREFS = "rbd-client"
        const val KEY_CORE_URL = "coreUrl"

        /** 10.0.2.2 = host loopback from the Android emulator (emulator → host Core). */
        const val DEFAULT_CORE_URL = "ws://10.0.2.2:4000/ws"

        const val PERMISSIONS_REQUEST = 1

        /** Amber — matches the web-app's badge chip color grammar (spec §8.1). */
        val AMBER = Color.rgb(0xFF, 0x8F, 0x00)
    }
}
