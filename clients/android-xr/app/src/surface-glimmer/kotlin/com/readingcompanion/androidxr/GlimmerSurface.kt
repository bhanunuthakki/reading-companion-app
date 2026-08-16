package com.readingcompanion.androidxr

// TODO(XR): ALPHA IMPORTS — this file compiles only with -PenableGlimmer=true,
// which adds the androidx.xr.glimmer alpha artifact. Component names are per
// the documented Glimmer surface (xr-glasses-dev-guide/02-android-xr.md:
// "Text, Icon, TitleChip, Card, List, Button. Focus-state outlines, no
// ripples"; 12-io-2026-updates.md: Google Sans Flex, Stacks, Title Chips).
// Exact signatures are UNVERIFIED against a resolvable artifact — integration
// must reconcile imports/params with the shipped alpha before first build.
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.xr.glimmer.Button
import androidx.xr.glimmer.Card
import androidx.xr.glimmer.Text
import androidx.xr.glimmer.TitleChip

/**
 * GlimmerSurface — the real additive UI for Android XR AI glasses, expressing
 * the same grammar as PhonePreviewSurface and the Meta 600×600 web-app: one
 * thing on stage; badge → pinch → TLDR card (≤3 citation titles) → dismiss.
 *
 * Glimmer conventions honored: TitleChip header for categorization, Card for
 * the digest, focus outlines instead of ripples (Glimmer's own focus model),
 * Google Sans Flex via the Glimmer defaults. No scrolling body text — the
 * Digest body renders only on the phone (spec §7 card grammar).
 */
@Composable
fun GlimmerSurface(state: CompanionUiState, actions: SurfaceActions) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Title Chips categorize the surface (DP4 Glimmer component).
        TitleChip { Text(if (state.connected) state.status else "offline") }
        Spacer(Modifier.height(12.dp))

        when (val stage = state.stage) {
            is Stage.Hint -> Text(stage.text)
            is Stage.Wait -> Text(stage.text)
            is Stage.Badge -> {
                // Focus-outlined chip; pinch (select) expands the Digest.
                Button(onClick = { if (stage.expandable) actions.onExpand() }) {
                    Text(stage.text)
                }
            }
            is Stage.Card -> Card {
                Column {
                    Text(stage.text)
                    stage.citations.forEachIndexed { i, title -> Text("${i + 1}. $title") }
                    Text(stage.note)
                    Button(onClick = actions.onDismiss) { Text("Dismiss") }
                }
            }
        }
    }
}
