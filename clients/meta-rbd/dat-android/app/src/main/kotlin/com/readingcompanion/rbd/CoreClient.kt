package com.readingcompanion.rbd

import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * WebSocket client for the Reading Companion Core (core/README.md), speaking
 * v1 (reading session) and v2 (thought partner). One socket per Client
 * (DEFINITIONS.md), reconnecting with exponential backoff until [close].
 *
 * Transport: OkHttp (the skeleton's existing choice — mature, ships its own
 * WS ping/pong keepalive, no extra deps). Frames encode/decode in
 * [CoreProtocol] so the wire logic stays pure-JVM testable.
 *
 * Threading: OkHttp invokes the listener on its own background threads; the
 * reconnect timer runs on a single scheduler thread. UI callers must marshal
 * to the main thread themselves.
 */
class CoreClient(
    private val url: String,
    private val listener: Listener,
    private val backoff: BackoffPolicy = BackoffPolicy(),
) {
    interface Listener {
        /** Connection lifecycle, including "reconnecting in N ms" transitions. */
        fun onConnectionState(connected: Boolean, detail: String)

        /** Every decoded server frame, including ProtocolError / Unknown. */
        fun onEvent(event: CoreEvent)
    }

    private val http = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS) // keeps NAT/emulator paths alive
        .build()
    private val scheduler = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "core-reconnect").apply { isDaemon = true }
    }

    @Volatile private var webSocket: WebSocket? = null
    @Volatile private var shouldRun = false

    fun connect() {
        if (shouldRun) return
        shouldRun = true
        openSocket()
    }

    /** User-initiated shutdown: closes the socket and stops reconnecting. */
    fun close() {
        shouldRun = false
        webSocket?.close(1000, "client closing")
        webSocket = null
    }

    /** Full teardown (also stops the reconnect scheduler). */
    fun shutdown() {
        close()
        scheduler.shutdownNow()
    }

    private fun openSocket() {
        val request = Request.Builder().url(url).build()
        webSocket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                backoff.reset()
                listener.onConnectionState(true, "connected to $url")
            }

            override fun onMessage(ws: WebSocket, text: String) {
                val event = try {
                    CoreProtocol.decode(text)
                } catch (e: Exception) {
                    // Fail loudly: a frame we can't decode is a bug on one side
                    // of the contract, never something to swallow.
                    CoreEvent.ProtocolError(
                        "undecodable Core frame (${e.message}): ${text.take(200)}",
                    )
                }
                listener.onEvent(event)
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                if (webSocket === ws) webSocket = null
                listener.onConnectionState(false, t.message ?: "ws failure")
                scheduleReconnect()
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                if (webSocket === ws) webSocket = null
                listener.onConnectionState(false, "closed ($code $reason)")
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (!shouldRun) return
        val delayMs = backoff.nextDelayMs()
        listener.onConnectionState(false, "reconnecting in ${delayMs} ms")
        scheduler.schedule({ if (shouldRun) openSocket() }, delayMs, TimeUnit.MILLISECONDS)
    }

    // ── v2 sends (thought partner) ──────────────────────────────────────────

    /**
     * Wear state defaults to NOT-worn on the Core (core/README.md) — send true
     * when glasses go on-face or every delivery holds to the phone (spec §7
     * rule 2). Resend after every reconnect: a new socket is a new default.
     */
    fun wear(worn: Boolean) = send(CoreProtocol.encodeWear(worn))

    fun ask(question: String, captureId: String? = null, threadId: String? = null) =
        send(CoreProtocol.encodeAsk(question, captureId, threadId))

    fun capture(imageBase64: String, hintKind: String? = null, threadId: String? = null) =
        send(CoreProtocol.encodeCapture(imageBase64, hintKind, threadId))

    fun jobCancel(jobId: String) = send(CoreProtocol.encodeJobCancel(jobId))

    // ── v1 sends (reading session) — kept working ───────────────────────────

    fun open(kind: String, title: String, deviceId: String) =
        send(CoreProtocol.encodeOpen(kind, title, deviceId))

    fun say(question: String) = send(CoreProtocol.encodeSay(question))
    fun watch(topic: String) = send(CoreProtocol.encodeWatch(topic))
    fun page(imageBase64: String) = send(CoreProtocol.encodePage(imageBase64))
    fun mic(pcmBase64: String) = send(CoreProtocol.encodeMic(pcmBase64))
    fun frame(jpegBase64: String) = send(CoreProtocol.encodeFrame(jpegBase64))
    fun end() = send(CoreProtocol.encodeEnd())

    /** True if the frame was handed to an open socket; false is reported loudly. */
    private fun send(frameJson: String): Boolean {
        val sent = webSocket?.send(frameJson) ?: false
        if (!sent) {
            listener.onEvent(
                CoreEvent.ProtocolError("send failed — socket not open: ${frameJson.take(80)}"),
            )
        }
        return sent
    }
}
