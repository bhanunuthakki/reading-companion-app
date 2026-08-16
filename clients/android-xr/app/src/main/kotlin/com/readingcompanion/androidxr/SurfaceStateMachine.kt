package com.readingcompanion.androidxr

/**
 * The glasses-surface state machine: hint → wait → badge → card → dismiss.
 *
 * This is the same "one thing on stage" grammar the Meta Ray-Ban Display
 * web-app renders on its 600×600 canvas (clients/meta-rbd/web-app/app.js),
 * expressed as a plain, synchronous, Compose-free class so it is unit-testable
 * on the JVM (SurfaceStateMachineTest). All IO (WebSocket, REST digest fetch,
 * earcon, TTS) is pushed out as [SurfaceEffect]s for the caller to execute.
 *
 * Etiquette rules implemented client-side (thought-partner-spec.md §7):
 * - Rule 2 defensive gate: a Digest delivered above `hold` while this client's
 *   wear state is not-worn is presented as `hold` locally. The DeliveryEngine
 *   in the Core already routes on wear state; this is the client refusing to
 *   present to glasses it believes are off-face (never rounding *up*).
 * - Rule 6: a Badge not glanced within [BADGE_EXPIRY_MS] is dismissed on the
 *   glasses; the Digest waits in its Thread on the phone ([onBadgeExpired] is
 *   driven by a timer the caller owns).
 * - Card grammar: TLDR + at most [MAX_CITATIONS_ON_GLASSES] citation titles +
 *   one action. Never body text on the glasses.
 */
class SurfaceStateMachine {

    var state: SurfaceState = SurfaceState()
        private set

    // ── Connection ──────────────────────────────────────────────────────────

    fun onSocketOpen(): List<SurfaceEffect> {
        state = state.copy(status = "ready")
        return emptyList()
    }

    fun onSocketClosed(): List<SurfaceEffect> {
        state = state.copy(status = "offline")
        return emptyList()
    }

    /** Wear state changed (WearStateSource). Gates future Digest presentation. */
    fun onWornChanged(worn: Boolean): List<SurfaceEffect> {
        state = state.copy(worn = worn)
        return emptyList()
    }

    // ── User intent ─────────────────────────────────────────────────────────

    fun onAskSubmitted(): List<SurfaceEffect> {
        state = state.copy(status = "asking…")
        return emptyList()
    }

    /** Pinch/tap on an expandable Badge → fetch the Digest (REST) for the card. */
    fun expandBadge(): List<SurfaceEffect> {
        val stage = state.stage
        if (stage !is Stage.Badge || !stage.expandable || stage.jobId == null) return emptyList()
        val threadId = state.threadId ?: return emptyList()
        state = state.copy(status = "opening…")
        return listOf(SurfaceEffect.FetchDigest(threadId = threadId, jobId = stage.jobId))
    }

    /** Digest fetched — show the TLDR card (≤3 citation titles, spec §7 grammar). */
    fun showDigestCard(tldr: String, citationTitles: List<String>): List<SurfaceEffect> {
        state = state.copy(
            status = "ready",
            stage = Stage.Card(
                text = tldr,
                citations = citationTitles.take(MAX_CITATIONS_ON_GLASSES),
                note = CARD_NOTE,
            ),
            badgeJobId = null,
        )
        return emptyList()
    }

    fun digestFetchFailed(): List<SurfaceEffect> {
        state = state.copy(status = "error", stage = Stage.Hint(HINT_DIGEST_ON_PHONE), badgeJobId = null)
        return emptyList()
    }

    /** Up-swipe / dismiss: clear whatever is on stage back to the hint. */
    fun dismiss(): List<SurfaceEffect> {
        state = state.copy(status = "ready", stage = Stage.Hint(HINT_DEFAULT), badgeJobId = null)
        return emptyList()
    }

    /** Spec §7 rule 6 — badge expiry timer fired. */
    fun onBadgeExpired(jobId: String): List<SurfaceEffect> {
        val stage = state.stage
        if (stage is Stage.Badge && stage.jobId == jobId) {
            state = state.copy(status = "on your phone", stage = Stage.Hint(HINT_HELD), badgeJobId = null)
        }
        return emptyList()
    }

    // ── Core events ─────────────────────────────────────────────────────────

    fun onEvent(event: CoreEvent): List<SurfaceEffect> = when (event) {
        is CoreEvent.AskRouted -> onAskRouted(event)
        is CoreEvent.JobUpdate -> onJobUpdate(event)
        is CoreEvent.Deliver -> onDeliver(event)
        is CoreEvent.CaptureStored -> {
            state = state.copy(status = "captured ${event.kind}")
            emptyList()
        }
        is CoreEvent.WatcherArmed -> {
            state = state.copy(
                status = "watching",
                stage = Stage.Badge(text = "Watching: ${event.topic}", jobId = null, expandable = false),
            )
            emptyList()
        }
        is CoreEvent.Opened -> {
            state = state.copy(status = event.sessionState)
            emptyList()
        }
        is CoreEvent.AnswerEvent -> {
            state = state.copy(
                status = "ready",
                stage = Stage.Card(
                    text = event.answer.text,
                    citations = event.answer.citations.take(MAX_CITATIONS_ON_GLASSES).map { it.title },
                    note = CARD_NOTE,
                ),
            )
            emptyList()
        }
        is CoreEvent.PageObserved -> {
            state = state.copy(status = "reading")
            emptyList()
        }
        is CoreEvent.Transcript, is CoreEvent.AudioChunk -> emptyList()
        is CoreEvent.ErrorEvent -> {
            state = state.copy(status = "error", lastError = event.message)
            emptyList()
        }
        is CoreEvent.Unknown -> {
            // Logged by the caller; never rendered. Keep status untouched.
            emptyList()
        }
    }

