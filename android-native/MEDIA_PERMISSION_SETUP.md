# One-time media permission behavior

The intended behavior is: when the app is first opened, request the minimum Android media permissions needed to scan local audio and video. If permissions are already granted, skip the dialog and continue. Android remembers a grant across app launches, so the dialog should not appear every time.

`MediaPermissionPlugin.kt` is a native Capacitor bridge starter for Android 13+ (`READ_MEDIA_AUDIO`, `READ_MEDIA_VIDEO`) and older Android (`READ_EXTERNAL_STORAGE`). The GitHub Actions workflow copies and registers this plugin in the generated Android app. Confirm first-run and subsequent-run behavior on a physical device.

Important platform behavior: Android may ask again if the user revokes permission, clears app data, reinstalls the app, or the OS resets permission. That is controlled by Android and cannot safely be bypassed. Do not request `MANAGE_EXTERNAL_STORAGE` for normal shared media scanning; prefer MediaStore.

The build workflow generates a fresh Android project, copies the plugin into the generated package, registers it with Capacitor, declares media permissions and calls `MediaPermission.requestIfNeeded()` from app startup before scanning. Test first-run, subsequent-run, denial, and revoked-permission cases on Android 12 and Android 13+.
