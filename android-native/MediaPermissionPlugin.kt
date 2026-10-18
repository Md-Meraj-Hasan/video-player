package com.meraj.mediaplayer

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PermissionState
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * One-time-at-first-use media permission bridge.
 * Android remembers granted runtime permissions; do not request again while already granted.
 * The OS may ask again if the user revokes permission or Android resets it.
 */
@CapacitorPlugin(
    name = "MediaPermission",
    permissions = [
        Permission(strings = [Manifest.permission.READ_MEDIA_AUDIO, Manifest.permission.READ_MEDIA_VIDEO], alias = "media13"),
        Permission(strings = [Manifest.permission.READ_EXTERNAL_STORAGE], alias = "mediaLegacy")
    ]
)
class MediaPermissionPlugin : Plugin() {
    @PluginMethod
    fun requestIfNeeded(call: PluginCall) {
        val alias = if (Build.VERSION.SDK_INT >= 33) "media13" else "mediaLegacy"
        if (getPermissionState(alias) == PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true).put("alreadyGranted", true))
            return
        }
        pendingCall = call
        requestPermissionForAlias(alias, call, "permissionResult")
    }

    private var pendingCall: PluginCall? = null

    @PermissionCallback
    private fun permissionResult(call: PluginCall) {
        val alias = if (Build.VERSION.SDK_INT >= 33) "media13" else "mediaLegacy"
        val granted = getPermissionState(alias) == PermissionState.GRANTED
        call.resolve(JSObject().put("granted", granted).put("alreadyGranted", false))
        pendingCall = null
    }
}
