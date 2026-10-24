# Nice Multimedia — Shared Media3 playback

- `MerajPlaybackService` owns the single `ExoPlayer` and `MediaSession`.
- Audio controls connect through `MerajMediaPlayerPlugin` using `MediaController`.
- `NativeVideoPlayerActivity` now connects to that same session; it no longer creates a second `ExoPlayer`.
- Video uses its original Android `content://` URI and does not copy the full video file.
- Closing video restores the previous audio queue, index, position and play/pause state when an audio queue existed.

Source-level checks are complete. A Gradle build and real-device playback test are still required.
