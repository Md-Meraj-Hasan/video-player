# Subtitle positioning diagnosis and fix

## Findings from the supplied build logs
- GitHub Actions reports `BUILD SUCCESSFUL` and verifies local web assets. This confirms compilation and packaging, not subtitle placement on a real device.
- The native player is generated from `android-native/NativeVideoPlayerActivity.kt` by `scripts/integrate-native-media.cjs`.
- The prior position calculation used `playerView.height` as the fraction denominator, although Media3's `SubtitleView` can have a different measured height when the video is letterboxed.
- The prior fraction was capped at `0.42`, which could prevent enough upward clearance in some portrait/multi-line subtitle cases.
- Control coordinates were read relative to their parent rather than measured against the subtitle surface in screen coordinates.

## Change in this package
`android-native/NativeVideoPlayerActivity.kt`
- Calculates clearance using the measured `SubtitleView` height.
- Measures subtitle surface and controls in screen coordinates.
- Raises the maximum bottom padding fraction from 0.42 to 0.78.
- Recalculates after controls are shown/hidden and after the next layout pass.
- Keeps Media3 ExoPlayer playback and the CC track toggle.

## Important validation status
The supplied GitHub Actions log shows a successful APK build for the commit used in that run. This modified source package has not yet been built or tested on a physical Android device. Subtitle files that explicitly specify their own cue position may still need separate handling.
