package com.readingcompanion.rbd

import java.util.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BackoffPolicyTest {

    private fun noJitter() = BackoffPolicy(
        baseMs = 1_000, factor = 2.0, capMs = 30_000, jitterRatio = 0.0,
    )

    @Test
    fun `delays grow exponentially and cap`() {
        val policy = noJitter()
        val delays = (1..7).map { policy.nextDelayMs() }
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L), delays)
    }

    @Test
    fun `reset returns to the base delay`() {
        val policy = noJitter()
        repeat(5) { policy.nextDelayMs() }
        policy.reset()
        assertEquals(0, policy.attemptCount)
        assertEquals(1_000L, policy.nextDelayMs())
    }

    @Test
    fun `attemptCount tracks handed-out delays`() {
        val policy = noJitter()
        assertEquals(0, policy.attemptCount)
        policy.nextDelayMs()
        policy.nextDelayMs()
        assertEquals(2, policy.attemptCount)
    }

    @Test
    fun `jitter stays within raw and raw times one-plus-ratio`() {
        val policy = BackoffPolicy(
            baseMs = 1_000, factor = 2.0, capMs = 30_000, jitterRatio = 0.2,
            random = Random(42), // deterministic
        )
        var raw = 1_000L
        repeat(10) {
            val delay = policy.nextDelayMs()
            assertTrue("delay $delay < raw $raw", delay >= raw)
            assertTrue("delay $delay > raw*1.2 ${raw * 12 / 10}", delay <= raw * 12 / 10)
            raw = (raw * 2).coerceAtMost(30_000L)
        }
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects a non-positive base`() {
        BackoffPolicy(baseMs = 0)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects a cap below the base`() {
        BackoffPolicy(baseMs = 5_000, capMs = 1_000)
    }
}
