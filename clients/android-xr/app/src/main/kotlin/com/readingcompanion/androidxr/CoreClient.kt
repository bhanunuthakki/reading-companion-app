package com.readingcompanion.androidxr

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

/**
 * WebSocket client for the Reading Companion Core (../../core), protocol
 * v1 + v2 per core/README.md. On real Android XR AI glasses the camera/mic
 * come through the Projected context; this class only moves JSON frames.
 *
 * Reconnects with exponential backoff (1 s → 30 s cap) until [shutdown].
 * Callbacks fire on OkHttp's socket thread — the ViewModel hops to Main.
 */
class CoreClient(
    initialUrl: String,
    private val scope: CoroutineScope,
) {
    var url: String = initialUrl
        private set

    var onOpen: () -> Unit = {}
    var onText: (String) -> Unit = {}
    var onClosed: (reason: String) -> Unit = {}

    private val client = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private var reconnectJob: Job? = null
    private var attempts = 0

    @Volatile
    private var shutdown = false

    fun connect() {
        if (shutdown) return
        val request = Request.Builder().url(url).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                attempts = 0
                this@CoreClient.onOpen()
            }

            override fun onMessage(webSocket: WebSocket, text: String) = onText(text)

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                this@CoreClient.onClosed(t.message ?: "ws failure")
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                this@CoreClient.onClosed(reason.ifEmpty { "closed ($code)" })
                scheduleReconnect()
            }
        })
    }

    /** Point at a different Core (settings change): drop and reconnect. */
    fun setUrl(newUrl: String) {
        if (newUrl == url) return
        url = newUrl
        attempts = 0
        webSocket?.close(CLOSE_NORMAL, "core url changed")
        webSocket = null
        connect()
    }

    /** Sends one message; returns false (and drops it) when the socket is down. */
    fun send(payload: JSONObject): Boolean =
        webSocket?.send(payload.toString()) ?: false

    fun shutdown() {
        shutdown = true
        reconnectJob?.cancel()
        webSocket?.close(CLOSE_NORMAL, "client closing")
        webSocket = null
    }

    private fun scheduleReconnect() {
        if (shutdown) return
        val backoffMs = (1000L shl minOf(attempts, 5)).coerceAtMost(MAX_BACKOFF_MS)
        attempts += 1
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(backoffMs)
            connect()
        }
    }

    private companion object {
        const val CLOSE_NORMAL = 1000
        const val MAX_BACKOFF_MS = 30_000L
    }
}
