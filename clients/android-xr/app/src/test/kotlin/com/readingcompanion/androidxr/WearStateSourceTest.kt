package com.readingcompanion.androidxr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wear-source → `{ type: "wear" }` message mapping. The behavioral contract
 * (core/README.md): wear state defaults to NOT-worn; a client that never
 * announces worn=true gets every delivery held to the phone.
 */
class WearStateSourceTest {

    @Test
    fun `manual source starts not-worn — the Core contract default`() {
        val source = ManualWearSource()
        assertFalse(source.worn.value)
    }

    @Test
    fun `set toggles the flow value`() {
        val source = ManualWearSource()
        source.set(true)
        assertTrue(source.worn.value)
        source.set(false)
        assertFalse(source.worn.value)
    }

    @Test
    fun `wear state maps to the exact wire message`() {
        val source = ManualWearSource()

        val notWorn = WsCodec.wear(source.worn.value)
        assertEquals("wear", notWorn.getString("type"))
        assertFalse(notWorn.getBoolean("worn"))

        source.set(true)
        val worn = WsCodec.wear(source.worn.value)
        assertEquals("wear", worn.getString("type"))
        assertTrue(worn.getBoolean("worn"))
        assertEquals(2, worn.length()) // exactly { type, worn } — nothing else on the wire
    }

    @Test
    fun `machine gates delivery on the source's wear state`() {
        // End-to-end of the plumbing this module exists for: not-worn → a
        // badge-level deliver presents as hold (spec §7 rule 2, client side).
        val source = ManualWearSource()
        val machine = SurfaceStateMachine()
        machine.onWornChanged(source.worn.value) // false

        machine.onEvent(CoreEvent.Deliver(level = "badge", surface = "glasses", jobId = "j1", tldr = "t", badge = "b"))
        assertTrue(machine.state.stage is Stage.Hint)
        assertEquals("on your phone", machine.state.status)

        source.set(true)
        machine.onWornChanged(source.worn.value)
        machine.onEvent(CoreEvent.Deliver(level = "badge", surface = "glasses", jobId = "j2", tldr = "t", badge = "b"))
        assertTrue(machine.state.stage is Stage.Badge)
    }
}
