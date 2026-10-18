# Meraj Video — Offline Android Video Player

A video-only version of the local media player, using HTML/CSS/JavaScript, Capacitor, and the included Android MediaStore scanner. The app opens the video library on startup and requests media permission, then lists videos stored on the device.

- Local device videos only; no streaming features.
- Dark premium UI with purple/blue accents.
- Video playback, playlist navigation, repeat/shuffle, playback speed, fit/fullscreen and lock controls inherited from the source project.
- Android APK build workflow: `.github/workflows/build-apk.yml`.

Builds and device playback must be verified with GitHub Actions and a real Android device. Codec support depends on Android/device codecs.
