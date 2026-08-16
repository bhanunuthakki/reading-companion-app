package com.readingcompanion.androidxr

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

/** A Digest reduced to what the glasses card may show (spec §7 grammar). */
data class DigestView(val tldr: String, val citationTitles: List<String>)

/**
 * Minimal REST access to the Core — used only to expand a Badge into its
 * Digest card via `GET /api/threads/:id` (core/README.md "REST"), exactly as
 * the Meta web-app does. Everything else rides the WebSocket.
 */
class CoreRest(private val client: OkHttpClient = OkHttpClient()) {

    /**
     * Fetches the Digest for [jobId] inside thread [threadId].
     * @param wsUrl the Core WS url (e.g. ws://10.0.2.2:4000/ws); the HTTP base
     *   is derived from it the same way the Meta web-app derives CORE_HTTP.
     * @throws IOException / IllegalStateException on any failure — callers map
     *   this to SurfaceStateMachine.digestFetchFailed(); no silent fallback.
     */
    suspend fun fetchDigest(wsUrl: String, threadId: String, jobId: String): DigestView =
        withContext(Dispatchers.IO) {
            val base = httpBaseFrom(wsUrl)
            val request = Request.Builder().url("$base/api/threads/$threadId").build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IOException("HTTP ${response.code} fetching thread $threadId")
                val body = response.body?.string() ?: throw IOException("empty body for thread $threadId")
                val detail = JSONObject(body)
                val jobs = detail.optJSONArray("jobs") ?: throw IllegalStateException("thread $threadId has no jobs array")
                for (i in 0 until jobs.length()) {
                    val job = jobs.getJSONObject(i)
                    if (job.getString("id") != jobId) continue
                    val digest = job.optJSONObject("digest")
                        ?: throw IllegalStateException("job $jobId has no digest yet")
                    val titles = buildList {
                        val citations = digest.optJSONArray("citations")
                        if (citations != null) for (j in 0 until citations.length()) {
                            add(citations.getJSONObject(j).getString("title"))
                        }
                    }
                    return@use DigestView(tldr = digest.getString("tldr"), citationTitles = titles)
                }
                throw IllegalStateException("job $jobId not found in thread $threadId")
            }
        }

    companion object {
        fun httpBaseFrom(wsUrl: String): String =
            wsUrl.replaceFirst(Regex("^ws"), "http").replaceFirst(Regex("/ws$"), "")
    }
}
