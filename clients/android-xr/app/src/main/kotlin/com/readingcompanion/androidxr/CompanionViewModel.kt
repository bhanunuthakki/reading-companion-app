package com.readingcompanion.androidxr

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONException

/** Everything the glasses surface renders — one immutable snapshot. */
data class CompanionUiState(
    val connected: Boolean = false,
    val status: String = "connecting",
    val stage: Stage = Stage.Hint(SurfaceStateMachine.HINT_DEFAULT),
    val worn: Boolean = false,
    val manualWear: Boolean = true, // whether the wear toggle should render
    val coreUrl: String = "",
    val listening: Boolean = false,
    val speechAvailable: Boolean = false,
    val cancellableJobId: String? = null,
    val lastError: String? = null,
)

/** Audio side-effect sink (ToneGenerator earcon + TextToSpeech), seam for tests. */
interface DeliveryAudio {
    fun playEarcon()
    fun speak(text: String)
}

/**
 * Orchestrates CoreClient (WS v2), CoreRest, the SurfaceStateMachine, and the
 * WearStateSource. Pure coordination — presentation grammar lives in the
 * machine, transport in the client, so both stay unit-testable without this
 * class. Runs its callbacks onto [scope] (Main on device).
 */
class CompanionViewModel(
    initialCoreUrl: String,
    private val wearSource: WearStateSource,
    private val audio: DeliveryAudio,
    private val scope: CoroutineScope,
    private val rest: CoreRest = CoreRest(),
) {
    private val machine = SurfaceStateMachine()
    private val client = CoreClient(initialCoreUrl, scope)

    private val _ui = MutableStateFlow(
        CompanionUiState(coreUrl = initialCoreUrl, manualWear = wearSource is ManualWearSource),
    )
    val ui: StateFlow<CompanionUiState> = _ui.asStateFlow()

    private var connected = false
    private var listening = false
    private var speechAvailable = false
    private var badgeExpiryJob: Job? = null
    private var researchIdx = 0

    fun start() {
        client.onOpen = {
            scope.launch {
                connected = true
                run(machine.onSocketOpen())
                // Wear state defaults to not-worn on the Core — (re)announce ours
                // on every (re)connect (core/README.md behavioral contract).
                client.send(WsCodec.wear(wearSource.worn.value))
                refresh()
            }
        }
        client.onText = { text ->
            scope.launch { handleText(text) }
        }
        client.onClosed = {
            scope.launch {
                connected = false
                run(machine.onSocketClosed())
                refresh()
            }
        }
        client.connect()

        scope.launch {
            wearSource.worn.collect { worn ->
                run(machine.onWornChanged(worn))
                client.send(WsCodec.wear(worn))
                refresh()
            }
        }
    }

    fun stop() {
        client.shutdown()
    }

    // ── User intents (SurfaceActions targets) ───────────────────────────────

    /** One spoken/typed question → WS v2 `ask`. Reuses the active Thread. */
    fun ask(question: String) {
        if (question.isBlank()) return
        val sent = client.send(WsCodec.ask(question = question, threadId = machine.state.threadId))
        if (sent) run(machine.onAskSubmitted()) else noteOffline()
        refresh()
    }

    /** Canned Research ask — same rotation as the Meta 600×600 surface. */
    fun quickResearch() {
        val question = RESEARCH_ASKS[researchIdx % RESEARCH_ASKS.size]
        researchIdx += 1
        ask(question)
    }

    /** Canned Quick ask — fast-path question, mirrors the Meta surface. */
    fun quickAsk() = ask(QUICK_ASK)

    /** Arm a Watcher (v1 `watch`, unchanged in v2). */
    fun watch() {
        if (!client.send(WsCodec.watch(WATCH_TOPIC))) noteOffline()
        refresh()
    }

    /** A captured still (≤1024 px JPEG, base64) → WS v2 `capture`. */
    fun capture(imageBase64: String, hintKind: String? = null) {
        val sent = client.send(
            WsCodec.capture(imageBase64 = imageBase64, hintKind = hintKind, threadId = machine.state.threadId),
        )
        if (!sent) noteOffline()
        refresh()
    }

    fun cancelActiveJob() {
        val jobId = machine.state.activeJobId ?: return
        if (!client.send(WsCodec.jobCancel(jobId))) noteOffline()
        refresh()
    }

    fun expandBadge() {
        run(machine.expandBadge())
        refresh()
    }

    fun dismiss() {
        badgeExpiryJob?.cancel()
        run(machine.dismiss())
        refresh()
    }

    /** Manual wear toggle (default surface). Fails loudly on a non-manual source. */
    fun setManualWear(worn: Boolean) {
        val manual = wearSource as? ManualWearSource
            ?: throw IllegalStateException(
                "wear toggle used with ${wearSource::class.simpleName} — the manual toggle only drives ManualWearSource",
            )
        manual.set(worn)
    }

    fun updateCoreUrl(url: String) {
        client.setUrl(url)
        refresh()
    }

    fun setListening(value: Boolean) {
        listening = value
        refresh()
    }

    fun setSpeechAvailable(value: Boolean) {
        speechAvailable = value
        refresh()
    }

    /** Local hardware failure (camera, mic) — same loud presentation as a Core error. */
    fun reportLocalError(message: String) {
        run(machine.onEvent(CoreEvent.ErrorEvent(message)))
        refresh()
    }

    // ── Core traffic ────────────────────────────────────────────────────────

    private fun handleText(text: String) {
        val event = try {
            WsCodec.decode(text)
        } catch (e: JSONException) {
            // Malformed frame from the Core: surface it, keep the socket alive.
            Log.e(TAG, "undecodable Core frame: ${e.message}")
            run(machine.onEvent(CoreEvent.ErrorEvent("undecodable Core frame: ${e.message}")))
            refresh()
            return
        }
        if (event is CoreEvent.Unknown) Log.w(TAG, "unknown Core message type '${event.type}' ignored")
        run(machine.onEvent(event))
        refresh()
    }

    private fun run(effects: List<SurfaceEffect>) {
        for (effect in effects) when (effect) {
            SurfaceEffect.PlayEarcon -> audio.playEarcon()
            is SurfaceEffect.Speak -> audio.speak(effect.text)
            is SurfaceEffect.FetchDigest -> fetchDigest(effect.threadId, effect.jobId)
            is SurfaceEffect.ArmBadgeExpiry -> armBadgeExpiry(effect.jobId, effect.afterMs)
        }
    }

    private fun fetchDigest(threadId: String, jobId: String) {
        scope.launch {
            try {
                val digest = rest.fetchDigest(client.url, threadId, jobId)
                run(machine.showDigestCard(digest.tldr, digest.citationTitles))
            } catch (e: Exception) {
                Log.e(TAG, "digest fetch failed for job $jobId: ${e.message}")
                run(machine.digestFetchFailed())
            }
            refresh()
        }
    }

    private fun armBadgeExpiry(jobId: String, afterMs: Long) {
        badgeExpiryJob?.cancel()
        badgeExpiryJob = scope.launch {
            delay(afterMs)
            run(machine.onBadgeExpired(jobId))
            refresh()
        }
    }

    private fun noteOffline() {
        run(machine.onEvent(CoreEvent.ErrorEvent("Core offline — check the Core URL below")))
    }

    private fun refresh() {
        val s = machine.state
        _ui.value = CompanionUiState(
            connected = connected,
            status = s.status,
            stage = s.stage,
            worn = s.worn,
            manualWear = wearSource is ManualWearSource,
            coreUrl = client.url,
            listening = listening,
            speechAvailable = speechAvailable,
            cancellableJobId = s.activeJobId,
            lastError = s.lastError,
        )
    }

    companion object {
        private const val TAG = "CompanionViewModel"

        // Stand-ins for spoken questions — the SAME canned asks as the Meta
        // web surface (clients/meta-rbd/web-app/app.js), so the two clients
        // demo the identical grammar.
        val RESEARCH_ASKS = listOf(
            "compare the literature on spaced repetition versus rereading — find papers and sources",
            "find sources on whether the spotlight effect replicates in recent studies",
            "survey the evidence comparing retrieval practice with elaborative interrogation",
        )
        const val QUICK_ASK = "define the spotlight effect"
        const val WATCH_TOPIC = "the spotlight effect"
    }
}
