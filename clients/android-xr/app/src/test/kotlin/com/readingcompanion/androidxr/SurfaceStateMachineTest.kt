package com.readingcompanion.androidxr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The surface grammar, hint → wait → badge → card → dismiss, as plain JVM
 * transitions — mirroring what the Meta 600×600 surface renders.
 */
class SurfaceStateMachineTest {

    private fun deliver(level: String, jobId: String = "job-1", tldr: String? = "Two sentences.", badge: String? = "Digest ready") =
        CoreEvent.Deliver(level = level, surface = "glasses", jobId = jobId, tldr = tldr, badge = badge)

    private fun wornMachine(): SurfaceStateMachine = SurfaceStateMachine().apply {
        onSocketOpen()
        onWornChanged(true)
    }

    // ── Baseline ────────────────────────────────────────────────────────────

    @Test
    fun `initial state is connecting with the default hint`() {
        val machine = SurfaceStateMachine()
        assertEquals("connecting", machine.state.status)
        assertEquals(Stage.Hint(SurfaceStateMachine.HINT_DEFAULT), machine.state.stage)
        assertEquals(false, machine.state.worn) // not-worn default
    }

    @Test
    fun `socket open and close move status`() {
        val machine = SurfaceStateMachine()
        machine.onSocketOpen()
        assertEquals("ready", machine.state.status)
        machine.onSocketClosed()
        assertEquals("offline", machine.state.status)
    }

    // ── Ask → route ─────────────────────────────────────────────────────────

    @Test
    fun `ask then background route shows the wait stage and tracks the job`() {
        val machine = wornMachine()
        machine.onAskSubmitted()
        assertEquals("asking…", machine.state.status)

        // The job_update "queued" may arrive BEFORE ask_routed (core/README.md).
        machine.onEvent(CoreEvent.JobUpdate(jobId = "job-1", state = "queued"))
        assertEquals("asking…", machine.state.status) // nothing to present yet

        machine.onEvent(CoreEvent.AskRouted(route = "background", threadId = "thr-1", answer = null, jobId = "job-1"))
        assertEquals("on it…", machine.state.status)
        assertEquals(Stage.Wait(SurfaceStateMachine.WAIT_TEXT), machine.state.stage)
        assertEquals("thr-1", machine.state.threadId)
        assertEquals("job-1", machine.state.activeJobId)

        machine.onEvent(CoreEvent.JobUpdate(jobId = "job-1", state = "running"))
        assertEquals("researching…", machine.state.status)
    }

    @Test
    fun `fast route shows the answer card immediately, clipped to 3 citations`() {
        val machine = wornMachine()
        val citations = (1..5).map { Citation("Paper $it", "https://p$it") }
        machine.onEvent(
            CoreEvent.AskRouted(
                route = "fast", threadId = "thr-1",
                answer = AnswerPayload("Quick answer.", citations), jobId = null,
            ),
        )
        val card = machine.state.stage as Stage.Card
        assertEquals("Quick answer.", card.text)
        assertEquals(listOf("Paper 1", "Paper 2", "Paper 3"), card.citations)
        assertEquals("ready", machine.state.status)
    }

    @Test
    fun `fast route without an answer is a loud contract error`() {
        val machine = wornMachine()
        machine.onEvent(CoreEvent.AskRouted(route = "fast", threadId = "thr-1", answer = null, jobId = null))
        assertEquals("error", machine.state.status)
    }

    // ── Deliver (the etiquette ladder, rendered) ────────────────────────────

    @Test
    fun `badge-level deliver while worn stages an expandable badge with expiry`() {
        val machine = wornMachine()
        val effects = machine.onEvent(deliver("badge"))
        val stage = machine.state.stage as Stage.Badge
        assertEquals("Digest ready", stage.text)
        assertEquals("job-1", stage.jobId)
        assertTrue(stage.expandable)
        assertEquals("digest ready", machine.state.status)
        assertEquals(
            listOf<SurfaceEffect>(SurfaceEffect.ArmBadgeExpiry("job-1", SurfaceStateMachine.BADGE_EXPIRY_MS)),
            effects,
        )
    }

    @Test
    fun `earcon deliver adds the earcon effect`() {
        val machine = wornMachine()
        val effects = machine.onEvent(deliver("earcon"))
        assertTrue(SurfaceEffect.PlayEarcon in effects)
        assertTrue(machine.state.stage is Stage.Badge)
    }

    @Test
    fun `speak deliver adds earcon and speaks the tldr`() {
        val machine = wornMachine()
        val effects = machine.onEvent(deliver("speak"))
        assertTrue(SurfaceEffect.PlayEarcon in effects)
        assertTrue(SurfaceEffect.Speak("Two sentences.") in effects)
    }

    @Test
    fun `hold deliver never touches the glasses stage beyond the hint`() {
        val machine = wornMachine()
        val effects = machine.onEvent(deliver("hold"))
        assertTrue(effects.isEmpty())
        assertEquals(Stage.Hint(SurfaceStateMachine.HINT_HELD), machine.state.stage)
        assertEquals("on your phone", machine.state.status)
    }

