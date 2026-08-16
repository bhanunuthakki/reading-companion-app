package com.readingcompanion.androidxr

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Where the on-face signal comes from. The DeliveryEngine in the Core keys
 * etiquette rule 2 ("never deliver to glasses that aren't worn") off the
 * `{ type: "wear", worn }` messages this source feeds — and the Core defaults
 * to NOT-worn, so a client that never sends wear gets every delivery held to
 * the phone (core/README.md).
 *
 * Implementations:
 * - [ManualWearSource] (default build) — a UI toggle standing in for the
 *   on-face sensor. Honest: it claims to be manual, it does not fake hardware.
 * - ProjectedLifecycleWearSource (glimmer source set only) — DP4 Device
 *   Availability API: the Projected activity's onResume/onPause fire when the
 *   user puts the glasses on/off (12-io-2026-updates.md).
 */
interface WearStateSource {
    /** Current wear state. MUST start `false` — wear defaults to not-worn. */
    val worn: StateFlow<Boolean>
}

/** UI-toggle wear source for phone/emulator builds. Starts not-worn. */
class ManualWearSource : WearStateSource {
    private val _worn = MutableStateFlow(false)
    override val worn: StateFlow<Boolean> = _worn.asStateFlow()

    fun set(worn: Boolean) {
        _worn.value = worn
    }
}
