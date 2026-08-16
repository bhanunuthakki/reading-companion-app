package com.readingcompanion.androidxr

// ─────────────────────────────────────────────────────────────────────────────
// GLIMMER-FLAVOR TEST — compiled only with `-PenableGlimmer=true`.
//
// This is where ProjectedTestRule slots in: DP4's projected-testing artifact
// ("Automates projected-test-environment setup for unit testing. Spin up a
// mock glasses runtime in a JVM test without needing an emulator" —
// xr-glasses-dev-guide/12-io-2026-updates.md; artifact
// androidx.xr.projected:projected-testing:1.0.0-alpha07). The rule drives the
// projected activity's lifecycle the way real wear events do, which lets us
// assert the full chain: on-face → ON_RESUME → ProjectedLifecycleWearSource
// → worn=true → { "type": "wear", "worn": true } on the wire.
//
// The exact ProjectedTestRule API is UNVERIFIED against a resolvable artifact;
// integration must reconcile the imports below with the shipped alpha.
// ─────────────────────────────────────────────────────────────────────────────

import androidx.xr.projected.testing.ProjectedTestRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ProjectedWearLifecycleTest {

    @get:Rule
    val projected = ProjectedTestRule()

    @Test
    fun `wear lifecycle maps to wear messages`() {
        // Launch the activity inside the mock glasses runtime.
        projected.launchActivity(MainActivity::class.java)
        val source = ProjectedLifecycleWearSource(projected.activity)

        // Not-worn until the runtime reports on-face (Core contract default).
        assertFalse(source.worn.value)

        projected.setDeviceWorn(true) // Device Availability API → ON_RESUME
        assertTrue(source.worn.value)
        assertEquals(true, WsCodec.wear(source.worn.value).getBoolean("worn"))

        projected.setDeviceWorn(false) // off-face → ON_PAUSE
        assertFalse(source.worn.value)
        assertEquals(false, WsCodec.wear(source.worn.value).getBoolean("worn"))
    }
}
