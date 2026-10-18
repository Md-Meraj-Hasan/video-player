package com.meraj.mediaplayer

import android.content.ContentUris
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import java.io.File
import java.io.FileOutputStream
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** Queries Android MediaStore for shared audio/video files after runtime permission is granted. */
@CapacitorPlugin(name = "MediaLibraryScanner")
class MediaLibraryScannerPlugin : Plugin() {
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
            MediaStore.Audio.Media.DURATION
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
                    item.put("type", cursor.getString(mimeCol) ?: "")
                    item.put("duration", if (durationCol >= 0) cursor.getLong(durationCol) else 0L)
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
    /** Copies a MediaStore content URI into app cache so Android WebView can play it reliably. */
    @PluginMethod
    fun preparePlayback(call: PluginCall) {
        val rawUri = call.getString("uri")
        if (rawUri.isNullOrBlank()) {
            call.reject("Missing media URI")
            return
        }
        try {
            val uri = Uri.parse(rawUri)
            val name = call.getString("name", "video.mp4") ?: "video.mp4"
            val safeName = name.substringAfterLast('/').replace(Regex("[^A-Za-z0-9._-]"), "_")
            val cacheDir = File(context.cacheDir, "meraj_media_playback")
            if (!cacheDir.exists()) cacheDir.mkdirs()
            val target = File(cacheDir, safeName)
            val expectedSize = call.getLong("size") ?: 0L
            if (!target.exists() || (expectedSize > 0 && target.length() != expectedSize)) {
                context.contentResolver.openInputStream(uri).use { input ->
                    if (input == null) throw IllegalStateException("Cannot open selected video")
                    FileOutputStream(target).use { output -> input.copyTo(output) }
                }
            }
            call.resolve(JSObject().put("path", target.absolutePath).put("size", target.length()))
        } catch (e: Exception) {
            call.reject("Could not prepare video for playback: ${e.message}", e)
        }
    }

}
