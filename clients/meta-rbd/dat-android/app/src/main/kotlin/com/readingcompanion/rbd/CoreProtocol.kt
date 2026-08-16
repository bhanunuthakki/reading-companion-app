package com.readingcompanion.rbd

import org.json.JSONArray
import org.json.JSONObject

/**
 * Wire-level encode/decode for the Core's WS protocol, v1 (reading session) and
 * v2 (thought partner). The exact message shapes are the contract in
 * core/README.md — this object is their single Kotlin home.
 *
 * Library choice: org.json + hand-rolled shapes, matching the existing skeleton
 * (and the Core's own plain-JSON frames). The protocol is ~10 small message
 * types; a serialization framework (Moshi/kotlinx.serialization) would add a
 * compiler plugin or reflection for no leverage. org.json ships in the Android
 * platform (zero APK cost); unit tests run against the org.json:json artifact.
 *
 * Pure JVM — no android.* imports — so it is unit-testable without a device.
 */
object CoreProtocol {

    // ── v2: client → Core ───────────────────────────────────────────────────

    fun encodeWear(worn: Boolean): String =
        JSONObject().put("type", "wear").put("worn", worn).toString()

    /**
     * `ask` — no threadId auto-creates a Thread on the Core (spec §12 Q2
     * default). Unknown threadId/captureId will come back as an `error` frame.
     */
    fun encodeAsk(question: String, captureId: String? = null, threadId: String? = null): String {
        require(question.isNotBlank()) { "ask requires a non-blank question" }
        val msg = JSONObject().put("type", "ask").put("question", question)
        captureId?.let { msg.put("captureId", it) }
        threadId?.let { msg.put("threadId", it) }
        return msg.toString()
    }

    /** `capture` — one Capture; the Core discards image bytes after extraction. */
    fun encodeCapture(imageBase64: String, hintKind: String? = null, threadId: String? = null): String {
        require(imageBase64.isNotEmpty()) { "capture requires image bytes" }
        hintKind?.let {
            require(it in CAPTURE_KINDS) { "unknown CaptureKind '$it' (expected one of $CAPTURE_KINDS)" }
        }
        val msg = JSONObject().put("type", "capture").put("imageBase64", imageBase64)
        hintKind?.let { msg.put("hintKind", it) }
        threadId?.let { msg.put("threadId", it) }
        return msg.toString()
    }

    fun encodeJobCancel(jobId: String): String {
        require(jobId.isNotBlank()) { "job_cancel requires a jobId" }
        return JSONObject().put("type", "job_cancel").put("jobId", jobId).toString()
    }

    /** DEFINITIONS.md: CaptureKind — `page | document | whiteboard | screen | scene | object`. */
    val CAPTURE_KINDS = setOf("page", "document", "whiteboard", "screen", "scene", "object")

    // ── v1: client → Core (kept working) ────────────────────────────────────

    fun encodeOpen(kind: String, title: String, deviceId: String): String =
        JSONObject()
            .put("type", "open")
            .put("ref", JSONObject().put("kind", kind).put("title", title))
            .put("deviceId", deviceId)
            .toString()

    fun encodeSay(question: String): String =
        JSONObject().put("type", "say").put("question", question).toString()

    fun encodeWatch(topic: String): String =
        JSONObject().put("type", "watch").put("topic", topic).toString()

    fun encodePage(imageBase64: String): String =
        JSONObject().put("type", "page").put("imageBase64", imageBase64).toString()

    fun encodeMic(pcmBase64: String): String =
        JSONObject().put("type", "mic").put("pcmBase64", pcmBase64).toString()

    fun encodeFrame(jpegBase64: String): String =
        JSONObject().put("type", "frame").put("jpegBase64", jpegBase64).toString()

    fun encodeEnd(): String = JSONObject().put("type", "end").toString()

    // ── Core → client ────────────────────────────────────────────────────────

    /**
     * Decode one server frame into a [CoreEvent]. Throws (JSONException /
     * IllegalArgumentException) on malformed frames — the caller surfaces that
     * as a loud [CoreEvent.ProtocolError]; nothing is silently coerced.
     */
    fun decode(text: String): CoreEvent {
        val msg = JSONObject(text)
        return when (val type = msg.optString("type")) {
            // v2
            "ask_routed" -> {
                val route = msg.getString("route")
                require(route == "fast" || route == "background") { "unknown ask route '$route'" }
                CoreEvent.AskRouted(
                    route = route,
                    threadId = msg.getString("threadId"),
                    answer = msg.optJSONObject("answer")?.let { decodeAnswer(it) },
                    jobId = optNonBlank(msg, "jobId"),
                )
            }
            "job_update" -> CoreEvent.JobUpdate(
                jobId = msg.getString("jobId"),
                state = JobState.fromWire(msg.getString("state")),
            )
            "deliver" -> CoreEvent.Deliver(
                level = InterruptLevel.fromWire(msg.getString("level")),
                surface = msg.getString("surface"),
                jobId = optNonBlank(msg, "jobId"),
                tldr = optNonBlank(msg, "tldr"),
                badge = optNonBlank(msg, "badge"),
            )
            "capture_stored" -> CoreEvent.CaptureStored(
                captureId = msg.getString("captureId"),
                kind = msg.getString("kind"),
            )
            // v1
            "opened" -> CoreEvent.Opened(msg.getJSONObject("session").optString("state"))
            "answer" -> CoreEvent.AnswerEvent(decodeAnswer(msg.getJSONObject("answer")))
            "transcript" -> CoreEvent.Transcript(msg.optString("text"))
            "page_observed" -> CoreEvent.PageObserved
            "watcher_armed" -> CoreEvent.WatcherArmed(msg.getJSONObject("watcher").getString("topic"))
            "audio" -> CoreEvent.AudioOut(
                java.util.Base64.getDecoder().decode(msg.getString("audioBase64")),
            )
            "error" -> CoreEvent.ErrorEvent(
                optNonBlank(msg, "message") ?: optNonBlank(msg, "error") ?: "unspecified Core error",
            )
            else -> CoreEvent.Unknown(type)
        }
    }

    private fun decodeAnswer(obj: JSONObject): Answer =
        Answer(
            text = obj.getString("text"),
            citations = decodeCitations(obj.optJSONArray("citations")),
        )

    private fun decodeCitations(arr: JSONArray?): List<Citation> {
        if (arr == null) return emptyList()
        return (0 until arr.length()).map { i ->
            val c = arr.getJSONObject(i)
            Citation(title = c.optString("title"), url = c.optString("url"))
        }
    }

    private fun optNonBlank(msg: JSONObject, key: String): String? =
        if (msg.has(key) && !msg.isNull(key)) msg.getString(key).takeIf { it.isNotBlank() } else null
}
