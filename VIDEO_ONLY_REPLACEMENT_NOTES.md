# Video-only UI replacement
- Replaced visible MP3/music-focused labels and empty states with video-first language.
- Hid legacy MP3-only playback controls, artwork and audio folder tools in the UI.
- Kept their DOM IDs for app.js compatibility; the JavaScript playback/seeker implementation was not rewritten.
- Refined video frame and playlist scrolling CSS.
- Validation: JavaScript syntax and ZIP integrity checked. APK/device testing not performed.

## Premium theme cycle update (v19)
- The palette icon now cycles through Default, Green, Red, Silver, Graphite, Blue, Ocean, Sunset, Gold and Ice on every tap; no theme-name buttons are shown.
- The selected theme is saved as `merajMusicTheme` and shared between the audio UI and the embedded video library.
- Audio folder browsing now uses a horizontal, scrollable folder-chip row with the selected folder's tracks below it.
- Fixed the lock icon drawing radius conversion to use the integer `dp(2)` helper argument.
