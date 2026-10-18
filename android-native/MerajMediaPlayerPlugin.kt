package com.meraj.mediaplayer

import android.net.Uri
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Native playback core using Media3/ExoPlayer.
 * Format/container detection is automatic: callers provide a URI, not a manually selected format.
 *
 * Integration note: attach this PlayerView to a dedicated native container/activity layout
 * before exposing the `play` method in a production app. This plugin source is a starter bridge,
 * not yet registered or built by the current GitHub workflow.
 */
@CapacitorPlugin(name = "MerajMediaPlayer")
class MerajMediaPlayerPlugin : Plugin() {
    private var player: ExoPlayer? = null
    private var playerView: PlayerView? = null

    override fun load() {
        super.load()
        player = ExoPlayer.Builder(context).build().apply {
            addListener(object : Player.Listener {
                override fun onPlayerError(error: PlaybackException) {
                    notifyListeners("playbackError", JSObject().apply {
                        put("message", error.message ?: "This file's codec/container is not supported on this device.")
                        put("errorCode", error.errorCode)
                    })
                }

                override fun onPlaybackStateChanged(playbackState: Int) {
                    notifyListeners("playbackState", JSObject().apply {
                        put("state", playbackState)
                        put("isPlaying", isPlaying)
                        put("position", currentPosition)
                        put("duration", duration)
                    })
                }
            })
        }
        playerView = PlayerView(context).apply {
            this.player = this@MerajMediaPlayerPlugin.player
            useController = true
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
    }

    @PluginMethod
    fun play(call: PluginCall) {
        val uriText = call.getString("uri")
        if (uriText.isNullOrBlank()) {
            call.reject("A local content URI is required.")
            return
        }
        try {
            val item = MediaItem.fromUri(Uri.parse(uriText))
            player?.setMediaItem(item)
            player?.prepare()
            player?.playWhenReady = true
            call.resolve(JSObject().put("accepted", true))
        } catch (e: Exception) {
            call.reject("Unable to open media: ${e.message}")
        }
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        player?.pause()
        call.resolve(JSObject().put("paused", true))
    }

    @PluginMethod
    fun resume(call: PluginCall) {
        player?.play()
        call.resolve(JSObject().put("playing", true))
    }

    @PluginMethod
    fun seekTo(call: PluginCall) {
        val position = call.getLong("positionMs")
        if (position == null || position < 0) {
            call.reject("positionMs must be a non-negative number.")
            return
        }
        player?.seekTo(position)
        call.resolve(JSObject().put("positionMs", position))
    }

    override fun handleOnDestroy() {
        playerView?.player = null
        player?.release()
        player = null
        playerView = null
        super.handleOnDestroy()
    }
}
