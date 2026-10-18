# Native Android playback integration (Media3 / ExoPlayer)

This folder contains the native playback implementation plan and Kotlin source for the next Android integration stage.

- Media3/ExoPlayer is used for automatic container/codec detection; users do not manually choose a format.
- The app passes a selected file URI to ExoPlayer and lets it detect the supported format.
- Actual format support depends on device decoders and included Media3 modules. No single player can guarantee every codec/container.
- This native bridge is not yet wired into the generated Capacitor app in this source ZIP. See `MerajMediaPlayerPlugin.kt` and the integration notes.
- The current HTML player remains the fallback for browser-supported formats.

After `npx cap add android`, copy the Kotlin file to `android/app/src/main/java/com/meraj/mediaplayer/` and register the plugin in `MainActivity` before building. Add Media3 dependencies to `android/app/build.gradle`. Do not claim native playback is active until this integration and a device build have been tested.
