package com.readingcompanion.rbd

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure-JVM tests of the WS v1+v2 wire contract (core/README.md message
 * shapes). Runs with the real org.json artifact — no device, no Robolectric.
 */
class CoreProtocolTest {

    // ── v2 encoding ──────────────────────────────────────────────────────────

    @Test
    fun `encodeWear produces the exact wear shape`() {
        val msg = JSONObject(CoreProtocol.encodeWear(true))
        assertEquals("wear", msg.getString("type"))
        assertTrue(msg.getBoolean("worn"))
        assertEquals(2, msg.length())
    }

    @Test
    fun `encodeAsk omits optional keys when absent`() {
        val msg = JSONObject(CoreProtocol.encodeAsk("what is the spotlight effect?"))
        assertEquals("ask", msg.getString("type"))
        assertEquals("what is the spotlight effect?", msg.getString("question"))
        assertFalse(msg.has("captureId"))
        assertFalse(msg.has("threadId"))
    }

    @Test
    fun `encodeAsk carries captureId and threadId when present`() {
        val msg = JSONObject(CoreProtocol.encodeAsk("q", captureId = "cap-1", threadId = "thr-9"))
        assertEquals("cap-1", msg.getString("captureId"))
        assertEquals("thr-9", msg.getString("threadId"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `encodeAsk rejects a blank question`() {
        CoreProtocol.encodeAsk("   ")
    }

    @Test
    fun `encodeCapture carries hintKind and threadId`() {
        val msg = JSONObject(CoreProtocol.encodeCapture("aGVsbG8=", "whiteboard", "thr-2"))
        assertEquals("capture", msg.getString("type"))
        assertEquals("aGVsbG8=", msg.getString("imageBase64"))
        assertEquals("whiteboard", msg.getString("hintKind"))
        assertEquals("thr-2", msg.getString("threadId"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `encodeCapture rejects an unknown CaptureKind`() {
        CoreProtocol.encodeCapture("aGVsbG8=", hintKind = "selfie")
    }

    @Test(expected = IllegalArgumentException::class)
    fun `encodeCapture rejects empty image bytes`() {
        CoreProtocol.encodeCapture("")
    }

    @Test
    fun `encodeJobCancel produces the exact job_cancel shape`() {
        val msg = JSONObject(CoreProtocol.encodeJobCancel("job-7"))
        assertEquals("job_cancel", msg.getString("type"))
        assertEquals("job-7", msg.getString("jobId"))
    }

    // ── v1 encoding (kept working) ──────────────────────────────────────────

    @Test
    fun `encodeOpen nests the ContentRef`() {
        val msg = JSONObject(CoreProtocol.encodeOpen("book", "Dune", "pixel-rbd"))
        assertEquals("open", msg.getString("type"))
        assertEquals("book", msg.getJSONObject("ref").getString("kind"))
        assertEquals("Dune", msg.getJSONObject("ref").getString("title"))
        assertEquals("pixel-rbd", msg.getString("deviceId"))
    }

    @Test
    fun `v1 say-watch-end shapes are stable`() {
        assertEquals("say", JSONObject(CoreProtocol.encodeSay("q")).getString("type"))
        assertEquals("watch", JSONObject(CoreProtocol.encodeWatch("t")).getString("type"))
        assertEquals("end", JSONObject(CoreProtocol.encodeEnd()).getString("type"))
    }

    // ── v2 decoding ──────────────────────────────────────────────────────────

    @Test
    fun `decode ask_routed fast carries the Answer`() {
        val event = CoreProtocol.decode(
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
    fun `decode ask_routed background carries the jobId and no answer`() {
        val event = CoreProtocol.decode(
            """{"type":"ask_routed","route":"background","threadId":"thr-1","jobId":"job-1"}""",
        ) as CoreEvent.AskRouted
        assertEquals("background", event.route)
        assertEquals("job-1", event.jobId)
        assertNull(event.answer)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `decode ask_routed rejects an unknown route`() {
        CoreProtocol.decode("""{"type":"ask_routed","route":"sideways","threadId":"t"}""")
    }

    @Test
    fun `decode job_update maps every JobState`() {
        for (state in JobState.entries) {
            val event = CoreProtocol.decode(
                """{"type":"job_update","jobId":"j","state":"${state.wire}"}""",
            ) as CoreEvent.JobUpdate
            assertEquals(state, event.state)
        }
    }

    @Test(expected = IllegalArgumentException::class)
    fun `decode job_update rejects an unknown JobState`() {
        CoreProtocol.decode("""{"type":"job_update","jobId":"j","state":"paused"}""")
    }

    @Test
    fun `decode deliver carries level surface tldr badge`() {
        val event = CoreProtocol.decode(
            """{"type":"deliver","level":"earcon","surface":"glasses","jobId":"job-3",
                "tldr":"Two sentences.","badge":"Two sentences."}""",
        ) as CoreEvent.Deliver
        assertEquals(InterruptLevel.EARCON, event.level)
        assertEquals("glasses", event.surface)
        assertEquals("job-3", event.jobId)
        assertEquals("Two sentences.", event.tldr)
    }

    @Test
    fun `decode deliver hold has no tldr and routes to phone`() {
        val event = CoreProtocol.decode(
            """{"type":"deliver","level":"hold","surface":"phone","jobId":"job-4"}""",
        ) as CoreEvent.Deliver
        assertEquals(InterruptLevel.HOLD, event.level)
        assertEquals("phone", event.surface)
        assertNull(event.tldr)
    }

    @Test
    fun `InterruptLevel ordering matches the etiquette ladder`() {
        // hold < badge < earcon < speak — DeliveryEngine may only round DOWN.
        assertTrue(InterruptLevel.HOLD < InterruptLevel.BADGE)
        assertTrue(InterruptLevel.BADGE < InterruptLevel.EARCON)
        assertTrue(InterruptLevel.EARCON < InterruptLevel.SPEAK)
    }

    @Test
    fun `decode capture_stored`() {
        val event = CoreProtocol.decode(
            """{"type":"capture_stored","captureId":"cap-9","kind":"page"}""",
        ) as CoreEvent.CaptureStored
        assertEquals("cap-9", event.captureId)
        assertEquals("page", event.kind)
    }

    @Test
    fun `queued job_update decodes standalone — it arrives before ask_routed`() {
        // core/README.md: the job_update "queued" is emitted during submission
        // and arrives BEFORE ask_routed; the client must accept an update for a
        // job it has never heard of.
        val event = CoreProtocol.decode(
            """{"type":"job_update","jobId":"job-unseen","state":"queued"}""",
        ) as CoreEvent.JobUpdate
        assertEquals(JobState.QUEUED, event.state)
    }

    // ── v1 decoding (kept working) ──────────────────────────────────────────

    @Test
    fun `decode v1 answer`() {
        val event = CoreProtocol.decode(
            """{"type":"answer","answer":{"text":"Spoken prose.","citations":[]}}""",
        ) as CoreEvent.AnswerEvent
        assertEquals("Spoken prose.", event.answer.text)
        assertTrue(event.answer.citations.isEmpty())
    }

    @Test
    fun `decode v1 audio round-trips base64 PCM`() {
        val pcm = byteArrayOf(1, 2, 3, -4, 0, 127)
        val b64 = java.util.Base64.getEncoder().encodeToString(pcm)
        val event = CoreProtocol.decode("""{"type":"audio","audioBase64":"$b64"}""")
            as CoreEvent.AudioOut
        assertTrue(pcm.contentEquals(event.pcm))
    }

    @Test
    fun `decode v1 watcher_armed`() {
        val event = CoreProtocol.decode(
            """{"type":"watcher_armed","watcher":{"topic":"the spotlight effect"}}""",
        ) as CoreEvent.WatcherArmed
        assertEquals("the spotlight effect", event.topic)
    }

    @Test
    fun `decode v1 opened and page_observed`() {
        val opened = CoreProtocol.decode(
            """{"type":"opened","session":{"state":"reading"}}""",
        ) as CoreEvent.Opened
        assertEquals("reading", opened.sessionState)
        assertEquals(CoreEvent.PageObserved, CoreProtocol.decode("""{"type":"page_observed"}"""))
    }

    // ── errors & unknowns ────────────────────────────────────────────────────

    @Test
    fun `decode error reads message or error field`() {
        val a = CoreProtocol.decode("""{"type":"error","message":"boom"}""") as CoreEvent.ErrorEvent
        assertEquals("boom", a.message)
        val b = CoreProtocol.decode("""{"type":"error","error":"bang"}""") as CoreEvent.ErrorEvent
        assertEquals("bang", b.message)
    }

    @Test
    fun `decode unknown type is surfaced not dropped`() {
        val event = CoreProtocol.decode("""{"type":"telepathy"}""") as CoreEvent.Unknown
        assertEquals("telepathy", event.type)
    }

    @Test(expected = Exception::class)
    fun `decode malformed JSON throws — fail loudly`() {
        CoreProtocol.decode("not json at all")
    }

    @Test(expected = Exception::class)
    fun `decode deliver without level throws — no silent defaults`() {
        CoreProtocol.decode("""{"type":"deliver","surface":"glasses"}""")
    }
}
