package com.readingcompanion.androidxr

import org.json.JSONException
import org.json.JSONObject

/**
 * WS v2 (+ retained v1) codec for the Core protocol — the exact shapes in
 * core/README.md ("WebSocket /ws"). Pure JVM (org.json only), unit-tested by
 * WsCodecTest. Encoding produces client→Core messages; [decode] parses
 * Core→client messages into typed [CoreEvent]s.
 *
 * Fail-loudly contract: a message that names a known type but is missing a
 * required field, or carries an out-of-vocabulary InterruptLevel/JobState,
 * throws [JSONException]. Unknown types decode to [CoreEvent.Unknown] (the
 * protocol may grow ahead of this client) — callers must log them, never
 * silently render them.
 */
object WsCodec {

    /** InterruptLevel vocabulary — DEFINITIONS.md verbatim, ordered. */
    val INTERRUPT_LEVELS = listOf("hold", "badge", "earcon", "speak")

    /** JobState vocabulary — DEFINITIONS.md verbatim. */
    val JOB_STATES = listOf("queued", "running", "digest_ready", "delivered", "archived", "failed")

    // ── Client → Core (v2) ──────────────────────────────────────────────────

    fun ask(question: String, captureId: String? = null, threadId: String? = null): JSONObject =
        JSONObject().put("type", "ask").put("question", question).apply {
            if (captureId != null) put("captureId", captureId)
            if (threadId != null) put("threadId", threadId)
        }

    fun capture(imageBase64: String, hintKind: String? = null, threadId: String? = null): JSONObject =
        JSONObject().put("type", "capture").put("imageBase64", imageBase64).apply {
            if (hintKind != null) put("hintKind", hintKind)
            if (threadId != null) put("threadId", threadId)
        }

    fun jobCancel(jobId: String): JSONObject =
        JSONObject().put("type", "job_cancel").put("jobId", jobId)

    fun wear(worn: Boolean): JSONObject =
        JSONObject().put("type", "wear").put("worn", worn)

    // ── Client → Core (v1, kept — a reading Session may still be open) ─────

    fun open(kind: String, title: String, deviceId: String): JSONObject =
        JSONObject().put("type", "open")
            .put("ref", JSONObject().put("kind", kind).put("title", title))
            .put("deviceId", deviceId)

    fun say(question: String): JSONObject = JSONObject().put("type", "say").put("question", question)
    fun watch(topic: String): JSONObject = JSONObject().put("type", "watch").put("topic", topic)
    fun page(imageBase64: String): JSONObject = JSONObject().put("type", "page").put("imageBase64", imageBase64)
    fun mic(pcmBase64: String): JSONObject = JSONObject().put("type", "mic").put("pcmBase64", pcmBase64)
    fun end(): JSONObject = JSONObject().put("type", "end")

    // ── Core → client ───────────────────────────────────────────────────────

    fun decode(text: String): CoreEvent {
        val msg = JSONObject(text)
        return when (val type = msg.optString("type")) {
            "ask_routed" -> {
                val route = msg.getString("route")
                if (route != "fast" && route != "background") {
                    throw JSONException("ask_routed: unknown route '$route'")
                }
                CoreEvent.AskRouted(
                    route = route,
                    threadId = msg.getString("threadId"),
                    answer = msg.optJSONObject("answer")?.let(::answerPayload),
                    jobId = if (msg.has("jobId")) msg.getString("jobId") else null,
                )
            }
            "job_update" -> {
                val state = msg.getString("state")
                if (state !in JOB_STATES) throw JSONException("job_update: unknown JobState '$state'")
                CoreEvent.JobUpdate(jobId = msg.getString("jobId"), state = state)
            }
            "deliver" -> {
                val level = msg.getString("level")
                if (level !in INTERRUPT_LEVELS) throw JSONException("deliver: unknown InterruptLevel '$level'")
                CoreEvent.Deliver(
                    level = level,
                    surface = msg.getString("surface"),
                    jobId = msg.getString("jobId"),
                    tldr = if (msg.has("tldr")) msg.getString("tldr") else null,
                    badge = if (msg.has("badge")) msg.getString("badge") else null,
                )
            }
            "capture_stored" -> CoreEvent.CaptureStored(
                captureId = msg.getString("captureId"),
                kind = msg.getString("kind"),
            )
            "watcher_armed" -> CoreEvent.WatcherArmed(
                topic = msg.getJSONObject("watcher").getString("topic"),
            )
            // v1 session traffic, still delivered when a reading Session is open:
            "opened" -> CoreEvent.Opened(sessionState = msg.getJSONObject("session").getString("state"))
            "answer" -> CoreEvent.AnswerEvent(answerPayload(msg.getJSONObject("answer")))
            "page_observed" -> CoreEvent.PageObserved
            "transcript" -> CoreEvent.Transcript(msg.optString("text"))
            "audio" -> CoreEvent.AudioChunk
            "error" -> CoreEvent.ErrorEvent(msg.optString("message", msg.optString("error", "unknown Core error")))
            else -> CoreEvent.Unknown(type = type, raw = msg)
        }
    }

    private fun answerPayload(answer: JSONObject): AnswerPayload {
        val citations = buildList {
            val arr = answer.optJSONArray("citations") ?: return@buildList
            for (i in 0 until arr.length()) {
                val c = arr.getJSONObject(i)
                add(Citation(title = c.getString("title"), url = c.optString("url")))
            }
        }
        return AnswerPayload(text = answer.getString("text"), citations = citations)
    }
}

/** Citation — DEFINITIONS.md verbatim: `{ title, url }`. */
data class Citation(val title: String, val url: String)

/** Answer body shared by v1 `answer` and v2 fast-route `ask_routed`. */
data class AnswerPayload(val text: String, val citations: List<Citation>)

/** Typed Core→client messages (core/README.md, v1 + v2). */
sealed interface CoreEvent {
    data class AskRouted(
        val route: String,
        val threadId: String,
        val answer: AnswerPayload?,
        val jobId: String?,
    ) : CoreEvent

    data class JobUpdate(val jobId: String, val state: String) : CoreEvent

    data class Deliver(
        val level: String,
        val surface: String,
        val jobId: String,
        val tldr: String?,
        val badge: String?,
    ) : CoreEvent

    data class CaptureStored(val captureId: String, val kind: String) : CoreEvent
    data class WatcherArmed(val topic: String) : CoreEvent

    data class Opened(val sessionState: String) : CoreEvent
    data class AnswerEvent(val answer: AnswerPayload) : CoreEvent
    data object PageObserved : CoreEvent
    data class Transcript(val text: String) : CoreEvent
    data object AudioChunk : CoreEvent

    data class ErrorEvent(val message: String) : CoreEvent
    data class Unknown(val type: String, val raw: JSONObject) : CoreEvent
}