    private fun onAskRouted(event: CoreEvent.AskRouted): List<SurfaceEffect> {
        state = state.copy(threadId = event.threadId)
        return when {
            event.route == "background" -> {
                state = state.copy(
                    status = "on it…",
                    stage = Stage.Wait(WAIT_TEXT),
                    activeJobId = event.jobId,
                )
                emptyList()
            }
            event.answer != null -> {
                state = state.copy(
                    status = "ready",
                    stage = Stage.Card(
                        text = event.answer.text,
                        citations = event.answer.citations.take(MAX_CITATIONS_ON_GLASSES).map { it.title },
                        note = CARD_NOTE,
                    ),
                )
                emptyList()
            }
            else -> {
                // fast route without an answer violates the contract — fail loudly.
                state = state.copy(status = "error", lastError = "ask_routed fast without answer")
                emptyList()
            }
        }
    }

    private fun onJobUpdate(event: CoreEvent.JobUpdate): List<SurfaceEffect> {
        when (event.state) {
            // "queued" may arrive BEFORE ask_routed (core/README.md); correlate later
            // via the jobId in ask_routed — nothing to present yet.
            "queued" -> Unit
            "running" -> state = state.copy(status = "researching…")
            "failed" -> {
                state = state.copy(status = "failed", activeJobId = null)
                if (state.stage is Stage.Wait) state = state.copy(stage = Stage.Hint(HINT_DEFAULT))
            }
            "archived" -> {
                // Reached via job_cancel; clear the wait if we were waiting on it.
                if (state.activeJobId == event.jobId) {
                    state = state.copy(status = "cancelled", activeJobId = null)
                    if (state.stage is Stage.Wait) state = state.copy(stage = Stage.Hint(HINT_DEFAULT))
                }
            }
            "digest_ready", "delivered" -> Unit // presentation is driven by `deliver`
        }
        return emptyList()
    }

    private fun onDeliver(event: CoreEvent.Deliver): List<SurfaceEffect> {
        // Defensive wear gate (spec §7 rule 2): never present above hold off-face.
        val level = if (!state.worn && event.level != "hold") "hold" else event.level
        if (state.activeJobId == event.jobId) state = state.copy(activeJobId = null)

        if (level == "hold") {
            state = state.copy(status = "on your phone", stage = Stage.Hint(HINT_HELD), badgeJobId = null)
            return emptyList()
        }

        state = state.copy(
            status = "digest ready",
            stage = Stage.Badge(
                text = event.badge ?: event.tldr ?: "Digest ready",
                jobId = event.jobId,
                expandable = true,
            ),
            badgeJobId = event.jobId,
        )
        return buildList {
            add(SurfaceEffect.ArmBadgeExpiry(jobId = event.jobId, afterMs = BADGE_EXPIRY_MS))
            if (level == "earcon" || level == "speak") add(SurfaceEffect.PlayEarcon)
            if (level == "speak" && event.tldr != null) add(SurfaceEffect.Speak(event.tldr))
        }
    }

    companion object {
        const val MAX_CITATIONS_ON_GLASSES = 3
        const val BADGE_EXPIRY_MS = 10L * 60L * 1000L // spec §7 rule 6: 10 min

        const val HINT_DEFAULT = "Hold to talk and ask about what you're doing."
        const val HINT_HELD = "A digest arrived quietly — it's waiting on your phone."
        const val HINT_DIGEST_ON_PHONE = "Couldn't open the digest — it's still on your phone."
        const val WAIT_TEXT = "On it — keep reading. I'll come back."
        const val CARD_NOTE = "dismiss · full digest on your phone"
    }
}

/** What is on the stage. Exactly one thing at a time — this is a glance, not a screen. */
sealed interface Stage {
    data class Hint(val text: String) : Stage
    data class Wait(val text: String) : Stage

    /** Silent chip (InterruptLevel `badge`); expandable when it carries a Digest. */
    data class Badge(val text: String, val jobId: String?, val expandable: Boolean) : Stage

    /** TLDR card: spoken-prose text + ≤3 citation titles + one action. */
    data class Card(val text: String, val citations: List<String>, val note: String) : Stage
}

/** Immutable machine state; the ViewModel copies this into Compose UI state. */
data class SurfaceState(
    val status: String = "connecting",
    val stage: Stage = Stage.Hint(SurfaceStateMachine.HINT_DEFAULT),
    val worn: Boolean = false, // wear defaults to not-worn (core/README.md)
    val threadId: String? = null,
    val activeJobId: String? = null,
    val badgeJobId: String? = null,
    val lastError: String? = null,
)

/** Side-effects the machine requests; executed by CompanionViewModel/MainActivity. */
sealed interface SurfaceEffect {
    data object PlayEarcon : SurfaceEffect
    data class Speak(val text: String) : SurfaceEffect
    data class FetchDigest(val threadId: String, val jobId: String) : SurfaceEffect
    data class ArmBadgeExpiry(val jobId: String, val afterMs: Long) : SurfaceEffect
}
