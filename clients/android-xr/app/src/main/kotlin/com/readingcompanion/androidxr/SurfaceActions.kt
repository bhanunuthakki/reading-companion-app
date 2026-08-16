package com.readingcompanion.androidxr

/**
 * Everything a glasses surface can ask of the app. Both surfaces —
 * PhonePreviewSurface (default) and GlimmerSurface (glimmer source set) —
 * render CompanionUiState and speak back through exactly this contract.
 */
class SurfaceActions(
    /** Hold-to-talk press (temple-tap PTT stand-in). */
    val onTalkStart: () -> Unit,
    /** Hold-to-talk release. */
    val onTalkEnd: () -> Unit,
    /** Explicit typed fallback — used when SpeechRecognizer is unavailable. */
    val onTypedAsk: (String) -> Unit,
    /** Canned Research / Quick / Watch asks (same grammar as the Meta surface). */
    val onResearch: () -> Unit,
    val onQuick: () -> Unit,
    val onWatch: () -> Unit,
    /** One-still Capture. */
    val onCapture: () -> Unit,
    /** Pinch/tap on an expandable Badge → TLDR card. */
    val onExpand: () -> Unit,
    /** Up-swipe / dismiss whatever is on stage. */
    val onDismiss: () -> Unit,
    /** Cancel the in-flight background ResearchJob. */
    val onCancelJob: () -> Unit,
    /** Manual wear toggle (ManualWearSource surfaces only). */
    val onWearToggle: (Boolean) -> Unit,
    /** Point the client at a different Core. */
    val onCoreUrlChange: (String) -> Unit,
)
