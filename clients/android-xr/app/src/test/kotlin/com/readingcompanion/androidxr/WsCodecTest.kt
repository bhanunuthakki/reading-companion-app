package com.readingcompanion.androidxr

import org.json.JSONException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * WS v2 codec round-trips against the exact shapes in core/README.md.
 * Pure JVM — real org.json on the test classpath.
 */
class WsCodecTest {

    // ── Outbound (client → Core) ────────────────────────────────────────────

    @Test
    fun `ask encodes question with optional threadId and captureId`() {
        val minimal = WsCodec.ask("what is the spotlight effect?")
        assertEquals("ask", minimal.getString("type"))
        assertEquals("what is the spotlight effect?", minimal.getString("question"))
        assertFalse(minimal.has("threadId"))
        assertFalse(minimal.has("captureId"))

        val full = WsCodec.ask("compare sources", captureId = "cap-1", threadId = "thr-1")
        assertEquals("cap-1", full.getString("captureId"))
        assertEquals("thr-1", full.getString("threadId"))
    }

    @Test
    fun `capture encodes image with optional hintKind`() {
        val msg = WsCodec.capture("aGVsbG8=", hintKind = "whiteboard", threadId = "thr-9")
        assertEquals("capture", msg.getString("type"))
        assertEquals("aGVsbG8=", msg.getString("imageBase64"))
        assertEquals("whiteboard", msg.getString("hintKind"))
        assertEquals("thr-9", msg.getString("threadId"))
    }

    @Test
    fun `wear encodes worn boolean both ways`() {
        assertEquals(true, WsCodec.wear(true).getBoolean("worn"))
        assertEquals(false, WsCodec.wear(false).getBoolean("worn"))
        assertEquals("wear", WsCodec.wear(true).getString("type"))
    }

    @Test
    fun `job_cancel encodes jobId`() {
        val msg = WsCodec.jobCancel("job-3")
        assertEquals("job_cancel", msg.getString("type"))
        assertEquals("job-3", msg.getString("jobId"))
    }

    @Test
    fun `v1 messages still encode`() {
        val open = WsCodec.open(kind = "book", title = "Dune", deviceId = "android-xr")
        assertEquals("open", open.getString("type"))
        assertEquals("book", open.getJSONObject("ref").getString("kind"))
        assertEquals("Dune", open.getJSONObject("ref").getString("title"))

        assertEquals("say", WsCodec.say("q").getString("type"))
        assertEquals("watch", WsCodec.watch("t").getString("type"))
        assertEquals("page", WsCodec.page("img").getString("type"))
        assertEquals("mic", WsCodec.mic("pcm").getString("type"))
        assertEquals("end", WsCodec.end().getString("type"))
    }

    // ── Inbound (Core → client) round-trips ─────────────────────────────────

    @Test
    fun `ask_routed fast decodes answer with citations`() {
        val event = WsCodec.decode(
            """{"type":"ask_routed","route":"fast","threadId":"thr-1",
                "answer":{"text":"Quick answer.","citations":[
                  {"title":"Paper A","url":"https://a"},{"title":"Paper B","url":"https://b"}]}}""",
        ) as CoreEvent.AskRouted
        assertEquals("fast", event.route)
        assertEquals("thr-1", event.threadId)
        assertNull(event.jobId)
        assertEquals("Quick answer.", event.answer!!.text)
        assertEquals(listOf("Paper A", "Paper B"), event.answer!!.citations.map { it.title })
    }

    @Test
    fun `ask_routed background decodes jobId without answer`() {
        val event = WsCodec.decode(
            """{"type":"ask_routed","route":"background","threadId":"thr-2","jobId":"job-7"}""",
        ) as CoreEvent.AskRouted
        assertEquals("background", event.route)
        assertEquals("job-7", event.jobId)
        assertNull(event.answer)
    }

