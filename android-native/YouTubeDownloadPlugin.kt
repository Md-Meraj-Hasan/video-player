package __PACKAGE__

import android.Manifest
import android.content.ContentValues
import android.net.Uri
import android.content.Intent
import android.provider.Settings
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.PermissionState
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import kotlin.concurrent.thread

@CapacitorPlugin(
    name = "YtDlp",
    permissions = [
        Permission(alias = "storage", strings = [Manifest.permission.WRITE_EXTERNAL_STORAGE]),
        Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])
    ]
)
class YouTubeDownloadPlugin : Plugin() {
    companion object {
        @Volatile private var activeDownloadConnection: HttpURLConnection? = null
        @Volatile private var cancelActiveDownload = false
        fun cancelFromNotification() {
            cancelActiveDownload = true
            activeDownloadConnection?.disconnect()
        }
    }

    private fun playlistServiceIntent(action: String, message: String? = null): Intent =
        Intent(getContext(), YouTubeDownloadService::class.java).apply {
            this.action = action
            if (message != null) putExtra("message", message)
        }

    private fun launchPlaylistForegroundService(call: PluginCall) {
        cancelActiveDownload = false
        val intent = playlistServiceIntent(YouTubeDownloadService.ACTION_START, call.getString("message") ?: "Preparing playlist…")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(intent) else getContext().startService(intent)
        call.resolve()
    }

