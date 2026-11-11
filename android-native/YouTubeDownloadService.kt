package __PACKAGE__

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder

class YouTubeDownloadService : Service() {
    companion object {
        const val ACTION_START = "com.meraj.nicedownloader.START_PLAYLIST"
        const val ACTION_UPDATE = "com.meraj.nicedownloader.UPDATE_PLAYLIST"
        const val ACTION_STOP = "com.meraj.nicedownloader.STOP_PLAYLIST"
        const val ACTION_CANCEL = "com.meraj.nicedownloader.CANCEL_PLAYLIST"
        private const val CHANNEL_ID = "nice_downloader_playlist"
        private const val NOTIFICATION_ID = 7301
    }

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Playlist downloads", NotificationManager.IMPORTANCE_LOW)
            channel.description = "Ongoing playlist download progress and cancellation"
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CANCEL -> {
                YouTubeDownloadPlugin.cancelFromNotification()
                updateNotification("Cancelling playlist…", true)
            }
            ACTION_UPDATE -> updateNotification(intent.getStringExtra("message") ?: "Downloading playlist…", false)
            ACTION_STOP -> {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                val notification = buildNotification(intent?.getStringExtra("message") ?: "Preparing playlist…", false)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                } else startForeground(NOTIFICATION_ID, notification)
            }
        }
        return START_NOT_STICKY
    }

    private fun updateNotification(message: String, cancelling: Boolean) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(message, cancelling))
    }

    private fun buildNotification(message: String, cancelling: Boolean): Notification {
        val cancelIntent = Intent(this, YouTubeDownloadService::class.java).setAction(ACTION_CANCEL)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0
        val cancelPending = PendingIntent.getService(this, 7302, cancelIntent, flags)
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
        builder.setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Nice Downloader")
            .setContentText(message)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
        if (!cancelling) builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cancel", cancelPending)
        return builder.build()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