    @Test
    fun `deliver above hold while not worn is presented as hold — rule 2, client side`() {
        val machine = SurfaceStateMachine().apply { onSocketOpen() } // worn=false
        val effects = machine.onEvent(deliver("speak"))
        assertTrue(effects.isEmpty()) // no earcon, no TTS to absent glasses
        assertEquals(Stage.Hint(SurfaceStateMachine.HINT_HELD), machine.state.stage)
    }

    @Test
    fun `deliver clears the active job`() {
        val machine = wornMachine()
        machine.onEvent(CoreEvent.AskRouted(route = "background", threadId = "t", answer = null, jobId = "job-1"))
        machine.onEvent(deliver("badge", jobId = "job-1"))
        assertNull(machine.state.activeJobId)
    }

    // ── Badge → card → dismiss ──────────────────────────────────────────────

    @Test
    fun `expand badge requests the digest fetch and card renders clipped citations`() {
        val machine = wornMachine()
        machine.onEvent(CoreEvent.AskRouted(route = "background", threadId = "thr-1", answer = null, jobId = "job-1"))
        machine.onEvent(deliver("badge"))

        val effects = machine.expandBadge()
        assertEquals(listOf<SurfaceEffect>(SurfaceEffect.FetchDigest("thr-1", "job-1")), effects)
        assertEquals("opening…", machine.state.status)

        machine.showDigestCard("The TLDR.", listOf("A", "B", "C", "D"))
        val card = machine.state.stage as Stage.Card
        assertEquals(listOf("A", "B", "C"), card.citations)

        machine.dismiss()
        assertEquals(Stage.Hint(SurfaceStateMachine.HINT_DEFAULT), machine.state.stage)
        assertNull(machine.state.badgeJobId)
    }

    @Test
    fun `expand on a non-expandable badge is a no-op`() {
        val machine = wornMachine()
        machine.onEvent(CoreEvent.WatcherArmed("the spotlight effect"))
        assertTrue((machine.state.stage as Stage.Badge).jobId == null)
        assertTrue(machine.expandBadge().isEmpty())
    }

    @Test
    fun `digest fetch failure points to the phone`() {
        val machine = wornMachine()
        machine.onEvent(CoreEvent.AskRouted(route = "background", threadId = "thr-1", answer = null, jobId = "job-1"))
        machine.onEvent(deliver("badge"))
        machine.expandBadge()
        machine.digestFetchFailed()
        assertEquals(Stage.Hint(SurfaceStateMachine.HINT_DIGEST_ON_PHONE), machine.state.stage)
        assertEquals("error", machine.state.status)
    }

    // ── Expiry (spec §7 rule 6) ─────────────────────────────────────────────

    @Test
    fun `badge expiry dismisses only the matching badge`() {
        val machine = wornMachine()
        machine.onEvent(deliver("badge", jobId = "job-1"))

        machine.onBadgeExpired("job-OTHER")
        assertTrue(machine.state.stage is Stage.Badge) // untouched

        machine.onBadgeExpired("job-1")
        assertEquals(Stage.Hint(SurfaceStateMachine.HINT_HELD), machine.state.stage)
        assertEquals("on your phone", machine.state.status)
    }

    // ── Job lifecycle edges ─────────────────────────────────────────────────

    @Test
    fun `failed job clears the wait`() {
        val machine = wornMachine()
        machine.onEvent(CoreEvent.AskRouted(route = "background", threadId = "t", answer = null, jobId = "job-1"))
        machine.onEvent(CoreEvent.JobUpdate("job-1", "failed"))
        assertEquals("failed", machine.state.status)
        assertNull(machine.state.activeJobId)
        assertTrue(machine.state.stage is Stage.Hint)
    }

    @Test
    fun `archived after cancel returns to the hint`() {
        val machine = wornMachine()
        machine.onEvent(CoreEvent.AskRouted(route = "background", threadId = "t", answer = null, jobId = "job-1"))
        machine.onEvent(CoreEvent.JobUpdate("job-1", "archived"))
        assertEquals("cancelled", machine.state.status)
        assertNull(machine.state.activeJobId)
        assertTrue(machine.state.stage is Stage.Hint)
    }

    @Test
    fun `capture_stored and v1 events update status`() {
        val machine = wornMachine()
        machine.onEvent(CoreEvent.CaptureStored("cap-1", "whiteboard"))
        assertEquals("captured whiteboard", machine.state.status)

        machine.onEvent(CoreEvent.Opened("reading"))
        assertEquals("reading", machine.state.status)

        machine.onEvent(CoreEvent.PageObserved)
        assertEquals("reading", machine.state.status)

        machine.onEvent(CoreEvent.ErrorEvent("unknown threadId"))
        assertEquals("error", machine.state.status)
        assertEquals("unknown threadId", machine.state.lastError)
    }

    @Test
    fun `v1 answer renders the same card grammar`() {
        val machine = wornMachine()
        machine.onEvent(
            CoreEvent.AnswerEvent(AnswerPayload("Spoken.", listOf(Citation("Only", "https://o")))),
        )
        val card = machine.state.stage as Stage.Card
        assertEquals("Spoken.", card.text)
        assertEquals(listOf("Only"), card.citations)
    }
}
