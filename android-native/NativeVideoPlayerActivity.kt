package com.meraj.mediaplayer

import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
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
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
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
class NativeVideoPlayerActivity : Activity() {
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
    private lateinit var fitButton: TextView
    private lateinit var rotateButton: TextView
    private lateinit var lockButton: TextView
    private lateinit var shareButton: TextView
    private lateinit var volumeButton: TextView
    private lateinit var titleLabel: TextView
    private lateinit var scaleDetector: ScaleGestureDetector
    private var pinchScale = 1f
    private var isPinching = false
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
    private var volumeMuted = false
    private var seeking = false
    private var lastTap = 0L
    // Side-swipe gestures: left half adjusts screen brightness; right half adjusts volume.
    private var gestureStartX = 0f
    private var gestureStartY = 0f
    private var gestureStartVolume = 1f
    private var gestureStartBrightness = 0.5f
    private var activeSideGesture = 0 // 0=none, 1=brightness, 2=volume
    private var sideGestureAdjusted = false
    private val handler = Handler(Looper.getMainLooper())
    private val hideControls = Runnable { if (!locked) { controls.visibility = View.GONE; topBar.visibility = View.GONE } }
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
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        playerView = PlayerView(this).apply {
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
            setKeepContentOnPlayerReset(true)
        }
        root.addView(playerView, FrameLayout.LayoutParams(-1, -1))
        gestureIndicator = View(this).apply {
            background = GradientDrawable().apply {
                setColor(Color.rgb(74, 224, 205))
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
                    gestureStartX = event.x
                    gestureStartY = event.y
                    gestureStartVolume = controller?.volume ?: 1f
                    val currentBrightness = window.attributes.screenBrightness
                    gestureStartBrightness = if (currentBrightness in 0.01f..1f) currentBrightness else 0.5f
                    activeSideGesture = 0
                    sideGestureAdjusted = false
                    gestureIndicator.visibility = View.GONE
                }
                MotionEvent.ACTION_MOVE -> {
                    if (!isPinching && !sideGestureAdjusted) {
                        val dx = event.x - gestureStartX
                        val dy = event.y - gestureStartY
                        if (kotlin.math.abs(dy) > dp(24) && kotlin.math.abs(dy) > kotlin.math.abs(dx) * 1.2f) {
                            activeSideGesture = if (gestureStartX < root.width / 2f) 1 else 2
                            sideGestureAdjusted = true
                            handler.removeCallbacks(hideControls)
                        }
                    }
                    if (!isPinching && sideGestureAdjusted) {
                        val delta = ((gestureStartY - event.y) / root.height.coerceAtLeast(1).toFloat()).coerceIn(-1f, 1f)
                        if (activeSideGesture == 1) {
                            val brightness = (gestureStartBrightness + delta).coerceIn(0.05f, 1f)
                            val attrs = window.attributes
                            attrs.screenBrightness = brightness
                            window.attributes = attrs
                            updateGestureIndicator(brightness, activeSideGesture)
                        } else if (activeSideGesture == 2) {
                            val newVolume = (gestureStartVolume + delta * 1.5f).coerceIn(0f, 1f)
                            controller?.volume = newVolume
                            volumeMuted = newVolume <= 0.001f
                            if (::volumeButton.isInitialized) volumeButton.text = if (volumeMuted) "🔇" else "🔊"
                            updateGestureIndicator(newVolume, activeSideGesture)
                        }
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (sideGestureAdjusted && !isPinching) {
                        gestureIndicator.visibility = View.GONE
                    } else if (!locked && !isPinching && event.pointerCount <= 1) {
                        val now = System.currentTimeMillis()
                        if (now - lastTap < 300) { toggleFit(); lastTap = 0L } else { lastTap = now; toggleControls() }
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
            background = null
        }
        val top = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(10), dp(4), dp(10), dp(4))
            background = null
        }
        // Requested layout: speed button on the LEFT, title in the middle, share on the RIGHT.
        speedButton = compactTool("1×  ▾") { showSpeedPicker() }.apply {
            contentDescription = "Playback speed menu"
            background = solidButton(Color.rgb(112, 55, 190))
            minWidth = dp(76)
            textSize = 16f
            setPadding(dp(10), dp(8), dp(10), dp(8))
            isClickable = true
            isFocusable = true
        }
        top.addView(speedButton, LinearLayout.LayoutParams(-2, dp(48)))
        titleLabel = TextView(this).apply {
            text = videoTitle; setTextColor(Color.WHITE); textSize = 14f
            maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), 0, dp(8), 0)
        }
        top.addView(titleLabel, LinearLayout.LayoutParams(0, dp(48), 1f))
        shareButton = compactTool("↗  Share") { shareCurrentVideo() }.apply {
            contentDescription = "Share current video"
            background = solidButton(Color.rgb(34, 150, 82))
            minWidth = dp(88)
            textSize = 16f
            setPadding(dp(10), dp(8), dp(10), dp(8))
            isClickable = true
            isFocusable = true
        }
        top.addView(shareButton, LinearLayout.LayoutParams(-2, dp(48)))
        topBar = top
        top.background = null
        root.addView(topBar, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))

        // Transparent, balanced control row: previous immediately left of the centered Play/Pause,
        // next immediately right. Remaining actions are distributed on both sides.
        val middle = LinearLayout(this).apply {
            minimumHeight = dp(50)
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            weightSum = 2f
            // Always occupy the full available player width, including landscape.
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(50))
        }
        fun makeIcon(icon: Int, action: () -> Unit): ImageButton = iconButton(icon, action).apply {
            background = null
            setColorFilter(Color.WHITE)
            setPadding(dp(5), dp(5), dp(5), dp(5))
        }
        fun makeText(label: String, action: () -> Unit): TextView = compactTool(label, action).apply {
            textSize = 21f
            setTextColor(Color.WHITE)
            background = solidButton(Color.rgb(112, 55, 190))
            setPadding(dp(3), dp(5), dp(3), dp(5))
        }
        fun skipButton(reverse: Boolean): TextView = compactTool(if (reverse) "↶\\n15" else "↷\\n15") {
            controller?.let { player ->
                val duration = player.duration
                val target = if (reverse) (player.currentPosition - 15_000L).coerceAtLeast(0L)
                    else (player.currentPosition + 15_000L).let { if (duration > 0L) it.coerceAtMost(duration) else it }
                player.seekTo(target)
            }
            showControls()
        }.apply {
            textSize = 18f
            setLineSpacing(-dp(3).toFloat(), 1f)
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            background = solidButton(Color.rgb(205, 48, 64))
            setPadding(dp(2), 0, dp(2), 0)
            contentDescription = if (reverse) "Rewind 15 seconds" else "Forward 15 seconds"
        }
        val leftGroup = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT }
        val rewind = skipButton(true)
        leftGroup.addView(rewind, LinearLayout.LayoutParams(dp(48), dp(48)))
        fitButton = makeText("⛶") { toggleFit() }.apply { textSize = 29f; contentDescription = "Fit screen" }
        rotateButton = makeText("↻") { toggleOrientation() }.apply { contentDescription = "Rotate screen" }
        val previousButton = makeIcon(android.R.drawable.ic_media_previous) {
            controller?.let { p ->
                if (p.hasPreviousMediaItem()) p.seekToPreviousMediaItem()
                else if (p.currentPosition > 3000L) p.seekTo(0L)
                else Toast.makeText(this, "This is the first video in the queue", Toast.LENGTH_SHORT).show()
            } ?: Toast.makeText(this, "Player is not ready yet", Toast.LENGTH_SHORT).show()
        }
        leftGroup.addView(previousButton, LinearLayout.LayoutParams(dp(40), dp(48)))
        middle.addView(leftGroup, LinearLayout.LayoutParams(0, dp(48), 1f))

        val rightGroup = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL or Gravity.LEFT; tag = "meraj-right-control-group" }
        val nextButton = makeIcon(android.R.drawable.ic_media_next) {
            controller?.let { p -> if (p.hasNextMediaItem()) p.seekToNextMediaItem() else Toast.makeText(this, "No next video in playback queue", Toast.LENGTH_SHORT).show() }
                ?: Toast.makeText(this, "Player is not ready yet", Toast.LENGTH_SHORT).show()
        }
        rightGroup.addView(nextButton, LinearLayout.LayoutParams(dp(48), dp(52)))
        val forward = skipButton(false)
        rightGroup.addView(forward, LinearLayout.LayoutParams(dp(48), dp(48)))
        rightGroup.addView(fitButton, LinearLayout.LayoutParams(dp(48), dp(48)))
        lockButton = makeText("🔓") {
            locked = !locked
            lockButton.text = if (locked) "🔒" else "🔓"
            lockButton.contentDescription = if (locked) "Unlock video controls" else "Lock video controls"
            setControlsLocked(locked)
            if (locked) { handler.removeCallbacks(hideControls); Toast.makeText(this, "Controls locked — tap lock to unlock", Toast.LENGTH_SHORT).show() }
            else { showControls(); Toast.makeText(this, "Controls unlocked", Toast.LENGTH_SHORT).show() }
        }
        rightGroup.addView(lockButton, LinearLayout.LayoutParams(dp(48), dp(48)))
        rightGroup.addView(rotateButton, LinearLayout.LayoutParams(dp(48), dp(48)))
        middle.addView(rightGroup, LinearLayout.LayoutParams(0, dp(48), 1f))

        playButton = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_media_play)
            setColorFilter(Color.WHITE)
            background = null
            setPadding(dp(5), dp(5), dp(5), dp(5))
            scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
            contentDescription = "Play or pause"
            setOnClickListener { controller?.let { if (it.isPlaying) it.pause() else it.play() }; showControls() }
        }
        val playSize = dp(44)
        middle.addView(playButton, 1, LinearLayout.LayoutParams(playSize, dp(48)))
        controls.addView(middle, LinearLayout.LayoutParams(-1, dp(50)))
        // Volume is deliberately removed from the button row; adjust it by swiping vertically on the right half.
        volumeButton = compactTool("🔊") { showVolumePicker() }

        val seekRow = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; orientation = LinearLayout.HORIZONTAL }
        positionLabel = timeLabel("00:00"); seekRow.addView(positionLabel)
        seekBar = SeekBar(this).apply {
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

    private fun solidButton(color: Int) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(8).toFloat()
    }

    private fun panelBackground() = GradientDrawable().apply {
        setColor(Color.argb(224, 5, 20, 24))
        cornerRadius = dp(12).toFloat()
        setStroke(dp(1), Color.argb(105, 105, 207, 197))
    }
    private fun toolBackground() = GradientDrawable().apply {
        setColor(Color.argb(225, 7, 27, 32))
        cornerRadius = dp(9).toFloat()
        setStroke(dp(1), Color.argb(115, 105, 207, 197))
    }
    private fun primaryToolBackground() = GradientDrawable().apply {
        setColor(Color.rgb(20, 123, 112))
        cornerRadius = dp(10).toFloat()
        setStroke(dp(1), Color.rgb(71, 217, 200))
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
        setImageResource(icon); setColorFilter(Color.WHITE); background = solidButton(Color.rgb(34, 150, 82))
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
            controls.findViewWithTag<LinearLayout>("meraj-right-control-group")?.gravity = Gravity.CENTER_VERTICAL or Gravity.LEFT
            val landscape = resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
            controls.setPadding(if (landscape) dp(4) else dp(8), dp(2), if (landscape) dp(4) else dp(8), dp(4))
            (controls.layoutParams as? FrameLayout.LayoutParams)?.let {
                // Explicitly stretch the complete control strip edge-to-edge in landscape.
                it.width = FrameLayout.LayoutParams.MATCH_PARENT
                it.leftMargin = 0
                it.rightMargin = 0
                it.bottomMargin = if (landscape) dp(12) else dp(56)
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
            if (!locked) { controls.visibility = View.GONE; topBar.visibility = View.GONE; handler.removeCallbacks(hideControls) }
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
        val p = controller
        if (p == null) {
            Toast.makeText(this, "Player is not ready yet", Toast.LENGTH_SHORT).show()
            return
        }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(12), dp(22), dp(8))
        }
        val label = TextView(this).apply {
            text = if (volumeMuted) "Volume: muted" else "Volume: ${(p.volume * 100).toInt()}%"
            textSize = 14f
        }
        panel.addView(label)
        val slider = SeekBar(this).apply {
            max = 100
            progress = if (volumeMuted) 0 else (p.volume * 100).toInt().coerceIn(0, 100)
        }
        panel.addView(slider)
        val dialog = AlertDialog.Builder(this)
            .setTitle("Video volume")
            .setView(panel)
            .setNegativeButton("Mute", null)
            .setPositiveButton("Done", null)
            .create()
        slider.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onProgressChanged(sb: SeekBar, value: Int, fromUser: Boolean) {
                if (!fromUser) return
                val current = controller ?: return
                current.volume = value / 100f
                volumeMuted = value == 0
                volumeButton.text = if (volumeMuted) "🔇" else "🔊"
                label.text = if (volumeMuted) "Volume: muted" else "Volume: $value%"
            }
            override fun onStopTrackingTouch(sb: SeekBar) {}
        })
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setOnClickListener {
                controller?.volume = 0f
                volumeMuted = true
                volumeButton.text = "🔇"
                slider.progress = 0
                label.text = "Volume: muted"
            }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (slider.progress > 0) volumeMuted = false
                volumeButton.text = if (volumeMuted) "🔇" else "🔊"
                dialog.dismiss()
                showControls()
            }
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
    private fun toggleFit() { fitMode = (fitMode + 1) % 3; playerView.resizeMode = when (fitMode) { 1 -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM; 2 -> AspectRatioFrameLayout.RESIZE_MODE_FILL; else -> AspectRatioFrameLayout.RESIZE_MODE_FIT }; fitButton.text = when (fitMode) { 1 -> "Zoom"; 2 -> "Fill"; else -> "Fit" }; showControls() }
    private fun toggleOrientation() {
        requestedOrientation = if (resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE) ActivityInfo.SCREEN_ORIENTATION_PORTRAIT else ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
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
                setColor(Color.rgb(31, 24, 46))
                cornerRadius = dp(10).toFloat()
                setStroke(dp(1), Color.rgb(112, 55, 190))
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
                if (value == speed) background = solidButton(Color.rgb(112, 55, 190))
                setOnClickListener {
                    speed = value
                    controller?.setPlaybackSpeed(speed)
                    speedButton.text = if (speed == 1f) "1×  ▾" else "${speed}×  ▾"
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
        const val EXTRA_QUEUE_URIS = "com.meraj.mediaplayer.VIDEO_QUEUE_URIS"
        const val EXTRA_QUEUE_TITLES = "com.meraj.mediaplayer.VIDEO_QUEUE_TITLES"
        const val EXTRA_QUEUE_MIMES = "com.meraj.mediaplayer.VIDEO_QUEUE_MIMES"
    }
}
