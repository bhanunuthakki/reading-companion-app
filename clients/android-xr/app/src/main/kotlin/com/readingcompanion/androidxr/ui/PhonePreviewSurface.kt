package com.readingcompanion.androidxr.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.readingcompanion.androidxr.CompanionUiState
import com.readingcompanion.androidxr.Stage
import com.readingcompanion.androidxr.SurfaceActions

/**
 * PhonePreviewSurface — the DEFAULT GlassesSurface everywhere, including the
 * ai_glasses AVD (the AI Glasses Developer Preview image runs standard
 * Android apps). A faithful plain-Compose rendition of the glasses surface:
 *
 * - dark ADDITIVE look (black renders transparent on a waveguide — same
 *   convention as the Meta 600×600 web-app),
 * - a SQUARE stage showing exactly one thing at a time
 *   (hint → wait → badge → card → dismiss),
 * - Title-Chip-style header and focus-outline styling per the documented
 *   Glimmer idiom (Google Sans Flex is not available outside the alpha
 *   artifacts; the system sans stands in),
 * - a dock of quick actions matching the Meta surface's canned asks.
 *
 * Below the square: phone-only controls (wear toggle, Core URL, typed ask) —
 * the parts of the demo harness that would never render on glasses.
 */
@Composable
fun PhonePreviewSurface(state: CompanionUiState, actions: SurfaceActions) {
    MaterialTheme(colorScheme = darkColorScheme()) {
        var showAskDialog by remember { mutableStateOf(false) }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            HeaderChips(state)
            Spacer(Modifier.height(12.dp))
            StageSquare(state, actions)
            Spacer(Modifier.height(12.dp))
            Dock(state, actions, onType = { showAskDialog = true })
            Spacer(Modifier.height(20.dp))
            PhoneControls(state, actions)
        }

        if (showAskDialog) {
            AskDialog(
                speechAvailable = state.speechAvailable,
                onAsk = {
                    showAskDialog = false
                    actions.onTypedAsk(it)
                },
                onDismiss = { showAskDialog = false },
            )
        }
    }
}

// ── Palette (additive: bright strokes on black) ─────────────────────────────

private val Amber = Color(0xFFFFB74D)
private val Cyan = Color(0xFF80DEEA)
private val Paper = Color(0xFFECECEC)
private val Dim = Color(0xFF9E9E9E)
private val Outline = Color(0xFF3A3A3A)

// ── Header: Title-Chip-style row ─────────────────────────────────────────────

@Composable
private fun HeaderChips(state: CompanionUiState) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TitleChipLike(text = "COMPANION", color = Cyan)
        TitleChipLike(
            text = if (state.connected) state.status else "offline",
            color = if (state.connected) Amber else Dim,
        )
    }
}

@Composable
private fun TitleChipLike(text: String, color: Color) {
    Box(
        modifier = Modifier
            .border(1.dp, color, RoundedCornerShape(50))
            .padding(horizontal = 14.dp, vertical = 6.dp),
    ) {
        Text(text = text.uppercase(), color = color, fontSize = 12.sp, letterSpacing = 1.5.sp)
    }
}

// ── Stage: the square, one-thing-at-a-time glasses canvas ───────────────────

@Composable
private fun StageSquare(state: CompanionUiState, actions: SurfaceActions) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .border(1.dp, Outline, RoundedCornerShape(12.dp))
            .padding(20.dp),
        contentAlignment = Alignment.Center,
    ) {
        when (val stage = state.stage) {
            is Stage.Hint -> Text(
                text = stage.text,
                color = Dim,
                fontSize = 18.sp,
                textAlign = TextAlign.Center,
                lineHeight = 26.sp,
            )
            is Stage.Wait -> Text(
                text = stage.text,
                color = Cyan,
                fontSize = 20.sp,
                textAlign = TextAlign.Center,
                lineHeight = 28.sp,
            )
            is Stage.Badge -> BadgeChip(stage, actions)
            is Stage.Card -> DigestCard(stage, actions)
        }
    }
}

/** Amber badge chip; focus-outlined when expandable (pinch/tap = open). */
@Composable
private fun BadgeChip(stage: Stage.Badge, actions: SurfaceActions) {
    val focusBorder = if (stage.expandable) Amber else Outline
    Row(
        modifier = Modifier
            .border(2.dp, focusBorder, RoundedCornerShape(50))
            .clickable(enabled = stage.expandable) { actions.onExpand() }
            .padding(horizontal = 18.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(10.dp)
                .background(Amber, CircleShape),
        )
        Spacer(Modifier.width(10.dp))
        Text(text = stage.text, color = Paper, fontSize = 16.sp)
    }
}

