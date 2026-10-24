package com.meraj.mediaplayer

import android.content.ContentUris
import android.net.Uri
import android.os.Build
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.util.Base64
import java.io.ByteArrayOutputStream
import android.provider.MediaStore
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** Queries Android MediaStore for shared audio/video files after runtime permission is granted. */
@CapacitorPlugin(name = "MediaLibraryScanner")
class MediaLibraryScannerPlugin : Plugin() {
    /** Opens Android's native chooser with the selected local audio/video content URI. */
    @PluginMethod
    fun shareMedia(call: PluginCall) {
        val rawUri = call.getString("uri")
        if (rawUri.isNullOrBlank()) { call.reject("Missing media URI"); return }
        try {
            val uri = Uri.parse(rawUri)
            val mimeType = call.getString("mimeType")?.takeIf { it.contains("/") } ?: "*/*"
            val name = call.getString("name", "Media file") ?: "Media file"
            val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(android.content.Intent.EXTRA_STREAM, uri)
                putExtra(android.content.Intent.EXTRA_TITLE, name)
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                clipData = android.content.ClipData.newUri(context.contentResolver, name, uri)
            }
            val chooser = android.content.Intent.createChooser(intent, "Share media file")
            chooser.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            activity.runOnUiThread { activity.startActivity(chooser) }
            call.resolve(JSObject().put("opened", true))
        } catch (e: Exception) {
            call.reject("Could not open Android share menu: ${e.message}", e)
        }
    }

    @PluginMethod
    fun scan(call: PluginCall) {
        val type = call.getString("type", "audio") ?: "audio"
        val resolver = context.contentResolver
        val items = JSArray()
        val collection: Uri = when (type) {
            "video" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
            else MediaStore.Video.Media.EXTERNAL_CONTENT_URI
            else -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
            else MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        }
        val projection = if (type == "video") mutableListOf(
            MediaStore.Video.Media._ID, MediaStore.Video.Media.DISPLAY_NAME,
            MediaStore.Video.Media.SIZE, MediaStore.Video.Media.MIME_TYPE,
            MediaStore.Video.Media.DURATION
        ) else mutableListOf(
            MediaStore.Audio.Media._ID, MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.SIZE, MediaStore.Audio.Media.MIME_TYPE,
            MediaStore.Audio.Media.DURATION, MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) projection.add(MediaStore.MediaColumns.RELATIVE_PATH)
        val sort = if (type == "video") "${MediaStore.Video.Media.DISPLAY_NAME} COLLATE NOCASE ASC"
                   else "${MediaStore.Audio.Media.DISPLAY_NAME} COLLATE NOCASE ASC"
        try {
            resolver.query(collection, projection.toTypedArray(), null, null, sort)?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
                val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
                val mimeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
                val durationCol = cursor.getColumnIndex(MediaStore.MediaColumns.DURATION)
                val pathCol = cursor.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH)
                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idCol)
                    val uri = ContentUris.withAppendedId(collection, id)
                    val item = JSObject()
                    item.put("id", id.toString())
                    item.put("uri", uri.toString())
                    item.put("name", cursor.getString(nameCol) ?: "Unknown media")
                    item.put("size", cursor.getLong(sizeCol))
                    val detectedMime = cursor.getString(mimeCol) ?: ""
                    item.put("type", detectedMime)
                    item.put("mimeType", detectedMime)
                    item.put("duration", if (durationCol >= 0) cursor.getLong(durationCol) else 0L)
                    val artistCol = cursor.getColumnIndex(MediaStore.Audio.Media.ARTIST)
                    val albumCol = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM)
                    item.put("artist", if (artistCol >= 0) cursor.getString(artistCol) ?: "Unknown artist" else "Unknown artist")
                    item.put("album", if (albumCol >= 0) cursor.getString(albumCol) ?: "Unknown album" else "Unknown album")
                    item.put("relativePath", if (pathCol >= 0) cursor.getString(pathCol) ?: "Device files" else "Device files")
                    items.put(item)
                }
            }
            call.resolve(JSObject().put("items", items).put("count", items.length()).put("type", type))
        } catch (e: SecurityException) {
            call.reject("Media permission denied", e)
        } catch (e: Exception) {
            call.reject("Could not scan device media: ${e.message}", e)
        }
    }
    /** Returns a small cached video-frame thumbnail as a data URL for library cards. */
    @PluginMethod
    fun getThumbnail(call: PluginCall) {
        val rawUri = call.getString("uri")
        if (rawUri.isNullOrBlank()) { call.reject("Missing media URI"); return }
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(context, Uri.parse(rawUri))
            val frame = retriever.getFrameAtTime(1_000_000L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                ?: retriever.getFrameAtTime(0L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
            if (frame == null) { call.resolve(JSObject().put("thumbnail", "")); return }
            val width = 320
            val scale = minOf(1.0, width.toDouble() / frame.width.toDouble())
            val thumb = if (scale < 1.0) Bitmap.createScaledBitmap(frame, (frame.width * scale).toInt().coerceAtLeast(1), (frame.height * scale).toInt().coerceAtLeast(1), true) else frame
            val bytes = ByteArrayOutputStream()
            thumb.compress(Bitmap.CompressFormat.JPEG, 78, bytes)
            val encoded = Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
            if (thumb !== frame) thumb.recycle()
            frame.recycle()
            call.resolve(JSObject().put("thumbnail", "data:image/jpeg;base64,$encoded"))
        } catch (e: Exception) {
            call.resolve(JSObject().put("thumbnail", ""))
        } finally {
            try { retriever.release() } catch (_: Exception) {}
        }
    }

    /** Copies a MediaStore URI into app cache for WebView playback. Large files use a larger buffer and a temporary file so incomplete copies are not played. Cache names are URI-specific to avoid filename collisions. */
    /** Launch native Media3 playback directly from the original content:// URI. No video copy/cache is created. */
    @PluginMethod
    fun launchVideo(call: PluginCall) {
        val rawUri = call.getString("uri")
        if (rawUri.isNullOrBlank()) { call.reject("Missing video URI"); return }
        try {
            val uri = Uri.parse(rawUri)
            val intent = android.content.Intent(context, NativeVideoPlayerActivity::class.java).apply {
                putExtra(NativeVideoPlayerActivity.EXTRA_URI, uri.toString())
                putExtra(NativeVideoPlayerActivity.EXTRA_TITLE, call.getString("name", "Video") ?: "Video")
                val queue = call.getArray("queue")
                val queueUris = ArrayList<String>()
                val queueTitles = ArrayList<String>()
                val queueMimes = ArrayList<String>()
                if (queue != null) {
                    for (i in 0 until queue.length()) {
                        val entry = queue.optJSONObject(i) ?: continue
                        val qUri = entry.optString("uri", "")
                        if (qUri.isNotBlank()) {
                            queueUris.add(qUri)
                            queueTitles.add(entry.optString("name", "Video"))
                            queueMimes.add(entry.optString("mimeType", "video/*"))
                        }
                    }
                }
                putStringArrayListExtra(NativeVideoPlayerActivity.EXTRA_QUEUE_URIS, queueUris)
                putStringArrayListExtra(NativeVideoPlayerActivity.EXTRA_QUEUE_TITLES, queueTitles)
                putStringArrayListExtra(NativeVideoPlayerActivity.EXTRA_QUEUE_MIMES, queueMimes)
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                clipData = android.content.ClipData.newUri(context.contentResolver, "video", uri)
            }
            activity.runOnUiThread { activity.startActivity(intent) }
            call.resolve(JSObject().put("opened", true).put("directUri", true))
        } catch (e: Exception) {
            call.reject("Could not start native video playback: ${e.message}", e)
        }
    }

}
