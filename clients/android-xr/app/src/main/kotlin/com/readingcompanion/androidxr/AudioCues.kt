package com.readingcompanion.androidxr

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.speech.tts.TextToSpeech
import android.util.Log

/**
 * The two delivery sounds of the etiquette ladder (spec §7):
 * - earcon — a short soft tone (ToneGenerator), InterruptLevel `earcon`+
 * - speak  — the Digest TLDR via TextToSpeech, InterruptLevel `speak`
 *
 * TTS input is spoken-prose by contract (Digest.tldr is TTS-safe, no
 * markdown — DEFINITIONS.md), so the text is spoken verbatim.
 */
class AudioCues(context: Context) : DeliveryAudio {

    private var ttsReady = false
    private val tts = TextToSpeech(context.applicationContext) { status ->
        ttsReady = status == TextToSpeech.SUCCESS
        if (!ttsReady) Log.e(TAG, "TextToSpeech init failed (status=$status) — speak-level deliveries will be silent")
    }

    override fun playEarcon() {
        try {
            val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, EARCON_VOLUME)
            tone.startTone(ToneGenerator.TONE_PROP_BEEP, EARCON_MS)
            // release after the tone finishes; ToneGenerator has no callback.
            android.os.Handler(android.os.Looper.getMainLooper())
                .postDelayed({ tone.release() }, EARCON_MS + 50L)
        } catch (e: RuntimeException) {
            Log.e(TAG, "earcon unavailable: ${e.message}")
        }
    }

    override fun speak(text: String) {
        if (!ttsReady) {
            Log.e(TAG, "speak requested before TTS ready — dropping: would have said \"$text\"")
            return
        }
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "digest-tldr")
    }

    fun shutdown() {
        tts.shutdown()
    }

    private companion object {
        const val TAG = "AudioCues"
        const val EARCON_VOLUME = 60 // 0..100
        const val EARCON_MS = 150
    }
}
