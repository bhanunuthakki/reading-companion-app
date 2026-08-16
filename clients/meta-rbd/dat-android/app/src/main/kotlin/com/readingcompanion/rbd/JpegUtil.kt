package com.readingcompanion.rbd

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.ByteArrayOutputStream

/**
 * JPEG downscaling before upload. core expects one still per Capture; sending
 * a 12 MP-class still base64'd over WS is pure waste — the Core's vision
 * extraction needs legible text, not megapixels. Longest edge is clamped to
 * [MAX_DIMENSION_PX] (spec requirement: <= 1024 px) and re-encoded at quality
 * [JPEG_QUALITY].
 */
object JpegUtil {

    const val MAX_DIMENSION_PX = 1024
    private const val JPEG_QUALITY = 85

    /**
     * Returns [jpeg] downscaled so max(width, height) <= [maxDim]. Throws on
     * undecodable input — a broken capture must surface, not upload garbage.
     */
    fun downscale(jpeg: ByteArray, maxDim: Int = MAX_DIMENSION_PX): ByteArray {
        require(maxDim > 0) { "maxDim must be positive" }

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            throw IllegalArgumentException("not a decodable JPEG (${jpeg.size} bytes)")
        }

        // Power-of-two subsampling first (cheap), exact scale second.
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= maxDim || bounds.outHeight / (sample * 2) >= maxDim) {
            sample *= 2
        }
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        val decoded = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size, opts)
            ?: throw IllegalArgumentException("JPEG decode failed (${jpeg.size} bytes)")

        val largest = maxOf(decoded.width, decoded.height)
        val scaled = if (largest > maxDim) {
            val scale = maxDim.toFloat() / largest
            Bitmap.createScaledBitmap(
                decoded,
                (decoded.width * scale).toInt().coerceAtLeast(1),
                (decoded.height * scale).toInt().coerceAtLeast(1),
                true,
            )
        } else {
            decoded
        }

        val out = ByteArrayOutputStream()
        if (!scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)) {
            throw IllegalStateException("JPEG re-encode failed")
        }
        if (scaled !== decoded) decoded.recycle()
        scaled.recycle()
        return out.toByteArray()
    }
}
