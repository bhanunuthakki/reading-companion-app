package com.readingcompanion.androidxr

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable

/**
 * GLIMMER GlassesSurface binding (source set `surface-glimmer`, compiled only
 * with `-PenableGlimmer=true`, which also adds the alpha androidx.xr.glimmer /
 * androidx.xr.projected dependencies).
 *
 * - Surface: [GlimmerSurface] — real Glimmer composables (TitleChip, Card,
 *   focus outlines) per the documented API.
 * - Wear: [ProjectedLifecycleWearSource] — DP4 Device Availability API wear
 *   lifecycle feeding `{ type: "wear" }`.
 */
object GlassesSurfaceBinding {

    const val NAME = "glimmer"

    fun createWearSource(activity: ComponentActivity): WearStateSource =
        ProjectedLifecycleWearSource(activity)

    @Composable
    fun GlassesSurface(state: CompanionUiState, actions: SurfaceActions) {
        GlimmerSurface(state, actions)
    }
}
