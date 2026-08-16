package com.readingcompanion.androidxr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream

/**
 * One-still Capture path (DEFINITIONS.md Capture / spec §4): back camera →
 * JPEG downscaled to ≤[MAX_DIMENSION_PX] px on the long edge → base64 for the
 * WS v2 `capture` message. Single stills only — the EscalationLevel ladder
 * (hardware-capability-spec.md §2) forbids continuous video outside ACTIVE.
 *
 * TODO(XR): on real AI glasses the world-facing camera is reached through the
 * PROJECTED CONTEXT — the phone-side app calls into the glasses camera via
 * androidx.xr.projected (xr-glasses-dev-guide/02-android-xr.md, "AI-glasses
 * camera access": /jetpack-xr-sdk/access-hardware-projected-context). This
 * CameraX path is the emulator/phone rendition of the same one-still grammar;
 * swap the camera *source* behind this class when the projected artifacts are
 * stable — the downscale + base64 + WS contract stays identical.
 */
class CaptureController(private val activity: ComponentActivity) {

    /** Captures one still; exactly one of the callbacks fires (on main thread). */
    fun captureStill(onJpegBase64: (String) -> Unit, onError: (String) -> Unit) {
        val future = ProcessCameraProvider.getInstance(activity)
        future.addListener({
            val provider = try {
                future.get()
            } catch (e: Exception) {
                onError("camera provider unavailable: ${e.message}")
                return@addListener
            }
            val imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .build()
            try {
                provider.unbindAll()
                provider.bindToLifecycle(activity, CameraSelector.DEFAULT_BACK_CAMERA, imageCapture)
            } catch (e: Exception) {
                onError("camera bind failed: ${e.message}")
                return@addListener
            }
            imageCapture.takePicture(
                ContextCompat.getMainExecutor(activity),
                object : ImageCapture.OnImageCapturedCallback() {
                    override fun onCaptureSuccess(image: ImageProxy) {
                        val encoded = try {
                            image.use { encodeJpeg(it) }
                        } catch (e: Exception) {
                            Log.e(TAG, "still encode failed", e)
                            null
                        } finally {
                            provider.unbind(imageCapture)
                        }
                        if (encoded != null) onJpegBase64(encoded) else onError("could not encode the captured still")
                    }

                    override fun onError(exception: ImageCaptureException) {
                        provider.unbind(imageCapture)
                        onError("capture failed: ${exception.message}")
                    }
                },
            )
        }, ContextCompat.getMainExecutor(activity))
    }

    private fun encodeJpeg(image: ImageProxy): String {
        // CAPTURE_MODE JPEG output: single plane of JPEG bytes.
        val buffer = image.planes[0].buffer
        val bytes = ByteArray(buffer.remaining()).also { buffer.get(it) }
        val source = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            ?: throw IllegalStateException("captured bytes are not a decodable JPEG")
        val scaled = downscale(source, MAX_DIMENSION_PX)
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    private fun downscale(bitmap: Bitmap, maxDim: Int): Bitmap {
        val longEdge = maxOf(bitmap.width, bitmap.height)
        if (longEdge <= maxDim) return bitmap
        val scale = maxDim.toFloat() / longEdge
        return Bitmap.createScaledBitmap(
            bitmap,
            (bitmap.width * scale).toInt().coerceAtLeast(1),
            (bitmap.height * scale).toInt().coerceAtLeast(1),
            true,
        )
    }

    private companion object {
        const val TAG = "CaptureController"
        const val MAX_DIMENSION_PX = 1024
        const val JPEG_QUALITY = 85
    }
}
