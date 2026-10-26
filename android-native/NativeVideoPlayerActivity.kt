package com.meraj.mediaplayer

import android.app.Activity
import android.app.AlertDialog
import android.media.AudioManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.WindowManager
import android.util.TypedValue
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.google.common.util.concurrent.ListenableFuture
import java.util.Locale

/** Full-screen controls attached to the single ExoPlayer owned by MerajPlaybackService. */
class NativeVideoPlayerActivity : Activity(), SensorEventListener {
    private lateinit var root: FrameLayout
    private lateinit var playerView: PlayerView
    private lateinit var controls: LinearLayout
    private lateinit var topBar: LinearLayout
    private lateinit var gestureIndicator: View
    private lateinit var playButton: ImageButton
    private lateinit var seekBar: SeekBar
    private lateinit var positionLabel: TextView
    private lateinit var durationLabel: TextView
    private lateinit var speedButton: TextView
    private lateinit var fitButton: View
    private lateinit var rotateButton: View
    private lateinit var lockButton: View
    private lateinit var shareButton: TextView
    private lateinit var volumeButton: TextView
    private lateinit var titleLabel: TextView
    private lateinit var scaleDetector: ScaleGestureDetector
    // Shake-to-rotate: use the accelerometer rather than relying on orientation callbacks alone.
    private var sensorManager: SensorManager? = null
    private var accelerometer: Sensor? = null
    private var lastAccelX = 0f
    private var lastAccelY = 0f
    private var lastAccelZ = 0f
    private var hasLastAccel = false
    private var lastShakeAt = 0L
    private var shakeRotationBusy = false
    private var shakeOrientationState = ActivityInfo.SCREEN_ORIENTATION_SENSOR
    private var pinchScale = 1f
    private var isPinching = false
    // True for the entire multi-touch sequence, even after ScaleGestureDetector ends.
    private var multiTouchGesture = false
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private var listener: Player.Listener? = null
    private var previousQueue: List<MediaItem> = emptyList()
    private var previousIndex = 0
    private var previousPosition = 0L
    private var previousPlayWhenReady = false
    private var queueSnapshotTaken = false
    private var videoUri: Uri? = null
    private var videoTitle = "Video"
    private var locked = false
    private var fitMode = 0
    private var speed = 1f
    private var themeName = "default"
    private var accentColor: Int = Color.rgb(155, 105, 255)
    private var volumeMuted = false
    private var seeking = false
    // Side-swipe gestures: left half adjusts screen brightness; right half adjusts volume.
    private var gestureStartX = 0f
    private var gestureStartY = 0f
    private var gestureStartVolume = 1f
    private var currentVolumeBoost = 0f
    private var gestureStartBrightness = 0.5f
    private var activeSideGesture = 0 // 0=none, 1=brightness, 2=volume
    private var sideGestureAdjusted = false
    private val handler = Handler(Looper.getMainLooper())
    private val hideControls = Runnable { if (!locked) { controls.visibility = View.GONE; topBar.visibility = View.GONE } }
    private val hideLockedIndicator = Runnable { if (locked) { controls.visibility = View.GONE; topBar.visibility = View.GONE } }
    private val progress = object : Runnable {
        override fun run() {
            val p = controller
            if (p != null && !seeking) {
                val duration = p.duration.takeIf { it > 0L } ?: 0L
                if (!seeking) {
                    seekBar.max = duration.coerceAtMost(Int.MAX_VALUE.toLong()).toInt().coerceAtLeast(1)
                    seekBar.progress = p.currentPosition.coerceAtMost(seekBar.max.toLong()).toInt()
                    positionLabel.text = formatTime(p.currentPosition)
                }
                durationLabel.text = formatTime(duration)
                playButton.setImageResource(android.R.drawable.ic_media_pause.takeIf { p.isPlaying } ?: android.R.drawable.ic_media_play)
            }
            handler.postDelayed(this, 400)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR
        sensorManager = getSystemService(SENSOR_SERVICE) as? SensorManager
        accelerometer = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        themeName = intent.getStringExtra(EXTRA_THEME) ?: "default"
        // Keep the native Media3 player in sync with the palette selected in the HTML library.
        // Values intentionally cover every theme offered by the audio/video library UI.
        accentColor = when (themeName.lowercase(Locale.ROOT)) {
            "green" -> Color.rgb(32, 230, 154)
            "red" -> Color.rgb(255, 73, 107)
            "silver" -> Color.rgb(213, 219, 229)
            "graphite" -> Color.rgb(174, 183, 196)
            "blue" -> Color.rgb(96, 165, 250)
            "ocean" -> Color.rgb(56, 189, 248)
            "sunset" -> Color.rgb(251, 113, 133)
            "gold" -> Color.rgb(234, 179, 8)
            "ice" -> Color.rgb(103, 232, 249)
            else -> Color.rgb(166, 108, 255) // premium purple default
        }
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        playerView = PlayerView(this).apply {
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
            setKeepContentOnPlayerReset(true)
        }
        // Subtitle block intentionally removed from the video UI.
        // Keep Media3 playback intact but never render subtitle cues over the video.
        playerView.subtitleView?.visibility = View.GONE
        root.addView(playerView, FrameLayout.LayoutParams(-1, -1))
        gestureIndicator = View(this).apply {
            background = GradientDrawable().apply {
                setColor(accentColor)
                cornerRadius = dp(3).toFloat()
            }
            visibility = View.GONE
            alpha = 0.95f
        }
        root.addView(gestureIndicator, FrameLayout.LayoutParams(dp(4), dp(72), Gravity.CENTER_VERTICAL or Gravity.LEFT))
        scaleDetector = ScaleGestureDetector(this, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
                isPinching = true
                handler.removeCallbacks(hideControls)
                return true
            }
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                pinchScale = (pinchScale * detector.scaleFactor).coerceIn(1f, 2f)
                playerView.scaleX = pinchScale
                playerView.scaleY = pinchScale
                return true
            }
            override fun onScaleEnd(detector: ScaleGestureDetector) {
                isPinching = false
                if (pinchScale <= 1.02f) {
                    pinchScale = 1f
                    playerView.scaleX = 1f
                    playerView.scaleY = 1f
                }
                showControls()
            }
        })
        playerView.setOnTouchListener { _, event ->
            scaleDetector.onTouchEvent(event)
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    multiTouchGesture = false
                    isPinching = false
                    gestureStartX = event.x
                    gestureStartY = event.y
                    val audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
                    val maxSystemVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
                    val currentSystemVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC)
                    gestureStartVolume = (currentSystemVolume.toFloat() / maxSystemVolume + currentVolumeBoost / 600f).coerceIn(0f, 2f)
                    val currentBrightness = window.attributes.screenBrightness
                    gestureStartBrightness = if (currentBrightness in 0.01f..1f) currentBrightness else 0.5f
                    activeSideGesture = 0
                    sideGestureAdjusted = false
                    gestureIndicator.visibility = View.GONE
                }
                MotionEvent.ACTION_POINTER_DOWN -> {
                    // Pinch zoom takes priority: never let the same two-finger motion
                    // enter the one-finger brightness/volume swipe handler.
                    multiTouchGesture = true
                    isPinching = true
                    activeSideGesture = 0
                    sideGestureAdjusted = false
                    gestureIndicator.visibility = View.GONE
                    handler.removeCallbacks(hideControls)
                }
                MotionEvent.ACTION_MOVE -> {
                    if (event.pointerCount > 1) {
                        multiTouchGesture = true
                        isPinching = true
                        activeSideGesture = 0
                        sideGestureAdjusted = false
                        gestureIndicator.visibility = View.GONE
                    }
                    if (event.pointerCount == 1 && !isPinching && !multiTouchGesture && !sideGestureAdjusted) {
                        val dx = event.x - gestureStartX
                        val dy = event.y - gestureStartY
                        if (kotlin.math.abs(dy) > dp(24) && kotlin.math.abs(dy) > kotlin.math.abs(dx) * 1.2f) {
                            activeSideGesture = if (gestureStartX < root.width / 2f) 1 else 2
                            sideGestureAdjusted = true
                            handler.removeCallbacks(hideControls)
                        }
                    }
                    if (event.pointerCount == 1 && !isPinching && !multiTouchGesture && sideGestureAdjusted) {
                        val delta = ((gestureStartY - event.y) / root.height.coerceAtLeast(1).toFloat()).coerceIn(-1f, 1f)
                        if (activeSideGesture == 1) {
                            val brightness = (gestureStartBrightness + delta).coerceIn(0.05f, 1f)
                            val attrs = window.attributes
                            attrs.screenBrightness = brightness
                            window.attributes = attrs
                            updateGestureIndicator(brightness, activeSideGesture)
                        } else if (activeSideGesture == 2) {
                            val newVolume = (gestureStartVolume + delta * 2f).coerceIn(0f, 2f)
                            val audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
                            val maxSystemVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
                            val systemLevel = newVolume.coerceAtMost(1f)
                            audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, (systemLevel * maxSystemVolume).toInt().coerceIn(0, maxSystemVolume), 0)
                            currentVolumeBoost = (newVolume - 1f).coerceAtLeast(0f) * 600f
                            MerajAudioEffects.setVolumeBoost(currentVolumeBoost.toInt())
                            volumeMuted = newVolume <= 0.001f
                            if (::volumeButton.isInitialized) volumeButton.text = if (volumeMuted) "🔇" else "🔊"
                            updateGestureIndicator(newVolume / 2f, activeSideGesture)
                        }
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (multiTouchGesture) {
                        // Finish pinch without toggling controls or changing fit/fill.
                        multiTouchGesture = false
                        isPinching = false
                        activeSideGesture = 0
                        sideGestureAdjusted = false
                        gestureIndicator.visibility = View.GONE
                    } else if (sideGestureAdjusted && !isPinching) {
                        gestureIndicator.visibility = View.GONE
                    } else if (locked && !isPinching && event.pointerCount <= 1) {
                        handler.removeCallbacks(hideLockedIndicator)
                        controls.visibility = View.VISIBLE
                        topBar.visibility = View.GONE
                        handler.postDelayed(hideLockedIndicator, 3000)
                    } else if (!locked && !isPinching && event.pointerCount <= 1) {
                        val now = System.currentTimeMillis()
                        // Double-tap must not change Fit/Fill mode. Taps only show/hide controls.
                        toggleControls()
                    }
                    activeSideGesture = 0
                    sideGestureAdjusted = false
                }
            }
            true
        }
        buildControls()
        setContentView(root)
        val rawUri = intent.getStringExtra(EXTRA_URI)
        if (rawUri.isNullOrBlank()) { finish(); return }
        videoUri = Uri.parse(rawUri)
        videoTitle = intent.getStringExtra(EXTRA_TITLE) ?: videoUri?.lastPathSegment ?: "Video"
        val token = SessionToken(this, ComponentName(this, MerajPlaybackService::class.java))
        val future = MediaController.Builder(this, token).buildAsync()
        controllerFuture = future
        future.addListener({
            if (isFinishing || isDestroyed) return@addListener
            try {
                val c = future.get()
                controller = c
                runCatching {
                    c.trackSelectionParameters = c.trackSelectionParameters.buildUpon()
                        .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                        .build()
                }
                playerView.player = c
                snapshotQueue(c)
                val uri = videoUri ?: return@addListener
                // MediaStore document/content URIs often have no file extension. Give
                // Media3 the provider MIME type explicitly so it does not mis-detect
                // large local videos as an unknown/unsupported media source.
                val providerMime = try { contentResolver.getType(uri) } catch (_: Exception) { null }
                val fallbackMime = when (uri.lastPathSegment?.substringAfterLast('.', "")?.lowercase(Locale.US)) {
                    "mp4", "m4v" -> "video/mp4"
                    "mkv" -> "video/x-matroska"
                    "webm" -> "video/webm"
                    "mov" -> "video/quicktime"
                    "3gp" -> "video/3gpp"
                    "ts", "m2ts" -> "video/mp2t"
                    "avi" -> "video/avi"
                    else -> null
                }
                val mime = providerMime?.takeIf { it.startsWith("video/") } ?: fallbackMime
                val queueUris = intent.getStringArrayListExtra(EXTRA_QUEUE_URIS).orEmpty()
                val queueTitles = intent.getStringArrayListExtra(EXTRA_QUEUE_TITLES).orEmpty()
                val queueMimes = intent.getStringArrayListExtra(EXTRA_QUEUE_MIMES).orEmpty()
                val mediaItems = ArrayList<MediaItem>()
                for (i in queueUris.indices) {
                    val qUri = Uri.parse(queueUris[i])
                    val qTitle = queueTitles.getOrNull(i) ?: qUri.lastPathSegment ?: "Video"
                    val qMime = queueMimes.getOrNull(i)?.takeIf { it.startsWith("video/") }
                        ?: try { contentResolver.getType(qUri)?.takeIf { it.startsWith("video/") } } catch (_: Exception) { null }
                    val builder = MediaItem.Builder().setMediaId(qUri.toString()).setUri(qUri)
                        .setMediaMetadata(MediaMetadata.Builder().setTitle(qTitle).build())
                    if (qMime != null && qMime != "video/*") builder.setMimeType(qMime)
                    mediaItems.add(builder.build())
                }
                if (mediaItems.isEmpty()) {
                    val builder = MediaItem.Builder().setMediaId(uri.toString()).setUri(uri)
                        .setMediaMetadata(MediaMetadata.Builder().setTitle(videoTitle).build())
                    if (mime != null) builder.setMimeType(mime)
                    mediaItems.add(builder.build())
                }
                val selectedIndex = mediaItems.indexOfFirst { it.mediaId == uri.toString() }.coerceAtLeast(0)
                c.setMediaItems(mediaItems, selectedIndex, 0L)
                c.setPlaybackSpeed(speed)
                c.prepare()
                c.playWhenReady = true
                c.play()
                val l = object : Player.Listener {
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                        android.util.Log.e("NiceMultimediaVideo", "Shared Media3 playback failed: ${error.errorCodeName}", error)
                        runOnUiThread { Toast.makeText(this@NativeVideoPlayerActivity, "Video playback failed: ${error.errorCodeName}", Toast.LENGTH_LONG).show() }
                    }
                    override fun onIsPlayingChanged(isPlaying: Boolean) { playButton.setImageResource(if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play) }
                    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                        val current = mediaItem ?: return
                        videoUri = current.localConfiguration?.uri ?: runCatching { Uri.parse(current.mediaId) }.getOrNull()
                        videoTitle = current.mediaMetadata.title?.toString()?.takeIf { it.isNotBlank() } ?: videoUri?.lastPathSegment ?: "Video"
                        runOnUiThread { titleLabel.text = videoTitle }
                    }
                }
                listener = l; c.addListener(l)
                handler.post(progress); showControls()
            } catch (e: Exception) {
                android.util.Log.e("NiceMultimediaVideo", "Could not connect to shared MediaSession", e)
                Toast.makeText(this, "Could not open video player", Toast.LENGTH_LONG).show(); finish()
            }
        }, com.google.common.util.concurrent.MoreExecutors.directExecutor())
    }

    private fun buildControls() {
        controls = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val landscape = resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
            setPadding(if (landscape) 0 else dp(8), dp(2), if (landscape) 0 else dp(8), dp(4))
            // Keep the controls container transparent. Only the top title bar and
            // intentionally emphasized buttons get their own visible surfaces.
            background = null
            elevation = 0f
        }
        val top = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(10), dp(4), dp(10), dp(4))
            // Keep the speed/title/share row transparent: remove the extra outer dock box.
            background = null
            elevation = 0f
        }
        // Requested layout: speed button on the LEFT, title in the middle, share on the RIGHT.
        speedButton = compactTool("⏱") { showSpeedPicker() }.apply {
            contentDescription = "Playback speed menu"
            background = toolBackground()
            elevation = dp(5).toFloat()
            setTextColor(accentColor)
            minWidth = dp(42)
            textSize = 18f
            setPadding(dp(4), dp(4), dp(4), dp(4))
            isClickable = true
            isFocusable = true
        }
        top.addView(speedButton, LinearLayout.LayoutParams(dp(42), dp(42)))
        titleLabel = TextView(this).apply {
            text = videoTitle; setTextColor(Color.WHITE); textSize = 14f
            maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), 0, dp(8), 0)
        }
        top.addView(titleLabel, LinearLayout.LayoutParams(0, dp(48), 1f))
        shareButton = compactTool("↗") { shareCurrentVideo() }.apply {
            contentDescription = "Share current video"
            background = toolBackground()
            elevation = dp(5).toFloat()
            setTextColor(accentColor)
            minWidth = dp(42)
            textSize = 20f
            setPadding(dp(4), dp(4), dp(4), dp(4))
            isClickable = true
            isFocusable = true
        }
        top.addView(shareButton, LinearLayout.LayoutParams(dp(42), dp(42)))
        topBar = top
        // No outer rounded rectangle around speed, title, and share; button circles remain.
        root.addView(topBar, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))

        // Transparent, balanced control row: previous immediately left of the centered Play/Pause,
        // next immediately right. Remaining actions are distributed on both sides.
        val middle = LinearLayout(this).apply {
            minimumHeight = dp(50)
            orientation = LinearLayout.HORIZONTAL
            // Keep the complete playback-tool cluster centered in the available player width.
            gravity = Gravity.CENTER
            // Child weights are leftGroup=2 and rightGroup=5. The old 2f
            // weightSum starved the right group, hiding its five controls.
            weightSum = 7f
            // Always occupy the full available player width, including landscape.
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(50))
        }
        fun makeIcon(icon: Int, action: () -> Unit): ImageButton = iconButton(icon, action).apply {
            background = toolBackground()
            elevation = dp(5).toFloat()
            setColorFilter(accentColor)
            setPadding(dp(5), dp(5), dp(5), dp(5))
        }
        fun makeText(label: String, action: () -> Unit): TextView = compactTool(label, action).apply {
            textSize = 21f
            setTextColor(Color.WHITE)
            background = null
            setTextColor(accentColor)
            setPadding(dp(3), dp(5), dp(3), dp(5))
        }
        fun skipButton(reverse: Boolean): View {
            val button = SkipButtonView(this, reverse)
            // Circular solid theme surface keeps the skip glyph visible on any video frame.
            button.background = toolBackground()
            button.elevation = dp(5).toFloat()
            button.contentDescription = if (reverse) "Rewind 15 seconds" else "Forward 15 seconds"
            button.isClickable = true
            button.isFocusable = true
            button.setOnClickListener {
                controller?.let { player ->
                    val duration = player.duration
                    val target = if (reverse) (player.currentPosition - 15_000L).coerceAtLeast(0L)
                        else (player.currentPosition + 15_000L).let { if (duration > 0L) it.coerceAtMost(duration) else it }
                    player.seekTo(target)
                }
                showControls()
            }
            return button
        }
        val landscapeControls = resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
        // Larger controls in portrait, with the remaining width distributed
        // evenly around fixed-size circular buttons.
        val smallControl = if (landscapeControls) dp(48) else dp(42)
        val leftGroup = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        val rewind = skipButton(true)
        leftGroup.addView(rewind, LinearLayout.LayoutParams(smallControl, smallControl).apply { leftMargin = dp(if (landscapeControls) 8 else 1); rightMargin = dp(if (landscapeControls) 8 else 1) })
        fitButton = ThemeIconView(this, "fit").apply {
            background = toolBackground()
            elevation = dp(5).toFloat()
            contentDescription = "Cycle Fit, Zoom and Fill modes"
            setOnClickListener { toggleFit() }
        }
        rotateButton = ThemeIconView(this, "rotate").apply {
            background = toolBackground()
            elevation = dp(5).toFloat()
            contentDescription = "Rotate screen"
            setOnClickListener { toggleOrientation(); showControls() }
        }
        val previousButton = makeIcon(android.R.drawable.ic_media_previous) {
            controller?.let { p ->
                if (p.hasPreviousMediaItem()) p.seekToPreviousMediaItem()
                else if (p.currentPosition > 3000L) p.seekTo(0L)
                else Toast.makeText(this, "This is the first video in the queue", Toast.LENGTH_SHORT).show()
            } ?: Toast.makeText(this, "Player is not ready yet", Toast.LENGTH_SHORT).show()
        }
        leftGroup.addView(previousButton, LinearLayout.LayoutParams(smallControl, smallControl).apply { leftMargin = dp(if (landscapeControls) 8 else 1); rightMargin = dp(if (landscapeControls) 8 else 1) })
        middle.addView(leftGroup, LinearLayout.LayoutParams(0, smallControl, 2f))

        val rightGroup = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER; tag = "meraj-right-control-group" }
        val nextButton = makeIcon(android.R.drawable.ic_media_next) {
            controller?.let { p -> if (p.hasNextMediaItem()) p.seekToNextMediaItem() else Toast.makeText(this, "No next video in playback queue", Toast.LENGTH_SHORT).show() }
                ?: Toast.makeText(this, "Player is not ready yet", Toast.LENGTH_SHORT).show()
        }
        rightGroup.addView(nextButton, LinearLayout.LayoutParams(smallControl, smallControl).apply { leftMargin = dp(if (landscapeControls) 8 else 1); rightMargin = dp(if (landscapeControls) 8 else 1) })
        val forward = skipButton(false)
        rightGroup.addView(forward, LinearLayout.LayoutParams(smallControl, smallControl).apply { leftMargin = dp(if (landscapeControls) 8 else 1); rightMargin = dp(if (landscapeControls) 8 else 1) })
        rightGroup.addView(fitButton, LinearLayout.LayoutParams(smallControl, smallControl).apply { leftMargin = dp(if (landscapeControls) 8 else 1); rightMargin = dp(if (landscapeControls) 8 else 1) })
        lockButton = ThemeIconView(this, "lock").apply {
            background = toolBackground()
            elevation = dp(5).toFloat()
            contentDescription = "Lock video controls"
            setOnClickListener {
                locked = !locked
                (lockButton as? ThemeIconView)?.isLocked = locked
                lockButton.contentDescription = if (locked) "Unlock video controls" else "Lock video controls"
                lockButton.invalidate()
                setControlsLocked(locked)
                if (locked) {
                    handler.removeCallbacks(hideControls)
                    handler.removeCallbacks(hideLockedIndicator)
                    handler.postDelayed(hideLockedIndicator, 5000)
                    Toast.makeText(this@NativeVideoPlayerActivity, "Controls locked — tap screen to show unlock", Toast.LENGTH_SHORT).show()
                } else {
                    handler.removeCallbacks(hideLockedIndicator)
                    showControls()
                    Toast.makeText(this@NativeVideoPlayerActivity, "Controls unlocked", Toast.LENGTH_SHORT).show()
                }
            }
        }
        rightGroup.addView(lockButton, LinearLayout.LayoutParams(smallControl, smallControl).apply { leftMargin = dp(if (landscapeControls) 8 else 1); rightMargin = dp(if (landscapeControls) 8 else 1) })
        rightGroup.addView(rotateButton, LinearLayout.LayoutParams(smallControl, smallControl).apply { leftMargin = dp(if (landscapeControls) 8 else 1); rightMargin = dp(if (landscapeControls) 8 else 1) })
        middle.addView(rightGroup, LinearLayout.LayoutParams(0, smallControl, 5f))

        // Keep every control circular and fixed-size, but use weighted spacer
        // views to spread the controls across the full available row width.
        fun distribute(group: LinearLayout) {
            val children = (0 until group.childCount).map { group.getChildAt(it) }
            group.removeAllViews()
            group.gravity = Gravity.CENTER_VERTICAL
            fun addSpacer() {
                group.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
            }
            addSpacer()
            children.forEachIndexed { index, child ->
                child.layoutParams = LinearLayout.LayoutParams(smallControl, smallControl)
                group.addView(child)
                if (index < children.lastIndex) addSpacer()
            }
            addSpacer()
        }
        distribute(leftGroup)
        distribute(rightGroup)

        playButton = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_media_play)
            setColorFilter(contrastTextColor(accentColor))
            background = primaryToolBackground()
            elevation = dp(7).toFloat()
            setPadding(dp(5), dp(5), dp(5), dp(5))
            scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
            contentDescription = "Play or pause"
            setOnClickListener { controller?.let { if (it.isPlaying) it.pause() else it.play() }; showControls() }
        }
        val playSize = smallControl
        middle.addView(playButton, 1, LinearLayout.LayoutParams(playSize, smallControl))
        middle.setPadding(dp(2), 0, dp(2), 0)
        controls.addView(middle, LinearLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(50)))
        // Volume is deliberately removed from the button row; adjust it by swiping vertically on the right half.
        volumeButton = compactTool("🔊") { showVolumePicker() }

        val seekRow = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            orientation = LinearLayout.HORIZONTAL
            // The parent control dock supplies the single panel surface; avoid a nested box.
            setBackgroundColor(Color.TRANSPARENT)
            elevation = 0f
            setPadding(dp(8), dp(2), dp(8), dp(2))
        }
        positionLabel = timeLabel("00:00"); seekRow.addView(positionLabel)
        seekBar = SeekBar(this).apply {
            progressTintList = android.content.res.ColorStateList.valueOf(accentColor)
            thumbTintList = android.content.res.ColorStateList.valueOf(accentColor)
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(Color.argb(90, 255, 255, 255))
            max = 1000
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onStartTrackingTouch(sb: SeekBar) { seeking = true; handler.removeCallbacks(hideControls) }
                override fun onProgressChanged(sb: SeekBar, value: Int, fromUser: Boolean) { if (fromUser) positionLabel.text = formatTime(value.toLong()) }
                override fun onStopTrackingTouch(sb: SeekBar) {
                    val target = sb.progress.toLong().coerceAtLeast(0L)
                    controller?.let { p ->
                        val duration = p.duration
                        p.seekTo(if (duration > 0L) target.coerceAtMost(duration) else target)
                    }
                    seeking = false
                    showControls()
                }
            })
        }
        seekRow.addView(seekBar, LinearLayout.LayoutParams(0, 34, 1f)); durationLabel = timeLabel("00:00"); seekRow.addView(durationLabel)
        controls.addView(seekRow)
        val controlsParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        )
        controlsParams.leftMargin = 0
        controlsParams.rightMargin = 0
        controlsParams.bottomMargin = dp(56)
        controls.layoutParams = controlsParams
        controls.isFocusable = false
        root.addView(controls, controlsParams)
        controls.setOnClickListener { showControls() }
    }

    private inner class ThemeIconView(
        context: android.content.Context,
        private val kind: String
    ) : View(context) {
        var fitMode: Int = 0
            set(value) { field = value; invalidate() }
        var isLocked: Boolean = false
            set(value) { field = value; invalidate() }

        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = dp(2).toFloat()
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            paint.color = accentColor
            val side = minOf(width, height).toFloat()
            val cx = width / 2f
            val cy = height / 2f
            val unit = side * 0.27f
            when (kind) {
                "fit" -> {
                    when (fitMode) {
                        0 -> { // four clear outward corner brackets = Fit
                            val p = Path()
                            val l = cx - unit; val r = cx + unit
                            val t = cy - unit; val b = cy + unit
                            val k = unit * 0.48f
                            p.moveTo(l, t + k); p.lineTo(l, t); p.lineTo(l + k, t)
                            p.moveTo(r - k, t); p.lineTo(r, t); p.lineTo(r, t + k)
                            p.moveTo(l, b - k); p.lineTo(l, b); p.lineTo(l + k, b)
                            p.moveTo(r - k, b); p.lineTo(r, b); p.lineTo(r, b - k)
                            canvas.drawPath(p, paint)
                        }
                        1 -> { // Zoom: magnifier with a plus, clearer than a text glyph
                            canvas.drawCircle(cx - unit * .12f, cy - unit * .12f, unit * .62f, paint)
                            canvas.drawLine(cx + unit * .28f, cy + unit * .28f, cx + unit * .82f, cy + unit * .82f, paint)
                            canvas.drawLine(cx - unit * .42f, cy - unit * .12f, cx + unit * .18f, cy - unit * .12f, paint)
                            canvas.drawLine(cx - unit * .12f, cy - unit * .42f, cx - unit * .12f, cy + unit * .18f, paint)
                        }
                        else -> { // Fill: a clean frame with solid center
                            paint.style = Paint.Style.STROKE
                            canvas.drawRoundRect(RectF(cx-unit, cy-unit, cx+unit, cy+unit), dp(2).toFloat(), dp(2).toFloat(), paint)
                            paint.style = Paint.Style.FILL
                            canvas.drawRect(RectF(cx-unit*.48f, cy-unit*.48f, cx+unit*.48f, cy+unit*.48f), paint)
                            paint.style = Paint.Style.STROKE
                        }
                    }
                }
                "rotate" -> {
                    val r = unit * .78f
                    val oval = RectF(cx-r, cy-r, cx+r, cy+r)
                    canvas.drawArc(oval, 35f, 285f, false, paint)
                    val ex = cx + r * kotlin.math.cos(Math.toRadians(320.0)).toFloat()
                    val ey = cy + r * kotlin.math.sin(Math.toRadians(320.0)).toFloat()
                    val arrow = Path().apply {
                        moveTo(ex, ey)
                        lineTo(ex - dp(6), ey - dp(1))
                        moveTo(ex, ey)
                        lineTo(ex - dp(1), ey + dp(6))
                    }
                    canvas.drawPath(arrow, paint)
                }
                "lock" -> {
                    val bw = unit * 1.15f
                    val bh = unit * .82f
                    val left = cx - bw/2
                    val right = cx + bw/2
                    val top = cy - bh/4
                    val bottom = cy + bh
                    val shackle = RectF(cx - bw*.32f, cy - unit*.95f, cx + bw*.32f, top + unit*.2f)
                    canvas.drawArc(shackle, 180f, 180f, false, paint)
                    canvas.drawRect(RectF(left, top, right, bottom), paint)
                    canvas.drawCircle(cx, top + bh*.42f, dp(2).toFloat(), paint)
                    canvas.drawLine(cx, top + bh*.42f, cx, top + bh*.66f, paint)
                }
            }
        }
    }

    private inner class SkipButtonView(
        context: android.content.Context,
        private val reverse: Boolean
    ) : View(context) {
        private val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = accentColor
            style = Paint.Style.STROKE
            strokeWidth = dp(2).toFloat()
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = accentColor
            textAlign = Paint.Align.CENTER
            typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val w = width.toFloat()
            val h = height.toFloat()
            // Transparent button surface; only the theme-colored icon is drawn.
            iconPaint.color = accentColor
            textPaint.color = accentColor

            // Clear circular rewind/forward glyph with a readable 15-second mark.
            val cx = w / 2f
            val cy = h * 0.43f
            val r = minOf(w, h) * 0.24f
            val oval = RectF(cx - r, cy - r, cx + r, cy + r)
            val startAngle = if (reverse) 45f else 135f
            val sweepAngle = if (reverse) 285f else -285f
            canvas.drawArc(oval, startAngle, sweepAngle, false, iconPaint)

            val endAngle = Math.toRadians((startAngle + sweepAngle).toDouble())
            val ex = cx + r * kotlin.math.cos(endAngle).toFloat()
            val ey = cy + r * kotlin.math.sin(endAngle).toFloat()
            val direction = if (reverse) 1f else -1f
            val arrow = Path().apply {
                moveTo(ex, ey)
                lineTo(ex - dp(5) * direction, ey - dp(1).toFloat())
                moveTo(ex, ey)
                lineTo(ex - dp(1).toFloat(), ey + dp(5) * direction)
            }
            canvas.drawPath(arrow, iconPaint)

            textPaint.textSize = dp(10).toFloat()
            val baseline = cy - (textPaint.ascent() + textPaint.descent()) / 2f
            canvas.drawText("15", cx, baseline, textPaint)
        }
    }

    private fun blendColor(base: Int, accent: Int, amount: Float): Int {
        val a = amount.coerceIn(0f, 1f)
        val r = (Color.red(base) * (1f - a) + Color.red(accent) * a).toInt()
        val g = (Color.green(base) * (1f - a) + Color.green(accent) * a).toInt()
        val b = (Color.blue(base) * (1f - a) + Color.blue(accent) * a).toInt()
        return Color.rgb(r, g, b)
    }

    private fun contrastTextColor(color: Int): Int {
        val luminance = (Color.red(color) * 299 + Color.green(color) * 587 + Color.blue(color) * 114) / 1000
        return if (luminance > 155) Color.BLACK else Color.WHITE
    }

    private fun solidButton(color: Int) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(5).toFloat()
    }

    // Theme-aware 3D surfaces: controls stay legible even when the video frame
    // contains colors similar to the active accent. The icon keeps its solid theme tint.
    private fun controlDockBackground() = GradientDrawable(
        GradientDrawable.Orientation.TOP_BOTTOM,
        intArrayOf(Color.argb(248, 20, 22, 34), Color.argb(238, 5, 7, 14))
    ).apply {
        cornerRadius = dp(14).toFloat()
        setStroke(dp(1), blendColor(Color.rgb(22, 24, 36), accentColor, 0.88f))
    }
    private fun panelBackground() = controlDockBackground()
    private fun toolBackground() = GradientDrawable(
        GradientDrawable.Orientation.TOP_BOTTOM,
        intArrayOf(blendColor(Color.rgb(42, 46, 60), accentColor, 0.42f),
                   blendColor(Color.rgb(9, 12, 22), accentColor, 0.20f))
    ).apply {
        shape = GradientDrawable.OVAL
        setStroke(dp(2), blendColor(Color.WHITE, accentColor, 0.72f))
    }
    private fun primaryToolBackground() = GradientDrawable(
        GradientDrawable.Orientation.TOP_BOTTOM,
        intArrayOf(blendColor(Color.WHITE, accentColor, 0.88f),
                   blendColor(Color.BLACK, accentColor, 0.72f))
    ).apply {
        shape = GradientDrawable.OVAL
        setStroke(dp(2), blendColor(Color.WHITE, accentColor, 0.82f))
    }

    private fun compactTool(label: String, action: () -> Unit): TextView = TextView(this).apply {
        text = label; textSize = 14f; setTextColor(Color.WHITE); gravity = Gravity.CENTER; maxLines = 1; includeFontPadding = false
        setPadding(4, 6, 4, 6); minWidth = 0
        isClickable = true; isFocusable = true
        setOnClickListener { action(); showControls() }
    }

    private fun tool(label: String, action: () -> Unit): TextView = TextView(this).apply {
        text = label; textSize = 15f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
        setPadding(12, 12, 12, 12); setOnClickListener { action(); showControls() }
    }
    private fun iconButton(icon: Int, action: () -> Unit): ImageButton = ImageButton(this).apply {
        setImageResource(icon); setColorFilter(accentColor); background = toolBackground()
        elevation = dp(4).toFloat()
        layoutParams = LinearLayout.LayoutParams(0, 58, 1f); setPadding(10, 10, 10, 10)
        scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
        setOnClickListener { action(); showControls() }
    }
    private fun timeLabel(value: String) = TextView(this).apply { text = value; setTextColor(Color.WHITE); textSize = 12f; setPadding(5, 0, 5, 0) }
    private fun setControlsLocked(value: Boolean) {
        // While locked, hide every control except the lock/unlock button itself.
        fun containsLock(view: View): Boolean {
            if (view === lockButton) return true
            if (view is android.view.ViewGroup) {
                for (i in 0 until view.childCount) if (containsLock(view.getChildAt(i))) return true
            }
            return false
        }
        fun applyVisibility(view: View) {
            if (view === lockButton) {
                view.visibility = View.VISIBLE
                view.isEnabled = true
                view.alpha = 1f
                return
            }
            if (value && !containsLock(view)) {
                view.visibility = View.GONE
                return
            }
            view.visibility = View.VISIBLE
            view.isEnabled = !value
            if (view is android.view.ViewGroup) {
                for (i in 0 until view.childCount) applyVisibility(view.getChildAt(i))
            }
        }
        applyVisibility(controls)
        topBar.visibility = if (value) View.GONE else View.VISIBLE
        if (value) {
            controls.findViewWithTag<LinearLayout>("meraj-right-control-group")?.gravity = Gravity.CENTER
            (controls.getChildAt(0) as? LinearLayout)?.gravity = Gravity.CENTER
            controls.setPadding(0, 0, 0, 0)
            controls.background = null
            (controls.layoutParams as? FrameLayout.LayoutParams)?.let {
                it.width = FrameLayout.LayoutParams.MATCH_PARENT
                it.leftMargin = 0
                it.rightMargin = 0
                it.bottomMargin = dp(12)
                controls.layoutParams = it
            }
        } else {
            controls.findViewWithTag<LinearLayout>("meraj-right-control-group")?.gravity = Gravity.CENTER
            (controls.getChildAt(0) as? LinearLayout)?.gravity = Gravity.CENTER
            val landscape = resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
            controls.setPadding(0, dp(2), 0, dp(4))
            (controls.layoutParams as? FrameLayout.LayoutParams)?.let {
                // Explicitly stretch the complete control strip edge-to-edge in landscape.
                it.width = FrameLayout.LayoutParams.MATCH_PARENT
                it.leftMargin = 0
                it.rightMargin = 0
                it.bottomMargin = if (landscape) dp(12) else dp(48)
                controls.layoutParams = it
            }
            val middle = controls.getChildAt(0)
            middle.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(50))
            if (landscape) {
                // Weighted left/right groups share all remaining width around the centered play button.
                middle.setPadding(0, 0, 0, 0)
            }
        }
    }
    private fun toggleControls() {
        if (controls.visibility == View.VISIBLE || topBar.visibility == View.VISIBLE) {
            if (!locked) {
                controls.visibility = View.GONE
                topBar.visibility = View.GONE
                handler.removeCallbacks(hideControls)
            }
        } else showControls()
    }
    private fun showControls() {
        controls.visibility = View.VISIBLE
        topBar.visibility = View.VISIBLE
        handler.removeCallbacks(hideControls)
        if (!locked) handler.postDelayed(hideControls, 5000)
    }
    private fun updateGestureIndicator(level: Float, side: Int) {
        val value = level.coerceIn(0f, 1f)
        val height = dp(24) + (dp(112) * value).toInt()
        val params = (gestureIndicator.layoutParams as FrameLayout.LayoutParams)
        params.width = dp(4)
        params.height = height
        params.gravity = Gravity.CENTER_VERTICAL or (if (side == 1) Gravity.LEFT else Gravity.RIGHT)
        params.leftMargin = if (side == 1) dp(28) else 0
        params.rightMargin = if (side == 2) dp(28) else 0
        gestureIndicator.layoutParams = params
        gestureIndicator.visibility = View.VISIBLE
    }
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun showVolumePicker() {
        val audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
        val maxSystemVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        val systemVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC)
        val initial = (systemVolume.toFloat() / maxSystemVolume * 100f + currentVolumeBoost / 6f).toInt().coerceIn(0, 200)
        val panel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(22), dp(12), dp(22), dp(8)) }
        val label = TextView(this).apply { text = "Volume: $initial% (100% = device maximum)"; textSize = 14f }
        panel.addView(label)
        val slider = SeekBar(this).apply { max = 200; progress = initial }
        panel.addView(slider)
        val dialog = AlertDialog.Builder(this).setTitle("Volume") .setView(panel).setNegativeButton("Mute", null).setPositiveButton("Done", null).create()
        fun applyVolume(value: Int) {
            val base = value.coerceAtMost(100)
            audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, (base / 100f * maxSystemVolume).toInt().coerceIn(0, maxSystemVolume), 0)
            currentVolumeBoost = (value - 100).coerceAtLeast(0) * 6f
            MerajAudioEffects.setVolumeBoost(currentVolumeBoost.toInt())
            volumeMuted = value == 0
            label.text = if (value <= 100) "Volume: $value% (device volume)" else "Volume: $value% (extra boost)"
            if (::volumeButton.isInitialized) volumeButton.text = if (volumeMuted) "🔇" else "🔊"
        }
        slider.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onProgressChanged(sb: SeekBar, value: Int, fromUser: Boolean) { if (fromUser) applyVolume(value) }
            override fun onStopTrackingTouch(sb: SeekBar) {}
        })
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setOnClickListener { applyVolume(0); slider.progress = 0 }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener { dialog.dismiss(); showControls() }
        }
        dialog.show()
        showControls()
    }

    private fun shareCurrentVideo() {
        val uri = videoUri ?: run { Toast.makeText(this, "Video URI unavailable", Toast.LENGTH_SHORT).show(); return }
        try {
            val send = Intent(Intent.ACTION_SEND).apply {
                type = contentResolver.getType(uri) ?: "video/*"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                clipData = android.content.ClipData.newUri(contentResolver, videoTitle, uri)
            }
            startActivity(Intent.createChooser(send, "Share video"))
        } catch (e: Exception) {
            Toast.makeText(this, "Could not share video: ${e.message ?: "unknown error"}", Toast.LENGTH_LONG).show()
        }
    }
    private fun toggleFit() {
        fitMode = (fitMode + 1) % 3
        playerView.resizeMode = when (fitMode) {
            1 -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            2 -> AspectRatioFrameLayout.RESIZE_MODE_FILL
            else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
        (fitButton as? ThemeIconView)?.fitMode = fitMode
        fitButton.contentDescription = when (fitMode) { 1 -> "Zoom mode"; 2 -> "Fill mode"; else -> "Fit mode" }
        fitButton.invalidate()
        showControls()
    }
    override fun onResume() {
        super.onResume()
        // Re-register on resume so shake detection remains reliable after returning from a chooser.
        hasLastAccel = false
        accelerometer?.let { sensor ->
            sensorManager?.registerListener(this, sensor, SensorManager.SENSOR_DELAY_GAME)
        }
    }

    override fun onPause() {
        sensorManager?.unregisterListener(this)
        hasLastAccel = false
        super.onPause()
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ACCELEROMETER || event.values.size < 3) return
        val x = event.values[0]
        val y = event.values[1]
        val z = event.values[2]
        if (!hasLastAccel) {
            lastAccelX = x; lastAccelY = y; lastAccelZ = z
            hasLastAccel = true
            return
        }

        // Delta acceleration catches a deliberate shake but ignores ordinary slow tilting.
        val deltaX = x - lastAccelX
        val deltaY = y - lastAccelY
        val deltaZ = z - lastAccelZ
        lastAccelX = x; lastAccelY = y; lastAccelZ = z
        val jerk = kotlin.math.sqrt(
            (deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ).toDouble()
        ).toFloat()
        val now = android.os.SystemClock.elapsedRealtime()
        if (jerk >= 8.5f && now - lastShakeAt >= 900L && !shakeRotationBusy) {
            lastShakeAt = now
            rotateAfterShake()
        }
    }

    private fun rotateAfterShake() {
        if (isFinishing || !::playerView.isInitialized) return
        shakeRotationBusy = true

        // A short Y-axis flip gives the video a 3D turn while the screen direction changes.
        playerView.cameraDistance = dp(1800).toFloat()
        playerView.animate().cancel()
        playerView.rotationY = 0f
        playerView.animate()
            .rotationY(78f)
            .setDuration(180L)
            .withEndAction {
                val current = resources.configuration.orientation
                val nextOrientation = when (shakeOrientationState) {
                    ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE ->
                        ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE
                    ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE ->
                        ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                    ActivityInfo.SCREEN_ORIENTATION_PORTRAIT ->
                        ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                    else -> if (
                        current == android.content.res.Configuration.ORIENTATION_LANDSCAPE
                    ) ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE
                    else ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                }
                shakeOrientationState = nextOrientation

                // Reset the view transform before Android relays out the full-screen player.
                playerView.rotationY = 0f
                requestedOrientation = nextOrientation
                root.post {
                    playerView.rotationY = -78f
                    playerView.animate()
                        .rotationY(0f)
                        .setDuration(220L)
                        .withEndAction {
                            shakeRotationBusy = false
                            showControls()
                        }
                        .start()
                }
            }
            .start()
    }

    private fun toggleOrientation() {
        requestedOrientation = if (resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE) {
            shakeOrientationState = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        } else {
            shakeOrientationState = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        }
        root.post {
            if (::controls.isInitialized) {
                val landscape = resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
                controls.setPadding(if (landscape) 0 else dp(8), dp(2), if (landscape) 0 else dp(8), dp(4))
                val lp = controls.layoutParams as? FrameLayout.LayoutParams
                if (lp != null) {
                    lp.width = FrameLayout.LayoutParams.MATCH_PARENT
                    lp.leftMargin = 0
                    lp.rightMargin = 0
                    controls.layoutParams = lp
                }
                setControlsLocked(locked)
                controls.requestLayout()
            }
        }
        showControls()
    }
    private fun showSpeedPicker() {
        val values = arrayOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)
        val popupContent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(4), dp(4), dp(4), dp(4))
            background = GradientDrawable().apply {
                setColor(blendColor(Color.BLACK, accentColor, 0.22f))
                cornerRadius = dp(10).toFloat()
                setStroke(dp(1), accentColor)
            }
        }
        var popup: PopupWindow? = null
        values.forEach { value ->
            val label = if (value == 1f) "1×  Normal" else "${value}×"
            val item = TextView(this).apply {
                text = label
                textSize = 14f
                setTextColor(if (value == speed) Color.WHITE else Color.LTGRAY)
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(14), dp(4), dp(16), dp(4))
                minWidth = dp(116)
                if (value == speed) background = solidButton(accentColor)
                if (value == speed) setTextColor(contrastTextColor(accentColor))
                setOnClickListener {
                    speed = value
                    controller?.setPlaybackSpeed(speed)
                    speedButton.text = "⏱"
                    popup?.dismiss()
                    showControls()
                }
            }
            popupContent.addView(item, LinearLayout.LayoutParams(-1, dp(36)))
        }
        popup = PopupWindow(popupContent, dp(138), -2, true).apply {
            elevation = dp(12).toFloat()
            isOutsideTouchable = true
            setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
            showAsDropDown(speedButton, 0, -dp(2), Gravity.START)
        }
        showControls()
    }
    private fun snapshotQueue(p: MediaController) { if (queueSnapshotTaken) return; previousQueue = (0 until p.mediaItemCount).map { p.getMediaItemAt(it) }; previousIndex = p.currentMediaItemIndex.coerceAtLeast(0); previousPosition = p.currentPosition.coerceAtLeast(0L); previousPlayWhenReady = p.playWhenReady; queueSnapshotTaken = true }
    private fun formatTime(ms: Long): String { val s = (ms.coerceAtLeast(0L) / 1000); return if (s >= 3600) String.format(Locale.US, "%d:%02d:%02d", s/3600, (s%3600)/60, s%60) else String.format(Locale.US, "%02d:%02d", s/60, s%60) }
    override fun onStop() { super.onStop() }
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        handler.removeCallbacks(hideControls)
        // Close only the video Activity; keep the shared playback service alive for audio.
        finish()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null); playerView.player = null
        val c = controller; listener?.let { c?.removeListener(it) }
        if (isFinishing && queueSnapshotTaken && c != null) try {
            if (previousQueue.isNotEmpty()) { c.setMediaItems(previousQueue, previousIndex.coerceIn(0, previousQueue.lastIndex), previousPosition); c.prepare(); if (previousPlayWhenReady) c.play() else c.pause() } else c.clearMediaItems()
        } catch (e: Exception) { android.util.Log.w("NiceMultimediaVideo", "Could not restore previous audio queue", e) }
        controllerFuture?.let { MediaController.releaseFuture(it) }; controllerFuture = null; controller = null
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); if (isFinishing) requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT; super.onDestroy()
    }
    companion object {
        const val EXTRA_URI = "com.meraj.mediaplayer.VIDEO_URI"
        const val EXTRA_TITLE = "com.meraj.mediaplayer.VIDEO_TITLE"
        const val EXTRA_THEME = "com.meraj.mediaplayer.VIDEO_THEME"
        const val EXTRA_QUEUE_URIS = "com.meraj.mediaplayer.VIDEO_QUEUE_URIS"
        const val EXTRA_QUEUE_TITLES = "com.meraj.mediaplayer.VIDEO_QUEUE_TITLES"
        const val EXTRA_QUEUE_MIMES = "com.meraj.mediaplayer.VIDEO_QUEUE_MIMES"
    }
}