    @Test
    fun `job_update decodes every JobState`() {
        for (state in WsCodec.JOB_STATES) {
            val event = WsCodec.decode(
                """{"type":"job_update","jobId":"job-1","state":"$state"}""",
            ) as CoreEvent.JobUpdate
            assertEquals(state, event.state)
            assertEquals("job-1", event.jobId)
        }
    }

    @Test
    fun `deliver decodes all fields and every InterruptLevel`() {
        for (level in WsCodec.INTERRUPT_LEVELS) {
            val event = WsCodec.decode(
                """{"type":"deliver","level":"$level","surface":"glasses",
                    "jobId":"job-1","tldr":"Two sentences.","badge":"Digest ready"}""",
            ) as CoreEvent.Deliver
            assertEquals(level, event.level)
            assertEquals("glasses", event.surface)
            assertEquals("Two sentences.", event.tldr)
            assertEquals("Digest ready", event.badge)
        }
    }

    @Test
    fun `capture_stored and watcher_armed decode`() {
        val stored = WsCodec.decode(
            """{"type":"capture_stored","captureId":"cap-1","kind":"whiteboard"}""",
        ) as CoreEvent.CaptureStored
        assertEquals("whiteboard", stored.kind)

        val armed = WsCodec.decode(
            """{"type":"watcher_armed","watcher":{"topic":"the spotlight effect"}}""",
        ) as CoreEvent.WatcherArmed
        assertEquals("the spotlight effect", armed.topic)
    }

    @Test
    fun `v1 opened answer page_observed error decode`() {
        val opened = WsCodec.decode("""{"type":"opened","session":{"state":"reading"}}""") as CoreEvent.Opened
        assertEquals("reading", opened.sessionState)

        val answer = WsCodec.decode(
            """{"type":"answer","answer":{"text":"Spoken.","citations":[]}}""",
        ) as CoreEvent.AnswerEvent
        assertEquals("Spoken.", answer.answer.text)

        assertTrue(WsCodec.decode("""{"type":"page_observed"}""") is CoreEvent.PageObserved)

        val error = WsCodec.decode("""{"type":"error","message":"unknown threadId"}""") as CoreEvent.ErrorEvent
        assertEquals("unknown threadId", error.message)
    }

    @Test
    fun `unknown type decodes to Unknown, never throws`() {
        val event = WsCodec.decode("""{"type":"future_thing","payload":1}""") as CoreEvent.Unknown
        assertEquals("future_thing", event.type)
    }

    // ── Fail-loudly: malformed known types throw ────────────────────────────

    @Test(expected = JSONException::class)
    fun `deliver without level throws`() {
        WsCodec.decode("""{"type":"deliver","surface":"glasses","jobId":"j"}""")
    }

    @Test(expected = JSONException::class)
    fun `deliver with out-of-vocabulary InterruptLevel throws`() {
        WsCodec.decode("""{"type":"deliver","level":"shout","surface":"glasses","jobId":"j"}""")
    }

    @Test(expected = JSONException::class)
    fun `job_update with unknown JobState throws`() {
        WsCodec.decode("""{"type":"job_update","jobId":"j","state":"paused"}""")
    }

    @Test(expected = JSONException::class)
    fun `ask_routed with unknown route throws`() {
        WsCodec.decode("""{"type":"ask_routed","route":"sideways","threadId":"t"}""")
    }

    @Test(expected = JSONException::class)
    fun `non-json frame throws`() {
        WsCodec.decode("not json at all")
    }

    // ── Outbound survives a JSON round-trip (serialize → reparse) ───────────

    @Test
    fun `outbound messages survive serialization round-trip`() {
        val originals = listOf(
            WsCodec.ask("q", "cap", "thr"),
            WsCodec.capture("img", "page", null),
            WsCodec.wear(true),
            WsCodec.jobCancel("job-1"),
        )
        for (original in originals) {
            val reparsed = JSONObject(original.toString())
            assertEquals(original.toString(), reparsed.toString())
        }
    }
}
