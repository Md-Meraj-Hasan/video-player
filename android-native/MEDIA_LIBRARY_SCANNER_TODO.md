# Automatic Android media library scanning — integration requirement

The web UI no longer exposes Choose Files / Choose Folder. It calls
`Capacitor.Plugins.MediaLibraryScanner.scan()` when a player opens or Rescan is tapped.

**Important:** the native `MediaLibraryScanner` plugin is not registered yet. Until it is
implemented and registered, the UI reports that automatic scanning needs Android integration.
This is intentional: a normal browser/WebView cannot silently enumerate all Android folders.

Required native work:
1. Implement a Capacitor Android plugin using `MediaStore.Audio` and `MediaStore.Video`.
2. Request `READ_MEDIA_AUDIO` and `READ_MEDIA_VIDEO` on Android 13+; handle the appropriate
   media read permissions on older supported Android versions.
3. Return media metadata, stable content URIs, duration, size, MIME type and relative path.
4. Provide playback support for `content://` URIs, ideally through Android Media3/ExoPlayer,
   and return items in a single library result.
5. Register the plugin in the generated Android MainActivity / Capacitor plugin setup.
6. Verify scan speed and permission-denied/empty-library states on a physical Android phone.

Do not request broad storage access unless a platform-specific need is established. MediaStore
is the preferred approach for indexing shared audio/video media.