    @PluginMethod
    fun startBackgroundPlaylist(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermissionCallback")
            return
        }
        launchPlaylistForegroundService(call)
    }

    @PermissionCallback
    private fun notificationPermissionCallback(call: PluginCall) {
        // The foreground service still runs if notifications are denied; its cancel
        // control remains available in the app's Downloads screen.
        launchPlaylistForegroundService(call)
    }

    @PluginMethod
    fun updateBackgroundPlaylist(call: PluginCall) {
        getContext().startService(playlistServiceIntent(YouTubeDownloadService.ACTION_UPDATE, call.getString("message") ?: "Downloading playlist…"))
        call.resolve()
    }

    @PluginMethod
    fun stopBackgroundPlaylist(call: PluginCall) {
        getContext().startService(playlistServiceIntent(YouTubeDownloadService.ACTION_STOP))
        call.resolve()
    }

    @PluginMethod
    fun getPlaylistCancelState(call: PluginCall) {
        call.resolve(JSObject().apply { put("cancelled", cancelActiveDownload) })
    }

    @PluginMethod
    fun cancelDownload(call: PluginCall) {
        cancelFromNotification()
        call.resolve(JSObject().apply { put("cancelling", true) })
    }

    /** Lists videos saved by Nice Downloader from the public Downloads/NiceDownloader folder. */
    @PluginMethod
    fun listDownloadedVideos(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.resolve(JSObject().put("items", JSArray()).put("count", 0))
            return
        }
        val items = JSArray()
        val projection = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.DATE_ADDED,
            MediaStore.MediaColumns.RELATIVE_PATH
        )
        try {
            // Match the base folder (single downloads) and playlist subfolders.
            val basePath = Environment.DIRECTORY_DOWNLOADS + "/NiceDownloader"
            val selection = "(${MediaStore.MediaColumns.RELATIVE_PATH} = ? OR ${MediaStore.MediaColumns.RELATIVE_PATH} LIKE ?) AND ${MediaStore.MediaColumns.MIME_TYPE} LIKE ?"
            val args = arrayOf(basePath, "$basePath/%", "video/%")
            getContext().contentResolver.query(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI, projection, selection, args,
                "${MediaStore.MediaColumns.DATE_ADDED} DESC"
            )?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
                val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
                val mimeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
                val dateCol = cursor.getColumnIndex(MediaStore.MediaColumns.DATE_ADDED)
                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idCol)
                    val uri = android.content.ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, id)
                    val item = JSObject()
                    item.put("id", "nice-downloader-$id")
                    item.put("uri", uri.toString())
                    val storedName = cursor.getString(nameCol) ?: "Downloaded video"
                    val playlistIndexMatch = Regex("^(\\d{4}) - (.*)$").find(storedName)
                    item.put("name", playlistIndexMatch?.groupValues?.get(2) ?: storedName)
                    item.put("size", cursor.getLong(sizeCol))
                    item.put("mimeType", cursor.getString(mimeCol) ?: "video/mp4")
                    item.put("type", cursor.getString(mimeCol) ?: "video/mp4")
                    item.put("duration", 0)
                    val relativePath = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.RELATIVE_PATH)) ?: ""
                    item.put("relativePath", relativePath)
                    val folderName = relativePath.removeSuffix("/").substringAfterLast("/")
                    item.put("playlistName", folderName.takeIf { it.isNotBlank() && it != "NiceDownloader" })
                    item.put("playlistIndex", playlistIndexMatch?.groupValues?.get(1)?.toIntOrNull() ?: -1)
                    item.put("dateAdded", if (dateCol >= 0) cursor.getLong(dateCol) else 0L)
                    items.put(item)
                }
            }
            call.resolve(JSObject().put("items", items).put("count", items.length()))
        } catch (e: Exception) {
            call.reject("Could not list Nice Downloader videos: ${e.message}", e)
        }
    }

    @PluginMethod
    fun getStorageStatus(call: PluginCall) {
        val legacy = Build.VERSION.SDK_INT <= Build.VERSION_CODES.P
        val granted = !legacy || getPermissionState("storage") == PermissionState.GRANTED
        call.resolve(JSObject().apply {
            put("apiLevel", Build.VERSION.SDK_INT)
            put("legacyPermissionRequired", legacy)
            put("permissionGranted", granted)
            put("storageReady", granted)
            put("saveLocation", "Download/NiceDownloader")
            put("method", if (legacy) "Legacy storage permission" else "Android MediaStore (no broad storage permission)")
        })
    }

    @PluginMethod
    fun requestStoragePermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.P) {
            call.resolve(JSObject().apply {
                put("storageReady", true)
                put("permissionGranted", true)
                put("message", "Android manages Downloads access through MediaStore. No storage permission is needed.")
            })
            return
        }
        if (getPermissionState("storage") == PermissionState.GRANTED) {
            call.resolve(JSObject().apply { put("storageReady", true); put("permissionGranted", true) })
        } else {
            requestPermissionForAlias("storage", call, "settingsStoragePermissionCallback")
        }
    }

    @PermissionCallback
    private fun settingsStoragePermissionCallback(call: PluginCall) {
        val granted = getPermissionState("storage") == PermissionState.GRANTED
        call.resolve(JSObject().apply {
            put("storageReady", granted)
            put("permissionGranted", granted)
            put("message", if (granted) "Storage permission granted." else "Storage permission was not granted.")
        })
    }

    @PluginMethod
    fun openAppSettings(call: PluginCall) {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().packageName))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            getContext().startActivity(intent)
            call.resolve()
        } catch (error: Exception) {
            call.reject("Could not open app settings: " + (error.message ?: "unknown error"))
        }
    }

    @PluginMethod
    fun httpRequest(call: PluginCall) {
        val rawUrl = call.getString("url")?.trim().orEmpty()
        val method = call.getString("method")?.uppercase(Locale.ROOT) ?: "GET"
        val uri = runCatching { Uri.parse(rawUrl) }.getOrNull()
        val host = uri?.host?.lowercase(Locale.ROOT).orEmpty()
        val allowedHost = host == "youtube.com" || host.endsWith(".youtube.com") ||
            host == "youtubei.googleapis.com" || host == "googlevideo.com" ||
            host.endsWith(".googlevideo.com") || host == "ytimg.com" || host.endsWith(".ytimg.com")
        if (uri == null || uri.scheme != "https" || !allowedHost || method !in setOf("GET", "POST", "HEAD")) {
            call.reject("Blocked YouTube network request.")
            return
        }
        thread(name = "NiceDownloader-youtube-http") {
            var connection: HttpURLConnection? = null
            try {
                connection = URL(rawUrl).openConnection() as HttpURLConnection
                connection.requestMethod = method
                connection.connectTimeout = 10000
                connection.readTimeout = 30000
                connection.instanceFollowRedirects = true
                connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36")
                connection.setRequestProperty("Accept", "application/json,text/plain,*/*")
                connection.setRequestProperty("Accept-Encoding", "identity")
                connection.setRequestProperty("Connection", "close")
                val headers = call.getObject("headers")
                headers?.keys()?.forEach { key ->
                    val value = headers.optString(key)
                    if (key.lowercase(Locale.ROOT) !in setOf("host", "connection", "content-length", "origin", "referer")) {
                        connection?.setRequestProperty(key, value)
                    }
                }
                if (method == "POST") {
                    connection.doOutput = true
                    if (connection.getRequestProperty("Content-Type") == null) connection.setRequestProperty("Content-Type", "application/json")
                    val payload = call.getString("body")?.toByteArray(Charsets.UTF_8) ?: ByteArray(0)
                    connection.outputStream.use { it.write(payload) }
                }
                val status = connection.responseCode
                val stream = if (status >= 400) connection.errorStream else connection.inputStream
                val responseBody = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
                val responseHeaders = JSObject()
                connection.headerFields.forEach { (key, values) ->
                    if (key != null && !values.isNullOrEmpty()) responseHeaders.put(key, values.joinToString(", "))
                }
                call.resolve(JSObject().apply {
                    put("status", status)
                    put("body", responseBody)
                    put("headers", responseHeaders)
                })
            } catch (error: Exception) {
                call.reject("YouTube HTTPS connection failed for " + host + ": " + (error.javaClass.simpleName + ": " + (error.message ?: "network error")))
            } finally {
                connection?.disconnect()
            }
        }
    }

    @PluginMethod
    fun downloadStream(call: PluginCall) {
        // Android 10+ uses MediaStore/scoped storage; request no broad storage permission there.
        // Android 9 and older need the legacy WRITE_EXTERNAL_STORAGE runtime permission.
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermissionCallback")
            return
        }
        startDownload(call)
    }

    @PermissionCallback
    private fun storagePermissionCallback(call: PluginCall) {
        if (getPermissionState("storage") == PermissionState.GRANTED) {
            startDownload(call)
        } else {
            call.reject("Storage permission was denied. Allow storage access to save downloads.")
        }
    }

    private fun startDownload(call: PluginCall) {
        val raw = call.getString("streamUrl")?.trim().orEmpty()
        val title = call.getString("title")?.trim().orEmpty().ifBlank { "YouTube video" }
        val extension = call.getString("extension")?.lowercase(Locale.ROOT)?.takeIf { it.matches(Regex("[a-z0-9]{2,5}")) } ?: "mp4"
        val requestedMime = call.getString("mimeType")?.substringBefore(";")?.trim()?.lowercase(Locale.ROOT)
        val mimeType = requestedMime?.takeIf { it in setOf("video/mp4", "video/webm") }
            ?: if (extension == "webm") "video/webm" else "video/mp4"
        val uri = runCatching { Uri.parse(raw) }.getOrNull()
        if (uri == null || uri.scheme != "https" || uri.host?.lowercase(Locale.ROOT)?.endsWith(".googlevideo.com") != true) {
            call.reject("Invalid YouTube media stream URL.")
            return
        }
        thread(name = "NiceDownloader-stream") {
            var connection: HttpURLConnection? = null
            var destination: Uri? = null
            var legacyDestination: java.io.File? = null
            try {
                // Internal private staging keeps incomplete data out of the public Downloads folder.
                val tempDirectory = java.io.File(getContext().filesDir, "NiceDownloaderTemp")
                if (!tempDirectory.exists() && !tempDirectory.mkdirs()) throw IllegalStateException("Could not create internal temporary folder")
                val digest = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(raw.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
                val tempFile = java.io.File(tempDirectory, "$digest.$extension.part")
                var offset = if (tempFile.isFile) tempFile.length() else 0L

                connection = URL(raw).openConnection() as HttpURLConnection
                activeDownloadConnection = connection
                connection.connectTimeout = 10000
                connection.readTimeout = 30000
                connection.instanceFollowRedirects = true
                connection.setRequestProperty("User-Agent", "Mozilla/5.0")
                connection.setRequestProperty("Accept-Encoding", "identity")
                if (offset > 0L) connection.setRequestProperty("Range", "bytes=$offset-")
                connection.connect()

                var code = connection.responseCode
                if (offset > 0L && (code == HttpURLConnection.HTTP_OK || code == 416)) {
                    // If Range is ignored or stale, restart cleanly rather than append duplicate bytes.
                    connection.disconnect()
                    connection = URL(raw).openConnection() as HttpURLConnection
                    activeDownloadConnection = connection
                    connection.connectTimeout = 10000
                    connection.readTimeout = 30000
                    connection.instanceFollowRedirects = true
                    connection.setRequestProperty("User-Agent", "Mozilla/5.0")
                    connection.setRequestProperty("Accept-Encoding", "identity")
                    connection.connect()
                    code = connection.responseCode
                    offset = 0L
                    tempFile.delete()
                }
                if (code !in 200..299) throw IllegalStateException("Media server returned HTTP $code")

                val contentRange = connection.getHeaderField("Content-Range")
                val rangeTotal = Regex("/(\\d+)$").find(contentRange.orEmpty())?.groupValues?.get(1)?.toLongOrNull()
                val responseLength = connection.contentLengthLong
                val expectedTotal = rangeTotal ?: if (responseLength >= 0L) offset + responseLength else -1L
                val append = offset > 0L && code == HttpURLConnection.HTTP_PARTIAL
                if (!append) offset = 0L

                BufferedInputStream(connection.inputStream).use { input ->
                    java.io.FileOutputStream(tempFile, append).use { fileOutput ->
                        BufferedOutputStream(fileOutput, 256 * 1024).use { out ->
                            val buffer = ByteArray(256 * 1024)
                            var done = offset
                            var lastProgress = -1
                            while (true) {
                                if (cancelActiveDownload) throw InterruptedException("Download cancelled by user")
                                val count = input.read(buffer)
                                if (count < 0) break
                                out.write(buffer, 0, count)
                                done += count
                                val progress = if (expectedTotal > 0L) (done * 100.0 / expectedTotal).toInt().coerceIn(0, 99) else 0
                                if (progress != lastProgress) {
                                    lastProgress = progress
                                    notifyListeners("downloadProgress", JSObject().apply {
                                        put("progress", progress)
                                        put("etaSeconds", 0)
                                        put("message", "Downloading to temporary storage…")
                                    })
                                }
                            }
                            out.flush()
                            fileOutput.fd.sync()
                        }
                    }
                }

                if (expectedTotal > 0L && tempFile.length() != expectedTotal) {
                    throw IllegalStateException("Download incomplete (\${tempFile.length()} of $expectedTotal bytes). Retry to continue.")
                }
                if (!tempFile.isFile || tempFile.length() <= 0L) throw IllegalStateException("The server returned an empty video file.")

                val safeName = title.replace(Regex("[\\\\/:*?\"<>|\\r\\n]"), "_").trim().take(100).ifBlank { "YouTube video" } + "." + extension
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
                    put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        val playlistName = call.getString("playlistName")?.takeIf { it.isNotBlank() }
                        val playlistIndex = call.getInt("playlistIndex", -1) ?: -1
                        val safePlaylistFolder = playlistName?.replace(Regex("[\\\\/:*?\"<>|\\r\\n]"), "_")?.trim()?.take(80)
                        val storedDisplayName = if (safePlaylistFolder != null && playlistIndex >= 0)
                            String.format(Locale.US, "%04d - %s", playlistIndex + 1, safeName)
                        else safeName
                        put(MediaStore.MediaColumns.DISPLAY_NAME, storedDisplayName)
                        put(MediaStore.MediaColumns.RELATIVE_PATH, if (safePlaylistFolder != null)
                            Environment.DIRECTORY_DOWNLOADS + "/NiceDownloader/" + safePlaylistFolder + "/"
                        else Environment.DIRECTORY_DOWNLOADS + "/NiceDownloader")
                        put(MediaStore.MediaColumns.IS_PENDING, 1)
                    }
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    destination = getContext().contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                        ?: throw IllegalStateException("Could not create public Downloads entry")
                    getContext().contentResolver.openOutputStream(destination!!, "w")?.use { output ->
                        java.io.FileInputStream(tempFile).use { input ->
                            val buffer = ByteArray(256 * 1024)
                            while (true) {
                                val count = input.read(buffer)
                                if (count < 0) break
                                output.write(buffer, 0, count)
                            }
                            output.flush()
                        }
                    } ?: throw IllegalStateException("Could not open public Downloads file")
                    getContext().contentResolver.update(destination!!, ContentValues().apply {
                        put(MediaStore.MediaColumns.IS_PENDING, 0)
                    }, null, null)
                } else {
                    val folder = java.io.File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "NiceDownloader")
                    if (!folder.exists() && !folder.mkdirs()) throw IllegalStateException("Could not create public Downloads folder")
                    legacyDestination = java.io.File(folder, safeName)
                    java.io.FileInputStream(tempFile).use { input ->
                        java.io.FileOutputStream(legacyDestination!!).use { output ->
                            val buffer = ByteArray(256 * 1024)
                            while (true) {
                                val count = input.read(buffer)
                                if (count < 0) break
                                output.write(buffer, 0, count)
                            }
                            output.fd.sync()
                        }
                    }
                }
                if (!tempFile.delete()) tempFile.deleteOnExit()
                call.resolve(JSObject().apply {
                    put("success", true)
                    put("publicDownload", true)
                    put("fileName", safeName)
                    put("filePath", "Download/NiceDownloader/$safeName")
                    put("folder", "Download/NiceDownloader")
                    put("resumed", append)
                })
            } catch (error: Exception) {
                destination?.let { runCatching { getContext().contentResolver.delete(it, null, null) } }
                legacyDestination?.let { runCatching { it.delete() } }
                call.reject(if (cancelActiveDownload) "Download cancelled by user. Partial data is kept privately for retry." else "Download failed: ${error.message ?: "network error"}. Incomplete data is kept privately for retry.")
            } finally {
                connection?.disconnect()
                if (activeDownloadConnection === connection) activeDownloadConnection = null
            }
        }
    }
}
