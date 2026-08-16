package com.readingcompanion.rbd

/**
 * Typed events decoded from the Core's WebSocket frames (v1 + v2).
 * Vocabulary is DEFINITIONS.md verbatim: ResearchJob, JobState, Digest,
 * InterruptLevel, Capture, Thread, Watcher, Answer, Citation.
 */

data class Citation(val title: String, val url: String)

/** DEFINITIONS.md: Answer — `{ text, citations }`; `text` is spoken verbatim by TTS. */
data class Answer(val text: String, val citations: List<Citation>)

/** DEFINITIONS.md: JobState — `queued | running | digest_ready | delivered | archived | failed`. */
enum class JobState(val wire: String) {
    QUEUED("queued"),
    RUNNING("running"),
    DIGEST_READY("digest_ready"),
    DELIVERED("delivered"),
    ARCHIVED("archived"),
    FAILED("failed");

    companion object {
        fun fromWire(wire: String): JobState =
            entries.firstOrNull { it.wire == wire }
                ?: throw IllegalArgumentException("unknown JobState '$wire'")
    }
}

/**
 * DEFINITIONS.md: InterruptLevel — `hold < badge < earcon < speak`, ordered;
 * the DeliveryEngine may only round *down*. Declaration order encodes the
 * ordering so `level >= EARCON` comparisons work via ordinal.
 */
enum class InterruptLevel(val wire: String) {
    HOLD("hold"),
    BADGE("badge"),
    EARCON("earcon"),
    SPEAK("speak");

    companion object {
        fun fromWire(wire: String): InterruptLevel =
            entries.firstOrNull { it.wire == wire }
                ?: throw IllegalArgumentException("unknown InterruptLevel '$wire'")
    }
}

sealed class CoreEvent {
    // ── WS v2 (thought partner) ─────────────────────────────────────────────

    /**
     * `ask_routed` — the triage decision. `route == "fast"` carries an Answer to
     * speak now; `route == "background"` carries the jobId of the dispatched
     * ResearchJob. NOTE (core/README.md): the `job_update "queued"` for that job
     * arrives BEFORE this frame — correlate via [jobId].
     */
    data class AskRouted(
        val route: String,
        val threadId: String,
        val answer: Answer?,
        val jobId: String?,
    ) : CoreEvent()

    /** `job_update` — every ResearchJob state transition, visible to the client. */
    data class JobUpdate(val jobId: String, val state: JobState) : CoreEvent()

    /** `deliver` — the DeliveryEngine's etiquette-laddered delivery of a Digest. */
    data class Deliver(
        val level: InterruptLevel,
        val surface: String,
        val jobId: String?,
        val tldr: String?,
        val badge: String?,
    ) : CoreEvent()

    /** `capture_stored` — the Capture's extract is persisted; image bytes are discarded. */
    data class CaptureStored(val captureId: String, val kind: String) : CoreEvent()

    // ── WS v1 (reading session) — kept working ─────────────────────────────

    data class Opened(val sessionState: String) : CoreEvent()
    data class AnswerEvent(val answer: Answer) : CoreEvent()
    data class Transcript(val text: String) : CoreEvent()
    object PageObserved : CoreEvent()
    data class WatcherArmed(val topic: String) : CoreEvent()

    /** `audio` — PCM from the Core's live voice path (24 kHz mono PCM16). */
    class AudioOut(val pcm: ByteArray) : CoreEvent()

    // ── Errors ──────────────────────────────────────────────────────────────

    /** An `error` frame sent by the Core. */
    data class ErrorEvent(val message: String) : CoreEvent()

    /**
     * A locally-detected protocol failure (undecodable frame, send on a closed
     * socket). Surfaced loudly instead of being swallowed (AGENTS.md: fail
     * loudly, no silent fallbacks).
     */
    data class ProtocolError(val message: String) : CoreEvent()

    /** A frame type this client does not know. Logged, never silently dropped. */
    data class Unknown(val type: String) : CoreEvent()
}
