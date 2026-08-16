package com.readingcompanion.androidxr

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log

/**
 * Hold-to-talk speech input via the platform SpeechRecognizer.
 *
 * Invocation is push-to-talk by product identity (hardware-capability-spec.md
 * §2/§7 — custom wake words are rejected for v1). On the ai_glasses/phone AVD
 * a recognition service is frequently absent; [available] is false there and
 * the surface falls back to the EXPLICIT text-entry dialog — the fallback is
 * typed input, never fabricated speech.
 */
class SpeechInput(
    private val context: Context,
    private val onResult: (String) -> Unit,
    private val onListeningChanged: (Boolean) -> Unit,
    private val onUnavailable: () -> Unit,
) {
    val available: Boolean = SpeechRecognizer.isRecognitionAvailable(context)

    private var recognizer: SpeechRecognizer? = null

    /** Press: open the mic. Requires RECORD_AUDIO (caller checks). */
    fun start() {
        if (!available) {
            onUnavailable()
            return
        }
        stopInternal()
        val r = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle) {
                val texts = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                onListeningChanged(false)
                val text = texts?.firstOrNull()
                if (text.isNullOrBlank()) {
                    Log.w(TAG, "speech ended with no transcription")
                } else {
                    onResult(text)
                }
            }

            override fun onError(error: Int) {
                onListeningChanged(false)
                Log.w(TAG, "SpeechRecognizer error $error")
                if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ||
                    error == SpeechRecognizer.ERROR_CLIENT
                ) return
                // Real failures (no service / network / no match) push the user
                // to the explicit typed fallback rather than silently doing nothing.
                if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) return
                onUnavailable()
            }

            override fun onReadyForSpeech(params: Bundle?) = onListeningChanged(true)
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        }
        onListeningChanged(true)
        r.startListening(intent)
    }

    /** Release: close the mic; results arrive via onResults. */
    fun stop() {
        recognizer?.stopListening()
    }

    fun destroy() = stopInternal()

    private fun stopInternal() {
        recognizer?.destroy()
        recognizer = null
    }

    private companion object {
        const val TAG = "SpeechInput"
    }
}
