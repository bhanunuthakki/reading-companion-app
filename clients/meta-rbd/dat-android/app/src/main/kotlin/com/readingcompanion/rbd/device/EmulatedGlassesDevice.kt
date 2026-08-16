package com.readingcompanion.rbd.device

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.ToneGenerator
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner

/**
 * The default [GlassesDevice]: the phone emulates the glasses so the whole
 * felt loop runs on a stock emulator with ZERO Meta artifacts (thought-partner-
 * spec.md §8.1: mwdat-mockdevice is the hardware path's dev aid; this class is
 * the no-SDK path — our demo target).
 *
 * Stand-ins:
 *  - glasses camera still  → CameraX ImageCapture (emulator virtual camera)
 *  - beamformed mic stream → AudioRecord, 16 kHz mono PCM16
 *  - open-ear speaker      → AudioTrack (PCM) + ToneGenerator (earcon)
 *  - Neural Band gestures  → the Activity's on-screen buttons calling
 *    [simulateTap]/[simulateLongPressStart]/[simulateLongPressEnd]
 *  - on-face sensing       → the Activity's wear toggle calling [setWorn]
 *
 * Battery discipline (hardware-capability-spec.md §2): the camera binds ONLY
 * an ImageCapture use case — no Preview, no ImageAnalysis, no frame loop. Each
 * still is one explicit `alerted`-level action; nothing here can stream.
 */
class EmulatedGlassesDevice(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
) : GlassesDevice {

    private var listener: GlassesDevice.Listener? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private var imageCapture: ImageCapture? = null
    private var toneGenerator: ToneGenerator? = null

    private var audioRecord: AudioRecord? = null
    private var micThread: Thread? = null
    @Volatile private var micRunning = false

    @Volatile private var worn = false
    override val isWorn: Boolean get() = worn

    override fun connect(listener: GlassesDevice.Listener) {
        this.listener = listener
        toneGenerator = ToneGenerator(AudioManager.STREAM_NOTIFICATION, EARCON_VOLUME)

        if (!hasPermission(Manifest.permission.CAMERA)) {
            // Fail loudly: connect "succeeds" (mic/speaker still work) but the
            // missing camera is reported, not discovered later as a mystery.
            listener.onConnectionState(true, "connected WITHOUT camera (CAMERA permission not granted)")
            return
        }
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            try {
                val provider = future.get()
                val capture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .build()
                provider.unbindAll()
                // ImageCapture use case only — see class doc (no frame loop).
                provider.bindToLifecycle(lifecycleOwner, androidx.camera.core.CameraSelector.DEFAULT_BACK_CAMERA, capture)
                cameraProvider = provider
                imageCapture = capture
                listener.onConnectionState(true, "connected (emulated glasses; CameraX bound)")
            } catch (e: Exception) {
                listener.onConnectionState(true, "connected WITHOUT camera (bind failed: ${e.message})")
            }
        }, ContextCompat.getMainExecutor(context))
    }

    override fun disconnect() {
        stopMicCapture()
        cameraProvider?.unbindAll()
        cameraProvider = null
        imageCapture = null
        toneGenerator?.release()
        toneGenerator = null
        listener?.onConnectionState(false, "disconnected")
        listener = null
    }

    // ── Emulator-only injection points (the on-screen controls) ─────────────

    fun setWorn(newWorn: Boolean) {
        worn = newWorn
        listener?.onWearState(newWorn)
    }

    fun simulateTap() {
        listener?.onGesture(GlassesDevice.Gesture.TAP)
    }

    fun simulateLongPressStart() {
        listener?.onGesture(GlassesDevice.Gesture.LONG_PRESS_START)
    }

    fun simulateLongPressEnd() {
        listener?.onGesture(GlassesDevice.Gesture.LONG_PRESS_END)
    }

    // ── Camera ───────────────────────────────────────────────────────────────

    override fun captureStill(onJpeg: (ByteArray) -> Unit, onError: (Throwable) -> Unit) {
        val capture = imageCapture
        if (capture == null) {
            onError(IllegalStateException("camera unavailable — grant CAMERA permission and reconnect"))
            return
        }
        capture.takePicture(
            ContextCompat.getMainExecutor(context),
            object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    try {
                        if (image.format != android.graphics.ImageFormat.JPEG) {
                            throw IllegalStateException("unexpected capture format ${image.format} (wanted JPEG)")
                        }
                        val buffer = image.planes[0].buffer
                        val bytes = ByteArray(buffer.remaining())
                        buffer.get(bytes)
                        onJpeg(bytes)
                    } catch (e: Exception) {
                        onError(e)
                    } finally {
                        image.close()
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    onError(exception)
                }
            },
        )
    }

    // ── Mic ──────────────────────────────────────────────────────────────────

    override fun startMicCapture(onPcmChunk: (ByteArray) -> Unit, onError: (Throwable) -> Unit) {
        if (micRunning) return
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            onError(IllegalStateException("RECORD_AUDIO permission not granted"))
            return
        }
        val sampleRate = GlassesDevice.MIC_SAMPLE_RATE_HZ
        val minBuf = AudioRecord.getMinBufferSize(
            sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBuf <= 0) {
            onError(IllegalStateException("AudioRecord unsupported config (minBuf=$minBuf)"))
            return
        }
        val record = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                sampleRate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                maxOf(minBuf, sampleRate / 5 * 2), // >= 200 ms
            )
        } catch (e: Exception) {
            onError(e)
            return
        }
        if (record.state != AudioRecord.STATE_INITIALIZED) {
            record.release()
            onError(IllegalStateException("AudioRecord failed to initialize"))
            return
        }
        audioRecord = record
        micRunning = true
        record.startRecording()
        micThread = Thread({
            val chunk = ByteArray(sampleRate / 10 * 2) // 100 ms of PCM16 mono
            while (micRunning) {
                val n = record.read(chunk, 0, chunk.size)
                if (n > 0) onPcmChunk(chunk.copyOf(n))
                else if (n < 0) {
                    onError(IllegalStateException("AudioRecord.read failed: $n"))
                    break
                }
            }
        }, "emulated-glasses-mic").apply { start() }
    }

    override fun stopMicCapture() {
        micRunning = false
        micThread?.join(500)
        micThread = null
        audioRecord?.let {
            try {
                it.stop()
            } catch (_: IllegalStateException) {
                // never started — nothing to stop
            }
            it.release()
        }
        audioRecord = null
    }

    // ── Speaker ──────────────────────────────────────────────────────────────

    override fun playAudio(pcm16MonoLe: ByteArray, sampleRateHz: Int) {
        if (pcm16MonoLe.isEmpty()) return
        Thread({
            val minBuf = AudioTrack.getMinBufferSize(
                sampleRateHz, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT,
            )
            val track = AudioTrack(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRateHz)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
                maxOf(minBuf, 4096),
                AudioTrack.MODE_STREAM,
                AudioManager.AUDIO_SESSION_ID_GENERATE,
            )
            try {
                track.play()
                track.write(pcm16MonoLe, 0, pcm16MonoLe.size)
                track.stop()
            } finally {
                track.release()
            }
        }, "emulated-glasses-speaker").start()
    }

    override fun playEarcon() {
        // Soft double-beep ~150 ms — the `earcon` InterruptLevel (spec §8.1:
        // "short tone via DAT audio out").
        toneGenerator?.startTone(ToneGenerator.TONE_PROP_ACK, 150)
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private companion object {
        const val EARCON_VOLUME = 70 // 0..100
    }
}
