package com.meraj.mediaplayer

import android.content.ComponentName
import android.net.Uri
import androidx.media3.common.PlaybackParameters
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.common.util.concurrent.ListenableFuture

@CapacitorPlugin(name = "MerajMediaPlayer")
class MerajMediaPlayerPlugin : Plugin() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var controllerFuture: ListenableFuture<MediaController>? = null
    @Volatile private var controller: MediaController? = null
    private var listener: Player.Listener? = null

    override fun load() {
        super.load()
        mainHandler.post {
            val token = SessionToken(context, ComponentName(context, MerajPlaybackService::class.java))
            val future = MediaController.Builder(context, token).buildAsync()
            controllerFuture = future
            future.addListener({
                try {
                    val c = future.get()
                    controller = c
                    val l = object : Player.Listener {
                        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                            notifyListeners("trackChanged", JSObject().apply {
                                put("mediaId", mediaItem?.mediaId ?: "")
                                put("title", mediaItem?.mediaMetadata?.title?.toString() ?: "")
                                put("reason", reason)
                            })
                        }
                        override fun onPlaybackStateChanged(playbackState: Int) {
                            val p = controller
                            notifyListeners("playbackState", JSObject().apply {
                                put("state", playbackState)
                                put("isPlaying", p?.isPlaying == true)
                                put("position", p?.currentPosition ?: 0L)
                                put("duration", (p?.duration ?: 0L).coerceAtLeast(0L))
                            })
                            if (playbackState == Player.STATE_ENDED) notifyListeners("trackEnded", JSObject())
                        }
                        override fun onIsPlayingChanged(isPlaying: Boolean) {
                            notifyListeners("playbackState", JSObject().apply {
                                put("state", controller?.playbackState ?: Player.STATE_IDLE)
                                put("isPlaying", isPlaying)
                                put("position", controller?.currentPosition ?: 0L)
                                put("duration", (controller?.duration ?: 0L).coerceAtLeast(0L))
                            })
                        }
                    }
                    listener = l
                    c.addListener(l)
                } catch (e: Exception) {
                    android.util.Log.e("MerajMediaPlayer", "Media session connection failed", e)
                }
            }, com.google.common.util.concurrent.MoreExecutors.directExecutor())
        }
    }

    private fun withController(call: PluginCall, action: (MediaController) -> Unit) {
        mainHandler.post {
            val c = controller
            if (c == null) call.reject("Background media session is not ready. Please try again.")
            else try { action(c) } catch (e: Exception) { call.reject(e.message ?: "Media operation failed") }
        }
    }

    @PluginMethod
    fun setQueue(call: PluginCall) {
        val items = call.getArray("items")
        val startIndex = call.getInt("startIndex", 0) ?: 0
        if (items == null || items.length() == 0) { call.reject("A non-empty queue is required."); return }
        withController(call) { c ->
            val mediaItems = ArrayList<MediaItem>()
            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                val uri = item.optString("uri", "")
                if (uri.isBlank()) continue
                val title = item.optString("title", "Local audio")
                val artist = item.optString("artist", "Unknown artist")
                val parsedUri = Uri.parse(uri)
                val builder = MediaItem.Builder().setMediaId(item.optString("id", uri)).setUri(parsedUri)
                    .setMediaMetadata(MediaMetadata.Builder().setTitle(title).setArtist(artist).build())
                val mime = try { context.contentResolver.getType(parsedUri) } catch (_: Exception) { null }
                if (!mime.isNullOrBlank()) builder.setMimeType(mime)
                mediaItems.add(builder.build())
            }
            if (mediaItems.isEmpty()) { call.reject("No playable local media URIs were supplied."); return@withController }
            c.setMediaItems(mediaItems, startIndex.coerceIn(0, mediaItems.lastIndex), 0L)
            c.prepare()
            call.resolve(JSObject().put("count", mediaItems.size))
        }
    }

    @PluginMethod
    fun playAt(call: PluginCall) {
        val index = call.getInt("index")
        if (index == null || index < 0) { call.reject("A valid queue index is required."); return }
        withController(call) { c ->
            if (index >= c.mediaItemCount) { call.reject("Queue index is out of range."); return@withController }
            c.seekToDefaultPosition(index)
            c.play()
            call.resolve(JSObject().put("playing", true).put("index", index))
        }
    }

    @PluginMethod
    fun play(call: PluginCall) {
        val uri = call.getString("uri")
        if (uri.isNullOrBlank()) { call.reject("A local content URI is required."); return }
        withController(call) { c ->
            val parsedUri = Uri.parse(uri)
            val builder = MediaItem.Builder().setUri(parsedUri)
            val mime = try { context.contentResolver.getType(parsedUri) } catch (_: Exception) { null }
            if (!mime.isNullOrBlank()) builder.setMimeType(mime)
            c.setMediaItem(builder.build())
            c.prepare(); c.playWhenReady = true; c.play()
            call.resolve(JSObject().put("accepted", true))
        }
    }

    @PluginMethod fun getState(call: PluginCall) = withController(call) { p ->
        call.resolve(JSObject().apply { put("isPlaying", p.isPlaying); put("position", p.currentPosition); put("duration", p.duration.coerceAtLeast(0L)); put("playbackState", p.playbackState); put("currentIndex", p.currentMediaItemIndex); put("mediaId", p.currentMediaItem?.mediaId ?: "") })
    }
    @PluginMethod fun setRepeatOne(call: PluginCall) = withController(call) { p ->
        val enabled = call.getBoolean("enabled", false) ?: false
        p.repeatMode = if (enabled) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
        call.resolve(JSObject().put("enabled", enabled))
    }
    @PluginMethod fun pause(call: PluginCall) = withController(call) { p -> p.pause(); call.resolve(JSObject().put("paused", true)) }
    @PluginMethod fun resume(call: PluginCall) = withController(call) { p -> p.play(); call.resolve(JSObject().put("playing", true)) }
    @PluginMethod fun seekTo(call: PluginCall) = withController(call) { p ->
        // Capacitor may receive a JavaScript Number as Integer, Long, or Double.
        // Parse all numeric representations so a valid slider position is not rejected.
        val raw = call.data.opt("positionMs")
        val position = when (raw) {
            is Number -> raw.toDouble().takeIf { it.isFinite() }?.toLong()
            is String -> raw.toDoubleOrNull()?.takeIf { it.isFinite() }?.toLong()
            else -> null
        }
        if (position == null || position < 0L) {
            call.reject("Invalid seek position: positionMs must be a non-negative number.")
        } else {
            val duration = p.duration
            val target = if (duration > 0L) position.coerceIn(0L, duration) else position
            android.util.Log.d("MerajMediaPlayer", "seekTo requested=$position target=$target duration=$duration seekable=${p.isCurrentMediaItemSeekable}")
            p.seekTo(target)
            call.resolve(JSObject().put("positionMs", target).put("accepted", true))
        }
    }



    @PluginMethod fun setPlaybackSpeed(call: PluginCall) = withController(call) { p ->
        val speed = call.getDouble("speed")
        if (speed == null || !speed.isFinite() || speed < 0.5 || speed > 2.0) {
            call.reject("Playback speed must be between 0.5 and 2.0.")
        } else {
            p.setPlaybackParameters(PlaybackParameters(speed.toFloat(), 1f))
            call.resolve(JSObject().put("speed", speed).put("accepted", true))
        }
    }

    @PluginMethod fun getEqualizerPresets(call: PluginCall) {
        val arr = JSArray()
        MerajAudioEffects.presets().forEach { (key, name) ->
            arr.put(JSObject().put("key", key).put("name", name))
        }
        call.resolve(JSObject().put("presets", arr))
    }

    @PluginMethod fun setEqualizerPreset(call: PluginCall) {
        val key = call.getString("preset")
        if (key.isNullOrBlank()) { call.reject("Preset required"); return }
        if (MerajAudioEffects.apply(key)) {
            call.resolve(JSObject().put("preset", key).put("accepted", true))
        } else {
            call.reject("Equalizer is not attached to the active audio session, or this preset is unavailable.")
        }
    }

    override fun handleOnDestroy() {
        mainHandler.post {
            listener?.let { controller?.removeListener(it) }
            controllerFuture?.let { MediaController.releaseFuture(it) }
            controllerFuture = null
            controller = null
        }
        super.handleOnDestroy()
    }
}
