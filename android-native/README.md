# Native Android playback integration (Media3 / ExoPlayer)

This folder contains the native Android media permission, scanner and audio playback plugins. The build workflow copies and registers these plugins in the generated Capacitor Android project.

- Media3/ExoPlayer is used for automatic container/codec detection; users do not manually choose a format.
- The app passes a selected file URI to ExoPlayer and lets it detect the supported format.
- Actual format support depends on device decoders and included Media3 modules. No single player can guarantee every codec/container.
- The build workflow registers the native playback bridge and adds the Media3 ExoPlayer dependency. Device playback still needs to be tested on a physical Android phone.
- The current HTML player remains the fallback for browser-supported formats.

The GitHub Actions workflow performs plugin copy/registration and adds the Media3 dependency. Verify playback on a physical Android phone before release.


## Background playback and notification

`MerajPlaybackService.kt` owns the ExoPlayer instance through Media3 `MediaSessionService`. Android can show its media notification and Play/Pause/Next controls while the app is backgrounded. The native plugin sends the local audio queue to the session so track transitions can advance automatically. The GitHub Actions build must be run and tested on a physical Android device; this source package has not been device-tested.


## Direct video playback (Media3 ExoPlayer)

Android MediaStore videos are opened in `NativeVideoPlayerActivity` using Media3 ExoPlayer and the original `content://` URI. The app does not copy video bytes into cache or app-private storage. Playback reads from the Android content provider; memory use is limited to player buffers and normal app/UI data. Android's decoder/codec support still determines which formats can play. The activity is added to the manifest and `media3-ui` is added by `scripts/integrate-native-media.cjs`.
