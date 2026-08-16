package com.readingcompanion.androidxr

import android.content.Context

/**
 * Persisted client settings. Just the Core URL for now — editable on the
 * surface and stored in SharedPreferences so the client survives restarts
 * pointed at the right Core.
 */
class CompanionSettings(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences("companion-settings", Context.MODE_PRIVATE)

    var coreUrl: String
        get() = prefs.getString(KEY_CORE_URL, DEFAULT_CORE_URL) ?: DEFAULT_CORE_URL
        set(value) {
            prefs.edit().putString(KEY_CORE_URL, value).apply()
        }

    companion object {
        private const val KEY_CORE_URL = "coreUrl"

        /** 10.0.2.2 = host loopback from the emulator (Core on the dev box). */
        const val DEFAULT_CORE_URL = "ws://10.0.2.2:4000/ws"
    }
}
