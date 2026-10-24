# Meraj Media — Offline Audio + Video Player

This project keeps the original offline audio library/player and replaces the former **MP3 Tools** navigation section with the full **Video Player** UI. The video player runs in a separate local HTML page inside an iframe to isolate its CSS and JavaScript from the existing audio player. A parent bridge forwards native media scan, thumbnail/cache, orientation and back-button calls to Capacitor plugins.

- Audio: local music scan, library, albums, artists, folders, favorites, queue/player, playback controls and themes.
- Video: local video library, search/folders, thumbnails, playback, seekbar, previous/next, 15-second seek, volume, fit/fullscreen, landscape rotate, lock controls and 0.5×–2× speed popup.
- Offline-first; no streaming or ad features. Build workflow strips the INTERNET permission.

## Browser preview
Run `npm install` then `npm run start`. Browser security requires selecting local audio folders/files for audio. Native video library scanning, orientation lock and Android MediaStore cache playback require the Android APK.

## Android build
GitHub Actions builds the debug APK. The native integration script registers media plugins and Media3 dependencies; physical-device testing is still required for Android permissions, codec support and orientation behavior.
