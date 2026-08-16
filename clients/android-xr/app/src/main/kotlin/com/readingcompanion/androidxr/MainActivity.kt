package com.readingcompanion.androidxr

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope

/**
 * The companion activity. On Android XR AI glasses this runs on the **phone**
 * and the Jetpack **Projected** runtime renders the glasses surface on the
 * connected eyewear, routing camera/mic/touch back here (the Projected model —
 * xr-glasses-dev-guide/02-android-xr.md "AI glasses path"). On the ai_glasses
 * AVD and on a plain phone AVD this same activity renders PhonePreviewSurface,
 * a faithful plain-Compose rendition of that surface.
 *
 * Which GlassesSurface renders — and where wear state comes from — is decided
 * by [GlassesSurfaceBinding], swapped per source set at build time:
 * - default: surface-phone (PhonePreviewSurface + ManualWearSource)
 * - `-PenableGlimmer=true`: surface-glimmer (GlimmerSurface + Projected
 *   Device Availability wear lifecycle, alpha androidx.xr.* artifacts)
 *
 * TODO(XR): when the androidx.xr.projected artifacts are stable, host this
 * activity in the Projected context so it renders on the glasses rather than
 * the phone screen, and route the camera through the projected context (see
 * CaptureController). Citations: xr-glasses-dev-guide/02-android-xr.md
 * (xr-projected, AI-glasses camera access) and 12-io-2026-updates.md (DP4
 * Device Availability API, ProjectedTestRule).
 */
class MainActivity : ComponentActivity() {

    private lateinit var settings: CompanionSettings
    private lateinit var wearSource: WearStateSource
    private lateinit var audioCues: AudioCues
    private lateinit var viewModel: CompanionViewModel
    private lateinit var speech: SpeechInput
    private lateinit var captureController: CaptureController

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
            grants.forEach { (permission, granted) ->
                if (!granted) Log.w(TAG, "$permission denied — the dependent path will explain itself when used")
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        settings = CompanionSettings(this)
        wearSource = GlassesSurfaceBinding.createWearSource(this)
        audioCues = AudioCues(this)
        captureController = CaptureController(this)

        viewModel = CompanionViewModel(
            initialCoreUrl = settings.coreUrl,
            wearSource = wearSource,
            audio = audioCues,
            scope = lifecycleScope,
        )

        speech = SpeechInput(
            context = this,
            onResult = { viewModel.ask(it) },
            onListeningChanged = { viewModel.setListening(it) },
            onUnavailable = { viewModel.setSpeechAvailable(false) },
        )
        viewModel.setSpeechAvailable(speech.available)

        val actions = SurfaceActions(
            onTalkStart = { startTalking() },
            onTalkEnd = { speech.stop() },
            onTypedAsk = { viewModel.ask(it) },
            onResearch = { viewModel.quickResearch() },
            onQuick = { viewModel.quickAsk() },
            onWatch = { viewModel.watch() },
            onCapture = { captureStill() },
            onExpand = { viewModel.expandBadge() },
            onDismiss = { viewModel.dismiss() },
            onCancelJob = { viewModel.cancelActiveJob() },
            onWearToggle = { viewModel.setManualWear(it) },
            onCoreUrlChange = { url ->
                settings.coreUrl = url
                viewModel.updateCoreUrl(url)
            },
        )

        setContent {
            val state by viewModel.ui.collectAsState()
            GlassesSurfaceBinding.GlassesSurface(state, actions)
        }

        viewModel.start()
        requestMissingPermissions()
    }

    override fun onDestroy() {
        speech.destroy()
        audioCues.shutdown()
        viewModel.stop()
        super.onDestroy()
    }

    private fun startTalking() {
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            permissionLauncher.launch(arrayOf(Manifest.permission.RECORD_AUDIO))
            return
        }
        speech.start()
    }

    private fun captureStill() {
        if (!hasPermission(Manifest.permission.CAMERA)) {
            permissionLauncher.launch(arrayOf(Manifest.permission.CAMERA))
            return
        }
        captureController.captureStill(
            onJpegBase64 = { viewModel.capture(it) },
            onError = { message ->
                Log.e(TAG, "capture error: $message")
                // Fail loudly through the same error presentation a Core error
                // frame gets: status "error" + lastError on the harness panel.
                viewModel.reportLocalError(message)
            },
        )
    }

    private fun requestMissingPermissions() {
        val wanted = listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
            .filterNot(::hasPermission)
        if (wanted.isNotEmpty()) permissionLauncher.launch(wanted.toTypedArray())
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private companion object {
        const val TAG = "MainActivity"
    }
}
