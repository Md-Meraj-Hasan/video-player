package com.meraj.mediaplayer

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import android.media.audiofx.Equalizer
import android.media.audiofx.LoudnessEnhancer

/** Owns playback independently of the WebView and supplies Android media notification/controls. */
class MerajPlaybackService : MediaSessionService() {
    private var player: ExoPlayer? = null
    private var mediaSession: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val sessionActivity = launchIntent?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()
        val exoPlayer = ExoPlayer.Builder(this).build().apply {
            setAudioAttributes(audioAttributes, true)
            setHandleAudioBecomingNoisy(true)
        }
        player = exoPlayer
        // Media3 exposes the active output session through ExoPlayer; attach the
        // platform Equalizer when playback has initialized the audio output.
        exoPlayer.addListener(object : Player.Listener {
            private fun attachCurrentAudioSession() {
                val sessionId = exoPlayer.audioSessionId
                if (sessionId > 0) MerajAudioEffects.attach(sessionId)
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY) attachCurrentAudioSession()
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) attachCurrentAudioSession()
            }

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                attachCurrentAudioSession()
            }
        })
        val builder = MediaSession.Builder(this, exoPlayer)
        if (sessionActivity != null) builder.setSessionActivity(sessionActivity)
        mediaSession = builder.build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onTaskRemoved(rootIntent: Intent?) {
        val p = player
        if (p == null || !p.playWhenReady || p.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        MerajAudioEffects.release()
        mediaSession?.run { player.release(); release() }
        mediaSession = null
        player = null
        super.onDestroy()
    }
}


/** Audio effects are attached to the actual ExoPlayer audio session, not the WebView or controller. */
internal object MerajAudioEffects {
    @Volatile private var sessionId: Int = 0
    @Volatile private var effect: Equalizer? = null
    @Volatile private var loudness: LoudnessEnhancer? = null
    @Volatile private var boostTarget = 0

    @Synchronized fun attach(id: Int) {
        try {
            effect?.release()
            effect = null
            sessionId = id
            if (id > 0) {
                effect = Equalizer(0, id).apply { enabled = true }
                loudness = LoudnessEnhancer(id).apply { setTargetGain(boostTarget); enabled = boostTarget > 0 }
            }
        } catch (e: Exception) {
            android.util.Log.e("MerajMediaPlayer", "Could not attach Equalizer to session $id", e)
        }
    }

    @Synchronized fun setVolumeBoost(gainMillibels: Int) {
        boostTarget = gainMillibels.coerceIn(0, 600)
        try {
            loudness?.let { it.setTargetGain(boostTarget); it.enabled = boostTarget > 0 }
        } catch (e: Exception) {
            android.util.Log.e("MerajMediaPlayer", "Could not apply volume boost", e)
        }
    }

    @Synchronized fun presets(): List<Pair<String, String>> {
        val eq = effect ?: return emptyList()
        return try {
            (0 until eq.numberOfPresets).map { i ->
                val name = eq.getPresetName(i.toShort()).toString()
                val key = name.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')
                key to name
            }
        } catch (e: Exception) {
            android.util.Log.e("MerajMediaPlayer", "Could not read Equalizer presets", e)
            emptyList()
        }
    }

    @Synchronized fun apply(key: String): Boolean {
        val eq = effect ?: return false
        return try {
            val idx = (0 until eq.numberOfPresets).firstOrNull { i ->
                eq.getPresetName(i.toShort()).toString().lowercase()
                    .replace(Regex("[^a-z0-9]+"), "-").trim('-') == key
            } ?: return false
            eq.usePreset(idx.toShort())
            eq.enabled = true
            true
        } catch (e: Exception) {
            android.util.Log.e("MerajMediaPlayer", "Could not apply Equalizer preset $key", e)
            false
        }
    }

    @Synchronized fun release() {
        try { effect?.release() } catch (_: Exception) {}
        try { loudness?.release() } catch (_: Exception) {}
        effect = null
        loudness = null
        boostTarget = 0
        sessionId = 0
    }
}
