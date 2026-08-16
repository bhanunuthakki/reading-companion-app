package com.readingcompanion.rbd

import java.util.Random

/**
 * Exponential backoff with bounded jitter for WS reconnects. Pure JVM,
 * deterministic under an injected [Random] — unit-tested without a device.
 *
 * Sequence (jitterRatio = 0): base, base*factor, base*factor^2, … capped at
 * [capMs]. Jitter adds up to `raw * jitterRatio` on top, so reconnecting
 * clients don't stampede a restarting Core in lockstep.
 */
class BackoffPolicy(
    private val baseMs: Long = 1_000,
    private val factor: Double = 2.0,
    private val capMs: Long = 30_000,
    private val jitterRatio: Double = 0.2,
    private val random: Random = Random(),
) {
    init {
        require(baseMs > 0) { "baseMs must be positive" }
        require(factor >= 1.0) { "factor must be >= 1" }
        require(capMs >= baseMs) { "capMs must be >= baseMs" }
        require(jitterRatio >= 0.0) { "jitterRatio must be >= 0" }
    }

    private var attempt = 0

    /** How many delays have been handed out since the last [reset]. */
    val attemptCount: Int get() = attempt

    /** Next delay in milliseconds; each call advances the attempt counter. */
    fun nextDelayMs(): Long {
        val raw = (baseMs * Math.pow(factor, attempt.toDouble()))
            .toLong()
            .coerceAtMost(capMs)
        attempt += 1
        val jitter = (raw * jitterRatio * random.nextDouble()).toLong()
        return raw + jitter
    }

    /** Call on a successful (re)connect so the next failure starts from base. */
    fun reset() {
        attempt = 0
    }
}