/** TLDR card: big spoken-prose text + ≤3 citation titles + one action. */
@Composable
private fun DigestCard(stage: Stage.Card, actions: SurfaceActions) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(2.dp, Amber, RoundedCornerShape(12.dp))
            .clickable { actions.onDismiss() }
            .padding(18.dp),
    ) {
        Text(text = stage.text, color = Paper, fontSize = 19.sp, lineHeight = 27.sp)
        Spacer(Modifier.height(12.dp))
        stage.citations.forEachIndexed { i, title ->
            Text(text = "${i + 1}. $title", color = Cyan, fontSize = 13.sp, lineHeight = 20.sp)
        }
        Spacer(Modifier.height(12.dp))
        Text(text = stage.note, color = Dim, fontSize = 12.sp)
    }
}

// ── Dock: quick actions + hold-to-talk + capture ────────────────────────────

@Composable
private fun Dock(state: CompanionUiState, actions: SurfaceActions, onType: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DockButton("Research", Modifier.weight(1f)) { actions.onResearch() }
        DockButton("Quick", Modifier.weight(1f)) { actions.onQuick() }
        DockButton("Watch", Modifier.weight(1f)) { actions.onWatch() }
        DockButton("Capture", Modifier.weight(1f)) { actions.onCapture() }
    }
    Spacer(Modifier.height(10.dp))
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HoldToTalkButton(state, actions, onType, Modifier.weight(2f))
        if (state.cancellableJobId != null) {
            DockButton("Cancel job", Modifier.weight(1f)) { actions.onCancelJob() }
        }
        DockButton("Type", Modifier.weight(1f), onClick = onType)
    }
}

@Composable
private fun DockButton(label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .border(1.dp, Outline, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = label, color = Paper, fontSize = 14.sp)
    }
}

/**
 * Hold-to-talk = the temple-tap PTT stand-in. Press opens the mic, release
 * closes it. When SpeechRecognizer is unavailable (common on AVDs) a tap
 * opens the explicit typed-ask dialog instead — never fabricated speech.
 */
@Composable
private fun HoldToTalkButton(
    state: CompanionUiState,
    actions: SurfaceActions,
    onType: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val active = state.listening
    Box(
        modifier = modifier
            .border(
                width = 2.dp,
                color = if (active) Amber else Cyan,
                shape = RoundedCornerShape(10.dp),
            )
            .pointerInput(state.speechAvailable) {
                detectTapGestures(
                    onPress = {
                        if (state.speechAvailable) {
                            actions.onTalkStart()
                            tryAwaitRelease()
                            actions.onTalkEnd()
                        } else {
                            tryAwaitRelease()
                            onType()
                        }
                    },
                )
            }
            .padding(vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = when {
                active -> "Listening… release to ask"
                state.speechAvailable -> "Hold to talk"
                else -> "Speech unavailable — tap to type"
            },
            color = if (active) Amber else Cyan,
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

// ── Phone-only controls (never rendered on glasses) ─────────────────────────

@Composable
private fun PhoneControls(state: CompanionUiState, actions: SurfaceActions) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(text = "PHONE HARNESS", color = Dim, fontSize = 11.sp, letterSpacing = 1.5.sp)
        Spacer(Modifier.height(8.dp))

        if (state.manualWear) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(text = "Glasses worn (manual)", color = Paper, fontSize = 14.sp)
                    Text(
                        text = "Feeds { type: \"wear\" } — not-worn holds every delivery to the phone.",
                        color = Dim,
                        fontSize = 11.sp,
                    )
                }
                Switch(
                    checked = state.worn,
                    onCheckedChange = actions.onWearToggle,
                    colors = SwitchDefaults.colors(checkedTrackColor = Amber),
                )
            }
            Spacer(Modifier.height(12.dp))
        }

        var urlDraft by remember(state.coreUrl) { mutableStateOf(state.coreUrl) }
        OutlinedTextField(
            value = urlDraft,
            onValueChange = { urlDraft = it },
            label = { Text("Core URL (ws://…/ws)") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            TextButton(
                onClick = { actions.onCoreUrlChange(urlDraft.trim()) },
                enabled = urlDraft.trim() != state.coreUrl && urlDraft.isNotBlank(),
            ) {
                Text("Reconnect", color = Cyan)
            }
        }

        state.lastError?.let {
            Spacer(Modifier.height(6.dp))
            Text(text = it, color = Color(0xFFEF9A9A), fontSize = 12.sp)
        }
    }
}

@Composable
private fun AskDialog(speechAvailable: Boolean, onAsk: (String) -> Unit, onDismiss: () -> Unit) {
    var draft by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (speechAvailable) "Type a question" else "Speech recognition unavailable — type your question") },
        text = {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                label = { Text("Question") },
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(onClick = { if (draft.isNotBlank()) onAsk(draft.trim()) }) { Text("Ask") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}
