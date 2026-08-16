package com.readingcompanion.androidxr

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import com.readingcompanion.androidxr.ui.PhonePreviewSurface

/**
 * DEFAULT GlassesSurface binding (source set `surface-phone`, compiled unless
 * `-PenableGlimmer=true`). Depends only on stable artifacts and runs on BOTH
 * the ai_glasses AVD and a plain phone AVD:
 *
 * - Surface: [PhonePreviewSurface] — plain-Compose rendition of the glasses
 *   surface (additive look, square stage, one-thing-at-a-time grammar).
 * - Wear: [ManualWearSource] — a UI toggle; the AVDs have no on-face sensor
 *   and this binding never pretends otherwise.
 */
object GlassesSurfaceBinding {

    const val NAME = "phone-preview"

    fun createWearSource(activity: ComponentActivity): WearStateSource = ManualWearSource()

    @Composable
    fun GlassesSurface(state: CompanionUiState, actions: SurfaceActions) {
        PhonePreviewSurface(state, actions)
    }
}
