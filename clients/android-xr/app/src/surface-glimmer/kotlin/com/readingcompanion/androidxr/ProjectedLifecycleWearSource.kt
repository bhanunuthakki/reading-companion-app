package com.readingcompanion.androidxr

import androidx.activity.ComponentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Wear state from the Projected runtime's Device Availability lifecycle
 * (glimmer source set only — compiled with `-PenableGlimmer=true`).
 *
 * TODO(XR): DP4's Device Availability API "consolidates wear-state and
 * connectivity into standard Android Lifecycle.State values. So onResume /
 * onPause now actually fire when the user puts the glasses on or off"
 * (xr-glasses-dev-guide/12-io-2026-updates.md, "Jetpack Projected — concrete
 * updates"; also 02-android-xr.md, xr-projected). This class therefore
 * observes the PROJECTED activity's lifecycle: ON_RESUME → worn=true,
 * ON_PAUSE → worn=false. If the alpha `androidx.xr.projected` artifacts
 * expose a dedicated device-availability listener type, prefer it over raw
 * lifecycle observation and replace this observer — the [WearStateSource]
 * seam and the `{ type: "wear" }` plumbing do not change.
 *
 * IMPORTANT: these semantics are only correct when the activity is actually
 * hosted in the Projected context. On a phone/emulator without Projected,
 * onResume just means "app foregrounded" — which is why the DEFAULT build
 * uses ManualWearSource instead.
 */
class ProjectedLifecycleWearSource(activity: ComponentActivity) : WearStateSource {

    private val _worn = MutableStateFlow(false) // wear defaults to not-worn (core/README.md)
    override val worn: StateFlow<Boolean> = _worn.asStateFlow()

    init {
        activity.lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onResume(owner: LifecycleOwner) {
                _worn.value = true // glasses on-face (Device Availability API)
            }

            override fun onPause(owner: LifecycleOwner) {
                _worn.value = false // glasses removed; the Session persists in the Core
            }
        })
    }
}
