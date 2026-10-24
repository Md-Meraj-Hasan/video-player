# MP3 Tools Tag Editor Fix

- Replaced the prior tag writer with an ID3v2.4 writer.
- Uses UTF-8 text frames with synchsafe frame sizes, matching the ID3v2.4 format.
- Removes an existing ID3v2 tag before writing new tags, so repeated edits do not stack tags.
- Removes an ID3v1 trailer when present.
- Keeps the original MP3 audio payload unchanged and writes a new `-tagged.mp3` copy.
- Some audio formats may not decode on every Android WebView.
- APK build and real-device processing have not been executed in this environment.
